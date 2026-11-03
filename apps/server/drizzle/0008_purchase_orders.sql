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

