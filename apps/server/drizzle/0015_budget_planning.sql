CREATE TABLE IF NOT EXISTS "budgets" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "fiscal_year" integer NOT NULL,
  "month" integer NOT NULL,
  "amount_paisa" integer NOT NULL DEFAULT 0,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "uq_budgets_pharmacy_branch_account_period" UNIQUE ("pharmacy_id", "branch_id", "account_id", "fiscal_year", "month"),
  CONSTRAINT "chk_budgets_month" CHECK ("month" >= 1 AND "month" <= 12),
  CONSTRAINT "chk_budgets_amount_non_negative" CHECK ("amount_paisa" >= 0)
);

CREATE INDEX IF NOT EXISTS "idx_budgets_lookup" ON "budgets" ("pharmacy_id", "fiscal_year", "month", "branch_id");
CREATE INDEX IF NOT EXISTS "idx_budgets_account" ON "budgets" ("pharmacy_id", "account_id");

