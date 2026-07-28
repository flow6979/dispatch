# Dispatch — MVP Build Plan

Companion to `dispatch-master-spec.md`. This turns the **[MVP]** feature set into a concrete, sequenced build — riskiest integration first, a walking skeleton before features.

---

## 1. MVP definition (the one sentence it must earn)

> **"From my phone, I capture a coding task; my laptop builds it in a branch, runs the tests, and opens a draft PR; I get a notification and a skimmable summary."**

If that loop is reliable, everything else is additive. Voice, the full lifecycle pipeline, autonomy — all come after this spine works.

### MVP success criteria (done = all true)
1. Authenticate GitHub; see and pick a repo by search; pick or create a branch.
2. Send a task (text first, then voice) from the phone.
3. Laptop runner executes it under Claude Code in an isolated worktree on the chosen branch.
4. Tests run locally; a **draft PR** opens on GitHub.
5. Phone gets a push notification + a confidence-first summary; deep-links to the PR.
6. Nothing lands on default/protected; task never ends silently; per-task budget ceiling enforced.

### Explicitly OUT of MVP
Full driving mode, CarPlay, autonomy ladder beyond Draft, the 6-stage gated pipeline, standing orders, multi-repo concurrency, cloud fallback, team features.

---

## 2. Components & recommended stack

| Component | Responsibility | Recommended stack |
|---|---|---|
| **Laptop Runner** (daemon) | Execute tasks locally under Claude Code; git worktree; run build/test; push branch + open draft PR | **Node/TypeScript + Claude Agent SDK**; menubar via a thin wrapper (or plain CLI first); `simple-git`; `gh` CLI for PRs |
| **Backend** | Auth, task queue, WS relay (phone↔runner), task state machine, audit, push fan-out | **Node/TS (Fastify) + Postgres + a WS layer**; a durable queue (start with a Postgres-backed queue) |
| **Phone client** | Capture (text→voice), task board, notifications, PR deep-links | **Expo / React Native**; device STT/TTS; Expo push notifications |
| **GitHub integration** | Repo list, branch ops, PR creation | MVP: runner uses local `gh`/git creds. v1: **GitHub App** for least-privilege + audit |

**Why these:** the Agent SDK lets the daemon reuse the exact Claude Code capability headlessly; Expo gets a cross-platform app with voice + push fastest; Postgres-backed everything keeps infra minimal until scale demands more.

---

## 3. Sequencing principle: riskiest integration first

The scary part isn't the UI or the coding agent — both are known. It's **"phone → backend → my laptop executes → result comes back"** across networks, reconnects, and a sleeping laptop. Build that thread *first*, end to end, with everything else stubbed.

---

## 4. Phased milestones

### Phase 0 — Walking skeleton *(prove the pipe)*
Goal: one hardcoded task travels the full path and comes back.
- [ ] Backend: minimal Fastify server + Postgres; `Task` table; two WS endpoints (`/phone`, `/runner`) that relay messages.
- [ ] Runner: Node daemon connects to `/runner`, authenticates with a static token, prints received tasks, sends back a canned "done."
- [ ] Phone (or a curl/Postman stand-in first): send `{prompt}` to `/phone`, see status update.
- [ ] Prove: message from phone reaches the laptop and a reply returns. Reconnect survives a WS drop.
**Exit:** round-trip works; no real coding yet.

### Phase 1 — Runner actually codes *(one repo, hardcoded)*
- [ ] Runner: on task, ensure a local clone of ONE hardcoded repo; create a worktree on a new branch.
- [ ] Runner: invoke Claude Code (Agent SDK) headless with the prompt in that worktree; stream progress lines back over WS.
- [ ] Runner: run the repo's test command; capture pass/fail.
- [ ] Runner: commit, push branch, open a **draft PR** via `gh`; return the PR URL.
- [ ] Backend: drive the task state machine (RUNNING → TESTS → PR_OPEN / FAILED); persist logs.
**Exit:** a typed prompt from Phase 0 produces a real draft PR with tests run. **This is the heart of the product.**

