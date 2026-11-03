import React, { useState, useEffect, useCallback } from 'react';
import type { StockTransferRecord, StockTransferLineRecord } from '../../types';
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
  ArrowLeft,
  Truck,
  Send,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  Building2,
  ShieldCheck,
} from 'lucide-react';
import {
  getTransferStatusDetails,
  validateReceiveTransferForm,
  type ReceiveLineInput,
} from '../../lib/transfer-utils';

interface StockTransferDetailPageProps {
  transferId: string;
  onBack: () => void;
  onRefreshList?: () => void;
}

export const StockTransferDetailPage: React.FC<StockTransferDetailPageProps> = ({
  transferId,
  onBack,
  onRefreshList,
}) => {
  const { can } = useAuth();
  const canCreate = can('inventory.transfer.create');

  const [transfer, setTransfer] = useState<StockTransferRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Receive Modal state
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [receiveLines, setReceiveLines] = useState<ReceiveLineInput[]>([]);
  const [receiveErrors, setReceiveErrors] = useState<Record<string, string>>({});
  const [receiveSubmitting, setReceiveSubmitting] = useState(false);

  const loadTransfer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: StockTransferRecord }>(
        `/api/stock-transfers/${transferId}`
      );
      setTransfer(res.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load transfer details';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [transferId]);

  useEffect(() => {
    loadTransfer();
  }, [loadTransfer]);

  // Dispatch Action
  const handleDispatch = async () => {
    if (!transfer) return;
    if (!window.confirm(`Are you sure you want to dispatch transfer ${transfer.transferNumber}? Stock will be moved to in-transit status.`)) {
      return;
    }

    setActionLoading(true);
    try {
      await apiFetch(`/api/stock-transfers/${transfer.id}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await loadTransfer();
      if (onRefreshList) onRefreshList();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to dispatch transfer';
      alert(msg);
    } finally {
      setActionLoading(false);
    }
  };

  // Cancel Action
  const handleCancel = async () => {
    if (!transfer) return;
    const reason = window.prompt('Enter cancellation reason:');
    if (reason === null) return;

    setActionLoading(true);
    try {
      await apiFetch(`/api/stock-transfers/${transfer.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      await loadTransfer();
      if (onRefreshList) onRefreshList();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel transfer';
      alert(msg);
    } finally {
      setActionLoading(false);
    }
  };

  // Open Receive Modal
  const openReceiveModal = () => {
    if (!transfer || !transfer.lines) return;
    const linesInit: ReceiveLineInput[] = transfer.lines.map((line) => ({
      lineId: line.id,
      quantityDispatched: line.quantityDispatched,
      quantityReceived: line.quantityDispatched, // default full receive
      shortageQuantity: 0,
      shortageReason: '',
    }));
    setReceiveLines(linesInit);
    setReceiveErrors({});
    setIsReceiveModalOpen(true);
  };

  const handleReceiveLineChange = (
    index: number,
    field: 'quantityReceived' | 'shortageQuantity' | 'shortageReason',
    value: string | number
  ) => {
    setReceiveLines((prev) => {
      const updated = [...prev];
      const cur = updated[index];
      if (!cur) return prev;
      const next: ReceiveLineInput = { ...cur };

      if (field === 'quantityReceived') {
        const val = parseInt(value as string, 10) || 0;
        next.quantityReceived = val;
        next.shortageQuantity = Math.max(0, next.quantityDispatched - val);
      } else if (field === 'shortageQuantity') {
        const val = parseInt(value as string, 10) || 0;
        next.shortageQuantity = val;
        next.quantityReceived = Math.max(0, next.quantityDispatched - val);
      } else if (field === 'shortageReason') {
        next.shortageReason = value as string;
      }

      updated[index] = next;
      return updated;
    });
  };

  const handleReceiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transfer) return;

    const validation = validateReceiveTransferForm(receiveLines);
    if (!validation.isValid) {
      setReceiveErrors(validation.errors);
      return;
    }

    setReceiveSubmitting(true);
    setReceiveErrors({});

    try {
      await apiFetch(`/api/stock-transfers/${transfer.id}/receive`, {
        method: 'POST',
        body: JSON.stringify({
          lines: receiveLines.map((l) => ({
            lineId: l.lineId,
            quantityReceived: l.quantityReceived,
            shortageQuantity: l.shortageQuantity,
            shortageReason: l.shortageReason || undefined,
          })),
        }),
      });

      setIsReceiveModalOpen(false);
      await loadTransfer();
      if (onRefreshList) onRefreshList();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record receipt';
      setReceiveErrors({ general: msg });
    } finally {
      setReceiveSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
        <span className="text-sm font-medium">Loading transfer details...</span>
      </div>
    );
  }

  if (error || !transfer) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Transfers
        </Button>
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
          {error || 'Transfer not found'}
        </div>
      </div>
    );
  }

  const statusMeta = getTransferStatusDetails(transfer.status);
  const isInterBranch = transfer.sourceBranchId !== transfer.destinationBranchId;

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{transfer.transferNumber}</h1>
              <Badge className={statusMeta.badgeClass}>{statusMeta.label}</Badge>
              {transfer.hasShortage && (
                <Badge className="bg-amber-100 text-amber-800 border-amber-300">
                  Shortage Recorded
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Created on {new Date(transfer.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {transfer.status === 'draft' && canCreate && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={actionLoading}
                className="text-rose-600 border-rose-300 hover:bg-rose-50"
              >
                <XCircle className="w-4 h-4 mr-1.5" /> Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleDispatch}
                disabled={actionLoading}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Send className="w-4 h-4 mr-1.5" /> Dispatch Transfer
              </Button>
            </>
          )}

          {transfer.status === 'in_transit' && canCreate && (
            <Button
              size="sm"
              onClick={openReceiveModal}
              disabled={actionLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" /> Receive Stock
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={loadTransfer} disabled={actionLoading}>
            <RefreshCw className={`w-4 h-4 ${actionLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* In-Transit Alert */}
      {transfer.status === 'in_transit' && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-3">
          <Truck className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <h4 className="font-semibold text-blue-900">Stock is In Transit</h4>
            <p className="text-blue-700 mt-0.5">
              These items have been deducted from source branch inventory and are currently{' '}
              <strong>not sellable</strong> at either branch. Once verified upon physical arrival at the
              destination, click <strong>Receive Stock</strong> to complete the transfer and add items to sellable stock.
            </p>
          </div>
        </div>
      )}

      {/* Transfer Information Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Source */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase tracking-wider">
              <Building2 className="w-4 h-4 text-slate-400" /> Source Location
            </div>
            <div className="text-lg font-bold text-slate-900">
              {transfer.sourceBranchName || transfer.sourceBranchId}
            </div>
            <div className="text-sm text-slate-600 flex items-center gap-1.5">
              <span className="text-slate-400">Shelf / Zone:</span>
              <span className="font-medium">
                {transfer.sourceLocationName || 'Default Branch Storage'}
              </span>
            </div>
            {transfer.dispatchedAt && (
              <div className="text-xs text-slate-500 pt-1 border-t border-slate-100 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Dispatched:{' '}
                {new Date(transfer.dispatchedAt).toLocaleString()}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Destination */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase tracking-wider">
              <Building2 className="w-4 h-4 text-blue-500" /> Destination Location
            </div>
            <div className="text-lg font-bold text-slate-900">
              {transfer.destinationBranchName || transfer.destinationBranchId}
            </div>
            <div className="text-sm text-slate-600 flex items-center gap-1.5">
              <span className="text-slate-400">Shelf / Zone:</span>
              <span className="font-medium">
                {transfer.destinationLocationName || 'Default Branch Storage'}
              </span>
            </div>
            {transfer.receivedAt ? (
              <div className="text-xs text-emerald-700 pt-1 border-t border-slate-100 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Received:{' '}
                {new Date(transfer.receivedAt).toLocaleString()}
              </div>
            ) : (
              <div className="text-xs text-slate-400 pt-1 border-t border-slate-100">
                Awaiting physical delivery & inspection
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Accounting & Nature Info */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>
            {isInterBranch
              ? 'Inter-Branch Transfer: Posts balanced inventory entry across branches with 0 P&L effect.'
              : 'Intra-Branch Transfer: Internal shelf realignment within the same branch (no GL entry required).'}
          </span>
        </div>
        {transfer.notes && (
          <span className="italic text-slate-500">Note: &quot;{transfer.notes}&quot;</span>
        )}
      </div>

      {/* Lines Table */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-800 text-sm flex items-center justify-between">
            <span>Transfer Items ({transfer.lines?.length || 0})</span>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Batch No</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead className="text-right">Requested</TableHead>
                <TableHead className="text-right">Dispatched</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Shortage</TableHead>
                <TableHead>Shortage Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfer.lines?.map((line: StockTransferLineRecord) => (
                <TableRow key={line.id}>
                  <TableCell className="font-medium text-slate-900">
                    <div>{line.product?.brandName || 'Product'}</div>
                    {line.product?.genericName && (
                      <div className="text-xs text-slate-400">{line.product.genericName}</div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {line.batch?.batchNo || '—'}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {line.batch?.expiryDate || '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium text-slate-700">
                    {line.quantityRequested}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-slate-900">
                    {line.quantityDispatched}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-emerald-700">
                    {line.quantityReceived}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {line.shortageQuantity > 0 ? (
                      <span className="text-rose-600">-{line.shortageQuantity}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600 max-w-xs truncate">
                    {line.shortageReason || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Receive Modal */}
      <Modal
        open={isReceiveModalOpen}
        onClose={() => setIsReceiveModalOpen(false)}
        title={`Receive Stock Transfer: ${transfer.transferNumber}`}
      >
        <form onSubmit={handleReceiveSubmit} className="space-y-4">
          <p className="text-xs text-slate-500">
            Verify count for each batch. If items were damaged or lost in transit, enter the shortage
            and provide a reason.
          </p>

          {receiveErrors.general && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs">
              {receiveErrors.general}
            </div>
          )}

          <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
            {receiveLines.map((line, idx) => {
              const originalLine = transfer.lines?.[idx];
              const balanceError = receiveErrors[`line_${idx}_balance`];
              const reasonError = receiveErrors[`line_${idx}_reason`];

              return (
                <div
                  key={line.lineId}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between font-semibold text-slate-800">
                    <span>{originalLine?.product?.brandName || 'Item'}</span>
                    <span className="text-slate-500 font-normal">
                      Dispatched: <strong>{line.quantityDispatched}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-slate-600 font-medium mb-1">
                        Received Count *
                      </label>
                      <Input
                        type="number"
                        min="0"
                        max={line.quantityDispatched}
                        value={line.quantityReceived}
                        onChange={(e) =>
                          handleReceiveLineChange(idx, 'quantityReceived', e.target.value)
                        }
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">
                        Shortage / Damaged
                      </label>
                      <Input
                        type="number"
                        min="0"
                        max={line.quantityDispatched}
                        value={line.shortageQuantity}
                        onChange={(e) =>
                          handleReceiveLineChange(idx, 'shortageQuantity', e.target.value)
                        }
                      />
                    </div>
                  </div>

                  {balanceError && (
                    <div className="text-rose-600 text-xs font-medium">{balanceError}</div>
                  )}

                  {line.shortageQuantity > 0 && (
                    <div className="pt-1">
                      <label className="block text-slate-600 font-medium mb-1">
                        Shortage Reason *
                      </label>
                      <Input
                        value={line.shortageReason || ''}
                        onChange={(e) =>
                          handleReceiveLineChange(idx, 'shortageReason', e.target.value)
                        }
                        placeholder="e.g. Broken ampoules, carton crushed during transit"
                      />
                      {reasonError && (
                        <div className="text-rose-600 text-xs font-medium mt-0.5">{reasonError}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsReceiveModalOpen(false)}
              disabled={receiveSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={receiveSubmitting}>
              {receiveSubmitting ? 'Recording Receipt...' : 'Confirm Stock Receipt'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
