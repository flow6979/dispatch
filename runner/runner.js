#!/usr/bin/env node
'use strict';

/**
 * Dispatch — Laptop Runner daemon (v0 MVP)
 *
 * Implements the RUNNER side of dispatch/PROTOCOL.md exactly.
 *
 * Connects to the backend over WebSocket as role=runner, registers, and
 * handles two Backend→Runner messages:
 *   - generate_spec  → replies spec_result
 *   - run_task       → streams progress, ends with a terminal result
 *
 * Two operating modes for run_task:
 *   - STUB  (DISPATCH_STUB unset or =1, the DEFAULT): never touches
 *           git/gh/claude. Simulates progress over ~4s, returns a fake PR.
 *   - REAL  (DISPATCH_STUB=0): clone → worktree → claude → tests →
 *           commit/push → draft PR. Draft PRs only, never merges.
 *
 * Also supports `node runner.js --selftest` which exercises the stub
 * generate_spec + run_task logic locally with NO websocket, printing every
 * message that would be emitted. Lets us verify correctness standalone
 * before the backend exists.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { nanoid } = require('nanoid');

// ---------------------------------------------------------------------------
// Configuration (all overridable via env, per PROTOCOL "Ports & scripts")
// ---------------------------------------------------------------------------

// DISPATCH_BACKEND may be a bare host ("localhost:4000") or a full origin
// ("https://dispatch-backend.onrender.com"). Derive the ws/wss scheme from it
// so a hosted HTTPS backend uses a secure socket.
const RAW_BACKEND = process.env.DISPATCH_BACKEND || 'localhost:4000';
let WS_SECURE = false;
let BACKEND_HOST = RAW_BACKEND;
{
  const m = RAW_BACKEND.match(/^(https?|wss?):\/\/(.+)$/);
  if (m) {
    WS_SECURE = m[1] === 'https' || m[1] === 'wss';
    BACKEND_HOST = m[2];
  } else if (process.env.DISPATCH_SECURE === '1') {
    WS_SECURE = true;
  }
  BACKEND_HOST = BACKEND_HOST.replace(/\/+$/, '');
}
const WS_SCHEME = WS_SECURE ? 'wss' : 'ws';
const TOKEN = 'dev-token';
const RUNNER_NAME = process.env.RUNNER_NAME || os.hostname();

// Real machine identity, sent on register so the phone can show WHAT is
// connecting and require explicit approval before it's used.
function ghLoginSync() {
  try {
    const res = spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8', timeout: 10000 });
    if (res.status === 0) return String(res.stdout || '').trim() || null;
  } catch (_) { /* ignore */ }
  return null;
}
const GH_USER = ghLoginSync();
const HOST = os.hostname();
const RUNNER_ID = `${HOST}:${GH_USER || 'unknown'}`;

// Stub mode is the DEFAULT: ON when DISPATCH_STUB is unset OR equals "1".
// Only DISPATCH_STUB=0 turns REAL mode on.
const STUB_MODE = process.env.DISPATCH_STUB !== '0';

const WORKSPACE = process.env.WORKSPACE
  ? expandHome(process.env.WORKSPACE)
  : path.join(os.homedir(), 'dispatch-workspace');

// Budget: wall-clock ceiling for a REAL task and a default token budget.
const DEFAULT_BUDGET_TOKENS = 250000;
const REAL_WALL_CLOCK_MS = Number(process.env.DISPATCH_WALL_MS || 20 * 60 * 1000); // 20 min

// Branch names we refuse to work directly on (default/protected).
const PROTECTED_BRANCHES = new Set([
  'main', 'master', 'develop', 'trunk', 'release', 'production', 'prod',
]);

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// ---------------------------------------------------------------------------
// Small logging helper
// ---------------------------------------------------------------------------

