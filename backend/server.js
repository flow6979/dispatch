'use strict';

/**
 * Dispatch Backend — async coding-agent orchestrator (v0 MVP).
 *
 * Implements the binding contract in ../PROTOCOL.md:
 *  - REST API on http://0.0.0.0:4000
 *  - WebSocket at /ws  (role=phone | role=runner)
 *  - Full task state machine with 3s auto-proceed after SPEC_DRAFTED.
 *
 * Persistence: a plain JSON file (data.json). No native deps.
 * (Deviation from PROTOCOL's SQLite note — pure-JS persistence per build spec.)
 */

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const Fastify = require('fastify');
const websocket = require('@fastify/websocket');
const cors = require('@fastify/cors');
const { nanoid } = require('nanoid');

const PORT = Number(process.env.PORT) || 4000;
const HOST = '0.0.0.0';
// Shared bootstrap secret. Set DISPATCH_SECRET in the environment to a real
// value; falls back to 'dev-token' for backward-compatible rollout (logs a
// warning). Devices exchange this once for a per-device token.
const SECRET = process.env.DISPATCH_SECRET || 'dev-token';
const DATA_FILE = path.join(__dirname, 'data.json');
const AUTO_PROCEED_MS = 3000;
const DEFAULT_BUDGET_TOKENS = 250000;
const DEFAULT_BUDGET_USD = Number(process.env.DISPATCH_BUDGET_USD || 3);

// ---------------------------------------------------------------------------
// Persistence (JSON file, read on boot, write on every change)
// ---------------------------------------------------------------------------

/** @type {{ tasks: Object<string, any>, context: any, pairedRunners: Object<string, any> }} */
let store = {
  tasks: {}, // id -> Task
  context: { repo: null, baseBranch: null, workBranch: null },
  // runnerId -> { host, ghUser, name, pairedAt }. A runner is only used to run
  // tasks once its machine has been explicitly approved from the phone.
  pairedRunners: {},
  // per-device tokens: token -> { kind:'phone'|'runner', id, label, createdAt }
  deviceTokens: {},
  // user-editable settings
  settings: { digestTime: '07:30', autonomy: 'auto', taskBudgetUsd: 3, push: true, quietHours: true },
  // which approved runner (PC) tasks are dispatched to
  selectedRunnerId: null,
  // phone push tokens: token -> { platform, createdAt } (for FCM/Expo push)
  pushTokens: {},
};

const DEFAULT_SETTINGS = { digestTime: '07:30', autonomy: 'auto', taskBudgetUsd: 3, push: true, quietHours: true };

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      if (raw.trim()) {
        const parsed = JSON.parse(raw);
        store.tasks = parsed.tasks && typeof parsed.tasks === 'object' ? parsed.tasks : {};
        store.context = parsed.context || { repo: null, baseBranch: null, workBranch: null };
        store.pairedRunners =
          parsed.pairedRunners && typeof parsed.pairedRunners === 'object' ? parsed.pairedRunners : {};
        store.deviceTokens =
          parsed.deviceTokens && typeof parsed.deviceTokens === 'object' ? parsed.deviceTokens : {};
        store.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}) };
        store.selectedRunnerId = parsed.selectedRunnerId || null;
      }
    }
  } catch (err) {
    console.error('[store] failed to load data.json, starting fresh:', err.message);
    store = { tasks: {}, context: { repo: null, baseBranch: null, workBranch: null }, pairedRunners: {} };
  }
}

function saveStore() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error('[store] failed to write data.json:', err.message);
  }
  // Also mirror to the laptop runner (durable disk) so state survives Render's
  // ephemeral-filesystem wipes on redeploy/restart.
  scheduleStateBackup();
}

// Debounced push of the full store to the connected runner for safekeeping.
let _backupTimer = null;
function scheduleStateBackup() {
  if (_backupTimer) return;
  _backupTimer = setTimeout(() => {
    _backupTimer = null;
    const live = liveRunnerEntry();
    if (!live) return;
    safeSend(live.socket, {
      type: 'state_backup',
      savedAt: now(),
      state: {
        tasks: store.tasks,
        context: store.context,
        pairedRunners: store.pairedRunners,
        deviceTokens: store.deviceTokens,
        settings: store.settings,
        selectedRunnerId: store.selectedRunnerId,
      },
    });
  }, 500);
}

// ---------------------------------------------------------------------------
// Task helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth: a request is authorized if it presents the shared SECRET (bootstrap)
// or a valid per-device token. Per-device tokens are individually revocable.
// ---------------------------------------------------------------------------

function genToken() {
  return 'dt_' + nanoid(24);
}

function authOk(token) {
  if (!token) return false;
  if (token === SECRET) return true;
  return !!store.deviceTokens[token];
}

