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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          width: '760px',
          maxWidth: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #cbd5e1',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>🔄</span>
              <h3
                id="substitutes-modal-title"
                style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}
              >
                Generic Substitutes Available
              </h3>
            </div>
            <div style={{ marginTop: '6px', fontSize: '13px', color: '#64748b' }}>
              Original: <strong style={{ color: '#0f172a' }}>{product.brandName}</strong> ({product.genericName} {product.strength})
              {product.totalStock <= 0 ? (
                <span
                  style={{
                    marginLeft: '8px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: '#fee2e2',
                    color: '#b91c1c',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  Out of Stock
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close substitutes modal"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '20px',
              color: '#64748b',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Content List */}
        <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
              Finding available substitutes sharing '{product.genericName}'...
            </div>
          ) : substitutes.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔍</div>
              <div style={{ fontWeight: 600, color: '#1e293b' }}>
                No active substitutes found in database
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                No other products currently share the generic formula '{product.genericName}'.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                style={{
                  fontSize: '12px',
                  color: '#64748b',
                  marginBottom: '4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>Found {substitutes.length} matching alternatives with same active ingredient:</span>
                <span>Use [↑][↓] to navigate, [Enter] to choose</span>
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
                      padding: '12px 16px',
                      borderRadius: '8px',
                      border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                      backgroundColor: isSelected ? '#eff6ff' : inStock ? '#ffffff' : '#f8fafc',
                      cursor: inStock ? 'pointer' : 'not-allowed',
                      opacity: inStock ? 1 : 0.65,
                      transition: 'border 0.1s ease',
                    }}
                  >
                    <div style={{ flex: 1, marginRight: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>
                          {sub.brandName}
                        </span>
                        <span
                          style={{
                            padding: '1px 6px',
                            backgroundColor: '#e2e8f0',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#475569',
                          }}
                        >
                          {sub.form} • {sub.strength}
                        </span>
                        {sub.isControlled && (
                          <span
                            style={{
                              padding: '1px 6px',
                              backgroundColor: '#fee2e2',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: 700,
                              color: '#b91c1c',
                            }}
                          >
                            CONTROLLED
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                        Mfr: {sub.manufacturer}
                        {sub.earliestBatch && (
                          <span style={{ marginLeft: '12px' }}>
                            Earliest Batch: <strong>{sub.earliestBatch.batchNo}</strong> (Exp: {sub.earliestBatch.expiryDate})
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>
                          {formatPKR(sub.mrpPaisa)}
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            color: inStock ? '#166534' : '#dc2626',
                          }}
                        >
                          {inStock ? `${sub.totalStock} in stock` : '0 in stock'}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={!inStock}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (inStock) onSelectSubstitute(sub);
                        }}
                        style={{
                          padding: '8px 14px',
                          backgroundColor: inStock ? (isSelected ? '#2563eb' : '#3b82f6') : '#cbd5e1',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          fontWeight: 600,
                          fontSize: '13px',
                          cursor: inStock ? 'pointer' : 'not-allowed',
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
            padding: '12px 24px',
            backgroundColor: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 18px',
              backgroundColor: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#475569',
              cursor: 'pointer',
            }}
          >
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
