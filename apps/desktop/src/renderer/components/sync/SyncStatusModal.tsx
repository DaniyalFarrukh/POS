import React, { useEffect, useState, useCallback } from 'react';
import type { AuthSession } from '@pos/shared';
import type { SyncStatus } from './types';
import { getSyncStateStyle, formatKarachiDateTime } from './types';
import { SyncExceptionsView } from './SyncExceptionsView';

interface SyncStatusModalProps {
  session: AuthSession;
  onClose: () => void;
  initialTab?: 'overview' | 'exceptions';
}

export const SyncStatusModal: React.FC<SyncStatusModalProps> = ({
  session,
  onClose,
  initialTab = 'overview',
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'exceptions'>(initialTab);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  const canManageExceptions = session.user.role === 'owner' || session.user.role === 'pharmacist';

  const fetchStatus = useCallback(async () => {
    if (!window.api?.sync?.getStatus) return;
    try {
      const s = await window.api.sync.getStatus();
      setStatus(s);
    } catch (err) {
      console.error('[SyncStatusModal] Failed to fetch sync status:', err);
    } finally {
      setLoading(false);
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

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setActionMsg(null);
    try {
      if (!window.api?.sync?.syncNow) {
        throw new Error('Sync API not available');
      }
      const newStatus = await window.api.sync.syncNow();
      setStatus(newStatus);
      setActionMsg({ text: 'Sync cycle completed successfully.' });
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
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
          width: '740px',
          maxWidth: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #cbd5e1',
          overflow: 'hidden',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#ffffff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: stateStyle.badgeBg,
                color: stateStyle.badgeText,
                border: `1px solid ${stateStyle.badgeBorder}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
              }}
            >
              🔄
            </div>
            <div>
              <h2 id="sync-modal-title" style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                Cloud Synchronization Center
              </h2>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                Counter: <strong>{session.counter.name}</strong> • Branch: <strong>{session.branch.name}</strong>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Close dialog (Esc)"
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
              color: '#64748b',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher if user can access Exceptions */}
        {canManageExceptions && (
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
              padding: '0 24px',
              gap: '24px',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              style={{
                padding: '12px 4px',
                border: 'none',
                background: 'none',
                borderBottom: `2px solid ${activeTab === 'overview' ? '#2563eb' : 'transparent'}`,
                color: activeTab === 'overview' ? '#1d4ed8' : '#64748b',
                fontWeight: activeTab === 'overview' ? 700 : 500,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Sync Status & Metrics
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('exceptions')}
              style={{
                padding: '12px 4px',
                border: 'none',
                background: 'none',
                borderBottom: `2px solid ${activeTab === 'exceptions' ? '#2563eb' : 'transparent'}`,
                color: activeTab === 'exceptions' ? '#1d4ed8' : '#64748b',
                fontWeight: activeTab === 'exceptions' ? 700 : 500,
                fontSize: '13px',
                cursor: 'pointer',
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
                    padding: '1px 7px',
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

        {/* Modal Body */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, backgroundColor: '#f8fafc' }}>
          {activeTab === 'exceptions' && canManageExceptions ? (
            <SyncExceptionsView
              onBackToStatus={() => setActiveTab('overview')}
              onRefreshParent={fetchStatus}
            />
          ) : loading && !status ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>
              Loading sync status and metrics...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Feedback Alert */}
              {actionMsg && (
                <div
                  role="status"
                  style={{
                    padding: '10px 16px',
                    borderRadius: '6px',
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

              {/* Status Banner Card */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                  padding: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      backgroundColor: stateStyle.dotColor,
                      boxShadow: status?.state === 'syncing' ? `0 0 0 3px ${stateStyle.badgeBorder}` : undefined,
                    }}
                  />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                        Connection: {stateStyle.label}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: stateStyle.badgeBg,
                          color: stateStyle.badgeText,
                          border: `1px solid ${stateStyle.badgeBorder}`,
                        }}
                      >
                        {status?.state ?? 'offline'}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
                      Last Online:{' '}
                      <strong>{formatKarachiDateTime(status?.lastOnlineAt)}</strong>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={syncing || status?.state === 'syncing'}
                  onClick={handleSyncNow}
                  style={{
                    padding: '8px 20px',
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
                    boxShadow: '0 1px 2px rgba(37,99,235,0.2)',
                  }}
                >
                  <span style={{ display: 'inline-block', animation: syncing ? 'spin 1s linear infinite' : undefined }}>
                    ↻
                  </span>
                  <span>{syncing || status?.state === 'syncing' ? 'Syncing...' : 'Retry Now'}</span>
                </button>
              </div>

              {/* Server Error Callout if any */}
              {status?.lastError && (
                <div
                  style={{
                    padding: '12px 16px',
                    backgroundColor: '#fff1f2',
                    borderRadius: '8px',
                    border: '1px solid #ffe4e6',
                    color: '#9f1239',
                    fontSize: '13px',
                  }}
                >
                  <strong>Last Sync Warning:</strong> {status.lastError}
                </div>
              )}

              {/* 4-Tile Metrics Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '16px',
                }}
              >
                {/* Pending Events Card */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    padding: '16px',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>
                    PENDING OUTBOX EVENTS
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 800, color: (status?.pendingCount ?? 0) > 0 ? '#d97706' : '#16a34a', marginTop: '6px' }}>
                    {status?.pendingCount ?? 0}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                    {(status?.pendingCount ?? 0) === 0
                      ? 'All sales, shifts and stock transactions synced to cloud'
                      : 'Queued to be pushed on next sync schedule'}
                  </div>
                </div>

                {/* Exceptions Card */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '10px',
                    border: `1px solid ${(status?.exceptionCount ?? 0) > 0 ? '#fecaca' : '#e2e8f0'}`,
                    padding: '16px',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>
                    SYNC EXCEPTIONS
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 800, color: (status?.exceptionCount ?? 0) > 0 ? '#dc2626' : '#16a34a', marginTop: '6px' }}>
                    {status?.exceptionCount ?? 0}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      {(status?.exceptionCount ?? 0) === 0
                        ? 'Zero rejected events'
                        : 'Events rejected by server'}
                    </span>
                    {canManageExceptions && (status?.exceptionCount ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('exceptions')}
                        style={{
                          border: 'none',
                          background: 'none',
                          color: '#2563eb',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        Review Exceptions →
                      </button>
                    )}
                  </div>
                </div>

                {/* Last Push Card */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    padding: '16px',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>
                    LAST SUCCESSFUL PUSH
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
                    {formatKarachiDateTime(status?.lastPushOkAt)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                    Outbox sales and inventory movements pushed to central server
                  </div>
                </div>

                {/* Last Pull Card */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    padding: '16px',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>
                    LAST SUCCESSFUL PULL
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
                    {formatKarachiDateTime(status?.lastPullOkAt)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                    Product catalog, prices, and batches pulled from central server
                  </div>
                </div>
              </div>

              {/* Offline Duration vs Limit Progress Meter */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                  padding: '20px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                      Offline Duration vs. Limit
                    </span>
                    <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '8px' }}>
                      ({hoursOffline.toFixed(1)} hours offline / 72 hours max)
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      color: getMeterColor(),
                    }}
                  >
                    {percentUsed}% limit used
                  </span>
                </div>

                {/* Meter Bar */}
                <div
                  style={{
                    height: '10px',
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

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
                  <span>0h (Connected)</span>
                  <span>36h (Warning 50%)</span>
                  <span>58h (Critical 80%)</span>
                  <span>72h (Exceeded 100%)</span>
                </div>

                {offlineLevel !== 'ok' && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '8px 12px',
                      backgroundColor: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: '#92400e',
                    }}
                  >
                    Notice: POS sales are <strong>never blocked</strong> by offline duration. Connect to network to refresh inventory and cloud backups.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#ffffff',
          }}
        >
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            SQLite WAL local engine • All timestamps in Pakistan Standard Time (PKT)
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 18px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#334155',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
