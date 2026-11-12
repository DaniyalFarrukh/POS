import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { generateUuidV7, getKarachiBusinessDate, addDaysToBusinessDate } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import {
  pharmacies,
  branches,
  stockLocations,
  suppliers,
  products,
  batches,
  stockMovements,
  users,
  journalLines,
  fiscalPeriods,
} from '../db/schema';
import { seedDefaultChartOfAccounts, getPharmacyAccountMap } from '../ledger/coa-seed';
import { signUserToken } from '../auth/jwt';
import { postPurchaseReceived } from '../ledger/posting-engine';

describe('Stock Management & Batches Expiry Module', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchA1Id: string;
  let branchA2Id: string;
  let branchB1Id: string;
  let locationA1Id: string;
  let locationA2Id: string;

  let ownerTokenA: string;
  let managerTokenA: string;
  let pharmacistTokenA: string;
  let accountantTokenA: string;
  let cashierTokenA: string;
  let ownerTokenB: string;

  let supplierAId: string;

  let product1Id: string; // Amoxicillin 500mg (low stock test: reorder 60, stock 40)
  let product2Id: string; // Panadol Extra (normal stock: reorder 20, stock 100)
  let product3Id: string; // Flagyl 400mg (zero stock)

  let batch1ExpiringSoonId: string; // expires in 25 days
  let batch2Expiring90Id: string; // expires in 75 days
  let batch3ExpiredId: string; // expired 10 days ago
  let batch4FreshId: string; // expires in 300 days

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });
    const db = ctx.db;
    const now = new Date();
    const nowIso = now.toISOString();

    // 1. Setup Pharmacy A & B
    pharmacyAId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyAId,
      name: 'Stock Central Pharmacy A',
      code: 'STKPA',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    pharmacyBId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyBId,
      name: 'Stock Pharmacy B',
      code: 'STKPB',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 2. Branches & Locations
    branchA1Id = generateUuidV7();
    await db.insert(branches).values({
      id: branchA1Id,
      pharmacyId: pharmacyAId,
      name: 'Main Branch A1',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    branchA2Id = generateUuidV7();
    await db.insert(branches).values({
      id: branchA2Id,
      pharmacyId: pharmacyAId,
      name: 'Secondary Branch A2',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    branchB1Id = generateUuidV7();
    await db.insert(branches).values({
      id: branchB1Id,
      pharmacyId: pharmacyBId,
      name: 'Branch B1',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    locationA1Id = generateUuidV7();
    await db.insert(stockLocations).values({
      id: locationA1Id,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      name: 'Main Shelf A1',
      code: 'MS-01',
      isDefault: true,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    locationA2Id = generateUuidV7();
    await db.insert(stockLocations).values({
      id: locationA2Id,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      name: 'Cold Storage A1',
      code: 'CS-01',
      isDefault: false,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // Seed Chart of Accounts & Open Fiscal Period for Pharmacy A and B
    await seedDefaultChartOfAccounts(db, pharmacyAId);
    await seedDefaultChartOfAccounts(db, pharmacyBId);

    const year = now.getFullYear();
    await db.insert(fiscalPeriods).values([
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyAId,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
        status: 'open',
      },
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyBId,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
        status: 'open',
      },
    ]);

    // Users & Tokens
    const ownerAId = generateUuidV7();
    await db.insert(users).values({
      id: ownerAId,
      pharmacyId: pharmacyAId,
      name: 'Owner Tariq',
      role: 'owner',
      pinHash: 'hash',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    ownerTokenA = signUserToken({
      userId: ownerAId,
      pharmacyId: pharmacyAId,
      role: 'owner',
      name: 'Owner Tariq',
    });

    const mgrAId = generateUuidV7();
    await db.insert(users).values({
      id: mgrAId,
      pharmacyId: pharmacyAId,
      name: 'Manager Usman',
      role: 'manager',
      pinHash: 'hash',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    managerTokenA = signUserToken({
      userId: mgrAId,
      pharmacyId: pharmacyAId,
      role: 'manager',
      name: 'Manager Usman',
    });

    const pharmAId = generateUuidV7();
    await db.insert(users).values({
      id: pharmAId,
      pharmacyId: pharmacyAId,
      name: 'Pharmacist Ayesha',
      role: 'pharmacist',
      pinHash: 'hash',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    pharmacistTokenA = signUserToken({
      userId: pharmAId,
      pharmacyId: pharmacyAId,
      role: 'pharmacist',
      name: 'Pharmacist Ayesha',
    });

    const acctAId = generateUuidV7();
    await db.insert(users).values({
      id: acctAId,
      pharmacyId: pharmacyAId,
      name: 'Accountant Bilal',
      role: 'accountant',
      pinHash: 'hash',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    accountantTokenA = signUserToken({
      userId: acctAId,
      pharmacyId: pharmacyAId,
      role: 'accountant',
      name: 'Accountant Bilal',
    });

    const cashAId = generateUuidV7();
    await db.insert(users).values({
      id: cashAId,
      pharmacyId: pharmacyAId,
      name: 'Cashier Zain',
      role: 'cashier',
      pinHash: 'hash',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    cashierTokenA = signUserToken({
      userId: cashAId,
      pharmacyId: pharmacyAId,
      role: 'cashier',
      name: 'Cashier Zain',
    });

    const ownerBId = generateUuidV7();
    await db.insert(users).values({
      id: ownerBId,
      pharmacyId: pharmacyBId,
      name: 'Owner Babar',
      role: 'owner',
      pinHash: 'hash',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    ownerTokenB = signUserToken({
      userId: ownerBId,
      pharmacyId: pharmacyBId,
      role: 'owner',
      name: 'Owner Babar',
    });

    // Supplier
    supplierAId = generateUuidV7();
    await db.insert(suppliers).values({
      id: supplierAId,
      pharmacyId: pharmacyAId,
      name: 'GSK Pakistan Distribution',
      phone: '03001234567',
      paymentTermsDays: 30,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // Products
    product1Id = generateUuidV7();
    await db.insert(products).values({
      id: product1Id,
      pharmacyId: pharmacyAId,
      brandName: 'Amoxil 500mg',
      genericName: 'Amoxicillin',
      strength: '500mg',
      form: 'Capsule',
      manufacturer: 'GSK',
      barcode: '896400010011',
      mrpPaisa: 30000,
      reorderLevel: 60, // on-hand will be 40 -> low stock!
      reorderQuantity: 100,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    product2Id = generateUuidV7();
    await db.insert(products).values({
      id: product2Id,
      pharmacyId: pharmacyAId,
      brandName: 'Panadol Extra',
      genericName: 'Paracetamol + Caffeine',
      strength: '500mg/65mg',
      form: 'Tablet',
      manufacturer: 'Haleon',
      barcode: '896400020022',
      mrpPaisa: 5000,
      reorderLevel: 20, // on-hand will be 100 -> normal stock
      reorderQuantity: 50,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    product3Id = generateUuidV7();
    await db.insert(products).values({
      id: product3Id,
      pharmacyId: pharmacyAId,
      brandName: 'Flagyl 400mg',
      genericName: 'Metronidazole',
      strength: '400mg',
      form: 'Tablet',
      manufacturer: 'Sanofi',
      barcode: '896400030033',
      mrpPaisa: 12000,
      reorderLevel: 30, // on hand is 0 -> low stock!
      reorderQuantity: 50,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // Batches & Expiry Dates
    // Batch 1: Expiring in 25 days (Amoxil, cost 20,000 paisa, qty 40)
    const todayKarachi = getKarachiBusinessDate(now);
    const exp25 = addDaysToBusinessDate(todayKarachi, 25);
    batch1ExpiringSoonId = generateUuidV7();
    await db.insert(batches).values({
      id: batch1ExpiringSoonId,
      pharmacyId: pharmacyAId,
      productId: product1Id,
      batchNo: 'AMX-25D',
      expiryDate: exp25,
      costPaisa: 20000,
      mrpPaisa: 30000,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // Batch 2: Expiring in 75 days (Panadol, cost 3,500 paisa, qty 60)
    const exp75 = addDaysToBusinessDate(todayKarachi, 75);
    batch2Expiring90Id = generateUuidV7();
    await db.insert(batches).values({
      id: batch2Expiring90Id,
      pharmacyId: pharmacyAId,
      productId: product2Id,
      batchNo: 'PAN-75D',
      expiryDate: exp75,
      costPaisa: 3500,
      mrpPaisa: 5000,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // Batch 3: Expired 10 days ago (Panadol, cost 3,500 paisa, qty 10)
    const expPast = addDaysToBusinessDate(todayKarachi, -10);
    batch3ExpiredId = generateUuidV7();
    await db.insert(batches).values({
      id: batch3ExpiredId,
      pharmacyId: pharmacyAId,
      productId: product2Id,
      batchNo: 'PAN-EXPIRED',
      expiryDate: expPast,
      costPaisa: 3500,
      mrpPaisa: 5000,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // Batch 4: Fresh, expires in 300 days (Panadol, cost 3,500 paisa, qty 30)
    const exp300 = addDaysToBusinessDate(todayKarachi, 300);
    batch4FreshId = generateUuidV7();
    await db.insert(batches).values({
      id: batch4FreshId,
      pharmacyId: pharmacyAId,
      productId: product2Id,
      batchNo: 'PAN-FRESH',
      expiryDate: exp300,
      costPaisa: 3500,
      mrpPaisa: 5000,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // Initial stock setup via purchase receiving posting so Ledger Inventory Account 1200 strictly matches!
    // Valuation:
    // Batch 1 (Amoxil): 40 * 20,000 = 800,000 paisa
    // Batch 2 (Panadol 75d): 60 * 3,500 = 210,000 paisa
    // Batch 3 (Panadol exp): 10 * 3,500 = 35,000 paisa
    // Batch 4 (Panadol fresh): 30 * 3,500 = 105,000 paisa
    // Total Stock Value = 800,000 + 210,000 + 35,000 + 105,000 = 1,150,000 paisa (Rs. 11,500)
    const grnId = generateUuidV7();
    const mov1Id = generateUuidV7();
    const mov2Id = generateUuidV7();
    const mov3Id = generateUuidV7();
    const mov4Id = generateUuidV7();

    await db.insert(stockMovements).values([
      {
        id: mov1Id,
        pharmacyId: pharmacyAId,
        productId: product1Id,
        batchId: batch1ExpiringSoonId,
        branchId: branchA1Id,
        locationId: locationA1Id,
        type: 'purchase',
        quantitySigned: 40,
        referenceType: 'purchase',
        referenceId: grnId,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: mov2Id,
        pharmacyId: pharmacyAId,
        productId: product2Id,
        batchId: batch2Expiring90Id,
        branchId: branchA1Id,
        locationId: locationA1Id,
        type: 'purchase',
        quantitySigned: 60,
        referenceType: 'purchase',
        referenceId: grnId,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: mov3Id,
        pharmacyId: pharmacyAId,
        productId: product2Id,
        batchId: batch3ExpiredId,
        branchId: branchA1Id,
        locationId: locationA2Id,
        type: 'purchase',
        quantitySigned: 10,
        referenceType: 'purchase',
        referenceId: grnId,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: mov4Id,
        pharmacyId: pharmacyAId,
        productId: product2Id,
        batchId: batch4FreshId,
        branchId: branchA1Id,
        locationId: locationA1Id,
        type: 'purchase',
        quantitySigned: 30,
        referenceType: 'purchase',
        referenceId: grnId,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);

    // Auto-post Purchase Received to post Dr 1200 Inventory = 1,150,000 paisa
    await db.transaction(async (tx) => {
      await postPurchaseReceived(tx, {
        pharmacyId: pharmacyAId,
        createdBy: ownerAId,
        payload: {
          purchase: {
            id: grnId,
            supplierId: supplierAId,
            branchId: branchA1Id,
            supplierInvoiceNo: 'INV-GSK-1001',
            invoiceDate: nowIso.slice(0, 10),
            totalCostPaisa: 1150000,
            taxPaisa: 0,
            createdAt: nowIso,
          },
          batches: [
            {
              id: batch1ExpiringSoonId,
              productId: product1Id,
              batchNo: 'AMX-25D',
              expiryDate: exp25,
              costPaisa: 20000,
              mrpPaisa: 30000,
            },
            {
              id: batch2Expiring90Id,
              productId: product2Id,
              batchNo: 'PAN-75D',
              expiryDate: exp75,
              costPaisa: 3500,
              mrpPaisa: 5000,
            },
            {
              id: batch3ExpiredId,
              productId: product2Id,
              batchNo: 'PAN-EXPIRED',
              expiryDate: expPast,
              costPaisa: 3500,
              mrpPaisa: 5000,
            },
            {
              id: batch4FreshId,
              productId: product2Id,
              batchNo: 'PAN-FRESH',
              expiryDate: exp300,
              costPaisa: 3500,
              mrpPaisa: 5000,
            },
          ],
          lines: [
            {
              id: generateUuidV7(),
              productId: product1Id,
              batchId: batch1ExpiringSoonId,
              quantity: 40,
              costPaisa: 20000,
              mrpPaisa: 30000,
            },
            {
              id: generateUuidV7(),
              productId: product2Id,
              batchId: batch2Expiring90Id,
              quantity: 60,
              costPaisa: 3500,
              mrpPaisa: 5000,
            },
            {
              id: generateUuidV7(),
              productId: product2Id,
              batchId: batch3ExpiredId,
              quantity: 10,
              costPaisa: 3500,
              mrpPaisa: 5000,
            },
            {
              id: generateUuidV7(),
              productId: product2Id,
              batchId: batch4FreshId,
              quantity: 30,
              costPaisa: 3500,
              mrpPaisa: 5000,
            },
          ],
        },
      });
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.cleanup();
  });

  it('GET /api/inventory/stock returns paginated product view with KPI metrics and proves ledger inventory reconciliation (variance = 0)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/inventory/stock?view=product&page=1&pageSize=10',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.pagination).toEqual({
      page: 1,
      pageSize: 10,
      total: 3, // 3 products
      totalPages: 1,
    });

    const kpis = body.data.kpis;
    // Stock value: 1,150,000 paisa (Rs. 11,500)
    expect(kpis.totalStockValuePaisa).toBe(1150000);
    // Ledger balance for Account 1200 Inventory must match:
    expect(kpis.ledgerInventoryBalancePaisa).toBe(1150000);
    // Invariant: Reconciliation difference must be exactly 0
    expect(kpis.reconciliationDifferencePaisa).toBe(0);

    // Low stock: Amoxil (40 <= 60) and Flagyl (0 <= 30) = 2 products
    expect(kpis.lowStockCount).toBe(2);
    // Near expiry (<= 90 days): AMX-25D (25 days) and PAN-75D (75 days) = 2 batches
    expect(kpis.nearExpiryCount).toBe(2);
    // Expired batches with stock > 0: PAN-EXPIRED (10 units) = 1 batch
    expect(kpis.expiredCount).toBe(1);

    // Check items
    const items = body.data.items;
    expect(items).toHaveLength(3);
    const amoxil = items.find((i: { id: string }) => i.id === product1Id);
    expect(amoxil.brandName).toBe('Amoxil 500mg');
    expect(amoxil.totalStock).toBe(40);
    expect(amoxil.isLowStock).toBe(true);
    expect(amoxil.stockValuePaisa).toBe(800000);
  });

  it('GET /api/inventory/stock supports batch view, branch, location, and status filters', async () => {
    // 1. Batch view
    const batchRes = await app.inject({
      method: 'GET',
      url: '/api/inventory/stock?view=batch&page=1&pageSize=10',
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(batchRes.statusCode).toBe(200);
    const batchBody = batchRes.json();
    expect(batchBody.data.items).toHaveLength(4);

    // 2. Filter by location A2 (Cold Storage A1) -> only expired batch
    const locRes = await app.inject({
      method: 'GET',
      url: `/api/inventory/stock?view=batch&locationId=${locationA2Id}`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
    });
    expect(locRes.statusCode).toBe(200);
    const locItems = locRes.json().data.items;
    expect(locItems).toHaveLength(1);
    expect(locItems[0].batchNo).toBe('PAN-EXPIRED');

    // 3. Filter status=low_stock on product view
    const lowStockRes = await app.inject({
      method: 'GET',
      url: '/api/inventory/stock?view=product&status=low_stock',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
    });
    expect(lowStockRes.statusCode).toBe(200);
    const lowItems = lowStockRes.json().data.items;
    expect(lowItems).toHaveLength(2);
    expect(lowItems.map((p: { brandName: string }) => p.brandName)).toEqual(
      expect.arrayContaining(['Amoxil 500mg', 'Flagyl 400mg'])
    );
  });

  it('GET /api/inventory/batches/expiring returns windowed batches (30, 60, 90, expired) with days remaining and summary counts', async () => {
    // 1. Window = 30 days -> AMX-25D (25 days)
    const res30 = await app.inject({
      method: 'GET',
      url: '/api/inventory/batches/expiring?window=30',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(res30.statusCode).toBe(200);
    const data30 = res30.json().data;
    expect(data30.items).toHaveLength(1);
    expect(data30.items[0].batchNo).toBe('AMX-25D');
    expect(data30.summary.expiring30).toBe(1);

    // 2. Window = expired -> PAN-EXPIRED
    const resExp = await app.inject({
      method: 'GET',
      url: '/api/inventory/batches/expiring?window=expired',
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(resExp.statusCode).toBe(200);
    const dataExp = resExp.json().data;
    expect(dataExp.items).toHaveLength(1);
    expect(dataExp.items[0].batchNo).toBe('PAN-EXPIRED');
    expect(dataExp.summary.expired).toBe(1);

    // 3. Window = all (all expiring <= 90 days or expired) -> AMX-25D, PAN-75D, PAN-EXPIRED
    const resAll = await app.inject({
      method: 'GET',
      url: '/api/inventory/batches/expiring?window=all',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
    });
    expect(resAll.statusCode).toBe(200);
    const dataAll = resAll.json().data;
    expect(dataAll.items).toHaveLength(3);
  });

  it('POST /api/inventory/batches/:id/discount updates batch sale price (MRP)', async () => {
    // Cashier attempt -> 403 Forbidden
    const cashierRes = await app.inject({
      method: 'POST',
      url: `/api/inventory/batches/${batch1ExpiringSoonId}/discount`,
      headers: { authorization: `Bearer ${cashierTokenA}` },
      payload: { mrpPaisa: 25000, reason: 'Near expiry markdown' },
    });
    expect(cashierRes.statusCode).toBe(403);

    // Pharmacist updates MRP from 30,000 to 24,000 paisa (Rs. 240)
    const discountRes = await app.inject({
      method: 'POST',
      url: `/api/inventory/batches/${batch1ExpiringSoonId}/discount`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: { mrpPaisa: 24000, reason: 'Near expiry 20% discount' },
    });
    expect(discountRes.statusCode).toBe(200);
    expect(discountRes.json().data.mrpPaisa).toBe(24000);

    // Verify updated in DB
    const [b] = await ctx.db.select().from(batches).where(eq(batches.id, batch1ExpiringSoonId));
    expect(b!.mrpPaisa).toBe(24000);
  });

  it('POST /api/inventory/batches/:id/write-off rejects excess quantity and posts balanced write-off journal entry', async () => {
    // Current on hand for batch3 (expired) is 10 units.
    // 1. Attempting to write off 15 units -> 400 CANNOT_WRITE_OFF_MORE_THAN_ON_HAND
    const excessRes = await app.inject({
      method: 'POST',
      url: `/api/inventory/batches/${batch3ExpiredId}/write-off`,
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        branchId: branchA1Id,
        locationId: locationA2Id,
        quantity: 15,
        reason: 'Expired syrup bottles disposal',
      },
    });
    expect(excessRes.statusCode).toBe(400);
    expect(excessRes.json().code).toBe('CANNOT_WRITE_OFF_MORE_THAN_ON_HAND');

    // 2. Successful write-off of all 10 expired units:
    // Valuation: 10 * 3,500 = 35,000 paisa (Rs. 350)
    const writeOffRes = await app.inject({
      method: 'POST',
      url: `/api/inventory/batches/${batch3ExpiredId}/write-off`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        branchId: branchA1Id,
        locationId: locationA2Id,
        quantity: 10,
        reason: 'Authorized expired batch write-off',
      },
    });

    expect(writeOffRes.statusCode).toBe(200);
    const writeOffData = writeOffRes.json().data;
    expect(writeOffData.writtenOffQuantity).toBe(10);
    expect(writeOffData.writtenOffValuePaisa).toBe(35000);
    expect(writeOffData.journalEntryId).toBeDefined();

    // 3. Verify stock movement was recorded
    const [movement] = await ctx.db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.id, writeOffData.movementId));
    expect(movement).toBeDefined();
    expect(movement!.type).toBe('adjustment');
    expect(movement!.quantitySigned).toBe(-10);

    // 4. Verify balanced ledger posting:
    // Dr 5010 Stock Adjustments and Write-offs: 35,000 paisa
    // Cr 1200 Inventory: 35,000 paisa
    const lines = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, writeOffData.journalEntryId));
    expect(lines).toHaveLength(2);

    const accountMap = await getPharmacyAccountMap(ctx.db, pharmacyAId);
    const drLine = lines.find((l) => l.accountId === accountMap.stock_adjustment);
    const crLine = lines.find((l) => l.accountId === accountMap.inventory);

    expect(drLine!.debitPaisa).toBe(35000);
    expect(drLine!.creditPaisa).toBe(0);
    expect(crLine!.debitPaisa).toBe(0);
    expect(crLine!.creditPaisa).toBe(35000);

    // 5. Invariant: Re-query GET /api/inventory/stock and prove:
    // New Stock Value = 1,150,000 - 35,000 = 1,115,000 paisa
    // New Ledger Balance = 1,115,000 paisa
    // Reconciliation difference remains exactly 0!
    const recheckRes = await app.inject({
      method: 'GET',
      url: '/api/inventory/stock?view=product',
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });
    expect(recheckRes.statusCode).toBe(200);
    const recheckKpis = recheckRes.json().data.kpis;
    expect(recheckKpis.totalStockValuePaisa).toBe(1115000);
    expect(recheckKpis.ledgerInventoryBalancePaisa).toBe(1115000);
    expect(recheckKpis.reconciliationDifferencePaisa).toBe(0);
    // Expired count is now 0 because all 10 expired units were written off!
    expect(recheckKpis.expiredCount).toBe(0);
  });

  it('GET /api/inventory/products/:id/stock-detail returns metadata, batches, and movements timeline', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/inventory/products/${product1Id}/stock-detail`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const detail = res.json().data;
    expect(detail.product.id).toBe(product1Id);
    expect(detail.product.brandName).toBe('Amoxil 500mg');
    expect(detail.product.totalStock).toBe(40);
    expect(detail.batches).toHaveLength(1);
    expect(detail.batches[0].batchNo).toBe('AMX-25D');

    // Timeline must include the initial purchase movement
    expect(detail.movements.length).toBeGreaterThanOrEqual(1);
    const firstMov = detail.movements[0];
    expect(firstMov.type).toBe('purchase');
    expect(firstMov.quantitySigned).toBe(40);
    expect(firstMov.batchNo).toBe('AMX-25D');
  });

  it('enforces tenant isolation: Pharmacy B token cannot view or write off Pharmacy A inventory', async () => {
    // 1. Pharmacy B attempts to view stock of Pharmacy A product
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/inventory/products/${product1Id}/stock-detail`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(detailRes.statusCode).toBe(404);

    // 2. Pharmacy B attempts to write off Pharmacy A batch
    const writeOffRes = await app.inject({
      method: 'POST',
      url: `/api/inventory/batches/${batch1ExpiringSoonId}/write-off`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
      payload: {
        branchId: branchB1Id,
        quantity: 1,
        reason: 'Malicious cross-tenant write off',
      },
    });
    expect(writeOffRes.statusCode).toBe(404);
  });
});
