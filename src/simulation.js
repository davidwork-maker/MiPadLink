import { createLoopbackPair } from "./loopback.js";
import { DisplaySession } from "./session.js";
import { createSessionId } from "./protocol.js";
import { DisplayBridgeRuntime } from "./bridge-runtime.js";
import { HostController } from "./host-controller.js";
import { ClientController } from "./client-controller.js";

export function runDemoSession() {
  const sessionId = createSessionId();
  const link = createLoopbackPair();
  const bridge = new DisplayBridgeRuntime({
    hostSize: { width: 2560, height: 1600 },
    clientSize: { width: 1920, height: 1080 }
  });
  const hostSession = new DisplaySession({ role: "host", sessionId, transport: link.a });
  const clientSession = new DisplaySession({ role: "client", sessionId, transport: link.b });
  const host = new HostController({ session: hostSession, bridge });
  const client = new ClientController({ session: clientSession, bridge });

  client.start({ transport: "usb-loopback" });
  host.start({ transport: "usb-loopback" });
  host.enqueueFrame({
    seq: 0,
    width: 2560,
    height: 1600,
    payload: "frame-0"
  });
  host.flushFrames();
  client.sendPointer({ x: 128, y: 256 });
  host.heartbeat(1000);
  client.heartbeat(1000);
  bridge.tick(5000);
  host.close("demo-finished", 6000);
  client.close("demo-finished", 6000);

  return {
    sessionId,
    host: host.snapshot(),
    client: client.snapshot(),
    bridge: bridge.snapshot()
  };
}
