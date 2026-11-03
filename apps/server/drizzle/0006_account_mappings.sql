-- ============================================================================
-- Migration 0006: Per-Pharmacy Account Mappings (Posting Engine Roles)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "pharmacy_account_mappings" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id"),
  "role" text NOT NULL CHECK ("role" IN (
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
    'ap'
  )),
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "updated_at" text NOT NULL,
  CONSTRAINT "pharmacy_account_mappings_pharmacy_role_unique" UNIQUE("pharmacy_id", "role")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "pharmacy_account_mappings_pharmacy_id_idx"
  ON "pharmacy_account_mappings" ("pharmacy_id");

