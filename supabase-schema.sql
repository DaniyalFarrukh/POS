-- HexaPharm POS Complete Database Schema for Supabase
-- Generated from Drizzle Migrations 0000 - 0023

-- =============================================
-- Migration: 0000_orange_hex.sql
-- =============================================

CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"expiry_date" text NOT NULL,
	"cost_paisa" integer NOT NULL,
	"mrp_paisa" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"op" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"last_invoice_seq" integer DEFAULT 0 NOT NULL,
	"last_credit_note_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_note_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"original_invoice_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid,
	"quantity" integer NOT NULL,
	"unit_price_paisa" integer NOT NULL,
	"tax_rate_bp" integer DEFAULT 0 NOT NULL,
	"tax_paisa" integer DEFAULT 0 NOT NULL,
	"line_total_paisa" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"credit_note_number" text NOT NULL,
	"original_invoice_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"counter_id" uuid NOT NULL,
	"cashier_user_id" uuid NOT NULL,
	"client_request_id" text NOT NULL,
	"subtotal_paisa" integer NOT NULL,
	"tax_paisa" integer DEFAULT 0 NOT NULL,
	"total_paisa" integer NOT NULL,
	"refund_method" text DEFAULT 'cash' NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_credit_notes_pharmacy_number" UNIQUE("pharmacy_id","credit_note_number")
);
--> statement-breakpoint
CREATE TABLE "device_registration_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"counter_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"branch_id" uuid,
	"counter_id" uuid,
	"device_name" text NOT NULL,
	"device_fingerprint" text,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid,
	"quantity" integer NOT NULL,
	"unit_price_paisa" integer NOT NULL,
	"discount_paisa" integer DEFAULT 0 NOT NULL,
	"tax_rate_bp" integer DEFAULT 0 NOT NULL,
	"tax_paisa" integer DEFAULT 0 NOT NULL,
	"line_total_paisa" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"counter_id" uuid NOT NULL,
	"cashier_user_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"client_request_id" text NOT NULL,
	"status" text DEFAULT 'finalized' NOT NULL,
	"subtotal_paisa" integer NOT NULL,
	"discount_paisa" integer DEFAULT 0 NOT NULL,
	"tax_paisa" integer DEFAULT 0 NOT NULL,
	"total_paisa" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_invoices_pharmacy_invoice_number" UNIQUE("pharmacy_id","invoice_number"),
	CONSTRAINT "uq_invoices_pharmacy_client_request" UNIQUE("pharmacy_id","client_request_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount_paisa" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pharmacies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"pharmacy_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_processed_events" PRIMARY KEY("pharmacy_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"brand_name" text NOT NULL,
	"generic_name" text,
	"strength" text,
	"form" text,
	"manufacturer" text,
	"barcode" text,
	"tax_category_id" uuid,
	"mrp_paisa" integer NOT NULL,
	"is_controlled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rejected_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"device_id" uuid,
	"event" jsonb NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid,
	"type" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"type" text NOT NULL,
	"quantity_signed" integer NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"phone" text,
	"email" text,
	"address" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate_bp" integer DEFAULT 0 NOT NULL,
	"is_exempt" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"pin_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_original_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("original_invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_original_invoice_id_invoices_id_fk" FOREIGN KEY ("original_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_counter_id_counters_id_fk" FOREIGN KEY ("counter_id") REFERENCES "public"."counters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_cashier_user_id_users_id_fk" FOREIGN KEY ("cashier_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_registration_codes" ADD CONSTRAINT "device_registration_codes_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_registration_codes" ADD CONSTRAINT "device_registration_codes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_registration_codes" ADD CONSTRAINT "device_registration_codes_counter_id_counters_id_fk" FOREIGN KEY ("counter_id") REFERENCES "public"."counters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_counter_id_counters_id_fk" FOREIGN KEY ("counter_id") REFERENCES "public"."counters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_counter_id_counters_id_fk" FOREIGN KEY ("counter_id") REFERENCES "public"."counters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cashier_user_id_users_id_fk" FOREIGN KEY ("cashier_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_events" ADD CONSTRAINT "processed_events_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tax_category_id_tax_categories_id_fk" FOREIGN KEY ("tax_category_id") REFERENCES "public"."tax_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejected_events" ADD CONSTRAINT "rejected_events_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejected_events" ADD CONSTRAINT "rejected_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_categories" ADD CONSTRAINT "tax_categories_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_batches_pharmacy_product" ON "batches" USING btree ("pharmacy_id","product_id");--> statement-breakpoint
CREATE INDEX "idx_batches_pharmacy_expiry" ON "batches" USING btree ("pharmacy_id","expiry_date");--> statement-breakpoint
CREATE INDEX "idx_branches_pharmacy" ON "branches" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_change_log_pharmacy_seq" ON "change_log" USING btree ("pharmacy_id","seq");--> statement-breakpoint
CREATE INDEX "idx_counters_pharmacy_branch" ON "counters" USING btree ("pharmacy_id","branch_id");--> statement-breakpoint
CREATE INDEX "idx_credit_note_lines_pharmacy_cn" ON "credit_note_lines" USING btree ("pharmacy_id","credit_note_id");--> statement-breakpoint
CREATE INDEX "idx_credit_notes_pharmacy_orig_inv" ON "credit_notes" USING btree ("pharmacy_id","original_invoice_id");--> statement-breakpoint
CREATE INDEX "idx_device_reg_codes_pharmacy" ON "device_registration_codes" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_devices_pharmacy" ON "devices" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_lines_pharmacy_invoice" ON "invoice_lines" USING btree ("pharmacy_id","invoice_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_pharmacy_created" ON "invoices" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_payments_pharmacy_invoice" ON "payments" USING btree ("pharmacy_id","invoice_id");--> statement-breakpoint
CREATE INDEX "idx_products_pharmacy" ON "products" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_products_pharmacy_barcode" ON "products" USING btree ("pharmacy_id","barcode");--> statement-breakpoint
CREATE INDEX "idx_rejected_events_pharmacy_created" ON "rejected_events" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_stock_alerts_pharmacy_branch" ON "stock_alerts" USING btree ("pharmacy_id","branch_id");--> statement-breakpoint
CREATE INDEX "idx_stock_movements_pharmacy_branch_batch" ON "stock_movements" USING btree ("pharmacy_id","branch_id","batch_id");--> statement-breakpoint
CREATE INDEX "idx_stock_movements_pharmacy_product" ON "stock_movements" USING btree ("pharmacy_id","product_id");--> statement-breakpoint
CREATE INDEX "idx_suppliers_pharmacy" ON "suppliers" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_tax_categories_pharmacy" ON "tax_categories" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_users_pharmacy" ON "users" USING btree ("pharmacy_id");

-- =============================================
-- Migration: 0001_naive_natasha_romanoff.sql
-- =============================================

ALTER TABLE "pharmacies" ADD COLUMN "code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD CONSTRAINT "pharmacies_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "uq_users_pharmacy_name" UNIQUE("pharmacy_id","name");

-- =============================================
-- Migration: 0002_goofy_sleepwalker.sql
-- =============================================

ALTER TABLE "change_log" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_change_log_pharmacy_branch_seq" ON "change_log" USING btree ("pharmacy_id","branch_id","seq");--> statement-breakpoint
-- Backfill branch_id for branch-scoped entities where the referenced branch exists
UPDATE "change_log" c
SET "branch_id" = v.extracted_id
FROM (
  SELECT seq,
    CASE
      WHEN (data->>'branchId') IS NOT NULL AND (data->>'branchId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (data->>'branchId')::uuid
      WHEN (data->>'branch_id') IS NOT NULL AND (data->>'branch_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (data->>'branch_id')::uuid
      ELSE NULL
    END AS extracted_id
  FROM "change_log"
  WHERE "branch_id" IS NULL
    AND "entity" IN ('stock_movement', 'counter', 'device', 'stock_alert')
    AND ((data->>'branchId') IS NOT NULL OR (data->>'branch_id') IS NOT NULL)
) v
WHERE c.seq = v.seq
  AND v.extracted_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "branches" b
    WHERE b.id = v.extracted_id AND b.pharmacy_id = c.pharmacy_id
  );


-- =============================================
-- Migration: 0003_immutable_finalized_records.sql
-- =============================================

ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_finalized_record_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'finalized records are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_invoices_immutable
BEFORE UPDATE OR DELETE ON "invoices"
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_record_modification();--> statement-breakpoint
CREATE TRIGGER trg_invoice_lines_immutable
BEFORE UPDATE OR DELETE ON "invoice_lines"
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_record_modification();--> statement-breakpoint
CREATE TRIGGER trg_payments_immutable
BEFORE UPDATE OR DELETE ON "payments"
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_record_modification();--> statement-breakpoint
CREATE TRIGGER trg_credit_notes_immutable
BEFORE UPDATE OR DELETE ON "credit_notes"
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_record_modification();--> statement-breakpoint
CREATE TRIGGER trg_credit_note_lines_immutable
BEFORE UPDATE OR DELETE ON "credit_note_lines"
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_record_modification();



-- =============================================
-- Migration: 0004_expand_user_roles.sql
-- =============================================

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" 
  CHECK ("role" IN ('owner', 'manager', 'accountant', 'pharmacist', 'cashier'));



-- =============================================
-- Migration: 0005_ledger_core.sql
-- =============================================

CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"parent_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	CONSTRAINT "uq_accounts_pharmacy_code" UNIQUE("pharmacy_id","code"),
	CONSTRAINT "accounts_type_check" CHECK ("type" IN ('asset', 'liability', 'equity', 'revenue', 'expense'))
);
--> statement-breakpoint
CREATE TABLE "fiscal_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	CONSTRAINT "fiscal_periods_status_check" CHECK ("status" IN ('open', 'closed')),
	CONSTRAINT "fiscal_periods_date_range_check" CHECK ("start_date" <= "end_date")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"entry_no" integer NOT NULL,
	"entry_date" text NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"memo" text,
	"status" text DEFAULT 'posted' NOT NULL,
	"reverses_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_journal_entries_pharmacy_entry_no" UNIQUE("pharmacy_id","entry_no"),
	CONSTRAINT "uq_journal_entries_pharmacy_source" UNIQUE("pharmacy_id","source_type","source_id"),
	CONSTRAINT "uq_journal_entries_reverses_entry_id" UNIQUE("reverses_entry_id"),
	CONSTRAINT "journal_entries_status_check" CHECK ("status" IN ('posted', 'reversed'))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_paisa" integer DEFAULT 0 NOT NULL,
	"credit_paisa" integer DEFAULT 0 NOT NULL,
	"branch_id" uuid,
	"party_type" text,
	"party_id" uuid,
	"memo" text,
	CONSTRAINT "journal_lines_debit_credit_xor_check" CHECK (
		("debit_paisa" > 0 AND "credit_paisa" = 0) OR
		("credit_paisa" > 0 AND "debit_paisa" = 0)
	),
	CONSTRAINT "journal_lines_party_type_check" CHECK (
		"party_type" IS NULL OR "party_type" IN ('customer', 'supplier', 'employee')
	)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_accounts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_entry_id_journal_entries_id_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_accounts_pharmacy" ON "accounts" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_fiscal_periods_pharmacy_dates" ON "fiscal_periods" USING btree ("pharmacy_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "idx_journal_entries_pharmacy_entry_date" ON "journal_entries" USING btree ("pharmacy_id","entry_date");--> statement-breakpoint
CREATE INDEX "idx_journal_lines_pharmacy_account" ON "journal_lines" USING btree ("pharmacy_id","account_id");--> statement-breakpoint
CREATE INDEX "idx_journal_lines_entry" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
-- 1. Immutability trigger on journal_entries and journal_lines (rejects UPDATE and DELETE)
CREATE OR REPLACE FUNCTION prevent_ledger_record_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'accounting records are immutable: corrections must be reversing entries';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_journal_entries_immutable
BEFORE UPDATE OR DELETE ON "journal_entries"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_record_modification();--> statement-breakpoint
CREATE TRIGGER trg_journal_lines_immutable
BEFORE UPDATE OR DELETE ON "journal_lines"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_record_modification();--> statement-breakpoint
-- 2. Closed period trigger on journal_entries (rejects posting into a closed fiscal period)
CREATE OR REPLACE FUNCTION check_journal_entry_open_period()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "fiscal_periods" fp
    WHERE fp.pharmacy_id = NEW.pharmacy_id
      AND fp.status = 'closed'
      AND NEW.entry_date >= fp.start_date
      AND NEW.entry_date <= fp.end_date
  ) THEN
    RAISE EXCEPTION 'cannot post journal entry into a closed fiscal period (entry_date: %)', NEW.entry_date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_journal_entries_open_period
BEFORE INSERT ON "journal_entries"
FOR EACH ROW EXECUTE FUNCTION check_journal_entry_open_period();--> statement-breakpoint
-- 3. Deferred constraint trigger that rejects unbalanced or empty entries at commit / statement end
CREATE OR REPLACE FUNCTION check_journal_entry_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_entry_id uuid;
  v_entry_pharmacy_id uuid;
  v_total_debit bigint;
  v_total_credit bigint;
  v_line_count integer;
  v_mismatch_count integer;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    v_entry_id := NEW.id;
  ELSE
    v_entry_id := NEW.entry_id;
  END IF;

  SELECT pharmacy_id INTO v_entry_pharmacy_id
  FROM "journal_entries"
  WHERE id = v_entry_id;

  SELECT
    COUNT(*),
    COALESCE(SUM(debit_paisa), 0),
    COALESCE(SUM(credit_paisa), 0),
    COUNT(*) FILTER (WHERE pharmacy_id <> v_entry_pharmacy_id)
  INTO v_line_count, v_total_debit, v_total_credit, v_mismatch_count
  FROM "journal_lines"
  WHERE entry_id = v_entry_id;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'journal entry % must have at least 2 lines (found %)', v_entry_id, v_line_count;
  END IF;

  IF v_mismatch_count > 0 THEN
    RAISE EXCEPTION 'journal entry % has lines with mismatched pharmacy_id', v_entry_id;
  END IF;

  IF v_total_debit <= 0 OR v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'unbalanced journal entry %: debit=% credit=%', v_entry_id, v_total_debit, v_total_credit;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_journal_entry_balance_on_entry
AFTER INSERT ON "journal_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_journal_entry_balance();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_journal_entry_balance_on_line
AFTER INSERT ON "journal_lines"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_journal_entry_balance();



-- =============================================
-- Migration: 0006_account_mappings.sql
-- =============================================

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



-- =============================================
-- Migration: 0007_suppliers_module.sql
-- =============================================

ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "tax_number" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "payment_terms_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "credit_limit_paisa" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "opening_balance_paisa" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_suppliers_pharmacy_name" ON "suppliers" ("pharmacy_id", "name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_suppliers_pharmacy_phone" ON "suppliers" ("pharmacy_id", "phone");



-- =============================================
-- Migration: 0008_purchase_orders.sql
-- =============================================

-- 1. Product reorder levels
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "reorder_level" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "reorder_quantity" integer DEFAULT 0 NOT NULL;

-- 2. Optional branch-specific reorder overrides
CREATE TABLE IF NOT EXISTS "product_reorder_levels" (
  "id" uuid PRIMARY KEY,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "reorder_level" integer DEFAULT 0 NOT NULL,
  "reorder_quantity" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "uq_product_reorder_levels_pharmacy_product_branch" UNIQUE ("pharmacy_id", "product_id", "branch_id")
);
CREATE INDEX IF NOT EXISTS "idx_product_reorder_levels_pharmacy" ON "product_reorder_levels" ("pharmacy_id");

-- 3. Purchase Orders table
CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" uuid PRIMARY KEY,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "po_number" text NOT NULL,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'draft',
  "over_receipt_policy" text NOT NULL DEFAULT 'flag',
  "issue_date" text NOT NULL,
  "expected_delivery_date" text,
  "total_expected_cost_paisa" bigint NOT NULL DEFAULT 0,
  "notes" text,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "uq_purchase_orders_pharmacy_po_number" UNIQUE ("pharmacy_id", "po_number")
);
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_pharmacy_status" ON "purchase_orders" ("pharmacy_id", "status");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_pharmacy_supplier" ON "purchase_orders" ("pharmacy_id", "supplier_id");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_pharmacy_branch" ON "purchase_orders" ("pharmacy_id", "branch_id");

-- 4. Purchase Order Lines table
CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
  "id" uuid PRIMARY KEY,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "purchase_order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "quantity_ordered" integer NOT NULL,
  "quantity_received" integer NOT NULL DEFAULT 0,
  "expected_cost_paisa" integer NOT NULL,
  "total_cost_paisa" bigint NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_po_lines_purchase_order_id" ON "purchase_order_lines" ("purchase_order_id");
CREATE INDEX IF NOT EXISTS "idx_po_lines_pharmacy_product" ON "purchase_order_lines" ("pharmacy_id", "product_id");

-- 5. Purchase Order Receipts Linking table (tracks deliveries & GRNs against POs)
CREATE TABLE IF NOT EXISTS "purchase_order_receipts" (
  "id" uuid PRIMARY KEY,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "purchase_order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE RESTRICT,
  "receipt_reference_id" uuid NOT NULL,
  "supplier_invoice_no" text NOT NULL,
  "receipt_date" text NOT NULL,
  "total_cost_paisa" bigint NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_po_receipts_pharmacy_po" ON "purchase_order_receipts" ("pharmacy_id", "purchase_order_id");



-- =============================================
-- Migration: 0009_warehouses_and_transfers.sql
-- =============================================

-- 1. Stock Locations (a branch has several locations: main shelf, back store, cold storage)
CREATE TABLE IF NOT EXISTS "stock_locations" (
  "id" uuid PRIMARY KEY,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  "code" text,
  "is_default" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "uq_stock_locations_pharmacy_branch_name" UNIQUE ("pharmacy_id", "branch_id", "name")
);
CREATE INDEX IF NOT EXISTS "idx_stock_locations_pharmacy_branch" ON "stock_locations" ("pharmacy_id", "branch_id");

-- 2. Add location_id to stock_movements (Server Postgres & Desktop SQLite)
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "location_id" uuid REFERENCES "stock_locations"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_stock_movements_pharmacy_location" ON "stock_movements" ("pharmacy_id", "location_id");

-- 3. Stock Transfers Header
CREATE TABLE IF NOT EXISTS "stock_transfers" (
  "id" uuid PRIMARY KEY,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "transfer_number" text NOT NULL,
  "source_branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "source_location_id" uuid REFERENCES "stock_locations"("id") ON DELETE SET NULL,
  "destination_branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "destination_location_id" uuid REFERENCES "stock_locations"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "dispatched_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "dispatched_at" timestamp with time zone,
  "received_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "received_at" timestamp with time zone,
  "has_shortage" boolean DEFAULT false NOT NULL,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "uq_stock_transfers_pharmacy_number" UNIQUE ("pharmacy_id", "transfer_number")
);
CREATE INDEX IF NOT EXISTS "idx_stock_transfers_pharmacy_status" ON "stock_transfers" ("pharmacy_id", "status");
CREATE INDEX IF NOT EXISTS "idx_stock_transfers_pharmacy_src_branch" ON "stock_transfers" ("pharmacy_id", "source_branch_id");
CREATE INDEX IF NOT EXISTS "idx_stock_transfers_pharmacy_dest_branch" ON "stock_transfers" ("pharmacy_id", "destination_branch_id");

-- 4. Stock Transfer Lines
CREATE TABLE IF NOT EXISTS "stock_transfer_lines" (
  "id" uuid PRIMARY KEY,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "transfer_id" uuid NOT NULL REFERENCES "stock_transfers"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "batch_id" uuid NOT NULL REFERENCES "batches"("id") ON DELETE RESTRICT,
  "quantity_requested" integer NOT NULL,
  "quantity_dispatched" integer NOT NULL DEFAULT 0,
  "quantity_received" integer NOT NULL DEFAULT 0,
  "shortage_quantity" integer NOT NULL DEFAULT 0,
  "shortage_reason" text,
  "dispatch_movement_id" uuid,
  "receive_movement_id" uuid,
  "shortage_movement_id" uuid,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_transfer_lines_transfer_id" ON "stock_transfer_lines" ("transfer_id");
CREATE INDEX IF NOT EXISTS "idx_transfer_lines_pharmacy_product" ON "stock_transfer_lines" ("pharmacy_id", "product_id");
CREATE INDEX IF NOT EXISTS "idx_transfer_lines_pharmacy_batch" ON "stock_transfer_lines" ("pharmacy_id", "batch_id");



-- =============================================
-- Migration: 0010_stock_counts_and_supplier_returns.sql
-- =============================================

-- 1. Stock Counts Header
CREATE TABLE IF NOT EXISTS "stock_counts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "location_id" uuid REFERENCES "stock_locations"("id") ON DELETE SET NULL,
  "count_number" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "notes" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "uq_stock_counts_pharmacy_number" UNIQUE ("pharmacy_id", "count_number")
);

CREATE INDEX IF NOT EXISTS "idx_stock_counts_pharmacy_branch" ON "stock_counts" ("pharmacy_id", "branch_id");
CREATE INDEX IF NOT EXISTS "idx_stock_counts_pharmacy_status" ON "stock_counts" ("pharmacy_id", "status");

-- 2. Stock Count Lines
CREATE TABLE IF NOT EXISTS "stock_count_lines" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "count_id" uuid NOT NULL REFERENCES "stock_counts"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "batch_id" uuid NOT NULL REFERENCES "batches"("id") ON DELETE RESTRICT,
  "system_quantity" integer NOT NULL,
  "counted_quantity" integer NOT NULL,
  "variance_quantity" integer NOT NULL,
  "cost_paisa" integer NOT NULL,
  "variance_paisa" integer NOT NULL,
  "notes" text,
  "adjustment_movement_id" uuid,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_stock_count_lines_count" ON "stock_count_lines" ("count_id");
CREATE INDEX IF NOT EXISTS "idx_stock_count_lines_pharmacy_batch" ON "stock_count_lines" ("pharmacy_id", "batch_id");

-- 3. Supplier Returns & Debit Notes
CREATE TABLE IF NOT EXISTS "supplier_returns" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  "return_number" text NOT NULL,
  "debit_note_number" text NOT NULL,
  "return_date" text NOT NULL,
  "status" text NOT NULL DEFAULT 'completed',
  "subtotal_paisa" integer NOT NULL,
  "tax_paisa" integer NOT NULL DEFAULT 0,
  "total_paisa" integer NOT NULL,
  "reason" text NOT NULL,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "uq_supplier_returns_pharmacy_number" UNIQUE ("pharmacy_id", "return_number"),
  CONSTRAINT "uq_supplier_returns_pharmacy_dn" UNIQUE ("pharmacy_id", "debit_note_number")
);

CREATE INDEX IF NOT EXISTS "idx_supplier_returns_pharmacy_supplier" ON "supplier_returns" ("pharmacy_id", "supplier_id");
CREATE INDEX IF NOT EXISTS "idx_supplier_returns_pharmacy_branch" ON "supplier_returns" ("pharmacy_id", "branch_id");

-- 4. Supplier Return Lines
CREATE TABLE IF NOT EXISTS "supplier_return_lines" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "return_id" uuid NOT NULL REFERENCES "supplier_returns"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "batch_id" uuid NOT NULL REFERENCES "batches"("id") ON DELETE RESTRICT,
  "quantity" integer NOT NULL,
  "unit_cost_paisa" integer NOT NULL,
  "tax_rate_bp" integer NOT NULL DEFAULT 0,
  "tax_paisa" integer NOT NULL DEFAULT 0,
  "total_paisa" integer NOT NULL,
  "movement_id" uuid,
  "reason" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_supplier_return_lines_return" ON "supplier_return_lines" ("return_id");
CREATE INDEX IF NOT EXISTS "idx_supplier_return_lines_pharmacy_batch" ON "supplier_return_lines" ("pharmacy_id", "batch_id");



-- =============================================
-- Migration: 0011_payments_and_customers.sql
-- =============================================

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


-- =============================================
-- Migration: 0012_expenses_module.sql
-- =============================================

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



-- =============================================
-- Migration: 0013_payment_reminders.sql
-- =============================================

CREATE TABLE IF NOT EXISTS "payment_reminders" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "party_type" text NOT NULL,
  "party_id" uuid NOT NULL,
  "document_id" uuid,
  "channel" text NOT NULL DEFAULT 'sms',
  "recipient" text,
  "message" text,
  "amount_paisa" integer NOT NULL DEFAULT 0,
  "days_overdue" integer NOT NULL DEFAULT 0,
  "sent_at" timestamp with time zone NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_payment_reminders_pharmacy_party" 
  ON "payment_reminders" ("pharmacy_id", "party_type", "party_id");

CREATE INDEX IF NOT EXISTS "idx_payment_reminders_pharmacy_sent_at" 
  ON "payment_reminders" ("pharmacy_id", "sent_at");



-- =============================================
-- Migration: 0014_cash_and_bank.sql
-- =============================================

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



-- =============================================
-- Migration: 0015_budget_planning.sql
-- =============================================

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



-- =============================================
-- Migration: 0016_period_close_tracking.sql
-- =============================================

ALTER TABLE "fiscal_periods"
  ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "closed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "reopened_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "reopened_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "reopen_reason" text;



-- =============================================
-- Migration: 0017_customers_and_credit_sales.sql
-- =============================================

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


-- =============================================
-- Migration: 0018_prescriptions_and_refill_reminders.sql
-- =============================================

-- Migration 0018: Prescriptions, Prescription Items, and Access Audit Logs

-- 1. Prescriptions Table
CREATE TABLE IF NOT EXISTS "prescriptions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "prescription_number" text NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "patient_name" text NOT NULL,
  "patient_phone" text,
  "patient_age" integer,
  "patient_gender" text,
  "doctor_name" text,
  "doctor_registration_number" text,
  "doctor_clinic" text,
  "prescription_date" text NOT NULL, -- YYYY-MM-DD (Asia/Karachi)
  "diagnosis" text,
  "repeat_count" integer NOT NULL DEFAULT 0,
  "repeats_used" integer NOT NULL DEFAULT 0,
  "refill_interval_days" integer NOT NULL DEFAULT 30,
  "next_refill_date" text, -- YYYY-MM-DD (Asia/Karachi)
  "is_controlled_drug" boolean NOT NULL DEFAULT false,
  "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'active', -- 'active' | 'fulfilled' | 'cancelled' | 'expired'
  "notes" text,
  "retention_status" text NOT NULL DEFAULT 'active', -- 'active' | 'retained' | 'archived'
  "statutory_retention_until" text NOT NULL, -- YYYY-MM-DD
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "uq_prescriptions_pharmacy_number" UNIQUE ("pharmacy_id", "prescription_number")
);

CREATE INDEX IF NOT EXISTS "idx_prescriptions_pharmacy" ON "prescriptions" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_prescriptions_pharmacy_customer" ON "prescriptions" ("pharmacy_id", "customer_id");
CREATE INDEX IF NOT EXISTS "idx_prescriptions_pharmacy_refill" ON "prescriptions" ("pharmacy_id", "next_refill_date", "status");
CREATE INDEX IF NOT EXISTS "idx_prescriptions_pharmacy_controlled" ON "prescriptions" ("pharmacy_id", "is_controlled_drug");

-- 2. Prescription Items Table
CREATE TABLE IF NOT EXISTS "prescription_items" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "prescription_id" uuid NOT NULL REFERENCES "prescriptions"("id") ON DELETE CASCADE,
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "dosage_instructions" text NOT NULL,
  "quantity_prescribed" integer NOT NULL,
  "quantity_dispensed" integer NOT NULL DEFAULT 0,
  "days_supply" integer NOT NULL DEFAULT 30,
  "is_controlled" boolean NOT NULL DEFAULT false,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_prescription_items_prescription" ON "prescription_items" ("prescription_id");
CREATE INDEX IF NOT EXISTS "idx_prescription_items_pharmacy_product" ON "prescription_items" ("pharmacy_id", "product_id");

-- 3. Dedicated Immutable Prescription Access Audit Log
CREATE TABLE IF NOT EXISTS "prescription_access_logs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "prescription_id" uuid REFERENCES "prescriptions"("id") ON DELETE SET NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "user_role" text NOT NULL,
  "action" text NOT NULL, -- 'view_detail' | 'view_list' | 'view_reminders' | 'create' | 'update' | 'dispense' | 'refill'
  "details" text,
  "accessed_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_prescription_access_logs_pharmacy" ON "prescription_access_logs" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_prescription_access_logs_prescription" ON "prescription_access_logs" ("prescription_id");
CREATE INDEX IF NOT EXISTS "idx_prescription_access_logs_user" ON "prescription_access_logs" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_prescription_access_logs_accessed_at" ON "prescription_access_logs" ("accessed_at");



-- =============================================
-- Migration: 0019_leave_management_and_attendance.sql
-- =============================================

-- 1. Employees table
CREATE TABLE IF NOT EXISTS "employees" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE SET NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "employee_code" text NOT NULL,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "email" text,
  "phone" text,
  "designation" text NOT NULL,
  "department" text,
  "joining_date" text NOT NULL,
  "salary_paisa" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_employees_pharmacy" ON "employees" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_employees_branch" ON "employees" ("branch_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_employees_pharmacy_code" ON "employees" ("pharmacy_id", "employee_code");

-- 2. Leave Types (yearly entitlement & carry-over rules)
CREATE TABLE IF NOT EXISTS "leave_types" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "is_paid" boolean NOT NULL DEFAULT true,
  "yearly_entitlement_days" integer NOT NULL DEFAULT 0,
  "max_carry_over_days" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_leave_types_pharmacy" ON "leave_types" ("pharmacy_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_leave_types_pharmacy_code" ON "leave_types" ("pharmacy_id", "code");

-- 3. Leave Allocations & Yearly Balances
CREATE TABLE IF NOT EXISTS "leave_allocations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "leave_type_id" uuid NOT NULL REFERENCES "leave_types"("id") ON DELETE RESTRICT,
  "year" integer NOT NULL,
  "entitled_days" integer NOT NULL DEFAULT 0,
  "carried_over_days" integer NOT NULL DEFAULT 0,
  "manual_adjustment_days" integer NOT NULL DEFAULT 0,
  "used_days" integer NOT NULL DEFAULT 0,
  "pending_days" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_leave_allocations_pharmacy" ON "leave_allocations" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_leave_allocations_employee" ON "leave_allocations" ("employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_leave_allocations_emp_type_year" ON "leave_allocations" ("pharmacy_id", "employee_id", "leave_type_id", "year");

-- 4. Leave Requests (Manager approval workflow)
CREATE TABLE IF NOT EXISTS "leave_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "leave_type_id" uuid NOT NULL REFERENCES "leave_types"("id") ON DELETE RESTRICT,
  "start_date" text NOT NULL,
  "end_date" text NOT NULL,
  "days_count" integer NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "rejection_reason" text,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_leave_requests_pharmacy" ON "leave_requests" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_leave_requests_employee" ON "leave_requests" ("employee_id");
CREATE INDEX IF NOT EXISTS "idx_leave_requests_dates" ON "leave_requests" ("pharmacy_id", "start_date", "end_date");
CREATE INDEX IF NOT EXISTS "idx_leave_requests_status" ON "leave_requests" ("pharmacy_id", "status");

-- 5. Attendance Records (reflecting approved leaves)
CREATE TABLE IF NOT EXISTS "attendance_records" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE SET NULL,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "date" text NOT NULL,
  "status" text NOT NULL,
  "leave_request_id" uuid REFERENCES "leave_requests"("id") ON DELETE SET NULL,
  "check_in_time" text,
  "check_out_time" text,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_attendance_pharmacy" ON "attendance_records" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_attendance_employee_date" ON "attendance_records" ("pharmacy_id", "employee_id", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_attendance_emp_date" ON "attendance_records" ("pharmacy_id", "employee_id", "date");



-- =============================================
-- Migration: 0020_payroll_module.sql
-- =============================================

-- 1. Configurable Statutory Components (EOBI, Social Security, etc.)
CREATE TABLE IF NOT EXISTS "payroll_statutory_components" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "component_type" text NOT NULL DEFAULT 'statutory_deduction',
  "calculation_type" text NOT NULL DEFAULT 'fixed',
  "fixed_amount_paisa" integer NOT NULL DEFAULT 0,
  "percentage_rate" text NOT NULL DEFAULT '0',
  "account_code" text NOT NULL DEFAULT '2210',
  "is_example" boolean NOT NULL DEFAULT true,
  "notes" text NOT NULL DEFAULT 'Example configuration. Must be reviewed and verified by a licensed accountant before use.',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_statutory_comp_pharmacy" ON "payroll_statutory_components" ("pharmacy_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_statutory_comp_pharmacy_code" ON "payroll_statutory_components" ("pharmacy_id", "code");

-- 2. Configurable Progressive Income Tax Slabs
CREATE TABLE IF NOT EXISTS "payroll_tax_slabs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "min_monthly_income_paisa" integer NOT NULL DEFAULT 0,
  "max_monthly_income_paisa" integer,
  "base_tax_paisa" integer NOT NULL DEFAULT 0,
  "excess_rate_percentage" text NOT NULL DEFAULT '0',
  "is_example" boolean NOT NULL DEFAULT true,
  "notes" text NOT NULL DEFAULT 'Example progressive slab. Must be reviewed and verified by a licensed accountant before use.',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_tax_slabs_pharmacy" ON "payroll_tax_slabs" ("pharmacy_id");

-- 3. Employee Advances & Loan Recoveries
CREATE TABLE IF NOT EXISTS "employee_advances" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "disbursement_date" text NOT NULL,
  "principal_paisa" integer NOT NULL,
  "recovered_paisa" integer NOT NULL DEFAULT 0,
  "remaining_paisa" integer NOT NULL,
  "monthly_installment_paisa" integer NOT NULL,
  "reason" text,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_employee_advances_pharmacy" ON "employee_advances" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_employee_advances_employee" ON "employee_advances" ("employee_id");

-- 4. Payroll Runs (Monthly per branch, status lifecycle, immutable once approved)
CREATE TABLE IF NOT EXISTS "payroll_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "month" text NOT NULL,
  "run_number" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "is_adjustment_run" boolean NOT NULL DEFAULT false,
  "adjustment_for_run_id" uuid REFERENCES "payroll_runs"("id") ON DELETE RESTRICT,
  "total_base_salary_paisa" integer NOT NULL DEFAULT 0,
  "total_allowances_paisa" integer NOT NULL DEFAULT 0,
  "total_overtime_paisa" integer NOT NULL DEFAULT 0,
  "total_gross_paisa" integer NOT NULL DEFAULT 0,
  "total_unpaid_leave_deductions_paisa" integer NOT NULL DEFAULT 0,
  "total_advances_recovered_paisa" integer NOT NULL DEFAULT 0,
  "total_tax_paisa" integer NOT NULL DEFAULT 0,
  "total_statutory_paisa" integer NOT NULL DEFAULT 0,
  "total_deductions_paisa" integer NOT NULL DEFAULT 0,
  "total_net_paisa" integer NOT NULL DEFAULT 0,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "payment_journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "payment_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
  "payment_method" text,
  "paid_at" timestamp with time zone,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp with time zone,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamp with time zone,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_payroll_runs_pharmacy" ON "payroll_runs" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_payroll_runs_branch" ON "payroll_runs" ("branch_id");
CREATE INDEX IF NOT EXISTS "idx_payroll_runs_month" ON "payroll_runs" ("pharmacy_id", "month");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payroll_runs_number" ON "payroll_runs" ("pharmacy_id", "run_number");

-- 5. Individual Employee Payroll Items (Payslips)
CREATE TABLE IF NOT EXISTS "payroll_items" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "payroll_run_id" uuid NOT NULL REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "employee_code" text NOT NULL,
  "employee_name" text NOT NULL,
  "designation" text NOT NULL,
  "base_salary_paisa" integer NOT NULL,
  "working_days" integer NOT NULL DEFAULT 30,
  "attended_days" integer NOT NULL DEFAULT 30,
  "unpaid_leave_days" integer NOT NULL DEFAULT 0,
  "unpaid_leave_deduction_paisa" integer NOT NULL DEFAULT 0,
  "overtime_hours" integer NOT NULL DEFAULT 0,
  "overtime_amount_paisa" integer NOT NULL DEFAULT 0,
  "allowances_paisa" integer NOT NULL DEFAULT 0,
  "allowances_breakdown" text,
  "advance_recovery_paisa" integer NOT NULL DEFAULT 0,
  "advance_id" uuid REFERENCES "employee_advances"("id") ON DELETE SET NULL,
  "tax_paisa" integer NOT NULL DEFAULT 0,
  "statutory_deductions_paisa" integer NOT NULL DEFAULT 0,
  "statutory_breakdown" text,
  "gross_salary_paisa" integer NOT NULL,
  "total_deductions_paisa" integer NOT NULL,
  "net_salary_paisa" integer NOT NULL,
  "payment_status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_payroll_items_pharmacy" ON "payroll_items" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_payroll_items_run" ON "payroll_items" ("payroll_run_id");
CREATE INDEX IF NOT EXISTS "idx_payroll_items_employee" ON "payroll_items" ("employee_id");

-- 6. Immutability Trigger: Approved payroll items cannot be altered or deleted directly
CREATE OR REPLACE FUNCTION prevent_approved_payroll_item_modification()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM "payroll_runs" WHERE id = OLD.payroll_run_id;
    IF v_status IN ('approved', 'posted', 'paid') THEN
      RAISE EXCEPTION 'Approved payroll run items are immutable. Corrections must be made via an adjustment run.';
    END IF;
    RETURN OLD;
  ELSE
    SELECT status INTO v_status FROM "payroll_runs" WHERE id = NEW.payroll_run_id;
    IF v_status IN ('approved', 'posted', 'paid') THEN
      IF (OLD.base_salary_paisa IS DISTINCT FROM NEW.base_salary_paisa OR
          OLD.gross_salary_paisa IS DISTINCT FROM NEW.gross_salary_paisa OR
          OLD.net_salary_paisa IS DISTINCT FROM NEW.net_salary_paisa OR
          OLD.total_deductions_paisa IS DISTINCT FROM NEW.total_deductions_paisa OR
          OLD.unpaid_leave_deduction_paisa IS DISTINCT FROM NEW.unpaid_leave_deduction_paisa OR
          OLD.allowances_paisa IS DISTINCT FROM NEW.allowances_paisa OR
          OLD.overtime_amount_paisa IS DISTINCT FROM NEW.overtime_amount_paisa OR
          OLD.advance_recovery_paisa IS DISTINCT FROM NEW.advance_recovery_paisa OR
          OLD.tax_paisa IS DISTINCT FROM NEW.tax_paisa OR
          OLD.statutory_deductions_paisa IS DISTINCT FROM NEW.statutory_deductions_paisa) THEN
        RAISE EXCEPTION 'Approved payroll run items are immutable. Corrections must be made via an adjustment run.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payroll_items_immutable ON "payroll_items";
CREATE TRIGGER trg_payroll_items_immutable
BEFORE UPDATE OR DELETE ON "payroll_items"
FOR EACH ROW EXECUTE FUNCTION prevent_approved_payroll_item_modification();


-- =============================================
-- Migration: 0021_notifications_and_audit_logs.sql
-- =============================================

-- 1. Per-user Notifications with Read State Tracking
CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(64) NOT NULL,
  "title" varchar(255) NOT NULL,
  "message" text NOT NULL,
  "severity" varchar(32) DEFAULT 'info' NOT NULL,
  "entity_type" varchar(64),
  "entity_id" uuid,
  "link" varchar(255),
  "is_read" boolean DEFAULT false NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_user_notifications_tenant_user_read" 
  ON "user_notifications" ("pharmacy_id", "user_id", "is_read");

-- 2. Comprehensive Audit Logs for Sensitive Actions (Who, What, When, Before & After)
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "user_name" varchar(255) NOT NULL,
  "user_role" varchar(64) NOT NULL,
  "action" varchar(128) NOT NULL,
  "entity" varchar(64) NOT NULL,
  "entity_id" uuid,
  "summary" text NOT NULL,
  "before_state" jsonb,
  "after_state" jsonb,
  "ip_address" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_audit_logs_pharmacy_created" 
  ON "audit_logs" ("pharmacy_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_logs_pharmacy_entity" 
  ON "audit_logs" ("pharmacy_id", "entity");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_pharmacy_user" 
  ON "audit_logs" ("pharmacy_id", "user_id");



-- =============================================
-- Migration: 0022_auth_hardening_and_compliance.sql
-- =============================================

-- 1. Pharmacy & Branch Regulatory Compliance Fields (F-M-11)
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "ntn" text;
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "strn" text;
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "drug_sale_license_no" text;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "drug_sale_license_no" text;

-- 2. Persisted JWT Revoked Tokens Table (F-H-09)
CREATE TABLE IF NOT EXISTS "revoked_tokens" (
  "jti" text PRIMARY KEY NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_revoked_tokens_expires" ON "revoked_tokens" ("expires_at");



-- =============================================
-- Migration: 0023_batch_expiry_check_constraint.sql
-- =============================================

-- Enforce YYYY-MM-DD standard format on batches.expiry_date
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'batches_expiry_date_format_chk'
  ) THEN
    ALTER TABLE "batches"
      ADD CONSTRAINT "batches_expiry_date_format_chk"
      CHECK (expiry_date ~ '^\d{4}-\d{2}-\d{2}$');
  END IF;
END $$;


