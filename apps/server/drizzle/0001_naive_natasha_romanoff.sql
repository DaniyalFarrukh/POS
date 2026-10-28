ALTER TABLE "pharmacies" ADD COLUMN "code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD CONSTRAINT "pharmacies_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "uq_users_pharmacy_name" UNIQUE("pharmacy_id","name");