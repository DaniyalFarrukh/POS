import React, { useState, useEffect, useCallback } from 'react';
import type {
  PaymentRecord,
  PaymentKPIs,
  PaymentDirection,
  PaymentMethod,
  ChequeStatus,
  CustomerRecord,
  SupplierRecord,
  BranchRecord,
  UnpaidDocumentRecord,
} from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatPaisa, formatKarachiDateOnly } from '../../lib/formatters';
import {
  calculateAutoAllocations,
  getChequeStatusMeta,
  getPaymentStatusMeta,
  getPaymentMethodMeta,
} from '../../lib/payment-utils';
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
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Eye,
  Plus,
  RefreshCw,
  Search,
  FileText,
  UserCheck,
} from 'lucide-react';

interface AllocationInputState {
  documentId: string;
  documentType: 'invoice' | 'purchase';
  documentNumber: string;
  allocatedRupees: string;
}

export const PaymentsPage: React.FC = () => {
  const { can } = useAuth();
  const canCreate = can('finance.payment.create');

  // List State
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [kpis, setKpis] = useState<PaymentKPIs>({
    totalReceiptsPaisa: 0,
    totalPaymentsPaisa: 0,
    netCashFlowPaisa: 0,
    pendingChequesCount: 0,
    pendingChequesValuePaisa: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination & Filtering
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<'all' | 'receipt' | 'payment' | 'cheque'>('all');
  const [chequeStatusFilter, setChequeStatusFilter] = useState<'all' | ChequeStatus>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Dropdown reference data
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);

  // Detail Modal State
  const [selectedPayment, setSelectedPayment] = useState<PaymentRecord | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false);

  // Reversal Modal State
  const [paymentToReverse, setPaymentToReverse] = useState<PaymentRecord | null>(null);
  const [reversalReason, setReversalReason] = useState<string>('');
  const [isReverseOpen, setIsReverseOpen] = useState<boolean>(false);
  const [reversalSubmitting, setReversalSubmitting] = useState<boolean>(false);

  // Bounce Modal State
  const [paymentToBounce, setPaymentToBounce] = useState<PaymentRecord | null>(null);
  const [bounceReason, setBounceReason] = useState<string>('');
  const [isBounceOpen, setIsBounceOpen] = useState<boolean>(false);
  const [bounceSubmitting, setBounceSubmitting] = useState<boolean>(false);

  // Record Payment Drawer State
  const [isRecordOpen, setIsRecordOpen] = useState<boolean>(false);
  const [recordSubmitting, setRecordSubmitting] = useState<boolean>(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  // Record Form Fields
  const [direction, setDirection] = useState<PaymentDirection>('receipt');
  const [branchId, setBranchId] = useState<string>('');
  const [partyId, setPartyId] = useState<string>('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amountRupees, setAmountRupees] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(() => getKarachiBusinessDate());
  const [chequeNumber, setChequeNumber] = useState<string>('');
  const [chequeDate, setChequeDate] = useState<string>('');
  const [bankName, setBankName] = useState<string>('');
  const [referenceNo, setReferenceNo] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Unpaid Documents & Allocations
  const [unpaidDocs, setUnpaidDocs] = useState<UnpaidDocumentRecord[]>([]);
  const [allocations, setAllocations] = useState<AllocationInputState[]>([]);
  const [docsLoading, setDocsLoading] = useState<boolean>(false);

  // New Customer Modal
  const [isNewCustomerOpen, setIsNewCustomerOpen] = useState<boolean>(false);
  const [newCustName, setNewCustName] = useState<string>('');
  const [newCustPhone, setNewCustPhone] = useState<string>('');
  const [newCustLimit, setNewCustLimit] = useState<string>('0');
  const [newCustSubmitting, setNewCustSubmitting] = useState<boolean>(false);

  // Fetch Payments List
  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('pageSize', pageSize.toString());

      if (activeTab === 'receipt') params.set('direction', 'receipt');
      if (activeTab === 'payment') params.set('direction', 'payment');
      if (activeTab === 'cheque') {
        params.set('method', 'cheque');
        if (chequeStatusFilter !== 'all') {
          params.set('chequeStatus', chequeStatusFilter);
        }
      }

      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await apiFetch<{
        success: boolean;
        data: {
          items: PaymentRecord[];
          total: number;
          page: number;
          pageSize: number;
          totalPages: number;
          kpis: PaymentKPIs;
        };
      }>(`/api/finance/payments?${params.toString()}`);

      setPayments(res.data.items || []);
      setTotalPages(res.data.totalPages || 1);
      if (res.data.kpis) {
        setKpis(res.data.kpis);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, activeTab, chequeStatusFilter, searchQuery, startDate, endDate]);

  // Load Dropdowns
  useEffect(() => {
    async function loadDropdowns() {
      try {
        const [bRes, cRes, sRes] = await Promise.all([
          apiFetch<{ items?: BranchRecord[]; data?: BranchRecord[] }>('/api/admin/branches').catch(
            () => ({
              items: [] as BranchRecord[],
              data: [] as BranchRecord[],
            })
          ),
          apiFetch<{ data: CustomerRecord[] }>('/api/finance/customers').catch(() => ({
            data: [] as CustomerRecord[],
          })),
          apiFetch<{ items?: SupplierRecord[]; data?: SupplierRecord[] }>(
            '/api/suppliers?limit=100'
          ).catch(() => ({
            items: [] as SupplierRecord[],
            data: [] as SupplierRecord[],
          })),
        ]);

        const branchList = bRes.items || bRes.data || [];
        setBranches(branchList);
        if (branchList.length > 0 && !branchId) {
          setBranchId(branchList[0]!.id);
        }

        setCustomers(cRes.data || []);
        const supplierList = sRes.items || sRes.data || [];
        setSuppliers(supplierList);
      } catch {
        // Dropdown loading errors non-blocking
      }
    }
    loadDropdowns();
  }, [branchId]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  // Fetch Unpaid Documents when Party changes
  useEffect(() => {
    if (!partyId) {
      setUnpaidDocs([]);
      setAllocations([]);
      return;
    }

    async function fetchUnpaid() {
      setDocsLoading(true);
      try {
        const partyType = direction === 'receipt' ? 'customer' : 'supplier';
        const res = await apiFetch<{
          success: boolean;
          data: { documents: UnpaidDocumentRecord[] };
        }>(`/api/finance/payments/unpaid-documents?partyType=${partyType}&partyId=${partyId}`);

        const docs = res.data.documents || [];
        setUnpaidDocs(docs);

        // Initialize empty allocations
        setAllocations(
          docs.map((d) => ({
            documentId: d.id,
            documentType: d.documentType,
            documentNumber: d.documentNumber,
            allocatedRupees: '0',
          }))
        );
      } catch {
        setUnpaidDocs([]);
        setAllocations([]);
      } finally {
        setDocsLoading(false);
      }
    }

    fetchUnpaid();
  }, [partyId, direction]);

  // Handle Auto-Allocate
  const handleAutoAllocate = () => {
    const totalPaisa = Math.round(parseFloat(amountRupees || '0') * 100);
    if (totalPaisa <= 0) return;

    const result = calculateAutoAllocations(totalPaisa, unpaidDocs);
    const allocMap = new Map(result.allocations.map((a) => [a.documentId, a.allocatedPaisa]));

    setAllocations(
      unpaidDocs.map((d) => {
        const paisa = allocMap.get(d.id) || 0;
        return {
          documentId: d.id,
          documentType: d.documentType,
          documentNumber: d.documentNumber,
          allocatedRupees: (paisa / 100).toFixed(2),
        };
      })
    );
  };

  // Allocation Calculations
  const totalAmountPaisa = Math.round(parseFloat(amountRupees || '0') * 100);
  const totalAllocatedPaisa = allocations.reduce((sum, a) => {
    const p = Math.round(parseFloat(a.allocatedRupees || '0') * 100);
    return sum + (p > 0 ? p : 0);
  }, 0);
  const advancePaisa = Math.max(0, totalAmountPaisa - totalAllocatedPaisa);
  const isOverAllocated = totalAllocatedPaisa > totalAmountPaisa;

  // Submit Payment Record
  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecordError(null);

    if (!partyId) {
      setRecordError(`Please select a ${direction === 'receipt' ? 'customer' : 'supplier'}`);
      return;
    }

    if (totalAmountPaisa <= 0) {
      setRecordError('Payment amount must be greater than zero');
      return;
    }

    if (isOverAllocated) {
      setRecordError('Allocated amount cannot exceed the total payment amount');
      return;
    }

    if (method === 'cheque' && !chequeNumber.trim()) {
      setRecordError('Cheque number is required for cheque payments');
      return;
    }

    setRecordSubmitting(true);
    try {
      const activeAllocations = allocations
        .filter((a) => Math.round(parseFloat(a.allocatedRupees || '0') * 100) > 0)
        .map((a) => ({
          documentType: a.documentType,
          documentId: a.documentId,
          documentNumber: a.documentNumber,
          allocatedPaisa: Math.round(parseFloat(a.allocatedRupees) * 100),
        }));

      await apiFetch('/api/finance/payments', {
        method: 'POST',
        body: JSON.stringify({
          branchId: branchId || undefined,
          direction,
          partyType: direction === 'receipt' ? 'customer' : 'supplier',
          partyId,
          method,
          amountPaisa: totalAmountPaisa,
          paymentDate,
          chequeNumber: method === 'cheque' ? chequeNumber.trim() : undefined,
          chequeDate: method === 'cheque' && chequeDate ? chequeDate : undefined,
          bankName: method === 'cheque' ? bankName.trim() : undefined,
          chequeStatus: method === 'cheque' ? 'pending' : undefined,
          referenceNo: referenceNo.trim() || undefined,
          notes: notes.trim() || undefined,
          allocations: activeAllocations,
        }),
      });

      // Reset and refresh
      setIsRecordOpen(false);
      setAmountRupees('');
      setChequeNumber('');
      setBankName('');
      setReferenceNo('');
      setNotes('');
      setAllocations([]);
      fetchPayments();
    } catch (err: unknown) {
      setRecordError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setRecordSubmitting(false);
    }
  };

  // Submit New Customer
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;

    setNewCustSubmitting(true);
    try {
      const res = await apiFetch<{ success: boolean; data: CustomerRecord }>(
        '/api/finance/customers',
        {
          method: 'POST',
          body: JSON.stringify({
            name: newCustName.trim(),
            phone: newCustPhone.trim() || undefined,
            creditLimitPaisa: Math.round(parseFloat(newCustLimit || '0') * 100),
          }),
        }
      );

      setCustomers((prev) => [res.data, ...prev]);
      setPartyId(res.data.id);
      setIsNewCustomerOpen(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustLimit('0');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create customer');
    } finally {
      setNewCustSubmitting(false);
    }
  };

  // Clear Cheque
  const handleClearCheque = async (p: PaymentRecord) => {
    if (!confirm(`Mark Cheque #${p.chequeNumber || p.paymentNumber} as Cleared?`)) return;
    try {
      await apiFetch(`/api/finance/payments/${p.id}/clear-cheque`, { method: 'POST' });
      fetchPayments();
      if (selectedPayment?.id === p.id) {
        setIsDetailOpen(false);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to clear cheque');
    }
  };

  // Reversal Execution
  const handleExecuteReverse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentToReverse || !reversalReason.trim()) return;

    setReversalSubmitting(true);
    try {
      await apiFetch(`/api/finance/payments/${paymentToReverse.id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reversalReason: reversalReason.trim() }),
      });
      setIsReverseOpen(false);
      setPaymentToReverse(null);
      setReversalReason('');
      fetchPayments();
      if (selectedPayment?.id === paymentToReverse.id) {
        setIsDetailOpen(false);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to reverse payment');
    } finally {
      setReversalSubmitting(false);
    }
  };

  // Bounce Cheque Execution
  const handleExecuteBounce = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentToBounce || !bounceReason.trim()) return;

    setBounceSubmitting(true);
    try {
      await apiFetch(`/api/finance/payments/${paymentToBounce.id}/bounce-cheque`, {
        method: 'POST',
        body: JSON.stringify({ bounceReason: bounceReason.trim() }),
      });
      setIsBounceOpen(false);
      setPaymentToBounce(null);
      setBounceReason('');
      fetchPayments();
      if (selectedPayment?.id === paymentToBounce.id) {
        setIsDetailOpen(false);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to mark cheque as bounced');
    } finally {
      setBounceSubmitting(false);
    }
  };

  // Open Details Modal
  const handleOpenDetail = async (p: PaymentRecord) => {
    try {
      const res = await apiFetch<{ success: boolean; data: PaymentRecord }>(
        `/api/finance/payments/${p.id}`
      );
      setSelectedPayment(res.data);
      setIsDetailOpen(true);
    } catch {
      setSelectedPayment(p);
      setIsDetailOpen(true);
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-emerald-400" />
            Financial Payments & Receipts
          </h1>
          <p className="text-sm text-slate-400">
            Customer receipts on credit, supplier purchase payments, document allocations, and
            cheque clearing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPayments}
            disabled={loading}
            className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {canCreate && (
            <Button
              onClick={() => setIsRecordOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Record Payment
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Receipts */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400">Total Customer Receipts</p>
              <h3 className="text-xl font-bold text-emerald-400 mt-1">
                {formatPaisa(kpis.totalReceiptsPaisa)}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Settled credit invoices</p>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20 text-emerald-400">
              <ArrowDownLeft className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        {/* Total Payments */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400">Total Supplier Payments</p>
              <h3 className="text-xl font-bold text-amber-400 mt-1">
                {formatPaisa(kpis.totalPaymentsPaisa)}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Settled purchase bills</p>
            </div>
            <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/20 text-amber-400">
              <ArrowUpRight className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        {/* Net Cash Flow */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400">Net Cash Flow</p>
              <h3
                className={`text-xl font-bold mt-1 ${
                  kpis.netCashFlowPaisa >= 0 ? 'text-sky-400' : 'text-rose-400'
                }`}
              >
                {formatPaisa(kpis.netCashFlowPaisa)}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Receipts minus payments</p>
            </div>
            <div className="p-3 bg-sky-500/10 rounded-lg border border-sky-500/20 text-sky-400">
              <Scale className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        {/* Pending Cheques */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400">Pending Cheques</p>
              <h3 className="text-xl font-bold text-violet-400 mt-1">{kpis.pendingChequesCount}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Value: {formatPaisa(kpis.pendingChequesValuePaisa)}
              </p>
            </div>
            <div className="p-3 bg-violet-500/10 rounded-lg border border-violet-500/20 text-violet-400">
              <CreditCard className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs & Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-slate-900/60 p-3 rounded-lg border border-slate-800">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 border-b sm:border-b-0 border-slate-800 pb-2 sm:pb-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActiveTab('all');
              setPage(1);
            }}
            className={
              activeTab === 'all'
                ? 'bg-slate-800 text-white font-medium'
                : 'text-slate-400 hover:text-white'
            }
          >
            All Transactions
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActiveTab('receipt');
              setPage(1);
            }}
            className={
              activeTab === 'receipt'
                ? 'bg-slate-800 text-emerald-400 font-medium'
                : 'text-slate-400 hover:text-emerald-400'
            }
          >
            Receipts
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActiveTab('payment');
              setPage(1);
            }}
            className={
              activeTab === 'payment'
                ? 'bg-slate-800 text-amber-400 font-medium'
                : 'text-slate-400 hover:text-amber-400'
            }
          >
            Payments
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActiveTab('cheque');
              setPage(1);
            }}
            className={
              activeTab === 'cheque'
                ? 'bg-slate-800 text-violet-400 font-medium'
                : 'text-slate-400 hover:text-violet-400'
            }
          >
            Cheque Register
          </Button>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'cheque' && (
            <select
              value={chequeStatusFilter}
              onChange={(e) => {
                setChequeStatusFilter(e.target.value as 'all' | ChequeStatus);
                setPage(1);
              }}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">All Cheque Statuses</option>
              <option value="pending">Pending Clearing</option>
              <option value="cleared">Cleared</option>
              <option value="bounced">Bounced</option>
            </select>
          )}

          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search #, cheque, notes..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-md pl-8 pr-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-44 sm:w-56"
            />
          </div>

          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(1);
            }}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />

          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(1);
            }}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-sm flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Payments Table */}
      <Card className="bg-slate-900 border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-800/60">
              <TableRow className="border-slate-800">
                <TableHead className="text-slate-400 font-medium">Payment #</TableHead>
                <TableHead className="text-slate-400 font-medium">Date</TableHead>
                <TableHead className="text-slate-400 font-medium">Type</TableHead>
                <TableHead className="text-slate-400 font-medium">Party</TableHead>
                <TableHead className="text-slate-400 font-medium">Method</TableHead>
                <TableHead className="text-slate-400 font-medium text-right">Amount</TableHead>
                <TableHead className="text-slate-400 font-medium text-right">
                  Allocated / Advance
                </TableHead>
                <TableHead className="text-slate-400 font-medium">Cheque Status</TableHead>
                <TableHead className="text-slate-400 font-medium">Status</TableHead>
                <TableHead className="text-slate-400 font-medium text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-10 text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-emerald-500" />
                    Loading payment records...
                  </TableCell>
                </TableRow>
              ) : payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-10 text-slate-400">
                    No transactions found for the selected filters.
                  </TableCell>
                </TableRow>
              ) : (
                payments.map((p) => {
                  const methodMeta = getPaymentMethodMeta(p.method);
                  const statusMeta = getPaymentStatusMeta(p.status);
                  const chequeMeta =
                    p.method === 'cheque' ? getChequeStatusMeta(p.chequeStatus) : null;

                  return (
                    <TableRow key={p.id} className="border-slate-800 hover:bg-slate-800/30">
                      <TableCell className="font-mono text-sm font-semibold text-slate-200">
                        {p.paymentNumber}
                      </TableCell>
                      <TableCell className="text-sm text-slate-300">
                        {formatKarachiDateOnly(p.paymentDate)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            p.direction === 'receipt'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }
                        >
                          {p.direction === 'receipt' ? 'Receipt' : 'Payment'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm font-medium text-slate-200">
                        {p.partyName || (p.partyType === 'customer' ? 'Customer' : 'Supplier')}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium w-max ${methodMeta.badgeClass}`}
                          >
                            {methodMeta.label}
                          </span>
                          {p.method === 'cheque' && p.chequeNumber && (
                            <span className="text-xs font-mono text-slate-400 mt-0.5">
                              #{p.chequeNumber}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm font-semibold text-right text-slate-100">
                        {formatPaisa(p.amountPaisa)}
                      </TableCell>
                      <TableCell className="text-sm text-right">
                        <div className="flex flex-col items-end">
                          <span className="text-slate-300 font-medium">
                            {formatPaisa(p.allocatedPaisa)}
                          </span>
                          {p.advancePaisa > 0 && (
                            <span className="text-xs text-sky-400 font-mono">
                              +{formatPaisa(p.advancePaisa)} adv
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {chequeMeta ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${chequeMeta.badgeClass}`}
                          >
                            {chequeMeta.label}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusMeta.badgeClass}`}
                        >
                          {statusMeta.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenDetail(p)}
                            className="h-8 w-8 p-0 text-slate-400 hover:text-white"
                            title="View Details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>

                          {p.method === 'cheque' &&
                            p.chequeStatus === 'pending' &&
                            p.status !== 'reversed' &&
                            canCreate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleClearCheque(p)}
                                className="h-8 w-8 p-0 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                                title="Mark Cheque Cleared"
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                            )}

                          {p.method === 'cheque' &&
                            p.chequeStatus !== 'bounced' &&
                            p.status !== 'reversed' &&
                            canCreate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setPaymentToBounce(p);
                                  setIsBounceOpen(true);
                                }}
                                className="h-8 w-8 p-0 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                title="Mark Cheque Bounced"
                              >
                                <AlertTriangle className="h-4 w-4" />
                              </Button>
                            )}

                          {p.status !== 'reversed' && canCreate && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setPaymentToReverse(p);
                                setIsReverseOpen(true);
                              }}
                              className="h-8 w-8 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                              title="Reverse Payment"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="border-slate-700 bg-slate-800 text-slate-300"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="border-slate-700 bg-slate-800 text-slate-300"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Record Payment Drawer / Modal */}
      <Modal
        open={isRecordOpen}
        onClose={() => setIsRecordOpen(false)}
        title={direction === 'receipt' ? 'Record Customer Receipt' : 'Record Supplier Payment'}
        maxWidth="2xl"
      >
        <form onSubmit={handleRecordSubmit} className="space-y-4">
          {recordError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>{recordError}</span>
            </div>
          )}

          {/* Direction Toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setDirection('receipt');
                setPartyId('');
              }}
              className={`py-2 text-sm font-semibold rounded-md transition-all ${
                direction === 'receipt'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Customer Receipt (Inflow)
            </button>
            <button
              type="button"
              onClick={() => {
                setDirection('payment');
                setPartyId('');
              }}
              className={`py-2 text-sm font-semibold rounded-md transition-all ${
                direction === 'payment'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Supplier Payment (Outflow)
            </button>
          </div>

          {/* Core Fields Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Party Selector */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-300">
                  {direction === 'receipt' ? 'Customer' : 'Supplier'} *
                </label>
                {direction === 'receipt' && (
                  <button
                    type="button"
                    onClick={() => setIsNewCustomerOpen(true)}
                    className="text-xs text-emerald-400 hover:underline flex items-center gap-0.5"
                  >
                    <Plus className="h-3 w-3" /> New
                  </button>
                )}
              </div>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                required
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-md px-3 py-2 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">
                  Select {direction === 'receipt' ? 'Customer' : 'Supplier'}...
                </option>
                {direction === 'receipt'
                  ? customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phone ? `(${c.phone})` : ''}
                      </option>
                    ))
                  : suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
              </select>
            </div>

            {/* Branch */}
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">Branch *</label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                required
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-md px-3 py-2 focus:ring-1 focus:ring-emerald-500"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">
                Payment Date *
              </label>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                required
                className="bg-slate-800 border-slate-700 text-slate-200 text-sm"
              />
            </div>
          </div>

          {/* Amount & Method */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Amount */}
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">
                Amount (PKR) *
              </label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="e.g. 5000.00"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                required
                className="bg-slate-800 border-slate-700 text-slate-200 text-sm font-semibold"
              />
            </div>

            {/* Method */}
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">
                Payment Method *
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-md px-3 py-2 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="cash">Cash in Hand</option>
                <option value="bank">Bank Transfer</option>
                <option value="wallet">Mobile Wallet (Easypaisa/JazzCash)</option>
                <option value="cheque">Bank Cheque</option>
              </select>
            </div>

            {/* Reference */}
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">
                Reference / Slip #
              </label>
              <Input
                type="text"
                placeholder="Optional receipt / slip #"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                className="bg-slate-800 border-slate-700 text-slate-200 text-sm"
              />
            </div>
          </div>

          {/* Cheque Specific Fields */}
          {method === 'cheque' && (
            <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-md grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-amber-300 block mb-1">
                  Cheque Number *
                </label>
                <Input
                  type="text"
                  placeholder="e.g. CHQ-882299"
                  value={chequeNumber}
                  onChange={(e) => setChequeNumber(e.target.value)}
                  required
                  className="bg-slate-800 border-amber-500/30 text-slate-200 text-sm font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-amber-300 block mb-1">Cheque Date</label>
                <Input
                  type="date"
                  value={chequeDate}
                  onChange={(e) => setChequeDate(e.target.value)}
                  className="bg-slate-800 border-amber-500/30 text-slate-200 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-amber-300 block mb-1">
                  Drawee Bank Name
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Meezan Bank, HBL"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="bg-slate-800 border-amber-500/30 text-slate-200 text-sm"
                />
              </div>
            </div>
          )}

          {/* Document Allocation Section */}
          <div className="pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-emerald-400" />
                  Apply Payment to Open Documents
                </h4>
                <p className="text-xs text-slate-400">
                  Select open credit invoices or bills to allocate against.
                </p>
              </div>

              {unpaidDocs.length > 0 && totalAmountPaisa > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAutoAllocate}
                  className="border-emerald-600/40 text-emerald-400 hover:bg-emerald-600/10 text-xs"
                >
                  Auto-Allocate (FIFO)
                </Button>
              )}
            </div>

            {docsLoading ? (
              <div className="p-4 text-center text-xs text-slate-400">
                Loading open documents...
              </div>
            ) : unpaidDocs.length === 0 ? (
              <div className="p-3 bg-slate-800/40 border border-slate-800 rounded text-xs text-slate-400 text-center">
                {partyId
                  ? 'No open credit documents pending for this party. The full amount will be recorded as an Advance Balance.'
                  : 'Select a customer or supplier to view outstanding credit balances.'}
              </div>
            ) : (
              <div className="border border-slate-800 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                <Table>
                  <TableHeader className="bg-slate-800/80">
                    <TableRow className="border-slate-800">
                      <TableHead className="text-xs text-slate-400">Doc #</TableHead>
                      <TableHead className="text-xs text-slate-400">Date</TableHead>
                      <TableHead className="text-xs text-slate-400 text-right">Total Due</TableHead>
                      <TableHead className="text-xs text-slate-400 text-right">
                        Balance Due
                      </TableHead>
                      <TableHead className="text-xs text-slate-400 text-right w-36">
                        Apply (PKR)
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unpaidDocs.map((doc, idx) => {
                      const curAlloc = allocations.find((a) => a.documentId === doc.id);
                      return (
                        <TableRow key={doc.id} className="border-slate-800">
                          <TableCell className="text-xs font-mono font-medium text-slate-200">
                            {doc.documentNumber}
                          </TableCell>
                          <TableCell className="text-xs text-slate-400">{doc.date}</TableCell>
                          <TableCell className="text-xs text-right text-slate-400">
                            {formatPaisa(doc.totalPaisa)}
                          </TableCell>
                          <TableCell className="text-xs text-right font-semibold text-amber-400">
                            {formatPaisa(doc.balanceDuePaisa)}
                          </TableCell>
                          <TableCell className="text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max={(doc.balanceDuePaisa / 100).toFixed(2)}
                              value={curAlloc?.allocatedRupees || '0'}
                              onChange={(e) => {
                                const val = e.target.value;
                                setAllocations((prev) =>
                                  prev.map((a, i) =>
                                    i === idx ? { ...a, allocatedRupees: val } : a
                                  )
                                );
                              }}
                              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1 text-right focus:ring-1 focus:ring-emerald-500"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Allocation Summary Bar */}
            <div className="mt-3 p-3 bg-slate-800/80 rounded-lg flex flex-wrap items-center justify-between text-xs border border-slate-700">
              <div className="flex items-center gap-4">
                <span>
                  Total Amount:{' '}
                  <strong className="text-white font-mono">{formatPaisa(totalAmountPaisa)}</strong>
                </span>
                <span>
                  Allocated:{' '}
                  <strong className="text-emerald-400 font-mono">
                    {formatPaisa(totalAllocatedPaisa)}
                  </strong>
                </span>
                <span>
                  Advance Balance:{' '}
                  <strong className="text-sky-400 font-mono">{formatPaisa(advancePaisa)}</strong>
                </span>
              </div>

              {isOverAllocated && (
                <span className="text-rose-400 font-medium">
                  Error: Overallocated by {formatPaisa(totalAllocatedPaisa - totalAmountPaisa)}
                </span>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">Notes</label>
            <Input
              type="text"
              placeholder="Settlement notes, cheque memo, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-slate-800 border-slate-700 text-slate-200 text-sm"
            />
          </div>

          {/* Submit Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsRecordOpen(false)}
              className="border-slate-700 text-slate-300"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={recordSubmitting || isOverAllocated}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {recordSubmitting ? 'Posting...' : 'Confirm & Post Payment'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Payment Detail Modal */}
      {selectedPayment && (
        <Modal
          open={isDetailOpen}
          onClose={() => setIsDetailOpen(false)}
          title={`Payment Details: ${selectedPayment.paymentNumber}`}
          maxWidth="xl"
        >
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 bg-slate-800/80 rounded border border-slate-700">
                <span className="text-slate-400 block">Date</span>
                <span className="text-white font-medium">
                  {formatKarachiDateOnly(selectedPayment.paymentDate)}
                </span>
              </div>
              <div className="p-2.5 bg-slate-800/80 rounded border border-slate-700">
                <span className="text-slate-400 block">Direction</span>
                <span className="font-semibold text-emerald-400 capitalize">
                  {selectedPayment.direction}
                </span>
              </div>
              <div className="p-2.5 bg-slate-800/80 rounded border border-slate-700">
                <span className="text-slate-400 block">Amount</span>
                <span className="text-white font-mono font-bold">
                  {formatPaisa(selectedPayment.amountPaisa)}
                </span>
              </div>
              <div className="p-2.5 bg-slate-800/80 rounded border border-slate-700">
                <span className="text-slate-400 block">Method</span>
                <span className="text-slate-200 capitalize font-medium">
                  {selectedPayment.method}
                </span>
              </div>
            </div>

            {/* Cheque Info */}
            {selectedPayment.method === 'cheque' && (
              <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded text-xs space-y-1">
                <div className="flex justify-between font-medium">
                  <span className="text-amber-300">Cheque #: {selectedPayment.chequeNumber}</span>
                  <span className="text-slate-300">Bank: {selectedPayment.bankName || '—'}</span>
                  <span className="text-slate-300">
                    Status: <strong className="capitalize">{selectedPayment.chequeStatus}</strong>
                  </span>
                </div>
                {selectedPayment.bounceReason && (
                  <p className="text-rose-400 pt-1 border-t border-amber-500/20">
                    Bounce Reason: {selectedPayment.bounceReason}
                  </p>
                )}
              </div>
            )}

            {/* Allocations Table */}
            <div>
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Document Allocations
              </h4>
              {selectedPayment.allocations && selectedPayment.allocations.length > 0 ? (
                <div className="border border-slate-800 rounded overflow-hidden">
                  <Table>
                    <TableHeader className="bg-slate-800/60">
                      <TableRow className="border-slate-800">
                        <TableHead className="text-xs text-slate-400">Document #</TableHead>
                        <TableHead className="text-xs text-slate-400">Type</TableHead>
                        <TableHead className="text-xs text-slate-400 text-right">
                          Allocated
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedPayment.allocations.map((a) => (
                        <TableRow key={a.id} className="border-slate-800">
                          <TableCell className="text-xs font-mono text-slate-200">
                            {a.documentNumber}
                          </TableCell>
                          <TableCell className="text-xs text-slate-400 capitalize">
                            {a.documentType}
                          </TableCell>
                          <TableCell className="text-xs font-mono font-semibold text-right text-emerald-400">
                            {formatPaisa(a.allocatedPaisa)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  No document allocations (100% advance payment).
                </p>
              )}
            </div>

            {/* Advance Callout */}
            {selectedPayment.advancePaisa > 0 && (
              <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded text-xs flex justify-between items-center text-sky-400">
                <span>Advance Balance Remaining:</span>
                <span className="font-mono font-bold text-sm">
                  {formatPaisa(selectedPayment.advancePaisa)}
                </span>
              </div>
            )}

            {/* Reversal Banner */}
            {selectedPayment.status === 'reversed' && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded text-xs text-rose-400">
                <p className="font-semibold flex items-center gap-1.5">
                  <RotateCcw className="h-4 w-4" /> This payment has been reversed in the ledger.
                </p>
                {selectedPayment.reversalReason && (
                  <p className="mt-1 text-slate-300">Reason: {selectedPayment.reversalReason}</p>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <div className="flex items-center gap-2">
                {selectedPayment.method === 'cheque' &&
                  selectedPayment.chequeStatus === 'pending' &&
                  selectedPayment.status !== 'reversed' &&
                  canCreate && (
                    <Button
                      size="sm"
                      onClick={() => handleClearCheque(selectedPayment)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Clear Cheque
                    </Button>
                  )}

                {selectedPayment.method === 'cheque' &&
                  selectedPayment.chequeStatus !== 'bounced' &&
                  selectedPayment.status !== 'reversed' &&
                  canCreate && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPaymentToBounce(selectedPayment);
                        setIsBounceOpen(true);
                      }}
                      className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 text-xs"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Cheque Bounced
                    </Button>
                  )}

                {selectedPayment.status !== 'reversed' && canCreate && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPaymentToReverse(selectedPayment);
                      setIsReverseOpen(true);
                    }}
                    className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10 text-xs"
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reverse Payment
                  </Button>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDetailOpen(false)}
                className="border-slate-700 text-slate-300"
              >
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reverse Payment Modal */}
      {paymentToReverse && (
        <Modal
          open={isReverseOpen}
          onClose={() => setIsReverseOpen(false)}
          title={`Reverse Payment #${paymentToReverse.paymentNumber}`}
          maxWidth="md"
        >
          <form onSubmit={handleExecuteReverse} className="space-y-4">
            <p className="text-xs text-slate-300">
              Reversing this payment will post an immutable reversal journal entry to the general
              ledger and re-open all allocated credit documents.
            </p>

            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">
                Reversal Reason *
              </label>
              <Input
                type="text"
                placeholder="Reason for payment reversal..."
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                required
                className="bg-slate-800 border-slate-700 text-slate-200 text-sm"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsReverseOpen(false)}
                className="border-slate-700 text-slate-300"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={reversalSubmitting || !reversalReason.trim()}
                className="bg-rose-600 hover:bg-rose-500 text-white"
              >
                {reversalSubmitting ? 'Reversing...' : 'Confirm Reversal'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Bounce Cheque Modal */}
      {paymentToBounce && (
        <Modal
          open={isBounceOpen}
          onClose={() => setIsBounceOpen(false)}
          title={`Record Bounced Cheque #${paymentToBounce.chequeNumber || paymentToBounce.paymentNumber}`}
          maxWidth="md"
        >
          <form onSubmit={handleExecuteBounce} className="space-y-4">
            <p className="text-xs text-slate-300">
              Recording this cheque as bounced will reverse the financial ledger entry, reopen all
              associated balances, and update the cheque register status to Bounced.
            </p>

            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">
                Bounce Reason / Bank Advice *
              </label>
              <Input
                type="text"
                placeholder="e.g. Insufficient funds / Signature mismatch"
                value={bounceReason}
                onChange={(e) => setBounceReason(e.target.value)}
                required
                className="bg-slate-800 border-slate-700 text-slate-200 text-sm"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsBounceOpen(false)}
                className="border-slate-700 text-slate-300"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={bounceSubmitting || !bounceReason.trim()}
                className="bg-amber-600 hover:bg-amber-500 text-white"
              >
                {bounceSubmitting ? 'Processing...' : 'Confirm Cheque Bounced'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Quick New Customer Modal */}
      <Modal
        open={isNewCustomerOpen}
        onClose={() => setIsNewCustomerOpen(false)}
        title="Add Customer Account"
        maxWidth="md"
      >
        <form onSubmit={handleCreateCustomer} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">Customer Name *</label>
            <Input
              type="text"
              placeholder="e.g. Dr. Zafar Clinic"
              value={newCustName}
              onChange={(e) => setNewCustName(e.target.value)}
              required
              className="bg-slate-800 border-slate-700 text-slate-200 text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">Phone Number</label>
            <Input
              type="text"
              placeholder="03001234567"
              value={newCustPhone}
              onChange={(e) => setNewCustPhone(e.target.value)}
              className="bg-slate-800 border-slate-700 text-slate-200 text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">
              Credit Limit (PKR)
            </label>
            <Input
              type="number"
              step="1"
              min="0"
              value={newCustLimit}
              onChange={(e) => setNewCustLimit(e.target.value)}
              className="bg-slate-800 border-slate-700 text-slate-200 text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsNewCustomerOpen(false)}
              className="border-slate-700 text-slate-300"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={newCustSubmitting}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              <UserCheck className="h-4 w-4 mr-1" />
              {newCustSubmitting ? 'Saving...' : 'Save Customer'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
