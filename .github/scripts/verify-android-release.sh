#!/usr/bin/env bash
set -euo pipefail

APK="android/app/build/outputs/apk/release/app-release.apk"
PACKAGE="org.knowledgeball.app"
ACTIVITY="${PACKAGE}/.MainActivity"
ARTIFACT_DIR="artifacts/android-release"
LAUNCH_LOG="${RUNNER_TEMP}/release-launch.txt"

if [[ ! -s "$APK" ]]; then
  echo "Signed release APK is missing or empty: $APK" >&2
  exit 1
fi

adb install -r "$APK"
adb shell am start -W -n "$ACTIVITY" | tee "$LAUNCH_LOG"
sleep 5

PID="$(adb shell pidof "$PACKAGE" | tr -d '\r')"
if [[ -z "$PID" ]]; then
  echo "Android app process is not running after launch: $PACKAGE" >&2
  cat "$LAUNCH_LOG" >&2
  exit 1
fi

echo "Android app is running with PID: $PID"
mkdir -p "$ARTIFACT_DIR"
adb exec-out screencap -p > "$ARTIFACT_DIR/release-launch.png"
test -s "$ARTIFACT_DIR/release-launch.png"
