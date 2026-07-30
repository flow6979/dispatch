# Token-cost minimization for Dispatch

_Research + implementable plan. Written 2026-07-30. Owner: runner (`runner/runner.js`)._

## Context & the core problem

Dispatch runs one Claude Code CLI process per task:

```
claude -p "<prompt>" --output-format stream-json [--model …] [--max-budget-usd …]
```

inside a **fresh `git worktree`** of a cloned repo (`runner/runner.js` → `runTaskReal`, and read-only in `handleChat`). Each task is a brand-new `claude` process with no memory, so every task re-establishes context from scratch (~200k tokens even for a 1-file change).

We already do three good things:

- **(a) Static repo map** — `buildRepoMap()` / `ensureRepoIndex()` build a file-tree + top-level-symbol map, cached on disk keyed by git `HEAD`, injected into the prompt inside `<repo_map>…</repo_map>`. Costs 0 tokens to build (pure `git ls-files` + regex).
- **(b) Model routing** — `CLASSIFY_MODEL`/`SPEC_MODEL` = haiku, `EDIT_MODEL`/`CHAT_MODEL` = sonnet.
- **(c) Dollar cap** — `--max-budget-usd` (`DEFAULT_BUDGET_USD=3`).

### The single most important fact this research surfaced

Claude Code **already does prompt caching automatically** and does it well — but its cache is **scoped to `{model, effort, machine, working directory, git-status snapshot}`**. The system prompt literally embeds the working directory, platform, shell, OS version, auto-memory paths, and a git branch/commit snapshot. Quote from the Claude Code caching doc:

> "In Claude Code, the cache is effectively scoped to one machine and directory. The system prompt embeds the working directory, platform, shell, OS version, and auto-memory paths, so two sessions in different directories build different prefixes and miss each other's cache. **That includes worktrees of the same repository, since each worktree has its own working directory.** … Sequential sessions share the prefix only when the git status snapshot at startup matches."

**Dispatch does the two things that guarantee a 100% cache miss on every task: (1) a fresh worktree = a new working directory, and (2) a fresh branch = a different git-status snapshot.** So today we get *zero* cross-task cache reuse even though our prefix (system prompt + repo map) is nearly identical task-to-task. That is the biggest, cheapest win available and it is a CLI flag + a small restructuring.

