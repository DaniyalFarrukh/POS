import React, { useState, useEffect, useRef } from 'react';
import { formatPKR, type Paisa } from '@pos/shared';
import type { CustomerInfo } from './types';

export interface PaymentMethodEntry {
  method: 'cash' | 'card' | 'wallet';
  amountPaisa: number;
}

export interface PaymentDetails {
  payments: PaymentMethodEntry[];
  tenderedPaisa?: number;
  changePaisa?: number;
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
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [singleMethod, setSingleMethod] = useState<'cash' | 'card' | 'wallet'>('cash');

  // Single cash tender state (Rupees)
  const initialRupees = (grandTotalPaisa / 100).toFixed(0);
  const [singleTenderedRupees, setSingleTenderedRupees] = useState(initialRupees);

  // Split payment state (Rupees)
  const [splitCashRupees, setSplitCashRupees] = useState('');
  const [splitCashTenderedRupees, setSplitCashTenderedRupees] = useState('');
  const [splitCardRupees, setSplitCardRupees] = useState('');
  const [splitWalletRupees, setSplitWalletRupees] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const tenderedInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    tenderedInputRef.current?.focus();
    tenderedInputRef.current?.select();
  }, [singleMethod, isSplitMode]);

  // Compute Single Mode Totals
  const singleTenderedPaisa = Math.round(Number(singleTenderedRupees || 0) * 100);
  const singleChangePaisa = singleTenderedPaisa - grandTotalPaisa;

  // Compute Split Mode Totals
  const splitCashPaisa = Math.max(0, Math.round(Number(splitCashRupees || 0) * 100));
  const splitCashTenderedPaisa = Math.max(0, Math.round(Number(splitCashTenderedRupees || splitCashRupees || 0) * 100));
  const splitCardPaisa = Math.max(0, Math.round(Number(splitCardRupees || 0) * 100));
  const splitWalletPaisa = Math.max(0, Math.round(Number(splitWalletRupees || 0) * 100));

  const splitTotalAllocatedPaisa = splitCashPaisa + splitCardPaisa + splitWalletPaisa;
  const splitRemainingPaisa = grandTotalPaisa - splitTotalAllocatedPaisa;
  const splitChangePaisa = splitCashPaisa > 0 ? splitCashTenderedPaisa - splitCashPaisa : 0;

  // Validate exact payment coverage
  let isPayable = false;
  if (!isSubmitting) {
    if (!isSplitMode) {
      if (singleMethod === 'cash') {
        isPayable = singleChangePaisa >= 0;
      } else {
        isPayable = true; // Card and Wallet are exact grandTotal
      }
    } else {
      // Split payments must cover the grand total EXACTLY (Rule: must cover total exactly before finalizing)
      const exactMatch = splitTotalAllocatedPaisa === grandTotalPaisa;
      const cashSufficient = splitCashPaisa === 0 || splitCashTenderedPaisa >= splitCashPaisa;
      isPayable = exactMatch && cashSufficient && splitTotalAllocatedPaisa > 0;
    }
  }

  // Quick tender suggestions for single cash
  const grandTotalRupees = Math.ceil(grandTotalPaisa / 100);
  const quickOptions = [
    { label: 'Exact', amount: grandTotalRupees },
    ...(grandTotalRupees < 500 ? [{ label: 'Rs. 500', amount: 500 }] : []),
    ...(grandTotalRupees < 1000 ? [{ label: 'Rs. 1,000', amount: 1000 }] : []),
    ...(grandTotalRupees < 2000 ? [{ label: 'Rs. 2,000', amount: 2000 }] : []),
    ...(grandTotalRupees < 5000 ? [{ label: 'Rs. 5,000', amount: 5000 }] : []),
  ];

  // Helper to fill remaining balance into a specific split method
  const handleFillRemaining = (target: 'cash' | 'card' | 'wallet') => {
    let currentOthers = 0;
    if (target === 'cash') currentOthers = splitCardPaisa + splitWalletPaisa;
    if (target === 'card') currentOthers = splitCashPaisa + splitWalletPaisa;
    if (target === 'wallet') currentOthers = splitCashPaisa + splitCardPaisa;

    const remainingToTargetPaisa = Math.max(0, grandTotalPaisa - currentOthers);
    const targetRupees = (remainingToTargetPaisa / 100).toFixed(0);

    if (target === 'cash') {
      setSplitCashRupees(targetRupees);
      setSplitCashTenderedRupees(targetRupees);
    } else if (target === 'card') {
      setSplitCardRupees(targetRupees);
    } else if (target === 'wallet') {
      setSplitWalletRupees(targetRupees);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPayable) return;
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      let finalPayments: PaymentMethodEntry[] = [];
      let finalTenderedPaisa = grandTotalPaisa;
      let finalChangePaisa = 0;

      if (!isSplitMode) {
        if (singleMethod === 'cash') {
          finalPayments = [{ method: 'cash', amountPaisa: grandTotalPaisa }];
          finalTenderedPaisa = singleTenderedPaisa;
          finalChangePaisa = Math.max(0, singleChangePaisa);
        } else {
          finalPayments = [{ method: singleMethod, amountPaisa: grandTotalPaisa }];
          finalTenderedPaisa = grandTotalPaisa;
          finalChangePaisa = 0;
        }
      } else {
        if (splitCashPaisa > 0) {
          finalPayments.push({ method: 'cash', amountPaisa: splitCashPaisa });
        }
        if (splitCardPaisa > 0) {
          finalPayments.push({ method: 'card', amountPaisa: splitCardPaisa });
        }
        if (splitWalletPaisa > 0) {
          finalPayments.push({ method: 'wallet', amountPaisa: splitWalletPaisa });
        }
        finalTenderedPaisa = splitCashPaisa > 0 ? splitCashTenderedPaisa : grandTotalPaisa;
        finalChangePaisa = Math.max(0, splitChangePaisa);
      }

      await onCompleteSale({
        payments: finalPayments,
        tenderedPaisa: finalTenderedPaisa,
        changePaisa: finalChangePaisa,
      });
    } catch (err: unknown) {
      console.error('Invoice settlement failed:', err);
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
        padding: '16px',
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
          width: '600px',
          maxWidth: '100%',
          overflow: 'hidden',
          border: '1px solid #cbd5e1',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '94vh',
        }}
      >
        {/* Header */}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>💳</span>
              <h3
                id="payment-modal-title"
                style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}
              >
                Payment & Settlement (F2)
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
            padding: '16px 20px',
            backgroundColor: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
            Grand Total Due
          </div>
          <div
            style={{
              fontSize: '32px',
              fontWeight: 800,
              color: '#0f172a',
              marginTop: '2px',
              fontFamily: 'Consolas, monospace',
            }}
          >
            {formatPKR(grandTotalPaisa)}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '16px',
              marginTop: '6px',
              fontSize: '12px',
              color: '#64748b',
            }}
          >
            <span>Subtotal: {formatPKR(netTotalPaisa)}</span>
            {totalDiscountPaisa > 0 && <span>Discount: -{formatPKR(totalDiscountPaisa)}</span>}
            <span>Tax: {formatPKR(totalTaxPaisa)}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px', overflowY: 'auto' }}>
          {errorMessage && (
            <div
              style={{
                padding: '10px 14px',
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

          {/* Mode Tabs: Single vs Split Payment */}
          <div
            style={{
              display: 'flex',
              backgroundColor: '#f1f5f9',
              padding: '3px',
              borderRadius: '8px',
              marginBottom: '16px',
            }}
          >
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setIsSplitMode(false)}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: !isSplitMode ? '#ffffff' : 'transparent',
                color: !isSplitMode ? '#0f172a' : '#64748b',
                fontWeight: !isSplitMode ? 700 : 500,
                fontSize: '13px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                boxShadow: !isSplitMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              Single Payment
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                setIsSplitMode(true);
                // Pre-fill cash with grand total initially if empty
                if (!splitCashRupees && !splitCardRupees && !splitWalletRupees) {
                  setSplitCashRupees((grandTotalPaisa / 100).toFixed(0));
                  setSplitCashTenderedRupees((grandTotalPaisa / 100).toFixed(0));
                }
              }}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: isSplitMode ? '#ffffff' : 'transparent',
                color: isSplitMode ? '#0f172a' : '#64748b',
                fontWeight: isSplitMode ? 700 : 500,
                fontSize: '13px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                boxShadow: isSplitMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              Split Payment (Cash + Card / Wallet)
            </button>
          </div>

          {/* MODE A: Single Payment Mode */}
          {!isSplitMode && (
            <>
              {/* Method Selector */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {[
                    { id: 'cash', label: '💵 Cash', sub: 'Cash at Counter' },
                    { id: 'card', label: '💳 Card', sub: 'POS Terminal' },
                    { id: 'wallet', label: '📱 Wallet', sub: 'EasyPaisa/JazzCash' },
                  ].map((m) => {
                    const isSelected = singleMethod === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => setSingleMethod(m.id as 'cash' | 'card' | 'wallet')}
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

              {/* Single Cash Details */}
              {singleMethod === 'cash' && (
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '14px',
                    marginBottom: '16px',
                  }}
                >
                  <label
                    htmlFor="single-tendered-amount"
                    style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}
                  >
                    Cash Tendered (Rupees)
                  </label>
                  <input
                    id="single-tendered-amount"
                    ref={tenderedInputRef}
                    type="number"
                    disabled={isSubmitting}
                    min="0"
                    step="1"
                    value={singleTenderedRupees}
                    onChange={(e) => setSingleTenderedRupees(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      fontSize: '20px',
                      fontWeight: 700,
                      borderRadius: '6px',
                      border: '1px solid #94a3b8',
                      fontFamily: 'Consolas, monospace',
                    }}
                  />

                  {/* Quick tender suggestions */}
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                    {quickOptions.map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => setSingleTenderedRupees(String(opt.amount))}
                        style={{
                          padding: '3px 8px',
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

                  {/* Change Due Box */}
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '10px 14px',
                      borderRadius: '6px',
                      backgroundColor: singleChangePaisa >= 0 ? '#dcfce7' : '#fee2e2',
                      border: `1px solid ${singleChangePaisa >= 0 ? '#86efac' : '#fca5a5'}`,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: singleChangePaisa >= 0 ? '#166534' : '#991b1b',
                      }}
                    >
                      {singleChangePaisa >= 0 ? 'Change to Return:' : 'Shortfall (Need more cash):'}
                    </span>
                    <span
                      style={{
                        fontSize: '20px',
                        fontWeight: 800,
                        fontFamily: 'Consolas, monospace',
                        color: singleChangePaisa >= 0 ? '#166534' : '#991b1b',
                      }}
                    >
                      {formatPKR(Math.abs(singleChangePaisa))}
                    </span>
                  </div>
                </div>
              )}

              {singleMethod !== 'cash' && (
                <div
                  style={{
                    padding: '12px 14px',
                    backgroundColor: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: '#1e40af',
                  }}
                >
                  Recorded as <strong>{singleMethod === 'card' ? 'Card POS Terminal' : 'Mobile Wallet'}</strong> payment for exact amount: <strong>{formatPKR(grandTotalPaisa)}</strong>.
                </div>
              )}
            </>
          )}

          {/* MODE B: Split Payment Mode */}
          {isSplitMode && (
            <div
              style={{
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '14px',
                marginBottom: '16px',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '10px' }}>
                Split Payment Allocations
              </div>

              {/* 1. Cash Row */}
              <div style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                    💵 Cash Portion (Rupees)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleFillRemaining('cash')}
                    style={{ fontSize: '11px', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Fill Remaining
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="number"
                    min="0"
                    placeholder="Cash Amount"
                    value={splitCashRupees}
                    onChange={(e) => {
                      setSplitCashRupees(e.target.value);
                      if (!splitCashTenderedRupees || splitCashTenderedRupees === splitCashRupees) {
                        setSplitCashTenderedRupees(e.target.value);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      fontSize: '14px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontFamily: 'Consolas, monospace',
                    }}
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder="Tendered"
                    value={splitCashTenderedRupees}
                    onChange={(e) => setSplitCashTenderedRupees(e.target.value)}
                    title="Cash Tendered (for change calculation)"
                    style={{
                      width: '130px',
                      padding: '8px 10px',
                      fontSize: '14px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontFamily: 'Consolas, monospace',
                    }}
                  />
                </div>
                {splitCashPaisa > 0 && splitChangePaisa >= 0 && (
                  <div style={{ fontSize: '11px', color: '#166534', marginTop: '2px', fontWeight: 600 }}>
                    Change: {formatPKR(splitChangePaisa)}
                  </div>
                )}
              </div>

              {/* 2. Card Row */}
              <div style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                    💳 Card Portion (Rupees)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleFillRemaining('card')}
                    style={{ fontSize: '11px', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Fill Remaining
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  placeholder="Card Amount"
                  value={splitCardRupees}
                  onChange={(e) => setSplitCardRupees(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: '14px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontFamily: 'Consolas, monospace',
                  }}
                />
              </div>

              {/* 3. Wallet Row */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                    📱 Wallet Portion (Rupees)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleFillRemaining('wallet')}
                    style={{ fontSize: '11px', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Fill Remaining
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  placeholder="Wallet Amount"
                  value={splitWalletRupees}
                  onChange={(e) => setSplitWalletRupees(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: '14px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontFamily: 'Consolas, monospace',
                  }}
                />
              </div>

              {/* Split Coverage Balance Summary */}
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '6px',
                  backgroundColor:
                    splitRemainingPaisa === 0
                      ? '#dcfce7'
                      : splitRemainingPaisa > 0
                      ? '#fef3c7'
                      : '#fee2e2',
                  border: `1px solid ${
                    splitRemainingPaisa === 0
                      ? '#86efac'
                      : splitRemainingPaisa > 0
                      ? '#fde68a'
                      : '#fca5a5'
                  }`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                <span>
                  {splitRemainingPaisa === 0
                    ? '✓ Total Covered Exactly:'
                    : splitRemainingPaisa > 0
                    ? '⚠️ Remaining to Cover:'
                    : '⚠️ Overpaid by:'}
                </span>
                <span style={{ fontFamily: 'Consolas, monospace', fontSize: '15px' }}>
                  {formatPKR(Math.abs(splitRemainingPaisa))}
                </span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              style={{
                padding: '10px 18px',
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
                padding: '10px 22px',
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
              <span>
                {isSubmitting
                  ? 'Finalizing Sale...'
                  : isPayable
                  ? 'Finalize Sale (Enter)'
                  : isSplitMode
                  ? 'Cover Total to Finalize'
                  : 'Enter Tendered Cash'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