function bearerOf(req) {
  const h = (req.headers && req.headers.authorization) || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// Short-lived pairing codes: a connected device mints one, the user pastes it
// into a new device to connect it — no shared secret needed on the new device.
const pairingCodes = new Map(); // CODE -> expiresAtMs
const PAIRING_TTL_MS = 30 * 60 * 1000;
const codeAlphabet = () => {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I/L
  const { customAlphabet } = require('nanoid');
  return customAlphabet(A, 8)();
};
function mintPairingCode() {
  const raw = codeAlphabet();
  const code = raw.slice(0, 4) + '-' + raw.slice(4); // XXXX-XXXX
  pairingCodes.set(code.toUpperCase(), now() + PAIRING_TTL_MS);
  return code;
}
function consumePairingCode(code) {
  if (!code) return false;
  const key = String(code).trim().toUpperCase();
  const exp = pairingCodes.get(key);
  if (!exp) return false;
  pairingCodes.delete(key); // one-time use
  return exp > now();
}

const TERMINAL_STATES = new Set([
  'PR_OPEN',
  'AWAITING_REVIEW',
  'FAILED',
  'BLOCKED',
  'MERGED',
  'DISCARDED',
  'ANSWERED', // chat/question replied to — no PR
]);

function now() {
  return Date.now();
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'task';
}

function newTask({ promptText, repo, baseBranch, workBranch, mode }) {
  const ts = now();
  const id = 't_' + nanoid(8);
  // Real mode refuses to work on a default/protected branch, and the phone
  // rarely specifies one. Auto-derive a unique work branch from the prompt so
  // every task lands on its own branch and can open a PR.
  const derivedBranch =
    workBranch || `dispatch/${slugify(promptText)}-${id.slice(2, 6)}`;
  return {
    id,
    promptText: promptText || '',
    repo: repo || null,
    baseBranch: baseBranch || null,
    workBranch: derivedBranch,
    state: 'CAPTURED',
    // 'auto' = runner decides chat vs task; 'ask' = force chat; 'build' = force PR
    mode: mode === 'ask' || mode === 'build' ? mode : 'auto',
    resolvedKind: null, // set by runner: 'chat' | 'task'
    answer: null, // filled for chat/ANSWERED tasks
    spec: null,
    summary: null,
    prUrl: null,
    progress: [],
    tokensUsed: 0,
    costUsd: 0,
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    budgetUsd: (store.settings && store.settings.taskBudgetUsd) || DEFAULT_BUDGET_USD,
    createdAt: ts,
    updatedAt: ts,
    // internal-only bookkeeping (not part of contract, but harmless to expose)
    _autoProceedAt: null,
  };
}

// The unified diff can be large (up to ~120KB). Keep it out of the list/WS
// payloads (the phone polls the list every 2s) — it's served only by the
// per-task detail endpoint. A lightweight `hasDiff` flag stays for the UI.
function stripHeavy(t) {
  if (t && t.diff) {
    const { diff, ...rest } = t;
    return { ...rest, hasDiff: true };
  }
  return t;
}

function tasksNewestFirst() {
  return Object.values(store.tasks)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(stripHeavy);
}

function touchTask(task) {
  task.updatedAt = now();
  saveStore();
  broadcastTasksUpdate();
}

// --- Push notifications (dormant until a Firebase FCM key is configured) -----
const FCM_SERVER_KEY = process.env.DISPATCH_FCM_SERVER_KEY || '';
let _fcmWarned = false;

// Notify all registered phones. No-op (one-time log) until DISPATCH_FCM_SERVER_KEY
// is set — safe to call from state transitions today; lights up when push is set up.
async function notifyDevices(title, body, data = {}) {
  if (store.settings && store.settings.push === false) return;
  const tokens = Object.keys(store.pushTokens || {});
  if (!tokens.length) return;
  if (!FCM_SERVER_KEY) {
    if (!_fcmWarned) { console.log('[push] notification suppressed — DISPATCH_FCM_SERVER_KEY not set'); _fcmWarned = true; }
    return;
  }
  try {
    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `key=${FCM_SERVER_KEY}` },
      body: JSON.stringify({ registration_ids: tokens, priority: 'high', notification: { title, body }, data }),
    });
    if (!res.ok) console.warn('[push] FCM responded', res.status);
  } catch (err) {
    console.warn('[push] send failed:', err.message);
  }
}

// Only the moments worth interrupting for.
function notifyForTask(task, prevState) {
  if (!task || task.state === prevState) return;
  const short = (task.promptText || 'Task').slice(0, 48);
  const m = {
    SPEC_DRAFTED: ['Needs your OK', short],
    PR_OPEN: ['PR ready to review', short],
    ANSWERED: ['Answer ready', short],
    MERGED: ['Merged ✓', short],
    BLOCKED: ['Task needs a hand', short],
    FAILED: ['Task needs a hand', short],
  }[task.state];
  if (m) notifyDevices(m[0], m[1], { taskId: task.id });
}

// ---------------------------------------------------------------------------
// WebSocket connection registries
// ---------------------------------------------------------------------------

const phones = new Set(); // Set<WebSocket>
const runners = new Set(); // Set<{ socket, runnerName }>
// repo -> { graph, head, builtAt } and repo -> status string. In-memory; the
// runner re-sends on index build or on-demand, so they don't need persisting.
const repoGraphs = new Map();
const repoGraphStatus = new Map();
// GitHub accounts reported by the runner: { accounts: [logins], active: login }
let runnerGithub = { accounts: [], active: null };

