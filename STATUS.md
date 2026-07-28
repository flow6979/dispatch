# Dispatch — Build Status (your wakeup report ☀️)

**TL;DR: the MVP is built, integrated, and working end-to-end.** You can capture a task from the (web) app → your laptop runner processes it → it flows to a draft PR → the app shows it. All 6 main screens render with live data. Verified via automated browser testing (no emulator on this machine — details below).

---

## ✅ What works right now
- **Backend** (Fastify + WS + JSON store, :4000) — full task state machine, live against your real `gh` repos.
- **Runner daemon** — connects, generates a spec, runs the task, returns a draft-PR result. **Stub mode** during testing (did NOT touch your real repos while you slept). Real path built (`DISPATCH_STUB=0`).
- **Phone app** (Expo/React Native, run on web) — all 8 surfaces, wired to the backend, polling live.
- **End-to-end loop** — proven twice: via `integration.sh` and by **typing a task in the actual UI** ("Add a dark mode toggle to settings") and watching it reach PR_OPEN.

## 📸 Screenshots (in project root, open them)
- `dispatch-03-capture-home.png` — Capture (hero): mic, context bar, DRAFT ONLY, Recent
- `dispatch-04-tasks.png` — Task board (grouped)
- `dispatch-05-repo-picker.png` — Repo picker showing **your real GitHub repos**
- `dispatch-06-settings.png` — Settings with **live runner status**
- `dispatch-07-digest.png` — Morning digest (triaged)
- `dispatch-02-capture-fixed.png` — Task detail (confidence-first summary + progress)
- `dispatch-01-capture.png` — the BROKEN render before I fixed the layout bug (kept as before/after)

## ▶️ To see it yourself
The servers may still be running — try **http://localhost:8081** in a browser. If not, restart:
```
cd dispatch/backend && npm start
cd dispatch/runner  && DISPATCH_STUB=1 npm start
cd dispatch/app     && npx expo start --web
```
(Full details in `dispatch/README.md`.)

---

## Decisions I made (revisit on your feedback)
1. **No emulator on this machine** (no Xcode/iOS Sim, no Android emu) → app verified on **Expo Web + Playwright**. Native path intact; install Xcode/Android Studio later to run on a device/emulator. I did NOT auto-install Xcode (multi-GB, intrusive).
2. **Runner in STUB mode** for testing → zero real PRs on your repos overnight. Flip `DISPATCH_STUB=0` to go live.
3. **JSON-file store** (not SQLite) + **polling** (not WS) in the app → fast, reliable, zero native deps. Easy to upgrade later.
4. Auth = static `dev-token`; autonomy = Draft-only. Matches the spec's MVP.

## 🐞 Bugs found & fixed during testing
1. **Web layout collapse** — the phone frame used `flex:0`, which RN-Web emits as `flex:0 1 0%`; a flex-basis of `0%` overrode `height:800` and collapsed the frame to ~2px (blank screen). Diagnosed with Playwright computed-style walk; fixed with explicit `flexGrow/flexShrink/flexBasis`. Now renders 390×732. (`app/app/_layout.js`)
   - Side note: CI-mode Metro needs an Expo **restart** to pick up edits (no hot reload).

## 🔧 Known limitations / polish items (good candidates for your feedback)
- **Board shows only "Ready" group** — stub always succeeds → every task hits PR_OPEN. The Needs-you / Running / Blocked groups are built but only populate once the **real runner** produces those states (or we seed them). Want me to add a demo seed?
- **Submitting a task opened the stub PR URL in a new browser tab** — need to check whether Task Detail auto-opens `prUrl`; likely a small effect to gate behind a tap. (Flagged, not yet fixed.)
- **Voice is a placeholder** — mic button is visual only; text is the working path (as scoped for MVP).
- **Spec Confirm auto-proceeds in 3s** — so I couldn't easily screenshot it mid-flow; the screen exists and is wired.
- Digest token spend is a rough estimate (backend doesn't report real spend yet).

## Build checklist
- [x] Backend built + verified ✅
- [x] Runner built + selftest ✅
- [x] Expo app built + web bundle compiles ✅
- [x] Integration test passes: task → PR_OPEN ✅
- [x] App renders on web (after layout fix) ✅
- [x] Click-through: Capture / Tasks / Repo / Settings / Digest / Task Detail ✅
- [x] Task created + completed **through the UI** ✅

## When you wake — how we iterate
Tell me "change this / that" on any screen or behavior. Fast to iterate because it's all one HTML-simple RN codebase + a tiny backend. Likely first asks: real-runner run on one of your repos (flip stub off, pick a safe repo), state variety on the board, voice input, or visual tweaks.
