import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { MIGRATIONS } from './db';
import { generateUuidV7 } from '@pos/shared';

describe('Invoices Schema & Immutability Triggers (Phase 2)', () => {
  let db: DatabaseInstance;
  let branchId: string;
  let counterId: string;
  let cashierUserId: string;
  let taxCategoryId: string;
  let productId: string;
  let batchId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Run all migrations sequentially up to current
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const m of MIGRATIONS) {
      m.up(db);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
      ).run(m.version, m.name, new Date().toISOString());
    }

    const now = new Date().toISOString();
    branchId = generateUuidV7();
    counterId = generateUuidV7();
    cashierUserId = generateUuidV7();
    taxCategoryId = generateUuidV7();
    productId = generateUuidV7();
    batchId = generateUuidV7();

    // Seed branch, counter, user, product, batch
    db.prepare(
      'INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(branchId, 'Main Branch', now, now);

    db.prepare(
      'INSERT INTO counters (id, branch_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(counterId, branchId, 'Counter 1', now, now);

    db.prepare(
      'INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(cashierUserId, 'Test Cashier', 'cashier', 'hash', 1, now, now);

    db.prepare(
      'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(taxCategoryId, 'Standard 18%', 1800, 0, now, now);

    db.prepare(`
      INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer,
        barcode, tax_category_id, mrp_paisa, is_controlled, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId,
      'Panadol 500mg',
      'Paracetamol',
      '500mg',
      'Tablet',
      'GSK',
      '8964000111222',
      taxCategoryId,
      5000,
      0,
      1,
      now,
      now
    );

    db.prepare(`
      INSERT INTO batches (
        id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batchId, productId, 'B-PAN-01', '2027-12-31', 3500, 5000, now, now);
  });

  describe('Counter enhancements (last_invoice_seq & code)', () => {
    it('sets last_invoice_seq default to 0 and assigns a unique code', () => {
      const counterRow = db
        .prepare('SELECT id, name, last_invoice_seq, code FROM counters WHERE id = ?')
        .get(counterId) as { id: string; name: string; last_invoice_seq: number; code: string };

      expect(counterRow).toBeDefined();
      expect(counterRow.last_invoice_seq).toBe(0);
      expect(typeof counterRow.code).toBe('string');
      expect(counterRow.code.length).toBeGreaterThan(0);
    });

    it('enforces unique constraint on counter code', () => {
      const now = new Date().toISOString();
      const newCounterId = generateUuidV7();

      // Attempt inserting with duplicate counter code
      expect(() => {
        db.prepare(
          'INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(newCounterId, branchId, 'Counter 2', 'C-DUPLICATE', 0, now, now);

        db.prepare(
          'INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(generateUuidV7(), branchId, 'Counter 3', 'C-DUPLICATE', 0, now, now);
      }).toThrow(/UNIQUE constraint failed: counters\.code/);
    });
  });

  describe('Inserting works for all Phase 2 tables', () => {
    it('successfully inserts records into invoices, invoice_lines, payments, and fiscal_submissions', () => {
      const invoiceId = generateUuidV7();
      const lineId = generateUuidV7();
      const paymentId = generateUuidV7();
      const fiscalId = generateUuidV7();
      const now = new Date().toISOString();

      // 1. Invoices
      db.prepare(`
        INSERT INTO invoices (
          id, counter_id, cashier_user_id, invoice_number, client_request_id,
          status, subtotal_paisa, discount_paisa, tax_paisa, total_paisa, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        invoiceId,
        counterId,
        cashierUserId,
        'INV-20261026-0001',
        'req-client-001',
        'finalized',
        10000,
        1000,
        1620,
        10620,
        'Customer note',
        now
      );

      // 2. Invoice Lines
      db.prepare(`
        INSERT INTO invoice_lines (
          id, invoice_id, product_id, batch_id, quantity,
          unit_price_paisa, discount_paisa, tax_rate_bp, tax_paisa, line_total_paisa
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        lineId,
        invoiceId,
        productId,
        batchId,
        2,
        5000,
        1000,
        1800,
        1620,
        10620
      );

      // 3. Payments
      db.prepare(`
        INSERT INTO payments (id, invoice_id, method, amount_paisa)
        VALUES (?, ?, ?, ?)
      `).run(paymentId, invoiceId, 'cash', 10620);

      // 4. Fiscal Submissions
      db.prepare(`
        INSERT INTO fiscal_submissions (
          id, invoice_id, status, fiscal_invoice_number, qr_payload, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(fiscalId, invoiceId, 'not_required', null, null, now, now);

      // Verify persisted rows
      const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as {
        invoice_number: string;
        client_request_id: string;
        total_paisa: number;
        status: string;
      };
      expect(inv.invoice_number).toBe('INV-20261026-0001');
      expect(inv.client_request_id).toBe('req-client-001');
      expect(inv.total_paisa).toBe(10620);
      expect(inv.status).toBe('finalized');

      const line = db.prepare('SELECT * FROM invoice_lines WHERE id = ?').get(lineId) as {
        quantity: number;
        line_total_paisa: number;
      };
      expect(line.quantity).toBe(2);
      expect(line.line_total_paisa).toBe(10620);

      const pay = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as {
        method: string;
        amount_paisa: number;
      };
      expect(pay.method).toBe('cash');
      expect(pay.amount_paisa).toBe(10620);

      const fiscal = db.prepare('SELECT * FROM fiscal_submissions WHERE id = ?').get(fiscalId) as {
        status: string;
        fiscal_invoice_number: string | null;
      };
      expect(fiscal.status).toBe('not_required');
      expect(fiscal.fiscal_invoice_number).toBeNull();
    });
  });

  describe('Uniqueness constraints', () => {
    it('rejects duplicate invoice_number', () => {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO invoices (
          id, counter_id, cashier_user_id, invoice_number, client_request_id,
          status, subtotal_paisa, discount_paisa, tax_paisa, total_paisa, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateUuidV7(),
        counterId,
        cashierUserId,
        'INV-UNIQUE-TEST',
        'req-client-001',
        'finalized',
        1000,
        0,
        0,
        1000,
        now
      );

      expect(() => {
        db.prepare(`
          INSERT INTO invoices (
            id, counter_id, cashier_user_id, invoice_number, client_request_id,
            status, subtotal_paisa, discount_paisa, tax_paisa, total_paisa, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateUuidV7(),
          counterId,
          cashierUserId,
          'INV-UNIQUE-TEST', // Duplicate
          'req-client-002',
          'finalized',
          1000,
          0,
          0,
          1000,
          now
        );
      }).toThrow(/UNIQUE constraint failed: invoices\.invoice_number/);
    });

    it('rejects duplicate client_request_id', () => {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO invoices (
          id, counter_id, cashier_user_id, invoice_number, client_request_id,
          status, subtotal_paisa, discount_paisa, tax_paisa, total_paisa, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateUuidV7(),
        counterId,
        cashierUserId,
        'INV-REQ-1',
        'client-idempotent-key',
        'finalized',
        1000,
        0,
        0,
        1000,
        now
      );

      expect(() => {
        db.prepare(`
          INSERT INTO invoices (
            id, counter_id, cashier_user_id, invoice_number, client_request_id,
            status, subtotal_paisa, discount_paisa, tax_paisa, total_paisa, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateUuidV7(),
          counterId,
          cashierUserId,
          'INV-REQ-2',
          'client-idempotent-key', // Duplicate client_request_id
          'finalized',
          1000,
          0,
          0,
          1000,
          now
        );
      }).toThrow(/UNIQUE constraint failed: invoices\.client_request_id/);
    });
  });

  describe('Immutability triggers on invoices, invoice_lines, and payments', () => {
    let invoiceId: string;
    let lineId: string;
    let paymentId: string;

    beforeEach(() => {
      invoiceId = generateUuidV7();
      lineId = generateUuidV7();
      paymentId = generateUuidV7();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO invoices (
          id, counter_id, cashier_user_id, invoice_number, client_request_id,
          status, subtotal_paisa, discount_paisa, tax_paisa, total_paisa, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        invoiceId,
        counterId,
        cashierUserId,
        'INV-IMMUTABLE-01',
        'req-imm-001',
        'finalized',
        5000,
        0,
        0,
        5000,
        'Notes',
        now
      );

      db.prepare(`
        INSERT INTO invoice_lines (
          id, invoice_id, product_id, batch_id, quantity,
          unit_price_paisa, discount_paisa, tax_rate_bp, tax_paisa, line_total_paisa
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(lineId, invoiceId, productId, batchId, 1, 5000, 0, 0, 0, 5000);

      db.prepare(`
        INSERT INTO payments (id, invoice_id, method, amount_paisa)
        VALUES (?, ?, ?, ?)
      `).run(paymentId, invoiceId, 'cash', 5000);
    });

    it('UPDATE on invoices fails with "finalized records are immutable"', () => {
      expect(() => {
        db.prepare('UPDATE invoices SET notes = ? WHERE id = ?').run('Tampered', invoiceId);
      }).toThrowError(/finalized records are immutable/);
    });

    it('DELETE on invoices fails with "finalized records are immutable"', () => {
      expect(() => {
        db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);
      }).toThrowError(/finalized records are immutable/);
    });

    it('UPDATE on invoice_lines fails with "finalized records are immutable"', () => {
      expect(() => {
        db.prepare('UPDATE invoice_lines SET quantity = 999 WHERE id = ?').run(lineId);
      }).toThrowError(/finalized records are immutable/);
    });

    it('DELETE on invoice_lines fails with "finalized records are immutable"', () => {
      expect(() => {
        db.prepare('DELETE FROM invoice_lines WHERE id = ?').run(lineId);
      }).toThrowError(/finalized records are immutable/);
    });

    it('UPDATE on payments fails with "finalized records are immutable"', () => {
      expect(() => {
        db.prepare('UPDATE payments SET amount_paisa = 0 WHERE id = ?').run(paymentId);
      }).toThrowError(/finalized records are immutable/);
    });

    it('DELETE on payments fails with "finalized records are immutable"', () => {
      expect(() => {
        db.prepare('DELETE FROM payments WHERE id = ?').run(paymentId);
      }).toThrowError(/finalized records are immutable/);
    });
  });

  describe('Fiscal submissions mutability', () => {
    it('allows rows in fiscal_submissions to be updated without violating immutability', () => {
      const invoiceId = generateUuidV7();
      const fiscalId = generateUuidV7();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO invoices (
          id, counter_id, cashier_user_id, invoice_number, client_request_id,
          status, subtotal_paisa, discount_paisa, tax_paisa, total_paisa, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        invoiceId,
        counterId,
        cashierUserId,
        'INV-FISCAL-TEST',
        'req-fiscal-001',
        'finalized',
        2500,
        0,
        0,
        2500,
        now
      );

      db.prepare(`
        INSERT INTO fiscal_submissions (
          id, invoice_id, status, fiscal_invoice_number, qr_payload, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(fiscalId, invoiceId, 'pending', null, null, now, now);

      // Now update the fiscal submission row to 'submitted'
      const later = new Date(Date.now() + 1000).toISOString();
      db.prepare(`
        UPDATE fiscal_submissions
        SET status = ?, fiscal_invoice_number = ?, qr_payload = ?, updated_at = ?
        WHERE id = ?
      `).run('submitted', 'FBR-INV-998877', 'https://fbr.gov.pk/qr/mock', later, fiscalId);

      const updated = db
        .prepare('SELECT * FROM fiscal_submissions WHERE id = ?')
        .get(fiscalId) as {
        status: string;
        fiscal_invoice_number: string;
        qr_payload: string;
        updated_at: string;
      };

      expect(updated.status).toBe('submitted');
      expect(updated.fiscal_invoice_number).toBe('FBR-INV-998877');
      expect(updated.qr_payload).toBe('https://fbr.gov.pk/qr/mock');
      expect(updated.updated_at).toBe(later);
    });
  });
});
