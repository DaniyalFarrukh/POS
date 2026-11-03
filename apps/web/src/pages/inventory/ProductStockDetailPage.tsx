import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { formatPaisa, formatKarachiDateTime } from '../../lib/formatters';
import { getMovementTypeBadge, getExpiryStatusDetails } from '../../lib/stock-utils';
import type { ProductStockDetailData } from '../../types';
import {
  Card,
  CardHeader,
  CardTitle,
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
import {
  ArrowLeft,
  Layers,
  History,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

interface ProductStockDetailPageProps {
  productId: string;
  onClose: () => void;
}

export const ProductStockDetailPage: React.FC<ProductStockDetailPageProps> = ({
  productId,
  onClose,
}) => {
  const [data, setData] = useState<ProductStockDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: ProductStockDetailData }>(
        `/api/inventory/products/${productId}/stock-detail`
      );
      setData(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load product stock details';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [productId]);

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
        Loading product stock details...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Button variant="outline" size="sm" onClick={onClose} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Stock Management
        </Button>
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg">
          {error || 'Product not found'}
        </div>
      </div>
    );
  }

  const { product, batches, movements } = data;

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">{product.brandName}</h1>
              {product.isLowStock && (
                <Badge variant="warning" className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Low Stock
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {product.genericName || 'No generic name'} • {product.strength || ''} {product.form || ''}
            </p>
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={loadDetail}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500">Total On-Hand Stock</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{product.totalStock}</div>
            <div className="text-xs text-slate-400 mt-1">Reorder level: {product.reorderLevel}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500">Total Stock Valuation</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              {formatPaisa(product.stockValuePaisa)}
            </div>
            <div className="text-xs text-slate-400 mt-1">At batch cost</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500">Retail Price (MRP)</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {formatPaisa(product.mrpPaisa)}
            </div>
            <div className="text-xs text-slate-400 mt-1">Default sale price</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500">Manufacturer & Barcode</div>
            <div className="text-sm font-semibold text-slate-900 mt-1 truncate">
              {product.manufacturer || '—'}
            </div>
            <div className="text-xs text-slate-400 mt-1 font-mono truncate">
              {product.barcode || 'No barcode'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Batches Table */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600" /> Active Batches Breakdown ({batches.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch #</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Expiry Date</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">MRP</TableHead>
                <TableHead className="text-right">On-Hand</TableHead>
                <TableHead className="text-right">Valuation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-6 text-slate-500 text-xs">
                    No active batches found for this product.
                  </TableCell>
                </TableRow>
              ) : (
                batches.map((b) => {
                  const now = new Date();
                  const days = Math.ceil(
                    (new Date(b.expiryDate).getTime() - now.getTime()) / (86400 * 1000)
                  );
                  const expDetails = getExpiryStatusDetails(b.expiryDate, days);

                  return (
                    <TableRow key={`${b.batchId}-${b.branchId}-${b.locationId || 'default'}`}>
                      <TableCell className="font-mono text-xs font-medium">{b.batchNo}</TableCell>
                      <TableCell className="text-xs">{b.branchName}</TableCell>
                      <TableCell className="text-xs text-slate-500">{b.locationName || 'Default'}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${expDetails.colorClass}`}
                        >
                          {expDetails.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs">{formatPaisa(b.costPaisa)}</TableCell>
                      <TableCell className="text-right text-xs font-semibold">{formatPaisa(b.mrpPaisa)}</TableCell>
                      <TableCell className="text-right font-bold text-xs">{b.onHandQuantity}</TableCell>
                      <TableCell className="text-right text-xs font-semibold text-emerald-700">
                        {formatPaisa(b.onHandQuantity * b.costPaisa)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Stock Movements Timeline */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <History className="w-4 h-4 text-purple-600" /> Stock Movements Timeline ({movements.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {movements.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">
              No stock movements recorded for this product.
            </div>
          ) : (
            <div className="relative border-l-2 border-slate-200 ml-4 space-y-6">
              {movements.map((m) => {
                const badge = getMovementTypeBadge(m.type);
                const isPositive = m.quantitySigned > 0;

                return (
                  <div key={m.id} className="relative pl-6">
                    {/* Timeline bullet */}
                    <div
                      className={`absolute -left-[9px] top-1.5 w-4 h-4 rounded-full border-2 border-white ${
                        isPositive ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />

                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-medium border ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                          <span className="font-mono text-slate-700">Batch: {m.batchNo}</span>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-600">{m.branchName}</span>
                          {m.locationName && (
                            <>
                              <span className="text-slate-400">•</span>
                              <span className="text-slate-500">{m.locationName}</span>
                            </>
                          )}
                        </div>

                        <span className="text-slate-400 font-mono text-[11px]">
                          {formatKarachiDateTime(m.createdAt)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200/60">
                        <div className="text-slate-600">
                          {m.reason ? (
                            <span>Reason: {m.reason}</span>
                          ) : m.referenceType ? (
                            <span className="text-slate-400">Ref: {m.referenceType}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </div>

                        <div
                          className={`font-mono font-bold text-sm ${
                            isPositive ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {isPositive ? `+${m.quantitySigned}` : m.quantitySigned}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
