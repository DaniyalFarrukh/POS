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
  invoices,
  invoiceLines,
  products,
  batches,
  creditNotes,
  erpPayments,
} from '../db/schema';
import { seedDefaultChartOfAccounts } from '../ledger/coa-seed';
import { signUserToken } from '../auth/jwt';

describe('ERP Sales Ledger Module (Phase 8)', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  // Tenant A
  let pharmacyAId: string;
  let branchA1Id: string;
  let branchA2Id: string;
  let counterA1Id: string;
  let accountantUserAId: string;
  let accountantTokenA: string;
  let cashierUser1Id: string;
  let cashierUser2Id: string;
  let customer1Id: string;
  let customer2Id: string;
  let productId: string;
  let batchId: string;

  // Tenant B
  let pharmacyBId: string;
  let ownerTokenB: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = await buildApp({ db: ctx.db });
    await app.ready();

    pharmacyAId = generateUuidV7();
    pharmacyBId = generateUuidV7();

    // 1. Create Pharmacies
    await ctx.db.insert(pharmacies).values([
      {
        id: pharmacyAId,
        name: 'Care Plus Pharmacy (Sales Ledger)',
        code: 'CPP',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: pharmacyBId,
        name: 'Alpha Pharmacy (Tenant B)',
        code: 'APB',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 2. Branches
    branchA1Id = generateUuidV7();
    branchA2Id = generateUuidV7();
    await ctx.db.insert(branches).values([
      {
        id: branchA1Id,
        pharmacyId: pharmacyAId,
        name: 'Branch Saddar',
        address: 'Saddar Karachi',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: branchA2Id,
        pharmacyId: pharmacyAId,
        name: 'Branch Clifton',
        address: 'Clifton Karachi',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    counterA1Id = generateUuidV7();
    await ctx.db.insert(counters).values({
      id: counterA1Id,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      code: 'CTR-SD-01',
      name: 'Counter 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 3. Seed Chart of Accounts
    await seedDefaultChartOfAccounts(ctx.db, pharmacyAId);
    await seedDefaultChartOfAccounts(ctx.db, pharmacyBId);

    // 4. Users
    accountantUserAId = generateUuidV7();
    cashierUser1Id = generateUuidV7();
    cashierUser2Id = generateUuidV7();
    const ownerUserBId = generateUuidV7();

    await ctx.db.insert(users).values([
      {
        id: accountantUserAId,
        pharmacyId: pharmacyAId,
        name: 'Accountant Tariq',
        role: 'accountant' as const,
        pinHash: 'dummy',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: cashierUser1Id,
        pharmacyId: pharmacyAId,
        name: 'Kamran Cashier',
        role: 'cashier' as const,
        pinHash: 'dummy',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: cashierUser2Id,
        pharmacyId: pharmacyAId,
        name: 'Asif Cashier',
        role: 'cashier' as const,
        pinHash: 'dummy',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: ownerUserBId,
        pharmacyId: pharmacyBId,
        name: 'Owner B',
        role: 'owner' as const,
        pinHash: 'dummy',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

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
      name: 'Owner B',
    });

    // 5. Customers
    customer1Id = generateUuidV7();
    customer2Id = generateUuidV7();
    await ctx.db.insert(customers).values([
      {
        id: customer1Id,
        pharmacyId: pharmacyAId,
        name: 'Dr. Zafar Clinic',
        phone: '03001112233',
        creditLimitPaisa: 10000000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: customer2Id,
        pharmacyId: pharmacyAId,
        name: 'Rashid Khan (Credit)',
        phone: '03124445566',
        creditLimitPaisa: 5000000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 6. Products & Batches
    productId = generateUuidV7();
    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId: pharmacyAId,
      brandName: 'Augmentin 625mg Tab',
      mrpPaisa: 45000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    batchId = generateUuidV7();
    await ctx.db.insert(batches).values({
      id: batchId,
      pharmacyId: pharmacyAId,
      productId,
      batchNo: 'BCH-AUG-01',
      expiryDate: '2027-12-31',
      costPaisa: 30000,
      mrpPaisa: 45000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 7. Insert Invoices (Sales)
    const inv1Id = generateUuidV7();
    const inv2Id = generateUuidV7();

    await ctx.db.insert(invoices).values([
      {
        id: inv1Id,
        pharmacyId: pharmacyAId,
        counterId: counterA1Id,
        cashierUserId: cashierUser1Id,
        customerId: customer1Id,
        invoiceNumber: 'INV-202611-001',
        clientRequestId: 'req-inv-001',
        subtotalPaisa: 90000,
        discountPaisa: 5000,
        taxPaisa: 0,
        totalPaisa: 85000, // 850 PKR
        status: 'completed',
        createdAt: '2026-11-03T10:00:00.000Z',
      },
      {
        id: inv2Id,
        pharmacyId: pharmacyAId,
        counterId: counterA1Id,
        cashierUserId: cashierUser2Id,
        customerId: customer2Id,
        invoiceNumber: 'INV-202611-002',
        clientRequestId: 'req-inv-002',
        subtotalPaisa: 150000,
        discountPaisa: 0,
        taxPaisa: 0,
        totalPaisa: 150000, // 1,500 PKR
        status: 'completed',
        createdAt: '2026-11-04T12:00:00.000Z',
      },
    ]);

    await ctx.db.insert(invoiceLines).values([
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyAId,
        invoiceId: inv1Id,
        productId,
        batchId,
        quantity: 2,
        unitPricePaisa: 45000,
        lineTotalPaisa: 90000,
      },
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyAId,
        invoiceId: inv2Id,
        productId,
        batchId,
        quantity: 3,
        unitPricePaisa: 50000,
        lineTotalPaisa: 150000,
      },
    ]);

    // 8. Insert Credit Note (Sales Return)
    const returnId = generateUuidV7();
    await ctx.db.insert(creditNotes).values({
      id: returnId,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      counterId: counterA1Id,
      cashierUserId: cashierUser1Id,
      originalInvoiceId: inv1Id,
      creditNoteNumber: 'CRN-202611-001',
      clientRequestId: 'req-crn-001',
      subtotalPaisa: 45000,
      taxPaisa: 0,
      totalPaisa: 45000, // 450 PKR return
      reason: 'Wrong dosage requested by patient',
      createdAt: '2026-11-04T15:00:00.000Z',
    });

    // 9. Insert Customer Receipt (Credit settlement)
    await ctx.db.insert(erpPayments).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      paymentNumber: 'REC-202611-001',
      paymentDate: '2026-11-05',
      direction: 'receipt',
      partyType: 'customer',
      partyId: customer1Id,
      method: 'cash',
      amountPaisa: 40000, // 400 PKR paid
      status: 'posted',
      createdBy: cashierUser1Id,
      createdAt: '2026-11-05T09:00:00.000Z',
      updatedAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await app.close();
    await ctx.cleanup();
  });

  it('1. fetches chronological sales ledger aggregating sales, returns, and customer receipts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/sales-ledger?startDate=2026-11-01&endDate=2026-11-05',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    const { summary, entries } = body.data;

    // Check Summary KPIs
    expect(summary.totalGrossSalesPaisa).toBe(85000 + 150000); // 235,000 paisa
    expect(summary.totalReturnsPaisa).toBe(45000); // 45,000 paisa
    expect(summary.totalReceiptsPaisa).toBe(40000); // 40,000 paisa
    expect(summary.netSalesPaisa).toBe(235000 - 45000); // 190,000 paisa
    expect(summary.totalCount).toBe(4); // 2 sales, 1 return, 1 receipt

    // Check Entries
    expect(entries.length).toBe(4);
    // Chronological order verification
    expect(entries[0].documentNumber).toBe('INV-202611-001');
    expect(entries[0].type).toBe('sale');
    expect(entries[0].netPaisa).toBe(85000);

    const retEntry = entries.find((e: { type: string }) => e.type === 'return');
    expect(retEntry).toBeDefined();
    expect(retEntry.documentNumber).toBe('CRN-202611-001');
    expect(retEntry.netPaisa).toBe(-45000);

    const recEntry = entries.find((e: { type: string }) => e.type === 'receipt');
    expect(recEntry).toBeDefined();
    expect(recEntry.documentNumber).toBe('REC-202611-001');
    expect(recEntry.netPaisa).toBe(40000);
  });

  it('2. filters sales ledger by cashier', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/finance/sales-ledger?cashierUserId=${cashierUser2Id}`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.entries.length).toBe(1);
    expect(body.data.entries[0].documentNumber).toBe('INV-202611-002');
  });

  it('3. filters sales ledger by customer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/finance/sales-ledger?customerId=${customer1Id}`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    // Should include INV-001, CRN-001, and REC-001 (all for customer 1)
    expect(body.data.entries.length).toBe(3);
    for (const e of body.data.entries) {
      expect(e.partyId).toBe(customer1Id);
    }
  });

  it('4. filters sales ledger by document type (sales only vs returns only)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/sales-ledger?type=return',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.entries.length).toBe(1);
    expect(body.data.entries[0].type).toBe('return');
    expect(body.data.entries[0].documentNumber).toBe('CRN-202611-001');
  });

  it('5. enforces tenant isolation: Tenant B sees zero records from Tenant A', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/sales-ledger',
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.entries.length).toBe(0);
    expect(body.data.summary.totalGrossSalesPaisa).toBe(0);
  });

  it('6. F-H-08: includes finalized POS invoices (standard desktop status) in sales ledger', async () => {
    const finalizedInvId = generateUuidV7();
    await ctx.db.insert(invoices).values({
      id: finalizedInvId,
      pharmacyId: pharmacyAId,
      counterId: counterA1Id,
      cashierUserId: cashierUser1Id,
      customerId: customer1Id,
      invoiceNumber: 'INV-202611-FINALIZED',
      clientRequestId: 'req-inv-fin-001',
      subtotalPaisa: 50000,
      discountPaisa: 0,
      taxPaisa: 0,
      totalPaisa: 50000,
      status: 'finalized',
      createdAt: '2026-11-05T10:00:00.000Z',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/sales-ledger?type=sale',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    const found = body.data.entries.find(
      (e: { documentNumber: string; grossPaisa: number }) =>
        e.documentNumber === 'INV-202611-FINALIZED'
    );
    expect(found).toBeDefined();
    expect(found?.grossPaisa).toBe(50000);
  });
});
