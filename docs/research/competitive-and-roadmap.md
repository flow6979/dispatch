# Dispatch: Competitive Landscape & Roadmap — Coding From Your Phone

_Research date: 2026-07-30. Author: research pass for Dispatch (Expo/RN Android app + Fastify relay on Render + laptop "runner" daemon running `claude -p`)._

> **Thesis in one line:** The market has converged on "assign a task, get a PR" — but almost everyone is either (a) a desktop tool with a bolted-on phone remote, or (b) a cloud agent you rent. Dispatch's wedge is a **truly phone-native, voice-first async agent that runs on *your own* laptop and *your own* Claude subscription**, with the one thing every incumbent is currently botching: **reliable, glanceable, actionable notifications**.

---

## 1. Competitor teardown — what's good, what's missing

### Anthropic — Claude app + Claude Code "Remote Control" (`/rc`)
The most direct threat because Dispatch is built on the same `claude` CLI.

**What it does well**
- First-party: Remote Control connects the Claude iOS/Android app to a Claude Code session on your machine — read history, send instructions, interrupt mid-run, view real-time output. ([docs](https://code.claude.com/docs/en/remote-control))
- "Push when Claude decides" sends a push when a long task finishes or Claude needs a decision. ([techradar](https://www.techradar.com/pro/anthropic-reveals-remote-control-a-mobile-version-of-claude-code-to-keep-you-productive-on-the-move))
- Uses your existing Claude subscription — no second bill.

**Gaps (this is Dispatch's opening)**
- **Notifications are broken in the field.** Multiple open GitHub issues in 2026: pushes never deliver despite paired sessions ([#60383](https://github.com/anthropics/claude-code/issues/60383)), broken across devices ([#60208](https://github.com/anthropics/claude-code/issues/60208)), Android specifically dead ([#57758](https://github.com/anthropics/claude-code/issues/57758)), and the setup is undocumented ([#48852](https://github.com/anthropics/claude-code/issues/48852)). This is the single biggest quality gap in the category.
- **Supervisory, not authoring.** You monitor an existing session; there's no clean "capture a task from scratch → auto-clone → draft PR" loop.
- No voice input, no per-task cost/token display, no intent classification (chat vs build), no task queue.
- Permission prompts add ~350 tokens each and interrupt async flow ([claudecodeguides](https://claudecodeguides.com/claude-code-permission-modes-affect-token-usage/)).

### Cursor — iOS app + Cloud Agents (the strongest mobile-native competitor)
Cursor shipped a **native iOS app on 2026-06-29** that is, feature-for-feature, the closest thing to Dispatch's vision. ([9to5mac](https://9to5mac.com/2026/06/29/cursor-releases-iphone-and-ipad-app-following-recent-acquisition-by-spacex/), [cursor.com](https://cursor.com/blog/ios-mobile-app))

**What it does well**
- **Live Activities on the lock screen** track agent status; push when an agent finishes, needs input, or is ready for review. This is the gold standard for glanceability.
- **Voice input** + slash commands to compose tasks.
- **Review + merge the PR from the phone** — demos, screenshots, logs, diffs.
- Cloud agents *or* remote-control your local machine; parallel agents; Slack `@Cursor` trigger. ([changelog](https://cursor.com/changelog/1-1))

**Gaps**
- **iOS only** (public beta, paid plans). Dispatch is Android — a wide-open flank.
- Cloud agents run in Cursor's VMs, not your laptop → second bill, and your local toolchain/secrets/state aren't there.
- No per-task token+$ ledger surfaced to the user.
- Heavy IDE lineage; the phone app is a companion, not the product.

### GitHub — Mobile + Copilot coding agent + Agents panel
The default for anyone already living in GitHub.

**What it does well**
- Assign an issue to `@copilot` (or use the + button in Mobile) → it works in a GitHub Actions env and **opens a draft PR**, tagging you for review. ([changelog](https://github.blog/changelog/2025-09-24-start-and-track-copilot-coding-agent-tasks-in-github-mobile/), [docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-mobile))
- **Agents panel** launches/tracks tasks from anywhere on github.com; steer via `@copilot` PR comments. ([github.blog](https://github.blog/news-insights/product-news/agents-panel-launch-copilot-coding-agent-tasks-anywhere-on-github/))
- PR-native review, permissions, and audit trail — enterprise-trusted.

**Gaps**
- The rich Agents panel is desktop-web; mobile is thin (assign + list, no full overlay).
- No voice, no cost display, runs in GitHub's ephemeral env (not your machine), Copilot models (not Claude).
- Steering is clunky (comment on a PR and wait) — not conversational.

### Devin (Cognition) — autonomous cloud engineer
**Well:** True fire-and-forget async; Slack/GitHub/NL task intake; Devin 3 hit >90% SWE-bench Verified in early 2026. ([buildfastwithai](https://www.buildfastwithai.com/ai-tools/devin)) Delegation-first UX lowers the barrier for non-engineers.
**Gaps:** Expensive, cloud-only, opaque, no phone-native app of note; overkill/overpriced for the "small change from my phone" job.

### Replit — Mobile app + Agent
**Well:** Genuinely phone-native creation ("idea → app"), instant Expo preview via QR, publish to store. Best onboarding/vibe-coding on a phone. ([blog.replit.com](https://blog.replit.com/mobile-apps))
**Gaps:** Walled garden — it's Replit's cloud projects, not your repo on your machine. Native mobile builds still push you to the web. Not a "PR against my existing GitHub repo" tool.

### Zed
**Well:** Best-in-class desktop Agent Panel, fast, parallel agents. ([deepwiki](https://deepwiki.com/zed-industries/zed/8.1-agent-panel-and-ui))
**Gaps:** **No mobile app at all.** A Feb-2026 feature request to remote-control the Agent panel from a phone is still unbuilt as of July 2026. ([discussion #49313](https://github.com/zed-industries/zed/discussions/49313)) Zero threat on mobile today.

### Warp
**Well:** Universal agent support (Claude Code, Codex, Gemini CLI, OpenCode as first-class), pane-stacking to run agents in parallel, and **Oz cloud agents triggered by webhooks/CI/Slack**. ([digitalapplied](https://www.digitalapplied.com/blog/warp-ai-terminal-agentic-cli-workflows-guide), [deployhq](https://www.deployhq.com/guides/warp))
**Gaps:** Terminal-first, desktop-first. No phone-native product. Power-user surface, not glanceable.

### The mobile-first async pack (closest in *spirit* to Dispatch)
- **Orca** (MIT, iOS+Android, 5k+ stars): live terminal mirror of desktop agent sessions (Claude Code/Codex/Cursor), full keyboard input, notify-on-finish, multi-worktree. BYO subscription. ([github](https://github.com/stablyai/orca)) **Gap:** it's a terminal *mirror* — powerful but not glanceable or voice-first; you're still driving a CLI on a 6" screen.
- **CodeAgent Mobile**: the most feature-complete phone-first async agent. Voice **Compose** (speech/screenshot → prompt), hands-free **Talk mode** (approve/merge/dispatch by voice), diff editor + merge, task intake from Jira/Linear/Slack, provision Codespaces in ~60s, pair to your IDE/CLI/cloud, notification-driven. ([codeagent-mobile.com](https://www.codeagent-mobile.com/)) **This is the closest competitor to Dispatch's intended UX — study it hard.** Gap: not tied to your own Claude sub; broad but not opinionated about a single clean loop.
- **AgentsRoom**: E2E-encrypted Mac↔phone sync, review diff / follow-up / rerun from the lock screen. ([agentsroom.dev](https://agentsroom.dev/features/mobile-desktop-sync))
- **Jules (Google/Gemini)**: cloud VM, **plan-approval before any code**, PR with reasoning + terminal logs, `jules` issue label, tiered concurrency. ([jules.google](https://jules.google/)) Gap: Gemini-only, cloud-only, no notable phone app.

### Landscape summary

| Product | Phone-native | Voice | Runs on *your* machine | Your Claude sub | Draft-PR loop | Glanceable notifs | Per-task $ |
|---|---|---|---|---|---|---|---|
| Claude RC | Companion | No | Yes | Yes | Weak | **Broken** | No |
| Cursor iOS | **Yes (iOS)** | **Yes** | Optional | No | Yes | **Yes (Live Act.)** | No |
| GitHub Copilot | Thin | No | No (Actions) | No | **Yes** | Basic | No |
| Devin | No | No | No | No | Yes | Basic | Partial |
| Replit | **Yes** | Partial | No | No | No (own cloud) | Basic | No |
| Orca | Yes (mirror) | No | Yes | Yes | Via CLI | Finish-only | No |
| CodeAgent Mobile | **Yes** | **Yes** | Optional | No | **Yes** | **Yes** | No |
| Jules | No | No | No | No | Yes | Basic | No |
| **Dispatch (target)** | **Yes (Android)** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** |

---

## 2. What makes Dispatch best-in-class — the killer differentiators

Dispatch should win on the intersection nobody else occupies. Five differentiators, in priority order:

1. **Notifications that actually work + are actionable.** Anthropic's own RC pushes are broken across a pile of open issues. If Dispatch's runner→relay→phone push is *reliable*, *fast*, and lets you **approve/deny a permission or answer a question directly from the notification/lock screen**, that alone beats the first-party experience. This is a correctness/reliability moat, not a feature.
2. **Voice-first capture + hands-free supervision.** Only Cursor (iOS) and CodeAgent do voice. Dispatch is Android — own voice on Android. "Talk mode": narrate what changed, ask "merge?", dispatch a follow-up — all without typing on glass.
3. **Runs on YOUR laptop with YOUR Claude subscription.** No second cloud bill, full access to your real toolchain, secrets, local services, and repo state. Devin/Cursor-cloud/Jules/Replit all rent you a VM. Dispatch = your machine, your keys, your `~/.claude` context.
4. **Per-task tokens + $ ledger, live.** Nobody surfaces this on mobile. Show cost accruing per task, a running monthly total, and a per-PR "this change cost $X / Y tokens." Turns an opaque agent into a budgetable tool — huge for trust and for teams.
5. **Intent classification (chat vs build) at capture time.** The phone already classifies. Lean in: a one-line question shouldn't spin up a clone+PR; a feature request should. This makes the app feel *smart at the door* and keeps cost/latency down.

Supporting differentiators worth owning: **plan-preview before code** (steal from Jules), **glanceable task cards** (tokens/$/status/PR link), and **zero-friction device pairing** (QR, one tap).

---

## 3. Prioritized roadmap (P0/P1/P2) — tailored to phone + relay + laptop runner

Effort = eng-weeks-ish; Impact = differentiation × user value. Everything here is buildable on the existing architecture.

### P0 — Table stakes + the reliability moat (do first)

| Feature | Why | Impact | Effort |
|---|---|---|---|
| **Rock-solid push pipeline (runner→relay→FCM→phone)** with delivery receipts + retry + "test notification" in pairing | Beats Anthropic's broken RC; without this nothing else matters | ★★★★★ | Med |
| **Actionable notifications** — approve/deny permission & answer y/n prompts from the notification and lock screen | Kills the #1 async-flow interrupt; the runner blocks on `claude` permission gates today | ★★★★★ | Med |
| **Glanceable task cards** — status, elapsed, tokens, $, repo, branch, PR link, one-tap to detail | Core of the "async, glanceable" promise | ★★★★★ | Low |
| **Draft-PR loop hardening** — clone → branch → `claude -p` → push → draft PR, with idempotency + failure surfacing | This is Dispatch's product; make it never silently fail | ★★★★★ | Med |
| **Per-task token + $ meter** parsed from `claude` output/stream-json | Unique on mobile; trust + budgeting | ★★★★☆ | Low |
| **Voice capture → prompt** (Android STT) with the existing chat/build classifier | Low-friction capture; core UX bet | ★★★★☆ | Low |

### P1 — Differentiation

| Feature | Why | Impact | Effort |
|---|---|---|---|
| **Plan-preview before execution** (`claude -p` in plan mode → show plan → tap Approve to build) | Steal from Jules; big trust win, cheap to add | ★★★★☆ | Med |
| **Follow-up / steer mid-task** — send a message into a running session from the phone | Matches Cursor/Copilot; turns monitoring into conversation | ★★★★☆ | Med |
| **Live Activity / persistent notification** showing agent progress (Android ongoing notification + Wear tile) | Glanceability parity with Cursor Live Activities | ★★★★☆ | Med |
| **In-app diff + PR review + merge** (via gh API) | Close the loop without leaving the app | ★★★☆☆ | Med |
| **Talk mode** — hands-free narration + voice approve/merge/dispatch | Cursor/CodeAgent parity; commute/driving use case | ★★★★☆ | High |
| **Task queue + parallel runs** across worktrees on the runner | Orca/Warp parity; power users | ★★★☆☆ | Med |
| **Monthly $ budget + soft cap / alert** built on the per-task meter | Nobody has this; team-friendly | ★★★☆☆ | Low |

### P2 — Expansion / moat-widening

| Feature | Why | Impact | Effort |
|---|---|---|---|
| **Task intake from Slack / Linear / Jira / GitHub issues** → auto-dispatch | CodeAgent/Devin parity; meets work where it lives | ★★★☆☆ | High |
| **Screenshot / photo → prompt** (attach a UI bug pic) | CodeAgent parity; great mobile-native affordance | ★★★☆☆ | Med |
| **Multi-runner / team pairing** — one phone → several laptops or a shared runner box | Scales to teams; sticky | ★★★☆☆ | High |
| **Scheduled / triggered tasks** (cron, on-CI-fail) via runner | Warp Oz parity | ★★☆☆☆ | Med |
| **iOS app** | Doubles TAM once Android loop is proven | ★★★☆☆ | High |
| **Session replay / transcript timeline** per task | Trust + debugging; audit | ★★☆☆☆ | Med |

**Sequencing logic:** P0 makes Dispatch *reliably better than Anthropic's own RC* on the exact axis they're failing (notifications) while nailing the draft-PR loop and the unique $ meter. P1 reaches feature parity with Cursor iOS on Android + adds plan-preview trust. P2 widens into teams and integrations.

---

## 4. UX principles for an async, glanceable, low-friction mobile agent

1. **The notification IS the interface.** Most interactions should complete without opening the app: approve a permission, answer y/n, see "PR ready," tap to merge. Optimize the lock screen first, the app second. (Cursor's Live Activities are the bar; Anthropic's broken pushes are the anti-pattern.)
2. **Capture must be zero-friction.** Voice by default, one-tap dictation, classify intent silently. Never make the user pick "chat vs build" — infer it, let them override.
3. **Glanceable > detailed.** A task card answers in <1s: what's it doing, is it stuck, how much has it cost, where's the PR. Progressive disclosure for logs/diffs.
4. **Async-honest status.** Always show one of a small, legible state set: Queued → Planning → Awaiting approval → Building → PR ready → Failed. No spinners without ETA/context. Persist across app kills (ongoing notification).
5. **Cost is a first-class citizen, not a surprise.** Show $ and tokens accruing live and per-PR. Users tolerate autonomy far more when the meter is visible.
6. **Fail loud, fail actionable.** If the runner loses network, `claude` errors, or push fails — say so on the phone with a retry button. Silent stalls are the worst async experience.
7. **Trust ramps: preview → autonomy.** Default to plan-preview + permission prompts; let confident users flip a task (or repo) to auto-accept. Make the trust dial explicit.
8. **Handoff continuity.** A task started by voice on the phone should be resumable/reviewable on the laptop and vice versa — one session, many surfaces (Cursor/AgentsRoom do this).
9. **Respect the thumb.** Primary actions (Approve, Merge, Follow-up) reachable one-handed; destructive actions guarded.

---

## 5. Specific features worth stealing / adapting

- **Cursor:** Live Activities on the lock screen (agent status + finish/needs-input/ready-for-review pushes) → adapt as an Android ongoing notification + Wear OS tile. Voice + slash commands in the composer.
- **CodeAgent Mobile:** **Talk mode** (hands-free voice supervision: review/approve/merge/dispatch/"catch me up"), and **screenshot-to-prompt**. Also its "send an agent to review a PR and post inline verdicts" pattern.
- **Jules:** **Plan-approval gate before any code is written**, and PRs that ship with **reasoning + full terminal logs** attached. Trivial to add given `claude -p` plan mode; big trust payoff.
- **GitHub Copilot:** **Draft PR as the default output** (never push to main), and the **Agents panel** model of "launch/track from anywhere" → mirror as a persistent task tray in Dispatch.
- **Warp Oz:** **Event-triggered cloud agents** (webhook/CI-fail/Slack) → runner-side triggers for P2.
- **Orca:** **Multi-worktree parallel agents** and BYO-subscription model (already Dispatch's model — lean into it as marketing).
- **AgentsRoom:** **E2E-encrypted Mac↔phone sync** and lock-screen follow-up/rerun — a good security posture and UX to advertise for the phone↔runner link.
- **Replit:** **Instant Expo QR preview** of the result — Dispatch could show a live preview / screenshot of the built change in the task card.

### Sources
- Claude Code Remote Control: https://code.claude.com/docs/en/remote-control · notification bugs: https://github.com/anthropics/claude-code/issues/60383 , https://github.com/anthropics/claude-code/issues/60208 , https://github.com/anthropics/claude-code/issues/57758 , https://github.com/anthropics/claude-code/issues/48852 · https://www.techradar.com/pro/anthropic-reveals-remote-control-a-mobile-version-of-claude-code-to-keep-you-productive-on-the-move
- Cursor iOS: https://cursor.com/blog/ios-mobile-app , https://9to5mac.com/2026/06/29/cursor-releases-iphone-and-ipad-app-following-recent-acquisition-by-spacex/ · web/agents: https://cursor.com/blog/agent-web · Slack: https://cursor.com/changelog/1-1
- GitHub Copilot: https://github.blog/changelog/2025-09-24-start-and-track-copilot-coding-agent-tasks-in-github-mobile/ , https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-mobile , https://github.blog/news-insights/product-news/agents-panel-launch-copilot-coding-agent-tasks-anywhere-on-github/
- Devin: https://www.buildfastwithai.com/ai-tools/devin
- Replit: https://blog.replit.com/mobile-apps
- Zed: https://deepwiki.com/zed-industries/zed/8.1-agent-panel-and-ui , https://github.com/zed-industries/zed/discussions/49313
- Warp: https://www.digitalapplied.com/blog/warp-ai-terminal-agentic-cli-workflows-guide , https://www.deployhq.com/guides/warp
- Orca: https://github.com/stablyai/orca , https://www.explainx.ai/blog/claude-code-mobile-remote-control-phone-guide-2026
- CodeAgent Mobile: https://www.codeagent-mobile.com/
- AgentsRoom: https://agentsroom.dev/features/mobile-desktop-sync
- Jules: https://jules.google/
- Permission/token overhead: https://claudecodeguides.com/claude-code-permission-modes-affect-token-usage/
