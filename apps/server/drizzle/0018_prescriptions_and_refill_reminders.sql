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

