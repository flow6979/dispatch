# Dispatch — Setup & Connecting Guide

How to install the app, connect your computer(s), connect more devices, manage
GitHub, and run real tasks. Dispatch has three parts:

```
   Phone app            Backend (Render)            Runner (your computer)
 ┌────────────┐  HTTPS  ┌───────────────┐   WSS    ┌──────────────────────┐
 │ capture UI │ ──────▶ │  orchestrator  │ ◀──────▶ │ runs Claude Code + gh │
 │ (Android)  │ ◀────── │  (relay/store) │           │ clones, edits, PRs    │
 └────────────┘  poll   └───────────────┘  socket   └──────────────────────┘
```

- **Phone app** — captures tasks (type or voice), shows progress/cost, the repo map, and settings. No AI, no GitHub access.
- **Backend** — a stateless-ish relay + task state machine on Render. No AI, no GitHub access.
- **Runner** — a Node daemon on *your* computer. It's the only piece with your `claude` login and your `gh` auth; it does the actual work.

> Security model: your Claude subscription, GitHub token, and source code stay
> on machines **you** control. The phone and cloud never see them.

---

## 1. Install the phone app (Android)

1. On your phone, open the latest release: **https://github.com/flow6979/dispatch/releases/latest**
2. Download `app-release.apk`, tap to install (allow "install from unknown sources").
3. Open the app. It auto-connects to the backend baked into the build.

> The APK is debug-signed and standalone. To update, install the newer APK over
> the old one (if it refuses, uninstall first).

---

## 2. Connect a computer (run the runner)

The runner does the real work, so at least one computer must be running it.

```bash
cd dispatch/runner
npm install            # first time only
DISPATCH_BACKEND=https://dispatch-backend-syxb.onrender.com \
  RUNNER_NAME="My Laptop" \
  DISPATCH_STUB=1 \
  npm start
```

Then in the app: **Settings → Runners** → your machine appears as *"awaiting
approval"* → tap **Approve**. Now it can run your tasks.

Requirements on the computer: `git`, `gh` (logged in — `gh auth login`), and the
`claude` CLI (logged in). The runner only connects **out** (no inbound ports),
so it works behind any firewall/NAT.

### Stub vs real mode
- `DISPATCH_STUB=1` (default) — **safe**: simulates a task and returns a fake PR. Touches no repos. Use to try the flow.
- `DISPATCH_STUB=0` — **real**: clones the repo, runs Claude to make changes, runs tests, and opens a **draft PR** (never merges, never pushes to a default/protected branch).

### Keep the runner always on (recommended)

Tasks only run while the runner is up. Install it as a background service so it
starts at login and restarts on crash/reboot:

```bash
# set your DISPATCH_* vars first (they get baked into the service), e.g.:
export DISPATCH_BACKEND=https://dispatch-backend-syxb.onrender.com
export DISPATCH_STUB=0
export RUNNER_NAME="My Laptop"

bash runner/install-macos-service.sh     # macOS (LaunchAgent)
```

- Logs: `tail -f ~/.dispatch/runner.log`
- Change a `DISPATCH_*` var later? Re-export it and re-run the install script.
- Remove: `bash runner/uninstall-macos-service.sh`

The installer captures your current `PATH` and `DISPATCH_*` variables so the
daemon sees the same `claude`/`gh`/`git` and settings you use interactively.

---

## 3. Connect multiple computers & pick which one runs tasks

Run the runner on each computer, giving each a distinct name:

```bash
# on your laptop
RUNNER_NAME="Laptop" DISPATCH_BACKEND=… DISPATCH_STUB=0 npm start
# on your desktop
RUNNER_NAME="Desktop" DISPATCH_BACKEND=… DISPATCH_STUB=0 npm start
```

In **Settings → Runners** you'll see all of them:
- **Approve** each machine you trust.
- Tap a machine's **radio** (or **Use**) to send your tasks to it — the active one shows **✓ Using / "running your tasks"**.
- If the selected machine goes offline, Dispatch falls back to another approved one automatically.
- **Revoke** removes a machine's access.

Your selection persists across backend restarts.

> Tip: on one physical machine you can still run several runners for testing by
> giving each a different `RUNNER_NAME`.

---

## 4. Connect another phone

**Simple (default setup):** just install the APK on the second phone — it
auto-connects to the same backend and sees the same tasks.

**Locked-down setup (a real `DISPATCH_SECRET` is set — see §6):** the second
phone can't auto-connect, so:
1. On a connected device: **Settings → Devices → Pair another device** → it shows a code like `4GMU-M9FX` (valid 30 min).
2. On the new phone, the app shows a **"Connect this device"** screen — paste the code → **Connect**.

Each device gets its own token, individually revocable.

---

## 5. Manage GitHub accounts

The GitHub account is whatever your **runner's `gh`** is logged in as (the app
never logs into GitHub). In **Settings → Account → GitHub**:
- See the active account and any others you're logged into on that machine.
- **Use** — switch the runner to another logged-in account (`gh auth switch`).
- **Disconnect** — log an account out (`gh auth logout`).
- To **add** an account: run `gh auth login` on the computer; it then appears here.

