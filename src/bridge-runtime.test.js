import test from "node:test";
import assert from "node:assert/strict";
import { DisplayBridgeRuntime } from "./bridge-runtime.js";

test("DisplayBridgeRuntime maps points and buffers frames", () => {
  const runtime = new DisplayBridgeRuntime({
    hostSize: { width: 2560, height: 1600 },
    clientSize: { width: 1920, height: 1080 },
    maxHistory: 2
  });

  runtime.pushFrame({ seq: 0 });
  runtime.pushFrame({ seq: 1 });
  runtime.pushFrame({ seq: 2 });
  const latest = runtime.takeLatestFrame();
  const mapped = runtime.mapClientPoint({ x: 960, y: 540 });
  runtime.markConnected(0);
  runtime.markHeartbeat(1000);
  const tick = runtime.tick(5000);
  const snapshot = runtime.snapshot();

  assert.equal(latest.seq, 2);
  assert.equal(mapped.inside, true);
  assert.equal(snapshot.frames.length, 0);
  assert.equal(snapshot.inputs.length, 1);
  assert.ok(["stale", "reconnect", "idle"].includes(tick.action));
  assert.equal(snapshot.connection.state, runtime.connection.state);
});
