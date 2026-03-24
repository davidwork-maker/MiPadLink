import { EventEmitter } from "node:events";

class MockSocket extends EventEmitter {
  constructor() {
    super();
    this._peer = null;
    this._closed = false;
  }

  setEncoding() {}

  connectPeer(peer) {
    this._peer = peer;
  }

  write(chunk) {
    if (this._closed) {
      throw new Error("socket is closed");
    }
    this._peer.emit("data", chunk);
    return true;
  }

  end() {
    if (this._closed) return;
    this._closed = true;
    this.emit("close");
    if (this._peer && !this._peer._closed) {
      this._peer._closed = true;
      this._peer.emit("close");
    }
  }
}

export function createMockSocketPair() {
  const a = new MockSocket();
  const b = new MockSocket();
  a.connectPeer(b);
  b.connectPeer(a);
  return { a, b };
}
