import { eq, and, sql } from 'drizzle-orm';
import type { DbClient } from '../sync/types';
import { accounts, branches } from '../db/schema';

export interface ReportDateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  branchId?: string | null;
  compareWithPrevious?: boolean;
}

export interface VarianceData {
  previousPaisa: number;
  variancePaisa: number;
  varianceBp: number; // Basis points (1% = 100 bp)
}

// -----------------------------------------------------------------------------
// 1. TRIAL BALANCE TYPES
// -----------------------------------------------------------------------------
export interface TrialBalanceRowItem {
  accountId: string;
  code: string;
  name: string;
  type: string;
  openingBalancePaisa: number;
  debitPaisa: number;
  creditPaisa: number;
  closingBalancePaisa: number;
  closingDebitPaisa?: number;
  closingCreditPaisa?: number;
  comparison?: VarianceData;
}

export interface TrialBalanceReportData {
  pharmacyId: string;
  startDate: string;
  endDate: string;
  branchId: string | null;
  branchName: string | null;
  totalOpeningDebitPaisa: number;
  totalOpeningCreditPaisa: number;
  totalDebitPaisa: number;
  totalCreditPaisa: number;
  totalClosingDebitPaisa: number;
  totalClosingCreditPaisa: number;
  isBalanced: boolean;
  rows: TrialBalanceRowItem[];
  previousPeriod?: {
    startDate: string;
    endDate: string;
    totalDebitPaisa: number;
    totalCreditPaisa: number;
  };
}

// -----------------------------------------------------------------------------
// 2. PROFIT & LOSS TYPES
// -----------------------------------------------------------------------------
export interface PnlAccountLine {
  accountId: string;
  code: string;
  name: string;
  amountPaisa: number;
  comparison?: VarianceData;
}

export interface ProfitAndLossReportData {
  pharmacyId: string;
  startDate: string;
  endDate: string;
  branchId: string | null;
  branchName: string | null;
  summary: {
    totalRevenuePaisa: number;
    totalCogsPaisa: number;
    grossProfitPaisa: number;
    grossMarginBp: number;
    totalOperatingExpensesPaisa: number;
    netProfitPaisa: number;
    netMarginBp: number;
    comparison?: {
      previousRevenuePaisa: number;
      previousCogsPaisa: number;
      previousGrossProfitPaisa: number;
      previousOperatingExpensesPaisa: number;
      previousNetProfitPaisa: number;
      revenueVariancePaisa: number;
      netProfitVariancePaisa: number;
    };
  };
  sections: {
    revenue: {
      totalPaisa: number;
      rows: PnlAccountLine[];
    };
    costOfGoodsSold: {
      totalPaisa: number;
      rows: PnlAccountLine[];
    };
    operatingExpenses: {
      totalPaisa: number;
      rows: PnlAccountLine[];
    };
  };
}

// -----------------------------------------------------------------------------
// 3. BALANCE SHEET TYPES
// -----------------------------------------------------------------------------
export interface BalanceSheetAccountLine {
  accountId: string;
  code: string;
  name: string;
  balancePaisa: number;
  comparison?: VarianceData;
}

export interface BalanceSheetReportData {
  pharmacyId: string;
  startDate: string;
  endDate: string;
  branchId: string | null;
  branchName: string | null;
  summary: {
    totalAssetsPaisa: number;
    totalLiabilitiesPaisa: number;
    totalBaseEquityPaisa: number;
    currentPeriodProfitPaisa: number;
    totalEquityAndReservesPaisa: number;
    totalLiabilitiesAndEquityPaisa: number;
    differencePaisa: number;
    comparison?: {
      previousAssetsPaisa: number;
      previousLiabilitiesPaisa: number;
      previousEquityPaisa: number;
      assetsVariancePaisa: number;
    };
  };
  isBalanced: boolean;
  sections: {
    assets: {
      totalPaisa: number;
      rows: BalanceSheetAccountLine[];
    };
    liabilities: {
      totalPaisa: number;
      rows: BalanceSheetAccountLine[];
    };
    equity: {
      totalBasePaisa: number;
      currentPeriodProfitPaisa: number;
      totalWithProfitPaisa: number;
      rows: BalanceSheetAccountLine[];
    };
  };
}

