import React, { useState, useEffect, useCallback } from 'react';
import type { PurchaseOrderRecord } from '../../types';
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
  ArrowLeft,
  RefreshCw,
  Printer,
  CheckCircle2,
  Send,
  Ban,
  PackageCheck,
  Calendar,
  AlertTriangle,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { canApprovePO, canManagePO, canReceivePO, getPOStatusDetails } from '../../lib/po-utils';

interface PurchaseOrderDetailPageProps {
  poId: string;
  onBack: () => void;
}

interface ReceiveLineInput {
  poLineId: string;
  productId: string;
  brandName: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  costPaisa: number;
  mrpPaisa: number;
  remainingQty: number;
}

export const PurchaseOrderDetailPage: React.FC<PurchaseOrderDetailPageProps> = ({
  poId,
  onBack,
}) => {
  const { user } = useAuth();
  const userRole = user?.role;

  const [po, setPo] = useState<PurchaseOrderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Modals
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [receiveLines, setReceiveLines] = useState<ReceiveLineInput[]>([]);
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [receiptDate, setReceiptDate] = useState(() => getKarachiBusinessDate());
  const [receiveError, setReceiveError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: PurchaseOrderRecord }>(`/api/purchase-orders/${poId}`);
      setPo(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load purchase order details');
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleApprove = async () => {
    if (!window.confirm('Are you sure you want to approve this purchase order?')) return;
    setActionLoading(true);
    try {
      await apiFetch(`/api/purchase-orders/${poId}/approve`, { method: 'POST' });
      await fetchDetail();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to approve purchase order');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSend = async () => {
    if (!window.confirm('Mark this purchase order as sent to the supplier?')) return;
    setActionLoading(true);
    try {
      await apiFetch(`/api/purchase-orders/${poId}/send`, { method: 'POST' });
      await fetchDetail();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to mark as sent');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    const reason = window.prompt('Please provide a reason for cancelling this purchase order:');
    if (reason === null) return;
    setActionLoading(true);
    try {
      await apiFetch(`/api/purchase-orders/${poId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await fetchDetail();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to cancel purchase order');
    } finally {
      setActionLoading(false);
    }
  };

  const openReceiveModal = () => {
    if (!po?.lines) return;
    const initial: ReceiveLineInput[] = po.lines.map((l) => {
      const remaining = Math.max(0, l.quantityOrdered - l.quantityReceived);
      const defaultExpiry = new Date();
      defaultExpiry.setFullYear(defaultExpiry.getFullYear() + 2);

      return {
        poLineId: l.id,
        productId: l.productId,
        brandName: l.product?.brandName || 'Product',
        batchNo: `BATCH-${Date.now().toString().slice(-4)}`,
        expiryDate: getKarachiBusinessDate(defaultExpiry),
        quantity: remaining,
        costPaisa: l.expectedCostPaisa,
        mrpPaisa: l.product?.mrpPaisa || Math.round(l.expectedCostPaisa * 1.25),
        remainingQty: remaining,
      };
    });
    setReceiveLines(initial);
    setSupplierInvoiceNo('');
    setReceiptDate(getKarachiBusinessDate());
    setReceiveError(null);
    setIsReceiveModalOpen(true);
  };

  const submitReceipt = async () => {
    if (!supplierInvoiceNo.trim()) {
      setReceiveError('Supplier Invoice # / Delivery Note is required');
      return;
    }

    const activeLines = receiveLines.filter((l) => l.quantity > 0);
    if (activeLines.length === 0) {
      setReceiveError('At least one item must have a quantity > 0 to receive');
      return;
    }

    setActionLoading(true);
    setReceiveError(null);
    try {
      await apiFetch(`/api/purchase-orders/${poId}/receive`, {
        method: 'POST',
        body: JSON.stringify({
          supplierInvoiceNo: supplierInvoiceNo.trim(),
          receiptDate,
          lines: activeLines.map((l) => ({
            poLineId: l.poLineId,
            productId: l.productId,
            batchNo: l.batchNo.trim(),
            expiryDate: l.expiryDate,
            quantity: l.quantity,
            costPaisa: l.costPaisa,
            mrpPaisa: l.mrpPaisa,
          })),
        }),
      });

      setIsReceiveModalOpen(false);
      await fetchDetail();
    } catch (err: unknown) {
      setReceiveError(err instanceof Error ? err.message : 'Failed to record goods receipt');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-500">
        <RefreshCw className="h-8 w-8 animate-spin mb-4 text-emerald-600" />
        <p>Loading purchase order details...</p>
      </div>
    );
  }

  if (error || !po) {
    return (
      <div className="p-6">
        <Button variant="outline" onClick={onBack} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Orders
        </Button>
        <Card className="border-red-200 bg-red-50 text-red-800">
          <CardContent className="p-6">
            <h3 className="font-bold flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" /> Error Loading Order
            </h3>
            <p className="mt-2 text-sm">{error || 'Purchase order not found'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusBadge = getPOStatusDetails(po.status);
  const isDraft = po.status === 'draft';
  const isApproved = po.status === 'approved';
  const isReceivable = ['approved', 'sent', 'partially_received'].includes(po.status);
  const canCancel =
    ['draft', 'approved', 'sent'].includes(po.status) &&
    (po.lines?.every((l) => l.quantityReceived === 0) ?? true);

  return (
    <div className="p-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Orders
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{po.poNumber}</h1>
              <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            </div>
            <p className="text-sm text-slate-500">
              Supplier:{' '}
              <span className="font-semibold text-slate-700">{po.supplierName || 'Supplier'}</span>{' '}
              | Branch: {po.branchName || 'Main'}
            </p>
          </div>
        </div>

        {/* Workflow Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setIsPrintModalOpen(true)}>
            <Printer className="h-4 w-4 mr-1.5" /> Print / PDF
          </Button>

          {isDraft && canApprovePO(userRole) && (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleApprove}
              disabled={actionLoading}
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" /> Approve Order
            </Button>
          )}

          {isApproved && canManagePO(userRole) && (
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={handleSend}
              disabled={actionLoading}
            >
              <Send className="h-4 w-4 mr-1.5" /> Mark as Sent
            </Button>
          )}

          {isReceivable && canReceivePO(userRole) && (
            <Button
              size="sm"
              className="bg-purple-600 hover:bg-purple-700 text-white"
              onClick={openReceiveModal}
              disabled={actionLoading}
            >
              <PackageCheck className="h-4 w-4 mr-1.5" /> Receive Goods (GRN)
            </Button>
          )}

          {canCancel && canManagePO(userRole) && (
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 border-red-300 hover:bg-red-50"
              onClick={handleCancel}
              disabled={actionLoading}
            >
              <Ban className="h-4 w-4 mr-1.5" /> Cancel Order
            </Button>
          )}
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <span className="text-xs font-medium text-slate-500 uppercase">
              Total Expected Cost
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
              {formatPaisa(po.totalExpectedCostPaisa)}
            </div>
            <div className="text-xs text-slate-400 mt-1">PKR Value</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <span className="text-xs font-medium text-slate-500 uppercase">Issue Date</span>
            <div className="text-lg font-semibold text-slate-800 mt-1 flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-emerald-600" />
              {formatKarachiDateOnly(po.issueDate)}
            </div>
            <div className="text-xs text-slate-400 mt-1">Order Date</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <span className="text-xs font-medium text-slate-500 uppercase">Expected Delivery</span>
            <div className="text-lg font-semibold text-slate-800 mt-1 flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-blue-600" />
              {po.expectedDeliveryDate
                ? formatKarachiDateOnly(po.expectedDeliveryDate)
                : 'Not specified'}
            </div>
            <div className="text-xs text-slate-400 mt-1">Due Date</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <span className="text-xs font-medium text-slate-500 uppercase">
              Over-Receipt Policy
            </span>
            <div className="text-lg font-semibold text-slate-800 mt-1 capitalize flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-amber-600" />
              {po.overReceiptPolicy === 'reject' ? 'Strict Reject' : 'Flag & Accept'}
            </div>
            <div className="text-xs text-slate-400 mt-1">Policy on deliveries</div>
          </CardContent>
        </Card>
      </div>

      {/* PO Line Items Table */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-slate-200 flex justify-between items-center">
            <h2 className="text-lg font-bold text-slate-900">Ordered Products</h2>
            <Badge variant="outline">{po.lines?.length || 0} line items</Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/75">
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Ordered Qty</TableHead>
                <TableHead className="text-right">Received Qty</TableHead>
                <TableHead className="text-center">Fulfillment</TableHead>
                <TableHead className="text-right">Expected Cost (PKR)</TableHead>
                <TableHead className="text-right">Line Total (PKR)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.lines && po.lines.length > 0 ? (
                po.lines.map((l) => {
                  const pct = Math.min(
                    100,
                    Math.round((l.quantityReceived / l.quantityOrdered) * 100)
                  );
                  const isOver = l.quantityReceived > l.quantityOrdered;

                  return (
                    <TableRow key={l.id} className="hover:bg-slate-50">
                      <TableCell>
                        <div className="font-semibold text-slate-900">{l.product?.brandName}</div>
                        {l.product?.genericName && (
                          <div className="text-xs text-slate-500">{l.product.genericName}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {l.quantityOrdered}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        <span className={isOver ? 'text-amber-600 font-bold' : ''}>
                          {l.quantityReceived}
                        </span>
                        {isOver && <span className="ml-1 text-xs text-amber-600">(Over)</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-24 bg-slate-200 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-2 rounded-full ${
                                pct === 100
                                  ? 'bg-emerald-600'
                                  : isOver
                                    ? 'bg-amber-500'
                                    : 'bg-blue-600'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono text-slate-600">{pct}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPaisa(l.expectedCostPaisa)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        {formatPaisa(l.totalCostPaisa)}
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-6 text-slate-500">
                    No line items found for this order
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Receiving Deliveries History */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-slate-200 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Goods Receiving History</h2>
              <p className="text-xs text-slate-500">
                Deliveries received against this purchase order (Payable posted)
              </p>
            </div>
            <Badge variant="outline">{po.receipts?.length || 0} deliveries</Badge>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/75">
                <TableHead>Receipt Date</TableHead>
                <TableHead>Supplier Invoice / GRN #</TableHead>
                <TableHead className="text-right">Total Payable Amount</TableHead>
                <TableHead>Recorded At (UTC)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.receipts && po.receipts.length > 0 ? (
                po.receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-slate-800">
                      {formatKarachiDateOnly(r.receiptDate)}
                    </TableCell>
                    <TableCell className="font-mono text-emerald-700 font-semibold">
                      {r.supplierInvoiceNo}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-slate-900">
                      {formatPaisa(r.totalCostPaisa)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 font-mono">
                      {r.createdAt.slice(0, 19).replace('T', ' ')}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-6 text-slate-400 text-sm">
                    No deliveries have been recorded yet for this purchase order.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Receive Goods Modal */}
      {isReceiveModalOpen && (
        <Modal
          open={isReceiveModalOpen}
          onClose={() => setIsReceiveModalOpen(false)}
          title={`Receive Goods against ${po.poNumber}`}
        >
          <div className="space-y-4 max-h-[75vh] overflow-y-auto p-1">
            {receiveError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
                {receiveError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Supplier Invoice # / Delivery Note <span className="text-red-500">*</span>
                </label>
                <Input
                  placeholder="e.g. INV-9042"
                  value={supplierInvoiceNo}
                  onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Receipt Date
                </label>
                <Input
                  type="date"
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.target.value)}
                />
              </div>
            </div>

            <div className="border border-slate-200 rounded-md overflow-hidden">
              <div className="bg-slate-100 p-2 font-semibold text-xs text-slate-700">
                Delivery Line Items
              </div>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="p-2 text-left">Product</th>
                    <th className="p-2 text-left">Batch #</th>
                    <th className="p-2 text-left">Expiry</th>
                    <th className="p-2 text-right">Qty Receiving</th>
                    <th className="p-2 text-right">Cost (PKR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receiveLines.map((line, idx) => (
                    <tr key={line.poLineId}>
                      <td className="p-2">
                        <div className="font-semibold text-slate-900">{line.brandName}</div>
                        <div className="text-[10px] text-slate-500">
                          Remaining: {line.remainingQty}
                        </div>
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          className="border border-slate-200 rounded px-1.5 py-1 w-28 text-xs font-mono"
                          value={line.batchNo}
                          onChange={(e) => {
                            const val = e.target.value;
                            setReceiveLines((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, batchNo: val } : item))
                            );
                          }}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="date"
                          className="border border-slate-200 rounded px-1.5 py-1 text-xs"
                          value={line.expiryDate}
                          onChange={(e) => {
                            const val = e.target.value;
                            setReceiveLines((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, expiryDate: val } : item
                              )
                            );
                          }}
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          min="0"
                          className="border border-slate-200 rounded px-1.5 py-1 w-20 text-xs font-mono text-right"
                          value={line.quantity}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10) || 0;
                            setReceiveLines((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, quantity: val } : item))
                            );
                          }}
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          className="border border-slate-200 rounded px-1.5 py-1 w-24 text-xs font-mono text-right"
                          value={(line.costPaisa / 100).toFixed(2)}
                          onChange={(e) => {
                            const val = parsePkrToPaisa(e.target.value || '0');
                            setReceiveLines((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, costPaisa: val } : item
                              )
                            );
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <Button variant="outline" size="sm" onClick={() => setIsReceiveModalOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={submitReceipt}
                disabled={actionLoading}
              >
                Confirm Receipt & Post Payable
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Print / PDF Modal */}
      {isPrintModalOpen && (
        <Modal
          open={isPrintModalOpen}
          onClose={() => setIsPrintModalOpen(false)}
          title={`Purchase Order: ${po.poNumber}`}
        >
          <div className="p-4 space-y-6 text-slate-800 font-sans print:p-0">
            {/* Header */}
            <div className="flex justify-between items-start border-b border-slate-300 pb-4">
              <div>
                <h1 className="text-xl font-bold uppercase tracking-wider text-emerald-800">
                  Purchase Order
                </h1>
                <p className="text-xs text-slate-500 mt-1">Official Document</p>
                <div className="text-sm font-semibold mt-2">Branch: {po.branchName || 'Main'}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-mono font-bold text-slate-900">{po.poNumber}</div>
                <div className="text-xs text-slate-500 mt-1">Date: {po.issueDate}</div>
                {po.expectedDeliveryDate && (
                  <div className="text-xs text-slate-500">
                    Delivery Due: {po.expectedDeliveryDate}
                  </div>
                )}
              </div>
            </div>

            {/* Vendor Details */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <span className="font-bold uppercase text-slate-500 block mb-1">
                  Vendor / Supplier
                </span>
                <div className="font-semibold text-slate-800 text-sm">{po.supplierName}</div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <span className="font-bold uppercase text-slate-500 block mb-1">
                  Status & Terms
                </span>
                <div>
                  Status: <span className="font-semibold uppercase">{po.status}</span>
                </div>
                <div>
                  Policy: <span className="capitalize">{po.overReceiptPolicy}</span>
                </div>
              </div>
            </div>

            {/* Items Table */}
            <table className="w-full text-xs border border-slate-200">
              <thead className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                <tr>
                  <th className="p-2 text-left">Item / Brand</th>
                  <th className="p-2 text-right">Quantity</th>
                  <th className="p-2 text-right">Unit Expected (PKR)</th>
                  <th className="p-2 text-right">Amount (PKR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {po.lines?.map((line) => (
                  <tr key={line.id}>
                    <td className="p-2 font-medium">{line.product?.brandName}</td>
                    <td className="p-2 text-right font-mono">{line.quantityOrdered}</td>
                    <td className="p-2 text-right font-mono">
                      {formatPaisa(line.expectedCostPaisa)}
                    </td>
                    <td className="p-2 text-right font-mono font-semibold">
                      {formatPaisa(line.totalCostPaisa)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                <tr>
                  <td colSpan={3} className="p-2 text-right uppercase">
                    Total Expected Amount:
                  </td>
                  <td className="p-2 text-right font-mono text-emerald-800 font-bold">
                    {formatPaisa(po.totalExpectedCostPaisa)}
                  </td>
                </tr>
              </tfoot>
            </table>

            {/* Signatures */}
            <div className="grid grid-cols-2 gap-8 pt-8 text-xs text-center">
              <div>
                <div className="border-t border-slate-400 pt-1 font-semibold">Prepared By</div>
                <div className="text-slate-500">{po.creatorName || 'Authorized Staff'}</div>
              </div>
              <div>
                <div className="border-t border-slate-400 pt-1 font-semibold">
                  Approved By (Manager / Owner)
                </div>
                <div className="text-slate-500">
                  {po.approvedAt ? 'Digitally Approved' : 'Pending Approval'}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 print:hidden">
              <Button variant="outline" size="sm" onClick={() => setIsPrintModalOpen(false)}>
                Close
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => window.print()}
              >
                <Printer className="h-4 w-4 mr-1.5" /> Print / Save as PDF
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
