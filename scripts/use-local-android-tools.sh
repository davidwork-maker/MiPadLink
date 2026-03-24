#!/usr/bin/env zsh

# Source this file before Android builds in this repo:
#   source ./scripts/use-local-android-tools.sh
#
# Customize the paths below to match your local toolchain installation.
# If JAVA_HOME or ANDROID_HOME are already set in your shell, this script
# will use those values as defaults.

export JAVA_HOME="${JAVA_HOME:-/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home}"
export ANDROID_SDK_ROOT="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_HOME="$ANDROID_SDK_ROOT"

export PATH="$JAVA_HOME/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"

echo "JAVA_HOME=$JAVA_HOME"
echo "ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT"
java -version 2>&1 | head -1
echo "adb: $(which adb 2>/dev/null || echo 'not found')"
