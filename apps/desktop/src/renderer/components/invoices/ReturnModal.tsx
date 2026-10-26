import React, { useState, useEffect } from 'react';
import type {
  InvoiceRecord,
  ReturnableLineItem,
  ReturnReason,
  RefundMethod,
  CreditNoteRecord,
} from '@pos/shared';
import { formatPKR, generateUuidV7 } from '@pos/shared';

interface ReturnModalProps {
  invoice: InvoiceRecord;
  onClose: () => void;
  onSuccess: (creditNote: CreditNoteRecord) => void;
}

interface SelectedReturnItem {
  invoiceLineId: string;
  quantity: number;
}

export const ReturnModal: React.FC<ReturnModalProps> = ({ invoice, onClose, onSuccess }) => {
  const [loadingLines, setLoadingLines] = useState(true);
  const [returnableLines, setReturnableLines] = useState<ReturnableLineItem[]>([]);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReason>('customer_return');
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('cash');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load returnable lines from IPC
  useEffect(() => {
    let isMounted = true;
    async function fetchLines() {
      try {
        setLoadingLines(true);
        setErrorMessage(null);
        const lines = await window.api.returns.getReturnableLines(invoice.id);
        if (isMounted) {
          setReturnableLines(lines);
          // Initialize quantity state: 0 for all lines
          const initialQty: Record<string, number> = {};
          lines.forEach((l) => {
            initialQty[l.invoiceLineId] = 0;
          });
          setReturnQuantities(initialQty);
        }
      } catch (err: unknown) {
        console.error('[ReturnModal] Failed to fetch returnable lines:', err);
        if (isMounted) {
          setErrorMessage(err instanceof Error ? err.message : 'Failed to fetch invoice lines.');
        }
      } finally {
        if (isMounted) setLoadingLines(false);
      }
    }
    fetchLines();
    return () => {
      isMounted = false;
    };
  }, [invoice.id]);

  // Update return quantity for a line
  const handleQuantityChange = (lineId: string, val: number, max: number) => {
    const clamped = Math.max(0, Math.min(val, max));
    setReturnQuantities((prev) => ({
      ...prev,
      [lineId]: clamped,
    }));
  };

  // Compute live return totals
  const totalReturnUnits = Object.values(returnQuantities).reduce((acc, q) => acc + q, 0);

  // Proportional estimated refund calculation
  let estimatedRefundPaisa = 0;
  returnableLines.forEach((line) => {
    const returnQty = returnQuantities[line.invoiceLineId] || 0;
    if (returnQty > 0 && line.soldQuantity > 0) {
      const lineUnitTotal = Math.round(line.lineTotalPaisa / line.soldQuantity);
      estimatedRefundPaisa += lineUnitTotal * returnQty;
    }
  });

  // Submit return
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalReturnUnits <= 0) {
      setErrorMessage('Please select at least 1 item quantity to return.');
      return;
    }

    const linesToReturn: SelectedReturnItem[] = Object.entries(returnQuantities)
      .filter(([, qty]) => qty > 0)
      .map(([invoiceLineId, quantity]) => ({
        invoiceLineId,
        quantity,
      }));

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const clientRequestId = generateUuidV7();
      const creditNote = await window.api.returns.processReturn({
        clientRequestId,
        originalInvoiceId: invoice.id,
        lines: linesToReturn,
        reason,
        refundMethod,
        notes: notes.trim() || undefined,
      });

      onSuccess(creditNote);
    } catch (err: unknown) {
      console.error('[ReturnModal] Process return error:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to process return.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-modal-title"
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="modal-content-card"
        style={{
          width: '100%',
          maxWidth: '740px',
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
            color: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>🔄</span>
              <h2 id="return-modal-title" style={{ fontSize: '18px', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
                Process Return & Credit Note
              </h2>
              <kbd className="kbd-cap-dark" style={{ fontSize: '11px', padding: '1px 6px' }}>
                Esc
              </kbd>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
              Invoice <strong style={{ color: '#ffffff' }}>#{invoice.invoiceNumber}</strong> • Created:{' '}
              {new Date(invoice.createdAt).toLocaleDateString('en-GB', {
                timeZone: 'Asia/Karachi',
              })}
            </div>
          </div>
          <button
            type="button"
            className="interactive-btn"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close return modal"
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: '8px',
              width: '32px',
              height: '32px',
              fontSize: '16px',
              color: '#cbd5e1',
              cursor: submitting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div
          style={{
            padding: '20px 24px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {errorMessage && (
            <div
              style={{
                backgroundColor: '#fee2e2',
                border: '1px solid #ef4444',
                color: '#991b1b',
                padding: '12px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              ⚠️ {errorMessage}
            </div>
          )}

          {loadingLines ? (
            <div
              style={{
                padding: '40px',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '14px',
              }}
            >
              ⏳ Loading invoice lines and remaining returnable balances...
            </div>
          ) : returnableLines.length === 0 ? (
            <div
              style={{
                padding: '30px',
                textAlign: 'center',
                backgroundColor: '#f8fafc',
                borderRadius: '8px',
                border: '1px dashed #cbd5e1',
                color: '#64748b',
              }}
            >
              No returnable items found on this invoice.
            </div>
          ) : (
            <div>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#334155',
                  marginBottom: '8px',
                }}
              >
                Select Items to Return:
              </div>
              <div
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr
                      style={{
                        backgroundColor: '#f1f5f9',
                        borderBottom: '1px solid #e2e8f0',
                        color: '#475569',
                        textAlign: 'left',
                      }}
                    >
                      <th style={{ padding: '10px 12px' }}>Product</th>
                      <th style={{ padding: '10px 12px' }}>Batch / Exp</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>Sold / Ret</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Unit Net</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>Return Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnableLines.map((line) => {
                      const qty = returnQuantities[line.invoiceLineId] || 0;
                      const isFullyReturned = line.returnableQuantity <= 0;
                      const unitNetPaisa =
                        line.soldQuantity > 0 ? Math.round(line.lineTotalPaisa / line.soldQuantity) : 0;

                      return (
                        <tr
                          key={line.invoiceLineId}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            backgroundColor: isFullyReturned
                              ? '#f8fafc'
                              : qty > 0
                              ? '#f0fdf4'
                              : '#ffffff',
                            opacity: isFullyReturned ? 0.6 : 1,
                          }}
                        >
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ fontWeight: 600, color: '#1e293b' }}>
                              {line.brandName || 'Product'}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {line.genericName || '—'}
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: '12px', color: '#475569' }}>
                            <div>{line.batchNo || '—'}</div>
                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                              {line.expiryDate || '—'}
                            </div>
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              textAlign: 'center',
                              fontSize: '12px',
                              color: '#334155',
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>{line.soldQuantity}</span>
                            <span style={{ color: '#94a3b8', margin: '0 4px' }}>/</span>
                            <span style={{ color: line.alreadyReturnedQuantity > 0 ? '#dc2626' : '#64748b' }}>
                              {line.alreadyReturnedQuantity}
                            </span>
                            <div style={{ fontSize: '11px', color: '#16a34a' }}>
                              (Max: {line.returnableQuantity})
                            </div>
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              textAlign: 'right',
                              fontWeight: 500,
                              color: '#334155',
                            }}
                          >
                            {formatPKR(unitNetPaisa)}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            {isFullyReturned ? (
                              <span
                                style={{
                                  fontSize: '11px',
                                  color: '#dc2626',
                                  fontWeight: 600,
                                  backgroundColor: '#fee2e2',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                }}
                              >
                                Fully Returned
                              </span>
                            ) : (
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '6px',
                                  overflow: 'hidden',
                                }}
                              >
                                <button
                                  type="button"
                                  disabled={qty <= 0 || submitting}
                                  onClick={() =>
                                    handleQuantityChange(line.invoiceLineId, qty - 1, line.returnableQuantity)
                                  }
                                  style={{
                                    border: 'none',
                                    background: '#f1f5f9',
                                    padding: '6px 10px',
                                    cursor: qty <= 0 ? 'not-allowed' : 'pointer',
                                    fontWeight: 700,
                                  }}
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  max={line.returnableQuantity}
                                  value={qty}
                                  disabled={submitting}
                                  onChange={(e) =>
                                    handleQuantityChange(
                                      line.invoiceLineId,
                                      parseInt(e.target.value, 10) || 0,
                                      line.returnableQuantity
                                    )
                                  }
                                  style={{
                                    width: '44px',
                                    textAlign: 'center',
                                    border: 'none',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    outline: 'none',
                                  }}
                                />
                                <button
                                  type="button"
                                  disabled={qty >= line.returnableQuantity || submitting}
                                  onClick={() =>
                                    handleQuantityChange(line.invoiceLineId, qty + 1, line.returnableQuantity)
                                  }
                                  style={{
                                    border: 'none',
                                    background: '#f1f5f9',
                                    padding: '6px 10px',
                                    cursor:
                                      qty >= line.returnableQuantity ? 'not-allowed' : 'pointer',
                                    fontWeight: 700,
                                  }}
                                >
                                  +
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Form Options: Reason & Refund Method */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '16px',
              backgroundColor: '#f8fafc',
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
            }}
          >
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#475569',
                  marginBottom: '6px',
                }}
              >
                Return Reason *
              </label>
              <select
                value={reason}
                disabled={submitting}
                onChange={(e) => setReason(e.target.value as ReturnReason)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  backgroundColor: '#ffffff',
                }}
              >
                <option value="customer_return">Customer Return (Not Needed / Change of Mind)</option>
                <option value="defective_damaged">Defective / Damaged Packaging</option>
                <option value="expired">Near Expiry / Expired</option>
                <option value="dispensing_error">Dispensing Error / Wrong Medicine Sold</option>
                <option value="other">Other Reason</option>
              </select>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#475569',
                  marginBottom: '6px',
                }}
              >
                Refund Method *
              </label>
              <select
                value={refundMethod}
                disabled={submitting}
                onChange={(e) => setRefundMethod(e.target.value as RefundMethod)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  backgroundColor: '#ffffff',
                }}
              >
                <option value="cash">Cash (From Drawer)</option>
                <option value="card">Card Reversal</option>
                <option value="wallet">Digital Wallet</option>
                <option value="credit">Store Credit Memo</option>
              </select>
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#475569',
                  marginBottom: '6px',
                }}
              >
                Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="Reason details or remarks..."
                value={notes}
                disabled={submitting}
                onChange={(e) => setNotes(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Refund Live Summary */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#ecfdf5',
              border: '1px solid #a7f3d0',
              padding: '14px 18px',
              borderRadius: '10px',
            }}
          >
            <div>
              <div style={{ fontSize: '12px', color: '#047857', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Estimated Refund Summary
              </div>
              <div style={{ fontSize: '12px', color: '#065f46', marginTop: '2px' }}>
                <span className="tabular-nums" style={{ fontWeight: 700 }}>{totalReturnUnits}</span> items selected • Automatically restored to original inventory batches
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="tabular-nums" style={{ fontSize: '24px', fontWeight: 800, color: '#065f46', letterSpacing: '-0.02em' }}>
                {formatPKR(estimatedRefundPaisa)}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '14px 24px',
            backgroundColor: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
          }}
        >
          <button
            type="button"
            className="interactive-btn"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#475569',
              fontWeight: 700,
              fontSize: '13px',
              cursor: submitting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>Cancel</span>
            <kbd className="kbd-cap" style={{ fontSize: '10px' }}>Esc</kbd>
          </button>
          <button
            type="button"
            className="interactive-btn"
            onClick={handleSubmit}
            disabled={submitting || totalReturnUnits <= 0}
            style={{
              padding: '8px 22px',
              borderRadius: '8px',
              border: 'none',
              background: totalReturnUnits > 0 && !submitting
                ? 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)'
                : '#cbd5e1',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '13px',
              cursor: totalReturnUnits > 0 && !submitting ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: totalReturnUnits > 0 && !submitting ? '0 2px 4px rgba(225, 29, 72, 0.25)' : 'none',
            }}
          >
            {submitting ? '⏳ Processing...' : `Confirm Return (${formatPKR(estimatedRefundPaisa)})`}
          </button>
        </div>
      </div>
    </div>
  );
};
