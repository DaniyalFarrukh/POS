import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7 } from '@pos/shared';
import { isPostgresReachable, createTestContext, type TestDatabaseContext } from '../db/test-helper';
import { pharmacies, branches, accounts, journalEntries } from '../db/schema';
import { seedDefaultChartOfAccounts } from './coa-seed';
import { postJournalEntry, reverseJournalEntry } from './service';
import { executeYearEndClosing, getMonthEndChecklist } from './period-close';
import { eq, and } from 'drizzle-orm';

describe('F-C-02: Reversal Accounting (D1) and Year-End Closing Idempotency', () => {
  let ctx: TestDatabaseContext;

  beforeAll(async () => {
    const reachable = await isPostgresReachable();
    if (!reachable) {
      throw new Error('PostgreSQL must be running for ledger tests.');
    }
    ctx = await createTestContext();
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  it('F-C-02: reverseJournalEntry inserts reversing entry with status=posted and nets to zero in subledgers and month-end checklist', async () => {
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: 'Reversal Test Pharmacy',
      code: `REV-${Date.now().toString().slice(-4)}`,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(branches).values({
      id: branchId,
      pharmacyId,
      name: 'Main Branch',
      createdAt: now,
      updatedAt: now,
    });

    await seedDefaultChartOfAccounts(ctx.db, pharmacyId);
    const coa = await ctx.db
      .select()
      .from(accounts)
      .where(eq(accounts.pharmacyId, pharmacyId));
    const cashAcc = coa.find((a) => a.code === '1000')!;
    const arAcc = coa.find((a) => a.code === '1100')!;

    const customerId = generateUuidV7();

    // 1. Post a customer receipt: Dr Cash (1000) / Cr AR (1100)
    const originalEntry = await ctx.db.transaction((tx) =>
      postJournalEntry(tx, {
        pharmacyId,
        entryDate: '2026-10-15',
        sourceType: 'payment',
        sourceId: generateUuidV7(),
        memo: 'Customer cash receipt',
        lines: [
          {
            accountId: cashAcc.id,
            debitPaisa: 50_000,
            creditPaisa: 0,
            branchId,
            memo: 'Cash received',
          },
          {
            accountId: arAcc.id,
            debitPaisa: 0,
            creditPaisa: 50_000,
            branchId,
            partyType: 'customer',
            partyId: customerId,
            memo: 'Credit to customer AR',
          },
        ],
      })
    );

    expect(originalEntry.status).toBe('posted');

    // 2. Reverse the entry (bounced check or correction)
    const reversal = await ctx.db.transaction((tx) =>
      reverseJournalEntry(
        tx,
        originalEntry.id,
        'Bounced payment receipt reversal',
        {
          pharmacyId,
          reversalDate: '2026-10-16',
        }
      )
    );

    // Per D1: reversing entry must have status 'posted' (NOT 'reversed')
    expect(reversal.status).toBe('posted');
    expect(reversal.reversesEntryId).toBe(originalEntry.id);

    // Verify in database directly
    const [persistedReversal] = await ctx.db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, reversal.id));
    expect(persistedReversal?.status).toBe('posted');

    // Verify month-end checklist reconciliation differences = 0
    const checklist = await getMonthEndChecklist(ctx.db, pharmacyId, 2026, 10);
    const recon = checklist.items.find((i) => i.id === 'reconciliation_differences')!;
    expect(recon.status).toBe('passed');
    expect(recon.count).toBe(0);
  });

  it('F-C-02: executeYearEndClosing is idempotent and uses deterministic source_id per fiscal year', async () => {
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: 'Year-End Pharmacy',
      code: `YEC-${Date.now().toString().slice(-4)}`,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(branches).values({
      id: branchId,
      pharmacyId,
      name: 'Main Branch',
      createdAt: now,
      updatedAt: now,
    });

    await seedDefaultChartOfAccounts(ctx.db, pharmacyId);
    const coa = await ctx.db
      .select()
      .from(accounts)
      .where(eq(accounts.pharmacyId, pharmacyId));
    const cashAcc = coa.find((a) => a.code === '1000')!;
    const salesAcc = coa.find((a) => a.code === '4000')!;
    const cogsAcc = coa.find((a) => a.code === '5000')!;
    const rentAcc = coa.find((a) => a.code === '6010')!;
    const reAcc = coa.find((a) => a.code === '3100')!;
    expect(reAcc.id).toBeDefined();

    // Post Sales: Dr Cash 200,000 / Cr Sales 200,000
    await ctx.db.transaction((tx) =>
      postJournalEntry(tx, {
        pharmacyId,
        entryDate: '2026-06-01',
        sourceType: 'invoice',
        sourceId: generateUuidV7(),
        memo: 'Sale',
        lines: [
          { accountId: cashAcc.id, debitPaisa: 200_000, creditPaisa: 0, branchId },
          { accountId: salesAcc.id, debitPaisa: 0, creditPaisa: 200_000, branchId },
        ],
      })
    );

    // Post Expenses: Dr COGS 80,000 / Dr Rent 40,000 / Cr Cash 120,000
    await ctx.db.transaction((tx) =>
      postJournalEntry(tx, {
        pharmacyId,
        entryDate: '2026-06-02',
        sourceType: 'expense',
        sourceId: generateUuidV7(),
        memo: 'Expenses',
        lines: [
          { accountId: cogsAcc.id, debitPaisa: 80_000, creditPaisa: 0, branchId },
          { accountId: rentAcc.id, debitPaisa: 40_000, creditPaisa: 0, branchId },
          { accountId: cashAcc.id, debitPaisa: 0, creditPaisa: 120_000, branchId },
        ],
      })
    );

    // Net profit = 200,000 - 80,000 - 40,000 = 80,000 paisa
    const firstClose = await executeYearEndClosing(ctx.db, {
      pharmacyId,
      fiscalYear: 2026,
      closingDate: '2026-12-31',
      memo: 'FY2026 Year-End Close',
    });

    expect(firstClose.netProfitPaisa).toBe(80_000);
    expect(firstClose.journalEntryId).toBeTruthy();

    // Verify closing entry lines in Retained Earnings
    const [reClosingLine] = await ctx.db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.pharmacyId, pharmacyId),
          eq(journalEntries.sourceType, 'year_end_closing')
        )
      );
    expect(reClosingLine).toBeDefined();

    // Second call for the SAME fiscal year must be idempotent (no duplicate entry created)
    const secondClose = await executeYearEndClosing(ctx.db, {
      pharmacyId,
      fiscalYear: 2026,
      closingDate: '2026-12-31',
      memo: 'FY2026 Year-End Close Second Attempt',
    });

    expect(secondClose.netProfitPaisa).toBe(0);
    expect(secondClose.linesCount).toBe(0);

    // Verify total year_end_closing entries is still exactly 1
    const closingEntries = await ctx.db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.pharmacyId, pharmacyId),
          eq(journalEntries.sourceType, 'year_end_closing')
        )
      );
    expect(closingEntries.length).toBe(1);
  });
});
