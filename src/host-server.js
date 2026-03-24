import net from "node:net";
import { decodeMessage, encodeMessage } from "./codec.js";
import { createCloseMessage, createFrameMessage, createHeartbeatMessage, createHelloMessage } from "./protocol.js";
import { createDisplayCaptureFrameProvider, createScreenCaptureFrameProvider, createStaticFrameProvider } from "./frame-provider.js";
import { checkAccessibilityPermission, createVirtualDisplaySession, getCaptureBackendStatus, injectDisplayInput } from "./virtual-display-helper.js";

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
  onInput = null
}) {
  let sessionId = null;
  let seq = 0;
  let active = false;
  let lastInput = null;
  let timer = null;
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
    }, frameIntervalMs);
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
    lastInput
  });

  return {
    onMessage,
    close,
    snapshot
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
  virtualDisplayName = "PadLink Virtual Display",
  virtualDisplayHiDPI = true,
  virtualDisplayPpi = 110,
  displayCaptureQuality = 0.72,
  captureBackend = "coreGraphics",
  refreshRate = 60,
  logInput = false
} = {}) {
  const normalizedCaptureQuality = Number.isFinite(displayCaptureQuality)
    ? Math.min(1, Math.max(0.1, displayCaptureQuality))
    : 0.72;
  let virtualDisplaySession = null;
  let streamWidth = width;
  let streamHeight = height;
  let frameProvider = frameSource === "screen"
    ? createScreenCaptureFrameProvider()
    : createStaticFrameProvider();

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

    virtualDisplaySession = await createVirtualDisplaySession({
      width,
      height,
      refreshRate,
      ppi: virtualDisplayPpi,
      hiDPI: virtualDisplayHiDPI,
      mirror: false,
      name: virtualDisplayName
    });
    if (virtualDisplaySession.reused) {
      console.warn(`[padlink] virtual display creation hit system limit; reusing existing display id=${virtualDisplaySession.displayId}.`);
    }
    streamWidth = virtualDisplaySession.width ?? width;
    streamHeight = virtualDisplaySession.height ?? height;
    frameProvider = createDisplayCaptureFrameProvider({
      displayId: virtualDisplaySession.displayId,
      quality: normalizedCaptureQuality,
      captureBackend
    });
    try {
      const backend = await getCaptureBackendStatus();
      if (captureBackend === "coreGraphics") {
        console.log("[padlink] capture backend: CoreGraphics (forced)");
      } else if (captureBackend === "screenCaptureKit") {
        console.log("[padlink] capture backend: ScreenCaptureKit (forced)");
        console.warn("[padlink] ScreenCaptureKit one-shot mode may trigger repeated macOS privacy prompts; prefer CoreGraphics for day-to-day local use.");
      } else if (backend.screenCaptureKit) {
        console.log("[padlink] capture backend: ScreenCaptureKit (CoreGraphics fallback enabled)");
        console.warn("[padlink] auto mode is experimental with ScreenCaptureKit one-shot capture; use --capture-backend=coreGraphics if macOS shows repeated privacy popups.");
      } else {
        console.warn("[padlink] capture backend: CoreGraphics only (ScreenCaptureKit helper unavailable)");
      }
    } catch {
      console.warn("[padlink] capture backend: unknown (failed to resolve helper status)");
    }
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
    const handler = createHostConnectionHandler({
      send,
      width: streamWidth,
      height: streamHeight,
      frameIntervalMs,
      frameProvider,
      onInput: logInput
        ? (message) => {
          const x = Number.isFinite(message.x) ? message.x.toFixed(3) : String(message.x);
          const y = Number.isFinite(message.y) ? message.y.toFixed(3) : String(message.y);
          console.log(`[padlink] input kind=${message.kind} action=${message.action ?? "tap"} x=${x} y=${y}`);
        }
        : null,
      inputSink: virtualDisplaySession
        ? (message) => injectDisplayInput({
          displayId: virtualDisplaySession.displayId,
          x: message.x,
          y: message.y,
          action: message.action ?? "tap"
        }).catch((error) => {
          // Surface only the compact reason to avoid noisy logs.
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[padlink] input injection failed: ${reason}`);
        })
        : null
    });
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
    socket.on("close", () => { socketClosed = true; handler.close("socket-closed"); });
    socket.on("error", () => { socketClosed = true; handler.close("socket-error"); });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  return {
    host,
    port,
    virtualDisplay: virtualDisplaySession,
    close: () =>
      new Promise((resolve, reject) => {
        server.close(async (error) => {
          try {
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
