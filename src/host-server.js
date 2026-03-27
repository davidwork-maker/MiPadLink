import net from "node:net";
import { ensureAdbReverseForPort, getAdbDeviceLinkStatus } from "./adb.js";
import { decodeMessage, encodeMessage } from "./codec.js";
import { createCloseMessage, createFrameMessage, createHeartbeatMessage, createHelloMessage } from "./protocol.js";
import { createDisplayCaptureFrameProvider, createScreenCaptureFrameProvider, createStaticFrameProvider } from "./frame-provider.js";
import { checkAccessibilityPermission, createVirtualDisplaySession, getCaptureBackendStatus, injectDisplayInput, openAccessibilitySettings, openScreenRecordingSettings } from "./virtual-display-helper.js";
import { createDashboard } from "./dashboard.js";

const CAPTURE_PRESETS = {
  performance: { frameIntervalMs: 50, displayCaptureQuality: 0.55 },
  balanced: { frameIntervalMs: 100, displayCaptureQuality: 0.72 },
  battery: { frameIntervalMs: 200, displayCaptureQuality: 0.45 }
};

function describeCaptureBackend(captureBackend, captureBackendStatus) {
  if (captureBackend === "systemScreencapture") {
    return "系统 screencapture（默认，弹窗最少）";
  }
  if (captureBackend === "coreGraphics") {
    return "CoreGraphics（兼容兜底）";
  }
  if (captureBackend === "screenCaptureKit") {
    return "ScreenCaptureKit（实验模式，可能重复弹权限窗）";
  }
  if (captureBackendStatus?.systemScreencapture) {
    return "自动选择：系统 screencapture";
  }
  if (captureBackendStatus?.coreGraphicsFallback) {
    return "自动选择：CoreGraphics 兜底";
  }
  return "采集后端未确认";
}

function getAuthorizedDeviceCount(deviceLink) {
  return Array.isArray(deviceLink?.authorizedDevices) ? deviceLink.authorizedDevices.length : 0;
}

function getUnauthorizedDeviceCount(deviceLink) {
  return Array.isArray(deviceLink?.unauthorizedDevices) ? deviceLink.unauthorizedDevices.length : 0;
}

function isDeviceLinkReady(deviceLink) {
  return Boolean(deviceLink?.ok && getAuthorizedDeviceCount(deviceLink) > 0 && deviceLink?.reverseReady);
}

function describeDeviceLinkStatus(deviceLink, { port = 9009 } = {}) {
  const reverseTarget = deviceLink?.reverseTarget ?? `tcp:${port}`;
  if (!deviceLink?.checked) {
    return "正在检测 USB / adb 状态";
  }
  if (!deviceLink.ok) {
    return `未找到 adb${deviceLink.error ? `：${deviceLink.error}` : ""}`;
  }
  if (getAuthorizedDeviceCount(deviceLink) === 0) {
    if (getUnauthorizedDeviceCount(deviceLink) > 0) {
      return "已检测到平板，但还没有在平板上允许 USB 调试";
    }
    return "还没有检测到已授权的 USB 平板";
  }
  if (!deviceLink.reverseReady) {
    return `已检测到 ${getAuthorizedDeviceCount(deviceLink)} 台设备，但 ${reverseTarget} 还没转发`;
  }
  return `USB / adb 已就绪 · ${getAuthorizedDeviceCount(deviceLink)} 台设备 · ${reverseTarget}`;
}

export function buildDashboardHealth({
  virtualDisplayEnabled = false,
  virtualDisplaySession = null,
  activeClients = 0,
  mirrorDisplay = false,
  width = 1600,
  height = 900,
  accessibility = { checked: false, trusted: false, error: null },
  deviceLink = { checked: false, ok: false, authorizedDevices: [], unauthorizedDevices: [], reverseReady: false },
  captureBackend = "systemScreencapture",
  captureBackendStatus = null
} = {}) {
  const checks = [];
  checks.push({
    key: "host",
    label: "Mac 服务",
    tone: "ok",
    ok: true,
    detail: "Host 服务正在运行"
  });

  if (virtualDisplayEnabled) {
    checks.push({
      key: "display",
      label: "虚拟显示器",
      tone: virtualDisplaySession ? "ok" : "warn",
      ok: Boolean(virtualDisplaySession),
      detail: virtualDisplaySession
        ? `${mirrorDisplay ? "镜像显示" : "扩展屏"} · ${virtualDisplaySession.displayId} · ${virtualDisplaySession.width ?? width}x${virtualDisplaySession.height ?? height}`
        : "当前未激活，可点击“重建虚拟屏”恢复"
    });
  } else {
    checks.push({
      key: "display",
      label: "虚拟显示器",
      tone: "info",
      ok: true,
      detail: "当前会话未启用虚拟显示模式"
    });
  }

  const deviceLinkReady = isDeviceLinkReady(deviceLink);
  checks.push({
    key: "usb",
    label: "USB / ADB 链路",
    tone: !deviceLink?.checked
      ? "info"
      : deviceLinkReady
        ? "ok"
        : "warn",
    ok: deviceLinkReady,
    detail: describeDeviceLinkStatus(deviceLink)
  });

  checks.push({
    key: "pad",
    label: "平板连接",
    tone: activeClients > 0 ? "ok" : "warn",
    ok: activeClients > 0,
    detail: activeClients > 0
      ? `已连接 ${activeClients} 台客户端`
      : "在平板上打开 MiPadLink，连接 127.0.0.1:9009"
  });

  const accessibilityOk = !virtualDisplayEnabled || (accessibility.checked && accessibility.trusted);
  checks.push({
    key: "input",
    label: "触控回传权限",
    tone: accessibility.checked ? (accessibilityOk ? "ok" : "warn") : "info",
    ok: accessibilityOk,
    detail: accessibility.checked
      ? (accessibility.trusted
        ? "辅助功能权限已授权"
        : `辅助功能权限未授权${accessibility.error ? `：${accessibility.error}` : ""}`)
      : "等待检查辅助功能权限"
  });

  const captureOk = captureBackend === "screenCaptureKit"
    ? Boolean(captureBackendStatus?.screenCaptureKit)
    : captureBackend === "coreGraphics"
      ? true
      : captureBackend === "systemScreencapture"
        ? captureBackendStatus?.systemScreencapture !== false
        : Boolean(captureBackendStatus?.systemScreencapture || captureBackendStatus?.coreGraphicsFallback);
  checks.push({
    key: "capture",
    label: "画面采集",
    tone: captureOk ? "info" : "warn",
    ok: captureOk,
    detail: `${describeCaptureBackend(captureBackend, captureBackendStatus)}${captureBackendStatus?.screenCaptureKit ? " · 已检测到 ScreenCaptureKit helper" : ""}`
  });

  let recommendation = "现在可以把窗口拖到右侧扩展屏上。";
  if (virtualDisplayEnabled && !virtualDisplaySession) {
    recommendation = "先点击“重建虚拟屏”，确认 Mac 上第二块显示器已经恢复。";
  } else if (deviceLink?.checked && !deviceLink.ok) {
    recommendation = "先运行 ./start.sh，或在 dashboard 里点“修复 USB 连接”，让 host 自己补全 adb 链路。";
  } else if (deviceLink?.checked && getAuthorizedDeviceCount(deviceLink) === 0) {
    recommendation = getUnauthorizedDeviceCount(deviceLink) > 0
      ? "先在平板上点“允许 USB 调试”，然后回来刷新 USB 状态。"
      : "先用 USB 连上平板，并打开开发者选项里的 USB 调试。";
  } else if (deviceLink?.checked && !deviceLink.reverseReady) {
    recommendation = "先点“修复 USB 连接”，把 adb reverse 补上，然后再在平板里连接。";
  } else if (!accessibilityOk) {
    recommendation = "先去系统设置 -> 隐私与安全性 -> 辅助功能，给当前终端授权，这样触控回传才会生效。";
  } else if (activeClients === 0) {
    recommendation = "在平板上打开 MiPadLink，连接 127.0.0.1:9009，然后再把窗口拖到扩展屏。";
  }

  return {
    readiness: checks.every((check) => check.ok) ? "ready" : "attention",
    recommendation,
    checks
  };
}

