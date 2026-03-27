# MiPadLink

[中文说明](README.zh-CN.md) | **English**

Turn an Android tablet into a wired macOS extended display over USB.

MiPadLink creates a real macOS virtual display, streams frames to an Android tablet through `adb reverse`, and sends touch input back to the Mac. The current implementation is optimized around Apple Silicon Macs and Android 10+ tablets, with Xiaomi Pad 7 as the main validation device.

<p align="center">
  <img src="https://img.shields.io/badge/macOS-13%2B-111827?style=flat-square" alt="macOS 13+" />
  <img src="https://img.shields.io/badge/Android-10%2B-166534?style=flat-square" alt="Android 10+" />
  <img src="https://img.shields.io/badge/Connection-USB%20wired-1d4ed8?style=flat-square" alt="USB wired" />
  <img src="https://img.shields.io/badge/License-MIT-b45309?style=flat-square" alt="MIT" />
</p>

## Screenshots

### Android client UI

![MiPadLink Android client](docs/assets/pad-ui-cn.png)

### Fit mode on Xiaomi Pad 7

`Fit` mode keeps the full macOS frame visible and avoids side cropping on 3:2 tablets.

![MiPadLink fit mode preview](docs/assets/pad-preview-fit.png)

## What This Project Does

- Creates a real macOS virtual display instead of a fake mirrored video window
- Uses a USB-first workflow through `adb reverse`
- Streams preview frames to Android over TCP localhost
- Sends touch input back to macOS
- Includes a local dashboard for display mode switching, capture presets, and quick diagnostics
- Includes a guided setup checklist in the dashboard so first-time users can see what is still missing
- Adds a guided setup panel with context-aware recovery buttons such as rebuilding the virtual display
- Adds an acceptance-test panel where you can mark pass/fail, keep notes, and copy a verification summary
- The acceptance panel can also recommend the next test and move through cases one by one
- The acceptance entry now lives near the top of the Mac dashboard so users do not need to hunt for it
- The dashboard can also open the relevant macOS settings panes for permission recovery

## Current Status

MiPadLink is already usable for experimentation, demos, and light productivity, but it is still an engineering prototype rather than a polished end-user product.

What works well right now:

- Wired host startup with `./start.sh`
- `./start.sh stop | status | doctor` operational flow
- macOS dashboard at `http://127.0.0.1:9010`
- Extended display and mirror switching
- Android fullscreen preview
- `Fit` mode for tablets with a different aspect ratio than the Mac virtual display

Known limitations:

- The transport is still JPEG-based, so latency and CPU usage can be improved further
- Compatibility should be described as “many Android tablets”, not literally every tablet
- Touch, scaling, and OEM background behavior may still vary by device brand and ROM

## Architecture

```text
macOS host
  -> creates a virtual display
  -> captures display frames
  -> serves frames on TCP localhost:9009
  -> injects pointer/touch input

USB cable + adb reverse
  -> forwards tablet localhost:9009 to Mac localhost:9009

Android client
  -> connects to 127.0.0.1:9009
  -> decodes JPEG frames
  -> renders preview/fullscreen
  -> sends touch coordinates back to macOS
```

## Quick Start

### 1. Requirements

Mac host:

- macOS 13+
- Node.js 18+
- Xcode Command Line Tools

Android tablet:

- Android 10+
- USB debugging enabled

### 2. Build the native helper

```bash
./scripts/build-macos-helper.sh
```

### 3. Build and install the Android client

```bash
cd android-client
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### 4. Start everything

```bash
./start.sh
```

What `./start.sh start` does:

- locates or downloads `adb`
- runs `adb reverse tcp:9009 tcp:9009`
- starts the host server
- opens the dashboard in the browser by default
- auto-checks the USB / adb link again once the host is live

Useful variants:

```bash
./start.sh
./start.sh start
./start.sh start balanced --no-open
./start.sh performance
./start.sh balanced mirror
./start.sh status
./start.sh doctor
./start.sh stop
npm run start:pad
npm run status:pad
npm run doctor:pad
```

Dashboard:

- URL: [http://127.0.0.1:9010](http://127.0.0.1:9010)
- Controls:
  - Extended / mirrored display switching
  - Capture presets
  - Virtual display rebuild
  - Close virtual display
  - Exit host service
  - Live USB / adb status with one-click repair for `adb reverse`
  - Refresh setup checks and see the next recommended action
  - Guided setup steps with recovery actions
  - Acceptance tests with pass/fail tracking and copyable summary
  - Recommended next test with previous/next navigation

Operational commands:

- `./start.sh start [performance|balanced|battery] [mirror] [--no-open]`
- `./start.sh status`
- `./start.sh doctor`
- `./start.sh stop`

### 5. Connect from the tablet

In the Android app:

1. Host: `127.0.0.1`
2. Port: `9009`
3. Tap `连接 TCP`
4. Use `完整显示 / Fit` if you want the whole desktop visible
5. Use `铺满裁切 / Fill` if you prefer edge-to-edge rendering

## Repository Guide

- [README.zh-CN.md](README.zh-CN.md): Chinese repository overview
- [docs/device-setup.md](docs/device-setup.md): setup details
- [docs/troubleshooting.md](docs/troubleshooting.md): common problems
- [docs/release-notes.en.md](docs/release-notes.en.md): English release notes draft
- [docs/release-notes.zh-CN.md](docs/release-notes.zh-CN.md): 中文发布说明草稿

## Compatibility

Validated directly:

- Xiaomi Pad 7
- macOS on Apple Silicon

Expected to work with adaptation:

- many Android 10+ tablets from Samsung, Lenovo, Huawei, OPPO, vivo, and similar vendors

Not guaranteed:

- every Android tablet
- every vendor ROM
- every screen ratio without extra tuning

## Roadmap

- Hardware-accelerated H.264/HEVC streaming
- Better latency profiling
- More robust reconnect handling after USB replug
- Better multi-device compatibility presets
- Prebuilt Android APK releases

## License

[MIT](LICENSE)
