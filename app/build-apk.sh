#!/usr/bin/env bash
# Build a standalone, installable Android APK locally (no Expo account / EAS).
# Mirrors the flow6979/root release approach: local Gradle build -> gh release.
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

cd "$(dirname "$0")"

echo "==> Accepting SDK licenses + installing platform 36 / build-tools 36"
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"

echo "==> Gradle assembleRelease (release build, JS bundled, debug-signed = installable)"
cd android
./gradlew assembleRelease --no-daemon

APK="$(pwd)/app/build/outputs/apk/release/app-release.apk"
echo "==> DONE. APK at: $APK"
ls -lh "$APK"
