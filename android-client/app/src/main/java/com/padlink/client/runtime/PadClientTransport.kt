package com.padlink.client.runtime

fun interface MessageListener {
    fun onMessage(message: BridgeMessage)
}

interface PadClientTransport {
    fun setOnMessageListener(listener: MessageListener)
    fun connect()
    fun send(message: BridgeMessage)
    fun close()
}
