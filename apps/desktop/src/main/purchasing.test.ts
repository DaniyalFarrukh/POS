import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { MIGRATIONS, setDatabaseForTesting } from './db';
import { seedDatabase } from './db/seed';
import { setSessionForTesting, logout, ForbiddenError } from './auth';
import {
  getSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  receiveGrn,
  getStockOverviewByProduct,
  getStockOverviewByBatch,
  adjustStock,
  roleGuardedReceiveGrn,
  roleGuardedAdjustStock,
  roleGuardedCreateSupplier,
} from './purchasing';
import { generateUuidV7 } from '@pos/shared';

describe('Purchasing, GRN Receiving & Stock Management', () => {
  let rawDb: DatabaseInstance;
  let testBranchId: string;
  let testUserId: string;
  let testSupplierId: string;
  let testProduct1Id: string;
  let testProduct2Id: string;

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
    seedDatabase(rawDb);

    // Setup a branch
    testBranchId = generateUuidV7();
    const now = new Date().toISOString();
    rawDb.prepare(`
      INSERT INTO branches (id, name, created_at, updated_at)
      VALUES (?, 'Main City Branch', ?, ?)
    `).run(testBranchId, now, now);

    // Setup an owner user
    testUserId = generateUuidV7();
    rawDb.prepare(`
      INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at)
      VALUES (?, 'Dr. Pharmacist', 'pharmacist', 'hash', 1, ?, ?)
    `).run(testUserId, now, now);

    // Fetch seeded supplier
    const supplierRow = rawDb.prepare('SELECT id FROM suppliers LIMIT 1').get() as { id: string };
    testSupplierId = supplierRow.id;

    // Fetch 2 seeded products
    const productRows = rawDb.prepare('SELECT id FROM products LIMIT 2').all() as { id: string }[];
    testProduct1Id = productRows[0]!.id;
    testProduct2Id = productRows[1]!.id;

    // Configure test session
    setSessionForTesting({
      user: { id: testUserId, name: 'Dr. Pharmacist', role: 'pharmacist', isActive: true },
      branch: { id: testBranchId, name: 'Main City Branch' },
      counter: { id: generateUuidV7(), name: 'Counter 1' },
      idleTimeoutMinutes: 15,
      isLocked: false,
    });
  });

  describe('1. Suppliers CRUD', () => {
    it('lists seeded standard pharmacy suppliers', () => {
      const suppliers = getSuppliers();
      expect(suppliers.length).toBeGreaterThanOrEqual(5);
      expect(suppliers.some((s) => s.name.includes('Muller & Phipps'))).toBe(true);
      expect(suppliers.some((s) => s.name.includes('Searle'))).toBe(true);
    });

    it('creates, reads, updates, and deletes a supplier', () => {
      const created = createSupplier({
        name: 'Novartis Pakistan Dist.',
        contactPerson: 'Zubair Shah',
        phone: '021-34567890',
        email: 'supply@novartis.pk',
        address: 'Sindh Industrial Trading Estate, Karachi',
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('Novartis Pakistan Dist.');

      // Read
      const found = getSupplier(created.id);
      expect(found).not.toBeNull();
      expect(found?.phone).toBe('021-34567890');

      // Update
      const updated = updateSupplier(created.id, {
        contactPerson: 'Zubair Shah (Senior Mgr)',
        phone: '021-99998888',
      });
      expect(updated.contactPerson).toBe('Zubair Shah (Senior Mgr)');
      expect(updated.phone).toBe('021-99998888');

      // Delete
      const delRes = deleteSupplier(created.id);
      expect(delRes.success).toBe(true);
      expect(getSupplier(created.id)).toBeNull();
    });

    it('blocks deleting a supplier that has associated purchase documents', () => {
      // Receive a GRN with testSupplierId
      receiveGrn({
        supplierId: testSupplierId,
        supplierInvoiceNo: 'INV-DEL-TEST',
        invoiceDate: '2026-10-26',
        lines: [
          {
            productId: testProduct1Id,
            batchNo: 'B-DEL-1',
            expiryDate: '2027-12-31',
            quantity: 10,
            costPaisa: 2500,
            mrpPaisa: 3500,
          },
        ],
      });

      expect(() => deleteSupplier(testSupplierId)).toThrow(/Cannot delete supplier/);
    });
  });

  describe('2. Purchase Receiving (GRN) & Batch Merging', () => {
    it('receiving the same batch twice merges correctly (Rule 4 & Rule 5)', () => {
      const batchNumber = 'BN-MERGE-001';

      // 1st Receiving of BN-MERGE-001: 10 units @ 3000 paisa (Rs. 30.00)
      const grn1 = receiveGrn({
        supplierId: testSupplierId,
        supplierInvoiceNo: 'INV-1001',
        invoiceDate: '2026-10-26',
        lines: [
          {
            productId: testProduct1Id,
            batchNo: batchNumber,
            expiryDate: '2027-08-31',
            quantity: 10,
            costPaisa: 3000,
            mrpPaisa: 4500,
          },
        ],
      });

      expect(grn1.id).toBeDefined();
      expect(grn1.lines).toHaveLength(1);
      const batchId1 = grn1.lines![0]!.batchId;

      // 2nd Receiving of same BN-MERGE-001: 15 units @ 3200 paisa (Rs. 32.00)
      const grn2 = receiveGrn({
        supplierId: testSupplierId,
        supplierInvoiceNo: 'INV-1002',
        invoiceDate: '2026-10-27',
        lines: [
          {
            productId: testProduct1Id,
            batchNo: batchNumber,
            expiryDate: '2027-08-31',
            quantity: 15,
            costPaisa: 3200,
            mrpPaisa: 4500,
          },
        ],
      });

      const batchId2 = grn2.lines![0]!.batchId;

      // Assert that batches are merged: exactly ONE batch entity exists in batches table
      expect(batchId2).toBe(batchId1);

      const batchCount = rawDb.prepare(
        'SELECT COUNT(*) as count FROM batches WHERE product_id = ? AND batch_no = ?'
      ).get(testProduct1Id, batchNumber) as { count: number };
      expect(batchCount.count).toBe(1);

      // Assert that 2 separate signed stock movements exist (Rule 4)
      const movements = rawDb.prepare(
        'SELECT * FROM stock_movements WHERE batch_id = ? ORDER BY created_at ASC'
      ).all(batchId1) as { type: string; quantity_signed: number }[];

      expect(movements).toHaveLength(2);
      expect(movements[0]?.type).toBe('purchase');
      expect(movements[0]?.quantity_signed).toBe(10);
      expect(movements[1]?.type).toBe('purchase');
      expect(movements[1]?.quantity_signed).toBe(15);

      // Assert stock balance is strictly the sum of movements: 10 + 15 = 25
      const overview = getStockOverviewByBatch({ search: batchNumber });
      expect(overview.items).toHaveLength(1);
      expect(overview.items[0]?.balance).toBe(25);
    });

    it('records outbox sync events inside the same transaction (Rule 5)', () => {
      const outboxBefore = rawDb.prepare('SELECT COUNT(*) as count FROM outbox').get() as {
        count: number;
      };

      receiveGrn({
        supplierId: testSupplierId,
        supplierInvoiceNo: 'INV-OUTBOX-1',
        invoiceDate: '2026-10-26',
        lines: [
          {
            productId: testProduct1Id,
            batchNo: 'BN-OB-1',
            expiryDate: '2028-01-01',
            quantity: 20,
            costPaisa: 5000,
            mrpPaisa: 7500,
          },
        ],
      });

      const outboxAfter = rawDb.prepare('SELECT COUNT(*) as count FROM outbox').get() as {
        count: number;
      };
      expect(outboxAfter.count).toBe(outboxBefore.count + 1);

      const latestEvent = rawDb.prepare(
        'SELECT * FROM outbox ORDER BY created_at DESC LIMIT 1'
      ).get() as { event_type: string; payload: string };
      expect(latestEvent.event_type).toBe('purchase.received');
      expect(latestEvent.payload).toContain('INV-OUTBOX-1');
    });
  });

  describe('3. Stock Adjustment & Signed Movements', () => {
    it('creates signed stock movements with required reasons (damage, loss, correction)', () => {
      // First, seed some initial stock via GRN: 50 units
      const grn = receiveGrn({
        supplierId: testSupplierId,
        supplierInvoiceNo: 'INV-ADJ-BASE',
        invoiceDate: '2026-10-26',
        lines: [
          {
            productId: testProduct2Id,
            batchNo: 'BN-ADJ-001',
            expiryDate: '2027-06-30',
            quantity: 50,
            costPaisa: 4000,
            mrpPaisa: 6000,
          },
        ],
      });
      const batchId = grn.lines![0]!.batchId;

      // 1. Adjustment for Damage: -4 units
      const adj1 = adjustStock({
        productId: testProduct2Id,
        batchId,
        quantitySigned: -4,
        reasonType: 'damage',
        reason: 'Liquid leaked during shelving',
      });

      expect(adj1.success).toBe(true);
      expect(adj1.newBalance).toBe(46); // 50 - 4 = 46

      // Verify movement record
      const moveRow1 = rawDb.prepare('SELECT * FROM stock_movements WHERE id = ?').get(adj1.movementId) as {
        type: string;
        quantity_signed: number;
        reason: string;
      };
      expect(moveRow1.type).toBe('adjustment');
      expect(moveRow1.quantity_signed).toBe(-4);
      expect(moveRow1.reason).toBe('[DAMAGE] Liquid leaked during shelving');

      // 2. Adjustment for Loss: -2 units
      const adj2 = adjustStock({
        productId: testProduct2Id,
        batchId,
        quantitySigned: -2,
        reasonType: 'loss',
        reason: 'Missing from bin during audit',
      });
      expect(adj2.newBalance).toBe(44); // 46 - 2 = 44

      // 3. Adjustment for Correction (Physical count higher): +6 units
      const adj3 = adjustStock({
        productId: testProduct2Id,
        batchId,
        quantitySigned: 6,
        reasonType: 'correction',
        reason: 'Physical count recount revealed extra carton',
      });
      expect(adj3.newBalance).toBe(50); // 44 + 6 = 50

      // Verify outbox rows for adjustments
      const adjEvents = rawDb.prepare(
        "SELECT COUNT(*) as count FROM outbox WHERE event_type = 'stock_adjustment.created'"
      ).get() as { count: number };
      expect(adjEvents.count).toBe(3);
    });

    it('rejects stock adjustment when required reason explanation is empty', () => {
      // Receiving initial batch
      const grn = receiveGrn({
        supplierId: testSupplierId,
        supplierInvoiceNo: 'INV-ADJ-FAIL',
        invoiceDate: '2026-10-26',
        lines: [
          {
            productId: testProduct1Id,
            batchNo: 'BN-ERR-1',
            expiryDate: '2027-10-01',
            quantity: 10,
            costPaisa: 1000,
            mrpPaisa: 2000,
          },
        ],
      });
      const batchId = grn.lines![0]!.batchId;

      expect(() =>
        adjustStock({
          productId: testProduct1Id,
          batchId,
          quantitySigned: -1,
          reasonType: 'damage',
          reason: '   ', // Empty whitespace
        })
      ).toThrow();
    });

    it('rejects stock adjustment with zero quantity', () => {
      expect(() =>
        adjustStock({
          productId: testProduct1Id,
          batchId: generateUuidV7(),
          quantitySigned: 0,
          reasonType: 'correction',
          reason: 'No change',
        })
      ).toThrow(/Adjustment quantity cannot be zero/);
    });

    it('enqueues stock_adjustment.created as both type and event_type in outbox (L-03)', () => {
      const grn = receiveGrn({
        supplierId: testSupplierId,
        supplierInvoiceNo: 'INV-ADJ-OUTBOX',
        invoiceDate: '2026-10-26',
        lines: [
          {
            productId: testProduct1Id,
            batchNo: 'BN-ADJ-OUTBOX',
            expiryDate: '2027-10-01',
            quantity: 10,
            costPaisa: 1000,
            mrpPaisa: 2000,
          },
        ],
      });
      const batchId = grn.lines![0]!.batchId;

      adjustStock({
        productId: testProduct1Id,
        batchId,
        quantitySigned: -2,
        reasonType: 'damage',
        reason: 'Broken bottle on shelf',
      });

      const outboxRow = rawDb.prepare(
        "SELECT type, event_type FROM outbox WHERE type = 'stock_adjustment.created' ORDER BY created_at DESC LIMIT 1"
      ).get() as { type: string; event_type: string };

      expect(outboxRow).toBeDefined();
      expect(outboxRow.type).toBe('stock_adjustment.created');
      expect(outboxRow.event_type).toBe('stock_adjustment.created');
    });

    it('filters stock overview products and batches using parameterized bindings (M-01)', () => {
      receiveGrn({
        supplierId: testSupplierId,
        supplierInvoiceNo: 'INV-M01-FILTER',
        invoiceDate: '2026-10-26',
        lines: [
          {
            productId: testProduct1Id,
            batchNo: 'BN-EXP-60',
            expiryDate: new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10),
            quantity: 15,
            costPaisa: 1000,
            mrpPaisa: 2000,
          },
          {
            productId: testProduct2Id,
            batchNo: 'BN-EXPIRED',
            expiryDate: '2020-01-01',
            quantity: 5,
            costPaisa: 1000,
            mrpPaisa: 2000,
          },
        ],
      });

      const res60 = getStockOverviewByProduct({ branchId: testBranchId, filter: 'expiring_60' });
      expect(res60.items.some((i) => i.productId === testProduct1Id)).toBe(true);

      const resExpired = getStockOverviewByBatch({ branchId: testBranchId, filter: 'expired' });
      expect(resExpired.items.some((b) => b.batchNo === 'BN-EXPIRED')).toBe(true);
    });
  });

  describe('4. Totals Match Verification', () => {
    it('purchase document total_cost_paisa exactly matches sum of line quantities * cost', () => {
      // 3 lines with different quantities and prices
      const line1 = { productId: testProduct1Id, batchNo: 'BN-TOT-1', expiryDate: '2027-01-01', quantity: 12, costPaisa: 3500, mrpPaisa: 5000 };
      const line2 = { productId: testProduct2Id, batchNo: 'BN-TOT-2', expiryDate: '2027-02-01', quantity: 25, costPaisa: 4250, mrpPaisa: 6000 };

      const expectedTotal = 12 * 3500 + 25 * 4250; // 42,000 + 106,250 = 148,250 paisa (Rs. 1,482.50)

      const grn = receiveGrn({
        supplierId: testSupplierId,
        supplierInvoiceNo: 'INV-TOTALS-MATCH',
        invoiceDate: '2026-10-26',
        lines: [line1, line2],
      });

      expect(grn.totalCostPaisa).toBe(expectedTotal);

      // Verify in database
      const dbRow = rawDb.prepare('SELECT total_cost_paisa FROM purchases WHERE id = ?').get(grn.id) as {
        total_cost_paisa: number;
      };
      expect(dbRow.total_cost_paisa).toBe(expectedTotal);
    });

    it('product-level stock overview balance matches the sum of its batch balances', () => {
      // Product 1 receives Batch A: 30 units and Batch B: 45 units
      receiveGrn({
        supplierId: testSupplierId,
        supplierInvoiceNo: 'INV-PROD-MATCH-1',
        invoiceDate: '2026-10-26',
        lines: [
          { productId: testProduct1Id, batchNo: 'BN-PA-1', expiryDate: '2027-01-01', quantity: 30, costPaisa: 1000, mrpPaisa: 2000 },
          { productId: testProduct1Id, batchNo: 'BN-PB-2', expiryDate: '2027-05-01', quantity: 45, costPaisa: 1050, mrpPaisa: 2000 },
        ],
      });

      // Fetch batch overview
      const batchRes = getStockOverviewByBatch({ search: 'BN-P' });
      const batchSum = batchRes.items.reduce((acc, b) => acc + b.balance, 0);
      expect(batchSum).toBe(75); // 30 + 45

      // Fetch product overview
      const prodRes = getStockOverviewByProduct({ branchId: testBranchId, pageSize: 200 });
      const p1 = prodRes.items.find((p) => p.productId === testProduct1Id);
      expect(p1).toBeDefined();
      expect(p1?.totalBalance).toBe(75);
      expect(p1?.batchCount).toBe(2);
    });
  });

  describe('5. Role Guard Enforcement (Rule 6)', () => {
    it('blocks cashier role from receiving GRN, adjusting stock, or creating suppliers', async () => {
      // Switch session to Cashier
      setSessionForTesting({
        user: { id: generateUuidV7(), name: 'Cashier Ahmed', role: 'cashier', isActive: true },
        branch: { id: testBranchId, name: 'Main City Branch' },
        counter: { id: generateUuidV7(), name: 'Counter 2' },
        idleTimeoutMinutes: 15,
        isLocked: false,
      });

      // Cashier cannot create supplier
      await expect(
        roleGuardedCreateSupplier({
          name: 'Blocked Supplier',
        })
      ).rejects.toThrow(ForbiddenError);

      // Cashier cannot receive GRN
      await expect(
        roleGuardedReceiveGrn({
          supplierId: testSupplierId,
          supplierInvoiceNo: 'INV-BLOCKED',
          invoiceDate: '2026-10-26',
          lines: [
            {
              productId: testProduct1Id,
              batchNo: 'B-CASHIER-ERR',
              expiryDate: '2027-10-01',
              quantity: 10,
              costPaisa: 1000,
              mrpPaisa: 2000,
            },
          ],
        })
      ).rejects.toThrow(ForbiddenError);

      // Cashier cannot adjust stock
      await expect(
        roleGuardedAdjustStock({
          productId: testProduct1Id,
          batchId: generateUuidV7(),
          quantitySigned: -1,
          reasonType: 'damage',
          reason: 'Unauthorized attempt',
        })
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
