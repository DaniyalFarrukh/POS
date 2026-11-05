import { describe, it, expect } from 'vitest';
import {
  calculateVariance,
  calculatePercentageUsed,
  getAlertStatus,
  generateBudgetCsv,
  MONTH_NAMES,
} from './lib/budget-utils';
import type { ActualVsBudgetReportData } from './types';

describe('Budget Planning Frontend Utilities', () => {
  it('1. Calculates variance for expense and revenue accounts', () => {
    // Expense: Budget 50,000 PKR (5,000,000 paisa), Actual 40,000 PKR (4,000,000 paisa)
    // Variance = Budget - Actual = +1,000,000 (favorable / under budget)
    const expUnder = calculateVariance(5000000, 4000000, 'expense');
    expect(expUnder).toBe(1000000);

    // Expense over budget: Budget 50,000 PKR, Actual 60,000 PKR
    // Variance = Budget - Actual = -1,000,000 (unfavorable / over budget)
    const expOver = calculateVariance(5000000, 6000000, 'expense');
    expect(expOver).toBe(-1000000);

    // Revenue: Budget 100,000 PKR (10,000,000 paisa), Actual 120,000 PKR (12,000,000 paisa)
    // Variance = Actual - Budget = +2,000,000 (favorable / exceeded target)
    const revExceeded = calculateVariance(10000000, 12000000, 'revenue');
    expect(revExceeded).toBe(2000000);

    // Revenue lagging: Budget 100,000 PKR, Actual 80,000 PKR
    // Variance = Actual - Budget = -2,000,000 (unfavorable / under target)
    const revLag = calculateVariance(10000000, 8000000, 'revenue');
    expect(revLag).toBe(-2000000);
  });

  it('2. Calculates percentage used with zero handling', () => {
    expect(calculatePercentageUsed(10000, 5000)).toBe(50);
    expect(calculatePercentageUsed(10000, 9500)).toBe(95);
    expect(calculatePercentageUsed(10000, 12000)).toBe(120);
    // Budget is 0, actual is 0 -> 0%
    expect(calculatePercentageUsed(0, 0)).toBe(0);
    // Budget is 0, actual > 0 -> 100%
    expect(calculatePercentageUsed(0, 5000)).toBe(100);
  });

  it('3. Computes alert status across boundaries (89.9% vs 90.0% vs 100.1%)', () => {
    // Expense boundaries
    expect(getAlertStatus(89.9, 'expense')).toBe('normal');
    expect(getAlertStatus(90.0, 'expense')).toBe('warning');
    expect(getAlertStatus(99.9, 'expense')).toBe('warning');
    expect(getAlertStatus(100.0, 'expense')).toBe('warning');
    expect(getAlertStatus(100.1, 'expense')).toBe('exceeded');

    // Revenue boundaries
    expect(getAlertStatus(89.9, 'revenue')).toBe('under');
    expect(getAlertStatus(90.0, 'revenue')).toBe('on_track');
    expect(getAlertStatus(100.0, 'revenue')).toBe('on_track');
    expect(getAlertStatus(100.1, 'revenue')).toBe('achieved');
  });

  it('4. Generates valid RFC-4180 CSV export', () => {
    const mockData: ActualVsBudgetReportData = {
      pharmacyId: 'p1',
      fiscalYear: 2026,
      month: 1,
      branchId: 'b1',
      branchName: 'Clifton Main',
      summary: {
        totalExpenseBudgetPaisa: 10000000,
        totalExpenseActualPaisa: 8000000,
        totalExpenseVariancePaisa: 2000000,
        totalRevenueBudgetPaisa: 50000000,
        totalRevenueActualPaisa: 55000000,
        totalRevenueVariancePaisa: 5000000,
        netBudgetPaisa: 40000000,
        netActualPaisa: 47000000,
        netVariancePaisa: 7000000,
        alertCount: 0,
      },
      alerts: [],
      rows: [
        {
          accountId: 'a1',
          accountCode: '6010',
          accountName: 'Rent',
          accountType: 'expense',
          branchId: 'b1',
          branchName: 'Clifton Main',
          budgetPaisa: 10000000,
          actualPaisa: 8000000,
          variancePaisa: 2000000,
          varianceBp: 2000,
          percentageUsed: 80,
          alertStatus: 'normal',
        },
      ],
    };

    const csv = generateBudgetCsv(mockData);
    expect(csv).toContain('"Actual vs Budget Report"');
    expect(csv).toContain('"Period:","January 2026"');
    expect(csv).toContain('"6010","Rent","EXPENSE"');
    expect(MONTH_NAMES[0]).toBe('January');
  });
});
