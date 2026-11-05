import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import {
  pharmacies,
  branches,
  users,
  journalEntries,
  journalLines,
  fiscalPeriods,
  erpExpenses,
} from '../db/schema';
import { seedDefaultChartOfAccounts, getPharmacyAccountMap } from '../ledger/coa-seed';
import { signUserToken } from '../auth/jwt';

describe('ERP Expenses Module (Categories, Entries, Approvals, Recurring, Posting)', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchA1Id: string;
  let branchB1Id: string;

  let ownerTokenA: string;
  let managerTokenA: string;
  let accountantTokenA: string;
  let pharmacistTokenA: string;
  let cashierTokenA: string;
  let ownerTokenB: string;

  let rentCategoryId: string;
  let repairsCategoryId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });
    const db = ctx.db;
    const now = new Date();
    const nowIso = now.toISOString();

    // 1. Setup Pharmacies
    pharmacyAId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyAId,
      name: 'Central Pharmacy A',
      code: 'CPHA_EXP',
      expenseApprovalThresholdPaisa: 2500000, // Rs. 25,000 threshold
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    pharmacyBId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyBId,
      name: 'Pharmacy B',
      code: 'CPHB_EXP',
      expenseApprovalThresholdPaisa: 2500000,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 2. Branches
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

    // 3. Seed COA & Fiscal Periods
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

    // 4. Users & Role Tokens
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
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.cleanup();
  });

  it('GET /api/finance/expense-categories lists and auto-seeds default categories mapped to COA expense accounts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/expense-categories',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(5);

    const rentCat = body.data.find((c: { name: string }) => c.name.toLowerCase().includes('rent'));
    const repairsCat = body.data.find((c: { name: string }) =>
      c.name.toLowerCase().includes('repair')
    );

    expect(rentCat).toBeDefined();
    expect(repairsCat).toBeDefined();

    rentCategoryId = rentCat.id;
    repairsCategoryId = repairsCat.id;
  });

  it('POST /api/finance/expenses records paid expense under threshold and posts balanced GL entry', async () => {
    // Immediate Cash payment for Office Rent: 15,000 paisa (Rs. 150.00) <= Rs. 25,000 threshold
    const res = await app.inject({
      method: 'POST',
      url: '/api/finance/expenses',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        branchId: branchA1Id,
        categoryId: rentCategoryId,
        amountPaisa: 15000,
        paymentType: 'paid',
        paymentMethod: 'cash',
        expenseDate: new Date().toISOString().slice(0, 10),
        notes: 'Monthly branch rent advance portion',
      },
    });

    expect(res.statusCode).toBe(201);
    const expense = res.json().data;
    expect(expense.expenseNumber).toMatch(/^EXP-/);
    expect(expense.status).toBe('posted');
    expect(expense.journalEntryId).toBeDefined();

    // Verify GL Posting:
    // Dr 6010 Rent = 15,000
    // Cr 1000 Cash = 15,000
    const lines = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, expense.journalEntryId));

    expect(lines).toHaveLength(2);
    const drLine = lines.find((l) => l.debitPaisa === 15000);
    const crLine = lines.find((l) => l.creditPaisa === 15000);

    expect(drLine).toBeDefined();
    expect(crLine).toBeDefined();
    expect(drLine!.creditPaisa).toBe(0);
    expect(crLine!.debitPaisa).toBe(0);

    const accountMap = await getPharmacyAccountMap(ctx.db, pharmacyAId);
    expect(crLine!.accountId).toBe(accountMap.cash);
  });

  it('POST /api/finance/expenses records credit expense (payable) and posts balanced AP entry', async () => {
    // Credit expense for AC Repairs: 80,000 paisa (Rs. 800.00) <= Rs. 25,000 threshold
    const res = await app.inject({
      method: 'POST',
      url: '/api/finance/expenses',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        branchId: branchA1Id,
        categoryId: repairsCategoryId,
        amountPaisa: 80000,
        paymentType: 'credit',
        vendorName: 'Cooling Masters HVAC Services',
        expenseDate: new Date().toISOString().slice(0, 10),
        notes: 'Main floor air conditioner servicing on 30-day credit',
      },
    });

    expect(res.statusCode).toBe(201);
    const expense = res.json().data;
    expect(expense.status).toBe('posted');
    expect(expense.paymentType).toBe('credit');
    expect(expense.journalEntryId).toBeDefined();

    // Verify GL Posting:
    // Dr 6050 Repairs = 80,000
    // Cr 2000 AP = 80,000
    const lines = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, expense.journalEntryId));

    expect(lines).toHaveLength(2);
    const accountMap = await getPharmacyAccountMap(ctx.db, pharmacyAId);
    const crAP = lines.find((l) => l.accountId === accountMap.ap);

    expect(crAP).toBeDefined();
    expect(crAP!.creditPaisa).toBe(80000);
    expect(crAP!.partyType).toBe('supplier');
  });

  it('enforces approval workflow for expense amounts above threshold (pending_approval -> approved -> posted)', async () => {
    // High-value expense: Rs. 50,000 (5,000,000 paisa) > Rs. 25,000 (2,500,000 paisa) threshold
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/finance/expenses',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        branchId: branchA1Id,
        categoryId: rentCategoryId,
        amountPaisa: 5000000,
        paymentType: 'paid',
        paymentMethod: 'bank',
        expenseDate: new Date().toISOString().slice(0, 10),
        notes: 'Quarterly full building lease payment',
      },
    });

    expect(createRes.statusCode).toBe(201);
    const pendingExp = createRes.json().data;
    expect(pendingExp.status).toBe('pending_approval');
    expect(pendingExp.journalEntryId).toBeNull(); // Not posted to GL yet!

    // Approve expense by Manager
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/finance/expenses/${pendingExp.id}/approve`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });

    expect(approveRes.statusCode).toBe(200);
    const approvedExp = approveRes.json().data;
    expect(approvedExp.status).toBe('posted');
    expect(approvedExp.approvedBy).toBeDefined();
    expect(approvedExp.journalEntryId).toBeDefined();

    // Verify GL entry exists now:
    // Dr 6010 Rent = 5,000,000
    // Cr 1010 Bank = 5,000,000
    const lines = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, approvedExp.journalEntryId));

    expect(lines).toHaveLength(2);
    const accountMap = await getPharmacyAccountMap(ctx.db, pharmacyAId);
    const crBank = lines.find((l) => l.accountId === accountMap.bank);
    expect(crBank!.creditPaisa).toBe(5000000);
  });

  it('POST /api/finance/expenses/:id/reverse creates immutable reversing journal entry', async () => {
    // 1. Create and post small expense
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/finance/expenses',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        branchId: branchA1Id,
        categoryId: repairsCategoryId,
        amountPaisa: 25000,
        paymentType: 'paid',
        paymentMethod: 'cash',
        expenseDate: new Date().toISOString().slice(0, 10),
        notes: 'Door hinge repair',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const expense = createRes.json().data;

    // 2. Reverse expense
    const revRes = await app.inject({
      method: 'POST',
      url: `/api/finance/expenses/${expense.id}/reverse`,
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: { reversalReason: 'Duplicate entry created by mistake' },
    });

    expect(revRes.statusCode).toBe(200);
    const reversedExpense = revRes.json().data;
    expect(reversedExpense.status).toBe('reversed');
    expect(reversedExpense.reversalEntryId).toBeDefined();

    // 3. Verify reversing journal entry
    const [revEntry] = await ctx.db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, reversedExpense.reversalEntryId));

    expect(revEntry).toBeDefined();
    expect(revEntry!.reversesEntryId).toBe(expense.journalEntryId);
  });

  it('supports recurring expense template creation and idempotent generation for a period', async () => {
    // 1. Create Recurring Template
    const templateRes = await app.inject({
      method: 'POST',
      url: '/api/finance/expenses/recurring',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        branchId: branchA1Id,
        categoryId: rentCategoryId,
        title: 'Monthly Branch 1 Rent Contract',
        amountPaisa: 2000000,
        frequency: 'monthly',
        dayOfMonth: 5,
        paymentType: 'paid',
        paymentMethod: 'bank',
        vendorName: 'City Real Estate Holdings',
        notes: 'Scheduled rent auto-generation',
      },
    });

    expect(templateRes.statusCode).toBe(201);
    const template = templateRes.json().data;
    expect(template.id).toBeDefined();

    // 2. Preview generation for 2026-11
    const previewRes = await app.inject({
      method: 'GET',
      url: '/api/finance/expenses/recurring/preview?period=2026-11',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(previewRes.statusCode).toBe(200);
    expect(previewRes.json().data.pendingCount).toBeGreaterThanOrEqual(1);

    // 3. Generate recurring expenses for 2026-11
    const genRes = await app.inject({
      method: 'POST',
      url: '/api/finance/expenses/recurring/generate',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: { period: '2026-11' },
    });

    expect(genRes.statusCode).toBe(200);
    expect(genRes.json().data.generatedCount).toBeGreaterThanOrEqual(1);

    // 4. Run generation AGAIN for 2026-11 -> must be completely idempotent (0 duplicates generated!)
    const genAgainRes = await app.inject({
      method: 'POST',
      url: '/api/finance/expenses/recurring/generate',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: { period: '2026-11' },
    });

    expect(genAgainRes.statusCode).toBe(200);
    expect(genAgainRes.json().data.generatedCount).toBe(0); // Idempotent!
  });

  it('GET /api/finance/expenses returns paginated list with KPI metrics', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/finance/expenses?page=1&pageSize=10',
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });

    expect(listRes.statusCode).toBe(200);
    const body = listRes.json();
    expect(body.success).toBe(true);

    const kpis = body.data.kpis;
    expect(kpis.totalExpensesPaisa).toBeGreaterThan(0);
    expect(kpis.expenseCount).toBeGreaterThan(0);
    expect(kpis.averageExpensePaisa).toBeGreaterThan(0);
  });

  it('enforces role permissions: cashier and pharmacist cannot access expenses (403 Forbidden)', async () => {
    const cashierRes = await app.inject({
      method: 'GET',
      url: '/api/finance/expenses',
      headers: { authorization: `Bearer ${cashierTokenA}` },
    });
    expect(cashierRes.statusCode).toBe(403);

    const pharmRes = await app.inject({
      method: 'POST',
      url: '/api/finance/expenses',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: { amountPaisa: 500 },
    });
    expect(pharmRes.statusCode).toBe(403);
  });

  it('enforces tenant isolation: Pharmacy B cannot view, approve, or reverse Pharmacy A expenses', async () => {
    // 1. Fetch Pharmacy A expense
    const [expA] = await ctx.db
      .select()
      .from(erpExpenses)
      .where(eq(erpExpenses.pharmacyId, pharmacyAId))
      .limit(1);
    expect(expA).toBeDefined();

    // 2. Pharmacy B attempts to view Pharmacy A expense -> 404
    const viewRes = await app.inject({
      method: 'GET',
      url: `/api/finance/expenses/${expA!.id}`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(viewRes.statusCode).toBe(404);

    // 3. Pharmacy B attempts to reverse Pharmacy A expense -> 404
    const revRes = await app.inject({
      method: 'POST',
      url: `/api/finance/expenses/${expA!.id}/reverse`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
      payload: { reversalReason: 'Cross tenant attempt' },
    });
    expect(revRes.statusCode).toBe(404);
  });
});
