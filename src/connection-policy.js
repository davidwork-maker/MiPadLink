function positiveInt(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

export function createConnectionPolicy({
  heartbeatIntervalMs = 1000,
  heartbeatTimeoutMs = 3000,
  retryBaseMs = 250,
  retryMaxMs = 5000,
  maxAttempts = 6
} = {}) {
  positiveInt(heartbeatIntervalMs, "heartbeatIntervalMs");
  positiveInt(heartbeatTimeoutMs, "heartbeatTimeoutMs");
  positiveInt(retryBaseMs, "retryBaseMs");
  positiveInt(retryMaxMs, "retryMaxMs");
  positiveInt(maxAttempts, "maxAttempts");

  if (heartbeatTimeoutMs < heartbeatIntervalMs) {
    throw new Error("heartbeatTimeoutMs must be >= heartbeatIntervalMs");
  }

  return Object.freeze({
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    retryBaseMs,
    retryMaxMs,
    maxAttempts
  });
}

export function computeRetryDelay(attempt, policy) {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("attempt must be a positive integer");
  }
  const rawDelay = policy.retryBaseMs * 2 ** (attempt - 1);
  return Math.min(rawDelay, policy.retryMaxMs);
}

export function shouldDeclareStale(lastSeenAt, now, policy) {
  if (!Number.isFinite(lastSeenAt) || !Number.isFinite(now)) {
    throw new Error("lastSeenAt and now must be numbers");
  }
  return now - lastSeenAt >= policy.heartbeatTimeoutMs;
}

export class ConnectionWatchdog {
  constructor(policy = createConnectionPolicy()) {
    this.policy = policy;
    this.state = "idle";
    this.lastSeenAt = null;
    this.disconnectedAt = null;
    this.retryCount = 0;
    this.nextRetryAt = null;
    this.lastAction = null;
    this.lastReason = null;
  }

  markConnected(now) {
    this.state = "connected";
    this.lastSeenAt = now;
    this.disconnectedAt = null;
    this.retryCount = 0;
    this.nextRetryAt = null;
    this.lastAction = "connected";
  }

  markHeartbeat(now) {
    this.lastSeenAt = now;
    if (this.state === "stale" || this.state === "reconnecting") {
      this.state = "connected";
      this.retryCount = 0;
      this.nextRetryAt = null;
    }
    this.lastAction = "heartbeat";
  }

  markDisconnected(now, reason = "disconnect") {
    this.state = "disconnected";
    this.disconnectedAt = now;
    this.lastReason = reason;
    this.retryCount = 0;
    this.nextRetryAt = now + computeRetryDelay(1, this.policy);
    this.lastAction = "disconnected";
  }

  tick(now) {
    if (this.state === "connected" && this.lastSeenAt !== null && shouldDeclareStale(this.lastSeenAt, now, this.policy)) {
      this.state = "stale";
      this.retryCount = 0;
      this.nextRetryAt = now;
      this.lastAction = "stale";
      return { action: "stale", retryInMs: 0 };
    }

    if ((this.state === "stale" || this.state === "reconnecting" || this.state === "disconnected") && this.nextRetryAt !== null && now >= this.nextRetryAt) {
      if (this.retryCount >= this.policy.maxAttempts) {
        this.state = "failed";
        this.lastAction = "failed";
        return { action: "failed" };
      }

      this.retryCount += 1;
      this.state = "reconnecting";
      const retryInMs = computeRetryDelay(this.retryCount + 1, this.policy);
      this.nextRetryAt = now + retryInMs;
      this.lastAction = "reconnect";
      return {
        action: "reconnect",
        attempt: this.retryCount,
        retryInMs
      };
    }

    return { action: "idle" };
  }

  snapshot() {
    return {
      state: this.state,
      lastSeenAt: this.lastSeenAt,
      disconnectedAt: this.disconnectedAt,
      retryCount: this.retryCount,
      nextRetryAt: this.nextRetryAt,
      lastAction: this.lastAction,
      lastReason: this.lastReason
    };
  }
}
