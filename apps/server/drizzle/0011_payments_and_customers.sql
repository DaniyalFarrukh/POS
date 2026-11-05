-- 1. Customers
CREATE TABLE IF NOT EXISTS "customers" (
  "id" uuid PRIMARY KEY,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "phone" text,
  "email" text,
  "address" text,
  "credit_limit_paisa" integer NOT NULL DEFAULT 0,
  "opening_balance_paisa" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_customers_pharmacy" ON "customers"("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_customers_pharmacy_phone" ON "customers"("pharmacy_id", "phone");
CREATE INDEX IF NOT EXISTS "idx_customers_pharmacy_name" ON "customers"("pharmacy_id", "name");

-- 2. Optional customer reference on invoices
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_invoices_pharmacy_customer" ON "invoices"("pharmacy_id", "customer_id");

-- 3. ERP Financial Payments (Customer Receipts & Supplier Payments)
CREATE TABLE IF NOT EXISTS "erp_payments" (
  "id" uuid PRIMARY KEY,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "payment_number" text NOT NULL,
  "payment_date" text NOT NULL,
  "direction" text NOT NULL,
  "party_type" text NOT NULL,
  "party_id" uuid NOT NULL,
  "method" text NOT NULL,
  "amount_paisa" integer NOT NULL,
  "allocated_paisa" integer NOT NULL DEFAULT 0,
  "advance_paisa" integer NOT NULL DEFAULT 0,
  "cheque_number" text,
  "cheque_date" text,
  "bank_name" text,
  "cheque_status" text,
  "bounce_reason" text,
  "bounced_at" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'posted',
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "reversal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "reversal_reason" text,
  "reversed_at" timestamp with time zone,
  "reference_no" text,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_erp_payments_pharmacy_number" ON "erp_payments"("pharmacy_id", "payment_number");
CREATE INDEX IF NOT EXISTS "idx_erp_payments_pharmacy_direction_date" ON "erp_payments"("pharmacy_id", "direction", "payment_date");
CREATE INDEX IF NOT EXISTS "idx_erp_payments_pharmacy_party" ON "erp_payments"("pharmacy_id", "party_type", "party_id");
CREATE INDEX IF NOT EXISTS "idx_erp_payments_pharmacy_cheque_status" ON "erp_payments"("pharmacy_id", "cheque_status");

-- 4. Payment Allocations (Multi-document settlement against invoices or purchase bills)
CREATE TABLE IF NOT EXISTS "payment_allocations" (
  "id" uuid PRIMARY KEY,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "payment_id" uuid NOT NULL REFERENCES "erp_payments"("id") ON DELETE RESTRICT,
  "document_type" text NOT NULL,
  "document_id" uuid NOT NULL,
  "document_number" text NOT NULL,
  "allocated_paisa" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_payment_allocations_pharmacy_payment" ON "payment_allocations"("pharmacy_id", "payment_id");
CREATE INDEX IF NOT EXISTS "idx_payment_allocations_pharmacy_document" ON "payment_allocations"("pharmacy_id", "document_type", "document_id");

-- 5. Expand pharmacy_account_mappings role check constraint to include advance_suppliers & customer_advances
ALTER TABLE "pharmacy_account_mappings" DROP CONSTRAINT IF EXISTS "pharmacy_account_mappings_role_check";
ALTER TABLE "pharmacy_account_mappings" ADD CONSTRAINT "pharmacy_account_mappings_role_check" CHECK ("role" IN (
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
  'customer_advances'
));