function safeSend(socket, obj) {
  try {
    if (socket && socket.readyState === 1 /* OPEN */) {
      socket.send(JSON.stringify(obj));
    }
  } catch (err) {
    console.error('[ws] send failed:', err.message);
  }
}

function broadcastTasksUpdate() {
  const payload = { type: 'tasks_update', tasks: tasksNewestFirst() };
  for (const sock of phones) safeSend(sock, payload);
}

function pairedRunnerEntries() {
  return [...runners].filter((e) => e.runnerId && store.pairedRunners[e.runnerId]);
}

// Pick the runner to dispatch to: the user-selected one if it's approved and
// connected, otherwise the first live approved runner. (Prefer an OPEN socket —
// during a runner restart a dead half-open entry can briefly coexist.)
function liveRunnerEntry() {
  const paired = pairedRunnerEntries();
  const open = paired.filter((e) => e.socket && e.socket.readyState === 1);
  const pool = open.length ? open : paired;
  if (store.selectedRunnerId) {
    const sel = pool.find((e) => e.runnerId === store.selectedRunnerId);
    if (sel) return sel;
  }
  return pool[0] || null;
}

function runnersPublic() {
  const live = liveRunnerEntry();
  return [...runners].map((e) => ({
    id: e.runnerId || null,
    name: e.runnerName || 'runner',
    host: e.host || null,
    ghUser: e.ghUser || null,
    paired: !!(e.runnerId && store.pairedRunners[e.runnerId]),
    // 'selected' = the user's chosen PC; 'active' = the one currently receiving
    // tasks (selected if connected, else the fallback).
    selected: !!(e.runnerId && e.runnerId === store.selectedRunnerId),
    active: !!(live && e.runnerId && e.runnerId === live.runnerId),
  }));
}

function broadcastRunnerStatus() {
  const paired = pairedRunnerEntries();
  const payload = {
    type: 'runner_status',
    connected: paired.length > 0,
    runnerName: paired.length ? paired[0].runnerName : null,
    runners: runnersPublic(),
  };
  for (const sock of phones) safeSend(sock, payload);
}

// Ensure an approved runner has a per-device token; mint + hand it over the
// socket if missing. Used from both explicit approval and re-register.
function ensureRunnerToken(entry) {
  if (!entry || !entry.runnerId || !store.pairedRunners[entry.runnerId]) return;
  let token = Object.keys(store.deviceTokens).find(
    (t) => store.deviceTokens[t].kind === 'runner' && store.deviceTokens[t].id === entry.runnerId,
  );
  if (!token) {
    token = genToken();
    store.deviceTokens[token] = { kind: 'runner', id: entry.runnerId, label: entry.host || null, createdAt: now() };
    saveStore();
  }
  safeSend(entry.socket, { type: 'device_token', token });
}

function sendToRunner(obj) {
  // Only dispatch to an APPROVED runner with a live socket. A connected-but-
  // unapproved machine is ignored until the user pairs it from the phone.
  const first = liveRunnerEntry();
  if (first) {
    safeSend(first.socket, obj);
    return true;
  }
  const anyConnected = runners.size > 0;
  console.warn(
    anyConnected
      ? '[runner] a runner is connected but not approved; message held:'
      : '[runner] no runner connected; message dropped:',
    obj.type,
  );
  return false;
}

// ---------------------------------------------------------------------------
// State-machine actions
// ---------------------------------------------------------------------------

function requestSpec(task) {
  sendToRunner({
    type: 'generate_spec',
    taskId: task.id,
    promptText: task.promptText,
    repo: task.repo,
    baseBranch: task.baseBranch,
    workBranch: task.workBranch,
    mode: task.mode || 'auto',
    budgetUsd: task.budgetUsd,
  });
}

function scheduleAutoProceed(task) {
  task._autoProceedAt = now() + AUTO_PROCEED_MS;
  setTimeout(() => {
    const t = store.tasks[task.id];
    if (!t) return;
    // Only auto-proceed if still sitting in SPEC_DRAFTED (not confirmed/held).
    if (t.state === 'SPEC_DRAFTED') {
      proceedToRun(t);
    }
  }, AUTO_PROCEED_MS);
}

function sendRunTask(task) {
  sendToRunner({
    type: 'run_task',
    taskId: task.id,
    promptText: task.promptText,
    spec: task.spec,
    repo: task.repo,
    baseBranch: task.baseBranch,
    workBranch: task.workBranch,
    budgetTokens: task.budgetTokens,
    budgetUsd: task.budgetUsd,
  });
}

function proceedToRun(task) {
  task.state = 'SPEC_CONFIRMED';
  task._autoProceedAt = null;
  touchTask(task);
  sendRunTask(task);
}

/**
 * Re-drive tasks that got stranded because no runner was connected when their
 * work was dispatched. Called whenever a runner (re)registers, and also on
 * boot. Idempotent: each state is nudged back onto its next hop.
 *   - CAPTURED       → ask the runner for a spec again
 *   - SPEC_DRAFTED   → re-arm the auto-proceed timer (timers die on restart)
 *   - SPEC_CONFIRMED → re-send run_task (the original may have been dropped)
 * Terminal/HELD tasks are left untouched.
 */
