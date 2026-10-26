import { z } from 'zod';

export const ReturnReasonSchema = z.enum([
  'defective_damaged',
  'expired',
  'customer_return',
  'dispensing_error',
  'other',
]);
export type ReturnReason = z.infer<typeof ReturnReasonSchema>;

export const RefundMethodSchema = z.enum(['cash', 'card', 'wallet', 'credit']);
export type RefundMethod = z.infer<typeof RefundMethodSchema>;

export const ProcessReturnLineInputSchema = z.object({
  invoiceLineId: z.string().uuid('invoiceLineId must be a valid UUID'),
  quantity: z.number().int('Return quantity must be an integer').min(1, 'Quantity must be at least 1'),
});
export type ProcessReturnLineInput = z.infer<typeof ProcessReturnLineInputSchema>;

export const ProcessReturnInputSchema = z.object({
  clientRequestId: z.string().min(1, 'clientRequestId is required'),
  originalInvoiceId: z.string().uuid('originalInvoiceId must be a valid UUID'),
  refundMethod: RefundMethodSchema.default('cash'),
  reason: ReturnReasonSchema,
  notes: z.string().nullable().optional(),
  lines: z.array(ProcessReturnLineInputSchema).min(1, 'At least one line item must be selected for return'),
});
export type ProcessReturnInput = z.infer<typeof ProcessReturnInputSchema>;

export const CreditNoteLineRecordSchema = z.object({
  id: z.string().uuid(),
  creditNoteId: z.string().uuid(),
  originalInvoiceLineId: z.string().uuid(),
  productId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  batchNo: z.string().optional(),
  expiryDate: z.string().optional(),
  quantity: z.number().int(),
  unitPricePaisa: z.number().int(),
  taxRateBp: z.number().int(),
  taxPaisa: z.number().int(),
  lineTotalPaisa: z.number().int(),
  brandName: z.string().optional(),
  genericName: z.string().optional(),
});
export type CreditNoteLineRecord = z.infer<typeof CreditNoteLineRecordSchema>;

export const CreditNoteRecordSchema = z.object({
  id: z.string().uuid(),
  creditNoteNumber: z.string(),
  originalInvoiceId: z.string().uuid(),
  originalInvoiceNumber: z.string().optional(),
  branchId: z.string().uuid(),
  counterId: z.string().uuid(),
  cashierUserId: z.string().uuid(),
  clientRequestId: z.string(),
  subtotalPaisa: z.number().int(),
  taxPaisa: z.number().int(),
  totalPaisa: z.number().int(),
  refundMethod: RefundMethodSchema,
  reason: ReturnReasonSchema,
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  lines: z.array(CreditNoteLineRecordSchema),
  cashierName: z.string().optional(),
  counterName: z.string().optional(),
});
export type CreditNoteRecord = z.infer<typeof CreditNoteRecordSchema>;

export const ReturnableLineItemSchema = z.object({
  invoiceLineId: z.string().uuid(),
  productId: z.string().uuid(),
  brandName: z.string().optional(),
  genericName: z.string().optional(),
  batchId: z.string().uuid().nullable().optional(),
  batchNo: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  soldQuantity: z.number().int(),
  alreadyReturnedQuantity: z.number().int(),
  returnableQuantity: z.number().int(),
  unitPricePaisa: z.number().int(),
  lineTotalPaisa: z.number().int(),
});
export type ReturnableLineItem = z.infer<typeof ReturnableLineItemSchema>;
