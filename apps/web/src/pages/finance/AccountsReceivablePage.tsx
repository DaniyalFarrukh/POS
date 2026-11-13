import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  ARSummaryData,
  CustomerARRecord,
  ProductARRecord,
  PaymentReminderRecord,
  PartyStatementData,
} from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatPaisa, formatKarachiDateOnly } from '../../lib/formatters';
import { getAgingBucketMeta, computeAgingPercentages } from '../../lib/ar-ap-utils';
import { getKarachiBusinessDate } from '@pos/shared';
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
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Printer,
  Bell,
  RefreshCw,
  Search,
  Users,
  Package,
  Calendar,
  CreditCard,
  ArrowDownLeft,
} from 'lucide-react';

export interface AccountsReceivablePageProps {
  onRecordPayment?: (customerId?: string, invoiceId?: string) => void;
}

export const AccountsReceivablePage: React.FC<AccountsReceivablePageProps> = ({
  onRecordPayment,
}) => {
  const { can } = useAuth();

  // Active Tab
  const [activeTab, setActiveTab] = useState<'customers' | 'products' | 'reminders'>('customers');

  // As Of Date
  const [asOfDate, setAsOfDate] = useState<string>(() => getKarachiBusinessDate());

  // Data States
  const [summary, setSummary] = useState<ARSummaryData | null>(null);
  const [customersList, setCustomersList] = useState<CustomerARRecord[]>([]);
  const [productsList, setProductsList] = useState<ProductARRecord[]>([]);
  const [remindersList, setRemindersList] = useState<PaymentReminderRecord[]>([]);

  // Loading & Error States
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Expanded Customer Rows
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());

  // Statement Modal State
  const [statementCustomer, setStatementCustomer] = useState<CustomerARRecord | null>(null);
  const [statementData, setStatementData] = useState<PartyStatementData | null>(null);
  const [statementLoading, setStatementLoading] = useState<boolean>(false);
  const [statementStartDate, setStatementStartDate] = useState<string>(
    () => `${getKarachiBusinessDate().slice(0, 4)}-01-01`
  );
  const [statementEndDate, setStatementEndDate] = useState<string>(() => getKarachiBusinessDate());

  // Reminder Modal State
  const [reminderTarget, setReminderTarget] = useState<CustomerARRecord | null>(null);
  const [reminderChannel, setReminderChannel] = useState<'sms' | 'whatsapp' | 'phone' | 'email'>(
    'whatsapp'
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
      const res = await apiFetch<{ success: boolean; data: ARSummaryData }>(
        `/api/finance/ar/summary?asOfDate=${asOfDate}`
      );
      if (res.success && res.data) {
        setSummary(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AR summary');
    }
  }, [asOfDate]);

  const fetchCustomers = useCallback(async () => {
    try {
      const params = new URLSearchParams({ asOfDate });
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      const res = await apiFetch<{ success: boolean; data: { customers: CustomerARRecord[] } }>(
        `/api/finance/ar/customers?${params.toString()}`
      );
      if (res.success && res.data) {
        setCustomersList(res.data.customers || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customer receivables');
    }
  }, [asOfDate, searchQuery]);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await apiFetch<{ success: boolean; data: { products: ProductARRecord[] } }>(
        '/api/finance/ar/products'
      );
      if (res.success && res.data) {
        setProductsList(res.data.products || []);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const fetchReminders = useCallback(async () => {
    try {
      const res = await apiFetch<{
        success: boolean;
        data: { reminders: PaymentReminderRecord[] };
      }>('/api/finance/ar/reminders');
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
      await Promise.all([fetchSummary(), fetchCustomers(), fetchProducts(), fetchReminders()]);
    } finally {
      setLoading(false);
    }
  }, [fetchSummary, fetchCustomers, fetchProducts, fetchReminders]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // ---------------------------------------------------------------------------
  // Expandable Row Handlers
  // ---------------------------------------------------------------------------

  const toggleCustomerExpand = (customerId: string) => {
    setExpandedCustomers((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) {
        next.delete(customerId);
      } else {
        next.add(customerId);
      }
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Statement Modal
  // ---------------------------------------------------------------------------

  const handleOpenStatement = async (customer: CustomerARRecord) => {
    setStatementCustomer(customer);
    setStatementLoading(true);
    try {
      const res = await apiFetch<{ success: boolean; data: PartyStatementData }>(
        `/api/finance/ar/statement/${customer.id}?startDate=${statementStartDate}&endDate=${statementEndDate}`
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
    if (!statementCustomer) return;
    setStatementLoading(true);
    try {
      const res = await apiFetch<{ success: boolean; data: PartyStatementData }>(
        `/api/finance/ar/statement/${statementCustomer.id}?startDate=${statementStartDate}&endDate=${statementEndDate}`
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

  const handleOpenReminder = (customer: CustomerARRecord) => {
    setReminderTarget(customer);
    setReminderRecipient(customer.phone || '');
    setReminderMessage(
      `Dear ${customer.name}, you have an outstanding balance of ${formatPaisa(
        customer.outstandingPaisa
      )} with our pharmacy. Kindly arrange for payment at your earliest convenience. Thank you!`
    );
    setReminderError(null);
  };

  const handleSendReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reminderTarget) return;

    setReminderSubmitting(true);
    setReminderError(null);
    try {
      const res = await apiFetch<{ success: boolean }>('/api/finance/ar/reminders', {
        method: 'POST',
        body: JSON.stringify({
          partyType: 'customer',
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
        alert('Payment reminder logged successfully!');
      }
    } catch (err) {
      setReminderError(err instanceof Error ? err.message : 'Failed to log reminder');
    } finally {
      setReminderSubmitting(false);
    }
  };

  // Aging percentages for visual bar
  const agingPct = useMemo(() => {
    if (!summary) return null;
    return computeAgingPercentages(summary.aging, summary.totalOutstandingPaisa);
  }, [summary]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Accounts Receivable (AR)
            </h1>
            <Badge variant="outline" className="border-blue-500/30 text-blue-600 text-xs">
              Asset Class 1100
            </Badge>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Customer credit sales, debt aging buckets, account statements, and control account
            reconciliation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500">As Of Date:</span>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="bg-transparent border-none text-slate-700 focus:outline-none text-xs"
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
              Record Customer Receipt
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-md">
          {error}
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Total Outstanding AR</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">
                  {summary ? formatPaisa(summary.totalOutstandingPaisa) : '—'}
                </h3>
              </div>
              <div className="p-3 bg-blue-500/10 text-blue-600 rounded-lg">
                <DollarSign className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500 flex items-center gap-1">
              <span>Customer credit balance</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Overdue Receivables</p>
                <h3 className="text-2xl font-bold text-amber-600 mt-1">
                  {summary ? formatPaisa(summary.overduePaisa) : '—'}
                </h3>
              </div>
              <div className="p-3 bg-amber-500/10 text-amber-600 rounded-lg">
                <AlertTriangle className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">
              <span>Past credit term date</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Collected This Month</p>
                <h3 className="text-2xl font-bold text-emerald-600 mt-1">
                  {summary ? formatPaisa(summary.collectedThisMonthPaisa) : '—'}
                </h3>
              </div>
              <div className="p-3 bg-emerald-500/10 text-emerald-600 rounded-lg">
                <ArrowDownLeft className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">
              <span>Credits posted to Account 1100</span>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`bg-white border-slate-200 shadow-sm ${
            summary?.reconciliation.isReconciled ? '' : 'ring-2 ring-rose-500/40'
          }`}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Ledger Reconciliation</p>
                <div className="flex items-center gap-2 mt-1">
                  <h3 className="text-lg font-bold text-slate-900">
                    {summary?.reconciliation.isReconciled ? 'Balanced' : 'Mismatch'}
                  </h3>
                  <Badge
                    className={
                      summary?.reconciliation.isReconciled
                        ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 text-[10px]'
                        : 'bg-rose-500/10 text-rose-600 border border-rose-500/20 text-[10px]'
                    }
                  >
                    Diff:{' '}
                    {summary ? formatPaisa(summary.reconciliation.differencePaisa) : 'Rs. 0.00'}
                  </Badge>
                </div>
              </div>
              <div
                className={`p-3 rounded-lg ${
                  summary?.reconciliation.isReconciled
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : 'bg-rose-500/10 text-rose-600'
                }`}
              >
                <CheckCircle2 className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 text-[11px] text-slate-400 truncate">
              Ctrl 1100:{' '}
              {summary ? formatPaisa(summary.reconciliation.controlAccountBalancePaisa) : '—'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Aging Distribution Visual Bar */}
      {summary && (
        <Card className="bg-white border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-2">
            <span>Aging Schedule Breakdown (As of {asOfDate})</span>
            <span className="text-slate-400 font-normal">
              Calculated from individual debt lines
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
            <div className="p-2.5 rounded bg-emerald-50/50 border border-emerald-100">
              <span className="text-[11px] text-emerald-600 font-medium">Current (0d)</span>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {formatPaisa(summary.aging.currentPaisa)}
              </p>
              <span className="text-[10px] text-slate-400">{agingPct?.current ?? 0}%</span>
            </div>

            <div className="p-2.5 rounded bg-blue-50/50 border border-blue-100">
              <span className="text-[11px] text-blue-600 font-medium">1 - 30 Days</span>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {formatPaisa(summary.aging.days1to30Paisa)}
              </p>
              <span className="text-[10px] text-slate-400">{agingPct?.days1to30 ?? 0}%</span>
            </div>

            <div className="p-2.5 rounded bg-amber-50/50 border border-amber-100">
              <span className="text-[11px] text-amber-600 font-medium">31 - 60 Days</span>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {formatPaisa(summary.aging.days31to60Paisa)}
              </p>
              <span className="text-[10px] text-slate-400">{agingPct?.days31to60 ?? 0}%</span>
            </div>

            <div className="p-2.5 rounded bg-orange-50/50 border border-orange-100">
              <span className="text-[11px] text-orange-600 font-medium">61 - 90 Days</span>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {formatPaisa(summary.aging.days61to90Paisa)}
              </p>
              <span className="text-[10px] text-slate-400">{agingPct?.days61to90 ?? 0}%</span>
            </div>

            <div className="p-2.5 rounded bg-rose-50/50 border border-rose-100">
              <span className="text-[11px] text-rose-600 font-medium">90+ Days</span>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {formatPaisa(summary.aging.days90PlusPaisa)}
              </p>
              <span className="text-[10px] text-slate-400">{agingPct?.days90Plus ?? 0}%</span>
            </div>
          </div>
        </Card>
      )}

      {/* Main Tabs Navigation */}
      <div className="border-b border-slate-200 flex items-center gap-6">
        <button
          onClick={() => setActiveTab('customers')}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'customers'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>By Customer</span>
          <Badge variant="outline" className="text-xs">
            {customersList.length}
          </Badge>
        </button>

        <button
          onClick={() => setActiveTab('products')}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'products'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>By Product</span>
          <Badge variant="outline" className="text-xs">
            {productsList.length}
          </Badge>
        </button>

        <button
          onClick={() => setActiveTab('reminders')}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'reminders'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>Reminders Log</span>
          <Badge variant="outline" className="text-xs">
            {remindersList.length}
          </Badge>
        </button>
      </div>

      {/* TAB 1: By Customer */}
      {activeTab === 'customers' && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <Input
              placeholder="Search customer by name or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-10 bg-white"
            />
          </div>

          <Card className="bg-white border-slate-200">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-slate-200">
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Outstanding Balance</TableHead>
                    <TableHead>Aging Summary</TableHead>
                    <TableHead className="text-right">Credit Limit</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10 text-slate-500">
                        <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
                        Loading receivables...
                      </TableCell>
                    </TableRow>
                  ) : customersList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10 text-slate-500">
                        <Users className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                        <p className="font-medium">No customers found</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    customersList.map((c) => {
                      const isExpanded = expandedCustomers.has(c.id);
                      return (
                        <React.Fragment key={c.id}>
                          <TableRow className="border-b border-slate-100 hover:bg-slate-50/50">
                            <TableCell>
                              <button
                                onClick={() => toggleCustomerExpand(c.id)}
                                className="p-1 hover:bg-slate-200 rounded text-slate-500"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                              </button>
                            </TableCell>
                            <TableCell className="font-medium text-slate-900">
                              <div>
                                <p>{c.name}</p>
                                <span className="text-[11px] text-slate-400">
                                  Terms: {c.paymentTermsDays} days
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-slate-600">
                              {c.phone || '—'}
                            </TableCell>
                            <TableCell className="text-right font-bold text-slate-900">
                              {formatPaisa(c.outstandingPaisa)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {c.aging.currentPaisa > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    Cur: {formatPaisa(c.aging.currentPaisa)}
                                  </span>
                                )}
                                {c.aging.days1to30Paisa > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                    1-30d: {formatPaisa(c.aging.days1to30Paisa)}
                                  </span>
                                )}
                                {c.aging.days31to60Paisa > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                                    31-60d: {formatPaisa(c.aging.days31to60Paisa)}
                                  </span>
                                )}
                                {c.aging.days61to90Paisa > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200">
                                    61-90d: {formatPaisa(c.aging.days61to90Paisa)}
                                  </span>
                                )}
                                {c.aging.days90PlusPaisa > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-semibold">
                                    90+d: {formatPaisa(c.aging.days90PlusPaisa)}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-xs text-slate-500">
                              {formatPaisa(c.creditLimitPaisa)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenStatement(c)}
                                  title="Statement of Account (Printable PDF)"
                                >
                                  <Printer className="w-4 h-4 text-slate-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenReminder(c)}
                                  title="Send Payment Reminder"
                                >
                                  <Bell className="w-4 h-4 text-amber-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (onRecordPayment) {
                                      onRecordPayment(c.id);
                                    } else {
                                      window.location.hash = '#finance-payments';
                                    }
                                  }}
                                  title="Record Receipt Shortcut"
                                >
                                  <CreditCard className="w-4 h-4 text-emerald-600" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>

                          {/* Expandable Documents Subtable */}
                          {isExpanded && (
                            <TableRow className="bg-slate-50/80">
                              <TableCell colSpan={7} className="p-4 pl-12">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                                    <span>Open Credit Invoices ({c.documents.length})</span>
                                  </div>

                                  {c.documents.length === 0 ? (
                                    <p className="text-xs text-slate-400">
                                      No open invoice documents pending settlement.
                                    </p>
                                  ) : (
                                    <div className="border border-slate-200 rounded overflow-hidden">
                                      <Table>
                                        <TableHeader>
                                          <TableRow className="bg-white text-[11px]">
                                            <TableHead>Invoice #</TableHead>
                                            <TableHead>Date</TableHead>
                                            <TableHead className="text-right">Total</TableHead>
                                            <TableHead className="text-right">Paid</TableHead>
                                            <TableHead className="text-right">
                                              Balance Due
                                            </TableHead>
                                            <TableHead>Aging</TableHead>
                                            <TableHead className="text-right">Action</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {c.documents.map((doc) => {
                                            const bucketMeta = getAgingBucketMeta(doc.agingBucket);
                                            return (
                                              <TableRow key={doc.id} className="text-xs">
                                                <TableCell className="font-medium">
                                                  {doc.invoiceNumber}
                                                </TableCell>
                                                <TableCell className="text-slate-500">
                                                  {formatKarachiDateOnly(doc.date)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                  {formatPaisa(doc.totalPaisa)}
                                                </TableCell>
                                                <TableCell className="text-right text-emerald-600">
                                                  {formatPaisa(doc.paidPaisa)}
                                                </TableCell>
                                                <TableCell className="text-right font-bold text-slate-900">
                                                  {formatPaisa(doc.balanceDuePaisa)}
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
                                                        onRecordPayment(c.id, doc.id);
                                                      } else {
                                                        window.location.hash = '#finance-payments';
                                                      }
                                                    }}
                                                  >
                                                    <CreditCard className="w-3.5 h-3.5 mr-1" />
                                                    Receive
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

      {/* TAB 2: By Product */}
      {activeTab === 'products' && (
        <Card className="bg-white border-slate-200">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-slate-200">
                  <TableHead>Product Name</TableHead>
                  <TableHead>Generic Name</TableHead>
                  <TableHead className="text-right">Units on Credit</TableHead>
                  <TableHead className="text-right">Total Credit Sales</TableHead>
                  <TableHead className="text-right">Receivable Amount</TableHead>
                  <TableHead className="text-right"># Invoices</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productsList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-slate-500">
                      <Package className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                      <p className="font-medium">No open credit products</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  productsList.map((p) => (
                    <TableRow key={p.productId} className="border-b border-slate-100">
                      <TableCell className="font-semibold text-slate-900">
                        {p.productName}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {p.genericName || '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium">{p.unitsOnCredit}</TableCell>
                      <TableCell className="text-right">
                        {formatPaisa(p.creditSalesPaisa)}
                      </TableCell>
                      <TableCell className="text-right font-bold text-blue-600">
                        {formatPaisa(p.receivablePaisa)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-slate-500">
                        {p.invoiceCount}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* TAB 3: Reminders Log */}
      {activeTab === 'reminders' && (
        <Card className="bg-white border-slate-200">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-slate-200">
                  <TableHead>Customer</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead className="text-right">Overdue Amount</TableHead>
                  <TableHead>Sent At</TableHead>
                  <TableHead>Message Log</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remindersList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-slate-500">
                      <Bell className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                      <p className="font-medium">No reminders recorded</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Use the "Send Reminder" button on any customer row to log WhatsApp, SMS or
                        call follow-ups.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  remindersList.map((r) => (
                    <TableRow key={r.id} className="border-b border-slate-100 text-xs">
                      <TableCell className="font-medium text-slate-900">{r.partyName}</TableCell>
                      <TableCell className="capitalize">
                        <Badge variant="outline" className="text-[10px]">
                          {r.channel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-500 font-mono">
                        {r.recipient || '—'}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatPaisa(r.amountPaisa)}
                      </TableCell>
                      <TableCell className="text-slate-500">
                        {formatKarachiDateOnly(r.sentAt)}
                      </TableCell>
                      <TableCell className="text-slate-600 max-w-xs truncate">
                        {r.message || '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* --------------------------------------------------------------------------- */}
      {/* MODAL: Printable Statement of Account */}
      {/* --------------------------------------------------------------------------- */}
      <Modal
        open={Boolean(statementCustomer)}
        onClose={() => {
          setStatementCustomer(null);
          setStatementData(null);
        }}
        title="Statement of Account"
        maxWidth="2xl"
      >
        {statementCustomer && (
          <div className="space-y-4">
            {/* Filter Date Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">From:</span>
                <input
                  type="date"
                  value={statementStartDate}
                  onChange={(e) => setStatementStartDate(e.target.value)}
                  className="h-8 px-2 rounded border border-slate-300 bg-white text-xs"
                />
                <span className="text-slate-500">To:</span>
                <input
                  type="date"
                  value={statementEndDate}
                  onChange={(e) => setStatementEndDate(e.target.value)}
                  className="h-8 px-2 rounded border border-slate-300 bg-white text-xs"
                />
                <Button size="sm" variant="outline" onClick={handleRefreshStatement}>
                  Update
                </Button>
              </div>

              <Button
                size="sm"
                onClick={handlePrintStatement}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Printer className="w-3.5 h-3.5 mr-1.5" />
                Print / Save PDF
              </Button>
            </div>

            {/* Printable Statement Container */}
            <div
              id="statement-print-area"
              className="p-6 bg-white border border-slate-200 rounded-lg space-y-4"
            >
              {/* Header */}
              <div className="flex justify-between items-start border-b pb-4 border-slate-200">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">STATEMENT OF ACCOUNT</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Period: {statementStartDate} to {statementEndDate}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className="font-bold text-slate-900">{statementCustomer.name}</p>
                  <p className="text-slate-500">{statementCustomer.phone || 'No phone'}</p>
                  <p className="text-slate-500">
                    {statementCustomer.address || 'Karachi, Pakistan'}
                  </p>
                </div>
              </div>

              {statementLoading ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  <RefreshCw className="w-5 h-5 mx-auto animate-spin mb-2" />
                  Generating statement...
                </div>
              ) : statementData ? (
                <>
                  {/* Summary row */}
                  <div className="grid grid-cols-4 gap-3 p-3 bg-slate-50 rounded text-xs text-center">
                    <div>
                      <p className="text-slate-400">Opening Balance</p>
                      <p className="font-bold text-slate-900 mt-0.5">
                        {formatPaisa(statementData.openingBalancePaisa)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Total Invoiced (Dr)</p>
                      <p className="font-bold text-slate-900 mt-0.5">
                        {formatPaisa(statementData.totalDebitsPaisa)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Total Received (Cr)</p>
                      <p className="font-bold text-emerald-600 mt-0.5">
                        {formatPaisa(statementData.totalCreditsPaisa)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Closing Balance</p>
                      <p className="font-bold text-blue-600 mt-0.5">
                        {formatPaisa(statementData.closingBalancePaisa)}
                      </p>
                    </div>
                  </div>

                  {/* Lines Table */}
                  <div className="border border-slate-200 rounded overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50 text-[11px]">
                          <TableHead>Date</TableHead>
                          <TableHead>Entry #</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Debit</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                          <TableHead className="text-right">Running Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {statementData.lines.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={6}
                              className="text-center py-6 text-xs text-slate-400"
                            >
                              No transactions in this period.
                            </TableCell>
                          </TableRow>
                        ) : (
                          statementData.lines.map((l) => (
                            <TableRow key={l.id} className="text-xs">
                              <TableCell className="font-mono text-slate-600">
                                {formatKarachiDateOnly(l.date)}
                              </TableCell>
                              <TableCell className="font-mono">{l.entryNo}</TableCell>
                              <TableCell>{l.description}</TableCell>
                              <TableCell className="text-right font-mono">
                                {l.debitPaisa > 0 ? formatPaisa(l.debitPaisa) : '—'}
                              </TableCell>
                              <TableCell className="text-right font-mono text-emerald-600">
                                {l.creditPaisa > 0 ? formatPaisa(l.creditPaisa) : '—'}
                              </TableCell>
                              <TableCell className="text-right font-mono font-bold">
                                {formatPaisa(l.runningBalancePaisa)}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : null}
            </div>

            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStatementCustomer(null);
                  setStatementData(null);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* --------------------------------------------------------------------------- */}
      {/* MODAL: Send Payment Reminder */}
      {/* --------------------------------------------------------------------------- */}
      <Modal
        open={Boolean(reminderTarget)}
        onClose={() => setReminderTarget(null)}
        title="Send Payment Reminder"
        maxWidth="md"
      >
        {reminderTarget && (
          <form onSubmit={handleSendReminder} className="space-y-4">
            {reminderError && (
              <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded border border-rose-200">
                {reminderError}
              </div>
            )}

            <div className="p-3 bg-slate-50 rounded text-xs flex justify-between items-center">
              <div>
                <p className="font-semibold text-slate-900">{reminderTarget.name}</p>
                <p className="text-slate-500 mt-0.5">
                  Outstanding Balance: {formatPaisa(reminderTarget.outstandingPaisa)}
                </p>
              </div>
              <Badge className="bg-amber-500/10 text-amber-600 border border-amber-500/20 text-xs">
                Overdue
              </Badge>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Communication Channel
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(['whatsapp', 'sms', 'phone', 'email'] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setReminderChannel(ch)}
                    className={`py-2 text-xs capitalize rounded border text-center font-medium transition-colors ${
                      reminderChannel === ch
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Recipient Contact (Phone / Email)
              </label>
              <Input
                type="text"
                value={reminderRecipient}
                onChange={(e) => setReminderRecipient(e.target.value)}
                placeholder="e.g. 03001234567"
                className="h-10 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Reminder Message
              </label>
              <textarea
                rows={4}
                value={reminderMessage}
                onChange={(e) => setReminderMessage(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setReminderTarget(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={reminderSubmitting}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {reminderSubmitting ? 'Logging...' : 'Log & Send Reminder'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
