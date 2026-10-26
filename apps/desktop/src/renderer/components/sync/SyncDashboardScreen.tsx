import React, { useEffect, useState, useCallback } from 'react';
import type { AuthSession } from '@pos/shared';
import type { SyncStatus } from './types';
import { getSyncStateStyle, formatKarachiDateTime } from './types';
import { SyncExceptionsView } from './SyncExceptionsView';

interface SyncDashboardScreenProps {
  session: AuthSession;
}

export const SyncDashboardScreen: React.FC<SyncDashboardScreenProps> = ({ session }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'exceptions'>('overview');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  const canManageExceptions = session.user.role === 'owner' || session.user.role === 'pharmacist';

  const fetchStatus = useCallback(async () => {
    if (!window.api?.sync?.getStatus) return;
    try {
      const s = await window.api.sync.getStatus();
      setStatus(s);
    } catch (err) {
      console.error('[SyncDashboardScreen] Error fetching status:', err);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    if (!window.api?.sync?.onStatusChanged) return;
    const unsubscribe = window.api.sync.onStatusChanged((newStatus: SyncStatus) => {
      setStatus(newStatus);
    });

    return () => {
      unsubscribe();
    };
  }, [fetchStatus]);

  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setActionMsg(null);
    try {
      if (!window.api?.sync?.syncNow) throw new Error('Sync API unavailable');
      const s = await window.api.sync.syncNow();
      setStatus(s);
      setActionMsg({ text: 'Sync cycle triggered and completed successfully.' });
    } catch (err) {
      setActionMsg({
        text: err instanceof Error ? err.message : 'Sync failed',
        isError: true,
      });
    } finally {
      setSyncing(false);
    }
  };

  const stateStyle = getSyncStateStyle(status?.state ?? 'offline');
  const percentUsed = Math.min(100, Math.max(0, Math.round(status?.percentUsed ?? 0)));
  const hoursOffline = status?.hoursOffline ?? 0;
  const offlineLevel = status?.offlineLevel ?? 'ok';

  const getMeterColor = () => {
    if (offlineLevel === 'exceeded' || offlineLevel === 'critical') return '#dc2626';
    if (offlineLevel === 'warning') return '#d97706';
    return '#16a34a';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
            Cloud Synchronization & Outbox Center
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
            Monitor real-time synchronization between this terminal, branch inventory, and the central cloud database.
          </p>
        </div>

        {/* Tab Selection */}
        {canManageExceptions && (
          <div
            style={{
              display: 'flex',
              backgroundColor: '#e2e8f0',
              padding: '4px',
              borderRadius: '8px',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              style={{
                padding: '6px 16px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: activeTab === 'overview' ? '#ffffff' : 'transparent',
                color: activeTab === 'overview' ? '#0f172a' : '#64748b',
                fontWeight: activeTab === 'overview' ? 700 : 500,
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: activeTab === 'overview' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              Overview & Status
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('exceptions')}
              style={{
                padding: '6px 16px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: activeTab === 'exceptions' ? '#ffffff' : 'transparent',
                color: activeTab === 'exceptions' ? '#0f172a' : '#64748b',
                fontWeight: activeTab === 'exceptions' ? 700 : 500,
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: activeTab === 'exceptions' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>Exceptions Review</span>
              {(status?.exceptionCount ?? 0) > 0 && (
                <span
                  style={{
                    backgroundColor: '#fee2e2',
                    color: '#991b1b',
                    padding: '1px 6px',
                    borderRadius: '9999px',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  {status?.exceptionCount}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {activeTab === 'exceptions' && canManageExceptions ? (
        <SyncExceptionsView
          onBackToStatus={() => setActiveTab('overview')}
          onRefreshParent={fetchStatus}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {actionMsg && (
            <div
              role="status"
              style={{
                padding: '12px 18px',
                borderRadius: '8px',
                backgroundColor: actionMsg.isError ? '#fef2f2' : '#f0fdf4',
                border: `1px solid ${actionMsg.isError ? '#fecaca' : '#bbf7d0'}`,
                color: actionMsg.isError ? '#991b1b' : '#166534',
                fontSize: '13px',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>{actionMsg.isError ? '⚠️' : '✅'} {actionMsg.text}</span>
              <button
                type="button"
                onClick={() => setActionMsg(null)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700 }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Connection Card */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: stateStyle.badgeBg,
                  color: stateStyle.badgeText,
                  border: `1px solid ${stateStyle.badgeBorder}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px',
                }}
              >
                🔄
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                    Sync Status: {stateStyle.label}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: stateStyle.badgeBg,
                      color: stateStyle.badgeText,
                      border: `1px solid ${stateStyle.badgeBorder}`,
                      textTransform: 'uppercase',
                    }}
                  >
                    {status?.state ?? 'offline'}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                  Terminal ID: <strong>{session.counter.name}</strong> • Branch: <strong>{session.branch.name}</strong> • Last Online: <strong>{formatKarachiDateTime(status?.lastOnlineAt)}</strong>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={syncing || status?.state === 'syncing'}
              onClick={handleSyncNow}
              style={{
                padding: '10px 24px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 700,
                cursor: syncing || status?.state === 'syncing' ? 'not-allowed' : 'pointer',
                opacity: syncing || status?.state === 'syncing' ? 0.7 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 2px 4px rgba(37,99,235,0.2)',
              }}
            >
              <span style={{ display: 'inline-block', animation: syncing ? 'spin 1s linear infinite' : undefined }}>
                ↻
              </span>
              <span>{syncing || status?.state === 'syncing' ? 'Synchronizing...' : 'Retry Now'}</span>
            </button>
          </div>

          {/* 4 Cards Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '16px',
            }}
          >
            {/* Pending */}
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                padding: '20px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                Pending Events
              </div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: (status?.pendingCount ?? 0) > 0 ? '#d97706' : '#16a34a', marginTop: '6px' }}>
                {status?.pendingCount ?? 0}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
                {(status?.pendingCount ?? 0) === 0 ? 'Outbox is completely clear' : 'Awaiting push to server'}
              </div>
            </div>

            {/* Exceptions */}
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '10px',
                border: `1px solid ${(status?.exceptionCount ?? 0) > 0 ? '#fecaca' : '#e2e8f0'}`,
                padding: '20px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                Exceptions
              </div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: (status?.exceptionCount ?? 0) > 0 ? '#dc2626' : '#16a34a', marginTop: '6px' }}>
                {status?.exceptionCount ?? 0}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{(status?.exceptionCount ?? 0) === 0 ? 'No rejected records' : 'Requires review'}</span>
                {canManageExceptions && (status?.exceptionCount ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('exceptions')}
                    style={{ border: 'none', background: 'none', color: '#2563eb', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: '11px' }}
                  >
                    View →
                  </button>
                )}
              </div>
            </div>

            {/* Last Push */}
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                padding: '20px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                Last Successful Push
              </div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginTop: '12px' }}>
                {formatKarachiDateTime(status?.lastPushOkAt)}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
                Sales and inventory outbox
              </div>
            </div>

            {/* Last Pull */}
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                padding: '20px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                Last Successful Pull
              </div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginTop: '12px' }}>
                {formatKarachiDateTime(status?.lastPullOkAt)}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
                Master catalog and pricing
              </div>
            </div>
          </div>

          {/* Offline Duration vs Limit Progress Meter */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '24px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div>
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                  Offline Duration vs. Threshold Limit
                </span>
                <span style={{ fontSize: '13px', color: '#64748b', marginLeft: '10px' }}>
                  ({hoursOffline.toFixed(1)} hours offline / 72 hours max)
                </span>
              </div>
              <span style={{ fontSize: '13px', fontWeight: 700, color: getMeterColor() }}>
                {percentUsed}% limit used
              </span>
            </div>

            <div
              style={{
                height: '12px',
                width: '100%',
                backgroundColor: '#e2e8f0',
                borderRadius: '9999px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${percentUsed}%`,
                  backgroundColor: getMeterColor(),
                  borderRadius: '9999px',
                  transition: 'width 0.4s ease-in-out',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
              <span>0h (Connected)</span>
              <span>36h (Warning 50%)</span>
              <span>58h (Critical 80%)</span>
              <span>72h (Exceeded 100%)</span>
            </div>

            {offlineLevel !== 'ok' && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px 16px',
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: '#92400e',
                }}
              >
                ⚠️ <strong>Offline Advisory:</strong> POS terminal operations and checkout are never halted by offline thresholds. However, catalog and stock updates from other counters or branches require synchronization.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
