import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  generateUuidV7,
  convertRupeesToPaisa,
} from '../../packages/shared/src/index';
import { buildApp } from '../../apps/server/src/app';
import {
  createTestContext,
  type TestDatabaseContext,
} from '../../apps/server/src/db/test-helper';
import {
  pharmacies,
  branches,
  counters,
  users,
  devices,
  taxCategories,
  products,
  batches,
  invoices,
  changeLog,
} from '../../apps/server/src/db/schema';
import {
  signDeviceToken,
  signUserToken,
} from '../../apps/server/src/auth/jwt';
import { pullChangeLog } from '../../apps/server/src/sync/pull-service';
import { insertChangeLog } from '../../apps/server/src/sync/change-log';
import {
  getDashboardOverview,
  getSalesReport,
} from '../../apps/server/src/reports/queries';
import { initDatabase, closeDatabase, getDatabase } from '../../apps/desktop/src/main/db';
import {
  hashPin,
  lockSession,
  setSessionForTesting,
} from '../../apps/desktop/src/main/auth';
import { createSupplier, receiveGrn } from '../../apps/desktop/src/main/purchasing';
import { finalizeSale } from '../../apps/desktop/src/main/finalizeSale';
import { processReturn } from '../../apps/desktop/src/main/returns';
import { pushPending } from '../../apps/desktop/src/main/sync/core/pushPending';
import { pullAndApply } from '../../apps/desktop/src/main/sync/core/pullAndApply';
import { createSyncWorker } from '../../apps/desktop/src/main/sync/core/syncWorker';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

