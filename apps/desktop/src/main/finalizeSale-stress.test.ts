import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { MIGRATIONS } from './db';
import {
  generateUuidV7,
  InsufficientStockError,
  computeInvoiceTotals,
  roundHalfUp,
} from '@pos/shared';
import {
  finalizeSale,
  type FinalizeSaleInput,
  type FinalizeSaleLineInput,
} from './finalizeSale';

describe('finalizeSale Stress & Failure Tests (Phase 2)', () => {
  let db: DatabaseInstance;
  let branchId: string;
  let counterId: string;
  let cashierUserId: string;
  let stdTaxCatId: string; // 18% standard tax
  let exemptTaxCatId: string; // 0% exempt
  let product1Id: string; // Standard 18% tax, MRP 100.00 PKR (10,000 paisa)
  let product2Id: string; // Exempt 0% tax, MRP 50.00 PKR (5,000 paisa)
  let batch1Id: string; // Prod 1, earliest expiry
  let batch2Id: string; // Prod 1, middle expiry
  let batch3Id: string; // Prod 1, latest expiry
  let batch4Id: string; // Prod 2, earliest expiry
  let batch5Id: string; // Prod 2, later expiry

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
    exemptTaxCatId = generateUuidV7();
    product1Id = generateUuidV7();
    product2Id = generateUuidV7();
    batch1Id = generateUuidV7();
    batch2Id = generateUuidV7();
    batch3Id = generateUuidV7();
    batch4Id = generateUuidV7();
    batch5Id = generateUuidV7();

    // 1. Branch
    db.prepare(
      'INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(branchId, 'Main Branch', now, now);

    // 2. Counter with code 'C1' and last_invoice_seq 0
    db.prepare(
      'INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(counterId, branchId, 'Counter 1', 'C1', 0, now, now);

    // 3. Active Cashier
    db.prepare(
      'INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(cashierUserId, 'Asif Cashier', 'cashier', 'pin_mock', 1, now, now);

    // 4. Tax Categories: 18% standard, 0% exempt
    db.prepare(
      'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(stdTaxCatId, 'Standard 18%', 1800, 0, now, now);

    db.prepare(
      'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(exemptTaxCatId, 'Exempt', 0, 1, now, now);

    // 5. Products
    // Product 1: Taxable 18%, MRP 10,000 paisa
    db.prepare(`
      INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer,
        barcode, tax_category_id, mrp_paisa, is_controlled, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      product1Id,
      'Amoxil 500mg',
      'Amoxicillin',
      '500mg',
      'Capsule',
      'GSK',
      '896400010001',
      stdTaxCatId,
      10000,
      0,
      1,
      now,
      now
    );

    // Product 2: Exempt 0%, MRP 5,000 paisa
    db.prepare(`
      INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer,
        barcode, tax_category_id, mrp_paisa, is_controlled, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      product2Id,
      'Panadol Drops',
      'Paracetamol',
      '100mg/ml',
      'Drops',
      'GSK',
      '896400010002',
      exemptTaxCatId,
      5000,
      0,
      1,
      now,
      now
    );

    // 6. Batches
    // Product 1 batches: 1000 units each across 3 batches
    db.prepare(`
      INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batch1Id, product1Id, 'B1-202701', '2027-01-01', 8000, 10000, now, now);

    db.prepare(`
      INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batch2Id, product1Id, 'B2-202706', '2027-06-01', 8000, 10000, now, now);

    db.prepare(`
      INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batch3Id, product1Id, 'B3-202712', '2027-12-01', 8000, 10000, now, now);

    // Product 2 batches: 800 units each across 2 batches
    db.prepare(`
      INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batch4Id, product2Id, 'B4-202612', '2026-12-01', 4000, 5000, now, now);

    db.prepare(`
      INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batch5Id, product2Id, 'B5-202703', '2027-03-01', 4000, 5000, now, now);

    // 7. Initial Stock Movements (purchase receiving)
    const initialBatches = [
      { batchId: batch1Id, prodId: product1Id, qty: 1000 },
      { batchId: batch2Id, prodId: product1Id, qty: 1000 },
      { batchId: batch3Id, prodId: product1Id, qty: 1000 },
      { batchId: batch4Id, prodId: product2Id, qty: 800 },
      { batchId: batch5Id, prodId: product2Id, qty: 800 },
    ];

    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type,
        quantity_signed, reference_type, reference_id,
        reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'purchase', ?, 'test_seed', ?, 'Initial stock', ?, ?)
    `);

    for (const b of initialBatches) {
      insertMovement.run(
        generateUuidV7(),
        b.prodId,
        b.batchId,
        branchId,
        b.qty,
        'seed-ref',
        now,
        now
      );
    }
  });

  it('1. Stress: 200 sales in a loop with random quantities - stock balances, payment totals, and contiguous invoice numbers', () => {
    const startingStock: Record<string, number> = {
      [batch1Id]: 1000,
      [batch2Id]: 1000,
      [batch3Id]: 1000,
      [batch4Id]: 800,
      [batch5Id]: 800,
    };

    const soldPerBatch: Record<string, number> = {
      [batch1Id]: 0,
      [batch2Id]: 0,
      [batch3Id]: 0,
      [batch4Id]: 0,
      [batch5Id]: 0,
    };

    let totalExpectedPaymentsPaisa = 0;
    const generatedInvoiceNumbers: string[] = [];

    // Deterministic pseudo-random generation across 200 iterations
    for (let i = 0; i < 200; i++) {
      const q1 = ((i * 17 + 3) % 5) + 1; // 1 to 5 units of Product 1
      const q2 = ((i * 31 + 7) % 4) + 1; // 1 to 4 units of Product 2

      // Compute expected totals using shared utilities
      const totals = computeInvoiceTotals([
        {
          unitPricePaisa: 10000,
          quantity: q1,
          taxRateBp: 1800,
          isTaxExempt: false,
        },
        {
          unitPricePaisa: 5000,
          quantity: q2,
          taxRateBp: 0,
          isTaxExempt: true,
        },
      ]);

      totalExpectedPaymentsPaisa += totals.grandTotalPaisa;

      // Alternate payment methods: split payments or single payment
      const clientRequestId = `stress-req-${i + 1}-${generateUuidV7()}`;
      let payments: { method: 'cash' | 'card' | 'wallet'; amountPaisa: number }[];

      if (i % 3 === 0) {
        // Split cash and card
        const cashAmount = roundHalfUp(totals.grandTotalPaisa, 2);
        const cardAmount = totals.grandTotalPaisa - cashAmount;
        payments = [
          { method: 'cash', amountPaisa: cashAmount },
          { method: 'card', amountPaisa: cardAmount },
        ];
      } else if (i % 3 === 1) {
        payments = [{ method: 'card', amountPaisa: totals.grandTotalPaisa }];
      } else {
        payments = [{ method: 'wallet', amountPaisa: totals.grandTotalPaisa }];
      }

      const input: FinalizeSaleInput = {
        clientRequestId,
        counterId,
        cashierUserId,
        lines: [
          { productId: product1Id, quantity: q1 },
          { productId: product2Id, quantity: q2 },
        ],
        payments,
        notes: `Sale loop index ${i}`,
      };

      const invoice = finalizeSale(input, { db, today: TODAY });

      generatedInvoiceNumbers.push(invoice.invoiceNumber);

      // Track batch allocations
      for (const line of invoice.lines) {
        if (line.batchId) {
          const currentSold = soldPerBatch[line.batchId];
          if (currentSold !== undefined) {
            soldPerBatch[line.batchId] = currentSold + line.quantity;
          }
        }
      }
    }

    // A. Verify stock per batch equals starting stock minus sold
    const allBatches = [batch1Id, batch2Id, batch3Id, batch4Id, batch5Id];
    for (const bId of allBatches) {
      const stockRow = db
        .prepare('SELECT SUM(quantity_signed) as bal FROM stock_movements WHERE batch_id = ?')
        .get(bId) as { bal: number };

      const expectedBal = startingStock[bId]! - soldPerBatch[bId]!;
      expect(stockRow.bal).toBe(expectedBal);
      expect(stockRow.bal).toBeGreaterThanOrEqual(0); // Never negative stock
    }

    // B. Verify sum of payments equals sum of invoice totals
    const sumPaymentsRow = db
      .prepare('SELECT SUM(amount_paisa) as totalPaid FROM payments')
      .get() as { totalPaid: number };

    const sumInvoicesRow = db
      .prepare('SELECT SUM(total_paisa) as totalInvoiced FROM invoices')
      .get() as { totalInvoiced: number };

    expect(sumPaymentsRow.totalPaid).toBe(totalExpectedPaymentsPaisa);
    expect(sumInvoicesRow.totalInvoiced).toBe(totalExpectedPaymentsPaisa);
    expect(sumPaymentsRow.totalPaid).toBe(sumInvoicesRow.totalInvoiced);

    // C. Verify invoice numbers are contiguous
    const countRow = db
      .prepare('SELECT COUNT(*) as c FROM invoices')
      .get() as { c: number };
    expect(countRow.c).toBe(200);

    const counterRow = db
      .prepare('SELECT last_invoice_seq FROM counters WHERE id = ?')
      .get(counterId) as { last_invoice_seq: number };
    expect(counterRow.last_invoice_seq).toBe(200);

    // Ensure every single number from 1 to 200 is represented in sequence
    for (let seq = 1; seq <= 200; seq++) {
      const expectedNumber = `C1-${String(seq).padStart(6, '0')}`;
      expect(generatedInvoiceNumbers[seq - 1]).toBe(expectedNumber);
    }
  });

  it('2. Crash Simulation: failure after invoice insert but before stock movements rolls back everything', () => {
    // Record baseline database state
    const initialInvoicesCount = (
      db.prepare('SELECT COUNT(*) as c FROM invoices').get() as { c: number }
    ).c;
    const initialLinesCount = (
      db.prepare('SELECT COUNT(*) as c FROM invoice_lines').get() as { c: number }
    ).c;
    const initialMovementsCount = (
      db.prepare('SELECT COUNT(*) as c FROM stock_movements').get() as { c: number }
    ).c;
    const initialPaymentsCount = (
      db.prepare('SELECT COUNT(*) as c FROM payments').get() as { c: number }
    ).c;
    const initialOutboxCount = (
      db.prepare('SELECT COUNT(*) as c FROM outbox').get() as { c: number }
    ).c;
    const initialSeq = (
      db.prepare('SELECT last_invoice_seq FROM counters WHERE id = ?').get(counterId) as {
        last_invoice_seq: number;
      }
    ).last_invoice_seq;

    // Inject simulated crash: SQLite trigger that fires BEFORE INSERT ON stock_movements
    // This executes after invoice insert (step 6) and line insert (step 7) but before stock movement insert
    db.exec(`
      CREATE TRIGGER test_simulate_crash_before_stock_movement
      BEFORE INSERT ON stock_movements
      BEGIN
        SELECT RAISE(ABORT, 'Simulated mid-transaction crash: process killed before stock movements write');
      END;
    `);

    const crashRequestId = generateUuidV7();
    const input: FinalizeSaleInput = {
      clientRequestId: crashRequestId,
      counterId,
      cashierUserId,
      lines: [{ productId: product1Id, quantity: 2 }],
      payments: [{ method: 'cash', amountPaisa: 23600 }], // 2 * 10000 + 18% tax = 23600
      notes: 'This sale should abort mid-transaction',
    };

    // finalizeSale must throw the injected abort error
    expect(() => finalizeSale(input, { db, today: TODAY })).toThrow(
      /Simulated mid-transaction crash/
    );

    // Clean up injected trigger
    db.exec('DROP TRIGGER test_simulate_crash_before_stock_movement;');

    // Verify atomic rollback: NOTHING was written
    const postInvoicesCount = (
      db.prepare('SELECT COUNT(*) as c FROM invoices').get() as { c: number }
    ).c;
    const postLinesCount = (
      db.prepare('SELECT COUNT(*) as c FROM invoice_lines').get() as { c: number }
    ).c;
    const postMovementsCount = (
      db.prepare('SELECT COUNT(*) as c FROM stock_movements').get() as { c: number }
    ).c;
    const postPaymentsCount = (
      db.prepare('SELECT COUNT(*) as c FROM payments').get() as { c: number }
    ).c;
    const postOutboxCount = (
      db.prepare('SELECT COUNT(*) as c FROM outbox').get() as { c: number }
    ).c;
    const postFiscalCount = (
      db.prepare('SELECT COUNT(*) as c FROM fiscal_submissions').get() as { c: number }
    ).c;
    const postSeq = (
      db.prepare('SELECT last_invoice_seq FROM counters WHERE id = ?').get(counterId) as {
        last_invoice_seq: number;
      }
    ).last_invoice_seq;

    expect(postInvoicesCount).toBe(initialInvoicesCount);
    expect(postLinesCount).toBe(initialLinesCount);
    expect(postMovementsCount).toBe(initialMovementsCount);
    expect(postPaymentsCount).toBe(initialPaymentsCount);
    expect(postOutboxCount).toBe(initialOutboxCount);
    expect(postFiscalCount).toBe(0);
    expect(postSeq).toBe(initialSeq);

    // Verify stock balance for batch 1 is completely intact (still 1000)
    const stockBal = (
      db.prepare('SELECT SUM(quantity_signed) as bal FROM stock_movements WHERE batch_id = ?').get(batch1Id) as {
        bal: number;
      }
    ).bal;
    expect(stockBal).toBe(1000);
  });

  it('3. Outbox: every finalized invoice has exactly one outbox row; rolled-back sales have none', () => {
    // A. Perform 5 successful sales
    const finalizedInvoices = [];
    for (let i = 0; i < 5; i++) {
      const inv = finalizeSale(
        {
          clientRequestId: `outbox-test-${i}-${generateUuidV7()}`,
          counterId,
          cashierUserId,
          lines: [{ productId: product2Id, quantity: 1 }],
          payments: [{ method: 'cash', amountPaisa: 5000 }],
        },
        { db, today: TODAY }
      );
      finalizedInvoices.push(inv);
    }

    // Verify every finalized invoice has exactly 1 outbox row
    const outboxRows = db
      .prepare('SELECT * FROM outbox WHERE event_type = ?')
      .all('invoice.created') as { id: string; event_type: string; payload: string; synced_at: string | null }[];

    expect(outboxRows).toHaveLength(5);

    for (const inv of finalizedInvoices) {
      const matching = outboxRows.filter((r) => {
        const payload = JSON.parse(r.payload) as { id: string; invoiceNumber: string; totalPaisa: number };
        return payload.id === inv.id;
      });
      expect(matching).toHaveLength(1);
      const row = matching[0]!;
      expect(row.synced_at).toBeNull();
      const payload = JSON.parse(row.payload) as { id: string; invoiceNumber: string; totalPaisa: number };
      expect(payload.invoiceNumber).toBe(inv.invoiceNumber);
      expect(payload.totalPaisa).toBe(inv.totalPaisa);
    }

    // B. Rolled-back sales have NO outbox rows
    const outboxCountBeforeFailedSales = outboxRows.length;

    // Failure 1: Insufficient stock
    expect(() =>
      finalizeSale(
        {
          clientRequestId: `outbox-fail-stock-${generateUuidV7()}`,
          counterId,
          cashierUserId,
          lines: [{ productId: product2Id, quantity: 999999 }], // Exceeds available
          payments: [{ method: 'cash', amountPaisa: 999999 * 5000 }],
        },
        { db, today: TODAY }
      )
    ).toThrow(InsufficientStockError);

    // Failure 2: Payment mismatch
    expect(() =>
      finalizeSale(
        {
          clientRequestId: `outbox-fail-pay-${generateUuidV7()}`,
          counterId,
          cashierUserId,
          lines: [{ productId: product2Id, quantity: 1 }],
          payments: [{ method: 'cash', amountPaisa: 1 }], // Mismatched (expected 5000)
        },
        { db, today: TODAY }
      )
    ).toThrow(/Payment total/);

    // Failure 3: Inactive product
    db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(product2Id);
    expect(() =>
      finalizeSale(
        {
          clientRequestId: `outbox-fail-inactive-${generateUuidV7()}`,
          counterId,
          cashierUserId,
          lines: [{ productId: product2Id, quantity: 1 }],
          payments: [{ method: 'cash', amountPaisa: 5000 }],
        },
        { db, today: TODAY }
      )
    ).toThrow(/inactive and cannot be sold/);

    // Verify outbox count did not increase at all
    const outboxCountAfterFailedSales = (
      db.prepare('SELECT COUNT(*) as c FROM outbox').get() as { c: number }
    ).c;
    expect(outboxCountAfterFailedSales).toBe(outboxCountBeforeFailedSales);
  });

  it('4. Immutability: attempts to UPDATE or DELETE invoices, lines and payments through raw SQL fail', () => {
    // Create a finalized invoice
    const inv = finalizeSale(
      {
        clientRequestId: generateUuidV7(),
        counterId,
        cashierUserId,
        lines: [{ productId: product1Id, quantity: 1 }],
        payments: [{ method: 'cash', amountPaisa: 11800 }], // 10000 + 18% tax
      },
      { db, today: TODAY }
    );

    const lineId = inv.lines[0]!.id;
    const paymentId = inv.payments[0]!.id;

    // A. INVOICES table immutability
    // Attempt UPDATE on invoices
    expect(() => {
      db.prepare('UPDATE invoices SET total_paisa = 0 WHERE id = ?').run(inv.id);
    }).toThrow(/finalized records are immutable/);

    expect(() => {
      db.prepare("UPDATE invoices SET notes = 'tampered' WHERE id = ?").run(inv.id);
    }).toThrow(/finalized records are immutable/);

    // Attempt DELETE on invoices
    expect(() => {
      db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
    }).toThrow(/finalized records are immutable/);

    // B. INVOICE_LINES table immutability
    // Attempt UPDATE on invoice_lines
    expect(() => {
      db.prepare('UPDATE invoice_lines SET quantity = 999 WHERE id = ?').run(lineId);
    }).toThrow(/finalized records are immutable/);

    expect(() => {
      db.prepare('UPDATE invoice_lines SET unit_price_paisa = 1 WHERE id = ?').run(lineId);
    }).toThrow(/finalized records are immutable/);

    // Attempt DELETE on invoice_lines
    expect(() => {
      db.prepare('DELETE FROM invoice_lines WHERE id = ?').run(lineId);
    }).toThrow(/finalized records are immutable/);

    // C. PAYMENTS table immutability
    // Attempt UPDATE on payments
    expect(() => {
      db.prepare('UPDATE payments SET amount_paisa = 0 WHERE id = ?').run(paymentId);
    }).toThrow(/finalized records are immutable/);

    expect(() => {
      db.prepare("UPDATE payments SET method = 'card' WHERE id = ?").run(paymentId);
    }).toThrow(/finalized records are immutable/);

    // Attempt DELETE on payments
    expect(() => {
      db.prepare('DELETE FROM payments WHERE id = ?').run(paymentId);
    }).toThrow(/finalized records are immutable/);

    // Verify all records remain completely intact and unaltered
    const invRow = db.prepare('SELECT total_paisa FROM invoices WHERE id = ?').get(inv.id) as { total_paisa: number };
    expect(invRow.total_paisa).toBe(11800);

    const lineRow = db.prepare('SELECT quantity, unit_price_paisa FROM invoice_lines WHERE id = ?').get(lineId) as {
      quantity: number;
      unit_price_paisa: number;
    };
    expect(lineRow.quantity).toBe(1);
    expect(lineRow.unit_price_paisa).toBe(10000);

    const payRow = db.prepare('SELECT amount_paisa, method FROM payments WHERE id = ?').get(paymentId) as {
      amount_paisa: number;
      method: string;
    };
    expect(payRow.amount_paisa).toBe(11800);
    expect(payRow.method).toBe('cash');
  });

  it('5. Price Integrity: renderer-supplied prices and totals are never used or trusted', () => {
    // Scenario A: Renderer supplies a tampered lower price and sends payment for that tampered price
    const tamperedLineInput = {
      productId: product1Id, // DB MRP is 10000 paisa (Rs. 100) + 18% tax = 11800 paisa
      quantity: 1,
      unitPricePaisa: 50, // Tampered price: Rs. 0.50
      totalPaisa: 50,
      price: 50,
    } as unknown as FinalizeSaleLineInput;

    const tamperedInputA: FinalizeSaleInput = {
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId,
      lines: [tamperedLineInput],
      payments: [{ method: 'cash', amountPaisa: 50 }], // Paying tampered amount
    };

    // finalizeSale calculates totals strictly from the DB product record and rejects payment mismatch
    expect(() => finalizeSale(tamperedInputA, { db, today: TODAY })).toThrow(
      /Payment total \(50 paisa\) does not match invoice total \(11800 paisa\)/
    );

    // Verify nothing was written to invoices or lines
    const invCount = (
      db.prepare('SELECT COUNT(*) as c FROM invoices WHERE client_request_id = ?').get(tamperedInputA.clientRequestId) as {
        c: number;
      }
    ).c;
    expect(invCount).toBe(0);

    // Scenario B: Renderer supplies tampered price metadata, but payment matches the true total
    const tamperedInputB: FinalizeSaleInput = {
      clientRequestId: generateUuidV7(),
      counterId,
      cashierUserId,
      lines: [
        {
          productId: product1Id,
          quantity: 2,
          unitPricePaisa: 10, // Tampered: 10 paisa
          lineTotalPaisa: 20, // Tampered: 20 paisa
        } as unknown as FinalizeSaleLineInput,
      ],
      payments: [{ method: 'card', amountPaisa: 23600 }], // 2 * 10000 + 18% tax = 23600
    };

    const invoiceB = finalizeSale(tamperedInputB, { db, today: TODAY });

    // Verify invoice totals and line unit price strictly come from the DB (10,000 paisa), NOT from the tampered 10 paisa
    expect(invoiceB.subtotalPaisa).toBe(20000);
    expect(invoiceB.taxPaisa).toBe(3600);
    expect(invoiceB.totalPaisa).toBe(23600);
    expect(invoiceB.lines[0]!.unitPricePaisa).toBe(10000);
    expect(invoiceB.lines[0]!.lineTotalPaisa).toBe(23600);

    // Verify the database record itself has the DB price and line total
    const lineRow = db
      .prepare('SELECT unit_price_paisa, line_total_paisa FROM invoice_lines WHERE invoice_id = ?')
      .get(invoiceB.id) as { unit_price_paisa: number; line_total_paisa: number };

    expect(lineRow.unit_price_paisa).toBe(10000);
    expect(lineRow.line_total_paisa).toBe(23600);
  });
});
