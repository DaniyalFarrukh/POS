import { eq, and, sql, inArray, asc } from 'drizzle-orm';
import type { DbClient } from '../sync/types';
import { generateUuidV7 } from '@pos/shared';
import { budgets, accounts, branches, journalEntries, journalLines } from '../db/schema';

export interface BudgetFilter {
  fiscalYear: number;
  month?: number | null; // 1-12 or null for whole year
  branchId?: string | null;
  accountId?: string | null;
  accountType?: 'expense' | 'revenue' | null;
}

export interface BudgetBatchItem {
  accountId: string;
  month: number; // 1-12
  amountPaisa: number;
  notes?: string | null;
}

export interface BatchUpsertBudgetInput {
  pharmacyId: string;
  branchId: string;
  fiscalYear: number;
  userId?: string | null;
  items: BudgetBatchItem[];
}

export interface CopyPreviousYearBudgetInput {
  pharmacyId: string;
  sourceYear: number;
  targetYear: number;
  branchId?: string | null;
  percentageAdjustmentBp?: number; // e.g. 1000 bp = +10%
  overwrite?: boolean;
  userId?: string | null;
}

export interface ActualVsBudgetRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: 'expense' | 'revenue';
  branchId: string | null;
  branchName: string | null;
  budgetPaisa: number;
  actualPaisa: number;
  variancePaisa: number;
  varianceBp: number;
  percentageUsed: number;
  alertStatus: 'normal' | 'warning' | 'exceeded' | 'under' | 'on_track' | 'achieved';
}

export interface BudgetAlert {
  accountId: string;
  accountCode: string;
  accountName: string;
  branchId: string | null;
  branchName: string | null;
  budgetPaisa: number;
  actualPaisa: number;
  percentageUsed: number;
  level: 'warning' | 'exceeded';
}

export interface BudgetSummaryKPIs {
  totalExpenseBudgetPaisa: number;
  totalExpenseActualPaisa: number;
  totalExpenseVariancePaisa: number;
  totalRevenueBudgetPaisa: number;
  totalRevenueActualPaisa: number;
  totalRevenueVariancePaisa: number;
  netBudgetPaisa: number;
  netActualPaisa: number;
  netVariancePaisa: number;
  alertCount: number;
}

export interface ActualVsBudgetResult {
  pharmacyId: string;
  fiscalYear: number;
  month: number | null;
  branchId: string | null;
  branchName: string | null;
  summary: BudgetSummaryKPIs;
  alerts: BudgetAlert[];
  rows: ActualVsBudgetRow[];
}

/**
 * Get stored budget lines with joined account and branch info
 */
export async function getBudgets(db: DbClient, pharmacyId: string, filter: BudgetFilter) {
  const conditions = [
    eq(budgets.pharmacyId, pharmacyId),
    eq(budgets.fiscalYear, filter.fiscalYear),
  ];

  if (filter.month) {
    conditions.push(eq(budgets.month, filter.month));
  }
  if (filter.branchId) {
    conditions.push(eq(budgets.branchId, filter.branchId));
  }
  if (filter.accountId) {
    conditions.push(eq(budgets.accountId, filter.accountId));
  }

  const rows = await db
    .select({
      id: budgets.id,
      pharmacyId: budgets.pharmacyId,
      branchId: budgets.branchId,
      branchName: branches.name,
      accountId: budgets.accountId,
      accountCode: accounts.code,
      accountName: accounts.name,
      accountType: accounts.type,
      fiscalYear: budgets.fiscalYear,
      month: budgets.month,
      amountPaisa: budgets.amountPaisa,
      notes: budgets.notes,
      createdAt: budgets.createdAt,
      updatedAt: budgets.updatedAt,
    })
    .from(budgets)
    .innerJoin(accounts, eq(budgets.accountId, accounts.id))
    .innerJoin(branches, eq(budgets.branchId, branches.id))
    .where(and(...conditions))
    .orderBy(asc(accounts.code), asc(budgets.month));

  return rows;
}

/**
 * Batch upserts monthly budget rows for an account/branch in a given fiscal year
 */
