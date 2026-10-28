import Database, {
  type Database as DatabaseInstance,
  type Statement,
  type Transaction,
} from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema';

export * from './db/schema';

export interface DbMetadata {
  dbPath: string;
  schemaVersion: number;
  journalMode: string;
  foreignKeys: boolean;
  migrationsApplied: number;
}

export interface MetaRow {
  key: string;
  value: string;
}

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseInstance) => void;
}

export interface BatchStockResult {
  batchId: string;
  productId: string;
  branchId: string;
  batchNo: string;
  expiryDate: string;
  brandName: string;
  genericName: string;
  costPaisa: number;
  mrpPaisa: number;
  balance: number;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '0001_initial_schema',
    up: (db: DatabaseInstance) => {
      // 1. Create single app_meta table
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      const insertMeta: Statement<[string, string]> = db.prepare<[string, string]>(`
        INSERT OR REPLACE INTO app_meta (key, value)
        VALUES (?, ?)
      `);

      const populateMetaTx: Transaction<(entries: [string, string][]) => void> = db.transaction(
        (entries: [string, string][]): void => {
          for (const [k, v] of entries) {
            insertMeta.run(k, v);
          }
        }
      );

      populateMetaTx([
        ['schema_version', '1'],
        ['initialized_at', new Date().toISOString()],
      ]);
    },
  },
  {
    version: 2,
    name: '0002_inventory_schema',
    up: (db: DatabaseInstance) => {
      // Create Phase 1 tables
      db.exec(`
        CREATE TABLE IF NOT EXISTS branches (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS counters (
          id TEXT PRIMARY KEY,
          branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('owner', 'pharmacist', 'cashier')),
          pin_hash TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          failed_login_attempts INTEGER NOT NULL DEFAULT 0,
          locked_until TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name ON users(name);

        CREATE TABLE IF NOT EXISTS tax_categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          rate_bp INTEGER NOT NULL,
          is_exempt INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY,
          brand_name TEXT NOT NULL,
          generic_name TEXT NOT NULL,
          strength TEXT NOT NULL,
          form TEXT NOT NULL,
          manufacturer TEXT NOT NULL,
          barcode TEXT UNIQUE,
          tax_category_id TEXT NOT NULL REFERENCES tax_categories(id) ON DELETE RESTRICT,
          mrp_paisa INTEGER NOT NULL,
          is_controlled INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
        CREATE INDEX IF NOT EXISTS idx_products_brand_name ON products(brand_name);
        CREATE INDEX IF NOT EXISTS idx_products_generic_name ON products(generic_name);

        CREATE TABLE IF NOT EXISTS suppliers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        -- Batches table: strictly NO direct quantity column (Rule 4)
        CREATE TABLE IF NOT EXISTS batches (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          batch_no TEXT NOT NULL,
          expiry_date TEXT NOT NULL,
          cost_paisa INTEGER NOT NULL,
          mrp_paisa INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_batches_expiry_date ON batches(expiry_date);
        CREATE INDEX IF NOT EXISTS idx_batches_product_batch ON batches(product_id, batch_no);

        -- Stock movements: all stock balance is the sum of quantity_signed (Rule 4)
        CREATE TABLE IF NOT EXISTS stock_movements (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
          branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
          type TEXT NOT NULL CHECK(type IN ('purchase', 'sale', 'return', 'adjustment', 'transfer_in', 'transfer_out')),
          quantity_signed INTEGER NOT NULL,
          reference_type TEXT,
          reference_id TEXT,
          reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_stock_movements_branch_batch ON stock_movements(branch_id, batch_id);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_branch_product ON stock_movements(branch_id, product_id);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at);

        -- View for aggregating stock by batch and branch
        CREATE VIEW IF NOT EXISTS view_batch_stock AS
        SELECT
          sm.branch_id,
          sm.batch_id,
          b.product_id,
          b.batch_no,
          b.expiry_date,
          b.cost_paisa,
          b.mrp_paisa,
          p.brand_name,
          p.generic_name,
          COALESCE(SUM(sm.quantity_signed), 0) AS balance
        FROM stock_movements sm
        INNER JOIN batches b ON sm.batch_id = b.id
        INNER JOIN products p ON b.product_id = p.id
        GROUP BY sm.branch_id, sm.batch_id;
      `);

      // Update schema_version in app_meta
      db.prepare(
        `
        INSERT OR REPLACE INTO app_meta (key, value)
        VALUES ('schema_version', '2')
      `
      ).run();
    },
  },
  {
    version: 3,
    name: '0003_purchases_and_outbox',
    up: (db: DatabaseInstance) => {
      // 1. Extend suppliers with contact info if not already present
      const existingCols = (
        db.prepare(`PRAGMA table_info(suppliers)`).all() as { name: string }[]
      ).map((c) => c.name);

      if (!existingCols.includes('contact_person')) {
        db.exec(`ALTER TABLE suppliers ADD COLUMN contact_person TEXT;`);
      }
      if (!existingCols.includes('phone')) {
        db.exec(`ALTER TABLE suppliers ADD COLUMN phone TEXT;`);
      }
      if (!existingCols.includes('email')) {
        db.exec(`ALTER TABLE suppliers ADD COLUMN email TEXT;`);
      }
      if (!existingCols.includes('address')) {
        db.exec(`ALTER TABLE suppliers ADD COLUMN address TEXT;`);
      }

      // 2. Purchases header table (Rule 1: integer total_cost_paisa)
      db.exec(`
        CREATE TABLE IF NOT EXISTS purchases (
          id TEXT PRIMARY KEY,
          branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
          supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
          supplier_invoice_no TEXT NOT NULL,
          invoice_date TEXT NOT NULL,
          total_cost_paisa INTEGER NOT NULL,
          created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_purchases_branch ON purchases(branch_id);
        CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
        CREATE INDEX IF NOT EXISTS idx_purchases_invoice_date ON purchases(invoice_date);

        -- 3. Purchase lines table (Rule 1: integer cost_paisa and mrp_paisa)
        CREATE TABLE IF NOT EXISTS purchase_lines (
          id TEXT PRIMARY KEY,
          purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
          product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
          batch_no TEXT NOT NULL,
          expiry_date TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK(quantity > 0),
          cost_paisa INTEGER NOT NULL,
          mrp_paisa INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_purchase_lines_purchase ON purchase_lines(purchase_id);
        CREATE INDEX IF NOT EXISTS idx_purchase_lines_product ON purchase_lines(product_id);
        CREATE INDEX IF NOT EXISTS idx_purchase_lines_batch ON purchase_lines(batch_id);

        -- 4. Outbox table for offline sync (Rule 5 & architecture)
        CREATE TABLE IF NOT EXISTS outbox (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          synced_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_outbox_synced_at ON outbox(synced_at);
      `);

      // Update schema_version in app_meta
      db.prepare(
        `
        INSERT OR REPLACE INTO app_meta (key, value)
        VALUES ('schema_version', '3')
      `
      ).run();
    },
  },
  {
    version: 4,
    name: '0004_invoices_and_sales',
    up: (db: DatabaseInstance) => {
      db.exec(`
        -- 1. Invoices table (Rule 1: integer paisa, Rule 3: immutable once finalized)
        CREATE TABLE IF NOT EXISTS invoices (
          id TEXT PRIMARY KEY,
          invoice_number TEXT UNIQUE NOT NULL,
          branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
          counter_id TEXT NOT NULL REFERENCES counters(id) ON DELETE RESTRICT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          customer_name TEXT,
          customer_phone TEXT,
          doctor_name TEXT,
          notes TEXT,
          subtotal_paisa INTEGER NOT NULL,
          discount_paisa INTEGER NOT NULL DEFAULT 0,
          tax_paisa INTEGER NOT NULL DEFAULT 0,
          grand_total_paisa INTEGER NOT NULL,
          paid_paisa INTEGER NOT NULL,
          change_paisa INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL CHECK(status IN ('finalized', 'cancelled', 'refunded')) DEFAULT 'finalized',
          fiscal_status TEXT NOT NULL CHECK(fiscal_status IN ('not_required', 'pending', 'submitted', 'failed')) DEFAULT 'not_required',
          fiscal_invoice_number TEXT,
          qr_payload TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
        CREATE INDEX IF NOT EXISTS idx_invoices_branch ON invoices(branch_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_counter ON invoices(counter_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);

        -- 2. Invoice lines table
        CREATE TABLE IF NOT EXISTS invoice_lines (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
          product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          batch_id TEXT REFERENCES batches(id) ON DELETE RESTRICT,
          batch_no TEXT,
          expiry_date TEXT,
          quantity INTEGER NOT NULL CHECK(quantity > 0),
          unit_price_paisa INTEGER NOT NULL,
          discount_bp INTEGER NOT NULL DEFAULT 0,
          discount_paisa INTEGER NOT NULL DEFAULT 0,
          tax_rate_bp INTEGER NOT NULL DEFAULT 0,
          tax_paisa INTEGER NOT NULL DEFAULT 0,
          line_total_paisa INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
        CREATE INDEX IF NOT EXISTS idx_invoice_lines_product ON invoice_lines(product_id);
        CREATE INDEX IF NOT EXISTS idx_invoice_lines_batch ON invoice_lines(batch_id);

        -- 3. Payments table
        CREATE TABLE IF NOT EXISTS payments (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
          payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'card', 'bank', 'other')),
          amount_paisa INTEGER NOT NULL,
          tendered_paisa INTEGER,
          change_paisa INTEGER,
          reference TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
      `);

      // Update schema_version in app_meta
      db.prepare(
        `
        INSERT OR REPLACE INTO app_meta (key, value)
        VALUES ('schema_version', '4')
      `
      ).run();
    },
  },
  {
    version: 5,
    name: '0005_invoices_schema_and_immutability',
    up: (db: DatabaseInstance) => {
      // 1. Add last_invoice_seq and unique code to counters if missing
      const counterCols = (
        db.prepare(`PRAGMA table_info(counters)`).all() as { name: string }[]
      ).map((c) => c.name);

      if (!counterCols.includes('last_invoice_seq')) {
        db.exec(`ALTER TABLE counters ADD COLUMN last_invoice_seq INTEGER NOT NULL DEFAULT 0;`);
      }
      if (!counterCols.includes('code')) {
        db.exec(`ALTER TABLE counters ADD COLUMN code TEXT;`);
        db.exec(`UPDATE counters SET code = 'C-' || substr(id, 1, 8) WHERE code IS NULL;`);
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_counters_code ON counters(code);`);
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_counters_default_code
          AFTER INSERT ON counters
          FOR EACH ROW
          WHEN NEW.code IS NULL
          BEGIN
            UPDATE counters SET code = 'C-' || substr(NEW.id, 1, 8) WHERE id = NEW.id;
          END;
        `);
      }

      // 2. Drop existing triggers and draft tables if they exist
      db.exec(`
        DROP TRIGGER IF EXISTS trg_invoices_no_update;
        DROP TRIGGER IF EXISTS trg_invoices_no_delete;
        DROP TRIGGER IF EXISTS trg_invoice_lines_no_update;
        DROP TRIGGER IF EXISTS trg_invoice_lines_no_delete;
        DROP TRIGGER IF EXISTS trg_payments_no_update;
        DROP TRIGGER IF EXISTS trg_payments_no_delete;

        DROP TABLE IF EXISTS payments;
        DROP TABLE IF EXISTS invoice_lines;
        DROP TABLE IF EXISTS invoices;
        DROP TABLE IF EXISTS fiscal_submissions;
      `);

      // 3. Create tables with exact Phase 2 schema
      db.exec(`
        -- Invoices: id (UUIDv7), counter_id, cashier_user_id, invoice_number (UNIQUE),
        -- client_request_id (UNIQUE), status ('finalized' only for now), subtotal_paisa,
        -- discount_paisa, tax_paisa, total_paisa, notes, created_at (UTC ISO).
        CREATE TABLE invoices (
          id TEXT PRIMARY KEY,
          counter_id TEXT NOT NULL REFERENCES counters(id) ON DELETE RESTRICT,
          cashier_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          invoice_number TEXT NOT NULL UNIQUE,
          client_request_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK(status IN ('finalized')) DEFAULT 'finalized',
          subtotal_paisa INTEGER NOT NULL,
          discount_paisa INTEGER NOT NULL DEFAULT 0,
          tax_paisa INTEGER NOT NULL DEFAULT 0,
          total_paisa INTEGER NOT NULL,
          notes TEXT,
          created_at TEXT NOT NULL
        );

        -- Invoice lines: id, invoice_id, product_id, batch_id, quantity (integer),
        -- unit_price_paisa, discount_paisa, tax_rate_bp, tax_paisa, line_total_paisa.
        CREATE TABLE invoice_lines (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
          product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          batch_id TEXT REFERENCES batches(id) ON DELETE RESTRICT,
          quantity INTEGER NOT NULL CHECK(quantity > 0),
          unit_price_paisa INTEGER NOT NULL,
          discount_paisa INTEGER NOT NULL DEFAULT 0,
          tax_rate_bp INTEGER NOT NULL DEFAULT 0,
          tax_paisa INTEGER NOT NULL DEFAULT 0,
          line_total_paisa INTEGER NOT NULL
        );

        -- Payments: id, invoice_id, method ('cash'|'card'|'wallet'), amount_paisa.
        CREATE TABLE payments (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
          method TEXT NOT NULL CHECK(method IN ('cash', 'card', 'wallet')),
          amount_paisa INTEGER NOT NULL
        );

        -- Fiscal submissions: id, invoice_id, status ('not_required'|'pending'|'submitted'|'failed'),
        -- fiscal_invoice_number NULL, qr_payload NULL, created_at, updated_at.
        -- (Fiscal data lives here so invoices stay fully immutable.)
        CREATE TABLE fiscal_submissions (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
          status TEXT NOT NULL CHECK(status IN ('not_required', 'pending', 'submitted', 'failed')) DEFAULT 'not_required',
          fiscal_invoice_number TEXT,
          qr_payload TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        -- Indexes on invoices(created_at), invoice_lines(invoice_id), invoice_lines(batch_id)
        CREATE INDEX idx_invoices_created_at ON invoices(created_at);
        CREATE INDEX idx_invoice_lines_invoice_id ON invoice_lines(invoice_id);
        CREATE INDEX idx_invoice_lines_batch_id ON invoice_lines(batch_id);
        CREATE INDEX idx_fiscal_submissions_invoice_id ON fiscal_submissions(invoice_id);

        -- SQLite triggers: BEFORE UPDATE and BEFORE DELETE on invoices, invoice_lines and payments
        -- that RAISE(ABORT, 'finalized records are immutable').
        CREATE TRIGGER trg_invoices_no_update
        BEFORE UPDATE ON invoices
        BEGIN
          SELECT RAISE(ABORT, 'finalized records are immutable');
        END;

        CREATE TRIGGER trg_invoices_no_delete
        BEFORE DELETE ON invoices
        BEGIN
          SELECT RAISE(ABORT, 'finalized records are immutable');
        END;

        CREATE TRIGGER trg_invoice_lines_no_update
        BEFORE UPDATE ON invoice_lines
        BEGIN
          SELECT RAISE(ABORT, 'finalized records are immutable');
        END;

        CREATE TRIGGER trg_invoice_lines_no_delete
        BEFORE DELETE ON invoice_lines
        BEGIN
          SELECT RAISE(ABORT, 'finalized records are immutable');
        END;

        CREATE TRIGGER trg_payments_no_update
        BEFORE UPDATE ON payments
        BEGIN
          SELECT RAISE(ABORT, 'finalized records are immutable');
        END;

        CREATE TRIGGER trg_payments_no_delete
        BEFORE DELETE ON payments
        BEGIN
          SELECT RAISE(ABORT, 'finalized records are immutable');
        END;
      `);

      // Update schema_version in app_meta
      db.prepare(
        `
        INSERT OR REPLACE INTO app_meta (key, value)
        VALUES ('schema_version', '5')
      `
      ).run();
    },
  },
  {
    version: 6,
    name: '0006_returns_and_shifts',
    up: (db: DatabaseInstance) => {
      // 1. Add last_credit_note_seq to counters if missing
      const counterCols = (
        db.prepare(`PRAGMA table_info(counters)`).all() as { name: string }[]
      ).map((c) => c.name);

      if (!counterCols.includes('last_credit_note_seq')) {
        db.exec(`ALTER TABLE counters ADD COLUMN last_credit_note_seq INTEGER NOT NULL DEFAULT 0;`);
      }

      // 2. Shifts table
      db.exec(`
        CREATE TABLE IF NOT EXISTS shifts (
          id TEXT PRIMARY KEY,
          branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
          counter_id TEXT NOT NULL REFERENCES counters(id) ON DELETE RESTRICT,
          cashier_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          status TEXT NOT NULL CHECK(status IN ('open', 'closed')) DEFAULT 'open',
          opened_at TEXT NOT NULL,
          closed_at TEXT,
          opening_cash_paisa INTEGER NOT NULL DEFAULT 0,
          counted_cash_paisa INTEGER,
          expected_cash_paisa INTEGER,
          difference_paisa INTEGER,
          sales_cash_paisa INTEGER NOT NULL DEFAULT 0,
          sales_card_paisa INTEGER NOT NULL DEFAULT 0,
          sales_wallet_paisa INTEGER NOT NULL DEFAULT 0,
          returns_cash_paisa INTEGER NOT NULL DEFAULT 0,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_shifts_counter ON shifts(counter_id);
        CREATE INDEX IF NOT EXISTS idx_shifts_branch ON shifts(branch_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_counter_open ON shifts(counter_id) WHERE status = 'open';
      `);

      // 3. Credit notes & Credit note lines tables
      db.exec(`
        CREATE TABLE IF NOT EXISTS credit_notes (
          id TEXT PRIMARY KEY,
          credit_note_number TEXT NOT NULL UNIQUE,
          original_invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
          branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
          counter_id TEXT NOT NULL REFERENCES counters(id) ON DELETE RESTRICT,
          cashier_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          client_request_id TEXT NOT NULL UNIQUE,
          subtotal_paisa INTEGER NOT NULL,
          tax_paisa INTEGER NOT NULL DEFAULT 0,
          total_paisa INTEGER NOT NULL,
          refund_method TEXT NOT NULL CHECK(refund_method IN ('cash', 'card', 'wallet', 'credit')) DEFAULT 'cash',
          reason TEXT NOT NULL CHECK(reason IN ('defective_damaged', 'expired', 'customer_return', 'dispensing_error', 'other')),
          notes TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_credit_notes_orig_inv ON credit_notes(original_invoice_id);
        CREATE INDEX IF NOT EXISTS idx_credit_notes_branch ON credit_notes(branch_id);
        CREATE INDEX IF NOT EXISTS idx_credit_notes_created_at ON credit_notes(created_at);

        CREATE TABLE IF NOT EXISTS credit_note_lines (
          id TEXT PRIMARY KEY,
          credit_note_id TEXT NOT NULL REFERENCES credit_notes(id) ON DELETE RESTRICT,
          original_invoice_line_id TEXT NOT NULL REFERENCES invoice_lines(id) ON DELETE RESTRICT,
          product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          batch_id TEXT REFERENCES batches(id) ON DELETE RESTRICT,
          quantity INTEGER NOT NULL CHECK(quantity > 0),
          unit_price_paisa INTEGER NOT NULL,
          tax_rate_bp INTEGER NOT NULL DEFAULT 0,
          tax_paisa INTEGER NOT NULL DEFAULT 0,
          line_total_paisa INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_credit_note_lines_cn ON credit_note_lines(credit_note_id);
        CREATE INDEX IF NOT EXISTS idx_credit_note_lines_orig_line ON credit_note_lines(original_invoice_line_id);

        -- Immutability triggers on credit notes and lines (Rule 3)
        CREATE TRIGGER IF NOT EXISTS trg_credit_notes_no_update
        BEFORE UPDATE ON credit_notes
        BEGIN
          SELECT RAISE(ABORT, 'credit notes are immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_credit_notes_no_delete
        BEFORE DELETE ON credit_notes
        BEGIN
          SELECT RAISE(ABORT, 'credit notes are immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_credit_note_lines_no_update
        BEFORE UPDATE ON credit_note_lines
        BEGIN
          SELECT RAISE(ABORT, 'credit notes are immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_credit_note_lines_no_delete
        BEFORE DELETE ON credit_note_lines
        BEGIN
          SELECT RAISE(ABORT, 'credit notes are immutable');
        END;
      `);

      // Update schema_version in app_meta
      db.prepare(
        `
        INSERT OR REPLACE INTO app_meta (key, value)
        VALUES ('schema_version', '6')
      `
      ).run();
    },
  },
  {
    version: 7,
    name: 'sync_client_tables_and_outbox_device_seq',
    up: (db: DatabaseInstance): void => {
      // 1. Ensure outbox has all Phase 3 columns (docs/SYNC_CLIENT.md)
      const existingCols = new Set(
        (db.pragma('table_info(outbox)') as Array<{ name: string }>).map((c) => c.name)
      );

      if (!existingCols.has('event_id')) {
        db.exec('ALTER TABLE outbox ADD COLUMN event_id TEXT;');
      }
      if (!existingCols.has('device_seq')) {
        db.exec('ALTER TABLE outbox ADD COLUMN device_seq INTEGER;');
      }
      if (!existingCols.has('type')) {
        db.exec('ALTER TABLE outbox ADD COLUMN type TEXT;');
      }
      if (!existingCols.has('entity_id')) {
        db.exec('ALTER TABLE outbox ADD COLUMN entity_id TEXT;');
      }
      if (!existingCols.has('occurred_at')) {
        db.exec('ALTER TABLE outbox ADD COLUMN occurred_at TEXT;');
      }
      if (!existingCols.has('status')) {
        db.exec("ALTER TABLE outbox ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';");
      }
      if (!existingCols.has('attempts')) {
        db.exec('ALTER TABLE outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;');
      }
      if (!existingCols.has('last_error')) {
        db.exec('ALTER TABLE outbox ADD COLUMN last_error TEXT;');
      }

      // 2. Backfill existing outbox rows: event_id = id, type = event_type, occurred_at = created_at
      db.exec(`
        UPDATE outbox SET event_id = id WHERE event_id IS NULL;
        UPDATE outbox SET type = event_type WHERE type IS NULL;
        UPDATE outbox SET occurred_at = created_at WHERE occurred_at IS NULL;
        UPDATE outbox SET status = CASE WHEN synced_at IS NOT NULL THEN 'acked' ELSE 'pending' END;
      `);

      // 3. Backfill device_seq contiguously in created order for any unsequenced rows
      const unsequencedRows = db
        .prepare(
          'SELECT id FROM outbox WHERE device_seq IS NULL ORDER BY created_at ASC, rowid ASC'
        )
        .all() as Array<{ id: string }>;

      const maxSeqRow = db
        .prepare('SELECT COALESCE(MAX(device_seq), 0) AS maxSeq FROM outbox')
        .get() as { maxSeq: number };
      let currentSeq = maxSeqRow.maxSeq;

      const updateSeqStmt = db.prepare('UPDATE outbox SET device_seq = ? WHERE id = ?');
      for (const row of unsequencedRows) {
        currentSeq++;
        updateSeqStmt.run(currentSeq, row.id);
      }

      // 4. Create UNIQUE index on device_seq and index on (status, device_seq)
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_device_seq ON outbox(device_seq);
        CREATE INDEX IF NOT EXISTS idx_outbox_status_device_seq ON outbox(status, device_seq);
      `);

      // 5. Create sync_state table (key/value) per docs/SYNC_CLIENT.md
      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_state (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);

      // Initialize default pull_cursor if not present
      db.prepare(
        `
        INSERT OR IGNORE INTO sync_state (key, value)
        VALUES ('pull_cursor', '0')
      `
      ).run();

      // 6. Create sync_exceptions table per docs/SYNC_CLIENT.md
      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_exceptions (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          code TEXT NOT NULL,
          message TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          note TEXT,
          created_at TEXT NOT NULL,
          resolved_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sync_exceptions_event_id ON sync_exceptions(event_id);
        CREATE INDEX IF NOT EXISTS idx_sync_exceptions_status ON sync_exceptions(status);
      `);

      // 7. Update schema_version in app_meta
      db.prepare(
        `
        INSERT OR REPLACE INTO app_meta (key, value)
        VALUES ('schema_version', '7')
      `
      ).run();
    },
  },
  {
    version: 8,
    name: '0008_user_lockout_and_unique_name',
    up: (db: DatabaseInstance): void => {
      const userCols = new Set(
        (db.pragma('table_info(users)') as Array<{ name: string }>).map((c) => c.name)
      );

      if (!userCols.has('failed_login_attempts')) {
        db.exec('ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;');
      }
      if (!userCols.has('locked_until')) {
        db.exec('ALTER TABLE users ADD COLUMN locked_until TEXT;');
      }

      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name ON users(name);');

      db.prepare(
        `
        INSERT OR REPLACE INTO app_meta (key, value)
        VALUES ('schema_version', '8')
      `
      ).run();
    },
  },
];

