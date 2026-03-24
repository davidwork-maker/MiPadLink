import test from "node:test";
import assert from "node:assert/strict";
import { createLoopbackPair } from "./loopback.js";
import { createSessionId } from "./protocol.js";
import { DisplaySession } from "./session.js";
import { runDemoSession } from "./simulation.js";

test("display sessions reach active state and exchange events", () => {
  const sessionId = createSessionId();
  const link = createLoopbackPair();
  const host = new DisplaySession({ role: "host", sessionId, transport: link.a, now: () => 123 });
  const client = new DisplaySession({ role: "client", sessionId, transport: link.b, now: () => 456 });

  host.start({ transport: "usb-loopback" });
  client.start({ transport: "usb-loopback" });

  assert.equal(host.status, "active");
  assert.equal(client.status, "active");

  host.sendFrame({ seq: 0, width: 1920, height: 1080, payload: "frame-0" });
  client.sendInput({ kind: "mouse", x: 10, y: 20, buttons: 0 });
  host.sendHeartbeat();

  assert.equal(client.framesReceived, 1);
  assert.equal(host.inputsReceived, 1);
  assert.equal(client.heartbeatsReceived, 1);

  host.close("done");
  client.close("done");

  assert.equal(host.status, "closed");
  assert.equal(client.status, "closed");
});

test("demo session produces a coherent snapshot", () => {
  const result = runDemoSession();

  assert.equal(result.host.session.status, "closed");
  assert.equal(result.client.session.status, "closed");
  assert.equal(result.host.session.framesReceived, 0);
  assert.equal(result.client.session.framesReceived, 1);
  assert.equal(result.host.session.inputsReceived, 1);
  assert.equal(result.bridge.inputs.length, 1);
});