// -----------------------------------------------------------------------------
// 4. CASH FLOW TYPES
// -----------------------------------------------------------------------------
export interface CashFlowCategoryLine {
  category: string;
  label: string;
  amountPaisa: number;
}

export interface CashFlowReportData {
  pharmacyId: string;
  startDate: string;
  endDate: string;
  branchId: string | null;
  branchName: string | null;
  summary: {
    openingCashPaisa: number;
    totalInflowsPaisa: number;
    totalOutflowsPaisa: number;
    netCashFlowPaisa: number;
    closingCashPaisa: number;
  };
  isReconciled: boolean;
  inflows: CashFlowCategoryLine[];
  outflows: CashFlowCategoryLine[];
}

// -----------------------------------------------------------------------------
// 5. GENERAL LEDGER TYPES
// -----------------------------------------------------------------------------
export interface GeneralLedgerAccountSummary {
  accountId: string;
  code: string;
  name: string;
  type: string;
  openingBalancePaisa: number;
  periodDebitPaisa: number;
  periodCreditPaisa: number;
  closingBalancePaisa: number;
}

export interface GeneralLedgerLineDetail {
  lineId: string;
  entryId: string;
  entryNo: number;
  entryDate: string;
  sourceType: string | null;
  sourceId: string | null;
  memo: string | null;
  branchId: string | null;
  branchName: string | null;
  debitPaisa: number;
  creditPaisa: number;
  runningBalancePaisa: number;
}

// -----------------------------------------------------------------------------
// HELPER: DATE CALCULATION FOR PREVIOUS PERIOD
// -----------------------------------------------------------------------------
function computePreviousPeriod(
  startDate: string,
  endDate: string
): { prevStartDate: string; prevEndDate: string } {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const durationMs = end.getTime() - start.getTime() + 24 * 60 * 60 * 1000;

  const prevEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const prevStart = new Date(prevEnd.getTime() - durationMs + 24 * 60 * 60 * 1000);

  return {
    prevStartDate: prevStart.toISOString().slice(0, 10),
    prevEndDate: prevEnd.toISOString().slice(0, 10),
  };
}

export function calculateVariance(current: number, previous: number): VarianceData {
  const variancePaisa = current - previous;
  const varianceBp = previous !== 0 ? Math.round((variancePaisa / Math.abs(previous)) * 10000) : 0;
  return {
    previousPaisa: previous,
    variancePaisa,
    varianceBp,
  };
}

async function validateAndGetBranchName(
  db: DbClient,
  pharmacyId: string,
  branchId?: string | null
): Promise<string | null> {
  if (!branchId) return null;
  const [b] = await db
    .select({ name: branches.name })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.pharmacyId, pharmacyId)))
    .limit(1);

  if (!b) {
    throw new Error('Branch not found or belongs to another pharmacy');
  }
  return b.name;
}

