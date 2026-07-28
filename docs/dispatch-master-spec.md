# Dispatch — Master Spec

> **One line:** A phone-first, voice-driven pilot for the whole idea→release lifecycle. Talk to it while driving or queue work before bed; it runs on *your laptop* (real local env + tests) and ships pull requests to GitHub.
>
> This document is the single source of truth. It supersedes and reconciles: `dispatch-product-design.md`, `dispatch-painpoints-features.md`, `dispatch-repo-branch-flow.md`, `dispatch-lifecycle-pipeline.md`. Where those disagree (notably cloud vs laptop execution), **this wins: execution is laptop-first, cloud-optional.**

---

## 1. Vision & positioning

The desktop coding-agent experience assumes you're at a keyboard watching a diff. Dispatch inverts that: the moments you have ideas or bug reports (commute, walk, in bed, on call) are exactly when you *can't* sit at a keyboard. Dispatch captures intent then, does the work in the background on your own machine, and defers anything that needs your eyes to when you're at a screen.

- **Phone = voice/text remote** (intent capture + coarse decisions). Never a mobile IDE.
- **Laptop = execution engine** (real toolchain, local DB, secrets, can run the actual app + tests).
- **GitHub = release target** (branches, draft PRs, releases).

**Core bet:** the *coding* is largely solved (Claude Code). The unsolved product is the **async interaction model**, the **trust model**, and the **voice-driven lifecycle** on top of a proven pipeline.

**Not:** a mobile IDE. You never read or write code on the phone.

---

## 2. Core concepts

### Working Context
`{ repo, baseBranch, workBranch }`. Once set, plain prompts become tasks against it. Every task snapshots its context, so queued/overnight work across multiple repos stays correctly scoped. `"What am I working on?"` reads it back.

### The gated pipeline
Work flows through stages, each producing an **artifact** and ending at a **gate** (approve / iterate / choose). Interactive mode discusses every gate; fire-and-forget auto-advances with defaults + flags.

### Autonomy ladder
Per-repo, per-task-type trust that escalates with track record:
`Observe → Draft (default) → Auto-green → scoped Auto-merge`.
**Always-ask triggers** override it: auth, secrets, payments, DB migrations, infra/CI, large deletions, dependency bumps.

### Voice-reviewability gradient
Prose artifacts (brief, approach, design) are ideal for voice — hear and debate on a drive. Code and logs are not — they gate at a screen. The pipeline is most hands-free at the top, most screen-bound at the bottom.

---

## 3. Architecture (reconciled — laptop-first)

```
┌────────────┐        ┌──────────────────┐        ┌──────────────────────────┐
│   Phone    │        │ Dispatch backend │        │  Laptop Runner (daemon)    │
│ voice/text │◀──WS──▶│ auth · queue ·   │◀──WS──▶│  • Claude Code (headless)  │
│ remote     │        │ policy · relay · │        │  • git worktree/branch     │
│ task board │        │ state machine    │        │  • local build/test/run    │
│ digest     │        │ GitHub App       │        │  • local secrets/env       │
└────────────┘        └──────────────────┘        └────────────┬───────────────┘
                               │                                ▼
                               └───────────────────────▶  GitHub (PRs / releases)
```

- **Phone never talks to the laptop directly.** Both hold persistent WebSocket connections to the backend, which relays. So you can queue tasks while the laptop sleeps; it drains the queue on wake.
- **Laptop Runner** is a menubar/CLI daemon that registers as your runner and executes tasks locally under Claude Code — real environment, higher-fidelity testing, no sandbox cost.
- **Backend** owns durable state (queue, task state machine, policy, audit), auth, and GitHub App wiring. Thin enough that the phone survives poor connectivity (capture works offline, syncs later).
- **Cloud runner** is an optional fallback for when the laptop is off (same interface, lower fidelity). Local-first, cloud-optional.

### Task lifecycle (state machine)
```
CAPTURED → SPEC_DRAFTED → (SPEC_CONFIRMED | AUTO_PROCEED) → RUNNING
   → { NEEDS_INPUT ↺ } → TESTS → PR_OPEN → { AWAITING_REVIEW → MERGED | HELD | DISCARDED }
                                        ↘ BLOCKED / FAILED (never silent)
```

### Laptop-runner consequences & handling
| Consequence | Handling |
|---|---|
| Laptop must be awake/connected to run | Keep-awake while a task runs (plugged-in for overnight); "leave it running" mode; queue-and-wait if off |
| Weaker isolation than a sandbox | Scope to a workspace dir; branch-only; confirm destructive; no force-push to protected; secret-scan before push |
| Multiple machines | Runner selection by name/voice ("run on the desktop"); default last-used |
| Crash mid-task | Checkpointed; resume on reconnect; report if it can't |

---

## 4. The lifecycle pipeline

```
① BRIEF → ② APPROACH → ③ ARTIFACTS → ④ IMPLEMENT → ⑤ TEST → ⑥ RELEASE
```

| Stage | Produces | Gate discussion | Hands-free |
|---|---|---|---|
| **① Brief** | problem, users, goals, scope, non-goals, success | refine aloud → approve | ✅ |
| **② Approach** | 2–3 options + trade-offs + recommendation | hear options → pick / blend | ✅ |
| **③ Artifacts** | tech spec, architecture, data model, API contract, UI notes (+ mandatory edge-case pass) | walk through → finalize | ✅ mostly |
| **④ Implement** | code on a branch, on the laptop, checkpointed | progress by voice; **diff review on screen** | ⚠️ partial |
| **⑤ Test** | local test results + app-run evidence | "12 pass, 2 fail — fix?"; logs on screen | ⚠️ mixed |
| **⑥ Release** | draft PR (default) / ready PR / release | **explicit confirm, never by voice** | ✅ confirm only |

