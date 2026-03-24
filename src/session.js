import { EventEmitter } from "node:events";
import {
  createCloseMessage,
  createFrameMessage,
  createHeartbeatMessage,
  createHelloMessage,
  createInputMessage,
  validateMessage
} from "./protocol.js";

export class DisplaySession extends EventEmitter {
  constructor({ role, sessionId, transport, now = () => Date.now() }) {
    super();
    if (role !== "host" && role !== "client") {
      throw new Error("role must be host or client");
    }
    this.role = role;
    this.sessionId = sessionId;
    this.transport = transport;
    this.now = now;
    this.status = "idle";
    this.localHelloSent = false;
    this.remoteHelloReceived = false;
    this.remoteRole = null;
    this.lastFrameSeq = -1;
    this.framesReceived = 0;
    this.inputsReceived = 0;
    this.heartbeatsReceived = 0;
    this.closedReason = null;

    this._unsubscribe = this.transport.onMessage((message) => {
      this._handleMessage(message);
    });
  }

  start(capabilities = {}) {
    if (this.status !== "idle") {
      return;
    }
    this.status = "handshaking";
    this._send(createHelloMessage({ sessionId: this.sessionId, role: this.role, capabilities }));
    this.localHelloSent = true;
    this._syncActiveState();
  }

  sendFrame({ seq, width, height, payload }) {
    this._assertOpen();
    this._send(createFrameMessage({ sessionId: this.sessionId, seq, width, height, payload }));
  }

  sendInput({ kind, x, y, buttons = 0 }) {
    this._assertOpen();
    this._send(createInputMessage({ sessionId: this.sessionId, kind, x, y, buttons }));
  }

  sendHeartbeat() {
    this._assertOpen();
    this._send(createHeartbeatMessage({ sessionId: this.sessionId, ts: this.now() }));
  }

  close(reason = "close") {
    if (this.status === "closed") {
      return;
    }
    this.closedReason = reason;
    this.status = "closed";
    this._send(createCloseMessage({ sessionId: this.sessionId, reason }));
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this.emit("close", reason);
  }

  snapshot() {
    return {
      role: this.role,
      sessionId: this.sessionId,
      status: this.status,
      remoteRole: this.remoteRole,
      remoteHelloReceived: this.remoteHelloReceived,
      localHelloSent: this.localHelloSent,
      lastFrameSeq: this.lastFrameSeq,
      framesReceived: this.framesReceived,
      inputsReceived: this.inputsReceived,
      heartbeatsReceived: this.heartbeatsReceived,
      closedReason: this.closedReason
    };
  }

  _send(message) {
    validateMessage(message);
    this.transport.send(message);
  }

  _assertOpen() {
    if (this.status === "closed") {
      throw new Error("session is closed");
    }
    if (this.status === "idle") {
      throw new Error("session has not started");
    }
  }

  _syncActiveState() {
    if (this.localHelloSent && this.remoteHelloReceived && this.status !== "closed") {
      this.status = "active";
      this.emit("active");
    }
  }

  _handleMessage(message) {
    validateMessage(message);
    if (message.sessionId !== this.sessionId) {
      throw new Error("sessionId mismatch");
    }

    switch (message.type) {
      case "hello":
        this.remoteHelloReceived = true;
        this.remoteRole = message.role;
        this._syncActiveState();
        break;
      case "frame":
        if (message.seq <= this.lastFrameSeq) {
          throw new Error("frame sequence must increase");
        }
        this.lastFrameSeq = message.seq;
        this.framesReceived += 1;
        this.emit("frame", message);
        break;
      case "input":
        this.inputsReceived += 1;
        this.emit("input", message);
        break;
      case "heartbeat":
        this.heartbeatsReceived += 1;
        this.emit("heartbeat", message);
        break;
      case "close":
        this.closedReason = message.reason;
        this.status = "closed";
        if (this._unsubscribe) {
          this._unsubscribe();
          this._unsubscribe = null;
        }
        this.emit("close", message.reason);
        break;
      default:
        throw new Error(`unexpected message type: ${message.type}`);
    }
  }
}
