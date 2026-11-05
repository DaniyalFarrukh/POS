import { describe, it, expect } from 'vitest';
import {
  formatPKR,
  getPayrollStatusBadge,
  formatAllowancesSummary,
  formatStatutorySummary,
  filterPayrollRuns,
} from './lib/payroll-utils';
import type { PayrollRunRecord } from './types';

describe('Payroll Web Utilities', () => {
  it('formats PKR currency correctly with 2 decimal places', () => {
    expect(formatPKR(0)).toBe('Rs. 0.00');
    expect(formatPKR(15000000)).toBe('Rs. 150,000.00');
    expect(formatPKR(2550)).toBe('Rs. 25.50');
  });

  it('returns proper badges for each payroll run status', () => {
    expect(getPayrollStatusBadge('draft')).toEqual({ label: 'Draft', variant: 'secondary' });
    expect(getPayrollStatusBadge('reviewed')).toEqual({ label: 'Reviewed', variant: 'warning' });
    expect(getPayrollStatusBadge('approved')).toEqual({
      label: 'Approved (Locked)',
      variant: 'default',
    });
    expect(getPayrollStatusBadge('posted')).toEqual({
      label: 'Posted to Ledger',
      variant: 'warning',
    });
    expect(getPayrollStatusBadge('paid')).toEqual({
      label: 'Paid & Disbursed',
      variant: 'success',
    });
    expect(getPayrollStatusBadge('cancelled')).toEqual({
      label: 'Cancelled',
      variant: 'destructive',
    });
  });

  it('formats allowances breakdown summary JSON', () => {
    expect(formatAllowancesSummary(null)).toBe('None');
    expect(formatAllowancesSummary('')).toBe('None');
    expect(formatAllowancesSummary('invalid-json')).toBe('None');
    expect(formatAllowancesSummary('[]')).toBe('None');

    const allowances = JSON.stringify([
      { name: 'Fuel', amountPaisa: 500000 },
      { name: 'Medical', amountPaisa: 300000 },
    ]);
    expect(formatAllowancesSummary(allowances)).toBe('Fuel: Rs. 5,000.00, Medical: Rs. 3,000.00');
  });

  it('formats statutory deductions breakdown summary JSON', () => {
    expect(formatStatutorySummary(null)).toBe('None');
    expect(formatStatutorySummary('')).toBe('None');
    expect(formatStatutorySummary('[]')).toBe('None');

    const statutory = JSON.stringify([
      { code: 'EOBI', amountPaisa: 150000 },
      { code: 'PESSI', amountPaisa: 50000 },
    ]);
    expect(formatStatutorySummary(statutory)).toBe('EOBI: Rs. 1,500.00, PESSI: Rs. 500.00');
  });

  it('filters payroll runs by branch, month, and status', () => {
    const baseRun = {
      totalBaseSalaryPaisa: 0,
      totalAllowancesPaisa: 0,
      totalOvertimePaisa: 0,
      totalUnpaidLeaveDeductionsPaisa: 0,
      totalAdvancesRecoveredPaisa: 0,
      totalTaxPaisa: 0,
      totalStatutoryPaisa: 0,
    };

    const runs: PayrollRunRecord[] = [
      {
        ...baseRun,
        id: 'r1',
        pharmacyId: 'p1',
        branchId: 'b1',
        month: '2026-11',
        runNumber: 'PR-2026-11-001',
        status: 'draft',
        totalGrossPaisa: 10000000,
        totalDeductionsPaisa: 1000000,
        totalNetPaisa: 9000000,
        employeeCount: 5,
        isAdjustmentRun: false,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
      },
      {
        ...baseRun,
        id: 'r2',
        pharmacyId: 'p1',
        branchId: 'b2',
        month: '2026-11',
        runNumber: 'PR-2026-11-002',
        status: 'posted',
        totalGrossPaisa: 15000000,
        totalDeductionsPaisa: 1500000,
        totalNetPaisa: 13500000,
        employeeCount: 8,
        isAdjustmentRun: false,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
      },
      {
        ...baseRun,
        id: 'r3',
        pharmacyId: 'p1',
        branchId: 'b1',
        month: '2026-10',
        runNumber: 'PR-2026-10-001',
        status: 'paid',
        totalGrossPaisa: 9500000,
        totalDeductionsPaisa: 950000,
        totalNetPaisa: 8550000,
        employeeCount: 5,
        isAdjustmentRun: false,
        createdAt: '2026-10-01',
        updatedAt: '2026-10-01',
      },
    ];

    expect(filterPayrollRuns(runs, {})).toHaveLength(3);
    expect(filterPayrollRuns(runs, { branchId: 'b1' })).toHaveLength(2);
    expect(filterPayrollRuns(runs, { month: '2026-11' })).toHaveLength(2);
    expect(filterPayrollRuns(runs, { status: 'posted' })).toHaveLength(1);
    expect(
      filterPayrollRuns(runs, { branchId: 'b1', month: '2026-11', status: 'draft' })
    ).toHaveLength(1);
    expect(filterPayrollRuns(runs, { branchId: 'b2', month: '2026-10' })).toHaveLength(0);
  });
});
