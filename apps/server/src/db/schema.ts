import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  bigserial,
  bigint,
  index,
  unique,
  primaryKey,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// 1. Root Tenant Table: Pharmacies
export const pharmacies = pgTable('pharmacies', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  expenseApprovalThresholdPaisa: integer('expense_approval_threshold_paisa')
    .notNull()
    .default(2500000),
  ntn: text('ntn'),
  strn: text('strn'),
  drugSaleLicenseNo: text('drug_sale_license_no'),
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
    drugSaleLicenseNo: text('drug_sale_license_no'),
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
    role: text('role', {
      enum: ['owner', 'manager', 'accountant', 'pharmacist', 'cashier'],
    }).notNull(),
    pinHash: text('pin_hash').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_users_pharmacy').on(table.pharmacyId),
    unique('uq_users_pharmacy_name').on(table.pharmacyId, table.name),
  ]
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
    reorderLevel: integer('reorder_level').notNull().default(0),
    reorderQuantity: integer('reorder_quantity').notNull().default(0),
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
    taxNumber: text('tax_number'),
    paymentTermsDays: integer('payment_terms_days').notNull().default(30),
    creditLimitPaisa: integer('credit_limit_paisa').notNull().default(0), // Rule 1: Integer paisa
    openingBalancePaisa: integer('opening_balance_paisa').notNull().default(0), // Rule 1: Integer paisa
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_suppliers_pharmacy').on(table.pharmacyId),
    index('idx_suppliers_pharmacy_name').on(table.pharmacyId, table.name),
    index('idx_suppliers_pharmacy_phone').on(table.pharmacyId, table.phone),
  ]
);

