import React, { useState, useEffect, useCallback } from 'react';
import type {
  PurchaseOrderRecord,
  PurchaseOrderKPIs,
  LowStockSuggestionItem,
  OverReceiptPolicy,
} from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatPaisa, formatKarachiDateOnly } from '../../lib/formatters';
import { getKarachiBusinessDate, parsePkrToPaisa } from '@pos/shared';
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
  FileText,
  Plus,
  RefreshCw,
  Search,
  Eye,
  AlertTriangle,
  Scale,
  Clock,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { PurchaseOrderDetailPage } from './PurchaseOrderDetailPage';
import {
  validatePOForm,
  calculatePOTotals,
  canManagePO,
  getPOStatusDetails,
  type POLineInput,
} from '../../lib/po-utils';

interface SupplierSimple {
  id: string;
  name: string;
}

interface BranchSimple {
  id: string;
  name: string;
}

interface ProductSimple {
  id: string;
  brandName: string;
  genericName?: string | null;
  mrpPaisa: number;
}

export const PurchaseOrdersPage: React.FC = () => {
  const { user } = useAuth();
  const userRole = user?.role;
  const isManagerOrOwner = canManagePO(userRole);

  // View state
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);

  // List & KPIs
  const [items, setItems] = useState<PurchaseOrderRecord[]>([]);
  const [kpis, setKpis] = useState<PurchaseOrderKPIs>({
    openCount: 0,
    pendingApprovalCount: 0,
    committedPaisa: 0,
    overdueCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Auxiliary data for dropdowns
  const [suppliersList, setSuppliersList] = useState<SupplierSimple[]>([]);
  const [branchesList, setBranchesList] = useState<BranchSimple[]>([]);
  const [productsList, setProductsList] = useState<ProductSimple[]>([]);

  // Create PO Drawer
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [issueDate, setIssueDate] = useState(() => getKarachiBusinessDate());
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [overReceiptPolicy, setOverReceiptPolicy] = useState<OverReceiptPolicy>('flag');
  const [notes, setNotes] = useState('');
  const [formLines, setFormLines] = useState<POLineInput[]>([]);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerSubmitting, setDrawerSubmitting] = useState(false);

  // Low Stock Suggestions
  const [isLowStockModalOpen, setIsLowStockModalOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<LowStockSuggestionItem[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const fetchPOs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (statusFilter !== 'all') query.set('status', statusFilter);
      if (searchTerm.trim()) query.set('search', searchTerm.trim());

      const res = await apiFetch<{ kpis: PurchaseOrderKPIs; items: PurchaseOrderRecord[] }>(
        `/api/purchase-orders?${query.toString()}`
      );
      setItems(res.items);
      setKpis(res.kpis);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchTerm]);

  useEffect(() => {
    fetchPOs();
  }, [fetchPOs]);

  // Load auxiliary data when opening drawer
  const loadAuxData = async () => {
    try {
      const [supRes, brRes, prodRes] = await Promise.all([
        apiFetch<{ items: SupplierSimple[] }>('/api/suppliers').catch(() => ({ items: [] })),
        apiFetch<{ branches: BranchSimple[] }>('/api/admin/branches').catch(() => ({
          branches: [],
        })),
        apiFetch<{ items: Array<{ productId: string; brandName: string; mrpPaisa: number }> }>(
          '/api/reports/stock-and-expiry'
        ).catch(() => ({ items: [] })),
      ]);
      setSuppliersList(supRes.items || []);
      setBranchesList(brRes.branches || []);
      if (prodRes.items) {
        setProductsList(
          prodRes.items.map((p) => ({
            id: p.productId,
            brandName: p.brandName,
            mrpPaisa: p.mrpPaisa,
          }))
        );
      }
    } catch {
      // Ignore background aux fetch errors
    }
  };

  const openCreateDrawer = async () => {
    await loadAuxData();
    setSupplierId(suppliersList[0]?.id || '');
    setBranchId(branchesList[0]?.id || '');
    setIssueDate(getKarachiBusinessDate());
    setExpectedDeliveryDate('');
    setOverReceiptPolicy('flag');
    setNotes('');
    setFormLines([
      {
        productId: productsList[0]?.id || '',
        quantityOrdered: 10,
        expectedCostPaisa: 1000,
      },
    ]);
    setDrawerError(null);
    setIsDrawerOpen(true);
  };

  const handleAddLine = () => {
    setFormLines((prev) => [
      ...prev,
      {
        productId: productsList[0]?.id || '',
        quantityOrdered: 10,
        expectedCostPaisa: 1000,
      },
    ]);
  };

  const handleRemoveLine = (idx: number) => {
    setFormLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmitPO = async () => {
    const validation = validatePOForm({
      supplierId,
      branchId,
      issueDate,
      expectedDeliveryDate,
      overReceiptPolicy,
      notes,
      lines: formLines,
    });

    if (!validation.isValid) {
      setDrawerError(Object.values(validation.errors).join(', '));
      return;
    }

    setDrawerSubmitting(true);
    setDrawerError(null);

    try {
      await apiFetch('/api/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          supplierId,
          branchId,
          issueDate,
          expectedDeliveryDate: expectedDeliveryDate || null,
          overReceiptPolicy,
          notes: notes.trim() || null,
          lines: formLines,
        }),
      });

      setIsDrawerOpen(false);
      await fetchPOs();
    } catch (err: unknown) {
      setDrawerError(err instanceof Error ? err.message : 'Failed to create purchase order');
    } finally {
      setDrawerSubmitting(false);
    }
  };

  // Open low stock suggestions
  const openLowStockModal = async () => {
    setLoadingSuggestions(true);
    setIsLowStockModalOpen(true);
    try {
      const res = await apiFetch<{ items: LowStockSuggestionItem[] }>(
        '/api/purchase-orders/low-stock-suggestions'
      );
      setSuggestions(res.items);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to fetch low stock suggestions');
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const applySuggestionsToDrawer = async () => {
    await loadAuxData();
    setIsLowStockModalOpen(false);

    const lines: POLineInput[] = suggestions.map((s) => ({
      productId: s.productId,
      quantityOrdered: s.suggestedQuantity,
      expectedCostPaisa: Math.round(s.mrpPaisa * 0.75),
    }));

    setSupplierId(suppliersList[0]?.id || '');
    setBranchId(branchesList[0]?.id || '');
    setIssueDate(getKarachiBusinessDate());
    setExpectedDeliveryDate('');
    setOverReceiptPolicy('flag');
    setNotes('Generated from low stock suggestions');
    setFormLines(
      lines.length > 0 ? lines : [{ productId: '', quantityOrdered: 10, expectedCostPaisa: 1000 }]
    );
    setDrawerError(null);
    setIsDrawerOpen(true);
  };

  if (selectedPoId) {
    return <PurchaseOrderDetailPage poId={selectedPoId} onBack={() => setSelectedPoId(null)} />;
  }

  const { totalQuantity, totalCostPaisa } = calculatePOTotals(formLines);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <FileText className="h-6 w-6 text-emerald-600" /> Purchase Orders
          </h1>
          <p className="text-sm text-slate-500">
            Manage procurement, approvals, delivery fulfillment, and automated payable postings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openLowStockModal}>
            <Sparkles className="h-4 w-4 mr-1.5 text-amber-500" /> Low Stock Suggestions
          </Button>
          <Button variant="outline" size="sm" onClick={fetchPOs}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
          {isManagerOrOwner && (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={openCreateDrawer}
            >
              <Plus className="h-4 w-4 mr-1.5" /> New Purchase Order
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs font-medium text-slate-500 uppercase">Open Orders</span>
              <div className="text-2xl font-bold text-slate-900 mt-1">{kpis.openCount}</div>
              <div className="text-xs text-slate-400 mt-1">Draft, Approved, or In Transit</div>
            </div>
            <FileText className="h-8 w-8 text-blue-500/20" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs font-medium text-slate-500 uppercase">Pending Approval</span>
              <div className="text-2xl font-bold text-amber-600 mt-1">
                {kpis.pendingApprovalCount}
              </div>
              <div className="text-xs text-slate-400 mt-1">Requires Manager / Owner sign-off</div>
            </div>
            <Clock className="h-8 w-8 text-amber-500/20" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs font-medium text-slate-500 uppercase">Committed Amount</span>
              <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
                {formatPaisa(kpis.committedPaisa)}
              </div>
              <div className="text-xs text-slate-400 mt-1">Total pending delivery value</div>
            </div>
            <Scale className="h-8 w-8 text-emerald-500/20" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs font-medium text-slate-500 uppercase">
                Overdue Deliveries
              </span>
              <div className="text-2xl font-bold text-red-600 mt-1">{kpis.overdueCount}</div>
              <div className="text-xs text-slate-400 mt-1">Past expected delivery date</div>
            </div>
            <AlertTriangle className="h-8 w-8 text-red-500/20" />
          </CardContent>
        </Card>
      </div>

      {/* Main Table Card with Filters & Tabs */}
      <Card>
        <CardContent className="p-0">
          {/* Status Tabs */}
          <div className="flex border-b border-slate-200 overflow-x-auto bg-slate-50/50 px-4 pt-3 gap-2">
            {[
              { id: 'all', label: 'All Orders' },
              { id: 'draft', label: 'Draft' },
              { id: 'approved', label: 'Approved' },
              { id: 'sent', label: 'Sent' },
              { id: 'partially_received', label: 'Partially Received' },
              { id: 'received', label: 'Received' },
              { id: 'cancelled', label: 'Cancelled' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
                  statusFilter === tab.id
                    ? 'border-emerald-600 text-emerald-700 font-bold bg-white rounded-t'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Bar */}
          <div className="p-4 border-b border-slate-200">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by PO #, supplier, or notes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="p-4 bg-red-50 text-red-700 text-sm border-b border-red-200">
              {error}
            </div>
          )}

          {/* Table */}
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/75">
                <TableHead>PO Number</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead>Delivery Due</TableHead>
                <TableHead className="text-right">Expected Cost (PKR)</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-emerald-600" />
                    Loading purchase orders...
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-slate-500">
                    No purchase orders found matching the filter.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((po) => {
                  const badge = getPOStatusDetails(po.status);
                  const isLate =
                    po.expectedDeliveryDate &&
                    ['approved', 'sent', 'partially_received'].includes(po.status) &&
                    po.expectedDeliveryDate < getKarachiBusinessDate();

                  return (
                    <TableRow
                      key={po.id}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => setSelectedPoId(po.id)}
                    >
                      <TableCell className="font-mono font-bold text-slate-900">
                        {po.poNumber}
                      </TableCell>
                      <TableCell className="font-medium text-slate-800">
                        {po.supplierName || 'Unknown Supplier'}
                      </TableCell>
                      <TableCell className="text-slate-600 text-xs">
                        {po.branchName || 'Main Branch'}
                      </TableCell>
                      <TableCell className="text-slate-600 text-xs font-mono">
                        {formatKarachiDateOnly(po.issueDate)}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {po.expectedDeliveryDate ? (
                          <span className={isLate ? 'text-red-600 font-bold' : 'text-slate-600'}>
                            {formatKarachiDateOnly(po.expectedDeliveryDate)}
                            {isLate && ' (Overdue)'}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-slate-900">
                        {formatPaisa(po.totalExpectedCostPaisa)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedPoId(po.id)}
                          className="h-8 px-2 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                        >
                          <Eye className="h-4 w-4 mr-1" /> View
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

      {/* Create Purchase Order Drawer Modal */}
      {isDrawerOpen && (
        <Modal
          open={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          title="New Purchase Order"
        >
          <div className="space-y-4 max-h-[75vh] overflow-y-auto p-1 text-xs">
            {drawerError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-xs">
                {drawerError}
              </div>
            )}

            {/* Header attributes */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Supplier <span className="text-red-500">*</span>
                </label>
                <select
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs bg-white"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">Select Supplier...</option>
                  {suppliersList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Destination Branch <span className="text-red-500">*</span>
                </label>
                <select
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs bg-white"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                >
                  <option value="">Select Branch...</option>
                  {branchesList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Issue Date</label>
                <Input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Expected Delivery Date
                </label>
                <Input
                  type="date"
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Over-Receipt Policy</label>
                <select
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs bg-white"
                  value={overReceiptPolicy}
                  onChange={(e) => setOverReceiptPolicy(e.target.value as OverReceiptPolicy)}
                >
                  <option value="flag">Flag & Allow Excess</option>
                  <option value="reject">Strict Reject Excess</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Notes / Instructions
                </label>
                <Input
                  placeholder="Optional memo or terms"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            {/* Line items section */}
            <div className="border border-slate-200 rounded-md overflow-hidden mt-4">
              <div className="bg-slate-100 p-2 flex justify-between items-center">
                <span className="font-semibold text-slate-700">Order Lines</span>
                <Button variant="outline" size="sm" onClick={handleAddLine} className="h-7 text-xs">
                  <Plus className="h-3 w-3 mr-1" /> Add Line
                </Button>
              </div>

              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="p-2 text-left">Product</th>
                    <th className="p-2 text-right">Quantity</th>
                    <th className="p-2 text-right">Expected Cost (PKR)</th>
                    <th className="p-2 text-right">Subtotal</th>
                    <th className="p-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {formLines.map((line, idx) => (
                    <tr key={idx}>
                      <td className="p-2">
                        {productsList.length > 0 ? (
                          <select
                            className="border border-slate-200 rounded px-2 py-1 text-xs w-48 bg-white"
                            value={line.productId}
                            onChange={(e) => {
                              const val = e.target.value;
                              setFormLines((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, productId: val } : item
                                )
                              );
                            }}
                          >
                            <option value="">Select Product...</option>
                            {productsList.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.brandName}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            placeholder="Product UUID"
                            className="border border-slate-200 rounded px-2 py-1 text-xs font-mono w-48"
                            value={line.productId}
                            onChange={(e) => {
                              const val = e.target.value;
                              setFormLines((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, productId: val } : item
                                )
                              );
                            }}
                          />
                        )}
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          min="1"
                          className="border border-slate-200 rounded px-2 py-1 text-xs w-20 text-right font-mono"
                          value={line.quantityOrdered}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10) || 1;
                            setFormLines((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, quantityOrdered: val } : item
                              )
                            );
                          }}
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          className="border border-slate-200 rounded px-2 py-1 text-xs w-24 text-right font-mono"
                          value={(line.expectedCostPaisa / 100).toFixed(2)}
                          onChange={(e) => {
                            const val = parsePkrToPaisa(e.target.value || '0');
                            setFormLines((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, expectedCostPaisa: val } : item
                              )
                            );
                          }}
                        />
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-slate-800">
                        {formatPaisa(line.quantityOrdered * line.expectedCostPaisa)}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          className="text-slate-400 hover:text-red-600 p-1"
                          onClick={() => handleRemoveLine(idx)}
                          disabled={formLines.length === 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                  <tr>
                    <td className="p-2">Total:</td>
                    <td className="p-2 text-right font-mono">{totalQuantity}</td>
                    <td className="p-2"></td>
                    <td className="p-2 text-right font-mono text-emerald-800">
                      {formatPaisa(totalCostPaisa)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <Button variant="outline" size="sm" onClick={() => setIsDrawerOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleSubmitPO}
                disabled={drawerSubmitting}
              >
                Create Draft PO
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Low Stock Suggestions Modal */}
      {isLowStockModalOpen && (
        <Modal
          open={isLowStockModalOpen}
          onClose={() => setIsLowStockModalOpen(false)}
          title="Create PO from Low Stock Suggestions"
        >
          <div className="space-y-4 max-h-[75vh] overflow-y-auto p-1 text-xs">
            <p className="text-slate-600">
              The following products have stock at or below their configured reorder levels.
            </p>

            {loadingSuggestions ? (
              <div className="py-8 text-center text-slate-500">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-amber-500" />
                Scanning inventory stock levels...
              </div>
            ) : suggestions.length === 0 ? (
              <div className="py-8 text-center text-emerald-700 bg-emerald-50 rounded border border-emerald-200 p-4 font-medium">
                All products are comfortably above their reorder thresholds!
              </div>
            ) : (
              <table className="w-full border border-slate-200 divide-y divide-slate-200">
                <thead className="bg-slate-50 text-slate-700 font-semibold">
                  <tr>
                    <th className="p-2 text-left">Product</th>
                    <th className="p-2 text-right">Current Stock</th>
                    <th className="p-2 text-right">Reorder Level</th>
                    <th className="p-2 text-right">Suggested Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {suggestions.map((s) => (
                    <tr key={s.productId}>
                      <td className="p-2 font-semibold text-slate-900">{s.brandName}</td>
                      <td className="p-2 text-right font-mono text-red-600 font-bold">
                        {s.currentStock}
                      </td>
                      <td className="p-2 text-right font-mono text-slate-600">{s.reorderLevel}</td>
                      <td className="p-2 text-right font-mono font-bold text-emerald-700">
                        {s.suggestedQuantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <Button variant="outline" size="sm" onClick={() => setIsLowStockModalOpen(false)}>
                Close
              </Button>
              {suggestions.length > 0 && (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={applySuggestionsToDrawer}
                >
                  <Sparkles className="h-4 w-4 mr-1.5" /> Load into Draft PO
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
