import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import {
  pharmacies,
  branches,
  suppliers,
  products,
  batches,
  stockMovements,
  users,
  journalLines,
  fiscalPeriods,
  supplierReturns,
} from '../db/schema';
import { seedDefaultChartOfAccounts, getPharmacyAccountMap } from '../ledger/coa-seed';
import { signUserToken } from '../auth/jwt';
import { postPurchaseReceived } from '../ledger/posting-engine';

describe('Supplier Returns & Debit Notes Module', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchA1Id: string;
  let branchB1Id: string;

  let ownerTokenA: string;
  let pharmacistTokenA: string;
  let cashierTokenA: string;
  let ownerTokenB: string;

  let supplierA1Id: string;
  let supplierB1Id: string;

  let product1Id: string;
  let batch1Id: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });
    const db = ctx.db;
    const now = new Date().toISOString();

    // 1. Setup Pharmacy A & B
    pharmacyAId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyAId,
      name: 'Return Pharmacy A',
      code: 'RTPHA',
      createdAt: now,
      updatedAt: now,
    });

    branchA1Id = generateUuidV7();
    await db.insert(branches).values({
      id: branchA1Id,
      pharmacyId: pharmacyAId,
      name: 'Branch Return Main',
      createdAt: now,
      updatedAt: now,
    });

    pharmacyBId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyBId,
      name: 'Return Pharmacy B',
      code: 'RTPHB',
      createdAt: now,
      updatedAt: now,
    });

    branchB1Id = generateUuidV7();
    await db.insert(branches).values({
      id: branchB1Id,
      pharmacyId: pharmacyBId,
      name: 'Branch Return B',
      createdAt: now,
      updatedAt: now,
    });

    // Seed COA & Fiscal Periods
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

    // 2. Setup Supplier A & B
    supplierA1Id = generateUuidV7();
    await db.insert(suppliers).values({
      id: supplierA1Id,
      pharmacyId: pharmacyAId,
      name: 'Apex Pharma Distributors',
      phone: '+923001234567',
      paymentTermsDays: 30,
      createdAt: now,
      updatedAt: now,
    });

    supplierB1Id = generateUuidV7();
    await db.insert(suppliers).values({
      id: supplierB1Id,
      pharmacyId: pharmacyBId,
      name: 'Beta Meds',
      phone: '+923007654321',
      createdAt: now,
      updatedAt: now,
    });

    // 3. Setup Product & Batch
    product1Id = generateUuidV7();
    await db.insert(products).values({
      id: product1Id,
      pharmacyId: pharmacyAId,
      brandName: 'Amoxil 500mg',
      mrpPaisa: 20000,
      createdAt: now,
      updatedAt: now,
    });

    batch1Id = generateUuidV7();
    await db.insert(batches).values({
      id: batch1Id,
      pharmacyId: pharmacyAId,
      productId: product1Id,
      batchNo: 'AMX-900',
      expiryDate: '2028-05-31',
      costPaisa: 15000, // Rs. 150 each
      mrpPaisa: 20000,
      createdAt: now,
      updatedAt: now,
    });

    // 4. Initial Purchase: 50 units @ Rs. 150 = Rs. 7,500 (750,000 paisa)
    const initialPurchaseId = generateUuidV7();
    await db.insert(stockMovements).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      productId: product1Id,
      batchId: batch1Id,
      branchId: branchA1Id,
      type: 'purchase',
      quantitySigned: 50,
      referenceType: 'purchase',
      referenceId: initialPurchaseId,
      createdAt: now,
      updatedAt: now,
    });

    // Post GRN journal entry to establish initial payable of 750,000 paisa
    await db.transaction(async (tx) => {
      await postPurchaseReceived(tx, {
        pharmacyId: pharmacyAId,
        createdBy: ownerAId,
        payload: {
          purchase: {
            id: initialPurchaseId,
            supplierId: supplierA1Id,
            branchId: branchA1Id,
            supplierInvoiceNo: 'INV-APEX-001',
            invoiceDate: now.slice(0, 10),
            totalCostPaisa: 750000,
            taxPaisa: 0,
            createdAt: now,
          },
          batches: [
            {
              id: batch1Id,
              productId: product1Id,
              batchNo: 'B-APEX-101',
              expiryDate: '2027-12-31',
              costPaisa: 15000,
              mrpPaisa: 20000,
            },
          ],
          lines: [
            {
              id: generateUuidV7(),
              productId: product1Id,
              batchId: batch1Id,
              quantity: 50,
              costPaisa: 15000,
              mrpPaisa: 20000,
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

  it('rejects attempt to return more than on-hand stock (cannot return more than on hand)', async () => {
    // Cashier attempt -> 403 Forbidden
    const cashierRes = await app.inject({
      method: 'POST',
      url: '/api/supplier-returns',
      headers: { authorization: `Bearer ${cashierTokenA}` },
      payload: {
        branchId: branchA1Id,
        supplierId: supplierA1Id,
        lines: [{ productId: product1Id, batchId: batch1Id, quantity: 1 }],
      },
    });
    expect(cashierRes.statusCode).toBe(403);

    // Current on hand is 50. Attempting to return 51 must fail with 400.
    const res = await app.inject({
      method: 'POST',
      url: '/api/supplier-returns',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        branchId: branchA1Id,
        supplierId: supplierA1Id,
        reason: 'Overstock return',
        lines: [
          {
            productId: product1Id,
            batchId: batch1Id,
            quantity: 51, // exceeds 50!
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CANNOT_RETURN_MORE_THAN_ON_HAND');

    // Verify owner can list returns
    const ownerListRes = await app.inject({
      method: 'GET',
      url: '/api/supplier-returns',
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });
    expect(ownerListRes.statusCode).toBe(200);
  });

  it('successfully creates supplier return: creates negative movement, generates debit note, and posts AP reduction', async () => {
    const db = ctx.db;

    // Return 20 units @ Rs. 150 = Rs. 3,000 (300,000 paisa)
    const res = await app.inject({
      method: 'POST',
      url: '/api/supplier-returns',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        branchId: branchA1Id,
        supplierId: supplierA1Id,
        reason: 'Damaged packaging during shipment',
        notes: 'Approved by supplier rep Ali',
        lines: [
          {
            productId: product1Id,
            batchId: batch1Id,
            quantity: 20,
            reason: 'Dented blisters',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const returnData = res.json().data;
    expect(returnData.returnNumber).toMatch(/^SR-/);
    expect(returnData.debitNoteNumber).toMatch(/^DN-/);
    expect(returnData.subtotalPaisa).toBe(300000);
    expect(returnData.totalPaisa).toBe(300000);

    // 1. Verify stock movement was negative (-20)
    const [move] = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.batchId, batch1Id),
          eq(stockMovements.referenceId, returnData.id),
          eq(stockMovements.type, 'return')
        )
      );
    expect(move).toBeDefined();
    expect(move!.quantitySigned).toBe(-20);

    // Remaining stock balance is now 50 - 20 = 30
    const [bal] = await db
      .select({ total: sql<number>`sum(${stockMovements.quantitySigned})`.mapWith(Number) })
      .from(stockMovements)
      .where(and(eq(stockMovements.branchId, branchA1Id), eq(stockMovements.batchId, batch1Id)));
    expect(bal!.total).toBe(30);

    // 2. Verify Debit Note journal entry posted
    // Debit 2000 Accounts Payable (supplier party) 300,000
    // Credit 1200 Inventory 300,000
    const accountMap = await getPharmacyAccountMap(db, pharmacyAId);
    const apAccountId = accountMap.ap;
    const invAccountId = accountMap.inventory;

    const [apDebitLine] = await db
      .select()
      .from(journalLines)
      .where(
        and(
          eq(journalLines.pharmacyId, pharmacyAId),
          eq(journalLines.accountId, apAccountId),
          eq(journalLines.partyId, supplierA1Id),
          eq(journalLines.debitPaisa, 300000)
        )
      );
    expect(apDebitLine).toBeDefined();
    expect(apDebitLine!.partyType).toBe('supplier');

    const [invCreditLine] = await db
      .select()
      .from(journalLines)
      .where(
        and(
          eq(journalLines.pharmacyId, pharmacyAId),
          eq(journalLines.accountId, invAccountId),
          eq(journalLines.creditPaisa, 300000)
        )
      );
    expect(invCreditLine).toBeDefined();

    // 3. Verify Supplier net payable in ledger:
    // Initial Purchase: Cr 750,000
    // Supplier Return: Dr 300,000
    // Net Payable = 750,000 - 300,000 = 450,000 paisa!
    const [apBalance] = await db
      .select({
        netPayable:
          sql<number>`sum(${journalLines.creditPaisa}) - sum(${journalLines.debitPaisa})`.mapWith(
            Number
          ),
      })
      .from(journalLines)
      .where(
        and(
          eq(journalLines.pharmacyId, pharmacyAId),
          eq(journalLines.accountId, apAccountId),
          eq(journalLines.partyId, supplierA1Id)
        )
      );
    expect(apBalance!.netPayable).toBe(450000);
  });

  it('enforces tenant isolation: pharmacy B cannot view pharmacy A supplier returns', async () => {
    const db = ctx.db;
    const [retRow] = await db
      .select()
      .from(supplierReturns)
      .where(eq(supplierReturns.pharmacyId, pharmacyAId));

    // Pharmacy B cannot get Pharmacy A's supplier return
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/supplier-returns/${retRow!.id}`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(getRes.statusCode).toBe(404);

    // Pharmacy B cannot list Pharmacy A's returns
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/supplier-returns',
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items).toHaveLength(0);
  });
});
