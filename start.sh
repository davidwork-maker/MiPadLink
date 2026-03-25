#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PORT=9009
DASH_PORT=9010

find_adb() {
  local candidates=(
    "${PADLINK_ADB:-}"
    "/tmp/padlink-tools/platform-tools/adb"
    "$HOME/.local/android-sdk/platform-tools/adb"
    "$HOME/Library/Android/sdk/platform-tools/adb"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  if command -v adb >/dev/null 2>&1; then
    command -v adb
    return 0
  fi
  return 1
}

ensure_adb() {
  if ADB="$(find_adb)"; then
    return 0
  fi
  echo "[mipadlink] adb not found, downloading Android platform-tools..."
  mkdir -p /tmp/padlink-tools
  curl -L --fail --retry 2 -o /tmp/platform-tools-latest-darwin.zip \
    "https://dl.google.com/android/repository/platform-tools-latest-darwin.zip"
  unzip -oq /tmp/platform-tools-latest-darwin.zip -d /tmp/padlink-tools
  ADB="/tmp/padlink-tools/platform-tools/adb"
}

ADB=""

# --- Frame rate presets ---
# Usage: ./start.sh [performance|balanced|battery] [mirror]
PRESET="balanced"
MIRROR_MODE=0
MIRROR_FLAG=""
for ARG in "$@"; do
  case "$ARG" in
    performance|p|1)
      PRESET="performance"
      ;;
    balanced|b|2)
      PRESET="balanced"
      ;;
    battery|3)
      PRESET="battery"
      ;;
    mirror|--mirror)
      MIRROR_MODE=1
      ;;
  esac
done

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
    FRAME_INTERVAL=80
    JPEG_QUALITY=0.55
    echo "[mipadlink] preset: BALANCED (80ms, quality 0.55)"
    ;;
esac

if [[ "$MIRROR_MODE" -eq 1 ]]; then
  echo "[mipadlink] initial mode: MIRROR DISPLAY"
  MIRROR_FLAG="--mirror-display"
fi

# --- Kill existing server ---
OLD_PIDS=$(lsof -ti :$PORT -ti :$DASH_PORT 2>/dev/null | sort -u)
if [[ -n "$OLD_PIDS" ]]; then
  echo "[mipadlink] stopping existing server (PIDs: ${OLD_PIDS//$'\n'/ })..."
  echo "$OLD_PIDS" | xargs kill 2>/dev/null || true
  sleep 1
fi

# --- Check Pad connection ---
echo "[mipadlink] checking Pad connection..."
ensure_adb
echo "[mipadlink] using adb: $ADB"
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
  $MIRROR_FLAG \
  --display-width=1600 \
  --display-height=900 \
  --frame-interval-ms=$FRAME_INTERVAL \
  --jpeg-quality=$JPEG_QUALITY \
  --capture-backend=systemScreencapture
