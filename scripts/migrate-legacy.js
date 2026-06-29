#!/usr/bin/env node
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const SOURCE = process.env.SOURCE || 'postgres://postgres@127.0.0.1:5512/postgres';
const TARGET = process.env.TARGET || 'postgres://postgres@10.99.0.2:5432/tk103b';
const BATCH = 2000;

function parseGpsTime(original, fallback) {
  if (!original || !original.startsWith('imei:')) return fallback;
  const parts = original.split(',');
  const dt = parts[2];
  if (!dt || dt.length < 12) return fallback;
  const y = 2000 + parseInt(dt.slice(0, 2), 10);
  const mo = parseInt(dt.slice(2, 4), 10);
  const d = parseInt(dt.slice(4, 6), 10);
  const h = parseInt(dt.slice(6, 8), 10);
  const mi = parseInt(dt.slice(8, 10), 10);
  const s = parseInt(dt.slice(10, 12), 10);
  const ts = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return isNaN(ts.getTime()) ? fallback : ts;
}

function extractImei(original) {
  if (!original?.startsWith('imei:')) return null;
  return original.split(',')[0].split(':')[1] || null;
}

async function main() {
  const target = new Pool({ connectionString: TARGET });
  const source = new Pool({ connectionString: SOURCE });

  const schema = fs.readFileSync(path.join(__dirname, '../migrations/001_schema.sql'), 'utf8');
  await target.query(schema);

  console.log('Reading source rows...');
  const { rows } = await source.query(`
    SELECT id, date_created, ST_X(coords) AS lng, ST_Y(coords) AS lat,
           original, type, speed, angle, ip
    FROM car
    WHERE coords IS NOT NULL
    ORDER BY id
  `);
  console.log(`Found ${rows.length} rows`);

  const trackers = new Map();
  for (const row of rows) {
    const imei = extractImei(row.original);
    if (!imei) continue;
    if (!trackers.has(imei)) {
      trackers.set(imei, { imei, created: row.date_created, updated: row.date_created });
    } else {
      const t = trackers.get(imei);
      if (row.date_created < t.created) t.created = row.date_created;
      if (row.date_created > t.updated) t.updated = row.date_created;
    }
  }

  console.log(`Upserting ${trackers.size} tracker(s)...`);
  const imeiToId = new Map();
  for (const t of trackers.values()) {
    const res = await target.query(
      `INSERT INTO tracker (imei, label, created_at, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (imei) DO UPDATE SET updated_at = EXCLUDED.updated_at
       RETURNING id`,
      [t.imei, `Tracker ${t.imei}`, t.created, t.updated]
    );
    imeiToId.set(t.imei, res.rows[0].id);
  }

  console.log('Migrating car events...');
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = [];
    const params = [];
    let n = 1;

    for (const row of batch) {
      const imei = extractImei(row.original);
      const trackerId = imeiToId.get(imei);
      if (!trackerId) continue;

      const gpsTime = parseGpsTime(row.original, row.date_created);
      values.push(
        `($${n++}, $${n++}, $${n++}, $${n++}, ST_SetSRID(ST_MakePoint($${n++}, $${n++}), 4326), $${n++}, $${n++}, $${n++}, $${n++}, $${n++})`
      );
      params.push(
        row.id,
        trackerId,
        gpsTime,
        row.date_created,
        row.lng,
        row.lat,
        row.type || 'unknown',
        row.speed,
        row.angle,
        row.ip || null,
        row.original
      );
    }

    if (values.length === 0) continue;

    await target.query(
      `INSERT INTO car (id, tracker_id, gps_time, date_created, coords, type, speed, angle, ip, original)
       VALUES ${values.join(', ')}
       ON CONFLICT (id) DO NOTHING`,
      params
    );
    inserted += values.length;
    process.stdout.write(`\r  ${inserted}/${rows.length}`);
  }

  await target.query(`SELECT setval('car_id_seq', (SELECT COALESCE(MAX(id), 1) FROM car))`);
  await target.query(`SELECT setval('tracker_id_seq', (SELECT COALESCE(MAX(id), 1) FROM tracker))`);

  const counts = await target.query(`
    SELECT 'tracker' AS tbl, count(*)::int FROM tracker
    UNION ALL SELECT 'car', count(*)::int FROM car
  `);
  console.log('\nDone:', counts.rows);

  await source.end();
  await target.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
