import React, { useState, useEffect } from 'react';
import type { AdjustmentReasonType, ProductWithTax } from '@pos/shared';

interface StockAdjustmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialProductId?: string;
  initialBatchId?: string;
  initialBatchNo?: string;
  initialBalance?: number;
  productName?: string;
}

export const StockAdjustmentModal: React.FC<StockAdjustmentModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialProductId = '',
  initialBatchId = '',
  initialBatchNo = '',
  initialBalance = 0,
  productName = '',
}) => {
  const [productId, setProductId] = useState<string>(initialProductId);
  const [batchId, setBatchId] = useState<string>(initialBatchId);
  const [currentBalance, setCurrentBalance] = useState<number>(initialBalance);
  const [displayProductName, setDisplayProductName] = useState<string>(productName);

  // Available batches for selected product
  const [availableBatches, setAvailableBatches] = useState<
    { id: string; batchNo: string; expiryDate: string; balance: number }[]
  >([]);

  // Adjustment form state
  const [adjustmentDirection, setAdjustmentDirection] = useState<'decrease' | 'increase'>('decrease');
  const [quantity, setQuantity] = useState<number>(1);
  const [reasonType, setReasonType] = useState<AdjustmentReasonType>('damage');
  const [reasonDetails, setReasonDetails] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Product search if not initial
  const [searchProductQuery, setSearchProductQuery] = useState<string>('');
  const [productSearchResults, setProductSearchResults] = useState<ProductWithTax[]>([]);

  useEffect(() => {
    if (initialProductId) {
      setProductId(initialProductId);
      setBatchId(initialBatchId);
      setCurrentBalance(initialBalance);
      setDisplayProductName(productName);
    }
  }, [initialProductId, initialBatchId, initialBalance, productName]);

  // Load batches when productId changes
  useEffect(() => {
    if (!productId) return;
    window.api.stock
      .getBatchesForProduct(productId)
      .then((batches) => {
        setAvailableBatches(batches);
        if (batches.length > 0 && !batchId) {
          const first = batches[0]!;
          setBatchId(first.id);
          setCurrentBalance(first.balance);
        } else if (batchId) {
          const matching = batches.find((b) => b.id === batchId);
          if (matching) setCurrentBalance(matching.balance);
        }
      })
      .catch((err) => console.error('Failed to load batches for product:', err));
  }, [productId, batchId]);

  // Product search
  useEffect(() => {
    if (!searchProductQuery.trim() || initialProductId) {
      setProductSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      window.api.products
        .getProducts({ search: searchProductQuery.trim(), pageSize: 8 })
        .then((res) => setProductSearchResults(res.products))
        .catch((err) => console.error(err));
    }, 200);
    return () => clearTimeout(timer);
  }, [searchProductQuery, initialProductId]);

  if (!isOpen) return null;

  const signedDelta = adjustmentDirection === 'decrease' ? -Math.abs(quantity) : Math.abs(quantity);
  const projectedBalance = currentBalance + signedDelta;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!productId) {
      setErrorMessage('Please select a product.');
      return;
    }
    if (!batchId) {
      setErrorMessage('Please select a batch.');
      return;
    }
    if (quantity <= 0) {
      setErrorMessage('Quantity must be greater than zero.');
      return;
    }
    if (!reasonDetails.trim()) {
      setErrorMessage('Detailed reason explanation is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      await window.api.stock.adjustStock({
        productId,
        batchId,
        quantitySigned: signedDelta,
        reasonType,
        reason: reasonDetails.trim(),
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save stock adjustment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          width: '520px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#f8fafc',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              Stock Adjustment (Movements Rule 4 & 5)
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#64748b' }}>
              Records a signed adjustment movement in the audit trail.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '18px',
              color: '#64748b',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px' }}>
          {errorMessage && (
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                borderRadius: '6px',
                fontSize: '12px',
                marginBottom: '14px',
                fontWeight: 500,
              }}
            >
              {errorMessage}
            </div>
          )}

          {/* Product Info / Picker */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
              Medicine / Product
            </label>
            {productId ? (
              <div
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#f1f5f9',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#0f172a',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>{displayProductName || 'Selected Medicine'}</span>
                {!initialProductId && (
                  <button
                    type="button"
                    onClick={() => {
                      setProductId('');
                      setBatchId('');
                      setAvailableBatches([]);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#0284c7',
                      fontSize: '11px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div>
                <input
                  type="text"
                  placeholder="Search product to adjust..."
                  value={searchProductQuery}
                  onChange={(e) => setSearchProductQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
                {productSearchResults.length > 0 && (
                  <div
                    style={{
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      marginTop: '4px',
                      maxHeight: '140px',
                      overflowY: 'auto',
                    }}
                  >
                    {productSearchResults.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => {
                          setProductId(p.id);
                          setDisplayProductName(`${p.brandName} ${p.strength} (${p.genericName})`);
                          setSearchProductQuery('');
                        }}
                        style={{
                          padding: '6px 12px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          borderBottom: '1px solid #f1f5f9',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#eff6ff')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
                      >
                        <strong>{p.brandName}</strong> {p.strength} — {p.genericName}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Batch Selector & Current Balance */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Batch Number
              </label>
              {availableBatches.length > 0 ? (
                <select
                  value={batchId}
                  onChange={(e) => {
                    setBatchId(e.target.value);
                    const b = availableBatches.find((item) => item.id === e.target.value);
                    if (b) setCurrentBalance(b.balance);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    backgroundColor: '#ffffff',
                  }}
                >
                  {availableBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchNo} (Exp: {b.expiryDate}) — Bal: {b.balance}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  disabled
                  value={initialBatchNo || 'No batches available'}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    backgroundColor: '#f1f5f9',
                    boxSizing: 'border-box',
                  }}
                />
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Current Balance (Rule 4)
              </label>
              <div
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  fontSize: '15px',
                  fontWeight: 700,
                  color: '#1e293b',
                  textAlign: 'center',
                }}
              >
                {currentBalance} units
              </div>
            </div>
          </div>

          {/* Adjustment Type & Quantity */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Adjustment Action
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setAdjustmentDirection('decrease')}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: '6px',
                    border: adjustmentDirection === 'decrease' ? '2px solid #ef4444' : '1px solid #cbd5e1',
                    backgroundColor: adjustmentDirection === 'decrease' ? '#fef2f2' : '#ffffff',
                    color: adjustmentDirection === 'decrease' ? '#b91c1c' : '#475569',
                    fontWeight: 600,
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  − Reduce (Out)
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustmentDirection('increase')}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: '6px',
                    border: adjustmentDirection === 'increase' ? '2px solid #16a34a' : '1px solid #cbd5e1',
                    backgroundColor: adjustmentDirection === 'increase' ? '#f0fdf4' : '#ffffff',
                    color: adjustmentDirection === 'increase' ? '#15803d' : '#475569',
                    fontWeight: 600,
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  + Add (In)
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Quantity
              </label>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                  fontWeight: 600,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Reason Category */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
              Reason Category <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              value={reasonType}
              onChange={(e) => setReasonType(e.target.value as AdjustmentReasonType)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                backgroundColor: '#ffffff',
              }}
            >
              <option value="damage">Damage (Broken / Leaked / Compromised Packaging)</option>
              <option value="loss">Loss (Expired stock discard / Missing from inventory)</option>
              <option value="correction">Correction (Audit recount / Data entry discrepancy)</option>
            </select>
          </div>

          {/* Detailed Reason Explanation */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
              Explanation / Audit Notes <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <textarea
              rows={2}
              required
              placeholder="e.g. 2 bottles broken during morning shelf arrangement; verified by Pharmacist."
              value={reasonDetails}
              onChange={(e) => setReasonDetails(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                boxSizing: 'border-box',
                resize: 'none',
              }}
            />
          </div>

          {/* Balance Preview Card */}
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#f1f5f9',
              borderRadius: '6px',
              marginBottom: '20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '12px', color: '#475569' }}>
              Movement: <strong>{signedDelta > 0 ? `+${signedDelta}` : signedDelta} units</strong>
            </span>
            <span style={{ fontSize: '13px', color: '#1e293b' }}>
              New Projected Balance:{' '}
              <strong style={{ fontSize: '16px', color: projectedBalance < 0 ? '#dc2626' : '#0f172a' }}>
                {projectedBalance} units
              </strong>
            </span>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#475569',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: '8px 20px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#0284c7',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              {isSubmitting ? 'Recording Movement...' : 'Save Adjustment (1 Tx)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
