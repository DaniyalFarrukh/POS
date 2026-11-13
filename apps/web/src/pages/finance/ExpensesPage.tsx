import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  ExpenseRecord,
  ExpenseKPIs,
  ExpenseCategoryRecord,
  RecurringExpenseRecord,
  ExpensePaymentType,
  BranchRecord,
} from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatPaisa, formatKarachiDateOnly } from '../../lib/formatters';
import {
  getExpenseStatusMeta,
  getPaymentTypeMeta,
  isApprovalRequired,
} from '../../lib/expense-utils';
import { getKarachiBusinessDate, parsePkrToPaisa } from '@pos/shared';
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
  TrendingUp,
  Receipt,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Plus,
  RefreshCw,
  Search,
  Eye,
  CreditCard,
  Wallet,
  Landmark,
  FileText,
  Repeat,
  Sparkles,
} from 'lucide-react';

interface JournalLineItem {
  id: string;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  debitPaisa: number;
  creditPaisa: number;
  memo?: string | null;
}

interface ExpenseDetailWithLines extends ExpenseRecord {
  journalLines?: JournalLineItem[];
}

interface RecurringPreviewData {
  period: string;
  pendingCount: number;
  alreadyGeneratedCount: number;
  templates: Array<{
    id: string;
    title: string;
    amountPaisa: number;
    categoryName: string;
    paymentType: string;
    paymentMethod: string | null;
    vendorName: string | null;
    lastGeneratedPeriod: string | null;
  }>;
}

