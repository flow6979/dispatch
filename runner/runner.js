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

// Request the 1-hour prompt-cache TTL so the stable prefix (instructions +
// repo map) survives between tasks on the same repo. Harmless on subscriptions
// (the CLI already does this); required for API keys.
process.env.ENABLE_PROMPT_CACHING_1H = process.env.ENABLE_PROMPT_CACHING_1H || '1';

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
const RUNNER_NAME = process.env.RUNNER_NAME || os.hostname();
// Auth: a saved per-device token (issued at approval) takes precedence; else
// the shared secret from the environment; else the legacy default.
const TOKEN_FILE_PATH = require('path').join(os.homedir(), '.dispatch', 'token');
function currentToken() {
  try {
    const t = require('fs').readFileSync(TOKEN_FILE_PATH, 'utf8').trim();
    if (t) return t;
  } catch (_) { /* none yet */ }
  return process.env.DISPATCH_SECRET || 'dev-token';
}
function saveDeviceToken(t) {
  try {
    require('fs').mkdirSync(require('path').join(os.homedir(), '.dispatch'), { recursive: true });
    require('fs').writeFileSync(TOKEN_FILE_PATH, String(t));
  } catch (_) { /* best-effort */ }
}

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

// Durable local mirror of the backend's state. The hosted backend has an
// ephemeral disk (wiped on redeploy); the laptop does not, so we keep a copy
// here and hand it back when the backend reconnects empty.
const STATE_DIR = path.join(os.homedir(), '.dispatch');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function saveStateMirror(state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify({ savedAt: Date.now(), state }));
    fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); // atomic
  } catch (_) { /* best-effort */ }
}

function readStateMirror() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------------------
// Per-repo code index ("repo map"): built once per repo (cached on the laptop,
// keyed by git HEAD) so Claude gets an instant map instead of re-scanning the
// whole repo from scratch every task. Pure static analysis — costs 0 tokens.
// ---------------------------------------------------------------------------

const INDEX_DIR = path.join(STATE_DIR, 'repo-index');
const SRC_EXT = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'java', 'kt', 'rs',
  'php', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'swift', 'scala', 'sh', 'sql',
]);
// Top-level declarations across common languages.
const SYMBOL_RE = /^(export\s+)?(default\s+)?(public\s+|private\s+|protected\s+)?(static\s+)?(async\s+)?(function|class|interface|type|enum|struct|def|func|const|let|var|module|trait|impl|fn)\b/;

function indexFileFor(repo) {
  const safe = String(repo).replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(INDEX_DIR, safe + '.json');
}

