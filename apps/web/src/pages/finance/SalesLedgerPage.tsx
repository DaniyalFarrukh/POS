import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { SalesLedgerRecord, SalesLedgerSummary, BranchRecord } from '../../types';
import { apiFetch } from '../../lib/api';
import { formatPaisa, formatKarachiDateTime } from '../../lib/formatters';
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
  Input,
} from '@pos/ui';
import {
  ReceiptText,
  RotateCcw,
  CreditCard,
  TrendingUp,
  Download,
  Printer,
  RefreshCw,
  Search,
  X,
  FileSpreadsheet,
  DollarSign,
} from 'lucide-react';

export const SalesLedgerPage: React.FC = () => {
  // Data states
  const [entries, setEntries] = useState<SalesLedgerRecord[]>([]);
  const [summary, setSummary] = useState<SalesLedgerSummary | null>(null);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'sale' | 'return' | 'receipt'>('all');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [cashierSearch, setCashierSearch] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Selected entry for detail modal
  const [selectedEntry, setSelectedEntry] = useState<SalesLedgerRecord | null>(null);

  // Fetch branches
  useEffect(() => {
    apiFetch<{ items?: BranchRecord[]; data?: BranchRecord[] }>('/api/admin/branches')
      .then((res) => {
        setBranches(res.items || res.data || []);
      })
      .catch(() => {
        // Non-admin may not have access to branches endpoint
      });
  }, []);

  // Fetch sales ledger entries
  const fetchSalesLedger = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (selectedBranchId) params.set('branchId', selectedBranchId);

      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await apiFetch<{
        success: boolean;
        data: {
          summary: SalesLedgerSummary;
          entries: SalesLedgerRecord[];
        };
      }>(`/api/finance/sales-ledger${qs}`);

      if (res.success && res.data) {
        setSummary(res.data.summary);
        setEntries(res.data.entries || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sales ledger data');
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, typeFilter, selectedBranchId]);

  useEffect(() => {
    fetchSalesLedger();
  }, [fetchSalesLedger]);

  // Client-side filtering for fast interactive search
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      // Global search term (Doc number, notes)
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesDoc = entry.documentNumber.toLowerCase().includes(term);
        const matchesNotes = entry.notes ? entry.notes.toLowerCase().includes(term) : false;
        if (!matchesDoc && !matchesNotes) return false;
      }

      // Customer search
      if (customerSearch) {
        const custTerm = customerSearch.toLowerCase();
        const matchesName = entry.partyName
          ? entry.partyName.toLowerCase().includes(custTerm)
          : false;
        const matchesPhone = entry.partyPhone
          ? entry.partyPhone.toLowerCase().includes(custTerm)
          : false;
        if (!matchesName && !matchesPhone) return false;
      }

      // Cashier search
      if (cashierSearch) {
        const cashierTerm = cashierSearch.toLowerCase();
        const matchesCashier = entry.cashierName
          ? entry.cashierName.toLowerCase().includes(cashierTerm)
          : false;
        if (!matchesCashier) return false;
      }

      return true;
    });
  }, [entries, searchTerm, customerSearch, cashierSearch]);

  const resetFilters = () => {
    setStartDate('');
    setEndDate('');
    setTypeFilter('all');
    setSelectedBranchId('');
    setCashierSearch('');
    setCustomerSearch('');
    setSearchTerm('');
  };

  // CSV Export
  const handleExportCsv = () => {
    if (filteredEntries.length === 0) return;

    const headers = [
      'Date & Time (Karachi)',
      'Document #',
      'Type',
      'Party / Customer',
      'Phone',
      'Branch',
      'Counter',
      'Cashier',
      'Payment Method',
      'Gross Paisa',
      'Discount Paisa',
      'Tax Paisa',
      'Net Paisa',
      'Running Balance Paisa',
      'Gross (PKR)',
      'Net (PKR)',
      'Running Balance (PKR)',
      'Notes',
    ];

    const rows = filteredEntries.map((row) => [
      formatKarachiDateTime(row.date),
      row.documentNumber,
      row.type.toUpperCase(),
      row.partyName || 'Walk-in Customer',
      row.partyPhone || '',
      row.branchName || '',
      row.counterName || '',
      row.cashierName || '',
      row.paymentMethod || 'cash',
      row.grossPaisa,
      row.discountPaisa,
      row.taxPaisa,
      row.netPaisa,
      row.runningNetPaisa,
      (row.grossPaisa / 100).toFixed(2),
      (row.netPaisa / 100).toFixed(2),
      (row.runningNetPaisa / 100).toFixed(2),
      (row.notes || '').replace(/"/g, '""'),
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.map((val) => `"${val}"`).join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `sales_ledger_${getKarachiBusinessDate()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Print view
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 print:p-0">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <ReceiptText className="w-6 h-6 text-emerald-600" />
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Sales Ledger</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Running chronological ledger of retail sales invoices, customer returns, and credit
            receipts.
          </p>
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={filteredEntries.length === 0}
            className="text-xs gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            disabled={filteredEntries.length === 0}
            className="text-xs gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchSalesLedger}
            disabled={isLoading}
            className="text-xs gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-emerald-500 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Gross Sales
                </p>
                <p className="text-xl font-bold text-emerald-700 mt-1">
                  {summary ? formatPaisa(summary.totalGrossSalesPaisa) : '—'}
                </p>
              </div>
              <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">All finalized retail sales invoices</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-rose-500 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Returns / Refunds
                </p>
                <p className="text-xl font-bold text-rose-700 mt-1">
                  {summary ? formatPaisa(summary.totalReturnsPaisa) : '—'}
                </p>
              </div>
              <div className="p-2.5 bg-rose-50 text-rose-600 rounded-lg">
                <RotateCcw className="w-5 h-5" />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Customer returns &amp; credit notes</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Customer Receipts
                </p>
                <p className="text-xl font-bold text-blue-700 mt-1">
                  {summary ? formatPaisa(summary.totalReceiptsPaisa) : '—'}
                </p>
              </div>
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
                <CreditCard className="w-5 h-5" />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Recoveries on credit receivables</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-indigo-500 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Net Sales
                </p>
                <p className="text-xl font-bold text-indigo-700 mt-1">
                  {summary ? formatPaisa(summary.netSalesPaisa) : '—'}
                </p>
              </div>
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg">
                <DollarSign className="w-5 h-5" />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              Gross Sales minus Returns ({summary ? summary.totalCount : 0} records)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Toolbar */}
      <Card className="shadow-sm border-slate-200 print:hidden">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Document Type Selector */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setTypeFilter('all')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  typeFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Documents
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('sale')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  typeFilter === 'sale'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sales Invoices
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('return')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  typeFilter === 'return'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Returns
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('receipt')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  typeFilter === 'receipt'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Customer Receipts
              </button>
            </div>

            {/* Clear filters */}
            {(startDate ||
              endDate ||
              typeFilter !== 'all' ||
              selectedBranchId ||
              cashierSearch ||
              customerSearch ||
              searchTerm) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 gap-1"
              >
                <X className="w-3.5 h-3.5" />
                Reset Filters
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 pt-2 border-t border-slate-100">
            {/* Start Date */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                Start Date
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            {/* End Date */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">End Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            {/* Branch */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Branch</label>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="w-full h-8 text-xs px-2.5 rounded-md border border-slate-300 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Customer Search */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                Customer / Phone
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <Input
                  type="text"
                  placeholder="Filter customer..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="h-8 text-xs pl-8"
                />
              </div>
            </div>

            {/* Document # or Notes Search */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">
                Doc # / Search
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <Input
                  type="text"
                  placeholder="Search document #..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-8 text-xs pl-8"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs flex items-center justify-between">
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchSalesLedger}
            className="text-xs text-rose-800"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Data Table */}
      <Card className="shadow-sm border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="text-xs font-semibold text-slate-700">
                  Date &amp; Time (PKT)
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Document #</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Type</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">
                  Party / Customer
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">
                  Branch &amp; Counter
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Cashier</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Method</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 text-right">
                  Gross
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 text-right">
                  Discount
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 text-right">
                  Tax
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 text-right">
                  Net Amount
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 text-right">
                  Running Total
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-12 text-slate-400 text-xs">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-400" />
                    Loading sales ledger entries...
                  </TableCell>
                </TableRow>
              ) : filteredEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-12 text-slate-400 text-xs">
                    <ReceiptText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    No sales, returns, or customer receipts found matching the selected criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredEntries.map((row) => {
                  const isReturn = row.type === 'return';
                  const isReceipt = row.type === 'receipt';
                  const isSale = row.type === 'sale';

                  return (
                    <TableRow
                      key={row.id}
                      className="hover:bg-slate-50/80 cursor-pointer text-xs"
                      onClick={() => setSelectedEntry(row)}
                    >
                      <TableCell className="font-mono text-slate-600 whitespace-nowrap">
                        {formatKarachiDateTime(row.date)}
                      </TableCell>

                      <TableCell className="font-mono font-medium text-slate-900">
                        {row.documentNumber}
                      </TableCell>

                      <TableCell>
                        {isSale && (
                          <Badge
                            variant="outline"
                            className="border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold text-[10px]"
                          >
                            Sale
                          </Badge>
                        )}
                        {isReturn && (
                          <Badge
                            variant="outline"
                            className="border-rose-300 bg-rose-50 text-rose-700 font-semibold text-[10px]"
                          >
                            Return
                          </Badge>
                        )}
                        {isReceipt && (
                          <Badge
                            variant="outline"
                            className="border-blue-300 bg-blue-50 text-blue-700 font-semibold text-[10px]"
                          >
                            Receipt
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="font-medium text-slate-900">
                          {row.partyName || 'Walk-in Customer'}
                        </div>
                        {row.partyPhone && (
                          <div className="text-[11px] text-slate-400">{row.partyPhone}</div>
                        )}
                      </TableCell>

                      <TableCell className="text-slate-600">
                        <div>{row.branchName || '—'}</div>
                        {row.counterName && (
                          <div className="text-[11px] text-slate-400">{row.counterName}</div>
                        )}
                      </TableCell>

                      <TableCell className="text-slate-600">{row.cashierName || '—'}</TableCell>

                      <TableCell className="capitalize text-slate-600">
                        <span className="inline-block px-2 py-0.5 rounded text-[11px] bg-slate-100 font-medium">
                          {row.paymentMethod || 'cash'}
                        </span>
                      </TableCell>

                      <TableCell className="text-right font-mono text-slate-700">
                        {row.grossPaisa !== 0 ? formatPaisa(row.grossPaisa) : '—'}
                      </TableCell>

                      <TableCell className="text-right font-mono text-slate-500">
                        {row.discountPaisa !== 0 ? formatPaisa(row.discountPaisa) : '—'}
                      </TableCell>

                      <TableCell className="text-right font-mono text-slate-500">
                        {row.taxPaisa !== 0 ? formatPaisa(row.taxPaisa) : '—'}
                      </TableCell>

                      <TableCell
                        className={`text-right font-mono font-semibold ${
                          isReturn ? 'text-rose-600' : 'text-slate-900'
                        }`}
                      >
                        {isReturn
                          ? `-${formatPaisa(Math.abs(row.netPaisa))}`
                          : formatPaisa(row.netPaisa)}
                      </TableCell>

                      <TableCell className="text-right font-mono font-bold text-slate-900 bg-slate-50/50">
                        {formatPaisa(row.runningNetPaisa)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Footer info */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center text-xs text-slate-500 gap-2">
          <div>
            Showing <span className="font-semibold text-slate-800">{filteredEntries.length}</span>{' '}
            of <span className="font-semibold text-slate-800">{entries.length}</span> records
          </div>
          <div className="flex items-center gap-4">
            <span>
              Cumulative Net Sales:{' '}
              <span className="font-mono font-bold text-slate-900">
                {summary ? formatPaisa(summary.netSalesPaisa) : '—'}
              </span>
            </span>
          </div>
        </div>
      </Card>

      {/* Detail Modal */}
      {selectedEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-slate-900">Transaction Details</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedEntry(null)}
                className="text-slate-400 hover:text-slate-600 p-1 h-auto"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-lg">
                <div>
                  <span className="text-slate-400 block">Document Number</span>
                  <span className="font-mono font-bold text-slate-800">
                    {selectedEntry.documentNumber}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Type</span>
                  <span className="capitalize font-semibold text-slate-800">
                    {selectedEntry.type}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Date &amp; Time (Karachi)</span>
                  <span className="font-mono text-slate-800">
                    {formatKarachiDateTime(selectedEntry.date)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Payment Method</span>
                  <span className="capitalize font-medium text-slate-800">
                    {selectedEntry.paymentMethod || 'cash'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 p-2">
                <div>
                  <span className="text-slate-400 block">Customer / Party</span>
                  <span className="font-medium text-slate-800">
                    {selectedEntry.partyName || 'Walk-in Customer'}
                  </span>
                  {selectedEntry.partyPhone && (
                    <span className="text-slate-500 block text-[11px]">
                      {selectedEntry.partyPhone}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-slate-400 block">Branch &amp; Counter</span>
                  <span className="font-medium text-slate-800">
                    {selectedEntry.branchName || '—'}
                  </span>
                  {selectedEntry.counterName && (
                    <span className="text-slate-500 block text-[11px]">
                      {selectedEntry.counterName}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-slate-400 block">Cashier</span>
                  <span className="font-medium text-slate-800">
                    {selectedEntry.cashierName || '—'}
                  </span>
                </div>
              </div>

              {/* Amount Breakdown */}
              <div className="border-t border-slate-100 pt-3 space-y-1.5 font-mono">
                <div className="flex justify-between text-slate-600">
                  <span>Gross Amount:</span>
                  <span>{formatPaisa(selectedEntry.grossPaisa)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Discount:</span>
                  <span>-{formatPaisa(selectedEntry.discountPaisa)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tax:</span>
                  <span>+{formatPaisa(selectedEntry.taxPaisa)}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1.5 text-sm">
                  <span>Net Amount:</span>
                  <span
                    className={selectedEntry.type === 'return' ? 'text-rose-600' : 'text-slate-900'}
                  >
                    {selectedEntry.type === 'return'
                      ? `-${formatPaisa(Math.abs(selectedEntry.netPaisa))}`
                      : formatPaisa(selectedEntry.netPaisa)}
                  </span>
                </div>
                <div className="flex justify-between font-semibold text-slate-700 pt-1">
                  <span>Running Balance at Transaction:</span>
                  <span>{formatPaisa(selectedEntry.runningNetPaisa)}</span>
                </div>
              </div>

              {selectedEntry.notes && (
                <div className="bg-slate-50 p-2.5 rounded text-slate-600 text-[11px]">
                  <span className="font-semibold text-slate-700 block">Notes:</span>
                  {selectedEntry.notes}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <Button size="sm" onClick={() => setSelectedEntry(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
