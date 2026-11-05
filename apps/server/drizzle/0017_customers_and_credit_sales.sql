-- 1. Extend customers table with price tier, duplicate flagging, and unique normalized phone
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "price_tier" text;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "is_duplicate" boolean NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "duplicate_of_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL;

-- Unique normalized phone per pharmacy for non-duplicate records (ignoring null or empty phones)
DROP INDEX IF EXISTS "uq_customers_pharmacy_phone";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customers_pharmacy_phone" 
  ON "customers" ("pharmacy_id", "phone") 
  WHERE "phone" IS NOT NULL AND "phone" != '' AND "is_duplicate" = false;

-- 2. Flag invoices where offline credit sales exceeded the customer's credit limit
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "credit_limit_exceeded" boolean NOT NULL DEFAULT false;

-- 3. Associate ERP Payments with counter if generated at counter
ALTER TABLE "erp_payments" ADD COLUMN IF NOT EXISTS "counter_id" uuid REFERENCES "counters"("id") ON DELETE SET NULL;
