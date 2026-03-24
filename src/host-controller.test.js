import test from "node:test";
import assert from "node:assert/strict";
import { createLoopbackPair } from "./loopback.js";
import { createSessionId } from "./protocol.js";
import { DisplaySession } from "./session.js";
import { HostController } from "./host-controller.js";

test("HostController buffers frames until the session is active and then flushes latest", () => {
  const sessionId = createSessionId();
  const link = createLoopbackPair();
  const hostSession = new DisplaySession({ role: "host", sessionId, transport: link.a });
  const clientSession = new DisplaySession({ role: "client", sessionId, transport: link.b });
  const host = new HostController({ session: hostSession });
  clientSession.start({ transport: "usb-loopback" });
  host.start({ transport: "usb-loopback" });

  host.enqueueFrame({ seq: 0, width: 2560, height: 1600, payload: "frame-0" });
  host.enqueueFrame({ seq: 1, width: 2560, height: 1600, payload: "frame-1" });
  const flushed = host.flushFrames();

  assert.equal(flushed.seq, 1);
  assert.equal(clientSession.framesReceived, 1);
  assert.equal(host.snapshot().lastFlushedFrame.seq, 1);
});
