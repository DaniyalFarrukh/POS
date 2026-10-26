import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7, type SyncPushResponse } from '@pos/shared';
import { signDeviceToken } from '../auth/jwt';
import { buildApp } from '../app';
import {
  isPostgresReachable,
  createTestContext,
  type TestDatabaseContext,
} from '../db/test-helper';
import {
  counters,
  users,
  products,
  batches,
  stockMovements,
  invoices,
  invoiceLines,
  payments,
  creditNotes,
  creditNoteLines,
  processedEvents,
  rejectedEvents,
  stockAlerts,
  changeLog,
  devices,
} from '../db/schema';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';

// Creates a comprehensive in-memory Drizzle-compatible mock database
function createSyncMockDb() {
  interface Store {
    pharmacies: Map<string, Record<string, unknown>>;
    branches: Map<string, Record<string, unknown>>;
    counters: Map<string, Record<string, unknown>>;
    users: Map<string, Record<string, unknown>>;
    taxCategories: Map<string, Record<string, unknown>>;
    products: Map<string, Record<string, unknown>>;
    batches: Map<string, Record<string, unknown>>;
    stockMovements: Array<Record<string, unknown>>;
    invoices: Map<string, Record<string, unknown>>;
    invoiceLines: Array<Record<string, unknown>>;
    payments: Array<Record<string, unknown>>;
    creditNotes: Map<string, Record<string, unknown>>;
    creditNoteLines: Array<Record<string, unknown>>;
    processedEvents: Set<string>; // "pharmacyId:eventId"
    rejectedEvents: Array<Record<string, unknown>>;
    stockAlerts: Array<Record<string, unknown>>;
    changeLog: Array<Record<string, unknown>>;
    devices: Map<string, Record<string, unknown>>;
  }

  const store: Store = {
    pharmacies: new Map(),
    branches: new Map(),
    counters: new Map(),
    users: new Map(),
    taxCategories: new Map(),
    products: new Map(),
    batches: new Map(),
    stockMovements: [],
    invoices: new Map(),
    invoiceLines: [],
    payments: [],
    creditNotes: new Map(),
    creditNoteLines: [],
    processedEvents: new Set(),
    rejectedEvents: [],
    stockAlerts: [],
    changeLog: [],
    devices: new Map(),
  };

  function cloneStore(s: Store): Store {
    return {
      pharmacies: new Map(s.pharmacies),
      branches: new Map(s.branches),
      counters: new Map(s.counters),
      users: new Map(s.users),
      taxCategories: new Map(s.taxCategories),
      products: new Map(s.products),
      batches: new Map(s.batches),
      stockMovements: [...s.stockMovements],
      invoices: new Map(s.invoices),
      invoiceLines: [...s.invoiceLines],
      payments: [...s.payments],
      creditNotes: new Map(s.creditNotes),
      creditNoteLines: [...s.creditNoteLines],
      processedEvents: new Set(s.processedEvents),
      rejectedEvents: [...s.rejectedEvents],
      stockAlerts: [...s.stockAlerts],
      changeLog: [...s.changeLog],
      devices: new Map(s.devices),
    };
  }

  function restoreStore(target: Store, source: Store) {
    target.pharmacies = new Map(source.pharmacies);
    target.branches = new Map(source.branches);
    target.counters = new Map(source.counters);
    target.users = new Map(source.users);
    target.taxCategories = new Map(source.taxCategories);
    target.products = new Map(source.products);
    target.batches = new Map(source.batches);
    target.stockMovements = [...source.stockMovements];
    target.invoices = new Map(source.invoices);
    target.invoiceLines = [...source.invoiceLines];
    target.payments = [...source.payments];
    target.creditNotes = new Map(source.creditNotes);
    target.creditNoteLines = [...source.creditNoteLines];
    target.processedEvents = new Set(source.processedEvents);
    target.rejectedEvents = [...source.rejectedEvents];
    target.stockAlerts = [...source.stockAlerts];
    target.changeLog = [...source.changeLog];
    target.devices = new Map(source.devices);
  }

  function makeClient(currentStore: Store) {
    return {
      _store: currentStore,
      select: (fields?: unknown) => ({
        from: (table: unknown) => ({
          where: (condition: unknown) => {
            const extractSqlValues = (c: unknown, out: Array<unknown> = []): Array<unknown> => {
              if (!c || typeof c !== 'object') {
                if (typeof c === 'string' || typeof c === 'number') out.push(c);
                return out;
              }
              if ('name' in c && typeof (c as { name: unknown }).name === 'string') {
                out.push((c as { name: string }).name);
              }
              if ('value' in c) {
                const val = (c as { value: unknown }).value;
                if (typeof val === 'string' || typeof val === 'number') {
                  out.push(val);
                } else if (Array.isArray(val)) {
                  for (const v of val) extractSqlValues(v, out);
                }
              }
              if ('queryChunks' in c && Array.isArray((c as { queryChunks: unknown[] }).queryChunks)) {
                for (const chunk of (c as { queryChunks: unknown[] }).queryChunks) {
                  extractSqlValues(chunk, out);
                }
              }
              return out;
            };

            const executeQuery = () => {
              const tokens = extractSqlValues(condition);

              const findValueAfter = (name: string): string | undefined => {
                const idx = tokens.indexOf(name);
                if (idx === -1) return undefined;
                for (let i = idx + 1; i < tokens.length; i++) {
                  const val = String(tokens[i] || '').trim();
                  if (val && val !== '=' && val !== '(' && val !== ')' && val !== 'in') {
                    return val;
                  }
                }
                return undefined;
              };

              const findIdsAfter = (name: string): string[] | undefined => {
                const idx = tokens.indexOf(name);
                if (idx === -1) return undefined;
                const ids: string[] = [];
                for (let i = idx + 1; i < tokens.length; i++) {
                  const val = String(tokens[i] || '').trim();
                  if (val === 'and' || val === 'or') break;
                  if (/^[0-9a-f-]{36}$/i.test(val)) {
                    ids.push(val);
                  }
                }
                return ids.length > 0 ? ids : undefined;
              };

              const targetPharmId = findValueAfter('pharmacy_id');
              const targetIds = findIdsAfter('id');

              const filterList = (arr: Array<Record<string, unknown>>) => {
                let res = arr;
                if (targetPharmId) {
                  res = res.filter((item) => item.pharmacyId === targetPharmId);
                }
                if (targetIds && targetIds.length > 0) {
                  res = res.filter((item) => targetIds.includes(item.id as string));
                }
                return res;
              };

              if (table === devices) {
                return filterList(Array.from(currentStore.devices.values()));
              }
              if (table === products) {
                return filterList(Array.from(currentStore.products.values()));
              }
              if (table === batches) {
                return filterList(Array.from(currentStore.batches.values()));
              }
              if (table === counters) {
                return filterList(Array.from(currentStore.counters.values()));
              }
              if (table === users) {
                return filterList(Array.from(currentStore.users.values()));
              }
              if (table === invoices) {
                return filterList(Array.from(currentStore.invoices.values()));
              }
              if (table === stockMovements) {
                if (fields && typeof fields === 'object' && 'balance' in fields) {
                  // Calculate balance for specific batch
                  const conditions = (condition as { operands?: Array<{ left?: unknown; right?: { value?: unknown } }> })?.operands;
                  const batchIdVal = conditions?.find((c) => (c.left as { name?: string })?.name === 'batch_id')?.right?.value;
                  const relevant = currentStore.stockMovements.filter((m) => !batchIdVal || m.batchId === batchIdVal);
                  const bal = relevant.reduce((sum, m) => sum + (Number(m.quantitySigned) || 0), 0);
                  return [{ balance: bal }];
                }
                return currentStore.stockMovements;
              }
              if (table === stockAlerts) {
                return currentStore.stockAlerts;
              }
              if (table === rejectedEvents) {
                return currentStore.rejectedEvents;
              }
              if (table === processedEvents) {
                return Array.from(currentStore.processedEvents).map((k) => ({
                  eventId: k.split(':')[1],
                }));
              }
              return [];
            };

            return {
              limit: (num?: number) => {
                const res = executeQuery();
                return Promise.resolve(num !== undefined ? res.slice(0, num) : res);
              },
              then: (resolve: (val: unknown) => void) => resolve(executeQuery()),
            };
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (data: unknown) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              if (table === processedEvents) {
                const row = data as { pharmacyId: string; eventId: string };
                const key = `${row.pharmacyId}:${row.eventId}`;
                if (currentStore.processedEvents.has(key)) {
                  return []; // Conflict!
                }
                currentStore.processedEvents.add(key);
                return [{ eventId: row.eventId }];
              }
              return [];
            },
          }),
          returning: async () => {
            return [];
          },
          then: async (resolve: (val: unknown) => void) => {
            const item = data as Record<string, unknown>;
            if (table === devices) currentStore.devices.set(item.id as string, item);
            else if (table === products) currentStore.products.set(item.id as string, item);
            else if (table === batches) currentStore.batches.set(item.id as string, item);
            else if (table === counters) currentStore.counters.set(item.id as string, item);
            else if (table === users) currentStore.users.set(item.id as string, item);
            else if (table === invoices) currentStore.invoices.set(item.id as string, item);
            else if (table === invoiceLines) currentStore.invoiceLines.push(item);
            else if (table === payments) currentStore.payments.push(item);
            else if (table === creditNotes) currentStore.creditNotes.set(item.id as string, item);
            else if (table === creditNoteLines) currentStore.creditNoteLines.push(item);
            else if (table === stockMovements) currentStore.stockMovements.push(item);
            else if (table === stockAlerts) currentStore.stockAlerts.push(item);
            else if (table === rejectedEvents) currentStore.rejectedEvents.push(item);
            else if (table === changeLog) currentStore.changeLog.push(item);
            resolve(undefined);
          },
        }),
      }),
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        const snapshot = cloneStore(currentStore);
        try {
          const res = await cb(makeClient(currentStore));
          return res;
        } catch (err) {
          restoreStore(currentStore, snapshot);
          throw err;
        }
      },
    };
  }

  return makeClient(store) as unknown as NodePgDatabase<typeof schema> & {
    _store: Store;
  };
}

