import { describe, it, expect } from 'vitest';
import {
  getExpenseStatusMeta,
  getPaymentTypeMeta,
  calculateExpenseKPIs,
  isApprovalRequired,
} from './lib/expense-utils';
import type { ExpenseRecord } from './types';

describe('Expense Utilities & KPI Calculations (Web)', () => {
  it('formats status metadata correctly', () => {
    expect(getExpenseStatusMeta('pending_approval').label).toBe('Pending Approval');
    expect(getExpenseStatusMeta('posted').label).toBe('Posted');
    expect(getExpenseStatusMeta('reversed').label).toBe('Reversed');
  });

  it('formats payment type metadata correctly', () => {
    expect(getPaymentTypeMeta('paid').label).toContain('Paid');
    expect(getPaymentTypeMeta('credit').label).toContain('Credit');
  });

  it('detects when approval is required based on threshold', () => {
    const threshold = 2500000; // Rs. 25,000
    expect(isApprovalRequired(2500000, threshold)).toBe(false);
    expect(isApprovalRequired(2500001, threshold)).toBe(true);
    expect(isApprovalRequired(5000000, threshold)).toBe(true);
    expect(isApprovalRequired(1000000, threshold)).toBe(false);
  });

  it('calculates expense summary KPIs accurately', () => {
    const mockExpenses: ExpenseRecord[] = [
      {
        id: 'exp-1',
        pharmacyId: 'p1',
        branchId: 'b1',
        expenseNumber: 'EXP-101',
        expenseDate: '2026-11-01',
        categoryId: 'c1',
        amountPaisa: 20000, // 200 Rs
        paymentType: 'paid',
        status: 'posted',
        approvalThresholdPaisa: 2500000,
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      },
      {
        id: 'exp-2',
        pharmacyId: 'p1',
        branchId: 'b1',
        expenseNumber: 'EXP-102',
        expenseDate: '2026-11-02',
        categoryId: 'c2',
        amountPaisa: 30000, // 300 Rs
        paymentType: 'credit',
        status: 'posted',
        approvalThresholdPaisa: 2500000,
        createdAt: '2026-11-02T00:00:00Z',
        updatedAt: '2026-11-02T00:00:00Z',
      },
      {
        id: 'exp-3',
        pharmacyId: 'p1',
        branchId: 'b1',
        expenseNumber: 'EXP-103',
        expenseDate: '2026-11-03',
        categoryId: 'c1',
        amountPaisa: 5000000,
        paymentType: 'paid',
        status: 'pending_approval',
        approvalThresholdPaisa: 2500000,
        createdAt: '2026-11-03T00:00:00Z',
        updatedAt: '2026-11-03T00:00:00Z',
      },
      {
        id: 'exp-4',
        pharmacyId: 'p1',
        branchId: 'b1',
        expenseNumber: 'EXP-104',
        expenseDate: '2026-11-04',
        categoryId: 'c2',
        amountPaisa: 10000,
        paymentType: 'paid',
        status: 'reversed',
        approvalThresholdPaisa: 2500000,
        createdAt: '2026-11-04T00:00:00Z',
        updatedAt: '2026-11-04T00:00:00Z',
      },
    ];

    const kpis = calculateExpenseKPIs(mockExpenses);
    // Posted: exp-1 (20,000) + exp-2 (30,000) = 50,000 paisa, count = 2
    expect(kpis.totalExpensesPaisa).toBe(50000);
    expect(kpis.expenseCount).toBe(2);
    expect(kpis.averageExpensePaisa).toBe(25000); // 50,000 / 2 = 25,000
    expect(kpis.pendingApprovalCount).toBe(1); // exp-3
  });
});
