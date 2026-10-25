import React, { useState, useEffect, useRef } from 'react';
import { formatPKR, type Paisa } from '@pos/shared';
import type { CustomerInfo } from './types';

export interface PaymentDetails {
  paymentMethod: 'cash' | 'card' | 'bank' | 'other';
  tenderedPaisa: number;
  changePaisa: number;
}

interface PaymentModalProps {
  grandTotalPaisa: Paisa;
  netTotalPaisa: Paisa;
  totalDiscountPaisa: Paisa;
  totalTaxPaisa: Paisa;
  itemCount: number;
  customer: CustomerInfo;
  onCompleteSale: (details: PaymentDetails) => Promise<void>;
  onClose: () => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  grandTotalPaisa,
  netTotalPaisa,
  totalDiscountPaisa,
  totalTaxPaisa,
  itemCount,
  customer,
  onCompleteSale,
  onClose,
}) => {
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'bank' | 'other'>('cash');
  const initialRupees = (grandTotalPaisa / 100).toFixed(0);
  const [tenderedRupees, setTenderedRupees] = useState(initialRupees);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const tenderedInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    tenderedInputRef.current?.focus();
    tenderedInputRef.current?.select();
  }, []);

  const tenderedPaisa = Math.round(Number(tenderedRupees || 0) * 100);
  const changePaisa = tenderedPaisa - grandTotalPaisa;
  const isPayable = (paymentMethod !== 'cash' || changePaisa >= 0) && !isSubmitting;

  const handleQuickTender = (rupees: number) => {
    setTenderedRupees(String(rupees));
  };

  const grandTotalRupees = Math.ceil(grandTotalPaisa / 100);
  const quickOptions = [
    { label: 'Exact', amount: grandTotalRupees },
    ...(grandTotalRupees < 500 ? [{ label: 'Rs. 500', amount: 500 }] : []),
    ...(grandTotalRupees < 1000 ? [{ label: 'Rs. 1,000', amount: 1000 }] : []),
    ...(grandTotalRupees < 2000 ? [{ label: 'Rs. 2,000', amount: 2000 }] : []),
    ...(grandTotalRupees < 5000 ? [{ label: 'Rs. 5,000', amount: 5000 }] : []),
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPayable) return;
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await onCompleteSale({
        paymentMethod,
        tenderedPaisa: paymentMethod === 'cash' ? tenderedPaisa : grandTotalPaisa,
        changePaisa: paymentMethod === 'cash' ? Math.max(0, changePaisa) : 0,
      });
    } catch (err: unknown) {
      console.error('Invoice persistence failed:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to finalize invoice to database.');
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '24px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          width: '560px',
          maxWidth: '100%',
          overflow: 'hidden',
          border: '1px solid #cbd5e1',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#0f172a',
            color: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>💳</span>
              <h3
                id="payment-modal-title"
                style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}
              >
                Payment & Invoice Settlement (F2)
              </h3>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
              {itemCount} item{itemCount === 1 ? '' : 's'} • {customer.name || 'Walk-in Customer'}
            </div>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '20px',
              color: '#94a3b8',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Amount Due Banner */}
        <div
          style={{
            padding: '20px 24px',
            backgroundColor: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
            Grand Total Due
          </div>
          <div
            style={{
              fontSize: '36px',
              fontWeight: 800,
              color: '#0f172a',
              marginTop: '4px',
              fontFamily: 'Consolas, monospace',
            }}
          >
            {formatPKR(grandTotalPaisa)}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '20px',
              marginTop: '10px',
              fontSize: '12px',
              color: '#64748b',
            }}
          >
            <span>Subtotal: {formatPKR(netTotalPaisa)}</span>
            {totalDiscountPaisa > 0 && <span>Discount: -{formatPKR(totalDiscountPaisa)}</span>}
            <span>Tax: {formatPKR(totalTaxPaisa)}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '24px' }}>
          {errorMessage && (
            <div
              style={{
                padding: '12px 14px',
                backgroundColor: '#fee2e2',
                border: '1px solid #fca5a5',
                borderRadius: '6px',
                color: '#b91c1c',
                fontSize: '13px',
                marginBottom: '16px',
                fontWeight: 600,
              }}
            >
              ⚠️ {errorMessage}
            </div>
          )}

          {/* Payment Method Selector */}
          <div style={{ marginBottom: '20px' }}>
            <label
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}
            >
              Payment Method
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {[
                { id: 'cash', label: '💵 Cash', sub: 'Cash at Counter' },
                { id: 'card', label: '💳 Card', sub: 'POS Machine' },
                { id: 'bank', label: '📱 Bank / QR', sub: 'Direct Transfer' },
              ].map((m) => {
                const isSelected = paymentMethod === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setPaymentMethod(m.id as 'cash' | 'card' | 'bank' | 'other')}
                    style={{
                      padding: '10px 8px',
                      borderRadius: '8px',
                      border: isSelected ? '2px solid #2563eb' : '1px solid #cbd5e1',
                      backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                      color: isSelected ? '#1d4ed8' : '#334155',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    <div>{m.label}</div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', fontWeight: 400 }}>
                      {m.sub}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cash Details: Tendered & Change Calculation */}
          {paymentMethod === 'cash' && (
            <div
              style={{
                backgroundColor: '#f1f5f9',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '20px',
              }}
            >
              <label
                htmlFor="tendered-amount"
                style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}
              >
                Cash Tendered (PKR Rupees)
              </label>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  id="tendered-amount"
                  ref={tenderedInputRef}
                  type="number"
                  disabled={isSubmitting}
                  min="0"
                  step="1"
                  value={tenderedRupees}
                  onChange={(e) => setTenderedRupees(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '12px 14px',
                    fontSize: '20px',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: '1px solid #94a3b8',
                    fontFamily: 'Consolas, monospace',
                  }}
                />
              </div>

              {/* Quick tender suggestions */}
              <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                {quickOptions.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleQuickTender(opt.amount)}
                    style={{
                      padding: '4px 10px',
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#334155',
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Live Change Calculation */}
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px 16px',
                  borderRadius: '6px',
                  backgroundColor: changePaisa >= 0 ? '#dcfce7' : '#fee2e2',
                  border: `1px solid ${changePaisa >= 0 ? '#86efac' : '#fca5a5'}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: changePaisa >= 0 ? '#166534' : '#991b1b',
                  }}
                >
                  {changePaisa >= 0 ? 'Change to Return:' : 'Remaining Shortfall:'}
                </span>
                <span
                  style={{
                    fontSize: '22px',
                    fontWeight: 800,
                    fontFamily: 'Consolas, monospace',
                    color: changePaisa >= 0 ? '#166534' : '#991b1b',
                  }}
                >
                  {formatPKR(Math.abs(changePaisa))}
                </span>
              </div>
            </div>
          )}

          {/* Database Persistence Notice */}
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '6px',
              fontSize: '12px',
              color: '#166534',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>💾</span>
            <span>
              <strong>Local SQLite Transaction</strong>: Creates invoice, payment record, decrements stock movements, and stages outbox sync in one atomic commit.
            </span>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              style={{
                padding: '12px 20px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                color: '#475569',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel (Esc)
            </button>
            <button
              type="submit"
              disabled={!isPayable}
              style={{
                padding: '12px 24px',
                backgroundColor: isPayable ? '#16a34a' : '#94a3b8',
                border: 'none',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: 700,
                color: '#ffffff',
                cursor: isPayable ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>{isSubmitting ? '⏳' : '✓'}</span>
              <span>{isSubmitting ? 'Saving to Database...' : 'Finalize Sale & Save'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
