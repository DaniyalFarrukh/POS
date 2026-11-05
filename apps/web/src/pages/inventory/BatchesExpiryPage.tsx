import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { formatPaisa } from '../../lib/formatters';
import {
  getExpiryStatusDetails,
  validateWriteOffInput,
  validateDiscountInput,
} from '../../lib/stock-utils';
import type {
  ExpiringBatchRecord,
  ExpiringBatchesSummary,
  BranchRecord,
  StockLocationRecord,
} from '../../types';
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
  Modal,
  Input,
} from '@pos/ui';
import {
  CalendarClock,
  AlertOctagon,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface ExpiringBatchesApiResponse {
  items: ExpiringBatchRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: ExpiringBatchesSummary;
}

export const BatchesExpiryPage: React.FC = () => {
  const [items, setItems] = useState<ExpiringBatchRecord[]>([]);
  const [summary, setSummary] = useState<ExpiringBatchesSummary>({
    expired: 0,
    expiring30: 0,
    expiring60: 0,
    expiring90: 0,
    totalExpiringCount: 0,
    totalExpiringValuePaisa: 0,
  });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [windowFilter, setWindowFilter] = useState<'all' | 'expired' | '30' | '60' | '90'>('all');
  const [branchId, setBranchId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [locations, setLocations] = useState<StockLocationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Discount Modal State
  const [discountModalBatch, setDiscountModalBatch] = useState<ExpiringBatchRecord | null>(null);
  const [newMrpRupees, setNewMrpRupees] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discounting, setDiscounting] = useState(false);
  const [discountError, setDiscountError] = useState<string | null>(null);

  // Write-off Modal State
  const [writeOffModalBatch, setWriteOffModalBatch] = useState<ExpiringBatchRecord | null>(null);
  const [writeOffQty, setWriteOffQty] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('Expired batch disposal');
  const [writingOff, setWritingOff] = useState(false);
  const [writeOffError, setWriteOffError] = useState<string | null>(null);

  // Load branches & locations
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [branchRes, locRes] = await Promise.all([
          apiFetch<{ data: BranchRecord[] }>('/api/admin/branches').catch(() => ({ data: [] })),
          apiFetch<{ data: StockLocationRecord[] }>('/api/stock-locations').catch(() => ({
            data: [],
          })),
        ]);
        if (branchRes.data) setBranches(branchRes.data);
        if (locRes.data) setLocations(locRes.data);
      } catch {
        // Soft fallback
      }
    };
    fetchMetadata();
  }, []);

  const loadBatches = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('window', windowFilter);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (branchId) params.set('branchId', branchId);
      if (locationId) params.set('locationId', locationId);
      if (searchTerm.trim()) params.set('search', searchTerm.trim());

      const res = await apiFetch<{ data: ExpiringBatchesApiResponse }>(
        `/api/inventory/batches/expiring?${params.toString()}`
      );

      if (res.data) {
        setItems(res.data.items);
        setSummary(res.data.summary);
        setTotal(res.data.pagination.total);
        setTotalPages(res.data.pagination.totalPages);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load expiring batches';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBatches();
  }, [windowFilter, branchId, locationId, page]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadBatches();
  };

  // Execute Discount
  const handleApplyDiscount = async () => {
    if (!discountModalBatch) return;
    const mrpPaisa = Math.round(parseFloat(newMrpRupees || '0') * 100);
    const valid = validateDiscountInput(mrpPaisa);
    if (!valid.isValid) {
      setDiscountError(valid.error || 'Invalid price');
      return;
    }

    setDiscounting(true);
    setDiscountError(null);
    try {
      await apiFetch(`/api/inventory/batches/${discountModalBatch.batchId}/discount`, {
        method: 'POST',
        body: JSON.stringify({
          mrpPaisa,
          reason: discountReason.trim() || undefined,
        }),
      });
      setDiscountModalBatch(null);
      await loadBatches();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to discount batch';
      setDiscountError(msg);
    } finally {
      setDiscounting(false);
    }
  };

  // Execute Write-Off
  const handleExecuteWriteOff = async () => {
    if (!writeOffModalBatch) return;
    const qty = parseInt(writeOffQty, 10);
    const valid = validateWriteOffInput(qty, writeOffModalBatch.onHandQuantity, writeOffReason);
    if (!valid.isValid) {
      setWriteOffError(valid.error || 'Invalid write-off quantity');
      return;
    }

    setWritingOff(true);
    setWriteOffError(null);
    try {
      await apiFetch(`/api/inventory/batches/${writeOffModalBatch.batchId}/write-off`, {
        method: 'POST',
        body: JSON.stringify({
          branchId: writeOffModalBatch.branchId,
          locationId: writeOffModalBatch.locationId || undefined,
          quantity: qty,
          reason: writeOffReason.trim(),
        }),
      });
      setWriteOffModalBatch(null);
      await loadBatches();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to write off batch';
      setWriteOffError(msg);
    } finally {
      setWritingOff(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <CalendarClock className="w-6 h-6 text-amber-600" /> Batches & Expiry Management
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Track expiring inventory in 30, 60, and 90-day windows. Markdown prices, return to
            suppliers, or write off with ledger posting.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={loadBatches} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className={summary.expired > 0 ? 'border-rose-300 bg-rose-50/40' : ''}>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-rose-700 flex items-center gap-1">
              <AlertOctagon className="w-3.5 h-3.5" /> Expired Batches
            </div>
            <div className="text-2xl font-bold text-rose-700 mt-1">{summary.expired}</div>
            <div className="text-xs text-rose-600/80 mt-1">
              Requires immediate write-off or return
            </div>
          </CardContent>
        </Card>

        <Card className={summary.expiring30 > 0 ? 'border-amber-300 bg-amber-50/30' : ''}>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-amber-700">Expiring in ≤ 30 Days</div>
            <div className="text-2xl font-bold text-amber-800 mt-1">{summary.expiring30}</div>
            <div className="text-xs text-amber-600 mt-1">High urgency for markdown</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500">Expiring in 31–60 Days</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{summary.expiring60}</div>
            <div className="text-xs text-slate-400 mt-1">Monitor dispensing rate</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500">Expiring Value At Risk</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {formatPaisa(summary.totalExpiringValuePaisa)}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Across {summary.totalExpiringCount} active batches
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Time Window Tabs */}
      <div className="flex border-b border-slate-200 gap-2">
        {(
          [
            { id: 'all', label: `All Expiring (${summary.totalExpiringCount})` },
            { id: 'expired', label: `Expired (${summary.expired})` },
            { id: '30', label: `≤ 30 Days (${summary.expiring30})` },
            { id: '60', label: `31–60 Days (${summary.expiring60})` },
            { id: '90', label: `61–90 Days (${summary.expiring90})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setWindowFilter(tab.id);
              setPage(1);
            }}
            className={`pb-2.5 px-3 text-xs font-medium transition-colors border-b-2 -mb-px ${
              windowFilter === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters Bar */}
      <Card>
        <CardContent className="p-4">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col sm:flex-row items-center justify-between gap-4"
          >
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              {/* Branch filter */}
              <select
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setLocationId('');
                  setPage(1);
                }}
                className="text-xs border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-700"
              >
                <option value="">All Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>

              {/* Location filter */}
              <select
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setPage(1);
                }}
                className="text-xs border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-700"
              >
                <option value="">All Locations</option>
                {locations
                  .filter((l) => !branchId || l.branchId === branchId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </div>

            {/* Search Input */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search batch # or product..."
                  className="pl-8 text-xs py-1 h-8"
                />
              </div>
              <Button type="submit" size="sm" variant="secondary" className="h-8 text-xs">
                Search
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Error display */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
          {error}
        </div>
      )}

      {/* Batches Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch #</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Branch & Location</TableHead>
                <TableHead>Expiry Status</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Retail (MRP)</TableHead>
                <TableHead className="text-right">On-Hand</TableHead>
                <TableHead className="text-right">Valuation</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-slate-500 text-xs">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                    Loading expiring batches...
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-slate-500 text-xs">
                    No expiring batches found in this category.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((b) => {
                  const expDetails = getExpiryStatusDetails(b.expiryDate, b.daysUntilExpiry);

                  return (
                    <TableRow key={`${b.batchId}-${b.branchId}-${b.locationId || 'default'}`}>
                      <TableCell className="font-mono text-xs font-semibold">{b.batchNo}</TableCell>
                      <TableCell>
                        <div className="font-medium text-xs text-slate-900">{b.productName}</div>
                        {b.genericName && (
                          <div className="text-[11px] text-slate-400">{b.genericName}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs text-slate-800">{b.branchName}</div>
                        {b.locationName && (
                          <div className="text-[11px] text-slate-400">{b.locationName}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${expDetails.colorClass}`}
                        >
                          {expDetails.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {formatPaisa(b.costPaisa)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold text-slate-900">
                        {formatPaisa(b.mrpPaisa)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-slate-900">
                        {b.onHandQuantity}
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold text-emerald-700">
                        {formatPaisa(b.stockValuePaisa)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Markdown / Discount button */}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            title="Markdown / Discount Batch"
                            onClick={() => {
                              setDiscountModalBatch(b);
                              setNewMrpRupees((b.mrpPaisa / 100).toFixed(2));
                              setDiscountReason('Near-expiry clearance');
                              setDiscountError(null);
                            }}
                          >
                            <Tag className="w-3 h-3 mr-1 text-blue-600" /> Discount
                          </Button>

                          {/* Write-off button */}
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 px-2 text-[11px]"
                            title="Write Off Batch with Ledger Posting"
                            onClick={() => {
                              setWriteOffModalBatch(b);
                              setWriteOffQty(String(b.onHandQuantity));
                              setWriteOffReason(
                                b.daysUntilExpiry < 0
                                  ? 'Expired stock write-off'
                                  : 'Damaged / unsellable stock write-off'
                              );
                              setWriteOffError(null);
                            }}
                          >
                            <Trash2 className="w-3 h-3 mr-1" /> Write Off
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {/* Pagination controls */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-xs text-slate-500">
            <div>
              Showing {items.length > 0 ? (page - 1) * pageSize + 1 : 0} to{' '}
              {Math.min(page * pageSize, total)} of {total} batches
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-7 text-xs"
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-0.5" /> Previous
              </Button>
              <span className="text-slate-600 font-medium">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="h-7 text-xs"
              >
                Next <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Discount Batch Modal */}
      {discountModalBatch && (
        <Modal
          open={true}
          onClose={() => setDiscountModalBatch(null)}
          title={`Markdown Batch: ${discountModalBatch.batchNo}`}
        >
          <div className="space-y-4 text-xs">
            <div className="bg-slate-50 p-3 rounded border border-slate-200">
              <div className="font-semibold text-slate-800">{discountModalBatch.productName}</div>
              <div className="text-slate-500 mt-1">
                Current MRP:{' '}
                <span className="font-bold">{formatPaisa(discountModalBatch.mrpPaisa)}</span> •
                Batch Cost:{' '}
                <span className="font-bold">{formatPaisa(discountModalBatch.costPaisa)}</span>
              </div>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">
                New Retail Price (MRP in Rs.)
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={newMrpRupees}
                onChange={(e) => setNewMrpRupees(e.target.value)}
                placeholder="e.g. 150.00"
                className="text-xs"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Discount Reason</label>
              <Input
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                placeholder="e.g. 20% near expiry clearance"
                className="text-xs"
              />
            </div>

            {discountError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded text-xs">
                {discountError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDiscountModalBatch(null)}
                disabled={discounting}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleApplyDiscount}
                disabled={discounting}
              >
                {discounting ? 'Applying...' : 'Apply Markdown'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Write-off Modal */}
      {writeOffModalBatch && (
        <Modal
          open={true}
          onClose={() => setWriteOffModalBatch(null)}
          title={`Write Off Batch: ${writeOffModalBatch.batchNo}`}
        >
          <div className="space-y-4 text-xs">
            <div className="bg-rose-50 p-3 rounded border border-rose-200 text-rose-800">
              <div className="font-semibold">{writeOffModalBatch.productName}</div>
              <div className="text-rose-700 mt-1">
                On-hand quantity:{' '}
                <span className="font-bold">{writeOffModalBatch.onHandQuantity} units</span>{' '}
                (Valuation:{' '}
                <span className="font-bold">{formatPaisa(writeOffModalBatch.stockValuePaisa)}</span>
                )
              </div>
              <div className="text-[11px] text-rose-600 mt-1">
                Notice: Writing off posts directly to General Ledger Account 5010 (Stock Adjustments
                & Write-offs) and reduces Inventory Account 1200.
              </div>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Quantity to Write Off</label>
              <Input
                type="number"
                min="1"
                max={writeOffModalBatch.onHandQuantity}
                value={writeOffQty}
                onChange={(e) => setWriteOffQty(e.target.value)}
                className="text-xs"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Write-Off Reason</label>
              <Input
                value={writeOffReason}
                onChange={(e) => setWriteOffReason(e.target.value)}
                placeholder="e.g. Expired batch destruction per DRAP guidelines"
                className="text-xs"
              />
            </div>

            {writeOffError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded text-xs">
                {writeOffError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWriteOffModalBatch(null)}
                disabled={writingOff}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleExecuteWriteOff}
                disabled={writingOff}
              >
                {writingOff ? 'Writing Off...' : 'Confirm Write Off & Post GL'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
