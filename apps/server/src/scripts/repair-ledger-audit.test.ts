import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7 } from '@pos/shared';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import { pharmacies, accounts, journalEntries, journalLines } from '../db/schema';
import { seedDefaultChartOfAccounts } from '../ledger/coa-seed';
import { runLedgerRepairScan } from './repair-ledger-audit';
import { eq } from 'drizzle-orm';

describe('Audit Ledger Repair Script (repair-ledger-audit)', () => {
  let ctx: TestDatabaseContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  it('scans and dry-runs anomaly detection, then applies fixes when requested', async () => {
    const pharmacyId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: 'Repair Test Pharmacy',
      code: `REP-${Date.now().toString().slice(-4)}`,
      createdAt: now,
      updatedAt: now,
    });

    await seedDefaultChartOfAccounts(ctx.db, pharmacyId);

    const [arAcc] = await ctx.db
      .select()
      .from(accounts)
      .where(eq(accounts.pharmacyId, pharmacyId))
      .then((accs) => accs.filter((a) => a.code === '1100'));
    const [cashAcc] = await ctx.db
      .select()
      .from(accounts)
      .where(eq(accounts.pharmacyId, pharmacyId))
      .then((accs) => accs.filter((a) => a.code === '1000'));

    // Create an original entry and an erroneous legacy reversing entry with status = 'reversed'
    const origId = generateUuidV7();
    const revId = generateUuidV7();

    await ctx.db.transaction(async (tx) => {
      await tx.insert(journalEntries).values([
        {
          id: origId,
          pharmacyId,
          entryNo: 1,
          entryDate: '2026-11-01',
          sourceType: 'manual',
          status: 'posted',
          memo: 'Original entry',
          createdAt: now,
        },
        {
          id: revId,
          pharmacyId,
          entryNo: 2,
          entryDate: '2026-11-02',
          sourceType: 'reversal',
          status: 'reversed', // Erroneous legacy status
          reversesEntryId: origId,
          memo: 'Reversing entry',
          createdAt: now,
        },
      ]);

      await tx.insert(journalLines).values([
        {
          id: generateUuidV7(),
          entryId: origId,
          pharmacyId,
          accountId: cashAcc!.id,
          debitPaisa: 5000,
          creditPaisa: 0,
        },
        {
          id: generateUuidV7(),
          entryId: origId,
          pharmacyId,
          accountId: arAcc!.id,
          debitPaisa: 0,
          creditPaisa: 5000,
        },
        {
          id: generateUuidV7(),
          entryId: revId,
          pharmacyId,
          accountId: arAcc!.id,
          debitPaisa: 5000,
          creditPaisa: 0,
        },
        {
          id: generateUuidV7(),
          entryId: revId,
          pharmacyId,
          accountId: cashAcc!.id,
          debitPaisa: 0,
          creditPaisa: 5000,
        },
      ]);
    });

    // 1. Diagnostic scan detects legacy reversing entries
    const report = await runLedgerRepairScan(ctx.db, { pharmacyId });
    expect(report.dryRun).toBe(true);
    expect(report.reversalStatusAnomaliesFound).toBe(1);
    expect(report.message).toContain('immutable');
  });
});
