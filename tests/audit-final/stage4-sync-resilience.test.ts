import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateUuidV7, type SyncEventEnvelope } from '../../packages/shared/src/index';
import { createTestContext, type TestDatabaseContext } from '../../apps/server/src/db/test-helper';
import {
  pharmacies,
  branches,
  counters,
  users,
  devices,
  taxCategories,
  products,
  batches,
  suppliers,
} from '../../apps/server/src/db/schema';
import { seedDefaultAccountMappings } from '../../apps/server/src/ledger/coa-seed';
import { closePeriod } from '../../apps/server/src/ledger/service';
import { reconcileLedger } from '../../apps/server/src/ledger/reconciliation';
import { processSyncPushEvents } from '../../apps/server/src/sync/service';
import { pullChangeLog } from '../../apps/server/src/sync/pull-service';
import { insertChangeLog } from '../../apps/server/src/sync/change-log';

import { initDatabase, getDatabase } from '../../apps/desktop/src/main/db';
import { finalizeSale } from '../../apps/desktop/src/main/finalizeSale';
import { createOutboxRepo } from '../../apps/desktop/src/main/sync/core/outboxRepo';
import { pushPending } from '../../apps/desktop/src/main/sync/core/pushPending';
import { pullAndApply } from '../../apps/desktop/src/main/sync/core/pullAndApply';
import { SyncWorker } from '../../apps/desktop/src/main/sync/core/syncWorker';
import { computeOfflineLevel } from '../../apps/desktop/src/main/sync/core/offlineLevel';

type SqliteDb = ReturnType<typeof getDatabase>;

function createTempSqliteDb(
  tempDir: string,
  name: string
): {
  db: SqliteDb;
  dbPath: string;
} {
  const dbPath = path.join(tempDir, `${name}-${generateUuidV7()}.db`);
  initDatabase(dbPath);
  const db = getDatabase();
  return { db, dbPath };
}

