import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  bigserial,
  index,
  unique,
  primaryKey,
} from 'drizzle-orm/pg-core';

// 1. Root Tenant Table: Pharmacies
export const pharmacies = pgTable('pharmacies', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
});

// 2. Branches
export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('idx_branches_pharmacy').on(table.pharmacyId)]
);

// 3. Counters
export const counters = pgTable(
  'counters',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    code: text('code'),
    lastInvoiceSeq: integer('last_invoice_seq').notNull().default(0),
    lastCreditNoteSeq: integer('last_credit_note_seq').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('idx_counters_pharmacy_branch').on(table.pharmacyId, table.branchId)]
);

// 4. Devices
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    counterId: uuid('counter_id').references(() => counters.id, { onDelete: 'set null' }),
    deviceName: text('device_name').notNull(),
    deviceFingerprint: text('device_fingerprint'),
    isRevoked: boolean('is_revoked').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('idx_devices_pharmacy').on(table.pharmacyId)]
);

// 5. Device Registration Codes
export const deviceRegistrationCodes = pgTable(
  'device_registration_codes',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    counterId: uuid('counter_id')
      .notNull()
      .references(() => counters.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('idx_device_reg_codes_pharmacy').on(table.pharmacyId)]
);

// 6. Users
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    role: text('role', { enum: ['owner', 'pharmacist', 'cashier'] }).notNull(),
    pinHash: text('pin_hash').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('idx_users_pharmacy').on(table.pharmacyId)]
);

// 7. Tax Categories
export const taxCategories = pgTable(
  'tax_categories',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    rateBp: integer('rate_bp').notNull().default(0),
    isExempt: boolean('is_exempt').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('idx_tax_categories_pharmacy').on(table.pharmacyId)]
);

// 8. Products
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    brandName: text('brand_name').notNull(),
    genericName: text('generic_name'),
    strength: text('strength'),
    form: text('form'),
    manufacturer: text('manufacturer'),
    barcode: text('barcode'),
    taxCategoryId: uuid('tax_category_id').references(() => taxCategories.id, {
      onDelete: 'set null',
    }),
    mrpPaisa: integer('mrp_paisa').notNull(), // Rule 1: Integer paisa
    isControlled: boolean('is_controlled').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_products_pharmacy').on(table.pharmacyId),
    index('idx_products_pharmacy_barcode').on(table.pharmacyId, table.barcode),
  ]
);

// 9. Suppliers
export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    contactPerson: text('contact_person'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('idx_suppliers_pharmacy').on(table.pharmacyId)]
);

// 10. Batches (Rule 4: no direct balance stored; balance derived from stock_movements)
export const batches = pgTable(
  'batches',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    batchNo: text('batch_no').notNull(),
    expiryDate: text('expiry_date').notNull(), // UTC date YYYY-MM-DD
    costPaisa: integer('cost_paisa').notNull(),
    mrpPaisa: integer('mrp_paisa').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_batches_pharmacy_product').on(table.pharmacyId, table.productId),
    index('idx_batches_pharmacy_expiry').on(table.pharmacyId, table.expiryDate),
  ]
);

// 11. Stock Movements (Rule 4: signed integers for all stock changes)
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    type: text('type', {
      enum: ['purchase', 'sale', 'return', 'adjustment', 'transfer_in', 'transfer_out'],
    }).notNull(),
    quantitySigned: integer('quantity_signed').notNull(),
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_stock_movements_pharmacy_branch_batch').on(
      table.pharmacyId,
      table.branchId,
      table.batchId
    ),
    index('idx_stock_movements_pharmacy_product').on(table.pharmacyId, table.productId),
  ]
);

// 12. Invoices (Rule 3: Immutable; UNIQUE (pharmacy_id, invoice_number) as required)
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    counterId: uuid('counter_id')
      .notNull()
      .references(() => counters.id, { onDelete: 'restrict' }),
    cashierUserId: uuid('cashier_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    invoiceNumber: text('invoice_number').notNull(),
    clientRequestId: text('client_request_id').notNull(),
    status: text('status').notNull().default('finalized'),
    subtotalPaisa: integer('subtotal_paisa').notNull(),
    discountPaisa: integer('discount_paisa').notNull().default(0),
    taxPaisa: integer('tax_paisa').notNull().default(0),
    totalPaisa: integer('total_paisa').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_invoices_pharmacy_invoice_number').on(table.pharmacyId, table.invoiceNumber),
    unique('uq_invoices_pharmacy_client_request').on(table.pharmacyId, table.clientRequestId),
    index('idx_invoices_pharmacy_created').on(table.pharmacyId, table.createdAt),
  ]
);

