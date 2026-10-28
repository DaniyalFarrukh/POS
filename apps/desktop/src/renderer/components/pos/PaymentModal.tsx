import React, { useState, useEffect, useRef } from 'react';
import { formatPKR, convertRupeesToPaisa, type Paisa } from '@pos/shared';
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
  const initialRupees = formatPKR(grandTotalPaisa, { showPrefix: false });
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
  let singleTenderedPaisa = 0;
  try {
    singleTenderedPaisa = singleTenderedRupees.trim() ? convertRupeesToPaisa(singleTenderedRupees) : 0;
  } catch {
    singleTenderedPaisa = 0;
  }
  const singleChangePaisa = singleTenderedPaisa - grandTotalPaisa;

  // Compute Split Mode Totals
  const parsePaisaSafe = (val: string): number => {
    try {
      return val.trim() ? Math.max(0, convertRupeesToPaisa(val)) : 0;
    } catch {
      return 0;
    }
  };
  const splitCashPaisa = parsePaisaSafe(splitCashRupees);
  const splitCashTenderedPaisa = parsePaisaSafe(splitCashTenderedRupees || splitCashRupees);
  const splitCardPaisa = parsePaisaSafe(splitCardRupees);
  const splitWalletPaisa = parsePaisaSafe(splitWalletRupees);

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
    const targetRupees = formatPKR(remainingToTargetPaisa, { showPrefix: false });

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
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        className="modal-content-card"
        style={{
          width: '620px',
          maxWidth: '100%',
        }}
      >
        {/* Header */}
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
              <span style={{ fontSize: '20px' }}>💳</span>
              <h3
                id="payment-modal-title"
                style={{ margin: 0, fontSize: '18px', fontWeight: 800, letterSpacing: '-0.01em' }}
              >
                Payment Settlement
              </h3>
              <kbd className="kbd-cap-dark" style={{ fontSize: '11px', padding: '1px 6px' }}>
                F2
              </kbd>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>
              {itemCount} item{itemCount === 1 ? '' : 's'} • {customer.name || 'Walk-in Customer'}
            </div>
          </div>
          <button
            type="button"
            className="interactive-btn"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: '8px',
              width: '32px',
              height: '32px',
              fontSize: '16px',
              color: '#cbd5e1',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* Amount Due Banner */}
        <div
          style={{
            padding: '18px 24px',
            backgroundColor: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Grand Total Due
          </div>
          <div
            className="tabular-nums"
            style={{
              fontSize: '34px',
              fontWeight: 900,
              color: '#0f172a',
              marginTop: '2px',
              letterSpacing: '-0.02em',
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
              fontWeight: 600,
            }}
          >
            <span className="tabular-nums">Subtotal: {formatPKR(netTotalPaisa)}</span>
            {totalDiscountPaisa > 0 && (
              <span className="tabular-nums" style={{ color: '#059669', backgroundColor: '#ecfdf5', padding: '1px 6px', borderRadius: '4px' }}>
                Saved: -{formatPKR(totalDiscountPaisa)}
              </span>
            )}
            <span className="tabular-nums">GST Tax: {formatPKR(totalTaxPaisa)}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px 24px', overflowY: 'auto' }}>
          {errorMessage && (
            <div
              className="shake-animation"
              style={{
                padding: '12px 16px',
                backgroundColor: '#fff1f2',
                border: '1px solid #fecdd3',
                borderRadius: '8px',
                color: '#be123c',
                fontSize: '13px',
                marginBottom: '16px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>⚠️</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Mode Tabs: Single vs Split Payment */}
          <div
            style={{
              display: 'flex',
              backgroundColor: '#f1f5f9',
              padding: '4px',
              borderRadius: '10px',
              marginBottom: '16px',
              border: '1px solid #e2e8f0',
            }}
          >
            <button
              type="button"
              className="interactive-btn"
              disabled={isSubmitting}
              onClick={() => setIsSplitMode(false)}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: !isSplitMode ? '#ffffff' : 'transparent',
                color: !isSplitMode ? '#0f172a' : '#64748b',
                fontWeight: !isSplitMode ? 800 : 600,
                fontSize: '13px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                boxShadow: !isSplitMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Single Payment
            </button>
            <button
              type="button"
              className="interactive-btn"
              disabled={isSubmitting}
              onClick={() => {
                setIsSplitMode(true);
                if (!splitCashRupees && !splitCardRupees && !splitWalletRupees) {
                  const initialSplit = formatPKR(grandTotalPaisa, { showPrefix: false });
                  setSplitCashRupees(initialSplit);
                  setSplitCashTenderedRupees(initialSplit);
                }
              }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: isSplitMode ? '#ffffff' : 'transparent',
                color: isSplitMode ? '#0f172a' : '#64748b',
                fontWeight: isSplitMode ? 800 : 600,
                fontSize: '13px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                boxShadow: isSplitMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
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
                        className="interactive-btn"
                        disabled={isSubmitting}
                        onClick={() => setSingleMethod(m.id as 'cash' | 'card' | 'wallet')}
                        style={{
                          padding: '12px 10px',
                          borderRadius: '10px',
                          border: isSelected ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                          backgroundColor: isSelected ? '#eef2ff' : '#ffffff',
                          color: isSelected ? '#4338ca' : '#334155',
                          fontWeight: 700,
                          fontSize: '13px',
                          cursor: isSubmitting ? 'not-allowed' : 'pointer',
                          textAlign: 'center',
                          boxShadow: isSelected ? '0 2px 4px rgba(79, 70, 229, 0.15)' : 'none',
                        }}
                      >
                        <div style={{ fontSize: '14px' }}>{m.label}</div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px', fontWeight: 500 }}>
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
                    borderRadius: '12px',
                    padding: '16px',
                    marginBottom: '16px',
                  }}
                >
                  <label
                    htmlFor="single-tendered-amount"
                    style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}
                  >
                    Cash Tendered (Rupees)
                  </label>
                  <input
                    id="single-tendered-amount"
                    ref={tenderedInputRef}
                    type="number"
                    disabled={isSubmitting}
                    min="0"
                    step="any"
                    value={singleTenderedRupees}
                    onChange={(e) => setSingleTenderedRupees(e.target.value)}
                    className="tabular-nums"
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      fontSize: '22px',
                      fontWeight: 800,
                      borderRadius: '8px',
                      border: '2px solid #cbd5e1',
                      outline: 'none',
                      backgroundColor: '#ffffff',
                    }}
                  />

                  {/* Quick tender suggestions */}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                    {quickOptions.map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        className="interactive-btn"
                        disabled={isSubmitting}
                        onClick={() => setSingleTenderedRupees(String(opt.amount))}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 700,
                          color: '#334155',
                          cursor: isSubmitting ? 'not-allowed' : 'pointer',
                          boxShadow: 'var(--shadow-sm)',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Change Due Box */}
                  <div
                    style={{
                      marginTop: '14px',
                      padding: '14px 18px',
                      borderRadius: '10px',
                      backgroundColor: singleChangePaisa >= 0 ? '#ecfdf5' : '#fff1f2',
                      border: `1px solid ${singleChangePaisa >= 0 ? '#a7f3d0' : '#fecdd3'}`,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: 700,
                        color: singleChangePaisa >= 0 ? '#047857' : '#be123c',
                      }}
                    >
                      {singleChangePaisa >= 0 ? '✓ Change to Return:' : '⚠️ Shortfall (Need more cash):'}
                    </span>
                    <span
                      className="tabular-nums"
                      style={{
                        fontSize: '24px',
                        fontWeight: 900,
                        color: singleChangePaisa >= 0 ? '#047857' : '#be123c',
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
                    padding: '16px 18px',
                    backgroundColor: '#eef2ff',
                    border: '1px solid #c7d2fe',
                    borderRadius: '10px',
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: '#3730a3',
                    lineHeight: 1.5,
                  }}
                >
                  Recorded as <strong>{singleMethod === 'card' ? 'Card POS Terminal' : 'Mobile Wallet'}</strong> payment for exact amount: <strong className="tabular-nums">{formatPKR(grandTotalPaisa)}</strong>.
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
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '16px',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#334155', marginBottom: '12px', letterSpacing: '-0.01em' }}>
                Split Payment Allocations
              </div>

              {/* 1. Cash Row */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>
                    💵 Cash Portion (Rupees)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleFillRemaining('cash')}
                    style={{ fontSize: '11px', color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                  >
                    Fill Remaining
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Cash Amount"
                    value={splitCashRupees}
                    onChange={(e) => {
                      setSplitCashRupees(e.target.value);
                      if (!splitCashTenderedRupees || splitCashTenderedRupees === splitCashRupees) {
                        setSplitCashTenderedRupees(e.target.value);
                      }
                    }}
                    className="tabular-nums"
                    style={{
                      flex: 1,
                      padding: '9px 12px',
                      fontSize: '14px',
                      fontWeight: 700,
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Tendered"
                    value={splitCashTenderedRupees}
                    onChange={(e) => setSplitCashTenderedRupees(e.target.value)}
                    title="Cash Tendered (for change calculation)"
                    className="tabular-nums"
                    style={{
                      width: '140px',
                      padding: '9px 12px',
                      fontSize: '14px',
                      fontWeight: 700,
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                </div>
                {splitCashPaisa > 0 && splitChangePaisa >= 0 && (
                  <div className="tabular-nums" style={{ fontSize: '12px', color: '#059669', marginTop: '4px', fontWeight: 700 }}>
                    Change: {formatPKR(splitChangePaisa)}
                  </div>
                )}
              </div>

              {/* 2. Card Row */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>
                    💳 Card Portion (Rupees)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleFillRemaining('card')}
                    style={{ fontSize: '11px', color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                  >
                    Fill Remaining
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Card Amount"
                  value={splitCardRupees}
                  onChange={(e) => setSplitCardRupees(e.target.value)}
                  className="tabular-nums"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    fontSize: '14px',
                    fontWeight: 700,
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                  }}
                />
              </div>

              {/* 3. Wallet Row */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>
                    📱 Wallet Portion (Rupees)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleFillRemaining('wallet')}
                    style={{ fontSize: '11px', color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                  >
                    Fill Remaining
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Wallet Amount"
                  value={splitWalletRupees}
                  onChange={(e) => setSplitWalletRupees(e.target.value)}
                  className="tabular-nums"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    fontSize: '14px',
                    fontWeight: 700,
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                  }}
                />
              </div>

              {/* Split Coverage Balance Summary */}
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  backgroundColor:
                    splitRemainingPaisa === 0
                      ? '#ecfdf5'
                      : splitRemainingPaisa > 0
                      ? '#fffbeb'
                      : '#fff1f2',
                  border: `1px solid ${
                    splitRemainingPaisa === 0
                      ? '#a7f3d0'
                      : splitRemainingPaisa > 0
                      ? '#fde68a'
                      : '#fecdd3'
                  }`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '13px',
                  fontWeight: 700,
                }}
              >
                <span>
                  {splitRemainingPaisa === 0
                    ? '✓ Total Covered Exactly:'
                    : splitRemainingPaisa > 0
                    ? '⚠️ Remaining to Cover:'
                    : '⚠️ Overpaid by:'}
                </span>
                <span className="tabular-nums" style={{ fontSize: '16px', fontWeight: 800 }}>
                  {formatPKR(Math.abs(splitRemainingPaisa))}
                </span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '18px' }}>
            <button
              type="button"
              className="interactive-btn"
              disabled={isSubmitting}
              onClick={onClose}
              style={{
                padding: '11px 20px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: 700,
                color: '#475569',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel (Esc)
            </button>
            <button
              type="submit"
              className="interactive-btn"
              disabled={!isPayable}
              style={{
                padding: '11px 26px',
                background: isPayable ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '#cbd5e1',
                border: 'none',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: 800,
                color: '#ffffff',
                cursor: isPayable ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: isPayable ? '0 4px 14px rgba(16, 185, 129, 0.35)' : 'none',
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
