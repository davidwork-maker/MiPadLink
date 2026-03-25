import net from "node:net";
import { decodeMessage, encodeMessage } from "./codec.js";
import { createCloseMessage, createFrameMessage, createHeartbeatMessage, createHelloMessage } from "./protocol.js";
import { createDisplayCaptureFrameProvider, createScreenCaptureFrameProvider, createStaticFrameProvider } from "./frame-provider.js";
import { checkAccessibilityPermission, createVirtualDisplaySession, getCaptureBackendStatus, injectDisplayInput } from "./virtual-display-helper.js";
import { createDashboard } from "./dashboard.js";

const CAPTURE_PRESETS = {
  performance: { frameIntervalMs: 50, displayCaptureQuality: 0.55 },
  balanced: { frameIntervalMs: 100, displayCaptureQuality: 0.72 },
  battery: { frameIntervalMs: 200, displayCaptureQuality: 0.45 }
};

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
  logInput = false
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
  let virtualDisplaySession = null;
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

  const updateDashboardState = () => {
    dashboard.updateState({
      host,
      port,
      frameIntervalMs: runtime.frameIntervalMs,
      displayCaptureQuality: runtime.displayCaptureQuality,
      capturePreset: runtime.capturePreset,
      mirrorEnabled: runtime.mirrorDisplay,
      virtualDisplay: virtualDisplaySession
        ? {
          displayId: virtualDisplaySession.displayId,
          width: streamWidth,
          height: streamHeight,
          name: virtualDisplaySession.name,
          mirror: runtime.mirrorDisplay
        }
        : null
    });
  };

  const refreshFrameProvider = () => {
    if (!virtualDisplaySession) {
      frameProviderController.current = frameSource === "screen"
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

  const rebuildVirtualDisplay = async ({ mirror } = {}) => {
    if (!virtualDisplay) {
      throw new Error("virtual-display-disabled");
    }
    const previousSession = virtualDisplaySession;
    const previousConfig = virtualDisplayConfig;
    const nextConfig = {
      ...virtualDisplayConfig,
      mirror: typeof mirror === "boolean" ? mirror : runtime.mirrorDisplay
    };

    if (previousSession) {
      try {
        await previousSession.close();
      } catch (closeError) {
        console.warn(`[padlink] failed to close previous virtual display: ${closeError instanceof Error ? closeError.message : String(closeError)}`);
      }
      virtualDisplaySession = null;
    }

    try {
      const nextSession = await createVirtualDisplaySession(nextConfig);
      virtualDisplaySession = nextSession;
      virtualDisplayConfig = nextConfig;
      streamWidth = nextSession.width ?? width;
      streamHeight = nextSession.height ?? height;
      runtime.mirrorDisplay = Boolean(nextConfig.mirror);
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
      if (previousConfig) {
        try {
          const restoreSession = await createVirtualDisplaySession(previousConfig);
          virtualDisplaySession = restoreSession;
          virtualDisplayConfig = previousConfig;
          streamWidth = restoreSession.width ?? width;
          streamHeight = restoreSession.height ?? height;
          runtime.mirrorDisplay = Boolean(previousConfig.mirror);
          refreshFrameProvider();
          updateDashboardState();
          dashboard.log("Restored previous virtual display after failed switch", "error");
        } catch (restoreError) {
          console.warn(`[padlink] failed to restore previous virtual display: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
        }
      }
      throw error;
    }
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
    throw new Error(`unknown-control-action:${payload.action}`);
  };

  if (virtualDisplay) {
    let accessibilityTrusted = true;
    try {
      const permission = await checkAccessibilityPermission();
      accessibilityTrusted = Boolean(permission?.trusted);
    } catch {
      accessibilityTrusted = false;
    }
    if (!accessibilityTrusted) {
      console.warn("[padlink] Accessibility permission is not trusted. Touch injection will not work until permission is granted.");
    }

    virtualDisplaySession = await createVirtualDisplaySession(virtualDisplayConfig);
    if (virtualDisplaySession.reused) {
      console.warn(`[padlink] virtual display creation hit system limit; reusing existing display id=${virtualDisplaySession.displayId}.`);
    }
    streamWidth = virtualDisplaySession.width ?? width;
    streamHeight = virtualDisplaySession.height ?? height;
    runtime.mirrorDisplay = Boolean(virtualDisplaySession.mirror ?? runtime.mirrorDisplay);
    refreshFrameProvider();
    try {
      const backend = await getCaptureBackendStatus();
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
      console.warn("[padlink] capture backend: unknown (failed to resolve helper status)");
    }
  }

  // --- Dashboard ---
  const dashboard = createDashboard({ port: 9010, onControl: handleDashboardControl });
  let activeClients = 0;
  let totalFramesPushed = 0;
  try {
    await dashboard.start();
    updateDashboardState();
    dashboard.log("Host server starting...", "ok");
    console.log(`[padlink] dashboard: http://127.0.0.1:9010`);
  } catch (dashError) {
    console.warn(`[padlink] dashboard failed to start: ${dashError instanceof Error ? dashError.message : String(dashError)}`);
  }

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10_000);
    let socketClosed = false;
    const send = (message) => {
      if (socketClosed || socket.destroyed || !socket.writable) return;
      try {
        socket.write(encodeMessage(message));
      } catch {
        socketClosed = true;
      }
    };
    activeClients += 1;
    dashboard.updateState({ clients: activeClients });
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
          dashboard.updateState({ totalFrames: totalFramesPushed });
        }
      },
      inputSink: virtualDisplaySession
        ? (message) => injectDisplayInput({
          displayId: resolveVirtualDisplayTargets(virtualDisplaySession).inputDisplayId,
          x: message.x,
          y: message.y,
          action: message.action ?? "tap"
        }).catch((error) => {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[padlink] input injection failed: ${reason}`);
        })
        : null
    });
    connectionHandlers.add(handler);
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
    socket.on("close", () => {
      socketClosed = true;
      handler.close("socket-closed");
      connectionHandlers.delete(handler);
      activeClients = Math.max(0, activeClients - 1);
      dashboard.updateState({ clients: activeClients });
      dashboard.log(`Client disconnected (${activeClients} remaining)`);
    });
    socket.on("error", () => {
      socketClosed = true;
      handler.close("socket-error");
      connectionHandlers.delete(handler);
      activeClients = Math.max(0, activeClients - 1);
      dashboard.updateState({ clients: activeClients });
      dashboard.log("Client connection error", "error");
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  return {
    host,
    port,
    virtualDisplay: virtualDisplaySession,
    dashboard,
    close: () =>
      new Promise((resolve, reject) => {
        server.close(async (error) => {
          try {
            await dashboard.close();
            if (virtualDisplaySession) {
              await virtualDisplaySession.close();
            }
          } catch (closeError) {
            reject(closeError);
            return;
          }
          if (error) reject(error);
          else resolve();
        });
      })
  };
}
