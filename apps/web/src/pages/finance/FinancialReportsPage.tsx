import React, { useState, useEffect, useCallback } from 'react';
import type {
  TrialBalanceReportData,
  ProfitAndLossReportData,
  BalanceSheetReportData,
  CashFlowReportData,
  GeneralLedgerAccountSummaryData,
  GeneralLedgerLineDetailData,
  BranchRecord,
} from '../../types';
import { apiFetch } from '../../lib/api';
import { formatPaisa } from '../../lib/formatters';
import {
  getPresetDateRange,
  generateTrialBalanceCsv,
  generateProfitAndLossCsv,
  generateBalanceSheetCsv,
  generateCashFlowCsv,
  triggerCsvDownload,
  type PresetPeriod,
} from '../../lib/financial-reports-utils';
import {
  Card,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Button,
  Badge,
  Input,
} from '@pos/ui';
import {
  FileText,
  Scale,
  TrendingUp,
  Landmark,
  BookOpen,
  Download,
  Printer,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  X,
} from 'lucide-react';

type ReportTab = 'trial-balance' | 'profit-loss' | 'balance-sheet' | 'cash-flow' | 'general-ledger';

export const FinancialReportsPage: React.FC = () => {
  // Active Report Tab
  const [activeTab, setActiveTab] = useState<ReportTab>('trial-balance');

  // Filters
  const [dateRange, setDateRange] = useState(() => getPresetDateRange('this_month'));
  const [selectedPreset, setSelectedPreset] = useState<PresetPeriod | 'custom'>('this_month');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [compareWithPrevious, setCompareWithPrevious] = useState<boolean>(false);

  // Reference data
  const [branches, setBranches] = useState<BranchRecord[]>([]);

  // Report Data States
  const [trialBalance, setTrialBalance] = useState<TrialBalanceReportData | null>(null);
  const [profitAndLoss, setProfitAndLoss] = useState<ProfitAndLossReportData | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetReportData | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowReportData | null>(null);
  const [glAccounts, setGlAccounts] = useState<GeneralLedgerAccountSummaryData[]>([]);

  // Detailed Ledger Drill-down
  const [selectedAccountForDrill, setSelectedAccountForDrill] =
    useState<GeneralLedgerAccountSummaryData | null>(null);
  const [drillLines, setDrillLines] = useState<GeneralLedgerLineDetailData[]>([]);
  const [isDrillLoading, setIsDrillLoading] = useState<boolean>(false);

  // Page States
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch branches
  useEffect(() => {
    apiFetch<{ items?: BranchRecord[]; data?: BranchRecord[] }>('/api/admin/branches')
      .then((res) => {
        setBranches(res.items || res.data || []);
      })
      .catch(() => {});
  }, []);

  // Fetch Active Report
  const fetchActiveReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('startDate', dateRange.startDate);
      params.set('endDate', dateRange.endDate);
      if (selectedBranchId) params.set('branchId', selectedBranchId);
      if (compareWithPrevious) params.set('compareWithPrevious', 'true');

      const qs = `?${params.toString()}`;

      if (activeTab === 'trial-balance') {
        const res = await apiFetch<{ success: boolean; data: TrialBalanceReportData }>(
          `/api/finance/reports/trial-balance${qs}`
        );
        if (res.success && res.data) setTrialBalance(res.data);
      } else if (activeTab === 'profit-loss') {
        const res = await apiFetch<{ success: boolean; data: ProfitAndLossReportData }>(
          `/api/finance/reports/profit-loss${qs}`
        );
        if (res.success && res.data) setProfitAndLoss(res.data);
      } else if (activeTab === 'balance-sheet') {
        const res = await apiFetch<{ success: boolean; data: BalanceSheetReportData }>(
          `/api/finance/reports/balance-sheet${qs}`
        );
        if (res.success && res.data) setBalanceSheet(res.data);
      } else if (activeTab === 'cash-flow') {
        const res = await apiFetch<{ success: boolean; data: CashFlowReportData }>(
          `/api/finance/reports/cash-flow${qs}`
        );
        if (res.success && res.data) setCashFlow(res.data);
      } else if (activeTab === 'general-ledger') {
        const res = await apiFetch<{
          success: boolean;
          data: { accounts: GeneralLedgerAccountSummaryData[] };
        }>(`/api/finance/reports/general-ledger${qs}`);
        if (res.success && res.data) setGlAccounts(res.data.accounts || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate financial statement');
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, dateRange, selectedBranchId, compareWithPrevious]);

  useEffect(() => {
    fetchActiveReport();
  }, [fetchActiveReport]);

  // Account Drill-down Fetch
  const handleDrilldownAccount = async (acct: GeneralLedgerAccountSummaryData) => {
    setSelectedAccountForDrill(acct);
    setIsDrillLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('startDate', dateRange.startDate);
      params.set('endDate', dateRange.endDate);
      if (selectedBranchId) params.set('branchId', selectedBranchId);

      const res = await apiFetch<{
        success: boolean;
        data: { lines: GeneralLedgerLineDetailData[] };
      }>(`/api/finance/reports/general-ledger/${acct.accountId}?${params.toString()}`);

      if (res.success && res.data) {
        setDrillLines(res.data.lines || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ledger lines');
    } finally {
      setIsDrillLoading(false);
    }
  };

  const handlePresetSelect = (preset: PresetPeriod) => {
    setSelectedPreset(preset);
    setDateRange(getPresetDateRange(preset));
  };

  // CSV Export
  const handleExportCsv = () => {
    if (activeTab === 'trial-balance' && trialBalance) {
      triggerCsvDownload(
        generateTrialBalanceCsv(trialBalance),
        `trial_balance_${dateRange.startDate}_${dateRange.endDate}.csv`
      );
    } else if (activeTab === 'profit-loss' && profitAndLoss) {
      triggerCsvDownload(
        generateProfitAndLossCsv(profitAndLoss),
        `profit_and_loss_${dateRange.startDate}_${dateRange.endDate}.csv`
      );
    } else if (activeTab === 'balance-sheet' && balanceSheet) {
      triggerCsvDownload(
        generateBalanceSheetCsv(balanceSheet),
        `balance_sheet_${dateRange.endDate}.csv`
      );
    } else if (activeTab === 'cash-flow' && cashFlow) {
      triggerCsvDownload(
        generateCashFlowCsv(cashFlow),
        `cash_flow_${dateRange.startDate}_${dateRange.endDate}.csv`
      );
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 print:p-0">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Scale className="w-6 h-6 text-indigo-600" />
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Financial Reports</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            GAAP-compliant financial statements derived strictly from general journal lines.
          </p>
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={isLoading}
            className="text-xs gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            disabled={isLoading}
            className="text-xs gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            Print / PDF
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchActiveReport}
            disabled={isLoading}
            className="text-xs gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Report Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2 print:hidden">
        <button
          type="button"
          onClick={() => setActiveTab('trial-balance')}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'trial-balance'
              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Scale className="w-4 h-4" />
          Trial Balance
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('profit-loss')}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'profit-loss'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          Profit &amp; Loss
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('balance-sheet')}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'balance-sheet'
              ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          Balance Sheet
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('cash-flow')}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'cash-flow'
              ? 'bg-teal-50 text-teal-700 border border-teal-200 shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Landmark className="w-4 h-4" />
          Cash Flow
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('general-ledger')}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'general-ledger'
              ? 'bg-amber-50 text-amber-700 border border-amber-200 shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          General Ledger
        </button>
      </div>

      {/* Filter Toolbar */}
      <Card className="shadow-sm border-slate-200 print:hidden">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Presets */}
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => handlePresetSelect('this_month')}
                className={`px-2.5 py-1 rounded font-medium ${
                  selectedPreset === 'this_month'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                This Month
              </button>
              <button
                type="button"
                onClick={() => handlePresetSelect('last_month')}
                className={`px-2.5 py-1 rounded font-medium ${
                  selectedPreset === 'last_month'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Last Month
              </button>
              <button
                type="button"
                onClick={() => handlePresetSelect('this_quarter')}
                className={`px-2.5 py-1 rounded font-medium ${
                  selectedPreset === 'this_quarter'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                This Quarter
              </button>
              <button
                type="button"
                onClick={() => handlePresetSelect('this_year')}
                className={`px-2.5 py-1 rounded font-medium ${
                  selectedPreset === 'this_year'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                This Year
              </button>
            </div>

            {/* Compare Checkbox */}
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={compareWithPrevious}
                onChange={(e) => setCompareWithPrevious(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
              />
              Compare with previous period
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                Start Date
              </label>
              <Input
                type="date"
                value={dateRange.startDate}
                onChange={(e) => {
                  setSelectedPreset('custom');
                  setDateRange((prev) => ({ ...prev, startDate: e.target.value }));
                }}
                className="h-8 text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">End Date</label>
              <Input
                type="date"
                value={dateRange.endDate}
                onChange={(e) => {
                  setSelectedPreset('custom');
                  setDateRange((prev) => ({ ...prev, endDate: e.target.value }));
                }}
                className="h-8 text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Branch</label>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="w-full h-8 text-xs px-2.5 rounded-md border border-slate-300 bg-white text-slate-800"
              >
                <option value="">Company-Wide (All Branches)</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs flex items-center justify-between">
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchActiveReport}
            className="text-xs text-rose-800"
          >
            Retry
          </Button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. TRIAL BALANCE VIEW */}
      {/* ========================================================================= */}
      {activeTab === 'trial-balance' && (
        <div className="space-y-4">
          {trialBalance && (
            <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div>
                <p className="text-xs text-slate-500">Statement Health Status</p>
                <div className="flex items-center gap-2 mt-1">
                  {trialBalance.isBalanced ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold gap-1 text-xs py-0.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Trial Balance Balanced (Total Dr = Cr)
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-rose-300 bg-rose-50 text-rose-700 font-semibold gap-1 text-xs py-0.5"
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                      Trial Balance Unbalanced
                    </Badge>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">Period Movement Total</p>
                <p className="text-lg font-mono font-bold text-slate-900 mt-1">
                  {formatPaisa(trialBalance.totalDebitPaisa)}
                </p>
              </div>
            </div>
          )}

          <Card className="shadow-sm border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-semibold text-slate-700">Code</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700">
                      Account Name
                    </TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700">Type</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700 text-right">
                      Opening Balance
                    </TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700 text-right">
                      Period Debit
                    </TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700 text-right">
                      Period Credit
                    </TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700 text-right">
                      Closing Balance
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-400" />
                        Generating Trial Balance...
                      </TableCell>
                    </TableRow>
                  ) : !trialBalance || trialBalance.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-slate-400 text-xs">
                        No transactions recorded for the selected period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {trialBalance.rows.map((row) => (
                        <TableRow key={row.accountId} className="text-xs hover:bg-slate-50/80">
                          <TableCell className="font-mono font-semibold text-slate-800">
                            {row.code}
                          </TableCell>
                          <TableCell className="font-medium text-slate-900">{row.name}</TableCell>
                          <TableCell className="capitalize text-slate-500">
                            <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100">
                              {row.type}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-slate-600">
                            {formatPaisa(row.openingBalancePaisa)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-slate-700">
                            {row.debitPaisa !== 0 ? formatPaisa(row.debitPaisa) : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-slate-700">
                            {row.creditPaisa !== 0 ? formatPaisa(row.creditPaisa) : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold text-slate-900">
                            {formatPaisa(row.closingBalancePaisa)}
                          </TableCell>
                        </TableRow>
                      ))}

                      {/* Total Footer Row */}
                      <TableRow className="bg-slate-100 font-bold text-xs border-t-2 border-slate-300">
                        <TableCell colSpan={4} className="text-slate-800">
                          TOTALS (Movement Invariant: Debits = Credits)
                        </TableCell>
                        <TableCell className="text-right font-mono text-indigo-700">
                          {formatPaisa(trialBalance.totalDebitPaisa)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-indigo-700">
                          {formatPaisa(trialBalance.totalCreditPaisa)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-slate-900">
                          {formatPaisa(
                            trialBalance.totalClosingDebitPaisa -
                              trialBalance.totalClosingCreditPaisa
                          )}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. PROFIT & LOSS VIEW */}
      {/* ========================================================================= */}
      {activeTab === 'profit-loss' && (
        <div className="space-y-4">
          {profitAndLoss && (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Card className="border-l-4 border-l-emerald-500 shadow-sm">
                <CardContent className="p-4">
                  <p className="text-xs text-slate-500 uppercase font-medium">Net Revenue</p>
                  <p className="text-xl font-bold text-emerald-700 mt-1">
                    {formatPaisa(profitAndLoss.summary.totalRevenuePaisa)}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-amber-500 shadow-sm">
                <CardContent className="p-4">
                  <p className="text-xs text-slate-500 uppercase font-medium">Cost of Goods Sold</p>
                  <p className="text-xl font-bold text-amber-700 mt-1">
                    {formatPaisa(profitAndLoss.summary.totalCogsPaisa)}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-blue-500 shadow-sm">
                <CardContent className="p-4">
                  <p className="text-xs text-slate-500 uppercase font-medium">Gross Profit</p>
                  <p className="text-xl font-bold text-blue-700 mt-1">
                    {formatPaisa(profitAndLoss.summary.grossProfitPaisa)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Margin: {(profitAndLoss.summary.grossMarginBp / 100).toFixed(1)}%
                  </p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-indigo-500 shadow-sm">
                <CardContent className="p-4">
                  <p className="text-xs text-slate-500 uppercase font-medium">
                    Net Profit / (Loss)
                  </p>
                  <p
                    className={`text-xl font-bold mt-1 ${profitAndLoss.summary.netProfitPaisa >= 0 ? 'text-indigo-700' : 'text-rose-700'}`}
                  >
                    {formatPaisa(profitAndLoss.summary.netProfitPaisa)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Net Margin: {(profitAndLoss.summary.netMarginBp / 100).toFixed(1)}%
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {profitAndLoss && (
            <Card className="shadow-sm border-slate-200">
              <CardContent className="p-6 space-y-6">
                {/* 1. Revenue Section */}
                <div>
                  <h3 className="text-sm font-bold text-slate-800 border-b border-slate-200 pb-2 uppercase tracking-wide">
                    1. Operating Revenue
                  </h3>
                  <div className="divide-y divide-slate-100 text-xs">
                    {profitAndLoss.sections.revenue.rows.map((row) => (
                      <div
                        key={row.accountId}
                        className="flex justify-between py-2 hover:bg-slate-50/50"
                      >
                        <span className="text-slate-700">
                          <span className="font-mono text-slate-400 mr-2">{row.code}</span>
                          {row.name}
                        </span>
                        <span className="font-mono font-medium text-slate-900">
                          {formatPaisa(row.amountPaisa)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between py-2 font-bold text-slate-900 bg-slate-50 px-2 rounded">
                      <span>Total Revenue</span>
                      <span className="font-mono">
                        {formatPaisa(profitAndLoss.sections.revenue.totalPaisa)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. COGS Section */}
                <div>
                  <h3 className="text-sm font-bold text-slate-800 border-b border-slate-200 pb-2 uppercase tracking-wide">
                    2. Cost of Goods Sold (COGS)
                  </h3>
                  <div className="divide-y divide-slate-100 text-xs">
                    {profitAndLoss.sections.costOfGoodsSold.rows.map((row) => (
                      <div
                        key={row.accountId}
                        className="flex justify-between py-2 hover:bg-slate-50/50"
                      >
                        <span className="text-slate-700">
                          <span className="font-mono text-slate-400 mr-2">{row.code}</span>
                          {row.name}
                        </span>
                        <span className="font-mono font-medium text-slate-900">
                          {formatPaisa(row.amountPaisa)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between py-2 font-bold text-slate-900 bg-slate-50 px-2 rounded">
                      <span>Total Cost of Goods Sold</span>
                      <span className="font-mono">
                        {formatPaisa(profitAndLoss.sections.costOfGoodsSold.totalPaisa)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Gross Profit Summary */}
                <div className="flex justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm font-bold text-blue-900">
                  <span>Gross Profit</span>
                  <span className="font-mono">
                    {formatPaisa(profitAndLoss.summary.grossProfitPaisa)}
                  </span>
                </div>

                {/* 3. Operating Expenses Section */}
                <div>
                  <h3 className="text-sm font-bold text-slate-800 border-b border-slate-200 pb-2 uppercase tracking-wide">
                    3. Operating Expenses
                  </h3>
                  <div className="divide-y divide-slate-100 text-xs">
                    {profitAndLoss.sections.operatingExpenses.rows.map((row) => (
                      <div
                        key={row.accountId}
                        className="flex justify-between py-2 hover:bg-slate-50/50"
                      >
                        <span className="text-slate-700">
                          <span className="font-mono text-slate-400 mr-2">{row.code}</span>
                          {row.name}
                        </span>
                        <span className="font-mono font-medium text-slate-900">
                          {formatPaisa(row.amountPaisa)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between py-2 font-bold text-slate-900 bg-slate-50 px-2 rounded">
                      <span>Total Operating Expenses</span>
                      <span className="font-mono">
                        {formatPaisa(profitAndLoss.sections.operatingExpenses.totalPaisa)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Net Profit Summary */}
                <div className="flex justify-between p-4 bg-indigo-50 border border-indigo-200 rounded-lg text-base font-bold text-indigo-950">
                  <span>NET PROFIT / (LOSS)</span>
                  <span className="font-mono text-xl">
                    {formatPaisa(profitAndLoss.summary.netProfitPaisa)}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. BALANCE SHEET VIEW */}
      {/* ========================================================================= */}
      {activeTab === 'balance-sheet' && (
        <div className="space-y-4">
          {balanceSheet && (
            <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div>
                <p className="text-xs text-slate-500">Balance Sheet Equation</p>
                <div className="flex items-center gap-2 mt-1">
                  {balanceSheet.isBalanced ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold gap-1 text-xs py-0.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Balanced: Assets = Liabilities + Equity (Diff = 0)
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-rose-300 bg-rose-50 text-rose-700 font-semibold gap-1 text-xs py-0.5"
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                      Unbalanced Difference: {formatPaisa(balanceSheet.summary.differencePaisa)}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="text-right">
                <p className="text-xs text-slate-500">Total Assets</p>
                <p className="text-lg font-mono font-bold text-slate-900 mt-1">
                  {formatPaisa(balanceSheet.summary.totalAssetsPaisa)}
                </p>
              </div>
            </div>
          )}

          {balanceSheet && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Assets Panel */}
              <Card className="shadow-sm border-slate-200">
                <CardContent className="p-5 space-y-4">
                  <h3 className="font-bold text-slate-900 text-sm border-b pb-2 uppercase tracking-wide text-indigo-700">
                    Assets
                  </h3>
                  <div className="divide-y divide-slate-100 text-xs">
                    {balanceSheet.sections.assets.rows.map((row) => (
                      <div key={row.accountId} className="flex justify-between py-2">
                        <span className="text-slate-700">
                          <span className="font-mono text-slate-400 mr-2">{row.code}</span>
                          {row.name}
                        </span>
                        <span className="font-mono font-medium text-slate-900">
                          {formatPaisa(row.balancePaisa)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between p-3 bg-slate-50 border-t-2 border-slate-300 font-bold text-sm text-slate-900 rounded">
                    <span>TOTAL ASSETS</span>
                    <span className="font-mono">
                      {formatPaisa(balanceSheet.summary.totalAssetsPaisa)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Liabilities & Equity Panel */}
              <div className="space-y-6">
                {/* Liabilities */}
                <Card className="shadow-sm border-slate-200">
                  <CardContent className="p-5 space-y-4">
                    <h3 className="font-bold text-slate-900 text-sm border-b pb-2 uppercase tracking-wide text-rose-700">
                      Liabilities
                    </h3>
                    <div className="divide-y divide-slate-100 text-xs">
                      {balanceSheet.sections.liabilities.rows.map((row) => (
                        <div key={row.accountId} className="flex justify-between py-2">
                          <span className="text-slate-700">
                            <span className="font-mono text-slate-400 mr-2">{row.code}</span>
                            {row.name}
                          </span>
                          <span className="font-mono font-medium text-slate-900">
                            {formatPaisa(row.balancePaisa)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-between p-2.5 bg-slate-50 font-bold text-xs text-slate-900 rounded">
                      <span>Total Liabilities</span>
                      <span className="font-mono">
                        {formatPaisa(balanceSheet.summary.totalLiabilitiesPaisa)}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Equity */}
                <Card className="shadow-sm border-slate-200">
                  <CardContent className="p-5 space-y-4">
                    <h3 className="font-bold text-slate-900 text-sm border-b pb-2 uppercase tracking-wide text-emerald-700">
                      Equity &amp; Reserves
                    </h3>
                    <div className="divide-y divide-slate-100 text-xs">
                      {balanceSheet.sections.equity.rows.map((row) => (
                        <div key={row.accountId} className="flex justify-between py-2">
                          <span className="text-slate-700">
                            <span className="font-mono text-slate-400 mr-2">{row.code}</span>
                            {row.name}
                          </span>
                          <span className="font-mono font-medium text-slate-900">
                            {formatPaisa(row.balancePaisa)}
                          </span>
                        </div>
                      ))}

                      {/* Current Period Profit line */}
                      <div className="flex justify-between py-2 text-indigo-700 font-semibold bg-indigo-50/50 px-2 rounded">
                        <span>Current Period Profit (P&amp;L)</span>
                        <span className="font-mono">
                          {formatPaisa(balanceSheet.summary.currentPeriodProfitPaisa)}
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-between p-2.5 bg-slate-50 font-bold text-xs text-slate-900 rounded">
                      <span>Total Equity &amp; Reserves</span>
                      <span className="font-mono">
                        {formatPaisa(balanceSheet.summary.totalEquityAndReservesPaisa)}
                      </span>
                    </div>

                    <div className="flex justify-between p-3 bg-slate-100 border-t-2 border-slate-300 font-bold text-sm text-slate-900 rounded">
                      <span>TOTAL LIABILITIES &amp; EQUITY</span>
                      <span className="font-mono">
                        {formatPaisa(balanceSheet.summary.totalLiabilitiesAndEquityPaisa)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. CASH FLOW VIEW */}
      {/* ========================================================================= */}
      {activeTab === 'cash-flow' && (
        <div className="space-y-4">
          {cashFlow && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="shadow-sm border-slate-200">
                <CardContent className="p-4">
                  <p className="text-xs text-slate-500 font-medium">Opening Cash &amp; Bank</p>
                  <p className="text-xl font-mono font-bold text-slate-800 mt-1">
                    {formatPaisa(cashFlow.summary.openingCashPaisa)}
                  </p>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-slate-200">
                <CardContent className="p-4">
                  <p className="text-xs text-slate-500 font-medium">Net Cash Flow (Period)</p>
                  <p
                    className={`text-xl font-mono font-bold mt-1 ${cashFlow.summary.netCashFlowPaisa >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                  >
                    {formatPaisa(cashFlow.summary.netCashFlowPaisa)}
                  </p>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-slate-200">
                <CardContent className="p-4">
                  <p className="text-xs text-slate-500 font-medium">Closing Cash &amp; Bank</p>
                  <p className="text-xl font-mono font-bold text-indigo-700 mt-1">
                    {formatPaisa(cashFlow.summary.closingCashPaisa)}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {cashFlow && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Inflows */}
              <Card className="shadow-sm border-slate-200">
                <CardContent className="p-5 space-y-3">
                  <h3 className="font-bold text-emerald-800 text-sm border-b pb-2 uppercase tracking-wide">
                    Cash Inflows
                  </h3>
                  <div className="divide-y divide-slate-100 text-xs">
                    {cashFlow.inflows.map((inf, idx) => (
                      <div key={idx} className="flex justify-between py-2">
                        <span className="text-slate-700">{inf.label}</span>
                        <span className="font-mono font-medium text-emerald-700">
                          {formatPaisa(inf.amountPaisa)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between p-2.5 bg-emerald-50 font-bold text-xs text-emerald-900 rounded">
                    <span>Total Cash Inflows</span>
                    <span className="font-mono">
                      {formatPaisa(cashFlow.summary.totalInflowsPaisa)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Outflows */}
              <Card className="shadow-sm border-slate-200">
                <CardContent className="p-5 space-y-3">
                  <h3 className="font-bold text-rose-800 text-sm border-b pb-2 uppercase tracking-wide">
                    Cash Outflows
                  </h3>
                  <div className="divide-y divide-slate-100 text-xs">
                    {cashFlow.outflows.map((out, idx) => (
                      <div key={idx} className="flex justify-between py-2">
                        <span className="text-slate-700">{out.label}</span>
                        <span className="font-mono font-medium text-rose-700">
                          {formatPaisa(out.amountPaisa)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between p-2.5 bg-rose-50 font-bold text-xs text-rose-900 rounded">
                    <span>Total Cash Outflows</span>
                    <span className="font-mono">
                      {formatPaisa(cashFlow.summary.totalOutflowsPaisa)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. GENERAL LEDGER VIEW */}
      {/* ========================================================================= */}
      {activeTab === 'general-ledger' && (
        <Card className="shadow-sm border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-xs font-semibold text-slate-700">Code</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700">
                    Account Name
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700">Type</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700 text-right">
                    Opening
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700 text-right">
                    Period Debit
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700 text-right">
                    Period Credit
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700 text-right">
                    Closing Balance
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700 text-center">
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {glAccounts.map((acct) => (
                  <TableRow
                    key={acct.accountId}
                    className="hover:bg-slate-50 text-xs cursor-pointer"
                    onClick={() => handleDrilldownAccount(acct)}
                  >
                    <TableCell className="font-mono font-semibold text-slate-800">
                      {acct.code}
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">{acct.name}</TableCell>
                    <TableCell className="capitalize text-slate-500">
                      <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100">
                        {acct.type}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-slate-600">
                      {formatPaisa(acct.openingBalancePaisa)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-slate-700">
                      {acct.periodDebitPaisa !== 0 ? formatPaisa(acct.periodDebitPaisa) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-slate-700">
                      {acct.periodCreditPaisa !== 0 ? formatPaisa(acct.periodCreditPaisa) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-slate-900">
                      {formatPaisa(acct.closingBalancePaisa)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] gap-1 text-indigo-600 hover:text-indigo-800"
                      >
                        Drill Down <ChevronRight className="w-3 h-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Account Drill-down Modal */}
      {selectedAccountForDrill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-4xl w-full p-6 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  General Ledger Detail — {selectedAccountForDrill.code}{' '}
                  {selectedAccountForDrill.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Period: {dateRange.startDate} to {dateRange.endDate}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedAccountForDrill(null)}
                className="text-slate-400 hover:text-slate-600 p-1 h-auto"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="overflow-y-auto flex-1">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-semibold">Date</TableHead>
                    <TableHead className="text-xs font-semibold">Entry #</TableHead>
                    <TableHead className="text-xs font-semibold">Memo / Description</TableHead>
                    <TableHead className="text-xs font-semibold">Branch</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Debit</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Credit</TableHead>
                    <TableHead className="text-xs font-semibold text-right">
                      Running Balance
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-slate-50/50 text-xs italic">
                    <TableCell colSpan={6}>Opening Balance</TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatPaisa(selectedAccountForDrill.openingBalancePaisa)}
                    </TableCell>
                  </TableRow>

                  {isDrillLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-xs text-slate-400">
                        <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1 text-slate-400" />
                        Loading ledger lines...
                      </TableCell>
                    </TableRow>
                  ) : drillLines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-xs text-slate-400">
                        No transactions recorded in this period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    drillLines.map((l) => (
                      <TableRow key={l.lineId} className="text-xs">
                        <TableCell className="font-mono text-slate-600">{l.entryDate}</TableCell>
                        <TableCell className="font-mono">#{l.entryNo}</TableCell>
                        <TableCell className="text-slate-800">{l.memo || '—'}</TableCell>
                        <TableCell className="text-slate-500">{l.branchName || '—'}</TableCell>
                        <TableCell className="text-right font-mono text-slate-700">
                          {l.debitPaisa !== 0 ? formatPaisa(l.debitPaisa) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-slate-700">
                          {l.creditPaisa !== 0 ? formatPaisa(l.creditPaisa) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-slate-900">
                          {formatPaisa(l.runningBalancePaisa)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-100 text-xs">
              <span className="text-slate-500">
                Closing Balance:{' '}
                <span className="font-mono font-bold text-slate-900">
                  {formatPaisa(selectedAccountForDrill.closingBalancePaisa)}
                </span>
              </span>
              <Button size="sm" onClick={() => setSelectedAccountForDrill(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
