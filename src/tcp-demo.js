import net from "node:net";
import { createSocketTransport } from "./socket-transport.js";
import { DisplaySession } from "./session.js";
import { createSessionId } from "./protocol.js";
import { createMockSocketPair } from "./mock-socket.js";

async function runPairDemo({ link, transportName, frames = 2, sessionId = createSessionId() }) {
  const hostSession = new DisplaySession({
    role: "host",
    sessionId,
    transport: createSocketTransport(link.a),
    now: () => 1000
  });
  const clientSession = new DisplaySession({
    role: "client",
    sessionId,
    transport: createSocketTransport(link.b),
    now: () => 2000
  });

  hostSession.start({
    virtualDisplay: true,
    encode: ["h264"],
    transport: transportName
  });

  const clientClosed = new Promise((resolve) => {
    clientSession.on("close", () => resolve(clientSession.snapshot()));
  });

  clientSession.start({
    render: ["fullscreen"],
    input: ["touch", "mouse"],
    transport: transportName
  });

  for (let seq = 0; seq < frames; seq += 1) {
    hostSession.sendFrame({
      seq,
      width: 2560,
      height: 1600,
      payload: `frame-${seq}`
    });
  }

  clientSession.sendInput({
    kind: "touch",
    x: 320,
    y: 240,
    buttons: 1
  });

  hostSession.close("tcp-demo-complete");
  clientSession.close("tcp-demo-complete");

  return {
    sessionId,
    transport: transportName,
    server: hostSession.snapshot(),
    client: await clientClosed
  };
}

async function runRealTcpDemo({ host = "127.0.0.1", port = 0, frames = 2 } = {}) {
  const sessionId = createSessionId();
  const server = net.createServer();
  let activeServerSocket = null;

  const serverReady = new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("error", onError);
      reject(error);
    };

    server.once("error", onError);
    try {
      server.listen(port, host, () => {
        server.off("error", onError);
        resolve(server.address());
      });
    } catch (error) {
      server.off("error", onError);
      reject(error);
    }
  });

  const serverSide = new Promise((resolve) => {
    server.on("connection", (socket) => {
      activeServerSocket = socket;
      const transport = createSocketTransport(socket);
      const session = new DisplaySession({
        role: "host",
        sessionId,
        transport,
        now: () => 1000
      });

      session.on("close", () => {
        resolve(session.snapshot());
      });

      session.start({
        virtualDisplay: true,
        encode: ["h264"],
        transport: "tcp"
      });

      for (let seq = 0; seq < frames; seq += 1) {
        session.sendFrame({
          seq,
          width: 2560,
          height: 1600,
          payload: `frame-${seq}`
        });
      }

      setTimeout(() => {
        session.close("tcp-demo-complete");
        socket.end();
      }, 10);
    });
  });

  let address;
  try {
    address = await serverReady;
  } catch (error) {
    server.close();
    throw error;
  }

  const clientSocket = net.createConnection({
    host: address.address,
    port: address.port
  });

  const clientSession = await new Promise((resolve, reject) => {
    clientSocket.on("connect", () => {
      const transport = createSocketTransport(clientSocket);
      const session = new DisplaySession({
        role: "client",
        sessionId,
        transport,
        now: () => 2000
      });

      session.on("frame", () => {
        if (session.framesReceived === frames) {
          session.sendInput({
            kind: "touch",
            x: 320,
            y: 240,
            buttons: 1
          });
        }
      });

      session.on("close", () => {
        clientSocket.end();
        resolve(session.snapshot());
      });

      session.start({
        render: ["fullscreen"],
        input: ["touch", "mouse"],
        transport: "tcp"
      });
    });

    clientSocket.on("error", reject);
  });

  const serverSnapshot = await serverSide;
  if (activeServerSocket && !activeServerSocket.destroyed) {
    activeServerSocket.end();
  }
  if (!clientSocket.destroyed) {
    clientSocket.end();
  }
  server.close();

  return {
    sessionId,
    transport: "tcp",
    server: serverSnapshot,
    client: clientSession
  };
}

async function runMockTcpDemo({ frames = 2 } = {}) {
  const link = createMockSocketPair();
  return runPairDemo({ link, transportName: "mock-socket", frames });
}

export async function runTcpDemo({ host = "127.0.0.1", port = 0, frames = 2 } = {}) {
  try {
    return await runRealTcpDemo({ host, port, frames });
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      return runMockTcpDemo({ frames });
    }
    throw error;
  }
}
