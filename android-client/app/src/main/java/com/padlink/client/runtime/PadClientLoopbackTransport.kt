package com.padlink.client.runtime

import org.json.JSONObject

class PadClientLoopbackTransport : PadClientTransport {
    private var listener: MessageListener? = null
    private var connected = false

    override fun setOnMessageListener(listener: MessageListener) {
        this.listener = listener
    }

    override fun connect() {
        connected = true
    }

    override fun send(message: BridgeMessage) {
        if (!connected) return

        when (message) {
            is BridgeMessage.Hello -> {
                if (message.role == "client") {
                    emit(
                        BridgeMessage.Hello(
                            sessionId = message.sessionId,
                            role = "host",
                            capabilities = JSONObject()
                                .put("render", "frame-stream")
                                .put("input", "touch")
                                .put("transport", "loopback")
                        )
                    )
                    emit(
                        BridgeMessage.Frame(
                            sessionId = message.sessionId,
                            seq = 0,
                            width = 2560,
                            height = 1600,
                            payload = "loopback-frame-0"
                        )
                    )
                }
            }
            is BridgeMessage.Input -> {
                emit(
                    BridgeMessage.Heartbeat(
                        sessionId = message.sessionId,
                        ts = System.currentTimeMillis()
                    )
                )
            }
            is BridgeMessage.Close -> {
                emit(
                    BridgeMessage.Close(
                        sessionId = message.sessionId,
                        reason = "loopback-close"
                    )
                )
                connected = false
            }
            else -> {
                // no-op
            }
        }
    }

    override fun close() {
        connected = false
    }

    private fun emit(message: BridgeMessage) {
        listener?.onMessage(message)
    }
}
