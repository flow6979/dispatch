# Dispatch — Morning Report ☀️

*Overnight autonomous session. Goal: make Dispatch the best tool for coding from your phone — least tokens, best results.*

---

## TL;DR
- **Shipped 3 substantial things tonight**, all deployed + verified: a **Repo Map tab** (zoomable dependency graph), **prompt caching** (measured **~47% cost drop** on repeat tasks), and **agent bounding** (cost ceiling + trimmed overhead).
- **Latest release: v0.1.9** — https://github.com/flow6979/dispatch/releases/tag/v0.1.9
- **The #1 thing to make Dispatch beat Anthropic's own app: reliable push notifications.** Anthropic's Remote Control pushes are broken across many open issues — this is a wide-open moat. It's built-ready and waiting on your **Firebase/FCM creds** (your call from last night).
- 3 research dossiers written in `docs/research/`.

---

## What shipped tonight (deployed + verified)

### 1. Repo Map tab 🗺️ (your headline request)
A new 5th tab that visualizes the selected repo as a **zoomable/pannable dependency graph**:
- Nodes = files, colored by top-level directory, sized by how many things import them.
- Edges = imports/requires (intra-repo).
- Tap a file → focus its neighborhood; pinch-zoom, pan.
- Built by the runner via **pure static analysis (0 tokens)**, cached per repo, served by the backend, rendered with Cytoscape.js/fcose in a WebView.
- Verified: 19 nodes / 44 edges for the dispatch repo, rendering on-device.
- **Follow-up:** currently loads Cytoscape from CDN (needs network); bundle it locally for offline. (Research doc has the exact steps.)

### 2. Prompt caching — the big token win 💸
Research surfaced the root cost bug: **every task used a fresh git worktree + branch, which guaranteed a 100% prompt-cache miss.** Fixed:
- `--exclude-dynamic-system-prompt-sections` → system-prompt prefix is byte-identical across worktrees.
- Reordered task/chat prompts so the **stable prefix (instructions + repo map) leads** and the per-task text trails (cache is exact prefix match).
- `ENABLE_PROMPT_CACHING_1H=1`.
- **Measured:** two questions on the same repo → $0.20 then **$0.11 (~47% cheaper)** on the repeat.

### 3. Agent bounding 🧱
- `--strict-mcp-config` (skip loading MCP servers we don't need → less system-prompt overhead every call).
- `--max-turns 40` on the edit step → a stuck task can't burn the whole budget.
- Compounds with the $ budget cap + model routing already in place.

---

## Where Dispatch stands vs the field (from research)

| Competitor | Their edge | Their gap = our opening |
|---|---|---|
| **Anthropic Claude Code RC** | First-party, supervisory | **Push notifications broken across many open issues**; no clean capture→PR loop |
| **Cursor iOS** | Live Activities, voice, review+merge on phone | **iOS only** — Android is wide open |
| **GitHub Copilot** | Agents panel, draft-PR default | Web-first, not phone-native |
| **CodeAgent Mobile** | Voice compose, Talk mode, merge | Not tied to *your* Claude sub / laptop |
| **Devin/Jules/Replit** | Autonomous cloud | Rent-a-VM, second bill, no real phone app |

**Dispatch's five killer differentiators** (already partly built):
1. **Notifications that actually work + are actionable** ← the moat. (Push, next.)
2. **Voice-first capture on Android.** (Voice is wired; verify on your device.)
3. **Runs on YOUR laptop with YOUR Claude sub** — no second cloud bill, your real toolchain/secrets. (Done.)
4. **Live per-task tokens + $ ledger.** Nobody surfaces this on mobile. (Done ✅.)
5. **Intent classification (chat vs build) at capture.** (Done ✅.)

---

## Recommended roadmap (what to do next, in order)

**P0 — the reliability moat**
1. **Push notifications** (needs your Firebase/FCM). Task needs-you / PR ready / answered → actionable push; ideally approve/answer from the notification. *This single thing beats Anthropic's first-party experience.*
2. **Ongoing/persistent status notification** while a task runs (survives app kill).
3. **Harden the security secret** — set `DISPATCH_SECRET` in Render (still on the default). See below.

**P1 — differentiation**
4. **Plan-preview gate** (Jules-style): show the plan + let you approve before any code is written. Easy with `claude` plan mode; big trust win.
5. **Review + merge the PR from the phone** (diff view, "merge" button).
6. **Talk mode**: hands-free voice supervision ("catch me up", "merge?", dispatch follow-up).
7. **Task-scoped file lists** (token opt #2): append only the touched files after the cached map → 30–60% fewer map tokens + fewer speculative reads.

**P2 — moat-widening**
8. Tree-sitter + PageRank repo map (better signal/token than the regex map).
9. Embeddings/RAG file retrieval for large repos (50–80% on big repos).
10. Multi-runner parallelism, event-triggered runs (CI-fail/Slack), team features.

Full detail + citations in `docs/research/competitive-and-roadmap.md` and `docs/research/token-optimization.md`.

---

## Two things that need YOU
1. **Firebase for push** — create a free Firebase project (Android app `com.flow6979.dispatch`), send me `google-services.json` + the FCM server key (or service-account JSON). Then I wire + verify real push. This is the highest-value next feature.
2. **Harden security** — set `DISPATCH_SECRET` (random string) in Render env, restart runner with it, rebuild app with `EXPO_PUBLIC_DISPATCH_SECRET`. Until then the shared secret is the default `dev-token` (fine for testing, not for real repos). The pairing-code flow is built so new devices connect by pasting a code — no rebuild needed once the secret is set.

---

## Cost math now (per task, sonnet edit, cached repo)
- A real sandbox build went **$0.46 → $0.065 → $0.054** as optimizations stacked (model routing → repo index → caching + bounding + file-scoping).
- Repeat tasks on the same repo: **~half** cost, thanks to prefix caching (measured $0.20 → $0.11).
- A *question* (chat mode) is cheaper still — no clone/edit/PR.
- Every task is hard-capped at **$3** (`--max-budget-usd`) so nothing runs away.

**Also shipped after this report's first draft:** agent bounding (`--strict-mcp-config`, `--max-turns 40`) and **task-scoped file hints** (points claude at likely-relevant files → fewer speculative reads). Next biggest levers: tree-sitter/PageRank map (#4) and RAG retrieval for large repos (#5).

---

## Open follow-ups / known rough edges
- Map tab: bundle Cytoscape for offline (CDN today).
- Settings "Pair another device" button: server-verified, but the on-emulator tap was flaky — re-verify on a real device.
- Voice: works on real devices with a speech engine; couldn't verify on the emulator (no engine).
- Render free tier still cold-starts (~30–50s) after idle; a keep-warm ping would smooth first-request latency.
