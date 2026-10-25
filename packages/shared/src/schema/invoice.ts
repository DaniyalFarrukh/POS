import { z } from 'zod';

export const InvoicePaymentMethodSchema = z.enum(['cash', 'card', 'bank', 'other']);
export type InvoicePaymentMethod = z.infer<typeof InvoicePaymentMethodSchema>;

export const InvoiceStatusSchema = z.enum(['finalized', 'cancelled', 'refunded']);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const FiscalStatusSchema = z.enum(['not_required', 'pending', 'submitted', 'failed']);
export type FiscalStatus = z.infer<typeof FiscalStatusSchema>;

export const InvoiceLineCreateInputSchema = z.object({
  productId: z.string().uuid('Product ID must be a valid UUID'),
  batchId: z.string().uuid().optional().nullable(),
  batchNo: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  quantity: z.number().int('Quantity must be an integer').min(1, 'Quantity must be at least 1'),
  unitPricePaisa: z.number().int('Unit price must be in integer paisa').min(0, 'Price cannot be negative'),
  discountType: z.enum(['none', 'percent', 'flat']).optional().default('none'),
  discountBp: z.number().int().min(0).max(10000).optional().default(0),
  flatDiscountPaisa: z.number().int().min(0).optional().default(0),
  taxRateBp: z.number().int().min(0).optional().default(0),
  isTaxExempt: z.boolean().optional().default(false),
});
export type InvoiceLineCreateInput = z.input<typeof InvoiceLineCreateInputSchema>;

export const CreateInvoiceInputSchema = z.object({
  customerName: z.string().optional().nullable(),
  customerPhone: z.string().optional().nullable(),
  doctorName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  paymentMethod: InvoicePaymentMethodSchema.optional().default('cash'),
  tenderedPaisa: z.number().int().min(0).optional().nullable(),
  paymentReference: z.string().optional().nullable(),
  lines: z.array(InvoiceLineCreateInputSchema).min(1, 'Invoice must have at least one line item'),
});
export type CreateInvoiceInput = z.input<typeof CreateInvoiceInputSchema>;

export const InvoiceLineRecordSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  productId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  batchNo: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  quantity: z.number().int(),
  unitPricePaisa: z.number().int(),
  discountBp: z.number().int(),
  discountPaisa: z.number().int(),
  taxRateBp: z.number().int(),
  taxPaisa: z.number().int(),
  lineTotalPaisa: z.number().int(),
  brandName: z.string().optional(),
  genericName: z.string().optional(),
  strength: z.string().optional(),
  form: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InvoiceLineRecord = z.infer<typeof InvoiceLineRecordSchema>;

export const PaymentRecordSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  paymentMethod: InvoicePaymentMethodSchema,
  amountPaisa: z.number().int(),
  tenderedPaisa: z.number().int().nullable().optional(),
  changePaisa: z.number().int().nullable().optional(),
  reference: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type PaymentRecord = z.infer<typeof PaymentRecordSchema>;

export const InvoiceRecordSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  branchId: z.string().uuid(),
  counterId: z.string().uuid(),
  userId: z.string().uuid(),
  customerName: z.string().nullable().optional(),
  customerPhone: z.string().nullable().optional(),
  doctorName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  subtotalPaisa: z.number().int(),
  discountPaisa: z.number().int(),
  taxPaisa: z.number().int(),
  grandTotalPaisa: z.number().int(),
  paidPaisa: z.number().int(),
  changePaisa: z.number().int(),
  status: InvoiceStatusSchema,
  fiscalStatus: FiscalStatusSchema,
  fiscalInvoiceNumber: z.string().nullable().optional(),
  qrPayload: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lines: z.array(InvoiceLineRecordSchema).optional(),
  payment: PaymentRecordSchema.optional(),
  userName: z.string().optional(),
  counterName: z.string().optional(),
});
export type InvoiceRecord = z.infer<typeof InvoiceRecordSchema>;