let dbInstance: DatabaseInstance | null = null;
let drizzleInstance: BetterSQLite3Database<typeof schema> | null = null;
let cachedMetadata: DbMetadata | null = null;

function resolveNativeBinding(): string | undefined {
  if (app && app.isPackaged) {
    const candidate = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'better-sqlite3',
      'prebuilds',
      `${process.platform}-${process.arch}.node`
    );
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function initDatabase(customPath?: string): DbMetadata {
  if (!customPath && cachedMetadata && dbInstance) {
    return cachedMetadata;
  }

  let dbPath = customPath;
  if (!dbPath) {
    if (app && typeof app.getPath === 'function') {
      const userDataDir = app.getPath('userData');
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }
      dbPath = path.join(userDataDir, 'pharmacy.db');
    } else if (process.env.APPDATA) {
      const userDataDir = path.join(process.env.APPDATA, 'HexaPharm');
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }
      dbPath = path.join(userDataDir, 'pharmacy.db');
    } else {
      // In unit test runner outside of Electron process
      dbPath = ':memory:';
    }
  }

  console.log(`[Database] Initializing SQLite database at: ${dbPath}`);

  const nativeBinding = resolveNativeBinding();
  if (nativeBinding) {
    console.log(`[Database] Using unpacked native binding: ${nativeBinding}`);
  }

  const db = new Database(dbPath, {
    nativeBinding,
  });

  // 1. Typed pragma: WAL mode (WAL does not apply to in-memory databases)
  const isMemory = dbPath === ':memory:';
  const journalResult = isMemory
    ? 'memory'
    : (db.pragma('journal_mode = WAL', { simple: true }) as string);
  console.log(`[Database] Journal mode: ${journalResult}`);

  // 2. Typed pragma: Foreign keys
  db.pragma('foreign_keys = ON');
  const fkResult = db.pragma('foreign_keys', { simple: true }) as number;
  const foreignKeysEnabled = fkResult === 1;
  console.log(`[Database] Foreign keys enabled: ${foreignKeysEnabled}`);

  // 2b. Startup Integrity Check (Phase 5)
  const integrityResult = db.pragma('integrity_check', { simple: true }) as string;
  if (integrityResult !== 'ok') {
    console.error(`[Database] FATAL: PRAGMA integrity_check failed: ${integrityResult}`);
    throw new Error(
      `SQLite Database Integrity Failure: PRAGMA integrity_check returned '${integrityResult}'`
    );
  }
  console.log('[Database] PRAGMA integrity_check: ok');

  // 3. Migration tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const getAppliedMigrations: Statement<[], { version: number }> = db.prepare<
    [],
    { version: number }
  >('SELECT version FROM schema_migrations ORDER BY version ASC');
  const appliedRows = getAppliedMigrations.all();
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  let newlyApplied = 0;
  const insertMigration: Statement<[number, string, string]> = db.prepare<[number, string, string]>(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  );

  const runMigrationTx: Transaction<(m: Migration) => void> = db.transaction(
    (m: Migration): void => {
      console.log(`[Database] Applying migration ${m.version}: ${m.name}`);
      m.up(db);
      insertMigration.run(m.version, m.name, new Date().toISOString());
    }
  );

  for (const migration of MIGRATIONS) {
    if (!appliedVersions.has(migration.version)) {
      runMigrationTx(migration);
      newlyApplied++;
    }
  }

  // Read schema version from app_meta
  const getMetaStmt: Statement<[string], MetaRow> = db.prepare<[string], MetaRow>(
    'SELECT key, value FROM app_meta WHERE key = ?'
  );
  const versionRow = getMetaStmt.get('schema_version');
  const schemaVersion = versionRow ? parseInt(versionRow.value, 10) : 0;
  console.log(
    `[Database] Current schema version: ${schemaVersion} (${newlyApplied} applied this run)`
  );

  dbInstance = db;
  drizzleInstance = drizzle(db, { schema });

  cachedMetadata = {
    dbPath,
    schemaVersion,
    journalMode: journalResult,
    foreignKeys: foreignKeysEnabled,
    migrationsApplied: MIGRATIONS.length,
  };

  return cachedMetadata;
}

