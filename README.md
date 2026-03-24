# MiPadLink

**Turn your Android tablet into a wired extended display for macOS — over USB, no Wi-Fi needed.**

**把你的安卓平板变成 Mac 的 USB 有线扩展屏 — 无需 Wi-Fi。**

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue" alt="macOS" />
  <img src="https://img.shields.io/badge/client-Android%2010%2B-green" alt="Android 10+" />
  <img src="https://img.shields.io/badge/license-MIT-orange" alt="MIT" />
</p>

---

## Features / 功能

- **USB wired connection** — low latency, no network dependency / USB 有线连接，低延迟，不依赖网络
- **Virtual display** — creates a real macOS extended desktop on your tablet / 在平板上创建真实的 macOS 扩展桌面
- **Touch input** — tap and drag on tablet to control the extended display / 在平板上触控操作扩展屏
- **Works on any Android tablet** — tested on Xiaomi Pad 7, should work on Samsung, Lenovo, etc. / 适用于任何安卓平板
- **No root required** — standard ADB + TCP, no system modification needed / 无需 root

## How It Works / 工作原理

```
┌─────────────┐    USB + adb reverse    ┌─────────────────┐
│   macOS     │◄────────────────────────►│  Android Tablet │
│  Host Node  │   TCP localhost:9009     │   MiPadLink App │
│  + Virtual  │ ──── JPEG frames ──────► │   renders frame │
│   Display   │ ◄─── touch events ────── │   sends touch   │
└─────────────┘                          └─────────────────┘
```

1. Mac creates a virtual display and captures its content (CoreGraphics)
2. Frames are JPEG-encoded and streamed to the tablet over USB (via `adb reverse`)
3. Tablet renders frames and sends touch coordinates back to Mac
4. Mac injects touch/mouse input into the virtual display

## Prerequisites / 环境要求

### Mac (Host)
- **macOS 13+** (Ventura or later)
- **Node.js 18+** (`node --version`)
- **Xcode Command Line Tools** (`xcode-select --install`)

### Android Tablet (Client)
- **Android 10+** (API 29+)
- **USB debugging enabled** (Settings → Developer Options → USB Debugging)
- **JDK 17 + Android SDK** (for building the APK)

## Quick Start / 快速开始

### 1. Build the macOS helper / 编译 macOS 原生组件

```bash
cd MiPadLink
./scripts/build-macos-helper.sh
```

### 2. Build & install the Android app / 编译安装安卓客户端

```bash
# Connect tablet via USB, then:
adb devices                    # verify tablet is listed

cd android-client
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### 3. Start (one command does everything) / 一键启动

```bash
./start.sh
```

This script: checks the device, sets up `adb reverse`, and starts the host server in one step.

> **Note:** `adb reverse` resets whenever you replug the USB cable or reinstall the APK. Always re-run `./start.sh` after reconnecting.

### 5. Connect from tablet / 平板连接

1. Open **MiPadLink** app on tablet
2. Host: `127.0.0.1`, Port: `9009`
3. Tap **连接 TCP**
4. Double-tap the preview area to enter fullscreen

> **First run on macOS:** grant **Screen Recording** and **Accessibility** permissions to your terminal app in System Settings → Privacy & Security, then restart the host server.

## Configuration / 配置选项

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--host` | `0.0.0.0` | Bind address |
| `--port` | `9009` | TCP port |
| `--virtual-display` | off | Create a macOS virtual display |
| `--display-width` | `1920` | Virtual display width |
| `--display-height` | `1080` | Virtual display height |
| `--frame-interval-ms` | `100` | Frame push interval (ms) |
| `--jpeg-quality` | `0.72` | JPEG quality (0.0–1.0) |
| `--capture-backend` | `coreGraphics` | `coreGraphics` or `screenCaptureKit` |
| `--frame-source` | `screen` | `screen`, `mock`, or auto |
| `--log-input` | off | Log touch input events |

### Tuning tips / 调优建议

```bash
# Lower latency (more CPU, lower quality)
--frame-interval-ms=50 --jpeg-quality=0.5

# Balanced
--frame-interval-ms=100 --jpeg-quality=0.72

# Battery saver
--frame-interval-ms=200 --jpeg-quality=0.45
```

## Project Structure / 项目结构

```
MiPadLink/
├── src/                    # Node.js host server
│   ├── cli.js              # CLI entry point
│   ├── host-server.js      # TCP server + frame pump
│   ├── frame-provider.js   # Screen capture frame providers
│   ├── virtual-display-helper.js  # macOS virtual display management
│   ├── session.js          # Display session state machine
│   ├── protocol.js         # Message protocol definitions
│   └── *.test.js           # Unit tests
├── macos-helper/           # Native macOS helpers (Obj-C++ / Swift)
│   ├── padlink_virtual_display.mm  # Virtual display + CoreGraphics capture
│   └── padlink_sc_capture.swift    # ScreenCaptureKit capture (optional)
├── android-client/         # Android tablet client
│   └── app/src/main/java/com/padlink/client/
│       ├── MainActivity.kt             # Main UI
│       ├── runtime/PadClientController.kt   # Session controller
│       ├── runtime/PadClientTcpTransport.kt # TCP transport
│       ├── runtime/BridgeMessage.kt         # Protocol messages
│       └── ui/RenderSurfaceView.kt          # Frame renderer
├── scripts/                # Build scripts
└── docs/                   # Additional documentation
```

## Running Tests / 运行测试

```bash
npm test
```

## Compatibility / 兼容性

| Device | Status |
|--------|--------|
| Xiaomi Pad 7 | ✅ Tested |
| Other Android 10+ tablets | ✅ Should work |
| macOS 13+ (Apple Silicon) | ✅ Tested |
| macOS 13+ (Intel) | ⚠️ Untested, should work |

## Roadmap / 路线图

- [ ] Hardware-accelerated video encoding (H.264/HEVC) to replace JPEG
- [ ] Multi-touch gesture forwarding
- [ ] Auto-reconnection on USB re-plug
- [ ] Adaptive frame rate based on network throughput
- [ ] Pre-built APK releases

## Contributing / 贡献

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License / 许可

[MIT](LICENSE)

## Acknowledgments / 致谢

- Apple CoreGraphics & ScreenCaptureKit APIs
- Android Jetpack libraries
