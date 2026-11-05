import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import { generateUuidV7 } from '@pos/shared';
import { signUserToken } from '../auth/jwt';
import {
  pharmacies,
  branches,
  users,
  fiscalPeriods,
  accounts,
  journalEntries,
  journalLines,
  budgets,
} from '../db/schema';
import { seedDefaultChartOfAccounts } from '../ledger/coa-seed';

describe('Budget Planning Module (Variance Math, Alerts, Copy, Permissions)', () => {
  let app: FastifyInstance;
  let ctx: TestDatabaseContext;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchA1Id: string;
  let branchA2Id: string;
  let branchBId: string;

  let ownerTokenA: string;
  let managerTokenA: string;
  let accountantTokenA: string;
  let cashierTokenA: string;
  let ownerTokenB: string;

  let rentAccountId: string; // 6010 (Expense)
  let utilitiesAccountId: string; // 6020 (Expense)
  let salariesAccountId: string; // 6000 (Expense)
  let salesAccountId: string; // 4000 (Revenue)

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
        name: 'MediCare Pharmacy A',
        code: `MEDA_${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: pharmacyBId,
        name: 'Al-Shifa Pharmacy B',
        code: `MEDB_${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 2. Create Branches
    branchA1Id = generateUuidV7();
    branchA2Id = generateUuidV7();
    branchBId = generateUuidV7();

    await ctx.db.insert(branches).values([
      {
        id: branchA1Id,
        pharmacyId: pharmacyAId,
        name: 'Main Clifton Branch',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: branchA2Id,
        pharmacyId: pharmacyAId,
        name: 'DHA Phase 5 Branch',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: branchBId,
        pharmacyId: pharmacyBId,
        name: 'Gulshan Branch B',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 3. Seed COA
    await seedDefaultChartOfAccounts(ctx.db, pharmacyAId);
    await seedDefaultChartOfAccounts(ctx.db, pharmacyBId);

    const allAcctsA = await ctx.db.select().from(accounts);
    rentAccountId = allAcctsA.find((a) => a.pharmacyId === pharmacyAId && a.code === '6010')!.id;
    utilitiesAccountId = allAcctsA.find(
      (a) => a.pharmacyId === pharmacyAId && a.code === '6020'
    )!.id;
    salariesAccountId = allAcctsA.find(
      (a) => a.pharmacyId === pharmacyAId && a.code === '6000'
    )!.id;
    salesAccountId = allAcctsA.find((a) => a.pharmacyId === pharmacyAId && a.code === '4000')!.id;

    // 4. Create Users
    const ownerAId = generateUuidV7();
    const managerAId = generateUuidV7();
    const accountantAId = generateUuidV7();
    const cashierAId = generateUuidV7();
    const ownerBId = generateUuidV7();

    await ctx.db.insert(users).values([
      {
        id: ownerAId,
        pharmacyId: pharmacyAId,
        name: 'Owner A',
        role: 'owner' as const,
        pinHash: 'dummy',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: managerAId,
        pharmacyId: pharmacyAId,
        name: 'Manager A',
        role: 'manager' as const,
        pinHash: 'dummy',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: accountantAId,
        pharmacyId: pharmacyAId,
        name: 'Accountant A',
        role: 'accountant' as const,
        pinHash: 'dummy',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: cashierAId,
        pharmacyId: pharmacyAId,
        name: 'Cashier A',
        role: 'cashier' as const,
        pinHash: 'dummy',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: ownerBId,
        pharmacyId: pharmacyBId,
        name: 'Owner B',
        role: 'owner' as const,
        pinHash: 'dummy',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    ownerTokenA = signUserToken({
      userId: ownerAId,
      pharmacyId: pharmacyAId,
      role: 'owner',
      name: 'Owner A',
    });
    managerTokenA = signUserToken({
      userId: managerAId,
      pharmacyId: pharmacyAId,
      role: 'manager',
      name: 'Manager A',
    });
    accountantTokenA = signUserToken({
      userId: accountantAId,
      pharmacyId: pharmacyAId,
      role: 'accountant',
      name: 'Accountant A',
    });
    cashierTokenA = signUserToken({
      userId: cashierAId,
      pharmacyId: pharmacyAId,
      role: 'cashier',
      name: 'Cashier A',
    });
    ownerTokenB = signUserToken({
      userId: ownerBId,
      pharmacyId: pharmacyBId,
      role: 'owner',
      name: 'Owner B',
    });

    // 5. Open Fiscal Period for 2026
    await ctx.db.insert(fiscalPeriods).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'open',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Sets and retrieves monthly budgets for expense and revenue accounts per branch', async () => {
    // Save budget for branchA1 for 2026
    const res = await app.inject({
      method: 'POST',
      url: '/api/finance/budgets/batch',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        fiscalYear: 2026,
        branchId: branchA1Id,
        items: [
          // Rent: 100,000 PKR / month (10,000,000 paisa) for Month 1 (Jan) and Month 2 (Feb)
          { accountId: rentAccountId, month: 1, amountPaisa: 10000000, notes: 'Jan rent' },
          { accountId: rentAccountId, month: 2, amountPaisa: 10000000, notes: 'Feb rent' },
          // Utilities: 50,000 PKR for Month 1
          { accountId: utilitiesAccountId, month: 1, amountPaisa: 5000000, notes: 'Jan utilities' },
          // Sales Revenue: 500,000 PKR for Month 1
          { accountId: salesAccountId, month: 1, amountPaisa: 50000000, notes: 'Jan sales target' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.count).toBe(4);

    // Fetch budgets list
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/finance/budgets?fiscalYear=2026&branchId=${branchA1Id}`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json();
    expect(getBody.data.budgets.length).toBeGreaterThanOrEqual(4);
  });

  it('2. Computes Actual vs Budget with correct variance math for expense and revenue', async () => {
    // Seed actual journal entries for Month 1 (2026-01-15)
    // 1. Rent expense: Dr 6010 Rent (80,000 PKR = 8,000,000 paisa), Cr 1000 Cash
    // Budget was 10,000,000 paisa.
    // For Expense: Variance = Budget - Actual = 10,000,000 - 8,000,000 = +2,000,000 paisa (favorable, under budget!)
    // % Used = 80.0%
    const rentEntryId = generateUuidV7();
    const cashAcctA = (await ctx.db.select().from(accounts)).find(
      (a) => a.pharmacyId === pharmacyAId && a.code === '1000'
    )!;

    await ctx.db.transaction(async (tx) => {
      await tx.insert(journalEntries).values({
        id: rentEntryId,
        pharmacyId: pharmacyAId,
        entryNo: 1,
        entryDate: '2026-01-15',
        sourceType: 'manual_journal',
        sourceId: rentEntryId,
        memo: 'Paid Jan Rent',
        status: 'posted',
        createdAt: new Date().toISOString(),
      });

      await tx.insert(journalLines).values([
        {
          id: generateUuidV7(),
          entryId: rentEntryId,
          pharmacyId: pharmacyAId,
          accountId: rentAccountId,
          branchId: branchA1Id,
          debitPaisa: 8000000,
          creditPaisa: 0,
          memo: 'Jan Rent payment',
        },
        {
          id: generateUuidV7(),
          entryId: rentEntryId,
          pharmacyId: pharmacyAId,
          accountId: cashAcctA.id,
          branchId: branchA1Id,
          debitPaisa: 0,
          creditPaisa: 8000000,
          memo: 'Cash paid for rent',
        },
      ]);
    });

    // 2. Sales revenue: Dr 1000 Cash, Cr 4000 Sales (550,000 PKR = 55,000,000 paisa)
    // Budget was 50,000,000 paisa.
    // For Revenue: Variance = Actual - Budget = 55,000,000 - 50,000,000 = +5,000,000 paisa (favorable, exceeded target!)
    // % Achieved = 110.0%
    const salesEntryId = generateUuidV7();
    await ctx.db.transaction(async (tx) => {
      await tx.insert(journalEntries).values({
        id: salesEntryId,
        pharmacyId: pharmacyAId,
        entryNo: 2,
        entryDate: '2026-01-20',
        sourceType: 'manual_journal',
        sourceId: salesEntryId,
        memo: 'Jan Sales',
        status: 'posted',
        createdAt: new Date().toISOString(),
      });

      await tx.insert(journalLines).values([
        {
          id: generateUuidV7(),
          entryId: salesEntryId,
          pharmacyId: pharmacyAId,
          accountId: cashAcctA.id,
          branchId: branchA1Id,
          debitPaisa: 55000000,
          creditPaisa: 0,
          memo: 'Cash from sales',
        },
        {
          id: generateUuidV7(),
          entryId: salesEntryId,
          pharmacyId: pharmacyAId,
          accountId: salesAccountId,
          branchId: branchA1Id,
          debitPaisa: 0,
          creditPaisa: 55000000,
          memo: 'Jan Sales credit',
        },
      ]);
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/finance/budgets/actual-vs-budget?fiscalYear=2026&month=1&branchId=${branchA1Id}`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    const rentRow = body.data.rows.find(
      (r: { accountId: string }) => r.accountId === rentAccountId
    );
    expect(rentRow).toBeDefined();
    expect(rentRow.budgetPaisa).toBe(10000000);
    expect(rentRow.actualPaisa).toBe(8000000);
    expect(rentRow.variancePaisa).toBe(2000000); // 10,000,000 - 8,000,000 = +2,000,000 (favorable)
    expect(rentRow.percentageUsed).toBe(80);
    expect(rentRow.alertStatus).toBe('normal');

    const salesRow = body.data.rows.find(
      (r: { accountId: string }) => r.accountId === salesAccountId
    );
    expect(salesRow).toBeDefined();
    expect(salesRow.budgetPaisa).toBe(50000000);
    expect(salesRow.actualPaisa).toBe(55000000);
    expect(salesRow.variancePaisa).toBe(5000000); // 55,000,000 - 50,000,000 = +5,000,000 (favorable)
    expect(salesRow.percentageUsed).toBe(110);
    expect(salesRow.alertStatus).toBe('achieved');

    // Check summary KPIs
    expect(body.data.summary.totalExpenseBudgetPaisa).toBe(15000000); // 10m Rent + 5m Utilities
    expect(body.data.summary.totalExpenseActualPaisa).toBe(8000000);
    expect(body.data.summary.totalExpenseVariancePaisa).toBe(7000000); // under budget
    expect(body.data.summary.totalRevenueBudgetPaisa).toBe(50000000);
    expect(body.data.summary.totalRevenueActualPaisa).toBe(55000000);
    expect(body.data.summary.netBudgetPaisa).toBe(35000000); // 50m rev - 15m exp
    expect(body.data.summary.netActualPaisa).toBe(47000000); // 55m rev - 8m exp
  });

  it('3. Generates alerts when an expense line exceeds 90 percent of budget', async () => {
    // Utilities budget was 5,000,000 paisa (50,000 PKR).
    // Let's add an expense of 4,750,000 paisa (47,500 PKR = 95% of budget -> WARNING alert!)
    const utilEntryId = generateUuidV7();
    const cashAcctA = (await ctx.db.select().from(accounts)).find(
      (a) => a.pharmacyId === pharmacyAId && a.code === '1000'
    )!;

    await ctx.db.transaction(async (tx) => {
      await tx.insert(journalEntries).values({
        id: utilEntryId,
        pharmacyId: pharmacyAId,
        entryNo: 3,
        entryDate: '2026-01-25',
        sourceType: 'manual_journal',
        sourceId: utilEntryId,
        memo: 'Paid Electricity Bill',
        status: 'posted',
        createdAt: new Date().toISOString(),
      });

      await tx.insert(journalLines).values([
        {
          id: generateUuidV7(),
          entryId: utilEntryId,
          pharmacyId: pharmacyAId,
          accountId: utilitiesAccountId,
          branchId: branchA1Id,
          debitPaisa: 4750000,
          creditPaisa: 0,
          memo: 'Electric bill payment',
        },
        {
          id: generateUuidV7(),
          entryId: utilEntryId,
          pharmacyId: pharmacyAId,
          accountId: cashAcctA.id,
          branchId: branchA1Id,
          debitPaisa: 0,
          creditPaisa: 4750000,
          memo: 'Cash paid for electric',
        },
      ]);
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/finance/budgets/actual-vs-budget?fiscalYear=2026&month=1&branchId=${branchA1Id}`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    const utilRow = body.data.rows.find(
      (r: { accountId: string }) => r.accountId === utilitiesAccountId
    );
    expect(utilRow).toBeDefined();
    expect(utilRow.actualPaisa).toBe(4750000);
    expect(utilRow.percentageUsed).toBe(95);
    expect(utilRow.alertStatus).toBe('warning');

    // Check alerts array
    expect(body.data.alerts.length).toBeGreaterThanOrEqual(1);
    const alert = body.data.alerts.find(
      (a: { accountId: string }) => a.accountId === utilitiesAccountId
    );
    expect(alert).toBeDefined();
    expect(alert.percentageUsed).toBe(95);
    expect(alert.level).toBe('warning');
    expect(alert.accountCode).toBe('6020');
  });

  it('4. Correctly copies last year budget with percentage inflation adjustment', async () => {
    // 1. Seed 2025 budget for branchA2: Salaries (6000) = 200,000 PKR / month (20,000,000 paisa)
    await ctx.db.insert(budgets).values([
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyAId,
        branchId: branchA2Id,
        accountId: salariesAccountId,
        fiscalYear: 2025,
        month: 1,
        amountPaisa: 20000000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyAId,
        branchId: branchA2Id,
        accountId: salariesAccountId,
        fiscalYear: 2025,
        month: 2,
        amountPaisa: 20000000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 2. Call copy-previous-year with +10% adjustment (1000 basis points)
    const copyRes = await app.inject({
      method: 'POST',
      url: '/api/finance/budgets/copy-previous-year',
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        sourceYear: 2025,
        targetYear: 2026,
        branchId: branchA2Id,
        percentageAdjustmentBp: 1000, // +10%
        overwrite: true,
      },
    });

    expect(copyRes.statusCode).toBe(200);
    const copyBody = copyRes.json();
    expect(copyBody.success).toBe(true);
    expect(copyBody.data.copiedCount).toBe(2);

    // 3. Verify target 2026 budget has 220,000 PKR (22,000,000 paisa)
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/finance/budgets?fiscalYear=2026&branchId=${branchA2Id}`,
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });

    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json();
    const sal2026 = getBody.data.budgets.filter(
      (b: { accountId: string }) => b.accountId === salariesAccountId
    );
    expect(sal2026.length).toBe(2);
    expect(sal2026[0].amountPaisa).toBe(22000000); // 20,000,000 * 1.10 = 22,000,000
    expect(sal2026[1].amountPaisa).toBe(22000000);
  });

  it('5. Enforces role-based permissions: owner, manager, accountant allowed; cashier rejected', async () => {
    // Cashier blocked from GET actual-vs-budget
    const cashierGet = await app.inject({
      method: 'GET',
      url: `/api/finance/budgets/actual-vs-budget?fiscalYear=2026&month=1&branchId=${branchA1Id}`,
      headers: { authorization: `Bearer ${cashierTokenA}` },
    });
    expect(cashierGet.statusCode).toBe(403);

    // Cashier blocked from POST batch
    const cashierPost = await app.inject({
      method: 'POST',
      url: '/api/finance/budgets/batch',
      headers: { authorization: `Bearer ${cashierTokenA}` },
      payload: { fiscalYear: 2026, branchId: branchA1Id, items: [] },
    });
    expect(cashierPost.statusCode).toBe(403);

    // Manager allowed to view and manage
    const mgrRes = await app.inject({
      method: 'GET',
      url: `/api/finance/budgets/actual-vs-budget?fiscalYear=2026&month=1&branchId=${branchA1Id}`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(mgrRes.statusCode).toBe(200);
  });

  it('6. Strictly isolates tenants: Pharmacy A cannot view or copy Pharmacy B budgets', async () => {
    // Pharmacy B creates a budget
    const bRentAcct = (await ctx.db.select().from(accounts)).find(
      (a) => a.pharmacyId === pharmacyBId && a.code === '6010'
    )!;

    const bRes = await app.inject({
      method: 'POST',
      url: '/api/finance/budgets/batch',
      headers: { authorization: `Bearer ${ownerTokenB}` },
      payload: {
        fiscalYear: 2026,
        branchId: branchBId,
        items: [{ accountId: bRentAcct.id, month: 1, amountPaisa: 99900000 }],
      },
    });
    expect(bRes.statusCode).toBe(200);

    // Pharmacy A queries its budgets: does not see Pharmacy B's 99,900,000 amount
    const aQuery = await app.inject({
      method: 'GET',
      url: `/api/finance/budgets?fiscalYear=2026`,
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });
    expect(aQuery.statusCode).toBe(200);
    const aList = aQuery.json().data.budgets;
    expect(aList.some((b: { amountPaisa: number }) => b.amountPaisa === 99900000)).toBe(false);

    // Pharmacy A cannot pass Pharmacy B branchId to copy
    const aTamper = await app.inject({
      method: 'POST',
      url: '/api/finance/budgets/copy-previous-year',
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        sourceYear: 2025,
        targetYear: 2026,
        branchId: branchBId, // Foreign branch!
      },
    });
    expect(aTamper.statusCode).toBe(400);
  });
});