export function buildDashboardGuide({
  host = "127.0.0.1",
  port = 9009,
  virtualDisplayEnabled = false,
  virtualDisplaySession = null,
  activeClients = 0,
  mirrorDisplay = false,
  accessibility = { checked: false, trusted: false, error: null },
  deviceLink = { checked: false, ok: false, authorizedDevices: [], unauthorizedDevices: [], reverseReady: false },
  captureBackend = "systemScreencapture"
} = {}) {
  const pushUniqueAction = (actions, action) => {
    if (actions.some((item) => item.action === action.action)) {
      return;
    }
    actions.push(action);
  };
  const steps = [];
  steps.push({
    key: "host",
    label: "启动 Mac 端服务",
    status: "done",
    detail: "Host 与 dashboard 已启动。"
  });

  if (virtualDisplayEnabled) {
    steps.push({
      key: "display",
      label: "准备虚拟显示器",
      status: virtualDisplaySession ? "done" : "current",
      detail: virtualDisplaySession
        ? `${mirrorDisplay ? "镜像模式" : "扩展屏模式"} 已就绪`
        : "虚拟屏当前未激活，先点击“重建虚拟屏”。"
    });
  }

  const deviceLinkStepStatus = !deviceLink?.checked
    ? "current"
    : !deviceLink.ok
      ? "current"
      : getAuthorizedDeviceCount(deviceLink) === 0
        ? "current"
        : deviceLink.reverseReady
          ? "done"
          : "current";
  steps.push({
    key: "usb",
    label: "检查 USB 与 adb reverse",
    status: deviceLinkStepStatus,
    detail: describeDeviceLinkStatus(deviceLink, { port })
  });

  const accessibilityStatus = !virtualDisplayEnabled
    ? "done"
    : accessibility.checked
      ? (accessibility.trusted ? "done" : "current")
      : "todo";
  steps.push({
    key: "accessibility",
    label: "检查触控权限",
    status: accessibilityStatus,
    detail: !virtualDisplayEnabled
      ? "当前会话未使用虚拟显示输入注入。"
      : accessibility.checked
        ? (accessibility.trusted
          ? "辅助功能权限已授权，触控可回传到 Mac。"
          : "辅助功能权限未授权，先在系统设置中授权当前终端。")
        : "点击“刷新检查”确认辅助功能权限状态。"
  });

  const padStatus = activeClients > 0
    ? "done"
    : (virtualDisplayEnabled && !virtualDisplaySession
      ? "todo"
      : isDeviceLinkReady(deviceLink)
        ? "current"
        : "todo");
  steps.push({
    key: "tablet",
    label: "连接平板",
    status: padStatus,
    detail: activeClients > 0
      ? `平板已连接，可直接使用。`
      : `在平板上打开 MiPadLink，连接 ${host}:${port}。`
  });

  const readyToUse = activeClients > 0 && (!virtualDisplayEnabled || Boolean(virtualDisplaySession));
  steps.push({
    key: "use",
    label: "开始使用",
    status: readyToUse ? "current" : "todo",
    detail: readyToUse
      ? "把窗口拖到右侧扩展屏；如果只想排障，也可以先切到镜像模式。"
      : "完成前面的步骤后，再把窗口拖到扩展屏。"
  });

  const actions = [];
  if (virtualDisplayEnabled && !virtualDisplaySession) {
    actions.push({
      key: "guide-refresh-display",
      label: "重建虚拟屏",
      action: "refreshDisplay",
      tone: "primary"
    });
    pushUniqueAction(actions, {
      key: "guide-open-screen-recording",
      label: "打开屏幕录制设置",
      action: "openScreenRecordingSettings",
      tone: "secondary"
    });
  } else if (virtualDisplaySession && mirrorDisplay) {
    actions.push({
      key: "guide-switch-extend",
      label: "切回扩展屏",
      action: "setMirror",
      payload: { enabled: false },
      tone: "primary"
    });
  } else if (virtualDisplaySession && activeClients === 0) {
    actions.push({
      key: "guide-switch-mirror",
      label: "切镜像排障",
      action: "setMirror",
      payload: { enabled: true },
      tone: "secondary"
    });
  }

  if (deviceLink?.checked && deviceLink.ok && getAuthorizedDeviceCount(deviceLink) > 0 && !deviceLink.reverseReady) {
    actions.unshift({
      key: "guide-repair-usb",
      label: "修复 USB 连接",
      action: "repairUsbLink",
      tone: "primary"
    });
  } else if (deviceLink?.checked && !isDeviceLinkReady(deviceLink)) {
    actions.unshift({
      key: "guide-refresh-usb",
      label: "刷新 USB 状态",
      action: "refreshDeviceLink",
      tone: "secondary"
    });
  }

  if (virtualDisplayEnabled && accessibility.checked && !accessibility.trusted) {
    actions.unshift({
      key: "guide-open-accessibility",
      label: "打开辅助功能设置",
      action: "openAccessibilitySettings",
      tone: "primary"
    });
  }

  if (virtualDisplayEnabled && captureBackend === "systemScreencapture") {
    pushUniqueAction(actions, {
      key: "guide-open-screen-recording-fallback",
      label: "打开屏幕录制设置",
      action: "openScreenRecordingSettings",
      tone: "secondary"
    });
  }

  actions.push({
    key: "guide-refresh-checks",
    label: "刷新检查",
    action: "refreshChecks",
    tone: actions.length === 0 ? "primary" : "secondary"
  });

  return {
    summary: readyToUse
      ? "连接链路已经就绪，可以开始拖动窗口。"
      : steps.find((step) => step.status === "current")?.detail || "按步骤完成连接。",
    steps,
    actions
  };
}

