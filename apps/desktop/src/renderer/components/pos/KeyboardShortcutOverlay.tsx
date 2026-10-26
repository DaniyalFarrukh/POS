import React from 'react';

interface KeyboardShortcutOverlayProps {
  visible: boolean;
}

export const KeyboardShortcutOverlay: React.FC<KeyboardShortcutOverlayProps> = ({ visible }) => {
  if (!visible) return null;

  const shortcuts = [
    { key: 'F1', label: 'POS Terminal', desc: 'Active sales cart & scanning screen' },
    { key: 'F2', label: 'Pay / Checkout', desc: 'Open payment modal & calculate change' },
    { key: 'F3', label: 'Search / Scan', desc: 'Focus product search for rapid barcode scanning' },
    { key: 'F4', label: 'Hold / Recall', desc: 'Park active cart or resume held transactions' },
    { key: 'F5', label: 'Day-End Report', desc: 'Shift summary, cash count & day-end closure' },
    { key: 'F6', label: 'Customer / Rx', desc: 'Attach patient details, doctor & prescription notes' },
    { key: 'F10', label: 'Lock Terminal', desc: 'Secure register instantly with quick PIN lock' },
    { key: 'Del', label: 'Remove Line', desc: 'Remove currently selected item from cart' },
    { key: 'Esc', label: 'Cancel / Close', desc: 'Dismiss open dialogs or clear search filter' },
  ];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: '68px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        backgroundColor: 'rgba(15, 23, 42, 0.94)',
        backdropFilter: 'blur(16px)',
        color: '#f8fafc',
        borderRadius: '16px',
        padding: '20px 28px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(99, 102, 241, 0.3)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        minWidth: '780px',
        maxWidth: '92vw',
        animation: 'scaleIn 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        pointerEvents: 'none', // Allows clicking through if accidentally holding Alt
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          paddingBottom: '12px',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
            }}
          >
            ⌨️
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '14px', letterSpacing: '0.04em', color: '#ffffff' }}>
              HIGH-SPEED POS SHORTCUTS
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
              Designed for keyboard-only cashier speed
            </div>
          </div>
        </div>
        <span
          style={{
            fontSize: '11px',
            color: '#a5b4fc',
            backgroundColor: 'rgba(99, 102, 241, 0.2)',
            padding: '4px 10px',
            borderRadius: '6px',
            fontWeight: 700,
            border: '1px solid rgba(99, 102, 241, 0.3)',
          }}
        >
          [Alt] Held • Release key to dismiss
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px',
        }}
      >
        {shortcuts.map((s) => (
          <div
            key={s.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              backgroundColor: 'rgba(30, 41, 59, 0.7)',
              padding: '10px 14px',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <kbd
              className="kbd-cap-dark"
              style={{
                fontSize: '12px',
                padding: '4px 8px',
                minWidth: '38px',
                textAlign: 'center',
                flexShrink: 0,
                color: '#38bdf8',
                borderColor: 'rgba(56, 189, 248, 0.4)',
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
              }}
            >
              {s.key}
            </kbd>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: '#f1f5f9' }}>
                {s.label}
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: '#94a3b8',
                  marginTop: '1px',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                }}
              >
                {s.desc}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