function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[runner ${ts}]`, ...args);
}

// ---------------------------------------------------------------------------
// SPEC generation
// ---------------------------------------------------------------------------

/**
 * Deterministic heuristic spec derived purely from promptText.
 * Used in STUB mode and as the fallback when a REAL `claude` call fails.
 * Shape matches PROTOCOL Task.spec exactly.
 */
function heuristicSpec(promptText) {
  const goal = (promptText && String(promptText).trim()) || 'Unspecified task';
  return {
    goal,
    scope: ['(to be determined)'],
    acceptance: ['existing tests pass'],
    assumptions: [
      {
        statement: 'The change can be made without altering public interfaces.',
        reversible: true,
      },
    ],
    risk: 'low',
    confidence: 0.6,
  };
}

/**
 * Coerce arbitrary parsed JSON into a valid spec, filling gaps from the
 * heuristic. Guarantees the PROTOCOL shape no matter what claude emitted.
 */
function normalizeSpec(raw, promptText) {
  const base = heuristicSpec(promptText);
  if (!raw || typeof raw !== 'object') return base;

  const asArray = (v, fallback) =>
    Array.isArray(v) && v.length ? v.map(String) : fallback;

  let assumptions = base.assumptions;
  if (Array.isArray(raw.assumptions) && raw.assumptions.length) {
    assumptions = raw.assumptions.map((a) => {
      if (a && typeof a === 'object') {
        return {
          statement: String(a.statement != null ? a.statement : a),
          reversible: a.reversible !== false,
        };
      }
      return { statement: String(a), reversible: true };
    });
  }

  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = base.confidence;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    goal: raw.goal ? String(raw.goal) : base.goal,
    scope: asArray(raw.scope, base.scope),
    acceptance: asArray(raw.acceptance, base.acceptance),
    assumptions,
    risk: raw.risk ? String(raw.risk) : base.risk,
    confidence,
  };
}

/** Best-effort extraction of the first JSON object from arbitrary text. */
function extractJson(text) {
  if (!text) return null;
  // Fast path: whole thing is JSON.
  try {
    return JSON.parse(text);
  } catch (_) { /* fall through */ }
  // Strip markdown fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch (_) { /* fall through */ }
  }
  // Grab the first balanced-looking {...} span.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (_) { /* fall through */ }
  }
  return null;
}

/**
 * Produce a spec for a task.
 * REAL mode: ask `claude -p` for JSON, parse, normalize. On any failure,
 * fall back to the heuristic. STUB mode: heuristic directly.
 */
async function generateSpec({ promptText, repo, baseBranch, workBranch }) {
  if (STUB_MODE) {
    return heuristicSpec(promptText);
  }

  const prompt =
    'You are a senior engineer scoping a coding task. ' +
    'Output ONLY a single JSON object (no prose, no markdown fences) with EXACTLY these keys: ' +
    'goal (string), scope (array of strings), acceptance (array of strings), ' +
    'assumptions (array of objects each with "statement" string and "reversible" boolean), ' +
    'risk (one of "low","medium","high"), confidence (number 0..1). ' +
    `Repo: ${repo}. Base branch: ${baseBranch}. Work branch: ${workBranch}. ` +
    `Task: ${promptText}`;

  try {
    const out = await runClaude(prompt, { cwd: process.cwd(), timeoutMs: 120000 });
    const parsed = extractJson(out);
    if (!parsed) throw new Error('could not parse JSON from claude output');
    return normalizeSpec(parsed, promptText);
  } catch (err) {
    log('generateSpec: claude failed, using heuristic:', err.message);
    return heuristicSpec(promptText);
  }
}

// ---------------------------------------------------------------------------
// child_process helpers
// ---------------------------------------------------------------------------

/** Run `claude -p <prompt>` and resolve with stdout. Rejects on error/timeout. */
function runClaude(prompt, { cwd, timeoutMs = 120000 } = {}) {
  return run('claude', ['-p', prompt], { cwd, timeoutMs });
}

/**
 * Run claude in JSON mode so we get the real token usage back. Resolves
 * { text, tokens } where tokens is the total input+output+cache for this call.
 * Falls back to plain text (tokens 0) if JSON parsing fails.
 */
async function runClaudeJson(prompt, { cwd, timeoutMs = 120000 } = {}) {
  const out = await run('claude', ['-p', prompt, '--output-format', 'json'], { cwd, timeoutMs });
  try {
    const d = JSON.parse(out);
    const u = d.usage || {};
    const tokens =
      (u.input_tokens || 0) +
      (u.output_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0);
    return { text: typeof d.result === 'string' ? d.result : out, tokens };
  } catch (_) {
    return { text: out, tokens: 0 };
  }
}

/** Generic command runner. Resolves {stdout} on exit 0, rejects otherwise. */
function run(cmd, args, { cwd, timeoutMs = 120000, env } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    const child = spawn(cmd, args, {
      cwd,
      env: env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`${cmd} spawn failed: ${err.message}`));
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

/**
 * Fetch the operator's real GitHub repos via the laptop's authed `gh`.
 * The hosted backend has no gh auth, so it relies on the runner for this.
 * Best-effort: returns [] on any failure (backend keeps its stub fallback).
 */
async function fetchRepos() {
  if (!hasBinary('gh')) return [];
  try {
    const out = await run('gh', ['repo', 'list', '--limit', '50', '--json', 'name,defaultBranchRef'], { timeoutMs: 20000 });
    const parsed = JSON.parse(out);
    return parsed.map((r) => ({
      name: r.name,
      defaultBranch: (r.defaultBranchRef && r.defaultBranchRef.name) || 'main',
    }));
  } catch (err) {
    log('fetchRepos failed (continuing without real repo list):', err.message);
    return [];
  }
}

/** Synchronous check whether a binary exists on PATH. */
function hasBinary(name) {
  const res = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
    stdio: 'ignore',
  });
  return res.status === 0;
}

// ---------------------------------------------------------------------------
// Confidence-first summary
// ---------------------------------------------------------------------------

function confidenceSummary(spec, extra) {
  const conf = spec && Number.isFinite(spec.confidence) ? spec.confidence : 0.6;
  const risk = (spec && spec.risk) || 'low';
  const pct = Math.round(conf * 100);
  const goal = (spec && spec.goal) || 'task';
  let s = `Confidence ${pct}% (risk: ${risk}). ${goal}.`;
  if (extra) s += ` ${extra}`;
  return s;
}

// ---------------------------------------------------------------------------
// STUB run_task
// ---------------------------------------------------------------------------

/**
 * STUB run_task: emit progress over ~4s, then a terminal PR_OPEN result.
 * `emit(msg)` is the sink for Runner→Backend messages.
 * `sleep` is injectable so --selftest can run fast if needed (defaults real).
 */
async function runTaskStub(task, emit, sleep = defaultSleep) {
  const { taskId, spec, repo } = task;

  emit({ type: 'progress', taskId, state: 'RUNNING', message: 'starting (stub)', pct: 20 });
  await sleep(1200);

  emit({ type: 'progress', taskId, state: 'RUNNING', message: 'applying changes (stub)', pct: 50 });
  await sleep(1200);

  emit({ type: 'progress', taskId, state: 'TESTS', message: 'running tests (stub)', pct: 80 });
  await sleep(1200);

  const repoName = repo || 'acme/repo';
  const prUrl = `https://github.com/${repoName}/pull/999`;
  emit({
    type: 'result',
    taskId,
    state: 'PR_OPEN',
    prUrl,
    summary: confidenceSummary(spec, `Draft PR opened at ${prUrl} (stub mode — no real changes made).`),
  });
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// REAL run_task
// ---------------------------------------------------------------------------

