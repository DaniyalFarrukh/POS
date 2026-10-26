import type { Database as DatabaseInstance } from 'better-sqlite3';
import {
  SyncPushResponseSchema,
  type SyncEventEnvelope,
} from '@pos/shared';
import { createOutboxRepo, type OutboxRepository } from './outboxRepo';
import type { PushSummary } from './types';

export interface PushPendingDependencies {
  db: DatabaseInstance;
  fetch: typeof fetch;
  clock?: { now: () => Date };
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
  outboxRepo?: OutboxRepository;
}

export interface PushPendingParams {
  serverUrl: string;
  token: string;
  limit?: number;
}

/**
 * Pushes pending outbox events to POST /sync/push.
 * Follows docs/SYNC_CLIENT.md specifications:
 * - Reads up to 100 events ordered by device_seq ASC
 * - 15 s timeout via AbortController
 * - Error classification (401/403 -> authError; 400 -> clientBug; 5xx/network -> failedRequest)
 * - Per-event dispatch: accepted/duplicate -> acked; retry_later -> attempts+1; rejected -> exception
 */
export async function pushPending(
  deps: PushPendingDependencies,
  params: PushPendingParams
): Promise<PushSummary> {
  const repo = deps.outboxRepo || createOutboxRepo(deps.db);
  const limit = Math.max(1, Math.min(params.limit ?? 100, 100));

  // 1. Read pending events ordered by device_seq ASC
  const pendingEvents = repo.getPending(limit);
  if (pendingEvents.length === 0) {
    return {
      sent: 0,
      acked: 0,
      retryLater: 0,
      rejected: 0,
      failedRequest: false,
      authError: false,
    };
  }

  // 2. Format envelopes for the shared schema
  const envelopes: SyncEventEnvelope[] = pendingEvents.map((r) => ({
    eventId: r.eventId,
    deviceSeq: r.deviceSeq,
    type: r.type,
    entityId: r.entityId || r.eventId,
    occurredAt: r.occurredAt,
    schemaVersion: 1,
    payload: r.payload,
  }));

  // 3. Configure 15s AbortController timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 15_000);

  const endpointUrl = `${params.serverUrl.replace(/\/+$/, '')}/sync/push`;

  let response: Response;
  try {
    response = await deps.fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.token}`,
      },
      body: JSON.stringify({ events: envelopes }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    deps.logger?.warn(
      `[SyncPush] Network or timeout error during push: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    // Network error / timeout: do not change any event
    return {
      sent: envelopes.length,
      acked: 0,
      retryLater: 0,
      rejected: 0,
      failedRequest: true,
      authError: false,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  // 4. HTTP 401 / 403: authError, events unchanged
  if (response.status === 401 || response.status === 403) {
    deps.logger?.warn(`[SyncPush] Authentication error (HTTP ${response.status}). Events unchanged.`);
    return {
      sent: envelopes.length,
      acked: 0,
      retryLater: 0,
      rejected: 0,
      failedRequest: false,
      authError: true,
    };
  }

  // 5. HTTP 400: clientBug, events unchanged
  if (response.status === 400) {
    deps.logger?.error('[SyncPush] Server returned HTTP 400 Bad Request (client bug). Events unchanged.');
    return {
      sent: envelopes.length,
      acked: 0,
      retryLater: 0,
      rejected: 0,
      failedRequest: true,
      authError: false,
      clientBug: true,
    };
  }

  // 6. HTTP 5xx or other non-success: failedRequest, events unchanged
  if (!response.ok) {
    deps.logger?.warn(`[SyncPush] Push failed with HTTP ${response.status}. Events unchanged.`);
    return {
      sent: envelopes.length,
      acked: 0,
      retryLater: 0,
      rejected: 0,
      failedRequest: true,
      authError: false,
    };
  }

  // 7. Parse and validate response JSON with shared Zod schema
  let responseData: unknown;
  try {
    responseData = await response.json();
  } catch (parseErr) {
    deps.logger?.error('[SyncPush] Failed to parse JSON response', parseErr);
    return {
      sent: envelopes.length,
      acked: 0,
      retryLater: 0,
      rejected: 0,
      failedRequest: true,
      authError: false,
    };
  }

  const parsed = SyncPushResponseSchema.safeParse(responseData);
  if (!parsed.success) {
    deps.logger?.error(
      `[SyncPush] Invalid response shape from server: ${parsed.error.message}`
    );
    return {
      sent: envelopes.length,
      acked: 0,
      retryLater: 0,
      rejected: 0,
      failedRequest: true,
      authError: false,
    };
  }

  // 8. Apply per-event results
  let ackedCount = 0;
  let retryLaterCount = 0;
  let rejectedCount = 0;

  for (const item of parsed.data.results) {
    switch (item.status) {
      case 'accepted':
      case 'duplicate':
        repo.markAcked([item.eventId]);
        ackedCount++;
        break;

      case 'retry_later':
        repo.markRetry([item.eventId], item.message || item.code || 'retry_later');
        retryLaterCount++;
        break;

      case 'rejected':
        repo.moveToException(
          item.eventId,
          item.code || 'REJECTED',
          item.message || 'Permanently rejected event'
        );
        rejectedCount++;
        break;
    }
  }

  return {
    sent: envelopes.length,
    acked: ackedCount,
    retryLater: retryLaterCount,
    rejected: rejectedCount,
    failedRequest: false,
    authError: false,
  };
}
