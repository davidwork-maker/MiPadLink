package com.padlink.client.runtime

import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.concurrent.thread

class PadClientTcpTransport(
    private val host: String,
    private val port: Int
) : PadClientTransport {
    @Volatile
    private var listener: MessageListener? = null
    @Volatile
    private var socket: Socket? = null
    @Volatile
    private var writer: BufferedWriter? = null
    @Volatile
    private var readerThread: Thread? = null
    private val writeLock = Any()
    private val closeLock = Any()
    private val writeExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "padlink-tcp-writer").apply { isDaemon = true }
    }

    @Volatile
    private var connected = false

    override fun setOnMessageListener(listener: MessageListener) {
        this.listener = listener
    }

    override fun connect() {
        if (connected) return

        val newSocket = Socket()
        newSocket.tcpNoDelay = true
        newSocket.keepAlive = true
        newSocket.receiveBufferSize = 1 shl 20
        newSocket.sendBufferSize = 1 shl 20
        newSocket.connect(InetSocketAddress(host, port), 3000)
        newSocket.soTimeout = 15_000
        val newWriter = BufferedWriter(OutputStreamWriter(newSocket.getOutputStream()))
        val newReader = BufferedReader(InputStreamReader(newSocket.getInputStream()))

        socket = newSocket
        writer = newWriter
        connected = true

        readerThread = thread(start = true, isDaemon = true, name = "padlink-tcp-reader") {
            try {
                while (connected) {
                    val line: String?
                    try {
                        line = newReader.readLine()
                    } catch (_: java.net.SocketTimeoutException) {
                        continue
                    }
                    if (line == null) break
                    try {
                        val parsed = BridgeMessage.fromJsonLine(line)
                        if (parsed is BridgeMessage.Unknown) continue
                        listener?.onMessage(parsed)
                    } catch (_: Exception) {
                        // Skip malformed messages but keep the connection alive.
                    }
                }
            } catch (_: Exception) {
                // Socket-level error.
            } finally {
                val wasConnected = connected
                connected = false
                if (wasConnected) {
                    try {
                        listener?.onMessage(
                            BridgeMessage.Close(sessionId = "", reason = "transport-disconnected")
                        )
                    } catch (_: Exception) { /* no-op */ }
                }
            }
        }
    }

    override fun send(message: BridgeMessage) {
        if (!connected) return
        val line = message.toJsonLine()
        writeExecutor.execute {
            try {
                synchronized(writeLock) {
                    writer?.apply {
                        write(line)
                        newLine()
                        flush()
                    }
                }
            } catch (_: Exception) {
                connected = false
            }
        }
    }

    override fun close() {
        synchronized(closeLock) {
            if (!connected && socket == null) return
            connected = false
            writeExecutor.shutdownNow()
            try {
                socket?.close()
            } catch (_: Exception) {
                // no-op
            }
            socket = null
            writer = null
            readerThread?.interrupt()
            readerThread = null
        }
    }
}