---

## 6. Settings you can change

**Settings** tab:
- **Digest time** — when the morning digest is timed.
- **Autonomy** — *Auto-run* (make draft PRs automatically) or *Review each* (confirm the plan before it runs).
- **Task budget** — max **$** per task; enforced via Claude's `--max-budget-usd`, so a task can't run away.
- **Push / Quiet hours** — notification prefs.

---

## 7. Harden security (recommended before real repos)

By default the shared secret is `dev-token` (fine for trying it out, **not** for
sensitive repos — it's in this public repo). To lock it down:

1. In Render → your service → **Environment**, add `DISPATCH_SECRET` = a long random string.
2. Restart each runner with the same secret:
   ```bash
   DISPATCH_SECRET=<your-secret> DISPATCH_BACKEND=… DISPATCH_STUB=0 npm start
   ```
3. Rebuild the app once with `EXPO_PUBLIC_DISPATCH_SECRET=<your-secret>` so it enrolls — or connect new devices with a **pairing code** (§4).

After this, only devices you explicitly pair (or that carry the secret) can
connect, and each runner must still be approved.

---

## 8. The Repo Map tab

Pick a repo (Capture → *switch*), open **Map**. It shows four static-analysis
graphs (0 tokens, built once per repo, cached): **Files**, **Modules**,
**Entities** (data models), **API↔DB** (routes → the entities they touch).
Works across JS/TS, Python, Go, Java, Kotlin, and more.

---

## 9. Deploy your own backend (optional)

The backend is deployed to Render from this repo via `render.yaml` (auto-deploy
on push to `main`, `rootDir: backend`). See `../DEPLOY.md`. Note the free tier
has an **ephemeral disk** — Dispatch mirrors state to your connected runner and
restores it on reconnect, so tasks/approvals survive redeploys.

---

## Runner environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DISPATCH_BACKEND` | `localhost:4000` | Backend URL (host or full `https://…`). |
| `DISPATCH_STUB` | `1` (safe) | `0` = real mode (clone/edit/test/draft-PR). |
| `RUNNER_NAME` | hostname | Display name **and** identity — give each machine a distinct one. |
| `DISPATCH_SECRET` | `dev-token` | Shared secret; set a real one to lock things down (§7). |
| `DISPATCH_BUDGET_USD` | `3` | Default max `$` per task. |
| `DISPATCH_EDIT_MODEL` | `sonnet` | Model for the code edit (`opus` for hard tasks). |
| `DISPATCH_REVIEW_MODEL` | `sonnet` | Model for the adversarial self-review. |
| `DISPATCH_SELF_REVIEW` | `1` (on) | `0` disables the AI self-review pass (static risk signals stay). |
| `DISPATCH_CLASSIFY_MODEL` / `DISPATCH_SPEC_MODEL` | `haiku` | Cheap models for intent/spec. |
| `DISPATCH_CHAT_MODEL` | `sonnet` | Model for chat answers. |
| `DISPATCH_MAX_TURNS` | `40` | Hard ceiling on the agent loop per task. |
| `WORKSPACE` | `~/dispatch-workspace` | Where repos are cloned. |

The runner also keeps a durable state mirror and its per-device token under
`~/.dispatch/`, and per-repo indexes under `~/.dispatch/repo-index/`.

---

## 10. Push notifications (optional)

Dispatch can push a notification when a task **needs your OK**, a **PR is ready
to review**, an **answer** lands, something is **blocked**, or a PR is **merged**.
The backend side is built in; it stays dormant until you add Firebase.

To turn it on:

1. Create a Firebase project → add an Android app with package
   `com.flow6979.dispatch` → download **`google-services.json`**.
2. Get the **Cloud Messaging server key** (Firebase → Project settings → Cloud
   Messaging).
3. Set it on the backend: `DISPATCH_FCM_SERVER_KEY=<server key>` (Render → the
   backend service → Environment).
4. Drop `google-services.json` into the app and rebuild (the phone then
   registers its token via `POST /api/push/register`).

Until step 3–4 are done, notifications are silently skipped (no errors). Toggle
them per-account with **Settings → Push**.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Task stuck at "captured" | No **approved** runner online. Start the runner and Approve it in Settings. |
| "No runner connected" banner | Start the runner on your computer. |
| Repo picker shows `acme/*` stubs | The runner (which has `gh`) isn't connected yet — it supplies your real repos. |
| PR is `…/pull/999` (fake) | Runner is in **stub** mode. Restart with `DISPATCH_STUB=0`. |
| Map is empty for a repo | The runner isn't connected, or the repo has no detectable structure for that view; try the **Modules** view. |
| First request after idle is slow | Render free tier cold-starts (~30–50s); it warms up while the runner is connected. |
| Voice does nothing | Needs a device speech engine (real phones have it; emulators usually don't). Typing always works. |