/**
 * REAL run_task. Never throws to caller: always emits exactly one terminal
 * `result` (PR_OPEN | FAILED | BLOCKED). Draft PRs only.
 */
async function runTaskReal(task, emit) {
  const { taskId, promptText, spec, repo, baseBranch, workBranch, budgetTokens } = task;
  const budget = budgetTokens || DEFAULT_BUDGET_TOKENS;
  const deadline = Date.now() + REAL_WALL_CLOCK_MS;
  const timeLeft = () => deadline - Date.now();

  const fail = (state, message) => {
    emit({ type: 'result', taskId, state, prUrl: null, summary: message });
  };

  try {
    // Guard: refuse protected/default branches.
    if (!workBranch || PROTECTED_BRANCHES.has(String(workBranch).toLowerCase())) {
      return fail(
        'BLOCKED',
        `Refusing to work on protected/default branch "${workBranch}". Provide a non-default work branch.`,
      );
    }
    if (workBranch === baseBranch) {
      return fail(
        'BLOCKED',
        `Work branch "${workBranch}" equals base branch "${baseBranch}"; refusing.`,
      );
    }
    if (!repo) return fail('BLOCKED', 'No repo specified.');

    // Tooling checks.
    if (!hasBinary('git')) return fail('FAILED', 'git not found on PATH.');

    emit({ type: 'progress', taskId, state: 'RUNNING', message: `preparing workspace ${WORKSPACE}`, pct: 5 });
    fs.mkdirSync(WORKSPACE, { recursive: true });

    // (a) Ensure repo cloned under WORKSPACE.
    const repoSlug = String(repo).replace(/[^A-Za-z0-9._/-]/g, '_');
    const repoDirName = repoSlug.split('/').pop();
    const repoDir = path.join(WORKSPACE, repoDirName);

    if (!fs.existsSync(path.join(repoDir, '.git'))) {
      emit({ type: 'progress', taskId, state: 'RUNNING', message: `cloning ${repo}`, pct: 10 });
      try {
        if (hasBinary('gh')) {
          await run('gh', ['repo', 'clone', repo, repoDir], { cwd: WORKSPACE, timeoutMs: 300000 });
        } else {
          await run('git', ['clone', `https://github.com/${repo}.git`, repoDir], {
            cwd: WORKSPACE, timeoutMs: 300000,
          });
        }
      } catch (err) {
        return fail('FAILED', `Clone failed: ${err.message}`);
      }
    } else {
      emit({ type: 'progress', taskId, state: 'RUNNING', message: 'repo already present, fetching', pct: 10 });
      try {
        await run('git', ['fetch', 'origin'], { cwd: repoDir, timeoutMs: 120000 });
      } catch (err) {
        log('fetch failed (continuing):', err.message);
      }
    }

    // Determine the repo's actual default branch and refuse if workBranch is it.
    let defaultBranch = null;
    try {
      const out = await run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: repoDir, timeoutMs: 30000 });
      defaultBranch = out.trim().split('/').pop();
    } catch (_) { /* best-effort */ }
    if (defaultBranch && workBranch === defaultBranch) {
      return fail('BLOCKED', `Work branch "${workBranch}" is the repo default branch; refusing.`);
    }

    // (b) git worktree add on workBranch off baseBranch.
    const worktreeDir = path.join(WORKSPACE, `${repoDirName}__${workBranch.replace(/[^A-Za-z0-9._-]/g, '_')}`);
    emit({ type: 'progress', taskId, state: 'RUNNING', message: `creating worktree on ${workBranch}`, pct: 15 });
    try {
      if (fs.existsSync(worktreeDir)) {
        await run('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: repoDir, timeoutMs: 60000 }).catch(() => {});
      }
      const baseRef = baseBranch ? `origin/${baseBranch}` : (defaultBranch ? `origin/${defaultBranch}` : 'HEAD');
      await run('git', ['worktree', 'add', '-b', workBranch, worktreeDir, baseRef], {
        cwd: repoDir, timeoutMs: 120000,
      });
    } catch (err) {
      return fail('FAILED', `worktree add failed: ${err.message}`);
    }

    if (timeLeft() <= 0) return fail('FAILED', 'Wall-clock budget exhausted before edits.');

    // (c) Run claude inside the worktree.
    emit({ type: 'progress', taskId, state: 'RUNNING', message: 'invoking claude to make changes', pct: 40 });
    const goal = (spec && spec.goal) || '';
    const claudePrompt =
      `${promptText}\n\nGoal: ${goal}\n\n` +
      'Make the necessary code changes in this repository to accomplish the task. ' +
      'Do not commit or push; leave changes in the working tree.';
    if (!hasBinary('claude')) {
      return fail('FAILED', 'claude CLI not found on PATH.');
    }
    let tokensUsed = 0;
    try {
      const res = await runClaudeJson(claudePrompt, { cwd: worktreeDir, timeoutMs: Math.min(timeLeft(), 15 * 60 * 1000) });
      tokensUsed = res.tokens || 0;
      emit({ type: 'progress', taskId, state: 'RUNNING', message: `claude made changes (${tokensUsed.toLocaleString()} tokens)`, pct: 60, tokensUsed });
    } catch (err) {
      return fail('FAILED', `claude edit step failed: ${err.message}`);
    }

    if (timeLeft() <= 0) return fail('FAILED', 'Wall-clock budget exhausted after edits.');

    // (d) Detect and run test command.
    emit({ type: 'progress', taskId, state: 'TESTS', message: 'running tests', pct: 70 });
    const testResult = await runDetectedTests(worktreeDir, Math.min(timeLeft(), 10 * 60 * 1000));
    if (testResult.ran && !testResult.passed) {
      return fail('FAILED', `Tests failed (${testResult.command}): ${testResult.message}`);
    }

    // (e) commit & push.
    emit({ type: 'progress', taskId, state: 'TESTS', message: 'committing and pushing', pct: 85 });
    try {
      await run('git', ['add', '-A'], { cwd: worktreeDir, timeoutMs: 60000 });
      // If nothing changed, that's a blocked outcome — no PR to open.
      const status = await run('git', ['status', '--porcelain'], { cwd: worktreeDir, timeoutMs: 30000 });
      if (!status.trim()) {
        return fail('BLOCKED', 'No changes were produced; nothing to open a PR for.');
      }
      await run('git', ['commit', '-m', `dispatch: ${goal || promptText}`.slice(0, 200)], {
        cwd: worktreeDir, timeoutMs: 60000,
      });
      await run('git', ['push', '-u', 'origin', workBranch], { cwd: worktreeDir, timeoutMs: 180000 });
    } catch (err) {
      return fail('FAILED', `git commit/push failed: ${err.message}`);
    }

    // (f) Draft PR only. Never merge.
    emit({ type: 'progress', taskId, state: 'PR_OPEN', message: 'opening draft PR', pct: 95 });
    let prUrl = null;
    if (hasBinary('gh')) {
      try {
        const out = await run(
          'gh',
          ['pr', 'create', '--draft', '--fill', '--base', baseBranch || defaultBranch || 'main', '--head', workBranch],
          { cwd: worktreeDir, timeoutMs: 120000 },
        );
        const m = out.match(/https?:\/\/\S+/);
        prUrl = m ? m[0] : out.trim();
      } catch (err) {
        return fail('FAILED', `gh pr create failed: ${err.message}`);
      }
    } else {
      return fail('FAILED', 'gh CLI not found; pushed branch but could not open a draft PR.');
    }

    // (g) Terminal success.
    emit({
      type: 'result',
      taskId,
      state: 'PR_OPEN',
      prUrl,
      tokensUsed,
      summary: confidenceSummary(
        spec,
        `Draft PR opened at ${prUrl}. Tests: ${testResult.ran ? (testResult.passed ? 'passed' : 'failed') : 'none detected'}. Used ~${tokensUsed.toLocaleString()} tokens.`,
      ),
    });
  } catch (err) {
    // Absolute backstop: never end without a terminal result.
    fail('FAILED', `Unexpected error: ${err && err.message ? err.message : String(err)}`);
  }
}

