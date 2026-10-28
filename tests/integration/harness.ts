import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../../apps/server/src/app';
import {
  isPostgresReachable,
  createTestContext,
  type TestDatabaseContext,
} from '../../apps/server/src/db/test-helper';
import {
  pharmacies,
  branches,
  counters,
  users,
  taxCategories,
  products,
  deviceRegistrationCodes,
  changeLog,
} from '../../apps/server/src/db/schema';
import { hashRegistrationCode } from '../../apps/server/src/auth/jwt';
import { MIGRATIONS } from '../../apps/desktop/src/main/db';
import { finalizeSale, type FinalizedInvoice } from '../../apps/desktop/src/main/finalizeSale';
import { processReturn } from '../../apps/desktop/src/main/returns';
import { registerDevice, type TokenStore } from '../../apps/desktop/src/main/sync/core/registration';
import { createSyncWorker, type SyncWorker } from '../../apps/desktop/src/main/sync/core/syncWorker';
import type { SyncStatus } from '../../apps/desktop/src/main/sync/core/types';
import { createNetworkProxy, type TestNetworkProxy } from './proxy';

export interface TestServer {
  baseUrl: string;
  pharmacyId: string;
  branchId: string;
  counterAId: string;
  counterBId: string;
  ownerUserId: string;
  taxCategoryId: string;
  productId: string;
  createRegistrationCode: (counterId?: string) => Promise<string>;
  runSql: (query: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  stop: () => Promise<void>;
  ctx: TestDatabaseContext;
}

export interface PurchaseLineInput {
  productId: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  costPaisa: number;
  mrpPaisa: number;
}

export interface ReceivePurchaseInput {
  supplierInvoiceNo?: string;
  lines: PurchaseLineInput[];
}

export interface TestCounter {
  name: string;
  counterId: string;
  branchId: string;
  pharmacyId: string;
  userId: string;
  db: DatabaseInstance;
  worker: SyncWorker;
  proxy: TestNetworkProxy;
  isOnline: () => boolean;
  goOffline: () => void;
  goOnline: () => void;
  syncNow: () => Promise<SyncStatus>;
  syncUntilIdle: (maxCycles?: number) => Promise<SyncStatus>;
  finalizeSale: (input: {
    clientRequestId: string;
    cashierUserId?: string;
    lines: Array<{ productId: string; quantity: number; discountPaisa?: number }>;
    payments: Array<{ method: 'cash' | 'card' | 'wallet'; amountPaisa: number }>;
    notes?: string | null;
  }) => FinalizedInvoice;
  receivePurchase: (input: ReceivePurchaseInput) => {
    purchaseId: string;
    batchIds: string[];
  };
  adjustStock: (input: {
    productId: string;
    batchId: string;
    quantitySigned: number;
    reason?: string;
  }) => { movementId: string };
  processReturn: (input: {
    originalInvoiceId: string;
    lines: Array<{ invoiceLineId: string; quantity: number }>;
    refundMethod?: 'cash' | 'card' | 'wallet';
    reason?: string;
  }) => { creditNoteId: string; creditNoteNumber: string; totalPaisa: number };
  restart: () => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * 1. startTestServer()
 * Starts the real Fastify app from apps/server on a random ephemeral port against
 * an isolated test PostgreSQL database schema, seeds pharmacy, branch, 2 counters,
 * product, tax category, and returns test helpers.
 */
export async function startTestServer(): Promise<TestServer> {
  const reachable = await isPostgresReachable();
  if (!reachable) {
    throw new Error(
      'PostgreSQL is not reachable on port 5432. Please start the database using "docker compose up -d".'
    );
  }

  const ctx = await createTestContext();
  const app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const now = new Date().toISOString();
  const pharmacyId = generateUuidV7();
  const branchId = generateUuidV7();
  const counterAId = generateUuidV7();
  const counterBId = generateUuidV7();
  const ownerUserId = generateUuidV7();
  const taxCategoryId = generateUuidV7();
  const productId = generateUuidV7();

  // 1. Seed Pharmacy
  await ctx.db.insert(pharmacies).values({
    id: pharmacyId,
    name: 'Integration Test Pharmacy',
    code: 'INTEG_' + pharmacyId.slice(0, 8),
    createdAt: now,
    updatedAt: now,
  });

  // 2. Seed Branch
  await ctx.db.insert(branches).values({
    id: branchId,
    pharmacyId,
    name: 'Main Branch',
    address: '100 Commercial Road, Lahore',
    createdAt: now,
    updatedAt: now,
  });

  // 3. Seed Counters A & B
  await ctx.db.insert(counters).values([
    {
      id: counterAId,
      pharmacyId,
      branchId,
      name: 'Counter A',
      code: 'CA',
      lastInvoiceSeq: 0,
      lastCreditNoteSeq: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: counterBId,
      pharmacyId,
      branchId,
      name: 'Counter B',
      code: 'CB',
      lastInvoiceSeq: 0,
      lastCreditNoteSeq: 0,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // 4. Seed User
  await ctx.db.insert(users).values({
    id: ownerUserId,
    pharmacyId,
    name: 'Admin Owner',
    role: 'owner',
    pinHash: 'test_pin_hash',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  // 5. Seed Tax Category (18% GST)
  await ctx.db.insert(taxCategories).values({
    id: taxCategoryId,
    pharmacyId,
    name: 'Standard GST (18%)',
    rateBp: 1800,
    isExempt: false,
    createdAt: now,
    updatedAt: now,
  });

  // 6. Seed Product (Panadol 500mg)
  await ctx.db.insert(products).values({
    id: productId,
    pharmacyId,
    brandName: 'Panadol 500mg',
    genericName: 'Paracetamol',
    strength: '500mg',
    form: 'Tablet',
    manufacturer: 'GSK Pakistan',
    barcode: '896400010001',
    taxCategoryId,
    mrpPaisa: 5000, // Rs. 50.00
    isControlled: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  // Append change_log rows for seeded master data so counters receive them on initial pull
  await ctx.db.insert(changeLog).values([
    {
      pharmacyId,
      entity: 'tax_category',
      entityId: taxCategoryId,
      op: 'upsert',
      data: {
        id: taxCategoryId,
        name: 'Standard GST (18%)',
        rateBp: 1800,
        isExempt: false,
      },
      createdAt: now,
    },
    {
      pharmacyId,
      entity: 'branch',
      entityId: branchId,
      op: 'upsert',
      data: {
        id: branchId,
        name: 'Main Branch',
      },
      createdAt: now,
    },
    {
      pharmacyId,
      entity: 'counter',
      entityId: counterAId,
      op: 'upsert',
      data: {
        id: counterAId,
        branchId,
        name: 'Counter A',
        code: 'CA',
      },
      createdAt: now,
    },
    {
      pharmacyId,
      entity: 'counter',
      entityId: counterBId,
      op: 'upsert',
      data: {
        id: counterBId,
        branchId,
        name: 'Counter B',
        code: 'CB',
      },
      createdAt: now,
    },
    {
      pharmacyId,
      entity: 'user',
      entityId: ownerUserId,
      op: 'upsert',
      data: {
        id: ownerUserId,
        name: 'Admin Owner',
        role: 'owner',
        isActive: true,
      },
      createdAt: now,
    },
    {
      pharmacyId,
      entity: 'product',
      entityId: productId,
      op: 'upsert',
      data: {
        id: productId,
        brandName: 'Panadol 500mg',
        genericName: 'Paracetamol',
        strength: '500mg',
        form: 'Tablet',
        manufacturer: 'GSK Pakistan',
        barcode: '896400010001',
        taxCategoryId,
        mrpPaisa: 5000,
        isControlled: false,
        isActive: true,
      },
      createdAt: now,
    },
  ]);

  let codeSeq = 1;
  const createRegistrationCode = async (targetCounterId?: string): Promise<string> => {
    const plainCode = `REG-TEST-${codeSeq++}-${Date.now().toString().slice(-4)}`;
    const codeId = generateUuidV7();
    const cId = targetCounterId || counterAId;

    await ctx.db.insert(deviceRegistrationCodes).values({
      id: codeId,
      pharmacyId,
      branchId,
      counterId: cId,
      codeHash: hashRegistrationCode(plainCode),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    return plainCode;
  };

  const runSql = async (
    query: string,
    params: unknown[] = []
  ): Promise<{ rows: Record<string, unknown>[] }> => {
    const res = await ctx.client.query(query, params);
    return { rows: res.rows as Record<string, unknown>[] };
  };

  const stop = async (): Promise<void> => {
    await app.close();
    await ctx.cleanup();
  };

  return {
    baseUrl,
    pharmacyId,
    branchId,
    counterAId,
    counterBId,
    ownerUserId,
    taxCategoryId,
    productId,
    createRegistrationCode,
    runSql,
    stop,
    ctx,
  };
}

/**
 * 2. createTestCounter(name, server)
 * Creates an isolated counter instance backed by a temporary SQLite file,
 * registers it against the server, initializes syncWorker and desktop services.
 */
export async function createTestCounter(
  name: string,
  server: TestServer,
  preferredCounterId?: string
): Promise<TestCounter> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `pos-counter-${name}-`));
  const dbPath = path.join(tempDir, 'counter.db');

  let db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Run desktop SQLite migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  for (const m of MIGRATIONS) {
    m.up(db);
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(m.version, m.name, new Date().toISOString());
  }

  // Network controls via controllable proxy
  const proxy = await createNetworkProxy(server.baseUrl);
  let onlineState = true;

  const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!onlineState) {
      throw new TypeError('fetch failed (Simulated Offline)');
    }
    return fetch(input, init);
  };

  // In-memory token store for test isolation
  let storedToken: string | null = null;
  const tokenStore: TokenStore = {
    setToken: async (token) => {
      storedToken = token;
    },
    getToken: async () => storedToken,
    clearToken: async () => {
      storedToken = null;
    },
  };

  // Perform real device registration against server
  const assignedCounterId = preferredCounterId || (name.includes('B') ? server.counterBId : server.counterAId);
  const code = await server.createRegistrationCode(assignedCounterId);

  const regResult = await registerDevice(
    { db, fetch: wrappedFetch as typeof fetch, tokenStore },
    { serverUrl: proxy.url, code, deviceName: name }
  );

  let worker = createSyncWorker({
    db,
    fetch: wrappedFetch as typeof fetch,
    tokenStore,
    config: {
      serverUrl: proxy.url,
      syncIntervalMs: 60000, // manual sync in tests
      maxOfflineHours: 72,
      requestTimeoutMs: 5000,
    },
  });

  // Pull initial master data (products, branch, counters, users, tax categories)
  await worker.syncNow();

  const counter: TestCounter = {
    name,
    counterId: assignedCounterId,
    branchId: regResult.branchId ?? server.branchId,
    pharmacyId: regResult.pharmacyId ?? server.pharmacyId,
    userId: server.ownerUserId,
    get db() {
      return db;
    },
    get worker() {
      return worker;
    },
    proxy,
    isOnline: () => onlineState,
    goOffline: () => {
      onlineState = false;
    },
    goOnline: () => {
      onlineState = true;
    },
    syncNow: async () => {
      return worker.syncNow();
    },
    syncUntilIdle: async (maxCycles = 15) => {
      let status: SyncStatus | null = null;
      for (let i = 0; i < maxCycles; i++) {
        status = await worker.syncNow();
        const pendingRow = db
          .prepare('SELECT COUNT(*) as count FROM outbox WHERE status = ?')
          .get('pending') as { count: number };
        if (pendingRow.count === 0 && status.state === 'online_idle') {
          return status;
        }
      }
      return status!;
    },
    finalizeSale: (input) => {
      return finalizeSale(
        {
          counterId: counter.counterId,
          cashierUserId: input.cashierUserId ?? counter.userId,
          clientRequestId: input.clientRequestId,
          lines: input.lines,
          payments: input.payments,
          notes: input.notes,
        },
        { db }
      );
    },
    receivePurchase: (input) => {
      const now = new Date().toISOString();
      const purchaseId = generateUuidV7();
      const supplierInvoiceNo = input.supplierInvoiceNo || `INV-${Date.now()}`;
      const batchIds: string[] = [];

      const insertBatchStmt = db.prepare(`
        INSERT OR IGNORE INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMovementStmt = db.prepare(`
        INSERT INTO stock_movements (id, product_id, batch_id, branch_id, type, quantity_signed, reference_type, reference_id, reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'purchase', ?, 'purchase', ?, ?, ?, ?)
      `);
      const insertOutboxStmt = db.prepare(`
        INSERT INTO outbox (
          id, event_id, device_seq, type, event_type, entity_id, payload, occurred_at, status, attempts, created_at
        ) VALUES (
          ?, ?, (SELECT COALESCE(MAX(device_seq), 0) + 1 FROM outbox), 'purchase.received', 'purchase.received', ?, ?, ?, 'pending', 0, ?
        )
      `);

      const batchesPayload: Array<{
        id: string;
        productId: string;
        batchNo: string;
        expiryDate: string;
        costPaisa: number;
        mrpPaisa: number;
      }> = [];

      const linesPayload: Array<{
        id: string;
        movementId: string;
        productId: string;
        batchId: string;
        quantity: number;
        costPaisa: number;
        mrpPaisa: number;
      }> = [];

      let totalCostPaisa = 0;

      const tx = db.transaction(() => {
        for (const line of input.lines) {
          // Check if batch already exists in SQLite
          const existing = db
            .prepare('SELECT id FROM batches WHERE product_id = ? AND batch_no = ?')
            .get(line.productId, line.batchNo) as { id: string } | undefined;

          const batchId = existing ? existing.id : generateUuidV7();
          const movementId = generateUuidV7();
          batchIds.push(batchId);

          insertBatchStmt.run(
            batchId,
            line.productId,
            line.batchNo,
            line.expiryDate,
            line.costPaisa,
            line.mrpPaisa,
            now,
            now
          );

          insertMovementStmt.run(
            movementId,
            line.productId,
            batchId,
            counter.branchId,
            line.quantity,
            purchaseId,
            `GRN: ${supplierInvoiceNo}`,
            now,
            now
          );

          totalCostPaisa += line.quantity * line.costPaisa;

          batchesPayload.push({
            id: batchId,
            productId: line.productId,
            batchNo: line.batchNo,
            expiryDate: line.expiryDate,
            costPaisa: line.costPaisa,
            mrpPaisa: line.mrpPaisa,
          });

          linesPayload.push({
            id: generateUuidV7(),
            movementId,
            productId: line.productId,
            batchId,
            quantity: line.quantity,
            costPaisa: line.costPaisa,
            mrpPaisa: line.mrpPaisa,
          });
        }

        const eventId = generateUuidV7();
        insertOutboxStmt.run(
          eventId,
          eventId,
          purchaseId,
          JSON.stringify({
            purchase: {
              id: purchaseId,
              branchId: counter.branchId,
              supplierInvoiceNo,
              invoiceDate: now.slice(0, 10),
              totalCostPaisa,
            },
            batches: batchesPayload,
            lines: linesPayload,
          }),
          now,
          now
        );
      });

      tx();

      return {
        purchaseId,
        batchIds,
      };
    },
    adjustStock: (input) => {
      const movementId = generateUuidV7();
      const eventId = generateUuidV7();
      const now = new Date().toISOString();
      const reason = input.reason || 'Inventory count adjustment';

      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO stock_movements (
            id, product_id, batch_id, branch_id, type, quantity_signed,
            reference_type, reference_id, reason, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'adjustment', ?, 'stock_adjustment', ?, ?, ?, ?)
        `).run(movementId, input.productId, input.batchId, counter.branchId, input.quantitySigned, movementId, reason, now, now);

        const payload = {
          movementId,
          branchId: counter.branchId,
          productId: input.productId,
          batchId: input.batchId,
          quantitySigned: input.quantitySigned,
          reasonType: 'damage',
          reason,
          createdAt: now,
        };

        db.prepare(`
          INSERT INTO outbox (
            id, event_id, device_seq, type, event_type, entity_id, payload, occurred_at, status, attempts, created_at
          ) VALUES (
            ?, ?, (SELECT COALESCE(MAX(device_seq), 0) + 1 FROM outbox), 'stock_adjustment.created', 'stock_adjustment.created', ?, ?, ?, 'pending', 0, ?
          )
        `).run(eventId, eventId, movementId, JSON.stringify(payload), now, now);
      });

      tx();
      return { movementId };
    },
    processReturn: (input) => {
      const result = processReturn(
        {
          originalInvoiceId: input.originalInvoiceId,
          lines: input.lines,
          refundMethod: input.refundMethod ?? 'cash',
          reason: 'customer_return',
          clientRequestId: generateUuidV7(),
        },
        {
          db,
          branchId: counter.branchId,
          counterId: counter.counterId,
          cashierUserId: counter.userId,
        }
      );
      return {
        creditNoteId: result.id,
        creditNoteNumber: result.creditNoteNumber,
        totalPaisa: result.totalPaisa,
      };
    },
    restart: async () => {
      worker.stop();
      db.close();

      db = new Database(dbPath);
      db.pragma('foreign_keys = ON');
      db.pragma('journal_mode = WAL');

      worker = createSyncWorker({
        db,
        fetch: wrappedFetch as typeof fetch,
        tokenStore,
        config: {
          serverUrl: proxy.url,
          syncIntervalMs: 60000,
          maxOfflineHours: 72,
          requestTimeoutMs: 5000,
        },
      });
    },
    cleanup: async () => {
      worker.stop();
      db.close();
      await proxy.close();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };

  return counter;
}

/**
 * Helper Assertions (Requirement 4)
 */
export async function serverStockForBatch(server: TestServer, batchId: string): Promise<number> {
  const res = await server.runSql(
    `SELECT COALESCE(SUM(quantity_signed), 0) as balance FROM stock_movements WHERE batch_id = $1`,
    [batchId]
  );
  return Number(res.rows[0]?.balance ?? 0);
}

export function localStockForBatch(counter: TestCounter, batchId: string): number {
  const row = counter.db
    .prepare('SELECT COALESCE(SUM(quantity_signed), 0) as balance FROM stock_movements WHERE batch_id = ?')
    .get(batchId) as { balance: number } | undefined;
  return Number(row?.balance ?? 0);
}

export async function countServerInvoices(server: TestServer): Promise<number> {
  const res = await server.runSql(`SELECT COUNT(*) as count FROM invoices`);
  return Number(res.rows[0]?.count ?? 0);
}

export function countOutbox(counter: TestCounter, status: string): number {
  const row = counter.db
    .prepare('SELECT COUNT(*) as count FROM outbox WHERE status = ?')
    .get(status) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}
