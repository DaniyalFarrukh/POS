import { eq, and, gte, lte, lt, asc, sql } from 'drizzle-orm';
import type { DbClient } from '../sync/types';
import { accounts, branches, journalEntries, journalLines } from '../db/schema';
import type { AccountType } from './coa-seed';

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  totalDebitPaisa: number;
  totalCreditPaisa: number;
  netBalancePaisa: number; // debit - credit (signed integer paisa)
}

export interface TrialBalanceResult {
  pharmacyId: string;
  from: string;
  to: string;
  branchId: string | null;
  rows: TrialBalanceRow[];
  totalDebitPaisa: number;
  totalCreditPaisa: number;
  isBalanced: boolean;
}

export interface AccountLedgerLineItem {
  lineId: string;
  entryId: string;
  entryNo: number;
  entryDate: string;
  sourceType: string | null;
  sourceId: string | null;
  entryMemo: string | null;
  lineMemo: string | null;
  branchId: string | null;
  partyType: 'customer' | 'supplier' | 'employee' | null;
  partyId: string | null;
  debitPaisa: number;
  creditPaisa: number;
  runningBalancePaisa: number;
}

export interface AccountLedgerResult {
  accountId: string;
  pharmacyId: string;
  code: string;
  name: string;
  type: AccountType;
  from: string;
  to: string;
  openingBalancePaisa: number;
  totalDebitPaisa: number;
  totalCreditPaisa: number;
  closingBalancePaisa: number;
  lines: AccountLedgerLineItem[];
}

/**
 * Computes the Trial Balance for `[from, to]` (inclusive), optionally scoped to `branchId`.
 * Strictly derived from `journal_lines` joined with `journal_entries` and `accounts`.
 */
export async function trialBalance(
  db: DbClient,
  pharmacyId: string,
  from: string,
  to: string,
  branchId?: string
): Promise<TrialBalanceResult> {
  if (branchId) {
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.pharmacyId, pharmacyId)))
      .limit(1);

    if (!branch) {
      throw new Error('Branch not found or belongs to another pharmacy');
    }
  }

  const lineConditions = [
    eq(journalLines.pharmacyId, pharmacyId),
    eq(journalEntries.pharmacyId, pharmacyId),
    gte(journalEntries.entryDate, from),
    lte(journalEntries.entryDate, to),
  ];

  if (branchId) {
    lineConditions.push(eq(journalLines.branchId, branchId));
  }

  const aggregated = await db
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      totalDebitPaisa: sql<number>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
      totalCreditPaisa: sql<number>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      and(eq(journalLines.entryId, journalEntries.id), eq(journalEntries.pharmacyId, pharmacyId))
    )
    .innerJoin(
      accounts,
      and(eq(journalLines.accountId, accounts.id), eq(accounts.pharmacyId, pharmacyId))
    )
    .where(and(...lineConditions))
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.type)
    .orderBy(asc(accounts.code));

  let totalDebitPaisa = 0;
  let totalCreditPaisa = 0;

  const rows: TrialBalanceRow[] = aggregated.map((r) => {
    const debit = Number(r.totalDebitPaisa);
    const credit = Number(r.totalCreditPaisa);
    totalDebitPaisa += debit;
    totalCreditPaisa += credit;

    return {
      accountId: r.accountId,
      code: r.code,
      name: r.name,
      type: r.type,
      totalDebitPaisa: debit,
      totalCreditPaisa: credit,
      netBalancePaisa: debit - credit,
    };
  });

  return {
    pharmacyId,
    from,
    to,
    branchId: branchId ?? null,
    rows,
    totalDebitPaisa,
    totalCreditPaisa,
    isBalanced: totalDebitPaisa === totalCreditPaisa,
  };
}

/**
 * Computes the General Ledger statement for a single account across `[from, to]`,
 * including opening balance prior to `from`, chronological movements, and running balance.
 * Strictly derived from `journal_lines` joined with `journal_entries`.
 */
export async function accountLedger(
  db: DbClient,
  accountId: string,
  from: string,
  to: string,
  pharmacyId?: string
): Promise<AccountLedgerResult> {
  const accountConds = [eq(accounts.id, accountId)];
  if (pharmacyId) {
    accountConds.push(eq(accounts.pharmacyId, pharmacyId));
  }

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(...accountConds))
    .limit(1);

  if (!account) {
    throw new Error('Account not found or belongs to another pharmacy');
  }

  const resolvedPharmacyId = account.pharmacyId;

  // 1. Opening balance from journal_lines with entry_date < from
  const [openingRow] = await db
    .select({
      debitBefore: sql<number>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
      creditBefore: sql<number>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      and(
        eq(journalLines.entryId, journalEntries.id),
        eq(journalEntries.pharmacyId, resolvedPharmacyId)
      )
    )
    .where(
      and(
        eq(journalLines.pharmacyId, resolvedPharmacyId),
        eq(journalLines.accountId, accountId),
        lt(journalEntries.entryDate, from)
      )
    );

  const openingBalancePaisa =
    Number(openingRow?.debitBefore ?? 0) - Number(openingRow?.creditBefore ?? 0);

  // 2. Lines within [from, to]
  const rawLines = await db
    .select({
      lineId: journalLines.id,
      entryId: journalEntries.id,
      entryNo: journalEntries.entryNo,
      entryDate: journalEntries.entryDate,
      sourceType: journalEntries.sourceType,
      sourceId: journalEntries.sourceId,
      entryMemo: journalEntries.memo,
      lineMemo: journalLines.memo,
      branchId: journalLines.branchId,
      partyType: journalLines.partyType,
      partyId: journalLines.partyId,
      debitPaisa: journalLines.debitPaisa,
      creditPaisa: journalLines.creditPaisa,
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      and(
        eq(journalLines.entryId, journalEntries.id),
        eq(journalEntries.pharmacyId, resolvedPharmacyId)
      )
    )
    .where(
      and(
        eq(journalLines.pharmacyId, resolvedPharmacyId),
        eq(journalLines.accountId, accountId),
        gte(journalEntries.entryDate, from),
        lte(journalEntries.entryDate, to)
      )
    )
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.entryNo), asc(journalLines.id));

  let runningBalancePaisa = openingBalancePaisa;
  let totalDebitPaisa = 0;
  let totalCreditPaisa = 0;

  const lines: AccountLedgerLineItem[] = rawLines.map((row) => {
    const debit = Number(row.debitPaisa);
    const credit = Number(row.creditPaisa);
    totalDebitPaisa += debit;
    totalCreditPaisa += credit;
    runningBalancePaisa += debit - credit;

    return {
      lineId: row.lineId,
      entryId: row.entryId,
      entryNo: Number(row.entryNo),
      entryDate: row.entryDate,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      entryMemo: row.entryMemo,
      lineMemo: row.lineMemo,
      branchId: row.branchId,
      partyType: row.partyType,
      partyId: row.partyId,
      debitPaisa: debit,
      creditPaisa: credit,
      runningBalancePaisa,
    };
  });

  return {
    accountId: account.id,
    pharmacyId: resolvedPharmacyId,
    code: account.code,
    name: account.name,
    type: account.type,
    from,
    to,
    openingBalancePaisa,
    totalDebitPaisa,
    totalCreditPaisa,
    closingBalancePaisa: runningBalancePaisa,
    lines,
  };
}
