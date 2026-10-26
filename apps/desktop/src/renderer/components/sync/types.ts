import type {
  SyncConnectionState,
  OfflineWarningLevel,
  SyncStatus,
  SyncExceptionRecord,
  SyncExceptionStatus,
} from '../../../main/sync/core/types';

export interface SyncStateStyle {
  label: string;
  dotColor: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  icon: string;
}

export function getSyncStateStyle(state: SyncConnectionState): SyncStateStyle {
  switch (state) {
    case 'online_idle':
      return {
        label: 'Online',
        dotColor: '#16a34a',
        badgeBg: '#f0fdf4',
        badgeText: '#15803d',
        badgeBorder: '#bbf7d0',
        icon: '●',
      };
    case 'syncing':
      return {
        label: 'Syncing...',
        dotColor: '#d97706',
        badgeBg: '#fffbeb',
        badgeText: '#b45309',
        badgeBorder: '#fde68a',
        icon: '↻',
      };
    case 'offline':
      return {
        label: 'Offline',
        dotColor: '#64748b',
        badgeBg: '#f8fafc',
        badgeText: '#475569',
        badgeBorder: '#cbd5e1',
        icon: '○',
      };
    case 'auth_error':
      return {
        label: 'Auth Error',
        dotColor: '#dc2626',
        badgeBg: '#fef2f2',
        badgeText: '#b91c1c',
        badgeBorder: '#fecaca',
        icon: '⚠',
      };
    case 'error':
    default:
      return {
        label: 'Sync Error',
        dotColor: '#e11d48',
        badgeBg: '#fff1f2',
        badgeText: '#be123c',
        badgeBorder: '#fecdd3',
        icon: '⚠',
      };
  }
}

/**
 * Format UTC ISO timestamp into Asia/Karachi local time per Rule 8.
 */
export function formatKarachiDateTime(isoString?: string | null): string {
  if (!isoString) return 'Never';
  const dateObj = new Date(isoString);
  if (Number.isNaN(dateObj.getTime())) return 'Invalid Date';

  const datePart = dateObj.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const timePart = dateObj.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  return `${datePart}, ${timePart} PKT`;
}

export interface OfflineBannerInfo {
  showBanner: boolean;
  title: string;
  message: string;
  level: OfflineWarningLevel;
  bgColor: string;
  borderColor: string;
  textColor: string;
  badgeBg: string;
}

export function getOfflineBannerInfo(
  level: OfflineWarningLevel,
  hoursOffline: number,
  percentUsed: number
): OfflineBannerInfo {
  if (level === 'ok') {
    return {
      showBanner: false,
      title: '',
      message: '',
      level,
      bgColor: '#f0fdf4',
      borderColor: '#bbf7d0',
      textColor: '#166534',
      badgeBg: '#dcfce7',
    };
  }

  const hoursStr = `${hoursOffline.toFixed(1)}h`;
  const pctStr = `${Math.min(100, Math.round(percentUsed))}%`;

  if (level === 'warning') {
    return {
      showBanner: true,
      title: 'Approaching Offline Limit',
      message: `Terminal has been offline for ${hoursStr} (${pctStr} of 72h limit). Please connect to the internet to sync pending transactions.`,
      level,
      bgColor: '#fffbeb',
      borderColor: '#fde68a',
      textColor: '#92400e',
      badgeBg: '#fef3c7',
    };
  }

  if (level === 'critical') {
    return {
      showBanner: true,
      title: 'Critical: Offline Limit Near Expiry',
      message: `Terminal has been offline for ${hoursStr} (${pctStr} of limit). Connect to network immediately to prevent stale catalog and inventory drift.`,
      level,
      bgColor: '#fff7ed',
      borderColor: '#fed7aa',
      textColor: '#9a3412',
      badgeBg: '#ffedd5',
    };
  }

  // exceeded
  return {
    showBanner: true,
    title: 'Offline Limit Exceeded',
    message: `Terminal has been offline for ${hoursStr} (over 72h limit). Local sales remain enabled, but central synchronization is overdue.`,
    level,
    bgColor: '#fef2f2',
    borderColor: '#fecaca',
    textColor: '#991b1b',
    badgeBg: '#fee2e2',
  };
}

export interface PayloadSummary {
  type: string;
  summary: string;
  details: { label: string; value: string }[];
}

export function summarizePayload(
  payload: Record<string, unknown> | null | undefined
): PayloadSummary {
  if (!payload || typeof payload !== 'object') {
    return {
      type: 'unknown',
      summary: 'No payload data available',
      details: [],
    };
  }

  const invoiceNumber = payload.invoice_number ?? payload.invoiceNumber;
  const totalPaisa = payload.total_paisa ?? payload.totalPaisa;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const itemCount = items.length || lines.length;

  if (invoiceNumber) {
    const formattedTotal =
      typeof totalPaisa === 'number'
        ? `Rs. ${(totalPaisa / 100).toFixed(2)}`
        : 'Unknown';
    return {
      type: 'Invoice Event',
      summary: `Invoice #${String(invoiceNumber)} (${formattedTotal})`,
      details: [
        { label: 'Invoice No', value: String(invoiceNumber) },
        { label: 'Total', value: formattedTotal },
        { label: 'Items Count', value: String(itemCount) },
      ],
    };
  }

  if (payload.grn_number ?? payload.grnNumber) {
    const grn = String(payload.grn_number ?? payload.grnNumber);
    return {
      type: 'Goods Receiving (GRN)',
      summary: `GRN #${grn}`,
      details: [
        { label: 'GRN No', value: grn },
        { label: 'Lines', value: String(itemCount) },
      ],
    };
  }

  if (payload.credit_note_number ?? payload.creditNoteNumber) {
    const cn = String(payload.credit_note_number ?? payload.creditNoteNumber);
    return {
      type: 'Credit Note / Return',
      summary: `Credit Note #${cn}`,
      details: [
        { label: 'CN No', value: cn },
        { label: 'Lines', value: String(itemCount) },
      ],
    };
  }

  if (payload.reason ?? payload.adjustment_type) {
    const reason = String(payload.reason ?? payload.adjustment_type ?? 'Stock Adjustment');
    return {
      type: 'Stock Adjustment',
      summary: reason,
      details: [
        { label: 'Reason', value: reason },
        { label: 'Batch ID', value: String(payload.batch_id ?? payload.batchId ?? '—') },
        { label: 'Quantity', value: String(payload.quantity ?? '—') },
      ],
    };
  }

  // Fallback to top-level key/value display
  const details = Object.entries(payload)
    .slice(0, 4)
    .map(([k, v]) => ({
      label: k,
      value: typeof v === 'object' ? JSON.stringify(v) : String(v),
    }));

  return {
    type: 'Generic Event',
    summary: Object.keys(payload).length > 0 ? `${Object.keys(payload).length} fields` : 'Empty payload',
    details,
  };
}

export type {
  SyncConnectionState,
  OfflineWarningLevel,
  SyncStatus,
  SyncExceptionRecord,
  SyncExceptionStatus,
};
