import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { encodeMessage } from "./codec.js";
import { createHelloMessage } from "./protocol.js";
import { buildAcceptanceChecklist, buildDashboardGuide, buildDashboardHealth, createHostConnectionHandler, resolveVirtualDisplayTargets, startHostServer } from "./host-server.js";

test("host connection handler replies hello and sends frames after handshake", async () => {
  const sent = [];
  const handler = createHostConnectionHandler({
    send: (message) => sent.push(message),
    frameIntervalMs: 10,
    now: () => 777
  });

  handler.onMessage({
    type: "hello",
    sessionId: "s1",
    role: "client",
    capabilities: {}
  });

  assert.equal(sent[0].type, "hello");
  assert.equal(sent[1].type, "frame");
  assert.equal(sent[1].payloadFormat, "text");

  handler.onMessage({
    type: "heartbeat",
    sessionId: "s1",
    ts: 1
  });

  assert.equal(sent[sent.length - 1].type, "heartbeat");
  handler.close("done");
  assert.equal(handler.snapshot().active, false);
});

test("host connection handler captures latest input", () => {
  const sent = [];
  const inputs = [];
  const handler = createHostConnectionHandler({
    send: (message) => sent.push(message),
    frameIntervalMs: 1000,
    inputSink: (message) => {
      inputs.push(message);
    }
  });

  handler.onMessage({
    type: "hello",
    sessionId: "s2",
    role: "client",
    capabilities: {}
  });
  handler.onMessage({
    type: "input",
    sessionId: "s2",
    kind: "touch",
    x: 11,
    y: 22,
    buttons: 1
  });

  assert.equal(handler.snapshot().lastInput.kind, "touch");
  assert.equal(inputs.length, 1);
  handler.close("done");
});

test("host connection handler updates frame interval at runtime", () => {
  const sent = [];
  const frames = [];
  const handler = createHostConnectionHandler({
    send: (message) => sent.push(message),
    frameIntervalMs: 120,
    onFrame: (frame, seq) => frames.push({ frame, seq })
  });

  assert.equal(handler.snapshot().frameIntervalMs, 120);

  handler.onMessage({
    type: "hello",
    sessionId: "s3",
    role: "client",
    capabilities: {}
  });

  assert.ok(sent.some((message) => message.type === "frame"));
  assert.ok(frames.length > 0);

  handler.updateFrameIntervalMs(60);
  assert.equal(handler.snapshot().frameIntervalMs, 60);
  handler.close("done");
});

test("resolveVirtualDisplayTargets uses mirror source ids when provided", () => {
  assert.deepEqual(
    resolveVirtualDisplayTargets({
      displayId: 20,
      captureDisplayId: 1,
      inputDisplayId: 1,
      mirror: true
    }),
    {
      captureDisplayId: 1,
      inputDisplayId: 1
    }
  );

  assert.deepEqual(
    resolveVirtualDisplayTargets({
      displayId: 20
    }),
    {
      captureDisplayId: 20,
      inputDisplayId: 20
    }
  );
});

test("buildDashboardHealth points users to the tablet when host is ready but no client is connected", () => {
  const health = buildDashboardHealth({
    virtualDisplayEnabled: true,
    virtualDisplaySession: {
      displayId: 24,
      width: 1600,
      height: 900
    },
    activeClients: 0,
    accessibility: {
      checked: true,
      trusted: true
    },
    captureBackend: "systemScreencapture",
    captureBackendStatus: {
      systemScreencapture: true,
      coreGraphicsFallback: true,
      screenCaptureKit: false
    }
  });

  assert.equal(health.readiness, "attention");
  assert.match(health.recommendation, /在平板上打开 MiPadLink/);
  assert.equal(health.checks.find((item) => item.key === "display")?.ok, true);
  assert.equal(health.checks.find((item) => item.key === "pad")?.ok, false);
});