function resumeStuckTasks() {
  if (pairedRunnerEntries().length === 0) return;
  let resumed = 0;
  for (const task of Object.values(store.tasks)) {
    switch (task.state) {
      case 'CAPTURED':
        requestSpec(task);
        resumed++;
        break;
      case 'SPEC_DRAFTED':
        scheduleAutoProceed(task);
        resumed++;
        break;
      case 'SPEC_CONFIRMED':
        sendRunTask(task);
        resumed++;
        break;
      default:
        break;
    }
  }
  if (resumed) console.log(`[runner] resumed ${resumed} stranded task(s)`);
}

// ---------------------------------------------------------------------------
// Runner message handling
// ---------------------------------------------------------------------------

function handleRunnerMessage(entry, msg) {
  switch (msg.type) {
    case 'register': {
      entry.runnerName = msg.runnerName || 'runner';
      entry.host = msg.host || null;
      entry.ghUser = msg.ghUser || null;
      entry.runnerId = msg.runnerId || `${entry.host || 'host'}:${entry.ghUser || 'user'}`;
      const approved = !!store.pairedRunners[entry.runnerId];
      console.log(
        `[runner] registered: ${entry.runnerName} (${entry.runnerId}) approved=${approved}`,
        msg.capabilities || [],
      );
      broadcastRunnerStatus();
      // Self-heal only for approved runners — re-drive tasks stranded because
      // no approved runner was connected when they were created/confirmed.
      if (approved) {
        ensureRunnerToken(entry); // hand it a per-device token if it lacks one
        resumeStuckTasks();
      }
      break;
    }
    case 'state_restore': {
      // Runner is offering its saved mirror of our state. Only adopt it if we
      // booted empty (i.e. Render just wiped our disk) so we never clobber
      // live data during a normal reconnect.
      const s = msg.state || {};
      const fresh =
        Object.keys(store.tasks).length === 0 &&
        Object.keys(store.pairedRunners).length === 0;
      if (fresh && (s.tasks || s.pairedRunners)) {
        if (s.tasks && typeof s.tasks === 'object') store.tasks = s.tasks;
        if (s.context) store.context = s.context;
        if (s.pairedRunners && typeof s.pairedRunners === 'object') store.pairedRunners = s.pairedRunners;
        if (s.deviceTokens && typeof s.deviceTokens === 'object') store.deviceTokens = s.deviceTokens;
        if (s.settings && typeof s.settings === 'object') store.settings = { ...store.settings, ...s.settings };
        if (s.selectedRunnerId) store.selectedRunnerId = s.selectedRunnerId;
        saveStore();
        console.log(
          `[state] restored from runner backup: ${Object.keys(store.tasks).length} tasks, ${Object.keys(store.pairedRunners).length} paired`,
        );
        broadcastRunnerStatus(); // this runner may now be approved
        broadcastTasksUpdate();
        ensureRunnerToken(entry); // approved via restore → hand it a token
        resumeStuckTasks(); // finish anything left mid-flight
      }
      break;
    }
    case 'github': {
      if (Array.isArray(msg.accounts)) runnerGithub = { accounts: msg.accounts, active: msg.active || null };
      break;
    }
    case 'repo_graph': {
      if (msg.repo && (msg.graphs || msg.graph)) {
        const graphs = msg.graphs || { files: msg.graph };
        repoGraphs.set(msg.repo, { graphs, head: msg.head || null, builtAt: now() });
        repoGraphStatus.set(msg.repo, 'ready');
      }
      break;
    }
    case 'graph_status': {
      if (msg.repo) repoGraphStatus.set(msg.repo, msg.status || 'building');
      break;
    }
    case 'request_pairing': {
      // Runner wants a pairing code to show the user for connecting a phone.
      const code = mintPairingCode();
      safeSend(entry.socket, { type: 'pairing_code', code, ttlSec: Math.round(PAIRING_TTL_MS / 1000) });
      break;
    }
    case 'repos': {
      // Runner (which has the operator's gh auth) supplied the real repo list.
      // Prefer it over the hosted backend's own gh/stub fallback.
      if (Array.isArray(msg.repos) && msg.repos.length) {
        reposCache = msg.repos.map((r) => ({
          name: r.name,
          defaultBranch: r.defaultBranch || 'main',
          pinned: false,
          recent: false,
        }));
        console.log(`[repos] received ${reposCache.length} repo(s) from runner ${entry.runnerName}`);
      }
      break;
    }
    case 'issues': {
      // Runner replied with open issues for a repo — cache for the phone.
      if (msg.repo) issuesCache[msg.repo] = { ts: now(), issues: Array.isArray(msg.issues) ? msg.issues : [] };
      break;
    }
    case 'spec_result': {
      const task = store.tasks[msg.taskId];
      if (!task) {
        console.warn('[runner] spec_result for unknown task:', msg.taskId);
        break;
      }
      task.spec = msg.spec || null;
      task.state = 'SPEC_DRAFTED';
      touchTask(task);
      // Autonomy: 'auto' proceeds after the timer; 'draft' waits for the user
      // to confirm from the phone.
      if (!store.settings || store.settings.autonomy !== 'review') scheduleAutoProceed(task);
      else notifyForTask(task, 'CAPTURED'); // only interrupt when it truly needs the user
      break;
    }
    case 'progress': {
      const task = store.tasks[msg.taskId];
      if (!task) {
        console.warn('[runner] progress for unknown task:', msg.taskId);
        break;
      }
      if (msg.state) task.state = msg.state;
      if (typeof msg.tokensUsed === 'number') task.tokensUsed = msg.tokensUsed;
      if (typeof msg.costUsd === 'number') task.costUsd = msg.costUsd;
      task.progress.push({
        ts: now(),
        state: msg.state || task.state,
        message: msg.message || '',
        pct: typeof msg.pct === 'number' ? msg.pct : null,
      });
      touchTask(task);
      break;
    }
    case 'result': {
      const task = store.tasks[msg.taskId];
      if (!task) {
        console.warn('[runner] result for unknown task:', msg.taskId);
        break;
      }
      const prevState = task.state;
      task.state = msg.state || 'FAILED';
      if (msg.prUrl !== undefined) task.prUrl = msg.prUrl;
      if (msg.summary !== undefined) task.summary = msg.summary;
      if (msg.answer !== undefined) task.answer = msg.answer;
      if (msg.resolvedKind !== undefined) task.resolvedKind = msg.resolvedKind;
      if (typeof msg.tokensUsed === 'number') task.tokensUsed = msg.tokensUsed;
      if (typeof msg.costUsd === 'number') task.costUsd = msg.costUsd;
      // Review payload: the PR diff, per-file stats, and test/check results so
      // the change can be reviewed from the phone.
      if (msg.diff !== undefined) task.diff = msg.diff;
      if (msg.files !== undefined) task.files = msg.files;
      if (msg.diffTruncated !== undefined) task.diffTruncated = msg.diffTruncated;
      if (msg.checks !== undefined) task.checks = msg.checks;
      if (msg.review !== undefined) task.review = msg.review;
      task.progress.push({
        ts: now(),
        state: task.state,
        message: msg.summary || 'terminal',
        pct: 100,
      });
      touchTask(task);
      notifyForTask(task, prevState);
      break;
    }
    default:
      console.warn('[runner] unknown message type:', msg.type);
  }
}

