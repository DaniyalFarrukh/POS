import { describe, it, expect } from 'vitest';
import { computeOfflineLevel } from './offlineLevel';

describe('offlineLevel: computeOfflineLevel (Phase 3.2)', () => {
  const maxOfflineHours = 72;
  const baseTime = new Date('2026-10-26T12:00:00.000Z');

  function timeAfterHours(hours: number): Date {
    return new Date(baseTime.getTime() + hours * 60 * 60 * 1000);
  }

  it('classifies 49% of max offline limit as level "ok"', () => {
    // 49% of 72 hours = 35.28 hours
    const hours = (49 / 100) * maxOfflineHours;
    const now = timeAfterHours(hours);

    const result = computeOfflineLevel(baseTime, now, maxOfflineHours);
    expect(result.level).toBe('ok');
    expect(result.hoursOffline).toBeCloseTo(35.28, 2);
    expect(result.percentUsed).toBeCloseTo(49, 2);
  });

  it('classifies 50% threshold as level "warning"', () => {
    // 50% of 72 hours = 36.00 hours
    const hours = (50 / 100) * maxOfflineHours;
    const now = timeAfterHours(hours);

    const result = computeOfflineLevel(baseTime, now, maxOfflineHours);
    expect(result.level).toBe('warning');
    expect(result.hoursOffline).toBeCloseTo(36.0, 2);
    expect(result.percentUsed).toBeCloseTo(50, 2);
  });

  it('classifies 79.9% as level "warning"', () => {
    const hours = (79.9 / 100) * maxOfflineHours;
    const now = timeAfterHours(hours);

    const result = computeOfflineLevel(baseTime, now, maxOfflineHours);
    expect(result.level).toBe('warning');
    expect(result.percentUsed).toBeCloseTo(79.9, 2);
  });

  it('classifies 80% threshold as level "critical"', () => {
    // 80% of 72 hours = 57.60 hours
    const hours = (80 / 100) * maxOfflineHours;
    const now = timeAfterHours(hours);

    const result = computeOfflineLevel(baseTime, now, maxOfflineHours);
    expect(result.level).toBe('critical');
    expect(result.hoursOffline).toBeCloseTo(57.6, 2);
    expect(result.percentUsed).toBeCloseTo(80, 2);
  });

  it('classifies 100% threshold as level "critical"', () => {
    // 100% of 72 hours = 72.00 hours
    const hours = maxOfflineHours;
    const now = timeAfterHours(hours);

    const result = computeOfflineLevel(baseTime, now, maxOfflineHours);
    expect(result.level).toBe('critical');
    expect(result.hoursOffline).toBeCloseTo(72.0, 2);
    expect(result.percentUsed).toBeCloseTo(100, 2);
  });

  it('classifies 101% of max offline limit as level "exceeded"', () => {
    // 101% of 72 hours = 72.72 hours
    const hours = (101 / 100) * maxOfflineHours;
    const now = timeAfterHours(hours);

    const result = computeOfflineLevel(baseTime, now, maxOfflineHours);
    expect(result.level).toBe('exceeded');
    expect(result.hoursOffline).toBeCloseTo(72.72, 2);
    expect(result.percentUsed).toBeCloseTo(101, 2);
  });

  it('handles null, undefined or zero duration safely as "ok"', () => {
    expect(computeOfflineLevel(null, baseTime, maxOfflineHours)).toEqual({
      level: 'ok',
      hoursOffline: 0,
      percentUsed: 0,
    });

    expect(computeOfflineLevel(undefined, baseTime, maxOfflineHours)).toEqual({
      level: 'ok',
      hoursOffline: 0,
      percentUsed: 0,
    });

    expect(computeOfflineLevel(baseTime, baseTime, maxOfflineHours)).toEqual({
      level: 'ok',
      hoursOffline: 0,
      percentUsed: 0,
    });
  });
});