export function getDatabase(): DatabaseInstance {
  if (!dbInstance) {
    initDatabase();
  }
  return dbInstance!;
}

export function setDatabaseForTesting(db: DatabaseInstance): void {
  dbInstance = db;
  drizzleInstance = drizzle(db, { schema });
}

export function getDrizzle(): BetterSQLite3Database<typeof schema> {
  if (!drizzleInstance) {
    initDatabase();
  }
  return drizzleInstance!;
}

export function getDbMetadata(): DbMetadata {
  if (!cachedMetadata) {
    return initDatabase();
  }
  return cachedMetadata;
}

export function getDbPath(): string {
  if (cachedMetadata) {
    return cachedMetadata.dbPath;
  }
  if (app && typeof app.getPath === 'function') {
    return path.join(app.getPath('userData'), 'pharmacy.db');
  } else if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'HexaPharm', 'pharmacy.db');
  }
  return ':memory:';
}

export function closeDatabase(): void {
  if (dbInstance && dbInstance.open) {
    console.log('[Database] Closing active SQLite connection...');
    dbInstance.close();
  }
  dbInstance = null;
  drizzleInstance = null;
  cachedMetadata = null;
}

/**
 * Computes the real-time stock balance for each batch in a given branch.
 * Stock balance is strictly computed as the sum of signed stock_movements (Rule 4).
 */
export function getStockByBatch(
  branchId: string,
  drizzleDb?: BetterSQLite3Database<typeof schema>
): BatchStockResult[] {
  const db = drizzleDb ?? getDrizzle();

  const rows = db
    .select({
      batchId: schema.batches.id,
      productId: schema.batches.productId,
      branchId: schema.stockMovements.branchId,
      batchNo: schema.batches.batchNo,
      expiryDate: schema.batches.expiryDate,
      costPaisa: schema.batches.costPaisa,
      mrpPaisa: schema.batches.mrpPaisa,
      brandName: schema.products.brandName,
      genericName: schema.products.genericName,
      balance: sql<number>`COALESCE(SUM(${schema.stockMovements.quantitySigned}), 0)`.mapWith(
        Number
      ),
    })
    .from(schema.stockMovements)
    .innerJoin(schema.batches, eq(schema.stockMovements.batchId, schema.batches.id))
    .innerJoin(schema.products, eq(schema.batches.productId, schema.products.id))
    .where(eq(schema.stockMovements.branchId, branchId))
    .groupBy(
      schema.stockMovements.branchId,
      schema.stockMovements.batchId,
      schema.batches.id,
      schema.products.id
    )
    .all();

  return rows;
}