export function buildAcceptanceChecklist({
  host = "127.0.0.1",
  port = 9009,
  virtualDisplayEnabled = false,
  virtualDisplaySession = null,
  activeClients = 0,
  mirrorDisplay = false,
  accessibility = { checked: false, trusted: false, error: null },
  virtualDisplayAutoCloseMs = 30_000
} = {}) {
  const hasDisplay = !virtualDisplayEnabled || Boolean(virtualDisplaySession);
  const clientReady = activeClients > 0;
  const touchReady = clientReady && (!virtualDisplayEnabled || Boolean(accessibility?.trusted));

  const cases = [
    {
      id: "extend-window",
      title: "扩展屏窗口显示",
      readiness: hasDisplay && clientReady && !mirrorDisplay ? "ready" : "blocked",
      prerequisite: !hasDisplay
        ? "先重建虚拟屏"
        : !clientReady
          ? "先让平板连接到 MiPadLink"
          : mirrorDisplay
            ? "先切回扩展屏模式"
            : "已就绪",
      steps: [
        "在 Mac 上打开任意窗口，例如 Finder 或备忘录。",
        "把窗口拖到右侧虚拟显示器。",
        "观察平板是否看到完整窗口内容，而不是只有桌面。"
      ],
      expected: "平板上能看到被拖过去的真实窗口内容。"
    },
    {
      id: "touch-mapping",
      title: "触控映射与点击位置",
      readiness: touchReady ? "ready" : "blocked",
      prerequisite: !clientReady
        ? "先连接平板"
        : accessibility?.checked && !accessibility?.trusted
          ? "先授权辅助功能权限"
          : "已就绪",
      steps: [
        "在平板上点击窗口四角和中间位置。",
        "再尝试短拖动，观察 Mac 侧鼠标或目标控件是否跟随。",
        "如果有偏差，记下偏差方向和大致距离。"
      ],
      expected: "点击位置与 Mac 侧响应位置基本一致，可正常点击和短拖。"
    },
    {
      id: "fullscreen-fit",
      title: "全屏与完整显示",
      readiness: clientReady ? "ready" : "blocked",
      prerequisite: clientReady ? "已就绪" : "先连接平板",
      steps: [
        "在平板上切换全屏。",
        "在 Android 客户端切换“完整显示 / 铺满裁切”。",
        "观察是否出现裁边、黑边或比例异常。"
      ],
      expected: "完整显示模式下内容不被裁切；铺满模式下裁切行为符合预期。"
    },
    {
      id: "usb-reconnect",
      title: "USB 断开与重连",
      readiness: clientReady ? "ready" : "blocked",
      prerequisite: clientReady ? "已就绪" : "先建立一次稳定连接",
      steps: [
        "保持 host 运行，拔掉 USB 线。",
        "等待平板断开，再重新插回 USB。",
        "确认重新连上后，平板是否恢复显示。"
      ],
      expected: "重新插线并恢复连接后，平板能重新看到画面。"
    },
    {
      id: "cleanup-close",
      title: "收尾与自动关闭",
      readiness: virtualDisplayEnabled ? "ready" : "blocked",
      prerequisite: virtualDisplayEnabled ? "已就绪" : "当前未启用虚拟显示器模式",
      steps: [
        "关闭平板客户端，或直接断开连接。",
        `等待约 ${Math.round(Math.max(0, virtualDisplayAutoCloseMs) / 1000)} 秒。`,
        "观察 Mac 的虚拟显示器是否自动消失。"
      ],
      expected: "没有客户端后，虚拟显示器会自动收起，不残留第二块屏。"
    }
  ];

  const readyCases = cases.filter((item) => item.readiness === "ready").length;
  const readyPrimaryCases = cases.filter((item) => item.readiness === "ready" && item.id !== "cleanup-close").length;
  return {
    summary: readyPrimaryCases > 0
      ? `当前可直接执行 ${readyCases} 项人工验收测试。`
      : "先完成上面的连接向导，再开始人工验收。",
    host: `${host}:${port}`,
    cases
  };
}

