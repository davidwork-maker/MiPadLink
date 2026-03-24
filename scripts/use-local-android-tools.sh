#!/usr/bin/env zsh

# Source this file before Android builds in this repo:
#   source ./scripts/use-local-android-tools.sh
#
# Customize the paths below to match your local toolchain installation.
# If JAVA_HOME or ANDROID_HOME are already set in your shell, this script
# will use those values as defaults.

PADLINK_TOOLS_ROOT="${PADLINK_TOOLS_ROOT:-/Users/davidwork/.local/padlink-tools}"
PADLINK_ANDROID_SDK="${PADLINK_ANDROID_SDK:-/Users/davidwork/.local/android-sdk}"

export JAVA_HOME="${JAVA_HOME:-$PADLINK_TOOLS_ROOT/jdk-17.0.18+8/Contents/Home}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$PADLINK_ANDROID_SDK}"
export ANDROID_HOME="$ANDROID_SDK_ROOT"

export PATH="$JAVA_HOME/bin:$PADLINK_TOOLS_ROOT/gradle-8.10.2/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"

echo "JAVA_HOME=$JAVA_HOME"
echo "ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT"
java -version 2>&1 | head -1
echo "adb: $(which adb 2>/dev/null || echo 'not found')"
