# Dispatch — MVP

Voice/text remote for an async coding agent. Capture a task from the phone → the laptop runner builds it in a branch, runs tests, opens a **draft PR** → review at a screen.

**This machine has no mobile emulator**, so the app is run/verified on **Expo Web**. Native (iOS/Android) is ready for when Xcode / Android Studio are installed.

## Components
- `backend/` — Fastify + WebSocket orchestrator (:4000), JSON-file store. Owns the task state machine.
- `runner/` — laptop daemon. Drives the authenticated `claude` CLI headless + git + `gh` to open draft PRs. **Stub mode is the default** (safe: touches no real repos).
- `app/` — Expo (React Native) phone app; runs on web for now.
- `PROTOCOL.md` — the binding contract between the three.

## Run it (3 terminals)
```bash
# 1. backend
cd backend && npm install && npm start          # http://localhost:4000

# 2. runner (STUB mode = safe default; no real git/PRs)
cd runner && npm install && DISPATCH_STUB=1 npm start

# 3. app (web)
cd app && npm install && npx expo start --web    # opens in browser
```

## Test the end-to-end loop (stub, no real repos)
```bash
bash test/integration.sh
```
Creates a task and asserts it flows CAPTURED → SPEC_DRAFTED → SPEC_CONFIRMED → RUNNING → TESTS → PR_OPEN with a (fake) PR URL.

## Going live (real PRs) — opt-in, not default
Set `DISPATCH_STUB=0` on the runner. It will then clone the target repo under `~/dispatch-workspace`, branch off (never on a protected/default branch), run `claude` headless, run tests, and open a **draft** PR via `gh`. Never merges.

See `STATUS.md` for the current build/test state and open items.
