import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { MIGRATIONS, setDatabaseForTesting } from './db';
import { finalizeSale } from './finalizeSale';
import { processReturn, getReturnableInvoiceLines } from './returns';
import { openShift, closeShift, getCurrentShift, getShiftHistory } from './shifts';
import { generateUuidV7 } from '@pos/shared';

describe('Returns & Shift Closing (Phase 2)', () => {
  let db: DatabaseInstance;
  let branchId: string;
  let counterId: string;
  let cashierUserId: string;
  let taxCatId: string;
  let productId: string;
  let batchId1: string;
  let batchId2: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const m of MIGRATIONS) {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString()
      );
    }

    setDatabaseForTesting(db);

    branchId = generateUuidV7();
    counterId = generateUuidV7();
    cashierUserId = generateUuidV7();
    taxCatId = generateUuidV7();
    productId = generateUuidV7();
    batchId1 = generateUuidV7();
    batchId2 = generateUuidV7();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      branchId,
      'Main Pharmacy Branch',
      now,
      now
    );

    db.prepare(
      'INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, last_credit_note_seq, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)'
    ).run(counterId, branchId, 'Counter 1', 'C-1', now, now);

    db.prepare(
      'INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(cashierUserId, 'Cashier Bilal', 'cashier', 'hash_test', 1, now, now);

    // Standard 10% tax (1000 bp)
    db.prepare(
      'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(taxCatId, 'Pharma 10%', 1000, 0, now, now);

    // Product with MRP 10000 paisa (Rs. 100)
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
      '896400010001',
      taxCatId,
      10000,
      0,
      1,
      now,
      now
    );

    // Batch 1: 50 units stock
    db.prepare(`
      INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batchId1, productId, 'B-001', '2028-12-31', 6000, 10000, now, now);

    db.prepare(`
      INSERT INTO stock_movements (id, product_id, branch_id, batch_id, type, quantity_signed, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'purchase', 50, ?, ?)
    `).run(generateUuidV7(), productId, branchId, batchId1, now, now);

    // Batch 2: 20 units stock
    db.prepare(`
      INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batchId2, productId, 'B-002', '2029-01-31', 6500, 10000, now, now);

    db.prepare(`
      INSERT INTO stock_movements (id, product_id, branch_id, batch_id, type, quantity_signed, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'purchase', 20, ?, ?)
    `).run(generateUuidV7(), productId, branchId, batchId2, now, now);
  });

  describe('1. Returnable Balances & Over-return Prevention', () => {
    it('calculates returnable balance and rejects over-returns', () => {
      // Finalize sale of 5 units of Product (unitPrice 10000, discount 0, tax 10% = 1000, lineTotal = 11000 per unit)
      // Total for 5 units = 50000 subtotal + 5000 tax = 55000 paisa
      const saleResult = finalizeSale(
        {
          clientRequestId: generateUuidV7(),
          counterId,
          cashierUserId,
          lines: [{ productId, quantity: 5, discountPaisa: 0 }],
          payments: [{ method: 'cash', amountPaisa: 55000 }],
        },
        { db }
      );

      const invoiceId = saleResult.id;
      const invoiceLineId = saleResult.lines[0]!.id;

      // 1. Check returnable lines
      const returnable = getReturnableInvoiceLines(invoiceId, db);
      expect(returnable).toHaveLength(1);
      expect(returnable[0]!.soldQuantity).toBe(5);
      expect(returnable[0]!.alreadyReturnedQuantity).toBe(0);
      expect(returnable[0]!.returnableQuantity).toBe(5);

      // 2. Reject over-return (attempting to return 6 units when only 5 sold)
      expect(() => {
        processReturn(
          {
            clientRequestId: generateUuidV7(),
            originalInvoiceId: invoiceId,
            reason: 'customer_return',
            refundMethod: 'cash',
            lines: [{ invoiceLineId, quantity: 6 }],
          },
          { db, counterId, cashierUserId, branchId }
        );
      }).toThrow(/Cannot return 6 units/);

      // 3. Return 3 units successfully
      const return1 = processReturn(
        {
          clientRequestId: generateUuidV7(),
          originalInvoiceId: invoiceId,
          reason: 'customer_return',
          refundMethod: 'cash',
          lines: [{ invoiceLineId, quantity: 3 }],
        },
        { db, counterId, cashierUserId, branchId }
      );
      expect(return1.lines[0]!.quantity).toBe(3);

      // 4. Returnable balance should now be 2
      const returnableAfter1 = getReturnableInvoiceLines(invoiceId, db);
      expect(returnableAfter1[0]!.soldQuantity).toBe(5);
      expect(returnableAfter1[0]!.alreadyReturnedQuantity).toBe(3);
      expect(returnableAfter1[0]!.returnableQuantity).toBe(2);

      // 5. Attempting to return 3 more units now fails (only 2 left)
      expect(() => {
        processReturn(
          {
            clientRequestId: generateUuidV7(),
            originalInvoiceId: invoiceId,
            reason: 'customer_return',
            refundMethod: 'cash',
            lines: [{ invoiceLineId, quantity: 3 }],
          },
          { db, counterId, cashierUserId, branchId }
        );
      }).toThrow(/only 2 unit\(s\) remain returnable/);

      // 6. Returning the remaining 2 units succeeds
      const return2 = processReturn(
        {
          clientRequestId: generateUuidV7(),
          originalInvoiceId: invoiceId,
          reason: 'customer_return',
          refundMethod: 'cash',
          lines: [{ invoiceLineId, quantity: 2 }],
        },
        { db, counterId, cashierUserId, branchId }
      );
      expect(return2.lines[0]!.quantity).toBe(2);

      // 7. Balance is now 0; cannot return anymore
      const returnableFinal = getReturnableInvoiceLines(invoiceId, db);
      expect(returnableFinal[0]!.returnableQuantity).toBe(0);

      expect(() => {
        processReturn(
          {
            clientRequestId: generateUuidV7(),
            originalInvoiceId: invoiceId,
            reason: 'customer_return',
            refundMethod: 'cash',
            lines: [{ invoiceLineId, quantity: 1 }],
          },
          { db, counterId, cashierUserId, branchId }
        );
      }).toThrow(/only 0 unit\(s\) remain returnable/);
    });

    it('rejects zero or negative return quantities', () => {
      const saleResult = finalizeSale(
        {
          clientRequestId: generateUuidV7(),
          counterId,
          cashierUserId,
          lines: [{ productId, quantity: 2, discountPaisa: 0 }],
          payments: [{ method: 'cash', amountPaisa: 22000 }],
        },
        { db }
      );

      const invoiceLineId = saleResult.lines[0]!.id;

      expect(() => {
        processReturn(
          {
            clientRequestId: generateUuidV7(),
            originalInvoiceId: saleResult.id,
            reason: 'customer_return',
            refundMethod: 'cash',
            lines: [{ invoiceLineId, quantity: 0 }],
          },
          { db, counterId, cashierUserId, branchId }
        );
      }).toThrow();
    });
  });

  describe('2. Stock Restored to the Exact Original Batch', () => {
    it('creates positive signed stock movements pointing to the original batch', () => {
      // FEFO will pick batchId1 (earlier expiry: 2028-12-31)
      const saleResult = finalizeSale(
        {
          clientRequestId: generateUuidV7(),
          counterId,
          cashierUserId,
          lines: [{ productId, quantity: 10, discountPaisa: 0 }],
          payments: [{ method: 'cash', amountPaisa: 110000 }],
        },
        { db }
      );

      const soldBatchId = saleResult.lines[0]!.batchId!;
      expect(soldBatchId).toBe(batchId1);

      // Check balance of batch 1 after sale (starting 50 - 10 = 40)
      const balanceAfterSale = (
        db
          .prepare(`SELECT SUM(quantity_signed) AS bal FROM stock_movements WHERE batch_id = ?`)
          .get(batchId1) as { bal: number }
      ).bal;
      expect(balanceAfterSale).toBe(40);

      // Return 4 units
      const creditNote = processReturn(
        {
          clientRequestId: generateUuidV7(),
          originalInvoiceId: saleResult.id,
          reason: 'defective_damaged',
          refundMethod: 'cash',
          lines: [{ invoiceLineId: saleResult.lines[0]!.id, quantity: 4 }],
        },
        { db, counterId, cashierUserId, branchId }
      );

      // Invariant Rule 4: Verify stock movement record
      const returnMovement = db
        .prepare(
          `SELECT * FROM stock_movements WHERE reference_id = ? AND reference_type = 'credit_note' AND batch_id = ?`
        )
        .get(creditNote.id, batchId1) as {
        id: string;
        type: string;
        quantity_signed: number;
        batch_id: string;
      };

      expect(returnMovement).toBeDefined();
      expect(returnMovement.type).toBe('return');
      expect(returnMovement.quantity_signed).toBe(4); // Positive integer per Rule 4
      expect(returnMovement.batch_id).toBe(batchId1);

      // Batch 1 balance must now be 40 + 4 = 44
      const balanceAfterReturn = (
        db
          .prepare(`SELECT SUM(quantity_signed) AS bal FROM stock_movements WHERE batch_id = ?`)
          .get(batchId1) as { bal: number }
      ).bal;
      expect(balanceAfterReturn).toBe(44);

      // Batch 2 balance must remain strictly untouched (20)
      const batch2Bal = (
        db
          .prepare(`SELECT SUM(quantity_signed) AS bal FROM stock_movements WHERE batch_id = ?`)
          .get(batchId2) as { bal: number }
      ).bal;
      expect(batch2Bal).toBe(20);
    });
  });

  describe('3. Credit Note Proportional Totals & Document Immutability', () => {
    it('computes proportional subtotal, tax, and total paisa correctly', () => {
      // Sale of 10 units: unit MRP = 10000, 10% tax = 1000 -> 11000 total per unit
      // Line: subtotal 100,000, tax 10,000, total 110,000
      const saleResult = finalizeSale(
        {
          clientRequestId: generateUuidV7(),
          counterId,
          cashierUserId,
          lines: [{ productId, quantity: 10, discountPaisa: 0 }],
          payments: [{ method: 'cash', amountPaisa: 110000 }],
        },
        { db }
      );

      // Return 3 units: should be exactly 3 * 10000 = 30000 subtotal, 3 * 1000 = 3000 tax, 33000 total
      const creditNote = processReturn(
        {
          clientRequestId: generateUuidV7(),
          originalInvoiceId: saleResult.id,
          reason: 'dispensing_error',
          refundMethod: 'cash',
          lines: [{ invoiceLineId: saleResult.lines[0]!.id, quantity: 3 }],
        },
        { db, counterId, cashierUserId, branchId }
      );

      expect(creditNote.subtotalPaisa).toBe(30000);
      expect(creditNote.taxPaisa).toBe(3000);
      expect(creditNote.totalPaisa).toBe(33000);
      expect(creditNote.lines[0]!.quantity).toBe(3);
      expect(creditNote.lines[0]!.lineTotalPaisa).toBe(33000);
      expect(creditNote.creditNoteNumber).toMatch(/^CN-/);
    });

    it('enforces immutability: UPDATE and DELETE on credit_notes and lines fail via triggers', () => {
      const saleResult = finalizeSale(
        {
          clientRequestId: generateUuidV7(),
          counterId,
          cashierUserId,
          lines: [{ productId, quantity: 2, discountPaisa: 0 }],
          payments: [{ method: 'cash', amountPaisa: 22000 }],
        },
        { db }
      );

      const creditNote = processReturn(
        {
          clientRequestId: generateUuidV7(),
          originalInvoiceId: saleResult.id,
          reason: 'customer_return',
          refundMethod: 'cash',
          lines: [{ invoiceLineId: saleResult.lines[0]!.id, quantity: 1 }],
        },
        { db, counterId, cashierUserId, branchId }
      );

      // Attempt raw UPDATE on credit_notes
      expect(() => {
        db.prepare(`UPDATE credit_notes SET total_paisa = 99999 WHERE id = ?`).run(creditNote.id);
      }).toThrow(/credit notes are immutable/);

      // Attempt raw DELETE on credit_notes
      expect(() => {
        db.prepare(`DELETE FROM credit_notes WHERE id = ?`).run(creditNote.id);
      }).toThrow(/credit notes are immutable/);

      // Attempt raw UPDATE on credit_note_lines
      expect(() => {
        db.prepare(`UPDATE credit_note_lines SET quantity = 99 WHERE credit_note_id = ?`).run(
          creditNote.id
        );
      }).toThrow(/credit notes are immutable/);

      // Attempt raw DELETE on credit_note_lines
      expect(() => {
        db.prepare(`DELETE FROM credit_note_lines WHERE credit_note_id = ?`).run(creditNote.id);
      }).toThrow(/credit notes are immutable/);
    });
  });

  describe('4. Shift Cash Reconciliation: Expected = Opening + Cash Sales - Cash Returns', () => {
    it('accurately reconciles drawer cash across cash sales, card sales, and cash refunds', () => {
      // 1. Open shift with Rs. 50.00 (5000 paisa) float
      const shift = openShift(
        {
          openingCashPaisa: 5000,
          notes: 'Morning float',
        },
        { counterId, cashierUserId, branchId, rawDb: db }
      );

      expect(shift.status).toBe('open');
      expect(shift.openingCashPaisa).toBe(5000);
      expect(shift.expectedCashPaisa).toBe(5000);

      // Cannot open a second shift on the same counter while one is open
      expect(() => {
        openShift(
          { openingCashPaisa: 1000 },
          { counterId, cashierUserId, branchId, rawDb: db }
        );
      }).toThrow(/already open/);

      // 2. Perform Cash Sale: 2 units = 22000 paisa cash
      const cashSale = finalizeSale(
        {
          clientRequestId: generateUuidV7(),
          counterId,
          cashierUserId,
          lines: [{ productId, quantity: 2, discountPaisa: 0 }],
          payments: [{ method: 'cash', amountPaisa: 22000 }],
        },
        { db }
      );

      // 3. Perform Split Payment Sale: 2 units = 22000 paisa (10000 cash, 12000 card)
      finalizeSale(
        {
          clientRequestId: generateUuidV7(),
          counterId,
          cashierUserId,
          lines: [{ productId, quantity: 2, discountPaisa: 0 }],
          payments: [
            { method: 'cash', amountPaisa: 10000 },
            { method: 'card', amountPaisa: 12000 },
          ],
        },
        { db }
      );

      // Check live totals:
      // Cash sales = 22000 + 10000 = 32000 paisa
      // Card sales = 12000 paisa
      // Expected cash = 5000 (opening) + 32000 (cash sales) = 37000 paisa
      const live1 = getCurrentShift(counterId, db);
      expect(live1?.salesCashPaisa).toBe(32000);
      expect(live1?.salesCardPaisa).toBe(12000);
      expect(live1?.expectedCashPaisa).toBe(37000);

      // 4. Process Cash Return: return 1 unit from cashSale (refund = 11000 paisa cash)
      processReturn(
        {
          clientRequestId: generateUuidV7(),
          originalInvoiceId: cashSale.id,
          reason: 'customer_return',
          refundMethod: 'cash',
          lines: [{ invoiceLineId: cashSale.lines[0]!.id, quantity: 1 }],
        },
        { db, counterId, cashierUserId, branchId }
      );

      // Check live totals after refund:
      // Expected cash = 5000 (opening) + 32000 (cash sales) - 11000 (cash return) = 26000 paisa
      const live2 = getCurrentShift(counterId, db);
      expect(live2?.returnsCashPaisa).toBe(11000);
      expect(live2?.expectedCashPaisa).toBe(26000);

      // 5. Close Shift with Counted Cash = 25500 paisa (Rs. 255.00)
      // Discrepancy = counted (25500) - expected (26000) = -500 paisa (Rs. 5.00 shortage)
      const closedShift = closeShift(
        {
          shiftId: shift.id,
          countedCashPaisa: 25500,
          notes: 'Rs 5 shortage due to change error',
        },
        { cashierUserId, rawDb: db }
      );

      expect(closedShift.status).toBe('closed');
      expect(closedShift.expectedCashPaisa).toBe(26000);
      expect(closedShift.countedCashPaisa).toBe(25500);
      expect(closedShift.differencePaisa).toBe(-500);
      expect(closedShift.closedAt).toBeDefined();

      // Verify history
      const history = getShiftHistory({ counterId, rawDb: db });
      expect(history).toHaveLength(1);
      expect(history[0]!.status).toBe('closed');
      expect(history[0]!.differencePaisa).toBe(-500);

      // Now counter is free: a new shift can be opened
      const nextShift = openShift(
        { openingCashPaisa: 3000 },
        { counterId, cashierUserId, branchId, rawDb: db }
      );
      expect(nextShift.status).toBe('open');
    });

    it('creates outbox events for shift opened, shift closed, and credit note created', () => {
      const shift = openShift(
        { openingCashPaisa: 4000 },
        { counterId, cashierUserId, branchId, rawDb: db }
      );

      const sale = finalizeSale(
        {
          clientRequestId: generateUuidV7(),
          counterId,
          cashierUserId,
          lines: [{ productId, quantity: 1, discountPaisa: 0 }],
          payments: [{ method: 'cash', amountPaisa: 11000 }],
        },
        { db }
      );

      processReturn(
        {
          clientRequestId: generateUuidV7(),
          originalInvoiceId: sale.id,
          reason: 'customer_return',
          refundMethod: 'cash',
          lines: [{ invoiceLineId: sale.lines[0]!.id, quantity: 1 }],
        },
        { db, counterId, cashierUserId, branchId }
      );

      closeShift(
        { shiftId: shift.id, countedCashPaisa: 4000 },
        { cashierUserId, rawDb: db }
      );

      const outboxRows = db
        .prepare(`SELECT event_type FROM outbox ORDER BY created_at ASC`)
        .all() as { event_type: string }[];

      const eventTypes = outboxRows.map((r) => r.event_type);
      expect(eventTypes).toContain('shift.opened');
      expect(eventTypes).toContain('invoice.created');
      expect(eventTypes).toContain('credit_note.created');
      expect(eventTypes).toContain('shift.closed');
    });
  });
});
