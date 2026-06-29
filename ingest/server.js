const net = require('node:net');
const { Pool } = require('pg');
const winston = require('winston');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}
const pool = new Pool({ connectionString: DATABASE_URL });

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
  ),
  level: 'debug',
  transports: [new winston.transports.Console({ timestamp: true })],
});

function parseGpsTime(original, fallback = new Date()) {
  if (!original?.startsWith('imei:')) return fallback;
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

function parseCoords(data) {
  const s = data.split(',');
  const l = s[7].split('.');
  const r = s[9].split('.');
  const lat = parseFloat(l[0].substring(0, 2)) + parseFloat(`${l[0].substring(2, 4)}.${l[1]}`) / 60;
  const lng = parseFloat(r[0].substring(0, 3)) + parseFloat(`${r[0].substring(3, 5)}.${r[1]}`) / 60;
  return { lat, lng };
}

async function ensureTracker(imei) {
  const res = await pool.query(
    `INSERT INTO tracker (imei, label, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (imei) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [imei, `Tracker ${imei}`]
  );
  return res.rows[0].id;
}

async function insertEvent({ imei, ip, speed, angle, type, original, lat, lng }) {
  const trackerId = await ensureTracker(imei);
  const gpsTime = parseGpsTime(original);
  await pool.query(
    `INSERT INTO car (tracker_id, gps_time, date_created, coords, type, speed, angle, ip, original)
     VALUES ($1, $2, now(), ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8, $9)`,
    [trackerId, gpsTime, lng, lat, type, speed, angle, ip || null, original]
  );
}

const server = net.createServer((c) => {
  logger.debug('client connected');
  c.on('end', () => logger.debug('client disconnected'));

  c.on('data', async (buf) => {
    const data = buf.toString();
    logger.info(JSON.stringify({ ip: c.remoteAddress, data }));

    if (data.startsWith('##,imei:')) {
      c.write('LOAD\r\n');
      return;
    }

    const imeiOnly = data.match(/^(\d{15});$/);
    if (imeiOnly) {
      c.write('ON\r\n');
      return;
    }

    if (data.startsWith('imei:')) {
      try {
        const s = data.split(',');
        const imei = extractImei(data);
        const { lat, lng } = parseCoords(data);
        await insertEvent({
          imei,
          ip: c.remoteAddress,
          speed: parseFloat(s[11]),
          angle: parseFloat(s[12].replace(';', '')),
          type: s[1],
          original: data,
          lat,
          lng,
        });
      } catch (e) {
        logger.error(e.message);
      }
      return;
    }

    logger.debug(`unknown packet: ${data.slice(0, 80)}`);
  });
});

server.on('error', (err) => { throw err; });
server.listen(9000, () => logger.info('GPS server bound on :9000'));

function shutdown() {
  server.close(() => {
    pool.end().then(() => process.exit(0));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
