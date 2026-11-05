import React, { useState, useEffect, useCallback } from 'react';
import type {
  SupplierReturnRecord,
  SupplierReturnLineRecord,
  SupplierRecord,
  BranchRecord,
} from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatPaisa } from '../../lib/formatters';
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
  RotateCcw,
  Plus,
  RefreshCw,
  Search,
  Eye,
  Trash2,
  FileText,
  DollarSign,
} from 'lucide-react';
import {
  calculateSupplierReturnKPIs,
  validateSupplierReturnForm,
  type SupplierReturnLineInput,
} from '../../lib/supplier-return-utils';

interface AvailableBatchOption {
  productId: string;
  brandName: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  costPaisa: number;
  onHand: number;
}

export const SupplierReturnsPage: React.FC = () => {
  const { can } = useAuth();
  const canCreate = can('inventory.supplier_return.create');

  // Detail view state
  const [selectedReturn, setSelectedReturn] = useState<SupplierReturnRecord | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // List & KPIs
  const [returns, setReturns] = useState<SupplierReturnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Dropdowns for create drawer
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [suppliersList, setSuppliersList] = useState<SupplierRecord[]>([]);
  const [availableBatches, setAvailableBatches] = useState<AvailableBatchOption[]>([]);

  // Create drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [reason, setReason] = useState('Damaged goods / shattered blisters');
  const [notes, setNotes] = useState('');
  const [formLines, setFormLines] = useState<SupplierReturnLineInput[]>([]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Load returns list
  const loadReturns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ items: SupplierReturnRecord[] }>('/api/supplier-returns');
      setReturns(res.items || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load supplier returns';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load auxiliary data
  const loadAuxData = useCallback(async () => {
    try {
      const bRes = await apiFetch<{ data?: BranchRecord[]; items?: BranchRecord[] }>(
        '/api/branches'
      );
      const bList = bRes.data || bRes.items || [];
      setBranches(bList);
      if (bList.length > 0 && bList[0]) {
        setBranchId(bList[0].id);
      }

      const sRes = await apiFetch<{ items?: SupplierRecord[] }>('/api/suppliers?limit=100');
      const sList = sRes.items || [];
      setSuppliersList(sList);
      if (sList.length > 0 && sList[0]) {
        setSupplierId(sList[0].id);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  // Load available batches for selected branch
  const loadBranchBatches = useCallback(async (brId: string) => {
    if (!brId) return;
    try {
      interface ProductBatchFetchItem {
        id: string;
        brandName: string;
        batches?: Array<{ id: string; batchNo: string; expiryDate: string; costPaisa: number }>;
      }
      const pRes = await apiFetch<{ items?: ProductBatchFetchItem[] }>('/api/products?limit=100');
      const pList = pRes.items || [];
      const batchOpts: AvailableBatchOption[] = [];

      for (const p of pList) {
        if (p.batches) {
          for (const b of p.batches) {
            batchOpts.push({
              productId: p.id,
              brandName: p.brandName,
              batchId: b.id,
              batchNo: b.batchNo,
              expiryDate: b.expiryDate,
              costPaisa: b.costPaisa,
              onHand: 100, // available on hand cap
            });
          }
        }
      }
      setAvailableBatches(batchOpts);
    } catch {
      setAvailableBatches([]);
    }
  }, []);

  useEffect(() => {
    loadReturns();
  }, [loadReturns]);

  useEffect(() => {
    loadAuxData();
  }, [loadAuxData]);

  useEffect(() => {
    if (branchId) {
      loadBranchBatches(branchId);
    }
  }, [branchId, loadBranchBatches]);

  const openCreateDrawer = () => {
    const firstBatch = availableBatches[0];
    setFormLines([
      {
        productId: firstBatch?.productId || '',
        batchId: firstBatch?.batchId || '',
        quantity: 1,
        availableOnHand: firstBatch?.onHand ?? 100,
        unitCostPaisa: firstBatch?.costPaisa ?? 0,
        reason: '',
      },
    ]);
    setNotes('');
    setFormErrors({});
    setIsDrawerOpen(true);
  };

  const handleAddLine = () => {
    const firstBatch = availableBatches[0];
    setFormLines((prev) => [
      ...prev,
      {
        productId: firstBatch?.productId || '',
        batchId: firstBatch?.batchId || '',
        quantity: 1,
        availableOnHand: firstBatch?.onHand ?? 100,
        unitCostPaisa: firstBatch?.costPaisa ?? 0,
        reason: '',
      },
    ]);
  };

  const handleRemoveLine = (idx: number) => {
    setFormLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleLineChange = (
    idx: number,
    field: 'batchChoice' | 'quantity' | 'reason',
    value: string | number
  ) => {
    setFormLines((prev) => {
      const updated = [...prev];
      const cur = updated[idx];
      if (!cur) return prev;
      const next: SupplierReturnLineInput = { ...cur };

      if (field === 'batchChoice') {
        const found = availableBatches.find((b) => b.batchId === value);
        if (found) {
          next.productId = found.productId;
          next.batchId = found.batchId;
          next.unitCostPaisa = found.costPaisa;
          next.availableOnHand = found.onHand;
        }
      } else if (field === 'quantity') {
        next.quantity = parseInt(value as string, 10) || 0;
      } else if (field === 'reason') {
        next.reason = value as string;
      }

      updated[idx] = next;
      return updated;
    });
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateSupplierReturnForm({
      branchId,
      supplierId,
      reason,
      lines: formLines,
    });

    if (!validation.isValid) {
      setFormErrors(validation.errors);
      return;
    }

    setSubmitting(true);
    setFormErrors({});

    try {
      const res = await apiFetch<{ data: SupplierReturnRecord }>('/api/supplier-returns', {
        method: 'POST',
        body: JSON.stringify({
          branchId,
          supplierId,
          reason: reason.trim(),
          notes: notes.trim() || undefined,
          lines: formLines.map((l) => ({
            productId: l.productId,
            batchId: l.batchId,
            quantity: l.quantity,
            reason: l.reason || undefined,
          })),
        }),
      });

      setIsDrawerOpen(false);
      await loadReturns();
      if (res.data) {
        setSelectedReturn(res.data);
        setIsDetailOpen(true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create supplier return';
      setFormErrors({ general: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const viewDetail = async (ret: SupplierReturnRecord) => {
    try {
      const res = await apiFetch<{ data: SupplierReturnRecord }>(`/api/supplier-returns/${ret.id}`);
      setSelectedReturn(res.data);
      setIsDetailOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load details';
      alert(msg);
    }
  };

  const filteredReturns = returns.filter((r) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      r.returnNumber.toLowerCase().includes(term) ||
      r.debitNoteNumber.toLowerCase().includes(term) ||
      (r.supplierName && r.supplierName.toLowerCase().includes(term)) ||
      (r.reason && r.reason.toLowerCase().includes(term))
    );
  });

  const kpis = calculateSupplierReturnKPIs(returns);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <RotateCcw className="w-7 h-7 text-blue-600" />
            <h1 className="text-2xl font-bold text-slate-900">
              Supplier Returns &amp; Debit Notes
            </h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Return damaged or expired stock to distributors, deduct inventory, and issue debit notes
            to reduce accounts payable.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={loadReturns} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          {canCreate && (
            <Button size="sm" onClick={openCreateDrawer}>
              <Plus className="w-4 h-4 mr-1.5" /> New Supplier Return
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-blue-600" /> Total Supplier Returns
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{kpis.totalReturns}</div>
            <div className="text-xs text-slate-400 mt-1">Debit notes processed</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wider flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-emerald-600" /> Total AP Reduction
            </div>
            <div className="text-2xl font-bold text-emerald-700 mt-1 font-mono">
              {formatPaisa(kpis.totalReturnedPaisa)}
            </div>
            <div className="text-xs text-emerald-500 mt-1">Credited back against payables</div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative min-w-[280px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by Return #, Debit Note #, or Supplier..."
              className="pl-9 text-xs"
            />
          </div>
        </CardContent>
      </Card>

      {/* Error alert */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
          {error}
        </div>
      )}

      {/* Returns Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Return #</TableHead>
                <TableHead>Debit Note #</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Total Debit</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                    Loading supplier returns...
                  </TableCell>
                </TableRow>
              ) : filteredReturns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-slate-500">
                    No supplier returns recorded. Click &quot;New Supplier Return&quot; to initiate
                    a return.
                  </TableCell>
                </TableRow>
              ) : (
                filteredReturns.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-bold text-slate-900 font-mono">
                      {r.returnNumber}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-blue-700 font-semibold">
                      {r.debitNoteNumber}
                    </TableCell>
                    <TableCell className="font-medium text-slate-800">
                      {r.supplierName || r.supplierId}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {r.branchName || r.branchId}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-emerald-700">
                      {formatPaisa(r.totalPaisa)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 max-w-xs truncate">
                      {r.reason}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{r.returnDate}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => viewDetail(r)}>
                        <Eye className="w-3.5 h-3.5 mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Supplier Return Drawer / Modal */}
      <Modal
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Create Supplier Return &amp; Debit Note"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          {formErrors.general && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs">
              {formErrors.general}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Branch *
              </label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full border border-slate-300 rounded p-2 text-xs bg-white"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Supplier / Distributor *
              </label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full border border-slate-300 rounded p-2 text-xs bg-white"
              >
                {suppliersList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
              General Return Reason *
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Broken packaging, near-expiry return, manufacturer recall"
            />
            {formErrors.reason && (
              <div className="text-rose-600 text-xs mt-1">{formErrors.reason}</div>
            )}
          </div>

          {/* Lines */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 uppercase">Return Batches</span>
              <Button type="button" variant="outline" size="sm" onClick={handleAddLine}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Batch
              </Button>
            </div>

            {formErrors.lines && <div className="text-rose-600 text-xs">{formErrors.lines}</div>}

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {formLines.map((line, idx) => {
                const qtyError = formErrors[`line_${idx}_qty`];
                return (
                  <div
                    key={idx}
                    className="p-2 bg-slate-50 border border-slate-200 rounded-lg space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <select
                          value={line.batchId}
                          onChange={(e) => handleLineChange(idx, 'batchChoice', e.target.value)}
                          className="w-full border border-slate-300 rounded p-1.5 text-xs bg-white"
                        >
                          {availableBatches.map((b) => (
                            <option key={b.batchId} value={b.batchId}>
                              {b.brandName} (Batch: {b.batchNo}, On-Hand: {b.onHand})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="w-24">
                        <Input
                          type="number"
                          min="1"
                          max={line.availableOnHand}
                          value={line.quantity}
                          onChange={(e) => handleLineChange(idx, 'quantity', e.target.value)}
                          className="text-xs text-right"
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

                    <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                      <span>
                        Max On Hand: <strong>{line.availableOnHand}</strong>
                      </span>
                      <span>
                        Debit: <strong>{formatPaisa(line.quantity * line.unitCostPaisa)}</strong>
                      </span>
                    </div>

                    {qtyError && (
                      <div className="text-rose-600 text-[11px] font-medium">{qtyError}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
              Reference / Delivery Challan Notes
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Handed to distributor driver Asif"
            />
          </div>

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
              {submitting ? 'Processing...' : 'Complete Return & Generate Debit Note'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Detail Modal */}
      <Modal
        open={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        title={selectedReturn ? `Debit Note: ${selectedReturn.debitNoteNumber}` : 'Return Details'}
      >
        {selectedReturn && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Return Number:</span>
                <span className="font-mono font-bold text-slate-900">
                  {selectedReturn.returnNumber}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Supplier:</span>
                <span className="font-semibold text-slate-900">
                  {selectedReturn.supplierName || selectedReturn.supplierId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Branch:</span>
                <span className="text-slate-800">
                  {selectedReturn.branchName || selectedReturn.branchId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Return Date:</span>
                <span className="text-slate-800">{selectedReturn.returnDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Reason:</span>
                <span className="text-slate-800 font-medium">{selectedReturn.reason}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5">
                <span className="font-bold text-slate-700">Total Debit (Payable Reduced):</span>
                <span className="font-mono font-bold text-emerald-700 text-sm">
                  {formatPaisa(selectedReturn.totalPaisa)}
                </span>
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Total Debit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedReturn.lines?.map((line: SupplierReturnLineRecord) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium text-xs">
                        {line.product?.brandName || 'Product'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {line.batch?.batchNo || '—'}
                      </TableCell>
                      <TableCell className="text-right font-bold text-xs">
                        {line.quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatPaisa(line.unitCostPaisa)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-xs text-emerald-700">
                        {formatPaisa(line.totalPaisa)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setIsDetailOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
