import { describe, it, expect } from 'vitest';
import {
  calculateProgressiveTax,
  calculateStatutoryComponentDeduction,
  computePayrollItemTotals,
  GeneratePayrollRunSchema,
  CreateEmployeeAdvanceSchema,
  CreateStatutoryComponentSchema,
  CreateTaxSlabSchema,
} from './payroll';

describe('Shared Payroll Schema & Calculation Utilities', () => {
  it('validates GeneratePayrollRunSchema', () => {
    const valid = {
      branchId: '018f3a2b-1234-7123-8123-0123456789ab',
      month: '2026-11',
      workingDays: 26,
    };
    expect(GeneratePayrollRunSchema.safeParse(valid).success).toBe(true);

    const invalidMonth = {
      branchId: '018f3a2b-1234-7123-8123-0123456789ab',
      month: '2026/11',
      workingDays: 26,
    };
    expect(GeneratePayrollRunSchema.safeParse(invalidMonth).success).toBe(false);

    const invalidDays = {
      branchId: '018f3a2b-1234-7123-8123-0123456789ab',
      month: '2026-11',
      workingDays: 32,
    };
    expect(GeneratePayrollRunSchema.safeParse(invalidDays).success).toBe(false);
  });

  it('validates CreateEmployeeAdvanceSchema', () => {
    const valid = {
      employeeId: '018f3a2b-1234-7123-8123-0123456789ab',
      principalPaisa: 5000000,
      monthlyInstallmentPaisa: 1000000,
      disbursementDate: '2026-11-01',
      reason: 'Medical expense',
    };
    expect(CreateEmployeeAdvanceSchema.safeParse(valid).success).toBe(true);

    const invalidPaisa = {
      ...valid,
      principalPaisa: 0,
    };
    expect(CreateEmployeeAdvanceSchema.safeParse(invalidPaisa).success).toBe(false);
  });

  it('validates CreateStatutoryComponentSchema and CreateTaxSlabSchema', () => {
    expect(
      CreateStatutoryComponentSchema.safeParse({
        code: 'EOBI',
        name: 'EOBI Pension',
        componentType: 'statutory_deduction',
        calculationType: 'fixed',
        fixedAmountPaisa: 150000,
        percentageRate: '0.00',
        accountCode: '2210',
      }).success
    ).toBe(true);

    expect(
      CreateTaxSlabSchema.safeParse({
        minMonthlyIncomePaisa: 5000000,
        maxMonthlyIncomePaisa: 10000000,
        baseTaxPaisa: 0,
        excessRatePercentage: '2.50',
      }).success
    ).toBe(true);
  });

  it('computes progressive income tax according to configurable slabs', () => {
    const slabs = [
      {
        minMonthlyIncomePaisa: 5000000, // 50k
        maxMonthlyIncomePaisa: 10000000, // 100k
        baseTaxPaisa: 0,
        excessRatePercentage: '2.50',
      },
      {
        minMonthlyIncomePaisa: 10000000, // 100k
        maxMonthlyIncomePaisa: 20000000, // 200k
        baseTaxPaisa: 125000, // 1,250 Rs
        excessRatePercentage: '12.50',
      },
    ];

    // Income below 50k (e.g. 40k)
    expect(calculateProgressiveTax(4000000, slabs)).toBe(0);

    // Income inside first bracket: 80,000 Rs (30,000 excess @ 2.5% = 750 Rs = 75,000 paisa)
    expect(calculateProgressiveTax(8000000, slabs)).toBe(75000);

    // Income inside second bracket: 150,000 Rs
    // Base tax: 1,250 Rs = 125,000 paisa
    // Excess: 50,000 Rs @ 12.5% = 6,250 Rs = 625,000 paisa
    // Total: 7,500 Rs = 750,000 paisa
    expect(calculateProgressiveTax(15000000, slabs)).toBe(750000);

    // Empty slabs return 0
    expect(calculateProgressiveTax(20000000, [])).toBe(0);
  });

  it('computes statutory component deductions for fixed and percentage types', () => {
    // Fixed amount e.g. EOBI Rs. 1,500 = 150,000 paisa
    const fixedComp = {
      code: 'EOBI',
      name: 'EOBI',
      accountCode: '2210',
      calculationType: 'fixed' as const,
      fixedAmountPaisa: 150000,
      percentageRate: '0.00',
    };
    expect(calculateStatutoryComponentDeduction(8000000, fixedComp)).toBe(150000);

    // Percentage e.g. Social security 1% of base salary 100,000 Rs
    const pctComp = {
      code: 'PESSI',
      name: 'PESSI',
      accountCode: '2210',
      calculationType: 'percentage' as const,
      fixedAmountPaisa: 0,
      percentageRate: '1.00',
    };
    expect(calculateStatutoryComponentDeduction(10000000, pctComp)).toBe(100000);
  });

  it('computes complete payroll item totals with unpaid leave deductions, overtime, and allowances', () => {
    const totals = computePayrollItemTotals({
      baseSalaryPaisa: 10000000, // 100,000 Rs
      unpaidLeaveDeductionPaisa: 769230, // 2 days @ 3,846.15 Rs
      overtimeAmountPaisa: 192308, // 4 hrs @ 480.77 Rs
      allowancesPaisa: 500000, // 5,000 Rs
      taxPaisa: 75000, // 750 Rs
      statutoryDeductionsPaisa: 150000, // 1,500 Rs
      advanceRecoveryPaisa: 1000000, // 10,000 Rs
    });

    // Gross salary: 10,000,000 - 769,230 + 192,308 + 500,000 = 9,923,078 paisa
    expect(totals.grossSalaryPaisa).toBe(9923078);

    // Total deductions: 75,000 (tax) + 150,000 (stat) + 1,000,000 (advance) = 1,225,000 paisa
    expect(totals.totalDeductionsPaisa).toBe(1225000);

    // Net salary: 9,923,078 - 1,225,000 = 8,698,078 paisa
    expect(totals.netSalaryPaisa).toBe(8698078);
  });
});
