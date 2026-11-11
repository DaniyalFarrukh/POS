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

