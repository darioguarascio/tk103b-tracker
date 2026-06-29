const API = '';

async function request(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  if (res.status === 401 && !path.includes('/auth/')) {
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchJson(path) {
  return request(path);
}

export async function login(password) {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
}

export async function checkAuth() {
  return request('/api/auth/check');
}

export async function logout() {
  return request('/api/auth/logout', { method: 'POST' });
}

export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function fmtShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const EVENT_COLORS = {
  move: '#3b82f6',
  'acc alarm': '#ef4444',
  'sensor alarm': '#f97316',
  'acc off': '#eab308',
  'acc on': '#22c55e',
  tracker: '#8b5cf6',
  'ac alarm': '#ec4899',
};

export function eventColor(type) {
  return EVENT_COLORS[type] || '#94a3b8';
}

export const ALL_TYPES = ['move', 'acc alarm', 'sensor alarm', 'acc off', 'acc on', 'tracker', 'ac alarm'];