function normalizeCapturePreset(presetName, frameIntervalMs, displayCaptureQuality) {
  if (presetName && CAPTURE_PRESETS[presetName]) {
    return presetName;
  }
  for (const [candidate, preset] of Object.entries(CAPTURE_PRESETS)) {
    if (preset.frameIntervalMs === frameIntervalMs && preset.displayCaptureQuality === displayCaptureQuality) {
      return candidate;
    }
  }
  return "balanced";
}

export function resolveVirtualDisplayTargets(virtualDisplaySession) {
  if (!virtualDisplaySession) {
    return {
      captureDisplayId: null,
      inputDisplayId: null
    };
  }
  return {
    captureDisplayId: Number.isFinite(virtualDisplaySession.captureDisplayId)
      ? virtualDisplaySession.captureDisplayId
      : virtualDisplaySession.displayId,
    inputDisplayId: Number.isFinite(virtualDisplaySession.inputDisplayId)
      ? virtualDisplaySession.inputDisplayId
      : virtualDisplaySession.displayId
  };
}

function createLineDecoder(onLine) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) onLine(line);
      index = buffer.indexOf("\n");
    }
  };
}

export function createHostConnectionHandler({
  send,
  width = 2560,
  height = 1600,
  frameIntervalMs = 80,
  now = () => Date.now(),
  frameProvider = createStaticFrameProvider(),
  inputSink = null,
  onInput = null,
  onFrame = null
}) {
  let sessionId = null;
  let seq = 0;
  let active = false;
  let lastInput = null;
  let timer = null;
  let currentFrameIntervalMs = frameIntervalMs;
  let frameInFlight = false;

  const pushFrame = (frame) => {
    if (!frame || !active || !sessionId) return;
    send(
      createFrameMessage({
        sessionId,
        seq,
        width: frame.width ?? width,
        height: frame.height ?? height,
        payload: frame.payload ?? "",
        payloadFormat: frame.payloadFormat ?? "text"
      })
    );
    seq += 1;
    if (onFrame) onFrame(frame, seq);
  };

  const sendNextFrame = () => {
    if (!active || !sessionId || frameInFlight) return;
    const currentSeq = seq;
    try {
      const maybeFrame = frameProvider.nextFrame({
        sessionId,
        seq: currentSeq,
        width,
        height
      });

      if (maybeFrame && typeof maybeFrame.then === "function") {
        frameInFlight = true;
        maybeFrame
          .then((frame) => pushFrame(frame))
          .catch((error) => {
            pushFrame({
              width,
              height,
              payload: `frame-provider-error:${error instanceof Error ? error.message : String(error)}`,
              payloadFormat: "text"
            });
          })
          .finally(() => {
            frameInFlight = false;
          });
        return;
      }

      pushFrame(maybeFrame);
    } catch (error) {
      pushFrame({
        width,
        height,
        payload: `frame-provider-error:${error instanceof Error ? error.message : String(error)}`,
        payloadFormat: "text"
      });
    }
  };

  const startFramePump = () => {
    if (timer) return;
    timer = setInterval(() => {
      sendNextFrame();
    }, currentFrameIntervalMs);
  };

  const stopFramePump = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  const close = (reason = "host-close") => {
    if (sessionId) {
      send(createCloseMessage({ sessionId, reason }));
    }
    active = false;
    stopFramePump();
  };

  const updateFrameIntervalMs = (nextFrameIntervalMs) => {
    if (!Number.isFinite(nextFrameIntervalMs) || nextFrameIntervalMs <= 0) {
      return;
    }
    if (nextFrameIntervalMs === currentFrameIntervalMs) {
      return;
    }
    currentFrameIntervalMs = nextFrameIntervalMs;
    if (active && sessionId) {
      stopFramePump();
      startFramePump();
    }
  };

  const onMessage = (message) => {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "hello") {
      sessionId = message.sessionId;
      active = true;
      send(
        createHelloMessage({
          sessionId,
          role: "host",
          capabilities: {
            render: ["frame-stream"],
            input: ["touch", "mouse"],
            transport: "tcp-line"
          }
        })
      );
      sendNextFrame();
      startFramePump();
      return;
    }

    if (!sessionId || message.sessionId !== sessionId) {
      return;
    }

    if (message.type === "input") {
      lastInput = message;
      if (onInput) onInput(message);
      if (inputSink) {
        Promise.resolve(inputSink(message)).catch(() => {
          // Keep streaming even if local input injection is unavailable.
        });
      }
      return;
    }

    if (message.type === "heartbeat") {
      send(createHeartbeatMessage({ sessionId, ts: now() }));
      return;
    }

    if (message.type === "close") {
      close("client-close");
    }
  };

  const snapshot = () => ({
    sessionId,
    active,
    seq,
    lastInput,
    frameIntervalMs: currentFrameIntervalMs
  });

  return {
    onMessage,
    close,
    snapshot,
    updateFrameIntervalMs
  };
}