Every artifact is versioned and stored in-repo (`docs/`), and the release PR links brief + spec + test evidence.

---

## 5. Interaction modes

- **Interactive (live voice/text):** walk stage-by-stage, discuss each gate. Best at a desk or on a call.
- **Fire-and-forget (overnight):** gates auto-advance on recommended defaults + flags; the whole pipeline can reach a draft PR unattended; sensitive forks park as `NEEDS_INPUT`; you get a morning digest.
- **Driving (hands-free):** top stages fully discussable by voice; bottom stages run + report summaries; **merge/deploy verbs disabled**; everything defers to a draft PR for desk review.

Driving-safety hard rules: no screen needed to capture; no diffs/file lists read aloud (counts/summaries only); dangerous verbs locked out; barge-in + resumable sessions.

---

## 6. Repo & branch navigation (voice/text)

- **Auth:** GitHub App (per-repo, fine-grained, revocable). On connect, backend caches granted repos (name, org, default branch, protected rules) → works offline.
- **Repo pick (match-first, never read-all):** fuzzy match + confirm; Pinned / Recent / learned nicknames ("the API repo"); disambiguate on multiple matches.
- **Branch:** select existing by match; **create with intent-generated names** ("the login retry fix" → `fix/login-retry`, one-word confirm — you never dictate kebab-case); **protected/default branch → forced to a working branch**; collision → switch-or-rename.
- **Then work:** prompts become tasks in the active context; "switch to the api repo, branch develop" resets it.

---

## 7. Trust & safety model

Hard invariants (never configurable away):
1. Work only on a branch, never directly on default/protected.
2. No production access from the runner.
3. No merge/deploy from voice mode.
4. Per-task token/time budget with a hard ceiling.
5. Never fail silently — every task ends in a reported state with logs.

Layered controls: GitHub App least-privilege · workspace-dir scoping · secret scanning before push · autonomy ladder + always-ask triggers · mandatory tests + self-review before "done" · full audit trail (utterance → spec → assumptions → logs → diff) · track-record-based autonomy unlock.

---

## 8. Feature catalog (by priority)

**[MVP] — the core loop must work end to end**
- Laptop Runner daemon (Claude Code headless, worktree per task, local build/test)
- Minimal phone client (voice + text capture, task board, push notifications)
- Backend (GitHub App auth, queue, WS relay, task state machine, audit)
- Match-first repo picker (pinned/recent/nickname) + intent-to-branch-name + protected-branch guardrail + Working Context
- Spec-back + assumptions + auto-proceed after grace period
- Draft PR + skimmable confidence-first summary + triaged morning digest
- Offline capture; never-fail-silently; per-task budget ceiling
- Cold-start repo onboarding (auto-detect build/test commands)

**[v1] — trust + hands-free + lifecycle**
- Full driving mode (CarPlay/Android Auto, spoken spec-confirm, verb lockout)
- Autonomy ladder + always-ask triggers; escalation notifications; quiet hours
- Gated pipeline with voice gate-discussions (brief/approach/design)
- `NEEDS_INPUT` park+resume; checkpointed resume; feasibility + cost pre-check; live cost
- Reply-to-iterate on a PR; verification evidence (tests/screenshots) in PR
- Learned repo nicknames; per-repo vocabulary priming

**[v2] — teammate-grade**
- Standing orders / cron ("nightly Sentry triage → draft fixes")
- Concurrent multi-repo runners; task dependencies; fan-out sub-agents
- Scoped auto-merge on track record; approach judge-panel
- Jira/Linear/Sentry/Slack integrations; org-level autonomy policies
- One-tap revert + post-mortem; cloud-fallback runner

---

## 9. Data model (core entities)

- **User** — account, GitHub App installation, notification + driving prefs, runners.
- **Runner** — a registered machine (name, status, workspace dir, allowed repos, capabilities).
- **Repo** — GitHub ref, default/protected branches, autonomy level, always-ask overrides, build/test hints, nicknames.
- **Task** — goal, source (voice/text), spec, assumptions, WorkingContext snapshot, state, autonomy applied, budget, linked PR, clarification transcript.
- **Run** — one execution attempt: runner, worktree ref, logs, test results, token/cost usage, checkpoints.
- **Digest** — rolled-up report delivered on a schedule or on demand.

---

## 10. Roadmap

- **MVP:** "queue a task from my phone → my laptop builds it → I wake to a draft PR" works reliably, text-first with basic voice, Draft autonomy only.
- **v1:** trustworthy + fully hands-free + the gated lifecycle.
- **v2:** an always-on teammate across repos with standing orders and earned autonomy.

---

## 11. Open decisions & risks

**Decisions to make**
- PR creation: by the **runner via `gh`/local git creds** vs the **backend via GitHub App**. (Recommend: runner via `gh` for MVP — least new infra; move to GitHub App for v1 audit/least-privilege.)
- Phone: **Expo/React Native** (fastest cross-platform) vs native. (Recommend Expo for MVP.)
- Backend hosting + how the phone/runner authenticate to it.

**Top risks**
- **Ambiguity-resolution quality** — the fire-and-forget promise rests on good default decisions + good flagging. Heaviest iteration goes into the spec engine.
- **Laptop availability** — overnight needs the machine awake; set expectations, add cloud fallback later.
- **Cost per task** — long agent runs add up; budgets + transparency are essential.
- **Trust adoption** — start Draft-only; earn auto-merge.
- **Voice accuracy on technical terms** — mitigate with per-repo vocabulary priming.
- **Runner security** — it's your real machine; workspace scoping + branch-only + secret scanning are non-negotiable.
