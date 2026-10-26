import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { generateUuidV7, type SyncEventEnvelope } from '@pos/shared';
import { MIGRATIONS } from '../../db';
import { SyncWorker } from './syncWorker';
import { createOutboxRepo } from './outboxRepo';
import type { TokenStore } from './registration';

describe('Sync Core Resilience Tests (Phase 3.2)', () => {
  let server: http.Server;
  let serverUrl: string;
  let tokenStore: TokenStore;
  let storedToken: string | null = 'test-bearer-token';
  const openSockets = new Set<import('node:net').Socket>();

  beforeEach(() => {
    storedToken = 'test-bearer-token';
    tokenStore = {
      getToken: vi.fn(async () => storedToken),
      setToken: vi.fn(async (t: string) => {
        storedToken = t;
      }),
      clearToken: vi.fn(async () => {
        storedToken = null;
      }),
    };
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const socket of openSockets) {
      socket.destroy();
    }
    openSockets.clear();
    if (server && server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  function startFakeServer(handlers: {
    onHealth?: (req: http.IncomingMessage, res: http.ServerResponse) => void;
    onPush?: (
      events: SyncEventEnvelope[],
      req: http.IncomingMessage,
      res: http.ServerResponse
    ) => void | Promise<void>;
    onPull?: (
      cursor: number,
      limit: number,
      req: http.IncomingMessage,
      res: http.ServerResponse
    ) => void;
  }): Promise<string> {
    return new Promise((resolve) => {
      server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://127.0.0.1`);

        if (url.pathname === '/health') {
          if (handlers.onHealth) {
            handlers.onHealth(req, res);
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          }
          return;
        }

        if (url.pathname === '/sync/push' && req.method === 'POST') {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          }
          const bodyStr = Buffer.concat(chunks).toString('utf-8');
          let parsed: { events?: SyncEventEnvelope[] } = {};
          try {
            parsed = JSON.parse(bodyStr);
          } catch {
            // keep empty
          }

          if (handlers.onPush) {
            await handlers.onPush(parsed.events || [], req, res);
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                results: (parsed.events || []).map((e) => ({
                  eventId: e.eventId,
                  status: 'accepted',
                })),
              })
            );
          }
          return;
        }

        if (url.pathname === '/sync/pull' && req.method === 'GET') {
          const cursor = parseInt(url.searchParams.get('cursor') || '0', 10);
          const limit = parseInt(url.searchParams.get('limit') || '200', 10);
          if (handlers.onPull) {
            handlers.onPull(cursor, limit, req, res);
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ changes: [], nextCursor: cursor, hasMore: false }));
          }
          return;
        }

        res.writeHead(404);
        res.end();
      });

      server.on('connection', (sock) => {
        openSockets.add(sock);
        sock.on('close', () => openSockets.delete(sock));
      });

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve(serverUrl);
      });
    });
  }

  function setupInMemoryDb(): DatabaseInstance {
    const db = new Database(':memory:');
    db.pragma('journal_mode = memory');

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

    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO branches (id, name, created_at, updated_at)
      VALUES ('branch-1', 'Main Branch', ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT OR IGNORE INTO counters (id, branch_id, name, code, created_at, updated_at)
      VALUES ('counter-1', 'branch-1', 'Counter 1', 'C-1', ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT OR IGNORE INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at)
      VALUES ('tax-1', 'Standard Rate', 1700, 0, ?, ?)
    `).run(now, now);

    return db;
  }

  function insertOutboxEvent(
    db: DatabaseInstance,
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

  // --------------------------------------------------------------------------
  // Scenario 1: Server drops connection after receiving push
  // --------------------------------------------------------------------------
  it('1. Server drops connection after receiving push: events stay pending, are resent, server returns duplicate, and events end up acked exactly once', async () => {
    let pushAttempts = 0;
    const serverProcessedEventIds = new Set<string>();

    await startFakeServer({
      onPush: (events, req, res) => {
        pushAttempts++;
        if (pushAttempts === 1) {
          // Server receives the events, records them as processed, but connection dies before response
          for (const ev of events) {
            serverProcessedEventIds.add(ev.eventId);
          }
          // Forcibly destroy client socket before writing response
          req.socket.destroy();
          return;
        }

        // On resent push: server detects events were already processed -> returns duplicate
        const results = events.map((e) => ({
          eventId: e.eventId,
          status: serverProcessedEventIds.has(e.eventId) ? 'duplicate' : 'accepted',
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      },
    });

    const db = setupInMemoryDb();
    const event1 = generateUuidV7();
    const event2 = generateUuidV7();
    const event3 = generateUuidV7();

    insertOutboxEvent(db, event1, 1, 'invoice.created', { invoiceId: event1 });
    insertOutboxEvent(db, event2, 2, 'invoice.created', { invoiceId: event2 });
    insertOutboxEvent(db, event3, 3, 'invoice.created', { invoiceId: event3 });

    const worker = new SyncWorker({
      db,
      fetch: globalThis.fetch,
      tokenStore,
      config: { serverUrl, syncIntervalMs: 30_000 },
    });

    // Run first sync: server drops socket during push
    const status1 = await worker.syncNow();
    expect(status1.state).toBe('error');

    // Events must NOT be dropped or marked acked: all 3 stay pending
    const repo = createOutboxRepo(db);
    const countsAfterDrop = repo.counts();
    expect(countsAfterDrop.pending).toBe(3);
    expect(countsAfterDrop.acked).toBe(0);
    expect(countsAfterDrop.total).toBe(3);

    // Verify outbox rows are still 'pending'
    const pendingEvents = repo.getPending(10);
    expect(pendingEvents).toHaveLength(3);
    expect(pendingEvents.map((e) => e.eventId)).toEqual([event1, event2, event3]);

    // Run second sync: client resends pending events, server responds duplicate
    const status2 = await worker.syncNow();
    expect(status2.state).toBe('online_idle');

    // All events are acked exactly once; outbox total remains 3
    const finalCounts = repo.counts();
    expect(finalCounts.pending).toBe(0);
    expect(finalCounts.acked).toBe(3);
    expect(finalCounts.total).toBe(3);
    expect(pushAttempts).toBe(2);

    worker.stop();
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Server returns 500 five times then succeeds with backoff schedule
  // --------------------------------------------------------------------------
  it('2. Server returns 500 five times then succeeds: backoff schedule is followed and no events are lost', async () => {
    vi.useFakeTimers();

    let pushCount = 0;
    const inProcessFetch: typeof fetch = async (input, init) => {
      const urlStr = String(input);
      if (urlStr.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.includes('/sync/push')) {
        pushCount++;
        if (pushCount <= 5) {
          return new Response(
            JSON.stringify({ error: 'Internal Server Error', attempt: pushCount }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const body = JSON.parse(String(init?.body || '{}'));
        return new Response(
          JSON.stringify({
            results: (body.events || []).map((e: { eventId: string }) => ({
              eventId: e.eventId,
              status: 'accepted',
            })),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('/sync/pull')) {
        return new Response(
          JSON.stringify({ changes: [], nextCursor: 0, hasMore: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(null, { status: 404 });
    };

    const db = setupInMemoryDb();
    const event1 = generateUuidV7();
    const event2 = generateUuidV7();
    insertOutboxEvent(db, event1, 1, 'invoice.created', { invoiceId: event1 });
    insertOutboxEvent(db, event2, 2, 'invoice.created', { invoiceId: event2 });

    // Inject random = 0.5 for jitter factor = 1.0 (exact delays: 2s, 4s, 8s, 16s, 32s)
    const worker = new SyncWorker({
      db,
      fetch: inProcessFetch,
      tokenStore,
      random: () => 0.5,
      config: { serverUrl: 'http://127.0.0.1:3000', syncIntervalMs: 30_000 },
    });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);

    // Attempt 1 fired and failed (pushCount === 1)
    expect(pushCount).toBe(1);
    expect(worker.getStatus().state).toBe('error');

    // Next delay is 2000ms. At 1999ms, attempt 2 has not fired yet.
    await vi.advanceTimersByTimeAsync(1999);
    expect(pushCount).toBe(1);

    // At 2000ms: attempt 2 fires (fails)
    await vi.advanceTimersByTimeAsync(1);
    expect(pushCount).toBe(2);

    // Next delay is 4000ms: attempt 3 fires
    await vi.advanceTimersByTimeAsync(4000);
    expect(pushCount).toBe(3);

    // Next delay is 8000ms: attempt 4 fires
    await vi.advanceTimersByTimeAsync(8000);
    expect(pushCount).toBe(4);

    // Next delay is 16000ms: attempt 5 fires
    await vi.advanceTimersByTimeAsync(16000);
    expect(pushCount).toBe(5);

    // Next delay is 32000ms: attempt 6 fires (succeeds!)
    await vi.advanceTimersByTimeAsync(32000);
    expect(pushCount).toBe(6);

    // Status transitions to online_idle, backoff reset
    expect(worker.getStatus().state).toBe('online_idle');

    // Verify no events were lost: both are acked
    const repo = createOutboxRepo(db);
    const counts = repo.counts();
    expect(counts.pending).toBe(0);
    expect(counts.acked).toBe(2);
    expect(counts.total).toBe(2);

    worker.stop();
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Process restart in the middle
  // --------------------------------------------------------------------------
  it('3. Process restart in the middle: create a new worker instance on the same SQLite file after a simulated crash: pending events are sent; acked ones are not resent; cursor survives', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-resilience-'));
    const tempDbPath = path.join(tempDir, 'pharmacy.db');

    const receivedEventBatches: string[][] = [];

    await startFakeServer({
      onPush: (events, _req, res) => {
        receivedEventBatches.push(events.map((e) => e.eventId));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            results: events.map((e) => ({ eventId: e.eventId, status: 'accepted' })),
          })
        );
      },
      onPull: (_cursor, _limit, _req, res) => {
        // Advance cursor from 42 to 45
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ changes: [], nextCursor: 45, hasMore: false }));
      },
    });

    try {
      // 1. Initial process: setup SQLite on disk
      const db1 = new Database(tempDbPath);
      db1.pragma('journal_mode = WAL');
      db1.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);
      for (const m of MIGRATIONS) {
        m.up(db1);
        db1.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(
          m.version,
          m.name,
          new Date().toISOString()
        );
      }

      // Pre-seed event 1 as already acked
      const event1 = generateUuidV7();
      const event2 = generateUuidV7();
      const event3 = generateUuidV7();
      insertOutboxEvent(db1, event1, 1, 'invoice.created', { invoiceId: event1 }, 'acked');
      insertOutboxEvent(db1, event2, 2, 'invoice.created', { invoiceId: event2 }, 'pending');
      insertOutboxEvent(db1, event3, 3, 'invoice.created', { invoiceId: event3 }, 'pending');

      // Set initial cursor in sync_state to 42
      db1.prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('pull_cursor', '42')").run();

      // Launch Worker 1
      const worker1 = new SyncWorker({
        db: db1,
        fetch: globalThis.fetch,
        tokenStore,
        config: { serverUrl },
      });

      await worker1.syncNow();

      // Worker 1 pushed events 2 and 3; event 1 was never sent
      expect(receivedEventBatches).toHaveLength(1);
      expect(receivedEventBatches[0]).toEqual([event2, event3]);

      // Verify pull advanced cursor to 45 in db1
      const cursorRow = db1
        .prepare<[string], { value: string }>('SELECT value FROM sync_state WHERE key = ?')
        .get('pull_cursor');
      expect(cursorRow?.value).toBe('45');

      // 2. Simulate crash / sudden restart: stop worker1 and close db1
      worker1.stop();
      db1.close();

      // 3. New process starts: open same SQLite file and instantiate brand new worker2
      const db2 = new Database(tempDbPath);
      db2.pragma('journal_mode = WAL');

      // Offline sale happened: event 4 queued as pending
      const event4 = generateUuidV7();
      insertOutboxEvent(db2, event4, 4, 'invoice.created', { invoiceId: event4 }, 'pending');

      const worker2 = new SyncWorker({
        db: db2,
        fetch: globalThis.fetch,
        tokenStore,
        config: { serverUrl },
      });

      // Verify pull_cursor survived the crash
      const cursorRow2 = db2
        .prepare<[string], { value: string }>('SELECT value FROM sync_state WHERE key = ?')
        .get('pull_cursor');
      expect(cursorRow2?.value).toBe('45');
      expect(worker2.getStatus().pendingCount).toBe(1);

      // Run sync cycle on Worker 2
      await worker2.syncNow();

      // Second push sent ONLY event 4! Events 1, 2, and 3 were NOT resent
      expect(receivedEventBatches).toHaveLength(2);
      expect(receivedEventBatches[1]).toEqual([event4]);

      // All 4 events in the database are now acked
      const repo2 = createOutboxRepo(db2);
      const counts2 = repo2.counts();
      expect(counts2.pending).toBe(0);
      expect(counts2.acked).toBe(4);
      expect(counts2.total).toBe(4);

      worker2.stop();
      db2.close();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Rejected event moves to sync_exceptions and later events sync
  // --------------------------------------------------------------------------
  it('4. Rejected event moves to sync_exceptions and later events in the same batch still sync', async () => {
    const event1 = generateUuidV7();
    const event2 = generateUuidV7();
    const event3 = generateUuidV7();

    await startFakeServer({
      onPush: (_events, _req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            results: [
              { eventId: event1, status: 'accepted' },
              {
                eventId: event2,
                status: 'rejected',
                code: 'TOTALS_MISMATCH',
                message: 'Invoice line sum does not equal total_paisa',
              },
              { eventId: event3, status: 'accepted' },
            ],
          })
        );
      },
    });

    const db = setupInMemoryDb();
    insertOutboxEvent(db, event1, 1, 'invoice.created', { invoiceId: event1, total: 1000 });
    insertOutboxEvent(db, event2, 2, 'invoice.created', { invoiceId: event2, invalid: true });
    insertOutboxEvent(db, event3, 3, 'invoice.created', { invoiceId: event3, total: 3000 });

    const worker = new SyncWorker({
      db,
      fetch: globalThis.fetch,
      tokenStore,
      config: { serverUrl },
    });

    const status = await worker.syncNow();
    expect(status.state).toBe('online_idle');

    const repo = createOutboxRepo(db);

    // Event 1 is acked
    const row1 = db.prepare('SELECT status FROM outbox WHERE id = ?').get(event1) as { status: string };
    expect(row1.status).toBe('acked');

    // Event 2 is exception
    const row2 = db.prepare('SELECT status, last_error FROM outbox WHERE id = ?').get(event2) as {
      status: string;
      last_error: string;
    };
    expect(row2.status).toBe('exception');
    expect(row2.last_error).toContain('[TOTALS_MISMATCH] Invoice line sum does not equal total_paisa');

    // Event 2 captured in sync_exceptions table
    const exceptions = repo.listExceptions();
    expect(exceptions).toHaveLength(1);
    const exc0 = exceptions[0]!;
    expect(exc0.eventId).toBe(event2);
    expect(exc0.code).toBe('TOTALS_MISMATCH');
    expect(exc0.message).toBe('Invoice line sum does not equal total_paisa');
    expect(exc0.status).toBe('open');
    expect(exc0.payload).toEqual({ invoiceId: event2, invalid: true });

    // Event 3 (later event in the same batch) synced successfully!
    const row3 = db.prepare('SELECT status FROM outbox WHERE id = ?').get(event3) as { status: string };
    expect(row3.status).toBe('acked');

    // Status counts: 0 pending, 2 acked, 1 exception
    const counts = repo.counts();
    expect(counts.pending).toBe(0);
    expect(counts.acked).toBe(2);
    expect(counts.exception).toBe(1);

    worker.stop();
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Retry and dismiss of an exception (including the note)
  // --------------------------------------------------------------------------
  it('5. Retry and dismiss of an exception (including the note)', async () => {
    let pushCalls = 0;
    await startFakeServer({
      onPush: (events, _req, res) => {
        pushCalls++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            results: events.map((e) => ({ eventId: e.eventId, status: 'accepted' })),
          })
        );
      },
    });

    const db = setupInMemoryDb();
    const repo = createOutboxRepo(db);

    // 1. Create Event A and move to exception
    const eventA = generateUuidV7();
    insertOutboxEvent(db, eventA, 1, 'invoice.created', { invoiceId: eventA }, 'pending');
    repo.moveToException(eventA, 'INVALID_PAYLOAD', 'Corrupt barcode');

    const exceptions = repo.listExceptions();
    expect(exceptions).toHaveLength(1);
    const exceptionA = exceptions[0]!;
    expect(exceptionA.status).toBe('open');
    expect(exceptionA.note).toBeNull();

    // Dismiss exception with a note
    const dismissNote = 'Manager reviewed: customer walked out, cancelled transaction';
    const dismissSuccess = repo.dismissException(exceptionA.id, dismissNote);
    expect(dismissSuccess).toBe(true);

    const dismissedList = repo.listExceptions('dismissed');
    expect(dismissedList).toHaveLength(1);
    const dismissed0 = dismissedList[0]!;
    expect(dismissed0.id).toBe(exceptionA.id);
    expect(dismissed0.status).toBe('dismissed');
    expect(dismissed0.note).toBe(dismissNote);
    expect(dismissed0.resolvedAt).toBeTruthy();

    // 2. Create Event B and move to exception
    const eventB = generateUuidV7();
    insertOutboxEvent(db, eventB, 2, 'invoice.created', { invoiceId: eventB }, 'pending');
    repo.moveToException(eventB, 'TRANSIENT_ERROR', 'Network glitch');

    const openExceptions = repo.listExceptions('open');
    expect(openExceptions).toHaveLength(1);
    const exceptionB = openExceptions[0]!;
    expect(exceptionB.eventId).toBe(eventB);

    // Retry exception B
    const retrySuccess = repo.retryException(exceptionB.id);
    expect(retrySuccess).toBe(true);

    // Exception record status becomes 'retried'
    const retriedExceptions = repo.listExceptions('retried');
    expect(retriedExceptions).toHaveLength(1);
    const retried0 = retriedExceptions[0]!;
    expect(retried0.id).toBe(exceptionB.id);
    expect(retried0.resolvedAt).toBeTruthy();

    // Outbox event is back to 'pending' with 0 attempts and cleared last_error
    const eventBRow = db.prepare('SELECT status, attempts, last_error FROM outbox WHERE id = ?').get(eventB) as {
      status: string;
      attempts: number;
      last_error: string | null;
    };
    expect(eventBRow.status).toBe('pending');
    expect(eventBRow.attempts).toBe(0);
    expect(eventBRow.last_error).toBeNull();

    // Now run sync cycle: event B is pushed and accepted
    const worker = new SyncWorker({
      db,
      fetch: globalThis.fetch,
      tokenStore,
      config: { serverUrl },
    });

    await worker.syncNow();
    expect(pushCalls).toBe(1);

    const finalBRow = db.prepare('SELECT status FROM outbox WHERE id = ?').get(eventB) as { status: string };
    expect(finalBRow.status).toBe('acked');

    worker.stop();
  });

  // --------------------------------------------------------------------------
  // Scenario 6: 1,000 queued events sync in batches of 100 in the right order
  // --------------------------------------------------------------------------
  it('6. 1,000 queued events sync in batches of 100 in the right order', async () => {
    const receivedBatches: SyncEventEnvelope[][] = [];

    await startFakeServer({
      onPush: (events, _req, res) => {
        // Enforce maximum 100 events per push per docs/SYNC_CLIENT.md
        expect(events.length).toBeLessThanOrEqual(100);
        receivedBatches.push(events);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            results: events.map((e) => ({ eventId: e.eventId, status: 'accepted' })),
          })
        );
      },
    });

    const db = setupInMemoryDb();
    const repo = createOutboxRepo(db);

    // Queue 1,000 events in a fast transaction
    const now = new Date().toISOString();
    const insertStmt = db.prepare(`
      INSERT INTO outbox (
        id, event_id, device_seq, type, event_type, entity_id, payload, occurred_at, status, attempts, created_at
      ) VALUES (?, ?, ?, 'invoice.created', 'invoice.created', ?, ?, ?, 'pending', 0, ?)
    `);

    const insertTx = db.transaction(() => {
      for (let i = 1; i <= 1000; i++) {
        const id = generateUuidV7();
        insertStmt.run(id, id, i, id, JSON.stringify({ index: i }), now, now);
      }
    });
    insertTx();

    expect(repo.counts().pending).toBe(1000);

    const worker = new SyncWorker({
      db,
      fetch: globalThis.fetch,
      tokenStore,
      config: { serverUrl },
    });

    // Run sync cycles until all pending events are pushed
    while (worker.getStatus().pendingCount > 0) {
      await worker.syncNow();
    }

    // Must have synced in exactly 10 batches of 100 events
    expect(receivedBatches).toHaveLength(10);

    for (let batchIdx = 0; batchIdx < 10; batchIdx++) {
      const batch = receivedBatches[batchIdx]!;
      expect(batch).toHaveLength(100);

      const expectedStartSeq = batchIdx * 100 + 1;
      const expectedEndSeq = (batchIdx + 1) * 100;

      expect(batch[0]!.deviceSeq).toBe(expectedStartSeq);
      expect(batch[batch.length - 1]!.deviceSeq).toBe(expectedEndSeq);

      // Verify strictly contiguous ascending order
      for (let j = 0; j < batch.length; j++) {
        expect(batch[j]!.deviceSeq).toBe(expectedStartSeq + j);
      }
    }

    // Outbox: 0 pending, 1,000 acked, 0 exceptions
    const finalCounts = repo.counts();
    expect(finalCounts.pending).toBe(0);
    expect(finalCounts.acked).toBe(1000);
    expect(finalCounts.exception).toBe(0);
    expect(finalCounts.total).toBe(1000);

    worker.stop();
  });
});