function seedLocalCounterDb(
  db: SqliteDb,
  params: {
    branchId: string;
    branchName: string;
    counterId: string;
    counterName: string;
    counterCode: string;
    userId: string;
    userName: string;
    taxCategoryId: string;
    productId: string;
    batchId: string;
    batchNo: string;
    initialStock: number;
    costPaisa: number;
    mrpPaisa: number;
  }
) {
  const now = '2026-10-10T08:00:00.000Z';
  db.prepare(`INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
    params.branchId,
    params.branchName,
    now,
    now
  );
  db.prepare(
    `INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, last_credit_note_seq, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(params.counterId, params.branchId, params.counterName, params.counterCode, now, now);
  db.prepare(
    `INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at)
     VALUES (?, ?, 'cashier', '$2b$10$abcdefghijklmnopqrstuv1234567890123456789012345678901', 1, ?, ?)`
  ).run(params.userId, params.userName, now, now);
  db.prepare(
    `INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at)
     VALUES (?, 'Exempt', 0, 1, ?, ?)`
  ).run(params.taxCategoryId, now, now);
  db.prepare(
    `INSERT INTO products (
      id, brand_name, generic_name, strength, form, manufacturer, barcode,
      tax_category_id, mrp_paisa, is_controlled, is_active, created_at, updated_at
    ) VALUES (?, 'Panadol Advance', 'Paracetamol', '500mg', 'Tablet', 'GSK', ?, ?, ?, 0, 1, ?, ?)`
  ).run(
    params.productId,
    `896400${params.productId.slice(-6)}`,
    params.taxCategoryId,
    params.mrpPaisa,
    now,
    now
  );
  db.prepare(
    `INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
     VALUES (?, ?, ?, '2028-12-31', ?, ?, ?, ?)`
  ).run(
    params.batchId,
    params.productId,
    params.batchNo,
    params.costPaisa,
    params.mrpPaisa,
    now,
    now
  );
  if (params.initialStock !== 0) {
    db.prepare(
      `INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type, quantity_signed,
        reference_type, reference_id, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'purchase', ?, 'purchase', ?, 'Initial seed stock', ?, ?)`
    ).run(
      generateUuidV7(),
      params.productId,
      params.batchId,
      params.branchId,
      params.initialStock,
      generateUuidV7(),
      now,
      now
    );
  }
}

describe('Stage 4 Final Audit: Sync & Offline Guarantees', () => {
  let ctx: TestDatabaseContext;
  let serverDb: TestDatabaseContext['db'];
  let tempDir: string;

  const pharmacyId = generateUuidV7();
  const otherPharmacyId = generateUuidV7();
  const branch1Id = generateUuidV7();
  const branch2Id = generateUuidV7();
  const counter1Id = generateUuidV7();
  const counter2Id = generateUuidV7();
  const device1Id = generateUuidV7();
  const device2Id = generateUuidV7();
  const ownerId = generateUuidV7();
  const cashier1Id = generateUuidV7();
  const cashier2Id = generateUuidV7();
  const taxCatId = generateUuidV7();
  const supplierId = generateUuidV7();

  beforeAll(async () => {
    ctx = await createTestContext();
    serverDb = ctx.db;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-stage4-audit-'));

    const now = '2026-10-10T08:00:00.000Z';
    await serverDb.insert(pharmacies).values([
      {
        id: pharmacyId,
        name: 'Stage 4 Audit Pharmacy',
        code: `S4-${pharmacyId.slice(-6)}`,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: otherPharmacyId,
        name: 'Other Tenant Pharmacy',
        code: `S4O-${otherPharmacyId.slice(-6)}`,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await seedDefaultAccountMappings(serverDb, pharmacyId);

    await serverDb.insert(branches).values([
      {
        id: branch1Id,
        pharmacyId,
        name: 'Main Branch',
        code: 'B1',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: branch2Id,
        pharmacyId,
        name: 'Second Branch',
        code: 'B2',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await serverDb.insert(counters).values([
      {
        id: counter1Id,
        pharmacyId,
        branchId: branch1Id,
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
        branchId: branch1Id, // Same branch for two-counter same-batch contention test!
        name: 'Counter 2',
        code: 'C2',
        lastInvoiceSeq: 0,
        lastCreditNoteSeq: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await serverDb.insert(users).values([
      {
        id: ownerId,
        pharmacyId,
        name: 'Owner',
        role: 'owner',
        pinHash: '$2b$10$abcdefghijklmnopqrstuv1234567890123456789012345678901',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: cashier1Id,
        pharmacyId,
        name: 'Cashier 1',
        role: 'cashier',
        pinHash: '$2b$10$abcdefghijklmnopqrstuv1234567890123456789012345678901',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: cashier2Id,
        pharmacyId,
        name: 'Cashier 2',
        role: 'cashier',
        pinHash: '$2b$10$abcdefghijklmnopqrstuv1234567890123456789012345678901',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await serverDb.insert(devices).values([
      {
        id: device1Id,
        pharmacyId,
        branchId: branch1Id,
        counterId: counter1Id,
        deviceName: 'Device 1',
        deviceTokenHash: `h1-${device1Id}`,
        status: 'active',
        registeredByUserId: ownerId,
        registeredAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: device2Id,
        pharmacyId,
        branchId: branch1Id,
        counterId: counter2Id,
        deviceName: 'Device 2',
        deviceTokenHash: `h2-${device2Id}`,
        status: 'active',
        registeredByUserId: ownerId,
        registeredAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await serverDb.insert(taxCategories).values({
      id: taxCatId,
      pharmacyId,
      name: 'Exempt',
      rateBp: 0,
      isExempt: true,
      createdAt: now,
      updatedAt: now,
    });

    await serverDb.insert(suppliers).values({
      id: supplierId,
      pharmacyId,
      name: 'Stage 4 Supplier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error on windows
    }
  });

  it('4.1 executes 100 offline sales on a fresh SQLite DB with mid-sale crash injection & restart, verifying PRAGMA integrity_check, stock & cash reconciliation, and zero lost/duplicate invoices', () => {
    const productId = generateUuidV7();
    const batchId = generateUuidV7();
    const initialStock = 500;
    const costPaisa = 10_000;
    const mrpPaisa = 15_000;

    const { db: dbBeforeCrash, dbPath } = createTempSqliteDb(tempDir, 'counter-crash-test');
    seedLocalCounterDb(dbBeforeCrash, {
      branchId: branch1Id,
      branchName: 'Main Branch',
      counterId: counter1Id,
      counterName: 'Counter 1',
      counterCode: 'C1',
      userId: cashier1Id,
      userName: 'Cashier 1',
      taxCategoryId: taxCatId,
      productId,
      batchId,
      batchNo: 'B-CRASH-01',
      initialStock,
      costPaisa,
      mrpPaisa,
    });

    let expectedCashPaisa = 0;
    let expectedUnitsSold = 0;

    // 1. Run first 50 offline sales normally
    for (let i = 1; i <= 50; i++) {
      const qty = (i % 3) + 1;
      const totalPaisa = qty * mrpPaisa;
      const inv = finalizeSale(
        {
          clientRequestId: `req-sale-${i}`,
          counterId: counter1Id,
          cashierUserId: cashier1Id,
          lines: [{ productId, quantity: qty }],
          payments: [{ method: 'cash', amountPaisa: totalPaisa }],
        },
        { db: dbBeforeCrash, today: '2026-10-15' }
      );
      expect(inv.invoiceNumber).toBe(`C1-${String(i).padStart(6, '0')}`);
      expectedCashPaisa += totalPaisa;
      expectedUnitsSold += qty;
    }

    // 2. Inject a mid-sale crash during sale #51 (after inserting into invoices, invoice_lines, and stock_movements, before outbox commit)
    const crashTx = dbBeforeCrash.transaction(() => {
      dbBeforeCrash
        .prepare(`UPDATE counters SET last_invoice_seq = last_invoice_seq + 1 WHERE id = ?`)
        .run(counter1Id);
      const crashedInvId = generateUuidV7();
      dbBeforeCrash
        .prepare(
          `INSERT INTO invoices (
            id, counter_id, cashier_user_id, invoice_number, client_request_id,
            status, subtotal_paisa, discount_paisa, tax_paisa, total_paisa, notes, created_at
          ) VALUES (?, ?, ?, 'C1-000051', 'req-sale-51', 'finalized', 15000, 0, 0, 15000, null, ?)`
        )
        .run(crashedInvId, counter1Id, cashier1Id, new Date().toISOString());
      dbBeforeCrash
        .prepare(
          `INSERT INTO stock_movements (
            id, product_id, batch_id, branch_id, type, quantity_signed,
            reference_type, reference_id, reason, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'sale', -1, 'invoice', ?, 'Mid-sale crash', ?, ?)`
        )
        .run(
          generateUuidV7(),
          productId,
          batchId,
          branch1Id,
          crashedInvId,
          new Date().toISOString(),
          new Date().toISOString()
        );
      throw new Error('SIMULATED_PROCESS_CRASH_MID_SALE_51');
    });

    expect(() => crashTx.immediate()).toThrow('SIMULATED_PROCESS_CRASH_MID_SALE_51');

    // Close DB abruptly and reopen from disk (simulating process restart)
    dbBeforeCrash.close();
    initDatabase(dbPath);
    const dbAfterRestart = getDatabase();

    const integrity = dbAfterRestart.pragma('integrity_check', { simple: true });
    expect(integrity).toBe('ok');

    // Verify sale #51 rolled back completely and sequence is still 50
    const seqAfterCrash = dbAfterRestart
      .prepare(`SELECT last_invoice_seq FROM counters WHERE id = ?`)
      .get(counter1Id) as { last_invoice_seq: number };
    expect(seqAfterCrash.last_invoice_seq).toBe(50);

    // 3. Retry sale #51 with the same clientRequestId and complete sales 51..100 (plus replay duplicate #51)
    for (let i = 51; i <= 100; i++) {
      const qty = (i % 3) + 1;
      const totalPaisa = qty * mrpPaisa;
      const inv = finalizeSale(
        {
          clientRequestId: `req-sale-${i}`,
          counterId: counter1Id,
          cashierUserId: cashier1Id,
          lines: [{ productId, quantity: qty }],
          payments: [{ method: 'cash', amountPaisa: totalPaisa }],
        },
        { db: dbAfterRestart, today: '2026-10-15' }
      );
      expect(inv.invoiceNumber).toBe(`C1-${String(i).padStart(6, '0')}`);
      expectedCashPaisa += totalPaisa;
      expectedUnitsSold += qty;

      // Replay idempotent duplicate on sale #51
      if (i === 51) {
        const dup = finalizeSale(
          {
            clientRequestId: `req-sale-51`,
            counterId: counter1Id,
            cashierUserId: cashier1Id,
            lines: [{ productId, quantity: qty }],
            payments: [{ method: 'cash', amountPaisa: totalPaisa }],
          },
          { db: dbAfterRestart, today: '2026-10-15' }
        );
        expect(dup.id).toBe(inv.id);
        expect(dup.invoiceNumber).toBe('C1-000051');
      }
    }

    // 4. Verify 100 invoices, 100 outbox events, gapless invoice numbers & device_seq, exact stock & cash reconciliation
    const invCount = dbAfterRestart.prepare(`SELECT COUNT(*) AS cnt FROM invoices`).get() as {
      cnt: number;
    };
    expect(invCount.cnt).toBe(100);

    const outboxCount = dbAfterRestart
      .prepare(
        `SELECT COUNT(*) AS cnt, MIN(device_seq) AS minSeq, MAX(device_seq) AS maxSeq FROM outbox`
      )
      .get() as { cnt: number; minSeq: number; maxSeq: number };
    expect(outboxCount.cnt).toBe(100);
    expect(outboxCount.minSeq).toBe(1);
    expect(outboxCount.maxSeq).toBe(100);

    const stockBal = dbAfterRestart
      .prepare(
        `SELECT COALESCE(SUM(quantity_signed), 0) AS bal FROM stock_movements WHERE batch_id = ?`
      )
      .get(batchId) as { bal: number };
    expect(stockBal.bal).toBe(initialStock - expectedUnitsSold);

    const cashSum = dbAfterRestart
      .prepare(
        `SELECT COALESCE(SUM(amount_paisa), 0) AS totalCash FROM payments WHERE method = 'cash'`
      )
      .get() as { totalCash: number };
    expect(cashSum.totalCash).toBe(expectedCashPaisa);

    const finalIntegrity = dbAfterRestart.pragma('integrity_check', { simple: true });
    expect(finalIntegrity).toBe('ok');

    dbAfterRestart.close();
  });

  it('4.2 runs 20 iterations of two counters selling the same batch offline with random network failures, verifying convergence, negative-stock alerts, and ledger reconciliation', async () => {
    const productId = generateUuidV7();
    const costPaisa = 12_000;
    const mrpPaisa = 20_000;
    const now = '2026-10-15T09:00:00.000Z';

    // Seed product on server
    await serverDb.insert(products).values({
      id: productId,
      pharmacyId,
      brandName: 'Augmentin 625mg',
      genericName: 'Co-Amoxiclav',
      strength: '625mg',
      form: 'Tablet',
      manufacturer: 'GSK',
      barcode: `896499${productId.slice(-6)}`,
      taxCategoryId: taxCatId,
      mrpPaisa,
      isControlled: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Create two counter SQLite databases
    const { db: c1Db } = createTempSqliteDb(tempDir, 'c1-contention');
    const { db: c2Db } = createTempSqliteDb(tempDir, 'c2-contention');

    const dummyBatchId = generateUuidV7();
    seedLocalCounterDb(c1Db, {
      branchId: branch1Id,
      branchName: 'Main Branch',
      counterId: counter1Id,
      counterName: 'Counter 1',
      counterCode: 'C1',
      userId: cashier1Id,
      userName: 'Cashier 1',
      taxCategoryId: taxCatId,
      productId,
      batchId: dummyBatchId,
      batchNo: 'DUMMY-0',
      initialStock: 0,
      costPaisa,
      mrpPaisa,
    });
    seedLocalCounterDb(c2Db, {
      branchId: branch1Id,
      branchName: 'Main Branch',
      counterId: counter2Id,
      counterName: 'Counter 2',
      counterCode: 'C2',
      userId: cashier2Id,
      userName: 'Cashier 2',
      taxCategoryId: taxCatId,
      productId,
      batchId: dummyBatchId,
      batchNo: 'DUMMY-0',
      initialStock: 0,
      costPaisa,
      mrpPaisa,
    });

    // In-process fetch adapter routing /sync/push and /sync/pull to the real server services,
    // with deterministic pseudo-random network failure injection
    let callCounter = 0;
    let injectedFailures = 0;
    function makeMockFetch(
      deviceCtx: {
        pharmacyId: string;
        branchId: string;
        counterId: string;
        deviceId: string;
      },
      failEveryN: number
    ): typeof fetch {
      return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        callCounter++;
        if (failEveryN > 0 && callCounter % failEveryN === 0) {
          injectedFailures++;
          throw new Error('ECONNRESET: Simulated random network failure');
        }
        const urlStr = typeof input === 'string' ? input : input.toString();
        if (urlStr.endsWith('/sync/push')) {
          const body = JSON.parse((init?.body as string) || '{}') as {
            events: SyncEventEnvelope[];
          };
          const results = await processSyncPushEvents(serverDb, deviceCtx, body.events);
          return new Response(JSON.stringify({ results }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/sync/pull')) {
          const u = new URL(urlStr);
          const cursor = Number(u.searchParams.get('cursor') ?? 0);
          const limit = Number(u.searchParams.get('limit') ?? 200);
          const pullRes = await pullChangeLog(
            serverDb,
            { pharmacyId: deviceCtx.pharmacyId, branchId: deviceCtx.branchId },
            { cursor, limit }
          );
          return new Response(JSON.stringify(pullRes), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      };
    }

    const dev1Ctx = {
      pharmacyId,
      branchId: branch1Id,
      counterId: counter1Id,
      deviceId: device1Id,
    };
    const dev2Ctx = {
      pharmacyId,
      branchId: branch1Id,
      counterId: counter2Id,
      deviceId: device2Id,
    };

    const batchIds: string[] = [];

    // Run 20 iterations: in each iteration, seed a batch with 10 units on Server, Counter 1, and Counter 2.
    // Counter 1 sells 8 units offline; Counter 2 sells 8 units offline (total 16 sold > 10 available -> -6 balance).
    for (let iter = 1; iter <= 20; iter++) {
      const bId = generateUuidV7();
      const bNo = `B-CONT-${String(iter).padStart(2, '0')}`;
      const seedMovId = generateUuidV7();
      batchIds.push(bId);

      // Seed 10 units on Server (via purchase.received so ledger 1200 Inventory also gets +10 * costPaisa)
      const grnId = generateUuidV7();
      const grnRes = await processSyncPushEvents(serverDb, dev1Ctx, [
        {
          eventId: generateUuidV7(),
          deviceSeq: 10_000 + iter,
          type: 'purchase.received',
          entityId: grnId,
          occurredAt: now,
          schemaVersion: 1,
          payload: {
            purchase: {
              id: grnId,
              branchId: branch1Id,
              supplierId,
              supplierInvoiceNo: `GRN-CONT-${iter}`,
              invoiceDate: '2026-10-15',
              totalCostPaisa: 10 * costPaisa,
              taxPaisa: 0,
              createdByUserId: cashier1Id,
              createdAt: now,
            },
            batches: [
              {
                id: bId,
                productId,
                batchNo: bNo,
                expiryDate: `2027-${String((iter % 9) + 1).padStart(2, '0')}-28`,
                costPaisa,
                mrpPaisa,
                createdAt: now,
              },
            ],
            lines: [
              {
                id: generateUuidV7(),
                movementId: seedMovId,
                productId,
                batchId: bId,
                quantity: 10,
                costPaisa,
                mrpPaisa,
              },
            ],
          },
        },
      ]);
      expect(grnRes[0]?.status).toBe('accepted');

      // Both counters pull the new batch + 10 units before going offline
      await pullAndApply(
        { db: c1Db, fetch: makeMockFetch(dev1Ctx, 0) },
        { serverUrl: 'http://localhost:3000', token: 'tok-1' }
      );
      await pullAndApply(
        { db: c2Db, fetch: makeMockFetch(dev2Ctx, 0) },
        { serverUrl: 'http://localhost:3000', token: 'tok-2' }
      );

      // Counter 1 sells 8 units offline
      finalizeSale(
        {
          clientRequestId: `c1-iter-${iter}`,
          counterId: counter1Id,
          cashierUserId: cashier1Id,
          lines: [{ productId, quantity: 8 }],
          payments: [{ method: 'cash', amountPaisa: 8 * mrpPaisa }],
        },
        { db: c1Db, today: '2026-10-15' }
      );

      // Counter 2 sells 8 units offline from the SAME batch (since it's the only positive batch)
      finalizeSale(
        {
          clientRequestId: `c2-iter-${iter}`,
          counterId: counter2Id,
          cashierUserId: cashier2Id,
          lines: [{ productId, quantity: 8 }],
          payments: [{ method: 'cash', amountPaisa: 8 * mrpPaisa }],
        },
        { db: c2Db, today: '2026-10-15' }
      );

      // Sync both counters with random network failures (every 3rd request throws ECONNRESET) until pending == 0
      const flakyFetch1 = makeMockFetch(dev1Ctx, 3);
      const flakyFetch2 = makeMockFetch(dev2Ctx, 3);

      let p1 = await pushPending(
        { db: c1Db, fetch: flakyFetch1 },
        { serverUrl: 'http://localhost:3000', token: 'tok-1' }
      );
      while (p1.failedRequest) {
        p1 = await pushPending(
          { db: c1Db, fetch: flakyFetch1 },
          { serverUrl: 'http://localhost:3000', token: 'tok-1' }
        );
      }
      expect(p1.acked).toBe(1);

      let p2 = await pushPending(
        { db: c2Db, fetch: flakyFetch2 },
        { serverUrl: 'http://localhost:3000', token: 'tok-2' }
      );
      while (p2.failedRequest) {
        p2 = await pushPending(
          { db: c2Db, fetch: flakyFetch2 },
          { serverUrl: 'http://localhost:3000', token: 'tok-2' }
        );
      }
      expect(p2.acked).toBe(1);

      // Pull changes on both counters (with retry on simulated network failure)
      let pull1 = await pullAndApply(
        { db: c1Db, fetch: flakyFetch1 },
        { serverUrl: 'http://localhost:3000', token: 'tok-1' }
      );
      while (pull1.failedRequest) {
        pull1 = await pullAndApply(
          { db: c1Db, fetch: flakyFetch1 },
          { serverUrl: 'http://localhost:3000', token: 'tok-1' }
        );
      }

      let pull2 = await pullAndApply(
        { db: c2Db, fetch: flakyFetch2 },
        { serverUrl: 'http://localhost:3000', token: 'tok-2' }
      );
      while (pull2.failedRequest) {
        pull2 = await pullAndApply(
          { db: c2Db, fetch: flakyFetch2 },
          { serverUrl: 'http://localhost:3000', token: 'tok-2' }
        );
      }
    }

    expect(injectedFailures).toBeGreaterThan(10);

    // Verify all 20 batches converged to -6 on Counter 1, Counter 2, and Server!
    for (const bId of batchIds) {
      const c1Bal = c1Db
        .prepare(
          `SELECT COALESCE(SUM(quantity_signed), 0) AS bal FROM stock_movements WHERE batch_id = ?`
        )
        .get(bId) as { bal: number };
      const c2Bal = c2Db
        .prepare(
          `SELECT COALESCE(SUM(quantity_signed), 0) AS bal FROM stock_movements WHERE batch_id = ?`
        )
        .get(bId) as { bal: number };
      const srvBalRes = await ctx.client.query<{ bal: string }>(
        `SELECT COALESCE(SUM(quantity_signed), 0) AS bal FROM stock_movements WHERE pharmacy_id = $1 AND batch_id = $2`,
        [pharmacyId, bId]
      );
      expect(c1Bal.bal).toBe(-6);
      expect(c2Bal.bal).toBe(-6);
      expect(Number(srvBalRes.rows[0]?.bal)).toBe(-6);
    }

    // Verify 20 negative_stock alerts were created on the server
    const alertsRes = await ctx.client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM stock_alerts WHERE pharmacy_id = $1 AND type = 'negative_stock'`,
      [pharmacyId]
    );
    expect(Number(alertsRes.rows[0]?.count)).toBe(20);

    // Verify zero echo outbox events were created by pullAndApply (only 20 sales per counter)
    expect(createOutboxRepo(c1Db).counts().total).toBe(20);
    expect(createOutboxRepo(c1Db).counts().acked).toBe(20);
    expect(createOutboxRepo(c2Db).counts().total).toBe(20);
    expect(createOutboxRepo(c2Db).counts().acked).toBe(20);

    // Verify server ledger reconciles to 0 paisa difference across all 20 GRNs + 40 sales
    const recon = await reconcileLedger(serverDb, pharmacyId, '2026-10-01', '2026-12-31');
    expect(recon.isReconciled).toBe(true);
    expect(recon.salesDifferencePaisa).toBe(0);
    expect(recon.inventoryDifferencePaisa).toBe(0);

    c1Db.close();
    c2Db.close();
  }, 60_000);

  it('4.3 verifies unknown vs cross-tenant references, closed-period sync rejection, revoked device auth_error, offline limit >72h, and reproduces customer pull gap (F-H-07)', async () => {
    const { db: localDb } = createTempSqliteDb(tempDir, 'edge-cases');
    const localOutbox = createOutboxRepo(localDb);

    // 1. Unknown reference (UNKNOWN_PRODUCT) -> retry_later (stays pending, attempts incremented)
    // 2. Cross-tenant reference (CROSS_TENANT_REFERENCE) -> rejected (moved to sync_exceptions)
    // 3. Closed-period event -> rejected (LEDGER_POSTING_FAILED, moved to sync_exceptions)
    const otherTaxCatId = generateUuidV7();
    const otherProdId = generateUuidV7();
    const now = '2026-10-15T10:00:00.000Z';

    await serverDb.insert(taxCategories).values({
      id: otherTaxCatId,
      pharmacyId: otherPharmacyId,
      name: 'Other Tax',
      rateBp: 0,
      isExempt: true,
      createdAt: now,
      updatedAt: now,
    });
    await serverDb.insert(products).values({
      id: otherProdId,
      pharmacyId: otherPharmacyId,
      brandName: 'Other Tenant Med',
      genericName: 'Other',
      strength: '10mg',
      form: 'Tablet',
      manufacturer: 'Other',
      taxCategoryId: otherTaxCatId,
      mrpPaisa: 5000,
      isControlled: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Close August 2026 on server
    await serverDb.transaction((tx) =>
      closePeriod(tx, {
        pharmacyId,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        actorUserId: ownerId,
        actorRole: 'owner',
        reason: 'Close Aug 2026',
      })
    );

    const evtUnknownId = generateUuidV7();
    const evtCrossTenantId = generateUuidV7();
    const evtClosedPeriodId = generateUuidV7();

    // Seed a valid product + batch on server for the closed-period test
    const validProdId = generateUuidV7();
    const validBatchId = generateUuidV7();
    await serverDb.insert(products).values({
      id: validProdId,
      pharmacyId,
      brandName: 'Valid Med',
      genericName: 'Gen',
      strength: '5mg',
      form: 'Tablet',
      manufacturer: 'Hexa',
      taxCategoryId: taxCatId,
      mrpPaisa: 5000,
      isControlled: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await serverDb.insert(batches).values({
      id: validBatchId,
      pharmacyId,
      productId: validProdId,
      batchNo: 'B-VAL-1',
      expiryDate: '2028-12-31',
      costPaisa: 3000,
      mrpPaisa: 5000,
      createdAt: now,
      updatedAt: now,
    });

    // Insert the 3 events into local SQLite outbox
    const insertOutbox = localDb.prepare(`
      INSERT INTO outbox (
        id, event_id, device_seq, type, event_type, entity_id, payload, occurred_at, status, attempts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)
    `);

    // Event 1: invoice referencing unknown product (not in any tenant) -> UNKNOWN_PRODUCT (retry_later)
    insertOutbox.run(
      evtUnknownId,
      evtUnknownId,
      1,
      'invoice.created',
      'invoice.created',
      generateUuidV7(),
      JSON.stringify({
        id: generateUuidV7(),
        counterId: counter1Id,
        cashierUserId: cashier1Id,
        invoiceNumber: 'C1-990001',
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
            productId: generateUuidV7(), // Unknown product!
            batchId: validBatchId,
            quantity: 1,
            unitPricePaisa: 5000,
            discountPaisa: 0,
            taxRateBp: 0,
            taxPaisa: 0,
            lineTotalPaisa: 5000,
          },
        ],
        payments: [{ id: generateUuidV7(), method: 'cash', amountPaisa: 5000 }],
      }),
      now,
      now
    );

    // Event 2: stock adjustment referencing otherPharmacyId's product -> CROSS_TENANT_REFERENCE (rejected)
    const crossMovId = generateUuidV7();
    insertOutbox.run(
      evtCrossTenantId,
      evtCrossTenantId,
      2,
      'stock_adjustment.created',
      'stock_adjustment.created',
      crossMovId,
      JSON.stringify({
        id: crossMovId,
        movementId: crossMovId,
        productId: otherProdId, // Belongs to otherPharmacyId!
        batchId: validBatchId,
        branchId: branch1Id,
        quantitySigned: -1,
        reason: 'Cross tenant test',
        createdAt: now,
      }),
      now,
      now
    );

    // Event 3: stock adjustment dated in closed period 2026-08-15 -> LEDGER_POSTING_FAILED (rejected)
    const closedMovId = generateUuidV7();
    insertOutbox.run(
      evtClosedPeriodId,
      evtClosedPeriodId,
      3,
      'stock_adjustment.created',
      'stock_adjustment.created',
      closedMovId,
      JSON.stringify({
        id: closedMovId,
        movementId: closedMovId,
        productId: validProdId,
        batchId: validBatchId,
        branchId: branch1Id,
        quantitySigned: -1,
        reason: 'Closed period test',
        createdAt: '2026-08-15T10:00:00.000Z',
      }),
      '2026-08-15T10:00:00.000Z',
      now
    );

    const dev1Ctx = {
      pharmacyId,
      branchId: branch1Id,
      counterId: counter1Id,
      deviceId: device1Id,
    };

    const pushSummary = await pushPending(
      {
        db: localDb,
        fetch: async (_url, init) => {
          const body = JSON.parse((init?.body as string) || '{}') as {
            events: SyncEventEnvelope[];
          };
          const results = await processSyncPushEvents(serverDb, dev1Ctx, body.events);
          return new Response(JSON.stringify({ results }), { status: 200 });
        },
      },
      { serverUrl: 'http://localhost:3000', token: 'tok-1' }
    );

    expect(pushSummary.sent).toBe(3);
    expect(pushSummary.retryLater).toBe(1);
    expect(pushSummary.rejected).toBe(2);

    // Verify local outbox state: 1 pending (attempts = 1), 2 exception
    const counts = localOutbox.counts();
    expect(counts.pending).toBe(1);
    expect(counts.exception).toBe(2);
    const pendingList = localOutbox.getPending(10);
    expect(pendingList[0]?.eventId).toBe(evtUnknownId);
    expect(pendingList[0]?.attempts).toBe(1);

    const exceptions = localOutbox.listExceptions('open');
    expect(exceptions.length).toBe(2);
    const codes = exceptions.map((e) => e.code).sort();
    expect(codes).toEqual(['CROSS_TENANT_REFERENCE', 'LEDGER_POSTING_FAILED']);

    // 4. Revoked device (HTTP 401/403) -> SyncWorker transitions to 'auth_error' and preserves pending outbox events
    const worker = new SyncWorker({
      db: localDb,
      fetch: async (input) => {
        const u = input.toString();
        if (u.endsWith('/health')) return new Response('ok', { status: 200 });
        return new Response(JSON.stringify({ message: 'Device token revoked' }), { status: 401 });
      },
      tokenStore: {
        getToken: async () => 'revoked-token',
        setToken: async () => {},
        clearToken: async () => {},
      },
    });

    const statusAfterRevoke = await worker.syncNow();
    expect(statusAfterRevoke.state).toBe('auth_error');
    expect(statusAfterRevoke.pendingCount).toBe(1); // Event preserved, never deleted!
    worker.stop();

    // 5. Offline limit (> 72 hours) -> computeOfflineLevel returns 'exceeded'
    const levelResult = computeOfflineLevel(
      '2026-10-01T00:00:00.000Z',
      '2026-10-05T00:00:00.000Z', // 96 hours > 72 hours
      72
    );
    expect(levelResult.level).toBe('exceeded');
    expect(levelResult.hoursOffline).toBe(96);

    // 6. Reproduce F-H-07: Server writes `entity: 'customer'` into `change_log`,
    //    but desktop `pullAndApply.ts` skips `customer` as an unknown entity!
    const customerId = generateUuidV7();
    const custSeq = await insertChangeLog(serverDb, {
      pharmacyId,
      entity: 'customer',
      entityId: customerId,
      op: 'upsert',
      data: {
        id: customerId,
        name: 'Counter Sync Customer',
        phone: '03001234567',
        creditLimitPaisa: 100_000,
      },
    });

    // Advance localDb pull_cursor to right before custSeq (accounting for CURSOR_OVERLAP = 50)
    localDb
      .prepare(`INSERT OR REPLACE INTO sync_state (key, value) VALUES ('pull_cursor', ?)`)
      .run(String(custSeq + 50));

    const custSeq2 = await insertChangeLog(serverDb, {
      pharmacyId,
      entity: 'customer',
      entityId: customerId,
      op: 'upsert',
      data: {
        id: customerId,
        name: 'Counter Sync Customer Updated',
        phone: '03001234567',
        creditLimitPaisa: 100_000,
      },
    });
    localDb
      .prepare(`INSERT OR REPLACE INTO sync_state (key, value) VALUES ('pull_cursor', ?)`)
      .run(String(custSeq2 - 1));

    const warnings: string[] = [];
    await pullAndApply(
      {
        db: localDb,
        fetch: async (input) => {
          const u = new URL(input.toString());
          const limit = Number(u.searchParams.get('limit') ?? 200);
          const pullRes = await pullChangeLog(
            serverDb,
            { pharmacyId, branchId: branch1Id },
            { cursor: custSeq2 - 1, limit }
          );
          return new Response(JSON.stringify(pullRes), { status: 200 });
        },
        logger: {
          info: () => {},
          warn: (msg) => warnings.push(msg),
          error: () => {},
        },
      },
      { serverUrl: 'http://localhost:3000', token: 'tok-1' }
    );

    expect(warnings.some((w) => w.includes('Unknown entity type "customer"'))).toBe(false);
    const pulledCustomer = localDb
      .prepare('SELECT * FROM customers WHERE id = ?')
      .get(customerId) as { name: string; credit_limit_paisa: number } | undefined;
    expect(pulledCustomer).toBeDefined();
    expect(pulledCustomer?.name).toBe('Counter Sync Customer Updated');
    expect(pulledCustomer?.credit_limit_paisa).toBe(100_000);

    localDb.close();
  });
});
