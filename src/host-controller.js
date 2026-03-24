import { DisplayBridgeRuntime } from "./bridge-runtime.js";

export class HostController {
  constructor({ session, bridge } = {}) {
    if (!session) {
      throw new Error("session is required");
    }
    this.session = session;
    this.bridge = bridge ?? new DisplayBridgeRuntime({
      hostSize: { width: 2560, height: 1600 },
      clientSize: { width: 1920, height: 1080 }
    });
    this.lastFlushedFrame = null;
    this.lastAction = null;
  }

  start(capabilities = {}) {
    this.bridge.markConnected(0);
    this.session.start({
      role: "host",
      virtualDisplay: true,
      encode: ["h264"],
      ...capabilities
    });
  }

  enqueueFrame(frame) {
    this.bridge.pushFrame(frame);
  }

  flushFrames() {
    const latest = this.bridge.takeLatestFrame();
    if (!latest) {
      this.lastAction = "idle";
      return null;
    }

    if (this.session.status === "active") {
      this.session.sendFrame(latest);
      this.lastFlushedFrame = latest;
      this.lastAction = "sent";
      return latest;
    }

    this.bridge.pushFrame(latest);
    this.lastAction = "buffered";
    return null;
  }

  heartbeat(now) {
    this.bridge.markHeartbeat(now);
    if (this.session.status === "active") {
      this.session.sendHeartbeat();
    }
  }

  tick(now) {
    return this.bridge.tick(now);
  }

  close(reason = "close", now = Date.now()) {
    this.bridge.markDisconnected(now, reason);
    this.session.close(reason);
  }

  snapshot() {
    return {
      lastFlushedFrame: this.lastFlushedFrame,
      lastAction: this.lastAction,
      session: this.session.snapshot(),
      bridge: this.bridge.snapshot()
    };
  }
}
