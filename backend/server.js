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
const DATA_FILE = path.join(__dirname, 'data.json');
const AUTO_PROCEED_MS = 3000;
const DEFAULT_BUDGET_TOKENS = 250000;

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
};

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
      state: { tasks: store.tasks, context: store.context, pairedRunners: store.pairedRunners },
    });
  }, 500);
}

// ---------------------------------------------------------------------------
// Task helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATES = new Set([
  'PR_OPEN',
  'AWAITING_REVIEW',
  'FAILED',
  'BLOCKED',
  'MERGED',
  'DISCARDED',
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

function newTask({ promptText, repo, baseBranch, workBranch }) {
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
    spec: null,
    summary: null,
    prUrl: null,
    progress: [],
    tokensUsed: 0,
    costUsd: 0,
    budgetTokens: DEFAULT_BUDGET_TOKENS,
    createdAt: ts,
    updatedAt: ts,
    // internal-only bookkeeping (not part of contract, but harmless to expose)
    _autoProceedAt: null,
  };
}

function tasksNewestFirst() {
  return Object.values(store.tasks).sort((a, b) => b.createdAt - a.createdAt);
}

function touchTask(task) {
  task.updatedAt = now();
  saveStore();
  broadcastTasksUpdate();
}

// ---------------------------------------------------------------------------
// WebSocket connection registries
// ---------------------------------------------------------------------------

const phones = new Set(); // Set<WebSocket>
const runners = new Set(); // Set<{ socket, runnerName }>

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

// Prefer an approved runner whose socket is actually OPEN. During a runner
// restart two entries can briefly coexist (the dead half-open one + the fresh
// one); sending to the dead socket silently drops the message.
function liveRunnerEntry() {
  const paired = pairedRunnerEntries();
  return paired.find((e) => e.socket && e.socket.readyState === 1) || paired[0] || null;
}

function runnersPublic() {
  return [...runners].map((e) => ({
    id: e.runnerId || null,
    name: e.runnerName || 'runner',
    host: e.host || null,
    ghUser: e.ghUser || null,
    paired: !!(e.runnerId && store.pairedRunners[e.runnerId]),
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
      if (approved) resumeStuckTasks();
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
        saveStore();
        console.log(
          `[state] restored from runner backup: ${Object.keys(store.tasks).length} tasks, ${Object.keys(store.pairedRunners).length} paired`,
        );
        broadcastRunnerStatus(); // this runner may now be approved
        broadcastTasksUpdate();
        resumeStuckTasks(); // finish anything left mid-flight
      }
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
    case 'spec_result': {
      const task = store.tasks[msg.taskId];
      if (!task) {
        console.warn('[runner] spec_result for unknown task:', msg.taskId);
        break;
      }
      task.spec = msg.spec || null;
      task.state = 'SPEC_DRAFTED';
      touchTask(task);
      scheduleAutoProceed(task);
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
      task.state = msg.state || 'FAILED';
      if (msg.prUrl !== undefined) task.prUrl = msg.prUrl;
      if (msg.summary !== undefined) task.summary = msg.summary;
      if (typeof msg.tokensUsed === 'number') task.tokensUsed = msg.tokensUsed;
      if (typeof msg.costUsd === 'number') task.costUsd = msg.costUsd;
      task.progress.push({
        ts: now(),
        state: task.state,
        message: msg.summary || 'terminal',
        pct: 100,
      });
      touchTask(task);
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

  // --- REST ---------------------------------------------------------------

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
    saveStore();
    console.log('[runner] approved:', id);
    broadcastRunnerStatus();
    resumeStuckTasks(); // run anything that was waiting for approval
    return { ok: true, runners: runnersPublic() };
  });

  // Revoke a previously-approved machine.
  app.post('/api/runners/:id/revoke', async (req) => {
    const id = decodeURIComponent(req.params.id);
    delete store.pairedRunners[id];
    saveStore();
    broadcastRunnerStatus();
    return { ok: true, runners: runnersPublic() };
  });

  app.get('/api/repos', async () => {
    const repos = await fetchRepos();
    return { repos };
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

  app.post('/api/tasks', async (req, reply) => {
    const body = req.body || {};
    const task = newTask({
      promptText: body.promptText,
      repo: body.repo,
      baseBranch: body.baseBranch,
      workBranch: body.workBranch,
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
