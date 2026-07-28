# Dispatch — Product Design

> Working name: **Dispatch**. You *dispatch* coding tasks to an agent from your phone — by voice or text — and it *relays* results back. Works overnight (fire-and-forget) and while driving (hands-free, conversational). Generic: any GitHub repo.

---

## 1. Vision & positioning

**One line:** *A phone-first async coding agent — talk to it while driving or queue it before bed, and wake up to reviewed-ready pull requests.*

The desktop coding-agent experience assumes you're at a keyboard watching a diff stream by. Dispatch inverts that: the moments you have ideas or bug reports (commute, walk, in bed, in a meeting) are exactly the moments you *can't* sit at a keyboard. Dispatch captures intent in those moments and does the work in the background, deferring anything that needs your eyes to when you're actually at a screen.

**What it is NOT:** it is not a mobile IDE. You never write or read code on the phone. The phone is for *intent capture* and *high-level decisions*; the laptop/desk is for *review and merge*.

**Core bet:** the coding capability is largely solved (Claude Code). The unsolved product is **the async interaction model + the trust model** — how you safely direct an agent you're not watching, and how it safely acts when you're not there.

---

## 2. Personas & jobs-to-be-done

- **The commuter engineer.** 40 min each way. Wants to turn dead time into progress: triage, small fixes, kick off bigger tasks that finish by the time they're at their desk.
- **The night owl / parent.** Has ideas after hours but no energy to code. Queues 3 tasks before bed, reviews PRs over morning coffee.
- **The on-call / firefighter.** Gets paged, away from laptop. Wants to say "there's a 500 spike on the payments service, investigate and draft a fix" and get a diagnosis + draft PR to review the moment they're back.

**Jobs:**
1. Capture a coding task the instant I think of it, hands-free if needed.
2. Have it done correctly in the background without babysitting.
3. Never let anything risky happen unattended.
4. Review and merge efficiently when I'm back at a screen.

---

## 3. The two modes

### Mode A — Overnight (fire-and-forget, async)
Text or voice, no live conversation expected. You dump tasks into a queue and walk away.

**Flow:**
1. **Capture** — "Fix the flaky login test and add retry logic to the payment webhook." (Can be several tasks in one dump; the app splits them.)
2. **Spec-back (async)** — For each task the agent posts a crisp restated spec + any assumptions it's making, as a notification. You *may* clarify, but silence = proceed with stated assumptions after a grace period (e.g. 10 min). This is the key to true fire-and-forget: it doesn't block on you.
3. **Work** — Runs in an isolated branch/worktree in the cloud. Runs tests. Opens a **draft PR**.
4. **Fork handling** — On ambiguity it makes the reasonable choice, **flags it prominently in the PR**, and keeps going. Only *destructive/irreversible* forks park the task as `needs-input`.
5. **Report** — Morning digest: "3 PRs ready ✅, 1 needs a decision ⚠️, 1 blocked ❌."

### Mode B — While driving (hands-free, conversational)
Voice-first, eyes-free, safety-first. **Nothing that requires reading a diff ever happens here.**

**Flow:**
1. **Talk** — natural voice. Agent transcribes + interprets.
2. **Confirm spec aloud** — "So: retry the payment webhook up to 3 times with backoff, only on 5xx, and add a test. Right?" → one spoken "yes." This single confirmation is the safety gate.
3. **Run in background** — you keep driving. Optional spoken status pings ("Tests passing, opening the PR now").
4. **Read-back is summary-only** — "Done. 3 files changed, tests green. Want me to hold it for your review, or is a draft PR fine?" You never approve *code* by voice — only *intent* and *coarse next-steps* (hold / draft / discard).
5. **Deferred review** — everything lands as a draft PR for desk review. The drive produces *queued work*, not merged work.

**Driving-safety rules (hard constraints):**
- No screen interaction required to complete a capture.
- No code, no diffs, no file lists read aloud beyond counts.
- Merge/deploy verbs are disabled in voice mode regardless of what you say ("merge it" → "I'll queue it for review at your desk").
- Big-motion detection optional: if moving fast, force voice-only UI.

---

## 4. System architecture

