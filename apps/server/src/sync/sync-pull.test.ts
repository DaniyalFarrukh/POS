import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7, type SyncPullResponse } from '@pos/shared';
import { signDeviceToken } from '../auth/jwt';
import { buildApp } from '../app';
import {
  isPostgresReachable,
  createTestContext,
  type TestDatabaseContext,
} from '../db/test-helper';
import {
  pharmacies,
  branches,
  counters,
  changeLog,
  devices,
} from '../db/schema';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { recordMasterDataChange } from './change-log';

// Mock DB for sync pull testing with in-memory store
function createSyncPullMockDb() {
  interface ChangeRow {
    seq: number;
    pharmacyId: string;
    branchId?: string | null;
    entity: string;
    entityId: string;
    op: string;
    data: Record<string, unknown>;
    createdAt: string;
  }

  interface Store {
    changeLog: ChangeRow[];
    devices: Map<string, Record<string, unknown>>;
    currentSeq: number;
  }

  const store: Store = {
    changeLog: [],
    devices: new Map(),
    currentSeq: 0,
  };

  const client = {
    _store: store,
    select: () => ({
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
                if (val && val !== '=' && val !== '>' && val !== '(' && val !== ')') {
                  return val;
                }
              }
              return undefined;
            };

            const targetPharmId = findValueAfter('pharmacy_id');

            if (table === devices) {
              let arr = Array.from(store.devices.values());
              if (targetPharmId) {
                arr = arr.filter((d) => d.pharmacyId === targetPharmId);
              }
              return arr;
            }

            if (table === changeLog) {
              const seqIdx = tokens.indexOf('seq');
              let minSeq = 0;
              if (seqIdx !== -1 && typeof tokens[seqIdx + 2] === 'number') {
                minSeq = tokens[seqIdx + 2] as number;
              } else if (seqIdx !== -1 && typeof tokens[seqIdx + 1] === 'number') {
                minSeq = tokens[seqIdx + 1] as number;
              }

              const targetBranchId = tokens.find(
                (t) =>
                  typeof t === 'string' &&
                  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) &&
                  t !== targetPharmId
              ) as string | undefined;

              return store.changeLog
                .filter(
                  (r) =>
                    (!targetPharmId || r.pharmacyId === targetPharmId) &&
                    r.seq > minSeq &&
                    (!targetBranchId || !r.branchId || r.branchId === targetBranchId)
                )
                .sort((a, b) => a.seq - b.seq);
            }

            return [];
          };

          return {
            orderBy: () => ({
              limit: (limitNum: number) => {
                const res = executeQuery();
                return Promise.resolve(res.slice(0, limitNum));
              },
            }),
            limit: (limitNum: number) => {
              const res = executeQuery();
              return Promise.resolve(res.slice(0, limitNum));
            },
            then: (resolve: (val: unknown) => void) => resolve(executeQuery()),
          };
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (data: unknown) => ({
        returning: async () => {
          if (table === changeLog) {
            store.currentSeq += 1;
            const row = {
              ...(data as Omit<ChangeRow, 'seq'>),
              seq: store.currentSeq,
            };
            store.changeLog.push(row);
            return [{ seq: store.currentSeq }];
          }
          return [];
        },
        then: async (resolve: (val: unknown) => void) => {
          if (table === devices) {
            const d = data as Record<string, unknown>;
            store.devices.set(d.id as string, d);
          }
          resolve(undefined);
        },
      }),
    }),
  };

  return client as unknown as NodePgDatabase<typeof schema> & {
    _store: Store;
  };
}

