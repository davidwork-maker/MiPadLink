import test from "node:test";
import assert from "node:assert/strict";
import { LatestFrameBuffer } from "./frame-buffer.js";

test("LatestFrameBuffer keeps the most recent frames only", () => {
  const buffer = new LatestFrameBuffer({ maxHistory: 2 });

  buffer.push({ seq: 0 });
  buffer.push({ seq: 1 });
  buffer.push({ seq: 2 });

  const snapshot = buffer.snapshot();

  assert.equal(snapshot.length, 2);
  assert.equal(snapshot.dropped, 1);
  assert.equal(snapshot.latest.seq, 2);
  assert.equal(buffer.drainLatest().seq, 2);
  assert.equal(buffer.snapshot().length, 0);
});
