import type {
  TrialBalanceReportData,
  ProfitAndLossReportData,
  BalanceSheetReportData,
  CashFlowReportData,
} from '../types';
import { getKarachiBusinessDate, toKarachiBusinessDate } from '@pos/shared';

export type PresetPeriod = 'this_month' | 'last_month' | 'this_quarter' | 'this_year';

export function getPresetDateRange(preset: PresetPeriod): { startDate: string; endDate: string } {
  const karachiToday = getKarachiBusinessDate();
  const year = parseInt(karachiToday.slice(0, 4), 10);
  const month = parseInt(karachiToday.slice(5, 7), 10) - 1; // 0-indexed

  if (preset === 'this_month') {
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 0));
    return {
      startDate: toKarachiBusinessDate(start),
      endDate: toKarachiBusinessDate(end),
    };
  }

  if (preset === 'last_month') {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    return {
      startDate: toKarachiBusinessDate(start),
      endDate: toKarachiBusinessDate(end),
    };
  }

  if (preset === 'this_quarter') {
    const quarterStartMonth = Math.floor(month / 3) * 3;
    const start = new Date(Date.UTC(year, quarterStartMonth, 1));
    const end = new Date(Date.UTC(year, quarterStartMonth + 3, 0));
    return {
      startDate: toKarachiBusinessDate(start),
      endDate: toKarachiBusinessDate(end),
    };
  }

  // this_year
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  };
}

export function computePreviousPeriod(
  startDate: string,
  endDate: string
): { prevStartDate: string; prevEndDate: string } {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const durationMs = end.getTime() - start.getTime() + 24 * 60 * 60 * 1000;

  const prevEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const prevStart = new Date(prevEnd.getTime() - durationMs + 24 * 60 * 60 * 1000);

  return {
    prevStartDate: toKarachiBusinessDate(prevStart),
    prevEndDate: toKarachiBusinessDate(prevEnd),
  };
}

export function formatBasisPoints(bp: number): string {
  const percent = (bp / 100).toFixed(1);
  return bp > 0 ? `+${percent}%` : `${percent}%`;
}

