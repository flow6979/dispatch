# Dispatch — Voice-Driven Lifecycle Pipeline (idea → release)

Dispatch grows from "async task agent" into a **voice-piloted product development lifecycle**. You talk it through each stage; it produces artifacts; you discuss and approve each one by voice; it implements and tests **on your laptop**; it releases on GitHub.

**Phone = voice remote. Laptop = execution engine (local dev + test). GitHub = release target.**

---

## The pipeline: staged, gated, discussable

Each stage produces an **artifact** and ends at a **gate** — a voice/text discussion where you *approve*, *iterate*, or *choose between options*. Nothing advances past a gate without a decision (or, in fire-and-forget mode, an auto-advance-with-flags).

```
① BRIEF ──▶ ② APPROACH ──▶ ③ ARTIFACTS ──▶ ④ IMPLEMENT ──▶ ⑤ TEST ──▶ ⑥ RELEASE
   gate         gate            gate            gate          gate        gate
 (voice-safe) (voice-safe)   (voice-safe)   (screen-lean)  (mixed)    (confirm)
```

| Stage | Input | Produces | Gate discussion | Hands-free? |
|---|---|---|---|---|
| **① Brief** | your one-liner idea | Product brief: problem, users, goals, scope, non-goals, success criteria | Read brief aloud → refine by voice → approve | ✅ Yes |
| **② Approach** | approved brief | 2–3 approaches with trade-offs + a recommendation | Hear the options → pick one / blend | ✅ Yes |
| **③ Artifacts** | chosen approach | Design artifacts: tech spec, architecture, data model, API/contract, UI notes | Walk through by voice → adjust → finalize | ✅ Mostly |
| **④ Implement** | finalized design | Code on a branch (on your laptop), incremental | Progress + questions by voice; code review on screen | ⚠️ Partial |
| **⑤ Test** | implementation | Local test + app run results | "12 pass, 2 fail — fix?" by voice; logs on screen | ⚠️ Mixed |
| **⑥ Release** | green build | PR / push / GitHub release | Explicit confirm (never auto by voice) | ✅ Confirm only |

**Voice-reviewability gradient:** concepts (brief/approach/design) are perfect for voice — they're prose, you can hear and debate them on a drive. Code and logs are not — those gate at a screen. The pipeline is deliberately most hands-free at the top.

---

## Per-stage detail

### ① Brief — turn a one-liner into a shared understanding
- You: *"I want a feature that lets users export their dashboard as a PDF."*
- Agent drafts a brief: problem, who it's for, goals, explicit non-goals, success criteria, open questions.
- **Discussion (voice):** reads a tight summary aloud; you refine (*"drop scheduled exports, that's out of scope"*); iterate until you say approve.
- Artifact saved (e.g. `docs/briefs/pdf-export.md`) and versioned.

### ② Approach — decide the *how* before building
- Agent proposes 2–3 approaches with trade-offs (e.g. server-side render vs client-side vs third-party), a recommendation, and risks.
- **Discussion (voice):** *"Option 1 is fastest but adds a dependency; Option 2 is more work but no new deps. Which way?"* → you pick or blend.
- This is a **judge-panel-friendly** step: it can generate multiple independent approaches and score them.

### ③ Artifacts — the design made concrete
- Produces the real design artifacts: tech spec, architecture sketch, data model, API/interface contracts, and UI notes (or a Figma handoff if wired).
- **Discussion (voice + optional screen):** narrates the design; you adjust decisions; finalize.
- Includes a mandatory **failure & edge-cases** pass before it's "final."
- These become the source of truth the implementation is checked against.

### ④ Implement — build it, on your laptop
- Runs on the **laptop runner** (see architecture below): fresh worktree, branch per feature, real local env.
- Incremental with checkpoints; **discussions** happen when it hits a real fork (*"the export lib needs a license key — use it or find an alternative?"*).
- Progress by voice; the actual **diff review is deferred to a screen** with a skimmable, confidence-first summary.

### ⑤ Test — verify locally, for real
- Runs the project's tests **locally on your laptop** — real toolchain, real DB, real fixtures.
- Can **run the actual app** and capture evidence (screenshots / a short recording / test output).
- **Discussion (mixed):** *"12 passed, 2 failed on the empty-dashboard case — want me to fix and re-run?"* Summary is voice-safe; logs and diffs are on screen.
- Loops back to ④ on failures until green (bounded by budget).

