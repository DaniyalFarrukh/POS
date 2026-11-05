import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { formatPaisa } from '../../lib/formatters';
import { calculateReconciliationStatus, getExpiryStatusDetails } from '../../lib/stock-utils';
import type {
  StockProductRecord,
  StockBatchRecord,
  StockKPIs,
  BranchRecord,
  StockLocationRecord,
} from '../../types';
import { ProductStockDetailPage } from './ProductStockDetailPage';
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
  Boxes,
  Layers,
  RefreshCw,
  Search,
  Eye,
  Scale,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  Building2,
  MapPin,
} from 'lucide-react';

interface StockApiResponse {
  items: StockProductRecord[] | StockBatchRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  kpis: StockKPIs;
}

export const StockManagementPage: React.FC = () => {
  const [view, setView] = useState<'product' | 'batch'>('product');
  const [productItems, setProductItems] = useState<StockProductRecord[]>([]);
  const [batchItems, setBatchItems] = useState<StockBatchRecord[]>([]);
  const [kpis, setKpis] = useState<StockKPIs>({
    totalStockValuePaisa: 0,
    ledgerInventoryBalancePaisa: 0,
    reconciliationDifferencePaisa: 0,
    lowStockCount: 0,
    nearExpiryCount: 0,
    expiredCount: 0,
  });

  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [branchId, setBranchId] = useState<string>('');
  const [locationId, setLocationId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'low_stock' | 'near_expiry' | 'expired'>(
    'all'
  );

  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [locations, setLocations] = useState<StockLocationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected product for stock detail view
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

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

  const loadStock = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('view', view);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      params.set('status', statusFilter);
      if (branchId) params.set('branchId', branchId);
      if (locationId) params.set('locationId', locationId);
      if (searchTerm.trim()) params.set('search', searchTerm.trim());

      const res = await apiFetch<{ data: StockApiResponse }>(
        `/api/inventory/stock?${params.toString()}`
      );

      if (res.data) {
        if (view === 'product') {
          setProductItems(res.data.items as StockProductRecord[]);
        } else {
          setBatchItems(res.data.items as StockBatchRecord[]);
        }
        setKpis(res.data.kpis);
        setTotal(res.data.pagination.total);
        setTotalPages(res.data.pagination.totalPages);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load stock inventory';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStock();
  }, [view, branchId, locationId, statusFilter, page]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadStock();
  };

  // If a product is selected, render the detail page
  if (selectedProductId) {
    return (
      <ProductStockDetailPage
        productId={selectedProductId}
        onClose={() => setSelectedProductId(null)}
      />
    );
  }

  const reconStatus = calculateReconciliationStatus(
    kpis.totalStockValuePaisa,
    kpis.ledgerInventoryBalancePaisa
  );

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Boxes className="w-6 h-6 text-blue-600" /> Stock Management & Valuation
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time on-hand stock derived strictly from immutable stock movements. Stock value
            reconciled against General Ledger Account 1200.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={loadStock} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Stock Valuation & Ledger Reconciliation */}
        <Card className="col-span-2 border-blue-200 bg-gradient-to-br from-blue-50/50 to-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-900 flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-blue-600" /> Inventory Stock Valuation & Ledger
                Reconciliation
              </span>
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded border font-semibold ${reconStatus.badgeClass}`}
              >
                {reconStatus.badgeText}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-blue-100">
              <div>
                <div className="text-[11px] text-slate-500 font-medium">
                  Physical Stock Valuation
                </div>
                <div className="text-xl font-bold text-slate-900 mt-0.5">
                  {formatPaisa(kpis.totalStockValuePaisa)}
                </div>
                <div className="text-[11px] text-slate-400">Sum of (batch on-hand × cost)</div>
              </div>

              <div>
                <div className="text-[11px] text-slate-500 font-medium">
                  GL Account 1200 Balance
                </div>
                <div className="text-xl font-bold text-slate-900 mt-0.5">
                  {formatPaisa(kpis.ledgerInventoryBalancePaisa)}
                </div>
                <div className="text-[11px] text-slate-400">Total Dr minus Cr in ledger</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Low Stock KPI */}
        <Card className={kpis.lowStockCount > 0 ? 'border-amber-300 bg-amber-50/30' : ''}>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-amber-700 flex items-center gap-1.5">
              <TrendingDown className="w-4 h-4 text-amber-600" /> Low Stock Items
            </div>
            <div className="text-2xl font-bold text-amber-900 mt-1">{kpis.lowStockCount}</div>
            <div className="text-xs text-amber-600/80 mt-1">Products at or below reorder level</div>
          </CardContent>
        </Card>

        {/* Expiry KPI */}
        <Card className={kpis.expiredCount > 0 ? 'border-rose-300 bg-rose-50/40' : ''}>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
              <CalendarClock className="w-4 h-4 text-purple-600" /> Expiry Status
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-slate-900">{kpis.nearExpiryCount}</span>
              <span className="text-xs text-slate-400">near expiry</span>
              {kpis.expiredCount > 0 && (
                <span className="text-xs font-bold text-rose-700 ml-1">
                  ({kpis.expiredCount} expired)
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 mt-1">Expiring within 90 days</div>
          </CardContent>
        </Card>
      </div>

      {/* View Switcher Tabs (By Product / By Batch) */}
      <div className="flex border-b border-slate-200 justify-between items-center">
        <div className="flex gap-2">
          <button
            onClick={() => {
              setView('product');
              setPage(1);
            }}
            className={`pb-2.5 px-4 text-xs font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
              view === 'product'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" /> By Product (Aggregated)
          </button>
          <button
            onClick={() => {
              setView('batch');
              setPage(1);
            }}
            className={`pb-2.5 px-4 text-xs font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
              view === 'batch'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> By Batch & Location
          </button>
        </div>

        {/* Quick status pills */}
        <div className="flex items-center gap-1 pb-2">
          {(
            [
              { id: 'all', label: 'All Items' },
              { id: 'low_stock', label: `Low Stock (${kpis.lowStockCount})` },
              { id: 'near_expiry', label: `Near Expiry (${kpis.nearExpiryCount})` },
              { id: 'expired', label: `Expired (${kpis.expiredCount})` },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setStatusFilter(s.id);
                setPage(1);
              }}
              className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${
                statusFilter === s.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <Card>
        <CardContent className="p-4">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col sm:flex-row items-center justify-between gap-4"
          >
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              {/* Branch filter */}
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
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
              </div>

              {/* Location filter */}
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
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
            </div>

            {/* Search Input */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search product, barcode, batch..."
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

      {/* Error alert */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
          {error}
        </div>
      )}

      {/* Main Stock Table */}
      <Card>
        <CardContent className="p-0">
          {view === 'product' ? (
            /* Product View Table */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Manufacturer / Barcode</TableHead>
                  <TableHead className="text-right">Reorder Level</TableHead>
                  <TableHead className="text-right">On-Hand Stock</TableHead>
                  <TableHead className="text-right">Valuation</TableHead>
                  <TableHead className="text-right">MRP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-slate-500 text-xs">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                      Loading stock inventory...
                    </TableCell>
                  </TableRow>
                ) : productItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-slate-500 text-xs">
                      No products found matching the criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  productItems.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-semibold text-xs text-slate-900">{p.brandName}</div>
                        <div className="text-[11px] text-slate-400">
                          {p.genericName || 'No generic'} • {p.strength || ''} {p.form || ''}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs text-slate-700">{p.manufacturer || '—'}</div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {p.barcode || '—'}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-500">
                        {p.reorderLevel}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`font-mono font-bold text-xs ${
                            p.isLowStock ? 'text-amber-700' : 'text-slate-900'
                          }`}
                        >
                          {p.totalStock}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold text-emerald-700">
                        {formatPaisa(p.stockValuePaisa)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-800">
                        {formatPaisa(p.mrpPaisa)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {p.isLowStock && (
                            <Badge variant="warning" className="text-[10px] py-0">
                              Low Stock
                            </Badge>
                          )}
                          {p.hasExpired && (
                            <Badge variant="destructive" className="text-[10px] py-0">
                              Expired
                            </Badge>
                          )}
                          {p.hasNearExpiry && !p.hasExpired && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] py-0 bg-amber-50 text-amber-700 border-amber-200"
                            >
                              Near Expiry
                            </Badge>
                          )}
                          {!p.isLowStock && !p.hasExpired && !p.hasNearExpiry && (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 text-emerald-700 border-emerald-200"
                            >
                              Adequate
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs px-2"
                          onClick={() => setSelectedProductId(p.id)}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1 text-blue-600" /> Detail
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          ) : (
            /* Batch View Table */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch #</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Branch & Location</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">MRP</TableHead>
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
                      Loading batches...
                    </TableCell>
                  </TableRow>
                ) : batchItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-slate-500 text-xs">
                      No batches found matching the criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  batchItems.map((b) => {
                    const expDetails = getExpiryStatusDetails(b.expiryDate, b.daysUntilExpiry);

                    return (
                      <TableRow key={`${b.batchId}-${b.branchId}-${b.locationId || 'default'}`}>
                        <TableCell className="font-mono text-xs font-semibold">
                          {b.batchNo}
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold text-xs text-slate-900">
                            {b.productName}
                          </div>
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
                        <TableCell className="text-right font-mono text-xs">
                          {formatPaisa(b.costPaisa)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold">
                          {formatPaisa(b.mrpPaisa)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold">
                          {b.onHandQuantity}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold text-emerald-700">
                          {formatPaisa(b.stockValuePaisa)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2"
                            onClick={() => setSelectedProductId(b.productId)}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1 text-blue-600" /> Detail
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}

          {/* Pagination bar */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-xs text-slate-500">
            <div>
              Showing {total > 0 ? (page - 1) * pageSize + 1 : 0} to{' '}
              {Math.min(page * pageSize, total)} of {total} items
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
    </div>
  );
};
