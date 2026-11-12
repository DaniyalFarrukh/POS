import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7 } from '@pos/shared';
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
  suppliers,
  purchaseOrders,
  purchaseOrderLines,
  stockMovements,
} from '../db/schema';
import { seedDefaultChartOfAccounts } from '../ledger/coa-seed';
import { postStockTransferReceived } from '../ledger/posting-engine';
import { applyPurchaseReceived } from './appliers/purchase';
import { buildApp } from '../app';
import { signUserToken } from '../auth/jwt';
import { eq, and } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

describe('F-H-06: Inventory Sync change_log, Historical Reconcile Timestamp & Intra-Branch Shortage', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;
  let pharmacyId: string;
  let branchId: string;
  let counterId: string;
  let ownerUserId: string;
  let authToken: string;
  let supplierId: string;
  let productId: string;

  beforeAll(async () => {
    const reachable = await isPostgresReachable();
    if (!reachable) {
      throw new Error('PostgreSQL must be running for inventory sync tests.');
    }
    ctx = await createTestContext();
    app = await buildApp({ db: ctx.db });
    await app.ready();

    pharmacyId = generateUuidV7();
    branchId = generateUuidV7();
    counterId = generateUuidV7();
    ownerUserId = generateUuidV7();
    supplierId = generateUuidV7();
    productId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: 'Sync Inventory Test Pharmacy',
      code: `SYN-${Date.now().toString().slice(-4)}`,
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
      code: 'C1',
      name: 'Counter 1',
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(users).values({
      id: ownerUserId,
      pharmacyId,
      role: 'owner',
      name: 'Owner User',
      pinHash: '$2b$10$abcdefghijklmnopqrstuv',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    authToken = signUserToken({
      userId: ownerUserId,
      pharmacyId,
      role: 'owner',
      name: 'Owner User',
    });

    await seedDefaultChartOfAccounts(ctx.db, pharmacyId);

    await ctx.db.insert(suppliers).values({
      id: supplierId,
      pharmacyId,
      name: 'Primary Pharma Ltd',
      contactPerson: 'Manager',
      phone: '03001234567',
      paymentTermsDays: 30,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId,
      brandName: 'Test Med 500mg',
      genericName: 'Paracetamol',
      form: 'tablet',
      strength: '500mg',
      manufacturer: 'GSK',
      mrpPaisa: 5000,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.cleanup();
  });

  it('PO receive emits change_log records for newly received batch and stock_movement (F-H-06)', async () => {
    const poId = generateUuidV7();
    const poLineId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(purchaseOrders).values({
      id: poId,
      pharmacyId,
      branchId,
      supplierId,
      poNumber: `PO-${Date.now().toString().slice(-6)}`,
      issueDate: '2026-11-01',
      expectedDeliveryDate: '2026-11-10',
      status: 'approved',
      totalCostPaisa: 300000,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(purchaseOrderLines).values({
      id: poLineId,
      pharmacyId,
      purchaseOrderId: poId,
      productId,
      quantityOrdered: 100,
      quantityReceived: 0,
      expectedCostPaisa: 3000,
      totalCostPaisa: 300000,
      actualCostPaisa: null,
      createdAt: now,
      updatedAt: now,
    });

    const receiveRes = await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${poId}/receive`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        supplierInvoiceNo: 'INV-PO-REC-001',
        receiptDate: '2026-11-05',
        lines: [
          {
            poLineId,
            productId,
            batchNo: 'BATCH-PO-001',
            expiryDate: '2028-12-31',
            quantity: 50,
            costPaisa: 3000,
            mrpPaisa: 5000,
          },
        ],
      },
    });

    expect(receiveRes.statusCode).toBe(200);

    const logs = await ctx.db.query.changeLog.findMany({
      where: (cl, { eq }) => eq(cl.pharmacyId, pharmacyId),
    });

    const batchLog = logs.find((l) => l.entity === 'batch');
    const movementLog = logs.find(
      (l) =>
        l.entity === 'stock_movement' && (l.data as Record<string, unknown>).type === 'purchase'
    );

    expect(batchLog).toBeDefined();
    expect(movementLog).toBeDefined();
  });

  it('batch write-off and batch discount emit change_log records (F-H-06)', async () => {
    const testBatchId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(batches).values({
      id: testBatchId,
      pharmacyId,
      productId,
      batchNo: 'DISC-001',
      expiryDate: '2028-06-30',
      costPaisa: 2000,
      mrpPaisa: 4000,
      createdAt: now,
      updatedAt: now,
    });

    // Seed 10 on-hand units
    await ctx.db.insert(stockMovements).values({
      id: generateUuidV7(),
      pharmacyId,
      productId,
      batchId: testBatchId,
      branchId,
      type: 'purchase',
      quantitySigned: 10,
      referenceType: 'purchase',
      reason: 'Initial test stock',
      createdAt: now,
      updatedAt: now,
    });

    // 1. Discount batch (update mrpPaisa)
    const discountRes = await app.inject({
      method: 'POST',
      url: `/api/inventory/batches/${testBatchId}/discount`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { mrpPaisa: 3500 },
    });
    expect(discountRes.statusCode).toBe(200);

    // 2. Write-off 2 units
    const writeOffRes = await app.inject({
      method: 'POST',
      url: `/api/inventory/batches/${testBatchId}/write-off`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        branchId,
        quantity: 2,
        reason: 'Damaged packaging',
      },
    });
    expect(writeOffRes.statusCode).toBe(200);

    const logs = await ctx.db.query.changeLog.findMany({
      where: (cl, { eq, and }) => and(eq(cl.pharmacyId, pharmacyId)),
    });

    const discountLog = logs.find(
      (l) =>
        l.entity === 'batch' &&
        l.entityId === testBatchId &&
        (l.data as Record<string, unknown>).mrpPaisa === 3500
    );
    const writeOffLog = logs.find(
      (l) =>
        l.entity === 'stock_movement' &&
        (l.data as Record<string, unknown>).batchId === testBatchId &&
        (l.data as Record<string, unknown>).quantitySigned === -2
    );

    expect(discountLog).toBeDefined();
    expect(writeOffLog).toBeDefined();
  });

  it('applyPurchaseReceived sets stock_movements.createdAt to payload.purchase.createdAt (F-H-06)', async () => {
    const historicalPurchaseId = generateUuidV7();
    const histBatchId = generateUuidV7();
    const historicalDate = '2026-10-15T10:00:00.000Z';

    await ctx.db.insert(batches).values({
      id: histBatchId,
      pharmacyId,
      productId,
      batchNo: 'HIST-001',
      expiryDate: '2028-10-15',
      costPaisa: 2500,
      mrpPaisa: 4500,
      createdAt: historicalDate,
      updatedAt: historicalDate,
    });

    await ctx.db.transaction(async (tx) => {
      await applyPurchaseReceived(
        tx,
        {
          pharmacyId,
          branchId,
          counterId,
          deviceId: generateUuidV7(),
          userId: ownerUserId,
          eventId: generateUuidV7(),
        },
        {
          purchase: {
            id: historicalPurchaseId,
            branchId,
            supplierId,
            supplierInvoiceNo: 'SUP-HIST-01',
            invoiceDate: '2026-10-15',
            totalCostPaisa: 25000,
            taxPaisa: 0,
            createdByUserId: ownerUserId,
            createdAt: historicalDate,
          },
          batches: [
            {
              id: histBatchId,
              productId,
              batchNo: 'HIST-001',
              expiryDate: '2028-10-15',
              costPaisa: 2500,
              mrpPaisa: 4500,
              createdAt: historicalDate,
            },
          ],
          lines: [
            {
              id: generateUuidV7(),
              productId,
              batchId: histBatchId,
              quantity: 10,
              costPaisa: 2500,
              mrpPaisa: 4500,
            },
          ],
        }
      );
    });

    const [movement] = await ctx.db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.pharmacyId, pharmacyId),
          eq(stockMovements.referenceId, historicalPurchaseId)
        )
      )
      .limit(1);

    expect(movement).toBeDefined();
    expect(new Date(movement.createdAt).toISOString()).toBe(new Date(historicalDate).toISOString());
  });

  it('postStockTransferReceived posts shortage loss when sourceBranchId === destinationBranchId (F-H-06)', async () => {
    const intraBatchId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(batches).values({
      id: intraBatchId,
      pharmacyId,
      productId,
      batchNo: 'INTRA-001',
      expiryDate: '2028-12-31',
      costPaisa: 1500,
      mrpPaisa: 3000,
      createdAt: now,
      updatedAt: now,
    });

    const entry = await ctx.db.transaction(async (tx) => {
      return await postStockTransferReceived(tx, {
        pharmacyId,
        sourceBranchId: branchId,
        destinationBranchId: branchId, // Same branch
        transferId: generateUuidV7(),
        transferNumber: 'TR-INTRA-001',
        lines: [
          {
            batchId: intraBatchId,
            quantityReceived: 8,
            shortageQuantity: 2, // 2 units lost during intra-branch relocation
          },
        ],
      });
    });

    expect(entry).not.toBeNull();
    // 2 units * 1,500 paisa = 3,000 paisa shortage loss
    expect(entry!.lines).toHaveLength(2);
    const debitLine = entry!.lines.find((l) => l.debitPaisa === 3000);
    const creditLine = entry!.lines.find((l) => l.creditPaisa === 3000);
    expect(debitLine).toBeDefined();
    expect(creditLine).toBeDefined();
  });

  describe('Sync Applier Expiry Normalization Hardening', () => {
    it('normalizes raw YYYY-MM expiry dates to month-end YYYY-MM-DD on sync apply', async () => {
      const purchaseId = generateUuidV7();
      const rawYmBatchId = generateUuidV7();
      const movementId = generateUuidV7();
      const nowIso = new Date().toISOString();

      await ctx.db.transaction(async (tx) => {
        await applyPurchaseReceived(
          tx,
          {
            pharmacyId,
            branchId,
            counterId,
            deviceId: generateUuidV7(),
            userId: ownerUserId,
            eventId: generateUuidV7(),
          },
          {
            purchase: {
              id: purchaseId,
              branchId,
              supplierId,
              supplierInvoiceNo: 'SUP-NORM-01',
              invoiceDate: '2026-11-04',
              totalCostPaisa: 10000,
              createdByUserId: ownerUserId,
              createdAt: nowIso,
            },
            batches: [
              {
                id: rawYmBatchId,
                productId,
                batchNo: 'SYNC-BN-RAW-YM',
                expiryDate: '2026-11', // Raw month input from legacy/desktop
                costPaisa: 1000,
                mrpPaisa: 2000,
              },
            ],
            lines: [
              {
                id: generateUuidV7(),
                movementId,
                productId,
                batchId: rawYmBatchId,
                quantity: 10,
                costPaisa: 1000,
                mrpPaisa: 2000,
              },
            ],
          }
        );
      });

      // Verify batch was stored with normalized month-end date in PostgreSQL
      const [storedBatch] = await ctx.db
        .select({ expiryDate: batches.expiryDate })
        .from(batches)
        .where(eq(batches.id, rawYmBatchId));

      expect(storedBatch).toBeDefined();
      expect(storedBatch!.expiryDate).toBe('2026-11-30');
    });

    it('rejects sync events containing impossible dates with SyncRejectedError', async () => {
      const purchaseId = generateUuidV7();
      const badBatchId = generateUuidV7();
      const nowIso = new Date().toISOString();

      await expect(
        ctx.db.transaction(async (tx) => {
          await applyPurchaseReceived(
            tx,
            {
              pharmacyId,
              branchId,
              counterId,
              deviceId: generateUuidV7(),
              userId: ownerUserId,
              eventId: generateUuidV7(),
            },
            {
              purchase: {
                id: purchaseId,
                branchId,
                supplierId,
                supplierInvoiceNo: 'SUP-BAD-01',
                invoiceDate: '2026-11-04',
                totalCostPaisa: 10000,
                createdByUserId: ownerUserId,
                createdAt: nowIso,
              },
              batches: [
                {
                  id: badBatchId,
                  productId,
                  batchNo: 'SYNC-BN-BAD',
                  expiryDate: '2026-02-31', // Impossible date
                  costPaisa: 1000,
                  mrpPaisa: 2000,
                },
              ],
              lines: [
                {
                  id: generateUuidV7(),
                  productId,
                  batchId: badBatchId,
                  quantity: 10,
                  costPaisa: 1000,
                  mrpPaisa: 2000,
                },
              ],
            }
          );
        })
      ).rejects.toThrow();
    });
  });
});
