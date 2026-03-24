#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_FILE="$ROOT_DIR/macos-helper/padlink_virtual_display.mm"
SC_CAPTURE_SRC="$ROOT_DIR/macos-helper/padlink_sc_capture.swift"
OUT_DIR="$ROOT_DIR/macos-helper/build"
OUT_FILE="$OUT_DIR/padlink-virtual-display"
SC_CAPTURE_OUT="$OUT_DIR/padlink-sc-capture"

mkdir -p "$OUT_DIR"

clang++ \
  -std=c++17 \
  -fobjc-arc \
  -Wall \
  -Wextra \
  -framework Cocoa \
  -framework CoreGraphics \
  "$SRC_FILE" \
  -o "$OUT_FILE"

if [[ "${PADLINK_ENABLE_SC_CAPTURE:-0}" == "1" ]] && command -v swiftc >/dev/null 2>&1; then
  set +e
  swiftc \
    -O \
    -parse-as-library \
    -framework ScreenCaptureKit \
    -framework AppKit \
    "$SC_CAPTURE_SRC" \
    -o "$SC_CAPTURE_OUT"
  swift_status=$?
  set -e
  if [[ $swift_status -ne 0 ]]; then
    echo "warn: failed to compile ScreenCaptureKit helper, fallback to CoreGraphics capture only" >&2
  fi
elif [[ "${PADLINK_ENABLE_SC_CAPTURE:-0}" == "1" ]]; then
  echo "warn: swiftc not found, fallback to CoreGraphics capture only" >&2
fi

echo "virtual_display=$OUT_FILE"
if [[ "${PADLINK_ENABLE_SC_CAPTURE:-0}" == "1" ]] && [[ -f "$SC_CAPTURE_OUT" ]]; then
  echo "sc_capture=$SC_CAPTURE_OUT"
fi
