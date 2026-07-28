# Dispatch — Deploy & Mobile (APK) Guide

```
 Android APK ──https──▶  Render (free backend)  ◀──wss── Laptop runner (your machine)
```
Phone and runner both connect OUT to the hosted backend, so the phone works anywhere and the laptop only needs outbound internet.

## Live backend (Render, free)
- **URL:** https://dispatch-backend-syxb.onrender.com  (health: `/api/health`)
- Free tier sleeps after ~15 min idle → first request cold-starts (~30–50s), then fast.
- Deployed via `render.yaml` blueprint (rootDir `backend`, binds `$PORT`).

## Runner → hosted backend (on your laptop)
```
cd dispatch/runner
DISPATCH_BACKEND=https://dispatch-backend-syxb.onrender.com DISPATCH_STUB=1 npm start
```
The runner derives `wss://` from the https URL automatically. Keep it running while you test.
Use `DISPATCH_STUB=0` for real PRs.

## APK — built locally with Gradle (no Expo account), released on GitHub
This mirrors the `flow6979/root` approach: local build → `gh release create`.
Our app is Expo, so it's `expo prebuild` (done) → Gradle `assembleRelease`.

- Render URL is baked in via `app/.env` (`EXPO_PUBLIC_API_BASE`).
- Release build is JS-bundled and debug-signed → **standalone + installable** (no Metro needed).
- Build script: `app/build-apk.sh` (installs SDK platform 36 / build-tools 36, runs `./gradlew assembleRelease`).

Build + release:
```
bash dispatch/app/build-apk.sh
# -> app/android/app/build/outputs/apk/release/app-release.apk
gh release create v0.1.0 -R flow6979/dispatch \
  --title "Dispatch v0.1.0" --notes "MVP test build" \
  dispatch/app/android/app/build/outputs/apk/release/app-release.apk
```
Then open the release on your phone and download/install the APK (allow "install from unknown sources").

## Toolchain notes (this machine)
- Android SDK: `~/Library/Android/sdk` · JDK 24 · Gradle wrapper 9.3.1 · Expo SDK 57 / RN 0.86 (compileSdk 36).
- No iOS build (no Xcode); Android only for now.
