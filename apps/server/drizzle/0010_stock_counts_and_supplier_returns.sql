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