// -----------------------------------------------------------------------------
// 1. TRIAL BALANCE QUERY ENGINE
// -----------------------------------------------------------------------------
export async function getTrialBalance(
  db: DbClient,
  pharmacyId: string,
  range: ReportDateRange
): Promise<TrialBalanceReportData> {
  const branchName = await validateAndGetBranchName(db, pharmacyId, range.branchId);

  // Single fast query computing:
  // 1) opening balance before startDate
  // 2) period debit & credit between startDate and endDate
  const branchFilterSql = range.branchId ? sql`AND jl.branch_id = ${range.branchId}` : sql``;

  const rawRowsResult = await db.execute<{
    account_id: string;
    code: string;
    name: string;
    type: string;
    opening_debit: string;
    opening_credit: string;
    period_debit: string;
    period_credit: string;
  }>(sql`
    SELECT
      a.id AS account_id,
      a.code,
      a.name,
      a.type,
      COALESCE(SUM(CASE WHEN je.entry_date < ${range.startDate} THEN jl.debit_paisa ELSE 0 END), 0) AS opening_debit,
      COALESCE(SUM(CASE WHEN je.entry_date < ${range.startDate} THEN jl.credit_paisa ELSE 0 END), 0) AS opening_credit,
      COALESCE(SUM(CASE WHEN je.entry_date >= ${range.startDate} AND je.entry_date <= ${range.endDate} THEN jl.debit_paisa ELSE 0 END), 0) AS period_debit,
      COALESCE(SUM(CASE WHEN je.entry_date >= ${range.startDate} AND je.entry_date <= ${range.endDate} THEN jl.credit_paisa ELSE 0 END), 0) AS period_credit
    FROM accounts a
    LEFT JOIN journal_lines jl ON jl.account_id = a.id AND jl.pharmacy_id = ${pharmacyId} ${branchFilterSql}
    LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.pharmacy_id = ${pharmacyId}
    WHERE a.pharmacy_id = ${pharmacyId} AND a.is_active = true
    GROUP BY a.id, a.code, a.name, a.type
    ORDER BY a.code ASC
  `);

  let totalOpeningDebitPaisa = 0;
  let totalOpeningCreditPaisa = 0;
  let totalDebitPaisa = 0;
  let totalCreditPaisa = 0;
  let totalClosingDebitPaisa = 0;
  let totalClosingCreditPaisa = 0;

  const rows: TrialBalanceRowItem[] = [];

  for (const r of rawRowsResult.rows) {
    const opDr = Number(r.opening_debit || 0);
    const opCr = Number(r.opening_credit || 0);
    const pDr = Number(r.period_debit || 0);
    const pCr = Number(r.period_credit || 0);

    const netOpening = opDr - opCr;
    const netClosing = netOpening + (pDr - pCr);

    totalOpeningDebitPaisa += opDr;
    totalOpeningCreditPaisa += opCr;
    totalDebitPaisa += pDr;
    totalCreditPaisa += pCr;

    if (netClosing >= 0) {
      totalClosingDebitPaisa += netClosing;
    } else {
      totalClosingCreditPaisa += Math.abs(netClosing);
    }

    // Only include rows with active history or non-zero balances
    if (opDr !== 0 || opCr !== 0 || pDr !== 0 || pCr !== 0) {
      rows.push({
        accountId: r.account_id,
        code: r.code,
        name: r.name,
        type: r.type,
        openingBalancePaisa: netOpening,
        debitPaisa: pDr,
        creditPaisa: pCr,
        closingBalancePaisa: netClosing,
        closingDebitPaisa: netClosing >= 0 ? netClosing : 0,
        closingCreditPaisa: netClosing < 0 ? Math.abs(netClosing) : 0,
      });
    }
  }

  // Previous period comparison if requested
  let previousPeriodData: TrialBalanceReportData['previousPeriod'] = undefined;
  if (range.compareWithPrevious) {
    const { prevStartDate, prevEndDate } = computePreviousPeriod(range.startDate, range.endDate);
    const prevRes = await db.execute<{ total_debit: string; total_credit: string }>(sql`
      SELECT
        COALESCE(SUM(jl.debit_paisa), 0) AS total_debit,
        COALESCE(SUM(jl.credit_paisa), 0) AS total_credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id AND je.pharmacy_id = ${pharmacyId}
      WHERE jl.pharmacy_id = ${pharmacyId}
        AND je.entry_date >= ${prevStartDate} AND je.entry_date <= ${prevEndDate}
        ${branchFilterSql}
    `);
    const prevDr = Number(prevRes.rows[0]?.total_debit || 0);
    const prevCr = Number(prevRes.rows[0]?.total_credit || 0);
    previousPeriodData = {
      startDate: prevStartDate,
      endDate: prevEndDate,
      totalDebitPaisa: prevDr,
      totalCreditPaisa: prevCr,
    };
  }

  return {
    pharmacyId,
    startDate: range.startDate,
    endDate: range.endDate,
    branchId: range.branchId || null,
    branchName,
    totalOpeningDebitPaisa,
    totalOpeningCreditPaisa,
    totalDebitPaisa,
    totalCreditPaisa,
    totalClosingDebitPaisa,
    totalClosingCreditPaisa,
    isBalanced: totalDebitPaisa === totalCreditPaisa,
    rows,
    previousPeriod: previousPeriodData,
  };
}

