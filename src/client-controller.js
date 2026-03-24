import { DisplayBridgeRuntime } from "./bridge-runtime.js";

export class ClientController {
  constructor({ session, bridge } = {}) {
    if (!session) {
      throw new Error("session is required");
    }
    this.session = session;
    this.bridge = bridge ?? new DisplayBridgeRuntime({
      hostSize: { width: 2560, height: 1600 },
      clientSize: { width: 1920, height: 1080 }
    });
    this.lastReceivedFrame = null;
    this.lastMappedInput = null;
    this.lastAction = null;

    this.session.on("frame", (frame) => {
      this.lastReceivedFrame = frame;
    });
  }

  start(capabilities = {}) {
    this.bridge.markConnected(0);
    this.session.start({
      role: "client",
      render: ["fullscreen"],
      input: ["touch", "mouse"],
      ...capabilities
    });
  }

  sendPointer(point, inputKind = "touch") {
    const mapped = this.bridge.mapClientPoint(point);
    this.lastMappedInput = mapped;
    this.session.sendInput({
      kind: inputKind,
      x: mapped.x,
      y: mapped.y,
      buttons: 1
    });
    this.lastAction = "sent";
    return mapped;
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
      lastReceivedFrame: this.lastReceivedFrame,
      lastMappedInput: this.lastMappedInput,
      lastAction: this.lastAction,
      session: this.session.snapshot(),
      bridge: this.bridge.snapshot()
    };
  }
}
