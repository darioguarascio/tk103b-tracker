import { describe, expect, it } from 'vitest';
import {
  isPlausibleStep,
  isStationaryMove,
  replayPlaybackIndices,
  segmentTrack,
  windowRange,
} from './geo';

function move(id, time, lat, lng, speed = 40) {
  return {
    id,
    type: 'move',
    gps_time: time,
    lat,
    lng,
    speed,
    angle: 90,
  };
}

describe('isStationaryMove', () => {
  it('detects zero-speed moves', () => {
    expect(isStationaryMove({ type: 'move', speed: 0 })).toBe(true);
    expect(isStationaryMove({ type: 'move', speed: 10 })).toBe(false);
    expect(isStationaryMove({ type: 'acc on', speed: 0 })).toBe(false);
  });
});

describe('replayPlaybackIndices', () => {
  it('collapses parked runs', () => {
    const track = [
      move(1, '2026-01-01T10:00:00Z', 45, 9, 30),
      move(2, '2026-01-01T10:01:00Z', 45, 9, 0),
      move(3, '2026-01-01T10:02:00Z', 45, 9, 0),
      move(4, '2026-01-01T10:03:00Z', 45.01, 9, 25),
    ];
    expect(replayPlaybackIndices(track)).toEqual([0, 3]);
  });

  it('returns [0] for a single point', () => {
    expect(replayPlaybackIndices([move(1, '2026-01-01T10:00:00Z', 45, 9)])).toEqual([0]);
  });
});

describe('segmentTrack', () => {
  it('keeps coords and breaks on long gaps', () => {
    const points = [
      move(1, '2026-01-01T10:00:00Z', 45, 9, 0),
      move(2, '2026-01-01T10:01:00Z', 45.001, 9, 0),
      move(3, '2026-01-01T12:00:00Z', 45.1, 9.1, 40),
    ];
    const segments = segmentTrack(points);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(2);
    expect(segments[1]).toHaveLength(1);
  });
});

describe('isPlausibleStep', () => {
  it('rejects impossible short-interval jumps', () => {
    const a = move(1, '2026-01-01T10:00:00Z', 45, 9);
    const b = move(2, '2026-01-01T10:00:02Z', 46, 10);
    expect(isPlausibleStep(a, b)).toBe(false);
  });
});

describe('windowRange', () => {
  it('clamps start to rangeMin', () => {
    const end = '2026-06-15T12:00:00Z';
    const min = '2026-06-10T00:00:00Z';
    const { start } = windowRange(30, end, min);
    expect(start.getTime()).toBe(new Date(min).getTime());
  });
});