// 9b. Customers (credit sales, receipts, master data sync)
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    creditLimitPaisa: integer('credit_limit_paisa').notNull().default(0), // Rule 1: Integer paisa
    openingBalancePaisa: integer('opening_balance_paisa').notNull().default(0), // Rule 1: Integer paisa
    priceTier: text('price_tier'),
    isDuplicate: boolean('is_duplicate').notNull().default(false),
    duplicateOfId: uuid('duplicate_of_id'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_customers_pharmacy').on(table.pharmacyId),
    index('idx_customers_pharmacy_name').on(table.pharmacyId, table.name),
    index('idx_customers_pharmacy_phone').on(table.pharmacyId, table.phone),
    unique('uq_customers_pharmacy_phone').on(table.pharmacyId, table.phone),
  ]
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
    check('batches_expiry_date_format_chk', sql`${table.expiryDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
  ]
);

// 10b. Stock Locations (a branch has multiple stock locations: main shelf, back store, cold storage)
export const stockLocations = pgTable(
  'stock_locations',
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
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_stock_locations_pharmacy_branch_name').on(
      table.pharmacyId,
      table.branchId,
      table.name
    ),
    index('idx_stock_locations_pharmacy_branch').on(table.pharmacyId, table.branchId),
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
    locationId: uuid('location_id').references(() => stockLocations.id, { onDelete: 'set null' }),
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
    index('idx_stock_movements_pharmacy_location').on(table.pharmacyId, table.locationId),
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
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    creditLimitExceeded: boolean('credit_limit_exceeded').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_invoices_pharmacy_invoice_number').on(table.pharmacyId, table.invoiceNumber),
    unique('uq_invoices_pharmacy_client_request').on(table.pharmacyId, table.clientRequestId),
    index('idx_invoices_pharmacy_created').on(table.pharmacyId, table.createdAt),
    index('idx_invoices_pharmacy_customer').on(table.pharmacyId, table.customerId),
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
    method: text('method', { enum: ['cash', 'card', 'wallet', 'credit'] }).notNull(),
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
  (table) => [index('idx_credit_note_lines_pharmacy_cn').on(table.pharmacyId, table.creditNoteId)]
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
    branchId: uuid('branch_id'),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    op: text('op', { enum: ['upsert', 'delete'] }).notNull(),
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_change_log_pharmacy_seq').on(table.pharmacyId, table.seq),
    index('idx_change_log_pharmacy_branch_seq').on(table.pharmacyId, table.branchId, table.seq),
  ]
);

// 21. Accounts (Chart of Accounts — ERP Spec Phase 7)
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type', {
      enum: ['asset', 'liability', 'equity', 'revenue', 'expense'],
    }).notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => accounts.id, {
      onDelete: 'restrict',
    }),
    isActive: boolean('is_active').notNull().default(true),
    isSystem: boolean('is_system').notNull().default(false),
  },
  (table) => [
    unique('uq_accounts_pharmacy_code').on(table.pharmacyId, table.code),
    index('idx_accounts_pharmacy').on(table.pharmacyId),
  ]
);

// 22. Fiscal Periods
export const fiscalPeriods = pgTable(
  'fiscal_periods',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    startDate: text('start_date').notNull(), // YYYY-MM-DD (Karachi business date)
    endDate: text('end_date').notNull(), // YYYY-MM-DD (Karachi business date)
    status: text('status', { enum: ['open', 'closed'] })
      .notNull()
      .default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'string' }),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
    reopenedAt: timestamp('reopened_at', { withTimezone: true, mode: 'string' }),
    reopenedBy: uuid('reopened_by').references(() => users.id, { onDelete: 'set null' }),
    reopenReason: text('reopen_reason'),
  },
  (table) => [
    index('idx_fiscal_periods_pharmacy_dates').on(table.pharmacyId, table.startDate, table.endDate),
  ]
);

// 23. Journal Entries (Immutable; sequential entry_no per pharmacy; unique source for auto-posted)
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    entryNo: integer('entry_no').notNull(),
    entryDate: text('entry_date').notNull(), // YYYY-MM-DD (Karachi business date)
    sourceType: text('source_type'),
    sourceId: uuid('source_id'),
    memo: text('memo'),
    status: text('status', { enum: ['posted', 'reversed'] })
      .notNull()
      .default('posted'),
    reversesEntryId: uuid('reverses_entry_id').references((): AnyPgColumn => journalEntries.id, {
      onDelete: 'restrict',
    }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_journal_entries_pharmacy_entry_no').on(table.pharmacyId, table.entryNo),
    unique('uq_journal_entries_pharmacy_source').on(
      table.pharmacyId,
      table.sourceType,
      table.sourceId
    ),
    unique('uq_journal_entries_reverses_entry_id').on(table.reversesEntryId),
    index('idx_journal_entries_pharmacy_entry_date').on(table.pharmacyId, table.entryDate),
  ]
);

// 24. Journal Lines (Immutable; integer paisa; exactly one of debit or credit > 0)
export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid('id').primaryKey(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'restrict' }),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    debitPaisa: integer('debit_paisa').notNull().default(0),
    creditPaisa: integer('credit_paisa').notNull().default(0),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    partyType: text('party_type', { enum: ['customer', 'supplier', 'employee'] }),
    partyId: uuid('party_id'),
    memo: text('memo'),
  },
  (table) => [
    index('idx_journal_lines_pharmacy_account').on(table.pharmacyId, table.accountId),
    index('idx_journal_lines_entry').on(table.entryId),
  ]
);

// 25. Per-Pharmacy Account Mappings (Posting Engine Roles)
export const pharmacyAccountMappings = pgTable(
  'pharmacy_account_mappings',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    role: text('role', {
      enum: [
        'sales',
        'sales_returns',
        'output_tax',
        'input_tax',
        'cogs',
        'inventory',
        'stock_adjustment',
        'cash',
        'bank',
        'wallet',
        'ar',
        'ap',
        'advance_suppliers',
        'customer_advances',
      ],
    }).notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    unique('pharmacy_account_mappings_pharmacy_role_unique').on(table.pharmacyId, table.role),
    index('pharmacy_account_mappings_pharmacy_id_idx').on(table.pharmacyId),
  ]
);

// 26. Product Reorder Levels (branch-specific overrides)
export const productReorderLevels = pgTable(
  'product_reorder_levels',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    reorderLevel: integer('reorder_level').notNull().default(0),
    reorderQuantity: integer('reorder_quantity').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_product_reorder_levels_pharmacy_product_branch').on(
      table.pharmacyId,
      table.productId,
      table.branchId
    ),
    index('idx_product_reorder_levels_pharmacy').on(table.pharmacyId),
  ]
);

// 27. Purchase Orders
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    poNumber: text('po_number').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    status: text('status', {
      enum: ['draft', 'approved', 'sent', 'partially_received', 'received', 'cancelled'],
    })
      .notNull()
      .default('draft'),
    overReceiptPolicy: text('over_receipt_policy', { enum: ['reject', 'flag'] })
      .notNull()
      .default('flag'),
    issueDate: text('issue_date').notNull(),
    expectedDeliveryDate: text('expected_delivery_date'),
    totalExpectedCostPaisa: bigint('total_expected_cost_paisa', { mode: 'number' })
      .notNull()
      .default(0),
    notes: text('notes'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'string' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_purchase_orders_pharmacy_po_number').on(table.pharmacyId, table.poNumber),
    index('idx_purchase_orders_pharmacy_status').on(table.pharmacyId, table.status),
    index('idx_purchase_orders_pharmacy_supplier').on(table.pharmacyId, table.supplierId),
    index('idx_purchase_orders_pharmacy_branch').on(table.pharmacyId, table.branchId),
  ]
);

// 28. Purchase Order Lines
export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    quantityOrdered: integer('quantity_ordered').notNull(),
    quantityReceived: integer('quantity_received').notNull().default(0),
    expectedCostPaisa: integer('expected_cost_paisa').notNull(),
    totalCostPaisa: bigint('total_cost_paisa', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_po_lines_purchase_order_id').on(table.purchaseOrderId),
    index('idx_po_lines_pharmacy_product').on(table.pharmacyId, table.productId),
  ]
);

// 29. Purchase Order Receipts Linking (tracks deliveries against POs)
export const purchaseOrderReceipts = pgTable(
  'purchase_order_receipts',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'restrict' }),
    receiptReferenceId: uuid('receipt_reference_id').notNull(),
    supplierInvoiceNo: text('supplier_invoice_no').notNull(),
    receiptDate: text('receipt_date').notNull(),
    totalCostPaisa: bigint('total_cost_paisa', { mode: 'number' }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('idx_po_receipts_pharmacy_po').on(table.pharmacyId, table.purchaseOrderId)]
);

// 30. Stock Transfers Header
export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    transferNumber: text('transfer_number').notNull(),
    sourceBranchId: uuid('source_branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    sourceLocationId: uuid('source_location_id').references(() => stockLocations.id, {
      onDelete: 'set null',
    }),
    destinationBranchId: uuid('destination_branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    destinationLocationId: uuid('destination_location_id').references(() => stockLocations.id, {
      onDelete: 'set null',
    }),
    status: text('status', {
      enum: ['draft', 'in_transit', 'received', 'cancelled'],
    })
      .notNull()
      .default('draft'),
    dispatchedBy: uuid('dispatched_by').references(() => users.id, { onDelete: 'set null' }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true, mode: 'string' }),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'set null' }),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'string' }),
    hasShortage: boolean('has_shortage').notNull().default(false),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_stock_transfers_pharmacy_number').on(table.pharmacyId, table.transferNumber),
    index('idx_stock_transfers_pharmacy_status').on(table.pharmacyId, table.status),
    index('idx_stock_transfers_pharmacy_src_branch').on(table.pharmacyId, table.sourceBranchId),
    index('idx_stock_transfers_pharmacy_dest_branch').on(
      table.pharmacyId,
      table.destinationBranchId
    ),
  ]
);

// 31. Stock Transfer Lines
export const stockTransferLines = pgTable(
  'stock_transfer_lines',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => stockTransfers.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'restrict' }),
    quantityRequested: integer('quantity_requested').notNull(),
    quantityDispatched: integer('quantity_dispatched').notNull().default(0),
    quantityReceived: integer('quantity_received').notNull().default(0),
    shortageQuantity: integer('shortage_quantity').notNull().default(0),
    shortageReason: text('shortage_reason'),
    dispatchMovementId: uuid('dispatch_movement_id'),
    receiveMovementId: uuid('receive_movement_id'),
    shortageMovementId: uuid('shortage_movement_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_transfer_lines_transfer_id').on(table.transferId),
    index('idx_transfer_lines_pharmacy_product').on(table.pharmacyId, table.productId),
    index('idx_transfer_lines_pharmacy_batch').on(table.pharmacyId, table.batchId),
  ]
);

// 32. Stock Counts
export const stockCounts = pgTable(
  'stock_counts',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').references(() => stockLocations.id, {
      onDelete: 'set null',
    }),
    countNumber: text('count_number').notNull(),
    status: text('status', {
      enum: ['draft', 'submitted', 'approved', 'cancelled'],
    })
      .notNull()
      .default('draft'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_stock_counts_pharmacy_number').on(table.pharmacyId, table.countNumber),
    index('idx_stock_counts_pharmacy_branch').on(table.pharmacyId, table.branchId),
    index('idx_stock_counts_pharmacy_status').on(table.pharmacyId, table.status),
  ]
);

// 33. Stock Count Lines
export const stockCountLines = pgTable(
  'stock_count_lines',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    countId: uuid('count_id')
      .notNull()
      .references(() => stockCounts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'restrict' }),
    systemQuantity: integer('system_quantity').notNull(),
    countedQuantity: integer('counted_quantity').notNull(),
    varianceQuantity: integer('variance_quantity').notNull(),
    costPaisa: integer('cost_paisa').notNull(),
    variancePaisa: integer('variance_paisa').notNull(),
    notes: text('notes'),
    adjustmentMovementId: uuid('adjustment_movement_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_stock_count_lines_count').on(table.countId),
    index('idx_stock_count_lines_pharmacy_batch').on(table.pharmacyId, table.batchId),
  ]
);

// 34. Supplier Returns & Debit Notes
export const supplierReturns = pgTable(
  'supplier_returns',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    returnNumber: text('return_number').notNull(),
    debitNoteNumber: text('debit_note_number').notNull(),
    returnDate: text('return_date').notNull(),
    status: text('status', {
      enum: ['draft', 'completed', 'cancelled'],
    })
      .notNull()
      .default('completed'),
    subtotalPaisa: integer('subtotal_paisa').notNull(),
    taxPaisa: integer('tax_paisa').notNull().default(0),
    totalPaisa: integer('total_paisa').notNull(),
    reason: text('reason').notNull(),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_supplier_returns_pharmacy_number').on(table.pharmacyId, table.returnNumber),
    unique('uq_supplier_returns_pharmacy_dn').on(table.pharmacyId, table.debitNoteNumber),
    index('idx_supplier_returns_pharmacy_supplier').on(table.pharmacyId, table.supplierId),
    index('idx_supplier_returns_pharmacy_branch').on(table.pharmacyId, table.branchId),
  ]
);

// 35. Supplier Return Lines
export const supplierReturnLines = pgTable(
  'supplier_return_lines',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    returnId: uuid('return_id')
      .notNull()
      .references(() => supplierReturns.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    unitCostPaisa: integer('unit_cost_paisa').notNull(),
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    taxPaisa: integer('tax_paisa').notNull().default(0),
    totalPaisa: integer('total_paisa').notNull(),
    movementId: uuid('movement_id'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_supplier_return_lines_return').on(table.returnId),
    index('idx_supplier_return_lines_pharmacy_batch').on(table.pharmacyId, table.batchId),
  ]
);

// 36. ERP Financial Payments (Customer Receipts & Supplier Payments)
export const erpPayments = pgTable(
  'erp_payments',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    paymentNumber: text('payment_number').notNull(),
    paymentDate: text('payment_date').notNull(), // YYYY-MM-DD
    direction: text('direction', { enum: ['receipt', 'payment'] }).notNull(),
    partyType: text('party_type', { enum: ['customer', 'supplier'] }).notNull(),
    partyId: uuid('party_id').notNull(),
    method: text('method', { enum: ['cash', 'bank', 'wallet', 'cheque'] }).notNull(),
    amountPaisa: integer('amount_paisa').notNull(), // Rule 1: Integer paisa
    allocatedPaisa: integer('allocated_paisa').notNull().default(0),
    advancePaisa: integer('advance_paisa').notNull().default(0),
    chequeNumber: text('cheque_number'),
    chequeDate: text('cheque_date'),
    bankName: text('bank_name'),
    chequeStatus: text('cheque_status', { enum: ['pending', 'cleared', 'bounced'] }),
    bounceReason: text('bounce_reason'),
    bouncedAt: timestamp('bounced_at', { withTimezone: true, mode: 'string' }),
    status: text('status', { enum: ['posted', 'reversed'] })
      .notNull()
      .default('posted'),
    counterId: uuid('counter_id').references(() => counters.id, { onDelete: 'set null' }),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, {
      onDelete: 'restrict',
    }),
    reversalEntryId: uuid('reversal_entry_id').references(() => journalEntries.id, {
      onDelete: 'restrict',
    }),
    reversalReason: text('reversal_reason'),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'string' }),
    referenceNo: text('reference_no'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_erp_payments_pharmacy_number').on(table.pharmacyId, table.paymentNumber),
    index('idx_erp_payments_pharmacy_direction_date').on(
      table.pharmacyId,
      table.direction,
      table.paymentDate
    ),
    index('idx_erp_payments_pharmacy_party').on(table.pharmacyId, table.partyType, table.partyId),
    index('idx_erp_payments_pharmacy_cheque_status').on(table.pharmacyId, table.chequeStatus),
  ]
);

// 37. Payment Allocations
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => erpPayments.id, { onDelete: 'restrict' }),
    documentType: text('document_type', { enum: ['invoice', 'purchase'] }).notNull(),
    documentId: uuid('document_id').notNull(),
    documentNumber: text('document_number').notNull(),
    allocatedPaisa: integer('allocated_paisa').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_payment_allocations_pharmacy_payment').on(table.pharmacyId, table.paymentId),
    index('idx_payment_allocations_pharmacy_document').on(
      table.pharmacyId,
      table.documentType,
      table.documentId
    ),
  ]
);

// 38. Expense Categories
export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_expense_categories_pharmacy_name').on(table.pharmacyId, table.name),
    index('idx_expense_categories_pharmacy').on(table.pharmacyId),
    index('idx_expense_categories_account').on(table.accountId),
  ]
);

// 39. Recurring Expense Templates
export const recurringExpenses = pgTable(
  'recurring_expenses',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => expenseCategories.id, { onDelete: 'restrict' }),
    amountPaisa: integer('amount_paisa').notNull(),
    frequency: text('frequency', {
      enum: ['monthly', 'weekly', 'quarterly', 'yearly'],
    })
      .notNull()
      .default('monthly'),
    dayOfMonth: integer('day_of_month').notNull().default(1),
    paymentType: text('payment_type', { enum: ['paid', 'credit'] })
      .notNull()
      .default('paid'),
    paymentMethod: text('payment_method', { enum: ['cash', 'bank', 'wallet'] }),
    vendorName: text('vendor_name'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    lastGeneratedPeriod: text('last_generated_period'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_recurring_expenses_pharmacy').on(table.pharmacyId),
    index('idx_recurring_expenses_category').on(table.categoryId),
  ]
);

// 40. ERP Expenses
export const erpExpenses = pgTable(
  'erp_expenses',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    expenseNumber: text('expense_number').notNull(),
    expenseDate: text('expense_date').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => expenseCategories.id, { onDelete: 'restrict' }),
    amountPaisa: integer('amount_paisa').notNull(),
    paymentType: text('payment_type', { enum: ['paid', 'credit'] }).notNull(),
    paymentMethod: text('payment_method', { enum: ['cash', 'bank', 'wallet'] }),
    vendorName: text('vendor_name'),
    notes: text('notes'),
    status: text('status', {
      enum: ['draft', 'pending_approval', 'approved', 'rejected', 'posted', 'reversed'],
    })
      .notNull()
      .default('posted'),
    approvalThresholdPaisa: integer('approval_threshold_paisa').notNull().default(2500000),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'string' }),
    recurringExpenseId: uuid('recurring_expense_id').references(() => recurringExpenses.id, {
      onDelete: 'set null',
    }),
    recurringPeriod: text('recurring_period'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, {
      onDelete: 'restrict',
    }),
    reversalEntryId: uuid('reversal_entry_id').references(() => journalEntries.id, {
      onDelete: 'restrict',
    }),
    reversalReason: text('reversal_reason'),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'string' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_erp_expenses_pharmacy_number').on(table.pharmacyId, table.expenseNumber),
    index('idx_erp_expenses_pharmacy_date').on(table.pharmacyId, table.expenseDate),
    index('idx_erp_expenses_pharmacy_category').on(table.pharmacyId, table.categoryId),
    index('idx_erp_expenses_pharmacy_status').on(table.pharmacyId, table.status),
    index('idx_erp_expenses_pharmacy_branch').on(table.pharmacyId, table.branchId),
  ]
);

// 41. Bank and Cash Accounts
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    type: text('type', { enum: ['cash', 'bank', 'wallet'] }).notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    bankName: text('bank_name'),
    accountNumber: text('account_number'),
    branchName: text('branch_name'),
    iban: text('iban'),
    openingBalancePaisa: integer('opening_balance_paisa').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_bank_accounts_pharmacy').on(table.pharmacyId),
    index('idx_bank_accounts_pharmacy_type').on(table.pharmacyId, table.type),
  ]
);

// 42. Fund Transfers
export const fundTransfers = pgTable(
  'fund_transfers',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    transferNumber: text('transfer_number').notNull(),
    fromAccountId: uuid('from_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'restrict' }),
    toAccountId: uuid('to_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'restrict' }),
    amountPaisa: integer('amount_paisa').notNull(),
    transferDate: text('transfer_date').notNull(), // YYYY-MM-DD Asia/Karachi
    referenceNo: text('reference_no'),
    notes: text('notes'),
    journalEntryId: uuid('journal_entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['completed', 'reversed'] })
      .notNull()
      .default('completed'),
    reversalEntryId: uuid('reversal_entry_id').references(() => journalEntries.id, {
      onDelete: 'restrict',
    }),
    reversalReason: text('reversal_reason'),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'string' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_fund_transfers_pharmacy_number').on(table.pharmacyId, table.transferNumber),
    index('idx_fund_transfers_pharmacy').on(table.pharmacyId),
    index('idx_fund_transfers_date').on(table.pharmacyId, table.transferDate),
  ]
);

// 43. Counter Deposits
export const counterDeposits = pgTable(
  'counter_deposits',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    depositNumber: text('deposit_number').notNull(),
    depositDate: text('deposit_date').notNull(), // YYYY-MM-DD
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    counterId: uuid('counter_id').references(() => counters.id, { onDelete: 'restrict' }),
    shiftId: text('shift_id'),
    sourceCashAccountId: uuid('source_cash_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'restrict' }),
    targetAccountId: uuid('target_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'restrict' }),
    amountPaisa: integer('amount_paisa').notNull(),
    notes: text('notes'),
    journalEntryId: uuid('journal_entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['completed', 'reversed'] })
      .notNull()
      .default('completed'),
    reversalEntryId: uuid('reversal_entry_id').references(() => journalEntries.id, {
      onDelete: 'restrict',
    }),
    reversalReason: text('reversal_reason'),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'string' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_counter_deposits_pharmacy_number').on(table.pharmacyId, table.depositNumber),
    index('idx_counter_deposits_pharmacy').on(table.pharmacyId),
    index('idx_counter_deposits_date').on(table.pharmacyId, table.depositDate),
  ]
);

// 44. Bank Reconciliations
export const bankReconciliations = pgTable(
  'bank_reconciliations',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'restrict' }),
    statementDate: text('statement_date').notNull(),
    statementBalancePaisa: integer('statement_balance_paisa').notNull(),
    ledgerBalancePaisa: integer('ledger_balance_paisa').notNull(),
    clearedBalancePaisa: integer('cleared_balance_paisa').notNull(),
    differencePaisa: integer('difference_paisa').notNull(),
    matchedCount: integer('matched_count').notNull().default(0),
    status: text('status', { enum: ['draft', 'reconciled'] })
      .notNull()
      .default('draft'),
    notes: text('notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [index('idx_bank_reconciliations_pharmacy').on(table.pharmacyId)]
);

// 45. Budgets
export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    fiscalYear: integer('fiscal_year').notNull(),
    month: integer('month').notNull(),
    amountPaisa: integer('amount_paisa').notNull().default(0),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_budgets_pharmacy_branch_account_period').on(
      table.pharmacyId,
      table.branchId,
      table.accountId,
      table.fiscalYear,
      table.month
    ),
    index('idx_budgets_lookup').on(table.pharmacyId, table.fiscalYear, table.month, table.branchId),
    index('idx_budgets_account').on(table.pharmacyId, table.accountId),
  ]
);

// 46. Payment Reminders (SMS/Email/WhatsApp logs for AR/AP)
export const paymentReminders = pgTable(
  'payment_reminders',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    partyType: text('party_type', { enum: ['customer', 'supplier'] }).notNull(),
    partyId: uuid('party_id').notNull(),
    documentId: uuid('document_id'),
    channel: text('channel', { enum: ['sms', 'whatsapp', 'email', 'phone', 'in_person'] })
      .notNull()
      .default('sms'),
    recipient: text('recipient'),
    message: text('message'),
    amountPaisa: integer('amount_paisa').notNull().default(0),
    daysOverdue: integer('days_overdue').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_payment_reminders_pharmacy_party').on(
      table.pharmacyId,
      table.partyType,
      table.partyId
    ),
    index('idx_payment_reminders_pharmacy_sent_at').on(table.pharmacyId, table.sentAt),
  ]
);

// 47. Prescriptions (Protected Health Information)
export const prescriptions = pgTable(
  'prescriptions',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    prescriptionNumber: text('prescription_number').notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    patientName: text('patient_name').notNull(),
    patientPhone: text('patient_phone'),
    patientAge: integer('patient_age'),
    patientGender: text('patient_gender'),
    doctorName: text('doctor_name'),
    doctorRegistrationNumber: text('doctor_registration_number'),
    doctorClinic: text('doctor_clinic'),
    prescriptionDate: text('prescription_date').notNull(), // YYYY-MM-DD (Karachi business date)
    diagnosis: text('diagnosis'),
    repeatCount: integer('repeat_count').notNull().default(0),
    repeatsUsed: integer('repeats_used').notNull().default(0),
    refillIntervalDays: integer('refill_interval_days').notNull().default(30),
    nextRefillDate: text('next_refill_date'), // YYYY-MM-DD (Karachi business date)
    isControlledDrug: boolean('is_controlled_drug').notNull().default(false),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    status: text('status', {
      enum: ['active', 'fulfilled', 'cancelled', 'expired'],
    })
      .notNull()
      .default('active'),
    notes: text('notes'),
    retentionStatus: text('retention_status', {
      enum: ['active', 'retained', 'archived'],
    })
      .notNull()
      .default('active'),
    statutoryRetentionUntil: text('statutory_retention_until').notNull(), // YYYY-MM-DD
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique('uq_prescriptions_pharmacy_number').on(table.pharmacyId, table.prescriptionNumber),
    index('idx_prescriptions_pharmacy').on(table.pharmacyId),
    index('idx_prescriptions_pharmacy_customer').on(table.pharmacyId, table.customerId),
    index('idx_prescriptions_pharmacy_refill').on(
      table.pharmacyId,
      table.nextRefillDate,
      table.status
    ),
    index('idx_prescriptions_pharmacy_controlled').on(table.pharmacyId, table.isControlledDrug),
  ]
);

// 48. Prescription Items
export const prescriptionItems = pgTable(
  'prescription_items',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    prescriptionId: uuid('prescription_id')
      .notNull()
      .references(() => prescriptions.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    dosageInstructions: text('dosage_instructions').notNull(),
    quantityPrescribed: integer('quantity_prescribed').notNull(),
    quantityDispensed: integer('quantity_dispensed').notNull().default(0),
    daysSupply: integer('days_supply').notNull().default(30),
    isControlled: boolean('is_controlled').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_prescription_items_prescription').on(table.prescriptionId),
    index('idx_prescription_items_pharmacy_product').on(table.pharmacyId, table.productId),
  ]
);

// 49. Prescription Access Audit Logs (Sensitive Health Data Access Tracking)
export const prescriptionAccessLogs = pgTable(
  'prescription_access_logs',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    prescriptionId: uuid('prescription_id').references(() => prescriptions.id, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    userRole: text('user_role').notNull(),
    action: text('action', {
      enum: [
        'view_detail',
        'view_list',
        'view_reminders',
        'create',
        'update',
        'dispense',
        'refill',
      ],
    }).notNull(),
    details: text('details'),
    accessedAt: timestamp('accessed_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_prescription_access_logs_pharmacy').on(table.pharmacyId),
    index('idx_prescription_access_logs_prescription').on(table.prescriptionId),
    index('idx_prescription_access_logs_user').on(table.userId),
    index('idx_prescription_access_logs_accessed_at').on(table.accessedAt),
  ]
);

// 50. Employees (HR)
export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    employeeCode: text('employee_code').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    designation: text('designation').notNull(),
    department: text('department'),
    joiningDate: text('joining_date').notNull(),
    salaryPaisa: integer('salary_paisa').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_employees_pharmacy').on(table.pharmacyId),
    index('idx_employees_branch').on(table.branchId),
    unique('uq_employees_pharmacy_code').on(table.pharmacyId, table.employeeCode),
  ]
);

// 51. Leave Types
export const leaveTypes = pgTable(
  'leave_types',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isPaid: boolean('is_paid').notNull().default(true),
    yearlyEntitlementDays: integer('yearly_entitlement_days').notNull().default(0),
    maxCarryOverDays: integer('max_carry_over_days').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_leave_types_pharmacy').on(table.pharmacyId),
    unique('uq_leave_types_pharmacy_code').on(table.pharmacyId, table.code),
  ]
);

// 52. Leave Allocations
export const leaveAllocations = pgTable(
  'leave_allocations',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    year: integer('year').notNull(),
    entitledDays: integer('entitled_days').notNull().default(0),
    carriedOverDays: integer('carried_over_days').notNull().default(0),
    manualAdjustmentDays: integer('manual_adjustment_days').notNull().default(0),
    usedDays: integer('used_days').notNull().default(0),
    pendingDays: integer('pending_days').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_leave_allocations_pharmacy').on(table.pharmacyId),
    index('idx_leave_allocations_employee').on(table.employeeId),
    unique('uq_leave_allocations_emp_type_year').on(
      table.pharmacyId,
      table.employeeId,
      table.leaveTypeId,
      table.year
    ),
  ]
);

// 53. Leave Requests
export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    daysCount: integer('days_count').notNull(),
    reason: text('reason').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'cancelled'] })
      .notNull()
      .default('pending'),
    rejectionReason: text('rejection_reason'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_leave_requests_pharmacy').on(table.pharmacyId),
    index('idx_leave_requests_employee').on(table.employeeId),
    index('idx_leave_requests_dates').on(table.pharmacyId, table.startDate, table.endDate),
    index('idx_leave_requests_status').on(table.pharmacyId, table.status),
  ]
);

// 54. Attendance Records
export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    date: text('date').notNull(),
    status: text('status', {
      enum: ['present', 'absent', 'late', 'half_day', 'on_leave'],
    }).notNull(),
    leaveRequestId: uuid('leave_request_id').references(() => leaveRequests.id, {
      onDelete: 'set null',
    }),
    checkInTime: text('check_in_time'),
    checkOutTime: text('check_out_time'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_attendance_pharmacy').on(table.pharmacyId),
    index('idx_attendance_employee_date').on(table.pharmacyId, table.employeeId, table.date),
    unique('uq_attendance_emp_date').on(table.pharmacyId, table.employeeId, table.date),
  ]
);

// 55. Payroll Statutory Components
export const payrollStatutoryComponents = pgTable(
  'payroll_statutory_components',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    componentType: text('component_type', {
      enum: ['statutory_deduction', 'tax'],
    })
      .notNull()
      .default('statutory_deduction'),
    calculationType: text('calculation_type', {
      enum: ['fixed', 'percentage'],
    })
      .notNull()
      .default('fixed'),
    fixedAmountPaisa: integer('fixed_amount_paisa').notNull().default(0),
    percentageRate: text('percentage_rate').notNull().default('0'),
    accountCode: text('account_code').notNull().default('2210'),
    isExample: boolean('is_example').notNull().default(true),
    notes: text('notes')
      .notNull()
      .default(
        'Example configuration. Must be reviewed and verified by a licensed accountant before use.'
      ),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_statutory_comp_pharmacy').on(table.pharmacyId),
    unique('uq_statutory_comp_pharmacy_code').on(table.pharmacyId, table.code),
  ]
);

// 56. Payroll Tax Slabs
export const payrollTaxSlabs = pgTable(
  'payroll_tax_slabs',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    minMonthlyIncomePaisa: integer('min_monthly_income_paisa').notNull().default(0),
    maxMonthlyIncomePaisa: integer('max_monthly_income_paisa'),
    baseTaxPaisa: integer('base_tax_paisa').notNull().default(0),
    excessRatePercentage: text('excess_rate_percentage').notNull().default('0'),
    isExample: boolean('is_example').notNull().default(true),
    notes: text('notes')
      .notNull()
      .default(
        'Example progressive slab. Must be reviewed and verified by a licensed accountant before use.'
      ),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('idx_tax_slabs_pharmacy').on(table.pharmacyId)]
);

// 57. Employee Advances
export const employeeAdvances = pgTable(
  'employee_advances',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    disbursementDate: text('disbursement_date').notNull(),
    principalPaisa: integer('principal_paisa').notNull(),
    recoveredPaisa: integer('recovered_paisa').notNull().default(0),
    remainingPaisa: integer('remaining_paisa').notNull(),
    monthlyInstallmentPaisa: integer('monthly_installment_paisa').notNull(),
    reason: text('reason'),
    status: text('status', { enum: ['active', 'recovered', 'written_off'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_employee_advances_pharmacy').on(table.pharmacyId),
    index('idx_employee_advances_employee').on(table.employeeId),
  ]
);

// 58. Payroll Runs
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    month: text('month').notNull(),
    runNumber: text('run_number').notNull(),
    status: text('status', {
      enum: ['draft', 'reviewed', 'approved', 'posted', 'paid', 'cancelled'],
    })
      .notNull()
      .default('draft'),
    isAdjustmentRun: boolean('is_adjustment_run').notNull().default(false),
    adjustmentForRunId: uuid('adjustment_for_run_id').references(
      (): AnyPgColumn => payrollRuns.id,
      { onDelete: 'restrict' }
    ),
    totalBaseSalaryPaisa: integer('total_base_salary_paisa').notNull().default(0),
    totalAllowancesPaisa: integer('total_allowances_paisa').notNull().default(0),
    totalOvertimePaisa: integer('total_overtime_paisa').notNull().default(0),
    totalGrossPaisa: integer('total_gross_paisa').notNull().default(0),
    totalUnpaidLeaveDeductionsPaisa: integer('total_unpaid_leave_deductions_paisa')
      .notNull()
      .default(0),
    totalAdvancesRecoveredPaisa: integer('total_advances_recovered_paisa').notNull().default(0),
    totalTaxPaisa: integer('total_tax_paisa').notNull().default(0),
    totalStatutoryPaisa: integer('total_statutory_paisa').notNull().default(0),
    totalDeductionsPaisa: integer('total_deductions_paisa').notNull().default(0),
    totalNetPaisa: integer('total_net_paisa').notNull().default(0),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, {
      onDelete: 'restrict',
    }),
    paymentJournalEntryId: uuid('payment_journal_entry_id').references(() => journalEntries.id, {
      onDelete: 'restrict',
    }),
    paymentAccountId: uuid('payment_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    paymentMethod: text('payment_method'),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'string' }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'string' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'string' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_payroll_runs_pharmacy').on(table.pharmacyId),
    index('idx_payroll_runs_branch').on(table.branchId),
    index('idx_payroll_runs_month').on(table.pharmacyId, table.month),
    unique('uq_payroll_runs_number').on(table.pharmacyId, table.runNumber),
  ]
);

// 59. Payroll Items
export const payrollItems = pgTable(
  'payroll_items',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'restrict' }),
    payrollRunId: uuid('payroll_run_id')
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    employeeCode: text('employee_code').notNull(),
    employeeName: text('employee_name').notNull(),
    designation: text('designation').notNull(),
    baseSalaryPaisa: integer('base_salary_paisa').notNull(),
    workingDays: integer('working_days').notNull().default(30),
    attendedDays: integer('attended_days').notNull().default(30),
    unpaidLeaveDays: integer('unpaid_leave_days').notNull().default(0),
    unpaidLeaveDeductionPaisa: integer('unpaid_leave_deduction_paisa').notNull().default(0),
    overtimeHours: integer('overtime_hours').notNull().default(0),
    overtimeAmountPaisa: integer('overtime_amount_paisa').notNull().default(0),
    allowancesPaisa: integer('allowances_paisa').notNull().default(0),
    allowancesBreakdown: text('allowances_breakdown'),
    advanceRecoveryPaisa: integer('advance_recovery_paisa').notNull().default(0),
    advanceId: uuid('advance_id').references(() => employeeAdvances.id, {
      onDelete: 'set null',
    }),
    taxPaisa: integer('tax_paisa').notNull().default(0),
    statutoryDeductionsPaisa: integer('statutory_deductions_paisa').notNull().default(0),
    statutoryBreakdown: text('statutory_breakdown'),
    grossSalaryPaisa: integer('gross_salary_paisa').notNull(),
    totalDeductionsPaisa: integer('total_deductions_paisa').notNull(),
    netSalaryPaisa: integer('net_salary_paisa').notNull(),
    paymentStatus: text('payment_status', { enum: ['pending', 'paid'] })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_payroll_items_pharmacy').on(table.pharmacyId),
    index('idx_payroll_items_run').on(table.payrollRunId),
    index('idx_payroll_items_employee').on(table.employeeId),
  ]
);

// 60. User Notifications with per-user read state
export const userNotifications = pgTable(
  'user_notifications',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    severity: text('severity', { enum: ['info', 'warning', 'critical'] })
      .notNull()
      .default('info'),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    link: text('link'),
    isRead: boolean('is_read').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_user_notifications_tenant_user_read').on(
      table.pharmacyId,
      table.userId,
      table.isRead
    ),
  ]
);

// 61. Comprehensive Audit Logs for Sensitive Actions
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    pharmacyId: uuid('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    userName: text('user_name').notNull(),
    userRole: text('user_role').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    summary: text('summary').notNull(),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_audit_logs_pharmacy_created').on(table.pharmacyId, table.createdAt),
    index('idx_audit_logs_pharmacy_entity').on(table.pharmacyId, table.entity),
    index('idx_audit_logs_pharmacy_user').on(table.pharmacyId, table.userId),
  ]
);

// 64. Revoked Tokens (Persisted JWT JTI Revocation)
export const revokedTokens = pgTable(
  'revoked_tokens',
  {
    jti: text('jti').primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('idx_revoked_tokens_expires').on(table.expiresAt)]
);