// ---------------------------------------------------------------------------
// /api/repos — gh repo list with in-memory cache + stub fallback
// ---------------------------------------------------------------------------

let reposCache = null;
// Per-repo open-issues cache filled by the runner on request.
const issuesCache = {};
const issuesRequestedAt = {};

function stubRepos() {
  return [
    { name: 'acme/payment-service', defaultBranch: 'main', pinned: true, recent: true },
    { name: 'acme/webhooks', defaultBranch: 'main', pinned: true, recent: false },
    { name: 'acme/dashboard', defaultBranch: 'main', pinned: false, recent: true },
    { name: 'acme/infra', defaultBranch: 'master', pinned: false, recent: false },
  ];
}

function fetchRepos() {
  return new Promise((resolve) => {
    if (reposCache) {
      resolve(reposCache);
      return;
    }
    execFile(
      'gh',
      ['repo', 'list', '--limit', '50', '--json', 'name,defaultBranchRef'],
      { timeout: 15000 },
      (err, stdout) => {
        if (err) {
          console.warn('[repos] gh failed, using stub list:', err.message);
          reposCache = stubRepos();
          resolve(reposCache);
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const repos = parsed.map((r) => ({
            name: r.name,
            defaultBranch: (r.defaultBranchRef && r.defaultBranchRef.name) || 'main',
            pinned: false,
            recent: false,
          }));
          reposCache = repos.length ? repos : stubRepos();
          resolve(reposCache);
        } catch (parseErr) {
          console.warn('[repos] failed to parse gh output, using stub:', parseErr.message);
          reposCache = stubRepos();
          resolve(reposCache);
        }
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Fastify app
// ---------------------------------------------------------------------------

async function build() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  // Tolerate an empty body on application/json POSTs (some clients set the
  // content-type without a body) instead of throwing FST_ERR_CTP_EMPTY_JSON_BODY.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body || !String(body).trim()) return done(null, {});
    try { done(null, JSON.parse(body)); } catch (err) { err.statusCode = 400; done(err, undefined); }
  });

  // Auth gate for REST. Health (keep-warm) and enroll (bootstrap) are open;
  // everything else needs the shared secret or a per-device token.
  const OPEN_ROUTES = new Set(['/api/health', '/api/enroll', '/api/pair']);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return; // /ws handled separately
    const path = req.url.split('?')[0];
    if (OPEN_ROUTES.has(path)) return;
    if (!authOk(bearerOf(req))) {
      reply.code(401);
      return reply.send({ error: 'unauthorized' });
    }
  });

  // --- REST ---------------------------------------------------------------

  // Exchange the shared secret for a per-device token (bootstrap enrollment).
  app.post('/api/enroll', async (req, reply) => {
    const body = req.body || {};
    if (body.secret !== SECRET) {
      reply.code(403);
      return { error: 'bad_secret' };
    }
    const token = genToken();
    store.deviceTokens[token] = {
      kind: body.kind === 'runner' ? 'runner' : 'phone',
      id: body.deviceId || null,
      label: body.label || null,
      createdAt: now(),
    };
    saveStore();
    return { token };
  });

  // Mint a pairing code (requires an already-authorized device).
  app.post('/api/pairing/new', async () => {
    const code = mintPairingCode();
    return { code, ttlSec: Math.round(PAIRING_TTL_MS / 1000) };
  });

  // Redeem a pairing code for a per-device token (open — that's the point).
  app.post('/api/pair', async (req, reply) => {
    const body = req.body || {};
    if (!consumePairingCode(body.code)) {
      reply.code(403);
      return { error: 'bad_or_expired_code' };
    }
    const token = genToken();
    store.deviceTokens[token] = {
      kind: 'phone',
      id: body.deviceId || null,
      label: body.label || 'paired device',
      createdAt: now(),
    };
    saveStore();
    return { token };
  });

  app.get('/api/health', async () => {
    // `runners` = approved+connected (drives the phone's connected indicator).
    // `pendingRunners` = connected but awaiting approval.
    const paired = pairedRunnerEntries().length;
    return { ok: true, runners: paired, pendingRunners: runners.size - paired };
  });

  // List every connected runner with its real identity + approval status.
  app.get('/api/runners', async () => {
    return { runners: runnersPublic() };
  });

  // Approve (pair) a connected machine so it can run tasks.
  app.post('/api/runners/:id/approve', async (req, reply) => {
    const id = decodeURIComponent(req.params.id);
    const entry = [...runners].find((e) => e.runnerId === id);
    if (!entry) {
      reply.code(404);
      return { error: 'runner_not_connected' };
    }
    store.pairedRunners[id] = {
      host: entry.host || null,
      ghUser: entry.ghUser || null,
      name: entry.runnerName || 'runner',
      pairedAt: now(),
    };
    if (!store.selectedRunnerId) store.selectedRunnerId = id; // first approved = default
    saveStore();
    // Issue a per-device token (revocable) and hand it over the open socket.
    ensureRunnerToken(entry);
    console.log('[runner] approved:', id);
    broadcastRunnerStatus();
    resumeStuckTasks(); // run anything that was waiting for approval
    return { ok: true, runners: runnersPublic() };
  });

  // Choose which approved runner (PC) tasks are dispatched to.
  app.post('/api/runners/:id/select', async (req, reply) => {
    const id = decodeURIComponent(req.params.id);
    if (!store.pairedRunners[id]) { reply.code(400); return { error: 'not_approved' }; }
    store.selectedRunnerId = id;
    saveStore();
    broadcastRunnerStatus();
    console.log('[runner] selected:', id);
    return { ok: true, runners: runnersPublic() };
  });

  // Revoke a previously-approved machine.
  app.post('/api/runners/:id/revoke', async (req) => {
    const id = decodeURIComponent(req.params.id);
    delete store.pairedRunners[id];
    if (store.selectedRunnerId === id) {
      // fall back to another approved runner, if any
      store.selectedRunnerId = Object.keys(store.pairedRunners)[0] || null;
    }
    // Also revoke any device token issued to this runner.
    for (const t of Object.keys(store.deviceTokens)) {
      if (store.deviceTokens[t].kind === 'runner' && store.deviceTokens[t].id === id) {
        delete store.deviceTokens[t];
      }
    }
    saveStore();
    broadcastRunnerStatus();
    return { ok: true, runners: runnersPublic() };
  });

  app.get('/api/repos', async () => {
    const repos = await fetchRepos();
    return { repos };
  });

  // --- user settings (editable from the phone) ---
  app.get('/api/settings', async () => store.settings);
  app.post('/api/settings', async (req) => {
    const b = req.body || {};
    const s = store.settings;
    if (typeof b.digestTime === 'string') s.digestTime = b.digestTime;
    if (b.autonomy === 'review' || b.autonomy === 'auto') s.autonomy = b.autonomy;
    if (typeof b.taskBudgetUsd === 'number' && b.taskBudgetUsd > 0) s.taskBudgetUsd = Math.min(50, b.taskBudgetUsd);
    if (typeof b.push === 'boolean') s.push = b.push;
    if (typeof b.quietHours === 'boolean') s.quietHours = b.quietHours;
    saveStore();
    return store.settings;
  });

  // --- GitHub accounts (managed on the laptop via the runner's gh) ---
  app.get('/api/github', async () => runnerGithub);
  app.post('/api/github/switch', async (req) => {
    const user = (req.body && req.body.user) || '';
    if (!user) return { error: 'user required' };
    const ok = sendToRunner({ type: 'gh_switch', user });
    return { ok };
  });
  app.post('/api/github/logout', async (req) => {
    const user = (req.body && req.body.user) || '';
    if (!user) return { error: 'user required' };
    const ok = sendToRunner({ type: 'gh_logout', user });
    return { ok };
  });

  // Repo dependency graph for the Map tab. Returns the cached graph if present;
  // otherwise reports status so the app can trigger a build.
  app.get('/api/repo-graph', async (req) => {
    const repo = (req.query && req.query.repo) || '';
    const type = (req.query && req.query.type) || 'files';
    const entry = repoGraphs.get(repo);
    const graphs = entry ? entry.graphs : null;
    const types = graphs ? Object.keys(graphs).filter((k) => graphs[k] && graphs[k].nodes) : [];
    return {
      repo,
      type,
      types, // available graph views
      graph: graphs && graphs[type] ? graphs[type] : null,
      head: entry ? entry.head : null,
      builtAt: entry ? entry.builtAt : null,
      status: repoGraphStatus.get(repo) || (entry ? 'ready' : 'none'),
    };
  });

  // Ask the runner to (re)build a repo's graph.
  app.post('/api/repo-graph/build', async (req) => {
    const repo = (req.body && req.body.repo) || '';
    if (!repo) return { error: 'repo required' };
    repoGraphStatus.set(repo, 'queued');
    const ok = sendToRunner({ type: 'build_graph', repo });
    if (!ok) repoGraphStatus.set(repo, 'no_runner');
    return { building: ok, status: repoGraphStatus.get(repo) };
  });

  app.get('/api/context', async () => {
    return store.context;
  });

  app.post('/api/context', async (req) => {
    const body = req.body || {};
    store.context = {
      repo: body.repo ?? null,
      baseBranch: body.baseBranch ?? null,
      workBranch: body.workBranch ?? null,
    };
    saveStore();
    return store.context;
  });

  app.get('/api/tasks', async () => {
    return { tasks: tasksNewestFirst() };
  });

  // Register this phone's push token (FCM/Expo) so the backend can notify it.
  app.post('/api/push/register', async (req, reply) => {
    const token = req.body && req.body.token;
    if (!token) { reply.code(400); return { error: 'no_token' }; }
    store.pushTokens = store.pushTokens || {};
    store.pushTokens[token] = { platform: (req.body && req.body.platform) || 'android', createdAt: now() };
    saveStore();
    return { ok: true };
  });

  // Open issues for a repo — served from the runner's gh, cached, refreshed on
  // demand. First call may return loading:true with the last-known list.
  app.get('/api/issues', async (req) => {
    const repo = req.query && req.query.repo;
    if (!repo) return { issues: [], loading: false };
    const cached = issuesCache[repo];
    const fresh = cached && now() - cached.ts < 60000;
    const recentlyAsked = issuesRequestedAt[repo] && now() - issuesRequestedAt[repo] < 8000;
    if (!fresh && !recentlyAsked) {
      issuesRequestedAt[repo] = now();
      sendToRunner({ type: 'list_issues', repo });
    }
    return { issues: cached ? cached.issues : [], loading: !cached };
  });

  app.post('/api/tasks', async (req, reply) => {
    const body = req.body || {};
    const task = newTask({
      promptText: body.promptText,
      repo: body.repo,
      baseBranch: body.baseBranch,
      workBranch: body.workBranch,
      mode: body.mode,
    });
    store.tasks[task.id] = task;
    saveStore();
    broadcastTasksUpdate();

    // Kick off spec generation on the connected runner.
    requestSpec(task);

    reply.code(201);
    return { task };
  });

  app.get('/api/tasks/:id', async (req, reply) => {
    const task = store.tasks[req.params.id];
    if (!task) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { task };
  });

  app.post('/api/tasks/:id/confirm', async (req, reply) => {
    const task = store.tasks[req.params.id];
    if (!task) {
      reply.code(404);
      return { error: 'not_found' };
    }
    // Advance SPEC_DRAFTED -> SPEC_CONFIRMED and tell runner to proceed.
    if (task.state === 'SPEC_DRAFTED') {
      proceedToRun(task);
    } else if (task.state === 'CAPTURED') {
      // Spec not ready yet (likely the generate_spec was dropped because no
      // runner was connected at capture). Re-request it now; when spec_result
      // arrives the auto-proceed timer runs the task automatically.
      requestSpec(task);
    } else if (task.state === 'HELD') {
      // Un-hold and resume from wherever we can.
      if (task.spec) proceedToRun(task);
      else {
        task.state = 'CAPTURED';
        touchTask(task);
        requestSpec(task);
      }
    }
    return { task };
  });

  // Approve & merge the task's open PR from the phone.
  app.post('/api/tasks/:id/merge', async (req, reply) => {
    const task = store.tasks[req.params.id];
    if (!task) { reply.code(404); return { error: 'not_found' }; }
    if (!task.prUrl) { reply.code(400); return { error: 'no_pr' }; }
    const method = (req.body && req.body.method) || 'squash';
    task.state = 'MERGING';
    touchTask(task);
    const sent = sendToRunner({
      type: 'merge_pr',
      taskId: task.id,
      prUrl: task.prUrl,
      repo: task.repo,
      workBranch: task.workBranch,
      mergeMethod: method,
    });
    if (!sent) {
      // No runner to perform the merge — revert optimistic state.
      task.state = 'PR_OPEN';
      touchTask(task);
      reply.code(503);
      return { error: 'no_runner' };
    }
    return { task };
  });

  // Request changes: the agent revises the same branch/PR with the feedback.
  app.post('/api/tasks/:id/revise', async (req, reply) => {
    const task = store.tasks[req.params.id];
    if (!task) { reply.code(404); return { error: 'not_found' }; }
    const comment = String((req.body && req.body.comment) || '').trim();
    if (!comment) { reply.code(400); return { error: 'empty_comment' }; }
    task.reviewNotes = Array.isArray(task.reviewNotes) ? task.reviewNotes : [];
    task.reviewNotes.push({ ts: now(), comment });
    task.state = 'SPEC_CONFIRMED';
    task._autoProceedAt = null;
    touchTask(task);
    const sent = sendToRunner({
      type: 'run_task',
      taskId: task.id,
      promptText:
        `${task.promptText}\n\n--- REVISION REQUESTED ---\n` +
        `Address this reviewer feedback on the existing open PR (branch ${task.workBranch}). ` +
        `Make the smallest change that satisfies it; keep everything else intact:\n${comment}`,
      spec: task.spec,
      repo: task.repo,
      baseBranch: task.baseBranch,
      workBranch: task.workBranch,
      budgetTokens: task.budgetTokens,
      budgetUsd: task.budgetUsd,
      revise: true,
    });
    if (!sent) { reply.code(503); return { error: 'no_runner' }; }
    return { task };
  });

  app.post('/api/tasks/:id/hold', async (req, reply) => {
    const task = store.tasks[req.params.id];
    if (!task) {
      reply.code(404);
      return { error: 'not_found' };
    }
    task.state = 'HELD';
    task._autoProceedAt = null;
    touchTask(task);
    return { task };
  });

  // --- WebSocket ----------------------------------------------------------

  app.get('/ws', { websocket: true }, (socket, req) => {
    const role = (req.query && req.query.role) || 'phone';

    // Authorize the socket: shared secret or a valid device token.
    if (!authOk(req.query && req.query.token)) {
      try { safeSend(socket, { type: 'unauthorized' }); socket.close(); } catch (_) {}
      return;
    }

    if (role === 'runner') {
      const entry = { socket, runnerName: null };
      runners.add(entry);
      console.log('[ws] runner connected. total runners:', runners.size);

      socket.isAlive = true;
      socket.on('pong', () => { socket.isAlive = true; });

      socket.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch (err) {
          console.error('[ws] bad runner message (ignored):', err.message);
          return;
        }
        try {
          handleRunnerMessage(entry, msg);
        } catch (err) {
          console.error('[ws] error handling runner message (continuing):', err.message);
        }
      });

      socket.on('close', () => {
        runners.delete(entry);
        console.log('[ws] runner disconnected. total runners:', runners.size);
        broadcastRunnerStatus();
      });

      socket.on('error', (err) => {
        console.error('[ws] runner socket error:', err.message);
      });
    } else {
      // role=phone (default)
      phones.add(socket);
      console.log('[ws] phone connected. total phones:', phones.size);

      socket.isAlive = true;
      socket.on('pong', () => { socket.isAlive = true; });

      // Immediately push current state so the phone is in sync.
      safeSend(socket, { type: 'tasks_update', tasks: tasksNewestFirst() });
      const paired0 = pairedRunnerEntries();
      safeSend(socket, {
        type: 'runner_status',
        connected: paired0.length > 0,
        runnerName: paired0.length ? paired0[0].runnerName : null,
        runners: runnersPublic(),
      });

      socket.on('message', (raw) => {
        // Phone does not need to send WS messages in v0; ignore safely.
        try {
          JSON.parse(raw.toString());
        } catch (_) {
          /* ignore */
        }
      });

      socket.on('close', () => {
        phones.delete(socket);
        console.log('[ws] phone disconnected. total phones:', phones.size);
      });

      socket.on('error', (err) => {
        console.error('[ws] phone socket error:', err.message);
      });
    }
  });

  return app;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// Heartbeat: ping every connected socket; terminate any that missed the last
// pong. Keeps `runners`/`phones` accurate when a peer half-closes (e.g. a
// network drop) so the phone's runner status reflects reality.
function startHeartbeat() {
  const HEARTBEAT_MS = 30000;
  setInterval(() => {
    const sweep = (sock, onDead) => {
      if (!sock) return;
      if (sock.isAlive === false) {
        try { sock.terminate(); } catch (_) { /* ignore */ }
        if (onDead) onDead();
        return;
      }
      sock.isAlive = false;
      try { sock.ping(); } catch (_) { /* ignore */ }
    };
    for (const entry of runners) sweep(entry.socket);
    for (const sock of phones) sweep(sock);
  }, HEARTBEAT_MS);
}

async function main() {
  loadStore();
  const app = await build();
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`[dispatch] backend listening on http://${HOST}:${PORT}`);
    console.log(`[dispatch] websocket on ws://${HOST}:${PORT}/ws`);
    startHeartbeat();
  } catch (err) {
    console.error('[dispatch] failed to start:', err);
    process.exit(1);
  }
}

// Never crash on unexpected errors.
process.on('uncaughtException', (err) => {
  console.error('[dispatch] uncaughtException (continuing):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[dispatch] unhandledRejection (continuing):', err);
});

main();
