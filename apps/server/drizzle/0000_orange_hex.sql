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