/** Detect a test command from the worktree and run it. */
async function runDetectedTests(dir, timeoutMs) {
  let command = null;
  let args = [];
  if (fs.existsSync(path.join(dir, 'package.json'))) {
    command = 'npm'; args = ['test'];
  } else if (fs.existsSync(path.join(dir, 'Gemfile'))) {
    command = 'bundle'; args = ['exec', 'rspec'];
  } else if (
    fs.existsSync(path.join(dir, 'pytest.ini')) ||
    fs.existsSync(path.join(dir, 'pyproject.toml')) ||
    fs.existsSync(path.join(dir, 'setup.py')) ||
    fs.existsSync(path.join(dir, 'tox.ini'))
  ) {
    command = 'pytest'; args = [];
  }

  if (!command) return { ran: false, passed: true, command: null, message: 'no test command detected' };
  if (!hasBinary(command)) {
    return { ran: false, passed: true, command, message: `${command} not installed; skipping tests` };
  }

  try {
    await run(command, args, { cwd: dir, timeoutMs });
    return { ran: true, passed: true, command: `${command} ${args.join(' ')}`.trim(), message: 'ok' };
  } catch (err) {
    return { ran: true, passed: false, command: `${command} ${args.join(' ')}`.trim(), message: err.message };
  }
}

// ---------------------------------------------------------------------------
// Message dispatch (shared by WS handler and selftest)
// ---------------------------------------------------------------------------

