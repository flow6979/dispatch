// Dispatch API client — talks to the backend REST API.
// Base URL default http://localhost:4000, override via EXPO_PUBLIC_API_BASE.
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ENV_BASE =
  (typeof process !== 'undefined' &&
    process.env &&
    process.env.EXPO_PUBLIC_API_BASE) ||
  (Constants?.expoConfig?.extra && Constants.expoConfig.extra.apiBase);

export const API_BASE = ENV_BASE || 'http://localhost:4000';

// Shared bootstrap secret (matches the backend's DISPATCH_SECRET). Defaults to
// 'dev-token' for backward-compatible rollout. Exchanged once for a per-device
// token, which is then used for all calls and is individually revocable.
const SECRET =
  (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_DISPATCH_SECRET) ||
  (Constants?.expoConfig?.extra && Constants.expoConfig.extra.dispatchSecret) ||
  'dev-token';

const TOKEN_KEY = 'dispatch.deviceToken';
let authToken = null;
let enrolling = null;

async function ensureToken() {
  if (authToken) return authToken;
  try {
    const saved = await AsyncStorage.getItem(TOKEN_KEY);
    if (saved) { authToken = saved; return authToken; }
  } catch (_) { /* ignore */ }
  // Enroll once: exchange the shared secret for a per-device token.
  if (!enrolling) {
    enrolling = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/enroll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: SECRET, kind: 'phone', label: 'phone' }),
        });
        if (res.ok) {
          const d = await res.json();
          if (d && d.token) {
            authToken = d.token;
            try { await AsyncStorage.setItem(TOKEN_KEY, authToken); } catch (_) {}
          }
        }
      } catch (_) { /* offline — fall back to the secret below */ }
    })();
  }
  await enrolling;
  enrolling = null;
  return authToken || SECRET; // fall back to the secret if enrollment failed
}

async function req(path, opts = {}) {
  const token = await ensureToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    // Token no longer valid (e.g. revoked / backend reset) — drop it and retry
    // once via re-enrollment.
    authToken = null;
    try { await AsyncStorage.removeItem(TOKEN_KEY); } catch (_) {}
    const t2 = await ensureToken();
    const res2 = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t2}`, ...(opts.headers || {}) },
    });
    if (!res2.ok) throw new Error(`HTTP ${res2.status} ${path}`.trim());
    const ct2 = res2.headers.get('content-type') || '';
    return ct2.includes('application/json') ? res2.json() : null;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${path} ${text}`.trim());
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return null;
}

export const api = {
  health: () => req('/api/health'),
  repos: () => req('/api/repos'),
  runners: () => req('/api/runners'),
  approveRunner: (id) =>
    req(`/api/runners/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  revokeRunner: (id) =>
    req(`/api/runners/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),
  getContext: () => req('/api/context'),
  setContext: (body) =>
    req('/api/context', { method: 'POST', body: JSON.stringify(body) }),
  tasks: () => req('/api/tasks'),
  createTask: (body) =>
    req('/api/tasks', { method: 'POST', body: JSON.stringify(body) }),
  task: (id) => req(`/api/tasks/${id}`),
  confirm: (id) =>
    req(`/api/tasks/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ approved: true }),
    }),
  hold: (id) => req(`/api/tasks/${id}/hold`, { method: 'POST' }),
};
