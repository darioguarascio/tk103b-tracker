const express = require('express');
const { query } = require('../db');
const { filterPlausiblePositions, isPlausibleStep, isStationaryMove } = require('../geo');

const router = express.Router();

const EVENT_TYPES = ['move', 'acc alarm', 'sensor alarm', 'acc off', 'acc on', 'tracker', 'ac alarm'];

router.get('/trackers', async (_req, res) => {
  const { rows } = await query(`
    SELECT t.id, t.imei, t.label, t.updated_at,
           GREATEST(t.updated_at, COALESCE(c.gps_time, t.updated_at)) AS last_seen,
           ST_X(c.coords) AS lng, ST_Y(c.coords) AS lat,
           c.type AS last_type, c.speed AS last_speed, c.angle AS last_angle
    FROM tracker t
    LEFT JOIN LATERAL (
      SELECT gps_time, coords, type, speed, angle
      FROM car
      WHERE tracker_id = t.id
      ORDER BY gps_time DESC
      LIMIT 1
    ) c ON true
    ORDER BY t.id
  `);
  res.json(rows);
});

router.get('/positions/latest', async (req, res) => {
  const trackerId = req.query.tracker_id;
  const params = [];
  let filter = '';
  if (trackerId) {
    params.push(trackerId);
    filter = 'WHERE c.tracker_id = $1';
  }

  const { rows } = await query(`
    SELECT DISTINCT ON (c.tracker_id)
      c.id, c.tracker_id, t.imei, t.label,
      c.gps_time, c.date_created, c.type, c.speed, c.angle,
      ST_X(c.coords) AS lng, ST_Y(c.coords) AS lat, c.original
    FROM car c
    JOIN tracker t ON t.id = c.tracker_id
    ${filter}
    ORDER BY c.tracker_id, c.gps_time DESC
  `, params);
  res.json(rows);
});

router.get('/track', async (req, res) => {
  const { tracker_id, from, to, types } = req.query;
  if (!tracker_id) return res.status(400).json({ error: 'tracker_id required' });

  const params = [tracker_id];
  const conditions = ['c.tracker_id = $1', 'c.coords IS NOT NULL'];

  if (from) {
    params.push(from);
    conditions.push(`c.gps_time >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`c.gps_time <= $${params.length}`);
  }
  if (types) {
    const typeList = types.split(',').map((t) => t.trim()).filter(Boolean);
    if (typeList.length) {
      params.push(typeList);
      conditions.push(`c.type = ANY($${params.length})`);
    }
  } else {
    conditions.push(`c.type = 'move'`);
  }

  const { rows } = await query(`
    SELECT c.id, c.gps_time, c.type, c.speed, c.angle,
           ST_X(c.coords) AS lng, ST_Y(c.coords) AS lat
    FROM car c
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.gps_time ASC
    LIMIT 50000
  `, params);
  res.json(filterPlausiblePositions(rows));
});

router.get('/events', async (req, res) => {
  const { tracker_id, from, to, types } = req.query;
  if (!tracker_id) return res.status(400).json({ error: 'tracker_id required' });

  const params = [tracker_id];
  const conditions = ['c.tracker_id = $1', 'c.coords IS NOT NULL'];

  if (from) {
    params.push(from);
    conditions.push(`c.gps_time >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`c.gps_time <= $${params.length}`);
  }

  if (types) {
    const typeList = types.split(',').map((t) => t.trim()).filter(Boolean);
    if (typeList.length) {
      params.push(typeList);
      conditions.push(`c.type = ANY($${params.length})`);
    }
  } else {
    conditions.push(`c.type <> 'move'`);
  }

  const { rows } = await query(`
    SELECT c.id, c.gps_time, c.type, c.speed, c.angle, c.original,
           ST_X(c.coords) AS lng, ST_Y(c.coords) AS lat
    FROM car c
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.gps_time DESC
    LIMIT 5000
  `, params);
  res.json(filterPlausiblePositions([...rows].reverse()).reverse());
});

router.get('/stats', async (req, res) => {
  const trackerId = req.query.tracker_id;
  const params = [];
  let filter = '';
  if (trackerId) {
    params.push(trackerId);
    filter = 'WHERE tracker_id = $1';
  }

  const { rows } = await query(`
    SELECT type, count(*)::int AS count
    FROM car ${filter}
    GROUP BY type
    ORDER BY count DESC
  `, params);
  res.json({ types: EVENT_TYPES, counts: rows });
});

router.get('/range', async (req, res) => {
  const { tracker_id, from, to } = req.query;
  const params = [];
  const conditions = [];

  if (tracker_id) {
    params.push(tracker_id);
    conditions.push(`tracker_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`gps_time >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`gps_time <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(`
    SELECT min(gps_time) AS min_time, max(gps_time) AS max_time, count(*)::int AS total
    FROM car ${where}
  `, params);
  res.json(rows[0]);
});

async function fetchLiveRows(trackerId, sinceId) {
  const params = [sinceId];
  let filter = 'c.id > $1';
  if (trackerId) {
    params.push(trackerId);
    filter += ` AND c.tracker_id = $${params.length}`;
  }

  const { rows } = await query(`
    SELECT c.id, c.tracker_id, c.gps_time, c.type, c.speed, c.angle,
           ST_X(c.coords) AS lng, ST_Y(c.coords) AS lat
    FROM car c
    WHERE ${filter}
    ORDER BY c.id ASC
    LIMIT 100
  `, params);

  const out = [];
  let lastSent = null;
  for (const row of rows) {
    if (row.type === 'move' && isStationaryMove(row)) continue;
    if (row.type === 'move' && lastSent && !isPlausibleStep(lastSent, row)) continue;
    out.push(row);
    if (row.lat != null && row.lng != null) lastSent = row;
  }
  return out;
}

router.get('/live/poll', async (req, res) => {
  try {
    const trackerId = req.query.tracker_id;
    const sinceId = parseInt(req.query.since_id || '0', 10);
    const rows = await fetchLiveRows(trackerId, sinceId);
    res.json(rows);
  } catch (err) {
    console.error('live poll error', err);
    res.status(500).json({ error: 'poll failed' });
  }
});

router.get('/live', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const trackerId = req.query.tracker_id;
  let lastId = parseInt(req.query.since_id || '0', 10);

  const send = (row) => {
    res.write(`data: ${JSON.stringify(row)}\n\n`);
  };

  const poll = async () => {
    try {
      const rows = await fetchLiveRows(trackerId, lastId);
      for (const row of rows) {
        lastId = row.id;
        send(row);
      }
    } catch (err) {
      console.error('live poll error', err);
    }
  };

  const interval = setInterval(poll, 2000);
  poll();
  req.on('close', () => clearInterval(interval));
});

module.exports = router;