// -----------------------------------------------------------------------------
// 2. PROFIT & LOSS QUERY ENGINE
// -----------------------------------------------------------------------------
export async function getProfitAndLoss(
  db: DbClient,
  pharmacyId: string,
  range: ReportDateRange
): Promise<ProfitAndLossReportData> {
  const branchName = await validateAndGetBranchName(db, pharmacyId, range.branchId);
  const branchFilterSql = range.branchId ? sql`AND jl.branch_id = ${range.branchId}` : sql``;

  // Single fast aggregation query for all revenue and expense accounts during period
  const rawResult = await db.execute<{
    account_id: string;
    code: string;
    name: string;
    type: string;
    period_debit: string;
    period_credit: string;
  }>(sql`
    SELECT
      a.id AS account_id,
      a.code,
      a.name,
      a.type,
      COALESCE(SUM(jl.debit_paisa), 0) AS period_debit,
      COALESCE(SUM(jl.credit_paisa), 0) AS period_credit
    FROM accounts a
    JOIN journal_lines jl ON jl.account_id = a.id AND jl.pharmacy_id = ${pharmacyId} ${branchFilterSql}
    JOIN journal_entries je ON je.id = jl.entry_id AND je.pharmacy_id = ${pharmacyId}
    WHERE a.pharmacy_id = ${pharmacyId}
      AND (a.type IN ('revenue', 'cost_of_sales', 'expense') OR a.code >= '4000')
      AND je.entry_date >= ${range.startDate} AND je.entry_date <= ${range.endDate}
    GROUP BY a.id, a.code, a.name, a.type
    ORDER BY a.code ASC
  `);

  const revenueRows: PnlAccountLine[] = [];
  const cogsRows: PnlAccountLine[] = [];
  const opexRows: PnlAccountLine[] = [];

  let totalRevenuePaisa = 0;
  let totalCogsPaisa = 0;
  let totalOperatingExpensesPaisa = 0;

  for (const r of rawResult.rows) {
    const dr = Number(r.period_debit || 0);
    const cr = Number(r.period_credit || 0);
    const code = r.code;
    const type = r.type;

    if (type === 'revenue' || (code >= '4000' && code < '5000')) {
      // Revenue normal balance = Credit (Cr - Dr). Contra revenue has Dr > Cr -> negative.
      const net = cr - dr;
      revenueRows.push({
        accountId: r.account_id,
        code: r.code,
        name: r.name,
        amountPaisa: net,
      });
      totalRevenuePaisa += net;
    } else if (type === 'cost_of_sales' || (code >= '5000' && code < '6000')) {
      // COGS normal balance = Debit (Dr - Cr).
      const net = dr - cr;
      cogsRows.push({
        accountId: r.account_id,
        code: r.code,
        name: r.name,
        amountPaisa: net,
      });
      totalCogsPaisa += net;
    } else {
      // Operating Expenses normal balance = Debit (Dr - Cr).
      const net = dr - cr;
      opexRows.push({
        accountId: r.account_id,
        code: r.code,
        name: r.name,
        amountPaisa: net,
      });
      totalOperatingExpensesPaisa += net;
    }
  }

  const grossProfitPaisa = totalRevenuePaisa - totalCogsPaisa;
  const netProfitPaisa = grossProfitPaisa - totalOperatingExpensesPaisa;
  const grossMarginBp =
    totalRevenuePaisa > 0 ? Math.round((grossProfitPaisa / totalRevenuePaisa) * 10000) : 0;
  const netMarginBp =
    totalRevenuePaisa > 0 ? Math.round((netProfitPaisa / totalRevenuePaisa) * 10000) : 0;

  // Previous period comparison if enabled
  let prevSummary: ProfitAndLossReportData['summary']['comparison'] = undefined;
  if (range.compareWithPrevious) {
    const { prevStartDate, prevEndDate } = computePreviousPeriod(range.startDate, range.endDate);
    const prevPnl = await getProfitAndLoss(db, pharmacyId, {
      startDate: prevStartDate,
      endDate: prevEndDate,
      branchId: range.branchId,
      compareWithPrevious: false,
    });

    prevSummary = {
      previousRevenuePaisa: prevPnl.summary.totalRevenuePaisa,
      previousCogsPaisa: prevPnl.summary.totalCogsPaisa,
      previousGrossProfitPaisa: prevPnl.summary.grossProfitPaisa,
      previousOperatingExpensesPaisa: prevPnl.summary.totalOperatingExpensesPaisa,
      previousNetProfitPaisa: prevPnl.summary.netProfitPaisa,
      revenueVariancePaisa: totalRevenuePaisa - prevPnl.summary.totalRevenuePaisa,
      netProfitVariancePaisa: netProfitPaisa - prevPnl.summary.netProfitPaisa,
    };
  }

  return {
    pharmacyId,
    startDate: range.startDate,
    endDate: range.endDate,
    branchId: range.branchId || null,
    branchName,
    summary: {
      totalRevenuePaisa,
      totalCogsPaisa,
      grossProfitPaisa,
      grossMarginBp,
      totalOperatingExpensesPaisa,
      netProfitPaisa,
      netMarginBp,
      comparison: prevSummary,
    },
    sections: {
      revenue: {
        totalPaisa: totalRevenuePaisa,
        rows: revenueRows,
      },
      costOfGoodsSold: {
        totalPaisa: totalCogsPaisa,
        rows: cogsRows,
      },
      operatingExpenses: {
        totalPaisa: totalOperatingExpensesPaisa,
        rows: opexRows,
      },
    },
  };
}

