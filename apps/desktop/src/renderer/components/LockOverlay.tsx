import React, { useState } from 'react';
import type { AuthSession } from '@pos/shared';
import { PinPad } from './PinPad';
import { LockIcon } from './common/Icons';

interface LockOverlayProps {
  session: AuthSession;
  onUnlocked: (session: AuthSession) => void;
  onSwitchUser: () => void;
}

export const LockOverlay: React.FC<LockOverlayProps> = ({
  session,
  onUnlocked,
  onSwitchUser,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleUnlock = async () => {
    if (pin.length < 4) {
      setError('Please enter your 4-8 digit PIN.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const updated = await window.api.auth.unlockSession({ pin });
      onUnlocked(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('Invalid PIN') ? 'Incorrect PIN.' : msg);
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        zIndex: 9999,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        backgroundColor: 'rgba(15, 23, 42, 0.8)',
      }}
    >
      <div
        className="modal-content-card"
        style={{
          width: '100%',
          maxWidth: '430px',
          padding: '36px 32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          borderRadius: '20px',
        }}
      >
        {/* Vector Padlock Badge */}
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            backgroundColor: '#fff1f2',
            border: '1px solid #fecdd3',
            color: '#e11d48',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '16px',
            boxShadow: '0 4px 12px rgba(225, 29, 72, 0.15)',
          }}
        >
          <LockIcon size={26} color="#e11d48" />
        </div>

        <h2 style={{ margin: '0 0 4px 0', fontSize: '22px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
          Terminal Locked
        </h2>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
          {session.branch.name} • {session.counter.name}
        </p>

        {/* User Card */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 18px',
            backgroundColor: '#f8fafc',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            marginBottom: '18px',
            width: '100%',
            boxSizing: 'border-box',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 6px rgba(79, 70, 229, 0.3)',
            }}
          >
            {session.user.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b' }}>
              {session.user.name}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
              Role: {session.user.role}
            </div>
          </div>
        </div>

        {error && (
          <div
            className="shake-animation"
            style={{
              padding: '10px 14px',
              backgroundColor: '#fff1f2',
              color: '#be123c',
              border: '1px solid #fecdd3',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              marginBottom: '16px',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            ⚠️ {error}
          </div>
        )}

        <PinPad
          pin={pin}
          onChange={setPin}
          onSubmit={handleUnlock}
          disabled={loading}
        />

        <button
          type="button"
          className="interactive-btn"
          onClick={onSwitchUser}
          style={{
            marginTop: '22px',
            background: 'none',
            border: 'none',
            color: '#64748b',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          Switch User Account
        </button>
      </div>
    </div>
  );
};
