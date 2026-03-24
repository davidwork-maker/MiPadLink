package com.padlink.client.runtime

import org.json.JSONObject

sealed class BridgeMessage(open val sessionId: String, open val type: String) {
    data class Hello(
        override val sessionId: String,
        val role: String,
        val capabilities: JSONObject = JSONObject()
    ) : BridgeMessage(sessionId, "hello")

    data class Frame(
        override val sessionId: String,
        val seq: Int,
        val width: Int,
        val height: Int,
        val payload: String,
        val payloadFormat: String = "text"
    ) : BridgeMessage(sessionId, "frame")

    data class Input(
        override val sessionId: String,
        val kind: String,
        val x: Double,
        val y: Double,
        val buttons: Int = 0,
        val action: String = "tap"
    ) : BridgeMessage(sessionId, "input")

    data class Heartbeat(
        override val sessionId: String,
        val ts: Long
    ) : BridgeMessage(sessionId, "heartbeat")

    data class Close(
        override val sessionId: String,
        val reason: String
    ) : BridgeMessage(sessionId, "close")

    data class Unknown(
        override val sessionId: String,
        val rawType: String,
        val raw: String
    ) : BridgeMessage(sessionId, "unknown")

    fun toJsonLine(): String {
        val json = JSONObject()
            .put("type", type)
            .put("sessionId", sessionId)

        when (this) {
            is Hello -> {
                json.put("role", role)
                json.put("capabilities", capabilities)
            }
            is Frame -> {
                json.put("seq", seq)
                json.put("width", width)
                json.put("height", height)
                json.put("payload", payload)
                json.put("payloadFormat", payloadFormat)
            }
            is Input -> {
                json.put("kind", kind)
                json.put("x", x)
                json.put("y", y)
                json.put("buttons", buttons)
                json.put("action", action)
            }
            is Heartbeat -> json.put("ts", ts)
            is Close -> json.put("reason", reason)
            is Unknown -> json.put("raw", raw)
        }

        return json.toString()
    }

    companion object {
        fun fromJsonLine(line: String): BridgeMessage {
            return try {
                val json = JSONObject(line)
                val sessionId = json.optString("sessionId", "")
                when (val type = json.optString("type", "")) {
                    "hello" -> Hello(
                        sessionId = sessionId,
                        role = json.optString("role", "unknown"),
                        capabilities = json.optJSONObject("capabilities") ?: JSONObject()
                    )
                    "frame" -> Frame(
                        sessionId = sessionId,
                        seq = json.optInt("seq", 0),
                        width = json.optInt("width", 0),
                        height = json.optInt("height", 0),
                        payload = json.optString("payload", ""),
                        payloadFormat = json.optString("payloadFormat", "text")
                    )
                    "input" -> Input(
                        sessionId = sessionId,
                        kind = json.optString("kind", "unknown"),
                        x = json.optDouble("x", 0.0),
                        y = json.optDouble("y", 0.0),
                        buttons = json.optInt("buttons", 0),
                        action = json.optString("action", "tap")
                    )
                    "heartbeat" -> Heartbeat(
                        sessionId = sessionId,
                        ts = json.optLong("ts", 0L)
                    )
                    "close" -> Close(
                        sessionId = sessionId,
                        reason = json.optString("reason", "close")
                    )
                    else -> Unknown(
                        sessionId = sessionId,
                        rawType = type,
                        raw = line
                    )
                }
            } catch (e: Exception) {
                Unknown(
                    sessionId = "",
                    rawType = "parse-error",
                    raw = line.take(200)
                )
            }
        }
    }
}