Sources: [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching), [Improve prompt caching across users and machines](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts#improve-prompt-caching-across-users-and-machines).

---

## Ranked plan (impact ÷ effort)

| # | Technique | Est. savings | Effort | Risk |
|---|-----------|-------------|--------|------|
| **1** | **Make the CLI prefix cacheable across invocations** (`--exclude-dynamic-system-prompt-sections` + stable prefix ordering + 1h TTL) | **40–90% of input tokens on repeat tasks** | S | Low |
| 2 | Stop shipping the whole repo map; ship a **task-scoped file list + trimmed map** | 30–60% of the repo-map tokens (and fewer downstream reads) | S–M | Low–Med |
| 3 | Bound the agent: `--max-turns`, `--allowedTools`, `--strict-mcp-config`, disable thinking on cheap steps | 10–30% + kills runaway loops | S | Low |
| 4 | **PageRank / tree-sitter repo map** (aider-style) to replace the regex map | Better map at ≤ same tokens → fewer reads | M | Med |
| 5 | **Embeddings/RAG retrieval** over a repo index to pick the top-k files, injected instead of a full map | 50–80% on large repos | L | Med–High |
| 6 | Test-output & log filtering via **PreToolUse hooks** | 5–20% (verbose repos) | S–M | Low |
| 7 | Cheaper spec/classify: keep repo out of classify, one-shot JSON spec on haiku | small but already mostly done | S | Low |

Legend: S ≈ hours, M ≈ 1–2 days, L ≈ 3–5 days.

---

## \#1 (DO THIS FIRST) — Make the CLI prefix cacheable across invocations

### What it is
Claude Code re-sends the full context every API request and lets the server cache the stable *prefix* (system prompt + project context), billing re-reads at ~10% of input rate. The catch is the cache key. Two levers:

1. **`--exclude-dynamic-system-prompt-sections`** (the non-interactive CLI equivalent of the SDK's `excludeDynamicSections: true`). It moves the per-session junk (working dir, git-repo flag, platform, shell, OS version, auto-memory paths) *out of the system prompt and into the first user message*, so the system prompt becomes byte-identical across worktrees/branches/machines and can share one cache entry. Without this, every worktree misses.
2. **A stable, front-loaded prefix.** Put everything that repeats across tasks (the repo map, standing instructions) at the *front* of the user prompt, and the task-specific text at the *end*. Cache is prefix-match and exact — any earlier byte change recomputes everything after it. Today `runTaskReal` builds the prompt as `promptText` first, then the repo map — i.e. the *variable* part is in front of the *stable* part, defeating even same-dir reuse. **Invert it.**
3. **TTL.** On a Claude subscription the CLI already requests the 1-hour TTL automatically. On an API key it defaults to 5 min — set `ENABLE_PROMPT_CACHING_1H=1` in the runner's env so bursts of tasks within an hour keep hitting the warm cache. (Cost tradeoff: 1h cache *writes* bill at 2× vs 1.25× for 5m, but reads are 0.1× either way — worth it when >1 task/repo/hour.)

### Expected savings
The repo map + standing instructions + Claude Code's own system prompt/tools are the bulk of the fixed ~200k. Moving from "always uncached" to "cached read" bills that block at ~10% of input rate. For a repo where 2+ tasks run within the TTL, that's a **40–90% reduction in input-token cost on every task after the first**, and lower latency (Anthropic cites up to 90% cost / 85% latency on long prompts with the 1h TTL).

### How to implement (in `runner/runner.js`)
1. **Add the flag** in `claudeFlags()`:
   ```js
   f.push('--exclude-dynamic-system-prompt-sections');
   ```
   (Applies to `runClaude`, `runClaudeJson`, `runClaudeStream`.)
2. **Front-load the stable prefix.** In `runTaskReal`, reorder `claudePrompt` so it is:
   ```
   [ standing instructions ] + <repo_map>…</repo_map> + \n\n---\nTASK:\n + promptText + goal
   ```
   Keep the standing-instructions + map text **byte-identical** between tasks on the same repo/HEAD (it already is, since the map is cached by HEAD). Do the same in `handleChat`.
3. **Set env once** where the runner spawns `claude` (or in the daemon's own env): `ENABLE_PROMPT_CACHING_1H=1`. Leave the default model/effort fixed per step so you never trip a model/effort cache reset mid-task.
4. **Verify** using the token fields we already parse (`cache_read_input_tokens` vs `cache_creation_input_tokens` in `runClaudeStream`/`runClaudeJson`). Log the read:create ratio per task; a high ratio on the 2nd+ task on a repo proves it works. This is a free built-in A/B.

### Risks
- Env context now lands in the user message, so Claude weighs "current directory / auto-memory" slightly less. For Dispatch that's irrelevant — we pass an explicit repo map and cwd already.
- Flag availability is version-gated. Guard with a `claude --version` check (or a one-time capability probe) and drop the flag on older CLIs.
- Cache is still per-machine unless the flag is set; since Dispatch is one laptop runner, per-machine is fine — the flag's job here is defeating the *per-worktree/per-branch* miss.

---

## \#2 — Task-scoped file lists instead of the whole repo map

### What it is
The map today is repo-wide (up to 3000 symbol lines / 60k chars) and injected in full. Most tasks touch 1–3 files. Two complementary moves:
- **Scope**: run the cheap classify/spec step first, extract likely paths (keywords → `git ls-files` + `grep -l`), and inject only *those* files' symbols in full plus a **shrunken global tree** (paths only, no symbols) for orientation.
- **Trim**: drop vendored/generated dirs (`node_modules`, `dist`, `build`, `.next`, `android/build`, lockfiles) from the map — honor `.gitignore` (we already use `git ls-files`, so add an ignore list for build output that is tracked).

### Expected savings
Repo-wide symbol block is the largest static chunk. Scoping to touched files typically cuts the injected map by **30–60%**, and — more importantly — gives the model a shorter, sharper starting point so it does fewer speculative `Read`/`Grep` calls (which are the *real* token sink in the agent loop). Note: this partly trades against #1 (a per-task-variable map is less cacheable), so keep a **stable global tree as the cached prefix** and append the **task-scoped file bodies after** the cache breakpoint / as the variable tail.

### How to implement
- New `scopedFilesFor(spec, promptText, dir)`: tokenize goal/scope, match against `git ls-files`, rank by filename/path hits, take top N (e.g. 8). Cheap, 0 API tokens.
- Split the prompt: `<repo_map>` (stable global tree, cached) → `<relevant_files>` (task-specific, uncached tail).
- Add a `SKIP_DIRS`/`SKIP_GLOBS` set to `buildRepoMap`.

### Risks
- Wrong file scoping → model has to search anyway (net-neutral, not worse, because it can still `Grep`). Keep the global tree so it can always recover.
- Slightly less cache reuse on the variable tail — acceptable; the big prefix stays cached.

---

## \#3 — Bound the agent (turns, tools, thinking)

### What it is
Cap the blast radius of a single run with CLI flags:
- `--max-turns N` — hard ceiling on agentic loops (print-mode only). Prevents a stuck task from burning the whole `--max-budget-usd`.
- `--allowedTools "Read Edit Write Bash Grep Glob"` (+ `--disallowedTools` for anything unwanted) — fewer tool defs in the system prompt and no surprise tools.
- `--strict-mcp-config` (with no `--mcp-config`) — ignore any ambient MCP servers so their tool schemas never bloat the system prompt. (Dispatch doesn't need MCP for edits.)
- `MAX_THINKING_TOKENS=…` or lower effort for the classify/spec steps — thinking tokens bill as output; trivial steps don't need them.

### Expected savings
`--strict-mcp-config` + trimmed tools shave fixed system-prompt overhead on *every* request (compounds with #1's caching). `--max-turns` is mostly a *cost-ceiling / safety* win. Reducing thinking on haiku steps: **10–30%** on those steps.

### How to implement
Extend `claudeFlags()` to accept `{ maxTurns, allowedTools, strictMcp }` and pass them from each call site. Set `MAX_THINKING_TOKENS` (e.g. `8000`) in the env for classify/spec; leave edit step full-effort.

### Risks
- `--max-turns` too low → tasks abort mid-edit and return FAILED. Tune per task type (classify=1, edit=high). Handle the "max turns reached" exit as a graceful BLOCKED, not a crash.
- Over-restricting tools can break a legitimate edit; keep the standard edit toolset.

---

## \#4 — Tree-sitter + PageRank repo map (aider-style)

### What it is
Replace the regex `SYMBOL_RE` map with a real one: parse each file with **tree-sitter** (per-language `tags.scm` queries) to extract precise defs/refs, build a graph (files = nodes, symbol references = edges), run **PageRank**, and emit only the highest-ranked identifiers up to a token budget (aider's default is ~1k map-tokens and it's remarkably navigable). This is strictly better signal-per-token than "first 40 top-level lines per file."

### Expected savings
Not a raw-token cut vs our current map necessarily — it's *quality per token*: the model orients faster and does fewer exploratory reads, which is where tokens actually go in the loop. On large/unfamiliar repos this is the difference between 3 reads and 15.

### How to implement
- Add `web-tree-sitter` (WASM grammars, no native build) or `tree-sitter` + language packages to `runner/`.
- Build the graph + a small PageRank (or reuse a lib). Cache the ranked map on disk keyed by HEAD exactly like today.
- Feed the ranked symbols into the same `<repo_map>` slot, so #1/#2 still apply.

### Risks
- Grammar coverage: unsupported languages fall back to the current regex map (aider does the same). Keep the regex path as fallback.
- More runner dependencies / first-run indexing time (mitigated by the HEAD-keyed cache).

---

## \#5 — Embeddings / RAG retrieval over a repo index

### What it is
Build a persistent per-repo index of file/chunk embeddings (keyed by HEAD, incremental on changed files). At task time, embed the task text, retrieve top-k chunks/files, and inject *those* (or their paths) instead of a whole-repo map. This is the classic "don't scan the repo, retrieve into it" approach.

### Expected savings
Largest on big repos where even a good map is huge: **50–80%** of context vs full-map approaches, because you inject only semantically relevant slices.

### How to implement
- Local embedding model (e.g. a small ONNX/`fastembed` model) or a cheap embeddings API; store vectors in a local file/SQLite (`~/.dispatch/repo-index/<repo>.vec`).
- Incremental: only re-embed files whose blob hash changed since last HEAD (diff `git ls-files -s`).
- At task time: retrieve top-k → feed as the task-scoped tail (pairs with #2).

### Risks
- Embedding infra + drift management is real work; index staleness if not incremental.
- Retrieval misses can hurt quality — always keep the global tree as a fallback so the agent can still search.
- Higher complexity than #1–#4 for a laptop runner; do this only if repos are large enough to justify it.

---

## \#6 — Filter verbose tool output via PreToolUse hooks

### What it is
A `PreToolUse` hook can rewrite Bash commands so, e.g., `npm test` returns only failing lines instead of thousands of lines of passing output — turning tens of thousands of tokens into hundreds. Dispatch already runs tests (`runDetectedTests`) but that output is separate; the win is when *Claude itself* runs tests/logs during the edit loop.

### Expected savings
**5–20%** on repos with chatty test/build output; situational.

### How to implement
- Ship a `.claude/settings.json` (or `--settings` inline) with a `PreToolUse` matcher on `Bash` pointing at a filter script (grep failures/errors, `head -100`). Pass it via `--settings` so it's scoped to the runner's invocation.

### Risks
- Over-filtering can hide the very error the model needs. Filter conservatively (keep FAIL/ERROR + a few lines of context).

---

## \#7 — Cheaper spec/classify (mostly already done)

- `classifyIntent` already runs on haiku with **no repo context** (cwd = tmpdir) — good, keep it.
- `generateSpec` asks for one JSON object on haiku — good. Add `--max-turns 1` and lower thinking so it can't loop.
- Consider **merging classify+spec into one haiku call** (one JSON with an `intent` field) to save a whole round-trip on BUILD tasks.

Savings: small in absolute terms, but free.

---

## Suggested implementation order

1. **#1 now** — one flag (`--exclude-dynamic-system-prompt-sections`), invert the prompt so the stable map/instructions lead, set `ENABLE_PROMPT_CACHING_1H=1`, and confirm via the `cache_read_input_tokens` we already log. Hours of work, biggest payoff.
2. **#3** — add `--max-turns` / `--allowedTools` / `--strict-mcp-config`; pure safety + fixed-overhead trim, composes with #1.
3. **#2** — task-scoped file tail + trim build dirs from the map.
4. **#4** — upgrade the map to tree-sitter+PageRank when you want better navigation.
5. **#6 / #5** — hooks for chatty repos; RAG only if repos are large enough to need it.

---

## Sources

- Anthropic — [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching) (cache scope = machine+directory+git-snapshot; worktrees miss; TTL/env vars `ENABLE_PROMPT_CACHING_1H`, `FORCE_PROMPT_CACHING_5M`, `DISABLE_PROMPT_CACHING`; `cache_read_input_tokens` / `cache_creation_input_tokens`).
- Anthropic — [Improve prompt caching across users and machines](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts#improve-prompt-caching-across-users-and-machines) (`excludeDynamicSections` / `--exclude-dynamic-system-prompt-sections`).
- Anthropic — [Prompt caching (API reference)](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) (`cache_control: {type:"ephemeral", ttl:"1h"}`, 1.25× vs 2× write premium, 0.1× reads, ≤4 breakpoints, prefix-match).
- Anthropic — [Manage costs / reduce token usage](https://code.claude.com/docs/en/costs) (model routing, `--strict-mcp-config`, MCP overhead, PreToolUse output-filtering hook, thinking budget `MAX_THINKING_TOKENS`, specific prompts, subagent offloading).
- Anthropic — [CLI reference](https://code.claude.com/docs/en/cli-reference) (`--max-turns`, `--allowedTools`, `--disallowedTools`, `--strict-mcp-config`, `--append-system-prompt`, `--exclude-dynamic-system-prompt-sections`, `--settings`).
- Anthropic — [Lessons from building Claude Code: prompt caching is everything](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything).
- Anthropic (X) — [Extended 1-hour cache TTL announcement](https://x.com/AnthropicAI/status/1925633128174899453) (up to 90% cost / 85% latency on long prompts).
- aider — [Building a better repository map with tree-sitter](https://aider.chat/2023/10/22/repomap.html) and [Repository map](https://aider.chat/docs/repomap.html) (tree-sitter `tags.scm`, PageRank over the symbol graph, `--map-tokens` default ~1k).
