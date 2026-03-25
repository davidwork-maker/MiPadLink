import test from "node:test";
import assert from "node:assert/strict";
import { createHostConnectionHandler, resolveVirtualDisplayTargets } from "./host-server.js";

test("host connection handler replies hello and sends frames after handshake", async () => {
  const sent = [];
  const handler = createHostConnectionHandler({
    send: (message) => sent.push(message),
    frameIntervalMs: 10,
    now: () => 777
  });

  handler.onMessage({
    type: "hello",
    sessionId: "s1",
    role: "client",
    capabilities: {}
  });

  assert.equal(sent[0].type, "hello");
  assert.equal(sent[1].type, "frame");
  assert.equal(sent[1].payloadFormat, "text");

  handler.onMessage({
    type: "heartbeat",
    sessionId: "s1",
    ts: 1
  });

  assert.equal(sent[sent.length - 1].type, "heartbeat");
  handler.close("done");
  assert.equal(handler.snapshot().active, false);
});

test("host connection handler captures latest input", () => {
  const sent = [];
  const inputs = [];
  const handler = createHostConnectionHandler({
    send: (message) => sent.push(message),
    frameIntervalMs: 1000,
    inputSink: (message) => {
      inputs.push(message);
    }
  });

  handler.onMessage({
    type: "hello",
    sessionId: "s2",
    role: "client",
    capabilities: {}
  });
  handler.onMessage({
    type: "input",
    sessionId: "s2",
    kind: "touch",
    x: 11,
    y: 22,
    buttons: 1
  });

  assert.equal(handler.snapshot().lastInput.kind, "touch");
  assert.equal(inputs.length, 1);
  handler.close("done");
});

test("host connection handler updates frame interval at runtime", () => {
  const sent = [];
  const frames = [];
  const handler = createHostConnectionHandler({
    send: (message) => sent.push(message),
    frameIntervalMs: 120,
    onFrame: (frame, seq) => frames.push({ frame, seq })
  });

  assert.equal(handler.snapshot().frameIntervalMs, 120);

  handler.onMessage({
    type: "hello",
    sessionId: "s3",
    role: "client",
    capabilities: {}
  });

  assert.ok(sent.some((message) => message.type === "frame"));
  assert.ok(frames.length > 0);

  handler.updateFrameIntervalMs(60);
  assert.equal(handler.snapshot().frameIntervalMs, 60);
  handler.close("done");
});

test("resolveVirtualDisplayTargets uses mirror source ids when provided", () => {
  assert.deepEqual(
    resolveVirtualDisplayTargets({
      displayId: 20,
      captureDisplayId: 1,
      inputDisplayId: 1,
      mirror: true
    }),
    {
      captureDisplayId: 1,
      inputDisplayId: 1
    }
  );

  assert.deepEqual(
    resolveVirtualDisplayTargets({
      displayId: 20
    }),
    {
      captureDisplayId: 20,
      inputDisplayId: 20
    }
  );
});
