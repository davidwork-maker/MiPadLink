#!/usr/bin/env zsh
set -e

SCRIPT_DIR="${0:A:h}"
ADB="/Users/davidwork/.local/android-sdk/platform-tools/adb"

echo "[mipadlink] checking Pad connection..."
if ! "$ADB" devices | grep -q "device$"; then
  echo "[mipadlink] ERROR: no Android device found. Connect the Pad via USB and enable USB debugging."
  exit 1
fi

echo "[mipadlink] setting up USB port forwarding..."
"$ADB" reverse tcp:9009 tcp:9009
echo "[mipadlink] adb reverse tcp:9009 ok"

echo "[mipadlink] starting host server..."
echo "[mipadlink] dashboard will open at http://127.0.0.1:9010"

# open dashboard in browser after a short delay
(sleep 2 && open "http://127.0.0.1:9010") &

exec node "$SCRIPT_DIR/src/cli.js" \
  --host-server \
  --host=127.0.0.1 \
  --port=9009 \
  --virtual-display \
  --display-width=1600 \
  --display-height=900 \
  --frame-interval-ms=100 \
  --capture-backend=coreGraphics \
  "$@"
