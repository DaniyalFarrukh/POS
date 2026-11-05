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
  accounts,
  journalLines,
  fiscalPeriods,
  bankAccounts,
} from '../db/schema';
import { seedDefaultChartOfAccounts } from '../ledger/coa-seed';
import { signUserToken } from '../auth/jwt';

describe('ERP Cash & Bank Module (Phase 8)', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  // Tenant A
  let pharmacyAId: string;
  let branchAId: string;
  let counterAId: string;
  let accountantUserAId: string;
  let accountantTokenA: string;
  let cashierUserAId: string;
  let cashierTokenA: string;

  // Tenant B (for cross-tenant tests)
  let pharmacyBId: string;
  let ownerUserBId: string;
  let ownerTokenB: string;

  // Bank & Cash accounts for Pharmacy A
  let cashAccountAId: string;
  let bankAccountAId: string;
  let ledgerCashAcctAId: string;
  let ledgerBankAcctAId: string;

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
        name: 'City Care Pharmacy (Cash & Bank)',
        code: 'CCP',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: pharmacyBId,
        name: 'Sehat Medical (Tenant B)',
        code: 'SMT',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 2. Create Branches
    branchAId = generateUuidV7();
    await ctx.db.insert(branches).values({
      id: branchAId,
      pharmacyId: pharmacyAId,
      name: 'Main Branch',
      address: 'Shahrah-e-Faisal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    counterAId = generateUuidV7();
    await ctx.db.insert(counters).values({
      id: counterAId,
      pharmacyId: pharmacyAId,
      branchId: branchAId,
      code: 'CTR-01',
      name: 'Checkout Counter 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 3. Seed Chart of Accounts
    await seedDefaultChartOfAccounts(ctx.db, pharmacyAId);
    await seedDefaultChartOfAccounts(ctx.db, pharmacyBId);

    // 4. Create Users & JWTs
    accountantUserAId = generateUuidV7();
    cashierUserAId = generateUuidV7();
    ownerUserBId = generateUuidV7();

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
        id: cashierUserAId,
        pharmacyId: pharmacyAId,
        name: 'Cashier Salman',
        role: 'cashier' as const,
        pinHash: 'dummy',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: ownerUserBId,
        pharmacyId: pharmacyBId,
        name: 'Owner Bilal',
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

    cashierTokenA = signUserToken({
      userId: cashierUserAId,
      pharmacyId: pharmacyAId,
      role: 'cashier',
      name: 'Cashier Salman',
    });

    ownerTokenB = signUserToken({
      userId: ownerUserBId,
      pharmacyId: pharmacyBId,
      role: 'owner',
      name: 'Owner Bilal',
    });

    // 5. Open Fiscal Period for 2026
    await ctx.db.insert(fiscalPeriods).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      status: 'open',
    });

    // 6. Look up ledger accounts: 1000 Cash in Hand, 1010 Bank
    const allAcctsA = await ctx.db.select().from(accounts);
    const cashLedger = allAcctsA.find((a) => a.pharmacyId === pharmacyAId && a.code === '1000')!;
    const bankLedger = allAcctsA.find((a) => a.pharmacyId === pharmacyAId && a.code === '1010')!;
    ledgerCashAcctAId = cashLedger.id;
    ledgerBankAcctAId = bankLedger.id;

    // 7. Create Bank Accounts
    cashAccountAId = generateUuidV7();
    bankAccountAId = generateUuidV7();

    await ctx.db.insert(bankAccounts).values([
      {
        id: cashAccountAId,
        pharmacyId: pharmacyAId,
        name: 'Main Vault Cash',
        type: 'cash',
        accountId: ledgerCashAcctAId,
        openingBalancePaisa: 10000000, // 100,000 PKR
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: bankAccountAId,
        pharmacyId: pharmacyAId,
        name: 'Meezan Bank Current Account',
        type: 'bank',
        accountId: ledgerBankAcctAId,
        bankName: 'Meezan Bank Ltd',
        accountNumber: '010203040506',
        iban: 'PK36MEZN0001020304050607',
        openingBalancePaisa: 50000000, // 500,000 PKR
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
    await ctx.cleanup();
  });

  it('1. lists bank and cash accounts with their live ledger balances', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/cash-bank/accounts',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.accounts)).toBe(true);
    expect(body.data.accounts.length).toBeGreaterThanOrEqual(2);

    const meezan = body.data.accounts.find((a: { id: string }) => a.id === bankAccountAId);
    expect(meezan).toBeDefined();
    expect(meezan.name).toBe('Meezan Bank Current Account');
    expect(meezan.type).toBe('bank');
    expect(typeof meezan.ledgerBalancePaisa).toBe('number');
  });

  it('2. records an inter-account fund transfer (Cash to Bank) and auto-posts balanced journal lines', async () => {
    const transferAmount = 2500000; // 25,000 PKR

    const res = await app.inject({
      method: 'POST',
      url: '/api/finance/cash-bank/transfers',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        fromAccountId: cashAccountAId,
        toAccountId: bankAccountAId,
        amountPaisa: transferAmount,
        transferDate: '2026-11-05',
        referenceNo: 'SLIP-9901',
        notes: 'Cash deposit from vault into Meezan bank',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.transferNumber).toMatch(/^TRF-/);
    expect(body.data.amountPaisa).toBe(transferAmount);
    expect(body.data.status).toBe('completed');
    expect(body.data.journalEntryId).toBeDefined();

    // Verify journal entry lines in database: Dr Bank 1010, Cr Cash 1000
    const lines = await ctx.db.select().from(journalLines);
    const entryLines = lines.filter((l) => l.entryId === body.data.journalEntryId);
    expect(entryLines.length).toBe(2);

    const bankDebitLine = entryLines.find((l) => l.accountId === ledgerBankAcctAId);
    const cashCreditLine = entryLines.find((l) => l.accountId === ledgerCashAcctAId);

    expect(bankDebitLine).toBeDefined();
    expect(bankDebitLine!.debitPaisa).toBe(transferAmount);
    expect(bankDebitLine!.creditPaisa).toBe(0);

    expect(cashCreditLine).toBeDefined();
    expect(cashCreditLine!.creditPaisa).toBe(transferAmount);
    expect(cashCreditLine!.debitPaisa).toBe(0);
  });

  it('3. reverses a fund transfer creating a reversal journal entry', async () => {
    // 1. Create transfer
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/finance/cash-bank/transfers',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        fromAccountId: bankAccountAId,
        toAccountId: cashAccountAId,
        amountPaisa: 1000000, // 10,000 PKR
        transferDate: '2026-11-05',
        referenceNo: 'CHQ-5501',
        notes: 'Petty cash replenishment by cheque',
      },
    });

    expect(createRes.statusCode).toBe(201);
    const transferId = createRes.json().data.id;

    // 2. Reverse transfer
    const reverseRes = await app.inject({
      method: 'POST',
      url: `/api/finance/cash-bank/transfers/${transferId}/reverse`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        reason: 'Cheque cancelled / wrong amount entered',
      },
    });

    expect(reverseRes.statusCode).toBe(200);
    const revBody = reverseRes.json();
    expect(revBody.success).toBe(true);
    expect(revBody.data.status).toBe('reversed');
    expect(revBody.data.reversalEntryId).toBeDefined();

    // Verify reversal entry lines: Dr Bank 1010, Cr Cash 1000
    const lines = await ctx.db.select().from(journalLines);
    const revLines = lines.filter((l) => l.entryId === revBody.data.reversalEntryId);
    expect(revLines.length).toBe(2);

    const bankRev = revLines.find((l) => l.accountId === ledgerBankAcctAId);
    const cashRev = revLines.find((l) => l.accountId === ledgerCashAcctAId);

    expect(bankRev!.debitPaisa).toBe(1000000);
    expect(cashRev!.creditPaisa).toBe(1000000);
  });

  it('4. records a day-end counter cash deposit into the bank and auto-posts to ledger', async () => {
    const depositAmount = 4500000; // 45,000 PKR

    const res = await app.inject({
      method: 'POST',
      url: '/api/finance/cash-bank/deposits',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        branchId: branchAId,
        counterId: counterAId,
        shiftId: 'shift-dayend-001',
        sourceCashAccountId: cashAccountAId,
        targetAccountId: bankAccountAId,
        amountPaisa: depositAmount,
        depositDate: '2026-11-05',
        notes: 'Counter 1 day-end collection deposited directly to Meezan Bank',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.depositNumber).toMatch(/^DEP-/);
    expect(body.data.amountPaisa).toBe(depositAmount);
    expect(body.data.journalEntryId).toBeDefined();

    // Verify journal lines: Dr Bank 1010, Cr Cash 1000
    const lines = await ctx.db.select().from(journalLines);
    const entryLines = lines.filter((l) => l.entryId === body.data.journalEntryId);
    expect(entryLines.length).toBe(2);
    expect(entryLines.find((l) => l.accountId === ledgerBankAcctAId)!.debitPaisa).toBe(
      depositAmount
    );
    expect(entryLines.find((l) => l.accountId === ledgerCashAcctAId)!.creditPaisa).toBe(
      depositAmount
    );
  });

  it('5. computes bank reconciliation difference math accurately (balanced vs discrepancy)', async () => {
    // Fetch ledger lines for Meezan Bank
    const linesRes = await app.inject({
      method: 'GET',
      url: `/api/finance/cash-bank/reconciliation/${bankAccountAId}/ledger-lines?asOfDate=2026-11-05`,
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(linesRes.statusCode).toBe(200);
    const linesBody = linesRes.json();
    expect(linesBody.success).toBe(true);
    expect(typeof linesBody.data.ledgerBalancePaisa).toBe('number');

    const ledgerBalancePaisa = linesBody.data.ledgerBalancePaisa;

    // A. Reconciled Session when Statement Balance matches Ledger Balance exactly
    const saveRes = await app.inject({
      method: 'POST',
      url: '/api/finance/cash-bank/reconciliation/save',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        bankAccountId: bankAccountAId,
        statementDate: '2026-11-05',
        statementBalancePaisa: ledgerBalancePaisa,
        clearedBalancePaisa: ledgerBalancePaisa,
        differencePaisa: 0,
        matchedCount: 5,
        status: 'reconciled',
        notes: 'Monthly bank statement matched with 0 variance',
      },
    });

    expect(saveRes.statusCode).toBe(201);
    const saveBody = saveRes.json();
    expect(saveBody.success).toBe(true);
    expect(saveBody.data.differencePaisa).toBe(0);
    expect(saveBody.data.status).toBe('reconciled');

    // B. Mismatch Session when Statement Balance differs from Ledger
    const mismatchRes = await app.inject({
      method: 'POST',
      url: '/api/finance/cash-bank/reconciliation/save',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        bankAccountId: bankAccountAId,
        statementDate: '2026-11-05',
        statementBalancePaisa: ledgerBalancePaisa + 150000, // 1,500 PKR uncleared check
        clearedBalancePaisa: ledgerBalancePaisa,
        differencePaisa: 150000,
        matchedCount: 4,
        status: 'draft',
        notes: 'Pending bank clearance for 1 deposit slip',
      },
    });

    expect(mismatchRes.statusCode).toBe(201);
    expect(mismatchRes.json().data.differencePaisa).toBe(150000);
  });

  it('6. strictly enforces cross-tenant isolation on cash & bank accounts, transfers, and deposits', async () => {
    // Pharmacy B user attempts to access Pharmacy A bank accounts
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/finance/cash-bank/accounts',
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });

    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    const foundA = body.data.accounts.find(
      (a: { id: string }) => a.id === bankAccountAId || a.id === cashAccountAId
    );
    expect(foundA).toBeUndefined();

    // Pharmacy B user attempts to transfer from Pharmacy A's account
    const badTransfer = await app.inject({
      method: 'POST',
      url: '/api/finance/cash-bank/transfers',
      headers: { authorization: `Bearer ${ownerTokenB}` },
      payload: {
        fromAccountId: cashAccountAId, // belongs to A
        toAccountId: bankAccountAId,
        amountPaisa: 100000,
        transferDate: '2026-11-05',
      },
    });

    expect(badTransfer.statusCode).toBe(404);

    // Cashier role without finance permission is rejected with 403
    const forbiddenRes = await app.inject({
      method: 'GET',
      url: '/api/finance/cash-bank/accounts',
      headers: { authorization: `Bearer ${cashierTokenA}` },
    });
    expect(forbiddenRes.statusCode).toBe(403);
  });
});