export async function batchUpsertBudgets(db: DbClient, input: BatchUpsertBudgetInput) {
  if (input.items.length === 0) {
    return { count: 0 };
  }

  const now = new Date().toISOString();

  // Validate that branch belongs to pharmacy
  const [branch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, input.branchId), eq(branches.pharmacyId, input.pharmacyId)))
    .limit(1);

  if (!branch) {
    throw new Error('Branch not found or does not belong to pharmacy');
  }

  // Validate accounts belong to pharmacy and are expense or revenue
  const accountIds = Array.from(new Set(input.items.map((i) => i.accountId)));
  const validAccounts = await db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.pharmacyId, input.pharmacyId), inArray(accounts.id, accountIds)));

  const validAccountMap = new Map(validAccounts.map((a) => [a.id, a.type]));
  for (const item of input.items) {
    const acctType = validAccountMap.get(item.accountId);
    if (!acctType || (acctType !== 'expense' && acctType !== 'revenue')) {
      throw new Error(`Account ${item.accountId} is invalid or not an expense/revenue account`);
    }
    if (item.month < 1 || item.month > 12) {
      throw new Error(`Month must be between 1 and 12 (received ${item.month})`);
    }
    if (item.amountPaisa < 0) {
      throw new Error(`Budget amount cannot be negative (received ${item.amountPaisa})`);
    }
  }

  // Upsert each item
  for (const item of input.items) {
    const budgetId = generateUuidV7();
    await db
      .insert(budgets)
      .values({
        id: budgetId,
        pharmacyId: input.pharmacyId,
        branchId: input.branchId,
        accountId: item.accountId,
        fiscalYear: input.fiscalYear,
        month: item.month,
        amountPaisa: item.amountPaisa,
        notes: item.notes ?? null,
        createdBy: input.userId ?? null,
        updatedBy: input.userId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          budgets.pharmacyId,
          budgets.branchId,
          budgets.accountId,
          budgets.fiscalYear,
          budgets.month,
        ],
        set: {
          amountPaisa: sql`EXCLUDED.amount_paisa`,
          notes: sql`EXCLUDED.notes`,
          updatedBy: input.userId ?? null,
          updatedAt: now,
        },
      });
  }

  return { count: input.items.length };
}

/**
 * Computes Actual vs Budget with variance math, percentage used, alert status, and summary KPIs.
 */
