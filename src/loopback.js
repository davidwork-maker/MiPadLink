function cloneMessage(message) {
  return structuredClone(message);
}

function createEndpoint() {
  const listeners = new Set();
  let peer = null;

  return {
    connect(nextPeer) {
      peer = nextPeer;
    },
    onMessage(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    send(message) {
      if (!peer) {
        throw new Error("endpoint is not connected");
      }
      peer._receive(cloneMessage(message));
    },
    _receive(message) {
      for (const handler of listeners) handler(message);
    }
  };
}

export function createLoopbackPair() {
  const a = createEndpoint();
  const b = createEndpoint();
  a.connect(b);
  b.connect(a);
  return { a, b };
}
