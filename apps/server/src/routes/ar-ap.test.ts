import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import {
  pharmacies,
  branches,
  counters,
  users,
  customers,
  suppliers,
  products,
  batches,
  invoices,
  invoiceLines,
  fiscalPeriods,
} from '../db/schema';
import { seedDefaultChartOfAccounts, getPharmacyAccountMap } from '../ledger/coa-seed';
import { postJournalEntry } from '../ledger/service';
import { signUserToken } from '../auth/jwt';

describe('ERP Accounts Receivable (AR) & Accounts Payable (AP) Module', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchAId: string;
  let branchBId: string;
  let counterAId: string;
  let accountantUserAId: string;
  let accountantTokenA: string;
  let ownerTokenB: string;

  let customer1Id: string;
  let customer2Id: string;
  let supplier1Id: string;
  let supplier2Id: string;
  let product1Id: string;
  let product2Id: string;
  let batch1Id: string;
  let batch2Id: string;

  let arAccountIdA: string;
  let apAccountIdA: string;
  let salesAccountIdA: string;
  let inventoryAccountIdA: string;
  let cashAccountIdA: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });
    await app.ready();

    // 1. Create Pharmacies
    pharmacyAId = generateUuidV7();
    pharmacyBId = generateUuidV7();

    await ctx.db.insert(pharmacies).values([
      {
        id: pharmacyAId,
        name: 'Pharmacy A AR/AP Test',
        code: `PHA-${Date.now()}-A`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: pharmacyBId,
        name: 'Pharmacy B AR/AP Test',
        code: `PHA-${Date.now()}-B`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 2. Create Branches
    branchAId = generateUuidV7();
    branchBId = generateUuidV7();

    await ctx.db.insert(branches).values([
      {
        id: branchAId,
        pharmacyId: pharmacyAId,
        name: 'Branch A1',
        address: 'Karachi Central',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: branchBId,
        pharmacyId: pharmacyBId,
        name: 'Branch B1',
        address: 'Lahore Central',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 2b. Create Counter for Branch A
    counterAId = generateUuidV7();
    await ctx.db.insert(counters).values({
      id: counterAId,
      pharmacyId: pharmacyAId,
      branchId: branchAId,
      name: 'Counter 1',
      code: 'C1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 3. Seed COA
    await seedDefaultChartOfAccounts(ctx.db, pharmacyAId);
    await seedDefaultChartOfAccounts(ctx.db, pharmacyBId);

    const mapA = await getPharmacyAccountMap(ctx.db, pharmacyAId);
    arAccountIdA = mapA.ar;
    apAccountIdA = mapA.ap;
    salesAccountIdA = mapA.sales;
    inventoryAccountIdA = mapA.inventory;
    cashAccountIdA = mapA.cash;

    // 4. Open Fiscal Period for 2026
    await ctx.db.insert(fiscalPeriods).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'open',
    });

    // 5. Create Users & Tokens
    accountantUserAId = generateUuidV7();
    const nowIso = new Date().toISOString();
    await ctx.db.insert(users).values({
      id: accountantUserAId,
      pharmacyId: pharmacyAId,
      name: 'Accountant Tariq',
      role: 'accountant',
      pinHash: 'dummy-hash',
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const ownerUserBId = generateUuidV7();
    await ctx.db.insert(users).values({
      id: ownerUserBId,
      pharmacyId: pharmacyBId,
      name: 'Owner Babar',
      role: 'owner',
      pinHash: 'dummy-hash',
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    accountantTokenA = signUserToken({
      userId: accountantUserAId,
      pharmacyId: pharmacyAId,
      role: 'accountant',
      name: 'Accountant Tariq',
    });

    ownerTokenB = signUserToken({
      userId: ownerUserBId,
      pharmacyId: pharmacyBId,
      role: 'owner',
      name: 'Owner Babar',
    });

    // 6. Create Parties (Customers & Suppliers)
    customer1Id = generateUuidV7();
    customer2Id = generateUuidV7();
    await ctx.db.insert(customers).values([
      {
        id: customer1Id,
        pharmacyId: pharmacyAId,
        name: 'Ahmed Clinic (Credit)',
        phone: '03001234567',
        creditLimitPaisa: 50000000, // 500,000 PKR
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: customer2Id,
        pharmacyId: pharmacyAId,
        name: 'Bilal Medical (Credit)',
        phone: '03129876543',
        creditLimitPaisa: 20000000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    supplier1Id = generateUuidV7();
    supplier2Id = generateUuidV7();
    await ctx.db.insert(suppliers).values([
      {
        id: supplier1Id,
        pharmacyId: pharmacyAId,
        name: 'Global Pharma Distribution',
        contactPerson: 'Mr. Tariq',
        phone: '03211112233',
        paymentTermsDays: 30,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: supplier2Id,
        pharmacyId: pharmacyAId,
        name: 'Sindh Med Supplies',
        contactPerson: 'Ms. Fatima',
        phone: '03334445566',
        paymentTermsDays: 45,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 7. Create Products
    product1Id = generateUuidV7();
    product2Id = generateUuidV7();
    await ctx.db.insert(products).values([
      {
        id: product1Id,
        pharmacyId: pharmacyAId,
        brandName: 'Panadol Extra 500mg',
        genericName: 'Paracetamol',
        mrpPaisa: 3500,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: product2Id,
        pharmacyId: pharmacyAId,
        brandName: 'Augmentin 625mg',
        genericName: 'Amoxicillin Clavulanate',
        mrpPaisa: 38000,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);

    // 8. Create Batches
    batch1Id = generateUuidV7();
    batch2Id = generateUuidV7();
    await ctx.db.insert(batches).values([
      {
        id: batch1Id,
        pharmacyId: pharmacyAId,
        productId: product1Id,
        batchNo: 'B-P1-001',
        expiryDate: '2027-12-31',
        costPaisa: 2500,
        mrpPaisa: 3500,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: batch2Id,
        pharmacyId: pharmacyAId,
        productId: product2Id,
        batchNo: 'B-P2-001',
        expiryDate: '2027-12-31',
        costPaisa: 30000,
        mrpPaisa: 38000,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
    await ctx.cleanup();
  });

  it('calculates aging bucket boundaries with exact days fixtures', async () => {
    // We post credit invoices with specific dates relative to current test date:
    // Reference business date: 2026-11-04
    // 1. Current (0 days old): 2026-11-04 -> 10,000 paisa (Rs. 100)
    // 2. 1-30 days (15 days old): 2026-10-20 -> 20,000 paisa (Rs. 200)
    // 3. 1-30 boundary (30 days old): 2026-10-05 -> 30,000 paisa (Rs. 300)
    // 4. 31-60 boundary (31 days old): 2026-10-04 -> 40,000 paisa (Rs. 400)
    // 5. 31-60 days (45 days old): 2026-09-20 -> 50,000 paisa (Rs. 500)
    // 6. 31-60 boundary (60 days old): 2026-09-05 -> 60,000 paisa (Rs. 600)
    // 7. 61-90 boundary (61 days old): 2026-09-04 -> 70,000 paisa (Rs. 700)
    // 8. 61-90 boundary (90 days old): 2026-08-06 -> 80,000 paisa (Rs. 800)
    // 9. 90+ boundary (91 days old): 2026-08-05 -> 90,000 paisa (Rs. 900)
    // 10. 90+ days (120 days old): 2026-07-07 -> 100,000 paisa (Rs. 1,000)

    const testFixtures = [
      { date: '2026-11-04', amountPaisa: 10000, expectedBucket: 'current' },
      { date: '2026-10-20', amountPaisa: 20000, expectedBucket: 'days1to30' },
      { date: '2026-10-05', amountPaisa: 30000, expectedBucket: 'days1to30' },
      { date: '2026-10-04', amountPaisa: 40000, expectedBucket: 'days31to60' },
      { date: '2026-09-20', amountPaisa: 50000, expectedBucket: 'days31to60' },
      { date: '2026-09-05', amountPaisa: 60000, expectedBucket: 'days31to60' },
      { date: '2026-09-04', amountPaisa: 70000, expectedBucket: 'days61to90' },
      { date: '2026-08-06', amountPaisa: 80000, expectedBucket: 'days61to90' },
      { date: '2026-08-05', amountPaisa: 90000, expectedBucket: 'days90Plus' },
      { date: '2026-07-07', amountPaisa: 100000, expectedBucket: 'days90Plus' },
    ];

    let entryCounter = 100;
    for (const f of testFixtures) {
      entryCounter += 1;
      const invoiceId = generateUuidV7();

      // Post invoice
      await ctx.db.insert(invoices).values({
        id: invoiceId,
        pharmacyId: pharmacyAId,
        counterId: counterAId,
        cashierUserId: accountantUserAId,
        invoiceNumber: `INV-AGING-${entryCounter}`,
        clientRequestId: `req-aging-${entryCounter}`,
        status: 'finalized',
        subtotalPaisa: f.amountPaisa,
        discountPaisa: 0,
        taxPaisa: 0,
        totalPaisa: f.amountPaisa,
        customerId: customer1Id,
        createdAt: `${f.date}T10:00:00.000Z`,
      });

      // Post Journal Entry & Lines using postJournalEntry in a transaction
      await ctx.db.transaction(async (tx) => {
        await postJournalEntry(tx, {
          pharmacyId: pharmacyAId,
          entryDate: f.date,
          sourceType: 'sale',
          sourceId: invoiceId,
          memo: `Credit Sale INV-AGING-${entryCounter}`,
          lines: [
            {
              accountId: arAccountIdA,
              debitPaisa: f.amountPaisa,
              creditPaisa: 0,
              partyType: 'customer',
              partyId: customer1Id,
              memo: `AR debit for INV-AGING-${entryCounter}`,
            },
            {
              accountId: salesAccountIdA,
              debitPaisa: 0,
              creditPaisa: f.amountPaisa,
              memo: `Sales credit`,
            },
          ],
        });
      });
    }

    // Call GET /api/finance/ar/summary (passing asOfDate=2026-11-04)
    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/ar/summary?asOfDate=2026-11-04',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    const aging = body.data.aging;

    // Verify exact bucket sums
    expect(aging.currentPaisa).toBe(10000);
    expect(aging.days1to30Paisa).toBe(20000 + 30000); // 50,000
    expect(aging.days31to60Paisa).toBe(40000 + 50000 + 60000); // 150,000
    expect(aging.days61to90Paisa).toBe(70000 + 80000); // 150,000
    expect(aging.days90PlusPaisa).toBe(90000 + 100000); // 190,000

    const expectedTotal = 10000 + 50000 + 150000 + 150000 + 190000; // 550,000 paisa
    expect(body.data.totalOutstandingPaisa).toBe(expectedTotal);
  });

  it('validates statement balances and running balance calculations for customer and supplier', async () => {
    // Customer 2 transactions:
    // Period: 2026-06-01 to 2026-06-30
    // Prior transaction (2026-05-10): Invoice Rs. 500 (50,000 paisa) -> Opening balance = 50,000
    // During period:
    // 1. 2026-06-05: Credit Sale Invoice Rs. 1,000 (100,000 paisa) -> Debit 100,000 -> Running = 150,000
    // 2. 2026-06-15: Customer Payment Receipt Rs. 800 (80,000 paisa) -> Credit 80,000 -> Running = 70,000
    // 3. 2026-06-20: Credit Note Return Rs. 200 (20,000 paisa) -> Credit 20,000 -> Running = 50,000
    // Expected closing balance = 50,000

    // Prior invoice (Opening Balance)
    await ctx.db.transaction(async (tx) => {
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-05-10',
        sourceType: 'sale',
        memo: 'May Credit Sale',
        lines: [
          {
            accountId: arAccountIdA,
            debitPaisa: 50000,
            creditPaisa: 0,
            partyType: 'customer',
            partyId: customer2Id,
          },
          {
            accountId: salesAccountIdA,
            debitPaisa: 0,
            creditPaisa: 50000,
          },
        ],
      });
    });

    // Period Tx 1: June 5 Invoice
    await ctx.db.transaction(async (tx) => {
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-06-05',
        sourceType: 'sale',
        memo: 'June Credit Sale #INV-1002',
        lines: [
          {
            accountId: arAccountIdA,
            debitPaisa: 100000,
            creditPaisa: 0,
            partyType: 'customer',
            partyId: customer2Id,
          },
          {
            accountId: salesAccountIdA,
            debitPaisa: 0,
            creditPaisa: 100000,
          },
        ],
      });
    });

    // Period Tx 2: June 15 Payment Receipt
    await ctx.db.transaction(async (tx) => {
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-06-15',
        sourceType: 'customer_receipt',
        memo: 'Receipt #RCT-1002',
        lines: [
          {
            accountId: cashAccountIdA,
            debitPaisa: 80000,
            creditPaisa: 0,
          },
          {
            accountId: arAccountIdA,
            debitPaisa: 0,
            creditPaisa: 80000,
            partyType: 'customer',
            partyId: customer2Id,
          },
        ],
      });
    });

    // Period Tx 3: June 20 Credit Note Return
    await ctx.db.transaction(async (tx) => {
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-06-20',
        sourceType: 'credit_note',
        memo: 'Credit Note #CRN-1002',
        lines: [
          {
            accountId: salesAccountIdA,
            debitPaisa: 20000,
            creditPaisa: 0,
          },
          {
            accountId: arAccountIdA,
            debitPaisa: 0,
            creditPaisa: 20000,
            partyType: 'customer',
            partyId: customer2Id,
          },
        ],
      });
    });

    // Query Customer Statement
    const stmtRes = await app.inject({
      method: 'GET',
      url: `/api/finance/ar/statement/${customer2Id}?startDate=2026-06-01&endDate=2026-06-30`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(stmtRes.statusCode).toBe(200);
    const stmt = stmtRes.json().data;

    expect(stmt.openingBalancePaisa).toBe(50000);
    expect(stmt.totalDebitsPaisa).toBe(100000);
    expect(stmt.totalCreditsPaisa).toBe(100000); // 80,000 + 20,000
    expect(stmt.closingBalancePaisa).toBe(50000); // 50,000 + 100,000 - 100,000

    expect(stmt.lines.length).toBe(3);
    expect(stmt.lines[0].runningBalancePaisa).toBe(150000);
    expect(stmt.lines[1].runningBalancePaisa).toBe(70000);
    expect(stmt.lines[2].runningBalancePaisa).toBe(50000);
  });

  it('guarantees control accounts equal the sum of party balances (reconciliation equals zero)', async () => {
    // 1. Supplier 1 & 2 AP transactions
    // Supplier 1: Purchase received Rs. 2,000 (200,000 paisa)
    await ctx.db.transaction(async (tx) => {
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-11-01',
        sourceType: 'purchase',
        memo: 'Purchase GRN #PO-401',
        lines: [
          {
            accountId: inventoryAccountIdA,
            debitPaisa: 200000,
            creditPaisa: 0,
          },
          {
            accountId: apAccountIdA,
            debitPaisa: 0,
            creditPaisa: 200000,
            partyType: 'supplier',
            partyId: supplier1Id,
          },
        ],
      });
    });

    // Supplier 1 payment of Rs. 500 (50,000 paisa)
    await ctx.db.transaction(async (tx) => {
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-11-02',
        sourceType: 'supplier_payment',
        memo: 'Payment #PAY-402',
        lines: [
          {
            accountId: apAccountIdA,
            debitPaisa: 50000,
            creditPaisa: 0,
            partyType: 'supplier',
            partyId: supplier1Id,
          },
          {
            accountId: cashAccountIdA,
            debitPaisa: 0,
            creditPaisa: 50000,
          },
        ],
      });
    });

    // Supplier 2: Purchase received Rs. 3,000 (300,000 paisa)
    await ctx.db.transaction(async (tx) => {
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-11-03',
        sourceType: 'purchase',
        memo: 'Purchase GRN #PO-403',
        lines: [
          {
            accountId: inventoryAccountIdA,
            debitPaisa: 300000,
            creditPaisa: 0,
          },
          {
            accountId: apAccountIdA,
            debitPaisa: 0,
            creditPaisa: 300000,
            partyType: 'supplier',
            partyId: supplier2Id,
          },
        ],
      });
    });

    // Verify AP Summary & Reconciliation
    const apRes = await app.inject({
      method: 'GET',
      url: '/api/finance/ap/summary',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(apRes.statusCode).toBe(200);
    const apData = apRes.json().data;

    // Supplier 1 balance = 200,000 - 50,000 = 150,000
    // Supplier 2 balance = 300,000
    // Total = 450,000
    expect(apData.totalOutstandingPaisa).toBe(450000);
    expect(apData.reconciliation.controlAccountBalancePaisa).toBe(450000);
    expect(apData.reconciliation.sumOfPartyBalancesPaisa).toBe(450000);
    expect(apData.reconciliation.differencePaisa).toBe(0);
    expect(apData.reconciliation.isReconciled).toBe(true);

    // Verify AR Summary & Reconciliation
    const arRes = await app.inject({
      method: 'GET',
      url: '/api/finance/ar/summary',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(arRes.statusCode).toBe(200);
    const arData = arRes.json().data;
    expect(arData.reconciliation.differencePaisa).toBe(0);
    expect(arData.reconciliation.isReconciled).toBe(true);
  });

  it('supports AR by product breakdown across open credit invoices', async () => {
    // Attach invoice lines to a credit invoice for Customer 1
    const invoiceId = generateUuidV7();
    await ctx.db.insert(invoices).values({
      id: invoiceId,
      pharmacyId: pharmacyAId,
      counterId: counterAId,
      cashierUserId: accountantUserAId,
      invoiceNumber: `INV-PROD-TEST`,
      clientRequestId: `req-prod-test`,
      status: 'finalized',
      subtotalPaisa: 73000,
      discountPaisa: 0,
      taxPaisa: 0,
      totalPaisa: 73000,
      customerId: customer1Id,
      createdAt: '2026-11-04T12:00:00.000Z',
    });

    await ctx.db.insert(invoiceLines).values([
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyAId,
        invoiceId,
        productId: product1Id,
        batchId: batch1Id,
        quantity: 10,
        unitPricePaisa: 3500,
        lineTotalPaisa: 35000,
        taxPaisa: 0,
      },
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyAId,
        invoiceId,
        productId: product2Id,
        batchId: batch2Id,
        quantity: 1,
        unitPricePaisa: 38000,
        lineTotalPaisa: 38000,
        taxPaisa: 0,
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/ar/products',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.products)).toBe(true);

    const panadol = body.data.products.find(
      (p: { productId: string }) => p.productId === product1Id
    );
    expect(panadol).toBeDefined();
    expect(panadol.unitsOnCredit).toBe(10);
    expect(panadol.receivablePaisa).toBe(35000);
  });

  it('supports logging and viewing payment reminders', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/finance/ar/reminders',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        partyType: 'customer',
        partyId: customer1Id,
        channel: 'whatsapp',
        recipient: '03001234567',
        message: 'Dear Ahmed Clinic, your invoice is overdue. Kindly clear balance.',
        amountPaisa: 550000,
        daysOverdue: 45,
      },
    });

    expect(postRes.statusCode).toBe(200);
    expect(postRes.json().success).toBe(true);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/finance/ar/reminders',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(getRes.statusCode).toBe(200);
    const reminders = getRes.json().data.reminders;
    expect(reminders.length).toBeGreaterThanOrEqual(1);
    expect(reminders[0].partyName).toBe('Ahmed Clinic (Credit)');
    expect(reminders[0].channel).toBe('whatsapp');
  });

  it('enforces cross-tenant isolation on AR and AP routes', async () => {
    // Pharmacy B attempts to view Pharmacy A's customer statement -> 404
    const res = await app.inject({
      method: 'GET',
      url: `/api/finance/ar/statement/${customer1Id}`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(res.statusCode).toBe(404);

    // Pharmacy B summary does not include Pharmacy A data
    const summaryB = await app.inject({
      method: 'GET',
      url: '/api/finance/ar/summary',
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(summaryB.statusCode).toBe(200);
    expect(summaryB.json().data.totalOutstandingPaisa).toBe(0);
  });
});
