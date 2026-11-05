import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  APSummaryData,
  SupplierAPRecord,
  BillAPRecord,
  PaymentReminderRecord,
  PartyStatementData,
} from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatPaisa, formatKarachiDateOnly } from '../../lib/formatters';
import { getAgingBucketMeta, computeAgingPercentages } from '../../lib/ar-ap-utils';
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
  Modal,
  Input,
} from '@pos/ui';
import {
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Printer,
  Bell,
  RefreshCw,
  Search,
  Truck,
  FileText,
  Calendar,
} from 'lucide-react';

export interface AccountsPayablePageProps {
  onRecordPayment?: (supplierId?: string, documentId?: string) => void;
}

export const AccountsPayablePage: React.FC<AccountsPayablePageProps> = ({ onRecordPayment }) => {
  const { can } = useAuth();

  // Active Tab
  const [activeTab, setActiveTab] = useState<'suppliers' | 'bills' | 'reminders'>('suppliers');

  // As Of Date
  const [asOfDate, setAsOfDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Data States
  const [summary, setSummary] = useState<APSummaryData | null>(null);
  const [suppliersList, setSuppliersList] = useState<SupplierAPRecord[]>([]);
  const [billsList, setBillsList] = useState<BillAPRecord[]>([]);
  const [remindersList, setRemindersList] = useState<PaymentReminderRecord[]>([]);

  // Loading & Error States
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [billsSearchQuery, setBillsSearchQuery] = useState<string>('');

  // Expanded Supplier Rows
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());

  // Statement Modal State
  const [statementSupplier, setStatementSupplier] = useState<SupplierAPRecord | null>(null);
  const [statementData, setStatementData] = useState<PartyStatementData | null>(null);
  const [statementLoading, setStatementLoading] = useState<boolean>(false);
  const [statementStartDate, setStatementStartDate] = useState<string>(
    () => `${new Date().getFullYear()}-01-01`
  );
  const [statementEndDate, setStatementEndDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );

  // Reminder Modal State
  const [reminderTarget, setReminderTarget] = useState<SupplierAPRecord | null>(null);
  const [reminderChannel, setReminderChannel] = useState<'sms' | 'whatsapp' | 'phone' | 'email'>(
    'phone'
  );
  const [reminderRecipient, setReminderRecipient] = useState<string>('');
  const [reminderMessage, setReminderMessage] = useState<string>('');
  const [reminderSubmitting, setReminderSubmitting] = useState<boolean>(false);
  const [reminderError, setReminderError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  const fetchSummary = useCallback(async () => {
    try {
      const res = await apiFetch<{ success: boolean; data: APSummaryData }>(
        `/api/finance/ap/summary?asOfDate=${asOfDate}`
      );
      if (res.success && res.data) {
        setSummary(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AP summary');
    }
  }, [asOfDate]);

  const fetchSuppliers = useCallback(async () => {
    try {
      const params = new URLSearchParams({ asOfDate });
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      const res = await apiFetch<{ success: boolean; data: { suppliers: SupplierAPRecord[] } }>(
        `/api/finance/ap/suppliers?${params.toString()}`
      );
      if (res.success && res.data) {
        setSuppliersList(res.data.suppliers || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load supplier payables');
    }
  }, [asOfDate, searchQuery]);

  const fetchBills = useCallback(async () => {
    try {
      const res = await apiFetch<{ success: boolean; data: { bills: BillAPRecord[] } }>(
        `/api/finance/ap/bills?asOfDate=${asOfDate}`
      );
      if (res.success && res.data) {
        setBillsList(res.data.bills || []);
      }
    } catch {
      // Non-fatal
    }
  }, [asOfDate]);

  const fetchReminders = useCallback(async () => {
    try {
      const res = await apiFetch<{
        success: boolean;
        data: { reminders: PaymentReminderRecord[] };
      }>('/api/finance/ap/reminders');
      if (res.success && res.data) {
        setRemindersList(res.data.reminders || []);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchSummary(), fetchSuppliers(), fetchBills(), fetchReminders()]);
    } finally {
      setLoading(false);
    }
  }, [fetchSummary, fetchSuppliers, fetchBills, fetchReminders]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // ---------------------------------------------------------------------------
  // Expandable Row Handlers
  // ---------------------------------------------------------------------------

  const toggleSupplierExpand = (supplierId: string) => {
    setExpandedSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(supplierId)) {
        next.delete(supplierId);
      } else {
        next.add(supplierId);
      }
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Statement Modal
  // ---------------------------------------------------------------------------

  const handleOpenStatement = async (supplier: SupplierAPRecord) => {
    setStatementSupplier(supplier);
    setStatementLoading(true);
    try {
      const res = await apiFetch<{ success: boolean; data: PartyStatementData }>(
        `/api/finance/ap/statement/${supplier.id}?startDate=${statementStartDate}&endDate=${statementEndDate}`
      );
      if (res.success && res.data) {
        setStatementData(res.data);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to fetch statement');
    } finally {
      setStatementLoading(false);
    }
  };

  const handleRefreshStatement = async () => {
    if (!statementSupplier) return;
    setStatementLoading(true);
    try {
      const res = await apiFetch<{ success: boolean; data: PartyStatementData }>(
        `/api/finance/ap/statement/${statementSupplier.id}?startDate=${statementStartDate}&endDate=${statementEndDate}`
      );
      if (res.success && res.data) {
        setStatementData(res.data);
      }
    } finally {
      setStatementLoading(false);
    }
  };

  const handlePrintStatement = () => {
    window.print();
  };

  // ---------------------------------------------------------------------------
  // Reminder Modal
  // ---------------------------------------------------------------------------

  const handleOpenReminder = (supplier: SupplierAPRecord) => {
    setReminderTarget(supplier);
    setReminderRecipient(supplier.phone || supplier.contactPerson || '');
    setReminderMessage(
      `Accounts payable follow-up for ${supplier.name}: Outstanding balance of ${formatPaisa(
        supplier.outstandingPaisa
      )}. Payment schedule status review.`
    );
    setReminderError(null);
  };

  const handleSendReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reminderTarget) return;

    setReminderSubmitting(true);
    setReminderError(null);
    try {
      const res = await apiFetch<{ success: boolean }>('/api/finance/ap/reminders', {
        method: 'POST',
        body: JSON.stringify({
          partyType: 'supplier',
          partyId: reminderTarget.id,
          channel: reminderChannel,
          recipient: reminderRecipient.trim() || null,
          message: reminderMessage.trim() || null,
          amountPaisa: reminderTarget.outstandingPaisa,
          daysOverdue: reminderTarget.aging.days1to30Paisa > 0 ? 30 : 0,
        }),
      });

      if (res.success) {
        setReminderTarget(null);
        await fetchReminders();
        alert('Supplier payment follow-up note logged successfully!');
      }
    } catch (err) {
      setReminderError(err instanceof Error ? err.message : 'Failed to log reminder note');
    } finally {
      setReminderSubmitting(false);
    }
  };

  // Aging percentages for visual bar
  const agingPct = useMemo(() => {
    if (!summary) return null;
    return computeAgingPercentages(summary.aging, summary.totalOutstandingPaisa);
  }, [summary]);

  // Filtered Bills
  const filteredBills = useMemo(() => {
    if (!billsSearchQuery.trim()) return billsList;
    const q = billsSearchQuery.trim().toLowerCase();
    return billsList.filter(
      (b) => b.billNumber.toLowerCase().includes(q) || b.supplierName.toLowerCase().includes(q)
    );
  }, [billsList, billsSearchQuery]);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Accounts Payable (AP)
            </h1>
            <Badge
              variant="outline"
              className="border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs"
            >
              Liability Class 2000
            </Badge>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Supplier credit bills, debt aging schedules, supplier statements of account, and control
            account reconciliation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500">As Of Date:</span>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="bg-transparent border-none text-slate-700 dark:text-slate-200 focus:outline-none text-xs"
            />
          </div>

          <Button variant="outline" size="sm" onClick={() => loadAllData()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {can('finance.payment.create') && (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                if (onRecordPayment) {
                  onRecordPayment();
                } else {
                  window.location.hash = '#finance-payments';
                }
              }}
            >
              <CreditCard className="w-4 h-4 mr-2" />
              Record Supplier Payment
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs rounded-md">
          {error}
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Total Outstanding AP
                </p>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                  {summary ? formatPaisa(summary.totalOutstandingPaisa) : '—'}
                </h3>
              </div>
              <div className="p-3 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg">
                <Truck className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Total supplier payables</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Overdue Payables
                </p>
                <h3 className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
                  {summary ? formatPaisa(summary.overduePaisa) : '—'}
                </h3>
              </div>
              <div className="p-3 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-lg">
                <AlertTriangle className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 text-xs text-rose-600/80 dark:text-rose-400/80 flex items-center gap-1">
              <span>Past credit term maturity</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Paid This Month
                </p>
                <h3 className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  {summary ? formatPaisa(summary.paidThisMonthPaisa) : '—'}
                </h3>
              </div>
              <div className="p-3 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg">
                <CreditCard className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 text-xs text-emerald-600/80 dark:text-emerald-400/80 flex items-center gap-1">
              <span>Supplier settlements cleared</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Ledger Reconciliation
                </p>
                <div className="flex items-center gap-2 mt-1">
                  {summary?.reconciliation.isReconciled ? (
                    <Badge
                      variant="outline"
                      className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                      Balanced (Diff: 0)
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                      Diff: {summary ? formatPaisa(summary.reconciliation.differencePaisa) : '—'}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="p-3 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-lg">
                <FileText className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                Ctrl:{' '}
                {summary ? formatPaisa(summary.reconciliation.controlAccountBalancePaisa) : '—'} |
                Sub: {summary ? formatPaisa(summary.reconciliation.sumOfPartyBalancesPaisa) : '—'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Visual Aging Schedule Breakdown Bar */}
      {summary && agingPct && (
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Accounts Payable Aging Schedule ({asOfDate})
              </span>
              <span className="text-xs text-slate-400">
                Total: {formatPaisa(summary.totalOutstandingPaisa)}
              </span>
            </div>

            {/* Segmented bar */}
            <div className="w-full h-3.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
              <div
                style={{ width: `${agingPct.current}%` }}
                className="bg-emerald-500 transition-all"
                title={`Current: ${formatPaisa(summary.aging.currentPaisa)} (${agingPct.current}%)`}
              />
              <div
                style={{ width: `${agingPct.days1to30}%` }}
                className="bg-blue-500 transition-all"
                title={`1-30 Days: ${formatPaisa(summary.aging.days1to30Paisa)} (${agingPct.days1to30}%)`}
              />
              <div
                style={{ width: `${agingPct.days31to60}%` }}
                className="bg-amber-500 transition-all"
                title={`31-60 Days: ${formatPaisa(summary.aging.days31to60Paisa)} (${agingPct.days31to60}%)`}
              />
              <div
                style={{ width: `${agingPct.days61to90}%` }}
                className="bg-orange-500 transition-all"
                title={`61-90 Days: ${formatPaisa(summary.aging.days61to90Paisa)} (${agingPct.days61to90}%)`}
              />
              <div
                style={{ width: `${agingPct.days90Plus}%` }}
                className="bg-rose-500 transition-all"
                title={`90+ Days: ${formatPaisa(summary.aging.days90PlusPaisa)} (${agingPct.days90Plus}%)`}
              />
            </div>

            {/* Aging Legend Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                <div>
                  <span className="text-slate-500 block text-[10px]">Current</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {formatPaisa(summary.aging.currentPaisa)}
                  </span>
                  <span className="text-[10px] text-slate-400 ml-1">({agingPct.current}%)</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
                <div>
                  <span className="text-slate-500 block text-[10px]">1 - 30 Days</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {formatPaisa(summary.aging.days1to30Paisa)}
                  </span>
                  <span className="text-[10px] text-slate-400 ml-1">({agingPct.days1to30}%)</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                <div>
                  <span className="text-slate-500 block text-[10px]">31 - 60 Days</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {formatPaisa(summary.aging.days31to60Paisa)}
                  </span>
                  <span className="text-[10px] text-slate-400 ml-1">({agingPct.days31to60}%)</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500 shrink-0" />
                <div>
                  <span className="text-slate-500 block text-[10px]">61 - 90 Days</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {formatPaisa(summary.aging.days61to90Paisa)}
                  </span>
                  <span className="text-[10px] text-slate-400 ml-1">({agingPct.days61to90}%)</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                <div>
                  <span className="text-slate-500 block text-[10px]">90+ Days</span>
                  <span className="font-semibold text-rose-600 dark:text-rose-400">
                    {formatPaisa(summary.aging.days90PlusPaisa)}
                  </span>
                  <span className="text-[10px] text-slate-400 ml-1">({agingPct.days90Plus}%)</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex items-center border-b border-slate-200 dark:border-slate-800 gap-6">
        <button
          onClick={() => setActiveTab('suppliers')}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'suppliers'
              ? 'border-amber-600 text-amber-600 dark:text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Truck className="w-4 h-4" />
          By Supplier ({suppliersList.length})
        </button>
        <button
          onClick={() => setActiveTab('bills')}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'bills'
              ? 'border-amber-600 text-amber-600 dark:text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <FileText className="w-4 h-4" />
          By Bill ({billsList.length})
        </button>
        <button
          onClick={() => setActiveTab('reminders')}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'reminders'
              ? 'border-amber-600 text-amber-600 dark:text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Bell className="w-4 h-4" />
          Reminders Log ({remindersList.length})
        </button>
      </div>

      {/* TAB 1: By Supplier */}
      {activeTab === 'suppliers' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <Input
                placeholder="Search supplier name, contact, phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-10 text-xs"
              />
            </div>
            <span className="text-xs text-slate-400">Showing {suppliersList.length} suppliers</span>
          </div>

          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-slate-850 text-xs font-semibold">
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Supplier Name</TableHead>
                    <TableHead>Contact / Phone</TableHead>
                    <TableHead className="text-right">Outstanding Payable</TableHead>
                    <TableHead>Aging Schedule</TableHead>
                    <TableHead className="text-right">Total Billed</TableHead>
                    <TableHead className="text-right">Total Paid</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10 text-slate-500">
                        <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
                        Loading payables...
                      </TableCell>
                    </TableRow>
                  ) : suppliersList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10 text-slate-500">
                        <Truck className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                        <p className="font-medium">No suppliers found</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    suppliersList.map((s) => {
                      const isExpanded = expandedSuppliers.has(s.id);
                      return (
                        <React.Fragment key={s.id}>
                          <TableRow className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                            <TableCell>
                              <button
                                onClick={() => toggleSupplierExpand(s.id)}
                                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-500"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                              </button>
                            </TableCell>
                            <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                              <div>
                                <p>{s.name}</p>
                                <span className="text-[11px] text-slate-400">
                                  Terms: {s.paymentTermsDays} days
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                              <div>
                                {s.contactPerson && (
                                  <p className="font-medium">{s.contactPerson}</p>
                                )}
                                <p className="text-[11px] text-slate-400">{s.phone || '—'}</p>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-bold text-slate-900 dark:text-slate-100">
                              {formatPaisa(s.outstandingPaisa)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {s.aging.currentPaisa > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    Cur: {formatPaisa(s.aging.currentPaisa)}
                                  </span>
                                )}
                                {s.aging.days1to30Paisa > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                    1-30d: {formatPaisa(s.aging.days1to30Paisa)}
                                  </span>
                                )}
                                {s.aging.days31to60Paisa > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                                    31-60d: {formatPaisa(s.aging.days31to60Paisa)}
                                  </span>
                                )}
                                {s.aging.days61to90Paisa > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200">
                                    61-90d: {formatPaisa(s.aging.days61to90Paisa)}
                                  </span>
                                )}
                                {s.aging.days90PlusPaisa > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-semibold">
                                    90+d: {formatPaisa(s.aging.days90PlusPaisa)}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-xs text-slate-500">
                              {formatPaisa(s.totalBilledPaisa)}
                            </TableCell>
                            <TableCell className="text-right text-xs text-emerald-600 font-medium">
                              {formatPaisa(s.totalPaidPaisa)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenStatement(s)}
                                  title="Statement of Account (Printable PDF)"
                                >
                                  <Printer className="w-4 h-4 text-slate-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenReminder(s)}
                                  title="Log Payment Follow-up Note"
                                >
                                  <Bell className="w-4 h-4 text-amber-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (onRecordPayment) {
                                      onRecordPayment(s.id);
                                    } else {
                                      window.location.hash = '#finance-payments';
                                    }
                                  }}
                                  title="Record Payment Shortcut"
                                >
                                  <CreditCard className="w-4 h-4 text-emerald-600" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>

                          {/* Expandable Bills Subtable */}
                          {isExpanded && (
                            <TableRow className="bg-slate-50/80 dark:bg-slate-800/30">
                              <TableCell colSpan={8} className="p-4 pl-12">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                                    <span>Open Purchase Bills / Invoices ({s.bills.length})</span>
                                  </div>

                                  {s.bills.length === 0 ? (
                                    <p className="text-xs text-slate-400">
                                      No open purchase bills pending payment.
                                    </p>
                                  ) : (
                                    <div className="border border-slate-200 dark:border-slate-700 rounded overflow-hidden">
                                      <Table>
                                        <TableHeader>
                                          <TableRow className="bg-white dark:bg-slate-800 text-[11px]">
                                            <TableHead>Bill / PO #</TableHead>
                                            <TableHead>Order Date</TableHead>
                                            <TableHead className="text-right">
                                              Total Amount
                                            </TableHead>
                                            <TableHead className="text-right">Paid</TableHead>
                                            <TableHead className="text-right">
                                              Balance Due
                                            </TableHead>
                                            <TableHead>Aging</TableHead>
                                            <TableHead className="text-right">Action</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {s.bills.map((bill) => {
                                            const bucketMeta = getAgingBucketMeta(bill.agingBucket);
                                            return (
                                              <TableRow key={bill.id} className="text-xs">
                                                <TableCell className="font-medium">
                                                  {bill.billNumber}
                                                </TableCell>
                                                <TableCell className="text-slate-500">
                                                  {formatKarachiDateOnly(bill.date)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                  {formatPaisa(bill.totalPaisa)}
                                                </TableCell>
                                                <TableCell className="text-right text-emerald-600">
                                                  {formatPaisa(bill.paidPaisa)}
                                                </TableCell>
                                                <TableCell className="text-right font-bold text-slate-900 dark:text-slate-100">
                                                  {formatPaisa(bill.balanceDuePaisa)}
                                                </TableCell>
                                                <TableCell>
                                                  <span
                                                    className={`text-[10px] px-2 py-0.5 rounded-full ${bucketMeta.badgeClass}`}
                                                  >
                                                    {bucketMeta.label}
                                                  </span>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                  <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 text-xs text-emerald-600 hover:text-emerald-700"
                                                    onClick={() => {
                                                      if (onRecordPayment) {
                                                        onRecordPayment(s.id, bill.id);
                                                      } else {
                                                        window.location.hash = '#finance-payments';
                                                      }
                                                    }}
                                                  >
                                                    <CreditCard className="w-3.5 h-3.5 mr-1" />
                                                    Pay Bill
                                                  </Button>
                                                </TableCell>
                                              </TableRow>
                                            );
                                          })}
                                        </TableBody>
                                      </Table>
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: By Bill */}
      {activeTab === 'bills' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <Input
                placeholder="Search bill number or supplier name..."
                value={billsSearchQuery}
                onChange={(e) => setBillsSearchQuery(e.target.value)}
                className="pl-9 h-10 text-xs"
              />
            </div>
            <span className="text-xs text-slate-400">
              Showing {filteredBills.length} open bills
            </span>
          </div>

          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-slate-850 text-xs font-semibold">
                    <TableHead>Bill / PO #</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Terms</TableHead>
                    <TableHead className="text-right">Total Bill</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance Due</TableHead>
                    <TableHead>Aging</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-slate-500">
                        <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
                        Loading open bills...
                      </TableCell>
                    </TableRow>
                  ) : filteredBills.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-slate-500">
                        <FileText className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                        <p className="font-medium">No open bills found</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredBills.map((b) => {
                      const bucketMeta = getAgingBucketMeta(b.agingBucket);
                      return (
                        <TableRow
                          key={b.id}
                          className="text-xs hover:bg-slate-50/50 dark:hover:bg-slate-850/40"
                        >
                          <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                            {b.billNumber}
                          </TableCell>
                          <TableCell className="font-medium">{b.supplierName}</TableCell>
                          <TableCell className="text-slate-500">
                            {formatKarachiDateOnly(b.date)}
                          </TableCell>
                          <TableCell className="text-slate-500">
                            {b.paymentTermsDays} days
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatPaisa(b.totalPaisa)}
                          </TableCell>
                          <TableCell className="text-right text-emerald-600">
                            {formatPaisa(b.paidPaisa)}
                          </TableCell>
                          <TableCell className="text-right font-bold text-slate-900 dark:text-slate-100">
                            {formatPaisa(b.balanceDuePaisa)}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full ${bucketMeta.badgeClass}`}
                            >
                              {bucketMeta.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-emerald-600 hover:text-emerald-700"
                              onClick={() => {
                                if (onRecordPayment) {
                                  onRecordPayment(b.supplierId, b.id);
                                } else {
                                  window.location.hash = '#finance-payments';
                                }
                              }}
                            >
                              <CreditCard className="w-3.5 h-3.5 mr-1" />
                              Pay
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 3: Reminders Log */}
      {activeTab === 'reminders' && (
        <div className="space-y-4">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-slate-850 text-xs font-semibold">
                    <TableHead>Date & Time</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Overdue</TableHead>
                    <TableHead>Notes / Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {remindersList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10 text-slate-500">
                        <Bell className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                        <p className="font-medium">No payment follow-up notes recorded</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    remindersList.map((r) => (
                      <TableRow key={r.id} className="text-xs">
                        <TableCell className="text-slate-500">
                          {formatKarachiDateOnly(r.sentAt)}
                        </TableCell>
                        <TableCell className="font-semibold text-slate-900 dark:text-slate-100">
                          {r.partyName || r.partyId}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-[11px]">
                            {r.channel}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {r.recipient || '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatPaisa(r.amountPaisa)}
                        </TableCell>
                        <TableCell>
                          <span className="text-[11px] text-amber-600">{r.daysOverdue} days</span>
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-slate-600 dark:text-slate-400">
                          {r.message || '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* STATEMENT MODAL */}
      {statementSupplier && (
        <Modal
          open={!!statementSupplier}
          onClose={() => {
            setStatementSupplier(null);
            setStatementData(null);
          }}
          title={`Statement of Account: ${statementSupplier.name}`}
        >
          <div className="space-y-4 text-xs max-h-[80vh] overflow-y-auto p-1">
            {/* Filter toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg print:hidden">
              <div className="flex items-center gap-2">
                <span>From:</span>
                <input
                  type="date"
                  value={statementStartDate}
                  onChange={(e) => setStatementStartDate(e.target.value)}
                  className="px-2 py-1 border rounded bg-white dark:bg-slate-900"
                />
                <span>To:</span>
                <input
                  type="date"
                  value={statementEndDate}
                  onChange={(e) => setStatementEndDate(e.target.value)}
                  className="px-2 py-1 border rounded bg-white dark:bg-slate-900"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRefreshStatement}
                  disabled={statementLoading}
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 mr-1 ${statementLoading ? 'animate-spin' : ''}`}
                  />
                  Update
                </Button>
              </div>

              <Button
                size="sm"
                className="bg-slate-800 hover:bg-slate-900 text-white"
                onClick={handlePrintStatement}
              >
                <Printer className="w-3.5 h-3.5 mr-1.5" />
                Print / Save PDF
              </Button>
            </div>

            {/* Printable Statement Document */}
            <div
              id="printable-statement"
              className="p-4 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-lg space-y-4"
            >
              <div className="flex justify-between items-start border-b pb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    STATEMENT OF ACCOUNT
                  </h2>
                  <p className="text-slate-500 font-medium">{statementSupplier.name}</p>
                  {statementSupplier.contactPerson && (
                    <p className="text-slate-400">Attn: {statementSupplier.contactPerson}</p>
                  )}
                  {statementSupplier.phone && (
                    <p className="text-slate-400">Phone: {statementSupplier.phone}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-700 dark:text-slate-300">
                    Liability Account 2000 (AP)
                  </p>
                  <p className="text-slate-500">
                    Period: {statementStartDate} to {statementEndDate}
                  </p>
                  <p className="text-slate-400">
                    Generated: {new Date().toISOString().slice(0, 10)}
                  </p>
                </div>
              </div>

              {statementLoading ? (
                <div className="text-center py-8">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto text-slate-400" />
                  <p className="mt-2 text-slate-500">Generating statement ledger entries...</p>
                </div>
              ) : statementData ? (
                <>
                  {/* Summary Bar */}
                  <div className="grid grid-cols-4 gap-2 p-3 bg-slate-50 dark:bg-slate-900 rounded text-center border">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">
                        Opening Balance
                      </span>
                      <p className="font-bold text-slate-800 dark:text-slate-200">
                        {formatPaisa(statementData.openingBalancePaisa)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">
                        Total Bills (Credit)
                      </span>
                      <p className="font-bold text-slate-800 dark:text-slate-200">
                        {formatPaisa(statementData.totalCreditsPaisa)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">
                        Total Paid (Debit)
                      </span>
                      <p className="font-bold text-emerald-600">
                        {formatPaisa(statementData.totalDebitsPaisa)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">
                        Closing Balance Due
                      </span>
                      <p className="font-bold text-amber-600 dark:text-amber-400">
                        {formatPaisa(statementData.closingBalancePaisa)}
                      </p>
                    </div>
                  </div>

                  {/* Lines Table */}
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-100 dark:bg-slate-800 text-[11px]">
                        <TableHead>Date</TableHead>
                        <TableHead>Entry #</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Debit (Paid)</TableHead>
                        <TableHead className="text-right">Credit (Billed)</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statementData.lines.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-6 text-slate-400">
                            No ledger transactions recorded in this period.
                          </TableCell>
                        </TableRow>
                      ) : (
                        statementData.lines.map((line) => (
                          <TableRow key={line.id} className="text-[11px]">
                            <TableCell>{formatKarachiDateOnly(line.date)}</TableCell>
                            <TableCell>#{line.entryNo}</TableCell>
                            <TableCell className="max-w-xs">{line.description}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] uppercase">
                                {line.type || 'journal'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-emerald-600 font-medium">
                              {line.debitPaisa > 0 ? formatPaisa(line.debitPaisa) : '—'}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {line.creditPaisa > 0 ? formatPaisa(line.creditPaisa) : '—'}
                            </TableCell>
                            <TableCell className="text-right font-bold">
                              {formatPaisa(line.runningBalancePaisa)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </>
              ) : null}
            </div>
          </div>
        </Modal>
      )}

      {/* REMINDER MODAL */}
      {reminderTarget && (
        <Modal
          open={!!reminderTarget}
          onClose={() => setReminderTarget(null)}
          title={`Log Supplier Follow-up Note: ${reminderTarget.name}`}
        >
          <form onSubmit={handleSendReminder} className="space-y-4 text-xs">
            {reminderError && (
              <div className="p-2.5 bg-rose-50 text-rose-700 border border-rose-200 rounded">
                {reminderError}
              </div>
            )}

            <div className="space-y-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Channel</label>
              <select
                value={reminderChannel}
                onChange={(e) =>
                  setReminderChannel(e.target.value as 'sms' | 'whatsapp' | 'phone' | 'email')
                }
                className="w-full px-3 py-2 border rounded bg-white dark:bg-slate-900 text-xs"
              >
                <option value="phone">Phone Call</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Recipient Contact Info
              </label>
              <Input
                value={reminderRecipient}
                onChange={(e) => setReminderRecipient(e.target.value)}
                placeholder="Phone number, email, or contact name"
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Follow-up / Reminder Notes
              </label>
              <textarea
                rows={3}
                value={reminderMessage}
                onChange={(e) => setReminderMessage(e.target.value)}
                className="w-full px-3 py-2 border rounded bg-white dark:bg-slate-900 text-xs"
                placeholder="Enter discussion notes or payment follow-up details..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReminderTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                disabled={reminderSubmitting}
              >
                {reminderSubmitting ? 'Saving...' : 'Save Follow-up Note'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
