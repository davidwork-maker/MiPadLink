import test from "node:test";
import assert from "node:assert/strict";
import { createLoopbackPair } from "./loopback.js";
import { createSessionId } from "./protocol.js";
import { DisplaySession } from "./session.js";
import { ClientController } from "./client-controller.js";

test("ClientController maps pointer input before sending it", () => {
  const sessionId = createSessionId();
  const link = createLoopbackPair();
  const hostSession = new DisplaySession({ role: "host", sessionId, transport: link.a });
  const clientSession = new DisplaySession({ role: "client", sessionId, transport: link.b });
  const client = new ClientController({ session: clientSession });

  hostSession.start({ transport: "usb-loopback" });
  client.start({ transport: "usb-loopback" });

  const mapped = client.sendPointer({ x: 960, y: 540 });

  assert.equal(hostSession.inputsReceived, 1);
  assert.equal(client.snapshot().lastAction, "sent");
  assert.equal(mapped.inside, true);
  assert.ok(client.snapshot().lastMappedInput.x > 0);
});