// -----------------------------------------------------------------------------
// 3. BALANCE SHEET QUERY ENGINE
// -----------------------------------------------------------------------------
export async function getBalanceSheet(
  db: DbClient,
  pharmacyId: string,
  range: ReportDateRange
): Promise<BalanceSheetReportData> {
  const branchName = await validateAndGetBranchName(db, pharmacyId, range.branchId);
  const branchFilterSql = range.branchId ? sql`AND jl.branch_id = ${range.branchId}` : sql``;

  // 1. Fetch cumulative balances for Assets, Liabilities, and Base Equity as of endDate
  const rawAccountsResult = await db.execute<{
    account_id: string;
    code: string;
    name: string;
    type: string;
    cumulative_debit: string;
    cumulative_credit: string;
  }>(sql`
    SELECT
      a.id AS account_id,
      a.code,
      a.name,
      a.type,
      COALESCE(SUM(jl.debit_paisa), 0) AS cumulative_debit,
      COALESCE(SUM(jl.credit_paisa), 0) AS cumulative_credit
    FROM accounts a
    JOIN journal_lines jl ON jl.account_id = a.id AND jl.pharmacy_id = ${pharmacyId} ${branchFilterSql}
    JOIN journal_entries je ON je.id = jl.entry_id AND je.pharmacy_id = ${pharmacyId}
    WHERE a.pharmacy_id = ${pharmacyId}
      AND je.entry_date <= ${range.endDate}
    GROUP BY a.id, a.code, a.name, a.type
    ORDER BY a.code ASC
  `);

  const assetRows: BalanceSheetAccountLine[] = [];
  const liabilityRows: BalanceSheetAccountLine[] = [];
  const equityRows: BalanceSheetAccountLine[] = [];

  let totalAssetsPaisa = 0;
  let totalLiabilitiesPaisa = 0;
  let totalBaseEquityPaisa = 0;

  // Cumulative P&L totals up to endDate: (Revenue credits - debits) - (Expense debits - credits)
  let cumulativeRevenueCrMinusDr = 0;
  let cumulativeExpenseDrMinusCr = 0;

  for (const r of rawAccountsResult.rows) {
    const dr = Number(r.cumulative_debit || 0);
    const cr = Number(r.cumulative_credit || 0);
    const code = r.code;
    const type = r.type;

    if (type === 'asset' || (code >= '1000' && code < '2000')) {
      // Normal balance Debit (Dr - Cr)
      const balance = dr - cr;
      assetRows.push({
        accountId: r.account_id,
        code: r.code,
        name: r.name,
        balancePaisa: balance,
      });
      totalAssetsPaisa += balance;
    } else if (type === 'liability' || (code >= '2000' && code < '3000')) {
      // Normal balance Credit (Cr - Dr)
      const balance = cr - dr;
      liabilityRows.push({
        accountId: r.account_id,
        code: r.code,
        name: r.name,
        balancePaisa: balance,
      });
      totalLiabilitiesPaisa += balance;
    } else if (type === 'equity' || (code >= '3000' && code < '4000')) {
      // Normal balance Credit (Cr - Dr)
      const balance = cr - dr;
      equityRows.push({
        accountId: r.account_id,
        code: r.code,
        name: r.name,
        balancePaisa: balance,
      });
      totalBaseEquityPaisa += balance;
    } else if (type === 'revenue' || (code >= '4000' && code < '5000')) {
      cumulativeRevenueCrMinusDr += cr - dr;
    } else {
      // COGS and Expenses
      cumulativeExpenseDrMinusCr += dr - cr;
    }
  }

  // Current Period Profit = All revenue - all expenses up to endDate
  const currentPeriodProfitPaisa = cumulativeRevenueCrMinusDr - cumulativeExpenseDrMinusCr;
  const totalEquityAndReservesPaisa = totalBaseEquityPaisa + currentPeriodProfitPaisa;
  const totalLiabilitiesAndEquityPaisa = totalLiabilitiesPaisa + totalEquityAndReservesPaisa;
  const differencePaisa = totalAssetsPaisa - totalLiabilitiesAndEquityPaisa;
  const isBalanced = differencePaisa === 0;

  return {
    pharmacyId,
    startDate: range.startDate,
    endDate: range.endDate,
    branchId: range.branchId || null,
    branchName,
    summary: {
      totalAssetsPaisa,
      totalLiabilitiesPaisa,
      totalBaseEquityPaisa,
      currentPeriodProfitPaisa,
      totalEquityAndReservesPaisa,
      totalLiabilitiesAndEquityPaisa,
      differencePaisa,
    },
    isBalanced,
    sections: {
      assets: {
        totalPaisa: totalAssetsPaisa,
        rows: assetRows,
      },
      liabilities: {
        totalPaisa: totalLiabilitiesPaisa,
        rows: liabilityRows,
      },
      equity: {
        totalBasePaisa: totalBaseEquityPaisa,
        currentPeriodProfitPaisa,
        totalWithProfitPaisa: totalEquityAndReservesPaisa,
        rows: equityRows,
      },
    },
  };
}

