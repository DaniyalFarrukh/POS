ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "tax_number" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "payment_terms_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "credit_limit_paisa" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "opening_balance_paisa" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_suppliers_pharmacy_name" ON "suppliers" ("pharmacy_id", "name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_suppliers_pharmacy_phone" ON "suppliers" ("pharmacy_id", "phone");

