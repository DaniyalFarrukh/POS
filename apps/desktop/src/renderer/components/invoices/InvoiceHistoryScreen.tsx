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
          className="toast-slide-in"
          style={{
            position: 'fixed',
            top: '20px',
            right: '24px',
            zIndex: 100,
            padding: '12px 20px',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            color: '#ffffff',
            borderRadius: '10px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.4), 0 0 0 1px rgba(99, 102, 241, 0.3)',
            fontSize: '13px',
            fontWeight: 700,
            backdropFilter: 'blur(8px)',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '22px' }}>🧾</span>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
              Invoices & Sales History
            </h2>
          </div>
          <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
            Lookup customer receipts, review finalized item batches, and reprint thermal slips.
          </div>
        </div>

        <button
          type="button"
          className="interactive-btn"
          onClick={loadInvoices}
          disabled={loading}
          style={{
            padding: '8px 16px',
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 700,
            color: '#334155',
            cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>{loading ? 'Refreshing...' : '🔄 Refresh List'}</span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '14px 18px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          marginBottom: '16px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          alignItems: 'center',
        }}
      >
        {/* Search input */}
        <div style={{ flex: '1 1 260px', minWidth: '220px', position: 'relative' }}>
          <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '14px', color: '#94a3b8' }}>
            🔍
          </span>
          <input
            type="text"
            placeholder="Search invoice # (e.g. C1-000001) or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '9px 12px 9px 34px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = '#6366f1';
              e.target.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = '#cbd5e1';
              e.target.style.boxShadow = 'none';
            }}
          />
        </div>

        {/* Date presets */}
        <div style={{ display: 'flex', gap: '6px', backgroundColor: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
          {[
            { id: 'today', label: 'Today' },
            { id: 'yesterday', label: 'Yesterday' },
            { id: 'week', label: 'Last 7 Days' },
            { id: 'all', label: 'All Time' },
            { id: 'custom', label: 'Custom Range' },
          ].map((preset) => {
            const isActive = dateFilter === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className="interactive-btn"
                onClick={() => setDateFilter(preset.id as typeof dateFilter)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: isActive ? '#ffffff' : 'transparent',
                  color: isActive ? '#4f46e5' : '#64748b',
                  fontSize: '12px',
                  fontWeight: isActive ? 800 : 600,
                  cursor: 'pointer',
                  boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                {preset.label}
              </button>
            );
          })}
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
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
              }}
            />
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>to</span>
            <input
              type="date"
              value={customDateTo}
              onChange={(e) => setCustomDateTo(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: '8px',
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
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.04)',
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
                backgroundColor: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
                zIndex: 10,
              }}
            >
              <tr>
                <th style={{ padding: '12px 16px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Invoice #</th>
                <th style={{ padding: '12px 16px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Date & Time</th>
                <th style={{ padding: '12px 16px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Items</th>
                <th style={{ padding: '12px 16px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cashier / Counter</th>
                <th style={{ padding: '12px 16px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Payment Method</th>
                <th style={{ padding: '12px 16px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>
                  Total
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
                    {loading ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '24px', animation: 'spin 1s linear infinite' }}>⏳</span>
                        <span style={{ fontWeight: 600 }}>Loading invoices...</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '28px' }}>🧾</span>
                        <span style={{ fontWeight: 600, color: '#64748b' }}>No invoices found for the selected criteria.</span>
                      </div>
                    )}
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

                  const isCash = paySummary.toLowerCase().includes('cash');
                  const isCard = paySummary.toLowerCase().includes('card');
                  const isSplit = paySummary.toLowerCase().includes('split');

                  const pillBg = isCash ? '#ecfdf5' : isCard ? '#e0e7ff' : isSplit ? '#e0f2fe' : '#f5f3ff';
                  const pillColor = isCash ? '#047857' : isCard ? '#4338ca' : isSplit ? '#0369a1' : '#6d28d9';
                  const pillBorder = isCash ? '#a7f3d0' : isCard ? '#c7d2fe' : isSplit ? '#bae6fd' : '#ddd6fe';

                  return (
                    <tr
                      key={inv.id}
                      className="cart-row"
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        transition: 'background-color 0.15s ease',
                      }}
                    >
                      <td className="tabular-nums" style={{ padding: '12px 16px', fontWeight: 800, color: '#0f172a' }}>
                        {inv.invoiceNumber}
                      </td>
                      <td className="tabular-nums" style={{ padding: '12px 16px', color: '#475569' }}>{dateStr}</td>
                      <td className="tabular-nums" style={{ padding: '12px 16px', color: '#334155', fontWeight: 600 }}>
                        {inv.lines?.length || 0} item{(inv.lines?.length || 0) === 1 ? '' : 's'}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#64748b' }}>
                        <span style={{ fontWeight: 600, color: '#334155' }}>{inv.userName || 'Cashier'}</span> • {inv.counterName || 'Counter'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            padding: '3px 9px',
                            borderRadius: '6px',
                            backgroundColor: pillBg,
                            color: pillColor,
                            border: `1px solid ${pillBorder}`,
                            fontSize: '11px',
                            fontWeight: 700,
                            textTransform: 'capitalize',
                          }}
                        >
                          {paySummary}
                        </span>
                      </td>
                      <td
                        className="tabular-nums"
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontWeight: 800,
                          fontSize: '14px',
                          color: '#0f172a',
                        }}
                      >
                        {formatPKR(inv.grandTotalPaisa)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          <button
                            type="button"
                            className="interactive-btn"
                            onClick={() => setSelectedInvoice(inv)}
                            style={{
                              padding: '5px 12px',
                              backgroundColor: '#ffffff',
                              border: '1px solid #cbd5e1',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 700,
                              color: '#4f46e5',
                              cursor: 'pointer',
                            }}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="interactive-btn"
                            onClick={() => setInvoiceForReturn(inv)}
                            style={{
                              padding: '5px 12px',
                              backgroundColor: '#fff1f2',
                              border: '1px solid #fecdd3',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 700,
                              color: '#e11d48',
                              cursor: 'pointer',
                            }}
                          >
                            🔄 Return
                          </button>
                          <button
                            type="button"
                            className="interactive-btn"
                            disabled={isReprinting}
                            onClick={() => handleReprint(inv)}
                            style={{
                              padding: '5px 14px',
                              backgroundColor: '#0f172a',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 700,
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
          aria-labelledby="invoice-details-title"
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedInvoice(null);
          }}
        >
          <div
            className="modal-content-card"
            style={{
              width: '720px',
              maxWidth: '100%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '18px 24px',
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                color: '#ffffff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>🧾</span>
                  <h3 id="invoice-details-title" style={{ margin: 0, fontSize: '18px', fontWeight: 800, letterSpacing: '-0.01em' }}>
                    Invoice #{selectedInvoice.invoiceNumber}
                  </h3>
                  <kbd className="kbd-cap-dark" style={{ fontSize: '11px', padding: '1px 6px' }}>
                    Esc
                  </kbd>
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                  {new Date(selectedInvoice.createdAt).toLocaleString('en-GB', {
                    timeZone: 'Asia/Karachi',
                  })}{' '}
                  • Finalized & Immutable Record
                </div>
              </div>
              <button
                type="button"
                className="interactive-btn"
                onClick={() => setSelectedInvoice(null)}
                aria-label="Close invoice details"
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  width: '32px',
                  height: '32px',
                  fontSize: '16px',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body: Lines & Totals */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              {selectedInvoice.notes && (
                <div
                  style={{
                    padding: '10px 14px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '13px',
                    marginBottom: '16px',
                    color: '#334155',
                  }}
                >
                  <strong style={{ color: '#0f172a' }}>Notes:</strong> {selectedInvoice.notes}
                </div>
              )}

              {/* Items List */}
              <div style={{ fontWeight: 700, fontSize: '13px', color: '#475569', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Purchased Items ({selectedInvoice.lines?.length || 0})
              </div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Item & Batch</th>
                      <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>Qty</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>Unit Price</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>Discount</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedInvoice.lines || []).map((l) => (
                      <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>
                            {l.brandName || l.genericName || 'Product'}
                          </div>
                          {(l.batchNo || l.expiryDate) && (
                            <div className="tabular-nums" style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                              Batch: <strong>{l.batchNo || 'N/A'}</strong> • Exp: {l.expiryDate || 'N/A'}
                            </div>
                          )}
                        </td>
                        <td className="tabular-nums" style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700 }}>
                          {l.quantity}
                        </td>
                        <td className="tabular-nums" style={{ padding: '10px 14px', textAlign: 'right' }}>
                          {formatPKR(l.unitPricePaisa)}
                        </td>
                        <td className="tabular-nums" style={{ padding: '10px 14px', textAlign: 'right', color: '#b91c1c', fontWeight: 600 }}>
                          {l.discountPaisa > 0 ? `-${formatPKR(l.discountPaisa)}` : '—'}
                        </td>
                        <td
                          className="tabular-nums"
                          style={{
                            padding: '10px 14px',
                            textAlign: 'right',
                            fontWeight: 800,
                            color: '#0f172a',
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
                  borderRadius: '10px',
                  padding: '14px 18px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                  <span style={{ color: '#64748b' }}>Subtotal:</span>
                  <span className="tabular-nums" style={{ fontWeight: 600 }}>{formatPKR(selectedInvoice.subtotalPaisa)}</span>
                </div>
                {selectedInvoice.discountPaisa > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                    <span style={{ color: '#64748b' }}>Total Discount:</span>
                    <span className="tabular-nums" style={{ color: '#b91c1c', fontWeight: 700 }}>-{formatPKR(selectedInvoice.discountPaisa)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                  <span style={{ color: '#64748b' }}>GST Tax:</span>
                  <span className="tabular-nums" style={{ fontWeight: 600 }}>{formatPKR(selectedInvoice.taxPaisa)}</span>
                </div>
                <div
                  style={{
                    borderTop: '1px solid #cbd5e1',
                    paddingTop: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>Grand Total:</span>
                  <span className="tabular-nums" style={{ color: '#059669', fontSize: '20px', fontWeight: 900, letterSpacing: '-0.02em' }}>
                    {formatPKR(selectedInvoice.grandTotalPaisa)}
                  </span>
                </div>
              </div>

              {/* Payment Details */}
              <div style={{ marginTop: '14px', fontSize: '12px', color: '#64748b' }}>
                <strong style={{ color: '#334155' }}>Payments Recorded:</strong>{' '}
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
                padding: '14px 24px',
                backgroundColor: '#f8fafc',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', color: '#475569', fontWeight: 600 }}>
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
                  className="interactive-btn"
                  onClick={() => {
                    const inv = selectedInvoice;
                    setSelectedInvoice(null);
                    setInvoiceForReturn(inv);
                  }}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#fff1f2',
                    border: '1px solid #fecdd3',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#e11d48',
                    cursor: 'pointer',
                  }}
                >
                  🔄 Process Return
                </button>
                <button
                  type="button"
                  className="interactive-btn"
                  onClick={() => setSelectedInvoice(null)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="interactive-btn"
                  onClick={() => handleReprint(selectedInvoice)}
                  style={{
                    padding: '8px 20px',
                    background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#ffffff',
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(5, 150, 105, 0.25)',
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