export async function startHostServer({
  host = "0.0.0.0",
  port = 9009,
  width = 2560,
  height = 1600,
  frameIntervalMs = 80,
  frameSource = "screen",
  virtualDisplay = false,
  mirrorDisplay = false,
  virtualDisplayName = "PadLink Virtual Display",
  virtualDisplayHiDPI = true,
  virtualDisplayPpi = 110,
  displayCaptureQuality = 0.72,
  captureBackend = "systemScreencapture",
  capturePreset = "balanced",
  refreshRate = 60,
  logInput = false,
  virtualDisplayAutoCloseMs = 30_000,
  createVirtualDisplaySessionFn = createVirtualDisplaySession,
  checkAccessibilityPermissionFn = checkAccessibilityPermission,
  getCaptureBackendStatusFn = getCaptureBackendStatus,
  injectDisplayInputFn = injectDisplayInput,
  getAdbDeviceLinkStatusFn = getAdbDeviceLinkStatus,
  ensureAdbReverseForPortFn = ensureAdbReverseForPort,
  openAccessibilitySettingsFn = openAccessibilitySettings,
  openScreenRecordingSettingsFn = openScreenRecordingSettings,
  createDashboardFn = createDashboard,
  deviceLinkPollIntervalMs = 15_000
} = {}) {
  const initialCaptureQuality = Number.isFinite(displayCaptureQuality)
    ? Math.min(1, Math.max(0.1, displayCaptureQuality))
    : CAPTURE_PRESETS.balanced.displayCaptureQuality;
  const runtime = {
    capturePreset: normalizeCapturePreset(capturePreset, frameIntervalMs, initialCaptureQuality),
    frameIntervalMs,
    displayCaptureQuality: initialCaptureQuality,
    captureBackend,
    mirrorDisplay: Boolean(mirrorDisplay)
  };
  let server = null;
  let dashboard = null;
  let actualPort = port;
  let closePromise = null;
  let shuttingDown = false;
  let virtualDisplaySession = null;
  let virtualDisplaySetupPromise = null;
  let idleCloseTimer = null;
  let captureBackendLogged = false;
  let accessibilityWarningLogged = false;
  let accessibilityStatus = {
    checked: false,
    trusted: false,
    error: null
  };
  let captureBackendStatus = null;
  let virtualDisplayConfig = {
    width,
    height,
    refreshRate,
    ppi: virtualDisplayPpi,
    hiDPI: virtualDisplayHiDPI,
    mirror: runtime.mirrorDisplay,
    name: virtualDisplayName
  };
  let streamWidth = width;
  let streamHeight = height;
  const frameProviderController = {
    current: frameSource === "screen"
    ? createScreenCaptureFrameProvider()
    : createStaticFrameProvider(),
    nextFrame(args) {
      return this.current.nextFrame(args);
    }
  };
  const connectionHandlers = new Set();
  const activeSockets = new Set();
  let activeClients = 0;
  let totalFramesPushed = 0;
  let deviceLinkStatus = {
    checked: false,
    ok: false,
    adbPath: null,
    devices: [],
    authorizedDevices: [],
    unauthorizedDevices: [],
    reverseMappings: [],
    reverseTarget: `tcp:${port}`,
    reverseReady: false,
    ready: false,
    error: null,
    lastRepair: null
  };
  let deviceLinkRefreshPromise = null;
  let deviceLinkPollTimer = null;

  const clearIdleCloseTimer = () => {
    if (!idleCloseTimer) return;
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  };

  const clearDeviceLinkPollTimer = () => {
    if (!deviceLinkPollTimer) return;
    clearInterval(deviceLinkPollTimer);
    deviceLinkPollTimer = null;
  };

  const refreshDeviceLink = async ({ repair = false, logResult = false } = {}) => {
    if (deviceLinkRefreshPromise) {
      return deviceLinkRefreshPromise;
    }
    deviceLinkRefreshPromise = (async () => {
      try {
        let nextStatus = await getAdbDeviceLinkStatusFn({
          port: actualPort || port
        });
        let repairResult = null;
        if (repair && nextStatus.ok && getAuthorizedDeviceCount(nextStatus) > 0 && !nextStatus.reverseReady) {
          repairResult = await ensureAdbReverseForPortFn({
            port: actualPort || port,
            adbPath: nextStatus.adbPath,
            serials: nextStatus.authorizedDevices.map((device) => device.serial)
          });
          nextStatus = await getAdbDeviceLinkStatusFn({
            port: actualPort || port
          });
        }
        deviceLinkStatus = {
          checked: true,
          ...nextStatus,
          lastRepair: repairResult
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        deviceLinkStatus = {
          checked: true,
          ok: false,
          adbPath: null,
          devices: [],
          authorizedDevices: [],
          unauthorizedDevices: [],
          reverseMappings: [],
          reverseTarget: `tcp:${actualPort || port}`,
          reverseReady: false,
          ready: false,
          error: reason,
          lastRepair: null
        };
      }

      updateDashboardState();
      if (dashboard && logResult) {
        if (isDeviceLinkReady(deviceLinkStatus)) {
          dashboard.log("USB / adb 链路已就绪", "ok");
        } else {
          dashboard.log(describeDeviceLinkStatus(deviceLinkStatus, { port: actualPort || port }), deviceLinkStatus.ok ? "info" : "error");
        }
      }
      return {
        ok: true,
        deviceLink: deviceLinkStatus
      };
    })();
    try {
      return await deviceLinkRefreshPromise;
    } finally {
      deviceLinkRefreshPromise = null;
    }
  };

  const updateDashboardState = () => {
    if (!dashboard) return;
    dashboard.updateState({
      host,
      port: actualPort,
      frameIntervalMs: runtime.frameIntervalMs,
      displayCaptureQuality: runtime.displayCaptureQuality,
      capturePreset: runtime.capturePreset,
      mirrorEnabled: runtime.mirrorDisplay,
      clients: activeClients,
      totalFrames: totalFramesPushed,
      health: buildDashboardHealth({
        virtualDisplayEnabled: virtualDisplay,
        virtualDisplaySession,
        activeClients,
        mirrorDisplay: runtime.mirrorDisplay,
        width: streamWidth,
        height: streamHeight,
        accessibility: accessibilityStatus,
        deviceLink: deviceLinkStatus,
        captureBackend: runtime.captureBackend,
        captureBackendStatus
      }),
      guide: buildDashboardGuide({
        host,
        port: actualPort,
        virtualDisplayEnabled: virtualDisplay,
        virtualDisplaySession,
        activeClients,
        mirrorDisplay: runtime.mirrorDisplay,
        accessibility: accessibilityStatus,
        deviceLink: deviceLinkStatus,
        captureBackend: runtime.captureBackend
      }),
      acceptanceChecklist: buildAcceptanceChecklist({
        host,
        port: actualPort,
        virtualDisplayEnabled: virtualDisplay,
        virtualDisplaySession,
        activeClients,
        mirrorDisplay: runtime.mirrorDisplay,
        accessibility: accessibilityStatus,
        virtualDisplayAutoCloseMs
      }),
      virtualDisplay: virtualDisplaySession
        ? {
          displayId: virtualDisplaySession.displayId,
          width: streamWidth,
          height: streamHeight,
          name: virtualDisplaySession.name,
          mirror: runtime.mirrorDisplay
        }
        : null,
      deviceLink: deviceLinkStatus
    });
  };

  const refreshFrameProvider = () => {
    if (!virtualDisplaySession) {
      frameProviderController.current = virtualDisplay
        ? createStaticFrameProvider({ prefix: "virtual-display-closed" })
        : frameSource === "screen"
          ? createScreenCaptureFrameProvider()
          : createStaticFrameProvider();
      return;
    }
    const { captureDisplayId } = resolveVirtualDisplayTargets(virtualDisplaySession);
    frameProviderController.current = createDisplayCaptureFrameProvider({
      displayId: captureDisplayId,
      quality: runtime.displayCaptureQuality,
      captureBackend: runtime.captureBackend
    });
  };

  const applyCapturePreset = (presetName) => {
    const preset = CAPTURE_PRESETS[presetName];
    if (!preset) {
      throw new Error(`unknown-capture-preset:${presetName}`);
    }
    runtime.capturePreset = presetName;
    runtime.frameIntervalMs = preset.frameIntervalMs;
    runtime.displayCaptureQuality = preset.displayCaptureQuality;
    for (const handler of connectionHandlers) {
      handler.updateFrameIntervalMs(runtime.frameIntervalMs);
    }
    refreshFrameProvider();
    updateDashboardState();
    dashboard.log(`Capture preset set to ${presetName} (${preset.frameIntervalMs}ms)`, "ok");
    return { ok: true, capturePreset: presetName };
  };

  const logCaptureBackendSelection = async () => {
    if (captureBackendLogged) return;
    captureBackendLogged = true;
    try {
      const backend = await getCaptureBackendStatusFn();
      captureBackendStatus = backend;
      if (captureBackend === "systemScreencapture") {
        console.log("[padlink] capture backend: system screencapture (forced)");
      } else if (captureBackend === "coreGraphics") {
        console.log("[padlink] capture backend: CoreGraphics (forced)");
      } else if (captureBackend === "screenCaptureKit") {
        console.log("[padlink] capture backend: ScreenCaptureKit (forced)");
        console.warn("[padlink] ScreenCaptureKit one-shot mode may trigger repeated macOS privacy prompts; prefer CoreGraphics for day-to-day local use.");
      } else if (backend.systemScreencapture) {
        console.log("[padlink] capture backend: system screencapture (CoreGraphics fallback enabled)");
      } else {
        console.warn("[padlink] capture backend: CoreGraphics only (ScreenCaptureKit helper unavailable)");
      }
    } catch {
      captureBackendStatus = {
        systemScreencapture: captureBackend === "systemScreencapture" ? false : null,
        screenCaptureKit: false,
        coreGraphicsFallback: captureBackend !== "screenCaptureKit"
      };
      console.warn("[padlink] capture backend: unknown (failed to resolve helper status)");
    }
  };

  const refreshRuntimeHealth = async ({ logResult = false } = {}) => {
    try {
      const permission = await checkAccessibilityPermissionFn();
      accessibilityStatus = {
        checked: true,
        trusted: Boolean(permission?.trusted),
        error: null
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      accessibilityStatus = {
        checked: true,
        trusted: false,
        error: reason
      };
    }

    try {
      captureBackendStatus = await getCaptureBackendStatusFn();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      captureBackendStatus = {
        systemScreencapture: runtime.captureBackend === "systemScreencapture" ? false : null,
        screenCaptureKit: false,
        coreGraphicsFallback: runtime.captureBackend !== "screenCaptureKit",
        error: reason
      };
    }

    updateDashboardState();
    if (dashboard && logResult) {
      const health = buildDashboardHealth({
        virtualDisplayEnabled: virtualDisplay,
        virtualDisplaySession,
        activeClients,
        mirrorDisplay: runtime.mirrorDisplay,
        width: streamWidth,
        height: streamHeight,
        accessibility: accessibilityStatus,
        deviceLink: deviceLinkStatus,
        captureBackend: runtime.captureBackend,
        captureBackendStatus
      });
      dashboard.log(health.recommendation, health.readiness === "ready" ? "ok" : "info");
    }
    return {
      ok: true,
      health: buildDashboardHealth({
        virtualDisplayEnabled: virtualDisplay,
        virtualDisplaySession,
        activeClients,
        mirrorDisplay: runtime.mirrorDisplay,
        width: streamWidth,
        height: streamHeight,
        accessibility: accessibilityStatus,
        deviceLink: deviceLinkStatus,
        captureBackend: runtime.captureBackend,
        captureBackendStatus
      })
    };
  };

  const scheduleDeviceLinkPolling = () => {
    clearDeviceLinkPollTimer();
    if (!Number.isFinite(deviceLinkPollIntervalMs) || deviceLinkPollIntervalMs <= 0) {
      return;
    }
    deviceLinkPollTimer = setInterval(() => {
      if (shuttingDown) {
        return;
      }
      refreshDeviceLink({ repair: activeClients === 0 }).catch((error) => {
        console.warn(`[padlink] failed to refresh device link: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, deviceLinkPollIntervalMs);
  };

  const ensureVirtualDisplayActive = async ({ reason = "startup" } = {}) => {
    if (!virtualDisplay) {
      return null;
    }
    clearIdleCloseTimer();
    if (virtualDisplaySession) {
      return virtualDisplaySession;
    }
    if (virtualDisplaySetupPromise) {
      return virtualDisplaySetupPromise;
    }
    virtualDisplaySetupPromise = (async () => {
      let accessibilityTrusted = true;
      try {
        const permission = await checkAccessibilityPermissionFn();
        accessibilityTrusted = Boolean(permission?.trusted);
        accessibilityStatus = {
          checked: true,
          trusted: accessibilityTrusted,
          error: null
        };
      } catch {
        accessibilityTrusted = false;
        accessibilityStatus = {
          checked: true,
          trusted: false,
          error: "permission-check-failed"
        };
      }
      if (!accessibilityTrusted && !accessibilityWarningLogged) {
        console.warn("[padlink] Accessibility permission is not trusted. Touch injection will not work until permission is granted.");
        accessibilityWarningLogged = true;
      }

      const nextSession = await createVirtualDisplaySessionFn(virtualDisplayConfig);
      if (nextSession.reused) {
        console.warn(`[padlink] virtual display creation hit system limit; reusing existing display id=${nextSession.displayId}.`);
      }
      virtualDisplaySession = nextSession;
      streamWidth = nextSession.width ?? width;
      streamHeight = nextSession.height ?? height;
      runtime.mirrorDisplay = Boolean(nextSession.mirror ?? runtime.mirrorDisplay);
      refreshFrameProvider();
      updateDashboardState();
      await logCaptureBackendSelection();
      if (dashboard && reason !== "startup") {
        dashboard.log(runtime.mirrorDisplay ? "Virtual display ready in mirror mode" : "Virtual display ready", "ok");
      }
      return nextSession;
    })();

    try {
      return await virtualDisplaySetupPromise;
    } finally {
      virtualDisplaySetupPromise = null;
    }
  };

  const teardownVirtualDisplay = async ({ reason = "manual", suppressLog = false } = {}) => {
    clearIdleCloseTimer();
    if (virtualDisplaySetupPromise) {
      try {
        await virtualDisplaySetupPromise;
      } catch {
        // Ignore setup failure during teardown.
      }
    }
    if (!virtualDisplaySession) {
      updateDashboardState();
      return { ok: true, virtualDisplayClosed: false };
    }
    const closingSession = virtualDisplaySession;
    virtualDisplaySession = null;
    streamWidth = width;
    streamHeight = height;
    refreshFrameProvider();
    updateDashboardState();
    await closingSession.close();
    if (dashboard && !suppressLog) {
      dashboard.log(`Virtual display closed (${reason})`, "ok");
    }
    return { ok: true, virtualDisplayClosed: true };
  };

  const scheduleVirtualDisplayIdleClose = (reason = "idle") => {
    clearIdleCloseTimer();
    if (!virtualDisplay || !virtualDisplaySession || shuttingDown || activeClients > 0) {
      return;
    }
    if (!Number.isFinite(virtualDisplayAutoCloseMs) || virtualDisplayAutoCloseMs <= 0) {
      return;
    }
    if (dashboard) {
      dashboard.log(`No clients connected, closing virtual display in ${Math.round(virtualDisplayAutoCloseMs / 1000)}s.`, "info");
    }
    idleCloseTimer = setTimeout(() => {
      idleCloseTimer = null;
      if (activeClients === 0 && virtualDisplaySession) {
        teardownVirtualDisplay({ reason }).catch((error) => {
          console.warn(`[padlink] failed to auto-close virtual display: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }, virtualDisplayAutoCloseMs);
  };

  const rebuildVirtualDisplay = async ({ mirror } = {}) => {
    if (!virtualDisplay) {
      throw new Error("virtual-display-disabled");
    }
    clearIdleCloseTimer();
    const previousConfig = { ...virtualDisplayConfig };
    const nextConfig = {
      ...virtualDisplayConfig,
      mirror: typeof mirror === "boolean" ? mirror : runtime.mirrorDisplay
    };

    if (virtualDisplaySession) {
      try {
        await teardownVirtualDisplay({ reason: "rebuild", suppressLog: true });
      } catch (closeError) {
        console.warn(`[padlink] failed to close previous virtual display: ${closeError instanceof Error ? closeError.message : String(closeError)}`);
      }
    }

    virtualDisplayConfig = nextConfig;
    runtime.mirrorDisplay = Boolean(nextConfig.mirror);

    try {
      const nextSession = await ensureVirtualDisplayActive({ reason: "rebuild" });
      virtualDisplaySession = nextSession;
      streamWidth = nextSession.width ?? width;
      streamHeight = nextSession.height ?? height;
      refreshFrameProvider();
      updateDashboardState();
      dashboard.log(runtime.mirrorDisplay ? "Mirror display enabled" : "Extended display enabled", "ok");
      return {
        ok: true,
        virtualDisplay: {
          displayId: nextSession.displayId,
          width: streamWidth,
          height: streamHeight,
          name: nextSession.name,
          mirror: runtime.mirrorDisplay
        }
      };
    } catch (error) {
      virtualDisplayConfig = previousConfig;
      runtime.mirrorDisplay = Boolean(previousConfig.mirror);
      try {
        await ensureVirtualDisplayActive({ reason: "restore" });
        dashboard.log("Restored previous virtual display after failed switch", "error");
      } catch (restoreError) {
        console.warn(`[padlink] failed to restore previous virtual display: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      }
      throw error;
    }
  };

  const closeHostServer = async () => {
    if (closePromise) {
      return closePromise;
    }
    shuttingDown = true;
    clearIdleCloseTimer();
    clearDeviceLinkPollTimer();
    closePromise = (async () => {
      for (const handler of connectionHandlers) {
        try {
          handler.close("host-shutdown");
        } catch {
          // no-op
        }
      }
      connectionHandlers.clear();
      for (const socket of activeSockets) {
        try {
          socket.destroy();
        } catch {
          // no-op
        }
      }
      activeSockets.clear();
      activeClients = 0;
      updateDashboardState();
      await new Promise((resolve, reject) => {
        if (!server || !server.listening) {
          resolve();
          return;
        }
        server.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
          else resolve();
        });
      });
      if (dashboard) {
        await dashboard.close();
      }
      await teardownVirtualDisplay({ reason: "host-shutdown", suppressLog: true });
    })();
    return closePromise;
  };

  const handleDashboardControl = async (payload) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("invalid-control-payload");
    }
    if (payload.action === "setMirror") {
      const nextMirror = Boolean(payload.enabled);
      if (nextMirror === runtime.mirrorDisplay && virtualDisplaySession) {
        return { ok: true, mirrorEnabled: runtime.mirrorDisplay };
      }
      return rebuildVirtualDisplay({ mirror: nextMirror });
    }
    if (payload.action === "setCapturePreset") {
      return applyCapturePreset(String(payload.preset ?? ""));
    }
    if (payload.action === "refreshDisplay") {
      return rebuildVirtualDisplay({ mirror: runtime.mirrorDisplay });
    }
    if (payload.action === "closeDisplay") {
      return teardownVirtualDisplay({ reason: "dashboard" });
    }
    if (payload.action === "refreshChecks") {
      const healthResult = await refreshRuntimeHealth({ logResult: true });
      const deviceResult = await refreshDeviceLink({ logResult: true });
      return {
        ...healthResult,
        deviceLink: deviceResult.deviceLink
      };
    }
    if (payload.action === "refreshDeviceLink") {
      return refreshDeviceLink({ logResult: true });
    }
    if (payload.action === "repairUsbLink") {
      return refreshDeviceLink({ repair: true, logResult: true });
    }
    if (payload.action === "openAccessibilitySettings") {
      const result = await openAccessibilitySettingsFn();
      dashboard.log("已打开辅助功能设置", "ok");
      return result;
    }
    if (payload.action === "openScreenRecordingSettings") {
      const result = await openScreenRecordingSettingsFn();
      dashboard.log("已打开屏幕录制设置", "ok");
      return result;
    }
    if (payload.action === "shutdownHost") {
      setTimeout(() => {
        closeHostServer().catch((error) => {
          console.warn(`[padlink] failed to shut down host: ${error instanceof Error ? error.message : String(error)}`);
        });
      }, 0);
      return { ok: true, shuttingDown: true };
    }
    throw new Error(`unknown-control-action:${payload.action}`);
  };

  if (virtualDisplay) {
    await ensureVirtualDisplayActive({ reason: "startup" });
  }

  // --- Dashboard ---
  dashboard = createDashboardFn({ port: 9010, onControl: handleDashboardControl });
  try {
    await dashboard.start();
    await refreshRuntimeHealth();
    updateDashboardState();
    dashboard.log("Host server starting...", "ok");
    console.log(`[padlink] dashboard: http://127.0.0.1:9010`);
  } catch (dashError) {
    console.warn(`[padlink] dashboard failed to start: ${dashError instanceof Error ? dashError.message : String(dashError)}`);
  }

  server = net.createServer((socket) => {
    const attachClient = async () => {
      socket.setEncoding("utf8");
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 10_000);
      socket.pause();
      activeSockets.add(socket);

      try {
        await ensureVirtualDisplayActive({ reason: "client-connect" });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        dashboard.log(`Unable to prepare virtual display: ${reason}`, "error");
        activeSockets.delete(socket);
        socket.destroy();
        return;
      }

      if (shuttingDown) {
        activeSockets.delete(socket);
        socket.destroy();
        return;
      }

      let socketClosed = false;
      let finalized = false;
      const send = (message) => {
        if (socketClosed || socket.destroyed || !socket.writable) return;
        try {
          socket.write(encodeMessage(message));
        } catch {
          socketClosed = true;
        }
      };
      activeClients += 1;
      updateDashboardState();
      dashboard.log(`Client connected (${activeClients} total)`, "ok");
      const handler = createHostConnectionHandler({
        send,
        width: streamWidth,
        height: streamHeight,
        frameIntervalMs: runtime.frameIntervalMs,
        frameProvider: frameProviderController,
        onInput: (message) => {
          dashboard.updateState({ lastInput: { x: message.x, y: message.y, action: message.action } });
          if (logInput) {
            const x = Number.isFinite(message.x) ? message.x.toFixed(3) : String(message.x);
            const y = Number.isFinite(message.y) ? message.y.toFixed(3) : String(message.y);
            console.log(`[padlink] input kind=${message.kind} action=${message.action ?? "tap"} x=${x} y=${y}`);
          }
        },
        onFrame: (frame) => {
          totalFramesPushed += 1;
          if (frame?.payloadFormat === "jpeg-base64" && totalFramesPushed % 5 === 0) {
            dashboard.preview(frame.payload);
          }
          if (totalFramesPushed % 10 === 0) {
            updateDashboardState();
          }
        },
        inputSink: virtualDisplay
          ? (message) => {
            const { inputDisplayId } = resolveVirtualDisplayTargets(virtualDisplaySession);
            if (!Number.isFinite(inputDisplayId)) {
              return Promise.resolve();
            }
            return injectDisplayInputFn({
              displayId: inputDisplayId,
              x: message.x,
              y: message.y,
              action: message.action ?? "tap"
            }).catch((error) => {
              const reason = error instanceof Error ? error.message : String(error);
              console.warn(`[padlink] input injection failed: ${reason}`);
            });
          }
          : null
      });
      connectionHandlers.add(handler);
      const finalize = (reason, level = "info") => {
        if (finalized) return;
        finalized = true;
        socketClosed = true;
        handler.close(reason);
        connectionHandlers.delete(handler);
        activeSockets.delete(socket);
        activeClients = Math.max(0, activeClients - 1);
        updateDashboardState();
        if (level === "error") {
          dashboard.log("Client connection error", "error");
        } else {
          dashboard.log(`Client disconnected (${activeClients} remaining)`);
        }
        if (activeClients === 0) {
          scheduleVirtualDisplayIdleClose("idle-client-disconnect");
        }
      };
      const onData = createLineDecoder((line) => {
        try {
          const message = decodeMessage(line);
          handler.onMessage(message);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[padlink] failed to process incoming message: ${reason}`);
        }
      });

      socket.on("data", onData);
      socket.on("close", () => finalize("socket-closed"));
      socket.on("error", () => finalize("socket-error", "error"));
      socket.resume();
    };

    attachClient().catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      dashboard.log(`Client attach failed: ${reason}`, "error");
      activeSockets.delete(socket);
      try {
        socket.destroy();
      } catch {
        // no-op
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  actualPort = server.address()?.port ?? port;
  updateDashboardState();
  await refreshDeviceLink({ repair: true });
  scheduleDeviceLinkPolling();

  return {
    host,
    port: actualPort,
    virtualDisplay: virtualDisplaySession,
    dashboard,
    close: closeHostServer
  };
}
