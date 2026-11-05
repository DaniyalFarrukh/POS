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