export const ExpensesPage: React.FC = () => {
  const { can } = useAuth();

  // Active Main Tab
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'recurring' | 'categories'>('all');

  // Main Data States
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [kpis, setKpis] = useState<ExpenseKPIs>({
    totalExpensesPaisa: 0,
    expenseCount: 0,
    averageExpensePaisa: 0,
    pendingApprovalCount: 0,
  });
  const [categories, setCategories] = useState<ExpenseCategoryRecord[]>([]);
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringExpenseRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [approvalThresholdPaisa, setApprovalThresholdPaisa] = useState<number>(2500000); // 25,000 PKR default

  // Loading & Error States
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState<boolean>(false);
  const [isReverseModalOpen, setIsReverseModalOpen] = useState<boolean>(false);
  const [isAddRecurringModalOpen, setIsAddRecurringModalOpen] = useState<boolean>(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState<boolean>(false);
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState<boolean>(false);

  // Selected for Details / Reversal
  const [selectedExpense, setSelectedExpense] = useState<ExpenseDetailWithLines | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [expenseToReverse, setExpenseToReverse] = useState<ExpenseRecord | null>(null);
  const [reverseReason, setReverseReason] = useState<string>('');
  const [reverseSubmitting, setReverseSubmitting] = useState<boolean>(false);

  // Add Expense Form State
  const [addBranchId, setAddBranchId] = useState<string>('');
  const [addCategoryId, setAddCategoryId] = useState<string>('');
  const [addAmountRupees, setAddAmountRupees] = useState<string>('');
  const [addExpenseDate, setAddExpenseDate] = useState<string>(() => getKarachiBusinessDate());
  const [addPaymentType, setAddPaymentType] = useState<ExpensePaymentType>('paid');
  const [addPaymentMethod, setAddPaymentMethod] = useState<'cash' | 'bank' | 'wallet'>('cash');
  const [addVendorName, setAddVendorName] = useState<string>('');
  const [addNotes, setAddNotes] = useState<string>('');
  const [addSubmitting, setAddSubmitting] = useState<boolean>(false);
  const [addFormError, setAddFormError] = useState<string | null>(null);

  // Add Recurring Template Form State
  const [recTitle, setRecTitle] = useState<string>('');
  const [recBranchId, setRecBranchId] = useState<string>('');
  const [recCategoryId, setRecCategoryId] = useState<string>('');
  const [recAmountRupees, setRecAmountRupees] = useState<string>('');
  const [recDayOfMonth, setRecDayOfMonth] = useState<number>(1);
  const [recPaymentType, setRecPaymentType] = useState<ExpensePaymentType>('paid');
  const [recPaymentMethod, setRecPaymentMethod] = useState<'cash' | 'bank' | 'wallet'>('cash');
  const [recVendorName, setRecVendorName] = useState<string>('');
  const [recNotes, setRecNotes] = useState<string>('');
  const [recSubmitting, setRecSubmitting] = useState<boolean>(false);
  const [recFormError, setRecFormError] = useState<string | null>(null);

  // Recurring Generation State
  const [genPeriod, setGenPeriod] = useState<string>(() => getKarachiBusinessDate().slice(0, 7));
  const [genPreview, setGenPreview] = useState<RecurringPreviewData | null>(null);
  const [genLoading, setGenLoading] = useState<boolean>(false);
  const [genSubmitting, setGenSubmitting] = useState<boolean>(false);
  const [genResultMsg, setGenResultMsg] = useState<string | null>(null);

  // Add Category State
  const [catName, setCatName] = useState<string>('');
  const [catDescription, setCatDescription] = useState<string>('');
  const [catSubmitting, setCatSubmitting] = useState<boolean>(false);
  const [catFormError, setCatFormError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  const fetchBranches = useCallback(async () => {
    try {
      const res = await apiFetch<{ items?: BranchRecord[]; data?: BranchRecord[] }>(
        '/api/admin/branches'
      ).catch(() => ({
        items: [] as BranchRecord[],
        data: [] as BranchRecord[],
      }));
      const list = res.items || res.data || [];
      setBranches(list);
      if (list.length > 0 && !addBranchId) {
        setAddBranchId(list[0]!.id);
        setRecBranchId(list[0]!.id);
      }
    } catch {
      // Branch list fetch failed silently
    }
  }, [addBranchId]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await apiFetch<{ success: boolean; data: ExpenseCategoryRecord[] }>(
        '/api/finance/expense-categories'
      );
      if (res.success && Array.isArray(res.data)) {
        setCategories(res.data);
        if (res.data.length > 0 && !addCategoryId) {
          setAddCategoryId(res.data[0]!.id);
          setRecCategoryId(res.data[0]!.id);
        }
      }
    } catch {
      // Failed to load categories
    }
  }, [addCategoryId]);

  const fetchRecurringTemplates = useCallback(async () => {
    try {
      const res = await apiFetch<{ success: boolean; data: RecurringExpenseRecord[] }>(
        '/api/finance/expenses/recurring'
      );
      if (res.success && Array.isArray(res.data)) {
        setRecurringTemplates(res.data);
      }
    } catch {
      // Failed to load recurring
    }
  }, []);

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (branchFilter !== 'all') params.append('branchId', branchFilter);
      if (categoryFilter !== 'all') params.append('categoryId', categoryFilter);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (paymentTypeFilter !== 'all') params.append('paymentType', paymentTypeFilter);
      if (dateFrom) params.append('startDate', dateFrom);
      if (dateTo) params.append('endDate', dateTo);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const url = `/api/finance/expenses${params.toString() ? `?${params.toString()}` : ''}`;
      const res = await apiFetch<{
        success: boolean;
        data: {
          items: ExpenseRecord[];
          kpis: ExpenseKPIs;
          approvalThresholdPaisa?: number;
        };
      }>(url);

      if (res.success && res.data) {
        setExpenses(res.data.items || []);
        if (res.data.kpis) {
          setKpis(res.data.kpis);
        }
        if (res.data.approvalThresholdPaisa) {
          setApprovalThresholdPaisa(res.data.approvalThresholdPaisa);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  }, [
    branchFilter,
    categoryFilter,
    statusFilter,
    paymentTypeFilter,
    dateFrom,
    dateTo,
    searchQuery,
  ]);

  useEffect(() => {
    fetchBranches();
    fetchCategories();
    fetchRecurringTemplates();
  }, [fetchBranches, fetchCategories, fetchRecurringTemplates]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------

  const handleOpenDetail = async (exp: ExpenseRecord) => {
    setSelectedExpense(exp);
    setIsDetailModalOpen(true);
    setDetailLoading(true);
    try {
      const res = await apiFetch<{ success: boolean; data: ExpenseDetailWithLines }>(
        `/api/finance/expenses/${exp.id}`
      );
      if (res.success && res.data) {
        setSelectedExpense(res.data);
      }
    } catch {
      // Fallback to minimal data
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddFormError(null);

    const amountPaisa = parsePkrToPaisa(addAmountRupees, 0);
    if (amountPaisa <= 0) {
      setAddFormError('Please enter a valid positive expense amount.');
      return;
    }

    if (!addCategoryId) {
      setAddFormError('Please select an expense category.');
      return;
    }
    if (!addBranchId) {
      setAddFormError('Please select a branch.');
      return;
    }

    setAddSubmitting(true);
    try {
      const res = await apiFetch<{ success: boolean; data: ExpenseRecord }>(
        '/api/finance/expenses',
        {
          method: 'POST',
          body: JSON.stringify({
            branchId: addBranchId,
            categoryId: addCategoryId,
            amountPaisa,
            expenseDate: addExpenseDate,
            paymentType: addPaymentType,
            paymentMethod: addPaymentType === 'paid' ? addPaymentMethod : null,
            vendorName: addVendorName.trim() || null,
            notes: addNotes.trim() || null,
          }),
        }
      );

      if (res.success) {
        setIsAddModalOpen(false);
        setAddAmountRupees('');
        setAddVendorName('');
        setAddNotes('');
        await fetchExpenses();
      } else {
        setAddFormError('Failed to record expense.');
      }
    } catch (err) {
      setAddFormError(err instanceof Error ? err.message : 'Failed to record expense.');
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleApproveExpense = async (id: string) => {
    if (
      !confirm(
        'Are you sure you want to approve this expense? This will post the transaction to the General Ledger.'
      )
    ) {
      return;
    }
    try {
      const res = await apiFetch<{ success: boolean }>(`/api/finance/expenses/${id}/approve`, {
        method: 'POST',
      });
      if (res.success) {
        await fetchExpenses();
        if (selectedExpense && selectedExpense.id === id) {
          setIsDetailModalOpen(false);
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve expense');
    }
  };

  const handleReverseExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseToReverse) return;
    if (!reverseReason.trim()) {
      alert('Please provide a mandatory reversal reason.');
      return;
    }

    setReverseSubmitting(true);
    try {
      const res = await apiFetch<{ success: boolean }>(
        `/api/finance/expenses/${expenseToReverse.id}/reverse`,
        {
          method: 'POST',
          body: JSON.stringify({ reversalReason: reverseReason.trim() }),
        }
      );

      if (res.success) {
        setIsReverseModalOpen(false);
        setExpenseToReverse(null);
        setReverseReason('');
        if (isDetailModalOpen) {
          setIsDetailModalOpen(false);
        }
        await fetchExpenses();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reverse expense');
    } finally {
      setReverseSubmitting(false);
    }
  };

  const handleCreateRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecFormError(null);

    const amountPaisa = parsePkrToPaisa(recAmountRupees, 0);
    if (amountPaisa <= 0) {
      setRecFormError('Please enter a valid positive recurring amount.');
      return;
    }

    if (!recTitle.trim()) {
      setRecFormError('Please specify a title (e.g. Monthly Rent).');
      return;
    }
    if (!recCategoryId) {
      setRecFormError('Please select an expense category.');
      return;
    }

    setRecSubmitting(true);
    try {
      const res = await apiFetch<{ success: boolean; data: RecurringExpenseRecord }>(
        '/api/finance/expenses/recurring',
        {
          method: 'POST',
          body: JSON.stringify({
            branchId: recBranchId || null,
            title: recTitle.trim(),
            categoryId: recCategoryId,
            amountPaisa,
            frequency: 'monthly',
            dayOfMonth: recDayOfMonth,
            paymentType: recPaymentType,
            paymentMethod: recPaymentType === 'paid' ? recPaymentMethod : null,
            vendorName: recVendorName.trim() || null,
            notes: recNotes.trim() || null,
          }),
        }
      );

      if (res.success) {
        setIsAddRecurringModalOpen(false);
        setRecTitle('');
        setRecAmountRupees('');
        setRecVendorName('');
        setRecNotes('');
        await fetchRecurringTemplates();
      } else {
        setRecFormError('Failed to create recurring template.');
      }
    } catch (err) {
      setRecFormError(err instanceof Error ? err.message : 'Failed to create recurring template.');
    } finally {
      setRecSubmitting(false);
    }
  };

  const handlePreviewRecurring = useCallback(async (period: string) => {
    setGenLoading(true);
    setGenResultMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: RecurringPreviewData }>(
        `/api/finance/expenses/recurring/preview?period=${period}`
      );
      if (res.success && res.data) {
        setGenPreview(res.data);
      }
    } catch {
      // preview error
    } finally {
      setGenLoading(false);
    }
  }, []);

  const handleOpenGenerateModal = () => {
    setIsGenerateModalOpen(true);
    setGenResultMsg(null);
    handlePreviewRecurring(genPeriod);
  };

  const handleRunGeneration = async () => {
    setGenSubmitting(true);
    setGenResultMsg(null);
    try {
      const res = await apiFetch<{
        success: boolean;
        data: {
          generatedCount: number;
          skippedCount: number;
        };
      }>('/api/finance/expenses/recurring/generate', {
        method: 'POST',
        body: JSON.stringify({ period: genPeriod }),
      });

      if (res.success && res.data) {
        setGenResultMsg(
          `Successfully processed! ${res.data.generatedCount} recurring expense(s) created, ${res.data.skippedCount} already existed (idempotently skipped).`
        );
        await fetchExpenses();
        await fetchRecurringTemplates();
        await handlePreviewRecurring(genPeriod);
      }
    } catch (err) {
      setGenResultMsg(`Generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setGenSubmitting(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setCatFormError(null);
    if (!catName.trim()) {
      setCatFormError('Category name is required.');
      return;
    }

    setCatSubmitting(true);
    try {
      // We look up an account or pass the standard account ID.
      // Standard expense accounts in COA: 5090 is Other Expenses
      const res = await apiFetch<{ success: boolean; data: ExpenseCategoryRecord }>(
        '/api/finance/expense-categories',
        {
          method: 'POST',
          body: JSON.stringify({
            name: catName.trim(),
            accountId: categories[0]?.accountId || '00000000-0000-0000-0000-000000000000',
            description: catDescription.trim() || null,
          }),
        }
      );

      if (res.success) {
        setIsAddCategoryModalOpen(false);
        setCatName('');
        setCatDescription('');
        await fetchCategories();
      }
    } catch (err) {
      setCatFormError(err instanceof Error ? err.message : 'Failed to create category.');
    } finally {
      setCatSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Filtered views
  // ---------------------------------------------------------------------------

  const displayedExpenses = useMemo(() => {
    if (activeTab === 'pending') {
      return expenses.filter((e) => e.status === 'pending_approval');
    }
    return expenses;
  }, [expenses, activeTab]);

  const liveThresholdCheck = useMemo(() => {
    const amountPaisa = parsePkrToPaisa(addAmountRupees, 0);
    if (amountPaisa <= 0) return false;
    return isApprovalRequired(amountPaisa, approvalThresholdPaisa);
  }, [addAmountRupees, approvalThresholdPaisa]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Expenses & Operating Costs
            </h1>
            <Badge variant="outline" className="border-indigo-500/30 text-indigo-500 text-xs">
              General Ledger
            </Badge>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Track business operating expenses, recurring utilities and rent, approval limits, and
            automated journal entries
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchExpenses()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {can('finance.expense.create') && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenGenerateModal}
                className="border-indigo-500/30 text-indigo-600 hover:bg-indigo-50:bg-indigo-950/40"
              >
                <Repeat className="w-4 h-4 mr-2" />
                Generate Recurring
              </Button>

              <Button
                size="sm"
                onClick={() => setIsAddModalOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Expense
              </Button>
            </>
          )}
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Total Posted Expenses</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">
                  {formatPaisa(kpis.totalExpensesPaisa)}
                </h3>
              </div>
              <div className="p-3 bg-indigo-500/10 text-indigo-600 rounded-lg">
                <DollarSign className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 flex items-center text-xs text-slate-500">
              <span>Posted to Chart of Accounts</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Expense Count</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">{kpis.expenseCount}</h3>
              </div>
              <div className="p-3 bg-emerald-500/10 text-emerald-600 rounded-lg">
                <Receipt className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 flex items-center text-xs text-slate-500">
              <span>Active approved transactions</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Average Expense</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">
                  {formatPaisa(kpis.averageExpensePaisa)}
                </h3>
              </div>
              <div className="p-3 bg-blue-500/10 text-blue-600 rounded-lg">
                <TrendingUp className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 flex items-center text-xs text-slate-500">
              <span>Per posted transaction</span>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`bg-white border-slate-200 shadow-sm ${
            kpis.pendingApprovalCount > 0 ? 'ring-2 ring-amber-500/30' : ''
          }`}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Pending Approvals</p>
                <h3 className="text-2xl font-bold text-amber-600 mt-1">
                  {kpis.pendingApprovalCount}
                </h3>
              </div>
              <div className="p-3 bg-amber-500/10 text-amber-600 rounded-lg">
                <AlertCircle className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 flex items-center text-xs text-slate-500">
              <span>Threshold: {formatPaisa(approvalThresholdPaisa)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Navigation Tabs */}
      <div className="border-b border-slate-200 flex items-center gap-6">
        <button
          onClick={() => setActiveTab('all')}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'all'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          All Expenses
        </button>

        <button
          onClick={() => setActiveTab('pending')}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'pending'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <span>Pending Approval</span>
          {kpis.pendingApprovalCount > 0 && (
            <Badge className="bg-amber-500 text-white hover:bg-amber-600 text-xs px-1.5 py-0.5">
              {kpis.pendingApprovalCount}
            </Badge>
          )}
        </button>

        <button
          onClick={() => setActiveTab('recurring')}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'recurring'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <span>Recurring Templates</span>
          <Badge variant="outline" className="text-xs">
            {recurringTemplates.length}
          </Badge>
        </button>

        <button
          onClick={() => setActiveTab('categories')}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'categories'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <span>Expense Categories</span>
          <Badge variant="outline" className="text-xs">
            {categories.length}
          </Badge>
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
          <p className="font-semibold">Error Loading Expenses</p>
          <p className="mt-0.5">{error}</p>
        </div>
      )}

      {/* TAB CONTENT: Expenses / Pending Approvals */}
      {(activeTab === 'all' || activeTab === 'pending') && (
        <div className="space-y-4">
          {/* Search & Filter Toolbar */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2 relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <Input
                placeholder="Search expense #, vendor, or notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-10 bg-white"
              />
            </div>

            <div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter by category"
                className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                aria-label="Filter by branch"
                className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={paymentTypeFilter}
                onChange={(e) => setPaymentTypeFilter(e.target.value)}
                aria-label="Filter by payment type"
                className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Payment Types</option>
                <option value="paid">Paid (Immediate)</option>
                <option value="credit">Credit (Payable)</option>
              </select>
            </div>

            {activeTab !== 'pending' && (
              <div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by status"
                  className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="posted">Posted</option>
                  <option value="pending_approval">Pending Approval</option>
                  <option value="reversed">Reversed</option>
                </select>
              </div>
            )}
          </div>

          {/* Date Range Bar */}
          <div className="flex flex-wrap items-center gap-3 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <span className="font-medium text-slate-500">Date Range:</span>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">From</span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 w-36 text-xs bg-white"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">To</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 w-36 text-xs bg-white"
              />
            </div>
            {(dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className="h-8 px-2 text-xs text-slate-500"
              >
                Clear Range
              </Button>
            )}
          </div>

          {/* Table */}
          <Card className="bg-white border-slate-200">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-slate-200">
                    <TableHead className="w-[120px]">Date</TableHead>
                    <TableHead>Expense #</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-slate-500">
                        <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
                        Loading expenses...
                      </TableCell>
                    </TableRow>
                  ) : displayedExpenses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-slate-500">
                        <Receipt className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                        <p className="font-medium text-slate-700">No expenses found</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {activeTab === 'pending'
                            ? 'No expenses currently pending approval.'
                            : 'Click "Add Expense" to record a new operating expense.'}
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayedExpenses.map((exp) => {
                      const statusMeta = getExpenseStatusMeta(exp.status);
                      const typeMeta = getPaymentTypeMeta(exp.paymentType);
                      return (
                        <TableRow
                          key={exp.id}
                          className="border-b border-slate-100 hover:bg-slate-50/50"
                        >
                          <TableCell className="font-mono text-xs text-slate-600">
                            {formatKarachiDateOnly(exp.expenseDate)}
                          </TableCell>
                          <TableCell className="font-medium text-slate-900">
                            <div className="flex items-center gap-2">
                              <span>{exp.expenseNumber}</span>
                              {exp.recurringPeriod && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] py-0 px-1 border-indigo-400/30 text-indigo-500"
                                >
                                  {exp.recurringPeriod}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs font-normal">
                              {exp.categoryName || 'Expense'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {exp.branchName || 'Main'}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {exp.vendorName || '—'}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-slate-900">
                            {formatPaisa(exp.amountPaisa)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span
                                className={`text-[11px] font-medium px-2 py-0.5 rounded-full inline-block w-fit ${typeMeta.badgeClass}`}
                              >
                                {typeMeta.label}
                              </span>
                              {exp.paymentType === 'paid' && exp.paymentMethod && (
                                <span className="text-[11px] text-slate-400 capitalize">
                                  via {exp.paymentMethod}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span
                              className={`text-xs font-medium px-2 py-0.5 rounded-full inline-block ${statusMeta.badgeClass}`}
                            >
                              {statusMeta.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenDetail(exp)}
                                title="View Details & General Ledger Lines"
                              >
                                <Eye className="w-4 h-4 text-slate-500" />
                              </Button>

                              {exp.status === 'pending_approval' &&
                                can('finance.expense.approve') && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleApproveExpense(exp.id)}
                                    className="text-emerald-600 hover:bg-emerald-50:bg-emerald-950/40"
                                    title="Approve and Post to Ledger"
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                  </Button>
                                )}

                              {exp.status === 'posted' && can('finance.expense.create') && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setExpenseToReverse(exp);
                                    setIsReverseModalOpen(true);
                                  }}
                                  className="text-rose-600 hover:bg-rose-50:bg-rose-950/40"
                                  title="Reverse Expense"
                                >
                                  <RotateCcw className="w-4 h-4" />
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
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB CONTENT: Recurring Templates */}
      {activeTab === 'recurring' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Recurring Expense Templates</h2>
              <p className="text-xs text-slate-500">
                Monthly rent, utilities, internet and maintenance bills generated automatically or
                on demand with preview
              </p>
            </div>
            {can('finance.expense.create') && (
              <Button
                size="sm"
                onClick={() => setIsAddRecurringModalOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Recurring Template
              </Button>
            )}
          </div>

          <Card className="bg-white border-slate-200">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-slate-200">
                    <TableHead>Title</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Frequency / Day</TableHead>
                    <TableHead>Payment Mode</TableHead>
                    <TableHead>Last Generated</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recurringTemplates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-slate-500">
                        <Repeat className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                        <p className="font-medium text-slate-700">No recurring templates</p>
                        <p className="text-xs text-slate-400 mt-1">
                          Create recurring templates to generate rent or utilities monthly in 1
                          click.
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    recurringTemplates.map((tmpl) => (
                      <TableRow
                        key={tmpl.id}
                        className="border-b border-slate-100 hover:bg-slate-50/50"
                      >
                        <TableCell className="font-medium text-slate-900">{tmpl.title}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {tmpl.categoryName || 'Expense'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {tmpl.branchName || 'All Branches'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {tmpl.vendorName || '—'}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-slate-900">
                          {formatPaisa(tmpl.amountPaisa)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 capitalize">
                          {tmpl.frequency} (Day {tmpl.dayOfMonth})
                        </TableCell>
                        <TableCell>
                          <span className="text-xs capitalize">
                            {tmpl.paymentType === 'paid'
                              ? `Paid (${tmpl.paymentMethod || 'cash'})`
                              : 'Credit (Payable)'}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-500">
                          {tmpl.lastGeneratedPeriod || 'Never'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              tmpl.isActive
                                ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                                : 'bg-slate-500/10 text-slate-500 border border-slate-500/20'
                            }
                          >
                            {tmpl.isActive ? 'Active' : 'Paused'}
                          </Badge>
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

      {/* TAB CONTENT: Expense Categories */}
      {activeTab === 'categories' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Expense Categories & Chart of Accounts Mapping
              </h2>
              <p className="text-xs text-slate-500">
                Each expense category maps directly to an expense ledger account in the Chart of
                Accounts (COA Class 5000)
              </p>
            </div>
            {can('finance.expense.create') && (
              <Button
                size="sm"
                onClick={() => setIsAddCategoryModalOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Category
              </Button>
            )}
          </div>

          <Card className="bg-white border-slate-200">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-slate-200">
                    <TableHead>Category Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Account ID</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((cat) => (
                    <TableRow key={cat.id} className="border-b border-slate-100">
                      <TableCell className="font-semibold text-slate-900">{cat.name}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {cat.description || '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-400">
                        {cat.accountId}
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                          Active
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* --------------------------------------------------------------------------- */}
      {/* MODAL: Record Expense */}
      {/* --------------------------------------------------------------------------- */}
      <Modal
        open={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Record Operating Expense"
        maxWidth="lg"
      >
        <form onSubmit={handleCreateExpense} className="space-y-4">
          {addFormError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-md">
              {addFormError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category *</label>
              <select
                value={addCategoryId}
                onChange={(e) => setAddCategoryId(e.target.value)}
                required
                className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Branch *</label>
              <select
                value={addBranchId}
                onChange={(e) => setAddBranchId(e.target.value)}
                required
                className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Amount (PKR) *
              </label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={addAmountRupees}
                onChange={(e) => setAddAmountRupees(e.target.value)}
                required
                className="h-10"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Expense Date *
              </label>
              <Input
                type="date"
                value={addExpenseDate}
                onChange={(e) => setAddExpenseDate(e.target.value)}
                required
                className="h-10"
              />
            </div>
          </div>

          {/* Live Approval Warning Banner */}
          {liveThresholdCheck && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-md flex items-start gap-2 text-xs text-amber-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Approval Required</p>
                <p>
                  This amount exceeds the pharmacy threshold of{' '}
                  {formatPaisa(approvalThresholdPaisa)}. It will be queued for Owner/Manager
                  approval before posting to the General Ledger.
                </p>
              </div>
            </div>
          )}

          {/* Payment Type Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700">Payment Settlement *</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAddPaymentType('paid')}
                className={`p-3 rounded-lg border text-left flex items-center gap-3 transition-colors ${
                  addPaymentType === 'paid'
                    ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 font-medium'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <CreditCard className="w-5 h-5 text-indigo-600" />
                <div>
                  <p className="text-xs font-semibold">Paid Immediately</p>
                  <p className="text-[11px] text-slate-500">Credits Cash or Bank Asset</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAddPaymentType('credit')}
                className={`p-3 rounded-lg border text-left flex items-center gap-3 transition-colors ${
                  addPaymentType === 'credit'
                    ? 'border-purple-600 bg-purple-50/50 text-purple-900 font-medium'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Landmark className="w-5 h-5 text-purple-600" />
                <div>
                  <p className="text-xs font-semibold">On Credit (Payable)</p>
                  <p className="text-[11px] text-slate-500">Credits Accounts Payable (2000)</p>
                </div>
              </button>
            </div>
          </div>

          {/* If Paid Immediately, choose method */}
          {addPaymentType === 'paid' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Payment Method *
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['cash', 'bank', 'wallet'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setAddPaymentMethod(method)}
                    className={`py-2 px-3 rounded border text-xs capitalize flex items-center justify-center gap-1.5 transition-colors ${
                      addPaymentMethod === method
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-semibold'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    {method === 'cash' && <DollarSign className="w-3.5 h-3.5" />}
                    {method === 'bank' && <Landmark className="w-3.5 h-3.5" />}
                    {method === 'wallet' && <Wallet className="w-3.5 h-3.5" />}
                    {method}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Optional Vendor */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Vendor / Beneficiary Name (Optional)
            </label>
            <Input
              type="text"
              placeholder="e.g. K-Electric, Landlord, Internet ISP"
              value={addVendorName}
              onChange={(e) => setAddVendorName(e.target.value)}
              className="h-10"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Notes & Bill References (Optional)
            </label>
            <textarea
              rows={2}
              placeholder="Provide invoice/receipt number or reference details. (Attachment storage is deferred: do not upload files)."
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setIsAddModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={addSubmitting}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {addSubmitting ? 'Saving...' : 'Record Expense'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* --------------------------------------------------------------------------- */}
      {/* MODAL: Expense Details & General Ledger Lines */}
      {/* --------------------------------------------------------------------------- */}
      <Modal
        open={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title={selectedExpense ? `Expense #${selectedExpense.expenseNumber}` : 'Expense Detail'}
        maxWidth="lg"
      >
        {selectedExpense && (
          <div className="space-y-5">
            {/* Header Status & Amount */}
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
              <div>
                <p className="text-xs text-slate-500">Total Expense Amount</p>
                <h3 className="text-2xl font-bold text-slate-900">
                  {formatPaisa(selectedExpense.amountPaisa)}
                </h3>
              </div>
              <div className="text-right">
                <span
                  className={`text-xs font-semibold px-3 py-1 rounded-full ${
                    getExpenseStatusMeta(selectedExpense.status).badgeClass
                  }`}
                >
                  {getExpenseStatusMeta(selectedExpense.status).label}
                </span>
                <p className="text-[11px] text-slate-400 mt-1">
                  Settlement: {getPaymentTypeMeta(selectedExpense.paymentType).label}
                </p>
              </div>
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-slate-500">Expense Date</p>
                <p className="font-semibold text-slate-800 mt-0.5">
                  {formatKarachiDateOnly(selectedExpense.expenseDate)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Category</p>
                <p className="font-semibold text-slate-800 mt-0.5">
                  {selectedExpense.categoryName}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Branch</p>
                <p className="font-semibold text-slate-800 mt-0.5">
                  {selectedExpense.branchName || 'Main'}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Vendor / Payee</p>
                <p className="font-semibold text-slate-800 mt-0.5">
                  {selectedExpense.vendorName || '—'}
                </p>
              </div>
            </div>

            {selectedExpense.notes && (
              <div className="p-3 bg-slate-50 rounded text-xs">
                <p className="text-slate-500 font-medium mb-1">Notes / References</p>
                <p className="text-slate-700">{selectedExpense.notes}</p>
              </div>
            )}

            {/* General Ledger Journal Breakdown */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-indigo-500" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  General Ledger Posting
                </h4>
              </div>

              {detailLoading ? (
                <div className="py-6 text-center text-xs text-slate-500">
                  <RefreshCw className="w-4 h-4 mx-auto animate-spin mb-1" />
                  Loading ledger entries...
                </div>
              ) : selectedExpense.journalLines && selectedExpense.journalLines.length > 0 ? (
                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 text-[11px]">
                        <TableHead>Account Code</TableHead>
                        <TableHead>Account Name</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedExpense.journalLines.map((line) => (
                        <TableRow key={line.id} className="text-xs">
                          <TableCell className="font-mono">{line.accountCode}</TableCell>
                          <TableCell className="font-medium">{line.accountName}</TableCell>
                          <TableCell className="text-right font-mono">
                            {line.debitPaisa > 0 ? formatPaisa(line.debitPaisa) : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {line.creditPaisa > 0 ? formatPaisa(line.creditPaisa) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : selectedExpense.status === 'pending_approval' ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800">
                  <p className="font-semibold">No journal entries created yet</p>
                  <p className="mt-0.5">
                    This expense requires approval because the amount (
                    {formatPaisa(selectedExpense.amountPaisa)}) exceeds the threshold limit. Posting
                    will occur automatically once approved.
                  </p>
                </div>
              ) : (
                <div className="p-3 text-center text-xs text-slate-400">
                  No direct journal lines found for this record.
                </div>
              )}
            </div>

            {/* Reversal Audit trail if reversed */}
            {selectedExpense.status === 'reversed' && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800">
                <p className="font-semibold flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" />
                  Transaction Reversed
                </p>
                <p className="mt-1">
                  Reason: {selectedExpense.reversalReason || 'No reason specified'}
                </p>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <Button variant="outline" size="sm" onClick={() => setIsDetailModalOpen(false)}>
                Close
              </Button>

              <div className="flex items-center gap-2">
                {selectedExpense.status === 'pending_approval' &&
                  can('finance.expense.approve') && (
                    <Button
                      size="sm"
                      onClick={() => handleApproveExpense(selectedExpense.id)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1.5" />
                      Approve & Post to Ledger
                    </Button>
                  )}

                {selectedExpense.status === 'posted' && can('finance.expense.create') && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setExpenseToReverse(selectedExpense);
                      setIsReverseModalOpen(true);
                    }}
                  >
                    <RotateCcw className="w-4 h-4 mr-1.5" />
                    Reverse Expense
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* --------------------------------------------------------------------------- */}
      {/* MODAL: Reverse Expense (Accounting Reversal Only) */}
      {/* --------------------------------------------------------------------------- */}
      <Modal
        open={isReverseModalOpen}
        onClose={() => setIsReverseModalOpen(false)}
        title="Reverse Operating Expense"
        maxWidth="md"
      >
        <form onSubmit={handleReverseExpense} className="space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800">
            <p className="font-semibold">Immutable Accounting Regulation</p>
            <p className="mt-0.5">
              Financial and accounting records cannot be modified or deleted. Reversing this expense
              will generate an offsetting reversing journal entry that neutralizes the financial
              balances.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Reversal Reason (Mandatory) *
            </label>
            <textarea
              rows={3}
              required
              placeholder="Explain why this expense is being reversed (e.g. Duplicate entry, incorrect amount recorded)..."
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsReverseModalOpen(false);
                setExpenseToReverse(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={reverseSubmitting || !reverseReason.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {reverseSubmitting ? 'Reversing...' : 'Confirm Reversal'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* --------------------------------------------------------------------------- */}
      {/* MODAL: New Recurring Template */}
      {/* --------------------------------------------------------------------------- */}
      <Modal
        open={isAddRecurringModalOpen}
        onClose={() => setIsAddRecurringModalOpen(false)}
        title="Create Recurring Expense Template"
        maxWidth="lg"
      >
        <form onSubmit={handleCreateRecurring} className="space-y-4">
          {recFormError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-md">
              {recFormError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Template Title *
            </label>
            <Input
              type="text"
              placeholder="e.g. Monthly Shop Rent - Clifton Branch"
              value={recTitle}
              onChange={(e) => setRecTitle(e.target.value)}
              required
              className="h-10"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category *</label>
              <select
                value={recCategoryId}
                onChange={(e) => setRecCategoryId(e.target.value)}
                required
                className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Branch (Optional)
              </label>
              <select
                value={recBranchId}
                onChange={(e) => setRecBranchId(e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Branches / Main</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Recurring Amount (PKR) *
              </label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={recAmountRupees}
                onChange={(e) => setRecAmountRupees(e.target.value)}
                required
                className="h-10"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Day of Month (1 - 31) *
              </label>
              <Input
                type="number"
                min="1"
                max="31"
                value={recDayOfMonth}
                onChange={(e) => setRecDayOfMonth(parseInt(e.target.value) || 1)}
                required
                className="h-10"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Settlement Type
              </label>
              <select
                value={recPaymentType}
                onChange={(e) => setRecPaymentType(e.target.value as ExpensePaymentType)}
                className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="paid">Paid Immediately</option>
                <option value="credit">On Credit (Payable)</option>
              </select>
            </div>

            {recPaymentType === 'paid' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Payment Method
                </label>
                <select
                  value={recPaymentMethod}
                  onChange={(e) =>
                    setRecPaymentMethod(e.target.value as 'cash' | 'bank' | 'wallet')
                  }
                  className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="cash">Cash</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="wallet">Mobile Wallet</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Beneficiary / Vendor Name
            </label>
            <Input
              type="text"
              placeholder="e.g. Landlord, Utility provider"
              value={recVendorName}
              onChange={(e) => setRecVendorName(e.target.value)}
              className="h-10"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              rows={2}
              placeholder="Optional notes or details..."
              value={recNotes}
              onChange={(e) => setRecNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAddRecurringModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={recSubmitting}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {recSubmitting ? 'Saving...' : 'Create Template'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* --------------------------------------------------------------------------- */}
      {/* MODAL: Generate Recurring Expenses (Preview & Execution) */}
      {/* --------------------------------------------------------------------------- */}
      <Modal
        open={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
        title="Generate Recurring Expenses"
        maxWidth="lg"
      >
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg">
            <div>
              <p className="text-xs text-slate-500">Target Billing Period (YYYY-MM)</p>
              <Input
                type="month"
                value={genPeriod}
                onChange={(e) => {
                  setGenPeriod(e.target.value);
                  handlePreviewRecurring(e.target.value);
                }}
                className="h-9 w-44 mt-1 bg-white font-mono text-xs"
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePreviewRecurring(genPeriod)}
              disabled={genLoading}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${genLoading ? 'animate-spin' : ''}`} />
              Recalculate Preview
            </Button>
          </div>

          {genResultMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-md">
              {genResultMsg}
            </div>
          )}

          {/* Preview Overview */}
          {genLoading ? (
            <div className="py-8 text-center text-xs text-slate-500">
              <RefreshCw className="w-5 h-5 mx-auto animate-spin mb-1.5" />
              Checking eligible templates and existing records...
            </div>
          ) : genPreview ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded">
                  <p className="text-[11px] text-indigo-600 font-medium">Eligible To Generate</p>
                  <p className="text-xl font-bold text-slate-900 mt-0.5">
                    {genPreview.pendingCount}
                  </p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                  <p className="text-[11px] text-slate-500 font-medium">
                    Already Generated for {genPeriod}
                  </p>
                  <p className="text-xl font-bold text-slate-700 mt-0.5">
                    {genPreview.alreadyGeneratedCount}
                  </p>
                </div>
              </div>

              {genPreview.templates.length > 0 ? (
                <div className="border border-slate-200 rounded overflow-hidden max-h-56 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 text-[11px]">
                        <TableHead>Template Title</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Settlement</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {genPreview.templates.map((t) => (
                        <TableRow key={t.id} className="text-xs">
                          <TableCell className="font-medium">{t.title}</TableCell>
                          <TableCell>{t.categoryName}</TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatPaisa(t.amountPaisa)}
                          </TableCell>
                          <TableCell className="capitalize text-[11px] text-slate-500">
                            {t.paymentType}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded">
                  All active templates have already been generated for {genPeriod}. Idempotency
                  ensures no duplicates are created.
                </div>
              )}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" onClick={() => setIsGenerateModalOpen(false)}>
              Close
            </Button>
            <Button
              onClick={handleRunGeneration}
              disabled={genSubmitting || !genPreview || genPreview.pendingCount === 0}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <Sparkles className="w-4 h-4 mr-1.5" />
              {genSubmitting
                ? 'Generating...'
                : `Generate ${genPreview?.pendingCount || 0} Expenses`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* --------------------------------------------------------------------------- */}
      {/* MODAL: New Category */}
      {/* --------------------------------------------------------------------------- */}
      <Modal
        open={isAddCategoryModalOpen}
        onClose={() => setIsAddCategoryModalOpen(false)}
        title="Add Expense Category"
        maxWidth="md"
      >
        <form onSubmit={handleCreateCategory} className="space-y-4">
          {catFormError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-md">
              {catFormError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Category Name *</label>
            <Input
              type="text"
              placeholder="e.g. Legal & Professional Fees"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              required
              className="h-10"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Description (Optional)
            </label>
            <Input
              type="text"
              placeholder="Brief details about what falls into this category"
              value={catDescription}
              onChange={(e) => setCatDescription(e.target.value)}
              className="h-10"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAddCategoryModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={catSubmitting}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {catSubmitting ? 'Saving...' : 'Create Category'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
