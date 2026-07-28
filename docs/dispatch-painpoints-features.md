# Dispatch — Pain Points → Features

Every feature below is anchored to a real user pain. Grouped by lifecycle stage and cross-cutting concern. Priority tags: **[MVP]** core loop, **[v1]** trust/hands-free, **[v2]** teammate-grade.

---

## 1. Capture — "the idea strikes at a bad moment"

| Pain | Features |
|---|---|
| Friction to open the app loses the thought | Lock-screen / home widget, one-tap record **[MVP]**; system-wide share sheet ("Send to Dispatch" from any app — Sentry, email, browser, Slack) **[v1]**; wake-word / Apple Watch / CarPlay capture **[v1]** |
| Can't type — hands or eyes are busy | Voice capture as first-class input **[MVP]**; works from headphones with no screen **[v1]** |
| Idea is half-formed / rambling | Accepts stream-of-consciousness and structures it into a spec **[MVP]**; asks 1–2 clarifying follow-ups only if truly blocking **[MVP]** |
| Multiple tasks in one breath | Auto-splits a dump into separate tracked tasks **[MVP]** |
| "Fix *this*" — referring to something on screen | Attach screenshot/log → OCR + parse **[v1]**; import from a pasted stack trace or Sentry link **[v1]** |
| Loses ideas in dead zones | Offline capture, queues locally, syncs when back online — capture *never* fails **[MVP]** |
| Noisy car ruins transcription | Noise-robust STT + spoken read-back to confirm before committing **[v1]** |

---

## 2. Specification — "vague ask → wrong result"

