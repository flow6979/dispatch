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

/** @type {{ tasks: Object<string, any>, context: any }} */
let store = {
  tasks: {}, // id -> Task
  context: { repo: null, baseBranch: null, workBranch: null },
};

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      if (raw.trim()) {
        const parsed = JSON.parse(raw);
        store.tasks = parsed.tasks && typeof parsed.tasks === 'object' ? parsed.tasks : {};
        store.context = parsed.context || { repo: null, baseBranch: null, workBranch: null };
      }
    }
  } catch (err) {
    console.error('[store] failed to load data.json, starting fresh:', err.message);
    store = { tasks: {}, context: { repo: null, baseBranch: null, workBranch: null } };
  }
}

function saveStore() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error('[store] failed to write data.json:', err.message);
  }
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

function newTask({ promptText, repo, baseBranch, workBranch }) {
  const ts = now();
  return {
    id: 't_' + nanoid(8),
    promptText: promptText || '',
    repo: repo || null,
    baseBranch: baseBranch || null,
    workBranch: workBranch || null,
    state: 'CAPTURED',
    spec: null,
    summary: null,
    prUrl: null,
    progress: [],
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

function broadcastRunnerStatus(connected, runnerName) {
  const payload = { type: 'runner_status', connected, runnerName: runnerName || null };
  for (const sock of phones) safeSend(sock, payload);
}

function sendToRunner(obj) {
  // Send to the first connected runner (single-user MVP).
  const first = runners.values().next().value;
  if (first) {
    safeSend(first.socket, obj);
    return true;
  }
  console.warn('[runner] no runner connected; message dropped:', obj.type);
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

function proceedToRun(task) {
  task.state = 'SPEC_CONFIRMED';
  task._autoProceedAt = null;
  touchTask(task);
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

// ---------------------------------------------------------------------------
// Runner message handling
// ---------------------------------------------------------------------------

function handleRunnerMessage(entry, msg) {
  switch (msg.type) {
    case 'register': {
      entry.runnerName = msg.runnerName || 'runner';
      console.log('[runner] registered:', entry.runnerName, msg.capabilities || []);
      broadcastRunnerStatus(true, entry.runnerName);
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
    return { ok: true, runners: runners.size };
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
      // Spec not ready yet; mark intent so auto-proceed still fires once drafted.
      // We simply proceed as soon as we can — leave CAPTURED, runner spec_result
      // will draft it and auto-proceed timer will run it. Nothing else to do.
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
        broadcastRunnerStatus(false, entry.runnerName);
      });

      socket.on('error', (err) => {
        console.error('[ws] runner socket error:', err.message);
      });
    } else {
      // role=phone (default)
      phones.add(socket);
      console.log('[ws] phone connected. total phones:', phones.size);

      // Immediately push current state so the phone is in sync.
      safeSend(socket, { type: 'tasks_update', tasks: tasksNewestFirst() });
      safeSend(socket, {
        type: 'runner_status',
        connected: runners.size > 0,
        runnerName: (runners.values().next().value || {}).runnerName || null,
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

async function main() {
  loadStore();
  const app = await build();
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`[dispatch] backend listening on http://${HOST}:${PORT}`);
    console.log(`[dispatch] websocket on ws://${HOST}:${PORT}/ws`);
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
