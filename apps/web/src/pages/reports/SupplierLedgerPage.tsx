import React, { useState, useEffect } from 'react';
import type { SupplierLedgerItem } from '../../types';
import { apiFetch } from '../../lib/api';
import { formatPaisa, formatKarachiDateTime } from '../../lib/formatters';
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
} from '@pos/ui';
import { Truck, DollarSign, Package, RefreshCw } from 'lucide-react';

export const SupplierLedgerPage: React.FC = () => {
  const [items, setItems] = useState<SupplierLedgerItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLedger = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ items: SupplierLedgerItem[] }>(
        '/api/reports/supplier-ledger'
      );
      setItems(res.items);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch supplier ledger'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLedger();
  }, []);

  const totalSpendPaisa = items.reduce((acc, i) => acc + i.totalCostPaisa, 0);
  const totalUnitsProcured = items.reduce((acc, i) => acc + i.totalQuantity, 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Supplier Procurement Ledger
          </h2>
          <p className="text-xs text-slate-500">
            Total inventory deliveries, supplier spend, and purchase frequency recorded on the server
          </p>
        </div>
        <Button
          onClick={fetchLedger}
          variant="outline"
          size="sm"
          className="gap-2 text-xs"
          disabled={isLoading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Active Suppliers"
          value={String(items.length)}
          subtitle="Suppliers with recorded stock entries"
          icon={<Truck className="w-4 h-4 text-blue-600" />}
        />
        <StatCard
          title="Total Units Received"
          value={totalUnitsProcured.toLocaleString()}
          subtitle="Cumulative stock units received"
          icon={<Package className="w-4 h-4 text-slate-600" />}
        />
        <StatCard
          title="Total Procurement Spend"
          value={formatPaisa(totalSpendPaisa)}
          subtitle="Aggregate supplier invoices in paisa"
          icon={<DollarSign className="w-4 h-4 text-emerald-600" />}
        />
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Supplier Ledger Table */}
      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-0">
          {items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Supplier / Procurement Source</TableHead>
                  <TableHead className="text-xs text-right">Deliveries Recorded</TableHead>
                  <TableHead className="text-xs text-right">Units Procured</TableHead>
                  <TableHead className="text-xs text-right">Total Procurement Cost</TableHead>
                  <TableHead className="text-xs text-right">Last Purchase Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-xs font-semibold text-slate-900">
                      {item.supplierName}
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono">
                      {item.purchaseCount}
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono font-medium">
                      {item.totalQuantity.toLocaleString()} units
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono font-bold text-slate-900">
                      {formatPaisa(item.totalCostPaisa)}
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono text-slate-500">
                      {formatKarachiDateTime(item.lastPurchaseDate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-xs text-slate-400">
              {isLoading ? 'Loading supplier history...' : 'No supplier procurement entries recorded.'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
