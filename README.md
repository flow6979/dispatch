# Dispatch

**Code from your phone.** Capture a task by voice or text on your phone → an AI
agent (Claude Code) on *your* computer clones the repo, makes the change, runs
tests, and opens a **draft PR** → review it from your phone. You watch it work
live, with real per-task token/$ cost.

> Runs on **your** machine with **your** Claude subscription and GitHub — no
> second cloud bill, and your code/credentials never leave machines you control.

## 📱 Get started
1. **Install the app:** grab `app-release.apk` from the [latest release](https://github.com/flow6979/dispatch/releases/latest) (Android).
2. **Run the runner** on your computer and **approve** it in the app.
3. Pick a repo, capture a task, watch it open a PR.

👉 Full walkthrough: **[docs/CONNECTING.md](docs/CONNECTING.md)** — installing, connecting one or **multiple computers** and choosing which runs your tasks, adding devices, GitHub accounts, settings, and security.

## Components
- **`app/`** — Expo / React Native Android app. Capture (voice + text), live progress, per-task tokens + $, the **Repo Map** tab, and Settings.
- **`backend/`** — Fastify + WebSocket orchestrator on Render. Task state machine, per-device auth, state mirror. No AI, no repo access.
- **`runner/`** — the daemon on your computer. The only piece with your `claude` + `gh` auth; it clones, runs Claude Code, tests, and opens draft PRs. Streams every action back to the phone.
- **`PROTOCOL.md`** — the contract between the three.

## Features
- **Voice or text capture** with **intent detection** — a question is answered (chat); a change request opens a PR.
- **Live action feed** — watch Claude read/edit/run commands in real time; see the exact **tokens + $** per task.
- **Cost controls** — per-task `$` budget cap, model routing (cheap models for cheap steps), and prompt caching (repeat tasks on a repo cost ~half).
- **Repo Map** — zoomable graphs of a repo: files, modules, data entities, and API→DB flow (static analysis, 0 tokens; JS/TS, Python, Go, Java, Kotlin, …).
- **Multiple computers** — connect several PCs and pick which one runs your tasks; automatic failover.
- **Per-device pairing** + revocable tokens; **GitHub account** switch/disconnect from the phone.
- **Draft PRs only** — never merges, never touches protected/default branches; hard `$` budget so nothing runs away.

## Run the stack yourself
```bash
# backend
cd backend && npm install && npm start                 # http://localhost:4000

# runner (STUB mode = safe; no real git/PRs). Use DISPATCH_STUB=0 for real PRs.
cd runner && npm install && \
  DISPATCH_BACKEND=http://localhost:4000 DISPATCH_STUB=1 npm start
```
Build the Android APK locally (JDK 17): `bash app/build-apk.sh`.

## Docs
- **[docs/CONNECTING.md](docs/CONNECTING.md)** — setup & connecting (start here).
- [DEPLOY.md](DEPLOY.md) — deploy the backend (Render) + build the APK.
- [PROTOCOL.md](PROTOCOL.md) — phone ↔ backend ↔ runner message contract.
- [docs/MORNING-REPORT.md](docs/MORNING-REPORT.md) — roadmap, cost math, what's shipped.
- [docs/research/](docs/research/) — competitive analysis, token-optimization, graph-viz notes.
