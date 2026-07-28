# Dispatch — Repo & Branch Navigation Flow (voice/text)

The navigation spine: **authenticate → pick a repo → pick or create a branch → work by prompting** — every step doable by voice *or* text. Once repo + branch are set, that becomes the **active working context**, and subsequent prompts are tasks executed against it.

---

## Core concept: the "Working Context"

```
WorkingContext = {
  repo:        <owner/name>,
  baseBranch:  <branch you branched from, e.g. main>,
  workBranch:  <branch you're working on, existing or newly created>,
}
```
- Every task the agent runs carries a snapshot of this context.
- One context is "active" at a time in voice mode; switching repos/branches resets it.
- Queued overnight tasks each remember their own context, so parallel work across repos is fine.
- `"What am I working on?"` always reads the active context back.

---

## Step 1 — Authenticate & load repos

- **GitHub App** OAuth (fine-grained, per-repo, revocable) — not a personal token.
- On success, backend pulls **only the granted repos** and caches them (name, org, default branch, last-pushed, visibility, protected-branch rules).
- Spoken confirmation: *"Connected. 2 orgs, 47 repositories."*
- Cached so the repo list works offline and voice matching is instant.

**Pain handled:** huge accounts, org permissions, offline access.

---

## Step 2 — Select a repo (search/match-first, never read-all)

You **cannot** enumerate 47 repos by voice — so selection is match-first.

**Text mode:** scrollable list with search + sections: **Pinned**, **Recent**, **All (searchable)**.

**Voice mode:**
| You say | Behaviour |
|---|---|
| "Open the payments repo" | Fuzzy-match name → confirm: *"Opening `acme/payment-service`. Right?"* |
| "Find repos with 'checkout'" | Narrows + reads back top 2–3 matches only |
| "My recent repos" | Reads back last 3 used |
| "Switch to the API repo" | Fuzzy-match → confirm |

**Fuzzy matching is essential** — STT will hear "payments service" for `payment-svc`. Match on normalized name, aliases, and per-user learned nicknames ("the API repo" → `acme/core-api`).

**Disambiguation:** *"I found two — `payment-service` and `payment-worker`. Which one?"* → "the first" / "worker".

**Pinned / recents / nicknames** make the 90% case one utterance.

**Pain handled:** can't read long lists aloud, mis-transcription, repeated access to the same few repos.

---

## Step 3 — Select or create a branch (voice/text)

Once a repo is chosen, detect its **default branch** and **protected-branch rules**.

### Selecting an existing branch
| You say | Behaviour |
|---|---|
| "Work on `staging`" | Match branch → set as workBranch → confirm |
| "What branches are there?" | Reads back recents / matches, not all 200 |
| "Use the branch from yesterday" | Resolves via recent history |

### Creating a branch (low-friction, it's cheap & reversible)
| You say | Behaviour |
|---|---|
| "Create a branch for the login retry fix" | **Auto-suggests a clean name** from intent → *"I'll create `fix/login-retry` off `main`. Go?"* → "yes" |
| "New branch called checkout hotfix" | Normalizes spoken words → `checkout-hotfix`, confirm |
| "Branch off `staging` instead" | Sets a non-default base branch |

**Key voice-safety detail:** users won't spell kebab-case aloud. The agent **generates a sane branch name from the task intent** and reads it back for a one-word confirm — you never dictate slashes and hyphens.

### Branching guardrails
- **Default/protected branch → refuse to work directly.** *"`main` is protected. I'll create a working branch — call it `fix/login-retry`?"* This enforces the "branch-only" invariant from the safety model.
- **Name already exists → offer:** switch to it, or pick a new name.
- **Base branch defaults** to repo default unless you say otherwise.

**Pain handled:** dictating branch names is painful; accidentally committing to main; ambiguous base.

---

## Step 4 — Work by prompting (the active context)

With `{repo, baseBranch, workBranch}` set, plain prompts become tasks against it:

- *"Add retry logic to the payment webhook, up to 3 times on 5xx."* → spec-back → run → PR against `workBranch`.
- Follow-ups stay in context: *"Also add a test for it."*
- *"Open a PR."* / *"Hold it for review."* (voice can queue/hold, **never merge** — per driving-mode lockout).
- *"Switch to the api repo, branch `develop`."* → resets active context.

Every task snapshots the context, so if you queue three and drive off, each runs in the repo/branch it was created in.

---

## Full happy-path (voice, hands-free)

```
You:    "Open the payments repo."
Agent:  "Opening acme/payment-service. Its default branch is main."
You:    "Create a branch for the webhook retry fix."
Agent:  "I'll create fix/webhook-retry off main. Go?"
You:    "Yes."
Agent:  "Done. You're on fix/webhook-retry. What should I do?"
You:    "Add retry with backoff, up to 3 times, only on 5xx, and a test."
Agent:  "So: retry the payment webhook 3× with backoff on 5xx errors,
         plus a test. Correct?"
You:    "Correct."
Agent:  "Running. I'll open a draft PR and ping you when it's ready."
```

---

## Edge cases & handling

| Edge case | Handling |
|---|---|
| No repos granted | Prompt to grant via GitHub App; deep-link to the install screen |
| Very large repo/branch count | Search-first UX; never read-all; top-N + "want more?" |
| Ambiguous repo/branch match | Read back candidates, ask to pick |
| STT mangles a name | Fuzzy match + confirm read-back before acting |
| Trying to work on protected/default | Force a working branch, auto-named |
| Branch name collision | Offer switch-to-existing or rename |
| Offline | Cached repo/branch list; queue selections + branch creation, sync later |
| Stale local clone | Backend spins a fresh worktree from the chosen base per task — no stale state |
| Wrong repo picked | "No, the other one" / "switch to X" re-resolves instantly |
| Permissions changed server-side | Re-sync on next open; drop repos no longer granted |

---

## How it plugs into the architecture

- Repo/branch metadata cached in the backend on GitHub App sync (Step 1).
- Voice matching runs against that cache → instant, offline-tolerant.
- `WorkingContext` lives per-session (voice) and is snapshotted onto every `Task` (so overnight queue items each carry their own repo/branch).
- Branch creation is a "safe write" (cheap, reversible) → one-word voice confirm; working-on-default is a guardrailed action → forced to branch.

---

## New features this flow introduces

- **Match-first repo picker** with pinned / recent / learned-nickname resolution **[MVP]**
- **Intent-to-branch-name generation** ("the login fix" → `fix/login-retry`, confirm) **[MVP]**
- **Protected-branch auto-branching** guardrail **[MVP]**
- **Active Working Context** object + "what am I working on?" read-back **[MVP]**
- **Per-task context snapshot** so queued/overnight work stays in its own repo/branch **[v1]**
- **Learned repo nicknames** ("the API repo") **[v1]**
