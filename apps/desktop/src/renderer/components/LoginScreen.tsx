import React, { useState, useEffect, useCallback } from 'react';
import type { PublicUser, AuthSession } from '@pos/shared';
import { PinPad } from './PinPad';

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
        return { bg: '#fef3c7', text: '#92400e', border: '#fde68a' };
      case 'pharmacist':
        return { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe' };
      default:
        return { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' };
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
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '860px',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        {/* Terminal Header */}
        <div
          style={{
            padding: '24px 32px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#ffffff',
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
              POS Terminal Login
            </h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
              Select your staff profile and enter your PIN
            </p>
          </div>
          <div
            style={{
              padding: '6px 14px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: '#f8fafc',
              color: '#334155',
              border: '1px solid #e2e8f0',
            }}
          >
            Offline Mode • Local WAL
          </div>
        </div>

        {error && (
          <div
            style={{
              margin: '16px 32px 0 32px',
              padding: '12px 16px',
              backgroundColor: '#fef2f2',
              color: '#b91c1c',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '32px', padding: '32px' }}>
          {/* User Selection List */}
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#334155', marginBottom: '14px' }}>
              Choose Account:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {users.map((user) => {
                const isSelected = selectedUser?.id === user.id;
                const badge = getRoleBadgeStyle(user.role);

                return (
                  <div
                    key={user.id}
                    onClick={() => {
                      setSelectedUser(user);
                      setPin('');
                      setError(null);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 18px',
                      borderRadius: '10px',
                      border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                      backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 2px 4px rgba(37, 99, 235, 0.1)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          backgroundColor: isSelected ? '#2563eb' : '#e2e8f0',
                          color: isSelected ? '#ffffff' : '#475569',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '16px',
                        }}
                      >
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '15px', color: '#1e293b' }}>
                          {user.name}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                          Terminal User
                        </div>
                      </div>
                    </div>

                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor: badge.bg,
                        color: badge.text,
                        border: `1px solid ${badge.border}`,
                        textTransform: 'uppercase',
                      }}
                    >
                      {user.role}
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
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
            }}
          >
            {selectedUser ? (
              <>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', marginBottom: '2px' }}>
                  {selectedUser.name}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
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
              <div style={{ color: '#94a3b8', fontSize: '14px' }}>Select an account to log in</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
