import React, { useState, useEffect, useCallback } from 'react';
import { parsePkrToPaisa, getKarachiBusinessDate } from '@pos/shared';
import type { ActualVsBudgetReportData, BranchRecord } from '../../types';
import { apiFetch } from '../../lib/api';
import { formatPaisa } from '../../lib/formatters';
import { generateBudgetCsv, triggerCsvDownload, MONTH_NAMES } from '../../lib/budget-utils';
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
  PiggyBank,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Download,
  Printer,
  RefreshCw,
  Plus,
  Copy,
  ChevronRight,
  X,
  Target,
  AlertCircle,
  Layers,
  Search,
} from 'lucide-react';

interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

export const BudgetPlanningPage: React.FC = () => {
  const currentYear = parseInt(getKarachiBusinessDate().slice(0, 4), 10);

  // Filters
  const [fiscalYear, setFiscalYear] = useState<number>(currentYear);
  const [month, setMonth] = useState<number>(0); // 0 = Full Year
  const [branchId, setBranchId] = useState<string>('');
  const [accountTypeFilter, setAccountTypeFilter] = useState<'all' | 'expense' | 'revenue'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Data
  const [report, setReport] = useState<ActualVsBudgetReportData | null>(null);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Set Budget Drawer State
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [drawerBranchId, setDrawerBranchId] = useState<string>('');
  const [drawerAccountId, setDrawerAccountId] = useState<string>('');
  const [annualAmountInput, setAnnualAmountInput] = useState<string>('');
  const [monthlyInputs, setMonthlyInputs] = useState<string[]>(Array(12).fill('0'));
  const [drawerNotes, setDrawerNotes] = useState<string>('');
  const [isSavingBudget, setIsSavingBudget] = useState<boolean>(false);

  // Copy Budget Modal State
  const [isCopyModalOpen, setIsCopyModalOpen] = useState<boolean>(false);
  const [copySourceYear, setCopySourceYear] = useState<number>(currentYear - 1);
  const [copyTargetYear, setCopyTargetYear] = useState<number>(currentYear);
  const [copyBranchId, setCopyBranchId] = useState<string>('');
  const [copyAdjustmentPct, setCopyAdjustmentPct] = useState<number>(0);
  const [isCopying, setIsCopying] = useState<boolean>(false);

  // 1. Fetch Branches & Accounts
  const loadMasterData = useCallback(async () => {
    try {
      const branchRes = await apiFetch<{ branches?: BranchRecord[] }>('/api/admin/branches');
      if (branchRes?.branches) {
        setBranches(branchRes.branches);
        const firstBranch = branchRes.branches[0];
        if (firstBranch && !drawerBranchId) {
          setDrawerBranchId(firstBranch.id);
        }
      }

      // Fetch active expense & revenue accounts for budget entry
      const acctRes = await apiFetch<{ accounts?: AccountOption[] }>('/api/finance/accounts');
      if (acctRes?.accounts) {
        const eligible = acctRes.accounts.filter(
          (a) => a.type === 'expense' || a.type === 'revenue'
        );
        setAccounts(eligible);
        const firstAcct = eligible[0];
        if (firstAcct && !drawerAccountId) {
          setDrawerAccountId(firstAcct.id);
        }
      }
    } catch {
      // Ignore master data load error if handled gracefully
    }
  }, [drawerBranchId, drawerAccountId]);

  // 2. Fetch Actual vs Budget Report
  const loadBudgetReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({
        fiscalYear: fiscalYear.toString(),
      });
      if (month > 0) {
        queryParams.set('month', month.toString());
      }
      if (branchId) {
        queryParams.set('branchId', branchId);
      }
      if (accountTypeFilter !== 'all') {
        queryParams.set('accountType', accountTypeFilter);
      }

      const res = await apiFetch<{ data?: ActualVsBudgetReportData }>(
        `/api/finance/budgets/actual-vs-budget?${queryParams.toString()}`
      );
      if (res?.data) {
        setReport(res.data);
      } else {
        setReport(null);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load actual vs budget report';
      setError(msg);
      setReport(null);
    } finally {
      setIsLoading(false);
    }
  }, [fiscalYear, month, branchId, accountTypeFilter]);

  useEffect(() => {
    loadMasterData();
  }, [loadMasterData]);

  useEffect(() => {
    loadBudgetReport();
  }, [loadBudgetReport]);

  // Handle Quick Distribute Annual Amount into 12 months
  const handleDistributeAnnual = () => {
    const totalPkr = parseFloat(annualAmountInput) || 0;
    if (totalPkr <= 0) return;
    const monthlyPkr = (totalPkr / 12).toFixed(2);
    setMonthlyInputs(Array(12).fill(monthlyPkr));
  };

  // Open Drawer and load existing budget for selected branch & account
  const openSetBudgetDrawer = async (targetBranchId?: string, targetAccountId?: string) => {
    const selBranch = targetBranchId || branchId || (branches[0]?.id ?? '');
    const selAccount = targetAccountId || (accounts[0]?.id ?? '');
    setDrawerBranchId(selBranch);
    setDrawerAccountId(selAccount);
    setDrawerNotes('');

    // Load existing budgets for this branch & account in fiscalYear
    if (selBranch && selAccount) {
      try {
        const res = await apiFetch<{
          data?: { budgets?: Array<{ month: number; amountPaisa: number }> };
        }>(
          `/api/finance/budgets?fiscalYear=${fiscalYear}&branchId=${selBranch}&accountId=${selAccount}`
        );
        const newInputs = Array(12).fill('0');
        if (res?.data?.budgets) {
          for (const b of res.data.budgets) {
            if (b.month >= 1 && b.month <= 12) {
              newInputs[b.month - 1] = (b.amountPaisa / 100).toFixed(2);
            }
          }
        }
        setMonthlyInputs(newInputs);
        const sum = newInputs.reduce((acc, val) => acc + (parseFloat(val) || 0), 0);
        setAnnualAmountInput(sum.toFixed(2));
      } catch {
        setMonthlyInputs(Array(12).fill('0'));
        setAnnualAmountInput('0');
      }
    }

    setIsDrawerOpen(true);
  };

  // Save Budget Batch
  const handleSaveBudget = async () => {
    if (!drawerBranchId || !drawerAccountId) {
      alert('Please select a branch and an account');
      return;
    }

    setIsSavingBudget(true);
    try {
      const items = monthlyInputs.map((val, idx) => ({
        accountId: drawerAccountId,
        month: idx + 1,
        amountPaisa: parsePkrToPaisa(val),
        notes: drawerNotes || undefined,
      }));

      await apiFetch('/api/finance/budgets/batch', {
        method: 'POST',
        body: JSON.stringify({
          fiscalYear,
          branchId: drawerBranchId,
          items,
        }),
      });

      setIsDrawerOpen(false);
      loadBudgetReport();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save budget';
      alert(msg);
    } finally {
      setIsSavingBudget(false);
    }
  };

  // Copy Last Year Budget
  const handleCopyPreviousYear = async () => {
    if (copySourceYear === copyTargetYear) {
      alert('Source year and target year cannot be the same');
      return;
    }

    setIsCopying(true);
    try {
      const res = await apiFetch<{ data?: { copiedCount?: number } }>(
        '/api/finance/budgets/copy-previous-year',
        {
          method: 'POST',
          body: JSON.stringify({
            sourceYear: copySourceYear,
            targetYear: copyTargetYear,
            branchId: copyBranchId || undefined,
            percentageAdjustmentBp: Math.round(copyAdjustmentPct * 100),
            overwrite: true,
          }),
        }
      );

      alert(`Successfully copied ${res?.data?.copiedCount ?? 0} budget lines to ${copyTargetYear}`);
      setIsCopyModalOpen(false);
      if (fiscalYear === copyTargetYear) {
        loadBudgetReport();
      } else {
        setFiscalYear(copyTargetYear);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to copy previous year budget';
      alert(msg);
    } finally {
      setIsCopying(false);
    }
  };

  // CSV Export
  const handleExportCsv = () => {
    if (!report) return;
    const csv = generateBudgetCsv(report);
    const filename = `budget_actual_vs_budget_${fiscalYear}_${month ? 'M' + month : 'Annual'}.csv`;
    triggerCsvDownload(csv, filename);
  };

  // Filter rows by search term
  const filteredRows = (report?.rows || []).filter((r) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      r.accountCode.toLowerCase().includes(q) ||
      r.accountName.toLowerCase().includes(q) ||
      (r.branchName && r.branchName.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-24">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <PiggyBank className="h-7 w-7 text-emerald-600" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Budget Planning</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Monthly budgets per branch, actual vs budget tracking, variance math, and threshold
            alerts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button
            variant="outline"
            className="flex items-center gap-1.5"
            onClick={() => setIsCopyModalOpen(true)}
          >
            <Copy className="h-4 w-4" />
            Copy Last Year
          </Button>

          <Button
            className="flex items-center gap-1.5 bg-[#2F64D8] hover:bg-[#2452B6] text-white"
            onClick={() => openSetBudgetDrawer()}
          >
            <Plus className="h-4 w-4" />
            Set Budget
          </Button>

          <Button
            variant="outline"
            className="flex items-center gap-1.5"
            onClick={handleExportCsv}
            disabled={!report || report.rows.length === 0}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>

          <Button
            variant="outline"
            className="flex items-center gap-1.5"
            onClick={() => window.print()}
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>

          <Button variant="outline" size="icon" onClick={loadBudgetReport} title="Refresh">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* 2. Filters Bar */}
      <Card className="print:hidden">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 items-center">
            {/* Year Selector */}
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-1">
                Fiscal Year
              </label>
              <select
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-1.5 bg-white text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                value={fiscalYear}
                onChange={(e) => setFiscalYear(Number(e.target.value))}
              >
                {[
                  currentYear - 2,
                  currentYear - 1,
                  currentYear,
                  currentYear + 1,
                  currentYear + 2,
                ].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            {/* Month Selector */}
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-1">
                Period
              </label>
              <select
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-1.5 bg-white text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                <option value={0}>Full Year (Annual)</option>
                {MONTH_NAMES.map((name, idx) => (
                  <option key={idx + 1} value={idx + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {/* Branch Selector */}
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-1">
                Branch
              </label>
              <select
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-1.5 bg-white text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                <option value="">All Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Account Type Filter */}
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-1">
                Account Type
              </label>
              <select
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-1.5 bg-white text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                value={accountTypeFilter}
                onChange={(e) =>
                  setAccountTypeFilter(e.target.value as 'all' | 'expense' | 'revenue')
                }
              >
                <option value="all">All (Revenue & Expense)</option>
                <option value="expense">Expenses Only</option>
                <option value="revenue">Revenue Only</option>
              </select>
            </div>

            {/* Search */}
            <div>
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block mb-1">
                Filter Accounts
              </label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-slate-400" />
                <Input
                  placeholder="Search code or name..."
                  className="pl-8 text-sm h-9 bg-white border-slate-300 text-slate-800 placeholder:text-slate-400"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Threshold Alerts Banner (Active Alerts >= 90%) */}
      {report && report.alerts && report.alerts.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-amber-900">
                  Budget Threshold Alerts ({report.alerts.length} lines &gt; 90% of budget)
                </h3>
              </div>
              <p className="text-xs text-amber-700 mt-0.5">
                The following expense categories have exceeded 90% of their allocated budget for the
                selected period.
              </p>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {report.alerts.map((alert) => (
                  <div
                    key={alert.accountId}
                    className="p-2.5 rounded bg-white border border-amber-200 shadow-2xs flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-900 truncate">
                        {alert.accountCode} - {alert.accountName}
                      </span>
                      <Badge
                        className={
                          alert.level === 'exceeded'
                            ? 'bg-rose-100 text-rose-800 border-rose-200'
                            : 'bg-amber-100 text-amber-800 border-amber-200'
                        }
                      >
                        {alert.percentageUsed.toFixed(1)}% Used
                      </Badge>
                    </div>

                    <div className="mt-2 text-xs flex justify-between text-slate-600">
                      <span>Actual: {formatPaisa(alert.actualPaisa)}</span>
                      <span>Budget: {formatPaisa(alert.budgetPaisa)}</span>
                    </div>

                    <div className="w-full bg-slate-200 rounded-full h-1.5 mt-1.5 overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full ${
                          alert.level === 'exceeded' ? 'bg-rose-600' : 'bg-amber-500'
                        }`}
                        style={{ width: `${Math.min(alert.percentageUsed, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. KPI Summary Cards */}
      {report && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Expense Budget vs Actual */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Total Expenses
                </span>
                <span className="p-1.5 rounded-full bg-rose-50 text-rose-600">
                  <TrendingDown className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-2">
                <div className="text-lg font-bold text-slate-900">
                  {formatPaisa(report.summary.totalExpenseActualPaisa)}
                </div>
                <div className="text-xs text-slate-500 flex justify-between mt-1">
                  <span>Budget: {formatPaisa(report.summary.totalExpenseBudgetPaisa)}</span>
                  <span
                    className={`font-semibold ${
                      report.summary.totalExpenseVariancePaisa >= 0
                        ? 'text-emerald-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {report.summary.totalExpenseVariancePaisa >= 0 ? '+' : ''}
                    {formatPaisa(report.summary.totalExpenseVariancePaisa)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Revenue Target vs Actual */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Total Revenue
                </span>
                <span className="p-1.5 rounded-full bg-emerald-50 text-emerald-600">
                  <TrendingUp className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-2">
                <div className="text-lg font-bold text-slate-900">
                  {formatPaisa(report.summary.totalRevenueActualPaisa)}
                </div>
                <div className="text-xs text-slate-500 flex justify-between mt-1">
                  <span>Target: {formatPaisa(report.summary.totalRevenueBudgetPaisa)}</span>
                  <span
                    className={`font-semibold ${
                      report.summary.totalRevenueVariancePaisa >= 0
                        ? 'text-emerald-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {report.summary.totalRevenueVariancePaisa >= 0 ? '+' : ''}
                    {formatPaisa(report.summary.totalRevenueVariancePaisa)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Net Operating Budget vs Actual */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Net Operating
                </span>
                <span className="p-1.5 rounded-full bg-blue-50 text-blue-600">
                  <Target className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-2">
                <div className="text-lg font-bold text-slate-900">
                  {formatPaisa(report.summary.netActualPaisa)}
                </div>
                <div className="text-xs text-slate-500 flex justify-between mt-1">
                  <span>Budget: {formatPaisa(report.summary.netBudgetPaisa)}</span>
                  <span
                    className={`font-semibold ${
                      report.summary.netVariancePaisa >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {report.summary.netVariancePaisa >= 0 ? '+' : ''}
                    {formatPaisa(report.summary.netVariancePaisa)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Alert Status Card */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Threshold Alerts
                </span>
                <span
                  className={`p-1.5 rounded-full ${
                    report.summary.alertCount > 0
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  <AlertCircle className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-2">
                <div className="text-lg font-bold text-slate-900">
                  {report.summary.alertCount} Lines &ge; 90%
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {report.summary.alertCount === 0
                    ? 'All expenses well within budget'
                    : 'Requires management attention'}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 5. Actual vs Budget Visual Chart (Pure SVG / Tailwind Offline) */}
      {report && filteredRows.length > 0 && (
        <Card className="overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Layers className="h-4 w-4 text-emerald-600" />
                Actual vs Budget Breakdown by Category
              </h2>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-xs bg-indigo-500 inline-block" />
                  Budget Allocated
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-xs bg-emerald-500 inline-block" />
                  Actual Incurred
                </span>
              </div>
            </div>

            <div className="space-y-3.5 max-h-72 overflow-y-auto pr-2">
              {filteredRows.slice(0, 10).map((row) => {
                const maxVal = Math.max(row.budgetPaisa, row.actualPaisa, 1);
                const budgetPct = Math.min(100, Math.round((row.budgetPaisa / maxVal) * 100));
                const actualPct = Math.min(100, Math.round((row.actualPaisa / maxVal) * 100));

                return (
                  <div key={row.accountId} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-800">
                        {row.accountCode} - {row.accountName}
                      </span>
                      <span className="text-slate-500">
                        {formatPaisa(row.actualPaisa)} / {formatPaisa(row.budgetPaisa)} (
                        {row.percentageUsed.toFixed(1)}%)
                      </span>
                    </div>

                    <div className="flex flex-col gap-1">
                      {/* Budget bar */}
                      <div className="w-full bg-slate-100 rounded-xs h-2 overflow-hidden">
                        <div
                          className="bg-indigo-500 h-2 rounded-xs transition-all"
                          style={{ width: `${budgetPct}%` }}
                        />
                      </div>
                      {/* Actual bar */}
                      <div className="w-full bg-slate-100 rounded-xs h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-xs transition-all ${
                            row.accountType === 'expense'
                              ? row.alertStatus === 'exceeded'
                                ? 'bg-rose-500'
                                : row.alertStatus === 'warning'
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                              : 'bg-emerald-500'
                          }`}
                          style={{ width: `${actualPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 6. Actual vs Budget Data Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Account Name</TableHead>
                <TableHead className="w-24">Type</TableHead>
                <TableHead className="w-32">Branch</TableHead>
                <TableHead className="text-right w-32">Budget (PKR)</TableHead>
                <TableHead className="text-right w-32">Actual (PKR)</TableHead>
                <TableHead className="text-right w-32">Variance (PKR)</TableHead>
                <TableHead className="w-40 text-center">% Used / Target</TableHead>
                <TableHead className="text-center w-28">Status</TableHead>
                <TableHead className="w-16 print:hidden"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-slate-500">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-emerald-600" />
                    Loading budget planning report...
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-rose-600">
                    {error}
                  </TableCell>
                </TableRow>
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-slate-400">
                    <PiggyBank className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">No budget records found for this period.</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Click &quot;Set Budget&quot; to plan monthly budgets or &quot;Copy Last
                      Year&quot; to replicate previous budgets.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((row) => (
                  <TableRow key={row.accountId} className="hover:bg-slate-50">
                    <TableCell className="font-mono text-xs font-semibold">
                      {row.accountCode}
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">{row.accountName}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          row.accountType === 'expense'
                            ? 'border-rose-300 text-rose-700 bg-rose-50'
                            : 'border-emerald-300 text-emerald-700 bg-emerald-50'
                        }
                      >
                        {row.accountType.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {row.branchName || 'All'}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatPaisa(row.budgetPaisa)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatPaisa(row.actualPaisa)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono font-semibold ${
                        row.variancePaisa >= 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {row.variancePaisa >= 0 ? '+' : ''}
                      {formatPaisa(row.variancePaisa)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-200 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-2 rounded-full ${
                              row.accountType === 'expense'
                                ? row.alertStatus === 'exceeded'
                                  ? 'bg-rose-600'
                                  : row.alertStatus === 'warning'
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500'
                                : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(row.percentageUsed, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono font-medium w-12 text-right">
                          {row.percentageUsed.toFixed(1)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        className={
                          row.alertStatus === 'exceeded'
                            ? 'bg-rose-100 text-rose-800 border-rose-300'
                            : row.alertStatus === 'warning'
                              ? 'bg-amber-100 text-amber-800 border-amber-300'
                              : row.alertStatus === 'achieved'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                : 'bg-slate-100 text-slate-700 border-gray-300'
                        }
                      >
                        {row.alertStatus.replace('_', ' ').toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right print:hidden">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          openSetBudgetDrawer(row.branchId || undefined, row.accountId)
                        }
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 7. Set / Edit Budget Drawer */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex justify-end">
          <div className="bg-white w-full max-w-lg h-full shadow-2xl flex flex-col justify-between overflow-y-auto">
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Set Monthly Budget</h2>
                  <p className="text-xs text-slate-500">
                    Plan monthly targets for Fiscal Year {fiscalYear}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setIsDrawerOpen(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Branch Selection */}
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Target Branch
                </label>
                <select
                  className="w-full text-sm border rounded-md px-3 py-2 bg-white focus:ring-2 focus:ring-emerald-500"
                  value={drawerBranchId}
                  onChange={(e) => {
                    setDrawerBranchId(e.target.value);
                    openSetBudgetDrawer(e.target.value, drawerAccountId);
                  }}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Account Selection */}
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Account (Expense / Revenue)
                </label>
                <select
                  className="w-full text-sm border rounded-md px-3 py-2 bg-white focus:ring-2 focus:ring-emerald-500"
                  value={drawerAccountId}
                  onChange={(e) => {
                    setDrawerAccountId(e.target.value);
                    openSetBudgetDrawer(drawerBranchId, e.target.value);
                  }}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name} ({a.type.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>

              {/* Quick Distribute Helper */}
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md space-y-2">
                <span className="text-xs font-semibold text-emerald-800 block">
                  Quick Helper: Distribute Annual Amount Evenly
                </span>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Total Annual PKR (e.g. 1200000)"
                    value={annualAmountInput}
                    onChange={(e) => setAnnualAmountInput(e.target.value)}
                    className="text-sm h-9 bg-white"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                    onClick={handleDistributeAnnual}
                  >
                    Divide by 12
                  </Button>
                </div>
              </div>

              {/* 12 Months Grid */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-600 block">
                  Monthly Budget Amounts (PKR)
                </span>
                <div className="grid grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                  {MONTH_NAMES.map((name, idx) => (
                    <div key={idx} className="space-y-1">
                      <label className="text-xs text-slate-500">{name}</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={monthlyInputs[idx]}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMonthlyInputs((prev) => {
                            const updated = [...prev];
                            updated[idx] = val;
                            return updated;
                          });
                        }}
                        className="text-sm h-8 font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Notes (Optional)
                </label>
                <Input
                  placeholder="Budget assumptions or justification..."
                  value={drawerNotes}
                  onChange={(e) => setDrawerNotes(e.target.value)}
                  className="text-sm"
                />
              </div>
            </div>

            {/* Drawer Actions Footer */}
            <div className="p-4 border-t bg-slate-50 flex items-center justify-end gap-3">
              <Button variant="outline" onClick={() => setIsDrawerOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleSaveBudget}
                disabled={isSavingBudget}
              >
                {isSavingBudget ? 'Saving...' : 'Save Budget'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Copy Last Year's Budget Modal */}
      {isCopyModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-lg shadow-xl overflow-hidden">
            <div className="p-5 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Copy className="h-5 w-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900">Copy Last Year&apos;s Budget</h3>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setIsCopyModalOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-500">
                Replicate all monthly budgets from a previous fiscal year into a target year, with
                an optional percentage inflation adjustment.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">
                    Source Year
                  </label>
                  <Input
                    type="number"
                    value={copySourceYear}
                    onChange={(e) => setCopySourceYear(Number(e.target.value))}
                    className="text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">
                    Target Year
                  </label>
                  <Input
                    type="number"
                    value={copyTargetYear}
                    onChange={(e) => setCopyTargetYear(Number(e.target.value))}
                    className="text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Branch (Optional)
                </label>
                <select
                  className="w-full text-sm border rounded-md px-3 py-2 bg-white"
                  value={copyBranchId}
                  onChange={(e) => setCopyBranchId(e.target.value)}
                >
                  <option value="">All Branches</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Inflation / Adjustment (% Change)
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 5 for +5% inflation"
                    value={copyAdjustmentPct}
                    onChange={(e) => setCopyAdjustmentPct(parseFloat(e.target.value) || 0)}
                    className="text-sm font-mono"
                  />
                  <span className="text-sm font-semibold text-slate-500">%</span>
                </div>
                <span className="text-xs text-slate-400 mt-1 block">
                  Example: +10% will multiply all budget lines by 1.10.
                </span>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCopyModalOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleCopyPreviousYear}
                disabled={isCopying}
              >
                {isCopying ? 'Copying...' : 'Copy Budgets'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
