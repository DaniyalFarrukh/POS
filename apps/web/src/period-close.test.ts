import { describe, it, expect } from 'vitest';
import {
  formatPaisa,
  formatPeriodDateRange,
  getChecklistSummary,
  isYearEndPeriod,
  validateReopenReason,
  filterPeriodsByYear,
} from './lib/period-close-utils';
import type { FiscalPeriodItem, PeriodChecklistItem } from './types';

describe('Period Close Utilities', () => {
  it('1. formatPaisa formats PKR integer paisa currency correctly', () => {
    expect(formatPaisa(18000000)).toContain('180,000.00');
    expect(formatPaisa(0)).toContain('0.00');
    expect(formatPaisa(-500000)).toContain('5,000.00');
  });

  it('2. formatPeriodDateRange formats valid date ranges', () => {
    expect(formatPeriodDateRange('2026-03-01', '2026-03-31')).toBe('2026-03-01 to 2026-03-31');
    expect(formatPeriodDateRange('', '')).toBe('');
  });

  it('3. getChecklistSummary computes passed/warning items and readiness score accurately', () => {
    const mixedItems: PeriodChecklistItem[] = [
      {
        id: 'unposted_documents',
        title: 'Unposted Docs',
        status: 'passed',
        count: 0,
        description: 'All clear',
      },
      {
        id: 'bank_reconciliation',
        title: 'Bank Rec',
        status: 'warning',
        count: 1,
        description: 'Pending rec',
      },
      {
        id: 'stock_count',
        title: 'Stock Count',
        status: 'passed',
        count: 0,
        description: 'Count verified',
      },
      {
        id: 'reconciliation_differences',
        title: 'Recon Diff',
        status: 'passed',
        count: 0,
        description: 'Zero diff',
      },
    ];

    const mixedSummary = getChecklistSummary(mixedItems);
    expect(mixedSummary.total).toBe(4);
    expect(mixedSummary.passed).toBe(3);
    expect(mixedSummary.warning).toBe(1);
    expect(mixedSummary.canClose).toBe(false);
    expect(mixedSummary.readinessScore).toBe(75);

    const cleanItems: PeriodChecklistItem[] = [
      {
        id: 'unposted_documents',
        title: 'Unposted Docs',
        status: 'passed',
        count: 0,
        description: 'All clear',
      },
      {
        id: 'bank_reconciliation',
        title: 'Bank Rec',
        status: 'passed',
        count: 0,
        description: 'All reconciled',
      },
      {
        id: 'stock_count',
        title: 'Stock Count',
        status: 'passed',
        count: 0,
        description: 'Count verified',
      },
      {
        id: 'reconciliation_differences',
        title: 'Recon Diff',
        status: 'passed',
        count: 0,
        description: 'Zero diff',
      },
    ];

    const cleanSummary = getChecklistSummary(cleanItems);
    expect(cleanSummary.canClose).toBe(true);
    expect(cleanSummary.readinessScore).toBe(100);
  });

  it('4. isYearEndPeriod flags December (month 12) as year-end period', () => {
    expect(isYearEndPeriod(12)).toBe(true);
    expect(isYearEndPeriod(1)).toBe(false);
    expect(isYearEndPeriod(6)).toBe(false);
  });

  it('5. validateReopenReason enforces mandatory reason with minimum 5 characters', () => {
    expect(validateReopenReason('').isValid).toBe(false);
    expect(validateReopenReason('   ').isValid).toBe(false);
    expect(validateReopenReason('fix').isValid).toBe(false);
    expect(validateReopenReason('Auditing supplier invoices').isValid).toBe(true);
  });

  it('6. filterPeriodsByYear filters fiscal periods by year prefix', () => {
    const samplePeriods: FiscalPeriodItem[] = [
      {
        id: 'p1',
        pharmacyId: 'ph1',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        status: 'closed',
        closedAt: '2026-02-01T00:00:00Z',
        closedBy: 'u1',
        reopenedAt: null,
        reopenedBy: null,
        reopenReason: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'p2',
        pharmacyId: 'ph1',
        startDate: '2025-12-01',
        endDate: '2025-12-31',
        status: 'closed',
        closedAt: '2026-01-01T00:00:00Z',
        closedBy: 'u1',
        reopenedAt: null,
        reopenedBy: null,
        reopenReason: null,
        createdAt: '2025-12-01T00:00:00Z',
        updatedAt: '2025-12-01T00:00:00Z',
      },
    ];

    const res2026 = filterPeriodsByYear(samplePeriods, 2026);
    expect(res2026).toHaveLength(1);
    expect(res2026[0]!.id).toBe('p1');
  });
});