export async function getActualVsBudget(
  db: DbClient,
  pharmacyId: string,
  filter: BudgetFilter
): Promise<ActualVsBudgetResult> {
  const { fiscalYear, month, branchId, accountType } = filter;

  // 1. Fetch branch name if filtered
  let branchName: string | null = null;
  if (branchId) {
    const [b] = await db
      .select({ name: branches.name })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.pharmacyId, pharmacyId)))
      .limit(1);
    if (!b) {
      throw new Error('Branch not found');
    }
    branchName = b.name;
  }

  // 2. Fetch all eligible accounts (expense & revenue)
  const acctConditions = [eq(accounts.pharmacyId, pharmacyId), eq(accounts.isActive, true)];
  if (accountType) {
    acctConditions.push(eq(accounts.type, accountType));
  } else {
    acctConditions.push(sql`${accounts.type} IN ('expense', 'revenue')`);
  }

  const eligibleAccounts = await db
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
    })
    .from(accounts)
    .where(and(...acctConditions))
    .orderBy(asc(accounts.code));

  // 3. Query budgets for the period
  const budgetConditions = [eq(budgets.pharmacyId, pharmacyId), eq(budgets.fiscalYear, fiscalYear)];
  if (month) {
    budgetConditions.push(eq(budgets.month, month));
  }
  if (branchId) {
    budgetConditions.push(eq(budgets.branchId, branchId));
  }

  const budgetRows = await db
    .select({
      accountId: budgets.accountId,
      branchId: budgets.branchId,
      amountPaisa: budgets.amountPaisa,
    })
    .from(budgets)
    .where(and(...budgetConditions));

  // Map: accountId -> total budget paisa
  const budgetSumByAccount = new Map<string, number>();
  for (const b of budgetRows) {
    budgetSumByAccount.set(b.accountId, (budgetSumByAccount.get(b.accountId) || 0) + b.amountPaisa);
  }

  // 4. Query actuals from journal_lines joined with journal_entries
  // Determine date boundary
  let startDate: string;
  let endDate: string;
  if (month && month >= 1 && month <= 12) {
    const mm = String(month).padStart(2, '0');
    startDate = `${fiscalYear}-${mm}-01`;
    // Last day of month
    const lastDay = new Date(fiscalYear, month, 0).getDate();
    endDate = `${fiscalYear}-${mm}-${String(lastDay).padStart(2, '0')}`;
  } else {
    startDate = `${fiscalYear}-01-01`;
    endDate = `${fiscalYear}-12-31`;
  }

  const journalConditions = [
    eq(journalEntries.pharmacyId, pharmacyId),
    eq(journalEntries.status, 'posted'),
    sql`${journalEntries.entryDate} >= ${startDate}`,
    sql`${journalEntries.entryDate} <= ${endDate}`,
  ];

  if (branchId) {
    journalConditions.push(eq(journalLines.branchId, branchId));
  }

  const actualRows = await db
    .select({
      accountId: journalLines.accountId,
      totalDebitPaisa: sql<string>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
      totalCreditPaisa: sql<string>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(...journalConditions))
    .groupBy(journalLines.accountId);

  // Map: accountId -> actual paisa
  const actualMapByAccount = new Map<string, { debit: number; credit: number }>();
  for (const act of actualRows) {
    actualMapByAccount.set(act.accountId, {
      debit: Number(act.totalDebitPaisa) || 0,
      credit: Number(act.totalCreditPaisa) || 0,
    });
  }

  // 5. Build Actual vs Budget rows
  const rows: ActualVsBudgetRow[] = [];
  const alerts: BudgetAlert[] = [];

  let totalExpenseBudgetPaisa = 0;
  let totalExpenseActualPaisa = 0;
  let totalRevenueBudgetPaisa = 0;
  let totalRevenueActualPaisa = 0;

  for (const acct of eligibleAccounts) {
    const budgetPaisa = budgetSumByAccount.get(acct.id) || 0;
    const act = actualMapByAccount.get(acct.id) || { debit: 0, credit: 0 };

    let actualPaisa = 0;
    let variancePaisa = 0;
    let percentageUsed = 0;
    let alertStatus: ActualVsBudgetRow['alertStatus'] = 'normal';

    if (acct.type === 'expense') {
      // Normal balance is debit
      actualPaisa = act.debit - act.credit;
      // For expense: Variance = Budget - Actual. Positive = under budget (favorable)
      variancePaisa = budgetPaisa - actualPaisa;

      if (budgetPaisa > 0) {
        percentageUsed = Math.round((actualPaisa / budgetPaisa) * 10000) / 100;
      } else if (actualPaisa > 0) {
        percentageUsed = 100;
      } else {
        percentageUsed = 0;
      }

      if (percentageUsed > 100) {
        alertStatus = 'exceeded';
      } else if (percentageUsed >= 90) {
        alertStatus = 'warning';
      } else {
        alertStatus = 'normal';
      }

      totalExpenseBudgetPaisa += budgetPaisa;
      totalExpenseActualPaisa += actualPaisa;

      // Add to alerts list if >= 90%
      if (alertStatus === 'warning' || alertStatus === 'exceeded') {
        alerts.push({
          accountId: acct.id,
          accountCode: acct.code,
          accountName: acct.name,
          branchId: branchId ?? null,
          branchName: branchName ?? 'All Branches',
          budgetPaisa,
          actualPaisa,
          percentageUsed,
          level: alertStatus,
        });
      }
    } else {
      // acct.type === 'revenue'
      // Normal balance is credit
      actualPaisa = act.credit - act.debit;
      // For revenue: Variance = Actual - Budget. Positive = exceeded target (favorable)
      variancePaisa = actualPaisa - budgetPaisa;

      if (budgetPaisa > 0) {
        percentageUsed = Math.round((actualPaisa / budgetPaisa) * 10000) / 100;
      } else if (actualPaisa > 0) {
        percentageUsed = 100;
      } else {
        percentageUsed = 0;
      }

      if (percentageUsed > 100) {
        alertStatus = 'achieved';
      } else if (percentageUsed >= 90) {
        alertStatus = 'on_track';
      } else {
        alertStatus = 'under';
      }

      totalRevenueBudgetPaisa += budgetPaisa;
      totalRevenueActualPaisa += actualPaisa;
    }

    const varianceBp = budgetPaisa > 0 ? Math.round((variancePaisa / budgetPaisa) * 10000) : 0;

    // Only include row if budget > 0 or actual !== 0 (or all accounts if explicitly requested)
    if (budgetPaisa > 0 || actualPaisa !== 0) {
      rows.push({
        accountId: acct.id,
        accountCode: acct.code,
        accountName: acct.name,
        accountType: acct.type as 'expense' | 'revenue',
        branchId: branchId ?? null,
        branchName: branchName ?? 'All Branches',
        budgetPaisa,
        actualPaisa,
        variancePaisa,
        varianceBp,
        percentageUsed,
        alertStatus,
      });
    }
  }

  // Summary KPIs
  const totalExpenseVariancePaisa = totalExpenseBudgetPaisa - totalExpenseActualPaisa;
  const totalRevenueVariancePaisa = totalRevenueActualPaisa - totalRevenueBudgetPaisa;
  const netBudgetPaisa = totalRevenueBudgetPaisa - totalExpenseBudgetPaisa;
  const netActualPaisa = totalRevenueActualPaisa - totalExpenseActualPaisa;
  const netVariancePaisa = netActualPaisa - netBudgetPaisa;

  return {
    pharmacyId,
    fiscalYear,
    month: month ?? null,
    branchId: branchId ?? null,
    branchName: branchName ?? 'All Branches',
    summary: {
      totalExpenseBudgetPaisa,
      totalExpenseActualPaisa,
      totalExpenseVariancePaisa,
      totalRevenueBudgetPaisa,
      totalRevenueActualPaisa,
      totalRevenueVariancePaisa,
      netBudgetPaisa,
      netActualPaisa,
      netVariancePaisa,
      alertCount: alerts.length,
    },
    alerts,
    rows,
  };
}

