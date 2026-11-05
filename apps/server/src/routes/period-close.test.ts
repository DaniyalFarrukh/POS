import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import { generateUuidV7 } from '@pos/shared';
import { signUserToken, signDeviceToken } from '../auth/jwt';
import {
  pharmacies,
  branches,
  counters,
  devices,
  users,
  accounts,
  journalEntries,
  journalLines,
  rejectedEvents,
  erpExpenses,
  expenseCategories,
  stockCounts,
  bankAccounts,
  bankReconciliations,
  products,
  batches,
} from '../db/schema';
import { seedDefaultChartOfAccounts } from '../ledger/coa-seed';

describe('Period Close Module (Checklist, Closed Period Enforcement, Year-End Entries, Reopen)', () => {
  let app: FastifyInstance;
  let ctx: TestDatabaseContext;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchAId: string;
  let counterAId: string;
  let deviceAId: string;
  let ownerAId: string;

  let ownerTokenA: string;
  let accountantTokenA: string;
  let cashierTokenA: string;
  let deviceJwtA: string;

  let salesAccountId: string; // 4000
  let rentAccountId: string; // 6010
  let salariesAccountId: string; // 6000
  let retainedEarningsAccountId: string; // 3100
  let cashAccountId: string; // 1000
  let bankAccountId: string; // 1010
  let testProductId: string;
  let testBatchId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = await buildApp({ db: ctx.db });
    await app.ready();

    pharmacyAId = generateUuidV7();
    pharmacyBId = generateUuidV7();

    // 1. Pharmacies
    await ctx.db.insert(pharmacies).values([
      {
        id: pharmacyAId,
        name: 'Prime Health Care A',
        code: `PRIME_${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: pharmacyBId,
        name: 'Metro Pharmacy B',
        code: `METRO_${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 2. Branches, Counters & Devices
    branchAId = generateUuidV7();
    await ctx.db.insert(branches).values({
      id: branchAId,
      pharmacyId: pharmacyAId,
      name: 'Main Pharmacy Branch',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    counterAId = generateUuidV7();
    await ctx.db.insert(counters).values({
      id: counterAId,
      pharmacyId: pharmacyAId,
      branchId: branchAId,
      code: 'CTR-01',
      name: 'Counter 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    deviceAId = generateUuidV7();
    await ctx.db.insert(devices).values({
      id: deviceAId,
      pharmacyId: pharmacyAId,
      branchId: branchAId,
      counterId: counterAId,
      deviceName: 'Counter 1 POS Device',
      isRevoked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    testProductId = generateUuidV7();
    await ctx.db.insert(products).values({
      id: testProductId,
      pharmacyId: pharmacyAId,
      brandName: 'Panadol 500mg',
      genericName: 'Paracetamol',
      mrpPaisa: 10000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    testBatchId = generateUuidV7();
    await ctx.db.insert(batches).values({
      id: testBatchId,
      pharmacyId: pharmacyAId,
      productId: testProductId,
      batchNo: 'B-2026-001',
      expiryDate: '2027-12-31',
      costPaisa: 6000,
      mrpPaisa: 10000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 3. Chart of Accounts
    await seedDefaultChartOfAccounts(ctx.db, pharmacyAId);
    await seedDefaultChartOfAccounts(ctx.db, pharmacyBId);

    const allAcctsA = await ctx.db.select().from(accounts);
    salesAccountId = allAcctsA.find((a) => a.pharmacyId === pharmacyAId && a.code === '4000')!.id;
    rentAccountId = allAcctsA.find((a) => a.pharmacyId === pharmacyAId && a.code === '6010')!.id;
    salariesAccountId = allAcctsA.find(
      (a) => a.pharmacyId === pharmacyAId && a.code === '6000'
    )!.id;
    retainedEarningsAccountId = allAcctsA.find(
      (a) => a.pharmacyId === pharmacyAId && a.code === '3100'
    )!.id;
    cashAccountId = allAcctsA.find((a) => a.pharmacyId === pharmacyAId && a.code === '1000')!.id;
    bankAccountId = allAcctsA.find((a) => a.pharmacyId === pharmacyAId && a.code === '1010')!.id;

    // 4. Users
    ownerAId = generateUuidV7();
    const accountantAId = generateUuidV7();
    const cashierAId = generateUuidV7();
    const ownerBId = generateUuidV7();

    await ctx.db.insert(users).values([
      {
        id: ownerAId,
        pharmacyId: pharmacyAId,
        name: 'Owner Farooq',
        role: 'owner' as const,
        pinHash: 'dummy',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: accountantAId,
        pharmacyId: pharmacyAId,
        name: 'Accountant Tariq',
        role: 'accountant' as const,
        pinHash: 'dummy',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: cashierAId,
        pharmacyId: pharmacyAId,
        name: 'Cashier Salman',
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
      name: 'Owner Farooq',
    });
    accountantTokenA = signUserToken({
      userId: accountantAId,
      pharmacyId: pharmacyAId,
      role: 'accountant',
      name: 'Accountant Tariq',
    });
    cashierTokenA = signUserToken({
      userId: cashierAId,
      pharmacyId: pharmacyAId,
      role: 'cashier',
      name: 'Cashier Salman',
    });

    deviceJwtA = signDeviceToken({
      deviceId: deviceAId,
      pharmacyId: pharmacyAId,
      branchId: branchAId,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Month-end checklist: detects unapproved expenses, missing bank rec, unapproved stock counts', async () => {
    // 1. Seed an unapproved expense for January 2026
    const catId = generateUuidV7();
    await ctx.db.insert(expenseCategories).values({
      id: catId,
      pharmacyId: pharmacyAId,
      name: 'Office Supplies',
      accountId: rentAccountId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await ctx.db.insert(erpExpenses).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      branchId: branchAId,
      categoryId: catId,
      expenseNumber: 'EXP-2026-001',
      expenseDate: '2026-01-10',
      amountPaisa: 3000000,
      paymentType: 'paid',
      paymentMethod: 'cash',
      status: 'pending_approval', // Pending approval!
      notes: 'Pending manager approval',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 2. Query month-end checklist for 2026-01
    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/periods/checklist?year=2026&month=1',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.year).toBe(2026);
    expect(body.data.month).toBe(1);

    // Verify unposted/unapproved item detected
    const unpostedItem = body.data.items.find((i: { id: string }) => i.id === 'unposted_documents');
    expect(unpostedItem).toBeDefined();
    expect(unpostedItem.status).toBe('warning');
    expect(unpostedItem.count).toBeGreaterThanOrEqual(1);

    // Verify bank reconciliation missing
    const bankRecItem = body.data.items.find((i: { id: string }) => i.id === 'bank_reconciliation');
    expect(bankRecItem).toBeDefined();
    expect(bankRecItem.status).toBe('warning');

    // Verify stock count missing
    const stockCountItem = body.data.items.find((i: { id: string }) => i.id === 'stock_count');
    expect(stockCountItem).toBeDefined();
    expect(stockCountItem.status).toBe('warning');
  });

  it('2. Month-end checklist: passes cleanly when documents are posted and reconciliations match', async () => {
    // 1. Seed an active bank account & completed reconciliation with 0 difference
    const bankAcctId = generateUuidV7();
    await ctx.db.insert(bankAccounts).values({
      id: bankAcctId,
      pharmacyId: pharmacyAId,
      name: 'Meezan Bank - Main Account',
      type: 'bank',
      accountId: rentAccountId,
      openingBalancePaisa: 10000000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await ctx.db.insert(bankReconciliations).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      bankAccountId: bankAcctId,
      statementDate: '2026-02-28',
      statementBalancePaisa: 10000000,
      ledgerBalancePaisa: 10000000,
      clearedBalancePaisa: 10000000,
      differencePaisa: 0,
      matchedCount: 5,
      status: 'reconciled',
      createdBy: ownerAId,
      createdAt: new Date().toISOString(),
      reconciledAt: new Date().toISOString(),
    });

    // 2. Seed an approved stock count for February 2026
    await ctx.db.insert(stockCounts).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      branchId: branchAId,
      countNumber: 'SC-2026-001',
      status: 'approved',
      createdAt: '2026-02-20T10:00:00.000Z',
      approvedAt: '2026-02-20T11:00:00.000Z',
      updatedAt: '2026-02-20T11:00:00.000Z',
    });

    // 3. Query checklist for February 2026
    const res = await app.inject({
      method: 'GET',
      url: '/api/finance/periods/checklist?year=2026&month=2',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    const bankItem = body.data.items.find((i: { id: string }) => i.id === 'bank_reconciliation');
    expect(bankItem.status).toBe('passed');

    const stockItem = body.data.items.find((i: { id: string }) => i.id === 'stock_count');
    expect(stockItem.status).toBe('passed');

    const reconItem = body.data.items.find(
      (i: { id: string }) => i.id === 'reconciliation_differences'
    );
    expect(reconItem.status).toBe('passed');
  });

  it('3. Closing a period blocks direct postings and sync events into it; late sync events log to rejected_events', async () => {
    // 1. Close March 2026 (2026-03-01 to 2026-03-31)
    const closeRes = await app.inject({
      method: 'POST',
      url: '/api/finance/periods/close',
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        reason: 'March month-end close',
      },
    });

    expect(closeRes.statusCode).toBe(200);
    const period = closeRes.json().period;
    expect(period.status).toBe('closed');
    expect(period.closedAt).toBeDefined();

    // 2. Attempt to post a manual journal entry inside the closed period (2026-03-15) -> Fails with 400
    const journalRes = await app.inject({
      method: 'POST',
      url: '/api/finance/journals',
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        entryDate: '2026-03-15',
        memo: 'Attempted late posting in closed March',
        lines: [
          { accountId: bankAccountId, debitPaisa: 500000, creditPaisa: 0 },
          { accountId: cashAccountId, debitPaisa: 0, creditPaisa: 500000 },
        ],
      },
    });

    expect(journalRes.statusCode).toBe(400);
    expect(journalRes.json().message).toContain('is closed');

    // 3. Attempt to push a sync event dated in the closed period via /sync/push
    // The sync engine must reject it, roll back, and record in rejected_events so it is not lost
    const lateInvoiceEventId = generateUuidV7();
    const lateInvoiceId = generateUuidV7();
    const syncRes = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: {
        authorization: `Bearer ${deviceJwtA}`,
      },
      payload: {
        events: [
          {
            eventId: lateInvoiceEventId,
            deviceSeq: 1,
            type: 'invoice.created',
            entityId: lateInvoiceId,
            occurredAt: '2026-03-15T10:00:00.000Z',
            schemaVersion: 1,
            payload: {
              id: lateInvoiceId,
              counterId: counterAId,
              cashierUserId: ownerAId,
              invoiceNumber: 'INV-LATE-001',
              clientRequestId: generateUuidV7(),
              status: 'finalized',
              subtotalPaisa: 10000,
              discountPaisa: 0,
              taxPaisa: 0,
              totalPaisa: 10000,
              createdAt: '2026-03-15T10:00:00.000Z',
              lines: [
                {
                  id: generateUuidV7(),
                  productId: testProductId,
                  batchId: testBatchId,
                  quantity: 1,
                  unitPricePaisa: 10000,
                  discountPaisa: 0,
                  taxRateBp: 0,
                  taxPaisa: 0,
                  lineTotalPaisa: 10000,
                },
              ],
              payments: [
                {
                  id: generateUuidV7(),
                  method: 'cash' as const,
                  amountPaisa: 10000,
                },
              ],
            },
          },
        ],
      },
    });

    expect(syncRes.statusCode).toBe(200);
    const syncBody = syncRes.json();
    // One rejected event
    expect(syncBody.results[0].status).toBe('rejected');

    // Verify rejected_events table in Postgres recorded the late event with clear error
    const rejectedRows = await ctx.db
      .select()
      .from(rejectedEvents)
      .where(eq(rejectedEvents.pharmacyId, pharmacyAId));
    const lateRejected = rejectedRows.find(
      (r) => (r.event as Record<string, unknown>)?.eventId === lateInvoiceEventId
    );
    expect(lateRejected).toBeDefined();
    expect(lateRejected?.code).toBe('LEDGER_POSTING_FAILED');
    expect(lateRejected?.message).toContain('is closed');
  });

  it('4. Reopening a closed period requires a reason, logs audit info, and unblocks postings', async () => {
    // 1. Fetch closed March period
    const periodsRes = await app.inject({
      method: 'GET',
      url: '/api/finance/periods',
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });
    const marchPeriod = periodsRes
      .json()
      .items.find((p: { startDate: string }) => p.startDate === '2026-03-01')!;

    // 2. Reopen March with mandatory reason
    const reopenRes = await app.inject({
      method: 'POST',
      url: `/api/finance/periods/${marchPeriod.id}/reopen`,
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        reason: 'Audit correction required for late supplier invoices',
      },
    });

    expect(reopenRes.statusCode).toBe(200);
    const reopened = reopenRes.json().period;
    expect(reopened.status).toBe('open');
    expect(reopened.reopenedAt).toBeDefined();
    expect(reopened.reopenReason).toContain('Audit correction');

    // 3. Postings on 2026-03-15 now succeed
    const postAgain = await app.inject({
      method: 'POST',
      url: '/api/finance/journals',
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        entryDate: '2026-03-15',
        memo: 'Correction posting in reopened March',
        lines: [
          { accountId: bankAccountId, debitPaisa: 500000, creditPaisa: 0 },
          { accountId: cashAccountId, debitPaisa: 0, creditPaisa: 500000 },
        ],
      },
    });

    expect(postAgain.statusCode).toBe(201);
  });

  it('5. Year-end closing entries: zeroes out all P&L accounts and transfers net profit to Retained Earnings (3100)', async () => {
    // 1. Seed Revenue (Sales 4000: Cr 50,000,000 paisa)
    // and Expenses (Rent 6010: Dr 12,000,000 paisa; Salaries 6000: Dr 20,000,000 paisa)
    // Net Profit = 50,000,000 - 32,000,000 = 18,000,000 paisa (180,000 PKR)
    const revEntryId = generateUuidV7();
    const expEntryId = generateUuidV7();

    await ctx.db.transaction(async (tx) => {
      // Revenue entry
      await tx.insert(journalEntries).values({
        id: revEntryId,
        pharmacyId: pharmacyAId,
        entryNo: 100,
        entryDate: '2026-06-15',
        sourceType: 'manual_journal',
        sourceId: revEntryId,
        memo: 'H1 2026 Sales Revenue',
        status: 'posted',
        createdAt: new Date().toISOString(),
      });
      await tx.insert(journalLines).values([
        {
          id: generateUuidV7(),
          entryId: revEntryId,
          pharmacyId: pharmacyAId,
          accountId: cashAccountId,
          branchId: branchAId,
          debitPaisa: 50000000,
          creditPaisa: 0,
        },
        {
          id: generateUuidV7(),
          entryId: revEntryId,
          pharmacyId: pharmacyAId,
          accountId: salesAccountId,
          branchId: branchAId,
          debitPaisa: 0,
          creditPaisa: 50000000,
        },
      ]);

      // Expense entry
      await tx.insert(journalEntries).values({
        id: expEntryId,
        pharmacyId: pharmacyAId,
        entryNo: 101,
        entryDate: '2026-06-30',
        sourceType: 'manual_journal',
        sourceId: expEntryId,
        memo: 'H1 2026 Operating Expenses',
        status: 'posted',
        createdAt: new Date().toISOString(),
      });
      await tx.insert(journalLines).values([
        {
          id: generateUuidV7(),
          entryId: expEntryId,
          pharmacyId: pharmacyAId,
          accountId: rentAccountId,
          branchId: branchAId,
          debitPaisa: 12000000,
          creditPaisa: 0,
        },
        {
          id: generateUuidV7(),
          entryId: expEntryId,
          pharmacyId: pharmacyAId,
          accountId: salariesAccountId,
          branchId: branchAId,
          debitPaisa: 20000000,
          creditPaisa: 0,
        },
        {
          id: generateUuidV7(),
          entryId: expEntryId,
          pharmacyId: pharmacyAId,
          accountId: cashAccountId,
          branchId: branchAId,
          debitPaisa: 0,
          creditPaisa: 32000000,
        },
      ]);
    });

    // 2. Call year-end closing endpoint
    const closeYearRes = await app.inject({
      method: 'POST',
      url: '/api/finance/periods/year-end-closing',
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        fiscalYear: 2026,
        closingDate: '2026-12-31',
        memo: 'FY 2026 Year-End Closing Entry to Retained Earnings',
      },
    });

    expect(closeYearRes.statusCode).toBe(200);
    const body = closeYearRes.json();
    expect(body.success).toBe(true);
    expect(body.data.netProfitPaisa).toBe(18000000);
    expect(body.data.journalEntryId).toBeDefined();

    // 3. Query trial balance up to 2026-12-31:
    // Sales (4000) net balance must be exactly 0
    // Rent (6010) net balance must be exactly 0
    // Salaries (6000) net balance must be exactly 0
    // Retained Earnings (3100) closing credit must equal 18,000,000 paisa
    const tbRes = await app.inject({
      method: 'GET',
      url: '/api/finance/reports/trial-balance?startDate=2026-01-01&endDate=2026-12-31',
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });

    expect(tbRes.statusCode).toBe(200);
    const tb = tbRes.json().data;
    expect(tb.summary.isBalanced).toBe(true);

    const salesRow = tb.accounts.find((a: { accountId: string }) => a.accountId === salesAccountId);
    expect(salesRow.closingDebitPaisa).toBe(0);
    expect(salesRow.closingCreditPaisa).toBe(0);

    const rentRow = tb.accounts.find((a: { accountId: string }) => a.accountId === rentAccountId);
    expect(rentRow.closingDebitPaisa).toBe(0);
    expect(rentRow.closingCreditPaisa).toBe(0);

    const salRow = tb.accounts.find(
      (a: { accountId: string }) => a.accountId === salariesAccountId
    );
    expect(salRow.closingDebitPaisa).toBe(0);
    expect(salRow.closingCreditPaisa).toBe(0);

    const reRow = tb.accounts.find(
      (a: { accountId: string }) => a.accountId === retainedEarningsAccountId
    );
    expect(reRow.closingCreditPaisa).toBe(18000000); // 180,000 PKR credited to Retained Earnings!
  });

  it('6. Enforces permissions: owner only for close, reopen, year-end; accountant can view checklist; cashier blocked', async () => {
    // Cashier blocked from checklist
    const cshChecklist = await app.inject({
      method: 'GET',
      url: '/api/finance/periods/checklist?year=2026&month=1',
      headers: { authorization: `Bearer ${cashierTokenA}` },
    });
    expect(cshChecklist.statusCode).toBe(403);

    // Accountant allowed on checklist
    const acctChecklist = await app.inject({
      method: 'GET',
      url: '/api/finance/periods/checklist?year=2026&month=1',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(acctChecklist.statusCode).toBe(200);

    // Accountant blocked from year-end closing (owner only)
    const acctYearEnd = await app.inject({
      method: 'POST',
      url: '/api/finance/periods/year-end-closing',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: { fiscalYear: 2026, closingDate: '2026-12-31' },
    });
    expect(acctYearEnd.statusCode).toBe(403);

    // Accountant blocked from closing period (owner only)
    const acctClose = await app.inject({
      method: 'POST',
      url: '/api/finance/periods/close',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: { startDate: '2026-04-01', endDate: '2026-04-30' },
    });
    expect(acctClose.statusCode).toBe(403);
  });

  it('7. Tenant isolation: Pharmacy A cannot view checklist or close periods of Pharmacy B', async () => {
    // Pharmacy A attempts to close period for Pharmacy B
    const tamperClose = await app.inject({
      method: 'POST',
      url: '/api/finance/periods/close',
      headers: { authorization: `Bearer ${ownerTokenA}` },
      payload: {
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        pharmacyId: pharmacyBId, // Injected foreign tenant
      },
    });

    expect(tamperClose.statusCode).toBe(200);
    // Period created must belong to Pharmacy A, NEVER Pharmacy B
    expect(tamperClose.json().pharmacyId).toBe(pharmacyAId);
    expect(tamperClose.json().period.pharmacyId).toBe(pharmacyAId);
  });
});