async function handleGenerateSpec(msg, emit) {
  const spec = await generateSpec({
    promptText: msg.promptText,
    repo: msg.repo,
    baseBranch: msg.baseBranch,
    workBranch: msg.workBranch,
  });
  emit({ type: 'spec_result', taskId: msg.taskId, spec });
}

async function handleRunTask(msg, emit, sleep) {
  const task = {
    taskId: msg.taskId,
    promptText: msg.promptText,
    spec: msg.spec,
    repo: msg.repo,
    baseBranch: msg.baseBranch,
    workBranch: msg.workBranch,
    budgetTokens: msg.budgetTokens,
  };
  if (STUB_MODE) {
    await runTaskStub(task, emit, sleep);
  } else {
    await runTaskReal(task, emit);
  }
}

// ---------------------------------------------------------------------------
// WebSocket client with auto-reconnect + backoff
// ---------------------------------------------------------------------------

function startWsClient() {
  const WebSocket = require('ws');
  const url = `${WS_SCHEME}://${BACKEND_HOST}/ws?role=runner&token=${TOKEN}`;
  let backoff = 1000;
  const MAX_BACKOFF = 30000;
  let ws = null;
  let stopping = false;

  let heartbeat = null;
  const HEARTBEAT_MS = 20000; // ping cadence; also keeps Render's proxy from idling us out

  function stopHeartbeat() {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  }

  function connect() {
    log(`connecting to ${url} (mode=${STUB_MODE ? 'STUB' : 'REAL'}, runner=${RUNNER_NAME})`);
    ws = new WebSocket(url);
    let alive = true;

    const emit = (obj) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
      } else {
        log('drop message (socket not open):', obj.type);
      }
    };

    ws.on('pong', () => { alive = true; });

    ws.on('open', () => {
      backoff = 1000; // reset on successful connect
      log('connected; registering');
      emit({
        type: 'register',
        runnerName: RUNNER_NAME,
        host: HOST,
        ghUser: GH_USER,
        runnerId: RUNNER_ID,
        capabilities: ['git', 'gh', 'claude'],
      });
      // Heartbeat: Render's free tier silently drops idle WebSocket
      // connections. Without this the runner half-closes — it thinks it's
      // connected while the backend shows 0 runners and tasks wait forever.
      // Ping keeps the pipe warm; a missing pong forces a reconnect.
      stopHeartbeat();
      alive = true;
      heartbeat = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (!alive) {
          log('no pong since last ping; connection is dead, terminating to reconnect');
          try { ws.terminate(); } catch (_) { /* ignore */ }
          return;
        }
        alive = false;
        try { ws.ping(); } catch (_) { /* ignore */ }
      }, HEARTBEAT_MS);
      // Push the operator's real repo list to the backend (it has no gh auth).
      // Async so registration/connect isn't blocked on the gh call.
      fetchRepos().then((repos) => {
        if (repos.length) {
          log(`sending ${repos.length} repo(s) to backend`);
          emit({ type: 'repos', repos });
        }
      });
    });

    ws.on('message', async (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (err) {
        log('ignoring non-JSON message:', err.message);
        return;
      }
      try {
        if (msg.type === 'generate_spec') {
          log(`generate_spec task=${msg.taskId}`);
          await handleGenerateSpec(msg, emit);
        } else if (msg.type === 'run_task') {
          log(`run_task task=${msg.taskId} (${STUB_MODE ? 'STUB' : 'REAL'})`);
          await handleRunTask(msg, emit);
        } else {
          log('unhandled message type:', msg.type);
        }
      } catch (err) {
        // Never fail silently: emit a terminal FAILED result if we have a taskId.
        log('handler error:', err && err.message);
        if (msg && msg.taskId) {
          emit({
            type: 'result',
            taskId: msg.taskId,
            state: 'FAILED',
            prUrl: null,
            summary: `Runner error: ${err && err.message ? err.message : String(err)}`,
          });
        }
      }
    });

    ws.on('close', () => {
      stopHeartbeat();
      if (stopping) return;
      log(`socket closed; reconnecting in ${backoff}ms`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
    });

    ws.on('error', (err) => {
      log('socket error:', err.message);
      // 'close' will follow and drive the reconnect.
    });
  }

  connect();

  process.on('SIGINT', () => {
    stopping = true;
    log('shutting down');
    if (ws) ws.close();
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Self-test: run stub logic locally with NO websocket, print emitted messages
// ---------------------------------------------------------------------------

async function runSelfTest() {
  const emitted = [];
  const emit = (obj) => {
    emitted.push(obj);
    console.log('EMIT ' + JSON.stringify(obj));
  };
  // Fast sleep so the self-test finishes quickly while still ordering messages.
  const fastSleep = () => Promise.resolve();

  console.log('=== SELFTEST: mode =', STUB_MODE ? 'STUB' : 'REAL', '(selftest forces stub logic) ===');
  console.log('--- generate_spec ---');
  await handleGenerateSpec(
    {
      type: 'generate_spec',
      taskId: 't_' + nanoid(6),
      promptText: 'Add retry logic to the webhook',
      repo: 'acme/payment-service',
      baseBranch: 'main',
      workBranch: 'fix/webhook-retry',
    },
    emit,
  );

  console.log('--- run_task (stub) ---');
  const runTaskId = 't_' + nanoid(6);
  // Force stub path regardless of DISPATCH_STUB so selftest never touches git/gh.
  await runTaskStub(
    {
      taskId: runTaskId,
      promptText: 'Add retry logic to the webhook',
      spec: heuristicSpec('Add retry logic to the webhook'),
      repo: 'acme/payment-service',
      baseBranch: 'main',
      workBranch: 'fix/webhook-retry',
      budgetTokens: DEFAULT_BUDGET_TOKENS,
    },
    emit,
    fastSleep,
  );

  // Assertions to prove protocol conformance.
  const problems = [];
  const specMsg = emitted.find((m) => m.type === 'spec_result');
  if (!specMsg) problems.push('missing spec_result');
  else {
    const s = specMsg.spec;
    for (const k of ['goal', 'scope', 'acceptance', 'assumptions', 'risk', 'confidence']) {
      if (!(k in s)) problems.push(`spec missing key ${k}`);
    }
    if (!Array.isArray(s.scope)) problems.push('spec.scope not array');
    if (!Array.isArray(s.assumptions) || !s.assumptions[0] || typeof s.assumptions[0].reversible !== 'boolean') {
      problems.push('spec.assumptions malformed');
    }
  }
  const progresses = emitted.filter((m) => m.type === 'progress');
  const result = emitted.find((m) => m.type === 'result');
  if (progresses.length < 3) problems.push('expected >=3 progress messages');
  if (!progresses.some((p) => p.state === 'RUNNING' && p.pct === 20)) problems.push('missing RUNNING pct 20');
  if (!progresses.some((p) => p.state === 'RUNNING' && p.pct === 50)) problems.push('missing RUNNING pct 50');
  if (!progresses.some((p) => p.state === 'TESTS' && p.pct === 80)) problems.push('missing TESTS pct 80');
  if (!result) problems.push('missing terminal result');
  else {
    if (result.state !== 'PR_OPEN') problems.push('result state not PR_OPEN');
    if (result.prUrl !== 'https://github.com/acme/payment-service/pull/999') problems.push('unexpected prUrl');
    if (!result.summary || !/confidence/i.test(result.summary)) problems.push('summary not confidence-first');
  }

  console.log('--- checks ---');
  if (problems.length === 0) {
    console.log('SELFTEST PASS: all protocol assertions held (' + emitted.length + ' messages emitted)');
    process.exit(0);
  } else {
    console.log('SELFTEST FAIL:');
    for (const p of problems) console.log('  - ' + p);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    runSelfTest().catch((err) => {
      console.error('SELFTEST ERROR:', err);
      process.exit(1);
    });
  } else {
    startWsClient();
  }
}

module.exports = {
  heuristicSpec,
  normalizeSpec,
  extractJson,
  generateSpec,
  runTaskStub,
  runTaskReal,
  confidenceSummary,
  handleGenerateSpec,
  handleRunTask,
};
