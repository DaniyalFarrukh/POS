import { describe, it, expect, beforeAll } from 'vitest';
import { performance } from 'node:perf_hooks';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import { signUserToken } from '../auth/jwt';
import { pharmacies, branches, users, accounts, fiscalPeriods } from '../db/schema';
import { seedDefaultChartOfAccounts } from '../ledger/coa-seed';
import { postJournalEntry } from '../ledger/service';
import type { FastifyInstance } from 'fastify';

describe('Financial Reports Module & Acceptance Test Suite', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchA1Id: string;
  let branchA2Id: string;
  let branchBId: string;

  let accountantTokenA: string;
  let managerTokenA: string;
  let cashierTokenA: string;
  let ownerTokenB: string;

  // Chart of accounts IDs for Pharmacy A
  let cashAccountId: string;
  let bankAccountId: string;
  let arAccountId: string;
  let invAccountId: string;
  let apAccountId: string;
  let equityAccountId: string;
  let salesAccountId: string;
  let salesReturnAccountId: string;
  let cogsAccountId: string;
  let salariesExpenseAccountId: string;
  let rentExpenseAccountId: string;
  let utilitiesExpenseAccountId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });
    await app.ready();

    pharmacyAId = generateUuidV7();
    pharmacyBId = generateUuidV7();

    // 1. Create Pharmacies
    await ctx.db.insert(pharmacies).values([
      {
        id: pharmacyAId,
        name: 'Prime Healthcare Pharmacy',
        code: `PHP-${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: pharmacyBId,
        name: 'Foreign Pharmacy B',
        code: `FPB-${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 2. Branches
    branchA1Id = generateUuidV7();
    branchA2Id = generateUuidV7();
    branchBId = generateUuidV7();

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
      {
        id: branchBId,
        pharmacyId: pharmacyBId,
        name: 'Branch Foreign B',
        address: 'Lahore',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 3. Seed Chart of Accounts
    await seedDefaultChartOfAccounts(ctx.db, pharmacyAId);
    await seedDefaultChartOfAccounts(ctx.db, pharmacyBId);

    const coaListA = await ctx.db.select().from(accounts);
    const getAcctA = (code: string) =>
      coaListA.find((a) => a.pharmacyId === pharmacyAId && a.code === code)!.id;

    cashAccountId = getAcctA('1000');
    bankAccountId = getAcctA('1010');
    arAccountId = getAcctA('1100');
    invAccountId = getAcctA('1200');
    apAccountId = getAcctA('2000');
    equityAccountId = getAcctA('3000');
    salesAccountId = getAcctA('4000');
    salesReturnAccountId = getAcctA('4090');
    cogsAccountId = getAcctA('5000');
    salariesExpenseAccountId = getAcctA('6000');
    rentExpenseAccountId = getAcctA('6010');
    utilitiesExpenseAccountId = getAcctA('6020');

    // 4. Create Users & Tokens
    const acctUserId = generateUuidV7();
    const mgrUserId = generateUuidV7();
    const cashierUserId = generateUuidV7();
    const foreignOwnerId = generateUuidV7();

    await ctx.db.insert(users).values({
      id: acctUserId,
      pharmacyId: pharmacyAId,
      name: 'Accountant Tariq',
      role: 'accountant',
      pinHash: 'dummy',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await ctx.db.insert(users).values({
      id: mgrUserId,
      pharmacyId: pharmacyAId,
      name: 'Manager Asim',
      role: 'manager',
      pinHash: 'dummy',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await ctx.db.insert(users).values({
      id: cashierUserId,
      pharmacyId: pharmacyAId,
      name: 'Cashier Salman',
      role: 'cashier',
      pinHash: 'dummy',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await ctx.db.insert(users).values({
      id: foreignOwnerId,
      pharmacyId: pharmacyBId,
      name: 'Foreign Owner',
      role: 'owner',
      pinHash: 'dummy',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    accountantTokenA = signUserToken({
      userId: acctUserId,
      pharmacyId: pharmacyAId,
      role: 'accountant',
      name: 'Accountant Tariq',
    });

    managerTokenA = signUserToken({
      userId: mgrUserId,
      pharmacyId: pharmacyAId,
      role: 'manager',
      name: 'Manager Asim',
    });

    cashierTokenA = signUserToken({
      userId: cashierUserId,
      pharmacyId: pharmacyAId,
      role: 'cashier',
      name: 'Cashier Salman',
    });

    ownerTokenB = signUserToken({
      userId: foreignOwnerId,
      pharmacyId: pharmacyBId,
      role: 'owner',
      name: 'Foreign Owner',
    });

    // 5. Fiscal Period for November 2026
    await ctx.db.insert(fiscalPeriods).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      status: 'open',
    });

    // 6. Seed Realistic Accounting Transactions for November 2026:
    await ctx.db.transaction(async (tx) => {
      // Entry 1: Owner Initial Capital Investment -> Dr Bank Rs. 1,000,000, Cr Equity Rs. 1,000,000
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-11-01',
        memo: 'Initial Owner Equity Contribution',
        lines: [
          {
            accountId: bankAccountId,
            debitPaisa: 100000000,
            creditPaisa: 0,
            branchId: branchA1Id,
          },
          {
            accountId: equityAccountId,
            debitPaisa: 0,
            creditPaisa: 100000000,
            branchId: branchA1Id,
          },
        ],
      });

      // Entry 2: Inventory Purchase on Credit -> Dr Inventory Rs. 400,000, Cr Accounts Payable Rs. 400,000
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-11-02',
        memo: 'Wholesale Medicine Stock Purchase',
        lines: [
          {
            accountId: invAccountId,
            debitPaisa: 40000000,
            creditPaisa: 0,
            branchId: branchA1Id,
          },
          {
            accountId: apAccountId,
            debitPaisa: 0,
            creditPaisa: 40000000,
            branchId: branchA1Id,
          },
        ],
      });

      // Entry 3: Supplier Payment from Bank -> Dr Accounts Payable Rs. 250,000, Cr Bank Rs. 250,000
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-11-03',
        memo: 'Partial payment to medicine distributor',
        lines: [
          {
            accountId: apAccountId,
            debitPaisa: 25000000,
            creditPaisa: 0,
            branchId: branchA1Id,
          },
          {
            accountId: bankAccountId,
            debitPaisa: 0,
            creditPaisa: 25000000,
            branchId: branchA1Id,
          },
        ],
      });

      // Entry 4: Branch 1 Retail Cash Sale ->
      // Dr Cash Rs. 150,000, Cr Sales Rs. 150,000
      // Dr COGS Rs. 90,000, Cr Inventory Rs. 90,000
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-11-05',
        memo: 'POS Daily Cash Sales Branch 1',
        lines: [
          {
            accountId: cashAccountId,
            debitPaisa: 15000000,
            creditPaisa: 0,
            branchId: branchA1Id,
          },
          {
            accountId: salesAccountId,
            debitPaisa: 0,
            creditPaisa: 15000000,
            branchId: branchA1Id,
          },
          {
            accountId: cogsAccountId,
            debitPaisa: 9000000,
            creditPaisa: 0,
            branchId: branchA1Id,
          },
          {
            accountId: invAccountId,
            debitPaisa: 0,
            creditPaisa: 9000000,
            branchId: branchA1Id,
          },
        ],
      });

      // Entry 5: Branch 2 Credit Sale ->
      // Dr AR Rs. 80,000, Cr Sales Rs. 80,000
      // Dr COGS Rs. 50,000, Cr Inventory Rs. 50,000
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-11-06',
        memo: 'Credit sales to hospital panel Branch 2',
        lines: [
          {
            accountId: arAccountId,
            debitPaisa: 8000000,
            creditPaisa: 0,
            branchId: branchA2Id,
          },
          {
            accountId: salesAccountId,
            debitPaisa: 0,
            creditPaisa: 8000000,
            branchId: branchA2Id,
          },
          {
            accountId: cogsAccountId,
            debitPaisa: 5000000,
            creditPaisa: 0,
            branchId: branchA2Id,
          },
          {
            accountId: invAccountId,
            debitPaisa: 0,
            creditPaisa: 5000000,
            branchId: branchA2Id,
          },
        ],
      });

      // Entry 6: Sales Return -> Dr Sales Returns Rs. 10,000, Cr Cash Rs. 10,000
      // Restock: Dr Inventory Rs. 6,000, Cr COGS Rs. 6,000
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-11-07',
        memo: 'Customer return medicine Branch 1',
        lines: [
          {
            accountId: salesReturnAccountId,
            debitPaisa: 1000000,
            creditPaisa: 0,
            branchId: branchA1Id,
          },
          {
            accountId: cashAccountId,
            debitPaisa: 0,
            creditPaisa: 1000000,
            branchId: branchA1Id,
          },
          {
            accountId: invAccountId,
            debitPaisa: 600000,
            creditPaisa: 0,
            branchId: branchA1Id,
          },
          {
            accountId: cogsAccountId,
            debitPaisa: 0,
            creditPaisa: 600000,
            branchId: branchA1Id,
          },
        ],
      });

      // Entry 7: Operating Expenses Paid from Bank:
      // Dr Salaries Rs. 35,000, Dr Rent Rs. 20,000, Dr Utilities Rs. 5,000, Cr Bank Rs. 60,000
      await postJournalEntry(tx, {
        pharmacyId: pharmacyAId,
        entryDate: '2026-11-08',
        memo: 'November Operating Expenses',
        lines: [
          {
            accountId: salariesExpenseAccountId,
            debitPaisa: 3500000,
            creditPaisa: 0,
            branchId: branchA1Id,
          },
          {
            accountId: rentExpenseAccountId,
            debitPaisa: 2000000,
            creditPaisa: 0,
            branchId: branchA1Id,
          },
          {
            accountId: utilitiesExpenseAccountId,
            debitPaisa: 500000,
            creditPaisa: 0,
            branchId: branchA2Id,
          },
          {
            accountId: bankAccountId,
            debitPaisa: 0,
            creditPaisa: 6000000,
            branchId: branchA1Id,
          },
        ],
      });
    });
  });

  it('1. Trial Balance: total debits strictly equal total credits and proves balanced state', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/reports/trial-balance?startDate=2026-11-01&endDate=2026-11-30',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.isBalanced).toBe(true);
    expect(body.data.totalDebitPaisa).toBe(body.data.totalCreditPaisa);
    expect(body.data.rows.length).toBeGreaterThan(0);
  });

  it('2. Profit & Loss: net profit strictly equals revenue minus COGS minus operating expenses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/reports/profit-loss?startDate=2026-11-01&endDate=2026-11-30',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    const { summary } = body.data;

    // Expected numbers based on seeded entries:
    // Gross Sales: 150,000 + 80,000 = 230,000 PKR = 23,000,000 paisa
    // Sales Returns: 10,000 PKR = 1,000,000 paisa
    // Net Revenue: 22,000,000 paisa
    expect(summary.totalRevenuePaisa).toBe(22000000);

    // COGS: 90,000 + 50,000 - 6,000 = 134,000 PKR = 13,400,000 paisa
    expect(summary.totalCogsPaisa).toBe(13400000);

    // Gross Profit: 22,000,000 - 13,400,000 = 8,600,000 paisa
    expect(summary.grossProfitPaisa).toBe(8600000);

    // Expenses: 35,000 (Salaries) + 20,000 (Rent) + 5,000 (Utilities) = 60,000 PKR = 6,000,000 paisa
    expect(summary.totalOperatingExpensesPaisa).toBe(6000000);

    // Net Profit: 8,600,000 - 6,000,000 = 2,600,000 paisa (Rs. 26,000)
    expect(summary.netProfitPaisa).toBe(2600000);

    // Formula invariant: Net Profit === Revenue - COGS - Expenses
    expect(summary.netProfitPaisa).toBe(
      summary.totalRevenuePaisa - summary.totalCogsPaisa - summary.totalOperatingExpensesPaisa
    );
  });

  it('3. Balance Sheet: assets strictly equal liabilities + equity + current period profit (difference = 0 paisa)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/reports/balance-sheet?startDate=2026-11-01&endDate=2026-11-30',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    const { summary } = body.data;

    // Assets:
    // Cash: 15,000,000 (Sale) - 1,000,000 (Refund) = 14,000,000 paisa (Rs. 140,000)
    // Bank: 100,000,000 (Equity) - 25,000,000 (AP payment) - 6,000,000 (Expenses) = 69,000,000 paisa (Rs. 690,000)
    // AR: 8,000,000 paisa (Rs. 80,000)
    // Inventory: 40,000,000 (Purchase) - 9,000,000 (COGS) - 5,000,000 (COGS) + 600,000 (Restock) = 26,600,000 paisa (Rs. 266,000)
    // Total Assets = 14,000,000 + 69,000,000 + 8,000,000 + 26,600,000 = 117,600,000 paisa (Rs. 1,176,000)
    expect(summary.totalAssetsPaisa).toBe(117600000);

    // Liabilities:
    // AP: 40,000,000 (Purchase) - 25,000,000 (Payment) = 15,000,000 paisa (Rs. 150,000)
    expect(summary.totalLiabilitiesPaisa).toBe(15000000);

    // Equity:
    // Owner Capital: 100,000,000 paisa (Rs. 1,000,000)
    expect(summary.totalBaseEquityPaisa).toBe(100000000);

    // Current Period Profit (from P&L): 2,600,000 paisa (Rs. 26,000)
    expect(summary.currentPeriodProfitPaisa).toBe(2600000);

    // Total Equity & Reserves = Base Equity + Current Period Profit = 102,600,000 paisa
    expect(summary.totalEquityAndReservesPaisa).toBe(102600000);

    // Total Liabilities + Equity = 15,000,000 + 102,600,000 = 117,600,000 paisa
    expect(summary.totalLiabilitiesAndEquityPaisa).toBe(117600000);

    // Invariant: Difference between Assets and Liabilities+Equity MUST be exactly 0 paisa!
    expect(summary.differencePaisa).toBe(0);
    expect(body.data.isBalanced).toBe(true);
  });

  it('4. Report figures strictly equal independent account ledger queries', async () => {
    // Check cash account ledger closing balance
    const ledgerRes = await app.inject({
      method: 'GET',
      url: `/api/finance/accounts/${cashAccountId}/ledger?from=2026-11-01&to=2026-11-30`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(ledgerRes.statusCode).toBe(200);
    const ledgerData = ledgerRes.json();

    // Check Balance Sheet cash line
    const bsRes = await app.inject({
      method: 'GET',
      url: '/api/finance/reports/balance-sheet?startDate=2026-11-01&endDate=2026-11-30',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    const bsData = bsRes.json();
    const bsCashLine = bsData.data.sections.assets.rows.find(
      (r: { code: string }) => r.code === '1000'
    );

    expect(bsCashLine).toBeDefined();
    expect(bsCashLine.balancePaisa).toBe(ledgerData.closingBalancePaisa);

    // Check Trial Balance cash line
    const tbRes = await app.inject({
      method: 'GET',
      url: '/api/finance/reports/trial-balance?startDate=2026-11-01&endDate=2026-11-30',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    const tbData = tbRes.json();
    const tbCashLine = tbData.data.rows.find((r: { code: string }) => r.code === '1000');
    expect(tbCashLine).toBeDefined();
    expect(tbCashLine.closingBalancePaisa).toBe(ledgerData.closingBalancePaisa);
  });

  it('5. Branch filter totals sum up to the whole (Branch Additivity)', async () => {
    // 1. Company-wide Profit & Loss
    const allRes = await app.inject({
      method: 'GET',
      url: '/api/finance/reports/profit-loss?startDate=2026-11-01&endDate=2026-11-30',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    const allPnl = allRes.json().data;

    // 2. Branch 1 Profit & Loss
    const b1Res = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/profit-loss?startDate=2026-11-01&endDate=2026-11-30&branchId=${branchA1Id}`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    const b1Pnl = b1Res.json().data;

    // 3. Branch 2 Profit & Loss
    const b2Res = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/profit-loss?startDate=2026-11-01&endDate=2026-11-30&branchId=${branchA2Id}`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    const b2Pnl = b2Res.json().data;

    // Branch 1 Gross Sales: 15,000,000; Returns: 1,000,000 -> Net Rev = 14,000,000
    // Branch 2 Gross Sales: 8,000,000; Returns: 0 -> Net Rev = 8,000,000
    // Sum = 22,000,000 = Company-wide Net Revenue!
    expect(b1Pnl.summary.totalRevenuePaisa + b2Pnl.summary.totalRevenuePaisa).toBe(
      allPnl.summary.totalRevenuePaisa
    );

    // Sum of COGS: Branch 1 (8,400,000) + Branch 2 (5,000,000) = 13,400,000 = Company-wide COGS!
    expect(b1Pnl.summary.totalCogsPaisa + b2Pnl.summary.totalCogsPaisa).toBe(
      allPnl.summary.totalCogsPaisa
    );

    // Sum of Expenses: Branch 1 (5,500,000) + Branch 2 (500,000) = 6,000,000 = Company-wide Expenses!
    expect(
      b1Pnl.summary.totalOperatingExpensesPaisa + b2Pnl.summary.totalOperatingExpensesPaisa
    ).toBe(allPnl.summary.totalOperatingExpensesPaisa);
  });

  it('6. Cash Flow: reconciled with ledger Cash & Bank closing balance', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/reports/cash-flow?startDate=2026-11-01&endDate=2026-11-30',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    const { summary } = body.data;
    // Opening Cash & Bank prior to Nov 1 = 0 paisa
    expect(summary.openingCashPaisa).toBe(0);

    // Closing Cash & Bank = Cash (14,000,000) + Bank (69,000,000) = 83,000,000 paisa (Rs. 830,000)
    expect(summary.closingCashPaisa).toBe(83000000);
    expect(summary.netCashFlowPaisa).toBe(83000000);
    expect(body.data.isReconciled).toBe(true);
  });

  it('7. General Ledger: summary and detailed account drill-down with running balance', async () => {
    // 1. General Ledger Summary (All Accounts)
    const summaryRes = await app.inject({
      method: 'GET',
      url: '/api/finance/reports/general-ledger?startDate=2026-11-01&endDate=2026-11-30',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(summaryRes.statusCode).toBe(200);
    const summaryBody = summaryRes.json();
    expect(summaryBody.success).toBe(true);
    expect(summaryBody.data.accounts.length).toBeGreaterThan(0);

    // 2. Drill-down for Bank Account
    const drillRes = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/general-ledger/${bankAccountId}?startDate=2026-11-01&endDate=2026-11-30`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(drillRes.statusCode).toBe(200);
    const drillBody = drillRes.json();
    expect(drillBody.success).toBe(true);
    expect(drillBody.data.account.code).toBe('1010');
    expect(drillBody.data.lines.length).toBe(3); // Capital in, Supplier out, Expenses out
    expect(drillBody.data.closingBalancePaisa).toBe(69000000);
  });

  it('8. Tenant isolation & role guards: blocks unauthorized cashier and foreign branch ID', async () => {
    // Cashier blocked (403)
    const cashierRes = await app.inject({
      method: 'GET',
      url: '/api/finance/reports/profit-loss?startDate=2026-11-01&endDate=2026-11-30',
      headers: { authorization: `Bearer ${cashierTokenA}` },
    });
    expect(cashierRes.statusCode).toBe(403);

    // Manager permitted (200)
    const mgrRes = await app.inject({
      method: 'GET',
      url: '/api/finance/reports/profit-loss?startDate=2026-11-01&endDate=2026-11-30',
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(mgrRes.statusCode).toBe(200);

    // Foreign branch ID belongs to Tenant B -> 404
    const foreignBranchRes = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/trial-balance?startDate=2026-11-01&endDate=2026-11-30&branchId=${branchBId}`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(foreignBranchRes.statusCode).toBe(404);

    // Cross-tenant data isolation: Tenant B sees 0 entries
    const bRes = await app.inject({
      method: 'GET',
      url: '/api/finance/reports/profit-loss?startDate=2026-11-01&endDate=2026-11-30',
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(bRes.statusCode).toBe(200);
    expect(bRes.json().data.summary.totalRevenuePaisa).toBe(0);
  });

  it('9. Performance benchmark: computes financial statements with 100,000 journal lines under 2.0 seconds', async () => {
    // Create dedicated pharmacy for benchmark
    const benchPharmacyId = generateUuidV7();
    const benchBranchId = generateUuidV7();

    await ctx.db.insert(pharmacies).values({
      id: benchPharmacyId,
      name: 'Benchmark Mega Pharmacy',
      code: `BMP-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await ctx.db.insert(branches).values({
      id: benchBranchId,
      pharmacyId: benchPharmacyId,
      name: 'Central Mega Branch',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await seedDefaultChartOfAccounts(ctx.db, benchPharmacyId);
    const coaBench = await ctx.db.select().from(accounts);
    const getBenchAcct = (code: string) =>
      coaBench.find((a) => a.pharmacyId === benchPharmacyId && a.code === code)!.id;

    const bCash = getBenchAcct('1000');
    const bSales = getBenchAcct('4000');

    const benchUserId = generateUuidV7();
    await ctx.db.insert(users).values({
      id: benchUserId,
      pharmacyId: benchPharmacyId,
      name: 'Bench Accountant',
      role: 'accountant',
      pinHash: 'dummy',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const benchToken = signUserToken({
      userId: benchUserId,
      pharmacyId: benchPharmacyId,
      role: 'accountant',
      name: 'Bench Accountant',
    });

    // Seed 100 balanced entries x 1,000 lines = 100,000 journal lines in PostgreSQL in a single fast transaction
    await ctx.db.transaction(async (tx) => {
      await tx.execute(`
        INSERT INTO "journal_entries" ("id", "pharmacy_id", "entry_no", "entry_date", "source_type", "memo", "status", "created_at")
        SELECT
          ('01a1b000-0000-7000-8000-' || LPAD(s.i::text, 12, '0'))::uuid,
          '${benchPharmacyId}'::uuid,
          s.i,
          '2026-11-' || LPAD((1 + (s.i % 28))::text, 2, '0'),
          'sale',
          'Daily POS Batch #' || s.i,
          'posted',
          NOW()
        FROM generate_series(1, 100) AS s(i);
      `);

      await tx.execute(`
        INSERT INTO "journal_lines" ("id", "entry_id", "pharmacy_id", "account_id", "debit_paisa", "credit_paisa", "branch_id")
        SELECT
          gen_random_uuid(),
          ('01a1b000-0000-7000-8000-' || LPAD(e.i::text, 12, '0'))::uuid,
          '${benchPharmacyId}'::uuid,
          '${bCash}'::uuid,
          1000,
          0,
          '${benchBranchId}'::uuid
        FROM generate_series(1, 100) AS e(i)
        CROSS JOIN generate_series(1, 500) AS l(j)
        UNION ALL
        SELECT
          gen_random_uuid(),
          ('01a1b000-0000-7000-8000-' || LPAD(e.i::text, 12, '0'))::uuid,
          '${benchPharmacyId}'::uuid,
          '${bSales}'::uuid,
          0,
          1000,
          '${benchBranchId}'::uuid
        FROM generate_series(1, 100) AS e(i)
        CROSS JOIN generate_series(1, 500) AS l(j);
      `);
    });

    // Now benchmark the Trial Balance, P&L, and Balance Sheet query performance
    const start = performance.now();

    const [tbRes, pnlRes, bsRes] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/api/finance/reports/trial-balance?startDate=2026-11-01&endDate=2026-11-30',
        headers: { authorization: `Bearer ${benchToken}` },
      }),
      app.inject({
        method: 'GET',
        url: '/api/finance/reports/profit-loss?startDate=2026-11-01&endDate=2026-11-30',
        headers: { authorization: `Bearer ${benchToken}` },
      }),
      app.inject({
        method: 'GET',
        url: '/api/finance/reports/balance-sheet?startDate=2026-11-01&endDate=2026-11-30',
        headers: { authorization: `Bearer ${benchToken}` },
      }),
    ]);

    const durationMs = performance.now() - start;

    expect(tbRes.statusCode).toBe(200);
    expect(pnlRes.statusCode).toBe(200);
    expect(bsRes.statusCode).toBe(200);

    const tbJson = tbRes.json();
    const bsJson = bsRes.json();
    expect(tbJson.data.isBalanced).toBe(true);
    expect(bsJson.data.isBalanced).toBe(true);

    console.log(
      `\n=================================================================\n` +
        `[BENCHMARK RESULT] Aggregated 100,000 journal lines across Trial Balance, P&L, and Balance Sheet\n` +
        `- Execution Time: ${durationMs.toFixed(2)} ms (Budget: 2,000.00 ms)\n` +
        `- Trial Balance Balanced: ${tbJson.data.isBalanced}\n` +
        `- Balance Sheet Balanced: ${bsJson.data.isBalanced}\n` +
        `=================================================================\n`
    );

    // Must be strictly under 2.0 seconds (2,000 ms)
    expect(durationMs).toBeLessThan(2000);
  }, 60000); // 60s timeout for seeding 100k rows
});
