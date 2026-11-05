import type { ActualVsBudgetReportData, ActualVsBudgetRow } from '../types';
import { formatPaisa } from './formatters';

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Calculates variance in paisa for Expense or Revenue.
 * - Expense: Budget - Actual (positive = favorable, under budget)
 * - Revenue: Actual - Budget (positive = favorable, exceeded target)
 */
export function calculateVariance(
  budgetPaisa: number,
  actualPaisa: number,
  accountType: 'expense' | 'revenue'
): number {
  if (accountType === 'expense') {
    return budgetPaisa - actualPaisa;
  }
  return actualPaisa - budgetPaisa;
}

/**
 * Calculates percentage used / achieved:
 * - If budget > 0: (actual / budget) * 100 rounded to 2 decimals
 * - If budget === 0: actual > 0 ? 100 : 0
 */
export function calculatePercentageUsed(budgetPaisa: number, actualPaisa: number): number {
  if (budgetPaisa > 0) {
    return Math.round((actualPaisa / budgetPaisa) * 10000) / 100;
  }
  return actualPaisa > 0 ? 100 : 0;
}

/**
 * Computes alert status:
 * - Expense:
 *   - 'exceeded' if percentageUsed > 100
 *   - 'warning' if percentageUsed >= 90
 *   - 'normal' otherwise
 * - Revenue:
 *   - 'achieved' if percentageUsed > 100
 *   - 'on_track' if percentageUsed >= 90
 *   - 'under' otherwise
 */
export function getAlertStatus(
  percentageUsed: number,
  accountType: 'expense' | 'revenue'
): ActualVsBudgetRow['alertStatus'] {
  if (accountType === 'expense') {
    if (percentageUsed > 100) return 'exceeded';
    if (percentageUsed >= 90) return 'warning';
    return 'normal';
  }
  if (percentageUsed > 100) return 'achieved';
  if (percentageUsed >= 90) return 'on_track';
  return 'under';
}

/**
 * Generates an RFC-4180 compliant CSV of the Actual vs Budget report.
 */
export function generateBudgetCsv(data: ActualVsBudgetReportData): string {
  const periodLabel = data.month
    ? MONTH_NAMES[data.month - 1] + ' ' + data.fiscalYear
    : 'FY ' + data.fiscalYear;
  const branchLabel = data.branchName || 'All Branches';

  const lines: string[] = [
    `"Actual vs Budget Report"`,
    `"Period:","${periodLabel}"`,
    `"Branch:","${branchLabel}"`,
    `""`,
    `"Summary KPIs"`,
    `"Total Expense Budget","${formatPaisa(data.summary.totalExpenseBudgetPaisa)}"`,
    `"Total Expense Actual","${formatPaisa(data.summary.totalExpenseActualPaisa)}"`,
    `"Total Expense Variance","${formatPaisa(data.summary.totalExpenseVariancePaisa)}"`,
    `"Total Revenue Budget","${formatPaisa(data.summary.totalRevenueBudgetPaisa)}"`,
    `"Total Revenue Actual","${formatPaisa(data.summary.totalRevenueActualPaisa)}"`,
    `"Total Revenue Variance","${formatPaisa(data.summary.totalRevenueVariancePaisa)}"`,
    `"Net Operating Budget","${formatPaisa(data.summary.netBudgetPaisa)}"`,
    `"Net Operating Actual","${formatPaisa(data.summary.netActualPaisa)}"`,
    `"Net Variance","${formatPaisa(data.summary.netVariancePaisa)}"`,
    `"Active Alerts (Lines >= 90%)","${data.summary.alertCount}"`,
    `""`,
    `"Account Code","Account Name","Type","Branch","Budget (PKR)","Actual (PKR)","Variance (PKR)","% Used","Alert Status"`,
  ];

  for (const row of data.rows) {
    const code = `"${row.accountCode.replace(/"/g, '""')}"`;
    const name = `"${row.accountName.replace(/"/g, '""')}"`;
    const type = `"${row.accountType.toUpperCase()}"`;
    const branch = `"${(row.branchName || '').replace(/"/g, '""')}"`;
    const budget = `"${formatPaisa(row.budgetPaisa)}"`;
    const actual = `"${formatPaisa(row.actualPaisa)}"`;
    const variance = `"${formatPaisa(row.variancePaisa)}"`;
    const pct = `"${row.percentageUsed.toFixed(1)}%"`;
    const status = `"${row.alertStatus.toUpperCase()}"`;

    lines.push(
      `${code},${name},${type},${branch},${budget},${actual},${variance},${pct},${status}`
    );
  }

  return lines.join('\r\n');
}

/**
 * Triggers a browser download of CSV string.
 */
export function triggerCsvDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
