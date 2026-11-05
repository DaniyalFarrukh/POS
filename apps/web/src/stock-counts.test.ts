import { describe, it, expect } from 'vitest';
import {
  getCountStatusDetails,
  calculateCountKPIs,
  calculateLineVariance,
  canApproveCount,
} from './lib/count-utils';
import type { StockCountRecord } from './types';

describe('Stock Counts Web Utilities & Logic', () => {
  it('correctly maps status details and badges', () => {
    const draft = getCountStatusDetails('draft');
    expect(draft.label).toBe('Draft');
    expect(draft.badgeClass).toContain('slate');

    const submitted = getCountStatusDetails('submitted');
    expect(submitted.label).toBe('Pending Approval');
    expect(submitted.badgeClass).toContain('blue');

    const approved = getCountStatusDetails('approved');
    expect(approved.label).toBe('Approved & Posted');
    expect(approved.badgeClass).toContain('emerald');

    const cancelled = getCountStatusDetails('cancelled');
    expect(cancelled.label).toBe('Cancelled');
    expect(cancelled.badgeClass).toContain('rose');
  });

  it('calculates variance math and paisa impact accurately', () => {
    // 1. Deficit / Shortage: System has 100, counted 92, cost Rs. 150 (15,000 paisa)
    // Variance Qty: -8, Variance Paisa: -120,000 paisa (-Rs. 1,200)
    const deficit = calculateLineVariance(100, 92, 15000);
    expect(deficit.varianceQuantity).toBe(-8);
    expect(deficit.variancePaisa).toBe(-120000);

    // 2. Surplus / Gain: System has 50, counted 55, cost Rs. 50 (5,000 paisa)
    // Variance Qty: +5, Variance Paisa: +25,000 paisa (+Rs. 250)
    const surplus = calculateLineVariance(50, 55, 5000);
    expect(surplus.varianceQuantity).toBe(5);
    expect(surplus.variancePaisa).toBe(25000);

    // 3. Exact Match: System has 30, counted 30
    const exact = calculateLineVariance(30, 30, 8000);
    expect(exact.varianceQuantity).toBe(0);
    expect(exact.variancePaisa).toBe(0);
  });

  it('calculates KPI counts across sessions', () => {
    const mockCounts: Partial<StockCountRecord>[] = [
      { id: '1', status: 'draft' },
      { id: '2', status: 'submitted' },
      { id: '3', status: 'submitted' },
      { id: '4', status: 'approved' },
      { id: '5', status: 'cancelled' },
    ];

    const kpis = calculateCountKPIs(mockCounts as StockCountRecord[]);
    expect(kpis.totalCounts).toBe(5);
    expect(kpis.draftCount).toBe(1);
    expect(kpis.submittedCount).toBe(2);
    expect(kpis.approvedCount).toBe(1);
  });

  it('restricts count approval to owner or manager', () => {
    expect(canApproveCount('owner')).toBe(true);
    expect(canApproveCount('manager')).toBe(true);
    expect(canApproveCount('pharmacist')).toBe(false);
    expect(canApproveCount('cashier')).toBe(false);
    expect(canApproveCount('accountant')).toBe(false);
    expect(canApproveCount(undefined)).toBe(false);
  });
});
