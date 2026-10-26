import React, { useState, useEffect, useCallback } from 'react';
import type { AuthSession, InvoiceRecord, CreditNoteRecord } from '@pos/shared';
import { formatPKR } from '@pos/shared';
import { generateThermalReceiptHtml } from '../../utils/receiptGenerator';
import { ReturnModal } from './ReturnModal';

interface InvoiceHistoryScreenProps {
  session: AuthSession;
}

export const InvoiceHistoryScreen: React.FC<InvoiceHistoryScreenProps> = ({ session }) => {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'week' | 'custom'>('today');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [invoiceForReturn, setInvoiceForReturn] = useState<InvoiceRecord | null>(null);
  const [showBatchOnReprint, setShowBatchOnReprint] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [reprintingId, setReprintingId] = useState<string | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Compute dates based on filter preset
  const getDateRange = useCallback(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    if (dateFilter === 'today') {
      return { dateFrom: todayStr, dateTo: todayStr };
    }
    if (dateFilter === 'yesterday') {
      const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yStr = y.toISOString().slice(0, 10);
      return { dateFrom: yStr, dateTo: yStr };
    }
    if (dateFilter === 'week') {
      const w = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { dateFrom: w.toISOString().slice(0, 10), dateTo: todayStr };
    }
    if (dateFilter === 'custom') {
      return {
        dateFrom: customDateFrom || undefined,
        dateTo: customDateTo || undefined,
      };
    }
    return { dateFrom: undefined, dateTo: undefined };
  }, [dateFilter, customDateFrom, customDateTo]);

  // Fetch invoices from IPC
  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const { dateFrom, dateTo } = getDateRange();
      const results = await window.api.invoices.searchInvoices({
        query: searchQuery.trim() || undefined,
        dateFrom,
        dateTo,
        limit: 100,
        offset: 0,
      });
      setInvoices(results);
    } catch (err: unknown) {
      console.error('[InvoiceHistory] Failed to search invoices:', err);
      setToastMessage('⚠️ Failed to load invoice history.');
    } finally {
      setLoading(false);
    }
  }, [getDateRange, searchQuery]);

  useEffect(() => {
    const handler = setTimeout(() => {
      loadInvoices();
    }, 200);
    return () => clearTimeout(handler);
  }, [loadInvoices]);

  // Handle thermal reprint
  const handleReprint = async (inv: InvoiceRecord) => {
    setReprintingId(inv.id);
    try {
      const receiptHtml = generateThermalReceiptHtml(
        {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          createdAt: inv.createdAt,
          subtotalPaisa: inv.subtotalPaisa,
          discountPaisa: inv.discountPaisa,
          taxPaisa: inv.taxPaisa,
          totalPaisa: inv.grandTotalPaisa,
          notes: inv.notes,
          customerName: inv.customerName,
          cashierName: inv.userName || session.user.name,
          counterName: inv.counterName || session.counter.name,
          branchName: session.branch.name,
          lines: (inv.lines || []).map((l) => ({
            id: l.id,
            brandName: l.brandName,
            genericName: l.genericName,
            batchNo: l.batchNo,
            expiryDate: l.expiryDate,
            quantity: l.quantity,
            unitPricePaisa: l.unitPricePaisa,
            discountPaisa: l.discountPaisa,
            taxPaisa: l.taxPaisa,
            lineTotalPaisa: l.lineTotalPaisa,
          })),
          payments: (inv.payments && inv.payments.length > 0
            ? inv.payments
            : inv.payment
            ? [inv.payment]
            : []
          ).map((p) => ({
            method: (p.paymentMethod === 'bank' ? 'wallet' : p.paymentMethod) as 'cash' | 'card' | 'wallet',
            amountPaisa: p.amountPaisa,
            tenderedPaisa: p.tenderedPaisa,
            changePaisa: p.changePaisa,
          })),
        },
        { showBatchExpiry: showBatchOnReprint }
      );

      const res = await window.api.invoices.printReceipt(receiptHtml);
      if (res.success) {
        setToastMessage(`✅ Receipt #${inv.invoiceNumber} reprinted successfully.`);
      } else {
        setToastMessage(`⚠️ Reprint failed: ${res.error || 'Printer error'}`);
      }
    } catch (err: unknown) {
      console.error('[Reprint] Error:', err);
      setToastMessage(`⚠️ Reprint error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReprintingId(null);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#f8fafc',
        padding: '20px',
        overflow: 'hidden',
      }}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '24px',
            zIndex: 100,
            padding: '12px 20px',
            backgroundColor: '#0f172a',
            color: '#ffffff',
            borderRadius: '8px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* Screen Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
            🧾 Invoices & Sales History
          </h2>
          <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
            Lookup customer receipts, review finalized items, and reprint thermal slips.
          </div>
        </div>

        <button
          type="button"
          onClick={loadInvoices}
          disabled={loading}
          style={{
            padding: '8px 16px',
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 600,
            color: '#334155',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Refreshing...' : '🔄 Refresh'}
        </button>
      </div>

      {/* Filter Toolbar */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          padding: '14px 18px',
          border: '1px solid #e2e8f0',
          marginBottom: '16px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          alignItems: 'center',
        }}
      >
        {/* Search input */}
        <div style={{ flex: '1 1 240px', minWidth: '220px' }}>
          <input
            type="text"
            placeholder="Search by invoice # (e.g. C1-000001) or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
            }}
          />
        </div>

        {/* Date presets */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {[
            { id: 'today', label: 'Today' },
            { id: 'yesterday', label: 'Yesterday' },
            { id: 'week', label: 'Last 7 Days' },
            { id: 'all', label: 'All Time' },
            { id: 'custom', label: 'Custom Range' },
          ].map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setDateFilter(preset.id as typeof dateFilter)}
              style={{
                padding: '7px 12px',
                borderRadius: '6px',
                border: dateFilter === preset.id ? '1px solid #2563eb' : '1px solid #e2e8f0',
                backgroundColor: dateFilter === preset.id ? '#eff6ff' : '#ffffff',
                color: dateFilter === preset.id ? '#1d4ed8' : '#475569',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Custom Date Pickers */}
        {dateFilter === 'custom' && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="date"
              value={customDateFrom}
              onChange={(e) => setCustomDateFrom(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
              }}
            />
            <span style={{ fontSize: '12px', color: '#64748b' }}>to</span>
            <input
              type="date"
              value={customDateTo}
              onChange={(e) => setCustomDateTo(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
              }}
            />
          </div>
        )}
      </div>

      {/* Invoices Table Container */}
      <div
        style={{
          flex: 1,
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead
              style={{
                position: 'sticky',
                top: 0,
                backgroundColor: '#f1f5f9',
                borderBottom: '1px solid #cbd5e1',
                zIndex: 10,
              }}
            >
              <tr>
                <th style={{ padding: '12px 16px', fontWeight: 700, color: '#334155' }}>Invoice #</th>
                <th style={{ padding: '12px 16px', fontWeight: 700, color: '#334155' }}>Date & Time</th>
                <th style={{ padding: '12px 16px', fontWeight: 700, color: '#334155' }}>Items</th>
                <th style={{ padding: '12px 16px', fontWeight: 700, color: '#334155' }}>Cashier / Counter</th>
                <th style={{ padding: '12px 16px', fontWeight: 700, color: '#334155' }}>Payment Method</th>
                <th style={{ padding: '12px 16px', fontWeight: 700, color: '#334155', textAlign: 'right' }}>
                  Total
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 700, color: '#334155', textAlign: 'center' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                    {loading ? 'Loading invoices...' : 'No invoices found for the selected criteria.'}
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => {
                  const dateStr = new Date(inv.createdAt).toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Karachi',
                  });
                  const isReprinting = reprintingId === inv.id;

                  // Format payment method summary
                  const payList = inv.payments && inv.payments.length > 0 ? inv.payments : inv.payment ? [inv.payment] : [];
                  const paySummary =
                    payList.length > 1
                      ? `Split (${payList.map((p) => p.paymentMethod).join(', ')})`
                      : payList[0]?.paymentMethod || 'cash';

                  return (
                    <tr
                      key={inv.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                      }}
                    >
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0f172a' }}>
                        {inv.invoiceNumber}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#475569' }}>{dateStr}</td>
                      <td style={{ padding: '12px 16px', color: '#334155' }}>
                        {inv.lines?.length || 0} item{(inv.lines?.length || 0) === 1 ? '' : 's'}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#64748b' }}>
                        {inv.userName || 'Cashier'} • {inv.counterName || 'Counter'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '12px',
                            backgroundColor: '#e0f2fe',
                            color: '#0369a1',
                            fontSize: '11px',
                            fontWeight: 600,
                            textTransform: 'capitalize',
                          }}
                        >
                          {paySummary}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontWeight: 700,
                          fontFamily: 'Consolas, monospace',
                          color: '#0f172a',
                        }}
                      >
                        {formatPKR(inv.grandTotalPaisa)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => setSelectedInvoice(inv)}
                            style={{
                              padding: '5px 10px',
                              backgroundColor: '#ffffff',
                              border: '1px solid #cbd5e1',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 600,
                              color: '#2563eb',
                              cursor: 'pointer',
                            }}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => setInvoiceForReturn(inv)}
                            style={{
                              padding: '5px 10px',
                              backgroundColor: '#fff1f2',
                              border: '1px solid #fecdd3',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 600,
                              color: '#e11d48',
                              cursor: 'pointer',
                            }}
                          >
                            🔄 Return
                          </button>
                          <button
                            type="button"
                            disabled={isReprinting}
                            onClick={() => handleReprint(inv)}
                            style={{
                              padding: '5px 12px',
                              backgroundColor: '#0f172a',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 600,
                              color: '#ffffff',
                              cursor: isReprinting ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {isReprinting ? 'Printing...' : '🖨️ Reprint'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice Details Modal */}
      {selectedInvoice && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
            padding: '20px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedInvoice(null);
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              width: '680px',
              maxWidth: '100%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
              overflow: 'hidden',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 20px',
                backgroundColor: '#0f172a',
                color: '#ffffff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>
                  Invoice #{selectedInvoice.invoiceNumber}
                </h3>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  {new Date(selectedInvoice.createdAt).toLocaleString('en-GB', {
                    timeZone: 'Asia/Karachi',
                  })}{' '}
                  • Finalized & Immutable
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '20px',
                  color: '#94a3b8',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body: Lines & Totals */}
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
              {selectedInvoice.notes && (
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#f1f5f9',
                    borderRadius: '6px',
                    fontSize: '12px',
                    marginBottom: '14px',
                    color: '#334155',
                  }}
                >
                  <strong>Notes:</strong> {selectedInvoice.notes}
                </div>
              )}

              {/* Items List */}
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#475569', marginBottom: '8px' }}>
                Purchased Items ({selectedInvoice.lines?.length || 0})
              </div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Item & Batch</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>Qty</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Unit Price</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Discount</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedInvoice.lines || []).map((l) => (
                      <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>
                            {l.brandName || l.genericName || 'Product'}
                          </div>
                          {(l.batchNo || l.expiryDate) && (
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              Batch: {l.batchNo || 'N/A'} • Exp: {l.expiryDate || 'N/A'}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>
                          {l.quantity}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                          {formatPKR(l.unitPricePaisa)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#b91c1c' }}>
                          {l.discountPaisa > 0 ? `-${formatPKR(l.discountPaisa)}` : '—'}
                        </td>
                        <td
                          style={{
                            padding: '8px 12px',
                            textAlign: 'right',
                            fontWeight: 700,
                            fontFamily: 'monospace',
                          }}
                        >
                          {formatPKR(l.lineTotalPaisa)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial Totals Breakdown */}
              <div
                style={{
                  marginTop: '16px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '12px 16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '13px' }}>
                  <span style={{ color: '#64748b' }}>Subtotal:</span>
                  <span>{formatPKR(selectedInvoice.subtotalPaisa)}</span>
                </div>
                {selectedInvoice.discountPaisa > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '13px' }}>
                    <span style={{ color: '#64748b' }}>Total Discount:</span>
                    <span style={{ color: '#b91c1c' }}>-{formatPKR(selectedInvoice.discountPaisa)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                  <span style={{ color: '#64748b' }}>Total Tax:</span>
                  <span>{formatPKR(selectedInvoice.taxPaisa)}</span>
                </div>
                <div
                  style={{
                    borderTop: '1px solid #cbd5e1',
                    paddingTop: '6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '16px',
                    fontWeight: 700,
                  }}
                >
                  <span>Grand Total:</span>
                  <span style={{ color: '#16a34a', fontFamily: 'Consolas, monospace' }}>
                    {formatPKR(selectedInvoice.grandTotalPaisa)}
                  </span>
                </div>
              </div>

              {/* Payment Details */}
              <div style={{ marginTop: '14px', fontSize: '12px', color: '#64748b' }}>
                <strong>Payments Recorded:</strong>{' '}
                {(selectedInvoice.payments && selectedInvoice.payments.length > 0
                  ? selectedInvoice.payments
                  : selectedInvoice.payment
                  ? [selectedInvoice.payment]
                  : []
                )
                  .map((p) => `${p.paymentMethod.toUpperCase()}: ${formatPKR(p.amountPaisa)}`)
                  .join(' | ')}
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '14px 20px',
                backgroundColor: '#f1f5f9',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showBatchOnReprint}
                  onChange={(e) => setShowBatchOnReprint(e.target.checked)}
                />
                <span>Include batch & expiry on receipt</span>
              </label>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    const inv = selectedInvoice;
                    setSelectedInvoice(null);
                    setInvoiceForReturn(inv);
                  }}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: '#fff1f2',
                    border: '1px solid #fecdd3',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#e11d48',
                    cursor: 'pointer',
                  }}
                >
                  🔄 Process Return
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedInvoice(null)}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => handleReprint(selectedInvoice)}
                  style={{
                    padding: '8px 18px',
                    backgroundColor: '#16a34a',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  🖨️ Print Receipt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Return Modal */}
      {invoiceForReturn && (
        <ReturnModal
          invoice={invoiceForReturn}
          onClose={() => setInvoiceForReturn(null)}
          onSuccess={(creditNote: CreditNoteRecord) => {
            setInvoiceForReturn(null);
            setToastMessage(
              `✅ Return processed successfully! Credit Note #${creditNote.creditNoteNumber} issued. Refund: ${formatPKR(
                creditNote.totalPaisa
              )}`
            );
            loadInvoices();
          }}
        />
      )}
    </div>
  );
};
