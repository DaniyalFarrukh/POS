import { z } from 'zod';

export const SupplierInputSchema = z.object({
  name: z.string().trim().min(1, 'Supplier name is required'),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email('Invalid email address').optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
});
export type CreateSupplierInput = z.infer<typeof SupplierInputSchema>;

export const UpdateSupplierInputSchema = SupplierInputSchema.partial();
export type UpdateSupplierInput = z.infer<typeof UpdateSupplierInputSchema>;

export const SupplierSchema = SupplierInputSchema.extend({
  id: z.string().uuid(),
  isActive: z.boolean().or(z.number()).transform((v) => Boolean(v)).default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Supplier = z.infer<typeof SupplierSchema>;

export const PurchaseLineInputSchema = z.object({
  productId: z.string().uuid('Product must be selected'),
  batchNo: z.string().trim().min(1, 'Batch number is required'),
  expiryDate: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Expiry date must be in YYYY-MM or YYYY-MM-DD format'),
  quantity: z.number().int('Quantity must be an integer').min(1, 'Quantity must be at least 1'),
  costPaisa: z.number().int('Cost must be in integer paisa').min(0, 'Cost cannot be negative'),
  mrpPaisa: z.number().int('MRP must be in integer paisa').min(0, 'MRP cannot be negative'),
});
export type PurchaseLineInput = z.infer<typeof PurchaseLineInputSchema>;

export const ReceiveGrnInputSchema = z.object({
  supplierId: z.string().uuid('Supplier is required'),
  supplierInvoiceNo: z.string().trim().min(1, 'Supplier invoice number is required'),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invoice date must be YYYY-MM-DD'),
  lines: z.array(PurchaseLineInputSchema).min(1, 'At least one line item is required'),
});
export type ReceiveGrnInput = z.infer<typeof ReceiveGrnInputSchema>;

export const PurchaseLineRecordSchema = z.object({
  id: z.string().uuid(),
  purchaseId: z.string().uuid(),
  productId: z.string().uuid(),
  batchId: z.string().uuid(),
  batchNo: z.string(),
  expiryDate: z.string(),
  quantity: z.number().int(),
  costPaisa: z.number().int(),
  mrpPaisa: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  brandName: z.string().optional(),
  genericName: z.string().optional(),
});
export type PurchaseLineRecord = z.infer<typeof PurchaseLineRecordSchema>;

export const PurchaseRecordSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierName: z.string().optional(),
  supplierInvoiceNo: z.string(),
  invoiceDate: z.string(),
  totalCostPaisa: z.number().int(),
  createdByUserId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lines: z.array(PurchaseLineRecordSchema).optional(),
});
export type PurchaseRecord = z.infer<typeof PurchaseRecordSchema>;

export const AdjustmentReasonTypeSchema = z.enum(['damage', 'loss', 'correction']);
export type AdjustmentReasonType = z.infer<typeof AdjustmentReasonTypeSchema>;

export const StockAdjustmentInputSchema = z.object({
  productId: z.string().uuid('Product must be selected'),
  batchId: z.string().uuid('Batch must be selected'),
  branchId: z.string().uuid().optional(),
  quantitySigned: z.number().int('Adjustment quantity must be an integer').refine((val) => val !== 0, {
    message: 'Adjustment quantity cannot be zero',
  }),
  reasonType: AdjustmentReasonTypeSchema,
  reason: z.string().trim().min(1, 'Reason explanation is required'),
});
export type StockAdjustmentInput = z.infer<typeof StockAdjustmentInputSchema>;

export const StockFilterTypeSchema = z.enum([
  'all',
  'low_stock',
  'expiring_60',
  'expiring_90',
  'expired',
]);
export type StockFilterType = z.infer<typeof StockFilterTypeSchema>;

export const StockFilterParamsSchema = z.object({
  branchId: z.string().uuid().optional(),
  filter: StockFilterTypeSchema.default('all'),
  search: z.string().default(''),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});
export type StockFilterParams = z.input<typeof StockFilterParamsSchema>;

export interface StockOverviewProduct {
  productId: string;
  brandName: string;
  genericName: string;
  form: string;
  strength: string;
  totalBalance: number;
  batchCount: number;
  earliestExpiry: string | null;
  isControlled: boolean;
}

export interface StockOverviewBatch {
  batchId: string;
  productId: string;
  batchNo: string;
  brandName: string;
  genericName: string;
  form: string;
  strength: string;
  expiryDate: string;
  costPaisa: number;
  mrpPaisa: number;
  balance: number;
  daysUntilExpiry: number;
  status: 'good' | 'expiring_90' | 'expiring_60' | 'expired';
}

export interface StockOverviewResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
