# Device Setup

## Android Tablet (Client)

1. Enable **Developer Options** on your Android tablet (Settings → About → tap Build Number 7 times).
2. Enable **USB Debugging** in Developer Options.
3. Connect the tablet to Mac via USB cable.
4. Verify the device is recognized:
   ```bash
   adb devices
   ```
5. Install the MiPadLink APK:
   ```bash
   cd android-client
   ./gradlew :app:assembleDebug
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

## macOS (Host)

### Prerequisites

- Node.js 18+
- Xcode Command Line Tools (`xcode-select --install`)

### Build helpers

```bash
./scripts/build-macos-helper.sh
```

### macOS permissions (first run only)

Go to **System Settings → Privacy & Security**:

- **Screen Recording** — add your terminal app (Terminal.app, iTerm2, etc.)
- **Accessibility** — add the same terminal app (required for touch input injection)

After granting permissions, restart your terminal.

## Quick Start

```bash
# 1. USB port forwarding
adb reverse tcp:9009 tcp:9009

# 2. Start host server
node ./src/cli.js --host-server --host=127.0.0.1 --port=9009 \
  --virtual-display --display-width=1600 --display-height=900 \
  --frame-interval-ms=100 --capture-backend=coreGraphics

# 3. Open MiPadLink on tablet → host: 127.0.0.1, port: 9009 → tap "连接 TCP"
```

## Troubleshooting

- **No display capture**: grant Screen Recording permission and restart terminal
- **Touch not working**: grant Accessibility permission and restart terminal
- **Repeated "unknown" popups**: ensure `--capture-backend=coreGraphics` (default)
