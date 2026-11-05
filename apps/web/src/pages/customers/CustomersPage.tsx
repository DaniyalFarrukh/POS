import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  CustomerRecord,
  CustomerLedgerLine,
  CustomerInvoiceSummary,
  CustomerStatementData,
} from '../../types';
import { apiFetch } from '../../lib/api';
import { formatPaisa } from '../../lib/formatters';
import { formatPaisaToPkr, getCreditStatus, filterCustomers } from '../../lib/customer-utils';
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
  Users,
  Search,
  Plus,
  RefreshCw,
  AlertTriangle,
  Printer,
  X,
  TrendingUp,
  Clock,
  ArrowRight,
} from 'lucide-react';

export const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'all' | 'with_balance' | 'exceeded' | 'duplicates'>(
    'all'
  );

  // Selected customer for modal
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'ledger' | 'invoices' | 'statement'>('ledger');
  const [ledgerData, setLedgerData] = useState<{
    lines: CustomerLedgerLine[];
    openingBalancePaisa: number;
    closingBalancePaisa: number;
    totalDebitsPaisa: number;
    totalCreditsPaisa: number;
  } | null>(null);
  const [invoices, setInvoices] = useState<CustomerInvoiceSummary[]>([]);
  const [statementData, setStatementData] = useState<CustomerStatementData | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState<boolean>(false);

  // Create Customer Modal
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    creditLimitRupees: 0,
    openingBalanceRupees: 0,
    priceTier: 'retail',
  });
  const [createSubmitting, setCreateSubmitting] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchCustomers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ success: boolean; data: CustomerRecord[] }>('/api/customers');
      if (res.success && Array.isArray(res.data)) {
        setCustomers(res.data);
      } else {
        setCustomers([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch customers');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // Load customer detail when selected
  useEffect(() => {
    if (!selectedCustomerId) {
      setLedgerData(null);
      setInvoices([]);
      setStatementData(null);
      return;
    }

    const loadDetail = async () => {
      setIsDetailLoading(true);
      try {
        if (detailTab === 'ledger') {
          const res = await apiFetch<{
            success: boolean;
            data: {
              lines: CustomerLedgerLine[];
              openingBalancePaisa: number;
              closingBalancePaisa: number;
              totalDebitsPaisa: number;
              totalCreditsPaisa: number;
            };
          }>(`/api/customers/${selectedCustomerId}/ledger`);
          if (res.success) setLedgerData(res.data);
        } else if (detailTab === 'invoices') {
          const res = await apiFetch<{ success: boolean; data: CustomerInvoiceSummary[] }>(
            `/api/customers/${selectedCustomerId}/invoices`
          );
          if (res.success) setInvoices(res.data);
        } else if (detailTab === 'statement') {
          const res = await apiFetch<{ success: boolean; data: CustomerStatementData }>(
            `/api/customers/${selectedCustomerId}/statement`
          );
          if (res.success) setStatementData(res.data);
        }
      } catch (err) {
        console.error('Failed to load customer detail', err);
      } finally {
        setIsDetailLoading(false);
      }
    };

    loadDetail();
  }, [selectedCustomerId, detailTab]);

  const filtered = useMemo(() => {
    return filterCustomers(customers, searchTerm, activeTab);
  }, [customers, searchTerm, activeTab]);

  // KPIs
  const totalBalancePaisa = useMemo(() => {
    return customers.reduce((sum, c) => sum + (c.currentBalancePaisa ?? 0), 0);
  }, [customers]);

  const exceededCount = useMemo(() => {
    return customers.filter((c) => {
      const bal = c.currentBalancePaisa ?? 0;
      const limit = c.creditLimitPaisa ?? 0;
      return limit > 0 && bal > limit;
    }).length;
  }, [customers]);

  const duplicatesCount = useMemo(() => {
    return customers.filter((c) => Boolean(c.isDuplicate)).length;
  }, [customers]);

  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim()) {
      setCreateError('Name is required');
      return;
    }

    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const res = await apiFetch<{ success: boolean; data: CustomerRecord }>('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name.trim(),
          phone: createForm.phone.trim() || undefined,
          email: createForm.email.trim() || undefined,
          address: createForm.address.trim() || undefined,
          creditLimitPaisa: Math.round(Number(createForm.creditLimitRupees || 0) * 100),
          openingBalancePaisa: Math.round(Number(createForm.openingBalanceRupees || 0) * 100),
          priceTier: createForm.priceTier || undefined,
          isActive: true,
        }),
      });

      if (res.success) {
        setShowCreateModal(false);
        setCreateForm({
          name: '',
          phone: '',
          email: '',
          address: '',
          creditLimitRupees: 0,
          openingBalanceRupees: 0,
          priceTier: 'retail',
        });
        fetchCustomers();
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create customer');
    } finally {
      setCreateSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500">
            Manage customer master data, credit limits, counter sync, running ledgers and statements
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchCustomers}
            disabled={isLoading}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="h-4 w-4" />
            New Customer
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white shadow-sm border border-gray-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total Customers
              </p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{customers.length}</h3>
              <p className="text-xs text-gray-400 mt-0.5">Synced across all counters</p>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
              <Users className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-sm border border-gray-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total AR Balance
              </p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">
                {formatPaisaToPkr(totalBalancePaisa)}
              </h3>
              <p className="text-xs text-emerald-600 font-medium mt-0.5">
                Live from General Ledger
              </p>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
              <TrendingUp className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-sm border border-gray-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Exceeded Credit Limits
              </p>
              <h3
                className={`text-2xl font-bold mt-1 ${exceededCount > 0 ? 'text-red-600' : 'text-gray-900'}`}
              >
                {exceededCount}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Offline sales exceeding limit</p>
            </div>
            <div className="p-3 bg-red-50 text-red-600 rounded-lg">
              <AlertTriangle className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-sm border border-gray-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Duplicate Flags
              </p>
              <h3
                className={`text-2xl font-bold mt-1 ${duplicatesCount > 0 ? 'text-amber-600' : 'text-gray-900'}`}
              >
                {duplicatesCount}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Matched by normalized phone</p>
            </div>
            <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
              <Clock className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main List & Filter */}
      <Card className="bg-white shadow-sm border border-gray-200">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-4">
            {/* Filter Tabs */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
              <button
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === 'all'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                onClick={() => setActiveTab('all')}
              >
                All ({customers.length})
              </button>
              <button
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === 'with_balance'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                onClick={() => setActiveTab('with_balance')}
              >
                With Balance
              </button>
              <button
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === 'exceeded'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                onClick={() => setActiveTab('exceeded')}
              >
                Exceeded ({exceededCount})
              </button>
              <button
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === 'duplicates'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                onClick={() => setActiveTab('duplicates')}
              >
                Duplicates ({duplicatesCount})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search name, phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 text-xs"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
              {error}
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 text-gray-600 text-xs">
                  <TableHead>Customer Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Price Tier</TableHead>
                  <TableHead className="text-right">Credit Limit</TableHead>
                  <TableHead className="text-right">Current Balance</TableHead>
                  <TableHead className="text-center">Credit Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-gray-400 text-sm">
                      Loading customer records...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-gray-400 text-sm">
                      No customers found matching criteria
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((customer) => {
                    const balance = customer.currentBalancePaisa ?? 0;
                    const limit = customer.creditLimitPaisa ?? 0;
                    const creditStatus = getCreditStatus(balance, limit);

                    return (
                      <TableRow
                        key={customer.id}
                        className="text-sm hover:bg-gray-50/75 transition-colors"
                      >
                        <TableCell>
                          <div className="font-medium text-gray-900 flex items-center gap-1.5">
                            {customer.name}
                            {customer.isDuplicate && (
                              <Badge className="bg-amber-100 text-amber-800 text-[10px] font-normal px-1.5 py-0.2">
                                Duplicate
                              </Badge>
                            )}
                          </div>
                          {customer.address && (
                            <div className="text-xs text-gray-400 line-clamp-1">
                              {customer.address}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-gray-600">
                          {customer.phone || '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs uppercase font-normal">
                            {customer.priceTier || 'retail'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium text-gray-700">
                          {formatPaisaToPkr(limit)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-gray-900">
                          {formatPaisaToPkr(balance)}
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${creditStatus.color}`}
                          >
                            {creditStatus.badgeText}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedCustomerId(customer.id);
                              setDetailTab('ledger');
                            }}
                            className="text-blue-600 hover:text-blue-800 text-xs flex items-center gap-1 ml-auto"
                          >
                            Ledger & Statement
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Customer Detail Drawer / Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end transition-opacity">
          <div className="w-full max-w-3xl bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-gray-200 flex justify-between items-start bg-gray-50">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-gray-900">{selectedCustomer.name}</h2>
                  {selectedCustomer.isDuplicate && (
                    <Badge className="bg-amber-100 text-amber-800 text-xs">Duplicate Account</Badge>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1 flex items-center gap-3">
                  <span>Phone: {selectedCustomer.phone || 'N/A'}</span>
                  <span>•</span>
                  <span>Price Tier: {selectedCustomer.priceTier || 'retail'}</span>
                  {selectedCustomer.address && (
                    <>
                      <span>•</span>
                      <span>{selectedCustomer.address}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedCustomerId(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Credit Status Summary Bar */}
            <div className="p-4 bg-white border-b border-gray-100 grid grid-cols-3 gap-4 text-center">
              <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                <span className="text-[11px] text-gray-500 uppercase font-medium">
                  Credit Limit
                </span>
                <p className="text-base font-bold text-gray-900 mt-0.5">
                  {formatPaisaToPkr(selectedCustomer.creditLimitPaisa)}
                </p>
              </div>
              <div className="bg-blue-50 p-2.5 rounded-lg border border-blue-200">
                <span className="text-[11px] text-blue-700 uppercase font-medium">
                  Current Balance
                </span>
                <p className="text-base font-bold text-blue-900 mt-0.5">
                  {formatPaisaToPkr(selectedCustomer.currentBalancePaisa ?? 0)}
                </p>
              </div>
              <div className="bg-emerald-50 p-2.5 rounded-lg border border-emerald-200">
                <span className="text-[11px] text-emerald-700 uppercase font-medium">
                  Credit Available
                </span>
                <p className="text-base font-bold text-emerald-900 mt-0.5">
                  {formatPaisaToPkr(selectedCustomer.creditAvailablePaisa ?? 0)}
                </p>
              </div>
            </div>

            {/* Tab navigation in Drawer */}
            <div className="flex border-b border-gray-200 bg-gray-50 px-4 pt-2">
              <button
                onClick={() => setDetailTab('ledger')}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                  detailTab === 'ledger'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Running Ledger
              </button>
              <button
                onClick={() => setDetailTab('invoices')}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                  detailTab === 'invoices'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Sales Invoices
              </button>
              <button
                onClick={() => setDetailTab('statement')}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                  detailTab === 'statement'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Customer Statement (PDF / Print)
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {isDetailLoading ? (
                <div className="text-center py-12 text-gray-400 text-sm">Loading details...</div>
              ) : detailTab === 'ledger' && ledgerData ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center text-xs bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <div>
                      <span className="text-gray-500">Opening Balance: </span>
                      <span className="font-bold text-gray-800">
                        {formatPaisaToPkr(ledgerData.openingBalancePaisa)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Closing Balance: </span>
                      <span className="font-bold text-blue-800">
                        {formatPaisaToPkr(ledgerData.closingBalancePaisa)}
                      </span>
                    </div>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs bg-gray-50">
                        <TableHead>Date</TableHead>
                        <TableHead>Entry #</TableHead>
                        <TableHead>Memo / Source</TableHead>
                        <TableHead className="text-right">Debit (Rs)</TableHead>
                        <TableHead className="text-right">Credit (Rs)</TableHead>
                        <TableHead className="text-right">Balance (Rs)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerData.lines.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-6 text-gray-400 text-xs">
                            No ledger transactions recorded for this customer yet
                          </TableCell>
                        </TableRow>
                      ) : (
                        ledgerData.lines.map((l) => (
                          <TableRow key={l.id} className="text-xs hover:bg-gray-50">
                            <TableCell className="font-mono">{l.entryDate}</TableCell>
                            <TableCell className="font-mono">#{l.entryNo}</TableCell>
                            <TableCell>{l.memo}</TableCell>
                            <TableCell className="text-right font-medium text-gray-900">
                              {l.debitPaisa > 0 ? formatPaisa(l.debitPaisa) : '—'}
                            </TableCell>
                            <TableCell className="text-right font-medium text-emerald-700">
                              {l.creditPaisa > 0 ? formatPaisa(l.creditPaisa) : '—'}
                            </TableCell>
                            <TableCell className="text-right font-bold text-blue-900">
                              {formatPaisa(l.runningBalancePaisa)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : detailTab === 'invoices' ? (
                <div className="space-y-4">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs bg-gray-50">
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Total (Rs)</TableHead>
                        <TableHead className="text-center">Limit Exceeded</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-6 text-gray-400 text-xs">
                            No invoices attached to this customer
                          </TableCell>
                        </TableRow>
                      ) : (
                        invoices.map((inv) => (
                          <TableRow key={inv.id} className="text-xs hover:bg-gray-50">
                            <TableCell className="font-mono font-medium text-gray-900">
                              {inv.invoiceNumber}
                            </TableCell>
                            <TableCell className="text-gray-500 font-mono">
                              {inv.createdAt.slice(0, 10)}
                            </TableCell>
                            <TableCell className="text-right font-bold text-gray-900">
                              {formatPaisaToPkr(inv.totalPaisa)}
                            </TableCell>
                            <TableCell className="text-center">
                              {inv.creditLimitExceeded ? (
                                <Badge className="bg-red-100 text-red-800 text-[10px] font-normal">
                                  Exceeded (Reviewed)
                                </Badge>
                              ) : (
                                <Badge className="bg-emerald-100 text-emerald-800 text-[10px] font-normal">
                                  Within Limit
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : detailTab === 'statement' && statementData ? (
                <div className="space-y-4">
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.print()}
                      className="flex items-center gap-1.5 text-xs print:hidden"
                    >
                      <Printer className="h-4 w-4" />
                      Print Statement
                    </Button>
                  </div>

                  {/* Printable Statement Container */}
                  <div className="p-6 bg-white border border-gray-200 rounded-xl space-y-6 text-xs text-gray-800 print:border-none print:p-0">
                    {/* Header */}
                    <div className="flex justify-between items-start border-b border-gray-200 pb-4">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">
                          {statementData.pharmacy?.name || 'Central Pharmacy'}
                        </h3>
                        <p className="text-gray-500 text-[11px]">Customer Account Statement</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[11px] text-gray-400">Statement Period</span>
                        <p className="font-medium text-gray-700">
                          {statementData.period.startDate} to {statementData.period.endDate}
                        </p>
                      </div>
                    </div>

                    {/* Customer Info */}
                    <div className="grid grid-cols-2 gap-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                      <div>
                        <span className="text-[10px] text-gray-400 uppercase font-semibold">
                          Billed To
                        </span>
                        <p className="font-bold text-gray-900 mt-0.5">
                          {statementData.customer.name}
                        </p>
                        <p className="text-gray-600">
                          {statementData.customer.phone || 'Phone: N/A'}
                        </p>
                        <p className="text-gray-500">{statementData.customer.address || ''}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-gray-400 uppercase font-semibold">
                          Account Status
                        </span>
                        <p className="font-bold text-blue-900 mt-0.5">
                          Closing Balance: {formatPaisaToPkr(statementData.closingBalancePaisa)}
                        </p>
                        <p className="text-gray-500">
                          Credit Limit: {formatPaisaToPkr(statementData.customer.creditLimitPaisa)}
                        </p>
                      </div>
                    </div>

                    {/* Statement Table */}
                    <Table>
                      <TableHeader>
                        <TableRow className="text-[11px] bg-gray-100">
                          <TableHead>Date</TableHead>
                          <TableHead>Ref / Type</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Debits (Rs)</TableHead>
                          <TableHead className="text-right">Credits (Rs)</TableHead>
                          <TableHead className="text-right">Balance (Rs)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow className="bg-gray-50/50 font-medium text-gray-700">
                          <TableCell colSpan={5}>Opening Balance</TableCell>
                          <TableCell className="text-right font-bold text-blue-900">
                            {formatPaisaToPkr(statementData.openingBalancePaisa)}
                          </TableCell>
                        </TableRow>
                        {statementData.transactions.map((tx) => (
                          <TableRow key={tx.id} className="text-xs">
                            <TableCell className="font-mono">{tx.date}</TableCell>
                            <TableCell className="font-mono uppercase text-gray-600">
                              {tx.reference}
                            </TableCell>
                            <TableCell>{tx.description}</TableCell>
                            <TableCell className="text-right font-medium text-gray-900">
                              {tx.debitPaisa > 0 ? formatPaisa(tx.debitPaisa) : '—'}
                            </TableCell>
                            <TableCell className="text-right font-medium text-emerald-700">
                              {tx.creditPaisa > 0 ? formatPaisa(tx.creditPaisa) : '—'}
                            </TableCell>
                            <TableCell className="text-right font-bold text-blue-900">
                              {formatPaisa(tx.balancePaisa)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-blue-50/50 font-bold text-gray-900 border-t-2 border-gray-300">
                          <TableCell colSpan={3}>Closing Statement Balance</TableCell>
                          <TableCell className="text-right text-gray-900">
                            {formatPaisa(statementData.totalDebitsPaisa)}
                          </TableCell>
                          <TableCell className="text-right text-emerald-700">
                            {formatPaisa(statementData.totalCreditsPaisa)}
                          </TableCell>
                          <TableCell className="text-right text-blue-900">
                            {formatPaisaToPkr(statementData.closingBalancePaisa)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Create Customer Slide-over Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h3 className="text-base font-bold text-gray-900">Create New Customer</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="p-4 space-y-4">
              {createError && (
                <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded border border-red-200">
                  {createError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Customer Name <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  required
                  placeholder="e.g. Muhammad Bilal"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Phone (03XXXXXXXXX)
                  </label>
                  <Input
                    type="text"
                    placeholder="03001234567"
                    value={createForm.phone}
                    onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Price Tier</label>
                  <select
                    value={createForm.priceTier}
                    onChange={(e) => setCreateForm({ ...createForm, priceTier: e.target.value })}
                    className="w-full text-sm border border-gray-300 rounded-md p-2"
                  >
                    <option value="retail">Retail</option>
                    <option value="wholesale">Wholesale</option>
                    <option value="corporate">Corporate</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Credit Limit (PKR)
                  </label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={createForm.creditLimitRupees}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        creditLimitRupees: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Opening Balance (PKR)
                  </label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={createForm.openingBalanceRupees}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        openingBalanceRupees: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <Input
                  type="email"
                  placeholder="customer@example.com"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
                <Input
                  type="text"
                  placeholder="Street address, city"
                  value={createForm.address}
                  onChange={(e) => setCreateForm({ ...createForm, address: e.target.value })}
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-gray-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={createSubmitting}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {createSubmitting ? 'Saving...' : 'Create Customer'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