```
┌─────────────────────┐      ┌──────────────────────┐      ┌─────────────────────┐
│   Mobile client     │      │   Dispatch backend    │      │   Execution layer    │
│  (iOS / Android)    │      │   (API + orchestrator)│      │  (agent runners)     │
│                     │      │                       │      │                      │
│ • Voice capture     │─────▶│ • Auth / accounts     │─────▶│ • Claude Code        │
│ • STT + TTS         │ HTTPS│ • Task queue          │ jobs │   headless per task  │
│ • Task list / status│◀─────│ • Spec engine         │◀─────│ • Isolated worktree/ │
│ • Push notifications│ WS   │ • Autonomy/policy     │ logs │   branch per task    │
│ • Digest view       │      │ • GitHub App wiring   │      │ • Test runners       │
└─────────────────────┘      │ • Notification router │      │ • Sandboxed, no prod │
                             └──────────────────────┘      └─────────────────────┘
                                        │                            │
                                        ▼                            ▼
                                  GitHub (repos, PRs, checks)   Secrets vault
```

**Why this shape:**
- The **execution layer is Claude Code running headless** (the model already knows how to code, run tests, open PRs). You are building the *orchestrator and clients* around it, not a coding agent.
- **One isolated workspace per task** (git worktree or fresh clone) so concurrent overnight tasks never collide.
- **The backend owns the queue, policy, and state machine** — the phone is a thin client so it survives poor connectivity (capture works offline, syncs later).

### Task lifecycle (state machine)
```
CAPTURED → SPEC_DRAFTED → (SPEC_CONFIRMED | AUTO_PROCEED) → RUNNING
   → { NEEDS_INPUT ↺ } → TESTS → PR_OPEN → { AWAITING_REVIEW → MERGED | HELD | DISCARDED }
                                        ↘ BLOCKED / FAILED
```

---

## 5. Key subsystems

### 5.1 Spec engine (the most important feature)
Turns a vague spoken sentence into a crisp, confirmable spec. Output for every task:
- **Goal** (one sentence)
- **Scope** (files/areas it expects to touch — coarse)
- **Acceptance** (how it'll know it's done — usually "these tests pass")
- **Assumptions** (the forks it resolved and how)
- **Blast radius** (branch-only? touches auth/payments/infra? migrations?)

In voice mode, the Goal + key Assumptions are read aloud. In overnight mode, the whole spec is a notification you *can* correct.

### 5.2 Autonomy & guardrails (the trust model)
Per-repo and per-task-type autonomy levels, escalating trust over time:

| Level | Behaviour |
|---|---|
| **Observe** | Agent only investigates + proposes; never writes code. |
| **Draft** *(default)* | Writes code in a branch, opens **draft** PR, never merges. |
| **Auto-green** | Auto-marks PR ready (still needs human merge) if all checks pass. |
| **Auto-merge (scoped)** | Merges automatically *only* for whitelisted task types (e.g. "test fixes") on whitelisted repos, when green. |

**Always-ask triggers (override autonomy):** anything touching auth, secrets, payments, DB migrations, infra/CI config, deletions above a threshold, or dependency bumps. These *never* auto-merge and, in voice mode, are read as "this one needs your review at a screen."

Hard invariants (never configurable away):
- Work only ever happens on a branch, never directly on default.
- No production access from the execution layer.
- No merge/deploy from voice mode.

### 5.3 Voice pipeline
- **STT:** on-device where possible (privacy + latency), cloud fallback.
- **NLU:** map utterance → {new task | clarify existing task | status query | coarse command}.
- **TTS:** short, skimmable spoken summaries. Never read code/diffs.
- **Barge-in:** you can interrupt the agent's speech.
- **Wake phrase / CarPlay-Android Auto integration** so capture is one tap or fully hands-free.

### 5.4 Review & notification router
- **Push notifications** for state changes (`needs-input`, `PR ready`, `blocked`).
- **Morning digest** (configurable time): grouped, triaged, one-tap deep links to each PR.
- **Deep links** open the PR in GitHub mobile / your reviewer of choice — Dispatch doesn't reinvent code review, it routes you to it.
- Optional Slack mirror of the digest.