/**
 * Copies last year's budget to target year with optional percentage adjustment.
 */
export async function copyPreviousYearBudget(db: DbClient, input: CopyPreviousYearBudgetInput) {
  const {
    pharmacyId,
    sourceYear,
    targetYear,
    branchId,
    percentageAdjustmentBp = 0,
    userId,
  } = input;

  if (sourceYear === targetYear) {
    throw new Error('Source year and target year cannot be the same');
  }

  // Validate branch if provided
  if (branchId) {
    const [b] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.pharmacyId, pharmacyId)))
      .limit(1);
    if (!b) {
      throw new Error('Branch not found or does not belong to pharmacy');
    }
  }

  const conditions = [eq(budgets.pharmacyId, pharmacyId), eq(budgets.fiscalYear, sourceYear)];
  if (branchId) {
    conditions.push(eq(budgets.branchId, branchId));
  }

  const sourceBudgets = await db
    .select()
    .from(budgets)
    .where(and(...conditions));

  if (sourceBudgets.length === 0) {
    return { copiedCount: 0 };
  }

  const now = new Date().toISOString();
  let copiedCount = 0;

  for (const b of sourceBudgets) {
    // Calculate adjusted amount in paisa
    // adjustment in bp: 1000 bp = +10%
    const multiplier = 10000 + (percentageAdjustmentBp || 0);
    const adjustedAmountPaisa = Math.max(0, Math.round((b.amountPaisa * multiplier) / 10000));

    const newBudgetId = generateUuidV7();
    await db
      .insert(budgets)
      .values({
        id: newBudgetId,
        pharmacyId: b.pharmacyId,
        branchId: b.branchId,
        accountId: b.accountId,
        fiscalYear: targetYear,
        month: b.month,
        amountPaisa: adjustedAmountPaisa,
        notes: b.notes ? `Copied from ${sourceYear}: ${b.notes}` : `Copied from ${sourceYear}`,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          budgets.pharmacyId,
          budgets.branchId,
          budgets.accountId,
          budgets.fiscalYear,
          budgets.month,
        ],
        set: {
          amountPaisa: adjustedAmountPaisa,
          notes: b.notes ? `Copied from ${sourceYear}: ${b.notes}` : `Copied from ${sourceYear}`,
          updatedBy: userId ?? null,
          updatedAt: now,
        },
      });

    copiedCount++;
  }

  return { copiedCount };
}
