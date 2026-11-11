import { z } from 'zod';
import { roundHalfUp } from '../money';

// Date format validation: YYYY-MM-DD
export const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD');

// Month format validation: YYYY-MM
export const MonthStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Month must be formatted as YYYY-MM');

// 1. Employee schemas
export const CreateEmployeeSchema = z.object({
  employeeCode: z.string().trim().min(1, 'Employee code is required'),
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  designation: z.string().trim().min(1, 'Designation is required'),
  department: z.string().optional().or(z.literal('')),
  branchId: z.string().uuid().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  joiningDate: DateStringSchema,
  salaryPaisa: z.number().int().nonnegative('Salary paisa must be non-negative').default(0),
});

export type CreateEmployeeInput = z.infer<typeof CreateEmployeeSchema>;

// 2. Leave Type schemas
export const CreateLeaveTypeSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').toUpperCase(),
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().optional().or(z.literal('')),
  isPaid: z.boolean().default(true),
  yearlyEntitlementDays: z
    .number()
    .int()
    .nonnegative('Entitlement days must be non-negative')
    .default(0),
  maxCarryOverDays: z.number().int().nonnegative('Carry-over days must be non-negative').default(0),
});

export type CreateLeaveTypeInput = z.infer<typeof CreateLeaveTypeSchema>;

// 3. Leave Request schemas
export const CreateLeaveRequestSchema = z
  .object({
    employeeId: z.string().uuid('Valid employee ID is required'),
    leaveTypeId: z.string().uuid('Valid leave type ID is required'),
    startDate: DateStringSchema,
    endDate: DateStringSchema,
    reason: z.string().trim().min(1, 'Reason is required'),
  })
  .refine((data) => data.startDate <= data.endDate, {
    message: 'Start date must be on or before end date',
    path: ['endDate'],
  });

export type CreateLeaveRequestInput = z.infer<typeof CreateLeaveRequestSchema>;

export const RejectLeaveRequestSchema = z.object({
  rejectionReason: z.string().trim().min(1, 'Rejection reason is required'),
});

export type RejectLeaveRequestInput = z.infer<typeof RejectLeaveRequestSchema>;

// 4. Carry Over schema
export const CarryOverLeavesSchema = z.object({
  fromYear: z.number().int().min(2000).max(2100),
  toYear: z.number().int().min(2000).max(2100),
  employeeId: z.string().uuid().optional(),
});

export type CarryOverLeavesInput = z.infer<typeof CarryOverLeavesSchema>;

// 5. Query schemas
export const LeaveCalendarQuerySchema = z.object({
  month: MonthStringSchema.optional(),
  startDate: DateStringSchema.optional(),
  endDate: DateStringSchema.optional(),
  branchId: z.string().uuid().optional(),
});

export type LeaveCalendarQuery = z.infer<typeof LeaveCalendarQuerySchema>;

export const PayrollPreviewQuerySchema = z.object({
  month: MonthStringSchema,
  employeeId: z.string().uuid().optional(),
  workingDaysInMonth: z.coerce.number().int().min(1).max(31).default(30),
});

export type PayrollPreviewQuery = z.infer<typeof PayrollPreviewQuerySchema>;

// 6. Mathematical & Business Helpers
/**
 * Calculates inclusive calendar days between two YYYY-MM-DD dates
 */
export function calculateLeaveDays(startDate: string, endDate: string): number {
  if (startDate > endDate) {
    throw new Error('startDate cannot be after endDate');
  }
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, diffDays);
}

/**
 * Checks whether two date intervals overlap (inclusive)
 */
export function checkLeaveOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  return startA <= endB && endA >= startB;
}

/**
 * Computes allowable carry-over days given unutilized days and type policy
 */
export function calculateCarryOver(remainingDays: number, maxCarryOverDays: number): number {
  if (remainingDays <= 0 || maxCarryOverDays <= 0) {
    return 0;
  }
  return Math.min(remainingDays, maxCarryOverDays);
}

/**
 * Computes monthly payroll deduction for unpaid leaves using exact integer paisa arithmetic
 */
export function calculateUnpaidLeaveDeduction(
  baseSalaryPaisa: number,
  unpaidLeaveDays: number,
  workingDaysInMonth = 30
): {
  dailyRatePaisa: number;
  deductionPaisa: number;
  grossSalaryPaisa: number;
  netSalaryPaisa: number;
} {
  if (baseSalaryPaisa <= 0 || unpaidLeaveDays <= 0 || workingDaysInMonth <= 0) {
    return {
      dailyRatePaisa: 0,
      deductionPaisa: 0,
      grossSalaryPaisa: Math.max(0, baseSalaryPaisa),
      netSalaryPaisa: Math.max(0, baseSalaryPaisa),
    };
  }

  const dailyRatePaisa = roundHalfUp(baseSalaryPaisa, workingDaysInMonth);
  const deductionPaisa = Math.min(baseSalaryPaisa, unpaidLeaveDays * dailyRatePaisa);
  const grossSalaryPaisa = baseSalaryPaisa;
  const netSalaryPaisa = Math.max(0, grossSalaryPaisa - deductionPaisa);

  return {
    dailyRatePaisa,
    deductionPaisa,
    grossSalaryPaisa,
    netSalaryPaisa,
  };
}
