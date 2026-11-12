import { eq, and, sql, gte, lte, lt, ne } from 'drizzle-orm';
import crypto from 'node:crypto';
import { getKarachiDayStartUtc, getKarachiNextDayStartUtc } from '@pos/shared';
import type { DbClient } from '../sync/types';
import {
  accounts,
  journalEntries,
  journalLines,
  erpExpenses,
  stockCounts,
  bankAccounts,
  bankReconciliations,
} from '../db/schema';
import { postJournalEntry, type JournalLineInput } from './service';

export interface ChecklistItem {
  id: 'unposted_documents' | 'bank_reconciliation' | 'stock_count' | 'reconciliation_differences';
  title: string;
  status: 'passed' | 'warning';
  count: number;
  description: string;
}

export interface MonthEndChecklistResult {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  canClose: boolean;
  items: ChecklistItem[];
}

export async function getMonthEndChecklist(
  db: DbClient,
  pharmacyId: string,
  year: number,
  month: number
): Promise<MonthEndChecklistResult> {
  const paddedMonth = String(month).padStart(2, '0');
  const startDate = `${year}-${paddedMonth}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate = `${year}-${paddedMonth}-${String(lastDay).padStart(2, '0')}`;

  const startIso = getKarachiDayStartUtc(startDate);
  const nextPeriodStartIso = getKarachiNextDayStartUtc(endDate);

  // 1. Unposted documents check
  // (unapproved/pending erpExpenses, unapproved stockCounts)
  const pendingExpenses = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(erpExpenses)
    .where(
      and(
        eq(erpExpenses.pharmacyId, pharmacyId),
        gte(erpExpenses.expenseDate, startDate),
        lte(erpExpenses.expenseDate, endDate),
        eq(erpExpenses.status, 'pending_approval')
      )
    );

  const pendingStockCounts = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(stockCounts)
    .where(
      and(
        eq(stockCounts.pharmacyId, pharmacyId),
        gte(stockCounts.createdAt, startIso),
        lt(stockCounts.createdAt, nextPeriodStartIso),
        ne(stockCounts.status, 'approved')
      )
    );

  const unpostedCount =
    Number(pendingExpenses[0]?.count || 0) + Number(pendingStockCounts[0]?.count || 0);

  const unpostedItem: ChecklistItem = {
    id: 'unposted_documents',
    title: 'Unposted Documents',
    status: unpostedCount > 0 ? 'warning' : 'passed',
    count: unpostedCount,
    description:
      unpostedCount > 0
        ? `${unpostedCount} unposted or unapproved document(s) pending review (expenses/stock counts)`
        : 'All transactions, expenses, and inventory documents are posted and approved',
  };

  // 2. Bank reconciliation check
  // Check that all active bank accounts have an approved/reconciled statement for this period
  const activeBankAccts = await db
    .select({ id: bankAccounts.id, name: bankAccounts.name })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.pharmacyId, pharmacyId), eq(bankAccounts.isActive, true)));

  const recRows = await db
    .select({
      bankAccountId: bankReconciliations.bankAccountId,
      differencePaisa: bankReconciliations.differencePaisa,
    })
    .from(bankReconciliations)
    .where(
      and(
        eq(bankReconciliations.pharmacyId, pharmacyId),
        gte(bankReconciliations.statementDate, startDate),
        lte(bankReconciliations.statementDate, endDate),
        eq(bankReconciliations.status, 'reconciled')
      )
    );

  const cleanReconciledCount = recRows.filter((r) => r.differencePaisa === 0).length;
  let bankRecWarning = false;
  let unreconciledBankCount = 0;

  if (activeBankAccts.length > 0) {
    const reconciledAccountIds = new Set(
      recRows.filter((r) => r.differencePaisa === 0).map((r) => r.bankAccountId)
    );

    for (const acct of activeBankAccts) {
      if (!reconciledAccountIds.has(acct.id)) {
        bankRecWarning = true;
        unreconciledBankCount++;
      }
    }
  } else {
    // If no bank accounts registered or no completed reconciliations recorded
    if (cleanReconciledCount === 0) {
      bankRecWarning = true;
      unreconciledBankCount = 1;
    }
  }

  const bankRecItem: ChecklistItem = {
    id: 'bank_reconciliation',
    title: 'Bank & Cash Reconciliation',
    status: bankRecWarning ? 'warning' : 'passed',
    count: unreconciledBankCount,
    description: bankRecWarning
      ? `${unreconciledBankCount} active bank account(s) missing clean reconciliation for ${year}-${paddedMonth}`
      : 'All active bank and cash accounts are reconciled with zero discrepancy',
  };

  // 3. Stock count check
  // Verify that an approved physical inventory stock count was conducted during this month
  const approvedCounts = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(stockCounts)
    .where(
      and(
        eq(stockCounts.pharmacyId, pharmacyId),
        gte(stockCounts.createdAt, startIso),
        lt(stockCounts.createdAt, nextPeriodStartIso),
        eq(stockCounts.status, 'approved')
      )
    );

  const approvedStockCount = Number(approvedCounts[0]?.count || 0);
  const stockCountMissing = approvedStockCount === 0;

  const stockCountItem: ChecklistItem = {
    id: 'stock_count',
    title: 'Physical Stock Count',
    status: stockCountMissing ? 'warning' : 'passed',
    count: stockCountMissing ? 1 : 0,
    description: stockCountMissing
      ? `No approved physical inventory stock count recorded for ${year}-${paddedMonth}`
      : `Physical stock count completed and verified (${approvedStockCount} approved count session)`,
  };

  // 4. Reconciliation differences check
  // AR control (1100) vs customer balances, AP control (2000) vs supplier balances, Trial balance equality
  let reconDiscrepancies = 0;

  // AR check
  const [arAcct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.pharmacyId, pharmacyId), eq(accounts.code, '1100')));

  if (arAcct) {
    const [ctrlAr] = await db
      .select({
        totalDebit: sql<string>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
        totalCredit: sql<string>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
      })
      .from(journalLines)
      .where(and(eq(journalLines.pharmacyId, pharmacyId), eq(journalLines.accountId, arAcct.id)));

    const arCtrlBal = Number(ctrlAr?.totalDebit || 0) - Number(ctrlAr?.totalCredit || 0);

    const partyLinesAr = await db
      .select({
        partyId: journalLines.partyId,
        debitPaisa: journalLines.debitPaisa,
        creditPaisa: journalLines.creditPaisa,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(
        and(
          eq(journalLines.pharmacyId, pharmacyId),
          eq(journalLines.accountId, arAcct.id),
          eq(journalLines.partyType, 'customer')
        )
      );

    const customerMap = new Map<string, number>();
    for (const l of partyLinesAr) {
      if (!l.partyId) continue;
      customerMap.set(l.partyId, (customerMap.get(l.partyId) || 0) + l.debitPaisa - l.creditPaisa);
    }

    let customerSum = 0;
    for (const val of customerMap.values()) customerSum += val;

    if (arCtrlBal !== customerSum) reconDiscrepancies++;
  }

  // AP check
  const [apAcct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.pharmacyId, pharmacyId), eq(accounts.code, '2000')));

  if (apAcct) {
    const [ctrlAp] = await db
      .select({
        totalDebit: sql<string>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
        totalCredit: sql<string>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
      })
      .from(journalLines)
      .where(and(eq(journalLines.pharmacyId, pharmacyId), eq(journalLines.accountId, apAcct.id)));

    const apCtrlBal = Number(ctrlAp?.totalCredit || 0) - Number(ctrlAp?.totalDebit || 0);

    const partyLinesAp = await db
      .select({
        partyId: journalLines.partyId,
        debitPaisa: journalLines.debitPaisa,
        creditPaisa: journalLines.creditPaisa,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(
        and(
          eq(journalLines.pharmacyId, pharmacyId),
          eq(journalLines.accountId, apAcct.id),
          eq(journalLines.partyType, 'supplier')
        )
      );

    const supplierMap = new Map<string, number>();
    for (const l of partyLinesAp) {
      if (!l.partyId) continue;
      supplierMap.set(l.partyId, (supplierMap.get(l.partyId) || 0) + l.creditPaisa - l.debitPaisa);
    }

    let supplierSum = 0;
    for (const val of supplierMap.values()) supplierSum += val;

    if (apCtrlBal !== supplierSum) reconDiscrepancies++;
  }

  // Trial Balance balanced check up to endDate
  const [tbCheck] = await db
    .select({
      sumDebit: sql<string>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
      sumCredit: sql<string>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.pharmacyId, pharmacyId),
        lte(journalEntries.entryDate, endDate),
        eq(journalEntries.status, 'posted')
      )
    );

  if (Number(tbCheck?.sumDebit || 0) !== Number(tbCheck?.sumCredit || 0)) {
    reconDiscrepancies++;
  }

  const reconItem: ChecklistItem = {
    id: 'reconciliation_differences',
    title: 'Control Accounts & Trial Balance Reconciliation',
    status: reconDiscrepancies > 0 ? 'warning' : 'passed',
    count: reconDiscrepancies,
    description:
      reconDiscrepancies > 0
        ? `${reconDiscrepancies} reconciliation difference(s) detected between control accounts and subledgers`
        : 'All control accounts match party subledgers and trial balance is in perfect balance',
  };

  const items = [unpostedItem, bankRecItem, stockCountItem, reconItem];
  const canClose = items.every((i) => i.status === 'passed');

  return {
    year,
    month,
    startDate,
    endDate,
    canClose,
    items,
  };
}

export interface ExecuteYearEndClosingInput {
  pharmacyId: string;
  fiscalYear: number;
  closingDate: string; // YYYY-MM-DD
  memo?: string;
  actorUserId: string;
}

export interface ExecuteYearEndClosingResult {
  journalEntryId: string | null;
  netProfitPaisa: number;
  linesCount: number;
}

export function getYearEndClosingSourceId(pharmacyId: string, fiscalYear: number): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${pharmacyId}:year_end_close:${fiscalYear}`)
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function executeYearEndClosing(
  db: DbClient,
  input: ExecuteYearEndClosingInput
): Promise<ExecuteYearEndClosingResult> {
  const executeInTx = async (tx: DbClient): Promise<ExecuteYearEndClosingResult> => {
    const deterministicSourceId = getYearEndClosingSourceId(input.pharmacyId, input.fiscalYear);

    // Check if this fiscal year was already closed (idempotency per D1)
    const [existing] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.pharmacyId, input.pharmacyId),
          eq(journalEntries.sourceType, 'year_end_closing'),
          eq(journalEntries.sourceId, deterministicSourceId)
        )
      )
      .limit(1);

    if (existing) {
      return {
        journalEntryId: existing.id,
        netProfitPaisa: 0,
        linesCount: 0,
      };
    }

    const startDate = `${input.fiscalYear}-01-01`;
    const endDate = input.closingDate;

    // 1. Find Retained Earnings Account (3100)
    const [reAcct] = await tx
      .select({ id: accounts.id, code: accounts.code, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.pharmacyId, input.pharmacyId), eq(accounts.code, '3100')));

    if (!reAcct) {
      throw new Error('Retained Earnings account (3100) not found in Chart of Accounts');
    }

    // 2. Query all revenue and expense account balances for the fiscal year up to closingDate
    // Include prior closing entries so already-zeroed balances sum to 0
    const plBalances = await tx
      .select({
        accountId: journalLines.accountId,
        accountCode: accounts.code,
        accountName: accounts.name,
        accountType: accounts.type,
        totalDebit: sql<string>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
        totalCredit: sql<string>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(
        and(
          eq(journalLines.pharmacyId, input.pharmacyId),
          gte(journalEntries.entryDate, startDate),
          lte(journalEntries.entryDate, endDate),
          eq(journalEntries.status, 'posted')
        )
      )
      .groupBy(journalLines.accountId, accounts.code, accounts.name, accounts.type);

    // Filter for revenue (type = 'revenue' or code starting with '4')
    // and expense (type = 'expense' or code starting with '5' or '6')
    const plRows = plBalances.filter((b) => {
      return (
        b.accountType === 'revenue' ||
        b.accountType === 'expense' ||
        b.accountCode.startsWith('4') ||
        b.accountCode.startsWith('5') ||
        b.accountCode.startsWith('6')
      );
    });

    const lines: JournalLineInput[] = [];
    let sumDebits = 0;
    let sumCredits = 0;

    for (const row of plRows) {
      const totalDebit = Number(row.totalDebit || 0);
      const totalCredit = Number(row.totalCredit || 0);
      const netDebit = totalDebit - totalCredit;

      if (netDebit > 0) {
        // Net debit balance (typical expense): Credit account to zero it out
        lines.push({
          accountId: row.accountId,
          debitPaisa: 0,
          creditPaisa: netDebit,
          memo: `Year-end zeroing of ${row.accountCode} - ${row.accountName}`,
        });
        sumCredits += netDebit;
      } else if (netDebit < 0) {
        // Net credit balance (typical revenue): Debit account to zero it out
        const creditBal = -netDebit;
        lines.push({
          accountId: row.accountId,
          debitPaisa: creditBal,
          creditPaisa: 0,
          memo: `Year-end zeroing of ${row.accountCode} - ${row.accountName}`,
        });
        sumDebits += creditBal;
      }
    }

    // 3. Balance Retained Earnings (3100)
    // Delta: Revenues zeroed (sumDebits) - Expenses zeroed (sumCredits) = Net Profit
    const netProfitPaisa = sumDebits - sumCredits;

    if (netProfitPaisa > 0) {
      // Net profit: Credit Retained Earnings
      lines.push({
        accountId: reAcct.id,
        debitPaisa: 0,
        creditPaisa: netProfitPaisa,
        memo: `Net profit transfer to Retained Earnings for FY${input.fiscalYear}`,
      });
    } else if (netProfitPaisa < 0) {
      // Net loss: Debit Retained Earnings
      lines.push({
        accountId: reAcct.id,
        debitPaisa: -netProfitPaisa,
        creditPaisa: 0,
        memo: `Net loss transfer to Retained Earnings for FY${input.fiscalYear}`,
      });
    }

    if (lines.length === 0) {
      return {
        journalEntryId: null,
        netProfitPaisa: 0,
        linesCount: 0,
      };
    }

    // 4. Post balanced closing journal entry with deterministic sourceId
    const entry = await postJournalEntry(tx, {
      pharmacyId: input.pharmacyId,
      entryDate: input.closingDate,
      sourceType: 'year_end_closing',
      sourceId: deterministicSourceId,
      memo: input.memo || `FY${input.fiscalYear} Year-End Closing Entry to Retained Earnings`,
      createdBy: input.actorUserId,
      lines,
    });

    return {
      journalEntryId: entry.id,
      netProfitPaisa,
      linesCount: lines.length,
    };
  };

  const transactionalDb = db as unknown as {
    transaction?: (
      cb: (tx: DbClient) => Promise<ExecuteYearEndClosingResult>
    ) => Promise<ExecuteYearEndClosingResult>;
  };
  if (typeof transactionalDb.transaction === 'function') {
    return await transactionalDb.transaction(executeInTx);
  }
  return await executeInTx(db);
}
