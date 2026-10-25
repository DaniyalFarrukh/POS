import React, { useState } from 'react';
import type { SetupInput, AuthSession } from '@pos/shared';
import { PinPad } from './PinPad';

interface SetupScreenProps {
  onSetupComplete: (session: AuthSession) => void;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ onSetupComplete }) => {
  const [branchName, setBranchName] = useState('City Pharmacy - Saddar');
  const [counterName, setCounterName] = useState('Counter 01');
  const [ownerName, setOwnerName] = useState('Dr. Tariq');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!branchName.trim() || !counterName.trim() || !ownerName.trim()) {
      setError('Please fill in all store and owner details.');
      return;
    }
    if (pin.length < 4 || pin.length > 8) {
      setError('PIN must be 4 to 8 numeric digits.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const input: SetupInput = {
        branchName: branchName.trim(),
        counterName: counterName.trim(),
        ownerName: ownerName.trim(),
        pin,
      };

      const session = await window.api.auth.completeSetup(input);
      onSetupComplete(session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '820px',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '28px 32px 20px 32px',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
          }}
        >
          <div style={{ display: 'inline-block', padding: '4px 10px', backgroundColor: '#eff6ff', color: '#1d4ed8', borderRadius: '6px', fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>
            INITIAL SETUP WIZARD
          </div>
          <h1 style={{ margin: '0 0 6px 0', fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
            Configure Counter Terminal
          </h1>
          <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>
            Initialize your store branch, counter terminal, and the primary Owner account.
          </p>
        </div>

        {error && (
          <div
            style={{
              margin: '20px 32px 0 32px',
              padding: '12px 16px',
              backgroundColor: '#fef2f2',
              color: '#b91c1c',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              fontSize: '14px',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '32px', padding: '32px' }}>
          {/* Form Fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                Branch / Store Name
              </label>
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="e.g. City Pharmacy - Main"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                Counter Identifier
              </label>
              <input
                type="text"
                value={counterName}
                onChange={(e) => setCounterName(e.target.value)}
                placeholder="e.g. Counter 01"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                Owner / Manager Full Name
              </label>
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="e.g. Dr. Tariq"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ backgroundColor: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '4px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                Security & Role Information:
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                <li>This account will have full <strong>Owner</strong> privileges.</li>
                <li>PIN is hashed with bcryptjs on the local counter terminal.</li>
                <li>Hashes are never exposed to the frontend or network.</li>
              </ul>
            </div>
          </div>

          {/* PIN Setup Keypad */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f8fafc',
              padding: '20px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#1e293b', marginBottom: '4px' }}>
              Set Owner PIN (4-8 digits)
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
              Use keyboard or on-screen keypad
            </div>

            <PinPad
              pin={pin}
              onChange={setPin}
              onSubmit={handleSubmit}
              disabled={loading}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
