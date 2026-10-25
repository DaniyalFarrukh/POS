import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const branches = sqliteTable('branches', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const counters = sqliteTable('counters', {
  id: text('id').primaryKey(),
  branchId: text('branch_id')
    .notNull()
    .references(() => branches.id),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role', { enum: ['owner', 'pharmacist', 'cashier'] }).notNull(),
  pinHash: text('pin_hash').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const taxCategories = sqliteTable('tax_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rateBp: integer('rate_bp').notNull(), // Basis points e.g. 1700 = 17%
  isExempt: integer('is_exempt', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    brandName: text('brand_name').notNull(),
    genericName: text('generic_name').notNull(),
    strength: text('strength').notNull(),
    form: text('form').notNull(),
    manufacturer: text('manufacturer').notNull(),
    barcode: text('barcode'),
    taxCategoryId: text('tax_category_id')
      .notNull()
      .references(() => taxCategories.id),
    mrpPaisa: integer('mrp_paisa').notNull(), // Rule 1: Integer paisa
    isControlled: integer('is_controlled', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_products_barcode').on(table.barcode),
    index('idx_products_brand_name').on(table.brandName),
    index('idx_products_generic_name').on(table.genericName),
  ]
);

export const suppliers = sqliteTable('suppliers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contactPerson: text('contact_person'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Rule 4: No direct stock/quantity columns on batches!
export const batches = sqliteTable(
  'batches',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    batchNo: text('batch_no').notNull(),
    expiryDate: text('expiry_date').notNull(), // YYYY-MM-DD
    costPaisa: integer('cost_paisa').notNull(), // Rule 1: Integer paisa
    mrpPaisa: integer('mrp_paisa').notNull(), // Rule 1: Integer paisa
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_batches_expiry_date').on(table.expiryDate),
    index('idx_batches_product_batch').on(table.productId, table.batchNo),
  ]
);

// Rule 4: Inventory changes are recorded as signed stock movements
export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    batchId: text('batch_id')
      .notNull()
      .references(() => batches.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    type: text('type', {
      enum: ['purchase', 'sale', 'return', 'adjustment', 'transfer_in', 'transfer_out'],
    }).notNull(),
    quantitySigned: integer('quantity_signed').notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    reason: text('reason'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_stock_movements_branch_batch').on(table.branchId, table.batchId),
    index('idx_stock_movements_branch_product').on(table.branchId, table.productId),
    index('idx_stock_movements_created_at').on(table.createdAt),
  ]
);

export const purchases = sqliteTable(
  'purchases',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    supplierInvoiceNo: text('supplier_invoice_no').notNull(),
    invoiceDate: text('invoice_date').notNull(),
    totalCostPaisa: integer('total_cost_paisa').notNull(), // Rule 1: Integer paisa
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_purchases_branch').on(table.branchId),
    index('idx_purchases_supplier').on(table.supplierId),
    index('idx_purchases_invoice_date').on(table.invoiceDate),
  ]
);

export const purchaseLines = sqliteTable(
  'purchase_lines',
  {
    id: text('id').primaryKey(),
    purchaseId: text('purchase_id')
      .notNull()
      .references(() => purchases.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    batchId: text('batch_id')
      .notNull()
      .references(() => batches.id),
    batchNo: text('batch_no').notNull(),
    expiryDate: text('expiry_date').notNull(),
    quantity: integer('quantity').notNull(),
    costPaisa: integer('cost_paisa').notNull(), // Rule 1: Integer paisa
    mrpPaisa: integer('mrp_paisa').notNull(), // Rule 1: Integer paisa
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_purchase_lines_purchase').on(table.purchaseId),
    index('idx_purchase_lines_product').on(table.productId),
    index('idx_purchase_lines_batch').on(table.batchId),
  ]
);

export const outbox = sqliteTable(
  'outbox',
  {
    id: text('id').primaryKey(),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull(),
    syncedAt: text('synced_at'),
  },
  (table) => [index('idx_outbox_synced_at').on(table.syncedAt)]
);

export const invoices = sqliteTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    invoiceNumber: text('invoice_number').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    counterId: text('counter_id')
      .notNull()
      .references(() => counters.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    customerName: text('customer_name'),
    customerPhone: text('customer_phone'),
    doctorName: text('doctor_name'),
    notes: text('notes'),
    subtotalPaisa: integer('subtotal_paisa').notNull(),
    discountPaisa: integer('discount_paisa').notNull().default(0),
    taxPaisa: integer('tax_paisa').notNull().default(0),
    grandTotalPaisa: integer('grand_total_paisa').notNull(),
    paidPaisa: integer('paid_paisa').notNull(),
    changePaisa: integer('change_paisa').notNull().default(0),
    status: text('status', { enum: ['finalized', 'cancelled', 'refunded'] }).notNull().default('finalized'),
    fiscalStatus: text('fiscal_status', { enum: ['not_required', 'pending', 'submitted', 'failed'] }).notNull().default('not_required'),
    fiscalInvoiceNumber: text('fiscal_invoice_number'),
    qrPayload: text('qr_payload'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_invoices_invoice_number').on(table.invoiceNumber),
    index('idx_invoices_branch').on(table.branchId),
    index('idx_invoices_counter').on(table.counterId),
    index('idx_invoices_created_at').on(table.createdAt),
  ]
);

export const invoiceLines = sqliteTable(
  'invoice_lines',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    batchId: text('batch_id').references(() => batches.id),
    batchNo: text('batch_no'),
    expiryDate: text('expiry_date'),
    quantity: integer('quantity').notNull(),
    unitPricePaisa: integer('unit_price_paisa').notNull(),
    discountBp: integer('discount_bp').notNull().default(0),
    discountPaisa: integer('discount_paisa').notNull().default(0),
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    taxPaisa: integer('tax_paisa').notNull().default(0),
    lineTotalPaisa: integer('line_total_paisa').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_invoice_lines_invoice').on(table.invoiceId),
    index('idx_invoice_lines_product').on(table.productId),
    index('idx_invoice_lines_batch').on(table.batchId),
  ]
);

export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    paymentMethod: text('payment_method', { enum: ['cash', 'card', 'bank', 'other'] }).notNull(),
    amountPaisa: integer('amount_paisa').notNull(),
    tenderedPaisa: integer('tendered_paisa'),
    changePaisa: integer('change_paisa'),
    reference: text('reference'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_payments_invoice').on(table.invoiceId)]
);

export type BranchModel = typeof branches.$inferSelect;
export type CounterModel = typeof counters.$inferSelect;
export type UserModel = typeof users.$inferSelect;
export type TaxCategoryModel = typeof taxCategories.$inferSelect;
export type ProductModel = typeof products.$inferSelect;
export type SupplierModel = typeof suppliers.$inferSelect;
export type BatchModel = typeof batches.$inferSelect;
export type StockMovementModel = typeof stockMovements.$inferSelect;
export type PurchaseModel = typeof purchases.$inferSelect;
export type PurchaseLineModel = typeof purchaseLines.$inferSelect;
export type OutboxModel = typeof outbox.$inferSelect;
export type InvoiceModel = typeof invoices.$inferSelect;
export type InvoiceLineModel = typeof invoiceLines.$inferSelect;
export type PaymentModel = typeof payments.$inferSelect;
