import type { Database as DatabaseInstance } from 'better-sqlite3';
import { generateUuidV7 } from '@pos/shared';
import type {
  OutboxEventRecord,
  OutboxCounts,
  OutboxEventStatus,
  SyncExceptionRecord,
  SyncExceptionStatus,
} from './types';

export interface OutboxRepository {
  getPending(limit?: number): OutboxEventRecord[];
  markAcked(eventIds: string[]): void;
  markRetry(eventIds: string[], error?: string): void;
  moveToException(eventId: string, code: string, message: string): void;
  listExceptions(status?: SyncExceptionStatus): SyncExceptionRecord[];
  retryException(id: string): boolean;
  dismissException(id: string, note?: string): boolean;
  counts(): OutboxCounts;
}

interface RawOutboxDbRow {
  id: string;
  event_id: string | null;
  device_seq: number;
  type: string | null;
  event_type: string | null;
  entity_id: string | null;
  payload: string;
  occurred_at: string | null;
  status: string | null;
  attempts: number | null;
  last_error: string | null;
  created_at: string;
}

export function createOutboxRepo(db: DatabaseInstance): OutboxRepository {
  const getPendingStmt = db.prepare<[number], RawOutboxDbRow>(`
    SELECT
      id,
      event_id,
      device_seq,
      type,
      event_type,
      entity_id,
      payload,
      occurred_at,
      status,
      attempts,
      last_error,
      created_at
    FROM outbox
    WHERE status = 'pending'
    ORDER BY device_seq ASC
    LIMIT ?
  `);

  const markAckedSingleStmt = db.prepare<[string, string, string]>(`
    UPDATE outbox
    SET status = 'acked', synced_at = ?
    WHERE id = ? OR event_id = ?
  `);

  const markRetrySingleStmt = db.prepare<[string | null, string, string]>(`
    UPDATE outbox
    SET attempts = attempts + 1, last_error = ?, status = 'pending'
    WHERE id = ? OR event_id = ?
  `);

  const selectForExceptionStmt = db.prepare<[string, string], { payload: string }>(`
    SELECT payload FROM outbox WHERE id = ? OR event_id = ? LIMIT 1
  `);

  const updateExceptionStmt = db.prepare<[string, string, string]>(`
    UPDATE outbox
    SET status = 'exception', last_error = ?
    WHERE id = ? OR event_id = ?
  `);

  const insertExceptionStmt = db.prepare<[string, string, string, string, string, string]>(`
    INSERT INTO sync_exceptions (
      id, event_id, code, message, payload, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'open', ?)
  `);

  const countStmt = db.prepare<[], { total: number; pending: number; acked: number; exception: number }>(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status = 'acked' THEN 1 ELSE 0 END), 0) AS acked,
      COALESCE(SUM(CASE WHEN status = 'exception' THEN 1 ELSE 0 END), 0) AS exception
    FROM outbox
  `);

  interface RawSyncExceptionDbRow {
    id: string;
    event_id: string;
    code: string;
    message: string;
    payload: string;
    status: string;
    note: string | null;
    created_at: string;
    resolved_at: string | null;
  }

  const listExceptionsAllStmt = db.prepare<[], RawSyncExceptionDbRow>(`
    SELECT id, event_id, code, message, payload, status, note, created_at, resolved_at
    FROM sync_exceptions
    ORDER BY created_at DESC
  `);

  const listExceptionsByStatusStmt = db.prepare<[string], RawSyncExceptionDbRow>(`
    SELECT id, event_id, code, message, payload, status, note, created_at, resolved_at
    FROM sync_exceptions
    WHERE status = ?
    ORDER BY created_at DESC
  `);

  const selectExceptionByIdStmt = db.prepare<[string], RawSyncExceptionDbRow>(`
    SELECT id, event_id, code, message, payload, status, note, created_at, resolved_at
    FROM sync_exceptions
    WHERE id = ?
    LIMIT 1
  `);

  const retryExceptionStmt = db.prepare<[string, string]>(`
    UPDATE sync_exceptions
    SET status = 'retried', resolved_at = ?
    WHERE id = ?
  `);

  const retryOutboxStmt = db.prepare<[string, string]>(`
    UPDATE outbox
    SET status = 'pending', attempts = 0, last_error = NULL
    WHERE id = ? OR event_id = ?
  `);

  const dismissExceptionStmt = db.prepare<[string | null, string, string]>(`
    UPDATE sync_exceptions
    SET status = 'dismissed', note = ?, resolved_at = ?
    WHERE id = ?
  `);

  return {
    getPending(limit = 100): OutboxEventRecord[] {
      const safeLimit = Math.max(1, Math.min(limit, 500));
      const rows = getPendingStmt.all(safeLimit);

      return rows.map((r) => {
        let parsedPayload: Record<string, unknown> = {};
        try {
          parsedPayload = JSON.parse(r.payload);
        } catch {
          parsedPayload = { raw: r.payload };
        }

        return {
          eventId: r.event_id || r.id,
          deviceSeq: r.device_seq,
          type: r.type || r.event_type || 'unknown',
          entityId: r.entity_id,
          payload: parsedPayload,
          occurredAt: r.occurred_at || r.created_at,
          status: (r.status as OutboxEventStatus) || 'pending',
          attempts: r.attempts ?? 0,
          lastError: r.last_error,
          createdAt: r.created_at,
        };
      });
    },

    markAcked(eventIds: string[]): void {
      if (eventIds.length === 0) return;
      const now = new Date().toISOString();

      const markTx = db.transaction(() => {
        for (const id of eventIds) {
          markAckedSingleStmt.run(now, id, id);
        }
      });
      markTx();
    },

    markRetry(eventIds: string[], error?: string): void {
      if (eventIds.length === 0) return;
      const errVal = error ?? null;

      const retryTx = db.transaction(() => {
        for (const id of eventIds) {
          markRetrySingleStmt.run(errVal, id, id);
        }
      });
      retryTx();
    },

    moveToException(eventId: string, code: string, message: string): void {
      const now = new Date().toISOString();
      const exceptionId = generateUuidV7();

      const exceptionTx = db.transaction(() => {
        const outboxRow = selectForExceptionStmt.get(eventId, eventId);
        const payloadStr = outboxRow ? outboxRow.payload : '{}';

        // 1. Mark outbox row as exception
        updateExceptionStmt.run(`[${code}] ${message}`, eventId, eventId);

        // 2. Insert record into sync_exceptions table
        insertExceptionStmt.run(
          exceptionId,
          eventId,
          code,
          message,
          payloadStr,
          now
        );
      });

      exceptionTx();
    },

    counts(): OutboxCounts {
      const row = countStmt.get();
      if (!row) {
        return { pending: 0, acked: 0, exception: 0, total: 0 };
      }
      return {
        pending: Number(row.pending),
        acked: Number(row.acked),
        exception: Number(row.exception),
        total: Number(row.total),
      };
    },

    listExceptions(status?: SyncExceptionStatus): SyncExceptionRecord[] {
      const rows = status
        ? listExceptionsByStatusStmt.all(status)
        : listExceptionsAllStmt.all();

      return rows.map((r) => {
        let parsedPayload: Record<string, unknown> = {};
        try {
          parsedPayload = JSON.parse(r.payload);
        } catch {
          parsedPayload = { raw: r.payload };
        }
        return {
          id: r.id,
          eventId: r.event_id,
          code: r.code,
          message: r.message,
          payload: parsedPayload,
          status: (r.status as SyncExceptionStatus) || 'open',
          note: r.note,
          createdAt: r.created_at,
          resolvedAt: r.resolved_at,
        };
      });
    },

    retryException(id: string): boolean {
      const row = selectExceptionByIdStmt.get(id);
      if (!row) return false;

      const now = new Date().toISOString();
      const retryTx = db.transaction(() => {
        retryExceptionStmt.run(now, id);
        retryOutboxStmt.run(row.event_id, row.event_id);
      });
      retryTx();
      return true;
    },

    dismissException(id: string, note?: string): boolean {
      const row = selectExceptionByIdStmt.get(id);
      if (!row) return false;

      const now = new Date().toISOString();
      dismissExceptionStmt.run(note ?? null, now, id);
      return true;
    },
  };
}
