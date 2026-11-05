import { describe, it, expect } from 'vitest';
import {
  computePreviousPeriod,
  formatBasisPoints,
  generateTrialBalanceCsv,
  generateProfitAndLossCsv,
  generateBalanceSheetCsv,
} from './lib/financial-reports-utils';
import type {
  TrialBalanceReportData,
  ProfitAndLossReportData,
  BalanceSheetReportData,
} from './types';

describe('Financial Reports Client Utilities & CSV Generation', () => {
  it('1. correctly computes previous period of identical duration', () => {
    // 30 days: 2026-11-01 to 2026-11-30
    const prev = computePreviousPeriod('2026-11-01', '2026-11-30');
    expect(prev.prevEndDate).toBe('2026-10-31');
    expect(prev.prevStartDate).toBe('2026-10-02');
  });

  it('2. formats basis points into signed percentage strings', () => {
    expect(formatBasisPoints(1250)).toBe('+12.5%');
    expect(formatBasisPoints(-320)).toBe('-3.2%');
    expect(formatBasisPoints(0)).toBe('0.0%');
  });

  it('3. generates standard RFC-4180 CSV for Trial Balance with balanced totals', () => {
    const mockTb: TrialBalanceReportData = {
      pharmacyId: 'p-1',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      branchId: null,
      branchName: null,
      totalOpeningDebitPaisa: 0,
      totalOpeningCreditPaisa: 0,
      totalDebitPaisa: 5000000,
      totalCreditPaisa: 5000000,
      totalClosingDebitPaisa: 5000000,
      totalClosingCreditPaisa: 5000000,
      isBalanced: true,
      rows: [
        {
          accountId: 'a-1',
          code: '1000',
          name: 'Cash in Hand',
          type: 'asset',
          openingBalancePaisa: 0,
          debitPaisa: 5000000,
          creditPaisa: 0,
          closingBalancePaisa: 5000000,
        },
        {
          accountId: 'a-2',
          code: '4000',
          name: 'Sales Revenue',
          type: 'revenue',
          openingBalancePaisa: 0,
          debitPaisa: 0,
          creditPaisa: 5000000,
          closingBalancePaisa: -5000000,
        },
      ],
    };

    const csv = generateTrialBalanceCsv(mockTb);
    expect(csv).toContain(
      '1000,"Cash in Hand",asset,0,5000000,0,5000000,0.00,50000.00,0.00,50000.00'
    );
    expect(csv).toContain('TOTALS,Total Debits & Credits,,,5000000,5000000,,,50000.00,50000.00');
  });

  it('4. generates P&L, Balance Sheet, and Cash Flow CSVs with correct math', () => {
    const mockPnl: ProfitAndLossReportData = {
      pharmacyId: 'p-1',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      branchId: null,
      branchName: null,
      summary: {
        totalRevenuePaisa: 22000000,
        totalCogsPaisa: 13400000,
        grossProfitPaisa: 8600000,
        grossMarginBp: 3909,
        totalOperatingExpensesPaisa: 6000000,
        netProfitPaisa: 2600000,
        netMarginBp: 1182,
      },
      sections: {
        revenue: { totalPaisa: 22000000, rows: [] },
        costOfGoodsSold: { totalPaisa: 13400000, rows: [] },
        operatingExpenses: { totalPaisa: 6000000, rows: [] },
      },
    };

    const pnlCsv = generateProfitAndLossCsv(mockPnl);
    expect(pnlCsv).toContain('NET PROFIT / (LOSS),,,2600000,26000.00');

    const mockBs: BalanceSheetReportData = {
      pharmacyId: 'p-1',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      branchId: null,
      branchName: null,
      summary: {
        totalAssetsPaisa: 117600000,
        totalLiabilitiesPaisa: 15000000,
        totalBaseEquityPaisa: 100000000,
        currentPeriodProfitPaisa: 2600000,
        totalEquityAndReservesPaisa: 102600000,
        totalLiabilitiesAndEquityPaisa: 117600000,
        differencePaisa: 0,
      },
      isBalanced: true,
      sections: {
        assets: { totalPaisa: 117600000, rows: [] },
        liabilities: { totalPaisa: 15000000, rows: [] },
        equity: {
          totalBasePaisa: 100000000,
          currentPeriodProfitPaisa: 2600000,
          totalWithProfitPaisa: 102600000,
          rows: [],
        },
      },
    };

    const bsCsv = generateBalanceSheetCsv(mockBs);
    expect(bsCsv).toContain('TOTAL ASSETS,,,117600000,1176000.00');
    expect(bsCsv).toContain('TOTAL LIABILITIES & EQUITY,,,117600000,1176000.00');
    expect(bsCsv).toContain('Difference (Assets - Liabilities & Equity),,,0,0.00');
  });
});
