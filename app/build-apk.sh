#!/usr/bin/env bash
# Build a standalone, installable Android APK locally (no Expo account / EAS).
# Mirrors the flow6979/root release approach: local Gradle build -> gh release.
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

# AGP 8.12's native (prefab/CMake) toolchain does not support JDK 24+; use JDK 17
# if a newer JVM is the default. Homebrew openjdk@17 is the expected location.
JDK17="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
if [ -x "$JDK17/bin/java" ]; then
  export JAVA_HOME="$JDK17"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
echo "==> Using JDK: $("${JAVA_HOME:-}/bin/java" -version 2>&1 | head -1)"

cd "$(dirname "$0")"

echo "==> Accepting SDK licenses + installing platform 36 / build-tools 36"
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006"

echo "==> Gradle assembleRelease (release build, JS bundled, debug-signed = installable)"
cd android
./gradlew assembleRelease --no-daemon

APK="$(pwd)/app/build/outputs/apk/release/app-release.apk"
echo "==> DONE. APK at: $APK"
ls -lh "$APK"
