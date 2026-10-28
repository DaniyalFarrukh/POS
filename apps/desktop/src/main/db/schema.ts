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

export const counters = sqliteTable(
  'counters',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    name: text('name').notNull(),
    code: text('code'),
    lastInvoiceSeq: integer('last_invoice_seq').notNull().default(0),
    lastCreditNoteSeq: integer('last_credit_note_seq').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_counters_code').on(table.code)]
);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    role: text('role', { enum: ['owner', 'pharmacist', 'cashier'] }).notNull(),
    pinHash: text('pin_hash').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: text('locked_until'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_users_name').on(table.name)]
);

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
    eventId: text('event_id'),
    deviceSeq: integer('device_seq'),
    type: text('type'),
    eventType: text('event_type'),
    entityId: text('entity_id'),
    payload: text('payload').notNull(),
    occurredAt: text('occurred_at'),
    status: text('status', { enum: ['pending', 'acked', 'exception'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    syncedAt: text('synced_at'),
  },
  (table) => [
    uniqueIndex('idx_outbox_device_seq').on(table.deviceSeq),
    index('idx_outbox_status_device_seq').on(table.status, table.deviceSeq),
    index('idx_outbox_synced_at').on(table.syncedAt),
  ]
);

export const invoices = sqliteTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    counterId: text('counter_id')
      .notNull()
      .references(() => counters.id),
    cashierUserId: text('cashier_user_id')
      .notNull()
      .references(() => users.id),
    invoiceNumber: text('invoice_number').notNull(),
    clientRequestId: text('client_request_id').notNull(),
    status: text('status', { enum: ['finalized'] }).notNull().default('finalized'),
    subtotalPaisa: integer('subtotal_paisa').notNull(),
    discountPaisa: integer('discount_paisa').notNull().default(0),
    taxPaisa: integer('tax_paisa').notNull().default(0),
    totalPaisa: integer('total_paisa').notNull(),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_invoices_invoice_number').on(table.invoiceNumber),
    uniqueIndex('idx_invoices_client_request_id').on(table.clientRequestId),
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
    quantity: integer('quantity').notNull(),
    unitPricePaisa: integer('unit_price_paisa').notNull(),
    discountPaisa: integer('discount_paisa').notNull().default(0),
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    taxPaisa: integer('tax_paisa').notNull().default(0),
    lineTotalPaisa: integer('line_total_paisa').notNull(),
  },
  (table) => [
    index('idx_invoice_lines_invoice_id').on(table.invoiceId),
    index('idx_invoice_lines_batch_id').on(table.batchId),
  ]
);

export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    method: text('method', { enum: ['cash', 'card', 'wallet'] }).notNull(),
    amountPaisa: integer('amount_paisa').notNull(),
  },
  (table) => [index('idx_payments_invoice').on(table.invoiceId)]
);

export const fiscalSubmissions = sqliteTable(
  'fiscal_submissions',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    status: text('status', {
      enum: ['not_required', 'pending', 'submitted', 'failed'],
    })
      .notNull()
      .default('not_required'),
    fiscalInvoiceNumber: text('fiscal_invoice_number'),
    qrPayload: text('qr_payload'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_fiscal_submissions_invoice_id').on(table.invoiceId)]
);

export const shifts = sqliteTable(
  'shifts',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    counterId: text('counter_id')
      .notNull()
      .references(() => counters.id),
    cashierUserId: text('cashier_user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
    openedAt: text('opened_at').notNull(),
    closedAt: text('closed_at'),
    openingCashPaisa: integer('opening_cash_paisa').notNull().default(0),
    countedCashPaisa: integer('counted_cash_paisa'),
    expectedCashPaisa: integer('expected_cash_paisa'),
    differencePaisa: integer('difference_paisa'),
    salesCashPaisa: integer('sales_cash_paisa').notNull().default(0),
    salesCardPaisa: integer('sales_card_paisa').notNull().default(0),
    salesWalletPaisa: integer('sales_wallet_paisa').notNull().default(0),
    returnsCashPaisa: integer('returns_cash_paisa').notNull().default(0),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_shifts_counter').on(table.counterId),
    index('idx_shifts_branch').on(table.branchId),
  ]
);

export const creditNotes = sqliteTable(
  'credit_notes',
  {
    id: text('id').primaryKey(),
    creditNoteNumber: text('credit_note_number').notNull().unique(),
    originalInvoiceId: text('original_invoice_id')
      .notNull()
      .references(() => invoices.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    counterId: text('counter_id')
      .notNull()
      .references(() => counters.id),
    cashierUserId: text('cashier_user_id')
      .notNull()
      .references(() => users.id),
    clientRequestId: text('client_request_id').notNull().unique(),
    subtotalPaisa: integer('subtotal_paisa').notNull(),
    taxPaisa: integer('tax_paisa').notNull().default(0),
    totalPaisa: integer('total_paisa').notNull(),
    refundMethod: text('refund_method', {
      enum: ['cash', 'card', 'wallet', 'credit'],
    }).notNull().default('cash'),
    reason: text('reason', {
      enum: [
        'defective_damaged',
        'expired',
        'customer_return',
        'dispensing_error',
        'other',
      ],
    }).notNull(),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_credit_notes_orig_inv').on(table.originalInvoiceId),
    index('idx_credit_notes_branch').on(table.branchId),
    index('idx_credit_notes_created_at').on(table.createdAt),
  ]
);

export const creditNoteLines = sqliteTable(
  'credit_note_lines',
  {
    id: text('id').primaryKey(),
    creditNoteId: text('credit_note_id')
      .notNull()
      .references(() => creditNotes.id),
    originalInvoiceLineId: text('original_invoice_line_id')
      .notNull()
      .references(() => invoiceLines.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    batchId: text('batch_id').references(() => batches.id),
    quantity: integer('quantity').notNull(),
    unitPricePaisa: integer('unit_price_paisa').notNull(),
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    taxPaisa: integer('tax_paisa').notNull().default(0),
    lineTotalPaisa: integer('line_total_paisa').notNull(),
  },
  (table) => [
    index('idx_credit_note_lines_cn').on(table.creditNoteId),
    index('idx_credit_note_lines_orig_line').on(table.originalInvoiceLineId),
  ]
);

export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value'),
});

export const syncExceptions = sqliteTable(
  'sync_exceptions',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull(),
    code: text('code').notNull(),
    message: text('message').notNull(),
    payload: text('payload').notNull(),
    status: text('status', { enum: ['open', 'dismissed', 'retried'] })
      .notNull()
      .default('open'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at'),
  },
  (table) => [
    index('idx_sync_exceptions_event_id').on(table.eventId),
    index('idx_sync_exceptions_status').on(table.status),
  ]
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
export type FiscalSubmissionModel = typeof fiscalSubmissions.$inferSelect;
export type ShiftModel = typeof shifts.$inferSelect;
export type CreditNoteModel = typeof creditNotes.$inferSelect;
export type CreditNoteLineModel = typeof creditNoteLines.$inferSelect;
export type SyncStateModel = typeof syncState.$inferSelect;
export type SyncExceptionModel = typeof syncExceptions.$inferSelect;


