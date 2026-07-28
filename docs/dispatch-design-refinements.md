# Dispatch — Design Refinements (closing MVP gaps)

Companion to `dispatch-master-spec.md`. Closes the two things the spec left open that actually block a clean MVP build: **(A) the spec-back engine** (flagged as the #1 risk) and **(B) the open technical decisions** (now locked with rationale).

---

## A. The Spec-Back Engine

The whole async promise — "queue a vague sentence, get a correct result unattended" — rests on this. It takes a rough utterance and produces a crisp, confirmable spec, surfacing every decision it had to make.

### A.1 Output contract (every task gets this)
```
Spec {
  goal:        string        // one sentence, the outcome
  scope:       string[]      // coarse areas/files it expects to touch
  acceptance:  string[]      // how it will know it's done (usually: these tests pass)
  assumptions: Assumption[]  // every fork it resolved, and how
  risk:        "low" | "medium" | "high"   // blast radius
  confidence:  number        // 0–1, how sure it understood you
  clarifying:  string[]      // questions it would ask IF interactive (max 2)
}

Assumption { statement: string; alternatives: string[]; reversible: boolean }
```

### A.2 How it behaves per mode
| Mode | Behaviour |
|---|---|
| **Interactive** | Reads goal + assumptions back, asks up to 2 clarifying questions, waits for confirm/edit |
| **Overnight (fire-and-forget)** | Posts the spec as a notification, then **auto-proceeds after a grace period** using stated assumptions; only *irreversible* forks park as `NEEDS_INPUT` |
| **Driving** | Speaks goal + top 1–2 assumptions only; one-word confirm; no lists read aloud |

### A.3 The decision rules (what makes defaults *good*)
1. **Bias to the smallest correct change.** Prefer the interpretation with the least blast radius.
2. **Never silently pick on an irreversible fork.** Reversible fork (naming, minor structure) → pick + flag. Irreversible (schema migration direction, deleting data, choosing a dependency, touching auth) → park in overnight, ask in interactive.
3. **Confidence gates behaviour.** `confidence < 0.5` → downgrade to **Observe** (investigate + propose, don't implement) rather than guess.
4. **Every assumption is visible and reversible-tagged.** The PR body lists them so review time targets exactly the guesses.
5. **Scope creep is surfaced, not absorbed.** If the real change is bigger than the spec implied, checkpoint and report before ballooning.

### A.4 Worked examples
```
Utterance: "make the export faster"
→ goal: Reduce dashboard PDF export latency
  scope: [export service, PDF renderer]
  acceptance: [existing export tests pass, export of a 50-widget dashboard < 3s]
  assumptions:
    - "Target is the PDF export path, not CSV" (alt: CSV export; reversible: yes)
    - "No change to output format/layout" (alt: allow layout tweaks; reversible: yes)
  risk: low  confidence: 0.7
  clarifying: ["Is CSV export in scope too?"]

Utterance: "fix the login bug"
→ confidence: 0.35  → DOWNGRADE TO OBSERVE
  goal: Investigate reported login failure and propose a fix (no code yet)
  clarifying: ["Which symptom — wrong-password loop, timeout, or SSO redirect?"]
```

### A.5 Implementation note
The spec engine is a **structured-output Claude call** (JSON schema = the Spec contract above) run before any code. In interactive mode its `clarifying` questions surface to the user; in overnight mode they're logged and defaults applied. This is a prompt + schema, not new infrastructure — it lands in **Phase 3** of the build plan.

---

## B. Locked technical decisions

These were "open" in the build plan. Locking them so implementation is unambiguous. Each is reversible later, but this is the MVP path.

| Decision | **Locked choice (MVP)** | Rationale | Revisit at |
|---|---|---|---|
| Execution location | **Laptop-first**, cloud-optional later | User requirement; real env + tests; no sandbox cost | v2 (cloud fallback) |
| Runner language | **Node/TypeScript** | Same ecosystem as backend; easy WS + process control | — |
| Agent invocation | **Shell out to the authenticated `claude` CLI headless** (`claude -p … --output-format json`) | The CLI is already installed + logged in on this laptop, so **no `ANTHROPIC_API_KEY` needed**; reuses existing Claude Code auth | v1 → Agent SDK if we need finer event streaming |
| Backend | **Fastify (Node/TS)** | Small, fast, same language as runner | — |
| Datastore | **SQLite (via better-sqlite3 or Prisma+SQLite)** | Zero infra for MVP; file-based; trivial local dev | v1 → Postgres when multi-user/hosted |
| Queue | **SQLite-backed table** (`status`, `claimed_by`, `visible_at`) | No broker to run; fine at MVP scale | v1 → real queue if throughput demands |
| Phone client | **Expo / React Native** | Fastest cross-platform; native voice + push | — |
| Voice STT/TTS | **On-device (Expo Speech / platform APIs)** first | Lowest latency, privacy; cloud fallback later | v1 (accuracy tuning) |
| PR creation | **Runner via local `gh` CLI** | Least new infra; reuses user's existing GitHub auth | v1 → GitHub App for least-privilege + audit |
| Auth (phone/runner ↔ backend) | **Static device-paired tokens** | Simple; both belong to one user | v1 → short-lived rotated tokens |
| GitHub auth | **User's existing `gh` login on the laptop** | Nothing to build for MVP | v1 → GitHub App |
| Transport | **WebSocket** (phone↔backend, runner↔backend) | Live status + relay; runner only needs outbound (no firewall changes) | — |

### B.1 What this means for the laptop
The runner needs, at Phase 1: **Node**, **`gh` authenticated**, the **authenticated `claude` CLI**, and a **workspace directory** it's allowed to write in. Nothing inbound — it dials out to the backend.

**Verified on this laptop (2026-07-28):** Node v22.15.0 ✅ · npm 10.9.2 ✅ · git 2.39.5 ✅ · `gh` 2.87.3 authenticated as `flow6979` ✅ · `claude` CLI 2.1.160 ✅ · python3 3.13.7 ✅. `ANTHROPIC_API_KEY` not set — **not needed**, since the runner uses the authenticated `claude` CLI. **All Phase 1 prerequisites are satisfied.**

---

## C. Deliberately deferred (NOT needed for MVP)
- Full 6-stage gated pipeline + voice gate-discussions → **v1**
- Driving mode (CarPlay/Android Auto, verb lockout) → **v1**
- Autonomy ladder beyond "Draft" → **v1**
- GitHub App, Postgres, rotated tokens, cloud fallback → **v1/v2**

These have enough design in the master spec to start when their phase arrives; refining them now would be premature.
