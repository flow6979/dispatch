# Dispatch Backend

Async coding-agent orchestrator backend (v0 MVP). Implements the binding
contract in [`../PROTOCOL.md`](../PROTOCOL.md).

- REST + WebSocket server on **http://0.0.0.0:4000** (WS at `ws://localhost:4000/ws`).
- Pure-JS dependencies only: `fastify`, `@fastify/websocket`, `@fastify/cors`, `nanoid`.
- Persistence: a plain JSON file `data.json` (read on boot, written on every change). No SQLite / native modules.
- CORS is open for the web app.

## Run

```bash
npm install
npm start          # -> node server.js, listens on 0.0.0.0:4000
```

State persists to `dispatch/backend/data.json` (auto-created on first write).

## REST endpoints

| Method | Path | Body → Returns |
|---|---|---|
| GET  | `/api/health` | `{ok:true, runners:<count>}` |
| GET  | `/api/repos` | `{repos:[{name,defaultBranch,pinned,recent}]}` — from `gh repo list --limit 50`, cached in memory; falls back to a stub list of 4 repos if `gh` fails |
| GET  | `/api/context` | `{repo,baseBranch,workBranch}` (active WorkingContext; fields may be null) |
| POST | `/api/context` | body `{repo,baseBranch,workBranch}` → same |
| GET  | `/api/tasks` | `{tasks:[Task]}` newest first |
| POST | `/api/tasks` | body `{promptText,repo,baseBranch,workBranch}` → `{task:Task}` (state `CAPTURED`, then backend requests spec from the runner) |
| GET  | `/api/tasks/:id` | `{task:Task}` (404 if unknown) |
| POST | `/api/tasks/:id/confirm` | body `{approved:true}` → advances `SPEC_DRAFTED`→`SPEC_CONFIRMED`, tells runner to proceed |
| POST | `/api/tasks/:id/hold` | → state `HELD` |

## WebSocket (`/ws`)

Connect with `?role=phone|runner&token=dev-token`.

**Runner → Backend:** `register`, `spec_result`, `progress`, `result`
**Backend → Runner:** `generate_spec`, `run_task`
**Backend → Phone (broadcast):** `tasks_update` (on every task change), `runner_status` (on runner connect/disconnect). A fresh `tasks_update` + `runner_status` is also pushed to each phone on connect.

## State machine

```
CAPTURED → SPEC_DRAFTED → SPEC_CONFIRMED → RUNNING → TESTS → PR_OPEN → AWAITING_REVIEW
side: NEEDS_INPUT, BLOCKED, FAILED, HELD, MERGED, DISCARDED
```

1. `POST /api/tasks` creates a task (`CAPTURED`) and sends `generate_spec` to the connected runner.
2. Runner replies `spec_result` → spec stored, state `SPEC_DRAFTED`, `tasks_update` broadcast.
3. **Auto-proceed:** 3s after `SPEC_DRAFTED`, if still not confirmed/held, state → `SPEC_CONFIRMED` and `run_task` is sent. `POST /:id/confirm` does this immediately; `POST /:id/hold` cancels it (state `HELD`).
4. Runner `progress` updates `task.progress` + `state`; `result` sets the terminal state, `prUrl`, and `summary`. Every change broadcasts `tasks_update`.

## Notes / deviations from PROTOCOL.md

- **Persistence:** the protocol mentions a SQLite file `backend/dispatch.db`; per the build spec this backend uses a JSON file (`data.json`) with pure-JS deps only — no native modules. The Task shape, states, endpoints, WS message types, and port are unchanged.
- Auth token (`dev-token`) is accepted but not enforced (dev single-user MVP, as allowed by the contract).
- The server never crashes on a bad WS message or unexpected error — it logs and continues.
