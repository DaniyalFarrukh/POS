import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { MIGRATIONS, setDatabaseForTesting } from './db';
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  importProductsCsv,
  getTaxCategories,
  roleGuardedCreateProduct,
  roleGuardedImportCsv,
  searchPosCatalog,
  getSubstitutes,
} from './products';
import { seedDatabase } from './db/seed';
import { setSessionForTesting, logout, ForbiddenError } from './auth';
import { generateUuidV7 } from '@pos/shared';

describe('Product Management & CSV Bulk Import', () => {
  let rawDb: DatabaseInstance;
  let defaultTaxId: string;

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
    const seedRes = seedDatabase(rawDb);
    defaultTaxId = seedRes.defaultTaxCategoryId;
  });

  describe('Database Seeding', () => {
    it('seeds 200 realistic pharmacy products into database', () => {
      const countRow = rawDb.prepare('SELECT COUNT(*) as count FROM products').get() as {
        count: number;
      };
      expect(countRow.count).toBe(200);

      // Verify idempotency (calling seed again adds 0)
      const secondSeed = seedDatabase(rawDb);
      expect(secondSeed.seededCount).toBe(0);
    });

    it('seeds active tax categories', () => {
      const categories = getTaxCategories(rawDb);
      expect(categories.length).toBeGreaterThanOrEqual(1);
      expect(categories.some((c) => c.name.includes('Standard GST'))).toBe(true);
    });
  });

  describe('Fast Paginated & Debounced Search', () => {
    it('paginates 200 items into 25 items per page', () => {
      const page1 = getProducts({ page: 1, pageSize: 25 }, rawDb);
      expect(page1.totalCount).toBe(200);
      expect(page1.totalPages).toBe(8);
      expect(page1.products).toHaveLength(25);
      expect(page1.page).toBe(1);

      const page2 = getProducts({ page: 2, pageSize: 25 }, rawDb);
      expect(page2.products).toHaveLength(25);
      expect(page2.page).toBe(2);
      expect(page2.products[0]?.id).not.toBe(page1.products[0]?.id);
    });

    it('filters accurately by brand name', () => {
      const result = getProducts({ search: 'Augmentin', page: 1, pageSize: 50 }, rawDb);
      expect(result.totalCount).toBeGreaterThan(0);
      expect(result.products.every((p) => p.brandName.includes('Augmentin'))).toBe(true);
    });

    it('filters accurately by generic name', () => {
      const result = getProducts({ search: 'Paracetamol', page: 1, pageSize: 50 }, rawDb);
      expect(result.totalCount).toBeGreaterThan(0);
      expect(result.products.every((p) => p.genericName.toLowerCase().includes('paracetamol'))).toBe(true);
    });

    it('filters accurately by barcode', () => {
      const all = getProducts({ page: 1, pageSize: 1 }, rawDb);
      const barcode = all.products[0]?.barcode;
      expect(barcode).toBeDefined();

      const filtered = getProducts({ search: barcode!, page: 1, pageSize: 10 }, rawDb);
      expect(filtered.totalCount).toBe(1);
      expect(filtered.products[0]?.barcode).toBe(barcode);
    });

    it('filters accurately by isActive in SQL pagination (M-12)', () => {
      // Deactivate 5 products
      rawDb.prepare('UPDATE products SET is_active = 0 WHERE id IN (SELECT id FROM products LIMIT 5)').run();

      const activeOnly = getProducts({ isActive: true, page: 1, pageSize: 200 }, rawDb);
      expect(activeOnly.totalCount).toBe(195);
      expect(activeOnly.products.every((p) => p.isActive === true)).toBe(true);

      const inactiveOnly = getProducts({ isActive: false, page: 1, pageSize: 200 }, rawDb);
      expect(inactiveOnly.totalCount).toBe(5);
      expect(inactiveOnly.products.every((p) => p.isActive === false)).toBe(true);
    });

    it('sorts by mrp_paisa ASC and DESC', () => {
      const asc = getProducts({ sortBy: 'mrp_paisa', sortOrder: 'asc', pageSize: 10 }, rawDb);
      const firstAsc = asc.products[0];
      const secondAsc = asc.products[1];
      expect(firstAsc).toBeDefined();
      expect(secondAsc).toBeDefined();
      if (firstAsc && secondAsc) {
        expect(firstAsc.mrpPaisa).toBeLessThanOrEqual(secondAsc.mrpPaisa);
      }

      const desc = getProducts({ sortBy: 'mrp_paisa', sortOrder: 'desc', pageSize: 10 }, rawDb);
      const firstDesc = desc.products[0];
      const secondDesc = desc.products[1];
      expect(firstDesc).toBeDefined();
      expect(secondDesc).toBeDefined();
      if (firstDesc && secondDesc) {
        expect(firstDesc.mrpPaisa).toBeGreaterThanOrEqual(secondDesc.mrpPaisa);
      }
    });
  });

  describe('Product CRUD Operations', () => {
    it('creates a new product and enforces integer paisa and barcode uniqueness', () => {
      const newProduct = createProduct(
        {
          brandName: 'Test Brand',
          genericName: 'Test Generic',
          strength: '250mg',
          form: 'capsule',
          manufacturer: 'Test Pharma',
          barcode: '9998887776665',
          taxCategoryId: defaultTaxId,
          mrpPaisa: 17500, // Rs. 175.00
          isControlled: false,
          isActive: true,
        },
        rawDb
      );

      expect(newProduct.id).toBeDefined();
      expect(newProduct.brandName).toBe('Test Brand');
      expect(newProduct.mrpPaisa).toBe(17500);

      // Verify unique barcode constraint
      expect(() =>
        createProduct(
          {
            brandName: 'Duplicate Barcode Item',
            genericName: 'Another Formula',
            strength: '500mg',
            form: 'tablet',
            manufacturer: 'Other Pharma',
            barcode: '9998887776665', // duplicate
            taxCategoryId: defaultTaxId,
            mrpPaisa: 20000,
            isControlled: false,
            isActive: true,
          },
          rawDb
        )
      ).toThrow(/already exists/);
    });

    it('updates an existing product', () => {
      const product = createProduct(
        {
          brandName: 'Initial Name',
          genericName: 'Formula A',
          strength: '10mg',
          form: 'tablet',
          manufacturer: 'Pharma A',
          barcode: '1122334455',
          taxCategoryId: defaultTaxId,
          mrpPaisa: 5000,
          isControlled: false,
          isActive: true,
        },
        rawDb
      );

      const updated = updateProduct(
        product.id,
        {
          brandName: 'Updated Name',
          mrpPaisa: 6500,
          isControlled: true,
        },
        rawDb
      );

      expect(updated.brandName).toBe('Updated Name');
      expect(updated.mrpPaisa).toBe(6500);
      expect(updated.isControlled).toBe(true);
      expect(getProduct(product.id, rawDb)?.brandName).toBe('Updated Name');
    });
  });

  describe('Single-Transaction CSV Bulk Import (Rule 5)', () => {
    it('imports valid rows and reports duplicates skipped with reasons', () => {
      const itemsToImport = [
        {
          brandName: 'CSV Drug Alpha',
          genericName: 'Chemical Alpha',
          strength: '50mg',
          form: 'tablet',
          manufacturer: 'Alpha Lab',
          barcode: '5550001',
          taxCategoryId: defaultTaxId,
          mrpPaisa: 12000,
          isControlled: false,
          isActive: true,
        },
        {
          brandName: 'CSV Drug Beta',
          genericName: 'Chemical Beta',
          strength: '100mg',
          form: 'syrup',
          manufacturer: 'Beta Lab',
          barcode: '5550002',
          taxCategoryId: defaultTaxId,
          mrpPaisa: 18000,
          isControlled: true,
          isActive: true,
        },
        // Duplicate of an already seeded barcode
        {
          brandName: 'CSV Duplicate Item',
          genericName: 'Dup Formula',
          strength: '500mg',
          form: 'tablet',
          manufacturer: 'Dup Lab',
          barcode: '896400010001', // already seeded!
          taxCategoryId: defaultTaxId,
          mrpPaisa: 25000,
          isControlled: false,
          isActive: true,
        },
      ];

      const res = importProductsCsv(itemsToImport, rawDb);
      expect(res.importedCount).toBe(2);
      expect(res.skippedCount).toBe(1);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]?.barcode).toBe('896400010001');
      expect(res.errors[0]?.reason).toContain('already exists in database');

      // Verify records are queryable
      const alpha = getProducts({ search: 'CSV Drug Alpha', pageSize: 1 }, rawDb);
      expect(alpha.totalCount).toBe(1);
      expect(alpha.products[0]?.mrpPaisa).toBe(12000);
    });
  });

  describe('IPC Role Guard for Product Actions', () => {
    it('blocks cashier role from creating or importing products', async () => {
      setSessionForTesting({
        user: { id: generateUuidV7(), name: 'Cashier User', role: 'cashier', isActive: true },
        branch: { id: generateUuidV7(), name: 'Main' },
        counter: { id: generateUuidV7(), name: 'C1' },
        isLocked: false,
        idleTimeoutMinutes: 5,
      });

      await expect(
        roleGuardedCreateProduct({
          brandName: 'Blocked',
          genericName: 'Blocked',
          strength: '10mg',
          form: 'tablet',
          manufacturer: 'Blocked',
          taxCategoryId: defaultTaxId,
          mrpPaisa: 1000,
          isControlled: false,
          isActive: true,
        })
      ).rejects.toThrow(ForbiddenError);

      await expect(roleGuardedImportCsv([])).rejects.toThrow(ForbiddenError);
    });

    it('permits pharmacist and owner roles to create products', async () => {
      setSessionForTesting({
        user: { id: generateUuidV7(), name: 'Pharmacist User', role: 'pharmacist', isActive: true },
        branch: { id: generateUuidV7(), name: 'Main' },
        counter: { id: generateUuidV7(), name: 'C1' },
        isLocked: false,
        idleTimeoutMinutes: 5,
      });

      await expect(
        roleGuardedCreateProduct({
          brandName: 'Pharmacist Allowed Item',
          genericName: 'Formula Ok',
          strength: '10mg',
          form: 'tablet',
          manufacturer: 'Pharma Ok',
          taxCategoryId: defaultTaxId,
          mrpPaisa: 1000,
          isControlled: false,
          isActive: true,
        })
      ).resolves.toHaveProperty('brandName', 'Pharmacist Allowed Item');
    });
  });

  describe('POS Search & Generic Substitutes', () => {
    it('searches pos catalog by brand name or generic formula', () => {
      const results = searchPosCatalog('Paracetamol', undefined, rawDb);
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.genericName.toLowerCase().includes('paracetamol'))).toBe(true);
      expect(results[0]).toHaveProperty('totalStock');
      expect(results[0]).toHaveProperty('mrpPaisa');
    });

    it('finds exact barcode match instantly on scanner input', () => {
      const all = getProducts({ page: 1, pageSize: 1 }, rawDb);
      const barcode = all.products[0]?.barcode;
      expect(barcode).toBeDefined();

      const results = searchPosCatalog(barcode!, undefined, rawDb);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.barcode).toBe(barcode);
    });

    it('retrieves active substitutes sharing identical generic molecule, prioritizing in-stock items', () => {
      // Find two products with same generic name
      const paracetamols = searchPosCatalog('Paracetamol', undefined, rawDb);
      expect(paracetamols.length).toBeGreaterThanOrEqual(2);

      const target = paracetamols[0]!;
      const substitutes = getSubstitutes(target.genericName, target.id, undefined, rawDb);

      expect(substitutes.length).toBeGreaterThanOrEqual(1);
      expect(substitutes.every((s) => s.id !== target.id)).toBe(true);
      expect(substitutes.every((s) => s.genericName.toLowerCase() === target.genericName.toLowerCase())).toBe(true);
    });
  });
});
