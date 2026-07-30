// Dispatch API client — talks to the backend REST API.
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ENV_BASE =
  (typeof process !== 'undefined' &&
    process.env &&
    process.env.EXPO_PUBLIC_API_BASE) ||
  (Constants?.expoConfig?.extra && Constants.expoConfig.extra.apiBase);

export const API_BASE = ENV_BASE || 'http://localhost:4000';

const SECRET =
  (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_DISPATCH_SECRET) ||
  (Constants?.expoConfig?.extra && Constants.expoConfig.extra.dispatchSecret) ||
  'dev-token';

const TOKEN_KEY = 'dispatch.deviceToken';

let authToken = null;
let status = 'checking'; // 'checking' | 'ready' | 'needs-pairing'
const listeners = new Set();

export function getAuthStatus() {
  return status;
}
export function onAuthChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function setStatus(s) {
  status = s;
  listeners.forEach((cb) => { try { cb(s); } catch (_) {} });
}

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

// Establish a usable token. Stored token wins; else try silent enroll with the
// shared secret; a definitive 403 means the app doesn't hold the real secret →
// the user must pair with a code. Network errors stay optimistic (use secret).
export async function bootstrapAuth() {
  if (authToken) { setStatus('ready'); return; }
  try {
    const saved = await AsyncStorage.getItem(TOKEN_KEY);
    if (saved) { authToken = saved; setStatus('ready'); return; }
  } catch (_) {}
  try {
    const res = await postJson('/api/enroll', { secret: SECRET, kind: 'phone', label: 'phone' });
    if (res.ok) {
      const d = await res.json();
      if (d && d.token) {
        authToken = d.token;
        try { await AsyncStorage.setItem(TOKEN_KEY, authToken); } catch (_) {}
        setStatus('ready');
        return;
      }
    }
    if (res.status === 403) { setStatus('needs-pairing'); return; }
    setStatus('ready'); // unexpected; fall back to secret and let calls retry
  } catch (_) {
    setStatus('ready'); // offline — use secret, offline banner will show
  }
}

// Redeem a pairing code shown by the runner / another device.
export async function pairWithCode(code) {
  const res = await postJson('/api/pair', { code, kind: 'phone', label: 'phone' });
  if (!res.ok) throw new Error(res.status === 403 ? 'Invalid or expired code' : `HTTP ${res.status}`);
  const d = await res.json();
  if (!d || !d.token) throw new Error('No token returned');
  authToken = d.token;
  try { await AsyncStorage.setItem(TOKEN_KEY, authToken); } catch (_) {}
  setStatus('ready');
}

export async function resetAuth() {
  authToken = null;
  try { await AsyncStorage.removeItem(TOKEN_KEY); } catch (_) {}
  setStatus('needs-pairing');
}

async function req(path, opts = {}) {
  if (!authToken && status === 'checking') await bootstrapAuth();
  const token = authToken || SECRET;
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    // Token invalid (e.g. backend wiped it on a redeploy) — drop it, re-enroll,
    // and RETRY the request once so the call transparently recovers.
    authToken = null;
    try { await AsyncStorage.removeItem(TOKEN_KEY); } catch (_) {}
    await bootstrapAuth();
    const t2 = authToken || SECRET;
    const res2 = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t2}`, ...(opts.headers || {}) },
    });
    if (res2.status === 401) { setStatus('needs-pairing'); throw new Error('unauthorized'); }
    if (!res2.ok) { const t = await res2.text().catch(() => ''); throw new Error(`HTTP ${res2.status} ${path} ${t}`.trim()); }
    const ct2 = res2.headers.get('content-type') || '';
    return ct2.includes('application/json') ? res2.json() : null;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${path} ${text}`.trim());
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

export const api = {
  health: () => req('/api/health'),
  repos: () => req('/api/repos'),
  runners: () => req('/api/runners'),
  approveRunner: (id) => req(`/api/runners/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  revokeRunner: (id) => req(`/api/runners/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),
  newPairingCode: () => req('/api/pairing/new', { method: 'POST' }),
  settings: () => req('/api/settings'),
  setSettings: (body) => req('/api/settings', { method: 'POST', body: JSON.stringify(body) }),
  github: () => req('/api/github'),
  switchGithub: (user) => req('/api/github/switch', { method: 'POST', body: JSON.stringify({ user }) }),
  logoutGithub: (user) => req('/api/github/logout', { method: 'POST', body: JSON.stringify({ user }) }),
  repoGraph: (repo, type) => req(`/api/repo-graph?repo=${encodeURIComponent(repo)}${type ? `&type=${encodeURIComponent(type)}` : ''}`),
  buildRepoGraph: (repo) => req('/api/repo-graph/build', { method: 'POST', body: JSON.stringify({ repo }) }),
  getContext: () => req('/api/context'),
  setContext: (body) => req('/api/context', { method: 'POST', body: JSON.stringify(body) }),
  tasks: () => req('/api/tasks'),
  createTask: (body) => req('/api/tasks', { method: 'POST', body: JSON.stringify(body) }),
  task: (id) => req(`/api/tasks/${id}`),
  confirm: (id) => req(`/api/tasks/${id}/confirm`, { method: 'POST', body: JSON.stringify({ approved: true }) }),
  hold: (id) => req(`/api/tasks/${id}/hold`, { method: 'POST' }),
};
