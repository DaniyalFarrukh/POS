import type {
  SyncEventEnvelope,
  SyncResultItem,
  SyncPushResponse,
} from '@pos/shared';

export type SyncConnectionState =
  | 'offline'
  | 'online_idle'
  | 'syncing'
  | 'auth_error'
  | 'error';

export type OfflineWarningLevel =
  | 'ok'
  | 'warning'
  | 'critical'
  | 'exceeded';

export interface OfflineLevelResult {
  level: OfflineWarningLevel;
  hoursOffline: number;
  percentUsed: number;
}

export type OutboxEventStatus = 'pending' | 'acked' | 'exception';

export interface OutboxEventRecord {
  eventId: string;
  deviceSeq: number;
  type: string;
  entityId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  status: OutboxEventStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export type SyncExceptionStatus = 'open' | 'dismissed' | 'retried';

export interface SyncExceptionRecord {
  id: string;
  eventId: string;
  code: string;
  message: string;
  payload: Record<string, unknown>;
  status: SyncExceptionStatus;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SyncState {
  deviceId?: string | null;
  serverUrl?: string | null;
  tokenEncrypted?: string | null;
  pullCursor: number;
  lastPushOkAt?: string | null;
  lastPullOkAt?: string | null;
  lastOnlineAt?: string | null;
}

export interface SyncStatus {
  state: SyncConnectionState;
  offlineLevel: OfflineWarningLevel;
  hoursOffline: number;
  percentUsed: number;
  pendingCount: number;
  exceptionCount: number;
  lastPushOkAt?: string | null;
  lastPullOkAt?: string | null;
  lastOnlineAt?: string | null;
  lastError?: string | null;
}

export interface SyncConfig {
  serverUrl: string;
  maxOfflineHours: number;
  syncIntervalMs: number;
  requestTimeoutMs: number;
}

export interface PushSummary {
  sent: number;
  acked: number;
  retryLater: number;
  rejected: number;
  failedRequest: boolean;
  authError: boolean;
  clientBug?: boolean;
}

export interface PullSummary {
  pages: number;
  changesApplied: number;
  newCursor: number;
  failedRequest: boolean;
  authError: boolean;
}

export interface OutboxCounts {
  pending: number;
  acked: number;
  exception: number;
  total: number;
}

export type {
  SyncEventEnvelope,
  SyncResultItem,
  SyncPushResponse,
};
