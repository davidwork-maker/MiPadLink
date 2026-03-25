package com.padlink.client.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.util.Base64
import android.util.AttributeSet
import android.os.SystemClock
import android.view.View
import com.padlink.client.R
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

class RenderSurfaceView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {
    enum class ScaleMode {
        FIT,
        FILL
    }

    private val backgroundPaint = Paint().apply {
        color = Color.parseColor("#101418")
    }

    private val framePaint = Paint().apply {
        color = Color.parseColor("#E9F7F2")
        textSize = 42f
        isAntiAlias = true
    }

    private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG).apply {
        isAntiAlias = true
    }

    private val touchMarkerPaint = Paint().apply {
        color = Color.parseColor("#FF3B30")
        isAntiAlias = true
    }

    private val decodeExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "padlink-jpeg-decode").apply { isDaemon = true }
    }
    private val decodeGeneration = AtomicLong(0L)
    private val decodeOptions = BitmapFactory.Options().apply {
        inPreferredConfig = Bitmap.Config.RGB_565
    }

    private var frameSummary = context.getString(R.string.status_waiting)
    private var bitmap: Bitmap? = null
    private var markerX = 0.5f
    private var markerY = 0.5f
    private var markerUntilMs = 0L
    private var hudVisible = true
    private var scaleMode = ScaleMode.FIT

    fun renderFrameSummary(summary: String) {
        decodeGeneration.incrementAndGet()
        frameSummary = summary
        bitmap?.recycle()
        bitmap = null
        invalidate()
    }

    fun renderJpegBase64(base64Jpeg: String) {
        val generation = decodeGeneration.incrementAndGet()
        decodeExecutor.execute {
            try {
                val bytes = Base64.decode(base64Jpeg, Base64.DEFAULT)
                val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOptions)
                if (decoded != null) {
                    post {
                        if (generation != decodeGeneration.get()) {
                            decoded.recycle()
                            return@post
                        }
                        bitmap?.recycle()
                        bitmap = decoded
                        frameSummary = context.getString(
                            R.string.jpeg_frame_format,
                            decoded.width,
                            decoded.height
                        )
                        invalidate()
                    }
                    return@execute
                }
                postDecodeFailure(generation, context.getString(R.string.decode_failed_null))
            } catch (_: Exception) {
                postDecodeFailure(generation, context.getString(R.string.decode_failed_invalid))
            }
        }
    }

    fun setHudVisible(visible: Boolean) {
        hudVisible = visible
        invalidate()
    }

    fun setScaleMode(mode: ScaleMode) {
        scaleMode = mode
        invalidate()
    }

    fun getScaleMode(): ScaleMode = scaleMode

    fun mapTouchPointToNormalized(viewX: Float, viewY: Float): Pair<Float, Float>? {
        val rect = computeContentRect() ?: return null
        if (hudVisible && !rect.contains(viewX, viewY)) {
            return null
        }
        val nx = ((viewX - rect.left) / rect.width()).coerceIn(0f, 1f)
        val ny = ((viewY - rect.top) / rect.height()).coerceIn(0f, 1f)
        return nx to ny
    }

    fun showInputMarker(nx: Float, ny: Float, durationMs: Long = 900L) {
        markerX = nx.coerceIn(0f, 1f)
        markerY = ny.coerceIn(0f, 1f)
        markerUntilMs = SystemClock.uptimeMillis() + durationMs
        invalidate()
    }

    override fun onDetachedFromWindow() {
        decodeGeneration.incrementAndGet()
        decodeExecutor.shutdownNow()
        bitmap?.recycle()
        bitmap = null
        super.onDetachedFromWindow()
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), backgroundPaint)
        if (hudVisible) {
            canvas.drawText(context.getString(R.string.render_title), 36f, 72f, framePaint)
        }
        val currentBitmap = bitmap
        if (currentBitmap != null) {
            val destRect = computeContentRect(currentBitmap)
            if (destRect != null) {
                canvas.drawBitmap(currentBitmap, null, destRect, bitmapPaint)
                drawInputMarker(canvas, destRect)
            }
            if (hudVisible) {
                canvas.drawText(frameSummary, 36f, 136f, framePaint)
            }
            return
        }
        if (hudVisible) {
            canvas.drawText(frameSummary, 36f, 136f, framePaint)
        }
    }

    private fun drawInputMarker(canvas: Canvas, destRect: RectF) {
        if (SystemClock.uptimeMillis() > markerUntilMs) {
            return
        }
        val markerPx = destRect.left + (destRect.width() * markerX)
        val markerPy = destRect.top + (destRect.height() * markerY)
        canvas.drawCircle(markerPx, markerPy, 9f, touchMarkerPaint)
    }

    private fun postDecodeFailure(generation: Long, reason: String) {
        post {
            if (generation != decodeGeneration.get()) return@post
            renderFrameSummary(reason)
        }
    }

    private fun computeContentRect(bitmapValue: Bitmap? = bitmap): RectF? {
        val currentBitmap = bitmapValue ?: return null
        val sourceWidth = currentBitmap.width.toFloat()
        val sourceHeight = currentBitmap.height.toFloat()
        if (sourceWidth <= 0f || sourceHeight <= 0f) {
            return null
        }
        val topOffset = if (hudVisible) 90f else 0f
        val targetWidth = width.toFloat()
        val targetHeight = (height - topOffset).coerceAtLeast(1f)
        val scale = when (scaleMode) {
            ScaleMode.FIT -> minOf(targetWidth / sourceWidth, targetHeight / sourceHeight)
            ScaleMode.FILL -> maxOf(targetWidth / sourceWidth, targetHeight / sourceHeight)
        }
        val drawWidth = sourceWidth * scale
        val drawHeight = sourceHeight * scale
        val left = (targetWidth - drawWidth) / 2f
        val top = topOffset + (targetHeight - drawHeight) / 2f
        return RectF(left, top, left + drawWidth, top + drawHeight)
    }
}
