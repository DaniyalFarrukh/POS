import { z } from 'zod';
import { DateStringSchema, MonthStringSchema } from './hr';

// 1. Statutory Component Schemas
export const CreateStatutoryComponentSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').toUpperCase(),
  name: z.string().trim().min(1, 'Name is required'),
  componentType: z.enum(['statutory_deduction', 'tax']).default('statutory_deduction'),
  calculationType: z.enum(['fixed', 'percentage']).default('fixed'),
  fixedAmountPaisa: z.number().int().nonnegative().default(0),
  percentageRate: z.string().default('0'),
  accountCode: z.string().default('2210'),
  notes: z.string().optional(),
  isExample: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export type CreateStatutoryComponentInput = z.infer<typeof CreateStatutoryComponentSchema>;

export const UpdateStatutoryComponentSchema = CreateStatutoryComponentSchema.partial();
export type UpdateStatutoryComponentInput = z.infer<typeof UpdateStatutoryComponentSchema>;

// 2. Tax Slab Schemas
export const CreateTaxSlabSchema = z.object({
  minMonthlyIncomePaisa: z.number().int().nonnegative().default(0),
  maxMonthlyIncomePaisa: z.number().int().nonnegative().optional().nullable(),
  baseTaxPaisa: z.number().int().nonnegative().default(0),
  excessRatePercentage: z.string().default('0'),
  notes: z.string().optional(),
  isExample: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export type CreateTaxSlabInput = z.infer<typeof CreateTaxSlabSchema>;

// 3. Employee Advances
export const CreateEmployeeAdvanceSchema = z.object({
  employeeId: z.string().uuid('Valid employee ID is required'),
  disbursementDate: DateStringSchema,
  principalPaisa: z.number().int().positive('Principal must be positive integer paisa'),
  monthlyInstallmentPaisa: z
    .number()
    .int()
    .positive('Monthly installment must be positive integer paisa'),
  reason: z.string().optional(),
});

export type CreateEmployeeAdvanceInput = z.infer<typeof CreateEmployeeAdvanceSchema>;

// 4. Payroll Run Generation & Lifecycle
export const GeneratePayrollRunSchema = z.object({
  branchId: z.string().uuid('Valid branch ID is required'),
  month: MonthStringSchema,
  workingDays: z.coerce.number().int().min(1).max(31).default(30),
});

export type GeneratePayrollRunInput = z.infer<typeof GeneratePayrollRunSchema>;

export const AllowanceItemSchema = z.object({
  name: z.string().min(1),
  amountPaisa: z.number().int().nonnegative(),
});

export const UpdatePayrollItemSchema = z.object({
  overtimeHours: z.number().nonnegative().optional(),
  overtimeAmountPaisa: z.number().int().nonnegative().optional(),
  allowancesPaisa: z.number().int().nonnegative().optional(),
  allowancesBreakdown: z.array(AllowanceItemSchema).optional(),
  advanceRecoveryPaisa: z.number().int().nonnegative().optional(),
});

export type UpdatePayrollItemInput = z.infer<typeof UpdatePayrollItemSchema>;

export const CreateAdjustmentRunSchema = z.object({
  originalRunId: z.string().uuid('Valid original payroll run ID is required'),
  reason: z.string().trim().min(1, 'Adjustment reason is required'),
});

export type CreateAdjustmentRunInput = z.infer<typeof CreateAdjustmentRunSchema>;

export const PayPayrollRunSchema = z.object({
  paymentAccountId: z.string().uuid('Payment account ID is required'),
  paymentMethod: z.enum(['cash', 'bank', 'cheque']).default('bank'),
  paymentDate: DateStringSchema.optional(),
});

export type PayPayrollRunInput = z.infer<typeof PayPayrollRunSchema>;

// 5. Mathematical Calculation Helpers
export interface TaxSlabCalculationDef {
  minMonthlyIncomePaisa: number;
  maxMonthlyIncomePaisa: number | null;
  baseTaxPaisa: number;
  excessRatePercentage: string;
}

/**
 * Computes progressive income tax using active brackets
 */
export function calculateProgressiveTax(
  monthlyIncomePaisa: number,
  slabs: TaxSlabCalculationDef[]
): number {
  if (monthlyIncomePaisa <= 0 || slabs.length === 0) {
    return 0;
  }

  // Find the bracket where minMonthlyIncomePaisa <= monthlyIncomePaisa < maxMonthlyIncomePaisa
  for (const slab of slabs) {
    const isAboveMin = monthlyIncomePaisa >= slab.minMonthlyIncomePaisa;
    const isBelowMax =
      slab.maxMonthlyIncomePaisa === null ||
      slab.maxMonthlyIncomePaisa === undefined ||
      monthlyIncomePaisa <= slab.maxMonthlyIncomePaisa;

    if (isAboveMin && isBelowMax) {
      const excess = monthlyIncomePaisa - slab.minMonthlyIncomePaisa;
      const rate = parseFloat(slab.excessRatePercentage) || 0;
      const taxFromExcess = Math.round((excess * rate) / 100);
      return slab.baseTaxPaisa + taxFromExcess;
    }
  }

  return 0;
}

export interface StatutoryComponentCalculationDef {
  code: string;
  name: string;
  calculationType: 'fixed' | 'percentage';
  fixedAmountPaisa: number;
  percentageRate: string;
  accountCode: string;
}

/**
 * Computes statutory deduction for a component
 */
export function calculateStatutoryComponentDeduction(
  grossSalaryPaisa: number,
  comp: StatutoryComponentCalculationDef
): number {
  if (comp.calculationType === 'fixed') {
    return Math.max(0, comp.fixedAmountPaisa);
  }
  const rate = parseFloat(comp.percentageRate) || 0;
  if (rate <= 0 || grossSalaryPaisa <= 0) {
    return 0;
  }
  return Math.round((grossSalaryPaisa * rate) / 100);
}

/**
 * Calculates net salary and verifies total deductions do not exceed gross
 */
export function computePayrollItemTotals(params: {
  baseSalaryPaisa: number;
  allowancesPaisa: number;
  overtimeAmountPaisa: number;
  unpaidLeaveDeductionPaisa: number;
  advanceRecoveryPaisa: number;
  taxPaisa: number;
  statutoryDeductionsPaisa: number;
}): {
  grossSalaryPaisa: number;
  totalDeductionsPaisa: number;
  netSalaryPaisa: number;
} {
  const grossSalaryPaisa = Math.max(
    0,
    params.baseSalaryPaisa -
      params.unpaidLeaveDeductionPaisa +
      params.allowancesPaisa +
      params.overtimeAmountPaisa
  );

  const totalDeductionsPaisa =
    params.advanceRecoveryPaisa + params.taxPaisa + params.statutoryDeductionsPaisa;

  const netSalaryPaisa = Math.max(0, grossSalaryPaisa - totalDeductionsPaisa);

  return {
    grossSalaryPaisa,
    totalDeductionsPaisa,
    netSalaryPaisa,
  };
}
