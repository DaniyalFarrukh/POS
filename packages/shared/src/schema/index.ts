import { z } from 'zod';

export const UserRoleSchema = z.enum(['owner', 'pharmacist', 'cashier']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const MovementTypeSchema = z.enum([
  'purchase',
  'sale',
  'return',
  'adjustment',
  'transfer_in',
  'transfer_out',
]);
export type MovementType = z.infer<typeof MovementTypeSchema>;

// Base schema for UUIDv7 and UTC timestamps (Rule 2 & Rule 8)
const BaseEntitySchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/)),
  updatedAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/)),
});

export const BranchSchema = BaseEntitySchema.extend({
  name: z.string().min(1),
});
export type Branch = z.infer<typeof BranchSchema>;

export const CounterSchema = BaseEntitySchema.extend({
  branchId: z.string().uuid(),
  name: z.string().min(1),
});
export type Counter = z.infer<typeof CounterSchema>;

export const UserSchema = BaseEntitySchema.extend({
  name: z.string().min(1),
  role: UserRoleSchema,
  pinHash: z.string().min(1),
  isActive: z.boolean().default(true),
});
export type User = z.infer<typeof UserSchema>;

export const TaxCategorySchema = BaseEntitySchema.extend({
  name: z.string().min(1),
  rateBp: z.number().int().min(0), // Basis points (e.g. 1700 = 17%)
  isExempt: z.boolean().default(false),
});
export type TaxCategory = z.infer<typeof TaxCategorySchema>;

export const ProductSchema = BaseEntitySchema.extend({
  brandName: z.string().min(1),
  genericName: z.string().min(1),
  strength: z.string().min(1),
  form: z.string().min(1),
  manufacturer: z.string().min(1),
  barcode: z.string().nullable().optional(),
  taxCategoryId: z.string().uuid(),
  mrpPaisa: z.number().int().min(0), // Rule 1: Integer paisa
  isControlled: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type Product = z.infer<typeof ProductSchema>;

export { SupplierSchema, type Supplier } from './purchasing';

// Rule 4: Batches NEVER store stock quantities directly
export const BatchSchema = BaseEntitySchema.extend({
  productId: z.string().uuid(),
  batchNo: z.string().min(1),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/), // YYYY-MM-DD
  costPaisa: z.number().int().min(0), // Rule 1: Integer paisa
  mrpPaisa: z.number().int().min(0), // Rule 1: Integer paisa
});
export type Batch = z.infer<typeof BatchSchema>;

// Rule 4: Every inventory change is recorded as a signed stock movement
export const StockMovementSchema = BaseEntitySchema.extend({
  productId: z.string().uuid(),
  batchId: z.string().uuid(),
  branchId: z.string().uuid(),
  type: MovementTypeSchema,
  quantitySigned: z.number().int(), // positive for additions/returns, negative for sales
  referenceType: z.string().nullable().optional(),
  referenceId: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
});
export type StockMovement = z.infer<typeof StockMovementSchema>;

// Computed view/query model for per-batch stock
export const BatchStockSchema = z.object({
  batchId: z.string().uuid(),
  productId: z.string().uuid(),
  branchId: z.string().uuid(),
  batchNo: z.string(),
  expiryDate: z.string(),
  brandName: z.string(),
  genericName: z.string(),
  costPaisa: z.number().int(),
  mrpPaisa: z.number().int(),
  balance: z.number().int(), // Sum of movements (Rule 4)
});
export type BatchStock = z.infer<typeof BatchStockSchema>;

export * from './auth';
