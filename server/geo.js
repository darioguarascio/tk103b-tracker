const EARTH_RADIUS_KM = 6371;
const MAX_IMPLIED_SPEED_KMH = 180;
const MIN_DT_MS = 5000;
const MAX_JUMP_KM_SHORT = 15;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function isPlausibleStep(prev, curr) {
  const dist = haversineKm(prev, curr);
  const dtMs = new Date(curr.gps_time).getTime() - new Date(prev.gps_time).getTime();

  if (dtMs <= 0) return dist <= 0.5;

  if (dtMs < MIN_DT_MS && dist > MAX_JUMP_KM_SHORT) return false;

  const hours = dtMs / 3600000;
  const impliedSpeed = dist / hours;
  return impliedSpeed <= MAX_IMPLIED_SPEED_KMH;
}

function isStationaryMove(point) {
  return point.type === 'move' && Number(point.speed ?? 0) <= 0;
}

function filterPlausiblePositions(points) {
  if (!points?.length) return [];

  const sorted = [...points]
    .filter((p) => !isStationaryMove(p))
    .sort((a, b) => new Date(a.gps_time).getTime() - new Date(b.gps_time).getTime());

  if (!sorted.length) return [];

  const kept = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = kept[kept.length - 1];
    if (isPlausibleStep(prev, sorted[i])) kept.push(sorted[i]);
  }
  return kept;
}

function segmentTrack(points) {
  const filtered = filterPlausiblePositions(points);
  if (!filtered.length) return [];

  const segments = [[filtered[0]]];
  for (let i = 1; i < filtered.length; i++) {
    const prev = filtered[i - 1];
    const curr = filtered[i];
    const dtMs = new Date(curr.gps_time).getTime() - new Date(prev.gps_time).getTime();
    const dist = haversineKm(prev, curr);

    if (dtMs > 3600000 || dist > 5) {
      segments.push([curr]);
    } else {
      segments[segments.length - 1].push(curr);
    }
  }
  return segments;
}

module.exports = { filterPlausiblePositions, segmentTrack, haversineKm, isPlausibleStep, isStationaryMove };
