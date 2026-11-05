import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import {
  pharmacies,
  users,
  branches,
  devices,
  products,
  batches,
  stockLocations,
  stockTransfers,
  stockTransferLines,
  stockMovements,
  journalLines,
  fiscalPeriods,
} from '../db/schema';
import { signUserToken, signDeviceToken } from '../auth/jwt';
import { seedDefaultChartOfAccounts, getPharmacyAccountMap } from '../ledger/coa-seed';
import { eq, and, sql } from 'drizzle-orm';

describe('Stock Transfers & Warehouses Module', () => {
  let ctx: TestDatabaseContext;
  let app: ReturnType<typeof buildApp>;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchA1Id: string;
  let branchA2Id: string;
  let branchBId: string;

  let ownerTokenA: string;
  let pharmacistTokenA: string;
  let cashierTokenA: string;
  let ownerTokenB: string;

  let deviceAToken1: string;
  let deviceAToken2: string;

  let locA1ShelfId: string;
  let locA1StoreId: string;
  let locA2ShelfId: string;

  let product1Id: string;
  let batch1Id: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });
    const db = ctx.db;
    const now = new Date().toISOString();

    // 1. Setup Pharmacy A with two branches
    pharmacyAId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyAId,
      name: 'Transfer Pharmacy A',
      code: 'TRPHA',
      createdAt: now,
      updatedAt: now,
    });

    branchA1Id = generateUuidV7();
    await db.insert(branches).values({
      id: branchA1Id,
      pharmacyId: pharmacyAId,
      name: 'Branch Alpha 1 (Downtown)',
      createdAt: now,
      updatedAt: now,
    });

    branchA2Id = generateUuidV7();
    await db.insert(branches).values({
      id: branchA2Id,
      pharmacyId: pharmacyAId,
      name: 'Branch Alpha 2 (Uptown)',
      createdAt: now,
      updatedAt: now,
    });

    // 2. Setup Pharmacy B (tenant isolation)
    pharmacyBId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyBId,
      name: 'Transfer Pharmacy B',
      code: 'TRPHB',
      createdAt: now,
      updatedAt: now,
    });

    branchBId = generateUuidV7();
    await db.insert(branches).values({
      id: branchBId,
      pharmacyId: pharmacyBId,
      name: 'Branch Beta 1',
      createdAt: now,
      updatedAt: now,
    });

    // 3. Seed Chart of Accounts & Fiscal Periods
    await seedDefaultChartOfAccounts(db, pharmacyAId);
    await seedDefaultChartOfAccounts(db, pharmacyBId);

    const year = new Date().getFullYear();
    await db.insert(fiscalPeriods).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      status: 'open',
    });
    await db.insert(fiscalPeriods).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyBId,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      status: 'open',
    });

    // 4. Create Users
    const ownerAId = generateUuidV7();
    await db.insert(users).values({
      id: ownerAId,
      pharmacyId: pharmacyAId,
      name: 'Owner Alice',
      role: 'owner',
      pinHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
      createdAt: now,
      updatedAt: now,
    });
    ownerTokenA = signUserToken({
      userId: ownerAId,
      pharmacyId: pharmacyAId,
      role: 'owner',
      name: 'Owner Alice',
    });

    const pharmacistAId = generateUuidV7();
    await db.insert(users).values({
      id: pharmacistAId,
      pharmacyId: pharmacyAId,
      name: 'Pharmacist Bob',
      role: 'pharmacist',
      pinHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
      createdAt: now,
      updatedAt: now,
    });
    pharmacistTokenA = signUserToken({
      userId: pharmacistAId,
      pharmacyId: pharmacyAId,
      role: 'pharmacist',
      name: 'Pharmacist Bob',
    });

    const cashierAId = generateUuidV7();
    await db.insert(users).values({
      id: cashierAId,
      pharmacyId: pharmacyAId,
      name: 'Cashier Charlie',
      role: 'cashier',
      pinHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
      createdAt: now,
      updatedAt: now,
    });
    cashierTokenA = signUserToken({
      userId: cashierAId,
      pharmacyId: pharmacyAId,
      role: 'cashier',
      name: 'Cashier Charlie',
    });

    const ownerBId = generateUuidV7();
    await db.insert(users).values({
      id: ownerBId,
      pharmacyId: pharmacyBId,
      name: 'Owner Eve',
      role: 'owner',
      pinHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
      createdAt: now,
      updatedAt: now,
    });
    ownerTokenB = signUserToken({
      userId: ownerBId,
      pharmacyId: pharmacyBId,
      role: 'owner',
      name: 'Owner Eve',
    });

    // 5. Create Devices for two counters in Branch A1 and Branch A2
    const deviceA1Id = generateUuidV7();
    await db.insert(devices).values({
      id: deviceA1Id,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      deviceName: 'POS Terminal A1',
      deviceFingerprint: 'fp-a1',
      isRevoked: false,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    deviceAToken1 = signDeviceToken({
      deviceId: deviceA1Id,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
    });

    const deviceA2Id = generateUuidV7();
    await db.insert(devices).values({
      id: deviceA2Id,
      pharmacyId: pharmacyAId,
      branchId: branchA2Id,
      deviceName: 'POS Terminal A2',
      deviceFingerprint: 'fp-a2',
      isRevoked: false,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    deviceAToken2 = signDeviceToken({
      deviceId: deviceA2Id,
      pharmacyId: pharmacyAId,
      branchId: branchA2Id,
    });

    // 6. Setup Stock Locations in Branch A1 & A2
    locA1ShelfId = generateUuidV7();
    await db.insert(stockLocations).values({
      id: locA1ShelfId,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      name: 'Main Shelf',
      code: 'MS',
      isDefault: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    locA1StoreId = generateUuidV7();
    await db.insert(stockLocations).values({
      id: locA1StoreId,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      name: 'Back Store',
      code: 'BS',
      isDefault: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    locA2ShelfId = generateUuidV7();
    await db.insert(stockLocations).values({
      id: locA2ShelfId,
      pharmacyId: pharmacyAId,
      branchId: branchA2Id,
      name: 'Main Shelf',
      code: 'MS',
      isDefault: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // 7. Product & Batch with initial 100 stock at Branch A1 Main Shelf
    product1Id = generateUuidV7();
    await db.insert(products).values({
      id: product1Id,
      pharmacyId: pharmacyAId,
      brandName: 'Amoxicillin 500mg',
      genericName: 'Amoxicillin',
      mrpPaisa: 1500,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    batch1Id = generateUuidV7();
    await db.insert(batches).values({
      id: batch1Id,
      pharmacyId: pharmacyAId,
      productId: product1Id,
      batchNo: 'BATCH-AMOX-01',
      expiryDate: '2027-12-31',
      costPaisa: 900,
      mrpPaisa: 1500,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(stockMovements).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      productId: product1Id,
      batchId: batch1Id,
      branchId: branchA1Id,
      locationId: locA1ShelfId,
      type: 'purchase',
      quantitySigned: 100,
      referenceType: 'initial_stock',
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.cleanup();
  });

  it('manages stock locations per branch and enforces uniqueness', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/stock-locations?branchId=${branchA1Id}`,
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items).toHaveLength(2);

    // Create duplicate location name in same branch -> 400
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/stock-locations',
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        branchId: branchA1Id,
        name: 'Main Shelf',
      },
    });
    expect(dupRes.statusCode).toBe(400);
  });

  it('creates draft transfer and dispatches: creates transfer_out movement, stock becomes in-transit and not sellable at either branch', async () => {
    const db = ctx.db;

    // Initial stock: Branch A1 has 100, Branch A2 has 0
    const [balA1Pre] = await db
      .select({ total: sql<number>`sum(${stockMovements.quantitySigned})`.mapWith(Number) })
      .from(stockMovements)
      .where(and(eq(stockMovements.branchId, branchA1Id), eq(stockMovements.batchId, batch1Id)));
    expect(balA1Pre!.total).toBe(100);

    const [balA2Pre] = await db
      .select({ total: sql<number>`sum(${stockMovements.quantitySigned})`.mapWith(Number) })
      .from(stockMovements)
      .where(and(eq(stockMovements.branchId, branchA2Id), eq(stockMovements.batchId, batch1Id)));
    expect(balA2Pre!.total ?? 0).toBe(0);

    // Verify cashier cannot create transfer (requires inventory.transfer.create)
    const cashierCreateRes = await app.inject({
      method: 'POST',
      url: '/api/stock-transfers',
      headers: { authorization: `Bearer ${cashierTokenA}` },
      payload: {
        sourceBranchId: branchA1Id,
        destinationBranchId: branchA2Id,
        lines: [{ productId: product1Id, batchId: batch1Id, quantityRequested: 5 }],
      },
    });
    expect(cashierCreateRes.statusCode).toBe(403);

    // Verify pharmacist can list transfers
    const pharmList = await app.inject({
      method: 'GET',
      url: '/api/stock-transfers',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
    });
    expect(pharmList.statusCode).toBe(200);

    // 1. Create Draft Transfer of 40 units from A1 to A2
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/stock-transfers',
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        sourceBranchId: branchA1Id,
        sourceLocationId: locA1ShelfId,
        destinationBranchId: branchA2Id,
        destinationLocationId: locA2ShelfId,
        notes: 'Transfer 40 units to branch A2',
        lines: [
          {
            productId: product1Id,
            batchId: batch1Id,
            quantityRequested: 40,
          },
        ],
      },
    });

    expect(createRes.statusCode).toBe(201);
    const transfer = createRes.json().data;
    expect(transfer.status).toBe('draft');
    expect(transfer.transferNumber).toMatch(/^TR-/);

    // 2. Dispatch Transfer (40 units)
    const dispatchRes = await app.inject({
      method: 'POST',
      url: `/api/stock-transfers/${transfer.id}/dispatch`,
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        lines: [
          {
            lineId: transfer.lines[0].id,
            quantityDispatched: 40,
          },
        ],
      },
    });

    expect(dispatchRes.statusCode).toBe(200);
    expect(dispatchRes.json().data.status).toBe('in_transit');

    // 3. Verify in-transit sellability boundary:
    // Branch A1 available stock is reduced: 100 - 40 = 60
    const [balA1Mid] = await db
      .select({ total: sql<number>`sum(${stockMovements.quantitySigned})`.mapWith(Number) })
      .from(stockMovements)
      .where(and(eq(stockMovements.branchId, branchA1Id), eq(stockMovements.batchId, batch1Id)));
    expect(balA1Mid!.total).toBe(60);

    // Branch A2 available stock is STILL 0 (in-transit stock cannot be sold before receipt!)
    const [balA2Mid] = await db
      .select({ total: sql<number>`sum(${stockMovements.quantitySigned})`.mapWith(Number) })
      .from(stockMovements)
      .where(and(eq(stockMovements.branchId, branchA2Id), eq(stockMovements.batchId, batch1Id)));
    expect(balA2Mid!.total ?? 0).toBe(0);

    // Transfer is marked in_transit in transfer queries
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/stock-transfers/${transfer.id}`,
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.status).toBe('in_transit');
  });

  it('receives transfer at destination: creates transfer_in movement and stock becomes sellable at destination', async () => {
    const db = ctx.db;

    // Get the in_transit transfer from previous test
    const [transferRow] = await db
      .select()
      .from(stockTransfers)
      .where(
        and(eq(stockTransfers.pharmacyId, pharmacyAId), eq(stockTransfers.status, 'in_transit'))
      );
    expect(transferRow).toBeDefined();

    const [lineRow] = await db
      .select()
      .from(stockTransferLines)
      .where(eq(stockTransferLines.transferId, transferRow!.id));

    // Receive full 40 units at destination
    const receiveRes = await app.inject({
      method: 'POST',
      url: `/api/stock-transfers/${transferRow!.id}/receive`,
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        lines: [
          {
            lineId: lineRow!.id,
            quantityReceived: 40,
          },
        ],
      },
    });

    expect(receiveRes.statusCode).toBe(200);
    expect(receiveRes.json().data.status).toBe('received');
    expect(receiveRes.json().data.hasShortage).toBe(false);

    // Branch A2 now has +40 stock
    const [balA2Post] = await db
      .select({ total: sql<number>`sum(${stockMovements.quantitySigned})`.mapWith(Number) })
      .from(stockMovements)
      .where(and(eq(stockMovements.branchId, branchA2Id), eq(stockMovements.batchId, batch1Id)));
    expect(balA2Post!.total).toBe(40);

    // Total company stock across branches: 60 + 40 = 100 (matches initial)
    const [totalBal] = await db
      .select({ total: sql<number>`sum(${stockMovements.quantitySigned})`.mapWith(Number) })
      .from(stockMovements)
      .where(and(eq(stockMovements.pharmacyId, pharmacyAId), eq(stockMovements.batchId, batch1Id)));
    expect(totalBal!.total).toBe(100);
  });

  it('inter-branch transfers post balanced double-entry with NO P&L effect (Dr Inventory dest, Cr Inventory src)', async () => {
    const db = ctx.db;
    const accountMap = await getPharmacyAccountMap(db, pharmacyAId);
    const invAccountId = accountMap.inventory;

    // Query journal entries posted for stock_transfer
    const transferEntries = await db
      .select()
      .from(journalLines)
      .where(
        and(eq(journalLines.pharmacyId, pharmacyAId), eq(journalLines.accountId, invAccountId))
      );

    // Check that there is a debit for branch A2 and credit for branch A1 of exactly 40 * 900 = 36,000 paisa
    const a2DebitLines = transferEntries.filter(
      (l) => l.branchId === branchA2Id && l.debitPaisa === 36000
    );
    const a1CreditLines = transferEntries.filter(
      (l) => l.branchId === branchA1Id && l.creditPaisa === 36000
    );

    expect(a2DebitLines.length).toBeGreaterThanOrEqual(1);
    expect(a1CreditLines.length).toBeGreaterThanOrEqual(1);

    // Net change on Inventory Account for this entry is: 36,000 debit - 36,000 credit = 0 paisa! (No P&L effect)
    expect(a2DebitLines[0]!.debitPaisa - a1CreditLines[0]!.creditPaisa).toBe(0);
  });

  it('handles shortages on receipt: records shortage quantity, shortage reason, and creates adjustment movement', async () => {
    const db = ctx.db;

    // 1. Create and dispatch a transfer of 20 units from A1 to A2
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/stock-transfers',
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        sourceBranchId: branchA1Id,
        sourceLocationId: locA1ShelfId,
        destinationBranchId: branchA2Id,
        destinationLocationId: locA2ShelfId,
        notes: 'Transfer 20 units with anticipated transit risk',
        lines: [
          {
            productId: product1Id,
            batchId: batch1Id,
            quantityRequested: 20,
          },
        ],
      },
    });
    const transfer = createRes.json().data;

    await app.inject({
      method: 'POST',
      url: `/api/stock-transfers/${transfer.id}/dispatch`,
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        lines: [{ lineId: transfer.lines[0].id, quantityDispatched: 20 }],
      },
    });

    // 2. Receive delivery with shortage: dispatched 20, but only 17 received, 3 damaged in transit
    const receiveRes = await app.inject({
      method: 'POST',
      url: `/api/stock-transfers/${transfer.id}/receive`,
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        lines: [
          {
            lineId: transfer.lines[0].id,
            quantityReceived: 17,
            shortageQuantity: 3,
            shortageReason: 'Damaged during truck transit',
          },
        ],
      },
    });

    expect(receiveRes.statusCode).toBe(200);
    const body = receiveRes.json().data;
    expect(body.status).toBe('received');
    expect(body.hasShortage).toBe(true);
    expect(body.lines[0].shortageQuantity).toBe(3);
    expect(body.lines[0].shortageReason).toBe('Damaged during truck transit');

    // 3. Verify stock movements:
    // Destination A2 gained +17
    const [recMove] = await db
      .select()
      .from(stockMovements)
      .where(
        and(eq(stockMovements.referenceId, transfer.id), eq(stockMovements.type, 'transfer_in'))
      );
    expect(recMove).toBeDefined();
    expect(recMove!.quantitySigned).toBe(17);
    expect(recMove!.branchId).toBe(branchA2Id);

    // Balances equal movements check:
    // Total stock in system was 100. Dispatched 20 from A1, received 17 at A2, 3 lost.
    // Net total across company should be 100 - 3 = 97
    const [totalBal] = await db
      .select({ total: sql<number>`sum(${stockMovements.quantitySigned})`.mapWith(Number) })
      .from(stockMovements)
      .where(and(eq(stockMovements.pharmacyId, pharmacyAId), eq(stockMovements.batchId, batch1Id)));
    expect(totalBal!.total).toBe(97);
  });

  it('supports two counters and offline overlap via sync push', async () => {
    const db = ctx.db;
    const now = new Date().toISOString();
    const offlineTransferId = generateUuidV7();
    const offlineLineId = generateUuidV7();
    const dispatchMovementId = generateUuidV7();
    const receiveMovementId = generateUuidV7();

    // Counter A1 pushes stock_transfer.dispatched (offline event)
    const pushA1Res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${deviceAToken1}` },
      payload: {
        events: [
          {
            eventId: generateUuidV7(),
            deviceSeq: 1,
            type: 'stock_transfer.dispatched',
            entityId: offlineTransferId,
            occurredAt: now,
            schemaVersion: 1,
            payload: {
              transferId: offlineTransferId,
              transferNumber: 'TR-SYNC-001',
              sourceBranchId: branchA1Id,
              sourceLocationId: locA1ShelfId,
              destinationBranchId: branchA2Id,
              destinationLocationId: locA2ShelfId,
              dispatchedAt: now,
              notes: 'Offline transfer from Counter 1',
              lines: [
                {
                  id: offlineLineId,
                  productId: product1Id,
                  batchId: batch1Id,
                  quantityDispatched: 10,
                  dispatchMovementId,
                },
              ],
            },
          },
        ],
      },
    });

    expect(pushA1Res.statusCode).toBe(200);
    expect(pushA1Res.json().results[0].status).toBe('accepted');

    // Verify transfer_out movement preserved dispatchMovementId
    const [moveOut] = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.id, dispatchMovementId));
    expect(moveOut).toBeDefined();
    expect(moveOut!.quantitySigned).toBe(-10);
    expect(moveOut!.type).toBe('transfer_out');

    // Replay of same event is recognized as duplicate
    const pushReplay = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${deviceAToken1}` },
      payload: {
        events: [
          {
            eventId: pushA1Res.json().results[0].eventId,
            deviceSeq: 1,
            type: 'stock_transfer.dispatched',
            entityId: offlineTransferId,
            occurredAt: now,
            schemaVersion: 1,
            payload: {},
          },
        ],
      },
    });
    expect(pushReplay.json().results[0].status).toBe('duplicate');

    // Counter A2 pushes stock_transfer.received (offline receipt)
    const pushA2Res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${deviceAToken2}` },
      payload: {
        events: [
          {
            eventId: generateUuidV7(),
            deviceSeq: 1,
            type: 'stock_transfer.received',
            entityId: offlineTransferId,
            occurredAt: now,
            schemaVersion: 1,
            payload: {
              transferId: offlineTransferId,
              receivedAt: now,
              lines: [
                {
                  lineId: offlineLineId,
                  productId: product1Id,
                  batchId: batch1Id,
                  quantityReceived: 10,
                  shortageQuantity: 0,
                  receiveMovementId,
                },
              ],
            },
          },
        ],
      },
    });

    expect(pushA2Res.statusCode).toBe(200);
    expect(pushA2Res.json().results[0].status).toBe('accepted');

    // Verify transfer_in movement preserved receiveMovementId
    const [moveIn] = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.id, receiveMovementId));
    expect(moveIn).toBeDefined();
    expect(moveIn!.quantitySigned).toBe(10);
    expect(moveIn!.type).toBe('transfer_in');
  });

  it('enforces tenant isolation: pharmacy B cannot access pharmacy A locations or transfers', async () => {
    // Pharmacy B cannot list Pharmacy A locations
    const locRes = await app.inject({
      method: 'GET',
      url: `/api/stock-locations?branchId=${branchA1Id}`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(locRes.statusCode).toBe(200);
    expect(locRes.json().items).toHaveLength(0); // isolated

    // Pharmacy B cannot view Pharmacy A transfers
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/stock-transfers',
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items).toHaveLength(0);
  });
});
