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

