# MiPadLink Release Notes Draft

## Summary

This release focuses on making MiPadLink easier to start, easier to demonstrate publicly, and better suited for tablets whose aspect ratio differs from the macOS virtual display.

## Highlights

- Added a more public-facing repository structure with bilingual documentation
- Improved startup flow with a one-command launcher
- Added `start / stop / status / doctor` operational commands for day-to-day use
- Added dashboard-driven controls for display mode and capture presets
- Added a dashboard setup checklist with the next recommended action for first-time users
- Added a live USB / adb status card with one-click repair for `adb reverse`
- Added a guided setup panel that surfaces context-aware recovery actions
- Added an acceptance-test panel with pass/fail tracking and copyable test summaries
- Switched the default display capture path to macOS `screencapture`
- Added Android `Fit / Fill` display modes to avoid side cropping on tablets such as Xiaomi Pad 7
- Improved touch/display mapping behavior and virtual display lifecycle handling

## User-Facing Improvements

- `./start.sh` now handles `adb reverse`, host startup, and dashboard launch
- `./start.sh status` and `./start.sh doctor` now expose local health and setup checks
- `./start.sh stop` now shuts down the host and cleans stale virtual display helpers
- `./start.sh start --no-open` now skips the browser auto-open for quieter launches
- Android client now exposes:
  - `完整显示 / Fit`
  - `铺满裁切 / Fill`
  - fullscreen entry
- Dashboard remains available at `http://127.0.0.1:9010`

## Current Positioning

MiPadLink should be presented as:

- an open-source wired-display prototype
- validated on Xiaomi Pad 7
- architecturally reusable for many Android tablets

MiPadLink should not yet be described as:

- universally compatible with every Android tablet
- production-ready for all device vendors and ROMs

## Known Limitations

- JPEG transport still leaves room for latency and CPU improvements
- OEM Android behavior can still affect stability
- More compatibility presets are still needed for wider tablet coverage

## Recommended Next Release Topics

- hardware-accelerated video pipeline
- reconnect hardening
- broader device compatibility matrix
- prebuilt APK distribution
