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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// 1. Root Tenant Table: Pharmacies
export const pharmacies = pgTable('pharmacies', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
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
    unique('uq_stock_locations_pharmacy_branch_name').on(table.pharmacyId, table.branchId, table.name),
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
    status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
  },
  (table) => [
    index('idx_fiscal_periods_pharmacy_dates').on(
      table.pharmacyId,
      table.startDate,
      table.endDate
    ),
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
    status: text('status', { enum: ['posted', 'reversed'] }).notNull().default('posted'),
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
  (table) => [
    index('idx_po_receipts_pharmacy_po').on(table.pharmacyId, table.purchaseOrderId),
  ]
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