test("buildDashboardHealth asks for accessibility permission before touch input is considered ready", () => {
  const health = buildDashboardHealth({
    virtualDisplayEnabled: true,
    virtualDisplaySession: {
      displayId: 24,
      width: 1600,
      height: 900
    },
    activeClients: 1,
    accessibility: {
      checked: true,
      trusted: false,
      error: "permission-denied"
    },
    captureBackend: "coreGraphics",
    captureBackendStatus: {
      coreGraphicsFallback: true
    }
  });

  assert.equal(health.readiness, "attention");
  assert.match(health.recommendation, /辅助功能/);
  assert.equal(health.checks.find((item) => item.key === "input")?.ok, false);
});

test("buildDashboardHealth recommends repairing the USB link when adb reverse is missing", () => {
  const health = buildDashboardHealth({
    virtualDisplayEnabled: true,
    virtualDisplaySession: {
      displayId: 24,
      width: 1600,
      height: 900
    },
    activeClients: 0,
    accessibility: {
      checked: true,
      trusted: true
    },
    deviceLink: {
      checked: true,
      ok: true,
      authorizedDevices: [{ serial: "de59cf69", state: "device", detail: "usb:1-1" }],
      unauthorizedDevices: [],
      reverseReady: false,
      reverseTarget: "tcp:9009"
    },
    captureBackend: "systemScreencapture",
    captureBackendStatus: {
      systemScreencapture: true,
      coreGraphicsFallback: true,
      screenCaptureKit: false
    }
  });

  assert.match(health.recommendation, /修复 USB 连接/);
  assert.equal(health.checks.find((item) => item.key === "usb")?.ok, false);
});

test("buildDashboardGuide recommends rebuilding the virtual display when it is missing", () => {
  const guide = buildDashboardGuide({
    host: "127.0.0.1",
    port: 9009,
    virtualDisplayEnabled: true,
    virtualDisplaySession: null,
    activeClients: 0,
    accessibility: {
      checked: false,
      trusted: false
    }
  });

  assert.match(guide.summary, /重建虚拟屏/);
  assert.equal(guide.steps.find((item) => item.key === "display")?.status, "current");
  assert.equal(guide.actions[0]?.action, "refreshDisplay");
});

test("buildDashboardGuide suggests switching back to extend mode when mirror mode is active", () => {
  const guide = buildDashboardGuide({
    host: "127.0.0.1",
    port: 9009,
    virtualDisplayEnabled: true,
    virtualDisplaySession: {
      displayId: 24,
      width: 1600,
      height: 900
    },
    activeClients: 1,
    mirrorDisplay: true,
    accessibility: {
      checked: true,
      trusted: true
    }
  });

  assert.match(guide.summary, /可以开始拖动窗口/);
  assert.equal(guide.actions[0]?.action, "setMirror");
  assert.deepEqual(guide.actions[0]?.payload, { enabled: false });
});

test("buildDashboardGuide exposes accessibility recovery when touch permission is missing", () => {
  const guide = buildDashboardGuide({
    host: "127.0.0.1",
    port: 9009,
    virtualDisplayEnabled: true,
    virtualDisplaySession: {
      displayId: 24,
      width: 1600,
      height: 900
    },
    activeClients: 1,
    mirrorDisplay: false,
    accessibility: {
      checked: true,
      trusted: false
    },
    captureBackend: "systemScreencapture"
  });

  assert.equal(guide.actions[0]?.action, "openAccessibilitySettings");
  assert.ok(guide.actions.some((item) => item.action === "openScreenRecordingSettings"));
});

test("buildDashboardGuide suggests repairing the USB link before connecting the tablet", () => {
  const guide = buildDashboardGuide({
    host: "127.0.0.1",
    port: 9009,
    virtualDisplayEnabled: true,
    virtualDisplaySession: {
      displayId: 24,
      width: 1600,
      height: 900
    },
    activeClients: 0,
    mirrorDisplay: false,
    accessibility: {
      checked: true,
      trusted: true
    },
    deviceLink: {
      checked: true,
      ok: true,
      authorizedDevices: [{ serial: "de59cf69", state: "device", detail: "usb:1-1" }],
      unauthorizedDevices: [],
      reverseReady: false,
      reverseTarget: "tcp:9009"
    },
    captureBackend: "systemScreencapture"
  });

  assert.equal(guide.steps.find((item) => item.key === "usb")?.status, "current");
  assert.equal(guide.actions[0]?.action, "repairUsbLink");
});

