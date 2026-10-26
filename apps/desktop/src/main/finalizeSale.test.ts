import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { MIGRATIONS } from './db';
import { generateUuidV7, InsufficientStockError } from '@pos/shared';
import {
  finalizeSale,
  type FinalizeSaleInput,
  type FiscalService,
} from './finalizeSale';

describe('finalizeSale Transaction Service (Phase 2)', () => {
  let db: DatabaseInstance;
  let branchId: string;
  let counterId: string;
  let cashierUserId: string;
  let stdTaxCatId: string; // 18% standard
  let exemptTaxCatId: string; // 0% exempt
  let productAId: string; // Standard tax product
  let productBId: string; // Exempt tax product
  let batchA1Id: string; // Batch 1 for product A
  let batchA2Id: string; // Batch 2 for product A
  let batchAExpiredId: string; // Expired batch for product A
  let batchBId: string; // Batch for product B

  const TODAY = '2026-10-26';

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Run all migrations sequentially up to 5
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
    exemptTaxCatId = generateUuidV7();
    productAId = generateUuidV7();
    productBId = generateUuidV7();
    batchA1Id = generateUuidV7();
    batchA2Id = generateUuidV7();
    batchAExpiredId = generateUuidV7();
    batchBId = generateUuidV7();

    // 1. Branch
    db.prepare(
      'INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(branchId, 'Main Pharmacy', now, now);

    // 2. Counter with code 'C1' and last_invoice_seq 0
    db.prepare(
      'INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(counterId, branchId, 'Counter 1', 'C1', 0, now, now);

    // 3. Cashier User
    db.prepare(
      'INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(cashierUserId, 'Tariq Cashier', 'cashier', 'pin_mock', 1, now, now);

    // 4. Tax Categories: 18% standard, 0% exempt
    db.prepare(
      'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(stdTaxCatId, 'Standard 18%', 1800, 0, now, now);

    db.prepare(
      'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(exemptTaxCatId, 'Exempt', 0, 1, now, now);

    // 5. Products
    // Product A: Rs. 100.00 (10000 paisa), Standard 18% tax
    db.prepare(`
      INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer,
        barcode, tax_category_id, mrp_paisa, is_controlled, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productAId,
      'Panadol 500mg',
      'Paracetamol',
      '500mg',
      'Tablet',
      'GSK',
      '896400010001',
      stdTaxCatId,
      10000,
      0,
      1,
      now,
      now
    );

    // Product B: Rs. 50.00 (5000 paisa), Tax exempt
    db.prepare(`
      INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer,
        barcode, tax_category_id, mrp_paisa, is_controlled, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productBId,
      'ORS Sachet',
      'Oral Rehydration Salts',
      'Standard',
      'Powder',
      'Searle',
      '896400020002',
      exemptTaxCatId,
      5000,
      0,
      1,
      now,
      now
    );

    // 6. Batches for Product A:
    // Batch A-Expired: expired yesterday (2026-10-25)
    db.prepare(`
      INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batchAExpiredId, productAId, 'BATCH-EXP', '2026-10-25', 6000, 10000, now, now);

    // Batch A1: expires 2026-12-01 (earlier)
    db.prepare(`
      INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batchA1Id, productAId, 'BATCH-A1', '2026-12-01', 6000, 10000, now, now);

    // Batch A2: expires 2027-06-01 (later)
    db.prepare(`
      INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batchA2Id, productAId, 'BATCH-A2', '2027-06-01', 6000, 10000, now, now);

    // Batch B: expires 2027-12-31
    db.prepare(`
      INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batchBId, productBId, 'BATCH-B1', '2027-12-31', 3000, 5000, now, now);

    // Helper to add purchase stock movement
    const addStock = (batchIdParam: string, productIdParam: string, qty: number) => {
      db.prepare(`
        INSERT INTO stock_movements (
          id, product_id, batch_id, branch_id, type, quantity_signed,
          reference_type, reference_id, reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'purchase', ?, 'grn', 'init', 'Init Stock', ?, ?)
      `).run(
        generateUuidV7(),
        productIdParam,
        batchIdParam,
        branchId,
        qty,
        now,
        now
      );
    };

    // Initial stock setup:
    // Expired Batch A: 50 units (must NOT be used)
    addStock(batchAExpiredId, productAId, 50);
    // Batch A1: 5 units available
    addStock(batchA1Id, productAId, 5);
    // Batch A2: 15 units available
    addStock(batchA2Id, productAId, 15);
    // Batch B: 20 units available
    addStock(batchBId, productBId, 20);
  });

  it('single line sale: creates invoice, line, payment, negative stock movement, outbox and fiscal submission', () => {
    // Buy 2 units of Product A: 2 @ Rs. 100 = Rs. 200 (20000 paisa)
    // Tax 18% on 20000 = 3600 paisa
    // Total = 23600 paisa
    const input: FinalizeSaleInput = {
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId,
      lines: [{ productId: productAId, quantity: 2 }],
      payments: [{ method: 'cash', amountPaisa: 23600 }],
      notes: 'Customer order 1',
    };

    const invoice = finalizeSale(input, { db, today: TODAY });

    expect(invoice).toBeDefined();
    expect(invoice.invoiceNumber).toBe('C1-000001');
    expect(invoice.status).toBe('finalized');
    expect(invoice.subtotalPaisa).toBe(20000);
    expect(invoice.discountPaisa).toBe(0);
    expect(invoice.taxPaisa).toBe(3600);
    expect(invoice.totalPaisa).toBe(23600);
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]?.batchId).toBe(batchA1Id); // Allocated from earliest batch A1
    expect(invoice.lines[0]?.quantity).toBe(2);
    expect(invoice.lines[0]?.unitPricePaisa).toBe(10000);
    expect(invoice.lines[0]?.taxRateBp).toBe(1800);
    expect(invoice.lines[0]?.taxPaisa).toBe(3600);
    expect(invoice.lines[0]?.lineTotalPaisa).toBe(23600);

    // Verify counter sequence incremented to 1
    const counterRow = db
      .prepare('SELECT last_invoice_seq FROM counters WHERE id = ?')
      .get(counterId) as { last_invoice_seq: number };
    expect(counterRow.last_invoice_seq).toBe(1);

    // Verify negative stock movement created for the sale (Rule 4)
    const movements = db
      .prepare("SELECT * FROM stock_movements WHERE reference_id = ? AND type = 'sale'")
      .all(invoice.id) as { batch_id: string; quantity_signed: number }[];
    expect(movements).toHaveLength(1);
    expect(movements[0]?.batch_id).toBe(batchA1Id);
    expect(movements[0]?.quantity_signed).toBe(-2);

    // Stock for batch A1 started at 5, sold 2 -> balance is now 3
    const a1Stock = db
      .prepare('SELECT SUM(quantity_signed) as bal FROM stock_movements WHERE batch_id = ?')
      .get(batchA1Id) as { bal: number };
    expect(a1Stock.bal).toBe(3);

    // Verify outbox event logged
    const outboxRow = db
      .prepare("SELECT * FROM outbox WHERE event_type = 'invoice.created'")
      .get() as { payload: string };
    expect(outboxRow).toBeDefined();
    const payload = JSON.parse(outboxRow.payload);
    expect(payload.id).toBe(invoice.id);
    expect(payload.invoiceNumber).toBe('C1-000001');

    // Verify fiscal submission row exists with status 'not_required'
    const fiscalRow = db
      .prepare('SELECT * FROM fiscal_submissions WHERE invoice_id = ?')
      .get(invoice.id) as { status: string };
    expect(fiscalRow).toBeDefined();
    expect(fiscalRow.status).toBe('not_required');
  });

  it('multi-batch split: splits requested quantity across batches in FEFO order', () => {
    // Product A has: Batch A1 (5 avail), Batch A2 (15 avail).
    // Request 8 units: takes 5 from Batch A1, and 3 from Batch A2.
    // 8 @ Rs. 100 = 80000 paisa, Tax 18% = 14400 paisa, Total = 94400 paisa.
    const input: FinalizeSaleInput = {
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId,
      lines: [{ productId: productAId, quantity: 8 }],
      payments: [{ method: 'card', amountPaisa: 94400 }],
    };

    const invoice = finalizeSale(input, { db, today: TODAY });

    expect(invoice.invoiceNumber).toBe('C1-000001');
    expect(invoice.lines).toHaveLength(2);

    // Line 1: 5 units from Batch A1
    expect(invoice.lines[0]?.batchId).toBe(batchA1Id);
    expect(invoice.lines[0]?.quantity).toBe(5);
    expect(invoice.lines[0]?.lineTotalPaisa).toBe(50000 + 9000); // 59000

    // Line 2: 3 units from Batch A2
    expect(invoice.lines[1]?.batchId).toBe(batchA2Id);
    expect(invoice.lines[1]?.quantity).toBe(3);
    expect(invoice.lines[1]?.lineTotalPaisa).toBe(30000 + 5400); // 35400

    expect(invoice.totalPaisa).toBe(59000 + 35400); // 94400

    // Verify stock movements
    const movements = db
      .prepare('SELECT batch_id, quantity_signed FROM stock_movements WHERE reference_id = ? ORDER BY quantity_signed ASC')
      .all(invoice.id) as { batch_id: string; quantity_signed: number }[];
    expect(movements).toHaveLength(2);
    expect(movements).toEqual([
      { batch_id: batchA1Id, quantity_signed: -5 },
      { batch_id: batchA2Id, quantity_signed: -3 },
    ]);

    // Batch A1 is now completely depleted (balance = 0)
    const a1Stock = db
      .prepare('SELECT SUM(quantity_signed) as bal FROM stock_movements WHERE batch_id = ?')
      .get(batchA1Id) as { bal: number };
    expect(a1Stock.bal).toBe(0);

    // Batch A2 started at 15, sold 3 -> balance is now 12
    const a2Stock = db
      .prepare('SELECT SUM(quantity_signed) as bal FROM stock_movements WHERE batch_id = ?')
      .get(batchA2Id) as { bal: number };
    expect(a2Stock.bal).toBe(12);
  });

  it('expired batch not used: ignores batches expiring before today', () => {
    // Expired batch A has 50 units. Valid batches A1 and A2 have 5 and 15 (20 total).
    // If requesting 25 units, expired batch cannot be used -> throws InsufficientStockError!
    const input: FinalizeSaleInput = {
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId,
      lines: [{ productId: productAId, quantity: 25 }],
      payments: [{ method: 'cash', amountPaisa: 295000 }],
    };

    expect(() => finalizeSale(input, { db, today: TODAY })).toThrow(InsufficientStockError);

    // Verify expired batch was never touched (still 50)
    const expStock = db
      .prepare('SELECT SUM(quantity_signed) as bal FROM stock_movements WHERE batch_id = ?')
      .get(batchAExpiredId) as { bal: number };
    expect(expStock.bal).toBe(50);
  });

  it('insufficient stock rolls back everything: no invoice, no movements, no sequence increment', () => {
    const input: FinalizeSaleInput = {
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId,
      lines: [{ productId: productAId, quantity: 9999 }], // Exceeds all stock
      payments: [{ method: 'cash', amountPaisa: 1000000 }],
    };

    expect(() => finalizeSale(input, { db, today: TODAY })).toThrow(InsufficientStockError);

    // Verify 0 invoices created
    const invoiceCount = db.prepare('SELECT COUNT(*) as c FROM invoices').get() as { c: number };
    expect(invoiceCount.c).toBe(0);

    // Verify 0 lines created
    const lineCount = db.prepare('SELECT COUNT(*) as c FROM invoice_lines').get() as { c: number };
    expect(lineCount.c).toBe(0);

    // Verify 0 payments created
    const paymentCount = db.prepare('SELECT COUNT(*) as c FROM payments').get() as { c: number };
    expect(paymentCount.c).toBe(0);

    // Verify 0 sale stock movements created
    const saleMovements = db.prepare("SELECT COUNT(*) as c FROM stock_movements WHERE type = 'sale'").get() as { c: number };
    expect(saleMovements.c).toBe(0);

    // Verify counter sequence was NOT incremented (remains 0)
    const counterRow = db.prepare('SELECT last_invoice_seq FROM counters WHERE id = ?').get(counterId) as { last_invoice_seq: number };
    expect(counterRow.last_invoice_seq).toBe(0);
  });

  it('invoice numbers sequential across 50 rapid calls with zero gaps', () => {
    // Add plenty of stock to Batch B for 50 sales of 1 unit
    db.prepare(`
      INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type, quantity_signed,
        reference_type, reference_id, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'purchase', 100, 'grn', 'bulk', 'Bulk', '2026-10-26T10:00:00.000Z', '2026-10-26T10:00:00.000Z')
    `).run(generateUuidV7(), productBId, batchBId, branchId);

    const generatedNumbers: string[] = [];

    // Run 50 rapid sales
    for (let i = 1; i <= 50; i++) {
      const sale = finalizeSale(
        {
          clientRequestId: `rapid-call-${i}`,
          counterId,
          cashierUserId,
          lines: [{ productId: productBId, quantity: 1 }],
          payments: [{ method: 'cash', amountPaisa: 5000 }], // Exempt Rs. 50
        },
        { db, today: TODAY }
      );
      generatedNumbers.push(sale.invoiceNumber);
    }

    expect(generatedNumbers).toHaveLength(50);
    for (let i = 1; i <= 50; i++) {
      const expected = `C1-${String(i).padStart(6, '0')}`;
      expect(generatedNumbers[i - 1]).toBe(expected);
    }

    // Verify counter last_invoice_seq equals 50
    const counterRow = db
      .prepare('SELECT last_invoice_seq FROM counters WHERE id = ?')
      .get(counterId) as { last_invoice_seq: number };
    expect(counterRow.last_invoice_seq).toBe(50);
  });

  it('totals reconcile to the exact paisa (Rule 1 & Rule 9)', () => {
    // Product A: 3 units @ Rs. 100 = 30000 paisa, discount 500 paisa -> Net 29500 paisa
    // 18% Tax on 29500 = roundHalfUp(29500 * 1800 / 10000) = 5310 paisa -> Total = 34810
    // Product B: 2 units @ Rs. 50 = 10000 paisa, discount 200 paisa -> Net 9800 paisa
    // 0% Tax (exempt) -> Total = 9800
    // Invoice grand total = 34810 + 9800 = 44610 paisa
    const input: FinalizeSaleInput = {
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId,
      lines: [
        { productId: productAId, quantity: 3, discountPaisa: 500 },
        { productId: productBId, quantity: 2, discountPaisa: 200 },
      ],
      payments: [
        { method: 'cash', amountPaisa: 40000 },
        { method: 'card', amountPaisa: 4610 },
      ], // Split payment summing to 44610
    };

    const invoice = finalizeSale(input, { db, today: TODAY });

    expect(invoice.subtotalPaisa).toBe(40000); // Gross: 30000 + 10000
    expect(invoice.discountPaisa).toBe(700);
    expect(invoice.taxPaisa).toBe(5310);
    expect(invoice.totalPaisa).toBe(44610);
    expect(invoice.payments).toHaveLength(2);

    // Verify invariant: sum of line totals equals invoice totalPaisa
    const sumLineTotals = invoice.lines.reduce((s, l) => s + l.lineTotalPaisa, 0);
    expect(sumLineTotals).toBe(invoice.totalPaisa);
  });

  it('payments not matching total rejected and transaction rolled back', () => {
    // Total is Rs. 100 + 18% tax = 11800 paisa
    // Attempt with underpayment: 11000 paisa
    const underpayInput: FinalizeSaleInput = {
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId,
      lines: [{ productId: productAId, quantity: 1 }],
      payments: [{ method: 'cash', amountPaisa: 11000 }],
    };

    expect(() => finalizeSale(underpayInput, { db, today: TODAY })).toThrow(
      /Payment total.*does not match/
    );

    // Attempt with overpayment: 12000 paisa
    const overpayInput: FinalizeSaleInput = {
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId,
      lines: [{ productId: productAId, quantity: 1 }],
      payments: [{ method: 'cash', amountPaisa: 12000 }],
    };

    expect(() => finalizeSale(overpayInput, { db, today: TODAY })).toThrow(
      /Payment total.*does not match/
    );

    // Ensure zero invoices or sequence increment occurred
    const count = db.prepare('SELECT COUNT(*) as c FROM invoices').get() as { c: number };
    expect(count.c).toBe(0);
    const counterRow = db.prepare('SELECT last_invoice_seq FROM counters WHERE id = ?').get(counterId) as { last_invoice_seq: number };
    expect(counterRow.last_invoice_seq).toBe(0);
  });

  it('idempotency: same clientRequestId twice returns the same invoice and creates no extra rows', () => {
    const clientRequestId = 'client-idemp-unique-999';
    const input: FinalizeSaleInput = {
      clientRequestId,
      counterId,
      cashierUserId,
      lines: [{ productId: productAId, quantity: 1 }],
      payments: [{ method: 'cash', amountPaisa: 11800 }],
    };

    // First call
    const firstSale = finalizeSale(input, { db, today: TODAY });
    expect(firstSale.invoiceNumber).toBe('C1-000001');

    // Second call with same clientRequestId
    const secondSale = finalizeSale(input, { db, today: TODAY });

    expect(secondSale.id).toBe(firstSale.id);
    expect(secondSale.invoiceNumber).toBe(firstSale.invoiceNumber);
    expect(secondSale.totalPaisa).toBe(firstSale.totalPaisa);

    // Verify only ONE invoice, ONE line, ONE payment in the database
    const invCount = db.prepare('SELECT COUNT(*) as c FROM invoices').get() as { c: number };
    expect(invCount.c).toBe(1);

    const lineCount = db.prepare('SELECT COUNT(*) as c FROM invoice_lines').get() as { c: number };
    expect(lineCount.c).toBe(1);

    const payCount = db.prepare('SELECT COUNT(*) as c FROM payments').get() as { c: number };
    expect(payCount.c).toBe(1);

    // Verify stock movement was only deducted ONCE (quantity_signed = -1)
    const saleMovements = db
      .prepare("SELECT * FROM stock_movements WHERE type = 'sale'")
      .all() as { quantity_signed: number }[];
    expect(saleMovements).toHaveLength(1);
    expect(saleMovements[0]?.quantity_signed).toBe(-1);

    // Verify counter sequence was only incremented ONCE
    const counterRow = db.prepare('SELECT last_invoice_seq FROM counters WHERE id = ?').get(counterId) as { last_invoice_seq: number };
    expect(counterRow.last_invoice_seq).toBe(1);
  });

  it('stock balance invariant: final stock equals starting stock minus sold quantities after N sales', () => {
    // Starting stock for Product B: 20 units
    const startingStock = db
      .prepare('SELECT SUM(quantity_signed) as bal FROM stock_movements WHERE product_id = ?')
      .get(productBId) as { bal: number };
    expect(startingStock.bal).toBe(20);

    // Perform 3 sales: 4 units, 6 units, 3 units = 13 units sold total
    const salesQuantities = [4, 6, 3];
    let expectedTotalSold = 0;

    for (let i = 0; i < salesQuantities.length; i++) {
      const q = salesQuantities[i]!;
      expectedTotalSold += q;
      finalizeSale(
        {
          clientRequestId: `stock-invariant-${i}`,
          counterId,
          cashierUserId,
          lines: [{ productId: productBId, quantity: q }],
          payments: [{ method: 'cash', amountPaisa: q * 5000 }], // Exempt Rs. 50/unit
        },
        { db, today: TODAY }
      );
    }

    const finalStock = db
      .prepare('SELECT SUM(quantity_signed) as bal FROM stock_movements WHERE product_id = ?')
      .get(productBId) as { bal: number };

    // Invariant: finalStock === startingStock - totalSold (20 - 13 = 7)
    expect(finalStock.bal).toBe(startingStock.bal - expectedTotalSold);
    expect(finalStock.bal).toBe(7);
  });

  it('fiscal service resilience: a FiscalService error does not roll back the sale', () => {
    const errorFiscalService: FiscalService = {
      onInvoiceFinalized: vi.fn().mockImplementation(() => {
        throw new Error('Fiscal FBR offline / unreachable');
      }),
    };

    const input: FinalizeSaleInput = {
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId,
      lines: [{ productId: productBId, quantity: 1 }],
      payments: [{ method: 'cash', amountPaisa: 5000 }],
    };

    // Should complete successfully without throwing
    const invoice = finalizeSale(input, { db, fiscalService: errorFiscalService, today: TODAY });

    expect(invoice).toBeDefined();
    expect(invoice.totalPaisa).toBe(5000);
    expect(errorFiscalService.onInvoiceFinalized).toHaveBeenCalledTimes(1);

    // Verify invoice is saved in DB
    const saved = db.prepare('SELECT id FROM invoices WHERE id = ?').get(invoice.id);
    expect(saved).toBeDefined();
  });
});