function gitLines(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) return [];
  return String(r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Build a compact repo map: file list + top-level symbols per source file. */
function buildRepoMap(dir) {
  const files = gitLines(dir, ['ls-files']);
  const lines = [`# Repo map — ${files.length} files`];
  let symBudget = 3000; // cap total symbol lines so the map stays compact
  let filesRead = 0;
  for (const f of files) {
    lines.push(f);
    const ext = (f.split('.').pop() || '').toLowerCase();
    if (SRC_EXT.has(ext) && symBudget > 0 && filesRead < 400) {
      filesRead += 1;
      try {
        const content = fs.readFileSync(path.join(dir, f), 'utf8');
        const syms = content
          .split('\n')
          // top-level only: no leading indentation (or an export), which keeps
          // the map to real declarations rather than nested locals.
          .filter((l) => /^(export|module\.|public |private |protected )/.test(l) || (/^\S/.test(l) && SYMBOL_RE.test(l.trim())))
          .map((l) => l.trim())
          .slice(0, 40);
        for (const s of syms) {
          lines.push('    ' + s.replace(/\s*[\{\(].*$/, '').slice(0, 110));
          if (--symBudget <= 0) break;
        }
      } catch (_) { /* skip unreadable */ }
    }
  }
  let map = lines.join('\n');
  if (map.length > 60000) map = map.slice(0, 60000) + '\n… (map truncated)';
  return map;
}

/**
 * Pick the files most likely relevant to a task by matching task words against
 * repo file paths (0 API tokens). Given to claude as a starting point so it
 * reads fewer speculative files. Appended AFTER the cached prefix (task-variable).
 */
function scopedFilesFor(text, dir, limit = 8) {
  const files = gitLines(dir, ['ls-files']).filter((f) => SRC_EXT.has((f.split('.').pop() || '').toLowerCase()));
  const stop = new Set(['the', 'and', 'for', 'add', 'fix', 'that', 'this', 'with', 'from', 'into', 'make', 'file', 'code', 'change', 'update', 'when', 'should', 'have', 'your', 'you']);
  const words = String(text || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((w) => w.length >= 3 && !stop.has(w));
  if (!words.length) return [];
  const scored = files.map((f) => {
    const base = f.split('/').pop().toLowerCase();
    const path = f.toLowerCase();
    let s = 0;
    for (const w of words) {
      if (base.includes(w)) s += 3;
      else if (path.includes(w)) s += 1;
    }
    return { f, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.f);
}

// ---------------------------------------------------------------------------
// Repo graphs (static analysis, 0 tokens). buildRepoGraphs() returns several
// views keyed by type; the app's Map tab lets you switch between them:
//   files    — file ↔ file import dependencies (multi-language)
//   modules  — folder ↔ folder architecture (aggregated; robust for any repo)
//   entities — data models / classes / types and how they reference each other
//   apiflow  — API routes → the entities/tables they touch (best-effort)
// ---------------------------------------------------------------------------

function degreeAndFinish(nodes, edges, extra) {
  const deg = {};
  edges.forEach((e) => { deg[e.source] = (deg[e.source] || 0) + 1; deg[e.target] = (deg[e.target] || 0) + 1; });
  nodes.forEach((n) => { n.deg = deg[n.id] || 0; });
  return { nodes, edges, builtAt: Date.now(), ...(extra || {}) };
}

// --- files: multi-language import edges ---
function buildFileGraph(srcFiles, fileSet, contents) {
  const JS_CAND = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '/index.js', '/index.ts', '/index.tsx', '/index.jsx'];
  const byBasename = {}; // basename(noext) -> [files]
  srcFiles.forEach((f) => {
    const b = f.split('/').pop().replace(/\.[^.]+$/, '');
    (byBasename[b] = byBasename[b] || []).push(f);
  });
  function resolveRel(fromFile, spec, cands) {
    const baseDir = fromFile.split('/').slice(0, -1).join('/');
    const stack = [];
    for (const seg of ((baseDir ? baseDir + '/' : '') + spec).split('/')) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') stack.pop(); else stack.push(seg);
    }
    const norm = stack.join('/');
    for (const c of cands) if (fileSet.has(norm + c)) return norm + c;
    return null;
  }
  function resolve(fromFile, spec, lang) {
    if (!spec) return null;
    if (lang === 'js') {
      if (spec.startsWith('.')) return resolveRel(fromFile, spec, JS_CAND);
      // non-relative (alias/pkg): last segment unique basename match
      const last = spec.split('/').pop();
      if (byBasename[last] && byBasename[last].length === 1) return byBasename[last][0];
      return null;
    }
    if (lang === 'py') {
      const rel = spec.replace(/\./g, '/');
      const cands = ['.py', '/__init__.py'];
      if (spec.startsWith('.')) return resolveRel(fromFile, spec.replace(/^\.+/, (m) => '../'.repeat(m.length - 1) || './').replace(/\./g, '/'), cands);
      for (const c of cands) if (fileSet.has(rel + c)) return rel + c;
      const last = spec.split('.').pop();
      if (byBasename[last] && byBasename[last].length === 1) return byBasename[last][0];
      return null;
    }
    // go/ruby/java/etc.: basename match fallback
    const last = spec.split(/[\/.]/).pop();
    if (byBasename[last] && byBasename[last].length === 1) return byBasename[last][0];
    return null;
  }
  const jsRe = /(?:from\s+|\brequire\(\s*|\bimport\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
  const pyRe = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
  const genRe = /(?:import|use|require|include)\s+['"]([^'"]+)['"]/g;
  const edgesSet = new Set(); const edges = [];
  const addEdge = (s, t) => { if (t && t !== s && !edgesSet.has(s + ' ' + t)) { edgesSet.add(s + ' ' + t); edges.push({ source: s, target: t }); } };
  for (const f of srcFiles) {
    const c = contents[f]; if (!c) continue;
    const ext = (f.split('.').pop() || '').toLowerCase();
    const lang = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue'].includes(ext) ? 'js'
      : ext === 'py' ? 'py' : 'gen';
    let m; let n = 0;
    const re = lang === 'js' ? jsRe : lang === 'py' ? pyRe : genRe;
    re.lastIndex = 0;
    while ((m = re.exec(c)) && n < 80) { n++; addEdge(f, resolve(f, m[1] || m[2], lang)); }
  }
  const connected = new Set(); edges.forEach((e) => { connected.add(e.source); connected.add(e.target); });
  const nodes = [...srcFiles.filter((f) => connected.has(f)), ...srcFiles.filter((f) => !connected.has(f)).slice(0, 80)]
    .map((f) => ({ id: f, label: f.split('/').pop(), path: f, group: f.includes('/') ? f.split('/')[0] : '(root)' }));
  return degreeAndFinish(nodes, edges, { fileCount: srcFiles.length });
}

// --- modules: aggregate file edges to folder level (always useful) ---
function moduleOf(f) {
  const parts = f.split('/');
  if (parts.length <= 1) return '(root)';
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/');
}
function buildModuleGraph(fileGraph, srcFiles) {
  const count = {};
  srcFiles.forEach((f) => { const mo = moduleOf(f); count[mo] = (count[mo] || 0) + 1; });
  const edgesSet = new Set(); const edges = [];
  fileGraph.edges.forEach((e) => {
    const a = moduleOf(e.source); const b = moduleOf(e.target);
    if (a !== b && !edgesSet.has(a + ' ' + b)) { edgesSet.add(a + ' ' + b); edges.push({ source: a, target: b }); }
  });
  const nodes = Object.keys(count).map((mo) => ({ id: mo, label: mo, group: mo.split('/')[0], size: count[mo] }));
  return degreeAndFinish(nodes, edges);
}

// --- entities: data models / classes / types + references between them ---
const ENTITY_RE = [
  /\b(?:export\s+)?(?:abstract\s+)?class\s+([A-Z][A-Za-z0-9_]+)/g,        // JS/TS/Java/Kotlin/PHP/Ruby
  /\b(?:export\s+)?interface\s+([A-Z][A-Za-z0-9_]+)/g,                    // TS/Java/Go
  /\b(?:export\s+)?type\s+([A-Z][A-Za-z0-9_]+)\s*[=<]/g,                   // TS
  /\b(?:export\s+)?enum\s+([A-Z][A-Za-z0-9_]+)/g,                          // TS/Java
  /\btype\s+([A-Z][A-Za-z0-9_]+)\s+struct\b/g,                            // Go
  /\bmodel\s+([A-Z][A-Za-z0-9_]+)\s*\{/g,                                  // Prisma
  /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z0-9_]+)/gi,   // SQL
  /\bclass\s+([A-Z][A-Za-z0-9_]+)\s*\(\s*(?:models\.Model|Base|db\.Model)/g, // Django/SQLAlchemy
];
function buildEntityGraph(srcFiles, contents) {
  const entities = {}; // name -> {file, kind}
  const kindOf = (i) => ['class', 'interface', 'type', 'enum', 'struct', 'model', 'table', 'model'][i] || 'entity';
  for (const f of srcFiles) {
    const c = contents[f]; if (!c) continue;
    ENTITY_RE.forEach((re, i) => {
      re.lastIndex = 0; let m; let n = 0;
      while ((m = re.exec(c)) && n < 200) { n++; const name = m[1]; if (name && !entities[name]) entities[name] = { file: f, kind: kindOf(i) }; }
    });
  }
  const names = Object.keys(entities);
  if (names.length > 400) names.length = 400;
  const nameSet = new Set(names);
  const edgesSet = new Set(); const edges = [];
  // Edge A->B if A's file references B's name (word boundary), A!=B.
  for (const a of names) {
    const c = contents[entities[a].file]; if (!c) continue;
    for (const b of names) {
      if (a === b) continue;
      if (new RegExp('\\b' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(c)) {
        const key = a + ' ' + b;
        if (!edgesSet.has(key)) { edgesSet.add(key); edges.push({ source: a, target: b }); }
      }
    }
    if (edges.length > 1200) break;
  }
  const nodes = names.map((n) => ({ id: n, label: n, group: entities[n].kind, path: entities[n].file }));
  return degreeAndFinish(nodes, edges, { note: nameSet.size ? undefined : 'no data entities detected' });
}

// --- apiflow: routes -> entities they likely touch (best-effort) ---
const ROUTE_RE = [
  /\b(?:app|router|api|fastify)\.(get|post|put|patch|delete|use)\(\s*['"`]([^'"`]+)/gi, // express/fastify
  /@(?:app|router|blueprint)\.(get|post|put|patch|delete|route)\(\s*['"]([^'"]+)/gi,     // flask/fastapi
  /@(Get|Post|Put|Patch|Delete)Mapping\(\s*["']?([^"')]*)/g,                              // spring
  /\b(get|post|put|patch|delete)\s+['"]([^'"]+)['"]\s*(?:=>|,|do)/gi,                     // rails-ish
];
function buildApiFlowGraph(srcFiles, contents, entityGraph) {
  const entityNames = new Set(entityGraph.nodes.map((n) => n.id));
  const nodes = []; const edges = []; const seen = new Set();
  const addNode = (id, label, group) => { if (!seen.has(id)) { seen.add(id); nodes.push({ id, label, group }); } };
  let routeCount = 0;
  for (const f of srcFiles) {
    const c = contents[f]; if (!c) continue;
    const routesInFile = [];
    ROUTE_RE.forEach((re) => {
      re.lastIndex = 0; let m; let n = 0;
      while ((m = re.exec(c)) && n < 100) {
        n++;
        const method = (m[1] || 'route').toUpperCase();
        const p = (m[2] || '').slice(0, 40) || '/';
        const id = 'route:' + method + ' ' + p;
        routesInFile.push(id);
        addNode(id, method + ' ' + p, 'route');
        routeCount++;
      }
    });
    if (!routesInFile.length) continue;
    // entities referenced in this file → connect each route to them
    for (const name of entityNames) {
      if (new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(c)) {
        addNode('entity:' + name, name, 'entity');
        for (const r of routesInFile) {
          const key = r + '>' + name;
          if (!seen.has('e:' + key)) { seen.add('e:' + key); edges.push({ source: r, target: 'entity:' + name }); }
        }
      }
    }
    if (nodes.length > 400) break;
  }
  return degreeAndFinish(nodes, edges, { routeCount, note: routeCount ? undefined : 'no API routes detected' });
}

function buildRepoGraphs(dir) {
  const files = gitLines(dir, ['ls-files']);
  const fileSet = new Set(files);
  const isSrc = (f) => SRC_EXT.has((f.split('.').pop() || '').toLowerCase());
  const srcFiles = files.filter(isSrc).slice(0, 800);
  const contents = {};
  for (const f of srcFiles) { try { contents[f] = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 200000); } catch (_) {} }
  const filesG = buildFileGraph(srcFiles, fileSet, contents);
  const modulesG = buildModuleGraph(filesG, srcFiles);
  const entitiesG = buildEntityGraph(srcFiles, contents);
  const apiflowG = buildApiFlowGraph(srcFiles, contents, entitiesG);
  filesG.fileCount = files.length;
  return { files: filesG, modules: modulesG, entities: entitiesG, apiflow: apiflowG, builtAt: Date.now(), fileCount: files.length };
}

// Backward-compatible single-graph accessor (the files view).
function buildRepoGraph(dir) {
  return buildRepoGraphs(dir).files;
}

/**
 * Return the cached repo map, rebuilding it only when the repo's HEAD changed
 * (or it's the first time). Emits a first-time "indexing" note so the phone can
 * explain the one-off delay.
 */
function ensureRepoIndex(dir, repo, emit, taskId) {
  const head = (gitLines(dir, ['rev-parse', 'HEAD'])[0]) || null;
  const file = indexFileFor(repo);
  let cached = null;
  try { if (fs.existsSync(file)) cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  if (cached && cached.head === head && cached.map) {
    emit && emit({ type: 'progress', taskId, message: `🗂️ using cached index for ${repo}` });
    if (cached.graphs) emit && emit({ type: 'repo_graph', repo, head, graphs: cached.graphs });
    else if (cached.graph) emit && emit({ type: 'repo_graph', repo, head, graphs: { files: cached.graph } });
    return cached.map;
  }
  const first = !cached;
  emit && emit({
    type: 'progress', taskId, state: 'RUNNING', pct: 18,
    message: first
      ? `🗂️ indexing ${repo} for the first time (one-time — future tasks are faster & cheaper)`
      : `🗂️ repo changed — refreshing index for ${repo}`,
  });
  const t0 = Date.now();
  const map = buildRepoMap(dir);
  let graphs = null;
  try { graphs = buildRepoGraphs(dir); } catch (_) {}
  try {
    fs.mkdirSync(INDEX_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ repo, head, builtAt: Date.now(), map, graphs }));
  } catch (_) {}
  if (graphs) emit && emit({ type: 'repo_graph', repo, head, graphs });
  log(`indexed ${repo} in ${Date.now() - t0}ms (map ${map.length} chars, files ${graphs ? graphs.files.nodes.length : 0} nodes)`);
  return map;
}

// Budget: wall-clock ceiling for a REAL task and a default token budget.
const DEFAULT_BUDGET_TOKENS = 250000;
const REAL_WALL_CLOCK_MS = Number(process.env.DISPATCH_WALL_MS || 20 * 60 * 1000); // 20 min

// Model routing: cheap models for trivial work, a stronger one for real edits.
// All overridable so you can dial cost vs quality.
const CLASSIFY_MODEL = process.env.DISPATCH_CLASSIFY_MODEL || 'haiku';
const SPEC_MODEL = process.env.DISPATCH_SPEC_MODEL || 'haiku';
const CHAT_MODEL = process.env.DISPATCH_CHAT_MODEL || 'sonnet';
const EDIT_MODEL = process.env.DISPATCH_EDIT_MODEL || 'sonnet'; // set to 'opus' for hard tasks
// Hard dollar cap per task (claude stops itself via --max-budget-usd).
const DEFAULT_BUDGET_USD = Number(process.env.DISPATCH_BUDGET_USD || 3);

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
    const out = await runClaude(prompt, { cwd: process.cwd(), timeoutMs: 120000, model: SPEC_MODEL });
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

/** Build the common claude CLI flags for model routing + dollar budget cap. */
function claudeFlags({ model, maxBudgetUsd, maxTurns } = {}) {
  // --exclude-dynamic-system-prompt-sections strips per-session/dir/git context
  // from the system prompt so the prefix is byte-identical across worktrees and
  // can be reused from the prompt cache (huge input-token savings on repeat
  // tasks per repo). --strict-mcp-config avoids loading the user's MCP servers
  // (we need none), trimming fixed system-prompt overhead on every call.
  const f = ['--exclude-dynamic-system-prompt-sections', '--strict-mcp-config'];
  if (model) f.push('--model', String(model));
  if (maxBudgetUsd && maxBudgetUsd > 0) f.push('--max-budget-usd', String(maxBudgetUsd));
  if (maxTurns && maxTurns > 0) f.push('--max-turns', String(maxTurns));
  return f;
}
const EDIT_MAX_TURNS = Number(process.env.DISPATCH_MAX_TURNS || 40); // safety ceiling

/** Run `claude -p <prompt>` and resolve with stdout. Rejects on error/timeout. */
function runClaude(prompt, { cwd, timeoutMs = 120000, model, maxBudgetUsd } = {}) {
  return run('claude', ['-p', prompt, ...claudeFlags({ model, maxBudgetUsd })], { cwd, timeoutMs });
}

/**
 * Run claude in JSON mode so we get the real token usage back. Resolves
 * { text, tokens } where tokens is the total input+output+cache for this call.
 * Falls back to plain text (tokens 0) if JSON parsing fails.
 */
async function runClaudeJson(prompt, { cwd, timeoutMs = 120000, model, maxBudgetUsd } = {}) {
  const out = await run('claude', ['-p', prompt, '--output-format', 'json', ...claudeFlags({ model, maxBudgetUsd })], { cwd, timeoutMs });
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

/** One-line human label for a tool_use so it's readable in logs / on the phone. */
function describeToolUse(name, input) {
  const i = input || {};
  const f = i.file_path || i.path || i.notebook_path;
  const rel = f ? String(f).split('/').slice(-2).join('/') : null;
  switch (name) {
    case 'Write': return `writing ${rel || 'a file'}`;
    case 'Edit':
    case 'MultiEdit': return `editing ${rel || 'a file'}`;
    case 'Read': return `reading ${rel || 'a file'}`;
    case 'Bash': return `running: ${String(i.command || '').slice(0, 60)}`;
    case 'Glob':
    case 'Grep': return `searching ${i.pattern ? `"${String(i.pattern).slice(0, 40)}"` : 'the repo'}`;
    case 'TodoWrite': return 'planning next steps';
    default: return name ? `using ${name}` : 'working';
  }
}

/**
 * Run claude in STREAMING mode and surface every step. Reads the stream-json
 * NDJSON output line-by-line; for each assistant text / tool_use it calls
 * onActivity({kind, label, detail}) so the caller can log it and push it to
 * the phone. Resolves { text, tokens } from the terminal `result` event.
 */
function runClaudeStream(prompt, { cwd, timeoutMs = 120000, onActivity, model, maxBudgetUsd } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', ...claudeFlags({ model, maxBudgetUsd })];
    const child = spawn('claude', args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    let stderr = '';
    let finalText = '';
    let tokens = 0;
    let costUsd = 0;
    let done = false;
    const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); try { child.kill('SIGKILL'); } catch (_) {} fn(arg); };
    const timer = setTimeout(() => finish(reject, new Error(`claude timed out after ${timeoutMs}ms`)), timeoutMs);

    function handle(evt) {
      try {
        if (evt.type === 'assistant') {
          for (const b of (evt.message && evt.message.content) || []) {
            if (b.type === 'text' && b.text && b.text.trim()) {
              onActivity && onActivity({ kind: 'thought', label: b.text.trim().slice(0, 80) });
            } else if (b.type === 'tool_use') {
              onActivity && onActivity({ kind: 'action', label: describeToolUse(b.name, b.input) });
            }
          }
        } else if (evt.type === 'result') {
          const u = evt.usage || {};
          tokens = (u.input_tokens || 0) + (u.output_tokens || 0) +
                   (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
          if (typeof evt.total_cost_usd === 'number') costUsd = evt.total_cost_usd;
          if (typeof evt.result === 'string') finalText = evt.result;
        }
      } catch (_) { /* ignore a bad event */ }
    }

    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try { handle(JSON.parse(line)); } catch (_) { /* partial/non-JSON */ }
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => finish(reject, new Error(`claude spawn failed: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) finish(resolve, { text: finalText, tokens, costUsd });
      else finish(reject, new Error(`claude exited ${code}: ${stderr.trim().slice(0, 200)}`));
    });
  });
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
    const repoMap = ensureRepoIndex(repoDir, repo, emit, taskId);
    emit({ type: 'progress', taskId, state: 'RUNNING', message: 'invoking claude to make changes', pct: 40 });
    const goal = (spec && spec.goal) || '';
    // Order matters for prompt caching: keep the STABLE prefix (standing
    // instructions + repo map) first and the per-task text last, so repeated
    // tasks on the same repo reuse the cached prefix.
    const claudePrompt =
      'You are an autonomous coding agent working inside a git worktree of a repository. ' +
      'Use the repository map below to locate relevant code directly — avoid re-scanning the ' +
      'whole repo; only read the specific files you need to edit. Make the necessary code ' +
      'changes to accomplish the task. Do not commit or push; leave changes in the working tree.\n\n' +
      `<repo_map>\n${repoMap}\n</repo_map>\n\n` +
      `--- TASK ---\n${promptText}\n\nGoal: ${goal}\n` +
      (() => {
        const scoped = scopedFilesFor(`${promptText} ${goal}`, repoDir);
        return scoped.length
          ? `\nLikely-relevant files (start here, but verify): ${scoped.join(', ')}\n`
          : '';
      })();
    if (!hasBinary('claude')) {
      return fail('FAILED', 'claude CLI not found on PATH.');
    }
    let tokensUsed = 0;
    let costUsd = 0;
    try {
      // Stream Claude's actions live: log each one and push it to the phone so
      // you can watch what it's doing (writing files, running commands, etc.).
      let step = 0;
      const res = await runClaudeStream(claudePrompt, {
        cwd: worktreeDir,
        timeoutMs: Math.min(timeLeft(), 15 * 60 * 1000),
        model: EDIT_MODEL,
        maxBudgetUsd: task.budgetUsd || DEFAULT_BUDGET_USD,
        maxTurns: EDIT_MAX_TURNS,
        onActivity: (a) => {
          const glyph = a.kind === 'action' ? '🔧' : '💭';
          log(`claude ${a.kind}: ${a.label}`);
          // Ramp the % from 40→68 across steps so the bar advances as it works.
          step += 1;
          const pct = Math.min(68, 40 + step);
          emit({ type: 'progress', taskId, state: 'RUNNING', message: `${glyph} ${a.label}`, pct });
        },
      });
      tokensUsed = res.tokens || 0;
      costUsd = res.costUsd || 0;
      emit({ type: 'progress', taskId, state: 'RUNNING', message: `claude finished (${tokensUsed.toLocaleString()} tokens · $${costUsd.toFixed(2)})`, pct: 68, tokensUsed, costUsd });
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
      costUsd,
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

/**
 * Decide whether a capture needs a PR ('task') or is just a question ('chat').
 * Cheap: a prompt-only classification (no repo read). Heuristic fallback.
 */
async function classifyIntent(promptText) {
  const p =
    'Route a developer request. Reply with EXACTLY one word and nothing else: ' +
    '"BUILD" if it asks to change, add, fix, implement, or refactor code (i.e. it should produce a pull request), ' +
    'or "ASK" if it is a question, explanation, review, or discussion that needs NO code change. ' +
    `Request: ${promptText}`;
  if (!STUB_MODE) {
    try {
      const out = await runClaude(p, { cwd: os.tmpdir(), timeoutMs: 60000, model: CLASSIFY_MODEL });
      const t = String(out).toUpperCase();
      if (t.includes('ASK') && !t.includes('BUILD')) return 'chat';
      if (t.includes('BUILD')) return 'task';
    } catch (err) {
      log('classifyIntent failed, using heuristic:', err.message);
    }
  }
  const s = String(promptText || '').trim().toLowerCase();
  if (/\?\s*$/.test(s) ||
      /^(how|what|why|when|where|who|which|does|do |did |is |are |can |could |should |would |explain|describe|tell me|show me|why|is there|what's)/.test(s)) {
    return 'chat';
  }
  return 'task';
}

/**
 * Answer a question (no PR). Runs claude read-only — in the repo clone if one
 * is selected, so answers are repo-aware. Ends with an ANSWERED result.
 */
async function handleChat(msg, emit) {
  const { taskId, promptText, repo } = msg;
  emit({ type: 'progress', taskId, state: 'RUNNING', message: '💬 thinking…', pct: 15 });

  if (STUB_MODE) {
    emit({
      type: 'result', taskId, state: 'ANSWERED', resolvedKind: 'chat',
      answer: `(stub) I would answer your question: "${promptText}"`,
      summary: 'Answered (stub mode).', tokensUsed: 0, costUsd: 0,
    });
    return;
  }

  let cwd = os.tmpdir();
  if (repo) {
    try {
      const repoDirName = String(repo).replace(/[^A-Za-z0-9._/-]/g, '_').split('/').pop();
      const repoDir = path.join(WORKSPACE, repoDirName);
      fs.mkdirSync(WORKSPACE, { recursive: true });
      if (!fs.existsSync(path.join(repoDir, '.git'))) {
        emit({ type: 'progress', taskId, state: 'RUNNING', message: `cloning ${repo}`, pct: 25 });
        if (hasBinary('gh')) await run('gh', ['repo', 'clone', repo, repoDir], { cwd: WORKSPACE, timeoutMs: 300000 });
        else await run('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, repoDir], { cwd: WORKSPACE, timeoutMs: 300000 });
      }
      cwd = repoDir;
    } catch (err) {
      log('chat: repo clone failed, answering without repo context:', err.message);
    }
  }

  const repoMap = repo && cwd !== os.tmpdir() ? ensureRepoIndex(cwd, repo, emit, taskId) : null;
  // Stable prefix first (instructions + repo map), the question last — for
  // prompt-cache reuse across questions on the same repo.
  const chatPrompt =
    `You answer questions about ${repo ? `the repository ${repo}` : 'software engineering'}. ` +
    'Be concise and specific. This is READ-ONLY — do not modify, create, commit, or push any files.\n\n' +
    (repoMap
      ? 'Use the repository map below to answer directly; only read specific files if you must.\n' +
        `<repo_map>\n${repoMap}\n</repo_map>\n\n`
      : '') +
    `--- QUESTION ---\n${promptText}`;

  let tokensUsed = 0, costUsd = 0, answer = '';
  try {
    let step = 0;
    const res = await runClaudeStream(chatPrompt, {
      cwd,
      timeoutMs: 10 * 60 * 1000,
      model: CHAT_MODEL,
      maxBudgetUsd: msg.budgetUsd || DEFAULT_BUDGET_USD,
      onActivity: (a) => {
        const g = a.kind === 'action' ? '🔧' : '💭';
        log(`chat ${a.kind}: ${a.label}`);
        step += 1;
        emit({ type: 'progress', taskId, state: 'RUNNING', message: `${g} ${a.label}`, pct: Math.min(85, 30 + step * 3) });
      },
    });
    tokensUsed = res.tokens || 0;
    costUsd = res.costUsd || 0;
    answer = (res.text && res.text.trim()) || '(no answer produced)';
  } catch (err) {
    emit({ type: 'result', taskId, state: 'FAILED', resolvedKind: 'chat', summary: `Couldn't answer: ${err.message}`, tokensUsed, costUsd });
    return;
  }
  emit({ type: 'result', taskId, state: 'ANSWERED', resolvedKind: 'chat', answer, summary: answer.slice(0, 240), tokensUsed, costUsd });
}

/** On-demand: ensure the repo is cloned, build its graph, send it back. */
async function handleBuildGraph(msg, emit) {
  const repo = msg.repo;
  if (!repo) return;
  try {
    const repoDirName = String(repo).replace(/[^A-Za-z0-9._/-]/g, '_').split('/').pop();
    const repoDir = path.join(WORKSPACE, repoDirName);
    fs.mkdirSync(WORKSPACE, { recursive: true });
    if (!fs.existsSync(path.join(repoDir, '.git'))) {
      emit({ type: 'graph_status', repo, status: 'cloning' });
      if (hasBinary('gh')) await run('gh', ['repo', 'clone', repo, repoDir], { cwd: WORKSPACE, timeoutMs: 300000 });
      else await run('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, repoDir], { cwd: WORKSPACE, timeoutMs: 300000 });
    }
    emit({ type: 'graph_status', repo, status: 'building' });
    const head = (gitLines(repoDir, ['rev-parse', 'HEAD'])[0]) || null;
    const graphs = buildRepoGraphs(repoDir);
    emit({ type: 'repo_graph', repo, head, graphs });
    log(`built graphs for ${repo}: files ${graphs.files.nodes.length}n, modules ${graphs.modules.nodes.length}n, entities ${graphs.entities.nodes.length}n, apiflow ${graphs.apiflow.nodes.length}n`);
  } catch (err) {
    emit({ type: 'graph_status', repo, status: 'error', message: err.message });
    log('build_graph failed:', err.message);
  }
}

async function handleGenerateSpec(msg, emit) {
  const mode = msg.mode || 'auto';
  let kind;
  if (mode === 'ask') kind = 'chat';
  else if (mode === 'build') kind = 'task';
  else {
    // Progress WITHOUT a state field so the backend keeps the task CAPTURED
    // while we classify (no premature RUNNING).
    emit({ type: 'progress', taskId: msg.taskId, message: '🧭 understanding intent…' });
    kind = await classifyIntent(msg.promptText);
    log(`intent for task=${msg.taskId}: ${kind}`);
  }

  if (kind === 'chat') {
    await handleChat(msg, emit);
    return;
  }

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
    budgetUsd: msg.budgetUsd,
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
  let backoff = 1000;
  let askedPairing = false; // print a pairing code once per process
  const MAX_BACKOFF = 30000;
  let ws = null;
  let stopping = false;

  let heartbeat = null;
  const HEARTBEAT_MS = 20000; // ping cadence; also keeps Render's proxy from idling us out

  function stopHeartbeat() {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  }

  function connect() {
    const url = `${WS_SCHEME}://${BACKEND_HOST}/ws?role=runner&token=${encodeURIComponent(currentToken())}`;
    log(`connecting to ${WS_SCHEME}://${BACKEND_HOST}/ws (mode=${STUB_MODE ? 'STUB' : 'REAL'}, runner=${RUNNER_NAME})`);
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
      // Ask the backend for a pairing code to show the user (once per run).
      if (!askedPairing) { askedPairing = true; emit({ type: 'request_pairing' }); }
      // Offer our durable state mirror in case the backend booted empty
      // (Render wiped its disk). Backend only adopts it if it has no data.
      const mirror = readStateMirror();
      if (mirror && mirror.state) {
        log('offering saved state backup to backend');
        emit({ type: 'state_restore', state: mirror.state, savedAt: mirror.savedAt });
      }
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
        } else if (msg.type === 'build_graph') {
          // On-demand repo graph for the app's Map tab.
          await handleBuildGraph(msg, emit);
        } else if (msg.type === 'state_backup') {
          // Backend is mirroring its state to us for safekeeping.
          if (msg.state) saveStateMirror(msg.state);
        } else if (msg.type === 'pairing_code') {
          const mins = Math.round((msg.ttlSec || 1800) / 60);
          log(`\n\n  ┌──────────────────────────────────────────────┐\n  │  📱 Connect a phone to Dispatch                │\n  │  Pairing code:  ${msg.code}                     │\n  │  Enter this in the app (valid ${mins} min).        │\n  └──────────────────────────────────────────────┘\n`);
        } else if (msg.type === 'device_token') {
          // We were approved and issued a per-device token; use it hereafter.
          if (msg.token) { saveDeviceToken(msg.token); log('received per-device token; saved'); }
        } else if (msg.type === 'unauthorized') {
          // Our saved per-device token is no longer valid (e.g. backend was
          // wiped/redeployed). Drop it so the next reconnect falls back to the
          // shared secret, which lets us restore state and get re-approved.
          log('backend rejected our token; clearing it and falling back to the secret');
          try { require('fs').rmSync(TOKEN_FILE_PATH, { force: true }); } catch (_) {}
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
  classifyIntent,
  handleChat,
  buildRepoMap,
  buildRepoGraph,
  buildRepoGraphs,
  scopedFilesFor,
  ensureRepoIndex,
  runClaudeStream,
  describeToolUse,
  runTaskStub,
  runTaskReal,
  confidenceSummary,
  handleGenerateSpec,
  handleRunTask,
};
