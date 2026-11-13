-- Migration 0024: Multi-Tenant Row Level Security (RLS) & Branch/Role Policies

-- 1. Helper Functions for Tenant, Role, and Branch Resolution
CREATE OR REPLACE FUNCTION "public".current_tenant_pharmacy_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_pharmacy_id', true), '')::uuid,
    NULLIF((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'pharmacy_id'), '')::uuid
  );
$$;

CREATE OR REPLACE FUNCTION "public".current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_user_role', true), ''),
    NULLIF((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '')
  );
$$;

CREATE OR REPLACE FUNCTION "public".current_branch_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_branch_id', true), '')::uuid,
    NULLIF((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'branch_id'), '')::uuid
  );
$$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION "public".current_tenant_pharmacy_id() TO authenticated;
    GRANT EXECUTE ON FUNCTION "public".current_user_role() TO authenticated;
    GRANT EXECUTE ON FUNCTION "public".current_branch_id() TO authenticated;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION "public".current_tenant_pharmacy_id() TO service_role;
    GRANT EXECUTE ON FUNCTION "public".current_user_role() TO service_role;
    GRANT EXECUTE ON FUNCTION "public".current_branch_id() TO service_role;
  END IF;
END $$;

-- 2. Tenant Tables: pharmacies and branches
ALTER TABLE pharmacies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_pharmacy_policy ON pharmacies;
CREATE POLICY tenant_pharmacy_policy ON pharmacies
  FOR ALL
  USING (id = "public".current_tenant_pharmacy_id())
  WITH CHECK (id = "public".current_tenant_pharmacy_id());

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_branch_policy ON branches;
CREATE POLICY tenant_branch_policy ON branches
  FOR ALL
  USING (
    pharmacy_id = "public".current_tenant_pharmacy_id() AND
    (
      "public".current_branch_id() IS NULL OR
      "public".current_user_role() IN ('owner', 'manager') OR
      id = "public".current_branch_id()
    )
  )
  WITH CHECK (
    pharmacy_id = "public".current_tenant_pharmacy_id() AND
    (
      "public".current_branch_id() IS NULL OR
      "public".current_user_role() IN ('owner', 'manager') OR
      id = "public".current_branch_id()
    )
  );

-- 3. Branch-Scoped Tables (with branch_id column)
DO $$
DECLARE
  tbl text;
  branch_tables text[] := ARRAY[
    'counters',
    'devices',
    'device_registration_codes',
    'stock_movements',
    'stock_locations',
    'product_reorder_levels',
    'stock_alerts',
    'stock_counts'
  ];
BEGIN
  FOREACH tbl IN ARRAY branch_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS branch_scoped_policy ON %I;', tbl);
    EXECUTE format('
      CREATE POLICY branch_scoped_policy ON %I
        FOR ALL
              USING (
          pharmacy_id = "public".current_tenant_pharmacy_id() AND
          (
            "public".current_branch_id() IS NULL OR
            "public".current_user_role() IN (''owner'', ''manager'') OR
            branch_id IS NULL OR
            branch_id = "public".current_branch_id()
          )
        )
        WITH CHECK (
          pharmacy_id = "public".current_tenant_pharmacy_id() AND
          (
            "public".current_branch_id() IS NULL OR
            "public".current_user_role() IN (''owner'', ''manager'') OR
            branch_id IS NULL OR
            branch_id = "public".current_branch_id()
          )
        );
    ', tbl);
  END LOOP;
END $$;

-- 3b. Inter-Branch Stock Transfers Table
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_transfers_branch_policy ON stock_transfers;
CREATE POLICY stock_transfers_branch_policy ON stock_transfers
  FOR ALL
  USING (
    pharmacy_id = "public".current_tenant_pharmacy_id() AND
    (
      "public".current_branch_id() IS NULL OR
      "public".current_user_role() IN ('owner', 'manager') OR
      source_branch_id = "public".current_branch_id() OR
      destination_branch_id = "public".current_branch_id()
    )
  )
  WITH CHECK (
    pharmacy_id = "public".current_tenant_pharmacy_id() AND
    (
      "public".current_branch_id() IS NULL OR
      "public".current_user_role() IN ('owner', 'manager') OR
      source_branch_id = "public".current_branch_id() OR
      destination_branch_id = "public".current_branch_id()
    )
  );

-- 4. Role-Scoped Sensitive Financial & Audit Tables (Owner, Accountant, Manager)
DO $$
DECLARE
  tbl text;
  finance_tables text[] := ARRAY[
    'accounts',
    'pharmacy_account_mappings',
    'journal_entries',
    'journal_lines',
    'fiscal_periods',
    'budgets',
    'bank_accounts',
    'bank_reconciliations',
    'fund_transfers',
    'payroll_runs',
    'payroll_items',
    'payroll_tax_slabs',
    'payroll_statutory_components',
    'employee_advances',
    'audit_logs'
  ];
BEGIN
  FOREACH tbl IN ARRAY finance_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS role_scoped_finance_policy ON %I;', tbl);
    EXECUTE format('
      CREATE POLICY role_scoped_finance_policy ON %I
        FOR ALL
              USING (
          pharmacy_id = "public".current_tenant_pharmacy_id() AND
          "public".current_user_role() IN (''owner'', ''accountant'', ''manager'')
        )
        WITH CHECK (
          pharmacy_id = "public".current_tenant_pharmacy_id() AND
          "public".current_user_role() IN (''owner'', ''accountant'', ''manager'')
        );
    ', tbl);
  END LOOP;
END $$;

-- 5. General Tenant-Scoped Tables
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'users',
    'tax_categories',
    'customers',
    'products',
    'batches',
    'invoices',
    'invoice_lines',
    'payments',
    'credit_notes',
    'credit_note_lines',
    'stock_transfer_lines',
    'stock_count_lines',
    'suppliers',
    'purchase_orders',
    'purchase_order_lines',
    'purchase_order_receipts',
    'supplier_returns',
    'supplier_return_lines',
    'payment_allocations',
    'payment_reminders',
    'expense_categories',
    'erp_expenses',
    'recurring_expenses',
    'counter_deposits',
    'prescriptions',
    'prescription_items',
    'prescription_access_logs',
    'leave_types',
    'leave_allocations',
    'leave_requests',
    'attendance_records',
    'employees',
    'change_log',
    'processed_events',
    'rejected_events',
    'user_notifications'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I;', tbl);
    EXECUTE format('
      CREATE POLICY tenant_isolation_policy ON %I
        FOR ALL
              USING (pharmacy_id = "public".current_tenant_pharmacy_id())
        WITH CHECK (pharmacy_id = "public".current_tenant_pharmacy_id());
    ', tbl);
  END LOOP;
END $$;

-- 6. Token Revocation Table (Service Role Only)
ALTER TABLE revoked_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS revoked_tokens_service_role_policy ON revoked_tokens;
CREATE POLICY revoked_tokens_service_role_policy ON revoked_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
