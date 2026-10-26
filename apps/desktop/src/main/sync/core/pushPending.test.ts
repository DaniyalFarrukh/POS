import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { generateUuidV7 } from '@pos/shared';
import { MIGRATIONS } from '../../db';
import { createOutboxRepo } from './outboxRepo';
import { pushPending } from './pushPending';

describe('pushPending (Phase 3.2)', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = memory');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const m of MIGRATIONS) {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString()
      );
    }
  });

  function insertEvent(
    id: string,
    seq: number,
    type: string,
    payload: Record<string, unknown>,
    status = 'pending'
  ) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO outbox (
        id, event_id, device_seq, type, event_type, entity_id, payload, occurred_at, status, attempts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      id,
      id,
      seq,
      type,
      type,
      id,
      JSON.stringify(payload),
      now,
      status,
      now
    );
  }

  it('all accepted: marks all events acked and returns matching summary', async () => {
    const id1 = generateUuidV7();
    const id2 = generateUuidV7();

    insertEvent(id1, 1, 'invoice.created', { inv: 1 });
    insertEvent(id2, 2, 'invoice.created', { inv: 2 });

    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://localhost:3001/sync/push');
      expect(init?.headers).toMatchObject({
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_token_123',
      });

      return new Response(
        JSON.stringify({
          results: [
            { eventId: id1, status: 'accepted' },
            { eventId: id2, status: 'accepted' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const summary = await pushPending(
      { db, fetch: fakeFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'test_token_123' }
    );

    expect(summary).toEqual({
      sent: 2,
      acked: 2,
      retryLater: 0,
      rejected: 0,
      failedRequest: false,
      authError: false,
    });

    const repo = createOutboxRepo(db);
    expect(repo.getPending()).toHaveLength(0);
    const counts = repo.counts();
    expect(counts.acked).toBe(2);
    expect(counts.pending).toBe(0);
  });

  it('mix of accepted, duplicate, retry_later, and rejected applied according to spec', async () => {
    const idAccepted = generateUuidV7();
    const idDuplicate = generateUuidV7();
    const idRetry = generateUuidV7();
    const idRejected = generateUuidV7();

    insertEvent(idAccepted, 1, 'invoice.created', { num: 1 });
    insertEvent(idDuplicate, 2, 'purchase.received', { num: 2 });
    insertEvent(idRetry, 3, 'stock_adjustment.created', { num: 3 });
    insertEvent(idRejected, 4, 'credit_note.created', { num: 4 });

    const fakeFetch = async () => {
      return new Response(
        JSON.stringify({
          results: [
            { eventId: idAccepted, status: 'accepted' },
            { eventId: idDuplicate, status: 'duplicate' },
            {
              eventId: idRetry,
              status: 'retry_later',
              code: 'UNKNOWN_PRODUCT',
              message: 'Product missing on server',
            },
            {
              eventId: idRejected,
              status: 'rejected',
              code: 'TOTALS_MISMATCH',
              message: 'Lines total does not match',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const summary = await pushPending(
      { db, fetch: fakeFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'test_token_xyz' }
    );

    expect(summary).toEqual({
      sent: 4,
      acked: 2,       // accepted + duplicate both become 'acked'
      retryLater: 1,  // stays pending with attempts + 1
      rejected: 1,    // moves to 'exception'
      failedRequest: false,
      authError: false,
    });

    // Check outbox records
    const rowAccepted = db.prepare('SELECT status, attempts FROM outbox WHERE id = ?').get(idAccepted) as { status: string; attempts: number };
    expect(rowAccepted.status).toBe('acked');

    const rowDuplicate = db.prepare('SELECT status, attempts FROM outbox WHERE id = ?').get(idDuplicate) as { status: string; attempts: number };
    expect(rowDuplicate.status).toBe('acked');

    const rowRetry = db.prepare('SELECT status, attempts, last_error FROM outbox WHERE id = ?').get(idRetry) as { status: string; attempts: number; last_error: string };
    expect(rowRetry.status).toBe('pending');
    expect(rowRetry.attempts).toBe(1);
    expect(rowRetry.last_error).toMatch(/Product missing on server/);

    const rowRejected = db.prepare('SELECT status, last_error FROM outbox WHERE id = ?').get(idRejected) as { status: string; last_error: string };
    expect(rowRejected.status).toBe('exception');
    expect(rowRejected.last_error).toMatch(/TOTALS_MISMATCH/);

    // Check sync_exceptions table has the rejected event
    const exceptions = db.prepare('SELECT event_id, code, message, status FROM sync_exceptions WHERE event_id = ?').all(idRejected) as Array<{
      event_id: string;
      code: string;
      message: string;
      status: string;
    }>;
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]?.code).toBe('TOTALS_MISMATCH');
    expect(exceptions[0]?.status).toBe('open');
  });

  it('network error or timeout leaves all events completely unchanged and returns failedRequest: true', async () => {
    const id1 = generateUuidV7();
    const id2 = generateUuidV7();
    insertEvent(id1, 1, 'invoice.created', { test: 1 });
    insertEvent(id2, 2, 'invoice.created', { test: 2 });

    const throwingFetch = async () => {
      throw new Error('Connection refused (ECONNREFUSED)');
    };

    const summary = await pushPending(
      { db, fetch: throwingFetch as typeof fetch },
      { serverUrl: 'http://offline-host:3001', token: 'token' }
    );

    expect(summary).toEqual({
      sent: 2,
      acked: 0,
      retryLater: 0,
      rejected: 0,
      failedRequest: true,
      authError: false,
    });

    // Ensure outbox rows are completely untouched
    const repo = createOutboxRepo(db);
    const pending = repo.getPending();
    expect(pending).toHaveLength(2);
    expect(pending[0]?.attempts).toBe(0);
    expect(pending[1]?.attempts).toBe(0);
  });

  it('HTTP 401/403 returns authError: true and leaves all events completely unchanged', async () => {
    const id1 = generateUuidV7();
    insertEvent(id1, 1, 'invoice.created', { a: 1 });

    const authErrorFetch = async () => {
      return new Response(JSON.stringify({ error: 'Device revoked' }), { status: 403 });
    };

    const summary = await pushPending(
      { db, fetch: authErrorFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'revoked_token' }
    );

    expect(summary).toEqual({
      sent: 1,
      acked: 0,
      retryLater: 0,
      rejected: 0,
      failedRequest: false,
      authError: true,
    });

    const repo = createOutboxRepo(db);
    const pending = repo.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe('pending');
    expect(pending[0]?.attempts).toBe(0);
  });

  it('HTTP 400 sets clientBug: true, failedRequest: true, and leaves all events unchanged', async () => {
    const id1 = generateUuidV7();
    insertEvent(id1, 1, 'invoice.created', { b: 2 });

    const badRequestFetch = async () => {
      return new Response(JSON.stringify({ error: 'Malformed push envelope' }), { status: 400 });
    };

    const summary = await pushPending(
      { db, fetch: badRequestFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'valid_token' }
    );

    expect(summary).toEqual({
      sent: 1,
      acked: 0,
      retryLater: 0,
      rejected: 0,
      failedRequest: true,
      authError: false,
      clientBug: true,
    });

    const repo = createOutboxRepo(db);
    expect(repo.getPending()).toHaveLength(1);
  });

  it('invalid response shape from server is rejected and leaves events unchanged', async () => {
    const id1 = generateUuidV7();
    insertEvent(id1, 1, 'invoice.created', { c: 3 });

    const invalidShapeFetch = async () => {
      // Missing 'results' array or invalid payload structure
      return new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const summary = await pushPending(
      { db, fetch: invalidShapeFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'valid_token' }
    );

    expect(summary.failedRequest).toBe(true);
    expect(summary.acked).toBe(0);

    const repo = createOutboxRepo(db);
    expect(repo.getPending()).toHaveLength(1);
  });

  it('strictly respects ordering by device_seq when dispatching to server', async () => {
    // Insert out of device_seq order
    const id3 = generateUuidV7();
    const id1 = generateUuidV7();
    const id2 = generateUuidV7();

    insertEvent(id3, 30, 'invoice.created', { seq: 30 });
    insertEvent(id1, 10, 'invoice.created', { seq: 10 });
    insertEvent(id2, 20, 'invoice.created', { seq: 20 });

    let sentEventIds: string[] = [];
    let sentSeqs: number[] = [];

    const orderTrackingFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { events: Array<{ eventId: string; deviceSeq: number }> };
      sentEventIds = body.events.map((e) => e.eventId);
      sentSeqs = body.events.map((e) => e.deviceSeq);

      return new Response(
        JSON.stringify({
          results: body.events.map((e) => ({ eventId: e.eventId, status: 'accepted' })),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await pushPending(
      { db, fetch: orderTrackingFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'token' }
    );

    expect(sentSeqs).toEqual([10, 20, 30]);
    expect(sentEventIds).toEqual([id1, id2, id3]);
  });

  it('events are never lost or duplicated in the outbox under any result', async () => {
    const id1 = generateUuidV7();
    const id2 = generateUuidV7();
    const id3 = generateUuidV7();

    insertEvent(id1, 1, 'invoice.created', { item: 1 });
    insertEvent(id2, 2, 'invoice.created', { item: 2 });
    insertEvent(id3, 3, 'invoice.created', { item: 3 });

    const totalBefore = (db.prepare('SELECT COUNT(*) as count FROM outbox').get() as { count: number }).count;
    expect(totalBefore).toBe(3);

    const partialFetch = async () => {
      return new Response(
        JSON.stringify({
          results: [
            { eventId: id1, status: 'accepted' },
            { eventId: id2, status: 'retry_later' },
            { eventId: id3, status: 'rejected', code: 'TEST_REJECT', message: 'Rejected' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await pushPending(
      { db, fetch: partialFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'token' }
    );

    const totalAfter = (db.prepare('SELECT COUNT(*) as count FROM outbox').get() as { count: number }).count;
    // Exactly 3 rows remain in outbox: 1 acked, 1 pending, 1 exception. No rows lost or duplicated!
    expect(totalAfter).toBe(3);

    const repo = createOutboxRepo(db);
    const counts = repo.counts();
    expect(counts.total).toBe(3);
    expect(counts.acked).toBe(1);
    expect(counts.pending).toBe(1);
    expect(counts.exception).toBe(1);
  });
});
