const test = require('node:test');
const assert = require('node:assert/strict');
const { filterPlausiblePositions, isPlausibleStep, isStationaryMove } = require('../geo');

function move(time, lat, lng, speed = 40) {
  return {
    type: 'move',
    gps_time: time,
    lat,
    lng,
    speed,
  };
}

test('isStationaryMove ignores non-move types', () => {
  assert.equal(isStationaryMove({ type: 'acc on', speed: 0 }), false);
});

test('filterPlausiblePositions drops stationary fixes', () => {
  const points = [
    move('2026-01-01T10:00:00Z', 45, 9, 30),
    move('2026-01-01T10:01:00Z', 45, 9, 0),
    move('2026-01-01T10:02:00Z', 45.01, 9, 25),
  ];
  const kept = filterPlausiblePositions(points);
  assert.equal(kept.length, 2);
  assert.equal(kept[1].lat, 45.01);
});

test('isPlausibleStep allows small duplicate-time drift', () => {
  const a = move('2026-01-01T10:00:00Z', 45, 9);
  const b = move('2026-01-01T10:00:00Z', 45.0001, 9.0001);
  assert.equal(isPlausibleStep(a, b), true);
});
