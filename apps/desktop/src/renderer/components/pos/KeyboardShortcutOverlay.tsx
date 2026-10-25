import React from 'react';

interface KeyboardShortcutOverlayProps {
  visible: boolean;
}

export const KeyboardShortcutOverlay: React.FC<KeyboardShortcutOverlayProps> = ({ visible }) => {
  if (!visible) return null;

  const shortcuts = [
    { key: 'F2', label: 'Pay / Checkout', desc: 'Open payment modal & calculate change' },
    { key: 'F3', label: 'Search / Scan', desc: 'Focus search input for rapid barcode scanning' },
    { key: 'F4', label: 'Hold / Recall', desc: 'Park active cart or resume held transactions' },
    { key: 'F6', label: 'Customer / Rx', desc: 'Attach patient name, phone, doctor & notes' },
    { key: 'Del', label: 'Remove Line', desc: 'Remove currently selected item from cart' },
    { key: 'Esc', label: 'Cancel / Close', desc: 'Dismiss open dialogs or clear search filter' },
  ];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: '64px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        borderRadius: '12px',
        padding: '16px 24px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
        border: '1px solid #334155',
        minWidth: '680px',
        maxWidth: '90vw',
        animation: 'fadeIn 0.15s ease-out',
        pointerEvents: 'none', // Allows clicking through if accidentally holding Alt
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #1e293b',
          paddingBottom: '10px',
          marginBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>⌨️</span>
          <span style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '0.02em' }}>
            TERMINAL KEYBOARD SHORTCUTS
          </span>
        </div>
        <span
          style={{
            fontSize: '11px',
            color: '#94a3b8',
            backgroundColor: '#1e293b',
            padding: '2px 8px',
            borderRadius: '4px',
            fontWeight: 500,
          }}
        >
          [Alt] Held • Release to dismiss
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
              alignItems: 'flex-start',
              gap: '10px',
              backgroundColor: '#1e293b',
              padding: '8px 10px',
              borderRadius: '6px',
              border: '1px solid #334155',
            }}
          >
            <kbd
              style={{
                display: 'inline-block',
                padding: '3px 8px',
                fontSize: '12px',
                fontWeight: 700,
                color: '#38bdf8',
                backgroundColor: '#0f172a',
                border: '1px solid #0284c7',
                borderRadius: '4px',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
                fontFamily: 'Consolas, monospace',
                flexShrink: 0,
              }}
            >
              {s.key}
            </kbd>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#f1f5f9' }}>
                {s.label}
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: '#94a3b8',
                  marginTop: '2px',
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
