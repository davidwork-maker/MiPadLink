import { decodeMessage, encodeMessage } from "./codec.js";

export function createSocketTransport(socket) {
  const listeners = new Set();
  let buffer = "";
  let closed = false;

  socket.setEncoding("utf8");

  const handleData = (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
      if (!line) continue;
      try {
        const message = decodeMessage(line);
        for (const handler of listeners) handler(message);
      } catch {
        // Skip malformed messages; keep the transport alive.
      }
    }
  };

  socket.on("data", handleData);
  socket.on("close", () => {
    closed = true;
  });

  return {
    onMessage(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    send(message) {
      if (closed) {
        throw new Error("socket is closed");
      }
      socket.write(encodeMessage(message));
    },
    close() {
      socket.end();
    }
  };
}
