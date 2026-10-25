import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { MIGRATIONS, setDatabaseForTesting } from './db';
import { createInvoice, getRecentInvoices, roleGuardedCreateInvoice } from './invoices';
import { setSessionForTesting, logout, AuthError } from './auth';
import { generateUuidV7, type AuthSession, type CreateInvoiceInput } from '@pos/shared';

describe('Invoice Creation & Database Persistence (Phase 2)', () => {
  let rawDb: DatabaseInstance;
  let testSession: AuthSession;
  let branchId: string;
  let counterId: string;
  let userId: string;
  let taxCatId: string;
  let productId: string;
  let batchId: string;

  beforeEach(() => {
    logout();
    rawDb = new Database(':memory:');
    rawDb.pragma('foreign_keys = ON');

    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const m of MIGRATIONS) {
      m.up(rawDb);
      rawDb
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, new Date().toISOString());
    }

    setDatabaseForTesting(rawDb);

    // Setup base entities
    branchId = generateUuidV7();
    counterId = generateUuidV7();
    userId = generateUuidV7();
    taxCatId = generateUuidV7();
    productId = generateUuidV7();
    batchId = generateUuidV7();
    const now = new Date().toISOString();

    rawDb.prepare('INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      branchId,
      'Main Branch',
      now,
      now
    );

    rawDb.prepare('INSERT INTO counters (id, branch_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      counterId,
      branchId,
      'Counter 1',
      now,
      now
    );

    rawDb.prepare('INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      userId,
      'Cashier Ali',
      'cashier',
      'pin_mock_hash',
      1,
      now,
      now
    );

    rawDb.prepare('INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      taxCatId,
      'Standard 18%',
      1800,
      0,
      now,
      now
    );

    rawDb.prepare(`
      INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer,
        barcode, tax_category_id, mrp_paisa, is_controlled, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId,
      'Augmentin 625mg',
      'Amoxicillin + Clavulanic Acid',
      '625mg',
      'tablet',
      'GSK',
      '8964000999999',
      taxCatId,
      12000, // Rs. 120.00
      0,
      1,
      now,
      now
    );

    rawDb.prepare(`
      INSERT INTO batches (
        id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      batchId,
      productId,
      'BATCH-AUG-01',
      '2027-06-30',
      8000,
      12000,
      now,
      now
    );

    // Initial stock: 100 units through a purchase movement
    rawDb.prepare(`
      INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type, quantity_signed,
        reference_type, reference_id, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateUuidV7(),
      productId,
      batchId,
      branchId,
      'purchase',
      100, // +100 units
      'test_grn',
      'init',
      'Initial stock',
      now,
      now
    );

    testSession = {
      user: { id: userId, name: 'Cashier Ali', role: 'cashier', isActive: true },
      branch: { id: branchId, name: 'Main Branch' },
      counter: { id: counterId, name: 'Counter 1' },
      isLocked: false,
      idleTimeoutMinutes: 5,
    };

    setSessionForTesting(testSession);
  });

  it('creates invoice, lines, payment, stock deductions, and outbox event in ONE transaction', () => {
    const input: CreateInvoiceInput = {
      customerName: 'Muhammad Usman',
      customerPhone: '0300-1122334',
      doctorName: 'Dr. Tariq',
      notes: 'Take with food',
      paymentMethod: 'cash',
      tenderedPaisa: 30000, // Rs. 300 cash tendered
      lines: [
        {
          productId,
          batchId,
          batchNo: 'BATCH-AUG-01',
          expiryDate: '2027-06-30',
          quantity: 2, // 2 units @ Rs. 120 = Rs. 240
          unitPricePaisa: 12000,
          discountType: 'percent',
          discountBp: 1000, // 10% discount = Rs. 24 off -> Net Rs. 216 (21600 paisa)
          taxRateBp: 1800, // 18% tax on 21600 = 3888 paisa
          isTaxExempt: false,
        },
      ],
    };

    const invoice = createInvoice(input, testSession, rawDb);

    expect(invoice).toBeDefined();
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{8}-0001$/);
    expect(invoice.customerName).toBe('Muhammad Usman');
    expect(invoice.lines).toHaveLength(1);

    // Monetary checks (Rule 1: integer paisa)
    // Net: 21600, Tax: 3888 -> Grand Total: 25488 paisa (Rs. 254.88)
    expect(invoice.subtotalPaisa).toBe(21600);
    expect(invoice.discountPaisa).toBe(2400);
    expect(invoice.taxPaisa).toBe(3888);
    expect(invoice.grandTotalPaisa).toBe(25488);
    expect(invoice.paidPaisa).toBe(25488);
    expect(invoice.changePaisa).toBe(30000 - 25488); // 4512 paisa (Rs. 45.12 change)

    // Verify Invoices table row
    const invoiceRow = rawDb.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id) as {
      status: string;
      grand_total_paisa: number;
    };
    expect(invoiceRow).toBeDefined();
    expect(invoiceRow.status).toBe('finalized');
    expect(invoiceRow.grand_total_paisa).toBe(25488);

    // Verify Invoice lines table row
    const lines = rawDb.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?').all(invoice.id);
    expect(lines).toHaveLength(1);

    // Verify Payments table row
    const payment = rawDb.prepare('SELECT * FROM payments WHERE invoice_id = ?').get(invoice.id) as {
      payment_method: string;
      amount_paisa: number;
      change_paisa: number;
    };
    expect(payment.payment_method).toBe('cash');
    expect(payment.amount_paisa).toBe(25488);
    expect(payment.change_paisa).toBe(4512);

    // Verify Outbox table row (Rule 5 & 7)
    const outboxRow = rawDb.prepare('SELECT * FROM outbox WHERE event_type = ?').get('invoice.created') as {
      payload: string;
      synced_at: string | null;
    };
    expect(outboxRow).toBeDefined();
    expect(outboxRow.synced_at).toBeNull();
    const payload = JSON.parse(outboxRow.payload);
    expect(payload.id).toBe(invoice.id);
    expect(payload.invoiceNumber).toBe(invoice.invoiceNumber);

    // Verify Stock Movement deduction (Rule 4: sum of movements)
    const stockRow = rawDb
      .prepare('SELECT SUM(quantity_signed) as balance FROM stock_movements WHERE batch_id = ?')
      .get(batchId) as { balance: number };
    // Started at 100, sold 2 -> balance must be exactly 98!
    expect(stockRow.balance).toBe(98);
  });

  it('rejects cash payment when tendered amount is less than grand total', () => {
    const input: CreateInvoiceInput = {
      paymentMethod: 'cash',
      tenderedPaisa: 5000, // Rs. 50 (insufficient for Rs. 120 product)
      lines: [
        {
          productId,
          batchId,
          quantity: 1,
          unitPricePaisa: 12000,
          discountType: 'none',
          discountBp: 0,
          flatDiscountPaisa: 0,
          taxRateBp: 0,
          isTaxExempt: true,
        },
      ],
    };

    expect(() => createInvoice(input, testSession, rawDb)).toThrow(/Insufficient cash tendered/);

    // Verify nothing was written to invoices or stock movements
    const invoiceCount = rawDb.prepare('SELECT COUNT(*) as c FROM invoices').get() as { c: number };
    expect(invoiceCount.c).toBe(0);

    const stock = rawDb
      .prepare('SELECT SUM(quantity_signed) as balance FROM stock_movements WHERE batch_id = ?')
      .get(batchId) as { balance: number };
    expect(stock.balance).toBe(100);
  });

  it('sequential invoice numbers increment per branch', () => {
    const baseInput: CreateInvoiceInput = {
      paymentMethod: 'card',
      lines: [
        {
          productId,
          batchId,
          quantity: 1,
          unitPricePaisa: 1000,
          discountType: 'none',
          discountBp: 0,
          flatDiscountPaisa: 0,
          taxRateBp: 0,
          isTaxExempt: true,
        },
      ],
    };

    const inv1 = createInvoice(baseInput, testSession, rawDb);
    const inv2 = createInvoice(baseInput, testSession, rawDb);

    expect(inv1.invoiceNumber).toMatch(/-0001$/);
    expect(inv2.invoiceNumber).toMatch(/-0002$/);
  });

  it('retrieves recent invoices with lines and payments', () => {
    const baseInput: CreateInvoiceInput = {
      customerName: 'Customer Test',
      paymentMethod: 'bank',
      lines: [
        {
          productId,
          batchId,
          quantity: 1,
          unitPricePaisa: 2500,
          discountType: 'none',
          discountBp: 0,
          flatDiscountPaisa: 0,
          taxRateBp: 0,
          isTaxExempt: true,
        },
      ],
    };

    createInvoice(baseInput, testSession, rawDb);
    const recents = getRecentInvoices(branchId, 10, rawDb);

    expect(recents).toHaveLength(1);
    expect(recents[0]?.customerName).toBe('Customer Test');
    expect(recents[0]?.payment?.paymentMethod).toBe('bank');
    expect(recents[0]?.lines).toHaveLength(1);
    expect(recents[0]?.lines?.[0]?.brandName).toBe('Augmentin 625mg');
  });

  it('enforces role guarding on invoice creation', async () => {
    // Valid roles: cashier, pharmacist, owner
    await expect(
      roleGuardedCreateInvoice(
        {
          paymentMethod: 'cash',
          lines: [
            {
              productId,
              quantity: 1,
              unitPricePaisa: 1000,
              discountType: 'none',
              discountBp: 0,
              flatDiscountPaisa: 0,
              taxRateBp: 0,
              isTaxExempt: true,
            },
          ],
        },
        rawDb
      )
    ).resolves.toHaveProperty('grandTotalPaisa', 1000);

    // Invalid role: logged out (unauthenticated)
    logout();
    await expect(
      roleGuardedCreateInvoice(
        {
          paymentMethod: 'cash',
          lines: [
            {
              productId,
              quantity: 1,
              unitPricePaisa: 1000,
              discountType: 'none',
              discountBp: 0,
              flatDiscountPaisa: 0,
              taxRateBp: 0,
              isTaxExempt: true,
            },
          ],
        },
        rawDb
      )
    ).rejects.toThrow(AuthError);
  });
});
