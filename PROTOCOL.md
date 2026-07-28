# Dispatch — Integration Contract (v0, MVP)

This is the binding contract between the three components. Backend, Runner, and App are built independently against THIS document. Do not deviate — matching this exactly is what makes integration work.

## Topology
```
App (Expo/web) ──REST + WS──▶ Backend (:4000) ◀──WS── Runner (laptop daemon)
```
- Backend runs on **http://localhost:4000**. WS on **ws://localhost:4000/ws**.
- SQLite DB file at `backend/dispatch.db`.
- Single-user MVP. Auth = static token `dev-token` passed as `?token=dev-token` (WS) or `Authorization: Bearer dev-token` (REST). Do not block if token missing in dev.

## Task states (string enum)
`CAPTURED → SPEC_DRAFTED → SPEC_CONFIRMED → RUNNING → TESTS → PR_OPEN → AWAITING_REVIEW`
Side states: `NEEDS_INPUT`, `BLOCKED`, `FAILED`, `HELD`, `MERGED`, `DISCARDED`.

## Task object (JSON) — canonical shape everywhere
```json
{
  "id": "t_abc123",
  "promptText": "Add retry logic to the webhook",
  "repo": "acme/payment-service",
  "baseBranch": "main",
  "workBranch": "fix/webhook-retry",
  "state": "RUNNING",
  "spec": {
    "goal": "…", "scope": ["…"], "acceptance": ["…"],
    "assumptions": [{"statement":"…","reversible":true}],
    "risk": "low", "confidence": 0.7
  },
  "summary": "confidence-first summary text or null",
  "prUrl": "https://github.com/... or null",
  "progress": [{"ts": 0, "state":"RUNNING", "message":"editing handler", "pct": 40}],
  "budgetTokens": 250000,
  "createdAt": 0, "updatedAt": 0
}
```

## REST API (Backend serves these)
| Method | Path | Body → Returns |
|---|---|---|
| GET | `/api/health` | `{ok:true, runners:<count>}` |
| GET | `/api/repos` | `{repos:[{name,defaultBranch,pinned,recent}]}` (from `gh repo list`, cached; fall back to a stub list if `gh` fails) |
| GET | `/api/context` | `{repo,baseBranch,workBranch}` (active WorkingContext, may be null fields) |
| POST | `/api/context` | body `{repo,baseBranch,workBranch}` → same |
| GET | `/api/tasks` | `{tasks:[Task]}` newest first |
| POST | `/api/tasks` | body `{promptText,repo,baseBranch,workBranch}` → `{task:Task}` (state CAPTURED, then backend requests spec from runner) |
| GET | `/api/tasks/:id` | `{task:Task}` |
| POST | `/api/tasks/:id/confirm` | body `{approved:true}` → advances SPEC_DRAFTED→SPEC_CONFIRMED and tells runner to proceed |
| POST | `/api/tasks/:id/hold` | → state HELD |

## WebSocket messages (JSON, field `type`)
Connect: `ws://localhost:4000/ws?role=phone|runner&token=dev-token`

### Runner → Backend
- `{type:"register", runnerName, capabilities:["git","gh","claude"]}`
- `{type:"spec_result", taskId, spec}` (after generating spec)
- `{type:"progress", taskId, state, message, pct}`
- `{type:"result", taskId, state, prUrl, summary}` (terminal: PR_OPEN | FAILED | BLOCKED | NEEDS_INPUT)

### Backend → Runner
- `{type:"generate_spec", taskId, promptText, repo, baseBranch, workBranch}`
- `{type:"run_task", taskId, promptText, spec, repo, baseBranch, workBranch, budgetTokens}`

### Backend → Phone (broadcast)
- `{type:"tasks_update", tasks:[Task]}` (send on every state change)
- `{type:"runner_status", connected:<bool>, runnerName}`

### Phone → Backend
- Phone may use REST only; WS is for receiving `tasks_update`. Phone does not need to send WS messages in v0.

## Runner behaviour
On `generate_spec`: produce a `spec` (see shape). Use `claude -p` headless if available, else a deterministic heuristic spec. Reply `spec_result`. Backend auto-proceeds after 3s if no phone confirm (MVP auto-proceed), OR immediately on `/confirm`.

On `run_task`:
1. Ensure repo cloned under `WORKSPACE` (default `~/dispatch-workspace`), `git worktree` on `workBranch` off `baseBranch`.
2. Refuse to work on a protected/default branch — must be a non-default branch.
3. Run `claude -p "<promptText + spec>"` inside the worktree to make changes. Stream `progress`.
4. Run detected test command (npm test / rspec / pytest) if present; capture result.
5. `git add/commit/push`; `gh pr create --draft`; return `result` with `prUrl` + a confidence-first `summary`.
6. **STUB MODE** (`DISPATCH_STUB=1`, the default for tests): skip git/claude/gh; simulate progress over ~4s and return a fake prUrl + summary. This is how we test safely without touching real repos.
7. Enforce budget + never end silently (always send a terminal `result`).

## Ports & scripts (all components)
- Each dir has its own `package.json` with `"start"` and (backend/runner) `"dev"`.
- Backend: `npm start` → listens :4000.
- Runner: `npm start` → connects to `ws://localhost:4000/ws?role=runner&token=dev-token`. Honors env `DISPATCH_BACKEND`, `DISPATCH_STUB`, `WORKSPACE`, `RUNNER_NAME`.
- App: `npx expo start --web` → talks to `http://localhost:4000`. Base URL from env/const `API_BASE` default `http://localhost:4000`.

## Non-negotiables
- Never fail silently: every task reaches a terminal state with a message.
- Draft PRs only; never merge.
- Stub mode must be the default when `DISPATCH_STUB` unset OR set to `1`.
