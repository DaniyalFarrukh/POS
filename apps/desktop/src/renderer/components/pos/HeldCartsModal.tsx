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
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
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
          width: '680px',
          maxWidth: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #cbd5e1',
          overflow: 'hidden',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🛒</span>
            <h3
              id="held-carts-modal-title"
              style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}
            >
              Park / Recall Transactions (F4)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '18px',
              color: '#64748b',
              cursor: 'pointer',
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
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#166534', fontSize: '14px' }}>
                    Park Active Cart ({activeLines.length} items • {formatPKR(grandTotalPaisa)})
                  </div>
                  <div style={{ fontSize: '12px', color: '#15803d', marginTop: '2px' }}>
                    Patient: {customer.name || 'Walk-in'}
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
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #86efac',
                    fontSize: '13px',
                  }}
                />
                <button
                  type="submit"
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#16a34a',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Park Cart
                </button>
              </form>
            </div>
          )}

          {/* Held Carts List */}
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '10px' }}>
              Parked Transactions ({heldCarts.length})
            </div>

            {heldCarts.length === 0 ? (
              <div
                style={{
                  padding: '32px',
                  textAlign: 'center',
                  color: '#94a3b8',
                  border: '1px dashed #cbd5e1',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
              >
                No parked carts in memory. Press F4 whenever you need to serve another customer while keeping an existing cart open.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {heldCarts.map((held) => (
                  <div
                    key={held.id}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '14px 16px',
                      backgroundColor: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '14px' }}>
                          {held.customer.name || 'Walk-in Customer'}
                        </span>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>
                          • {held.heldAt}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#475569', marginTop: '3px' }}>
                        {held.cartLines.length} items • <strong>{formatPKR(held.totalPaisa)}</strong>
                        {held.note && (
                          <span style={{ marginLeft: '10px', color: '#0284c7', fontStyle: 'italic' }}>
                            "{held.note}"
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          onRecallCart(held);
                          onClose();
                        }}
                        style={{
                          padding: '7px 14px',
                          backgroundColor: '#2563eb',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Recall Cart
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteHeldCart(held.id)}
                        style={{
                          padding: '7px 10px',
                          backgroundColor: '#fee2e2',
                          color: '#b91c1c',
                          border: '1px solid #fca5a5',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
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
            padding: '12px 24px',
            backgroundColor: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
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
