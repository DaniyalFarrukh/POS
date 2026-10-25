import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './db/schema';
import { MIGRATIONS, getStockByBatch } from './db';
import { generateUuidV7 } from '@pos/shared';

interface TableColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

describe('Local SQLite Schema & Inventory Logic (Phase 1)', () => {
  let rawDb: DatabaseInstance;
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(() => {
    // Fresh in-memory database with foreign keys enabled
    rawDb = new Database(':memory:');
    rawDb.pragma('foreign_keys = ON');

    // Run all migrations sequentially
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const migration of MIGRATIONS) {
      migration.up(rawDb);
      rawDb
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString());
    }

    db = drizzle(rawDb, { schema });
  });

  describe('Rule 4: No direct quantity column exists', () => {
    it('verifies that batches and products do NOT contain any direct quantity/stock columns', () => {
      const forbiddenColumnNames = [
        'quantity',
        'qty',
        'stock',
        'balance',
        'current_stock',
        'available_qty',
        'total_qty',
        'inventory',
      ];

      const batchColumns = rawDb.pragma('table_info(batches)') as TableColumnInfo[];
      const batchColNames = batchColumns.map((c) => c.name.toLowerCase());

      for (const forbidden of forbiddenColumnNames) {
        expect(
          batchColNames,
          `batches table must not contain '${forbidden}' column per Rule 4`
        ).not.toContain(forbidden);
      }

      const productColumns = rawDb.pragma('table_info(products)') as TableColumnInfo[];
      const productColNames = productColumns.map((c) => c.name.toLowerCase());

      for (const forbidden of forbiddenColumnNames) {
        expect(
          productColNames,
          `products table must not contain '${forbidden}' column per Rule 4`
        ).not.toContain(forbidden);
      }

      // Stock movements must be the only place where quantities exist (as signed integers)
      const movementColumns = rawDb.pragma('table_info(stock_movements)') as TableColumnInfo[];
      const movementColNames = movementColumns.map((c) => c.name.toLowerCase());
      expect(movementColNames).toContain('quantity_signed');
    });
  });

  describe('Inventory balance calculation and movements', () => {
    it('proves balance equals the sum of movements and sales require negative quantities', () => {
      const now = new Date().toISOString();
      const branchId = generateUuidV7();
      const taxCategoryId = generateUuidV7();
      const productId = generateUuidV7();
      const batchId = generateUuidV7();

      // 1. Insert Branch
      rawDb
        .prepare('INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(branchId, 'Main Branch', now, now);

      // 2. Insert Tax Category (18% GST = 1800 bp)
      rawDb
        .prepare(
          'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(taxCategoryId, 'Standard Rate', 1800, 0, now, now);

      // 3. Insert Product
      rawDb
        .prepare(
          `INSERT INTO products (
            id, brand_name, generic_name, strength, form, manufacturer,
            barcode, tax_category_id, mrp_paisa, is_controlled, is_active,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          productId,
          'Augmentin',
          'Amoxicillin + Clavulanic Acid',
          '625mg',
          'tablet',
          'GSK',
          '8964000998877',
          taxCategoryId,
          45000, // 450.00 PKR in paisa
          0,
          1,
          now,
          now
        );

      // 4. Insert Batch (strictly without quantity column)
      rawDb
        .prepare(
          `INSERT INTO batches (
            id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(batchId, productId, 'AUG-2026-X1', '2027-06-30', 36000, 45000, now, now);

      // Helper to add movements
      const addMovement = (type: string, quantitySigned: number, reason?: string) => {
        rawDb
          .prepare(
            `INSERT INTO stock_movements (
              id, product_id, batch_id, branch_id, type, quantity_signed,
              reference_type, reference_id, reason, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            generateUuidV7(),
            productId,
            batchId,
            branchId,
            type,
            quantitySigned,
            'test_ref',
            generateUuidV7(),
            reason ?? null,
            now,
            now
          );
      };

      // Initial state: no movements -> empty result
      expect(getStockByBatch(branchId, db)).toEqual([]);

      // Helper to safely get the first stock record
      const getFirstBatch = (items: ReturnType<typeof getStockByBatch>) => {
        const first = items[0];
        expect(first).toBeDefined();
        if (!first) throw new Error('Expected batch record');
        return first;
      };

      // Step 1: Initial Purchase of 100 units (+100)
      addMovement('purchase', 100, 'Supplier delivery PO-1001');

      let stock = getStockByBatch(branchId, db);
      expect(stock).toHaveLength(1);
      const batchRecord = getFirstBatch(stock);
      expect(batchRecord.batchId).toBe(batchId);
      expect(batchRecord.batchNo).toBe('AUG-2026-X1');
      expect(batchRecord.brandName).toBe('Augmentin');
      expect(batchRecord.balance).toBe(100);

      // Step 2: Transfer in of 25 units (+25)
      addMovement('transfer_in', 25, 'Transfer from Warehouse');
      stock = getStockByBatch(branchId, db);
      expect(getFirstBatch(stock).balance).toBe(125); // 100 + 25

      // Step 3: Sale of 30 units (-30) -> Negative quantity for sale
      addMovement('sale', -30, 'Counter sale INV-001');
      stock = getStockByBatch(branchId, db);
      expect(getFirstBatch(stock).balance).toBe(95); // 125 - 30

      // Step 4: Another sale of 15 units (-15)
      addMovement('sale', -15, 'Counter sale INV-002');
      stock = getStockByBatch(branchId, db);
      expect(getFirstBatch(stock).balance).toBe(80); // 95 - 15

      // Step 5: Customer return of 5 units (+5)
      addMovement('return', 5, 'Customer return RET-001');
      stock = getStockByBatch(branchId, db);
      expect(getFirstBatch(stock).balance).toBe(85); // 80 + 5

      // Step 6: Stock adjustment of -3 units (-3) due to damage
      addMovement('adjustment', -3, 'Damaged packaging write-off');
      stock = getStockByBatch(branchId, db);
      expect(getFirstBatch(stock).balance).toBe(82); // 85 - 3

      // Step 7: Transfer out of 20 units (-20)
      addMovement('transfer_out', -20, 'Transfer to Sub-branch');
      stock = getStockByBatch(branchId, db);
      expect(getFirstBatch(stock).balance).toBe(62); // 82 - 20

      // Direct SQL verification against view_batch_stock
      const viewRow = rawDb
        .prepare('SELECT balance FROM view_batch_stock WHERE batch_id = ? AND branch_id = ?')
        .get(batchId, branchId) as { balance: number };
      expect(viewRow.balance).toBe(62);

      // Direct verification that SUM of quantity_signed equals exactly 62
      const rawSumRow = rawDb
        .prepare(
          'SELECT SUM(quantity_signed) as total FROM stock_movements WHERE batch_id = ? AND branch_id = ?'
        )
        .get(batchId, branchId) as { total: number };
      expect(rawSumRow.total).toBe(62);
      expect(getFirstBatch(stock).balance).toBe(rawSumRow.total);
    });

    it('enforces foreign key constraints when inserting related records', () => {
      const now = new Date().toISOString();
      const nonExistentBranchId = generateUuidV7();
      const nonExistentProductId = generateUuidV7();
      const nonExistentBatchId = generateUuidV7();

      // Attempting to insert a stock movement with invalid foreign keys must fail
      expect(() => {
        rawDb
          .prepare(
            `INSERT INTO stock_movements (
              id, product_id, batch_id, branch_id, type, quantity_signed,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            generateUuidV7(),
            nonExistentProductId,
            nonExistentBatchId,
            nonExistentBranchId,
            'purchase',
            50,
            now,
            now
          );
      }).toThrow();
    });

    it('enforces uniqueness on product barcode', () => {
      const now = new Date().toISOString();
      const taxCategoryId = generateUuidV7();

      rawDb
        .prepare(
          'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(taxCategoryId, 'Tax Category', 0, 1, now, now);

      const barcode = '1234567890123';

      rawDb
        .prepare(
          `INSERT INTO products (
            id, brand_name, generic_name, strength, form, manufacturer,
            barcode, tax_category_id, mrp_paisa, is_controlled, is_active,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          generateUuidV7(),
          'Product 1',
          'Generic 1',
          '100mg',
          'tablet',
          'Pharma A',
          barcode,
          taxCategoryId,
          1000,
          0,
          1,
          now,
          now
        );

      // Attempting to insert another product with the same barcode must throw SQLITE_CONSTRAINT
      expect(() => {
        rawDb
          .prepare(
            `INSERT INTO products (
              id, brand_name, generic_name, strength, form, manufacturer,
              barcode, tax_category_id, mrp_paisa, is_controlled, is_active,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            generateUuidV7(),
            'Product 2',
            'Generic 2',
            '200mg',
            'tablet',
            'Pharma B',
            barcode,
            taxCategoryId,
            2000,
            0,
            1,
            now,
            now
          );
      }).toThrow(/UNIQUE constraint failed/);
    });
  });
});
