package com.padlink.client.runtime

import org.json.JSONObject
import java.util.UUID
import kotlin.concurrent.thread

class PadClientController(
    private val transport: PadClientTransport,
    private val transportName: String,
    private val onFrame: (BridgeMessage.Frame) -> Unit,
    private val onState: (String) -> Unit
) {
    private val sessionId = UUID.randomUUID().toString()

    @Volatile
    private var active = false

    @Volatile
    private var connected = false

    init {
        transport.setOnMessageListener(MessageListener { message ->
            handleIncoming(message)
        })
    }

    fun bootstrapDemo() {
        onState("idle")
    }

    fun connect() {
        if (connected) return
        onState("connecting")
        thread(start = true, isDaemon = true, name = "padlink-connect") {
            try {
                transport.connect()
                connected = true
                onState("handshaking")
                transport.send(
                    BridgeMessage.Hello(
                        sessionId = sessionId,
                        role = "client",
                        capabilities = JSONObject()
                            .put("render", "fullscreen")
                            .put("input", "touch")
                            .put("transport", transportName)
                    )
                )
            } catch (_: Exception) {
                connected = false
                onState("connect-failed")
            }
        }
    }

    fun sendTouch(x: Float, y: Float, action: String = "tap") {
        if (!connected || !active) {
            onState("not-connected")
            return
        }

        try {
            transport.send(
                BridgeMessage.Input(
                    sessionId = sessionId,
                    kind = "touch",
                    x = x.toDouble(),
                    y = y.toDouble(),
                    buttons = 1,
                    action = action
                )
            )
        } catch (_: Exception) {
            onState("input-failed")
        }
    }

    fun close() {
        if (!connected) {
            transport.close()
            onState("closed")
            return
        }

        try {
            transport.send(
                BridgeMessage.Close(
                    sessionId = sessionId,
                    reason = "activity-stop"
                )
            )
        } catch (_: Exception) {
            // no-op
        }
        transport.close()
        connected = false
        active = false
        onState("closed")
    }

    private fun handleIncoming(message: BridgeMessage) {
        if (message is BridgeMessage.Close && message.reason == "transport-disconnected") {
            active = false
            connected = false
            onState("closed-remote")
            return
        }
        if (message.sessionId != sessionId) return

        when (message) {
            is BridgeMessage.Hello -> {
                if (message.role == "host") {
                    active = true
                    onState("active")
                }
            }
            is BridgeMessage.Frame -> {
                onFrame(message)
                onState("frame-${message.seq}")
            }
            is BridgeMessage.Heartbeat -> onState("heartbeat")
            is BridgeMessage.Close -> {
                active = false
                connected = false
                onState("closed-remote")
            }
            is BridgeMessage.Input -> {
                // client should not receive input messages in normal flow
            }
            is BridgeMessage.Unknown -> {
                // silently ignore unrecognized or malformed messages
            }
        }
    }
}
