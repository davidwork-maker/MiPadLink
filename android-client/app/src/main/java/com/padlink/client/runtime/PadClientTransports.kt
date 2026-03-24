package com.padlink.client.runtime

object PadClientTransports {
    fun loopback(): PadClientTransport = PadClientLoopbackTransport()

    fun tcp(host: String, port: Int): PadClientTransport = PadClientTcpTransport(
        host = host,
        port = port
    )
}
