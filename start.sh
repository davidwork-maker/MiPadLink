#!/usr/bin/env zsh
set -e

SCRIPT_DIR="${0:A:h}"
ADB="/Users/davidwork/.local/android-sdk/platform-tools/adb"
PORT=9009
DASH_PORT=9010

# --- Frame rate presets ---
# Usage: ./start.sh [performance|balanced|battery]
PRESET="${1:-balanced}"
case "$PRESET" in
  performance|p|1)
    FRAME_INTERVAL=50
    JPEG_QUALITY=0.55
    echo "[mipadlink] preset: PERFORMANCE (50ms, quality 0.55)"
    ;;
  battery|b|3)
    FRAME_INTERVAL=200
    JPEG_QUALITY=0.45
    echo "[mipadlink] preset: BATTERY SAVER (200ms, quality 0.45)"
    ;;
  *)
    PRESET="balanced"
    FRAME_INTERVAL=100
    JPEG_QUALITY=0.72
    echo "[mipadlink] preset: BALANCED (100ms, quality 0.72)"
    ;;
esac

# --- Kill existing server ---
OLD_PIDS=$(lsof -ti :$PORT -ti :$DASH_PORT 2>/dev/null | sort -u)
if [[ -n "$OLD_PIDS" ]]; then
  echo "[mipadlink] stopping existing server (PIDs: ${OLD_PIDS//$'\n'/ })..."
  echo "$OLD_PIDS" | xargs kill 2>/dev/null || true
  sleep 1
fi

# --- Check Pad connection ---
echo "[mipadlink] checking Pad connection..."
if ! "$ADB" devices 2>/dev/null | grep -q "device$"; then
  echo "[mipadlink] WARNING: no Android device found. Server will start anyway."
  echo "[mipadlink]          Connect Pad via USB, then run: $ADB reverse tcp:$PORT tcp:$PORT"
else
  echo "[mipadlink] setting up USB port forwarding..."
  "$ADB" reverse tcp:$PORT tcp:$PORT
  echo "[mipadlink] adb reverse tcp:$PORT ok"
fi

# --- Start server ---
echo "[mipadlink] starting host server..."
echo "[mipadlink] dashboard: http://127.0.0.1:$DASH_PORT"
echo "[mipadlink] press Ctrl+C to stop"

# open dashboard in browser after a short delay
(sleep 3 && open "http://127.0.0.1:$DASH_PORT") &

exec node "$SCRIPT_DIR/src/cli.js" \
  --host-server \
  --host=127.0.0.1 \
  --port=$PORT \
  --virtual-display \
  --display-width=1600 \
  --display-height=900 \
  --frame-interval-ms=$FRAME_INTERVAL \
  --jpeg-quality=$JPEG_QUALITY \
  --capture-backend=coreGraphics
