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

async function recordPing(imei) {
  await ensureTracker(imei);
}

function formatLog(ip, message) {
  const host = ip?.replace(/^::ffff:/, '') || '?';
  return `[${host}] ${message}`;
}

function describePacket(data, ip) {
  const host = ip?.replace(/^::ffff:/, '') || '?';

  if (data.startsWith('##,imei:')) {
    const imei = extractImei(data.replace('##,', ''));
    return formatLog(host, `handshake imei=${imei || '?'}`);
  }

  const imeiOnly = data.match(/^(\d{15});$/);
  if (imeiOnly) {
    return formatLog(host, `ping imei=${imeiOnly[1]}`);
  }

  const imeiShort = data.match(/^imei:(\d{15});?$/);
  if (imeiShort) {
    return formatLog(host, `ping imei=${imeiShort[1]}`);
  }

  if (data.startsWith('imei:')) {
    const imei = extractImei(data);
    const parts = data.split(',');
    const type = parts[1] || '?';
    const speed = parts[11] ?? '?';
    const angle = parts[12]?.replace(';', '') ?? '?';
    let coords = '';
    try {
      const { lat, lng } = parseCoords(data);
      coords = ` lat=${lat.toFixed(5)} lng=${lng.toFixed(5)}`;
    } catch {
      coords = ' coords=?';
    }
    return formatLog(host, `${type} imei=${imei || '?'} speed=${speed} angle=${angle}${coords}`);
  }

  const preview = data.replace(/\r?\n/g, ' ').slice(0, 100);
  return formatLog(host, `unknown (${data.length}b): ${preview}`);
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
  const ip = c.remoteAddress;
  logger.debug(formatLog(ip, 'client connected'));
  c.on('end', () => logger.debug(formatLog(ip, 'client disconnected')));

  c.on('data', async (buf) => {
    const data = buf.toString().trim();
    logger.info(describePacket(data, ip));

    if (data.startsWith('##,imei:')) {
      const imei = extractImei(data.replace('##,', ''));
      if (imei) {
        try {
          await recordPing(imei);
        } catch (e) {
          logger.error(formatLog(ip, `ping failed imei=${imei}: ${e.message}`));
        }
      }
      c.write('LOAD\r\n');
      return;
    }

    const imeiOnly = data.match(/^(\d{15});?$/);
    if (imeiOnly) {
      try {
        await recordPing(imeiOnly[1]);
      } catch (e) {
        logger.error(formatLog(ip, `ping failed imei=${imeiOnly[1]}: ${e.message}`));
      }
      c.write('ON\r\n');
      return;
    }

    const imeiShort = data.match(/^imei:(\d{15});?$/);
    if (imeiShort) {
      try {
        await recordPing(imeiShort[1]);
      } catch (e) {
        logger.error(formatLog(ip, `ping failed imei=${imeiShort[1]}: ${e.message}`));
      }
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
          ip,
          speed: parseFloat(s[11]),
          angle: parseFloat(s[12].replace(';', '')),
          type: s[1],
          original: data,
          lat,
          lng,
        });
      } catch (e) {
        logger.error(formatLog(ip, `insert failed: ${e.message}`));
      }
      return;
    }

    logger.debug(formatLog(ip, `ignored packet (${data.length}b)`));
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
