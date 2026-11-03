import React, { useState, useEffect, useCallback } from 'react';
import type {
  StockCountRecord,
  StockCountLineRecord,
  BranchRecord,
  StockLocationRecord,
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
  Badge,
  Modal,
  Input,
} from '@pos/ui';
import {
  ClipboardCheck,
  Plus,
  RefreshCw,
  Search,
  Eye,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowLeft,
  Send,
  Check,
} from 'lucide-react';
import {
  getCountStatusDetails,
  calculateCountKPIs,
  calculateLineVariance,
  canApproveCount,
} from '../../lib/count-utils';

interface ProductBatchOption {
  productId: string;
  brandName: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  costPaisa: number;
}

export const StockCountsPage: React.FC = () => {
  const { user, can } = useAuth();
  const canCreate = can('inventory.count.create');
  const userCanApprove = canApproveCount(user?.role);

  // Detail view state
  const [selectedCountId, setSelectedCountId] = useState<string | null>(null);
  const [countDetail, setCountDetail] = useState<StockCountRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lineCounts, setLineCounts] = useState<Record<string, { counted: number; notes: string }>>({});

  // List & KPIs
  const [counts, setCounts] = useState<StockCountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Dropdowns for create drawer
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [locations, setLocations] = useState<StockLocationRecord[]>([]);
  const [productBatches, setProductBatches] = useState<ProductBatchOption[]>([]);

  // Create drawer
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedBatches, setSelectedBatches] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // Load list
  const loadCounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = '/api/stock-counts';
      if (statusFilter !== 'all') {
        url += `?status=${statusFilter}`;
      }
      const res = await apiFetch<{ items: StockCountRecord[] }>(url);
      setCounts(res.items || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load stock counts';
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
      if (bList.length > 0 && bList[0]) {
        setBranchId(bList[0].id);
      }

      interface ProductBatchFetchItem {
        id: string;
        brandName: string;
        batches?: Array<{ id: string; batchNo: string; expiryDate: string; costPaisa: number }>;
      }
      const pRes = await apiFetch<{ items?: ProductBatchFetchItem[] }>('/api/products?limit=100');
      const pList = pRes.items || [];
      const batchOpts: ProductBatchOption[] = [];
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
            });
          }
        }
      }
      setProductBatches(batchOpts);
    } catch {
      // Non-fatal
    }
  }, []);

  // Load locations when branch changes
  useEffect(() => {
    if (branchId) {
      apiFetch<{ items: StockLocationRecord[] }>(`/api/stock-locations?branchId=${branchId}`)
        .then((res) => setLocations(res.items || []))
        .catch(() => setLocations([]));
    } else {
      setLocations([]);
    }
  }, [branchId]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    loadAuxData();
  }, [loadAuxData]);

  // Load count detail
  const loadCountDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await apiFetch<{ data: StockCountRecord }>(`/api/stock-counts/${id}`);
      setCountDetail(res.data);
      const initLineCounts: Record<string, { counted: number; notes: string }> = {};
      if (res.data.lines) {
        for (const line of res.data.lines) {
          initLineCounts[line.id] = {
            counted: line.countedQuantity,
            notes: line.notes || '',
          };
        }
      }
      setLineCounts(initLineCounts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load count session';
      alert(msg);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCountId) {
      loadCountDetail(selectedCountId);
    } else {
      setCountDetail(null);
    }
  }, [selectedCountId, loadCountDetail]);

  const openCreateDrawer = () => {
    setNotes('');
    setSelectedBatches(productBatches.slice(0, 10).map((b) => b.batchId));
    setDrawerError(null);
    setIsDrawerOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedBatches.length === 0) {
      setDrawerError('Select at least one product batch to count');
      return;
    }

    setSubmitting(true);
    setDrawerError(null);

    try {
      const batchesPayload = selectedBatches.map((batchId) => {
        const found = productBatches.find((b) => b.batchId === batchId);
        return {
          productId: found?.productId || '',
          batchId,
        };
      });

      const res = await apiFetch<{ data: StockCountRecord }>('/api/stock-counts', {
        method: 'POST',
        body: JSON.stringify({
          branchId,
          locationId: locationId || undefined,
          notes: notes.trim() || undefined,
          batches: batchesPayload,
        }),
      });

      setIsDrawerOpen(false);
      await loadCounts();
      if (res.data?.id) {
        setSelectedCountId(res.data.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create count session';
      setDrawerError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveLines = async () => {
    if (!countDetail) return;
    setDetailLoading(true);
    try {
      const linesPayload = Object.entries(lineCounts).map(([lineId, val]) => ({
        lineId,
        countedQuantity: val.counted,
        notes: val.notes || undefined,
      }));

      await apiFetch(`/api/stock-counts/${countDetail.id}/lines`, {
        method: 'PUT',
        body: JSON.stringify({ lines: linesPayload }),
      });
      await loadCountDetail(countDetail.id);
      await loadCounts();
      alert('Counted quantities saved successfully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save counts';
      alert(msg);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!countDetail) return;
    if (!window.confirm('Submit this count session for manager/owner approval?')) return;
    setDetailLoading(true);
    try {
      await apiFetch(`/api/stock-counts/${countDetail.id}/submit`, {
        method: 'POST',
      });
      await loadCountDetail(countDetail.id);
      await loadCounts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit count';
      alert(msg);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!countDetail) return;
    if (
      !window.confirm(
        'Approve count session? This will immediately generate stock adjustments and post journal entries to the General Ledger.'
      )
    ) {
      return;
    }

    setDetailLoading(true);
    try {
      await apiFetch(`/api/stock-counts/${countDetail.id}/approve`, {
        method: 'POST',
      });
      await loadCountDetail(countDetail.id);
      await loadCounts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to approve count';
      alert(msg);
    } finally {
      setDetailLoading(false);
    }
  };

  // Detail View
  if (selectedCountId && countDetail) {
    const statusMeta = getCountStatusDetails(countDetail.status);
    const isDraft = countDetail.status === 'draft';
    const isSubmitted = countDetail.status === 'submitted';

    return (
      <div className="space-y-6">
        {/* Top bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setSelectedCountId(null)}>
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">{countDetail.countNumber}</h1>
                <Badge className={statusMeta.badgeClass}>{statusMeta.label}</Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Branch: <strong>{countDetail.branchName || countDetail.branchId}</strong>
                {countDetail.locationName ? ` · Shelf: ${countDetail.locationName}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isDraft && canCreate && (
              <>
                <Button variant="outline" size="sm" onClick={handleSaveLines} disabled={detailLoading}>
                  <Check className="w-4 h-4 mr-1.5" /> Save Quantities
                </Button>
                <Button size="sm" onClick={handleSubmitForApproval} disabled={detailLoading}>
                  <Send className="w-4 h-4 mr-1.5" /> Submit for Review
                </Button>
              </>
            )}

            {isSubmitted && userCanApprove && (
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={detailLoading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <CheckCircle2 className="w-4 h-4 mr-1.5" /> Approve &amp; Post Adjustments
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => loadCountDetail(countDetail.id)}
              disabled={detailLoading}
            >
              <RefreshCw className={`w-4 h-4 ${detailLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Count Lines Table */}
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <span className="font-semibold text-sm text-slate-900">
                Audited Batches ({countDetail.lines?.length || 0})
              </span>
              <span className="text-xs text-slate-500">
                Created: {new Date(countDetail.createdAt).toLocaleString()}
              </span>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Batch No</TableHead>
                  <TableHead className="text-right">System Qty</TableHead>
                  <TableHead className="text-right">Counted Qty</TableHead>
                  <TableHead className="text-right">Variance Qty</TableHead>
                  <TableHead className="text-right">Cost Impact</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {countDetail.lines?.map((line: StockCountLineRecord) => {
                  const currentInput = lineCounts[line.id] || {
                    counted: line.countedQuantity,
                    notes: line.notes || '',
                  };
                  const variance = calculateLineVariance(
                    line.systemQuantity,
                    currentInput.counted,
                    line.costPaisa
                  );

                  return (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium text-slate-900">
                        <div>{line.product?.brandName || 'Product'}</div>
                        {line.product?.genericName && (
                          <div className="text-xs text-slate-400">{line.product.genericName}</div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{line.batch?.batchNo || '—'}</TableCell>
                      <TableCell className="text-right font-medium text-slate-600">
                        {line.systemQuantity}
                      </TableCell>
                      <TableCell className="text-right">
                        {isDraft ? (
                          <Input
                            type="number"
                            min="0"
                            value={currentInput.counted}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10) || 0;
                              setLineCounts((prev) => ({
                                ...prev,
                                [line.id]: { ...prev[line.id], counted: val, notes: prev[line.id]?.notes || '' },
                              }));
                            }}
                            className="w-24 text-right inline-block text-xs"
                          />
                        ) : (
                          <span className="font-bold text-slate-900">{line.countedQuantity}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        {variance.varianceQuantity < 0 ? (
                          <span className="text-rose-600">{variance.varianceQuantity}</span>
                        ) : variance.varianceQuantity > 0 ? (
                          <span className="text-emerald-600">+{variance.varianceQuantity}</span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {variance.variancePaisa < 0 ? (
                          <span className="text-rose-600">{formatPaisa(variance.variancePaisa)}</span>
                        ) : variance.variancePaisa > 0 ? (
                          <span className="text-emerald-600">+{formatPaisa(variance.variancePaisa)}</span>
                        ) : (
                          <span className="text-slate-400">Rs. 0.00</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {isDraft ? (
                          <Input
                            value={currentInput.notes}
                            placeholder="Reason for variance"
                            onChange={(e) => {
                              const val = e.target.value;
                              setLineCounts((prev) => ({
                                ...prev,
                                [line.id]: { ...prev[line.id], notes: val, counted: prev[line.id]?.counted ?? line.countedQuantity },
                              }));
                            }}
                            className="text-xs max-w-xs"
                          />
                        ) : (
                          line.notes || '—'
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredCounts = counts.filter((c) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      c.countNumber.toLowerCase().includes(term) ||
      (c.branchName && c.branchName.toLowerCase().includes(term)) ||
      (c.notes && c.notes.toLowerCase().includes(term))
    );
  });

  const kpis = calculateCountKPIs(counts);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-7 h-7 text-blue-600" />
            <h1 className="text-2xl font-bold text-slate-900">Stock Counts &amp; Audits</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Conduct shelf inventory counts, record physical counts per batch, and reconcile variances into the ledger.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={loadCounts} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          {canCreate && (
            <Button size="sm" onClick={openCreateDrawer}>
              <Plus className="w-4 h-4 mr-1.5" /> Start Count Session
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total Sessions
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{kpis.totalCounts}</div>
            <div className="text-xs text-slate-400 mt-1">Audit cycles recorded</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> Pending Review
            </div>
            <div className="text-2xl font-bold text-blue-700 mt-1">{kpis.submittedCount}</div>
            <div className="text-xs text-blue-500 mt-1">Awaiting manager approval</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Approved &amp; Posted
            </div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">{kpis.approvedCount}</div>
            <div className="text-xs text-emerald-500 mt-1">Adjustments in general ledger</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> In Draft
            </div>
            <div className="text-2xl font-bold text-slate-800 mt-1">{kpis.draftCount}</div>
            <div className="text-xs text-slate-400 mt-1">Counting in progress</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Search */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto">
            {['all', 'draft', 'submitted', 'approved', 'cancelled'].map((st) => (
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
              placeholder="Search session # or branch..."
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

      {/* Sessions Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session #</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead>Created Date</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                    Loading count sessions...
                  </TableCell>
                </TableRow>
              ) : filteredCounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                    No count sessions found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredCounts.map((c) => {
                  const statusDetails = getCountStatusDetails(c.status);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-bold text-slate-900 font-mono">
                        {c.countNumber}
                      </TableCell>
                      <TableCell className="font-medium text-slate-800">
                        {c.branchName || c.branchId}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {c.locationName || 'All Branch Shelves'}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusDetails.badgeClass}>{statusDetails.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {c.createdByName || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedCountId(c.id)}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" /> Review
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

      {/* Start Count Drawer / Modal */}
      <Modal
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Start Stock Count Session"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          {drawerError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs">
              {drawerError}
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
                Specific Location (Optional)
              </label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full border border-slate-300 rounded p-2 text-xs bg-white"
              >
                <option value="">All Branch Shelves</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
              Select Batches to Audit ({selectedBatches.length} selected)
            </label>
            <div className="max-h-56 overflow-y-auto border border-slate-200 rounded p-2 space-y-1 bg-slate-50">
              {productBatches.map((b) => {
                const checked = selectedBatches.includes(b.batchId);
                return (
                  <label
                    key={b.batchId}
                    className="flex items-center gap-2 p-1 text-xs hover:bg-white rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelectedBatches((prev) =>
                          checked ? prev.filter((id) => id !== b.batchId) : [...prev, b.batchId]
                        );
                      }}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-medium text-slate-800">{b.brandName}</span>
                    <span className="text-slate-400 font-mono text-[11px]">
                      (Batch: {b.batchNo}, Exp: {b.expiryDate})
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
              Audit Notes
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. End of month physical audit"
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
              {submitting ? 'Creating...' : 'Initialize Count Session'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

