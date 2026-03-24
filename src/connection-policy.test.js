import test from "node:test";
import assert from "node:assert/strict";
import {
  ConnectionWatchdog,
  computeRetryDelay,
  createConnectionPolicy,
  shouldDeclareStale
} from "./connection-policy.js";

test("connection policy computes exponential backoff", () => {
  const policy = createConnectionPolicy();

  assert.equal(computeRetryDelay(1, policy), 250);
  assert.equal(computeRetryDelay(2, policy), 500);
  assert.equal(computeRetryDelay(10, policy), 5000);
});

test("watchdog marks stale and reconnects with backoff", () => {
  const watchdog = new ConnectionWatchdog(
    createConnectionPolicy({ heartbeatIntervalMs: 1000, heartbeatTimeoutMs: 3000 })
  );

  watchdog.markConnected(0);
  assert.equal(shouldDeclareStale(0, 2999, watchdog.policy), false);
  assert.equal(shouldDeclareStale(0, 3000, watchdog.policy), true);

  assert.deepEqual(watchdog.tick(3000), { action: "stale", retryInMs: 0 });
  const reconnect = watchdog.tick(3000);
  assert.equal(reconnect.action, "reconnect");
  assert.equal(reconnect.attempt, 1);
  assert.equal(watchdog.snapshot().state, "reconnecting");

  watchdog.markHeartbeat(3050);
  assert.equal(watchdog.snapshot().state, "connected");
});
