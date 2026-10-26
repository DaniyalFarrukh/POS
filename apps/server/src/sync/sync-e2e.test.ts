import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7, type SyncEventEnvelope } from '@pos/shared';
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
  users,
  products,
  batches,
  devices,
  deviceRegistrationCodes,
  stockMovements,
  processedEvents,
  rejectedEvents,
  invoices,
  changeLog,
} from '../db/schema';
import {
  hashRegistrationCode,
} from '../auth/jwt';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

describe('Server End-to-End Tests with Real Fastify & PostgreSQL (Phase 3)', () => {
  let isAvailable = false;
  let ctx: TestDatabaseContext | undefined;
  let app: FastifyInstance | undefined;

  beforeAll(async () => {
    isAvailable = await isPostgresReachable();
    if (!isAvailable) {
      console.warn('PostgreSQL is not reachable. Skipping server E2E test suite.');
      return;
    }

    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 100 });
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (ctx) {
      await ctx.cleanup();
    }
  });

  // Helper to create a pharmacy with branch, counter, user and registration code
  async function setupTenant(name: string, codeSuffix: string) {
    if (!ctx) throw new Error('Test context not initialized');

    const now = new Date().toISOString();
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const userId = generateUuidV7();

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(branches).values({
      id: branchId,
      pharmacyId,
      name: `${name} Main Branch`,
      address: '123 Test Street',
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
      id: userId,
      pharmacyId,
      name: 'Manager User',
      role: 'owner',
      pinHash: 'hashed_pin_placeholder',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const plainCode = `REG-${codeSuffix}-1111`;
    const codeId = generateUuidV7();
    await ctx.db.insert(deviceRegistrationCodes).values({
      id: codeId,
      pharmacyId,
      branchId,
      counterId,
      codeHash: hashRegistrationCode(plainCode),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: now,
    });

    return {
      pharmacyId,
      branchId,
      counterId,
      userId,
      plainCode,
    };
  }

  // Helper to register a device via Fastify endpoint
  async function registerDevice(plainCode: string, deviceName: string) {
    if (!app) throw new Error('Fastify app not initialized');

    const res = await app.inject({
      method: 'POST',
      url: '/devices/register',
      payload: {
        code: plainCode,
        deviceName,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { deviceId: string; token: string };
    expect(body.deviceId).toBeDefined();
    expect(body.token).toBeDefined();
    return body;
  }

  // Helper to generate an extra registration code for an existing branch/counter
  async function createExtraRegistrationCode(
    pharmacyId: string,
    branchId: string,
    counterId: string,
    codeSuffix: string
  ) {
    if (!ctx) throw new Error('Test context not initialized');

    const plainCode = `REG-${codeSuffix}-2222`;
    const codeId = generateUuidV7();
    await ctx.db.insert(deviceRegistrationCodes).values({
      id: codeId,
      pharmacyId,
      branchId,
      counterId,
      codeHash: hashRegistrationCode(plainCode),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    return plainCode;
  }

  /**
   * Scenario 1:
   * Register two devices in the same pharmacy, push events from both, pull from both:
   * both see the same batches and stock movements, and stock balance equals the sum of movements.
   */
  it('Scenario 1: Two devices in the same pharmacy push and pull; both see identical batches/movements and stock balance equals sum of movements', async (context) => {
    if (!isAvailable || !ctx || !app) {
      context.skip();
      return;
    }

    // 1. Setup Pharmacy with two registration codes for two devices in the same branch
    const tenant = await setupTenant('City Central Pharmacy', 'D101');
    const code2 = await createExtraRegistrationCode(
      tenant.pharmacyId,
      tenant.branchId,
      tenant.counterId,
      'D102'
    );

    // 2. Register Device 1 and Device 2
    const dev1 = await registerDevice(tenant.plainCode, 'Terminal Counter 1');
    const dev2 = await registerDevice(code2, 'Terminal Counter 2');

    // 3. Create a product in central master data
    const productId = generateUuidV7();
    const batchId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId: tenant.pharmacyId,
      brandName: 'Amoxicillin 500mg',
      mrpPaisa: 800,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // 4. Device 1 pushes purchase.received (creates batch + purchase stock movement +100)
    const purchaseEventId = generateUuidV7();
    const purchaseId = generateUuidV7();
    const purchaseEvent: SyncEventEnvelope = {
      eventId: purchaseEventId,
      deviceSeq: 1,
      type: 'purchase.received',
      entityId: purchaseId,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        purchase: {
          id: purchaseId,
          branchId: tenant.branchId,
          supplierInvoiceNo: 'SUP-INV-8899',
          invoiceDate: '2026-10-26',
          totalCostPaisa: 50000,
        },
        batches: [
          {
            id: batchId,
            productId,
            batchNo: 'BAT-2026-X1',
            expiryDate: '2028-06-30',
            costPaisa: 500,
            mrpPaisa: 800,
          },
        ],
        lines: [
          {
            id: generateUuidV7(),
            productId,
            batchId,
            quantity: 100,
            costPaisa: 500,
            mrpPaisa: 800,
          },
        ],
      },
    };

    const push1Res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${dev1.token}` },
      payload: { events: [purchaseEvent] },
    });

    expect(push1Res.statusCode).toBe(200);
    const push1Body = push1Res.json() as { results: Array<{ eventId: string; status: string }> };
    expect(push1Body.results[0]?.status).toBe('accepted');

    // 5. Device 2 pushes invoice.created (sells 30 units -> stock movement -30)
    const invoiceEventId = generateUuidV7();
    const invoiceId = generateUuidV7();
    const invoiceEvent: SyncEventEnvelope = {
      eventId: invoiceEventId,
      deviceSeq: 1,
      type: 'invoice.created',
      entityId: invoiceId,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        id: invoiceId,
        counterId: tenant.counterId,
        cashierUserId: tenant.userId,
        invoiceNumber: 'INV-2026-0001',
        clientRequestId: generateUuidV7(),
        status: 'completed',
        subtotalPaisa: 24000,
        discountPaisa: 0,
        taxPaisa: 0,
        totalPaisa: 24000,
        lines: [
          {
            id: generateUuidV7(),
            productId,
            batchId,
            quantity: 30,
            unitPricePaisa: 800,
            discountPaisa: 0,
            taxRateBp: 0,
            taxPaisa: 0,
            lineTotalPaisa: 24000,
          },
        ],
        payments: [
          {
            id: generateUuidV7(),
            method: 'cash',
            amountPaisa: 24000,
          },
        ],
        createdAt: now,
      },
    };

    const push2Res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${dev2.token}` },
      payload: { events: [invoiceEvent] },
    });

    expect(push2Res.statusCode).toBe(200);
    const push2Body = push2Res.json() as { results: Array<{ eventId: string; status: string }> };
    expect(push2Body.results[0]?.status).toBe('accepted');

    // 6. Device 1 also pushes stock_adjustment.created (+10 units)
    const adjEventId = generateUuidV7();
    const adjEvent: SyncEventEnvelope = {
      eventId: adjEventId,
      deviceSeq: 2,
      type: 'stock_adjustment.created',
      entityId: adjEventId,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        id: adjEventId,
        movementId: generateUuidV7(),
        productId,
        batchId,
        branchId: tenant.branchId,
        quantitySigned: 10,
        reason: 'Physical count found surplus',
        createdAt: now,
      },
    };

    const push3Res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${dev1.token}` },
      payload: { events: [adjEvent] },
    });

    expect(push3Res.statusCode).toBe(200);
    const push3Body = push3Res.json() as { results: Array<{ eventId: string; status: string }> };
    expect(push3Body.results[0]?.status).toBe('accepted');

    // 7. Pull changes from Device 1
    const pull1Res = await app.inject({
      method: 'GET',
      url: '/sync/pull?cursor=0&limit=200',
      headers: { authorization: `Bearer ${dev1.token}` },
    });
    expect(pull1Res.statusCode).toBe(200);
    const pull1Body = pull1Res.json() as {
      changes: Array<{ entity: string; entityId: string; op: string; data: Record<string, unknown> }>;
    };

    // 8. Pull changes from Device 2
    const pull2Res = await app.inject({
      method: 'GET',
      url: '/sync/pull?cursor=0&limit=200',
      headers: { authorization: `Bearer ${dev2.token}` },
    });
    expect(pull2Res.statusCode).toBe(200);
    const pull2Body = pull2Res.json() as {
      changes: Array<{ entity: string; entityId: string; op: string; data: Record<string, unknown> }>;
    };

    // 9. Both see the exact same batches
    const dev1Batches = pull1Body.changes.filter((c) => c.entity === 'batch');
    const dev2Batches = pull2Body.changes.filter((c) => c.entity === 'batch');
    expect(dev1Batches.length).toBeGreaterThan(0);
    expect(dev1Batches).toEqual(dev2Batches);
    expect(dev1Batches.some((b) => b.entityId === batchId)).toBe(true);

    // 10. Both see the exact same stock movements (purchase +100, sale -30, adjustment +10)
    const dev1Movements = pull1Body.changes.filter((c) => c.entity === 'stock_movement');
    const dev2Movements = pull2Body.changes.filter((c) => c.entity === 'stock_movement');
    expect(dev1Movements.length).toBe(3);
    expect(dev1Movements).toEqual(dev2Movements);

    // 11. Verify stock balance equals the sum of movements (100 - 30 + 10 = 80)
    const sumFromMovements = dev1Movements.reduce(
      (sum, m) => sum + Number(m.data.quantitySigned),
      0
    );
    expect(sumFromMovements).toBe(80);

    // Direct database validation: balance = sum of stock_movements (Rule 4)
    const [dbBalanceRow] = await ctx.db
      .select({
        balance: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`,
      })
      .from(stockMovements)
      .where(
        sql`${stockMovements.pharmacyId} = ${tenant.pharmacyId} AND ${stockMovements.batchId} = ${batchId}`
      );

    expect(Number(dbBalanceRow?.balance)).toBe(80);
    expect(Number(dbBalanceRow?.balance)).toBe(sumFromMovements);
  });

  /**
   * Scenario 2:
   * Replay the same push batch 3 times: results become duplicate, row counts unchanged.
   */
  it('Scenario 2: Replaying the same push batch 3 times results in "duplicate" and leaves database row counts unchanged', async (context) => {
    if (!isAvailable || !ctx || !app) {
      context.skip();
      return;
    }

    const tenant = await setupTenant('Replay Pharmacy', 'R201');
    const dev = await registerDevice(tenant.plainCode, 'Replay Device');

    const productId = generateUuidV7();
    const batchId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId: tenant.pharmacyId,
      brandName: 'Paracetamol 500mg',
      mrpPaisa: 150,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const event1Id = generateUuidV7();
    const purchaseId = generateUuidV7();
    const event1: SyncEventEnvelope = {
      eventId: event1Id,
      deviceSeq: 1,
      type: 'purchase.received',
      entityId: purchaseId,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        purchase: {
          id: purchaseId,
          branchId: tenant.branchId,
          supplierInvoiceNo: 'REPLAY-SUP-01',
          invoiceDate: '2026-10-26',
          totalCostPaisa: 10000,
        },
        batches: [
          {
            id: batchId,
            productId,
            batchNo: 'BATCH-REP-1',
            expiryDate: '2027-12-31',
            costPaisa: 100,
            mrpPaisa: 150,
          },
        ],
        lines: [
          {
            id: generateUuidV7(),
            productId,
            batchId,
            quantity: 50,
            costPaisa: 100,
            mrpPaisa: 150,
          },
        ],
      },
    };

    const event2Id = generateUuidV7();
    const invoiceId = generateUuidV7();
    const event2: SyncEventEnvelope = {
      eventId: event2Id,
      deviceSeq: 2,
      type: 'invoice.created',
      entityId: invoiceId,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        id: invoiceId,
        counterId: tenant.counterId,
        cashierUserId: tenant.userId,
        invoiceNumber: 'INV-REP-01',
        clientRequestId: generateUuidV7(),
        status: 'completed',
        subtotalPaisa: 1500,
        discountPaisa: 0,
        taxPaisa: 0,
        totalPaisa: 1500,
        lines: [
          {
            id: generateUuidV7(),
            productId,
            batchId,
            quantity: 10,
            unitPricePaisa: 150,
            discountPaisa: 0,
            taxRateBp: 0,
            taxPaisa: 0,
            lineTotalPaisa: 1500,
          },
        ],
        payments: [
          {
            id: generateUuidV7(),
            method: 'cash',
            amountPaisa: 1500,
          },
        ],
        createdAt: now,
      },
    };

    const replayBatchPayload = {
      events: [event1, event2],
    };

    // Helper to query row counts for this pharmacy
    const getRowCounts = async () => {
      if (!ctx) throw new Error('no ctx');
      const [procCount] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(processedEvents)
        .where(eq(processedEvents.pharmacyId, tenant.pharmacyId));
      const [batchCount] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(batches)
        .where(eq(batches.pharmacyId, tenant.pharmacyId));
      const [smCount] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(stockMovements)
        .where(eq(stockMovements.pharmacyId, tenant.pharmacyId));
      const [invCount] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(invoices)
        .where(eq(invoices.pharmacyId, tenant.pharmacyId));
      const [clCount] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(changeLog)
        .where(eq(changeLog.pharmacyId, tenant.pharmacyId));

      return {
        processedEvents: Number(procCount?.count),
        batches: Number(batchCount?.count),
        stockMovements: Number(smCount?.count),
        invoices: Number(invCount?.count),
        changeLog: Number(clCount?.count),
      };
    };

    // 1st Push: Must be accepted
    const res1 = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${dev.token}` },
      payload: replayBatchPayload,
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json() as { results: Array<{ eventId: string; status: string }> };
    expect(body1.results).toHaveLength(2);
    expect(body1.results[0]?.status).toBe('accepted');
    expect(body1.results[1]?.status).toBe('accepted');

    const countsAfterPush1 = await getRowCounts();
    expect(countsAfterPush1.processedEvents).toBe(2);
    expect(countsAfterPush1.batches).toBe(1);
    expect(countsAfterPush1.invoices).toBe(1);

    // 2nd Push (Replay #1): Must return duplicate, row counts unchanged
    const res2 = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${dev.token}` },
      payload: replayBatchPayload,
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json() as { results: Array<{ eventId: string; status: string }> };
    expect(body2.results).toHaveLength(2);
    expect(body2.results[0]?.status).toBe('duplicate');
    expect(body2.results[1]?.status).toBe('duplicate');

    const countsAfterPush2 = await getRowCounts();
    expect(countsAfterPush2).toEqual(countsAfterPush1);

    // 3rd Push (Replay #2): Must return duplicate, row counts still unchanged
    const res3 = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${dev.token}` },
      payload: replayBatchPayload,
    });
    expect(res3.statusCode).toBe(200);
    const body3 = res3.json() as { results: Array<{ eventId: string; status: string }> };
    expect(body3.results).toHaveLength(2);
    expect(body3.results[0]?.status).toBe('duplicate');
    expect(body3.results[1]?.status).toBe('duplicate');

    const countsAfterPush3 = await getRowCounts();
    expect(countsAfterPush3).toEqual(countsAfterPush1);
  });

  /**
   * Scenario 3:
   * Send 100 events including one invalid one in the middle: the others are accepted.
   */
  it('Scenario 3: 100 events with 1 invalid event in the middle: 99 accepted and 1 rejected into rejected_events', async (context) => {
    if (!isAvailable || !ctx || !app) {
      context.skip();
      return;
    }

    const tenant = await setupTenant('Bulk 100 Pharmacy', 'B301');
    const dev = await registerDevice(tenant.plainCode, 'Bulk Device');

    const productId = generateUuidV7();
    const batchId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId: tenant.pharmacyId,
      brandName: 'Bulk Test Syrup',
      mrpPaisa: 300,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(batches).values({
      id: batchId,
      pharmacyId: tenant.pharmacyId,
      productId,
      batchNo: 'BAT-BULK-001',
      expiryDate: '2027-12-31',
      costPaisa: 200,
      mrpPaisa: 300,
      createdAt: now,
      updatedAt: now,
    });

    // Generate 100 events: index 0..99. Middle is index 49 (deviceSeq 50).
    const events: SyncEventEnvelope[] = [];
    const invalidIndex = 49;
    let invalidEventId = '';

    for (let i = 0; i < 100; i++) {
      const eventId = generateUuidV7();
      const seq = i + 1;

      if (i === invalidIndex) {
        // Invalid event: stock adjustment with quantitySigned = 0 (violates non-zero refine)
        invalidEventId = eventId;
        events.push({
          eventId,
          deviceSeq: seq,
          type: 'stock_adjustment.created',
          entityId: eventId,
          occurredAt: now,
          schemaVersion: 1,
          payload: {
            id: eventId,
            productId,
            batchId,
            branchId: tenant.branchId,
            quantitySigned: 0, // INVALID: schema enforces quantity cannot be 0
            reason: 'Zero quantity adjustment error',
            createdAt: now,
          },
        });
      } else {
        // Valid stock adjustment (+1 unit)
        events.push({
          eventId,
          deviceSeq: seq,
          type: 'stock_adjustment.created',
          entityId: eventId,
          occurredAt: now,
          schemaVersion: 1,
          payload: {
            id: eventId,
            productId,
            batchId,
            branchId: tenant.branchId,
            quantitySigned: 1,
            reason: `Batch adjustment #${seq}`,
            createdAt: now,
          },
        });
      }
    }

    expect(events).toHaveLength(100);

    const res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${dev.token}` },
      payload: { events },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      results: Array<{ eventId: string; status: string; code?: string; message?: string }>;
    };

    expect(body.results).toHaveLength(100);

    // Verify 99 accepted
    const acceptedResults = body.results.filter((r) => r.status === 'accepted');
    expect(acceptedResults).toHaveLength(99);

    // Verify exactly the middle event was rejected
    const rejectedResult = body.results[invalidIndex];
    expect(rejectedResult).toBeDefined();
    expect(rejectedResult?.eventId).toBe(invalidEventId);
    expect(rejectedResult?.status).toBe('rejected');
    expect(rejectedResult?.code).toBe('INVALID_PAYLOAD');

    // Verify rejected_events table recorded the failure
    const rejectedRows = await ctx.db
      .select()
      .from(rejectedEvents)
      .where(
        sql`${rejectedEvents.pharmacyId} = ${tenant.pharmacyId} AND ${rejectedEvents.code} = 'INVALID_PAYLOAD'`
      );

    expect(rejectedRows).toHaveLength(1);
    expect(rejectedRows[0]?.code).toBe('INVALID_PAYLOAD');

    // Verify processed_events table only contains the 99 accepted events
    const processedRows = await ctx.db
      .select()
      .from(processedEvents)
      .where(eq(processedEvents.pharmacyId, tenant.pharmacyId));

    expect(processedRows).toHaveLength(99);
    expect(processedRows.some((p) => p.eventId === invalidEventId)).toBe(false);
  });

  /**
   * Scenario 4:
   * Revoked device token rejected on push and pull.
   */
  it('Scenario 4: Revoked device token is rejected with HTTP 403 on both push and pull', async (context) => {
    if (!isAvailable || !ctx || !app) {
      context.skip();
      return;
    }

    const tenant = await setupTenant('Revocation Pharmacy', 'RV401');
    const dev = await registerDevice(tenant.plainCode, 'Terminal To Revoke');

    // Verify push and pull work before revocation
    const initialPull = await app.inject({
      method: 'GET',
      url: '/sync/pull?cursor=0',
      headers: { authorization: `Bearer ${dev.token}` },
    });
    expect(initialPull.statusCode).toBe(200);

    const initialPush = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${dev.token}` },
      payload: { events: [] },
    });
    expect(initialPush.statusCode).toBe(200);

    // Revoke the device directly in database
    await ctx.db
      .update(devices)
      .set({ isRevoked: true })
      .where(eq(devices.id, dev.deviceId));

    // Push with revoked token: Must return HTTP 403
    const revokedPush = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${dev.token}` },
      payload: { events: [] },
    });
    expect(revokedPush.statusCode).toBe(403);
    const pushErr = revokedPush.json() as { message: string };
    expect(pushErr.message).toMatch(/Device has been revoked/i);

    // Pull with revoked token: Must return HTTP 403
    const revokedPull = await app.inject({
      method: 'GET',
      url: '/sync/pull?cursor=0',
      headers: { authorization: `Bearer ${dev.token}` },
    });
    expect(revokedPull.statusCode).toBe(403);
    const pullErr = revokedPull.json() as { message: string };
    expect(pullErr.message).toMatch(/Device has been revoked/i);
  });

  /**
   * Scenario 5:
   * Device from pharmacy A can never read or write pharmacy B data.
   */
  it('Scenario 5: Multi-tenant isolation: Device from Pharmacy A can never read or write Pharmacy B data', async (context) => {
    if (!isAvailable || !ctx || !app) {
      context.skip();
      return;
    }

    // 1. Setup Pharmacy A and Pharmacy B
    const tenantA = await setupTenant('Tenant Alpha', 'A501');
    const tenantB = await setupTenant('Tenant Beta', 'B502');

    const devA = await registerDevice(tenantA.plainCode, 'Alpha Device');
    const devB = await registerDevice(tenantB.plainCode, 'Beta Device');

    const now = new Date().toISOString();
    const productBId = generateUuidV7();
    const batchBId = generateUuidV7();

    // 2. Pharmacy B creates a private product and batch
    await ctx.db.insert(products).values({
      id: productBId,
      pharmacyId: tenantB.pharmacyId,
      brandName: 'Beta Exclusive Antibiotic',
      mrpPaisa: 1200,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // 3. Device B pushes a purchase event in Pharmacy B
    const purchaseBId = generateUuidV7();
    const pushBRes = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${devB.token}` },
      payload: {
        events: [
          {
            eventId: generateUuidV7(),
            deviceSeq: 1,
            type: 'purchase.received',
            entityId: purchaseBId,
            occurredAt: now,
            schemaVersion: 1,
            payload: {
              purchase: {
                id: purchaseBId,
                branchId: tenantB.branchId,
                supplierInvoiceNo: 'SUP-BETA-001',
                invoiceDate: '2026-10-26',
                totalCostPaisa: 99000,
              },
              batches: [
                {
                  id: batchBId,
                  productId: productBId,
                  batchNo: 'BATCH-BETA-01',
                  expiryDate: '2029-01-01',
                  costPaisa: 900,
                  mrpPaisa: 1200,
                },
              ],
              lines: [
                {
                  id: generateUuidV7(),
                  productId: productBId,
                  batchId: batchBId,
                  quantity: 110,
                  costPaisa: 900,
                  mrpPaisa: 1200,
                },
              ],
            },
          },
        ],
      },
    });
    expect(pushBRes.statusCode).toBe(200);

    // 4. READ ISOLATION (PULL): Device A pulls changes
    const pullARes = await app.inject({
      method: 'GET',
      url: '/sync/pull?cursor=0&limit=500',
      headers: { authorization: `Bearer ${devA.token}` },
    });
    expect(pullARes.statusCode).toBe(200);
    const pullABody = pullARes.json() as {
      changes: Array<{ entity: string; entityId: string; data: Record<string, unknown> }>;
    };

    // Device A must see ZERO items belonging to Pharmacy B
    const leakBatch = pullABody.changes.find((c) => c.entityId === batchBId);
    expect(leakBatch).toBeUndefined();

    const leakProduct = pullABody.changes.find((c) => c.entityId === productBId);
    expect(leakProduct).toBeUndefined();

    for (const change of pullABody.changes) {
      if (change.data.pharmacyId) {
        expect(change.data.pharmacyId).toBe(tenantA.pharmacyId);
      }
    }

    // 5. WRITE ISOLATION (PUSH): Device A attempts to push a stock adjustment targeting Pharmacy B's product & batch
    const maliciousAdjId = generateUuidV7();
    const pushMaliciousRes = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${devA.token}` },
      payload: {
        events: [
          {
            eventId: maliciousAdjId,
            deviceSeq: 1,
            type: 'stock_adjustment.created',
            entityId: maliciousAdjId,
            occurredAt: now,
            schemaVersion: 1,
            payload: {
              id: maliciousAdjId,
              productId: productBId, // Pharmacy B's product
              batchId: batchBId,     // Pharmacy B's batch
              branchId: tenantA.branchId,
              quantitySigned: 50,
              reason: 'Cross-tenant illegal write attempt',
              createdAt: now,
            },
          },
        ],
      },
    });

    expect(pushMaliciousRes.statusCode).toBe(200);
    const maliciousBody = pushMaliciousRes.json() as {
      results: Array<{ eventId: string; status: string; code?: string }>;
    };

    // Must be rejected or retry_later (cannot access unowned product/batch)
    expect(maliciousBody.results[0]?.status).toBe('retry_later');
    expect(maliciousBody.results[0]?.code).toBe('UNKNOWN_PRODUCT');

    // 6. Verify Pharmacy B's stock movements and batches remain strictly unmodified
    const betaMovements = await ctx.db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.pharmacyId, tenantB.pharmacyId));

    // Only the original purchase movement by Device B exists
    expect(betaMovements).toHaveLength(1);
    expect(betaMovements[0]?.referenceId).toBe(purchaseBId);
  });
});
