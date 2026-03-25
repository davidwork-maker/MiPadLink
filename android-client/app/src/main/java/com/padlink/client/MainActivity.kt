package com.padlink.client

import android.os.Bundle
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.constraintlayout.widget.ConstraintSet
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.padlink.client.databinding.ActivityMainBinding
import com.padlink.client.runtime.PadClientController
import com.padlink.client.runtime.PadClientTransport
import com.padlink.client.runtime.PadClientTransports
import com.padlink.client.ui.RenderSurfaceView

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var controller: PadClientController? = null
    private var isFullscreen = false
    private var defaultRootPadding = 0
    private lateinit var fullscreenGestureDetector: GestureDetector

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        defaultRootPadding = binding.root.paddingLeft
        fullscreenGestureDetector = GestureDetector(
            this,
            object : GestureDetector.SimpleOnGestureListener() {
                override fun onDoubleTap(e: MotionEvent): Boolean {
                    applyFullscreenUi(!isFullscreen)
                    return true
                }
            }
        )
        binding.hostInput.setText("127.0.0.1")
        binding.portInput.setText("9009")
        binding.renderSurface.setScaleMode(RenderSurfaceView.ScaleMode.FIT)
        updateScaleModeLabel()
        binding.fullscreenButton.setOnClickListener {
            applyFullscreenUi(!isFullscreen)
        }
        binding.scaleModeButton.setOnClickListener {
            val nextMode = when (binding.renderSurface.getScaleMode()) {
                RenderSurfaceView.ScaleMode.FIT -> RenderSurfaceView.ScaleMode.FILL
                RenderSurfaceView.ScaleMode.FILL -> RenderSurfaceView.ScaleMode.FIT
            }
            binding.renderSurface.setScaleMode(nextMode)
            updateScaleModeLabel()
        }

        binding.connectButton.setOnClickListener {
            replaceController(
                transportName = "loopback",
                transport = PadClientTransports.loopback()
            )
            controller?.connect()
        }

        binding.connectTcpButton.setOnClickListener {
            val host = binding.hostInput.text.toString().trim().ifEmpty { "127.0.0.1" }
            val port = binding.portInput.text.toString().trim().toIntOrNull() ?: 9009
            replaceController(
                transportName = "tcp",
                transport = PadClientTransports.tcp(host = host, port = port)
            )
            controller?.connect()
        }

        binding.touchpadButton.setOnClickListener {
            val nx = 0.5f
            val ny = 0.5f
            controller?.sendTouch(
                x = nx,
                y = ny,
                action = "tap"
            )
            binding.renderSurface.showInputMarker(nx, ny)
        }

        binding.renderSurface.setOnTouchListener { view, event ->
            if (fullscreenGestureDetector.onTouchEvent(event)) {
                return@setOnTouchListener true
            }
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN,
                MotionEvent.ACTION_MOVE,
                MotionEvent.ACTION_UP -> {
                    val mapped = binding.renderSurface.mapTouchPointToNormalized(event.x, event.y)
                        ?: return@setOnTouchListener false
                    val (nx, ny) = mapped
                    val action = when (event.actionMasked) {
                        MotionEvent.ACTION_DOWN -> "move"
                        MotionEvent.ACTION_MOVE -> "move"
                        MotionEvent.ACTION_UP -> "tap"
                        else -> "tap"
                    }
                    controller?.sendTouch(nx, ny, action)
                    binding.renderSurface.showInputMarker(nx, ny)
                    true
                }
                else -> false
            }
        }

        applyFullscreenUi(false)
    }

    override fun onStart() {
        super.onStart()
        binding.sessionValue.text = getString(R.string.session_idle)
        binding.statusValue.text = getString(R.string.status_waiting)
    }

    override fun onStop() {
        controller?.close()
        super.onStop()
    }

    private fun replaceController(
        transportName: String,
        transport: PadClientTransport
    ) {
        controller?.close()
        controller = PadClientController(
            transport = transport,
            transportName = transportName,
            onFrame = { frame ->
                runOnUiThread {
                    binding.statusValue.text = getString(
                        R.string.status_frame_format,
                        frame.seq,
                        frame.width,
                        frame.height
                    )
                    if (frame.payloadFormat == "jpeg-base64") {
                        binding.renderSurface.renderJpegBase64(frame.payload)
                    } else {
                        binding.renderSurface.renderFrameSummary(frame.payload)
                    }
                }
            },
            onState = { state ->
                runOnUiThread {
                    binding.sessionValue.text = toLocalizedState(state)
                }
            }
        ).also {
            it.bootstrapDemo()
        }
    }

    private fun toLocalizedState(state: String): String {
        return when {
            state.startsWith("frame-") -> getString(
                R.string.state_streaming,
                state.removePrefix("frame-")
            )
            state == "idle" -> getString(R.string.state_idle)
            state == "connecting" -> getString(R.string.state_connecting)
            state == "handshaking" -> getString(R.string.state_handshaking)
            state == "active" -> getString(R.string.state_active)
            state == "heartbeat" -> getString(R.string.state_heartbeat)
            state == "closed" -> getString(R.string.state_closed)
            state == "closed-remote" -> getString(R.string.state_closed_remote)
            state == "connect-failed" -> getString(R.string.state_connect_failed)
            state == "not-connected" -> getString(R.string.state_not_connected)
            state == "input-failed" -> getString(R.string.state_input_failed)
            else -> state
        }
    }

    private fun applyFullscreenUi(enable: Boolean) {
        isFullscreen = enable
        val controlsVisibility = if (enable) View.GONE else View.VISIBLE
        val toggleViews = listOf(
            binding.titleView,
            binding.sessionLabel,
            binding.sessionValue,
            binding.statusLabel,
            binding.statusValue,
            binding.hostInput,
            binding.portInput,
            binding.scaleModeButton,
            binding.connectButton,
            binding.connectTcpButton,
            binding.touchpadButton
        )
        toggleViews.forEach { it.visibility = controlsVisibility }
        binding.fullscreenButton.visibility = if (enable) View.GONE else View.VISIBLE

        binding.fullscreenButton.text = getString(
            if (enable) R.string.fullscreen_exit else R.string.fullscreen_enter
        )
        binding.renderSurface.setHudVisible(!enable)
        val padding = if (enable) 0 else defaultRootPadding
        binding.root.setPadding(padding, padding, padding, padding)

        val set = ConstraintSet()
        set.clone(binding.root)
        set.clear(R.id.renderSurface, ConstraintSet.TOP)
        set.clear(R.id.renderSurface, ConstraintSet.BOTTOM)
        if (enable) {
            set.connect(
                R.id.renderSurface,
                ConstraintSet.TOP,
                ConstraintSet.PARENT_ID,
                ConstraintSet.TOP,
                0
            )
            set.connect(
                R.id.renderSurface,
                ConstraintSet.BOTTOM,
                ConstraintSet.PARENT_ID,
                ConstraintSet.BOTTOM,
                0
            )
            set.connect(
                R.id.fullscreenButton,
                ConstraintSet.TOP,
                ConstraintSet.PARENT_ID,
                ConstraintSet.TOP,
                dp(12)
            )
            set.connect(
                R.id.fullscreenButton,
                ConstraintSet.END,
                ConstraintSet.PARENT_ID,
                ConstraintSet.END,
                dp(12)
            )
        } else {
            set.connect(
                R.id.renderSurface,
                ConstraintSet.TOP,
                R.id.hostInput,
                ConstraintSet.BOTTOM,
                dp(20)
            )
            set.connect(
                R.id.renderSurface,
                ConstraintSet.BOTTOM,
                R.id.connectButton,
                ConstraintSet.TOP,
                0
            )
            set.connect(
                R.id.fullscreenButton,
                ConstraintSet.BASELINE,
                R.id.titleView,
                ConstraintSet.BASELINE,
                0
            )
            set.connect(
                R.id.fullscreenButton,
                ConstraintSet.END,
                ConstraintSet.PARENT_ID,
                ConstraintSet.END,
                0
            )
        }
        set.applyTo(binding.root)

        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        if (enable) {
            insetsController?.systemBarsBehavior =
                androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            insetsController?.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            insetsController?.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    private fun updateScaleModeLabel() {
        binding.scaleModeButton.text = getString(
            when (binding.renderSurface.getScaleMode()) {
                RenderSurfaceView.ScaleMode.FIT -> R.string.scale_mode_fit
                RenderSurfaceView.ScaleMode.FILL -> R.string.scale_mode_fill
            }
        )
    }
}
