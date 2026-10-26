import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { MIGRATIONS } from './db';
import { generateUuidV7 } from '@pos/shared';
import {
  searchInvoices,
  getInvoiceById,
  roleGuardedFinalizeSale,
} from './invoices';
import {
  generateThermalReceiptHtml,
  type ReceiptInvoiceData,
} from '../renderer/utils/receiptGenerator';
import { getReceiptStrings } from '../renderer/utils/receiptTranslations';
import { printReceiptHtml } from './printService';
import { setSessionForTesting } from './auth';

describe('Prompt 2.4: Payments, Receipts, and Invoice History', () => {
  let db: DatabaseInstance;
  let branchId: string;
  let counterId: string;
  let cashierUserId: string;
  let stdTaxCatId: string;
  let productId: string;
  let batchId: string;

  const TODAY = '2026-10-26';

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Run migrations 1 through 5
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

    const now = '2026-10-26T10:00:00.000Z';
    branchId = generateUuidV7();
    counterId = generateUuidV7();
    cashierUserId = generateUuidV7();
    stdTaxCatId = generateUuidV7();
    productId = generateUuidV7();
    batchId = generateUuidV7();

    // 1. Branch
    db.prepare(
      'INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(branchId, 'Gulshan Branch', now, now);

    // 2. Counter
    db.prepare(
      'INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(counterId, branchId, 'Counter 1', 'C1', 0, now, now);

    // 3. User
    db.prepare(
      'INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(cashierUserId, 'Hamza Cashier', 'cashier', 'mock_hash', 1, now, now);

    // 4. Tax Category: 18%
    db.prepare(
      'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(stdTaxCatId, 'Standard GST 18%', 1800, 0, now, now);

    // 5. Product: Rs. 100.00 (10000 paisa)
    db.prepare(`
      INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer,
        barcode, tax_category_id, mrp_paisa, is_controlled, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId,
      'Augmentin 625mg',
      'Amoxicillin + Clavulanic',
      '625mg',
      'Tablet',
      'GSK',
      '896400099999',
      stdTaxCatId,
      10000,
      0,
      1,
      now,
      now
    );

    // 6. Batch: 500 units
    db.prepare(`
      INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batchId, productId, 'AUG-2027A', '2027-11-30', 8000, 10000, now, now);

    // 7. Initial purchase movement
    db.prepare(`
      INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type,
        quantity_signed, reference_type, reference_id,
        reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'purchase', 500, 'test_ref', 'seed', 'Initial batch stock', ?, ?)
    `).run(generateUuidV7(), productId, batchId, branchId, now, now);

    // Setup active session for role-guarded calls
    setSessionForTesting({
      user: {
        id: cashierUserId,
        name: 'Hamza Cashier',
        role: 'cashier',
        isActive: true,
      },
      branch: {
        id: branchId,
        name: 'Gulshan Branch',
      },
      counter: {
        id: counterId,
        name: 'Counter 1',
      },
      idleTimeoutMinutes: 15,
      isLocked: false,
    });
  });

  it('generates complete 80mm thermal receipt HTML with batch/expiry toggle, split payments, and fiscal box', () => {
    const mockInvoiceData: ReceiptInvoiceData = {
      id: generateUuidV7(),
      invoiceNumber: 'C1-000001',
      createdAt: '2026-10-26T14:30:00.000Z',
      subtotalPaisa: 20000,
      discountPaisa: 0,
      taxPaisa: 3600,
      totalPaisa: 23600,
      notes: 'Customer: Ahmad Khan | Phone: 03001234567',
      customerName: 'Ahmad Khan',
      cashierName: 'Hamza Cashier',
      counterName: 'Counter 1',
      branchName: 'Gulshan Branch',
      branchAddress: 'Block 4, Gulshan-e-Iqbal, Karachi',
      lines: [
        {
          id: 'l1',
          brandName: 'Augmentin 625mg',
          genericName: 'Amoxicillin + Clavulanic',
          batchNo: 'AUG-2027A',
          expiryDate: '2027-11-30',
          quantity: 2,
          unitPricePaisa: 10000,
          lineTotalPaisa: 23600,
        },
      ],
      payments: [
        { method: 'cash', amountPaisa: 13600, tenderedPaisa: 15000, changePaisa: 1400 },
        { method: 'card', amountPaisa: 10000 },
      ],
    };

    // 1. With batch & expiry enabled (default)
    const htmlWithBatch = generateThermalReceiptHtml(mockInvoiceData, { showBatchExpiry: true });
    expect(htmlWithBatch).toContain('C1-000001');
    expect(htmlWithBatch).toContain('Augmentin 625mg');
    expect(htmlWithBatch).toContain('Batch: AUG-2027A');
    expect(htmlWithBatch).toContain('Exp: 2027-11-30');
    expect(htmlWithBatch).toContain('Rs. 236.00'); // Total
    expect(htmlWithBatch).toContain('Cash');
    expect(htmlWithBatch).toContain('Card');
    expect(htmlWithBatch).toContain('Rs. 14.00'); // Change due (1400 paisa)
    expect(htmlWithBatch).toContain('FBR FISCAL INVOICE');
    expect(htmlWithBatch).toContain('QR Code Space Reserved');

    // 2. With batch & expiry toggled OFF
    const htmlWithoutBatch = generateThermalReceiptHtml(mockInvoiceData, { showBatchExpiry: false });
    expect(htmlWithoutBatch).not.toContain('Batch: AUG-2027A');
    expect(htmlWithoutBatch).toContain('Augmentin 625mg');

    // 3. Urdu dictionary verification (Rule 10)
    const urduStrings = getReceiptStrings('ur');
    expect(urduStrings.invoiceHeading).toBe('کیش / سیلز میمو');
    expect(urduStrings.grandTotal).toBe('میزانِ کل');
    expect(urduStrings.fiscalHeading).toBe('ایف بی آر انوائس');

    const htmlUrdu = generateThermalReceiptHtml(mockInvoiceData, { locale: 'ur' });
    expect(htmlUrdu).toContain('dir="rtl"');
    expect(htmlUrdu).toContain('میزانِ کل');
  });

  it('finalizes a sale via roleGuardedFinalizeSale with split payments and persists to DB', async () => {
    // 2 units of Augmentin: 2 * 10000 + 18% tax = 23600 paisa
    // Split payment: Cash Rs. 136.00 (13600 paisa) + Card Rs. 100.00 (10000 paisa) = exactly 23600 paisa
    const finalized = await roleGuardedFinalizeSale(
      {
        clientRequestId: generateUuidV7(),
        lines: [{ productId, quantity: 2, discountPaisa: 0 }],
        payments: [
          { method: 'cash', amountPaisa: 13600 },
          { method: 'card', amountPaisa: 10000 },
        ],
        notes: 'Split payment customer purchase',
      },
      db
    );

    expect(finalized).toBeDefined();
    expect(finalized.invoiceNumber).toBe('C1-000001');
    expect(finalized.totalPaisa).toBe(23600);
    expect(finalized.payments).toHaveLength(2);
    expect(finalized.payments[0]?.method).toBe('cash');
    expect(finalized.payments[0]?.amountPaisa).toBe(13600);
    expect(finalized.payments[1]?.method).toBe('card');
    expect(finalized.payments[1]?.amountPaisa).toBe(10000);

    // Verify persisted in DB
    const invInDb = db.prepare('SELECT id, invoice_number, total_paisa FROM invoices WHERE id = ?').get(finalized.id) as {
      id: string;
      invoice_number: string;
      total_paisa: number;
    };
    expect(invInDb.invoice_number).toBe('C1-000001');
    expect(invInDb.total_paisa).toBe(23600);

    // Verify 2 payments in DB
    const payRows = db.prepare('SELECT * FROM payments WHERE invoice_id = ?').all(finalized.id);
    expect(payRows).toHaveLength(2);
  });

  it('searches invoices by number and date range and loads single invoice with all details', async () => {
    // Finalize 3 sales
    for (let i = 1; i <= 3; i++) {
      await roleGuardedFinalizeSale(
        {
          clientRequestId: `search-test-${i}-${generateUuidV7()}`,
          lines: [{ productId, quantity: 1, discountPaisa: 0 }],
          payments: [{ method: 'cash', amountPaisa: 11800 }], // 10000 + 18% tax
          notes: i === 2 ? 'VIP Customer Dr. Arshad' : `Customer ${i}`,
        },
        db
      );
    }

    // 1. Search all invoices for this branch
    const allInvoices = searchInvoices(branchId, {}, db);
    expect(allInvoices).toHaveLength(3);

    // 2. Search by invoice number query
    const searchByNum = searchInvoices(branchId, { query: '000002' }, db);
    expect(searchByNum).toHaveLength(1);
    expect(searchByNum[0]?.invoiceNumber).toBe('C1-000002');
    expect(searchByNum[0]?.lines).toHaveLength(1);
    expect(searchByNum[0]?.lines?.[0]?.brandName).toBe('Augmentin 625mg');

    // 3. Search by notes/customer query
    const searchByNotes = searchInvoices(branchId, { query: 'Arshad' }, db);
    expect(searchByNotes).toHaveLength(1);
    expect(searchByNotes[0]?.notes).toContain('Arshad');

    // 4. Search by date filter
    const searchByDate = searchInvoices(
      branchId,
      { dateFrom: TODAY, dateTo: TODAY },
      db
    );
    expect(searchByDate).toHaveLength(3);

    // 5. getInvoiceById loads full line details and payments
    const targetId = allInvoices[0]!.id;
    const fullInvoice = getInvoiceById(targetId, db);
    expect(fullInvoice).not.toBeNull();
    expect(fullInvoice?.id).toBe(targetId);
    expect(fullInvoice?.lines).toHaveLength(1);
    expect(fullInvoice?.lines?.[0]?.batchNo).toBe('AUG-2027A');
    expect(fullInvoice?.lines?.[0]?.expiryDate).toBe('2027-11-30');
    expect(fullInvoice?.payment?.paymentMethod).toBe('cash');
  });

  it('printReceiptHtml executes gracefully and returns success in test environment', async () => {
    const result = await printReceiptHtml('<html><body>Test Thermal Print</body></html>');
    expect(result.success).toBe(true);
  });
});
