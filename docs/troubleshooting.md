# MiPadLink Troubleshooting

## 1. Windows do not appear on the Pad / 窗口拖过去没反应

**Symptoms**
- The Pad shows the desktop wallpaper only.
- Dragging an app window to the virtual display appears to do nothing.

**What to check**
- Make sure the Mac has **Screen Recording** permission enabled for the terminal or IDE that launched `./start.sh`.
- Re-run `./start.sh` after every APK reinstall or USB replug, because `adb reverse` is reset.
- Try **Mirror Display** from the dashboard if the extension display still shows nothing.

**Recovery steps**
1. Stop the server with `Ctrl+C`.
2. Re-run `./start.sh`.
3. Check `./start.sh status` to confirm the virtual display is active.
4. If the display is still blank, open the dashboard and click **镜像显示**.
5. If needed, click **重建虚拟屏** to recreate the virtual display session.

---

## 2. Fullscreen looks cropped / 全屏显示不全

**Symptoms**
- The image fills the screen but some edges appear cut off.
- The aspect ratio looks wrong in fullscreen.

**What to check**
- The Android client uses a **fit-to-screen** renderer, so cropping usually means the current capture source is the wrong mode or size.
- Try switching between **扩展屏** and **镜像显示** in the dashboard.
- Try a different capture preset: **性能**, **平衡**, or **省电**.

---

## 3. `./start.sh` fails with port already in use / 端口被占用

**Symptoms**
- The script reports `EADDRINUSE` on `9009` or `9010`.

**What to do**
- `./start.sh` now tries to stop the old processes automatically.
- `./start.sh stop` performs a cleaner shutdown before falling back to killing old port listeners.
- If something still occupies the ports, manually stop the old Node process and try again.

---

## 4. `adb reverse` disappears / USB changes break connection

**Symptoms**
- The Pad cannot reach `127.0.0.1:9009` after USB reconnect or APK reinstall.

**What to do**
- Re-run `./start.sh`.
- Run `./start.sh doctor` if you are unsure whether `adb` or permissions are missing.
- Open the dashboard and check the **USB / ADB** card.
- Try **刷新 USB 状态** first, then **修复 USB 连接** if `adb reverse` is missing.
- If you need to do it manually:

```bash
export PATH="/Users/davidwork/.local/android-sdk/platform-tools:$PATH"
adb reverse tcp:9009 tcp:9009
```

---

## 5. Mirror mode does not help / 镜像模式也不行

**What to try**
- Click **重建虚拟屏** once.
- Try each capture preset.
- Verify macOS permissions again:
  - Screen Recording
  - Accessibility

**Note**
- Mirror mode is a fallback to make sure the Pad shows usable content even when the virtual extended display is problematic.
