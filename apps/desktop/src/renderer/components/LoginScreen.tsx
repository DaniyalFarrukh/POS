import React, { useState, useEffect, useCallback } from 'react';
import type { PublicUser, AuthSession } from '@pos/shared';
import { PinPad } from './PinPad';
import { BrandLogo, ShieldCheckIcon } from './common/Icons';

interface LoginScreenProps {
  onLoginSuccess: (session: AuthSession) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<PublicUser | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const activeUsers = await window.api.auth.getUsers();
      setUsers(activeUsers);
      const first = activeUsers[0];
      if (first && !selectedUser) {
        setSelectedUser(first);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedUser]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleLogin = async () => {
    if (!selectedUser) {
      setError('Please select a user account.');
      return;
    }
    if (pin.length < 4) {
      setError('Please enter your full 4-8 digit PIN.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const session = await window.api.auth.login({
        userId: selectedUser.id,
        pin,
      });
      onLoginSuccess(session);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('Invalid PIN') ? 'Incorrect PIN. Please try again.' : msg);
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const getRoleBadgeStyle = (role: string) => {
    switch (role) {
      case 'owner':
        return { bg: '#fef3c7', text: '#92400e', border: '#fde68a', label: 'SUPER ADMIN' };
      case 'pharmacist':
        return { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', label: 'PHARMACIST' };
      default:
        return { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0', label: 'CASHIER' };
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f1f5f9',
        padding: '24px',
        boxSizing: 'border-box',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '860px',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 20px 40px -15px rgba(15, 23, 42, 0.08), 0 0 1px 1px rgba(226, 232, 240, 0.8)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        {/* Terminal Header with Human-Made Brand Logo */}
        <div
          style={{
            padding: '20px 32px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#ffffff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <BrandLogo size={38} showText={true} textSubtitle="Clinical Pharmacy Terminal" />
          </div>

          <div
            style={{
              padding: '6px 14px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: 700,
              backgroundColor: '#f8fafc',
              color: '#334155',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <ShieldCheckIcon size={15} color="#059669" />
            <span>Local SQLite WAL Active</span>
          </div>
        </div>

        {error && (
          <div
            className="shake-animation"
            style={{
              margin: '18px 32px 0 32px',
              padding: '12px 16px',
              backgroundColor: '#fff1f2',
              color: '#be123c',
              border: '1px solid #fecdd3',
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ fontWeight: 800 }}>Notice:</span>
            <span>{error}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '28px', padding: '28px 32px' }}>
          {/* User Selection List */}
          <div>
            <div style={{ fontSize: '12px', fontWeight: 800, color: '#64748b', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Select Account
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {users.map((user) => {
                const isSelected = selectedUser?.id === user.id;
                const badge = getRoleBadgeStyle(user.role);

                return (
                  <div
                    key={user.id}
                    className="interactive-btn"
                    onClick={() => {
                      setSelectedUser(user);
                      setPin('');
                      setError(null);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderRadius: '12px',
                      border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                      backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                      boxShadow: isSelected ? '0 2px 8px rgba(37, 99, 235, 0.1)' : 'var(--shadow-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          width: '38px',
                          height: '38px',
                          borderRadius: '50%',
                          background: isSelected ? 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' : '#f1f5f9',
                          color: isSelected ? '#ffffff' : '#475569',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800,
                          fontSize: '15px',
                        }}
                      >
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '14.5px', color: '#0f172a' }}>
                          {user.name}
                        </div>
                        <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 500 }}>
                          Staff Member
                        </div>
                      </div>
                    </div>

                    <span
                      style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontSize: '10.5px',
                        fontWeight: 800,
                        backgroundColor: badge.bg,
                        color: badge.text,
                        border: `1px solid ${badge.border}`,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {badge.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* PIN Pad Column */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f8fafc',
              padding: '24px 20px',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
            }}
          >
            {selectedUser ? (
              <>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#1e293b', marginBottom: '2px' }}>
                  {selectedUser.name}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', fontWeight: 500 }}>
                  Enter PIN to unlock terminal
                </div>

                <PinPad
                  pin={pin}
                  onChange={setPin}
                  onSubmit={handleLogin}
                  disabled={loading}
                />
              </>
            ) : (
              <div style={{ color: '#94a3b8', fontSize: '14px', fontWeight: 500 }}>Select an account to log in</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
