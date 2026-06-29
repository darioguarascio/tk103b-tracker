const crypto = require('crypto');

const PASSWORD = process.env.AUTH_PASSWORD || '';
const SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE = 'ct_session';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}

function makeToken() {
  const payload = `${Date.now()}.${crypto.randomBytes(16).toString('hex')}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token) return false;
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return false;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  if (sign(payload) !== sig) return false;
  const ts = parseInt(payload.split('.')[0], 10);
  if (isNaN(ts) || Date.now() - ts > MAX_AGE) return false;
  return true;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

function authEnabled() {
  return Boolean(PASSWORD);
}

function checkPassword(password) {
  if (!authEnabled()) return true;
  const a = Buffer.from(password);
  const b = Buffer.from(PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function authMiddleware(req, res, next) {
  if (!authEnabled()) return next();
  if (req.path === '/auth/login' || req.path === '/auth/check') return next();

  const cookies = parseCookies(req.headers.cookie);
  if (verifyToken(cookies[COOKIE])) return next();

  res.status(401).json({ error: 'unauthorized' });
}

function loginHandler(req, res) {
  if (!authEnabled()) {
    const token = makeToken();
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE / 1000}`);
    return res.json({ ok: true });
  }

  const { password } = req.body || {};
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'invalid password' });
  }

  const token = makeToken();
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE / 1000}`);
  res.json({ ok: true });
}

function checkHandler(req, res) {
  if (!authEnabled()) return res.json({ authenticated: true, required: false });
  const cookies = parseCookies(req.headers.cookie);
  res.json({ authenticated: verifyToken(cookies[COOKIE]), required: true });
}

function logoutHandler(_req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
}

module.exports = { authMiddleware, loginHandler, checkHandler, logoutHandler, authEnabled };
