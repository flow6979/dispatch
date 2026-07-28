# Dispatch — Laptop Runner

The runner is the laptop-side daemon for **Dispatch**, an async coding-agent
orchestrator. It connects to the backend over WebSocket, registers itself, and
handles two backend requests:

- `generate_spec` → replies with a `spec_result`
- `run_task` → streams `progress` messages and ends with a terminal `result`

It implements the RUNNER side of [`../PROTOCOL.md`](../PROTOCOL.md) exactly.

## Requirements

- Node.js 18+ (developed on v22).
- Pure-JS deps only: [`ws`](https://www.npmjs.com/package/ws),
  [`nanoid`](https://www.npmjs.com/package/nanoid).
- For **REAL mode** only: `git`, `gh` (GitHub CLI, authenticated), and the
  `claude` CLI must be on `PATH`. STUB mode needs none of these.

## Install

```bash
cd dispatch/runner
npm install
```

## Run

```bash
npm start          # = node runner.js  → connects to the backend
```

On start it connects to
`ws://localhost:4000/ws?role=runner&token=dev-token`, sends a `register`
message, and then services `generate_spec` / `run_task` requests. If the socket
drops it auto-reconnects with exponential backoff (1s → 2s → … capped at 30s).

### Self-test (no backend needed)

The backend may not exist yet, so the runner ships a standalone self-test that
exercises the stub `generate_spec` + `run_task` logic locally, prints every
emitted message, and asserts protocol conformance:

```bash
node runner.js --selftest        # or: npm run selftest
```

Exit code `0` = pass, `1` = fail. It never opens a websocket and never touches
git/gh/claude.

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `DISPATCH_BACKEND` | `localhost:4000` | Backend host:port for the WS URL. |
| `DISPATCH_STUB` | *(unset → stub ON)* | `1` or unset = **STUB mode** (default). `0` = **REAL mode**. |
| `RUNNER_NAME` | `os.hostname()` | Name sent in the `register` message. |
| `WORKSPACE` | `~/dispatch-workspace` | Where repos are cloned / worktrees created (REAL mode). |
| `DISPATCH_WALL_MS` | `1200000` (20 min) | Wall-clock budget for a REAL task. |

## STUB vs REAL mode

### STUB mode (default — the safe test path)

Active when `DISPATCH_STUB` is unset or `=1`. **Never touches git, gh, or
claude.** For `run_task` it emits progress over ~4 seconds:

1. `progress` RUNNING pct 20
2. `progress` RUNNING pct 50
3. `progress` TESTS pct 80
4. terminal `result` PR_OPEN with a fake `prUrl`
   (`https://github.com/<repo>/pull/999`) and a confidence-first summary.

`generate_spec` in stub mode returns a deterministic heuristic spec derived
from `promptText` (goal = promptText, scope `["(to be determined)"]`,
acceptance `["existing tests pass"]`, one reversible assumption, risk `low`,
confidence `0.6`).

### REAL mode (`DISPATCH_STUB=0`)

Performs the real workflow, always ending in a terminal `result`:

1. Ensure the repo is cloned under `WORKSPACE` (`gh repo clone`, else `git clone`).
2. `git worktree add` the `workBranch` off `baseBranch`. **Refuses** (state
   `BLOCKED`) if `workBranch` is a protected/default branch (main, master,
   develop, …) or equals `baseBranch` / the repo's actual default branch.
3. Run `claude -p "<promptText + spec goal>"` inside the worktree; stream progress.
4. Detect and run the test command: `package.json`→`npm test`,
   `Gemfile`→`bundle exec rspec`, pytest markers→`pytest`.
5. `git add -A && git commit && git push -u origin <workBranch>`.
6. `gh pr create --draft --fill` — **draft PRs only, never merges**.
7. Terminal `result` with the real `prUrl` and a confidence-first summary.

`generate_spec` in real mode calls `claude -p` asking for JSON only, parses it,
normalizes it to the protocol shape, and **falls back to the heuristic spec if
claude fails or returns unparseable output.**

A wall-clock budget (`DISPATCH_WALL_MS`) and the task's `budgetTokens` are
enforced. On any failure the runner sends a terminal `FAILED`/`BLOCKED` result
with the error message — it never ends silently.

## WebSocket message reference (implemented)

**Runner → Backend**

- `{type:"register", runnerName, capabilities:["git","gh","claude"]}`
- `{type:"spec_result", taskId, spec}`
- `{type:"progress", taskId, state, message, pct}`
- `{type:"result", taskId, state, prUrl, summary}` — terminal (`PR_OPEN` |
  `FAILED` | `BLOCKED` | `NEEDS_INPUT`)

**Backend → Runner (handled)**

- `{type:"generate_spec", taskId, promptText, repo, baseBranch, workBranch}`
- `{type:"run_task", taskId, promptText, spec, repo, baseBranch, workBranch, budgetTokens}`
