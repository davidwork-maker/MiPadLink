import { LatestFrameBuffer } from "./frame-buffer.js";
import { describeDisplayLink, mapPointToSource } from "./display-layout.js";
import { ConnectionWatchdog, createConnectionPolicy } from "./connection-policy.js";

export class DisplayBridgeRuntime {
  constructor({ hostSize, clientSize, maxHistory = 2 } = {}) {
    this.hostSize = hostSize;
    this.clientSize = clientSize;
    this.layout = describeDisplayLink({ host: hostSize, client: clientSize });
    this.frames = new LatestFrameBuffer({ maxHistory });
    this.inputs = [];
    this.connection = new ConnectionWatchdog(createConnectionPolicy());
  }

  pushFrame(frame) {
    this.frames.push(frame);
  }

  takeLatestFrame() {
    return this.frames.drainLatest();
  }

  mapClientPoint(point) {
    const mapped = mapPointToSource(point, this.hostSize, this.clientSize);
    this.inputs.push(mapped);
    return mapped;
  }

  markConnected(now) {
    this.connection.markConnected(now);
  }

  markHeartbeat(now) {
    this.connection.markHeartbeat(now);
  }

  markDisconnected(now, reason) {
    this.connection.markDisconnected(now, reason);
  }

  tick(now) {
    return this.connection.tick(now);
  }

  snapshot() {
    return {
      layout: this.layout,
      frames: this.frames.snapshot(),
      inputs: [...this.inputs],
      connection: this.connection.snapshot()
    };
  }
}
