import { randomUUID } from "node:crypto";

const ALLOWED_TYPES = new Set(["hello", "frame", "input", "heartbeat", "close"]);
const ALLOWED_ROLES = new Set(["host", "client"]);

export function createSessionId() {
  return randomUUID();
}

export function createHelloMessage({ sessionId, role, capabilities = {} }) {
  return {
    type: "hello",
    sessionId,
    role,
    capabilities
  };
}

export function createFrameMessage({ sessionId, seq, width, height, payload, payloadFormat = "text" }) {
  return {
    type: "frame",
    sessionId,
    seq,
    width,
    height,
    payload,
    payloadFormat
  };
}

export function createInputMessage({ sessionId, kind, x, y, buttons = 0, action = "tap" }) {
  return {
    type: "input",
    sessionId,
    kind,
    x,
    y,
    buttons,
    action
  };
}

export function createHeartbeatMessage({ sessionId, ts }) {
  return {
    type: "heartbeat",
    sessionId,
    ts
  };
}

export function createCloseMessage({ sessionId, reason = "close" }) {
  return {
    type: "close",
    sessionId,
    reason
  };
}

export function validateMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new TypeError("message must be an object");
  }

  if (!ALLOWED_TYPES.has(message.type)) {
    throw new Error(`unsupported message type: ${String(message.type)}`);
  }

  if (typeof message.sessionId !== "string" || message.sessionId.length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }

  if (message.type === "hello") {
    if (!ALLOWED_ROLES.has(message.role)) {
      throw new Error(`unsupported role: ${String(message.role)}`);
    }
    if (!message.capabilities || typeof message.capabilities !== "object") {
      throw new Error("hello.capabilities must be an object");
    }
  }

  if (message.type === "frame") {
    if (!Number.isInteger(message.seq) || message.seq < 0) {
      throw new Error("frame.seq must be a non-negative integer");
    }
    if (!Number.isFinite(message.width) || !Number.isFinite(message.height)) {
      throw new Error("frame width and height must be numbers");
    }
    if (typeof message.payload !== "string") {
      throw new Error("frame.payload must be a string");
    }
    if (message.payloadFormat !== undefined && typeof message.payloadFormat !== "string") {
      throw new Error("frame.payloadFormat must be a string when provided");
    }
  }

  if (message.type === "input") {
    if (typeof message.kind !== "string" || message.kind.length === 0) {
      throw new Error("input.kind must be a non-empty string");
    }
    if (message.action !== undefined && (typeof message.action !== "string" || message.action.length === 0)) {
      throw new Error("input.action must be a non-empty string when provided");
    }
  }

  if (message.type === "heartbeat") {
    if (!Number.isFinite(message.ts)) {
      throw new Error("heartbeat.ts must be a number");
    }
  }

  if (message.type === "close") {
    if (typeof message.reason !== "string") {
      throw new Error("close.reason must be a string");
    }
  }

  return true;
}
