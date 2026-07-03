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

export function fmtRelativeAgo(iso, nowMs = Date.now()) {
  if (!iso) return '—';
  const diffMs = nowMs - new Date(iso).getTime();
  if (diffMs < 0) return 'just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 1) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return fmtShort(iso);
}

export function liveUpdateFreshness(iso, nowMs = Date.now()) {
  if (!iso) return 'unknown';
  const sec = (nowMs - new Date(iso).getTime()) / 1000;
  if (sec < 30) return 'fresh';
  if (sec < 120) return 'aging';
  return 'stale';
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

export const LIVE_TOAST_TYPES = new Set(['acc alarm', 'sensor alarm', 'ac alarm']);

export function isLiveToastType(type) {
  return LIVE_TOAST_TYPES.has(type);
}
