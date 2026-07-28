# Dispatch — Deploy & Mobile (APK) Guide

Goal: run Dispatch as an installable Android APK that talks to a free-hosted backend, with the runner on your laptop.

```
 Android APK ──https──▶  Render (free backend)  ◀──wss── Laptop runner (your machine)
```
The phone and the runner both connect OUT to the hosted backend, so the phone works from anywhere and your laptop only needs outbound internet.

---

## Step 1 — Backend on Render (free)  ⟵ needs your free Render account
The repo includes `render.yaml`, so this is near one-click:
1. Go to https://render.com → sign up / log in **with GitHub** (free).
2. **New → Blueprint** → pick the `dispatch` repo → **Apply**.
3. Wait for the deploy. You'll get a URL like `https://dispatch-backend.onrender.com`.
4. Verify: open `https://dispatch-backend.onrender.com/api/health` → `{"ok":true,...}`.

> Free tier sleeps after ~15 min idle → the first request after idle takes ~30–50s (cold start), then it's fast. The service itself persists (longevity is fine).

Tell me the URL and I'll bake it into the APK build + point the runner at it.

## Step 2 — Point the runner at the hosted backend  ⟵ I automate once I have the URL
On your laptop:
```
cd dispatch/runner
DISPATCH_BACKEND=dispatch-backend.onrender.com DISPATCH_STUB=1 npm start
```
(The runner connects out via `wss://`. Keep it running while you test. Use `DISPATCH_STUB=0` for real PRs.)

## Step 3 — Build the APK (EAS)  ⟵ needs your free Expo account
Config is already in `app/eas.json` + `app/app.json` (package `com.flow6979.dispatch`, cleartext + INTERNET, APK profile).
```
cd dispatch/app
npx eas-cli login                     # free Expo account
# I will set EXPO_PUBLIC_API_BASE in eas.json to your Render URL first
npx eas-cli build -p android --profile preview
```
EAS builds in the cloud (~10–15 min) and gives a download link. Open it on your phone → install the APK (allow "install from unknown sources").

Alternatively give me an `EXPO_TOKEN` (Expo dashboard → Account → Access Tokens) and I'll trigger the build for you.

## Step 4 — Publish the APK as a GitHub Release (optional, easy phone download)
Once EAS produces the `.apk`, I'll attach it to a GitHub Release on the public repo so you can download it directly from your phone browser.

---

## Fastest smoke test (no build) — Expo Go
If you just want to see it on the phone in ~2 min: install **Expo Go** (Play Store), then on the laptop `cd dispatch/app && npx expo start --tunnel`, scan the QR. (Point it at the Render URL via `EXPO_PUBLIC_API_BASE`.)
