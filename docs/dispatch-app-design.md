# Dispatch — App Design & UI Artifacts (MVP)

Companion to `dispatch-master-spec.md` + `dispatch-mvp-build-plan.md`. The UX design for the MVP: phone app screens, the laptop runner surface, navigation, the status/visual system, and the voice interaction model. Wireframes are lo-fi ASCII — enough to build from or to hand to Figma.

---

## 1. Design principles

1. **Capture in one motion.** The first screen *is* the capture screen. Idea → recorded before the thought escapes.
2. **Glanceable, one-handed, in-the-dark.** Used in bed, on a walk, at a red light. Big targets, high contrast, dark-first, minimal reading.
3. **Voice-first, text-equal.** Everything doable by voice is doable by text and vice versa.
4. **Never make me read code on the phone.** Summaries and statuses only; code review deep-links out to a desk.
5. **Status is the product.** At a glance: what's running, what needs me, what's ready.
6. **Safety is visible.** The current repo/branch and the "draft-only" guarantee are always on screen — you always know where work will land.

---

## 2. Information architecture / navigation map

```
                         ┌───────────────┐
                         │  Onboarding   │  (first run only)
                         │  Connect GH · │
                         │  Pair laptop  │
                         └──────┬────────┘
                                ▼
        ┌───────────────────────────────────────────────┐
        │                  TAB BAR                        │
        │   [ Capture ]   [ Tasks ]   [ Digest ]  [ ⚙ ]   │
        └─────┬────────────────┬───────────┬────────┬─────┘
              ▼                ▼            ▼        ▼
         Capture(Home)     Task Board    Digest   Settings
              │                │                    │
        ┌─────┴─────┐          ▼                    ▼
        ▼           ▼      Task Detail          Runners /
   Repo Picker  Spec Confirm   │               Notif / Budget
        │                      ▼
        ▼                 PR deep-link → GitHub (external)
   Branch Picker
```

Four tabs: **Capture** (home), **Tasks**, **Digest**, **Settings**. Repo/Branch pickers and Spec-confirm are modal flows off Capture.

---

## 3. Screen-by-screen wireframes

### 3.1 Onboarding (first run)
```
┌──────────────────────────────┐
│                              │
│         Dispatch             │
│   code from anywhere         │
│                              │
│  ①  Connect GitHub           │
│     [  Connect with GitHub ] │
│                              │
│  ②  Pair your laptop         │
│     Run this on your Mac:    │
│     ┌────────────────────┐   │
│     │ npx dispatch-runner │   │
│     │   pair  A1B2-C3D4   │   │
│     └────────────────────┘   │
│     ○ waiting for laptop…    │
│                              │
└──────────────────────────────┘
```
Two steps: GitHub auth, then a **pairing code** the laptop runner claims. Status dot flips green when the runner connects.

