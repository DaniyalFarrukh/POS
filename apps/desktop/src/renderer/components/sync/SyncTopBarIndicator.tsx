import React, { useEffect, useState, useCallback } from 'react';
import type { SyncStatus } from './types';
import { getSyncStateStyle } from './types';

interface SyncTopBarIndicatorProps {
  onClick: () => void;
}

export const SyncTopBarIndicator: React.FC<SyncTopBarIndicatorProps> = ({ onClick }) => {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!window.api?.sync?.getStatus) return;
    try {
      const s = await window.api.sync.getStatus();
      setStatus(s);
    } catch (err) {
      console.error('[SyncTopBarIndicator] Failed to fetch status:', err);
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

  const state = status?.state ?? 'offline';
  const style = getSyncStateStyle(state);
  const pendingCount = status?.pendingCount ?? 0;
  const exceptionCount = status?.exceptionCount ?? 0;

  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to view Cloud Synchronization Status and Controls"
      aria-label={`Sync Status: ${style.label}, ${pendingCount} pending events, ${exceptionCount} exceptions`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 12px',
        borderRadius: '9999px',
        backgroundColor: style.badgeBg,
        border: `1px solid ${style.badgeBorder}`,
        color: style.badgeText,
        fontSize: '12px',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s ease-in-out',
        outline: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        e.currentTarget.style.filter = 'brightness(0.97)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.filter = 'none';
      }}
    >
      {/* Animated / Static Dot */}
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: style.dotColor,
          display: 'inline-block',
          boxShadow:
            state === 'syncing'
              ? `0 0 0 2px ${style.badgeBorder}`
              : undefined,
          animation: state === 'syncing' ? 'pulse 1.2s infinite' : undefined,
        }}
      />

      {/* State Label */}
      <span>{style.label}</span>

      <span style={{ opacity: 0.5 }}>•</span>

      {/* Pending Events Count */}
      <span style={{ fontWeight: pendingCount > 0 ? 700 : 500 }}>
        {pendingCount === 1 ? '1 pending' : `${pendingCount} pending`}
      </span>

      {/* Exception Badge Alert if Any */}
      {exceptionCount > 0 && (
        <span
          style={{
            marginLeft: '4px',
            padding: '1px 6px',
            borderRadius: '9999px',
            backgroundColor: '#fee2e2',
            color: '#991b1b',
            border: '1px solid #fecaca',
            fontSize: '11px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
          }}
          title={`${exceptionCount} sync exception(s) require review`}
        >
          <span>⚠</span>
          <span>{exceptionCount}</span>
        </span>
      )}
    </button>
  );
};