test("buildAcceptanceChecklist blocks touch and extend tests until prerequisites are ready", () => {
  const checklist = buildAcceptanceChecklist({
    host: "127.0.0.1",
    port: 9009,
    virtualDisplayEnabled: true,
    virtualDisplaySession: null,
    activeClients: 0,
    mirrorDisplay: true,
    accessibility: {
      checked: true,
      trusted: false
    }
  });

  assert.match(checklist.summary, /先完成上面的连接向导/);
  assert.equal(checklist.cases.find((item) => item.id === "extend-window")?.readiness, "blocked");
  assert.equal(checklist.cases.find((item) => item.id === "touch-mapping")?.readiness, "blocked");
});

test("buildAcceptanceChecklist exposes ready scenarios when the session is usable", () => {
  const checklist = buildAcceptanceChecklist({
    host: "127.0.0.1",
    port: 9009,
    virtualDisplayEnabled: true,
    virtualDisplaySession: {
      displayId: 24,
      width: 1600,
      height: 900
    },
    activeClients: 1,
    mirrorDisplay: false,
    accessibility: {
      checked: true,
      trusted: true
    },
    virtualDisplayAutoCloseMs: 45_000
  });

  assert.match(checklist.summary, /当前可直接执行/);
  assert.equal(checklist.cases.find((item) => item.id === "extend-window")?.readiness, "ready");
  assert.equal(checklist.cases.find((item) => item.id === "touch-mapping")?.readiness, "ready");
  assert.match(checklist.cases.find((item) => item.id === "cleanup-close")?.steps[1], /45/);
});

function createNoopDashboardFactory() {
  return () => ({
    start: async () => {},
    updateState: () => {},
    log: () => {},
    preview: () => {},
    close: async () => {}
  });
}

function createDashboardHarness() {
  let onControl = null;
  const factory = ({ onControl: nextOnControl }) => {
    onControl = nextOnControl;
    return {
      start: async () => {},
      updateState: () => {},
      log: () => {},
      preview: () => {},
      close: async () => {}
    };
  };
  return {
    factory,
    runControl: (payload) => {
      if (typeof onControl !== "function") {
        throw new Error("control-handler-unavailable");
      }
      return onControl(payload);
    }
  };
}

test("startHostServer auto closes virtual display after the last client disconnects", async () => {
  const closedDisplayIds = [];
  let nextDisplayId = 40;
  const host = await startHostServer({
    host: "127.0.0.1",
    port: 0,
    frameSource: "mock",
    virtualDisplay: true,
    virtualDisplayAutoCloseMs: 30,
    createDashboardFn: createNoopDashboardFactory(),
    createVirtualDisplaySessionFn: async () => {
      const displayId = nextDisplayId;
      nextDisplayId += 1;
      return {
        displayId,
        width: 1600,
        height: 900,
        name: `Display ${displayId}`,
        close: async () => {
          closedDisplayIds.push(displayId);
        }
      };
    },
    checkAccessibilityPermissionFn: async () => ({ trusted: true }),
    getCaptureBackendStatusFn: async () => ({ systemScreencapture: true })
  });

  const socket = net.createConnection({ host: "127.0.0.1", port: host.port });
  await once(socket, "connect");
  socket.write(encodeMessage(createHelloMessage({
    sessionId: "auto-close",
    role: "client",
    capabilities: {}
  })));
  await delay(30);
  socket.destroy();
  await once(socket, "close");
  await delay(80);

  assert.deepEqual(closedDisplayIds, [40]);
  await host.close();
});

