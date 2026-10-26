import React, { useState, useEffect } from 'react';
import type { ProfitPerBatchItem } from '../../types';
import { apiFetch } from '../../lib/api';
import { formatPaisa, formatKarachiDateOnly } from '../../lib/formatters';
import {
  StatCard,
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
} from '@pos/ui';
import { TrendingUp, DollarSign, RefreshCw, Sparkles } from 'lucide-react';

export const ProfitPerBatchReportPage: React.FC = () => {
  const [items, setItems] = useState<ProfitPerBatchItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ items: ProfitPerBatchItem[] }>(
        '/api/reports/profit-per-batch'
      );
      setItems(res.items);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch profit per batch report'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  const totalRevenuePaisa = items.reduce((acc, i) => acc + i.revenuePaisa, 0);
  const totalCostPaisa = items.reduce((acc, i) => acc + i.costPaisa, 0);
  const totalProfitPaisa = totalRevenuePaisa - totalCostPaisa;
  const overallMargin =
    totalRevenuePaisa > 0
      ? Math.round((totalProfitPaisa / totalRevenuePaisa) * 1000) / 10
      : 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Batch-Level Profit &amp; Margin Intelligence
          </h2>
          <p className="text-xs text-slate-500">
            Exact gross margin per product batch: <span className="font-mono">Revenue - (Units Sold &times; Batch Cost)</span> strictly in integer paisa (Rule 1)
          </p>
        </div>
        <Button
          onClick={fetchReport}
          variant="outline"
          size="sm"
          className="gap-2 text-xs"
          disabled={isLoading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Financial Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Batches Sold"
          value={String(items.length)}
          subtitle="Batches with active sale history"
          icon={<Sparkles className="w-4 h-4 text-blue-600" />}
        />
        <StatCard
          title="Cumulative Revenue"
          value={formatPaisa(totalRevenuePaisa)}
          subtitle="Gross turnover from batches"
          icon={<DollarSign className="w-4 h-4 text-slate-600" />}
        />
        <StatCard
          title="Cost of Goods Sold (COGS)"
          value={formatPaisa(totalCostPaisa)}
          subtitle="Batch procurement cost basis"
          icon={<DollarSign className="w-4 h-4 text-amber-600" />}
        />
        <StatCard
          title={`Net Gross Profit (${overallMargin}%)`}
          value={formatPaisa(totalProfitPaisa)}
          subtitle="Cumulative gross margins"
          icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
        />
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Table of Batches */}
      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-0">
          {items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Product &amp; Batch No</TableHead>
                  <TableHead className="text-xs">Expiry Date</TableHead>
                  <TableHead className="text-xs text-right">Units Sold</TableHead>
                  <TableHead className="text-xs text-right">Unit Cost</TableHead>
                  <TableHead className="text-xs text-right">Total Revenue</TableHead>
                  <TableHead className="text-xs text-right">Cost Basis</TableHead>
                  <TableHead className="text-xs text-right">Gross Profit</TableHead>
                  <TableHead className="text-xs text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const isPositive = item.profitPaisa >= 0;
                  return (
                    <TableRow key={item.batchId}>
                      <TableCell className="text-xs">
                        <div className="font-bold text-slate-900">{item.brandName}</div>
                        <div className="text-[11px] font-mono text-slate-500 font-medium">{item.batchNo}</div>
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {formatKarachiDateOnly(item.expiryDate)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono font-medium">
                        {item.unitsSold}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono text-slate-600">
                        {formatPaisa(item.unitCostPaisa)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono font-medium text-slate-900">
                        {formatPaisa(item.revenuePaisa)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono text-slate-600">
                        {formatPaisa(item.costPaisa)}
                      </TableCell>
                      <TableCell className={`text-right text-xs font-mono font-bold ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {formatPaisa(item.profitPaisa)}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        <Badge
                          variant={isPositive ? 'success' : 'destructive'}
                          className="text-[10px] font-mono font-bold"
                        >
                          {item.marginPercent}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-xs text-slate-400">
              {isLoading ? 'Calculating batch profits...' : 'No sales registered yet to calculate profit margins.'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
