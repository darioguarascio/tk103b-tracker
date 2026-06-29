const express = require('express');
const path = require('path');
const api = require('./routes/api');
const { pool } = require('./db');
const { authMiddleware, loginHandler, checkHandler, logoutHandler, authEnabled } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.post('/api/auth/login', loginHandler);
app.get('/api/auth/check', checkHandler);
app.post('/api/auth/logout', logoutHandler);

app.use('/api', authMiddleware, api);

const webDist = path.join(__dirname, '../web/dist');
app.use(express.static(webDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(webDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}${authEnabled() ? ' (auth enabled)' : ''}`);
});
