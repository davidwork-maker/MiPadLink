# MiPadLink Android Client

The Android tablet app that receives and renders the extended display from macOS.

## Build

Requires JDK 17 and Android SDK (API 35).

```bash
./gradlew :app:assembleDebug
```

## Install

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Architecture

- **`MainActivity`** — UI, fullscreen toggle, touch event handling
- **`PadClientController`** — session state machine, connects transport to UI callbacks
- **`PadClientTcpTransport`** — TCP socket transport with background reader/writer threads
- **`BridgeMessage`** — JSON-based protocol messages (hello, frame, input, heartbeat, close)
- **`RenderSurfaceView`** — custom view that decodes JPEG frames and renders touch markers

## Dependencies

Minimal dependency footprint — only AndroidX core libraries:

- `androidx.core:core-ktx`
- `androidx.appcompat:appcompat`
- `com.google.android.material:material`
- `androidx.constraintlayout:constraintlayout`

No third-party networking or JSON libraries; uses raw `java.net.Socket` and `org.json.JSONObject`.
