import { describe, expect, it } from 'vitest';
import {
  eventColor,
  fmtRelativeAgo,
  isLiveToastType,
  liveUpdateFreshness,
} from './api';

describe('fmtRelativeAgo', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');

  it('formats seconds', () => {
    expect(fmtRelativeAgo('2026-01-01T11:59:58Z', now)).toBe('2s ago');
  });

  it('handles missing value', () => {
    expect(fmtRelativeAgo(null, now)).toBe('—');
  });
});

describe('liveUpdateFreshness', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');

  it('classifies recent updates as fresh', () => {
    expect(liveUpdateFreshness('2026-01-01T11:59:50Z', now)).toBe('fresh');
  });

  it('classifies old updates as stale', () => {
    expect(liveUpdateFreshness('2026-01-01T11:57:00Z', now)).toBe('stale');
  });
});

describe('eventColor', () => {
  it('returns known colors', () => {
    expect(eventColor('move')).toBe('#3b82f6');
  });

  it('falls back for unknown types', () => {
    expect(eventColor('unknown')).toBe('#94a3b8');
  });
});

describe('isLiveToastType', () => {
  it('flags alarm types', () => {
    expect(isLiveToastType('acc alarm')).toBe(true);
    expect(isLiveToastType('move')).toBe(false);
  });
});
