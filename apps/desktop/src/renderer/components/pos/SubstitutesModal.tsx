import React, { useEffect, useState } from 'react';
import type { PosCatalogItem } from './types';
import { formatPKR } from '@pos/shared';

interface SubstitutesModalProps {
  product: PosCatalogItem | null;
  onSelectSubstitute: (substitute: PosCatalogItem) => void;
  onClose: () => void;
}

export const SubstitutesModal: React.FC<SubstitutesModalProps> = ({
  product,
  onSelectSubstitute,
  onClose,
}) => {
  const [substitutes, setSubstitutes] = useState<PosCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!product) return;
    let active = true;
    setLoading(true);

    window.api.products
      .getSubstitutes(product.genericName, product.id)
      .then((items) => {
        if (!active) return;
        setSubstitutes(items);
        setSelectedIndex(0);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch substitutes:', err);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [product]);

  // Keyboard navigation inside modal (ArrowUp, ArrowDown, Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (substitutes.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % substitutes.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + substitutes.length) % substitutes.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = substitutes[selectedIndex];
        if (selected && selected.totalStock > 0) {
          onSelectSubstitute(selected);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [substitutes, selectedIndex, onSelectSubstitute, onClose]);

  if (!product) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="substitutes-modal-title"
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content-card"
        style={{
          width: '780px',
          maxWidth: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
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
              <span style={{ fontSize: '20px' }}>🔄</span>
              <h3
                id="substitutes-modal-title"
                style={{ margin: 0, fontSize: '18px', fontWeight: 800, letterSpacing: '-0.01em' }}
              >
                Generic Substitutes Available
              </h3>
              <kbd className="kbd-cap-dark" style={{ fontSize: '11px', padding: '1px 6px' }}>
                Esc
              </kbd>
            </div>
            <div style={{ marginTop: '4px', fontSize: '12px', color: '#94a3b8' }}>
              Original: <strong style={{ color: '#ffffff' }}>{product.brandName}</strong> ({product.genericName} {product.strength})
              {product.totalStock <= 0 ? (
                <span
                  style={{
                    marginLeft: '8px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                    color: '#fca5a5',
                    fontSize: '11px',
                    fontWeight: 700,
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                  }}
                >
                  Out of Stock
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="interactive-btn"
            onClick={onClose}
            aria-label="Close substitutes modal"
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

        {/* Content List */}
        <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px', animation: 'pulse 1.5s infinite' }}>⏳</div>
              <div style={{ fontWeight: 600 }}>Searching active substitutes...</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                Matching generic formula '{product.genericName}'
              </div>
            </div>
          ) : substitutes.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center' }}>
              <div style={{ fontSize: '32px', marginBottom: '10px' }}>🔍</div>
              <div style={{ fontWeight: 700, fontSize: '15px', color: '#1e293b' }}>
                No active substitutes found in database
              </div>
              <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                No other registered products currently share the generic formula '{product.genericName}'.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div
                style={{
                  fontSize: '12px',
                  color: '#64748b',
                  marginBottom: '4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>Found <strong style={{ color: '#0f172a' }}>{substitutes.length}</strong> matching alternatives with same active ingredient:</span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Use <kbd className="kbd-cap">↑</kbd> <kbd className="kbd-cap">↓</kbd> to navigate, <kbd className="kbd-cap">Enter</kbd> to choose
                </span>
              </div>

              {substitutes.map((sub, idx) => {
                const isSelected = idx === selectedIndex;
                const inStock = sub.totalStock > 0;

                return (
                  <div
                    key={sub.id}
                    onClick={() => {
                      if (inStock) onSelectSubstitute(sub);
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 18px',
                      borderRadius: '10px',
                      border: isSelected ? '2px solid #6366f1' : '1px solid #e2e8f0',
                      backgroundColor: isSelected ? '#f5f3ff' : inStock ? '#ffffff' : '#f8fafc',
                      boxShadow: isSelected ? '0 4px 12px rgba(99, 102, 241, 0.12)' : '0 1px 2px rgba(0, 0, 0, 0.04)',
                      cursor: inStock ? 'pointer' : 'not-allowed',
                      opacity: inStock ? 1 : 0.65,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ flex: 1, marginRight: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>
                          {sub.brandName}
                        </span>
                        <span
                          style={{
                            padding: '2px 8px',
                            backgroundColor: '#f1f5f9',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#475569',
                            border: '1px solid #e2e8f0',
                          }}
                        >
                          {sub.form} • {sub.strength}
                        </span>
                        {sub.isControlled && (
                          <span
                            style={{
                              padding: '2px 8px',
                              backgroundColor: '#fee2e2',
                              borderRadius: '6px',
                              fontSize: '10px',
                              fontWeight: 800,
                              color: '#b91c1c',
                              border: '1px solid #fecdd3',
                            }}
                          >
                            Rx CONTROLLED
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                        Mfr: <span style={{ fontWeight: 600, color: '#334155' }}>{sub.manufacturer}</span>
                        {sub.earliestBatch && (
                          <span style={{ marginLeft: '12px' }}>
                            Earliest Batch: <strong>{sub.earliestBatch.batchNo}</strong> (Exp: <span className="tabular-nums">{sub.earliestBatch.expiryDate}</span>)
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div className="tabular-nums" style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>
                          {formatPKR(sub.mrpPaisa)}
                        </div>
                        <div
                          className="tabular-nums"
                          style={{
                            fontSize: '12px',
                            fontWeight: 700,
                            color: inStock ? '#059669' : '#dc2626',
                          }}
                        >
                          {inStock ? `${sub.totalStock} in stock` : '0 in stock'}
                        </div>
                      </div>

                      <button
                        type="button"
                        className="interactive-btn"
                        disabled={!inStock}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (inStock) onSelectSubstitute(sub);
                        }}
                        style={{
                          padding: '8px 16px',
                          background: inStock
                            ? isSelected
                              ? 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)'
                              : '#4f46e5'
                            : '#cbd5e1',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          fontWeight: 700,
                          fontSize: '13px',
                          cursor: inStock ? 'pointer' : 'not-allowed',
                          boxShadow: inStock ? '0 2px 4px rgba(79, 70, 229, 0.25)' : 'none',
                        }}
                      >
                        {inStock ? 'Select Substitute' : 'No Stock'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
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
            style={{
              padding: '8px 18px',
              backgroundColor: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              color: '#475569',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>Close</span>
            <kbd className="kbd-cap" style={{ fontSize: '10px' }}>Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  );
};
