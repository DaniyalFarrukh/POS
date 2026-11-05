-- 1. Configurable Statutory Components (EOBI, Social Security, etc.)
CREATE TABLE IF NOT EXISTS "payroll_statutory_components" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "component_type" text NOT NULL DEFAULT 'statutory_deduction',
  "calculation_type" text NOT NULL DEFAULT 'fixed',
  "fixed_amount_paisa" integer NOT NULL DEFAULT 0,
  "percentage_rate" text NOT NULL DEFAULT '0',
  "account_code" text NOT NULL DEFAULT '2210',
  "is_example" boolean NOT NULL DEFAULT true,
  "notes" text NOT NULL DEFAULT 'Example configuration. Must be reviewed and verified by a licensed accountant before use.',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_statutory_comp_pharmacy" ON "payroll_statutory_components" ("pharmacy_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_statutory_comp_pharmacy_code" ON "payroll_statutory_components" ("pharmacy_id", "code");

-- 2. Configurable Progressive Income Tax Slabs
CREATE TABLE IF NOT EXISTS "payroll_tax_slabs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "min_monthly_income_paisa" integer NOT NULL DEFAULT 0,
  "max_monthly_income_paisa" integer,
  "base_tax_paisa" integer NOT NULL DEFAULT 0,
  "excess_rate_percentage" text NOT NULL DEFAULT '0',
  "is_example" boolean NOT NULL DEFAULT true,
  "notes" text NOT NULL DEFAULT 'Example progressive slab. Must be reviewed and verified by a licensed accountant before use.',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_tax_slabs_pharmacy" ON "payroll_tax_slabs" ("pharmacy_id");

-- 3. Employee Advances & Loan Recoveries
CREATE TABLE IF NOT EXISTS "employee_advances" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "disbursement_date" text NOT NULL,
  "principal_paisa" integer NOT NULL,
  "recovered_paisa" integer NOT NULL DEFAULT 0,
  "remaining_paisa" integer NOT NULL,
  "monthly_installment_paisa" integer NOT NULL,
  "reason" text,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_employee_advances_pharmacy" ON "employee_advances" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_employee_advances_employee" ON "employee_advances" ("employee_id");

-- 4. Payroll Runs (Monthly per branch, status lifecycle, immutable once approved)
CREATE TABLE IF NOT EXISTS "payroll_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "month" text NOT NULL,
  "run_number" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "is_adjustment_run" boolean NOT NULL DEFAULT false,
  "adjustment_for_run_id" uuid REFERENCES "payroll_runs"("id") ON DELETE RESTRICT,
  "total_base_salary_paisa" integer NOT NULL DEFAULT 0,
  "total_allowances_paisa" integer NOT NULL DEFAULT 0,
  "total_overtime_paisa" integer NOT NULL DEFAULT 0,
  "total_gross_paisa" integer NOT NULL DEFAULT 0,
  "total_unpaid_leave_deductions_paisa" integer NOT NULL DEFAULT 0,
  "total_advances_recovered_paisa" integer NOT NULL DEFAULT 0,
  "total_tax_paisa" integer NOT NULL DEFAULT 0,
  "total_statutory_paisa" integer NOT NULL DEFAULT 0,
  "total_deductions_paisa" integer NOT NULL DEFAULT 0,
  "total_net_paisa" integer NOT NULL DEFAULT 0,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "payment_journal_entry_id" uuid REFERENCES "journal_entries"("id") ON DELETE RESTRICT,
  "payment_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
  "payment_method" text,
  "paid_at" timestamp with time zone,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp with time zone,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamp with time zone,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_payroll_runs_pharmacy" ON "payroll_runs" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_payroll_runs_branch" ON "payroll_runs" ("branch_id");
CREATE INDEX IF NOT EXISTS "idx_payroll_runs_month" ON "payroll_runs" ("pharmacy_id", "month");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payroll_runs_number" ON "payroll_runs" ("pharmacy_id", "run_number");

-- 5. Individual Employee Payroll Items (Payslips)
CREATE TABLE IF NOT EXISTS "payroll_items" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "payroll_run_id" uuid NOT NULL REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "employee_code" text NOT NULL,
  "employee_name" text NOT NULL,
  "designation" text NOT NULL,
  "base_salary_paisa" integer NOT NULL,
  "working_days" integer NOT NULL DEFAULT 30,
  "attended_days" integer NOT NULL DEFAULT 30,
  "unpaid_leave_days" integer NOT NULL DEFAULT 0,
  "unpaid_leave_deduction_paisa" integer NOT NULL DEFAULT 0,
  "overtime_hours" integer NOT NULL DEFAULT 0,
  "overtime_amount_paisa" integer NOT NULL DEFAULT 0,
  "allowances_paisa" integer NOT NULL DEFAULT 0,
  "allowances_breakdown" text,
  "advance_recovery_paisa" integer NOT NULL DEFAULT 0,
  "advance_id" uuid REFERENCES "employee_advances"("id") ON DELETE SET NULL,
  "tax_paisa" integer NOT NULL DEFAULT 0,
  "statutory_deductions_paisa" integer NOT NULL DEFAULT 0,
  "statutory_breakdown" text,
  "gross_salary_paisa" integer NOT NULL,
  "total_deductions_paisa" integer NOT NULL,
  "net_salary_paisa" integer NOT NULL,
  "payment_status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_payroll_items_pharmacy" ON "payroll_items" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_payroll_items_run" ON "payroll_items" ("payroll_run_id");
CREATE INDEX IF NOT EXISTS "idx_payroll_items_employee" ON "payroll_items" ("employee_id");

-- 6. Immutability Trigger: Approved payroll items cannot be altered or deleted directly
CREATE OR REPLACE FUNCTION prevent_approved_payroll_item_modification()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM "payroll_runs" WHERE id = OLD.payroll_run_id;
    IF v_status IN ('approved', 'posted', 'paid') THEN
      RAISE EXCEPTION 'Approved payroll run items are immutable. Corrections must be made via an adjustment run.';
    END IF;
    RETURN OLD;
  ELSE
    SELECT status INTO v_status FROM "payroll_runs" WHERE id = NEW.payroll_run_id;
    IF v_status IN ('approved', 'posted', 'paid') THEN
      IF (OLD.base_salary_paisa IS DISTINCT FROM NEW.base_salary_paisa OR
          OLD.gross_salary_paisa IS DISTINCT FROM NEW.gross_salary_paisa OR
          OLD.net_salary_paisa IS DISTINCT FROM NEW.net_salary_paisa OR
          OLD.total_deductions_paisa IS DISTINCT FROM NEW.total_deductions_paisa OR
          OLD.unpaid_leave_deduction_paisa IS DISTINCT FROM NEW.unpaid_leave_deduction_paisa OR
          OLD.allowances_paisa IS DISTINCT FROM NEW.allowances_paisa OR
          OLD.overtime_amount_paisa IS DISTINCT FROM NEW.overtime_amount_paisa OR
          OLD.advance_recovery_paisa IS DISTINCT FROM NEW.advance_recovery_paisa OR
          OLD.tax_paisa IS DISTINCT FROM NEW.tax_paisa OR
          OLD.statutory_deductions_paisa IS DISTINCT FROM NEW.statutory_deductions_paisa) THEN
        RAISE EXCEPTION 'Approved payroll run items are immutable. Corrections must be made via an adjustment run.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payroll_items_immutable ON "payroll_items";
CREATE TRIGGER trg_payroll_items_immutable
BEFORE UPDATE OR DELETE ON "payroll_items"
FOR EACH ROW EXECUTE FUNCTION prevent_approved_payroll_item_modification();