### 3.2 Capture (Home) — the main screen
```
┌──────────────────────────────┐
│  acme/payment-service         │  ← context bar (tap to switch repo)
│  ⑃ fix/webhook-retry · draft  │  ← branch + "draft-only" guarantee
├──────────────────────────────┤
│                              │
│                              │
│          (  ●  )             │  ← big mic button (hold or tap)
│        tap to speak          │
│                              │
│   ┌────────────────────────┐ │
│   │ or type a task…        │ │  ← text input, equal citizen
│   └────────────────────────┘ │
│                              │
├──────────────────────────────┤
│  RECENT                       │
│  ● running  Add retry logic   │
│  ⚠ needs you  Rename exports  │
│  ✓ ready    Fix flaky test    │
└──────────────────────────────┘
```
- **Context bar** always shows where work lands + the draft-only guarantee (principle #6).
- Mic is the hero. Text field directly beneath.
- Recent tasks with live status dots — tap to open detail.

### 3.3 Repo Picker (match-first)
```
┌──────────────────────────────┐
│  ← Choose a repo              │
│  ┌────────────────────────┐   │
│  │ 🔍 search…             │   │  ← type OR speak "the payments repo"
│  └────────────────────────┘   │
│  PINNED                       │
│   ★ acme/payment-service      │
│   ★ acme/core-api             │
│  RECENT                       │
│   ↻ acme/dashboard-web        │
│   ↻ acme/billing-worker       │
│  ALL (47)                     │
│   acme/…                      │
└──────────────────────────────┘
```
Never a raw 47-item read-aloud. Voice → fuzzy match → confirm inline.

### 3.4 Branch Picker (select or create)
```
┌──────────────────────────────┐
│  ← Branch on payment-service  │
│                              │
│  [ + Create a new branch ]    │
│                              │
│  default:  main  🔒 protected │  ← can't work here; will auto-branch
│  RECENT                       │
│   ⑃ fix/webhook-retry         │
│   ⑃ staging                   │
│  …                            │
└──────────────────────────────┘

  Create flow (voice-friendly):
  You: "a branch for the login retry fix"
  ┌──────────────────────────────┐
  │  I'll create                  │
  │     fix/login-retry           │  ← intent-generated name
  │  off  main                    │
  │     [ Create ]   [ Rename ]   │
  └──────────────────────────────┘
```
Protected/default branch is marked 🔒 and forces auto-branching. You never type kebab-case — confirm the generated name.

### 3.5 Spec Confirmation (spec-back)
```
┌──────────────────────────────┐
│  Before I start…      70% ▓▓░ │  ← confidence meter
│                              │
│  GOAL                         │
│  Retry the payment webhook up │
│  to 3× with backoff on 5xx    │
│                              │
│  I'M ASSUMING                 │
│  • only 5xx, not 4xx   ✎      │
│  • add a unit test     ✎      │
│                              │
│  DONE WHEN                    │
│  • webhook tests pass         │
│                              │
│  RISK  ● low                  │
│                              │
│  [ Looks right — go ]         │
│  [ Let me adjust ]            │
└──────────────────────────────┘
```
The single most important screen for trust: shows the restated goal, editable assumptions, acceptance, risk, and a confidence meter. In voice mode this is spoken (goal + top assumptions) with a one-word confirm.

### 3.6 Task Board
```
┌──────────────────────────────┐
│  Tasks              [ filter ]│
│  NEEDS YOU (1)                │
│   ⚠ Rename export fields      │
│      "migration direction?"   │
│  RUNNING (2)                  │
│   ● Add retry logic   ▓▓▓░ 60%│
│   ● Fix flaky login test      │
│  READY TO REVIEW (1)          │
│   ✓ Fix pagination  → PR #214 │
│  DONE / BLOCKED               │
│   ✗ Upgrade deps  (blocked)   │
└──────────────────────────────┘
```
Grouped by what needs *your* attention first. `NEEDS YOU` always on top.

### 3.7 Task Detail
```
┌──────────────────────────────┐
│  ← Add retry logic     ● run  │
│  acme/payment-service         │
│  ⑃ fix/webhook-retry          │
├──────────────────────────────┤
│  SUMMARY (confidence-first)   │
│  Added backoff retry to the   │
│  webhook handler. ⚠ Check the │
│  max-retry constant — I chose │
│  3, you may want it in config.│
│                              │
│  PROGRESS                     │
│  ✓ spec confirmed             │
│  ✓ edited webhook_handler.rb  │
│  ● running tests… (8/10)      │
│                              │
│  [ Open PR #—  (when ready) ] │
│  [ 💬 Reply with a change ]    │
└──────────────────────────────┘
```
Leads with "what I'm unsure about." Live progress. Deep-link to the PR (opens GitHub externally — no code shown in-app). Reply-to-iterate is a v1 nicety shown here as a stub.

### 3.8 Digest (morning roll-up)
```
┌──────────────────────────────┐
│  Good morning ☕  Overnight:  │
│                              │
│  ⚠ 1 needs a decision         │
│     Rename exports — pick     │
│     migration direction       │
│  ✓ 3 ready to review          │
│     → review "Fix pagination" │
│       first (touches billing) │
│  ✗ 1 blocked                  │
│     Upgrade deps — lockfile   │
│                              │
│  spent: 320k tokens (~$X)     │
└──────────────────────────────┘
```
Triaged: decisions first, then a prioritized review order ("review this first"), then blockers, then cost.

### 3.9 Settings
```
┌──────────────────────────────┐
│  Settings                     │
│  RUNNERS                      │
│   ● MacBook Pro  connected    │
│     workspace: ~/dispatch     │
│     [ Pair another machine ]  │
│  NOTIFICATIONS                │
│   Push          [on]          │
│   Digest time   7:30 AM       │
│   Quiet hours   10p–7a        │
│  DEFAULTS                     │
│   Autonomy      Draft only    │
│   Task budget   250k tokens   │
│  ACCOUNT                      │
│   GitHub  flow6979  [manage]  │
└──────────────────────────────┘
```

---

## 4. Laptop Runner surface (menubar)

Minimal — it mostly runs invisibly.
```
  ⎇ Dispatch ▾
  ─────────────────────
  ● Connected  (flow6979)
  Now: Add retry logic  60%
  Workspace: ~/dispatch
  ─────────────────────
  ▸ Keep awake while running ✓
  ▸ Pause new tasks
  ▸ View logs…
  ▸ Quit
```
Shows connection, current task, workspace. "Keep awake" toggle for overnight. That's the whole surface.

---

## 5. Status & component system

**Status vocabulary (one color + glyph each, used everywhere):**
| State | Glyph | Color | Meaning |
|---|---|---|---|
| Queued | ◦ | grey | waiting for a runner |
| Running | ● | blue (pulsing) | in progress |
| Needs you | ⚠ | amber | a decision is parked |
| Ready | ✓ | green | PR open, review at a screen |
| Blocked/Failed | ✗ | red | stopped, with reason |

**Core components:** Context Bar · Mic Button (idle/listening/processing states) · Task Row (glyph + title + optional progress) · Assumption Chip (editable) · Confidence Meter · Digest Card · Runner Status Pill.

---

## 6. Visual language

- **Theme:** dark-first (bed/car/night use), optional light. High contrast.
- **Type:** large, few sizes — Title / Body / Caption. Generous line height; nothing dense.
- **Color:** near-black canvas; one accent (blue) for interactive/running; the status palette above reserved strictly for status.
- **Motion:** the mic's listening pulse and the running dot are the only ambient motion — everything else is calm.
- **Density:** low. One primary action per screen.

---

## 7. Voice interaction surface (spoken UX)

The audio counterpart to the screens:
- **Capture:** tap/hold mic → transcribe → route to new task / clarify / status query / switch context.
- **Confirm:** spoken spec-back reads *goal + top 1–2 assumptions*, waits for "yes / adjust."
- **Status:** "what's running?" → spoken board summary ("two running, one needs you on the export rename").
- **Read-back rule:** never speak diffs, file lists, or logs — counts and one-line summaries only.
- **Locked verbs (MVP already respects):** no "merge"/"deploy" by voice → "I'll queue it for review at your desk."

---

## 8. Screen inventory (build checklist)

MVP screens: Onboarding · Capture(Home) · Repo Picker · Branch Picker (+create) · Spec Confirm · Task Board · Task Detail · Digest · Settings · Runner menubar. **10 surfaces.**

Deferred to v1: driving/CarPlay mode, gated-pipeline stage views (brief/approach/design gates), autonomy settings, reply-to-iterate thread.

---

## 9. Next artifact step
These wireframes can be turned into a **real Figma design** (screens + a small design system: color tokens, status styles, components) via the Figma integration — or built straight into the Expo app. Recommend generating the Figma design system + the 4 hero screens (Capture, Repo Picker, Spec Confirm, Task Board) first, since those carry the product.