test("startHostServer close tears down virtual display even with an active client", async () => {
  const closedDisplayIds = [];
  const host = await startHostServer({
    host: "127.0.0.1",
    port: 0,
    frameSource: "mock",
    virtualDisplay: true,
    virtualDisplayAutoCloseMs: 0,
    createDashboardFn: createNoopDashboardFactory(),
    createVirtualDisplaySessionFn: async () => ({
      displayId: 77,
      width: 1600,
      height: 900,
      name: "Display 77",
      close: async () => {
        closedDisplayIds.push(77);
      }
    }),
    checkAccessibilityPermissionFn: async () => ({ trusted: true }),
    getCaptureBackendStatusFn: async () => ({ systemScreencapture: true })
  });

  const socket = net.createConnection({ host: "127.0.0.1", port: host.port });
  await once(socket, "connect");
  socket.write(encodeMessage(createHelloMessage({
    sessionId: "host-close",
    role: "client",
    capabilities: {}
  })));
  await delay(30);

  await host.close();
  socket.destroy();
  assert.deepEqual(closedDisplayIds, [77]);
});

test("startHostServer exposes dashboard controls for opening macOS settings", async () => {
  const calls = [];
  const dashboardHarness = createDashboardHarness();
  const host = await startHostServer({
    host: "127.0.0.1",
    port: 0,
    frameSource: "mock",
    virtualDisplay: true,
    virtualDisplayAutoCloseMs: 0,
    createDashboardFn: dashboardHarness.factory,
    createVirtualDisplaySessionFn: async () => ({
      displayId: 88,
      width: 1600,
      height: 900,
      name: "Display 88",
      close: async () => {}
    }),
    checkAccessibilityPermissionFn: async () => ({ trusted: false }),
    getCaptureBackendStatusFn: async () => ({ systemScreencapture: true }),
    openAccessibilitySettingsFn: async () => {
      calls.push("accessibility");
      return { ok: true };
    },
    openScreenRecordingSettingsFn: async () => {
      calls.push("screen-recording");
      return { ok: true };
    }
  });

  await dashboardHarness.runControl({ action: "openAccessibilitySettings" });
  await dashboardHarness.runControl({ action: "openScreenRecordingSettings" });
  assert.deepEqual(calls, ["accessibility", "screen-recording"]);

  await host.close();
});

test("startHostServer repairs adb reverse on startup and from dashboard control", async () => {
  const repairCalls = [];
  let reverseReady = false;
  const dashboardHarness = createDashboardHarness();
  const host = await startHostServer({
    host: "127.0.0.1",
    port: 0,
    frameSource: "mock",
    virtualDisplay: true,
    virtualDisplayAutoCloseMs: 0,
    deviceLinkPollIntervalMs: 0,
    createDashboardFn: dashboardHarness.factory,
    createVirtualDisplaySessionFn: async () => ({
      displayId: 91,
      width: 1600,
      height: 900,
      name: "Display 91",
      close: async () => {}
    }),
    checkAccessibilityPermissionFn: async () => ({ trusted: true }),
    getCaptureBackendStatusFn: async () => ({ systemScreencapture: true }),
    getAdbDeviceLinkStatusFn: async ({ port }) => ({
      ok: true,
      adbPath: "/tmp/adb",
      devices: [{ serial: "de59cf69", state: "device", detail: "usb:1-1" }],
      authorizedDevices: [{ serial: "de59cf69", state: "device", detail: "usb:1-1" }],
      unauthorizedDevices: [],
      reverseMappings: reverseReady ? [{ serial: "de59cf69", remote: `tcp:${port}`, local: `tcp:${port}` }] : [],
      reverseTarget: `tcp:${port}`,
      reverseReady,
      ready: reverseReady,
      error: null
    }),
    ensureAdbReverseForPortFn: async ({ port }) => {
      repairCalls.push(port);
      reverseReady = true;
      return {
        ok: true,
        repaired: true,
        adbPath: "/tmp/adb",
        reverseTarget: `tcp:${port}`,
        serials: ["de59cf69"],
        failed: [],
        error: null
      };
    }
  });

  assert.equal(repairCalls.length, 1);

  reverseReady = false;
  await dashboardHarness.runControl({ action: "repairUsbLink" });
  assert.equal(repairCalls.length, 2);

  await host.close();
});
