-- 1. Employees table
CREATE TABLE IF NOT EXISTS "employees" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE SET NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "employee_code" text NOT NULL,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "email" text,
  "phone" text,
  "designation" text NOT NULL,
  "department" text,
  "joining_date" text NOT NULL,
  "salary_paisa" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_employees_pharmacy" ON "employees" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_employees_branch" ON "employees" ("branch_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_employees_pharmacy_code" ON "employees" ("pharmacy_id", "employee_code");

-- 2. Leave Types (yearly entitlement & carry-over rules)
CREATE TABLE IF NOT EXISTS "leave_types" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "is_paid" boolean NOT NULL DEFAULT true,
  "yearly_entitlement_days" integer NOT NULL DEFAULT 0,
  "max_carry_over_days" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_leave_types_pharmacy" ON "leave_types" ("pharmacy_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_leave_types_pharmacy_code" ON "leave_types" ("pharmacy_id", "code");

-- 3. Leave Allocations & Yearly Balances
CREATE TABLE IF NOT EXISTS "leave_allocations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "leave_type_id" uuid NOT NULL REFERENCES "leave_types"("id") ON DELETE RESTRICT,
  "year" integer NOT NULL,
  "entitled_days" integer NOT NULL DEFAULT 0,
  "carried_over_days" integer NOT NULL DEFAULT 0,
  "manual_adjustment_days" integer NOT NULL DEFAULT 0,
  "used_days" integer NOT NULL DEFAULT 0,
  "pending_days" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_leave_allocations_pharmacy" ON "leave_allocations" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_leave_allocations_employee" ON "leave_allocations" ("employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_leave_allocations_emp_type_year" ON "leave_allocations" ("pharmacy_id", "employee_id", "leave_type_id", "year");

-- 4. Leave Requests (Manager approval workflow)
CREATE TABLE IF NOT EXISTS "leave_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "leave_type_id" uuid NOT NULL REFERENCES "leave_types"("id") ON DELETE RESTRICT,
  "start_date" text NOT NULL,
  "end_date" text NOT NULL,
  "days_count" integer NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "rejection_reason" text,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_leave_requests_pharmacy" ON "leave_requests" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_leave_requests_employee" ON "leave_requests" ("employee_id");
CREATE INDEX IF NOT EXISTS "idx_leave_requests_dates" ON "leave_requests" ("pharmacy_id", "start_date", "end_date");
CREATE INDEX IF NOT EXISTS "idx_leave_requests_status" ON "leave_requests" ("pharmacy_id", "status");

-- 5. Attendance Records (reflecting approved leaves)
CREATE TABLE IF NOT EXISTS "attendance_records" (
  "id" uuid PRIMARY KEY NOT NULL,
  "pharmacy_id" uuid NOT NULL REFERENCES "pharmacies"("id") ON DELETE RESTRICT,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE SET NULL,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "date" text NOT NULL,
  "status" text NOT NULL,
  "leave_request_id" uuid REFERENCES "leave_requests"("id") ON DELETE SET NULL,
  "check_in_time" text,
  "check_out_time" text,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_attendance_pharmacy" ON "attendance_records" ("pharmacy_id");
CREATE INDEX IF NOT EXISTS "idx_attendance_employee_date" ON "attendance_records" ("pharmacy_id", "employee_id", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_attendance_emp_date" ON "attendance_records" ("pharmacy_id", "employee_id", "date");

