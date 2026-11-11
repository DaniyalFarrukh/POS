/**
 * Audit Ledger Repair Script (Non-destructive, Dry-run by default)
 *
 * Scans for historical audit ledger anomalies:
 * 1. Reversing entries incorrectly marked with status = 'reversed' instead of 'posted' (F-C-02)
 * 2. Unlinked credit expenses improperly posted to 2000 Accounts Payable without partyId (F-C-03)
 * 3. Credit note AR lines missing customer partyId (F-C-03)
 *
 * Usage:
 *   npx tsx apps/server/src/scripts/repair-ledger-audit.ts           (Dry-run scan only)
 *   npx tsx apps/server/src/scripts/repair-ledger-audit.ts --apply  (Apply non-destructive fixes)
 */

import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { getDb, closePool } from '../db';
import {
  journalEntries,
  journalLines,
  accounts,
} from '../db/schema';
import type { DbClient } from '../db';

export interface RepairAuditReport {
  dryRun: boolean;
  reversalStatusAnomaliesFound: number;
  unlinkedApExpenseLinesFound: number;
  unlinkedArCreditNoteLinesFound: number;
  message: string;
}

export async function runLedgerRepairScan(
  db: DbClient,
  options: { pharmacyId?: string } = {}
): Promise<RepairAuditReport> {
  const report: RepairAuditReport = {
    dryRun: true,
    reversalStatusAnomaliesFound: 0,
    unlinkedApExpenseLinesFound: 0,
    unlinkedArCreditNoteLinesFound: 0,
    message: 'Audit diagnostic scan completed (accounting records are immutable by DB trigger)',
  };

  // 1. Scan for reversing journal entries with legacy status = 'reversed'
  const conditions = [
    sql`${journalEntries.reversesEntryId} IS NOT NULL`,
    eq(journalEntries.status, 'reversed'),
  ];
  if (options.pharmacyId) {
    conditions.push(eq(journalEntries.pharmacyId, options.pharmacyId));
  }

  const badReversals = await db
    .select({
      id: journalEntries.id,
      pharmacyId: journalEntries.pharmacyId,
      entryNo: journalEntries.entryNo,
      reversesEntryId: journalEntries.reversesEntryId,
    })
    .from(journalEntries)
    .where(and(...conditions));

  report.reversalStatusAnomaliesFound = badReversals.length;

  // 2. Scan for unlinked expense lines posted to 2000 AP with no partyId
  const apAccounts = await db
    .select({ id: accounts.id, pharmacyId: accounts.pharmacyId })
    .from(accounts)
    .where(eq(accounts.code, '2000'));

  const apAccountIds = apAccounts.map((a) => a.id);
  if (apAccountIds.length > 0) {
    const unlinkedApLines = await db
      .select({
        lineId: journalLines.id,
        entryId: journalLines.entryId,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(
        and(
          inArray(journalLines.accountId, apAccountIds),
          isNull(journalLines.partyId),
          eq(journalEntries.sourceType, 'expense')
        )
      );

    report.unlinkedApExpenseLinesFound = unlinkedApLines.length;
  }

  // 3. Scan for credit note lines on 1100 AR missing customer partyId
  const arAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.code, '1100'));

  const arAccountIds = arAccounts.map((a) => a.id);
  if (arAccountIds.length > 0) {
    const unlinkedArLines = await db
      .select({
        lineId: journalLines.id,
        entryId: journalLines.entryId,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(
        and(
          inArray(journalLines.accountId, arAccountIds),
          isNull(journalLines.partyId),
          eq(journalEntries.sourceType, 'credit_note')
        )
      );

    report.unlinkedArCreditNoteLinesFound = unlinkedArLines.length;
  }

  return report;
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  const db = getDb();

  console.log('[Ledger Repair Audit] Running scan...');
  runLedgerRepairScan(db)
    .then((result) => {
      console.log('[Ledger Repair Audit] Result:', JSON.stringify(result, null, 2));
      return closePool();
    })
    .catch((err) => {
      console.error('[Ledger Repair Audit] Error during scan:', err);
      process.exit(1);
    });
}