### ⑥ Release — ship it on GitHub
- Opens a **draft PR** by default (or ready PR / release per your autonomy setting).
- Fills the PR template, links the brief + spec + test evidence, tags reviewers.
- **Merge/release is an explicit confirmation — never done by voice** (driving-mode lockout still applies). *"I'll open the PR; merge it from your desk."*

---

## Architecture change: the laptop is the runner

Earlier drafts assumed cloud sandboxes. Because you want **all local dev + testing on your own machine**, the executor becomes a persistent daemon on your laptop.

```
┌────────────┐        ┌──────────────────┐        ┌──────────────────────┐
│   Phone    │        │ Dispatch backend │        │  Laptop Runner (daemon)│
│ voice/text │◀──WS──▶│ queue · policy · │◀──WS──▶│  • Claude Code local   │
│ remote     │        │ relay · state    │        │  • git worktree/branch │
└────────────┘        └──────────────────┘        │  • local build/test    │
                                                   │  • runs the real app   │
                                                   │  • local secrets/env   │
                                                   └──────────┬─────────────┘
                                                              ▼
                                                        GitHub (PRs/releases)
```

**How it works**
- A **menubar/CLI daemon** on the laptop registers as your runner, holds a persistent connection to the backend, and executes tasks locally under Claude Code.
- **Phone never talks to the laptop directly** — both talk to the backend, which relays. So you can queue tasks while the laptop is offline; it picks them up when it wakes.
- Uses your **real local environment**: installed toolchain, local DB, `.env` secrets, ability to actually launch the app. No cloud setup, no sandbox cost, higher-fidelity testing.

**Consequences & handling**
| Consequence | Handling |
|---|---|
| Laptop must be awake/connected for a task to run | Keep-awake while a task runs (plugged-in required for overnight); "leave it running" mode |
| Overnight needs the machine on | Scheduled work window; warn if laptop is likely to sleep; queue-and-wait if it's off |
| Weaker isolation than a sandbox (it's your real box) | Scope all work to a workspace dir; branch-only; confirm destructive ops; no force-push to protected |
| Multiple machines (desktop + laptop) | Pick a runner by name/voice: *"run this on the desktop"*; default to last-used |
| Runner crashes mid-task | Checkpointed; resumes on reconnect; reports if it can't |
| Secrets on the machine | Never leave the machine; diff secret-scanned before any push |

**Optional:** cloud runner as a *fallback* when the laptop is off — same interface, lower fidelity. Local-first, cloud-optional.

---

## Interaction modes across the pipeline

- **Interactive (live voice session):** you walk stage-by-stage, discussing each gate. Great at a desk or on a call.
- **Fire-and-forget (overnight/driving):** gates **auto-advance using recommended defaults + flags**, so the whole pipeline can run to a draft PR unattended; anything sensitive parks for you. You wake up to *"Brief and design auto-approved with these 3 assumptions; implementation done; 2 tests failing — needs you."*
- **Driving:** top stages (brief/approach/design) are fully discussable by voice; bottom stages run and report summaries; nothing merges.

---

## Grounding note
The *pipeline logic* — brief → approach → tech spec → implement → test → PR, with maker-checker review at each step — already exists in mature form (PRD authoring/review, tech-spec, idea-to-PR orchestrators). **Dispatch's novel layer is the voice/mobile front-end + the laptop-runner + the per-gate voice-discussion model.** You're wrapping a proven pipeline in a hands-free remote, not inventing the pipeline.

---

## New features this vision introduces

- **Staged, gated pipeline** with per-stage artifacts and approve/iterate/choose gates **[v1]**
- **Voice gate-discussions** — read-aloud brief/approach/design, refine by voice **[v1]**
- **Laptop Runner daemon** — local dev + test + run-the-app, phone as remote **[MVP-critical]**
- **Runner selection by voice** ("run on the desktop") + keep-awake / scheduled window **[v1]**
- **Auto-advance-with-flags** so the full pipeline can run unattended to a draft PR **[v1]**
- **Approach judge-panel** — multiple approaches generated, scored, chosen by voice **[v2]**
- **Evidence-rich release** — PR links brief + spec + test output/screenshots **[v1]**
- **Local-first, cloud-fallback runner** for when the laptop is off **[v2]**
