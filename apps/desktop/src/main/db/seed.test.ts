import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initDatabase, getDatabase, closeDatabase } from '../db';
import { seedDatabase, shouldAutoSeedOnStartup, runStartupAutoSeed, cleanupDemoData } from './seed';
import { generateUuidV7 } from '@pos/shared';

describe('F-C-01: seedDatabase production guard and safe demo-data cleanup tool', () => {
  let tempDir: string;
  let dbPath: string;
  let backupDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-fc01-test-'));
    dbPath = path.join(tempDir, 'counter.db');
    backupDir = path.join(tempDir, 'backups');
    initDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('refuses to run seedDatabase when isPackaged is true', () => {
    const db = getDatabase();
    expect(() => seedDatabase(db, { isPackaged: true })).toThrow(/packaged/i);

    const productCount = (
      db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number }
    ).count;
    expect(productCount).toBe(0);
  });

  it('only auto-seeds on startup when !isPackaged AND explicit POS_DEV_AUTO_SEED=true flag is set', () => {
    const db = getDatabase();

    expect(shouldAutoSeedOnStartup({ isPackaged: true, env: { POS_DEV_AUTO_SEED: 'true' } })).toBe(
      false
    );
    expect(shouldAutoSeedOnStartup({ isPackaged: false, env: {} })).toBe(false);
    expect(
      shouldAutoSeedOnStartup({ isPackaged: false, env: { POS_DEV_AUTO_SEED: 'false' } })
    ).toBe(false);
    expect(shouldAutoSeedOnStartup({ isPackaged: false, env: { POS_DEV_AUTO_SEED: 'true' } })).toBe(
      true
    );

    // Startup without flag must NOT seed anything
    const resNoFlag = runStartupAutoSeed({ db, isPackaged: false, env: {} });
    expect(resNoFlag.seeded).toBe(false);
    expect(
      (db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number }).count
    ).toBe(0);

    // Startup in packaged mode even with flag must NOT seed anything
    const resPackaged = runStartupAutoSeed({
      db,
      isPackaged: true,
      env: { POS_DEV_AUTO_SEED: 'true' },
    });
    expect(resPackaged.seeded).toBe(false);
    expect(
      (db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number }).count
    ).toBe(0);

    // Startup in unpackaged dev mode WITH explicit flag seeds 200 demo products
    const resDev = runStartupAutoSeed({
      db,
      isPackaged: false,
      env: { POS_DEV_AUTO_SEED: 'true' },
    });
    expect(resDev.seeded).toBe(true);
    expect(
      (db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number }).count
    ).toBe(200);
  });

  it('cleanupDemoData is owner-only, dry-run by default, backs up first, and preserves real or referenced rows', async () => {
    const db = getDatabase();
    const { defaultTaxCategoryId } = seedDatabase(db, { isPackaged: false });

    // Insert 1 real custom product and 1 real custom supplier
    const realProductId = generateUuidV7();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer,
        barcode, tax_category_id, mrp_paisa, is_controlled, is_active, created_at, updated_at
      ) VALUES (?, 'Real Custom Med', 'Custom Generic', '50mg', 'tablet', 'Local Pharma', '999999999999', ?, 50000, 0, 1, ?, ?)`
    ).run(realProductId, defaultTaxCategoryId, now, now);

    const realSupplierId = generateUuidV7();
    db.prepare(
      `INSERT INTO suppliers (id, name, contact_person, phone, email, address, created_at, updated_at)
       VALUES (?, 'Real Pharma Supplier', 'Ali', '03001234567', 'real@supplier.pk', 'Karachi', ?, ?)`
    ).run(realSupplierId, now, now);

    // Reference 1 demo product in a batch so it must be preserved (never delete referenced rows)
    const demoProduct = db
      .prepare("SELECT id FROM products WHERE barcode = '896400010001'")
      .get() as { id: string };
    const batchId = generateUuidV7();
    db.prepare(
      `INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
       VALUES (?, ?, 'B-001', '2028-12-31', 5000, 8500, ?, ?)`
    ).run(batchId, demoProduct.id, now, now);

    // 1. Non-owner roles must be rejected
    await expect(cleanupDemoData({ userRole: 'cashier', db, backupDir })).rejects.toThrow(/Owner/i);
    await expect(cleanupDemoData({ userRole: 'pharmacist', db, backupDir })).rejects.toThrow(
      /Owner/i
    );

    // 2. Default invocation is dryRun: true -> reports counts and deletes nothing
    const dryRes = await cleanupDemoData({ userRole: 'owner', db, backupDir });
    expect(dryRes.dryRun).toBe(true);
    expect(dryRes.candidateProductsCount).toBe(199);
    expect(dryRes.skippedReferencedProductsCount).toBe(1);
    expect(dryRes.candidateSuppliersCount).toBe(5);
    expect(dryRes.deletedProductsCount).toBe(0);
    expect(dryRes.deletedSuppliersCount).toBe(0);
    expect(dryRes.backupInfo).toBeNull();
    expect(
      (db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number }).count
    ).toBe(201);

    // 3. Execute with dryRun: false -> creates backup first, removes 199 unreferenced demo products & 5 demo suppliers
    const execRes = await cleanupDemoData({
      userRole: 'owner',
      dryRun: false,
      db,
      backupDir,
    });
    expect(execRes.dryRun).toBe(false);
    expect(execRes.backupInfo).not.toBeNull();
    expect(fs.existsSync(execRes.backupInfo!.filePath)).toBe(true);
    expect(execRes.deletedProductsCount).toBe(199);
    expect(execRes.deletedSuppliersCount).toBe(5);

    // Only the 1 real product + 1 referenced demo product remain (2 total)
    const remainingProducts = db.prepare('SELECT id FROM products').all() as { id: string }[];
    expect(remainingProducts.map((p) => p.id).sort()).toEqual(
      [realProductId, demoProduct.id].sort()
    );

    // Only the 1 real supplier remains
    const remainingSuppliers = db.prepare('SELECT id FROM suppliers').all() as { id: string }[];
    expect(remainingSuppliers.map((s) => s.id)).toEqual([realSupplierId]);
  });
});