// -----------------------------------------------------------------------------
// 4. CASH FLOW QUERY ENGINE
// -----------------------------------------------------------------------------
export async function getCashFlow(
  db: DbClient,
  pharmacyId: string,
  range: ReportDateRange
): Promise<CashFlowReportData> {
  const branchName = await validateAndGetBranchName(db, pharmacyId, range.branchId);
  const branchFilterSql = range.branchId ? sql`AND jl.branch_id = ${range.branchId}` : sql``;

  // Cash & Bank accounts: Asset accounts with codes starting with '10'
  const cashAccountsResult = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.pharmacyId, pharmacyId),
        eq(accounts.type, 'asset'),
        sql`${accounts.code} LIKE '10%'`
      )
    );

  const cashAccountIds = cashAccountsResult.map((a: { id: string }) => a.id);
  if (cashAccountIds.length === 0) {
    return {
      pharmacyId,
      startDate: range.startDate,
      endDate: range.endDate,
      branchId: range.branchId || null,
      branchName,
      summary: {
        openingCashPaisa: 0,
        totalInflowsPaisa: 0,
        totalOutflowsPaisa: 0,
        netCashFlowPaisa: 0,
        closingCashPaisa: 0,
      },
      isReconciled: true,
      inflows: [],
      outflows: [],
    };
  }

  // 1. Opening Cash & Bank (Debits - Credits prior to startDate)
  const openingRes = await db.execute<{ opening_balance: string }>(sql`
    SELECT
      COALESCE(SUM(jl.debit_paisa - jl.credit_paisa), 0) AS opening_balance
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.pharmacy_id = ${pharmacyId}
    WHERE jl.pharmacy_id = ${pharmacyId}
      AND jl.account_id IN (${sql.join(cashAccountIds, sql`, `)})
      AND je.entry_date < ${range.startDate}
      ${branchFilterSql}
  `);
  const openingCashPaisa = Number(openingRes.rows[0]?.opening_balance || 0);

  // 2. Period Cash Movements: Inflows (Dr to Cash/Bank) and Outflows (Cr to Cash/Bank)
  const movementsRes = await db.execute<{
    source_type: string | null;
    debit_paisa: string;
    credit_paisa: string;
  }>(sql`
    SELECT
      je.source_type,
      COALESCE(SUM(jl.debit_paisa), 0) AS debit_paisa,
      COALESCE(SUM(jl.credit_paisa), 0) AS credit_paisa
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.pharmacy_id = ${pharmacyId}
    WHERE jl.pharmacy_id = ${pharmacyId}
      AND jl.account_id IN (${sql.join(cashAccountIds, sql`, `)})
      AND je.entry_date >= ${range.startDate} AND je.entry_date <= ${range.endDate}
      ${branchFilterSql}
    GROUP BY je.source_type
  `);

  let totalInflowsPaisa = 0;
  let totalOutflowsPaisa = 0;

  const inflows: CashFlowCategoryLine[] = [];
  const outflows: CashFlowCategoryLine[] = [];

  for (const m of movementsRes.rows) {
    const dr = Number(m.debit_paisa || 0);
    const cr = Number(m.credit_paisa || 0);
    const src = m.source_type || 'other';

    let label = 'Other Cash Receipts';
    if (src === 'sale' || src === 'invoice') label = 'Customer Sales & Receipts';
    else if (src === 'capital' || src === 'equity') label = 'Capital Injections';
    else if (src === 'transfer') label = 'Internal Cash Transfers (In)';

    if (dr > 0) {
      totalInflowsPaisa += dr;
      inflows.push({
        category: src,
        label,
        amountPaisa: dr,
      });
    }

    let outLabel = 'Other Cash Disbursements';
    if (src === 'supplier_payment' || src === 'purchase') label = 'Payments to Suppliers';
    else if (src === 'expense') outLabel = 'Operating Expenses & Utilities';
    else if (src === 'refund' || src === 'credit_note') outLabel = 'Customer Refunds';
    else if (src === 'transfer') outLabel = 'Internal Cash Transfers (Out)';

    if (cr > 0) {
      totalOutflowsPaisa += cr;
      outflows.push({
        category: src,
        label: outLabel,
        amountPaisa: cr,
      });
    }
  }

  const netCashFlowPaisa = totalInflowsPaisa - totalOutflowsPaisa;
  const closingCashPaisa = openingCashPaisa + netCashFlowPaisa;

  // Verify against actual closing ledger balance at endDate
  const closingRes = await db.execute<{ closing_balance: string }>(sql`
    SELECT
      COALESCE(SUM(jl.debit_paisa - jl.credit_paisa), 0) AS closing_balance
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.pharmacy_id = ${pharmacyId}
    WHERE jl.pharmacy_id = ${pharmacyId}
      AND jl.account_id IN (${sql.join(cashAccountIds, sql`, `)})
      AND je.entry_date <= ${range.endDate}
      ${branchFilterSql}
  `);
  const actualClosing = Number(closingRes.rows[0]?.closing_balance || 0);
  const isReconciled = closingCashPaisa === actualClosing;

  return {
    pharmacyId,
    startDate: range.startDate,
    endDate: range.endDate,
    branchId: range.branchId || null,
    branchName,
    summary: {
      openingCashPaisa,
      totalInflowsPaisa,
      totalOutflowsPaisa,
      netCashFlowPaisa,
      closingCashPaisa,
    },
    isReconciled,
    inflows,
    outflows,
  };
}