// 13. Invoice Lines
export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    batchId: uuid('batch_id').references(() => batches.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    unitPricePaisa: integer('unit_price_paisa').notNull(),
    discountPaisa: integer('discount_paisa').notNull().default(0),
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    taxPaisa: integer('tax_paisa').notNull().default(0),
    lineTotalPaisa: integer('line_total_paisa').notNull(),
  },
  (table) => [index('idx_invoice_lines_pharmacy_invoice').on(table.pharmacyId, table.invoiceId)]
);

// 14. Payments
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    method: text('method', { enum: ['cash', 'card', 'wallet'] }).notNull(),
    amountPaisa: integer('amount_paisa').notNull(),
  },
  (table) => [index('idx_payments_pharmacy_invoice').on(table.pharmacyId, table.invoiceId)]
);

// 15. Credit Notes (UNIQUE (pharmacy_id, credit_note_number))
export const creditNotes = pgTable(
  'credit_notes',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    creditNoteNumber: text('credit_note_number').notNull(),
    originalInvoiceId: uuid('original_invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    counterId: uuid('counter_id')
      .notNull()
      .references(() => counters.id, { onDelete: 'restrict' }),
    cashierUserId: uuid('cashier_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    clientRequestId: text('client_request_id').notNull(),
    subtotalPaisa: integer('subtotal_paisa').notNull(),
    taxPaisa: integer('tax_paisa').notNull().default(0),
    totalPaisa: integer('total_paisa').notNull(),
    refundMethod: text('refund_method', {
      enum: ['cash', 'card', 'wallet', 'credit'],
    })
      .notNull()
      .default('cash'),
    reason: text('reason').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_credit_notes_pharmacy_number').on(table.pharmacyId, table.creditNoteNumber),
    index('idx_credit_notes_pharmacy_orig_inv').on(table.pharmacyId, table.originalInvoiceId),
  ]
);

// 16. Credit Note Lines
export const creditNoteLines = pgTable(
  'credit_note_lines',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    creditNoteId: uuid('credit_note_id')
      .notNull()
      .references(() => creditNotes.id, { onDelete: 'restrict' }),
    originalInvoiceLineId: uuid('original_invoice_line_id')
      .notNull()
      .references(() => invoiceLines.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    batchId: uuid('batch_id').references(() => batches.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    unitPricePaisa: integer('unit_price_paisa').notNull(),
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    taxPaisa: integer('tax_paisa').notNull().default(0),
    lineTotalPaisa: integer('line_total_paisa').notNull(),
  },
  (table) => [
    index('idx_credit_note_lines_pharmacy_cn').on(table.pharmacyId, table.creditNoteId),
  ]
);

// 17. Processed Events (Rule 7: UNIQUE (pharmacy_id, event_id) primary key)
export const processedEvents = pgTable(
  'processed_events',
  {
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_processed_events', columns: [table.pharmacyId, table.eventId] }),
  ]
);

// 18. Rejected Events
export const rejectedEvents = pgTable(
  'rejected_events',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    event: jsonb('event').notNull(),
    code: text('code').notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('idx_rejected_events_pharmacy_created').on(table.pharmacyId, table.createdAt)]
);

// 19. Stock Alerts
export const stockAlerts = pgTable(
  'stock_alerts',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id').references(() => batches.id, { onDelete: 'set null' }),
    type: text('type').notNull(), // 'negative_stock', 'near_expiry', 'expired', 'low_stock'
    severity: text('severity').notNull().default('warning'),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [index('idx_stock_alerts_pharmacy_branch').on(table.pharmacyId, table.branchId)]
);

// 20. Change Log (Requirement: change_log.seq is a bigserial)
export const changeLog = pgTable(
  'change_log',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    op: text('op', { enum: ['upsert', 'delete'] }).notNull(),
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('idx_change_log_pharmacy_seq').on(table.pharmacyId, table.seq)]
);
