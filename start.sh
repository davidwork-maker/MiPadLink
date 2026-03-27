#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PORT=9009
DASH_PORT=9010
ADB=""
PRESET="balanced"
MIRROR_MODE=0
AUTO_OPEN=1

usage() {
  cat <<'EOF'
MiPadLink launcher

Usage:
  ./start.sh
  ./start.sh start [performance|balanced|battery] [mirror] [--no-open]
  ./start.sh stop
  ./start.sh status
  ./start.sh doctor
  ./start.sh help

Examples:
  ./start.sh
  ./start.sh performance
  ./start.sh start balanced mirror
  ./start.sh start balanced --no-open
  ./start.sh stop
  ./start.sh doctor
EOF
}

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

find_running_pids() {
  local pids
  pids="$(lsof -ti :$PORT -ti :$DASH_PORT 2>/dev/null | sort -u || true)"
  if [[ -n "$pids" ]]; then
    echo "$pids"
  fi
  return 0
}

wait_for_ports_to_close() {
  local attempts=10
  local running_pids
  while (( attempts > 0 )); do
    running_pids="$(find_running_pids)"
    if [[ -z "$running_pids" ]]; then
      return 0
    fi
    sleep 1
    attempts=$((attempts - 1))
  done
  return 1
}

request_graceful_shutdown() {
  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi
  if curl -fsS -m 2 \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"action":"shutdownHost"}' \
    "http://127.0.0.1:$DASH_PORT/api/control" >/dev/null 2>&1; then
    echo "[mipadlink] requested graceful shutdown from dashboard..."
  fi
}

stop_port_processes() {
  local old_pids
  old_pids="$(find_running_pids)"
  if [[ -n "$old_pids" ]]; then
    echo "[mipadlink] stopping existing server (PIDs: ${old_pids//$'\n'/ })..."
    echo "$old_pids" | xargs kill 2>/dev/null || true
    sleep 1
  fi
}

cleanup_stale_helpers() {
  echo "[mipadlink] cleaning stale virtual display helpers..."
  pkill -f "padlink-virtual-display create" 2>/dev/null || true
  sleep 1
}

run_stop() {
  request_graceful_shutdown
  wait_for_ports_to_close || true
  stop_port_processes
  cleanup_stale_helpers
  echo "[mipadlink] stopped."
}

run_status() {
  node "$SCRIPT_DIR/src/cli.js" \
    --status \
    --host=127.0.0.1 \
    --port=$PORT \
    --dashboard-port=$DASH_PORT
}

run_doctor() {
  node "$SCRIPT_DIR/src/cli.js" \
    --doctor \
    --host=127.0.0.1 \
    --port=$PORT \
    --dashboard-port=$DASH_PORT
}

parse_start_options() {
  local arg
  PRESET="balanced"
  MIRROR_MODE=0
  AUTO_OPEN=1
  for arg in "$@"; do
    case "$arg" in
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
      no-open|--no-open)
        AUTO_OPEN=0
        ;;
      *)
        echo "[mipadlink] unknown start option: $arg"
        usage
        exit 1
        ;;
    esac
  done
}

run_start() {
  local frame_interval
  local jpeg_quality
  local mirror_flag=""

  case "$PRESET" in
    performance)
      frame_interval=50
      jpeg_quality=0.55
      echo "[mipadlink] preset: PERFORMANCE (50ms, quality 0.55)"
      ;;
    battery)
      frame_interval=200
      jpeg_quality=0.45
      echo "[mipadlink] preset: BATTERY SAVER (200ms, quality 0.45)"
      ;;
    *)
      PRESET="balanced"
      frame_interval=80
      jpeg_quality=0.55
      echo "[mipadlink] preset: BALANCED (80ms, quality 0.55)"
      ;;
  esac

  if [[ "$MIRROR_MODE" -eq 1 ]]; then
    echo "[mipadlink] initial mode: MIRROR DISPLAY"
    mirror_flag="--mirror-display"
  fi

  stop_port_processes
  cleanup_stale_helpers

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

  echo "[mipadlink] starting host server..."
  echo "[mipadlink] dashboard: http://127.0.0.1:$DASH_PORT"
  echo "[mipadlink] tip: ./start.sh stop | ./start.sh status | ./start.sh doctor"
  echo "[mipadlink] press Ctrl+C to stop"

  if [[ "$AUTO_OPEN" -eq 1 ]]; then
    (sleep 3 && open "http://127.0.0.1:$DASH_PORT") &
  else
    echo "[mipadlink] auto-open disabled (--no-open)"
  fi

  exec node "$SCRIPT_DIR/src/cli.js" \
    --host-server \
    --host=127.0.0.1 \
    --port=$PORT \
    --virtual-display \
    $mirror_flag \
    --display-width=1600 \
    --display-height=900 \
    --frame-interval-ms=$frame_interval \
    --jpeg-quality=$jpeg_quality \
    --capture-backend=systemScreencapture
}

COMMAND="start"
if [[ $# -gt 0 ]]; then
  case "$1" in
    start|stop|status|doctor|help)
      COMMAND="$1"
      shift
      ;;
    -h|--help)
      COMMAND="help"
      shift
      ;;
  esac
fi

case "$COMMAND" in
  start)
    parse_start_options "$@"
    run_start
    ;;
  stop)
    run_stop
    ;;
  status)
    run_status
    ;;
  doctor)
    run_doctor
    ;;
  help)
    usage
    ;;
esac
