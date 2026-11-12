import React, { useState, useEffect, useCallback } from 'react';
import { getKarachiBusinessDate } from '@pos/shared';
import type { FiscalPeriodItem, MonthEndChecklistData, YearEndClosingResult } from '../../types';
import { apiFetch } from '../../lib/api';
import {
  formatPaisa,
  formatPeriodDateRange,
  getChecklistSummary,
  isYearEndPeriod,
  validateReopenReason,
} from '../../lib/period-close-utils';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  CheckCircle2,
  AlertTriangle,
  Lock,
  Unlock,
  RefreshCw,
  FileCheck,
  Building2,
  FileSpreadsheet,
  Layers,
  History,
  ShieldAlert,
} from 'lucide-react';

const MONTH_NAMES = [
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

export const PeriodClosePage: React.FC = () => {
  // Date selection state
  const todayStr = getKarachiBusinessDate();
  const [selectedYear, setSelectedYear] = useState<number>(parseInt(todayStr.slice(0, 4), 10));
  const [selectedMonth, setSelectedMonth] = useState<number>(parseInt(todayStr.slice(5, 7), 10));

  // Active tab
  const [activeTab, setActiveTab] = useState<'checklist' | 'periods' | 'year-end'>('checklist');

  // Data state
  const [checklist, setChecklist] = useState<MonthEndChecklistData | null>(null);
  const [periods, setPeriods] = useState<FiscalPeriodItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals state
  const [isCloseModalOpen, setIsCloseModalOpen] = useState<boolean>(false);
  const [closeReason, setCloseReason] = useState<string>('');
  const [isClosingPeriod, setIsClosingPeriod] = useState<boolean>(false);

  const [isReopenModalOpen, setIsReopenModalOpen] = useState<boolean>(false);
  const [reopenTargetPeriod, setReopenTargetPeriod] = useState<FiscalPeriodItem | null>(null);
  const [reopenReason, setReopenReason] = useState<string>('');
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [isReopeningPeriod, setIsReopeningPeriod] = useState<boolean>(false);

  // Year-end closing state
  const [yearEndClosingDate, setYearEndClosingDate] = useState<string>(`${selectedYear}-12-31`);
  const [yearEndMemo, setYearEndMemo] = useState<string>(`FY ${selectedYear} Year-End Closing`);
  const [isExecutingYearEnd, setIsExecutingYearEnd] = useState<boolean>(false);
  const [yearEndResult, setYearEndResult] = useState<YearEndClosingResult | null>(null);

  // Fetch checklist for selected year & month
  const fetchChecklist = useCallback(async () => {
    try {
      const res = await apiFetch<{ success: boolean; data: MonthEndChecklistData }>(
        `/api/finance/periods/checklist?year=${selectedYear}&month=${selectedMonth}`
      );
      if (res.data) {
        setChecklist(res.data);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch month-end checklist';
      setErrorMsg(msg);
    }
  }, [selectedYear, selectedMonth]);

  // Fetch fiscal periods list
  const fetchPeriods = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: FiscalPeriodItem[] }>('/api/finance/periods');
      if (res.items) {
        setPeriods(res.items);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch fiscal periods';
      setErrorMsg(msg);
    }
  }, []);

  // Initial and refresh load
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    await Promise.all([fetchChecklist(), fetchPeriods()]);
    setIsLoading(false);
  }, [fetchChecklist, fetchPeriods]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Derive current month's period record if exists
  const paddedMonth = String(selectedMonth).padStart(2, '0');
  const currentMonthStart = `${selectedYear}-${paddedMonth}-01`;
  const currentMonthPeriod = periods.find((p) => p.startDate === currentMonthStart);
  const isPeriodClosed = currentMonthPeriod?.status === 'closed';

  const checklistSummary = checklist ? getChecklistSummary(checklist.items) : null;

  // Handle Close Month
  const handleCloseMonth = async () => {
    if (!checklist) return;
    setIsClosingPeriod(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await apiFetch('/api/finance/periods/close', {
        method: 'POST',
        body: JSON.stringify({
          startDate: checklist.startDate,
          endDate: checklist.endDate,
          reason:
            closeReason || `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear} Month-End Close`,
        }),
      });
      setSuccessMsg(
        `Fiscal period for ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear} closed successfully.`
      );
      setIsCloseModalOpen(false);
      setCloseReason('');
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to close period';
      setErrorMsg(msg);
    } finally {
      setIsClosingPeriod(false);
    }
  };

  // Handle Reopen Month
  const handleReopenMonth = async () => {
    if (!reopenTargetPeriod) return;
    const validation = validateReopenReason(reopenReason);
    if (!validation.isValid) {
      setReopenError(validation.error || 'Invalid reason');
      return;
    }

    setIsReopeningPeriod(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setReopenError(null);
    try {
      await apiFetch(`/api/finance/periods/${reopenTargetPeriod.id}/reopen`, {
        method: 'POST',
        body: JSON.stringify({
          reason: reopenReason.trim(),
        }),
      });
      setSuccessMsg(
        `Fiscal period (${reopenTargetPeriod.startDate} to ${reopenTargetPeriod.endDate}) reopened.`
      );
      setIsReopenModalOpen(false);
      setReopenTargetPeriod(null);
      setReopenReason('');
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reopen period';
      setReopenError(msg);
    } finally {
      setIsReopeningPeriod(false);
    }
  };

  // Handle Year-End Closing
  const handleExecuteYearEnd = async () => {
    setIsExecutingYearEnd(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: YearEndClosingResult }>(
        '/api/finance/periods/year-end-closing',
        {
          method: 'POST',
          body: JSON.stringify({
            fiscalYear: selectedYear,
            closingDate: yearEndClosingDate,
            memo: yearEndMemo,
          }),
        }
      );
      if (res.data) {
        setYearEndResult(res.data);
        setSuccessMsg(
          `FY ${selectedYear} closing entries posted successfully! Net Profit: ${formatPaisa(
            res.data.netProfitPaisa
          )} transferred to Retained Earnings (3100).`
        );
      }
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to execute year-end closing';
      setErrorMsg(msg);
    } finally {
      setIsExecutingYearEnd(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Period Close & Year-End
          </h1>
          <p className="text-sm text-slate-500">
            Month-end checklist verification, period locking (owner only), and FY closing entries to
            Retained Earnings
          </p>
        </div>

        {/* Controls: Year, Month, Refresh */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label
              htmlFor="period-year-select"
              className="text-xs font-semibold text-slate-600 uppercase tracking-wider"
            >
              Year:
            </label>
            <select
              id="period-year-select"
              aria-label="Select Year"
              value={selectedYear}
              onChange={(e) => {
                const y = Number(e.target.value);
                setSelectedYear(y);
                setYearEndClosingDate(`${y}-12-31`);
                setYearEndMemo(`FY ${y} Year-End Closing`);
              }}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {[2024, 2025, 2026, 2027, 2028].map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="period-month-select"
              className="text-xs font-semibold text-slate-600 uppercase tracking-wider"
            >
              Month:
            </label>
            <select
              id="period-month-select"
              aria-label="Select Month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={idx + 1} value={idx + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={isLoading}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {!isPeriodClosed ? (
            <Button
              variant="default"
              size="sm"
              onClick={() => setIsCloseModalOpen(true)}
              disabled={isLoading || isPeriodClosed}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Lock className="w-4 h-4" />
              Close {MONTH_NAMES[selectedMonth - 1]}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (currentMonthPeriod) {
                  setReopenTargetPeriod(currentMonthPeriod);
                  setIsReopenModalOpen(true);
                }
              }}
              className="flex items-center gap-1.5 border-amber-500 text-amber-700 hover:bg-amber-50"
            >
              <Unlock className="w-4 h-4" />
              Reopen Period
            </Button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 text-rose-600" />
          <span className="text-sm font-medium">{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-600" />
          <span className="text-sm font-medium">{successMsg}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Period Status */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Period Status
              </span>
              {isPeriodClosed ? (
                <Lock className="w-4 h-4 text-rose-500" />
              ) : (
                <Unlock className="w-4 h-4 text-emerald-500" />
              )}
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <Badge variant={isPeriodClosed ? 'destructive' : 'default'}>
                {isPeriodClosed ? 'Closed (Locked)' : 'Open (Active)'}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {MONTH_NAMES[selectedMonth - 1]} {selectedYear} (
              {checklist ? formatPeriodDateRange(checklist.startDate, checklist.endDate) : '...'})
            </p>
          </CardContent>
        </Card>

        {/* Card 2: Readiness Score */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Readiness Score
              </span>
              <FileCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">
                {checklistSummary ? `${checklistSummary.readinessScore}%` : '---'}
              </span>
              <span className="text-xs text-slate-500">
                ({checklistSummary?.passed ?? 0} of {checklistSummary?.total ?? 0} checks passed)
              </span>
            </div>
            <div className="mt-2 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full ${
                  checklistSummary?.canClose ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
                style={{ width: `${checklistSummary?.readinessScore ?? 0}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Unposted Documents */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Unposted Documents
              </span>
              <Layers className="w-4 h-4 text-amber-500" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">
                {checklist?.items.find((i) => i.id === 'unposted_documents')?.count ?? 0}
              </span>
              <span className="text-xs text-slate-500">pending items</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">Unapproved expenses and physical counts</p>
          </CardContent>
        </Card>

        {/* Card 4: Reconciliation Difference */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Reconciliations
              </span>
              <Building2 className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              {checklist?.items.find((i) => i.id === 'reconciliation_differences')?.status ===
              'passed' ? (
                <span className="text-2xl font-bold text-emerald-600">Zero Diff</span>
              ) : (
                <span className="text-2xl font-bold text-rose-600">Discrepancy</span>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">Control accounts & Trial Balance aligned</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs Header */}
      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('checklist')}
          className={`py-3 px-5 text-sm font-semibold border-b-2 flex items-center gap-2 ${
            activeTab === 'checklist'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          <FileCheck className="w-4 h-4" />
          Month-End Readiness Checklist
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('periods')}
          className={`py-3 px-5 text-sm font-semibold border-b-2 flex items-center gap-2 ${
            activeTab === 'periods'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          <History className="w-4 h-4" />
          Period History & Audit Log
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('year-end')}
          className={`py-3 px-5 text-sm font-semibold border-b-2 flex items-center gap-2 ${
            activeTab === 'year-end'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Year-End Closing (Retained Earnings)
          {isYearEndPeriod(selectedMonth) && (
            <Badge variant="default" className="bg-emerald-600 ml-1 text-[10px]">
              Dec Active
            </Badge>
          )}
        </button>
      </div>

      {/* TAB 1: Month-End Checklist */}
      {activeTab === 'checklist' && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-slate-900">
                    Pre-Close Verification Checklist for {MONTH_NAMES[selectedMonth - 1]}{' '}
                    {selectedYear}
                  </CardTitle>
                  <p className="text-xs text-slate-500 mt-1">
                    All items must be in &quot;Passed&quot; state before locking the month to
                    prevent out-of-balance entries.
                  </p>
                </div>
                {checklistSummary?.canClose ? (
                  <Badge
                    variant="default"
                    className="bg-emerald-600 flex items-center gap-1 text-xs px-2.5 py-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Ready to Close
                  </Badge>
                ) : (
                  <Badge
                    variant="destructive"
                    className="flex items-center gap-1 text-xs px-2.5 py-1"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" /> Action Required
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Status</TableHead>
                    <TableHead className="w-64">Verification Item</TableHead>
                    <TableHead>System Findings & Description</TableHead>
                    <TableHead className="w-32 text-right">Pending Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checklist?.items.map((item) => (
                    <TableRow key={item.id} className="hover:bg-slate-50/50">
                      <TableCell>
                        {item.status === 'passed' ? (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 text-emerald-700">
                            <CheckCircle2 className="w-4 h-4" />
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-700">
                            <AlertTriangle className="w-4 h-4" />
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-semibold text-slate-800 text-sm">
                        {item.title}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{item.description}</TableCell>
                      <TableCell className="text-right">
                        {item.count > 0 ? (
                          <Badge variant="destructive" className="font-mono text-xs">
                            {item.count}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-slate-400 font-mono text-xs">
                            0
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!checklist?.items || checklist.items.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-slate-400 text-sm">
                        Loading checklist verification items...
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Readiness Banner */}
          {checklistSummary?.canClose ? (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-emerald-900">Checklist Complete</h4>
                  <p className="text-xs text-emerald-700">
                    All subledgers, bank accounts, and physical stock counts have been reconciled
                    with zero discrepancy.
                  </p>
                </div>
              </div>
              {!isPeriodClosed && (
                <Button
                  size="sm"
                  onClick={() => setIsCloseModalOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Lock className="w-4 h-4 mr-1.5" /> Lock Period Now
                </Button>
              )}
            </div>
          ) : (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-amber-900">Pending Month-End Requirements</h4>
                <p className="text-xs text-amber-700">
                  Please resolve the warnings above before closing this fiscal period. Unapproved
                  items or missing reconciliations can compromise financial report integrity.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Fiscal Periods History */}
      {activeTab === 'periods' && (
        <Card>
          <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-slate-900">
                Fiscal Periods & Locking Audit Log
              </CardTitle>
              <p className="text-xs text-slate-500 mt-1">
                Historical record of closed and reopened periods. Reopening is strictly logged for
                audit integrity.
              </p>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Start Date</TableHead>
                  <TableHead className="w-32">End Date</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead>Closed Details</TableHead>
                  <TableHead>Reopen Reason & Audit</TableHead>
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => (
                  <TableRow key={period.id} className="hover:bg-slate-50/50">
                    <TableCell className="font-mono text-sm text-slate-700">
                      {period.startDate}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-700">
                      {period.endDate}
                    </TableCell>
                    <TableCell>
                      <Badge variant={period.status === 'closed' ? 'destructive' : 'default'}>
                        {period.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {period.closedAt ? (
                        <div>
                          <span>Closed: {new Date(period.closedAt).toLocaleDateString()}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400">---</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {period.reopenReason ? (
                        <div className="max-w-md">
                          <span className="font-semibold text-amber-800">Reason: </span>
                          <span>{period.reopenReason}</span>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Reopened:{' '}
                            {period.reopenedAt
                              ? new Date(period.reopenedAt).toLocaleDateString()
                              : ''}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">---</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {period.status === 'closed' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setReopenTargetPeriod(period);
                            setIsReopenModalOpen(true);
                          }}
                          className="h-7 px-2 text-xs border-amber-500 text-amber-700 hover:bg-amber-50"
                        >
                          <Unlock className="w-3.5 h-3.5 mr-1" /> Reopen
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedYear(Number(period.startDate.slice(0, 4)));
                            setSelectedMonth(Number(period.startDate.slice(5, 7)));
                            setIsCloseModalOpen(true);
                          }}
                          className="h-7 px-2 text-xs text-emerald-700 hover:bg-emerald-50"
                        >
                          <Lock className="w-3.5 h-3.5 mr-1" /> Close
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {periods.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-slate-400 text-sm">
                      No fiscal periods registered yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* TAB 3: Year-End Closing */}
      {activeTab === 'year-end' && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-slate-900">
                    Fiscal Year {selectedYear} Year-End Closing Entry
                  </CardTitle>
                  <p className="text-xs text-slate-500 mt-1">
                    Zeroes out all Revenue (4000-4999) and Expense (5000-6999) accounts and
                    transfers the Net Profit / Loss to Retained Earnings (3100).
                  </p>
                </div>
                <Badge variant="outline" className="font-mono text-xs">
                  Target Account: 3100 (Retained Earnings)
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm">
                  <ShieldAlert className="w-4 h-4 text-emerald-600" />
                  <span>Year-End Closing Mechanism (Rule 4: Balanced Journal Entries)</span>
                </div>
                <ul className="text-xs text-slate-600 space-y-1 list-disc pl-5">
                  <li>
                    Debit all Revenue accounts with net credit balance to bring their balance to
                    zero.
                  </li>
                  <li>
                    Credit all Expense accounts with net debit balance to bring their balance to
                    zero.
                  </li>
                  <li>Credit Retained Earnings (3100) by Net Profit (or Debit by Net Loss).</li>
                  <li>Total Debits = Total Credits (Strictly balanced trigger pass).</li>
                  <li>
                    Requires Owner role (&quot;finance.period_close.execute&quot; permission).
                  </li>
                </ul>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="year-end-date"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Closing Entry Date:
                  </label>
                  <Input
                    id="year-end-date"
                    type="date"
                    value={yearEndClosingDate}
                    onChange={(e) => setYearEndClosingDate(e.target.value)}
                    className="w-full text-sm font-mono"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Typically December 31 of the closing fiscal year.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="year-end-memo"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Journal Entry Memo:
                  </label>
                  <Input
                    id="year-end-memo"
                    type="text"
                    value={yearEndMemo}
                    onChange={(e) => setYearEndMemo(e.target.value)}
                    className="w-full text-sm"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Description visible on General Ledger and Trial Balance.
                  </p>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <Button
                  onClick={handleExecuteYearEnd}
                  disabled={isExecutingYearEnd}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  {isExecutingYearEnd
                    ? 'Posting Closing Entry...'
                    : `Post FY ${selectedYear} Closing Entry`}
                </Button>
              </div>

              {yearEndResult && (
                <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg space-y-2">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Year-End Closing Entry Successfully Posted</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-emerald-800">
                    <div>
                      <span className="text-slate-500">Journal Entry ID: </span>
                      <span className="font-mono">{yearEndResult.journalEntryId}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Net Profit Transferred: </span>
                      <span className="font-bold">{formatPaisa(yearEndResult.netProfitPaisa)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Accounts Zeroed: </span>
                      <span className="font-bold">{yearEndResult.linesCount}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* MODAL 1: Close Period Dialog */}
      {isCloseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-slate-900">
              <div className="p-2.5 bg-rose-100 rounded-full text-rose-600">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-lg">Close Fiscal Period</h3>
                <p className="text-xs text-slate-500">
                  {MONTH_NAMES[selectedMonth - 1]} {selectedYear} (
                  {checklist ? formatPeriodDateRange(checklist.startDate, checklist.endDate) : ''})
                </p>
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-xs space-y-1">
              <p className="font-semibold">Important Notice:</p>
              <p>
                Closing this period will strictly block new manual journal entries and reject
                offline POS sync events dated inside this period.
              </p>
            </div>

            <div>
              <label
                htmlFor="close-reason-input"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Close Notes / Reason:
              </label>
              <Input
                id="close-reason-input"
                type="text"
                placeholder="e.g. Month-end closing verification complete"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                className="w-full text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCloseModalOpen(false)}
                disabled={isClosingPeriod}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCloseMonth}
                disabled={isClosingPeriod}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {isClosingPeriod ? 'Closing...' : 'Confirm & Lock Period'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Reopen Period Dialog */}
      {isReopenModalOpen && reopenTargetPeriod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-slate-900">
              <div className="p-2.5 bg-amber-100 rounded-full text-amber-600">
                <Unlock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-lg">Reopen Fiscal Period</h3>
                <p className="text-xs text-slate-500">
                  Period:{' '}
                  {formatPeriodDateRange(reopenTargetPeriod.startDate, reopenTargetPeriod.endDate)}
                </p>
              </div>
            </div>

            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs space-y-1">
              <p className="font-semibold">Audit Accountability Warning:</p>
              <p>
                Reopening a period allows new postings and revisions to historical records. A clear
                audit reason is mandatory (minimum 5 characters) and will be permanently recorded in
                the system audit log.
              </p>
            </div>

            <div>
              <label
                htmlFor="reopen-reason-input"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Mandatory Reopening Reason:
              </label>
              <Input
                id="reopen-reason-input"
                type="text"
                placeholder="e.g. Audit correction required for late supplier invoices"
                value={reopenReason}
                onChange={(e) => {
                  setReopenReason(e.target.value);
                  setReopenError(null);
                }}
                className={`w-full text-sm ${reopenError ? 'border-rose-500 ring-rose-500' : ''}`}
              />
              {reopenError && <p className="text-xs text-rose-600 mt-1">{reopenError}</p>}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsReopenModalOpen(false);
                  setReopenTargetPeriod(null);
                }}
                disabled={isReopeningPeriod}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleReopenMonth}
                disabled={isReopeningPeriod}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {isReopeningPeriod ? 'Reopening...' : 'Confirm Reopen'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
