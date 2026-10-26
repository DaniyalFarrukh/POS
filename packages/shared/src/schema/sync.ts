import { z } from 'zod';

export const SyncEventTypeSchema = z.enum([
  'purchase.received',
  'invoice.created',
  'credit_note.created',
  'stock_adjustment.created',
]);
export type SyncEventType = z.infer<typeof SyncEventTypeSchema>;

export const SyncResultStatusSchema = z.enum([
  'accepted',
  'duplicate',
  'retry_later',
  'rejected',
]);
export type SyncResultStatus = z.infer<typeof SyncResultStatusSchema>;

/**
 * Event envelope defined in docs/SYNC.md:
 * { eventId: UUIDv7, deviceSeq: integer (monotonic per device), type: string, entityId: UUIDv7, occurredAt: UTC ISO, schemaVersion: 1, payload: object }
 */
export const SyncEventEnvelopeSchema = z.object({
  eventId: z.string().uuid('eventId must be a valid UUIDv7'),
  deviceSeq: z.number().int('deviceSeq must be an integer').min(1, 'deviceSeq must be >= 1'),
  type: z.string().min(1, 'type is required'),
  entityId: z.string().uuid('entityId must be a valid UUIDv7'),
  occurredAt: z.string().min(1, 'occurredAt is required'),
  schemaVersion: z.number().int('schemaVersion must be integer'),
  payload: z.record(z.string(), z.unknown()),
});
export type SyncEventEnvelope = z.infer<typeof SyncEventEnvelopeSchema>;

// 1. purchase.received Payload Schema
export const PurchaseBatchInputSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  batchNo: z.string().min(1),
  expiryDate: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  costPaisa: z.number().int().min(0),
  mrpPaisa: z.number().int().min(0),
  createdAt: z.string().optional(),
});
export type PurchaseBatchInput = z.infer<typeof PurchaseBatchInputSchema>;

export const PurchaseLineInputItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  batchId: z.string().uuid(),
  quantity: z.number().int().min(1),
  costPaisa: z.number().int().min(0),
  mrpPaisa: z.number().int().min(0),
});
export type PurchaseLineInputItem = z.infer<typeof PurchaseLineInputItemSchema>;

export const PurchaseReceivedPayloadSchema = z.object({
  purchase: z.object({
    id: z.string().uuid(),
    branchId: z.string().uuid(),
    supplierId: z.string().uuid().nullable().optional(),
    supplierInvoiceNo: z.string().min(1),
    invoiceDate: z.string(),
    totalCostPaisa: z.number().int().min(0),
    createdByUserId: z.string().uuid().optional(),
    createdAt: z.string().optional(),
  }),
  batches: z.array(PurchaseBatchInputSchema).min(1),
  lines: z.array(PurchaseLineInputItemSchema).min(1),
});
export type PurchaseReceivedPayload = z.infer<typeof PurchaseReceivedPayloadSchema>;

// 2. invoice.created Payload Schema
export const InvoiceCreatedLineSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  productId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().min(1),
  unitPricePaisa: z.number().int().min(0),
  discountPaisa: z.number().int().min(0).default(0),
  taxRateBp: z.number().int().min(0).default(0),
  taxPaisa: z.number().int().min(0).default(0),
  lineTotalPaisa: z.number().int().min(0),
});
export type InvoiceCreatedLine = z.infer<typeof InvoiceCreatedLineSchema>;

export const InvoiceCreatedPaymentSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  method: z.enum(['cash', 'card', 'wallet']),
  amountPaisa: z.number().int().min(1),
});
export type InvoiceCreatedPayment = z.infer<typeof InvoiceCreatedPaymentSchema>;

