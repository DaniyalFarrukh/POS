import React, { useState } from 'react';
import type { CartItem, CustomerInfo, HeldCart } from './types';
import { formatPKR, type Paisa } from '@pos/shared';

interface HeldCartsModalProps {
  activeLines: CartItem[];
  customer: CustomerInfo;
  grandTotalPaisa: Paisa;
  heldCarts: HeldCart[];
  onHoldActiveCart: (note: string) => void;
  onRecallCart: (heldCart: HeldCart) => void;
  onDeleteHeldCart: (heldCartId: string) => void;
  onClose: () => void;
}

export const HeldCartsModal: React.FC<HeldCartsModalProps> = ({
  activeLines,
  customer,
  grandTotalPaisa,
  heldCarts,
  onHoldActiveCart,
  onRecallCart,
  onDeleteHeldCart,
  onClose,
}) => {
  const [parkNote, setParkNote] = useState('');

  const handlePark = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeLines.length === 0) return;
    onHoldActiveCart(parkNote.trim());
    setParkNote('');
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="held-carts-modal-title"
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content-card"
        style={{
          width: '700px',
          maxWidth: '100%',
          maxHeight: '88vh',
        }}
      >
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>🛒</span>
            <h3
              id="held-carts-modal-title"
              style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}
            >
              Park / Recall Transactions
            </h3>
            <kbd className="kbd-cap" style={{ fontSize: '10px', padding: '1px 5px' }}>F4</kbd>
          </div>
          <button
            type="button"
            className="interactive-btn"
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: '6px',
              width: '30px',
              height: '30px',
              fontSize: '16px',
              color: '#64748b',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {/* Park Current Cart Section */}
          {activeLines.length > 0 && (
            <div
              style={{
                backgroundColor: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: '12px',
                padding: '16px 18px',
                marginBottom: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 800, color: '#065f46', fontSize: '14px' }}>
                    Park Active Cart ({activeLines.length} items • <span className="tabular-nums">{formatPKR(grandTotalPaisa)}</span>)
                  </div>
                  <div style={{ fontSize: '12px', color: '#047857', marginTop: '2px', fontWeight: 500 }}>
                    Patient: {customer.name || 'Walk-in Customer'}
                  </div>
                </div>
              </div>

              <form onSubmit={handlePark} style={{ marginTop: '12px', display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  placeholder="Optional reference / note (e.g. Customer getting prescription / cash)..."
                  value={parkNote}
                  onChange={(e) => setParkNote(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid #a7f3d0',
                    fontSize: '13px',
                    backgroundColor: '#ffffff',
                    outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  className="interactive-btn"
                  style={{
                    padding: '9px 18px',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '13px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 6px rgba(16, 185, 129, 0.25)',
                  }}
                >
                  Park Cart
                </button>
              </form>
            </div>
          )}

          {/* Held Carts List */}
          <div>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#334155', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Parked Transactions ({heldCarts.length})
            </div>

            {heldCarts.length === 0 ? (
              <div
                style={{
                  padding: '36px 20px',
                  textAlign: 'center',
                  color: '#94a3b8',
                  border: '2px dashed #cbd5e1',
                  borderRadius: '12px',
                  fontSize: '13px',
                }}
              >
                No parked carts in memory. Press <kbd className="kbd-cap">F4</kbd> whenever you need to serve another customer while keeping an existing cart open.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {heldCarts.map((held) => (
                  <div
                    key={held.id}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '14px 18px',
                      backgroundColor: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '14px' }}>
                          {held.customer.name || 'Walk-in Customer'}
                        </span>
                        <span className="tabular-nums" style={{ fontSize: '11px', color: '#64748b' }}>
                          • {held.heldAt}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#475569', marginTop: '3px' }}>
                        {held.cartLines.length} items • <strong className="tabular-nums">{formatPKR(held.totalPaisa)}</strong>
                        {held.note && (
                          <span style={{ marginLeft: '10px', color: '#4f46e5', fontStyle: 'italic', fontWeight: 600 }}>
                            "{held.note}"
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="interactive-btn"
                        onClick={() => {
                          onRecallCart(held);
                          onClose();
                        }}
                        style={{
                          padding: '8px 16px',
                          background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          boxShadow: '0 2px 6px rgba(79, 70, 229, 0.25)',
                        }}
                      >
                        Recall Cart
                      </button>
                      <button
                        type="button"
                        className="interactive-btn"
                        onClick={() => onDeleteHeldCart(held.id)}
                        style={{
                          padding: '8px 12px',
                          backgroundColor: '#fff1f2',
                          color: '#be123c',
                          border: '1px solid #fecdd3',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            padding: '14px 24px',
            backgroundColor: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
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
            }}
          >
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
