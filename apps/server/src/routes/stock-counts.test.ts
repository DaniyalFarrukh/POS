import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import {
  pharmacies,
  branches,
  stockLocations,
  products,
  batches,
  stockMovements,
  stockCounts,
  users,
  journalLines,
  fiscalPeriods,
} from '../db/schema';
import { seedDefaultChartOfAccounts, getPharmacyAccountMap } from '../ledger/coa-seed';
import { signUserToken } from '../auth/jwt';

describe('Stock Counts Module', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchA1Id: string;
  let branchB1Id: string;
  let locationA1Id: string;

  let ownerTokenA: string;
  let managerTokenA: string;
  let pharmacistTokenA: string;
  let cashierTokenA: string;
  let ownerTokenB: string;

  let product1Id: string;
  let batch1Id: string;
  let product2Id: string;
  let batch2Id: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });
    const db = ctx.db;
    const now = new Date().toISOString();

    // 1. Setup Pharmacy A & B
    pharmacyAId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyAId,
      name: 'Count Pharmacy A',
      code: 'CTPHA',
      createdAt: now,
      updatedAt: now,
    });

    branchA1Id = generateUuidV7();
    await db.insert(branches).values({
      id: branchA1Id,
      pharmacyId: pharmacyAId,
      name: 'Branch Count Main',
      createdAt: now,
      updatedAt: now,
    });

    locationA1Id = generateUuidV7();
    await db.insert(stockLocations).values({
      id: locationA1Id,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      name: 'Bay 1 - Main Shelf',
      isDefault: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    pharmacyBId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyBId,
      name: 'Count Pharmacy B',
      code: 'CTPHB',
      createdAt: now,
      updatedAt: now,
    });

    branchB1Id = generateUuidV7();
    await db.insert(branches).values({
      id: branchB1Id,
      pharmacyId: pharmacyBId,
      name: 'Branch Count B',
      createdAt: now,
      updatedAt: now,
    });

    // Seed COA & Fiscal periods
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

    // Users
    const ownerAId = generateUuidV7();
    await db.insert(users).values({
      id: ownerAId,
      pharmacyId: pharmacyAId,
      name: 'Owner Alice',
      role: 'owner',
      pinHash: 'hash',
      createdAt: now,
      updatedAt: now,
    });
    ownerTokenA = signUserToken({
      userId: ownerAId,
      pharmacyId: pharmacyAId,
      role: 'owner',
      name: 'Owner Alice',
    });

    const managerAId = generateUuidV7();
    await db.insert(users).values({
      id: managerAId,
      pharmacyId: pharmacyAId,
      name: 'Manager Bob',
      role: 'manager',
      pinHash: 'hash',
      createdAt: now,
      updatedAt: now,
    });
    managerTokenA = signUserToken({
      userId: managerAId,
      pharmacyId: pharmacyAId,
      role: 'manager',
      name: 'Manager Bob',
    });

    const pharmAId = generateUuidV7();
    await db.insert(users).values({
      id: pharmAId,
      pharmacyId: pharmacyAId,
      name: 'Pharmacist Carol',
      role: 'pharmacist',
      pinHash: 'hash',
      createdAt: now,
      updatedAt: now,
    });
    pharmacistTokenA = signUserToken({
      userId: pharmAId,
      pharmacyId: pharmacyAId,
      role: 'pharmacist',
      name: 'Pharmacist Carol',
    });

    const cashierAId = generateUuidV7();
    await db.insert(users).values({
      id: cashierAId,
      pharmacyId: pharmacyAId,
      name: 'Cashier Dan',
      role: 'cashier',
      pinHash: 'hash',
      createdAt: now,
      updatedAt: now,
    });
    cashierTokenA = signUserToken({
      userId: cashierAId,
      pharmacyId: pharmacyAId,
      role: 'cashier',
      name: 'Cashier Dan',
    });

    const ownerBId = generateUuidV7();
    await db.insert(users).values({
      id: ownerBId,
      pharmacyId: pharmacyBId,
      name: 'Owner Bob B',
      role: 'owner',
      pinHash: 'hash',
      createdAt: now,
      updatedAt: now,
    });
    ownerTokenB = signUserToken({
      userId: ownerBId,
      pharmacyId: pharmacyBId,
      role: 'owner',
      name: 'Owner Bob B',
    });

    // 2. Setup Products & Initial Stock
    product1Id = generateUuidV7();
    await db.insert(products).values({
      id: product1Id,
      pharmacyId: pharmacyAId,
      brandName: 'Augmentin 625mg',
      genericName: 'Amoxicillin + Clavulanic Acid',
      mrpPaisa: 35000,
      createdAt: now,
      updatedAt: now,
    });

    batch1Id = generateUuidV7();
    await db.insert(batches).values({
      id: batch1Id,
      pharmacyId: pharmacyAId,
      productId: product1Id,
      batchNo: 'AUG-100',
      expiryDate: '2028-12-31',
      costPaisa: 25000, // Rs. 250
      mrpPaisa: 35000,
      createdAt: now,
      updatedAt: now,
    });

    product2Id = generateUuidV7();
    await db.insert(products).values({
      id: product2Id,
      pharmacyId: pharmacyAId,
      brandName: 'Panadol 500mg',
      genericName: 'Paracetamol',
      mrpPaisa: 5000,
      createdAt: now,
      updatedAt: now,
    });

    batch2Id = generateUuidV7();
    await db.insert(batches).values({
      id: batch2Id,
      pharmacyId: pharmacyAId,
      productId: product2Id,
      batchNo: 'PAN-200',
      expiryDate: '2027-06-30',
      costPaisa: 3000, // Rs. 30
      mrpPaisa: 5000,
      createdAt: now,
      updatedAt: now,
    });

    // Initial stock: 100 units of Batch 1, 50 units of Batch 2
    await db.insert(stockMovements).values([
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyAId,
        productId: product1Id,
        batchId: batch1Id,
        branchId: branchA1Id,
        locationId: locationA1Id,
        type: 'purchase',
        quantitySigned: 100,
        referenceType: 'initial_stock',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyAId,
        productId: product2Id,
        batchId: batch2Id,
        branchId: branchA1Id,
        locationId: locationA1Id,
        type: 'purchase',
        quantitySigned: 50,
        referenceType: 'initial_stock',
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.cleanup();
  });

  it('creates count session, calculates system on-hand, records counted quantities and variance math', async () => {
    // 1. Pharmacist creates a count session for Bay 1
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/stock-counts',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        branchId: branchA1Id,
        locationId: locationA1Id,
        notes: 'Monthly physical inventory audit',
        batches: [
          { productId: product1Id, batchId: batch1Id },
          { productId: product2Id, batchId: batch2Id },
        ],
      },
    });

    expect(createRes.statusCode).toBe(201);
    const countSession = createRes.json().data;
    expect(countSession.status).toBe('draft');
    expect(countSession.countNumber).toMatch(/^SC-/);
    expect(countSession.lines).toHaveLength(2);

    // Verify owner can list stock counts
    const ownerListRes = await app.inject({
      method: 'GET',
      url: '/api/stock-counts',
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });
    expect(ownerListRes.statusCode).toBe(200);

    // Verify system quantities matched on-hand stock
    const line1 = countSession.lines.find((l: { batchId: string }) => l.batchId === batch1Id);
    const line2 = countSession.lines.find((l: { batchId: string }) => l.batchId === batch2Id);
    expect(line1.systemQuantity).toBe(100);
    expect(line2.systemQuantity).toBe(50);

    // 2. Update lines with counted quantities:
    // Batch 1: Counted 95 (shortage / deficit of -5)
    // Batch 2: Counted 54 (surplus / gain of +4)
    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/stock-counts/${countSession.id}/lines`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        lines: [
          { lineId: line1.id, countedQuantity: 95, notes: '5 packs water damaged' },
          { lineId: line2.id, countedQuantity: 54, notes: 'Found unrecorded carton' },
        ],
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const updatedLines = updateRes.json().data.lines;
    const updLine1 = updatedLines.find((l: { id: string }) => l.id === line1.id);
    const updLine2 = updatedLines.find((l: { id: string }) => l.id === line2.id);

    // Variance math checks:
    // Line 1: variance_quantity = 95 - 100 = -5
    // Line 1: variance_paisa = -5 * 25000 = -125,000 paisa (-Rs. 1,250)
    expect(updLine1.varianceQuantity).toBe(-5);
    expect(updLine1.variancePaisa).toBe(-125000);

    // Line 2: variance_quantity = 54 - 50 = +4
    // Line 2: variance_paisa = +4 * 3000 = +12,000 paisa (+Rs. 120)
    expect(updLine2.varianceQuantity).toBe(4);
    expect(updLine2.variancePaisa).toBe(12000);

    // Submit count session for approval
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/stock-counts/${countSession.id}/submit`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
    });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().data.status).toBe('submitted');
  });

  it('rejects approval by pharmacist (403) and requires manager or owner role', async () => {
    const db = ctx.db;
    const [countRow] = await db
      .select()
      .from(stockCounts)
      .where(and(eq(stockCounts.pharmacyId, pharmacyAId), eq(stockCounts.status, 'submitted')));
    expect(countRow).toBeDefined();

    // Pharmacist attempt -> 403 Forbidden
    const pharmApproveRes = await app.inject({
      method: 'POST',
      url: `/api/stock-counts/${countRow!.id}/approve`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
    });
    expect(pharmApproveRes.statusCode).toBe(403);

    // Cashier attempt -> 403 Forbidden
    const cashierApproveRes = await app.inject({
      method: 'POST',
      url: `/api/stock-counts/${countRow!.id}/approve`,
      headers: { authorization: `Bearer ${cashierTokenA}` },
    });
    expect(cashierApproveRes.statusCode).toBe(403);
  });

  it('manager approval succeeds: generates stock adjustments, posts balanced journal entries, and balances equal counted quantities', async () => {
    const db = ctx.db;
    const [countRow] = await db
      .select()
      .from(stockCounts)
      .where(and(eq(stockCounts.pharmacyId, pharmacyAId), eq(stockCounts.status, 'submitted')));

    // Manager approves
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/stock-counts/${countRow!.id}/approve`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });

    expect(approveRes.statusCode).toBe(200);
    const body = approveRes.json().data;
    expect(body.status).toBe('approved');
    expect(body.approvedBy).toBeDefined();
    expect(body.approvedAt).toBeDefined();

    // 1. Verify stock movements generated
    // Batch 1 had -5 adjustment
    const [move1] = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.batchId, batch1Id),
          eq(stockMovements.referenceId, countRow!.id),
          eq(stockMovements.type, 'adjustment')
        )
      );
    expect(move1).toBeDefined();
    expect(move1!.quantitySigned).toBe(-5);

    // Batch 2 had +4 adjustment
    const [move2] = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.batchId, batch2Id),
          eq(stockMovements.referenceId, countRow!.id),
          eq(stockMovements.type, 'adjustment')
        )
      );
    expect(move2).toBeDefined();
    expect(move2!.quantitySigned).toBe(4);

    // 2. Balances check: Batch 1 should now be 95, Batch 2 should now be 54 (matches counted)
    const [bal1] = await db
      .select({ total: sql<number>`sum(${stockMovements.quantitySigned})`.mapWith(Number) })
      .from(stockMovements)
      .where(and(eq(stockMovements.branchId, branchA1Id), eq(stockMovements.batchId, batch1Id)));
    expect(bal1!.total).toBe(95);

    const [bal2] = await db
      .select({ total: sql<number>`sum(${stockMovements.quantitySigned})`.mapWith(Number) })
      .from(stockMovements)
      .where(and(eq(stockMovements.branchId, branchA1Id), eq(stockMovements.batchId, batch2Id)));
    expect(bal2!.total).toBe(54);

    // 3. Ledger check: Verify journal entries posted for stock adjustments
    const accountMap = await getPharmacyAccountMap(db, pharmacyAId);
    const invAccountId = accountMap.inventory;
    const adjAccountId = accountMap.stock_adjustment;

    const entries = await db
      .select()
      .from(journalLines)
      .where(eq(journalLines.pharmacyId, pharmacyAId));

    // Negative variance (-5 * 25000 = 125,000 paisa)
    // Dr Stock Adjustment 125,000, Cr Inventory 125,000
    const lossLines = entries.filter(
      (l) => l.debitPaisa === 125000 && l.accountId === adjAccountId
    );
    expect(lossLines.length).toBeGreaterThanOrEqual(1);

    // Positive variance (+4 * 3000 = 12,000 paisa)
    // Dr Inventory 12,000, Cr Stock Adjustment 12,000
    const gainLines = entries.filter((l) => l.debitPaisa === 12000 && l.accountId === invAccountId);
    expect(gainLines.length).toBeGreaterThanOrEqual(1);
  });

  it('enforces tenant isolation: pharmacy B cannot view or approve pharmacy A count session', async () => {
    const db = ctx.db;
    const [countRow] = await db
      .select()
      .from(stockCounts)
      .where(eq(stockCounts.pharmacyId, pharmacyAId));

    // Pharmacy B cannot get count session
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/stock-counts/${countRow!.id}`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(getRes.statusCode).toBe(404);

    // Pharmacy B cannot approve Pharmacy A count
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/stock-counts/${countRow!.id}/approve`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(approveRes.statusCode).toBe(404);
  });
});
