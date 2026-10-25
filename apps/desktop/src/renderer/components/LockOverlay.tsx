import React, { useState } from 'react';
import type { AuthSession } from '@pos/shared';
import { PinPad } from './PinPad';

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
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          padding: '32px 28px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        {/* Lock Icon */}
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            backgroundColor: '#fee2e2',
            color: '#dc2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            marginBottom: '16px',
          }}
        >
          🔒
        </div>

        <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
          Terminal Locked
        </h2>
        <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }}>
          {session.branch.name} • {session.counter.name}
        </p>

        {/* User Card */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 16px',
            backgroundColor: '#f8fafc',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            marginBottom: '16px',
            width: '100%',
            boxSizing: 'border-box',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {session.user.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>
              {session.user.name}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>
              Role: {session.user.role}
            </div>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#fef2f2',
              color: '#b91c1c',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              fontSize: '13px',
              marginBottom: '12px',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            {error}
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
          onClick={onSwitchUser}
          style={{
            marginTop: '20px',
            background: 'none',
            border: 'none',
            color: '#64748b',
            fontSize: '13px',
            fontWeight: 500,
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
