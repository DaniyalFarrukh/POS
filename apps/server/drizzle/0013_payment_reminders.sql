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