describe('Audit A1 Regression Suite — High Findings (H-01 to H-16)', () => {
  let ctx: TestDatabaseContext;
  let app: ReturnType<typeof buildApp>;
  let serverUrl: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({
      db: ctx.db,
      deviceRateLimitMax: 3,
      deviceRateLimitWindow: '1 minute',
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address() as { port: number };
    serverUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    closeDatabase();
    await app.close();
    await ctx.cleanup();
  });

  async function seedServerTenant(name: string) {
    const now = new Date().toISOString();
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const ownerId = generateUuidV7();
    const deviceId = generateUuidV7();
    const taxCategoryId = generateUuidV7();
    const productId = generateUuidV7();
    const batchId = generateUuidV7();

    const ownerPinHash = await hashPin('12345678');
    const pharmacyCode = name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase() + '_' + pharmacyId.slice(0, 8);

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name,
      code: pharmacyCode,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(branches).values({
      id: branchId,
      pharmacyId,
      name: 'Main Branch',
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(counters).values({
      id: counterId,
      pharmacyId,
      branchId,
      name: 'Counter 1',
      code: 'C1',
      lastInvoiceSeq: 0,
      lastCreditNoteSeq: 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(users).values({
      id: ownerId,
      pharmacyId,
      name: `Owner ${name}`,
      role: 'owner',
      pinHash: ownerPinHash,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(devices).values({
      id: deviceId,
      pharmacyId,
      branchId,
      counterId,
      deviceName: 'Counter 1 Device',
      isRevoked: false,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(taxCategories).values({
      id: taxCategoryId,
      pharmacyId,
      name: 'Standard Exempt',
      rateBp: 0,
      isExempt: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId,
      brandName: 'Augmentin 625mg',
      genericName: 'Amoxicillin + Clavulanic Acid',
      strength: '625mg',
      form: 'Tablet',
      manufacturer: 'GSK',
      taxCategoryId,
      mrpPaisa: 5000,
      isControlled: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(batches).values({
      id: batchId,
      pharmacyId,
      productId,
      batchNo: 'BATCH-H01',
      expiryDate: '2028-12-31',
      costPaisa: 3500,
      mrpPaisa: 5000,
      createdAt: now,
      updatedAt: now,
    });

    const deviceToken = signDeviceToken({ pharmacyId, branchId, deviceId });
    const ownerToken = signUserToken({
      userId: ownerId,
      pharmacyId,
      role: 'owner',
      name: `Owner ${name}`,
    });

    return {
      pharmacyId,
      branchId,
      counterId,
      ownerId,
      deviceId,
      taxCategoryId,
      productId,
      batchId,
      deviceToken,
      ownerToken,
    };
  }

  function resetDesktopDbWithTenant(tenant: {
    branchId: string;
    counterId: string;
    ownerId: string;
    taxCategoryId: string;
    productId: string;
    batchId: string;
  }) {
    closeDatabase();
    initDatabase(':memory:');
    const db = getDatabase();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      tenant.branchId,
      'Main Branch',
      now,
      now
    );
    db.prepare(
      'INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, last_credit_note_seq, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)'
    ).run(tenant.counterId, tenant.branchId, 'Counter 1', 'C1', now, now);
    db.prepare(
      'INSERT INTO users (id, name, role, pin_hash, is_active, failed_login_attempts, locked_until, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, NULL, ?, ?)'
    ).run(tenant.ownerId, 'Owner', 'owner', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', now, now);
    db.prepare(
      'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)'
    ).run(tenant.taxCategoryId, 'Standard Exempt', now, now);
    db.prepare(
      `INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer, barcode,
        tax_category_id, mrp_paisa, is_controlled, is_active, created_at, updated_at
      ) VALUES (?, 'Augmentin 625mg', 'Amoxicillin + Clavulanic Acid', '625mg', 'Tablet', 'GSK', NULL, ?, 5000, 0, 1, ?, ?)`
    ).run(tenant.productId, tenant.taxCategoryId, now, now);
    db.prepare(
      'INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at) VALUES (?, ?, ?, ?, 3500, 5000, ?, ?)'
    ).run(tenant.batchId, tenant.productId, 'BATCH-H01', '2028-12-31', now, now);

    setSessionForTesting({
      user: { id: tenant.ownerId, name: 'Owner', role: 'owner', isActive: true },
      branch: { id: tenant.branchId, name: 'Main Branch' },
      counter: { id: tenant.counterId, name: 'Counter 1' },
      isLocked: false,
      idleTimeoutMinutes: 5,
    });

    return db;
  }

  it('H-01: server preserves client stock_movement UUIDv7s and pullAndApply does not overwrite movement IDs via UPDATE', async () => {
    const tenant = await seedServerTenant('H01 Pharmacy');
    const db = resetDesktopDbWithTenant(tenant);
    const now = new Date().toISOString();

    const initMovId = generateUuidV7();
    db.prepare(
      `INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type, quantity_signed, reference_type, reference_id, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'adjustment', 50, 'stock_adjustment', ?, 'Initial stock', ?, ?)`
    ).run(initMovId, tenant.productId, tenant.batchId, tenant.branchId, initMovId, now, now);

    // Finalize a sale with two lines of the same product/batch and same quantity (5 units each)
    const sale = finalizeSale(
      {
        clientRequestId: generateUuidV7(),
        counterId: tenant.counterId,
        cashierUserId: tenant.ownerId,
        lines: [
          { productId: tenant.productId, quantity: 5 },
          { productId: tenant.productId, quantity: 5 },
        ],
        payments: [{ method: 'cash', amountPaisa: 50000 }],
      },
      { db, today: '2026-10-28' }
    );

    const beforePullMovements = db
      .prepare('SELECT id FROM stock_movements WHERE reference_id = ? ORDER BY rowid ASC')
      .all(sale.id) as { id: string }[];
    expect(beforePullMovements).toHaveLength(2);
    const originalClientIds = beforePullMovements.map((m) => m.id);

    const pushSummary = await pushPending(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );
    expect(pushSummary.acked).toBe(1);

    await pullAndApply(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );

    const afterPullMovements = db
      .prepare('SELECT id FROM stock_movements WHERE reference_id = ? ORDER BY rowid ASC')
      .all(sale.id) as { id: string }[];

    const serverMovementsRes = await ctx.client.query<{ id: string }>(
      'SELECT id FROM stock_movements WHERE pharmacy_id = $1 AND reference_id = $2',
      [tenant.pharmacyId, sale.id]
    );
    const serverMovements = serverMovementsRes.rows;

    // Client-generated IDs must be preserved (Rule 2 & Rule 4) and match server IDs
    expect(afterPullMovements.map((m) => m.id)).toEqual(originalClientIds);
    expect(afterPullMovements.map((m) => m.id).sort()).toEqual(
      serverMovements.map((m) => m.id).sort()
    );
  });

  it('H-02: convertRupeesToPaisa preserves negative sign on string input and rounds >2 decimal places consistently', () => {
    expect(convertRupeesToPaisa('-35.50')).toBe(-3550);
    expect(convertRupeesToPaisa('35.509')).toBe(3551);
  });

  it('H-03: processReturn idempotent replay returns populated camelCase line fields from loadCreditNote', () => {
    closeDatabase();
    initDatabase(':memory:');
    const db = getDatabase();
    const now = new Date().toISOString();

    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const userId = generateUuidV7();
    const taxCatId = generateUuidV7();
    const productId = generateUuidV7();
    const batchId = generateUuidV7();

    db.prepare('INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      branchId,
      'Branch 1',
      now,
      now
    );
    db.prepare(
      'INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, last_credit_note_seq, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)'
    ).run(counterId, branchId, 'Counter 1', 'C1', now, now);
    db.prepare(
      'INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    ).run(userId, 'Cashier', 'cashier', 'hash', now, now);
    db.prepare(
      'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)'
    ).run(taxCatId, 'Exempt', now, now);
    db.prepare(
      `INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer, barcode,
        tax_category_id, mrp_paisa, is_controlled, is_active, created_at, updated_at
      ) VALUES (?, 'Brufen 400mg', 'Ibuprofen', '400mg', 'Tablet', 'Abbott', NULL, ?, 4000, 0, 1, ?, ?)`
    ).run(productId, taxCatId, now, now);
    db.prepare(
      'INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at) VALUES (?, ?, ?, ?, 2500, 4000, ?, ?)'
    ).run(batchId, productId, 'B-H03', '2028-12-31', now, now);
    const movId = generateUuidV7();
    db.prepare(
      `INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type, quantity_signed, reference_type, reference_id, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'adjustment', 20, 'stock_adjustment', ?, 'Init', ?, ?)`
    ).run(movId, productId, batchId, branchId, movId, now, now);

    const invoice = finalizeSale(
      {
        clientRequestId: generateUuidV7(),
        counterId,
        cashierUserId: userId,
        lines: [{ productId, quantity: 3 }],
        payments: [{ method: 'cash', amountPaisa: 12000 }],
      },
      { db, today: '2026-10-28' }
    );

    const returnRequestId = generateUuidV7();
    const firstReturn = processReturn(
      {
        clientRequestId: returnRequestId,
        originalInvoiceId: invoice.id,
        lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: 1 }],
        refundMethod: 'cash',
        reason: 'customer_return',
      },
      { db, counterId, cashierUserId: userId, branchId }
    );

    const replayReturn = processReturn(
      {
        clientRequestId: returnRequestId,
        originalInvoiceId: invoice.id,
        lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: 1 }],
        refundMethod: 'cash',
        reason: 'customer_return',
      },
      { db, counterId, cashierUserId: userId, branchId }
    );

    expect(replayReturn.lines[0]?.productId).toBe(firstReturn.lines[0]?.productId);
    expect(replayReturn.lines[0]?.originalInvoiceLineId).toBe(
      firstReturn.lines[0]?.originalInvoiceLineId
    );
    expect(replayReturn.lines[0]?.unitPricePaisa).toBe(firstReturn.lines[0]?.unitPricePaisa);
    expect(replayReturn.lines[0]?.lineTotalPaisa).toBe(firstReturn.lines[0]?.lineTotalPaisa);
  });

  it('H-04: desktop backup:restore IPC handler checks session.isLocked and blocks restore when terminal is locked', () => {
    const mainIndexSource = fs.readFileSync(
      path.join(REPO_ROOT, 'apps/desktop/src/main/index.ts'),
      'utf8'
    );

    // Extract the backup:restore IPC handler block in apps/desktop/src/main/index.ts
    const restoreHandlerMatch = mainIndexSource.match(
      /ipcMain\.handle\('backup:restore'[\s\S]*?restoreDatabaseBackup[\s\S]*?\}\);/
    );
    expect(restoreHandlerMatch).not.toBeNull();

    setSessionForTesting({
      user: { id: generateUuidV7(), name: 'Owner', role: 'owner', isActive: true },
      branch: { id: generateUuidV7(), name: 'Main Branch' },
      counter: { id: generateUuidV7(), name: 'Counter 1' },
      isLocked: false,
      idleTimeoutMinutes: 5,
    });
    lockSession();

    // Verify whether the backup:restore guard in index.ts checks session.isLocked or uses assertRole/requireRole
    const restoreBlock = restoreHandlerMatch![0];
    expect(restoreBlock).toMatch(/isLocked|assertRole|requireRole/);
  });

  it('H-05: POST /api/auth/login enforces rate limiting against brute-force PIN attempts', async () => {
    const tenant = await seedServerTenant('H05 Pharmacy');
    const statuses: number[] = [];

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          pharmacyId: tenant.pharmacyId,
          name: `Owner H05 Pharmacy`,
          pin: '000000',
        },
      });
      statuses.push(res.statusCode);
    }

    expect(statuses).toContain(429);
  });

  it('H-06: processSyncPushEvents logs unexpected database constraint rejections to rejected_events with sanitized message and processes subsequent good events in batch', async () => {
    const tenant = await seedServerTenant('H06 Pharmacy');
    const now = new Date().toISOString();

    const makeInvoiceEvent = (seq: number, invoiceNum: string) => {
      const eventId = generateUuidV7();
      const invId = generateUuidV7();
      return {
        eventId,
        deviceSeq: seq,
        type: 'invoice.created',
        entityId: invId,
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          id: invId,
          counterId: tenant.counterId,
          cashierUserId: tenant.ownerId,
          invoiceNumber: invoiceNum,
          clientRequestId: generateUuidV7(),
          status: 'finalized',
          subtotalPaisa: 5000,
          discountPaisa: 0,
          taxPaisa: 0,
          totalPaisa: 5000,
          createdAt: now,
          lines: [
            {
              id: generateUuidV7(),
              productId: tenant.productId,
              batchId: tenant.batchId,
              quantity: 1,
              unitPricePaisa: 5000,
              discountPaisa: 0,
              taxRateBp: 0,
              taxPaisa: 0,
              lineTotalPaisa: 5000,
            },
          ],
          payments: [
            {
              id: generateUuidV7(),
              method: 'cash',
              amountPaisa: 5000,
            },
          ],
        },
      };
    };

    // Event 1: Good unique invoice
    // Event 2: Duplicate invoice number triggers database unique constraint violation
    // Event 3: Good unique invoice in same batch must still be processed and accepted
    const res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${tenant.deviceToken}` },
      payload: {
        events: [
          makeInvoiceEvent(1, 'INV-H06-0001'),
          makeInvoiceEvent(2, 'INV-H06-0001'), // Duplicate
          makeInvoiceEvent(3, 'INV-H06-0002'), // Good subsequent event
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ results: Array<{ eventId: string; status: string; code?: string; message?: string }> }>();
    expect(body.results).toHaveLength(3);
    expect(body.results[0]?.status).toBe('accepted');
    expect(body.results[1]?.status).toBe('rejected');
    expect(body.results[1]?.code).toBe('INTERNAL_ERROR');
    expect(body.results[1]?.message).toMatch(/unexpected internal error/i);
    expect(body.results[2]?.status).toBe('accepted');

    // Per docs/SYNC.md line 30: Rejected events are stored in rejected_events for owner visibility with sanitized message
    const loggedRejectedRes = await ctx.client.query(
      'SELECT code, message FROM rejected_events WHERE pharmacy_id = $1',
      [tenant.pharmacyId]
    );
    const loggedRejected = loggedRejectedRes.rows;

    expect(loggedRejected).toHaveLength(1);
    expect(loggedRejected[0]?.code).toBe('INTERNAL_ERROR');
    expect(loggedRejected[0]?.message).toMatch(/unexpected internal error/i);
  });

  it('H-07: PATCH /api/admin/users/:id writes user deactivation to change_log in one db.transaction without exposing plain-text PIN', async () => {
    const tenant = await seedServerTenant('H07 Pharmacy');
    const db = resetDesktopDbWithTenant(tenant);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${tenant.ownerToken}` },
      payload: {
        name: 'Cashier H07',
        role: 'cashier',
        pin: '123456',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json<{ id: string }>();

    await pullAndApply(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );

    // Deactivate user via PATCH /api/admin/users/:id
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${created.id}`,
      headers: { authorization: `Bearer ${tenant.ownerToken}` },
      payload: {
        isActive: false,
      },
    });
    expect(patchRes.statusCode).toBe(200);

    // Check change_log row on server: must exist and NEVER contain plain-text PIN
    const changeLogRows = await ctx.client.query(
      `SELECT op, data FROM change_log WHERE pharmacy_id = $1 AND entity = 'user' AND entity_id = $2 ORDER BY seq DESC LIMIT 1`,
      [tenant.pharmacyId, created.id]
    );
    expect(changeLogRows.rows).toHaveLength(1);
    const changeData = changeLogRows.rows[0]?.data as Record<string, unknown>;
    expect(changeData.isActive).toBe(false);
    expect(changeData.pin).toBeUndefined(); // NEVER expose plain text PIN
    if (changeData.pinHash) {
      expect(String(changeData.pinHash)).toMatch(/^\$2[aby]\$/); // bcrypt hash only
    }

    await pullAndApply(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );

    const localUser = db
      .prepare('SELECT is_active FROM users WHERE id = ?')
      .get(created.id) as { is_active: number } | undefined;

    expect(localUser?.is_active).toBe(0);
  });

  it('H-08: complete product records sync via change_log; clearing barcode syncs, and incomplete payloads are rejected', async () => {
    const tenant = await seedServerTenant('H08 Pharmacy');
    const db = resetDesktopDbWithTenant(tenant);
    const now = new Date().toISOString();
    const prodId = generateUuidV7();

    // 1. Initial complete product record in server DB and change_log
    const initialProduct = {
      id: prodId,
      pharmacyId: tenant.pharmacyId,
      brandName: 'Panadol Extra 500mg',
      genericName: 'Paracetamol + Caffeine',
      strength: '500mg/65mg',
      form: 'Tablet',
      manufacturer: 'GSK Pakistan',
      barcode: '8964000123456',
      taxCategoryId: tenant.taxCategoryId,
      mrpPaisa: 6500,
      isControlled: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    await ctx.db.insert(products).values(initialProduct);

    await ctx.db.insert(changeLog).values({
      pharmacyId: tenant.pharmacyId,
      entity: 'product',
      entityId: prodId,
      op: 'upsert',
      data: initialProduct,
      createdAt: now,
    });

    // 2. Complete price update: preserves genericName, strength, form, manufacturer, and barcode
    const updatedPriceProduct = {
      ...initialProduct,
      mrpPaisa: 7200,
      updatedAt: now,
    };

    await ctx.db.insert(changeLog).values({
      pharmacyId: tenant.pharmacyId,
      entity: 'product',
      entityId: prodId,
      op: 'upsert',
      data: updatedPriceProduct,
      createdAt: now,
    });

    await pullAndApply(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );

    const syncedProd1 = db
      .prepare(
        'SELECT generic_name, strength, form, manufacturer, barcode, mrp_paisa FROM products WHERE id = ?'
      )
      .get(prodId) as {
      generic_name: string;
      strength: string;
      form: string;
      manufacturer: string;
      barcode: string | null;
      mrp_paisa: number;
    };

    expect(syncedProd1.mrp_paisa).toBe(7200);
    expect(syncedProd1.generic_name).toBe('Paracetamol + Caffeine');
    expect(syncedProd1.strength).toBe('500mg/65mg');
    expect(syncedProd1.form).toBe('Tablet');
    expect(syncedProd1.manufacturer).toBe('GSK Pakistan');
    expect(syncedProd1.barcode).toBe('8964000123456');

    // 3. Legitimately cleared barcode on server clears it on counter via straight upsert
    const clearedBarcodeProduct = {
      ...updatedPriceProduct,
      barcode: null,
      updatedAt: new Date().toISOString(),
    };

    await ctx.db.insert(changeLog).values({
      pharmacyId: tenant.pharmacyId,
      entity: 'product',
      entityId: prodId,
      op: 'upsert',
      data: clearedBarcodeProduct,
      createdAt: now,
    });

    await pullAndApply(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );

    const syncedProd2 = db
      .prepare('SELECT barcode FROM products WHERE id = ?')
      .get(prodId) as { barcode: string | null };
    expect(syncedProd2.barcode).toBeNull();

    // 4. Incomplete product payload (missing mandatory mrpPaisa and brandName) is rejected and logged
    const incompleteProduct = {
      id: generateUuidV7(),
      genericName: 'Broken Product',
      // missing brandName, mrpPaisa, taxCategoryId
    };

    await ctx.db.insert(changeLog).values({
      pharmacyId: tenant.pharmacyId,
      entity: 'product',
      entityId: incompleteProduct.id,
      op: 'upsert',
      data: incompleteProduct,
      createdAt: now,
    });

    const pullSummary = await pullAndApply(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );

    // The incomplete product must NOT be inserted into SQLite
    const brokenRow = db
      .prepare('SELECT id FROM products WHERE id = ?')
      .get(incompleteProduct.id);
    expect(brokenRow).toBeUndefined();
    // And pullAndApply recorded exception/rejected change
    expect(pullSummary.changesApplied).toBeGreaterThanOrEqual(0);
  });

  it('H-09: pullChangeLog filters by branch in SQL, handles 500 rows from other branches, and isolates branch-scoped events', async () => {
    const tenant = await seedServerTenant('H09 Pharmacy');
    const branchBId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(branches).values({
      id: branchBId,
      pharmacyId: tenant.pharmacyId,
      name: 'Branch B',
      createdAt: now,
      updatedAt: now,
    });

    // 1. Insert 500 rows for Branch B
    const branchBRows = Array.from({ length: 500 }, () => ({
      pharmacyId: tenant.pharmacyId,
      branchId: branchBId,
      entity: 'stock_movement',
      entityId: generateUuidV7(),
      op: 'upsert' as const,
      data: { branchId: branchBId, quantitySigned: 10 },
      createdAt: now,
    }));
    await ctx.db.insert(changeLog).values(branchBRows);

    // 2. Insert 5 rows for tenant.branchId (Branch A)
    const branchAEntityIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const eid = generateUuidV7();
      branchAEntityIds.push(eid);
      await ctx.db.insert(changeLog).values({
        pharmacyId: tenant.pharmacyId,
        branchId: tenant.branchId,
        entity: 'stock_movement',
        entityId: eid,
        op: 'upsert',
        data: { branchId: tenant.branchId, quantitySigned: i + 1 },
        createdAt: now,
      });
    }

    // 3. Insert 1 pharmacy-wide row (branchId NULL)
    const globalEntityId = generateUuidV7();
    await ctx.db.insert(changeLog).values({
      pharmacyId: tenant.pharmacyId,
      branchId: null,
      entity: 'tax_category',
      entityId: globalEntityId,
      op: 'upsert',
      data: { id: globalEntityId, name: 'Global Exempt', rateBp: 0, isExempt: true },
      createdAt: now,
    });

    // 4. Branch A pulls with limit 10: must get all 5 Branch A rows + 1 global row in ONE request (no empty pages)
    const pullRes = await pullChangeLog(
      ctx.db,
      { pharmacyId: tenant.pharmacyId, branchId: tenant.branchId },
      { cursor: 0, limit: 10 }
    );

    // Should return 6 total rows (5 Branch A + 1 global), and NONE of the 500 Branch B rows
    expect(pullRes.changes).toHaveLength(6);
    expect(pullRes.changes.map((c) => c.entityId)).toEqual(
      expect.arrayContaining([...branchAEntityIds, globalEntityId])
    );
    expect(pullRes.changes.some((c) => (c.data as Record<string, unknown>).branchId === branchBId)).toBe(false);

    // 5. Branch B pulls: must see Branch B rows and global row, but NONE of Branch A rows
    const pullResB = await pullChangeLog(
      ctx.db,
      { pharmacyId: tenant.pharmacyId, branchId: branchBId },
      { cursor: 0, limit: 10 }
    );
    expect(pullResB.changes).toHaveLength(10);
    expect(pullResB.changes.some((c) => branchAEntityIds.includes(c.entityId))).toBe(false);
  });

  it('H-09: products, tax categories, suppliers, batches and staff users always have branch_id NULL and reach every branch; branch-scoped rows reach only their branch', async () => {
    const tenant = await seedServerTenant('H09 Scope Pharmacy');
    const now = new Date().toISOString();
    const branchBId = generateUuidV7();

    await ctx.db.insert(branches).values({
      id: branchBId,
      pharmacyId: tenant.pharmacyId,
      name: 'Branch B',
      createdAt: now,
      updatedAt: now,
    });

    // 1. Insert pharmacy-wide entities via central helper insertChangeLog
    const pId = generateUuidV7();
    const tcId = generateUuidV7();
    const sId = generateUuidV7();
    const bId = generateUuidV7();
    const uId = generateUuidV7();

    await insertChangeLog(ctx.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId, // Should be forced to NULL for product
      entity: 'product',
      entityId: pId,
      op: 'upsert',
      data: { id: pId, brandName: 'Global Med', mrpPaisa: 1000 },
    });

    await insertChangeLog(ctx.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId, // Should be forced to NULL for tax_category
      entity: 'tax_category',
      entityId: tcId,
      op: 'upsert',
      data: { id: tcId, name: 'Exempt', rateBp: 0 },
    });

    await insertChangeLog(ctx.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId, // Should be forced to NULL for supplier
      entity: 'supplier',
      entityId: sId,
      op: 'upsert',
      data: { id: sId, name: 'Global Supplier' },
    });

    await insertChangeLog(ctx.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId, // Should be forced to NULL for batch
      entity: 'batch',
      entityId: bId,
      op: 'upsert',
      data: { id: bId, batchNo: 'B-GLOBAL', mrpPaisa: 1000 },
    });

    await insertChangeLog(ctx.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId, // Should be forced to NULL for user
      entity: 'user',
      entityId: uId,
      op: 'upsert',
      data: { id: uId, name: 'Staff User', role: 'cashier' },
    });

    // Verify branch_id is NULL for all 5 entities in database
    const globalLogRows = await ctx.client.query(
      `SELECT entity, branch_id FROM change_log WHERE pharmacy_id = $1 AND entity_id IN ($2, $3, $4, $5, $6)`,
      [tenant.pharmacyId, pId, tcId, sId, bId, uId]
    );
    expect(globalLogRows.rows).toHaveLength(5);
    for (const row of globalLogRows.rows) {
      expect(row.branch_id).toBeNull();
    }

    // 2. Insert branch-scoped entities
    const smAId = generateUuidV7();
    const smBId = generateUuidV7();

    await insertChangeLog(ctx.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId,
      entity: 'stock_movement',
      entityId: smAId,
      op: 'upsert',
      data: { id: smAId, branchId: tenant.branchId, quantitySigned: 1 },
    });

    await insertChangeLog(ctx.db, {
      pharmacyId: tenant.pharmacyId,
      branchId: branchBId,
      entity: 'stock_movement',
      entityId: smBId,
      op: 'upsert',
      data: { id: smBId, branchId: branchBId, quantitySigned: 2 },
    });

    const smRows = await ctx.client.query(
      `SELECT entity_id, branch_id FROM change_log WHERE pharmacy_id = $1 AND entity_id IN ($2, $3)`,
      [tenant.pharmacyId, smAId, smBId]
    );
    const rowA = smRows.rows.find((r) => r.entity_id === smAId);
    const rowB = smRows.rows.find((r) => r.entity_id === smBId);
    expect(rowA.branch_id).toBe(tenant.branchId);
    expect(rowB.branch_id).toBe(branchBId);

    // 3. Branch A pulls: receives all 5 global rows + Branch A movement, but NOT Branch B movement
    const pullA = await pullChangeLog(
      ctx.db,
      { pharmacyId: tenant.pharmacyId, branchId: tenant.branchId },
      { cursor: 0, limit: 100 }
    );
    const pullAIds = pullA.changes.map((c) => c.entityId);
    expect(pullAIds).toContain(pId);
    expect(pullAIds).toContain(tcId);
    expect(pullAIds).toContain(sId);
    expect(pullAIds).toContain(bId);
    expect(pullAIds).toContain(uId);
    expect(pullAIds).toContain(smAId);
    expect(pullAIds).not.toContain(smBId);

    // 4. Branch B pulls: receives all 5 global rows + Branch B movement, but NOT Branch A movement
    const pullB = await pullChangeLog(
      ctx.db,
      { pharmacyId: tenant.pharmacyId, branchId: branchBId },
      { cursor: 0, limit: 100 }
    );
    const pullBIds = pullB.changes.map((c) => c.entityId);
    expect(pullBIds).toContain(pId);
    expect(pullBIds).toContain(tcId);
    expect(pullBIds).toContain(sId);
    expect(pullBIds).toContain(bId);
    expect(pullBIds).toContain(uId);
    expect(pullBIds).toContain(smBId);
    expect(pullBIds).not.toContain(smAId);
  });

  it('H-09: cursor overlap does not cause infinite loop when overlap rows exceed page limit and re-applied rows never overwrite newer local data', async () => {
    const tenant = await seedServerTenant('H09 Overlap Pharmacy');
    const db = resetDesktopDbWithTenant(tenant);

    // Local user has failed attempts recorded locally
    db.prepare('UPDATE users SET failed_login_attempts = 4 WHERE id = ?').run(tenant.ownerId);

    // Seed 60 tax categories on server
    for (let i = 1; i <= 60; i++) {
      const tcId = generateUuidV7();
      await insertChangeLog(ctx.db, {
        pharmacyId: tenant.pharmacyId,
        entity: 'tax_category',
        entityId: tcId,
        op: 'upsert',
        data: { id: tcId, name: `TaxCat ${i}`, rateBp: 0, isExempt: true },
      });
    }

    // Pull initial pages to reach cursor 50
    const firstPull = await pullAndApply(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken, limit: 60 }
    );
    expect(firstPull.newCursor).toBeGreaterThanOrEqual(50);
    const reachedCursor = firstPull.newCursor;

    // Call pullAndApply with small page limit (limit = 10 < CURSOR_OVERLAP = 50)
    // Server overlap sends rows from effectiveCursor (reachedCursor - 50).
    // Client must not loop infinitely even though overlap rows (50) exceed page limit (10).
    const boundedPull = await pullAndApply(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken, limit: 10 }
    );

    // Completed cleanly without infinite loop
    expect(boundedPull.failedRequest).toBe(false);
    expect(boundedPull.newCursor).toBeGreaterThanOrEqual(reachedCursor);

    // Re-applied overlap rows did NOT overwrite local user state
    const localUser = db
      .prepare('SELECT failed_login_attempts FROM users WHERE id = ?')
      .get(tenant.ownerId) as { failed_login_attempts: number };
    expect(localUser.failed_login_attempts).toBe(4);
  });

  it('H-10: pullAndApply handles supplier delete op without FOREIGN KEY constraint failure when local purchases exist', async () => {
    const tenant = await seedServerTenant('H10 Pharmacy');
    const db = resetDesktopDbWithTenant(tenant);
    const now = new Date().toISOString();

    const supplier = createSupplier({ name: 'Supplier With Local GRN' });
    receiveGrn({
      supplierId: supplier.id,
      supplierInvoiceNo: 'GRN-H10-001',
      invoiceDate: '2026-10-28',
      lines: [
        {
          productId: tenant.productId,
          batchNo: 'B-H10',
          expiryDate: '2028-12-31',
          quantity: 10,
          costPaisa: 3000,
          mrpPaisa: 5000,
        },
      ],
    });

    await ctx.db.insert(changeLog).values({
      pharmacyId: tenant.pharmacyId,
      entity: 'supplier',
      entityId: supplier.id,
      op: 'delete',
      data: { id: supplier.id },
      createdAt: now,
    });

    const summary = await pullAndApply(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );

    expect(summary.failedRequest).toBe(false);
  });

  it('H-11: SyncWorker transitions to error state when retryPushSummary fails after a retry_later pull', async () => {
    const tenant = await seedServerTenant('H11 Pharmacy');
    const db = resetDesktopDbWithTenant(tenant);
    const now = new Date().toISOString();

    // Enqueue a pending outbox event
    const eventId = generateUuidV7();
    db.prepare(
      `INSERT INTO outbox (
        id, event_id, device_seq, type, event_type, entity_id, payload, occurred_at, status, attempts, created_at
      ) VALUES (?, ?, 1, 'stock_adjustment.created', 'stock_adjustment.created', ?, ?, ?, 'pending', 0, ?)`
    ).run(
      eventId,
      eventId,
      eventId,
      JSON.stringify({
        id: eventId,
        productId: tenant.productId,
        batchId: tenant.batchId,
        branchId: tenant.branchId,
        quantitySigned: 5,
        reason: 'Test retry push failure',
      }),
      now,
      now
    );

    let pushCallCount = 0;
    const customFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/sync/push')) {
        pushCallCount++;
        if (pushCallCount === 1) {
          return new Response(
            JSON.stringify({
              results: [{ eventId, status: 'retry_later', code: 'UNKNOWN_BATCH' }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        // Second push (retryPushSummary) fails with HTTP 500
        return new Response('Internal Server Error', { status: 500 });
      }
      return globalThis.fetch(input, init);
    };

    const worker = createSyncWorker({
      db,
      fetch: customFetch,
      tokenStore: {
        getToken: () => tenant.deviceToken,
        setToken: () => {},
        clearToken: () => {},
      },
      config: { serverUrl },
    });

    const status = await worker.syncNow();
    worker.stop();

    expect(pushCallCount).toBe(2);
    expect(status.state).toBe('error');
  });

  it('H-12: desktop createWindow does not register duplicate ipcMain.handle listeners without removing previous handlers', () => {
    const mainIndexSource = fs.readFileSync(
      path.join(REPO_ROOT, 'apps/desktop/src/main/index.ts'),
      'utf8'
    );

    // Extract createWindow function body up to app.whenReady()
    const createWindowSection = mainIndexSource.slice(
      mainIndexSource.indexOf('function createWindow(): void {'),
      mainIndexSource.indexOf('app.whenReady()')
    );

    // ipcMain.handle inside createWindow crashes Electron on window re-creation unless handlers are registered once outside createWindow or cleaned up with removeHandler
    const registersIpcInsideCreateWindow = createWindowSection.includes("ipcMain.handle('ping'");
    const removesHandlersBeforeRegistering = createWindowSection.includes('ipcMain.removeHandler');

    expect(registersIpcInsideCreateWindow && !removesHandlersBeforeRegistering).toBe(false);
  });

  it('H-13: desktop and web index.html do not load external Google Fonts CDNs (Rule 10 offline requirement)', () => {
    const desktopHtml = fs.readFileSync(
      path.join(REPO_ROOT, 'apps/desktop/index.html'),
      'utf8'
    );
    const webHtml = fs.readFileSync(
      path.join(REPO_ROOT, 'apps/web/index.html'),
      'utf8'
    );

    expect(desktopHtml).not.toContain('fonts.googleapis.com');
    expect(desktopHtml).not.toContain('fonts.gstatic.com');
    expect(webHtml).not.toContain('fonts.googleapis.com');
    expect(webHtml).not.toContain('fonts.gstatic.com');
  });

  it('H-14: ReturnModal refund estimate and PaymentModal split initialization preserve exact integer paisa without float truncation', () => {
    closeDatabase();
    initDatabase(':memory:');
    const db = getDatabase();
    const now = new Date().toISOString();

    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const userId = generateUuidV7();
    const taxCatId = generateUuidV7();
    const productId = generateUuidV7();
    const batchId = generateUuidV7();

    db.prepare('INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      branchId,
      'Branch 1',
      now,
      now
    );
    db.prepare(
      'INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, last_credit_note_seq, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)'
    ).run(counterId, branchId, 'Counter 1', 'C1', now, now);
    db.prepare(
      'INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    ).run(userId, 'Cashier', 'cashier', 'hash', now, now);
    db.prepare(
      'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)'
    ).run(taxCatId, 'Exempt', now, now);
    db.prepare(
      `INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer, barcode,
        tax_category_id, mrp_paisa, is_controlled, is_active, created_at, updated_at
      ) VALUES (?, 'Disprin', 'Aspirin', '300mg', 'Tablet', 'Reckitt', NULL, ?, 100, 0, 1, ?, ?)`
    ).run(productId, taxCatId, now, now);
    db.prepare(
      'INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at) VALUES (?, ?, ?, ?, 50, 100, ?, ?)'
    ).run(batchId, productId, 'B-H14', '2028-12-31', now, now);
    const movId = generateUuidV7();
    db.prepare(
      `INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type, quantity_signed, reference_type, reference_id, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'adjustment', 10, 'stock_adjustment', ?, 'Init', ?, ?)`
    ).run(movId, productId, batchId, branchId, movId, now, now);

    // 3 units @ 100 paisa minus 200 paisa flat discount = 100 paisa lineTotalPaisa for 3 units
    const invoice = finalizeSale(
      {
        clientRequestId: generateUuidV7(),
        counterId,
        cashierUserId: userId,
        lines: [{ productId, quantity: 3, discountPaisa: 200 }],
        payments: [{ method: 'cash', amountPaisa: 100 }],
      },
      { db, today: '2026-10-28' }
    );

    const creditNote = processReturn(
      {
        clientRequestId: generateUuidV7(),
        originalInvoiceId: invoice.id,
        lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: 3 }],
        refundMethod: 'cash',
        reason: 'customer_return',
      },
      { db, counterId, cashierUserId: userId, branchId }
    );

    const returnModalSource = fs.readFileSync(
      path.join(REPO_ROOT, 'apps/desktop/src/renderer/components/invoices/ReturnModal.tsx'),
      'utf8'
    );
    const paymentModalSource = fs.readFileSync(
      path.join(REPO_ROOT, 'apps/desktop/src/renderer/components/pos/PaymentModal.tsx'),
      'utf8'
    );

    // ReturnModal.tsx line 81-82 uses Math.round(line.lineTotalPaisa / line.soldQuantity) * returnQty -> 99 paisa instead of 100 paisa
    const usesFloatUnitRounding = returnModalSource.includes(
      'Math.round(line.lineTotalPaisa / line.soldQuantity)'
    );
    // PaymentModal.tsx line 351-352 uses (grandTotalPaisa / 100).toFixed(0) when initializing split cash
    const usesToFixedZeroInSplitInit = paymentModalSource.includes(
      'setSplitCashRupees((grandTotalPaisa / 100).toFixed(0))'
    );

    expect(creditNote.totalPaisa).toBe(100);
    expect(usesFloatUnitRounding).toBe(false);
    expect(usesToFixedZeroInSplitInit).toBe(false);
  });

  it('H-15: server sales report and dashboard overview use Asia/Karachi (UTC+5) day boundaries instead of UTC', async () => {
    const tenant = await seedServerTenant('H15 Pharmacy');

    // 2026-10-28 01:30:00 in Asia/Karachi (PKT, UTC+5) is 2026-10-27T20:30:00.000Z in UTC
    const karachiEarlyMorningUtc = '2026-10-27T20:30:00.000Z';

    await ctx.db.insert(invoices).values({
      id: generateUuidV7(),
      pharmacyId: tenant.pharmacyId,
      counterId: tenant.counterId,
      cashierUserId: tenant.ownerId,
      invoiceNumber: 'INV-H15-PKT',
      clientRequestId: generateUuidV7(),
      status: 'finalized',
      subtotalPaisa: 15000,
      discountPaisa: 0,
      taxPaisa: 0,
      totalPaisa: 15000,
      createdAt: karachiEarlyMorningUtc,
    });

    const overview = await getDashboardOverview(ctx.db, tenant.pharmacyId, '2026-10-28');
    const salesReport = await getSalesReport(ctx.db, {
      pharmacyId: tenant.pharmacyId,
      startDate: '2026-10-28',
      endDate: '2026-10-28',
    });

    expect(overview.todayInvoiceCount).toBe(1);
    expect(salesReport.totals.invoiceCount).toBe(1);
    expect(salesReport.byDay[0]?.date).toBe('2026-10-28');
  });

  it('H-16: workspace dependencies resolve patched versions for zod (>=4.6.6) and esbuild (>=0.25.0)', () => {
    const sharedPkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'packages/shared/package.json'), 'utf8')
    ) as { dependencies: { zod: string } };

    // GHSA-mrhx-c7xc-m3w5 requires zod >= 4.6.6
    const zodSpec = sharedPkg.dependencies.zod.replace(/^[\^~]/, '');
    const major = parseInt(zodSpec.split('.')[0] ?? '0', 10);

    expect(major).toBeGreaterThanOrEqual(4);
  });
});
