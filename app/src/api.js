// Dispatch API client — talks to the backend REST API.
// Base URL default http://localhost:4000, override via EXPO_PUBLIC_API_BASE.
import Constants from 'expo-constants';

const ENV_BASE =
  (typeof process !== 'undefined' &&
    process.env &&
    process.env.EXPO_PUBLIC_API_BASE) ||
  (Constants?.expoConfig?.extra && Constants.expoConfig.extra.apiBase);

export const API_BASE = ENV_BASE || 'http://localhost:4000';
const TOKEN = 'dev-token';

async function req(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...(opts.headers || {}),
    },
  });
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