### 5.5 Concurrency & cost control
- Cap on concurrent runners per account; excess tasks queue.
- Per-task token/time budget with a hard ceiling; agent reports if it's about to blow the budget rather than silently churning.
- Nightly "standing orders" (cron) for recurring jobs: "every night triage new Sentry errors into draft fixes."

---

## 6. Data model (core entities)

- **User** — account, linked GitHub App installation, notification prefs, driving-mode prefs.
- **Repo** — GitHub repo ref, autonomy level, always-ask overrides, test command hints.
- **Task** — goal, source (voice/text), spec, state, autonomy applied, budget, timestamps, linked PR, transcript of any clarifications.
- **Run** — one execution attempt of a task: worktree ref, logs, test results, token/cost usage.
- **Digest** — a rolled-up report delivered at a time or on demand.

---

## 7. Tech stack (recommendation)

- **Execution:** Claude Code headless in ephemeral cloud sandboxes (container per run, no prod network egress). One git worktree per task.
- **Backend:** a small API + queue (e.g. Node/TS or Go) + a durable job queue + Postgres for state. WebSocket channel for live status in voice sessions.
- **GitHub integration:** a **GitHub App** (fine-grained, per-repo, revocable) rather than a personal token — this is the right trust primitive for "generic any repo."
- **Mobile:** native or React Native; CarPlay / Android Auto for the driving mode; on-device STT/TTS where available.
- **Secrets:** a proper vault; per-repo scoped credentials; nothing long-lived on the device.

---

## 8. Security & trust model (make-or-break)

1. **Least privilege via GitHub App** — user grants only the repos they choose; revocable anytime; no org-wide blast radius.
2. **Sandboxed execution** — each run is isolated, no production network, no cross-task access.
3. **Branch-only, draft-by-default** — nothing reaches default branch without an explicit human step.
4. **Auditability** — every task keeps the original utterance, the confirmed spec, assumptions, and full run logs. You can always answer "why did it do that?"
5. **Voice can't do damage** — the dangerous verbs simply don't exist in that mode.
6. **Budget ceilings** — no runaway overnight token burn.

---

## 9. Roadmap

**MVP (prove the loop):**
- Text + voice capture on phone → task queue.
- Claude Code headless runner, one branch per task, draft PR, runs tests.
- Async spec-back as a notification; auto-proceed after grace period.
- Morning digest + push notifications.
- Autonomy = Draft only. GitHub App auth.
- *Goal: "queue 3 tasks at night, wake to 3 draft PRs" works reliably.*

**v1 (make it trustworthy + hands-free):**
- Full driving mode: CarPlay/Android Auto, spoken spec-confirm, summary read-back, dangerous-verb lockout.
- Autonomy levels + always-ask triggers.
- `needs-input` parking + resume.
- Cost/budget controls.

**v2 (make it a teammate):**
- Concurrent multi-task across repos.
- Standing orders / cron ("nightly Sentry triage").
- Trust-curve automation (auto-merge scoped task types).
- Integrations: Jira/Linear ("fix TICKET-123"), Sentry (auto-repro from error), Slack.

---

## 10. Open questions / risks

- **Ambiguity resolution quality** — the whole fire-and-forget promise rests on the agent making *good* default calls and flagging them well. Needs heavy iteration on the spec engine.
- **Trust adoption** — will people actually let an agent open PRs unattended? Start Draft-only; earn auto-merge.
- **Cost per task** — overnight batches of long agent runs can be expensive; budgets + transparency are essential.
- **Voice accuracy on technical terms** — code identifiers, service names. Mitigate with per-repo vocabulary priming from the codebase.
- **Connectivity** — capture must work offline (tunnels, dead zones) and sync later.
- **"Fix bugs" is unbounded** — need to nudge vague asks toward a bounded spec, or scope them to "investigate + propose" (Observe level) rather than blind fixing.

---

## 11. What makes it defensible / differentiated

- **Async-native + safety-native**, not a mobile IDE bolted onto an agent. The interaction and trust models *are* the product.
- **The deferred-review split** (capture anywhere, review at a screen) is the honest answer to "code while driving" — and most competitors will get this wrong by trying to show diffs on a phone.
- **Standing orders** turn it from a tool you invoke into a teammate that shows up with work already started.