// -----------------------------------------------------------------------------
// 5. GENERAL LEDGER QUERY ENGINE
// -----------------------------------------------------------------------------
export async function getGeneralLedgerSummary(
  db: DbClient,
  pharmacyId: string,
  range: ReportDateRange
): Promise<{
  pharmacyId: string;
  startDate: string;
  endDate: string;
  branchId: string | null;
  branchName: string | null;
  accounts: GeneralLedgerAccountSummary[];
}> {
  const branchName = await validateAndGetBranchName(db, pharmacyId, range.branchId);
  const tb = await getTrialBalance(db, pharmacyId, range);

  const accountsSummary: GeneralLedgerAccountSummary[] = tb.rows.map((r) => ({
    accountId: r.accountId,
    code: r.code,
    name: r.name,
    type: r.type,
    openingBalancePaisa: r.openingBalancePaisa,
    periodDebitPaisa: r.debitPaisa,
    periodCreditPaisa: r.creditPaisa,
    closingBalancePaisa: r.closingBalancePaisa,
  }));

  return {
    pharmacyId,
    startDate: range.startDate,
    endDate: range.endDate,
    branchId: range.branchId || null,
    branchName,
    accounts: accountsSummary,
  };
}

export async function getAccountLedgerDetail(
  db: DbClient,
  pharmacyId: string,
  accountId: string,
  range: ReportDateRange
): Promise<{
  pharmacyId: string;
  account: { id: string; code: string; name: string; type: string };
  startDate: string;
  endDate: string;
  openingBalancePaisa: number;
  totalDebitPaisa: number;
  totalCreditPaisa: number;
  closingBalancePaisa: number;
  lines: GeneralLedgerLineDetail[];
}> {
  // Validate account
  const [acct] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.pharmacyId, pharmacyId)))
    .limit(1);

  if (!acct) {
    throw new Error('Account not found or belongs to another pharmacy');
  }

  const branchFilterSql = range.branchId ? sql`AND jl.branch_id = ${range.branchId}` : sql``;

  // 1. Opening balance before startDate
  const opRes = await db.execute<{ opening_balance: string }>(sql`
    SELECT
      COALESCE(SUM(jl.debit_paisa - jl.credit_paisa), 0) AS opening_balance
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.pharmacy_id = ${pharmacyId}
    WHERE jl.pharmacy_id = ${pharmacyId}
      AND jl.account_id = ${accountId}
      AND je.entry_date < ${range.startDate}
      ${branchFilterSql}
  `);
  const openingBalancePaisa = Number(opRes.rows[0]?.opening_balance || 0);

  // 2. Fetch lines in date range
  const linesRes = await db.execute<{
    line_id: string;
    entry_id: string;
    entry_no: string;
    entry_date: string;
    source_type: string | null;
    source_id: string | null;
    memo: string | null;
    branch_id: string | null;
    branch_name: string | null;
    debit_paisa: string;
    credit_paisa: string;
  }>(sql`
    SELECT
      jl.id AS line_id,
      je.id AS entry_id,
      je.entry_no,
      je.entry_date,
      je.source_type,
      je.source_id,
      COALESCE(jl.memo, je.memo) AS memo,
      jl.branch_id,
      b.name AS branch_name,
      jl.debit_paisa,
      jl.credit_paisa
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.pharmacy_id = ${pharmacyId}
    LEFT JOIN branches b ON b.id = jl.branch_id
    WHERE jl.pharmacy_id = ${pharmacyId}
      AND jl.account_id = ${accountId}
      AND je.entry_date >= ${range.startDate} AND je.entry_date <= ${range.endDate}
      ${branchFilterSql}
    ORDER BY je.entry_date ASC, je.entry_no ASC, jl.id ASC
  `);

  let running = openingBalancePaisa;
  let totalDebitPaisa = 0;
  let totalCreditPaisa = 0;

  const lines: GeneralLedgerLineDetail[] = [];

  for (const r of linesRes.rows) {
    const dr = Number(r.debit_paisa || 0);
    const cr = Number(r.credit_paisa || 0);
    totalDebitPaisa += dr;
    totalCreditPaisa += cr;
    running += dr - cr;

    lines.push({
      lineId: r.line_id,
      entryId: r.entry_id,
      entryNo: Number(r.entry_no),
      entryDate: r.entry_date,
      sourceType: r.source_type,
      sourceId: r.source_id,
      memo: r.memo,
      branchId: r.branch_id,
      branchName: r.branch_name,
      debitPaisa: dr,
      creditPaisa: cr,
      runningBalancePaisa: running,
    });
  }

  return {
    pharmacyId,
    account: {
      id: acct.id,
      code: acct.code,
      name: acct.name,
      type: acct.type,
    },
    startDate: range.startDate,
    endDate: range.endDate,
    openingBalancePaisa,
    totalDebitPaisa,
    totalCreditPaisa,
    closingBalancePaisa: running,
    lines,
  };
}