### Phase 2 — Repo & branch navigation
- [ ] GitHub auth (MVP: `gh` on the runner reports available repos; cache in backend). List repos to the phone.
- [ ] Phone: **match-first repo picker** — search box + Pinned/Recent/All.
- [ ] Branch: list/select existing; **create with intent-generated name** + confirm; **protected/default → force working branch**.
- [ ] Backend: persist **Working Context**; snapshot it onto each task.
- [ ] Runner: cold-start onboarding — auto-detect build/test commands for a new repo.
**Exit:** pick any granted repo + branch from the phone, then task against it.

### Phase 3 — Spec-back + real task UX
- [ ] Backend/agent: **spec-back** — restate Goal/Scope/Acceptance/Assumptions before running; **auto-proceed** after a grace period.
- [ ] Phone: **task board** (queued / running / needs-input / ready / blocked) with live status.
- [ ] Runner: enforce **per-task budget ceiling**; **never fail silently** (always return a state + logs; fall back to propose-a-plan if stuck).
- [ ] PR: generate the **confidence-first skimmable summary** (what changed, why, risk, "check this first").
**Exit:** vague asks get confirmed; you always get *something* back, clearly.

### Phase 4 — Voice + notifications + digest
- [ ] Phone: **voice capture** (device STT) → task; spoken **spec-back read-back** + one-word confirm (TTS).
- [ ] Phone: **offline capture** — queue locally, sync when connected.
- [ ] Backend: **push notifications** on state changes; **triaged morning digest** at a chosen time.
- [ ] Runner: **keep-awake** while a task runs (`caffeinate` on macOS).
**Exit:** the full MVP sentence works, voice-first, unattended overnight to a draft PR.

---

## 5. Laptop Runner — design detail

```
daemon start
  → load config { backendUrl, runnerName, workspaceDir, allowedRepos }
  → authenticate, open WS to backend/runner, register capabilities
  → on TASK:
       ensure repo cloned under workspaceDir
       git worktree add <workspaceDir>/<task-id> <baseBranch>
       create/checkout workBranch
       run Claude Code (Agent SDK) with prompt, streaming events → backend
       run detected test command; capture result
       if green (or per policy): git push; gh pr create --draft
       return { state, prUrl, summary, logsRef, cost }
       git worktree remove (cleanup)
  → on DISCONNECT: buffer + reconnect with backoff; resume in-flight from checkpoint
```
**Guardrails in the daemon:** refuse work on default/protected (force a branch); confine all FS ops to `workspaceDir`; secret-scan the diff before push; enforce token/time budget; no destructive git without confirm.

---

## 6. Backend — design detail

- **Auth:** device-paired tokens for phone and runner (both belong to one User).
- **State:** `Task` state machine as the spine; every transition persisted with a timestamp + reason (audit).
- **Relay:** route phone↔runner messages by User; hold tasks durably so a sleeping runner drains the queue on reconnect.
- **Queue:** Postgres-backed (`status`, `claimed_by`, `visible_at`) — no extra infra for MVP.
- **Notifications:** on terminal/needs-input transitions, fan out push + compose digest.

---

## 7. Phone client — design detail

- **Capture screen:** big record button (voice) + text field; works offline.
- **Context bar:** current repo + branch, one tap to switch.
- **Task board:** live statuses via WS; tap a task → summary + PR deep-link.
- **Digest view:** grouped, risk-flagged, "review this first."
- **Settings:** paired runner(s), notification prefs, budget default.

---

## 8. Open technical decisions (resolve before/at Phase 2)

1. **PR creation path:** runner-`gh` (MVP, least infra) → GitHub App (v1, least-privilege + audit). *Recommend start with `gh`.*
2. **Runner auth to backend:** static paired token (MVP) → short-lived rotated tokens (v1).
3. **Backend hosting:** a small managed host is fine for MVP; the runner only needs an outbound WS, so no inbound firewall changes on the laptop.
4. **How many runners:** MVP assumes one laptop; design the `Runner` entity now so multi-machine is additive.

---

## 9. First three concrete steps

1. **Stand up Phase 0** — Fastify + Postgres + two WS endpoints; a Node runner that echoes; prove the round-trip with a curl stand-in for the phone.
2. **Phase 1 runner spike** — wire the Claude Agent SDK into the daemon against one hardcoded repo; get a real draft PR out the door from a hardcoded prompt.
3. **Only then** add the Expo phone client and the repo/branch picker (Phase 2).

> Rule of thumb: don't build the phone UI until a `curl` can already produce a draft PR on your laptop. The UI is the easy, last mile.
