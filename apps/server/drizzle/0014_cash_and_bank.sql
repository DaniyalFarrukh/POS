-- Migration 0014: Cash and Bank, Fund Transfers, Counter Deposits, and Bank Reconciliations

-- 1. Bank and Cash Accounts
CREATE TABLE IF NOT EXISTS "bank_accounts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "type" text NOT NULL, -- 'cash' | 'bank' | 'wallet'
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "bank_name" text,
  "account_number" text,
  "branch_name" text,
  "iban" text,
  "opening_balance_paisa" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_bank_accounts_pharmacy" ON "bank_accounts" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_bank_accounts_pharmacy_type" ON "bank_accounts" ("pharmacy_id", "type");

-- 2. Fund Transfers (Inter-account transfers between cash & bank)
CREATE TABLE IF NOT EXISTS "fund_transfers" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "transfer_number" text NOT NULL,
  "from_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE RESTRICT,
  "to_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE RESTRICT,
  "amount_paisa" integer NOT NULL,
  "transfer_date" text NOT NULL, -- YYYY-MM-DD Asia/Karachi
  "reference_no" text,
  "notes" text,
  "journal_entry_id" uuid NOT NULL REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'completed', -- 'completed' | 'reversed'
  "reversal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "reversal_reason" text,
  "reversed_at" timestamp with time zone,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "uq_fund_transfers_pharmacy_number" UNIQUE ("pharmacy_id", "transfer_number")
);

CREATE INDEX IF NOT EXISTS "idx_fund_transfers_pharmacy" ON "fund_transfers" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_fund_transfers_date" ON "fund_transfers" ("pharmacy_id", "transfer_date");

-- 3. Day-end Counter Cash Deposits
CREATE TABLE IF NOT EXISTS "counter_deposits" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "deposit_number" text NOT NULL,
  "deposit_date" text NOT NULL, -- YYYY-MM-DD
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "counter_id" uuid REFERENCES "counters"("id") ON DELETE RESTRICT,
  "shift_id" text,
  "source_cash_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE RESTRICT,
  "target_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE RESTRICT,
  "amount_paisa" integer NOT NULL,
  "notes" text,
  "journal_entry_id" uuid NOT NULL REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'completed', -- 'completed' | 'reversed'
  "reversal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "reversal_reason" text,
  "reversed_at" timestamp with time zone,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "uq_counter_deposits_pharmacy_number" UNIQUE ("pharmacy_id", "deposit_number")
);

CREATE INDEX IF NOT EXISTS "idx_counter_deposits_pharmacy" ON "counter_deposits" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_counter_deposits_date" ON "counter_deposits" ("pharmacy_id", "deposit_date");

-- 4. Bank Reconciliation Sessions
CREATE TABLE IF NOT EXISTS "bank_reconciliations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "bank_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE RESTRICT,
  "statement_date" text NOT NULL,
  "statement_balance_paisa" integer NOT NULL,
  "ledger_balance_paisa" integer NOT NULL,
  "cleared_balance_paisa" integer NOT NULL,
  "difference_paisa" integer NOT NULL,
  "matched_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'draft', -- 'draft' | 'reconciled'
  "notes" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL,
  "reconciled_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_bank_reconciliations_pharmacy" ON "bank_reconciliations" ("pharmacy_id");

