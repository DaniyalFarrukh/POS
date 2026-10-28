import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7 } from '../../packages/shared/src/index';
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
} from '../../apps/server/src/db/schema';
import { signDeviceToken } from '../../apps/server/src/auth/jwt';
import {
  initDatabase,
  getDatabase,
  setDatabaseForTesting,
} from '../../apps/desktop/src/main/db';
import { hashPin, setSessionForTesting } from '../../apps/desktop/src/main/auth';
import {
  createSupplier,
  receiveGrn,
  adjustStock,
} from '../../apps/desktop/src/main/purchasing';
import { finalizeSale } from '../../apps/desktop/src/main/finalizeSale';
import { processReturn } from '../../apps/desktop/src/main/returns';
import { openShift, closeShift } from '../../apps/desktop/src/main/shifts';
import { pushPending } from '../../apps/desktop/src/main/sync/core/pushPending';
import { pullAndApply } from '../../apps/desktop/src/main/sync/core/pullAndApply';

type DatabaseInstance = ReturnType<typeof getDatabase>;

function openMigratedSqliteDb(dbPath: string): DatabaseInstance {
  initDatabase(dbPath);
  return getDatabase();
}

describe('Two-Counter Multi-Device Consistency Integration Suite', () => {
  let ctx: TestDatabaseContext;
  let app: ReturnType<typeof buildApp>;
  let serverUrl: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-two-counter-'));
    ctx = await createTestContext();
    app = buildApp({
      db: ctx.db,
      deviceRateLimitMax: 500,
      deviceRateLimitWindow: '1 minute',
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address() as { port: number };
    serverUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await app.close();
    await ctx.cleanup();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors on Windows
    }
  });

  async function seedTwoCounterPharmacy(label: string) {
    const now = new Date().toISOString();
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const counter1Id = generateUuidV7();
    const counter2Id = generateUuidV7();
    const ownerId = generateUuidV7();
    const device1Id = generateUuidV7();
    const device2Id = generateUuidV7();
    const taxCategoryId = generateUuidV7();
    const productId = generateUuidV7();
    const pinHash = await hashPin('12345678');

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: label,
      code: `${label.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_${pharmacyId.slice(0, 8)}`,
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

    await ctx.db.insert(counters).values([
      {
        id: counter1Id,
        pharmacyId,
        branchId,
        name: 'Counter 1',
        code: 'C1',
        lastInvoiceSeq: 0,
        lastCreditNoteSeq: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: counter2Id,
        pharmacyId,
        branchId,
        name: 'Counter 2',
        code: 'C2',
        lastInvoiceSeq: 0,
        lastCreditNoteSeq: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await ctx.db.insert(users).values({
      id: ownerId,
      pharmacyId,
      name: `Owner ${label}`,
      role: 'owner',
      pinHash,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(devices).values([
      {
        id: device1Id,
        pharmacyId,
        branchId,
        counterId: counter1Id,
        deviceName: 'Counter 1 Terminal',
        isRevoked: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: device2Id,
        pharmacyId,
        branchId,
        counterId: counter2Id,
        deviceName: 'Counter 2 Terminal',
        isRevoked: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await ctx.db.insert(taxCategories).values({
      id: taxCategoryId,
      pharmacyId,
      name: 'Exempt',
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

    const device1Token = signDeviceToken({
      pharmacyId,
      branchId,
      counterId: counter1Id,
      deviceId: device1Id,
    });
    const device2Token = signDeviceToken({
      pharmacyId,
      branchId,
      counterId: counter2Id,
      deviceId: device2Id,
    });

    const seedLocalCounterDb = (db: DatabaseInstance) => {
      db.prepare(
        'INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).run(branchId, 'Main Branch', now, now);
      db.prepare(
        'INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, last_credit_note_seq, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)'
      ).run(counter1Id, branchId, 'Counter 1', 'C1', now, now);
      db.prepare(
        'INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, last_credit_note_seq, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)'
      ).run(counter2Id, branchId, 'Counter 2', 'C2', now, now);
      db.prepare(
        'INSERT INTO users (id, name, role, pin_hash, is_active, failed_login_attempts, locked_until, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, NULL, ?, ?)'
      ).run(ownerId, `Owner ${label}`, 'owner', pinHash, now, now);
      db.prepare(
        'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)'
      ).run(taxCategoryId, 'Exempt', now, now);
      db.prepare(
        `INSERT INTO products (
          id, brand_name, generic_name, strength, form, manufacturer, barcode,
          tax_category_id, mrp_paisa, is_controlled, is_active, created_at, updated_at
        ) VALUES (?, 'Augmentin 625mg', 'Amoxicillin + Clavulanic Acid', '625mg', 'Tablet', 'GSK', NULL, ?, 5000, 0, 1, ?, ?)`
      ).run(productId, taxCategoryId, now, now);
    };

    const db1Path = path.join(tempDir, `c1-${pharmacyId}.db`);
    const db2Path = path.join(tempDir, `c2-${pharmacyId}.db`);
    const db1 = openMigratedSqliteDb(db1Path);
    const db2 = openMigratedSqliteDb(db2Path);
    seedLocalCounterDb(db1);
    seedLocalCounterDb(db2);

    return {
      pharmacyId,
      branchId,
      counter1Id,
      counter2Id,
      ownerId,
      taxCategoryId,
      productId,
      device1Token,
      device2Token,
      db1,
      db2,
      db1Path,
      db2Path,
    };
  }

  function activateCounterSession(
    db: DatabaseInstance,
    tenant: { branchId: string; ownerId: string },
    counterId: string,
    counterName: string
  ) {
    setDatabaseForTesting(db);
    setSessionForTesting({
      user: { id: tenant.ownerId, name: 'Owner', role: 'owner', isActive: true },
      branch: { id: tenant.branchId, name: 'Main Branch' },
      counter: { id: counterId, name: counterName },
      isLocked: false,
      idleTimeoutMinutes: 5,
    });
  }

  it('keeps two counters consistent across purchases, sales, returns, adjustments, and shifts with identical movement IDs', async () => {
    const t = await seedTwoCounterPharmacy('TwoCounter FullFlow');

    // 1. Counter 1: Open shift, create supplier, receive GRN (+100 units), finalize sale (-10 units), close shift
    activateCounterSession(t.db1, t, t.counter1Id, 'Counter 1');
    const shift1 = openShift(
      { openingCashPaisa: 100000 },
      { counterId: t.counter1Id, branchId: t.branchId, cashierUserId: t.ownerId, rawDb: t.db1 }
    );
    const supplier = createSupplier({ name: 'Premier Pharma Dist' });
    const grn = receiveGrn({
      supplierId: supplier.id,
      supplierInvoiceNo: 'GRN-TC-001',
      invoiceDate: '2026-10-28',
      lines: [
        {
          productId: t.productId,
          batchNo: 'BATCH-TC-01',
          expiryDate: '2028-12-31',
          quantity: 100,
          costPaisa: 3500,
          mrpPaisa: 5000,
        },
      ],
    });
    const batchId = grn.lines![0]!.batchId;

    const sale1 = finalizeSale(
      {
        clientRequestId: generateUuidV7(),
        counterId: t.counter1Id,
        cashierUserId: t.ownerId,
        lines: [{ productId: t.productId, quantity: 10 }],
        payments: [{ method: 'cash', amountPaisa: 50000 }],
      },
      { db: t.db1, today: '2026-10-28' }
    );

    closeShift(
      { shiftId: shift1.id, countedCashPaisa: 150000 },
      { cashierUserId: t.ownerId, userRole: 'owner', rawDb: t.db1 }
    );

    // Push Counter 1's 4 outbox events (shift.opened, purchase.received, invoice.created, shift.closed)
    const push1 = await pushPending(
      { db: t.db1, fetch: globalThis.fetch },
      { serverUrl, token: t.device1Token }
    );
    expect(push1.rejected).toBe(0);
    expect(push1.retryLater).toBe(0);
    expect(push1.acked).toBe(4);

    // 2. Counter 2 pulls from server: sees batch and current stock balance of 100 - 10 = 90
    const pull2 = await pullAndApply(
      { db: t.db2, fetch: globalThis.fetch },
      { serverUrl, token: t.device2Token }
    );
    expect(pull2.failedRequest).toBe(false);

    const c2StockAfterPull1 = (
      t.db2
        .prepare('SELECT COALESCE(SUM(quantity_signed), 0) as bal FROM stock_movements WHERE batch_id = ?')
        .get(batchId) as { bal: number }
    ).bal;
    expect(c2StockAfterPull1).toBe(90);

    // 3. Counter 2: makes a sale (-15 units), processes a return on its sale (+3 units), and records a damage adjustment (-2 units)
    activateCounterSession(t.db2, t, t.counter2Id, 'Counter 2');
    const sale2 = finalizeSale(
      {
        clientRequestId: generateUuidV7(),
        counterId: t.counter2Id,
        cashierUserId: t.ownerId,
        lines: [{ productId: t.productId, quantity: 15 }],
        payments: [{ method: 'cash', amountPaisa: 75000 }],
      },
      { db: t.db2, today: '2026-10-28' }
    );

    processReturn(
      {
        clientRequestId: generateUuidV7(),
        originalInvoiceId: sale2.id,
        lines: [{ invoiceLineId: sale2.lines[0]!.id, quantity: 3 }],
        refundMethod: 'cash',
        reason: 'customer_return',
      },
      { db: t.db2, counterId: t.counter2Id, cashierUserId: t.ownerId, branchId: t.branchId }
    );

    adjustStock({
      productId: t.productId,
      batchId,
      quantitySigned: -2,
      reasonType: 'damage',
      reason: 'Damaged blister pack',
    });

    // Push Counter 2's 3 events (invoice.created, credit_note.created, stock_adjustment.created)
    const push2 = await pushPending(
      { db: t.db2, fetch: globalThis.fetch },
      { serverUrl, token: t.device2Token }
    );
    expect(push2.rejected).toBe(0);
    expect(push2.retryLater).toBe(0);
    expect(push2.acked).toBe(3);

    // 4. Both counters pull to converge
    await pullAndApply(
      { db: t.db1, fetch: globalThis.fetch },
      { serverUrl, token: t.device1Token }
    );
    await pullAndApply(
      { db: t.db2, fetch: globalThis.fetch },
      { serverUrl, token: t.device2Token }
    );

    // Expected final balance: +100 (GRN) - 10 (sale1) - 15 (sale2) + 3 (return) - 2 (adjustment) = 76
    const c1Movements = t.db1
      .prepare('SELECT id, type, quantity_signed FROM stock_movements WHERE batch_id = ? ORDER BY id ASC')
      .all(batchId) as Array<{ id: string; type: string; quantity_signed: number }>;
    const c2Movements = t.db2
      .prepare('SELECT id, type, quantity_signed FROM stock_movements WHERE batch_id = ? ORDER BY id ASC')
      .all(batchId) as Array<{ id: string; type: string; quantity_signed: number }>;
    const serverMovementsRes = await ctx.client.query<{
      id: string;
      type: string;
      quantity_signed: number;
    }>(
      'SELECT id, type, quantity_signed FROM stock_movements WHERE pharmacy_id = $1 AND batch_id = $2 ORDER BY id ASC',
      [t.pharmacyId, batchId]
    );

    expect(c1Movements).toHaveLength(5);
    expect(c1Movements).toEqual(c2Movements);
    expect(c1Movements).toEqual(serverMovementsRes.rows);

    const totalBalance = c1Movements.reduce((sum, m) => sum + m.quantity_signed, 0);
    expect(totalBalance).toBe(76);
    expect(sale1.id).toBeDefined();

    t.db1.close();
    t.db2.close();
  });

  it('handles offline overlap, duplicate push deliveries, and counter SQLite restart cleanly', async () => {
    const t = await seedTwoCounterPharmacy('TwoCounter OfflineAndRestart');

    // 1. Counter 1 receives 20 units and syncs; Counter 2 pulls so both counters start with 20 units
    activateCounterSession(t.db1, t, t.counter1Id, 'Counter 1');
    const supplier = createSupplier({ name: 'Overlap Supplier' });
    const grn = receiveGrn({
      supplierId: supplier.id,
      supplierInvoiceNo: 'GRN-OVERLAP-1',
      invoiceDate: '2026-10-28',
      lines: [
        {
          productId: t.productId,
          batchNo: 'BATCH-OVL-01',
          expiryDate: '2028-12-31',
          quantity: 20,
          costPaisa: 3500,
          mrpPaisa: 5000,
        },
      ],
    });
    const batchId = grn.lines![0]!.batchId;

    await pushPending({ db: t.db1, fetch: globalThis.fetch }, { serverUrl, token: t.device1Token });
    await pullAndApply({ db: t.db2, fetch: globalThis.fetch }, { serverUrl, token: t.device2Token });

    // 2. Both counters go offline and concurrently sell 12 units each from the 20-unit batch (total 24 sold)
    activateCounterSession(t.db1, t, t.counter1Id, 'Counter 1');
    finalizeSale(
      {
        clientRequestId: generateUuidV7(),
        counterId: t.counter1Id,
        cashierUserId: t.ownerId,
        lines: [{ productId: t.productId, quantity: 12 }],
        payments: [{ method: 'cash', amountPaisa: 60000 }],
      },
      { db: t.db1, today: '2026-10-28' }
    );

    activateCounterSession(t.db2, t, t.counter2Id, 'Counter 2');
    finalizeSale(
      {
        clientRequestId: generateUuidV7(),
        counterId: t.counter2Id,
        cashierUserId: t.ownerId,
        lines: [{ productId: t.productId, quantity: 12 }],
        payments: [{ method: 'cash', amountPaisa: 60000 }],
      },
      { db: t.db2, today: '2026-10-28' }
    );

    // 3. Capture Counter 1's pending event before pushing so we can replay it to test duplicate delivery
    const c1OutboxRow = t.db1
      .prepare("SELECT event_id, device_seq, type, entity_id, payload, occurred_at FROM outbox WHERE status = 'pending' LIMIT 1")
      .get() as {
      event_id: string;
      device_seq: number;
      type: string;
      entity_id: string;
      payload: string;
      occurred_at: string;
    };

    const push1 = await pushPending({ db: t.db1, fetch: globalThis.fetch }, { serverUrl, token: t.device1Token });
    const push2 = await pushPending({ db: t.db2, fetch: globalThis.fetch }, { serverUrl, token: t.device2Token });
    expect(push1.acked).toBe(1);
    expect(push2.acked).toBe(1);

    // 4. Duplicate delivery test: resend Counter 1's event directly to POST /sync/push
    const dupRes = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${t.device1Token}` },
      payload: {
        events: [
          {
            eventId: c1OutboxRow.event_id,
            deviceSeq: c1OutboxRow.device_seq,
            type: c1OutboxRow.type,
            entityId: c1OutboxRow.entity_id,
            occurredAt: c1OutboxRow.occurred_at,
            schemaVersion: 1,
            payload: JSON.parse(c1OutboxRow.payload),
          },
        ],
      },
    });
    expect(dupRes.statusCode).toBe(200);
    expect(dupRes.json().results[0].status).toBe('duplicate');

    // 5. Simulate Counter 2 process restart: close SQLite DB, reopen from disk, pull & verify cursor continuity
    t.db2.close();
    t.db2 = openMigratedSqliteDb(t.db2Path);

    await pullAndApply({ db: t.db1, fetch: globalThis.fetch }, { serverUrl, token: t.device1Token });
    await pullAndApply({ db: t.db2, fetch: globalThis.fetch }, { serverUrl, token: t.device2Token });

    // Both counters and PostgreSQL must agree on balance = 20 - 12 - 12 = -4 (with a negative_stock alert recorded)
    const bal1 = (
      t.db1
        .prepare('SELECT COALESCE(SUM(quantity_signed), 0) as bal FROM stock_movements WHERE batch_id = ?')
        .get(batchId) as { bal: number }
    ).bal;
    const bal2 = (
      t.db2
        .prepare('SELECT COALESCE(SUM(quantity_signed), 0) as bal FROM stock_movements WHERE batch_id = ?')
        .get(batchId) as { bal: number }
    ).bal;
    expect(bal1).toBe(-4);
    expect(bal2).toBe(-4);

    const alertRes = await ctx.client.query(
      "SELECT id FROM stock_alerts WHERE pharmacy_id = $1 AND batch_id = $2 AND type = 'negative_stock'",
      [t.pharmacyId, batchId]
    );
    expect(alertRes.rows.length).toBeGreaterThanOrEqual(1);

    t.db1.close();
    t.db2.close();
  });
});