describe('GET /sync/pull (Phase 3)', () => {
  function setupMockTenant(mockDb: ReturnType<typeof createSyncPullMockDb>, name = 'Main') {
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const deviceId = generateUuidV7();

    mockDb._store.devices.set(deviceId, {
      id: deviceId,
      pharmacyId,
      branchId,
      counterId,
      deviceName: `${name} Counter 1`,
      isRevoked: false,
    });

    const token = signDeviceToken({ pharmacyId, branchId, deviceId });

    return {
      pharmacyId,
      branchId,
      counterId,
      deviceId,
      token,
    };
  }

  describe('Core Functionality & Constraints', () => {
    it('1. empty cursor returns everything in order', async () => {
      const mockDb = createSyncPullMockDb();
      const tenant = setupMockTenant(mockDb, 'OrderTest');
      const app = buildApp({ db: mockDb });

      // Record 3 changes
      await recordMasterDataChange(mockDb, {
        pharmacyId: tenant.pharmacyId,
        entity: 'product',
        entityId: generateUuidV7(),
        op: 'upsert',
        data: { name: 'Panadol 500mg', mrpPaisa: 5000 },
      });

      await recordMasterDataChange(mockDb, {
        pharmacyId: tenant.pharmacyId,
        entity: 'tax_category',
        entityId: generateUuidV7(),
        op: 'upsert',
        data: { name: 'Standard 0%', rateBp: 0 },
      });

      await recordMasterDataChange(mockDb, {
        pharmacyId: tenant.pharmacyId,
        entity: 'supplier',
        entityId: generateUuidV7(),
        op: 'upsert',
        data: { name: 'GlaxoSmithKline' },
      });

      // GET /sync/pull with cursor=0 (or omitted)
      const res = await app.inject({
        method: 'GET',
        url: '/sync/pull',
        headers: { authorization: `Bearer ${tenant.token}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<SyncPullResponse>();
      expect(data.changes).toHaveLength(3);
      expect(data.hasMore).toBe(false);
      expect(data.changes[0]!.seq).toBe(1);
      expect(data.changes[1]!.seq).toBe(2);
      expect(data.changes[2]!.seq).toBe(3);
      expect(data.nextCursor).toBe(3);
    });

    it('2. paging with hasMore is correct and gap-free', async () => {
      const mockDb = createSyncPullMockDb();
      const tenant = setupMockTenant(mockDb, 'PageTest');
      const app = buildApp({ db: mockDb });

      // Insert 7 change entries
      for (let i = 1; i <= 7; i++) {
        await recordMasterDataChange(mockDb, {
          pharmacyId: tenant.pharmacyId,
          entity: 'product',
          entityId: generateUuidV7(),
          op: 'upsert',
          data: { name: `Product ${i}`, mrpPaisa: i * 1000 },
        });
      }

      // Page 1: limit=3, cursor=0
      const res1 = await app.inject({
        method: 'GET',
        url: '/sync/pull?cursor=0&limit=3',
        headers: { authorization: `Bearer ${tenant.token}` },
      });
      expect(res1.statusCode).toBe(200);
      const page1 = res1.json<SyncPullResponse>();
      expect(page1.changes).toHaveLength(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.changes.map((c) => c.seq)).toEqual([1, 2, 3]);
      expect(page1.nextCursor).toBe(3);

      // Page 2: limit=3, cursor=3
      const res2 = await app.inject({
        method: 'GET',
        url: `/sync/pull?cursor=${page1.nextCursor}&limit=3`,
        headers: { authorization: `Bearer ${tenant.token}` },
      });
      expect(res2.statusCode).toBe(200);
      const page2 = res2.json<SyncPullResponse>();
      expect(page2.changes).toHaveLength(3);
      expect(page2.hasMore).toBe(true);
      expect(page2.changes.map((c) => c.seq)).toEqual([4, 5, 6]);
      expect(page2.nextCursor).toBe(6);

      // Page 3: limit=3, cursor=6
      const res3 = await app.inject({
        method: 'GET',
        url: `/sync/pull?cursor=${page2.nextCursor}&limit=3`,
        headers: { authorization: `Bearer ${tenant.token}` },
      });
      expect(res3.statusCode).toBe(200);
      const page3 = res3.json<SyncPullResponse>();
      expect(page3.changes).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
      expect(page3.changes.map((c) => c.seq)).toEqual([7]);
      expect(page3.nextCursor).toBe(7);

      // Verify all 7 received in exact order without duplicates or gaps
      const allSeqs = [
        ...page1.changes.map((c) => c.seq),
        ...page2.changes.map((c) => c.seq),
        ...page3.changes.map((c) => c.seq),
      ];
      expect(allSeqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('3. a product price change appears on the next pull', async () => {
      const mockDb = createSyncPullMockDb();
      const tenant = setupMockTenant(mockDb, 'PriceTest');
      const app = buildApp({ db: mockDb });

      const productId = generateUuidV7();

      // Initial create of product with MRP 5000 paisa
      await recordMasterDataChange(mockDb, {
        pharmacyId: tenant.pharmacyId,
        entity: 'product',
        entityId: productId,
        op: 'upsert',
        data: { id: productId, name: 'Brufen 400mg', mrpPaisa: 5000 },
      });

      // Counter pulls initial data
      const initialPullRes = await app.inject({
        method: 'GET',
        url: '/sync/pull?cursor=0',
        headers: { authorization: `Bearer ${tenant.token}` },
      });
      const initialPull = initialPullRes.json<SyncPullResponse>();
      expect(initialPull.changes).toHaveLength(1);
      const lastSeenCursor = initialPull.nextCursor;

      // Price update on server from 5000 to 7500 paisa
      await recordMasterDataChange(mockDb, {
        pharmacyId: tenant.pharmacyId,
        entity: 'product',
        entityId: productId,
        op: 'upsert',
        data: { id: productId, name: 'Brufen 400mg', mrpPaisa: 7500 },
      });

      // Counter performs next pull with cursor = lastSeenCursor
      const nextPullRes = await app.inject({
        method: 'GET',
        url: `/sync/pull?cursor=${lastSeenCursor}`,
        headers: { authorization: `Bearer ${tenant.token}` },
      });

      expect(nextPullRes.statusCode).toBe(200);
      const nextPull = nextPullRes.json<SyncPullResponse>();
      expect(nextPull.changes).toHaveLength(1);
      expect(nextPull.changes[0]!.entity).toBe('product');
      expect(nextPull.changes[0]!.data.mrpPaisa).toBe(7500);
      expect(nextPull.nextCursor).toBeGreaterThan(lastSeenCursor);
    });

    it('4. tenant isolation: never include data from another pharmacy', async () => {
      const mockDb = createSyncPullMockDb();
      const tenantA = setupMockTenant(mockDb, 'TenantA');
      const tenantB = setupMockTenant(mockDb, 'TenantB');
      const app = buildApp({ db: mockDb });

      // Change for Tenant A
      await recordMasterDataChange(mockDb, {
        pharmacyId: tenantA.pharmacyId,
        entity: 'product',
        entityId: generateUuidV7(),
        op: 'upsert',
        data: { name: 'Tenant A Product', mrpPaisa: 1000 },
      });

      // Change for Tenant B
      await recordMasterDataChange(mockDb, {
        pharmacyId: tenantB.pharmacyId,
        entity: 'product',
        entityId: generateUuidV7(),
        op: 'upsert',
        data: { name: 'Tenant B Secret Product', mrpPaisa: 9999 },
      });

      // Tenant A pulls
      const resA = await app.inject({
        method: 'GET',
        url: '/sync/pull?cursor=0',
        headers: { authorization: `Bearer ${tenantA.token}` },
      });

      expect(resA.statusCode).toBe(200);
      const dataA = resA.json<SyncPullResponse>();
      expect(dataA.changes).toHaveLength(1);
      expect(dataA.changes[0]!.data.name).toBe('Tenant A Product');

      // Tenant B pulls
      const resB = await app.inject({
        method: 'GET',
        url: '/sync/pull?cursor=0',
        headers: { authorization: `Bearer ${tenantB.token}` },
      });

      expect(resB.statusCode).toBe(200);
      const dataB = resB.json<SyncPullResponse>();
      expect(dataB.changes).toHaveLength(1);
      expect(dataB.changes[0]!.data.name).toBe('Tenant B Secret Product');
    });

    it('5. branch filtering: filters branch-scoped entities by the device branch', async () => {
      const mockDb = createSyncPullMockDb();
      const tenant = setupMockTenant(mockDb, 'BranchFilter');
      const otherBranchId = generateUuidV7();
      const app = buildApp({ db: mockDb });

      // Pharmacy-wide product (no branchId) -> should be included
      await recordMasterDataChange(mockDb, {
        pharmacyId: tenant.pharmacyId,
        entity: 'product',
        entityId: generateUuidV7(),
        op: 'upsert',
        data: { name: 'Universal Medicine', mrpPaisa: 2000 },
      });

      // Stock movement for device's branch -> should be included
      await recordMasterDataChange(mockDb, {
        pharmacyId: tenant.pharmacyId,
        entity: 'stock_movement',
        entityId: generateUuidV7(),
        op: 'upsert',
        data: { branchId: tenant.branchId, quantitySigned: 10 },
      });

      // Stock movement for a DIFFERENT branch -> should be filtered out!
      await recordMasterDataChange(mockDb, {
        pharmacyId: tenant.pharmacyId,
        entity: 'stock_movement',
        entityId: generateUuidV7(),
        op: 'upsert',
        data: { branchId: otherBranchId, quantitySigned: 50 },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/sync/pull?cursor=0',
        headers: { authorization: `Bearer ${tenant.token}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<SyncPullResponse>();
      expect(data.changes).toHaveLength(2);
      expect(data.changes.some((c) => c.entity === 'product')).toBe(true);
      expect(
        data.changes.some(
          (c) => c.entity === 'stock_movement' && c.data.branchId === tenant.branchId
        )
      ).toBe(true);
      expect(
        data.changes.some(
          (c) => c.entity === 'stock_movement' && c.data.branchId === otherBranchId
        )
      ).toBe(false);
    });

    it('6. invalid cursor/limit rejected with 400', async () => {
      const mockDb = createSyncPullMockDb();
      const tenant = setupMockTenant(mockDb, 'InvalidParams');
      const app = buildApp({ db: mockDb });

      // Negative cursor
      const res1 = await app.inject({
        method: 'GET',
        url: '/sync/pull?cursor=-1',
        headers: { authorization: `Bearer ${tenant.token}` },
      });
      expect(res1.statusCode).toBe(400);

      // Non-numeric cursor
      const res2 = await app.inject({
        method: 'GET',
        url: '/sync/pull?cursor=invalid',
        headers: { authorization: `Bearer ${tenant.token}` },
      });
      expect(res2.statusCode).toBe(400);

      // Limit = 0
      const res3 = await app.inject({
        method: 'GET',
        url: '/sync/pull?limit=0',
        headers: { authorization: `Bearer ${tenant.token}` },
      });
      expect(res3.statusCode).toBe(400);

      // Limit > 500
      const res4 = await app.inject({
        method: 'GET',
        url: '/sync/pull?limit=501',
        headers: { authorization: `Bearer ${tenant.token}` },
      });
      expect(res4.statusCode).toBe(400);

      // Missing authorization token
      const resNoAuth = await app.inject({
        method: 'GET',
        url: '/sync/pull?cursor=0',
      });
      expect(resNoAuth.statusCode).toBe(401);
    });
  });

  describe('PostgreSQL Live Integration (when PostgreSQL is active)', () => {
    let ctx: TestDatabaseContext;

    beforeAll(async () => {
      const isAvailable = await isPostgresReachable();
      if (!isAvailable) {
        throw new Error(
          'PostgreSQL is required for this test suite. Ensure Docker is running with "docker compose up -d".'
        );
      }
      ctx = await createTestContext();
    });

    afterAll(async () => {
      if (ctx) {
        await ctx.cleanup();
      }
    });

    it('executes pullChangeLog against live PostgreSQL schema', async () => {

      const pharmacyId = generateUuidV7();
      const branchId = generateUuidV7();
      const counterId = generateUuidV7();
      const deviceId = generateUuidV7();
      const now = new Date().toISOString();

      await ctx.db.insert(pharmacies).values({
        id: pharmacyId,
        name: 'Live Pull Pharmacy',
        code: 'LIVE_PULL',
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert(branches).values({
        id: branchId,
        pharmacyId,
        name: 'Branch 1',
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert(counters).values({
        id: counterId,
        pharmacyId,
        branchId,
        name: 'Counter 1',
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert(devices).values({
        id: deviceId,
        pharmacyId,
        branchId,
        counterId,
        deviceName: 'Live Pull Device',
        isRevoked: false,
        createdAt: now,
        updatedAt: now,
      });

      const token = signDeviceToken({ pharmacyId, branchId, deviceId });
      const app = buildApp({ db: ctx.db });

      // Insert 2 live change log rows
      await recordMasterDataChange(ctx.db, {
        pharmacyId,
        entity: 'product',
        entityId: generateUuidV7(),
        op: 'upsert',
        data: { name: 'Live Product 1', mrpPaisa: 5000 },
      });

      await recordMasterDataChange(ctx.db, {
        pharmacyId,
        entity: 'product',
        entityId: generateUuidV7(),
        op: 'upsert',
        data: { name: 'Live Product 2', mrpPaisa: 10000 },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/sync/pull?cursor=0&limit=10',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<SyncPullResponse>();
      expect(data.changes.length).toBeGreaterThanOrEqual(2);
      expect(data.hasMore).toBe(false);
    });
  });
});
