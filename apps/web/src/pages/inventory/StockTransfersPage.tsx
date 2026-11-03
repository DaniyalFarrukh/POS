import React, { useState, useEffect, useCallback } from 'react';
import type {
  StockTransferRecord,
  StockTransferKPIs,
  BranchRecord,
  StockLocationRecord,
} from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
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
  Truck,
  Plus,
  RefreshCw,
  Search,
  ArrowRight,
  Eye,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { StockTransferDetailPage } from './StockTransferDetailPage';
import {
  getTransferStatusDetails,
  calculateTransferKPIs,
  validateCreateTransferForm,
  type CreateTransferLineInput,
} from '../../lib/transfer-utils';

interface ProductBatchOption {
  productId: string;
  brandName: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
}

export const StockTransfersPage: React.FC = () => {
  const { can } = useAuth();
  const canCreate = can('inventory.transfer.create');

  // Detail view state
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);

  // List & KPIs
  const [transfers, setTransfers] = useState<StockTransferRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Dropdown options
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [sourceLocations, setSourceLocations] = useState<StockLocationRecord[]>([]);
  const [destLocations, setDestLocations] = useState<StockLocationRecord[]>([]);
  const [productBatches, setProductBatches] = useState<ProductBatchOption[]>([]);

  // Create Transfer Drawer / Modal
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [sourceBranchId, setSourceBranchId] = useState('');
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationBranchId, setDestinationBranchId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [autoDispatch, setAutoDispatch] = useState(false);
  const [formLines, setFormLines] = useState<CreateTransferLineInput[]>([]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Load transfers list
  const loadTransfers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = '/api/stock-transfers';
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.append('status', statusFilter);
      }
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const res = await apiFetch<{ items: StockTransferRecord[] }>(url);
      setTransfers(res.items || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load stock transfers';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  // Load auxiliary data
  const loadAuxData = useCallback(async () => {
    try {
      const bRes = await apiFetch<{ data?: BranchRecord[]; items?: BranchRecord[] }>('/api/branches');
      const bList = bRes.data || bRes.items || [];
      setBranches(bList);
      if (bList.length >= 2 && bList[0] && bList[1]) {
        setSourceBranchId(bList[0].id);
        setDestinationBranchId(bList[1].id);
      } else if (bList.length === 1 && bList[0]) {
        setSourceBranchId(bList[0].id);
        setDestinationBranchId(bList[0].id);
      }

      // Load products for batches
      interface ProductBatchFetchItem {
        id: string;
        brandName: string;
        batches?: Array<{ id: string; batchNo: string; expiryDate: string }>;
      }
      const pRes = await apiFetch<{ items?: ProductBatchFetchItem[] }>('/api/products?limit=100');
      const pList = pRes.items || [];
      const batchOpts: ProductBatchOption[] = [];
      for (const p of pList) {
        if (p.batches && p.batches.length > 0) {
          for (const b of p.batches) {
            batchOpts.push({
              productId: p.id,
              brandName: p.brandName,
              batchId: b.id,
              batchNo: b.batchNo,
              expiryDate: b.expiryDate,
            });
          }
        }
      }
      setProductBatches(batchOpts);
    } catch {
      // Non-fatal if auxiliary data fails to load
    }
  }, []);

  // Load locations when branches change in drawer
  useEffect(() => {
    if (sourceBranchId) {
      apiFetch<{ items: StockLocationRecord[] }>(
        `/api/stock-locations?branchId=${sourceBranchId}`
      )
        .then((res) => setSourceLocations(res.items || []))
        .catch(() => setSourceLocations([]));
    } else {
      setSourceLocations([]);
    }
  }, [sourceBranchId]);

  useEffect(() => {
    if (destinationBranchId) {
      apiFetch<{ items: StockLocationRecord[] }>(
        `/api/stock-locations?branchId=${destinationBranchId}`
      )
        .then((res) => setDestLocations(res.items || []))
        .catch(() => setDestLocations([]));
    } else {
      setDestLocations([]);
    }
  }, [destinationBranchId]);

  useEffect(() => {
    loadTransfers();
  }, [loadTransfers]);

  useEffect(() => {
    loadAuxData();
  }, [loadAuxData]);

  // Reset & open create drawer
  const openCreateDrawer = () => {
    setFormLines([
      {
        productId: productBatches[0]?.productId || '',
        batchId: productBatches[0]?.batchId || '',
        quantityRequested: 1,
      },
    ]);
    setNotes('');
    setAutoDispatch(false);
    setFormErrors({});
    setIsDrawerOpen(true);
  };

  const handleAddLine = () => {
    setFormLines((prev) => [
      ...prev,
      {
        productId: productBatches[0]?.productId || '',
        batchId: productBatches[0]?.batchId || '',
        quantityRequested: 1,
      },
    ]);
  };

  const handleRemoveLine = (idx: number) => {
    setFormLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleLineChange = (
    idx: number,
    field: 'batchChoice' | 'quantityRequested',
    value: string | number
  ) => {
    setFormLines((prev) => {
      const updated = [...prev];
      const cur = updated[idx];
      if (!cur) return prev;
      const next: CreateTransferLineInput = { ...cur };
      if (field === 'batchChoice') {
        const found = productBatches.find((b) => b.batchId === value);
        if (found) {
          next.productId = found.productId;
          next.batchId = found.batchId;
        }
      } else if (field === 'quantityRequested') {
        next.quantityRequested = parseInt(value as string, 10) || 0;
      }
      updated[idx] = next;
      return updated;
    });
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateCreateTransferForm({
      sourceBranchId,
      sourceLocationId: sourceLocationId || undefined,
      destinationBranchId,
      destinationLocationId: destinationLocationId || undefined,
      lines: formLines,
    });

    if (!validation.isValid) {
      setFormErrors(validation.errors);
      return;
    }

    setSubmitting(true);
    setFormErrors({});

    try {
      // 1. Create transfer
      const createRes = await apiFetch<{ data: StockTransferRecord }>('/api/stock-transfers', {
        method: 'POST',
        body: JSON.stringify({
          sourceBranchId,
          sourceLocationId: sourceLocationId || undefined,
          destinationBranchId,
          destinationLocationId: destinationLocationId || undefined,
          notes: notes.trim() || undefined,
          lines: formLines.map((l) => ({
            productId: l.productId,
            batchId: l.batchId,
            quantityRequested: l.quantityRequested,
          })),
        }),
      });

      const newTransfer = createRes.data;

      // 2. Dispatch immediately if requested
      if (autoDispatch && newTransfer?.id) {
        await apiFetch(`/api/stock-transfers/${newTransfer.id}/dispatch`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
      }

      setIsDrawerOpen(false);
      await loadTransfers();
      if (newTransfer?.id) {
        setSelectedTransferId(newTransfer.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create transfer';
      setFormErrors({ general: msg });
    } finally {
      setSubmitting(false);
    }
  };

  // If viewing detail
  if (selectedTransferId) {
    return (
      <StockTransferDetailPage
        transferId={selectedTransferId}
        onBack={() => setSelectedTransferId(null)}
        onRefreshList={loadTransfers}
      />
    );
  }

  // Filter transfers by search
  const filteredTransfers = transfers.filter((t) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      t.transferNumber.toLowerCase().includes(term) ||
      (t.notes && t.notes.toLowerCase().includes(term)) ||
      (t.sourceBranchName && t.sourceBranchName.toLowerCase().includes(term)) ||
      (t.destinationBranchName && t.destinationBranchName.toLowerCase().includes(term))
    );
  });

  const kpis: StockTransferKPIs = calculateTransferKPIs(transfers);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="w-7 h-7 text-blue-600" />
            <h1 className="text-2xl font-bold text-slate-900">Stock Transfers</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Dispatch, track in-transit inventory, and receive branch &amp; warehouse stock transfers.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={loadTransfers} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {canCreate && (
            <Button size="sm" onClick={openCreateDrawer}>
              <Plus className="w-4 h-4 mr-1.5" />
              New Transfer
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Transfers
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{kpis.totalCount}</div>
            <div className="text-xs text-slate-400 mt-1">Recorded across branches</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> In Transit
            </div>
            <div className="text-2xl font-bold text-blue-700 mt-1">{kpis.inTransitCount}</div>
            <div className="text-xs text-blue-500 mt-1">Stock not sellable at either end</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Completed
            </div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">{kpis.receivedCount}</div>
            <div className="text-xs text-emerald-500 mt-1">Successfully received</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-amber-600 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Shortages
            </div>
            <div className="text-2xl font-bold text-amber-700 mt-1">{kpis.shortageCount}</div>
            <div className="text-xs text-amber-500 mt-1">Reported loss / damage</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Search */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto">
            {['all', 'in_transit', 'draft', 'received', 'cancelled'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                  statusFilter === st
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {st.replace('_', ' ')}
              </button>
            ))}
          </div>

          <div className="relative min-w-[260px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search transfer # or branch..."
              className="pl-9 text-xs"
            />
          </div>
        </CardContent>
      </Card>

      {/* Error Alert */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
          {error}
        </div>
      )}

      {/* Transfers Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transfer #</TableHead>
                <TableHead>Source</TableHead>
                <TableHead></TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dispatched At</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                    Loading transfers...
                  </TableCell>
                </TableRow>
              ) : filteredTransfers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                    No stock transfers match the current filter.
                  </TableCell>
                </TableRow>
              ) : (
                filteredTransfers.map((t) => {
                  const statusDetails = getTransferStatusDetails(t.status);
                  return (
                    <TableRow key={t.id} className="hover:bg-slate-50 transition-colors">
                      <TableCell className="font-bold text-slate-900 font-mono">
                        {t.transferNumber}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-slate-800">
                          {t.sourceBranchName || t.sourceBranchId}
                        </div>
                        {t.sourceLocationName && (
                          <div className="text-xs text-slate-400">{t.sourceLocationName}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-300">
                        <ArrowRight className="w-4 h-4" />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-slate-800">
                          {t.destinationBranchName || t.destinationBranchId}
                        </div>
                        {t.destinationLocationName && (
                          <div className="text-xs text-slate-400">{t.destinationLocationName}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusDetails.badgeClass}>{statusDetails.label}</Badge>
                        {t.hasShortage && (
                          <span className="ml-1.5 inline-block text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                            Shortage
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {t.dispatchedAt ? new Date(t.dispatchedAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedTransferId(t.id)}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Transfer Modal */}
      <Modal
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Create Stock Transfer"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          {formErrors.general && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs">
              {formErrors.general}
            </div>
          )}

          {/* Source & Destination Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Source Branch *
              </label>
              <select
                value={sourceBranchId}
                onChange={(e) => setSourceBranchId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>

              <label className="block text-xs font-medium text-slate-600 mt-2 mb-1">
                Source Shelf / Location
              </label>
              <select
                value={sourceLocationId}
                onChange={(e) => setSourceLocationId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white"
              >
                <option value="">Default Location</option>
                {sourceLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.isDefault ? '(Default)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Destination Branch *
              </label>
              <select
                value={destinationBranchId}
                onChange={(e) => setDestinationBranchId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {formErrors.destinationBranchId && (
                <div className="text-rose-600 text-xs mt-1">{formErrors.destinationBranchId}</div>
              )}

              <label className="block text-xs font-medium text-slate-600 mt-2 mb-1">
                Destination Shelf / Location
              </label>
              <select
                value={destinationLocationId}
                onChange={(e) => setDestinationLocationId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white"
              >
                <option value="">Default Location</option>
                {destLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.isDefault ? '(Default)' : ''}
                  </option>
                ))}
              </select>
              {formErrors.destinationLocationId && (
                <div className="text-rose-600 text-xs mt-1">{formErrors.destinationLocationId}</div>
              )}
            </div>
          </div>

          {/* Transfer Lines */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 uppercase">Items to Transfer</span>
              <Button type="button" variant="outline" size="sm" onClick={handleAddLine}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Product
              </Button>
            </div>

            {formErrors.lines && (
              <div className="text-rose-600 text-xs">{formErrors.lines}</div>
            )}

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {formLines.map((line, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg"
                >
                  <div className="flex-1">
                    <select
                      value={line.batchId}
                      onChange={(e) => handleLineChange(idx, 'batchChoice', e.target.value)}
                      className="w-full border border-slate-300 rounded p-1.5 text-xs bg-white"
                    >
                      {productBatches.length === 0 ? (
                        <option value="">No product batches available</option>
                      ) : (
                        productBatches.map((b) => (
                          <option key={b.batchId} value={b.batchId}>
                            {b.brandName} (Batch: {b.batchNo}, Exp: {b.expiryDate})
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="w-24">
                    <Input
                      type="number"
                      min="1"
                      value={line.quantityRequested}
                      onChange={(e) =>
                        handleLineChange(idx, 'quantityRequested', e.target.value)
                      }
                      className="text-xs"
                      placeholder="Qty"
                    />
                  </div>

                  {formLines.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemoveLine(idx)}
                      className="text-rose-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
              Transfer Notes
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Replenishment shipment for weekend"
            />
          </div>

          {/* Dispatch immediately option */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="autoDispatchCheck"
              checked={autoDispatch}
              onChange={(e) => setAutoDispatch(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
            />
            <label htmlFor="autoDispatchCheck" className="text-xs font-medium text-slate-700">
              Dispatch immediately (moves inventory to In-Transit immediately upon creation)
            </label>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDrawerOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating...' : autoDispatch ? 'Create & Dispatch' : 'Save as Draft'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
