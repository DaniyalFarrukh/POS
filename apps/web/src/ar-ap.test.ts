import { describe, it, expect } from 'vitest';
import {
  calculateDaysDifference,
  classifyAgingBucket,
  checkReconciliation,
  computeAgingPercentages,
  getAgingBucketMeta,
} from './lib/ar-ap-utils';
import type { AgingSummary } from './types';

describe('Web AR & AP Utilities', () => {
  it('correctly classifies aging bucket boundaries', () => {
    expect(classifyAgingBucket(-5)).toBe('current');
    expect(classifyAgingBucket(0)).toBe('current');
    expect(classifyAgingBucket(1)).toBe('days1to30');
    expect(classifyAgingBucket(15)).toBe('days1to30');
    expect(classifyAgingBucket(30)).toBe('days1to30');
    expect(classifyAgingBucket(31)).toBe('days31to60');
    expect(classifyAgingBucket(60)).toBe('days31to60');
    expect(classifyAgingBucket(61)).toBe('days61to90');
    expect(classifyAgingBucket(90)).toBe('days61to90');
    expect(classifyAgingBucket(91)).toBe('days90Plus');
    expect(classifyAgingBucket(150)).toBe('days90Plus');
  });

  it('calculates days difference accurately between ISO dates', () => {
    expect(calculateDaysDifference('2026-11-04', '2026-11-04')).toBe(0);
    expect(calculateDaysDifference('2026-11-04', '2026-10-20')).toBe(15);
    expect(calculateDaysDifference('2026-11-04', '2026-10-05')).toBe(30);
    expect(calculateDaysDifference('2026-11-04', '2026-10-04')).toBe(31);
  });

  it('checks reconciliation equality and reports differences', () => {
    const balanced = checkReconciliation(500000, 500000);
    expect(balanced.differencePaisa).toBe(0);
    expect(balanced.isReconciled).toBe(true);

    const unbalanced = checkReconciliation(500000, 480000);
    expect(unbalanced.differencePaisa).toBe(20000);
    expect(unbalanced.isReconciled).toBe(false);
  });

  it('computes aging bucket percentages', () => {
    const aging: AgingSummary = {
      currentPaisa: 50000, // 50%
      days1to30Paisa: 20000, // 20%
      days31to60Paisa: 15000, // 15%
      days61to90Paisa: 10000, // 10%
      days90PlusPaisa: 5000, // 5%
    };
    const totalPaisa = 100000;
    const p = computeAgingPercentages(aging, totalPaisa);

    expect(p.current).toBe(50);
    expect(p.days1to30).toBe(20);
    expect(p.days31to60).toBe(15);
    expect(p.days61to90).toBe(10);
    expect(p.days90Plus).toBe(5);
  });

  it('provides meta styles for all aging buckets', () => {
    const buckets = ['current', 'days1to30', 'days31to60', 'days61to90', 'days90Plus'] as const;
    for (const b of buckets) {
      const meta = getAgingBucketMeta(b);
      expect(meta.label).toBeDefined();
      expect(meta.badgeClass).toBeDefined();
    }
  });
});