// -----------------------------------------------------------------------------
// RFC-4180 CSV GENERATORS
// -----------------------------------------------------------------------------
export function generateTrialBalanceCsv(report: TrialBalanceReportData): string {
  const headers = [
    'Account Code',
    'Account Name',
    'Type',
    'Opening Balance Paisa',
    'Debit Paisa',
    'Credit Paisa',
    'Closing Balance Paisa',
    'Opening (PKR)',
    'Debit (PKR)',
    'Credit (PKR)',
    'Closing (PKR)',
  ];

  const rows = report.rows.map((r) => [
    r.code,
    `"${r.name.replace(/"/g, '""')}"`,
    r.type,
    r.openingBalancePaisa,
    r.debitPaisa,
    r.creditPaisa,
    r.closingBalancePaisa,
    (r.openingBalancePaisa / 100).toFixed(2),
    (r.debitPaisa / 100).toFixed(2),
    (r.creditPaisa / 100).toFixed(2),
    (r.closingBalancePaisa / 100).toFixed(2),
  ]);

  rows.push([
    'TOTALS',
    'Total Debits & Credits',
    '',
    '',
    report.totalDebitPaisa,
    report.totalCreditPaisa,
    '',
    '',
    (report.totalDebitPaisa / 100).toFixed(2),
    (report.totalCreditPaisa / 100).toFixed(2),
    '',
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

export function generateProfitAndLossCsv(report: ProfitAndLossReportData): string {
  const lines: string[] = [];
  lines.push('Statement: Profit & Loss Statement (Income Statement)');
  lines.push(`Period: ${report.startDate} to ${report.endDate}`);
  lines.push(`Branch: ${report.branchName || 'Company-Wide'}`);
  lines.push('');
  lines.push('Section,Account Code,Account Name,Amount Paisa,Amount (PKR)');

  // Revenue
  for (const r of report.sections.revenue.rows) {
    lines.push(
      `Revenue,${r.code},"${r.name.replace(/"/g, '""')}",${r.amountPaisa},${(r.amountPaisa / 100).toFixed(2)}`
    );
  }
  lines.push(
    `Total Revenue,,,${report.summary.totalRevenuePaisa},${(report.summary.totalRevenuePaisa / 100).toFixed(2)}`
  );
  lines.push('');

  // COGS
  for (const r of report.sections.costOfGoodsSold.rows) {
    lines.push(
      `Cost of Goods Sold,${r.code},"${r.name.replace(/"/g, '""')}",${r.amountPaisa},${(r.amountPaisa / 100).toFixed(2)}`
    );
  }
  lines.push(
    `Total Cost of Goods Sold,,,${report.summary.totalCogsPaisa},${(report.summary.totalCogsPaisa / 100).toFixed(2)}`
  );
  lines.push(
    `Gross Profit,,,${report.summary.grossProfitPaisa},${(report.summary.grossProfitPaisa / 100).toFixed(2)}`
  );
  lines.push('');

  // Expenses
  for (const r of report.sections.operatingExpenses.rows) {
    lines.push(
      `Operating Expenses,${r.code},"${r.name.replace(/"/g, '""')}",${r.amountPaisa},${(r.amountPaisa / 100).toFixed(2)}`
    );
  }
  lines.push(
    `Total Operating Expenses,,,${report.summary.totalOperatingExpensesPaisa},${(report.summary.totalOperatingExpensesPaisa / 100).toFixed(2)}`
  );
  lines.push('');
  lines.push(
    `NET PROFIT / (LOSS),,,${report.summary.netProfitPaisa},${(report.summary.netProfitPaisa / 100).toFixed(2)}`
  );

  return lines.join('\n');
}

export function generateBalanceSheetCsv(report: BalanceSheetReportData): string {
  const lines: string[] = [];
  lines.push('Statement: Balance Sheet');
  lines.push(`As of: ${report.endDate}`);
  lines.push(`Branch: ${report.branchName || 'Company-Wide'}`);
  lines.push('');
  lines.push('Category,Account Code,Account Name,Balance Paisa,Balance (PKR)');

  // Assets
  for (const r of report.sections.assets.rows) {
    lines.push(
      `Asset,${r.code},"${r.name.replace(/"/g, '""')}",${r.balancePaisa},${(r.balancePaisa / 100).toFixed(2)}`
    );
  }
  lines.push(
    `TOTAL ASSETS,,,${report.summary.totalAssetsPaisa},${(report.summary.totalAssetsPaisa / 100).toFixed(2)}`
  );
  lines.push('');

  // Liabilities
  for (const r of report.sections.liabilities.rows) {
    lines.push(
      `Liability,${r.code},"${r.name.replace(/"/g, '""')}",${r.balancePaisa},${(r.balancePaisa / 100).toFixed(2)}`
    );
  }
  lines.push(
    `TOTAL LIABILITIES,,,${report.summary.totalLiabilitiesPaisa},${(report.summary.totalLiabilitiesPaisa / 100).toFixed(2)}`
  );
  lines.push('');

  // Equity
  for (const r of report.sections.equity.rows) {
    lines.push(
      `Equity,${r.code},"${r.name.replace(/"/g, '""')}",${r.balancePaisa},${(r.balancePaisa / 100).toFixed(2)}`
    );
  }
  lines.push(
    `Current Period Profit (P&L),,,${report.summary.currentPeriodProfitPaisa},${(report.summary.currentPeriodProfitPaisa / 100).toFixed(2)}`
  );
  lines.push(
    `TOTAL EQUITY & RESERVES,,,${report.summary.totalEquityAndReservesPaisa},${(report.summary.totalEquityAndReservesPaisa / 100).toFixed(2)}`
  );
  lines.push('');
  lines.push(
    `TOTAL LIABILITIES & EQUITY,,,${report.summary.totalLiabilitiesAndEquityPaisa},${(report.summary.totalLiabilitiesAndEquityPaisa / 100).toFixed(2)}`
  );
  lines.push(
    `Difference (Assets - Liabilities & Equity),,,${report.summary.differencePaisa},${(report.summary.differencePaisa / 100).toFixed(2)}`
  );

  return lines.join('\n');
}

export function generateCashFlowCsv(report: CashFlowReportData): string {
  const lines: string[] = [];
  lines.push('Statement: Cash Flow Statement (Cash & Bank)');
  lines.push(`Period: ${report.startDate} to ${report.endDate}`);
  lines.push('');
  lines.push('Flow Type,Category,Description,Amount Paisa,Amount (PKR)');

  lines.push(
    `Opening Cash & Bank,,,${report.summary.openingCashPaisa},${(report.summary.openingCashPaisa / 100).toFixed(2)}`
  );
  lines.push('');

  for (const inf of report.inflows) {
    lines.push(
      `Inflow,${inf.category},"${inf.label.replace(/"/g, '""')}",${inf.amountPaisa},${(inf.amountPaisa / 100).toFixed(2)}`
    );
  }
  lines.push(
    `Total Cash Inflows,,,${report.summary.totalInflowsPaisa},${(report.summary.totalInflowsPaisa / 100).toFixed(2)}`
  );
  lines.push('');

  for (const out of report.outflows) {
    lines.push(
      `Outflow,${out.category},"${out.label.replace(/"/g, '""')}",${out.amountPaisa},${(out.amountPaisa / 100).toFixed(2)}`
    );
  }
  lines.push(
    `Total Cash Outflows,,,${report.summary.totalOutflowsPaisa},${(report.summary.totalOutflowsPaisa / 100).toFixed(2)}`
  );
  lines.push('');

  lines.push(
    `Net Cash Flow,,,${report.summary.netCashFlowPaisa},${(report.summary.netCashFlowPaisa / 100).toFixed(2)}`
  );
  lines.push(
    `Closing Cash & Bank,,,${report.summary.closingCashPaisa},${(report.summary.closingCashPaisa / 100).toFixed(2)}`
  );

  return lines.join('\n');
}

export function triggerCsvDownload(csvContent: string, fileName: string): void {
  const encodedUri = encodeURI(`data:text/csv;charset=utf-8,${csvContent}`);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
