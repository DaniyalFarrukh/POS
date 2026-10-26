import React, { useState } from 'react';
import type { SyncStatus } from './types';
import { getOfflineBannerInfo } from './types';

interface SyncOfflineBannerProps {
  status: SyncStatus | null;
  onSyncNow?: () => Promise<void>;
  onOpenSyncStatus?: () => void;
}

export const SyncOfflineBanner: React.FC<SyncOfflineBannerProps> = ({
  status,
  onSyncNow,
  onOpenSyncStatus,
}) => {
  const [syncing, setSyncing] = useState(false);

  if (!status) return null;

  const bannerInfo = getOfflineBannerInfo(
    status.offlineLevel,
    status.hoursOffline,
    status.percentUsed
  );

  if (!bannerInfo.showBanner) {
    return null;
  }

  const handleSyncClick = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      if (onSyncNow) {
        await onSyncNow();
      } else if (window.api?.sync?.syncNow) {
        await window.api.sync.syncNow();
      }
    } catch (err) {
      console.error('[SyncOfflineBanner] SyncNow failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      role="alert"
      style={{
        backgroundColor: bannerInfo.bgColor,
        borderBottom: `1px solid ${bannerInfo.borderColor}`,
        color: bannerInfo.textColor,
        padding: '10px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        fontSize: '13px',
        flexShrink: 0,
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
        <span
          style={{
            fontSize: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            backgroundColor: bannerInfo.badgeBg,
            flexShrink: 0,
          }}
        >
          {bannerInfo.level === 'warning' ? '⚠️' : '🚨'}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{bannerInfo.title}</span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: '4px',
                backgroundColor: bannerInfo.badgeBg,
                border: `1px solid ${bannerInfo.borderColor}`,
                textTransform: 'uppercase',
              }}
            >
              {bannerInfo.level}
            </span>
          </div>
          <span style={{ fontSize: '12px', opacity: 0.9 }}>{bannerInfo.message}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        {onOpenSyncStatus && (
          <button
            type="button"
            onClick={onOpenSyncStatus}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: `1px solid ${bannerInfo.borderColor}`,
              backgroundColor: '#ffffff',
              color: bannerInfo.textColor,
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.1s',
            }}
          >
            View Details
          </button>
        )}

        <button
          type="button"
          disabled={syncing || status.state === 'syncing'}
          onClick={handleSyncClick}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: bannerInfo.textColor,
            color: '#ffffff',
            fontSize: '12px',
            fontWeight: 700,
            cursor: syncing ? 'not-allowed' : 'pointer',
            opacity: syncing ? 0.7 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.1s',
          }}
        >
          {syncing || status.state === 'syncing' ? (
            <>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>↻</span>
              <span>Syncing...</span>
            </>
          ) : (
            <>
              <span>↻</span>
              <span>Sync Now</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
