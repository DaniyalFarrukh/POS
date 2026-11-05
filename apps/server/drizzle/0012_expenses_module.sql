-- Migration 0012: Expenses Module (Categories, Expenses, Recurring Schedules, Approvals)

-- 1. Pharmacy Expense Approval Threshold
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "expense_approval_threshold_paisa" integer NOT NULL DEFAULT 2500000;

-- 2. Expense Categories (mapped to Chart of Accounts expense accounts e.g. 6010 Rent, 6020 Utilities)
CREATE TABLE IF NOT EXISTS "expense_categories" (
  "id" uuid PRIMARY KEY,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "uq_expense_categories_pharmacy_name" UNIQUE ("pharmacy_id", "name")
);

CREATE INDEX IF NOT EXISTS "idx_expense_categories_pharmacy" ON "expense_categories"("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_expense_categories_account" ON "expense_categories"("account_id");

-- 3. Recurring Expense Templates (Monthly Rent, Utilities, Subscriptions)
CREATE TABLE IF NOT EXISTS "recurring_expenses" (
  "id" uuid PRIMARY KEY,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "title" text NOT NULL,
  "category_id" uuid NOT NULL REFERENCES "expense_categories"("id") ON DELETE RESTRICT,
  "amount_paisa" integer NOT NULL,
  "frequency" text NOT NULL DEFAULT 'monthly',
  "day_of_month" integer NOT NULL DEFAULT 1,
  "payment_type" text NOT NULL DEFAULT 'paid',
  "payment_method" text,
  "vendor_name" text,
  "notes" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_generated_period" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_recurring_expenses_pharmacy" ON "recurring_expenses"("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_recurring_expenses_category" ON "recurring_expenses"("category_id");

-- 4. ERP Expenses (Business Expenses with GL Posting, Approvals, and Reversals)
CREATE TABLE IF NOT EXISTS "erp_expenses" (
  "id" uuid PRIMARY KEY,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "expense_number" text NOT NULL,
  "expense_date" text NOT NULL,
  "category_id" uuid NOT NULL REFERENCES "expense_categories"("id") ON DELETE RESTRICT,
  "amount_paisa" integer NOT NULL,
  "payment_type" text NOT NULL,
  "payment_method" text,
  "vendor_name" text,
  "notes" text,
  "status" text NOT NULL DEFAULT 'posted',
  "approval_threshold_paisa" integer NOT NULL DEFAULT 2500000,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamp with time zone,
  "recurring_expense_id" uuid REFERENCES "recurring_expenses"("id") ON DELETE SET NULL,
  "recurring_period" text,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "reversal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "reversal_reason" text,
  "reversed_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "uq_erp_expenses_pharmacy_number" UNIQUE ("pharmacy_id", "expense_number")
);

-- Unique index ensuring idempotent recurring generation per period
CREATE UNIQUE INDEX IF NOT EXISTS "uq_erp_expenses_recurring_period"
  ON "erp_expenses"("pharmacy_id", "recurring_expense_id", "recurring_period")
  WHERE "recurring_expense_id" IS NOT NULL AND "status" != 'reversed';

CREATE INDEX IF NOT EXISTS "idx_erp_expenses_pharmacy_date" ON "erp_expenses"("pharmacy_id", "expense_date");
CREATE INDEX IF NOT EXISTS "idx_erp_expenses_pharmacy_category" ON "erp_expenses"("pharmacy_id", "category_id");
CREATE INDEX IF NOT EXISTS "idx_erp_expenses_pharmacy_status" ON "erp_expenses"("pharmacy_id", "status");
CREATE INDEX IF NOT EXISTS "idx_erp_expenses_pharmacy_branch" ON "erp_expenses"("pharmacy_id", "branch_id");

