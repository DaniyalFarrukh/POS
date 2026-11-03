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

