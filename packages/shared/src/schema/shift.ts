import { z } from 'zod';

export const ShiftStatusSchema = z.enum(['open', 'closed']);
export type ShiftStatus = z.infer<typeof ShiftStatusSchema>;

export const OpenShiftInputSchema = z.object({
  openingCashPaisa: z.number().int('Opening cash must be integer paisa').min(0, 'Opening cash cannot be negative'),
  notes: z.string().nullable().optional(),
});
export type OpenShiftInput = z.infer<typeof OpenShiftInputSchema>;

export const CloseShiftInputSchema = z.object({
  shiftId: z.string().uuid('shiftId must be a valid UUID'),
  countedCashPaisa: z.number().int('Counted cash must be integer paisa').min(0, 'Counted cash cannot be negative'),
  notes: z.string().nullable().optional(),
});
export type CloseShiftInput = z.infer<typeof CloseShiftInputSchema>;

export const ShiftRecordSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  counterId: z.string().uuid(),
  cashierUserId: z.string().uuid(),
  status: ShiftStatusSchema,
  openedAt: z.string(),
  closedAt: z.string().nullable().optional(),
  openingCashPaisa: z.number().int(),
  countedCashPaisa: z.number().int().nullable().optional(),
  expectedCashPaisa: z.number().int(),
  differencePaisa: z.number().int().nullable().optional(),
  salesCashPaisa: z.number().int(),
  salesCardPaisa: z.number().int(),
  salesWalletPaisa: z.number().int(),
  salesTotalPaisa: z.number().int(),
  returnsCashPaisa: z.number().int(),
  salesCount: z.number().int(),
  returnsCount: z.number().int(),
  cashierName: z.string().optional(),
  counterName: z.string().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ShiftRecord = z.infer<typeof ShiftRecordSchema>;