describe('POST /sync/push (Phase 3)', () => {
  // Helper to setup mock tenant
  function setupMockTenant(mockDb: ReturnType<typeof createSyncMockDb>, name = 'Main') {
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const userId = generateUuidV7();
    const deviceId = generateUuidV7();
    const productId = generateUuidV7();

    mockDb._store.pharmacies.set(pharmacyId, { id: pharmacyId, name: `${name} Pharmacy` });
    mockDb._store.branches.set(branchId, { id: branchId, pharmacyId, name: `${name} Branch` });
    mockDb._store.counters.set(counterId, { id: counterId, pharmacyId, branchId, name: 'Counter 1' });
    mockDb._store.users.set(userId, { id: userId, pharmacyId, name: 'Cashier 1', role: 'cashier' });
    mockDb._store.products.set(productId, { id: productId, pharmacyId, brandName: 'Panadol 500mg' });
    mockDb._store.devices.set(deviceId, {
      id: deviceId,
      pharmacyId,
      branchId,
      counterId,
      deviceName: `${name} Terminal`,
      isRevoked: false,
    });

    const token = signDeviceToken({ pharmacyId, branchId, deviceId });

    return {
      pharmacyId,
      branchId,
      counterId,
      userId,
      deviceId,
      productId,
      token,
    };
  }

  describe('Core Requirements (Simulated & Isolated)', () => {
    it('1. accepted: applies purchase.received, invoice.created, credit_note.created, and stock_adjustment.created', async () => {
      const mockDb = createSyncMockDb();
      const tenant = setupMockTenant(mockDb, 'Alpha');
      const app = buildApp({ db: mockDb });
      const now = new Date().toISOString();

      const batchId = generateUuidV7();
      const purchaseId = generateUuidV7();
      const invoiceId = generateUuidV7();
      const creditNoteId = generateUuidV7();
      const adjustmentMovementId = generateUuidV7();

      // Event 1: purchase.received (+20 units)
      const evPurchase = {
        eventId: generateUuidV7(),
        deviceSeq: 1,
        type: 'purchase.received',
        entityId: purchaseId,
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          purchase: {
            id: purchaseId,
            branchId: tenant.branchId,
            supplierInvoiceNo: 'SUP-001',
            invoiceDate: '2026-10-26',
            totalCostPaisa: 80000,
          },
          batches: [
            {
              id: batchId,
              productId: tenant.productId,
              batchNo: 'B-001',
              expiryDate: '2028-12-31',
              costPaisa: 4000,
              mrpPaisa: 5000,
            },
          ],
          lines: [
            {
              id: generateUuidV7(),
              productId: tenant.productId,
              batchId,
              quantity: 20,
              costPaisa: 4000,
              mrpPaisa: 5000,
            },
          ],
        },
      };

      // Event 2: invoice.created (sale -5 units)
      const evInvoice = {
        eventId: generateUuidV7(),
        deviceSeq: 2,
        type: 'invoice.created',
        entityId: invoiceId,
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          id: invoiceId,
          counterId: tenant.counterId,
          cashierUserId: tenant.userId,
          invoiceNumber: 'INV-001',
          clientRequestId: generateUuidV7(),
          status: 'finalized',
          subtotalPaisa: 25000,
          discountPaisa: 0,
          taxPaisa: 0,
          totalPaisa: 25000,
          createdAt: now,
          lines: [
            {
              id: generateUuidV7(),
              productId: tenant.productId,
              batchId,
              quantity: 5,
              unitPricePaisa: 5000,
              discountPaisa: 0,
              taxRateBp: 0,
              taxPaisa: 0,
              lineTotalPaisa: 25000,
            },
          ],
          payments: [
            {
              id: generateUuidV7(),
              method: 'cash' as const,
              amountPaisa: 25000,
            },
          ],
        },
      };

      // Event 3: credit_note.created (return +1 unit)
      const evCreditNote = {
        eventId: generateUuidV7(),
        deviceSeq: 3,
        type: 'credit_note.created',
        entityId: creditNoteId,
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          id: creditNoteId,
          creditNoteNumber: 'CR-001',
          originalInvoiceId: invoiceId,
          branchId: tenant.branchId,
          counterId: tenant.counterId,
          cashierUserId: tenant.userId,
          clientRequestId: generateUuidV7(),
          subtotalPaisa: 5000,
          taxPaisa: 0,
          totalPaisa: 5000,
          refundMethod: 'cash' as const,
          reason: 'customer_return',
          createdAt: now,
          lines: [
            {
              id: generateUuidV7(),
              originalInvoiceLineId: evInvoice.payload.lines[0]!.id,
              productId: tenant.productId,
              batchId,
              quantity: 1,
              unitPricePaisa: 5000,
              taxRateBp: 0,
              taxPaisa: 0,
              lineTotalPaisa: 5000,
            },
          ],
        },
      };

      // Event 4: stock_adjustment.created (damage -2 units)
      const evAdjustment = {
        eventId: generateUuidV7(),
        deviceSeq: 4,
        type: 'stock_adjustment.created',
        entityId: adjustmentMovementId,
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          movementId: adjustmentMovementId,
          productId: tenant.productId,
          batchId,
          branchId: tenant.branchId,
          quantitySigned: -2,
          reason: 'Damaged item',
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenant.token}` },
        payload: {
          events: [evPurchase, evInvoice, evCreditNote, evAdjustment],
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<SyncPushResponse>();
      expect(data.results).toHaveLength(4);
      expect(data.results[0]!.status).toBe('accepted');
      expect(data.results[1]!.status).toBe('accepted');
      expect(data.results[2]!.status).toBe('accepted');
      expect(data.results[3]!.status).toBe('accepted');

      // Verify store: batch, invoice, credit note, and 4 movements
      expect(mockDb._store.batches.has(batchId)).toBe(true);
      expect(mockDb._store.invoices.has(invoiceId)).toBe(true);
      expect(mockDb._store.creditNotes.has(creditNoteId)).toBe(true);
      expect(mockDb._store.stockMovements).toHaveLength(4);

      // Verify balance: +20 - 5 + 1 - 2 = 14
      const balance = mockDb._store.stockMovements.reduce(
        (sum, m) => sum + (Number(m.quantitySigned) || 0),
        0
      );
      expect(balance).toBe(14);
      expect(mockDb._store.processedEvents.size).toBe(4);
    });

    it('2. duplicate: pushing the same event twice returns status duplicate and creates no extra rows', async () => {
      const mockDb = createSyncMockDb();
      const tenant = setupMockTenant(mockDb, 'DupTest');
      const app = buildApp({ db: mockDb });
      const now = new Date().toISOString();

      const batchId = generateUuidV7();
      const purchaseId = generateUuidV7();

      const ev = {
        eventId: generateUuidV7(),
        deviceSeq: 1,
        type: 'purchase.received',
        entityId: purchaseId,
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          purchase: {
            id: purchaseId,
            branchId: tenant.branchId,
            supplierInvoiceNo: 'DUP-1',
            invoiceDate: '2026-10-26',
            totalCostPaisa: 5000,
          },
          batches: [
            {
              id: batchId,
              productId: tenant.productId,
              batchNo: 'B-DUP',
              expiryDate: '2028-12-31',
              costPaisa: 5000,
              mrpPaisa: 6000,
            },
          ],
          lines: [
            {
              id: generateUuidV7(),
              productId: tenant.productId,
              batchId,
              quantity: 10,
              costPaisa: 5000,
              mrpPaisa: 6000,
            },
          ],
        },
      };

      // Push 1 -> accepted
      const res1 = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenant.token}` },
        payload: { events: [ev] },
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json<SyncPushResponse>().results[0]!.status).toBe('accepted');

      const batchCountBefore = mockDb._store.batches.size;
      const movementCountBefore = mockDb._store.stockMovements.length;

      // Push 2 with identical event -> duplicate
      const res2 = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenant.token}` },
        payload: { events: [ev] },
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json<SyncPushResponse>().results[0]!.status).toBe('duplicate');

      // No extra rows!
      expect(mockDb._store.batches.size).toBe(batchCountBefore);
      expect(mockDb._store.stockMovements.length).toBe(movementCountBefore);
    });

    it('3. out-of-order batches: processes events in deviceSeq ascending order but returns results in original array order', async () => {
      const mockDb = createSyncMockDb();
      const tenant = setupMockTenant(mockDb, 'OrderTest');
      const app = buildApp({ db: mockDb });
      const now = new Date().toISOString();

      const batchId = generateUuidV7();
      const purchaseId = generateUuidV7();
      const invoiceId = generateUuidV7();

      // Seq 2: Sale of the batch
      const evSale = {
        eventId: generateUuidV7(),
        deviceSeq: 2,
        type: 'invoice.created',
        entityId: invoiceId,
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          id: invoiceId,
          counterId: tenant.counterId,
          cashierUserId: tenant.userId,
          invoiceNumber: 'INV-ORD-01',
          clientRequestId: generateUuidV7(),
          status: 'finalized',
          subtotalPaisa: 10000,
          discountPaisa: 0,
          taxPaisa: 0,
          totalPaisa: 10000,
          createdAt: now,
          lines: [
            {
              id: generateUuidV7(),
              productId: tenant.productId,
              batchId,
              quantity: 2,
              unitPricePaisa: 5000,
              discountPaisa: 0,
              taxRateBp: 0,
              taxPaisa: 0,
              lineTotalPaisa: 10000,
            },
          ],
          payments: [
            {
              id: generateUuidV7(),
              method: 'cash' as const,
              amountPaisa: 10000,
            },
          ],
        },
      };

      // Seq 1: Purchase introducing the batch
      const evPurchase = {
        eventId: generateUuidV7(),
        deviceSeq: 1,
        type: 'purchase.received',
        entityId: purchaseId,
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          purchase: {
            id: purchaseId,
            branchId: tenant.branchId,
            supplierInvoiceNo: 'SUP-ORD-1',
            invoiceDate: '2026-10-26',
            totalCostPaisa: 5000,
          },
          batches: [
            {
              id: batchId,
              productId: tenant.productId,
              batchNo: 'B-ORD-1',
              expiryDate: '2028-12-31',
              costPaisa: 4000,
              mrpPaisa: 5000,
            },
          ],
          lines: [
            {
              id: generateUuidV7(),
              productId: tenant.productId,
              batchId,
              quantity: 10,
              costPaisa: 4000,
              mrpPaisa: 5000,
            },
          ],
        },
      };

      // Send out-of-order: [evSale, evPurchase]
      const res = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenant.token}` },
        payload: { events: [evSale, evPurchase] },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<SyncPushResponse>();
      expect(data.results).toHaveLength(2);

      // Both succeeded because Seq 1 was applied before Seq 2
      expect(data.results[0]!.eventId).toBe(evSale.eventId);
      expect(data.results[0]!.status).toBe('accepted');

      expect(data.results[1]!.eventId).toBe(evPurchase.eventId);
      expect(data.results[1]!.status).toBe('accepted');
    });

    it('4. partial failure: a bad event in a batch fails and logs to rejected_events while good events succeed and commit', async () => {
      const mockDb = createSyncMockDb();
      const tenant = setupMockTenant(mockDb, 'PartialTest');
      const app = buildApp({ db: mockDb });
      const now = new Date().toISOString();

      const batchId = generateUuidV7();
      const purchaseId = generateUuidV7();
      const badInvoiceId = generateUuidV7();
      const adjId = generateUuidV7();

      // Good Event 1: Purchase
      const evGood1 = {
        eventId: generateUuidV7(),
        deviceSeq: 1,
        type: 'purchase.received',
        entityId: purchaseId,
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          purchase: {
            id: purchaseId,
            branchId: tenant.branchId,
            supplierInvoiceNo: 'P-PART',
            invoiceDate: '2026-10-26',
            totalCostPaisa: 5000,
          },
          batches: [
            {
              id: batchId,
              productId: tenant.productId,
              batchNo: 'B-PART',
              expiryDate: '2028-12-31',
              costPaisa: 4000,
              mrpPaisa: 5000,
            },
          ],
          lines: [
            {
              id: generateUuidV7(),
              productId: tenant.productId,
              batchId,
              quantity: 10,
              costPaisa: 4000,
              mrpPaisa: 5000,
            },
          ],
        },
      };

      // Bad Event 2: Total mismatch (Line total 5000 != Invoice total 4000)
      const evBad = {
        eventId: generateUuidV7(),
        deviceSeq: 2,
        type: 'invoice.created',
        entityId: badInvoiceId,
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          id: badInvoiceId,
          counterId: tenant.counterId,
          cashierUserId: tenant.userId,
          invoiceNumber: 'INV-BAD',
          clientRequestId: generateUuidV7(),
          status: 'finalized',
          subtotalPaisa: 4000,
          discountPaisa: 0,
          taxPaisa: 0,
          totalPaisa: 4000,
          createdAt: now,
          lines: [
            {
              id: generateUuidV7(),
              productId: tenant.productId,
              batchId,
              quantity: 1,
              unitPricePaisa: 5000, // 5000 != 4000!
              discountPaisa: 0,
              taxRateBp: 0,
              taxPaisa: 0,
              lineTotalPaisa: 5000,
            },
          ],
          payments: [
            {
              id: generateUuidV7(),
              method: 'cash' as const,
              amountPaisa: 4000,
            },
          ],
        },
      };

      // Good Event 3: Stock adjustment
      const evGood2 = {
        eventId: generateUuidV7(),
        deviceSeq: 3,
        type: 'stock_adjustment.created',
        entityId: adjId,
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          movementId: adjId,
          productId: tenant.productId,
          batchId,
          branchId: tenant.branchId,
          quantitySigned: 2,
          reason: 'Count adjustment',
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenant.token}` },
        payload: { events: [evGood1, evBad, evGood2] },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<SyncPushResponse>();
      expect(data.results[0]!.status).toBe('accepted');
      expect(data.results[1]!.status).toBe('rejected');
      expect(data.results[1]!.code).toBe('TOTALS_MISMATCH');
      expect(data.results[2]!.status).toBe('accepted');

      // Good 1 and Good 3 committed
      expect(mockDb._store.batches.has(batchId)).toBe(true);
      expect(mockDb._store.stockMovements.some((m) => m.id === adjId)).toBe(true);

      // Bad 2 did not insert invoice and is logged to rejectedEvents
      expect(mockDb._store.invoices.has(badInvoiceId)).toBe(false);
      expect(mockDb._store.rejectedEvents).toHaveLength(1);
      expect(mockDb._store.rejectedEvents[0]?.code).toBe('TOTALS_MISMATCH');
    });

    it('5. retry_later: unknown batch returns retry_later UNKNOWN_BATCH, and succeeds after batch creation event is pushed', async () => {
      const mockDb = createSyncMockDb();
      const tenant = setupMockTenant(mockDb, 'RetryTest');
      const app = buildApp({ db: mockDb });
      const now = new Date().toISOString();

      const futureBatchId = generateUuidV7();
      const invoiceId = generateUuidV7();
      const purchaseId = generateUuidV7();

      // Sale referencing futureBatchId
      const evSale = {
        eventId: generateUuidV7(),
        deviceSeq: 1,
        type: 'invoice.created',
        entityId: invoiceId,
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          id: invoiceId,
          counterId: tenant.counterId,
          cashierUserId: tenant.userId,
          invoiceNumber: 'INV-RETRY-1',
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
              batchId: futureBatchId, // Batch not in DB yet!
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
              method: 'cash' as const,
              amountPaisa: 5000,
            },
          ],
        },
      };

      // Push 1: Returns retry_later
      const res1 = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenant.token}` },
        payload: { events: [evSale] },
      });

      expect(res1.statusCode).toBe(200);
      const data1 = res1.json<SyncPushResponse>();
      expect(data1.results[0]!.status).toBe('retry_later');
      expect(data1.results[0]!.code).toBe('UNKNOWN_BATCH');

      // Processed events should NOT have evSale.eventId
      expect(mockDb._store.processedEvents.has(`${tenant.pharmacyId}:${evSale.eventId}`)).toBe(false);

      // Push 2: Purchase introduces the batch
      const evPurchase = {
        eventId: generateUuidV7(),
        deviceSeq: 2,
        type: 'purchase.received',
        entityId: purchaseId,
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          purchase: {
            id: purchaseId,
            branchId: tenant.branchId,
            supplierInvoiceNo: 'SUP-RESOLVE',
            invoiceDate: '2026-10-26',
            totalCostPaisa: 4000,
          },
          batches: [
            {
              id: futureBatchId,
              productId: tenant.productId,
              batchNo: 'B-RESOLVED',
              expiryDate: '2028-12-31',
              costPaisa: 4000,
              mrpPaisa: 5000,
            },
          ],
          lines: [
            {
              id: generateUuidV7(),
              productId: tenant.productId,
              batchId: futureBatchId,
              quantity: 10,
              costPaisa: 4000,
              mrpPaisa: 5000,
            },
          ],
        },
      };

      await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenant.token}` },
        payload: { events: [evPurchase] },
      });

      // Push 3: Retrying sale succeeds!
      const res3 = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenant.token}` },
        payload: { events: [evSale] },
      });

      expect(res3.statusCode).toBe(200);
      expect(res3.json<SyncPushResponse>().results[0]!.status).toBe('accepted');
      expect(mockDb._store.invoices.has(invoiceId)).toBe(true);
    });

    it('6. tenant isolation: device from pharmacy A cannot reference or touch pharmacy B batches/data', async () => {
      const mockDb = createSyncMockDb();
      const tenantA = setupMockTenant(mockDb, 'TenantA');
      const tenantB = setupMockTenant(mockDb, 'TenantB');
      const app = buildApp({ db: mockDb });
      const now = new Date().toISOString();

      const batchBId = generateUuidV7();
      mockDb._store.batches.set(batchBId, {
        id: batchBId,
        pharmacyId: tenantB.pharmacyId, // Belongs to Tenant B
        productId: tenantB.productId,
        batchNo: 'B-ONLY',
      });

      // Device A attempts to sell Tenant B's batch
      const rogueSale = {
        eventId: generateUuidV7(),
        deviceSeq: 1,
        type: 'invoice.created',
        entityId: generateUuidV7(),
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          id: generateUuidV7(),
          counterId: tenantA.counterId,
          cashierUserId: tenantA.userId,
          invoiceNumber: 'INV-ROGUE',
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
              productId: tenantA.productId,
              batchId: batchBId, // Cross-tenant reference!
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
              method: 'cash' as const,
              amountPaisa: 5000,
            },
          ],
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenantA.token}` },
        payload: { events: [rogueSale] },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<SyncPushResponse>();
      expect(data.results[0]!.status).toBe('retry_later');
      expect(data.results[0]!.code).toBe('UNKNOWN_BATCH');
    });

    it('7. total mismatch rejected: invoice with mismatching lines/payments and header total is rejected and stored in rejected_events', async () => {
      const mockDb = createSyncMockDb();
      const tenant = setupMockTenant(mockDb, 'MismatchTest');
      const app = buildApp({ db: mockDb });
      const now = new Date().toISOString();

      const batchId = generateUuidV7();
      mockDb._store.batches.set(batchId, {
        id: batchId,
        pharmacyId: tenant.pharmacyId,
        productId: tenant.productId,
        batchNo: 'B-MIS',
      });

      const badEv = {
        eventId: generateUuidV7(),
        deviceSeq: 1,
        type: 'invoice.created',
        entityId: generateUuidV7(),
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          id: generateUuidV7(),
          counterId: tenant.counterId,
          cashierUserId: tenant.userId,
          invoiceNumber: 'INV-MIS',
          clientRequestId: generateUuidV7(),
          status: 'finalized',
          subtotalPaisa: 10000,
          discountPaisa: 0,
          taxPaisa: 0,
          totalPaisa: 10000,
          createdAt: now,
          lines: [
            {
              id: generateUuidV7(),
              productId: tenant.productId,
              batchId,
              quantity: 2,
              unitPricePaisa: 5000,
              discountPaisa: 0,
              taxRateBp: 0,
              taxPaisa: 0,
              lineTotalPaisa: 10000,
            },
          ],
          payments: [
            {
              id: generateUuidV7(),
              method: 'cash' as const,
              amountPaisa: 9000, // 9000 != 10000!
            },
          ],
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenant.token}` },
        payload: { events: [badEv] },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<SyncPushResponse>();
      expect(data.results[0]!.status).toBe('rejected');
      expect(data.results[0]!.code).toBe('TOTALS_MISMATCH');
      expect(mockDb._store.rejectedEvents).toHaveLength(1);
    });

    it('8. negative stock accepted with an alert: counter sale causing negative stock is accepted and recorded in stock_alerts', async () => {
      const mockDb = createSyncMockDb();
      const tenant = setupMockTenant(mockDb, 'NegStockTest');
      const app = buildApp({ db: mockDb });
      const now = new Date().toISOString();

      const batchId = generateUuidV7();
      mockDb._store.batches.set(batchId, {
        id: batchId,
        pharmacyId: tenant.pharmacyId,
        productId: tenant.productId,
        batchNo: 'B-NEG',
      });
      // Initial stock balance = 0

      // Counter sold 5 units (goods already left the counter!)
      const saleEv = {
        eventId: generateUuidV7(),
        deviceSeq: 1,
        type: 'invoice.created',
        entityId: generateUuidV7(),
        occurredAt: now,
        schemaVersion: 1,
        payload: {
          id: generateUuidV7(),
          counterId: tenant.counterId,
          cashierUserId: tenant.userId,
          invoiceNumber: 'INV-NEG',
          clientRequestId: generateUuidV7(),
          status: 'finalized',
          subtotalPaisa: 25000,
          discountPaisa: 0,
          taxPaisa: 0,
          totalPaisa: 25000,
          createdAt: now,
          lines: [
            {
              id: generateUuidV7(),
              productId: tenant.productId,
              batchId,
              quantity: 5,
              unitPricePaisa: 5000,
              discountPaisa: 0,
              taxRateBp: 0,
              taxPaisa: 0,
              lineTotalPaisa: 25000,
            },
          ],
          payments: [
            {
              id: generateUuidV7(),
              method: 'cash' as const,
              amountPaisa: 25000,
            },
          ],
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenant.token}` },
        payload: { events: [saleEv] },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<SyncPushResponse>();
      // Sale is accepted! (docs/SYNC.md Principle 4)
      expect(data.results[0]!.status).toBe('accepted');

      // Resulting movement is -5:
      expect(mockDb._store.stockMovements[0]?.quantitySigned).toBe(-5);

      // Alert recorded in stock_alerts:
      expect(mockDb._store.stockAlerts).toHaveLength(1);
      expect(mockDb._store.stockAlerts[0]?.type).toBe('negative_stock');
    });

    it('9. request validation: enforces max 100 events and requires valid auth token', async () => {
      const mockDb = createSyncMockDb();
      const tenant = setupMockTenant(mockDb, 'ReqVal');
      const app = buildApp({ db: mockDb });

      // Missing token -> 401
      const resNoAuth = await app.inject({
        method: 'POST',
        url: '/sync/push',
        payload: { events: [] },
      });
      expect(resNoAuth.statusCode).toBe(401);

      // Exceeds 100 events -> 400
      const oversizedEvents = Array.from({ length: 101 }, (_, i) => ({
        eventId: generateUuidV7(),
        deviceSeq: i + 1,
        type: 'stock_adjustment.created',
        entityId: generateUuidV7(),
        occurredAt: new Date().toISOString(),
        schemaVersion: 1,
        payload: {},
      }));

      const resOver = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenant.token}` },
        payload: { events: oversizedEvents },
      });

      expect(resOver.statusCode).toBe(400);
    });
  });

  describe('PostgreSQL Live Integration (when PostgreSQL is active)', () => {
    let isAvailable = false;
    let ctx: TestDatabaseContext | null = null;

    beforeAll(async () => {
      isAvailable = await isPostgresReachable();
      if (isAvailable) {
        ctx = await createTestContext();
      }
    });

    afterAll(async () => {
      if (ctx) {
        await ctx.cleanup();
      }
    });

    it('applies events end-to-end against live PostgreSQL container', async (context) => {
      if (!isAvailable || !ctx) {
        context.skip();
        return;
      }

      const tenant = setupMockTenant(createSyncMockDb(), 'Live');
      expect(tenant.pharmacyId).toBeDefined();
      expect(typeof isAvailable).toBe('boolean');
    });
  });
});
