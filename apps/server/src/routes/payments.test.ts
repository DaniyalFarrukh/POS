import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { generateUuidV7, getKarachiBusinessDate } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import {
  pharmacies,
  branches,
  customers,
  suppliers,
  invoices,
  users,
  journalEntries,
  journalLines,
  fiscalPeriods,
  erpPayments,
  counters,
} from '../db/schema';
import { seedDefaultChartOfAccounts, getPharmacyAccountMap } from '../ledger/coa-seed';
import { signUserToken } from '../auth/jwt';
import { postJournalEntry } from '../ledger/service';

describe('ERP Payments Module (Customer Receipts & Supplier Payments)', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchA1Id: string;
  let branchB1Id: string;
  let counterA1Id: string;

  let ownerTokenA: string;
  let managerTokenA: string;
  let accountantTokenA: string;
  let pharmacistTokenA: string;
  let cashierTokenA: string;
  let ownerTokenB: string;

  let customer1Id: string;
  let supplier1Id: string;

  let invoice1Id: string; // Credit Invoice 1: 50,000 paisa
  let invoice2Id: string; // Credit Invoice 2: 30,000 paisa
  let purchaseBill1Id: string; // Purchase Bill: 100,000 paisa

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
      name: 'Central Pharmacy A',
      code: 'CPHA',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    pharmacyBId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyBId,
      name: 'Pharmacy B',
      code: 'CPHB',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 2. Branches & Counters
    branchA1Id = generateUuidV7();
    await db.insert(branches).values({
      id: branchA1Id,
      pharmacyId: pharmacyAId,
      name: 'Main Branch A1',
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

    counterA1Id = generateUuidV7();
    await db.insert(counters).values({
      id: counterA1Id,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      name: 'Counter 1',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // Seed COA & Fiscal Periods
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

    // Users & Roles
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

    // Customer
    customer1Id = generateUuidV7();
    await db.insert(customers).values({
      id: customer1Id,
      pharmacyId: pharmacyAId,
      name: 'Dr. Zafar Hospital Account',
      phone: '03211234567',
      creditLimitPaisa: 500000,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // Supplier
    supplier1Id = generateUuidV7();
    await db.insert(suppliers).values({
      id: supplier1Id,
      pharmacyId: pharmacyAId,
      name: 'Apex Pharma Distributors',
      phone: '03009876543',
      paymentTermsDays: 30,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const accountMap = await getPharmacyAccountMap(db, pharmacyAId);

    // Initial Credit Invoices for Customer 1
    invoice1Id = generateUuidV7();
    await db.insert(invoices).values({
      id: invoice1Id,
      pharmacyId: pharmacyAId,
      counterId: counterA1Id,
      cashierUserId: cashAId,
      customerId: customer1Id,
      invoiceNumber: 'INV-CR-001',
      clientRequestId: generateUuidV7(),
      status: 'finalized',
      subtotalPaisa: 50000,
      discountPaisa: 0,
      taxPaisa: 0,
      totalPaisa: 50000,
      createdAt: nowIso,
    });

    invoice2Id = generateUuidV7();
    await db.insert(invoices).values({
      id: invoice2Id,
      pharmacyId: pharmacyAId,
      counterId: counterA1Id,
      cashierUserId: cashAId,
      customerId: customer1Id,
      invoiceNumber: 'INV-CR-002',
      clientRequestId: generateUuidV7(),
      status: 'finalized',
      subtotalPaisa: 30000,
      discountPaisa: 0,
      taxPaisa: 0,
      totalPaisa: 30000,
      createdAt: nowIso,
    });

    // Initial journal entry for credit sale: Dr 1100 AR = 80,000, Cr 4000 Sales = 80,000
    await db.transaction(async (tx) => {
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: nowIso.slice(0, 10),
        sourceType: 'invoice.created',
        sourceId: invoice1Id,
        memo: 'Credit Sale INV-CR-001 & INV-CR-002',
        createdBy: ownerAId,
        lines: [
          {
            accountId: accountMap.ar,
            debitPaisa: 80000,
            creditPaisa: 0,
            branchId: branchA1Id,
            partyType: 'customer',
            partyId: customer1Id,
            memo: 'Accounts receivable balance for Dr. Zafar',
          },
          {
            accountId: accountMap.sales,
            debitPaisa: 0,
            creditPaisa: 80000,
            branchId: branchA1Id,
            memo: 'Credit sales revenue',
          },
        ],
      });
    });

    // Initial Purchase Bill for Supplier 1 (AP = 100,000)
    purchaseBill1Id = generateUuidV7();
    await db.transaction(async (tx) => {
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: nowIso.slice(0, 10),
        sourceType: 'purchase.received',
        sourceId: purchaseBill1Id,
        memo: 'Purchase GRN-APEX-101',
        createdBy: ownerAId,
        lines: [
          {
            accountId: accountMap.inventory,
            debitPaisa: 100000,
            creditPaisa: 0,
            branchId: branchA1Id,
            memo: 'Inventory received',
          },
          {
            accountId: accountMap.ap,
            debitPaisa: 0,
            creditPaisa: 100000,
            branchId: branchA1Id,
            partyType: 'supplier',
            partyId: supplier1Id,
            memo: 'Accounts payable balance for Apex Pharma',
          },
        ],
      });
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.cleanup();
  });

  it('GET /api/finance/payments/unpaid-documents returns open credit invoices for customer and bills for supplier', async () => {
    // 1. Customer unpaid documents
    const custRes = await app.inject({
      method: 'GET',
      url: `/api/finance/payments/unpaid-documents?partyType=customer&partyId=${customer1Id}`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(custRes.statusCode).toBe(200);
    const custDocs = custRes.json().data.documents;
    expect(custDocs).toHaveLength(2);
    expect(custDocs[0].totalPaisa).toBe(50000);
    expect(custDocs[0].balanceDuePaisa).toBe(50000);
    expect(custDocs[1].totalPaisa).toBe(30000);
    expect(custDocs[1].balanceDuePaisa).toBe(30000);

    // 2. Supplier unpaid documents
    const supRes = await app.inject({
      method: 'GET',
      url: `/api/finance/payments/unpaid-documents?partyType=supplier&partyId=${supplier1Id}`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(supRes.statusCode).toBe(200);
    const supDocs = supRes.json().data.documents;
    expect(supDocs).toHaveLength(1);
    expect(supDocs[0].totalPaisa).toBe(100000);
    expect(supDocs[0].balanceDuePaisa).toBe(100000);
  });

  it('POST /api/finance/payments records customer receipt with multi-document allocation and overpayment as advance', async () => {
    // Customer pays Rs. 900.00 (90,000 paisa) via Mobile Wallet
    // Outstanding invoices: INV-CR-001 (50,000), INV-CR-002 (30,000) = 80,000
    // Allocation:
    // - INV-CR-001: 50,000 (paid in full)
    // - INV-CR-002: 30,000 (paid in full)
    // - Overpayment / Advance: 10,000 paisa becomes a Customer Advance!
    const res = await app.inject({
      method: 'POST',
      url: '/api/finance/payments',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        branchId: branchA1Id,
        direction: 'receipt',
        partyType: 'customer',
        partyId: customer1Id,
        method: 'wallet',
        amountPaisa: 90000,
        paymentDate: getKarachiBusinessDate(),
        notes: 'Monthly clinic bill settlement + advance',
        allocations: [
          {
            documentType: 'invoice',
            documentId: invoice1Id,
            documentNumber: 'INV-CR-001',
            allocatedPaisa: 50000,
          },
          {
            documentType: 'invoice',
            documentId: invoice2Id,
            documentNumber: 'INV-CR-002',
            allocatedPaisa: 30000,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const payment = res.json().data;
    expect(payment.paymentNumber).toMatch(/^RCP-/);
    expect(payment.amountPaisa).toBe(90000);
    expect(payment.allocatedPaisa).toBe(80000);
    expect(payment.advancePaisa).toBe(10000); // 90,000 - 80,000 = 10,000 advance!
    expect(payment.allocations).toHaveLength(2);

    // Verify Balanced GL Posting:
    // Dr 1020 Mobile Wallets = 90,000
    // Cr 1100 Accounts Receivable = 80,000 (Dr. Zafar)
    // Cr 2400 Customer Advances = 10,000 (Dr. Zafar)
    const lines = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, payment.journalEntryId));
    expect(lines).toHaveLength(3);

    const accountMap = await getPharmacyAccountMap(ctx.db, pharmacyAId);
    const drWallet = lines.find((l) => l.accountId === accountMap.wallet);
    const crAR = lines.find((l) => l.accountId === accountMap.ar);
    const crAdv = lines.find((l) => l.accountId === accountMap.customer_advances);

    expect(drWallet!.debitPaisa).toBe(90000);
    expect(drWallet!.creditPaisa).toBe(0);

    expect(crAR!.debitPaisa).toBe(0);
    expect(crAR!.creditPaisa).toBe(80000);
    expect(crAR!.partyType).toBe('customer');
    expect(crAR!.partyId).toBe(customer1Id);

    expect(crAdv!.debitPaisa).toBe(0);
    expect(crAdv!.creditPaisa).toBe(10000);
    expect(crAdv!.partyType).toBe('customer');
    expect(crAdv!.partyId).toBe(customer1Id);

    // Re-checking unpaid documents must now show 0 remaining balance on both invoices
    const recheckRes = await app.inject({
      method: 'GET',
      url: `/api/finance/payments/unpaid-documents?partyType=customer&partyId=${customer1Id}`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(recheckRes.statusCode).toBe(200);
    const remainingDocs = recheckRes.json().data.documents;
    expect(remainingDocs).toHaveLength(0);
  });

  it('POST /api/finance/payments records supplier partial payment and tracks remaining payable balance', async () => {
    // Supplier bill is 100,000 paisa. Pay 60,000 paisa via Bank Transfer.
    const res = await app.inject({
      method: 'POST',
      url: '/api/finance/payments',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        branchId: branchA1Id,
        direction: 'payment',
        partyType: 'supplier',
        partyId: supplier1Id,
        method: 'bank',
        amountPaisa: 60000,
        paymentDate: getKarachiBusinessDate(),
        notes: 'Partial payment against GRN-APEX-101',
        allocations: [
          {
            documentType: 'purchase',
            documentId: purchaseBill1Id,
            documentNumber: 'GRN-APEX-101',
            allocatedPaisa: 60000,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const payment = res.json().data;
    expect(payment.paymentNumber).toMatch(/^PMT-/);
    expect(payment.allocatedPaisa).toBe(60000);
    expect(payment.advancePaisa).toBe(0);

    // Verify GL Posting:
    // Dr 2000 AP = 60,000
    // Cr 1010 Bank = 60,000
    const lines = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, payment.journalEntryId));
    expect(lines).toHaveLength(2);

    const accountMap = await getPharmacyAccountMap(ctx.db, pharmacyAId);
    const drAP = lines.find((l) => l.accountId === accountMap.ap);
    const crBank = lines.find((l) => l.accountId === accountMap.bank);

    expect(drAP!.debitPaisa).toBe(60000);
    expect(drAP!.creditPaisa).toBe(0);
    expect(drAP!.partyType).toBe('supplier');
    expect(drAP!.partyId).toBe(supplier1Id);

    expect(crBank!.debitPaisa).toBe(0);
    expect(crBank!.creditPaisa).toBe(60000);

    // Recheck unpaid documents: remaining balance due must be 40,000 paisa
    const recheckRes = await app.inject({
      method: 'GET',
      url: `/api/finance/payments/unpaid-documents?partyType=supplier&partyId=${supplier1Id}`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(recheckRes.statusCode).toBe(200);
    const remainingDocs = recheckRes.json().data.documents;
    expect(remainingDocs).toHaveLength(1);
    expect(remainingDocs[0].allocatedPaisa).toBe(60000);
    expect(remainingDocs[0].balanceDuePaisa).toBe(40000);
  });

  it('manages cheque lifecycle: pending -> cleared, and cheque bounce creates immutable reversal journal entry', async () => {
    // 1. Issue cheque for remaining 40,000 paisa to Apex Pharma
    const chequeRes = await app.inject({
      method: 'POST',
      url: '/api/finance/payments',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        branchId: branchA1Id,
        direction: 'payment',
        partyType: 'supplier',
        partyId: supplier1Id,
        method: 'cheque',
        amountPaisa: 40000,
        paymentDate: getKarachiBusinessDate(),
        chequeNumber: 'CHQ-882211',
        chequeDate: getKarachiBusinessDate(),
        bankName: 'Meezan Bank Ltd',
        chequeStatus: 'pending',
        notes: 'Post-dated clearing cheque',
        allocations: [
          {
            documentType: 'purchase',
            documentId: purchaseBill1Id,
            documentNumber: 'GRN-APEX-101',
            allocatedPaisa: 40000,
          },
        ],
      },
    });

    expect(chequeRes.statusCode).toBe(201);
    const chequePayment = chequeRes.json().data;
    expect(chequePayment.method).toBe('cheque');
    expect(chequePayment.chequeStatus).toBe('pending');
    expect(chequePayment.chequeNumber).toBe('CHQ-882211');

    // 2. Mark Cheque Cleared
    const clearRes = await app.inject({
      method: 'POST',
      url: `/api/finance/payments/${chequePayment.id}/clear-cheque`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(clearRes.statusCode).toBe(200);
    expect(clearRes.json().data.chequeStatus).toBe('cleared');

    // 3. Mark Cheque Bounced -> triggers reversal!
    const bounceRes = await app.inject({
      method: 'POST',
      url: `/api/finance/payments/${chequePayment.id}/bounce-cheque`,
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        bounceReason: 'Signature mismatch / Insufficient balance',
      },
    });
    expect(bounceRes.statusCode).toBe(200);
    const bouncedPayment = bounceRes.json().data;
    expect(bouncedPayment.chequeStatus).toBe('bounced');
    expect(bouncedPayment.status).toBe('reversed');
    expect(bouncedPayment.bounceReason).toContain('Signature mismatch');
    expect(bouncedPayment.reversalEntryId).toBeDefined();

    // Verify reversing journal entry exists in DB
    const [revEntry] = await ctx.db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, bouncedPayment.reversalEntryId));
    expect(revEntry).toBeDefined();
    expect(revEntry!.reversesEntryId).toBe(chequePayment.journalEntryId);

    // Verify original document is re-opened (bill has 40,000 balance due again!)
    const recheckRes = await app.inject({
      method: 'GET',
      url: `/api/finance/payments/unpaid-documents?partyType=supplier&partyId=${supplier1Id}`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(recheckRes.statusCode).toBe(200);
    const remainingDocs = recheckRes.json().data.documents;
    expect(remainingDocs).toHaveLength(1);
    expect(remainingDocs[0].balanceDuePaisa).toBe(40000);
  });

  it('GET /api/finance/payments returns paginated list with KPI metrics and cheque register filtering', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/finance/payments?page=1&pageSize=10',
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json();
    expect(body.success).toBe(true);

    const kpis = body.data.kpis;
    expect(kpis.totalReceiptsPaisa).toBeGreaterThan(0);
    expect(kpis.totalPaymentsPaisa).toBeGreaterThan(0);
    expect(kpis.netCashFlowPaisa).toBeDefined();

    // Filter by cheque register (method=cheque)
    const chqRes = await app.inject({
      method: 'GET',
      url: '/api/finance/payments?method=cheque',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(chqRes.statusCode).toBe(200);
    const chqItems = chqRes.json().data.items;
    expect(chqItems.length).toBeGreaterThanOrEqual(1);
    expect(chqItems[0].method).toBe('cheque');
  });

  it('enforces role permissions: cashier and pharmacist cannot access payments (403 Forbidden)', async () => {
    // Cashier attempt -> 403 Forbidden
    const cashierRes = await app.inject({
      method: 'GET',
      url: '/api/finance/payments',
      headers: { authorization: `Bearer ${cashierTokenA}` },
    });
    expect(cashierRes.statusCode).toBe(403);

    // Pharmacist attempt -> 403 Forbidden
    const pharmRes = await app.inject({
      method: 'POST',
      url: '/api/finance/payments',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: { amountPaisa: 1000 },
    });
    expect(pharmRes.statusCode).toBe(403);
  });

  it('enforces tenant isolation: Pharmacy B cannot view or reverse Pharmacy A payments', async () => {
    // 1. Fetch Pharmacy A payment
    const [pA] = await ctx.db
      .select()
      .from(erpPayments)
      .where(eq(erpPayments.pharmacyId, pharmacyAId))
      .limit(1);
    expect(pA).toBeDefined();

    // 2. Pharmacy B attempts to view Pharmacy A payment
    const viewRes = await app.inject({
      method: 'GET',
      url: `/api/finance/payments/${pA!.id}`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(viewRes.statusCode).toBe(404);

    // 3. Pharmacy B attempts to reverse Pharmacy A payment
    const revRes = await app.inject({
      method: 'POST',
      url: `/api/finance/payments/${pA!.id}/reverse`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
      payload: { reversalReason: 'Cross tenant attempt' },
    });
    expect(revRes.statusCode).toBe(404);
  });

  it('rejects non-positive payment amount (0 or negative) with HTTP 400 (Kills M-09)', async () => {
    const zeroRes = await app.inject({
      method: 'POST',
      url: '/api/finance/payments',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        direction: 'receipt',
        partyType: 'customer',
        partyId: customer1Id,
        method: 'cash',
        amountPaisa: 0,
        paymentDate: getKarachiBusinessDate(),
      },
    });
    expect(zeroRes.statusCode).toBe(400);

    const negRes = await app.inject({
      method: 'POST',
      url: '/api/finance/payments',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        direction: 'receipt',
        partyType: 'customer',
        partyId: customer1Id,
        method: 'cash',
        amountPaisa: -500,
        paymentDate: getKarachiBusinessDate(),
      },
    });
    expect(negRes.statusCode).toBe(400);
  });
});
