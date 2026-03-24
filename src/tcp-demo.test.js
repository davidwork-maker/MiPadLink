import test from "node:test";
import assert from "node:assert/strict";
import { createSocketTransport } from "./socket-transport.js";
import { createMockSocketPair } from "./mock-socket.js";
import { createSessionId } from "./protocol.js";
import { DisplaySession } from "./session.js";
import { runTcpDemo } from "./tcp-demo.js";

test("line transport exchanges frames and input over a socket-like stream", () => {
  const sessionId = createSessionId();
  const sockets = createMockSocketPair();
  const host = new DisplaySession({
    role: "host",
    sessionId,
    transport: createSocketTransport(sockets.a),
    now: () => 1000
  });
  const client = new DisplaySession({
    role: "client",
    sessionId,
    transport: createSocketTransport(sockets.b),
    now: () => 2000
  });

  host.start({ transport: "mock-socket" });
  client.start({ transport: "mock-socket" });

  host.sendFrame({ seq: 0, width: 2560, height: 1600, payload: "frame-0" });
  host.sendFrame({ seq: 1, width: 2560, height: 1600, payload: "frame-1" });
  client.sendInput({ kind: "touch", x: 10, y: 20, buttons: 1 });

  assert.equal(host.status, "active");
  assert.equal(client.status, "active");
  assert.equal(client.framesReceived, 2);
  assert.equal(host.inputsReceived, 1);

  host.close("done");
  client.close("done");

  assert.equal(host.status, "closed");
  assert.equal(client.status, "closed");
});

test("tcp demo falls back cleanly when a real socket cannot be opened", async () => {
  const result = await runTcpDemo({ frames: 2 });

  assert.equal(result.server.status, "closed");
  assert.equal(result.client.status, "closed");
  assert.ok(result.transport === "tcp" || result.transport === "mock-socket");
});
