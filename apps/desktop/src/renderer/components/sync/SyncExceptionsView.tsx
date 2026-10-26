import React, { useEffect, useState, useCallback } from 'react';
import type { SyncExceptionRecord, SyncExceptionStatus } from './types';
import { formatKarachiDateTime, summarizePayload } from './types';

interface SyncExceptionsViewProps {
  onBackToStatus?: () => void;
  onRefreshParent?: () => void;
}

export const SyncExceptionsView: React.FC<SyncExceptionsViewProps> = ({
  onBackToStatus,
  onRefreshParent,
}) => {
  const [exceptions, setExceptions] = useState<SyncExceptionRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterStatus, setFilterStatus] = useState<SyncExceptionStatus | 'all'>('open');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  // Dismiss modal state
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissNote, setDismissNote] = useState<string>('');
  const [submittingDismiss, setSubmittingDismiss] = useState<boolean>(false);

  // Retrying state
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Expanded payloads map
  const [expandedPayloads, setExpandedPayloads] = useState<Record<string, boolean>>({});

  const fetchExceptions = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      if (!window.api?.sync?.listExceptions) {
        throw new Error('Sync API not available in current window');
      }
      const statusParam = filterStatus === 'all' ? undefined : filterStatus;
      const data = await window.api.sync.listExceptions(statusParam);
      setExceptions(data);
    } catch (err) {
      console.error('[SyncExceptionsView] Error fetching exceptions:', err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    fetchExceptions();
  }, [fetchExceptions]);

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    setActionSuccessMsg(null);
    setErrorMsg(null);
    try {
      const res = await window.api.sync.retryException(id);
      if (res.success) {
        setActionSuccessMsg(`Event ${id.slice(0, 8)}... marked for retry. Sync will dispatch shortly.`);
        await fetchExceptions();
        onRefreshParent?.();
      } else {
        setErrorMsg('Failed to retry event (already resolved or not found).');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRetryingId(null);
    }
  };

  const openDismissModal = (id: string) => {
    setDismissingId(id);
    setDismissNote('');
    setErrorMsg(null);
  };

  const handleConfirmDismiss = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dismissingId) return;
    setSubmittingDismiss(true);
    setErrorMsg(null);
    try {
      const res = await window.api.sync.dismissException(dismissingId, dismissNote.trim() || undefined);
      if (res.success) {
        setActionSuccessMsg(`Exception ${dismissingId.slice(0, 8)}... dismissed successfully.`);
        setDismissingId(null);
        await fetchExceptions();
        onRefreshParent?.();
      } else {
        setErrorMsg('Failed to dismiss exception.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingDismiss(false);
    }
  };

  const toggleExpandPayload = (id: string) => {
    setExpandedPayloads((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const getStatusBadge = (status: SyncExceptionStatus) => {
    switch (status) {
      case 'open':
        return { text: 'Open / Rejected', bg: '#fee2e2', color: '#991b1b', border: '#fecaca' };
      case 'retried':
        return { text: 'Retried', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' };
      case 'dismissed':
        return { text: 'Dismissed', bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' };
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top Header / Actions Bar */}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {onBackToStatus && (
              <button
                type="button"
                onClick={onBackToStatus}
                style={{
                  padding: '5px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#475569',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
            )}
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
              Synchronization Exceptions
            </h2>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                border: '1px solid #fecaca',
              }}
            >
              Pharmacist / Owner Access
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
            Inspect sync events rejected by the central server. Retry recovered events or dismiss with audit notes.
          </p>
        </div>

        {/* Filter Pills & Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              display: 'flex',
              backgroundColor: '#f1f5f9',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
            }}
          >
            {(['open', 'retried', 'dismissed', 'all'] as const).map((tab) => {
              const active = filterStatus === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilterStatus(tab)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: active ? '#ffffff' : 'transparent',
                    color: active ? '#0f172a' : '#64748b',
                    fontSize: '12px',
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                    textTransform: 'capitalize',
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => fetchExceptions()}
            title="Refresh exceptions"
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#334155',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>↻</span>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {actionSuccessMsg && (
        <div
          role="status"
          style={{
            marginBottom: '16px',
            padding: '10px 16px',
            borderRadius: '6px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            fontSize: '13px',
            fontWeight: 500,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>✅ {actionSuccessMsg}</span>
          <button
            type="button"
            onClick={() => setActionSuccessMsg(null)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#166534', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          style={{
            marginBottom: '16px',
            padding: '10px 16px',
            borderRadius: '6px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Main List */}
      {loading ? (
        <div
          style={{
            padding: '40px',
            textAlign: 'center',
            color: '#64748b',
            fontSize: '14px',
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
          }}
        >
          Loading sync exceptions...
        </div>
      ) : exceptions.length === 0 ? (
        <div
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div style={{ fontSize: '36px' }}>🎉</div>
          <div style={{ fontWeight: 700, fontSize: '16px', color: '#0f172a' }}>
            No {filterStatus === 'all' ? '' : filterStatus} exceptions found
          </div>
          <p style={{ margin: 0, color: '#64748b', fontSize: '13px', maxWidth: '400px' }}>
            All outbound transactions and stock events synchronized cleanly without rejected records.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
          {exceptions.map((ex) => {
            const badge = getStatusBadge(ex.status);
            const payloadSummary = summarizePayload(ex.payload);
            const isExpanded = Boolean(expandedPayloads[ex.id]);
            const isRetrying = retryingId === ex.id;

            return (
              <div
                key={ex.id}
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '10px',
                  border: `1px solid ${ex.status === 'open' ? '#fecaca' : '#e2e8f0'}`,
                  padding: '16px 20px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                {/* Row Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: badge.bg,
                        color: badge.color,
                        border: `1px solid ${badge.border}`,
                        fontSize: '11px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {badge.text}
                    </span>

                    <span
                      style={{
                        fontFamily: 'Consolas, monospace',
                        fontSize: '12px',
                        fontWeight: 700,
                        backgroundColor: '#f1f5f9',
                        color: '#b91c1c',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      {ex.code}
                    </span>

                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                      {payloadSummary.type}
                    </span>
                  </div>

                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    {formatKarachiDateTime(ex.createdAt)}
                  </div>
                </div>

                {/* Error Message */}
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#fff1f2',
                    borderRadius: '6px',
                    border: '1px solid #ffe4e6',
                    color: '#9f1239',
                    fontSize: '13px',
                    fontWeight: 500,
                  }}
                >
                  <strong>Server Rejection:</strong> {ex.message}
                </div>

                {/* Payload Quick Summary */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    backgroundColor: '#f8fafc',
                    padding: '8px 14px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#334155',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Summary:</span>
                  <span>{payloadSummary.summary}</span>

                  {payloadSummary.details.map((d) => (
                    <span key={d.label} style={{ color: '#64748b' }}>
                      <strong style={{ color: '#475569' }}>{d.label}:</strong> {d.value}
                    </span>
                  ))}

                  <button
                    type="button"
                    onClick={() => toggleExpandPayload(ex.id)}
                    style={{
                      marginLeft: 'auto',
                      border: 'none',
                      background: 'none',
                      color: '#2563eb',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {isExpanded ? 'Hide Payload ▲' : 'View Raw JSON ▼'}
                  </button>
                </div>

                {/* Expanded Raw Payload */}
                {isExpanded && (
                  <pre
                    style={{
                      margin: 0,
                      padding: '12px',
                      borderRadius: '6px',
                      backgroundColor: '#0f172a',
                      color: '#e2e8f0',
                      fontSize: '11px',
                      fontFamily: 'Consolas, monospace',
                      overflowX: 'auto',
                      maxHeight: '200px',
                    }}
                  >
                    {JSON.stringify(ex.payload, null, 2)}
                  </pre>
                )}

                {/* Resolution note if dismissed */}
                {ex.note && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#475569',
                      padding: '6px 10px',
                      backgroundColor: '#f1f5f9',
                      borderRadius: '4px',
                      borderLeft: '3px solid #94a3b8',
                    }}
                  >
                    <strong>Resolution Note:</strong> {ex.note}
                    {ex.resolvedAt && (
                      <span style={{ color: '#94a3b8', marginLeft: '8px' }}>
                        ({formatKarachiDateTime(ex.resolvedAt)})
                      </span>
                    )}
                  </div>
                )}

                {/* Actions (Only for Open exceptions) */}
                {ex.status === 'open' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
                    <button
                      type="button"
                      disabled={isRetrying}
                      onClick={() => openDismissModal(ex.id)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#ffffff',
                        color: '#475569',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Dismiss with Note
                    </button>

                    <button
                      type="button"
                      disabled={isRetrying}
                      onClick={() => handleRetry(ex.id)}
                      style={{
                        padding: '6px 16px',
                        borderRadius: '6px',
                        border: 'none',
                        backgroundColor: '#2563eb',
                        color: '#ffffff',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: isRetrying ? 'not-allowed' : 'pointer',
                        opacity: isRetrying ? 0.7 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      {isRetrying ? 'Retrying...' : '↻ Retry Event'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Dismiss Dialog Modal */}
      {dismissingId && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '24px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !submittingDismiss) setDismissingId(null);
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              width: '460px',
              maxWidth: '100%',
              padding: '24px',
              border: '1px solid #cbd5e1',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                Dismiss Sync Exception
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                Provide an audit note explaining why this rejected event is being dismissed (e.g. corrected in backoffice or voided).
              </p>
            </div>

            <form onSubmit={handleConfirmDismiss} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label
                  htmlFor="dismiss-note-input"
                  style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}
                >
                  Resolution Note (Required for Audit):
                </label>
                <textarea
                  id="dismiss-note-input"
                  rows={3}
                  required
                  placeholder="e.g., Line prices corrected manually in central database by owner."
                  value={dismissNote}
                  onChange={(e) => setDismissNote(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    fontFamily: 'inherit',
                    outline: 'none',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                  }}
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  disabled={submittingDismiss}
                  onClick={() => setDismissingId(null)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={submittingDismiss || !dismissNote.trim()}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: '#dc2626',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: submittingDismiss || !dismissNote.trim() ? 'not-allowed' : 'pointer',
                    opacity: submittingDismiss || !dismissNote.trim() ? 0.6 : 1,
                  }}
                >
                  {submittingDismiss ? 'Dismissing...' : 'Confirm Dismissal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