export const InvoiceCreatedPayloadSchema = z.object({
  id: z.string().uuid(),
  counterId: z.string().uuid(),
  cashierUserId: z.string().uuid(),
  invoiceNumber: z.string().min(1),
  clientRequestId: z.string().min(1),
  status: z.string().default('finalized'),
  subtotalPaisa: z.number().int().min(0),
  discountPaisa: z.number().int().min(0).default(0),
  taxPaisa: z.number().int().min(0).default(0),
  totalPaisa: z.number().int().min(0),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  lines: z.array(InvoiceCreatedLineSchema).min(1, 'Invoice must contain at least 1 line item'),
  payments: z.array(InvoiceCreatedPaymentSchema).min(1, 'Invoice must contain at least 1 payment'),
});
export type InvoiceCreatedPayload = z.infer<typeof InvoiceCreatedPayloadSchema>;

// 3. credit_note.created Payload Schema
export const CreditNoteCreatedLineSchema = z.object({
  id: z.string().uuid(),
  creditNoteId: z.string().uuid().optional(),
  originalInvoiceLineId: z.string().uuid(),
  productId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().min(1),
  unitPricePaisa: z.number().int().min(0),
  taxRateBp: z.number().int().min(0).default(0),
  taxPaisa: z.number().int().min(0).default(0),
  lineTotalPaisa: z.number().int().min(0),
});
export type CreditNoteCreatedLine = z.infer<typeof CreditNoteCreatedLineSchema>;

export const CreditNoteCreatedPayloadSchema = z.object({
  id: z.string().uuid(),
  creditNoteNumber: z.string().min(1),
  originalInvoiceId: z.string().uuid(),
  branchId: z.string().uuid(),
  counterId: z.string().uuid(),
  cashierUserId: z.string().uuid(),
  clientRequestId: z.string().min(1),
  subtotalPaisa: z.number().int().min(0),
  taxPaisa: z.number().int().min(0).default(0),
  totalPaisa: z.number().int().min(0),
  refundMethod: z.enum(['cash', 'card', 'wallet', 'credit']).default('cash'),
  reason: z.string().min(1),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  lines: z.array(CreditNoteCreatedLineSchema).min(1, 'Credit note must have at least 1 line item'),
});
export type CreditNoteCreatedPayload = z.infer<typeof CreditNoteCreatedPayloadSchema>;

// 4. stock_adjustment.created Payload Schema
export const StockAdjustmentCreatedPayloadSchema = z.object({
  id: z.string().uuid().optional(),
  movementId: z.string().uuid().optional(),
  productId: z.string().uuid(),
  batchId: z.string().uuid(),
  branchId: z.string().uuid(),
  quantitySigned: z.number().int().refine((n) => n !== 0, {
    message: 'Adjustment quantity cannot be 0',
  }),
  reasonType: z.string().optional(),
  reason: z.string().min(1),
  createdAt: z.string().optional(),
});
export type StockAdjustmentCreatedPayload = z.infer<
  typeof StockAdjustmentCreatedPayloadSchema
>;

// Request & Response envelope schemas
export const SyncPushRequestSchema = z.object({
  events: z.array(SyncEventEnvelopeSchema).max(100, 'Maximum 100 events allowed per push'),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

export const SyncResultItemSchema = z.object({
  eventId: z.string().uuid(),
  status: SyncResultStatusSchema,
  code: z.string().optional(),
  message: z.string().optional(),
});
export type SyncResultItem = z.infer<typeof SyncResultItemSchema>;

export const SyncPushResponseSchema = z.object({
  results: z.array(SyncResultItemSchema),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;

// GET /sync/pull schemas (docs/SYNC.md)
export const SyncPullQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0, 'Cursor must be >= 0').default(0),
  limit: z.coerce.number().int().min(1, 'Limit must be >= 1').max(500, 'Limit cannot exceed 500').default(200),
});
export type SyncPullQuery = z.infer<typeof SyncPullQuerySchema>;

export const SyncChangeItemSchema = z.object({
  seq: z.number().int(),
  entity: z.string(),
  entityId: z.string().uuid(),
  op: z.enum(['upsert', 'delete']),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string().optional(),
});
export type SyncChangeItem = z.infer<typeof SyncChangeItemSchema>;

export const SyncPullResponseSchema = z.object({
  changes: z.array(SyncChangeItemSchema),
  nextCursor: z.number().int(),
  hasMore: z.boolean(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;