| Pain | Features |
|---|---|
| Agent guesses wrong on ambiguous asks | **Spec-back**: restated Goal / Scope / Acceptance / Assumptions before running **[MVP]**; confidence score ("70% sure you mean X") **[v1]** |
| It needs a decision but I'm asleep/driving | Async question with a **sensible default + grace-period auto-proceed** **[MVP]**; batches multiple questions into one prompt **[v1]** |
| Task turns out bigger than I thought | Scope-boundary declaration up front; mid-run "this is larger than expected — continue, or stop at a checkpoint?" **[v1]** |
| "Fix bugs" is unbounded and dangerous | Auto-downgrades vague/broad asks to **Observe mode** (investigate + propose, don't blind-fix) **[v1]** |
| I don't remember what I even asked | Every task stores original utterance + confirmed spec + assumptions, always viewable **[MVP]** |

---

## 3. Execution — "it works unwatched and I have no idea what's happening"

| Pain | Features |
|---|---|
| Agent goes down a wrong path for an hour | Checkpoints + early-signal reporting ("here's my plan, starting now") **[MVP]**; self-check before finalizing **[v1]** |
| No visibility into a long run | Live progress stream in-app; milestone pings ("tests passing", "opening PR") **[MVP]** |
| Blocked on missing env/secret/access | Detects, **parks the task**, and tells you *exactly* what it needs to proceed **[v1]** |
| Repo won't build / has no tests | Detects, reports honestly, offers to just propose a patch instead of pretending it verified **[MVP]** |
| Concurrent tasks step on each other | One isolated git worktree/branch per task **[MVP]** |
| Runaway loop burning time/tokens | Per-task time + token budget with hard ceiling; reports rather than silently churning **[MVP]** |
| Flaky tests block an otherwise-good fix | Flakiness detection + bounded retries; flags suspected flake in the PR **[v1]** |

---

## 4. Trust & safety — "I'm scared to let it act unattended"

| Pain | Features |
|---|---|
| Fear of irreversible damage | Hard invariants: branch-only, draft-by-default, no prod access, sandboxed run **[MVP]** |
| Different risk tolerance per repo/task | Autonomy ladder: Observe → Draft → Auto-green → scoped Auto-merge **[v1]** |
| Some areas must never be auto-touched | **Always-ask triggers**: auth, secrets, payments, DB migrations, infra/CI, large deletions, dep bumps — override autonomy, never auto-merge **[v1]** |
| Plausible-but-wrong "fix" | Mandatory tests + independent self-review pass; PR states confidence + "what I'm unsure about" **[v1]** |
| Secret leakage | Secret scanning on the diff before PR; scoped, short-lived credentials **[v1]** |
| Over-broad repo access | **GitHub App**, per-repo, fine-grained, revocable — not a personal token **[MVP]** |
| "Why did it do that?" | Full audit trail per task: utterance → spec → assumptions → run logs → diff **[MVP]** |
| Earning trust over time | Track-record dashboard (accept/revert rates) that gradually unlocks higher autonomy **[v2]** |

---

## 5. Review — "reviewing on a phone is miserable"

| Pain | Features |
|---|---|
| Can't meaningfully review a diff on mobile | Defer review to desk by design; deep-link straight to the PR in your reviewer **[MVP]** |
| I need the gist without reading code | Skimmable/listenable PR summary: what changed, why, risk level, **"check this first"** **[MVP]** |
| Too many PRs in the morning | **Triaged digest**: prioritized, risk-flagged, grouped, "review this one first" **[MVP]** |
| Don't understand the reasoning | Narrative rationale per PR linked back to the original ask + assumptions **[MVP]** |
| I want changes after reviewing | Reply with feedback (voice/text) → agent iterates async and updates the PR **[v1]** |
| Did it *actually* work, not just compile? | Verification evidence in PR: test output, screenshots, or a short run recording **[v1]** |

---

## 6. Driving mode — "eyes on the road, hands on the wheel"

| Pain | Features |
|---|---|
| Can't touch a screen at all | Fully voice loop; CarPlay / Android Auto integration **[v1]** |
| Reviewing code by voice is unsafe | No diffs/file lists read aloud — summaries and counts only **[v1]** |
| Accidental dangerous command | Merge/deploy verbs **disabled in voice mode** regardless of what's said **[v1]** |
| Road demands attention mid-sentence | Barge-in, pause/resume, fully resumable voice sessions **[v1]** |
| Technical terms get mis-heard | Per-repo vocabulary priming (service names, identifiers from the codebase) **[v1]** |
| Want progress on the *drive home* | Spoken briefing of overnight results; decide **hold / draft / discard** by voice (never merge) **[v2]** |

---

## 7. Overnight mode — "I wake up and want results, not excuses"

| Pain | Features |
|---|---|
| Wake to "I got stuck and did nothing" | Never blocks on you; falls back to **propose-a-plan** so you always get *something* **[MVP]** |
| Questions pile up unanswered all night | Sensible defaults + prominent flags rather than parking **[MVP]** |
| Don't want it running/billing all night | Scheduled work window + nightly budget cap **[v1]** |
| Recurring chores I keep re-asking | **Standing orders / cron**: "nightly, triage new Sentry errors into draft fixes" **[v2]** |
| Morning cognitive load | One consolidated morning digest at a time you pick **[MVP]** |

---

## 8. Cost & efficiency — "unpredictable bills scare me off"

| Pain | Features |
|---|---|
| No idea what a task will cost | Pre-run estimate; live cost in progress view; cost shown in digest **[v1]** |
| Money wasted on impossible tasks | Feasibility pre-check before committing to a full run **[v1]** |
| Monthly spend runs away | Per-account monthly cap + alerts; per-repo budgets **[v1]** |
| Paying for redundant work | Dedup similar/overlapping queued tasks; reuse prior analysis **[v2]** |

---

## 9. Context & memory — "it doesn't know my codebase or me"

| Pain | Features |
|---|---|
| Ignores repo conventions | Reads CLAUDE.md / contributing docs; primes on repo style **[MVP]** |
| Repeats the same mistake | Per-repo persistent learnings ("don't do X here") **[v2]** |
| Forgets my preferences | Personal memory of how you like specs, PRs, notifications **[v2]** |
| Cold-start on a new repo | Guided onboarding auto-detects build/test commands, entry points, structure **[MVP]** |

---

## 10. Orchestration & scale — "I have many things going at once"

| Pain | Features |
|---|---|
| Tasks with dependencies | Task dependencies / ordering; "do B after A merges" **[v2]** |
| Lots of parallel work | Concurrent runners across repos, isolated worktrees, capped concurrency **[v2]** |
| Big task, want breadth | Fan-out sub-agents (investigate, implement, verify) under one task **[v2]** |
| Losing track of everything | Unified task board: queued / running / needs-input / ready / blocked **[MVP]** |

---

## 11. Notifications — "don't spam me, but don't let me miss the one that matters"

| Pain | Features |
|---|---|
| Notification fatigue | Smart batching + severity tiers; quiet hours **[MVP]** |
| Missed a blocker | Escalation for `needs-input` / `blocked` (repeat, then fall back to default) **[v1]** |
| Wrong channel | Route by preference: push, digest, Slack mirror, email **[v1]** |

---

## 12. Failure & recovery — "never fail silently"

| Pain | Features |
|---|---|
| Silent failure | Always reports with logs + what it tried + why it stopped **[MVP]** |
| Partial progress lost | Checkpointed runs; resume from last good state **[v1]** |
| Bad result already merged | One-tap revert + "explain what went wrong" post-mortem **[v2]** |

---

## 13. Team & collaboration — "it shouldn't work in a silo"

| Pain | Features |
|---|---|
| Teammates unaware | Slack mirror of digests/PRs; auto-assign reviewer **[v2]** |
| Ticketing disconnect | Link tasks to Jira/Linear; "fix TICKET-123" pulls the ticket **[v2]** |
| Org-wide safety needs | Org-level autonomy policies + guardrail enforcement **[v2]** |

---

## 14. Delight / differentiators — "things competitors will miss"

- **Deferred-review split** done right: capture anywhere, review only at a screen — the honest answer to "code while driving." **[MVP]**
- **"What are my agents doing?"** — ask by voice anytime for a spoken status. **[v1]**
- **Ambient standing orders** that show up with work already started (a teammate, not a tool). **[v2]**
- **Screenshot-a-bug → draft fix** from anywhere via share sheet. **[v1]**
- **Reproduce-from-Sentry** — turn an error link into a repro + draft fix. **[v2]**
- **Confidence-first PRs** — every PR leads with "here's what I'm *not* sure about," so review time goes where it matters. **[v1]**

---

## The 6 that make or break it (build these well or nothing else matters)
1. **Spec-back + assumption flagging** — the whole async promise rests on good default decisions.
2. **Autonomy ladder + always-ask triggers** — the trust model.
3. **Frictionless capture (voice + offline + share sheet)** — if capture has friction, the moments are lost.
4. **Triaged morning digest + skimmable PR summaries** — review is the bottleneck, not coding.
5. **Never fail silently / always deliver something** — trust dies on the first silent no-op.
6. **Driving-mode verb lockout** — one unsafe merge-by-voice incident ends the product.
