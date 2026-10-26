import React, { useEffect, useState } from 'react';
import type { DashboardOverview } from '../types';
import { apiFetch } from '../lib/api';
import { formatPaisa, formatKarachiDateOnly } from '../lib/formatters';
import { StatCard, Card, CardHeader, CardTitle, CardContent, Table, TableHeader, TableBody, TableHead, TableRow, TableCell, Badge, Button } from '@pos/ui';
import {
  DollarSign,
  Receipt,
  AlertTriangle,
  PackageX,
  RefreshCw,
  TrendingUp,
  Clock,
} from 'lucide-react';

export const OverviewPage: React.FC = () => {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch<DashboardOverview>('/api/dashboard/overview');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard overview');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 gap-2">
        <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
        <span className="text-sm font-medium">Loading executive overview...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-center space-y-3">
        <p className="text-sm font-semibold text-red-700">{error}</p>
        <Button onClick={fetchOverview} variant="outline" size="sm">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & Refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Today's Financial &amp; Stock Snapshot
          </h2>
          <p className="text-xs text-slate-500">
            Real-time metrics calculated strictly from centralized synced transactions
          </p>
        </div>
        <Button
          onClick={fetchOverview}
          variant="outline"
          size="sm"
          className="gap-2 text-xs"
          disabled={isLoading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Today's Net Sales"
          value={formatPaisa(data?.todaySalesPaisa || 0)}
          subtitle="Total revenue finalized today"
          icon={<DollarSign className="w-4 h-4 text-emerald-600" />}
        />
        <StatCard
          title="Invoices Created"
          value={String(data?.todayInvoiceCount || 0)}
          subtitle="Invoices processed across all counters"
          icon={<Receipt className="w-4 h-4 text-blue-600" />}
        />
        <StatCard
          title="Expiring Batches"
          value={String(data?.expiringBatches.length || 0)}
          subtitle="Batches expiring within 90 days"
          icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
        />
        <StatCard
          title="Low Stock Items"
          value={String(data?.lowStockProducts.length || 0)}
          subtitle="Products at or below 10 units"
          icon={<PackageX className="w-4 h-4 text-rose-500" />}
        />
      </div>

      {/* Grid: Top Selling Products & Expiring Soon */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products */}
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <CardTitle className="text-sm font-bold text-slate-900">
                Top Products Today
              </CardTitle>
            </div>
            <span className="text-[11px] text-slate-400 font-medium">By units sold</span>
          </CardHeader>
          <CardContent className="p-0">
            {data?.topProducts && data.topProducts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Product</TableHead>
                    <TableHead className="text-xs text-right">Units Sold</TableHead>
                    <TableHead className="text-xs text-right">Total Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topProducts.map((p) => (
                    <TableRow key={p.productId}>
                      <TableCell className="font-semibold text-xs text-slate-800">
                        {p.brandName}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono font-medium">
                        {p.unitsSold}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono font-bold text-slate-900">
                        {formatPaisa(p.revenuePaisa)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-8 text-center text-xs text-slate-400">
                No product sales recorded yet today.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Batches Expiring Soon */}
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <CardTitle className="text-sm font-bold text-slate-900">
                Batches Expiring Soon (&lt; 90 Days)
              </CardTitle>
            </div>
            <span className="text-[11px] text-slate-400 font-medium">Requires rotation</span>
          </CardHeader>
          <CardContent className="p-0">
            {data?.expiringBatches && data.expiringBatches.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Product &amp; Batch</TableHead>
                    <TableHead className="text-xs">Expiry Date</TableHead>
                    <TableHead className="text-xs text-right">Stock</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.expiringBatches.map((b) => (
                    <TableRow key={b.batchId}>
                      <TableCell className="text-xs">
                        <div className="font-semibold text-slate-800">{b.brandName}</div>
                        <div className="text-[11px] font-mono text-slate-400">{b.batchNo}</div>
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        <Badge variant="warning" className="text-[10px] font-semibold">
                          {formatKarachiDateOnly(b.expiryDate)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono font-bold text-slate-900">
                        {b.currentStock} units
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-8 text-center text-xs text-slate-400">
                No batches currently nearing expiration.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Low Stock Alerts */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <PackageX className="w-4 h-4 text-rose-500" />
            <CardTitle className="text-sm font-bold text-slate-900">
              Low Stock Depletion Watchlist
            </CardTitle>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">Current balance &le; 10</span>
        </CardHeader>
        <CardContent className="p-0">
          {data?.lowStockProducts && data.lowStockProducts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Product Name</TableHead>
                  <TableHead className="text-xs text-right">Total Current Stock</TableHead>
                  <TableHead className="text-xs text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lowStockProducts.map((p) => (
                  <TableRow key={p.productId}>
                    <TableCell className="font-semibold text-xs text-slate-800">
                      {p.brandName}
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono font-bold text-rose-600">
                      {p.currentStock} units
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <Badge variant="destructive" className="text-[10px] uppercase font-bold">
                        Reorder Needed
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-xs text-slate-400">
              All inventory levels are above safe minimum thresholds.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
