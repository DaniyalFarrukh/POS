import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { generateUuidV7 } from '@pos/shared';
import { MIGRATIONS } from '../../db';
import { SyncWorker } from './syncWorker';
import type { TokenStore } from './registration';

describe('SyncWorker (Phase 3.2)', () => {
  let db: DatabaseInstance;
  let tokenStore: TokenStore;
  let storedToken: string | null = 'mock-valid-token';

  beforeEach(() => {
    storedToken = 'mock-valid-token';
    tokenStore = {
      getToken: vi.fn(async () => storedToken),
      setToken: vi.fn(async (t: string) => {
        storedToken = t;
      }),
      clearToken: vi.fn(async () => {
        storedToken = null;
      }),
    };

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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function insertOutboxEvent(
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

  it('offline -> online transition: recovers from unreachable health check to online_idle', async () => {
    let healthOk = false;

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.endsWith('/health')) {
        if (!healthOk) {
          throw new Error('Network error: connect ECONNREFUSED');
        }
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/sync/pull')) {
        return new Response(
          JSON.stringify({
            changes: [],
            nextCursor: 0,
            hasMore: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ results: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const worker = new SyncWorker({
      db,
      fetch: mockFetch,
      tokenStore,
      config: { serverUrl: 'http://127.0.0.1:3000', syncIntervalMs: 30_000 },
    });

    // 1. Initial attempt fails -> transitions to offline
    const status1 = await worker.syncNow();
    expect(status1.state).toBe('offline');
    expect(status1.lastError).toContain('Central server unreachable');

    // 2. Server recovers -> health check passes
    healthOk = true;
    const status2 = await worker.syncNow();
    expect(status2.state).toBe('online_idle');
    expect(status2.lastError).toBeNull();
    expect(status2.lastOnlineAt).toBeTruthy();
  });

  it('backoff schedule: backs off on consecutive failures and resets on success', async () => {
    vi.useFakeTimers();

    let healthOk = false;
    let healthCalls = 0;

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.endsWith('/health')) {
        healthCalls++;
        if (!healthOk) {
          throw new Error('Connection refused');
        }
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (urlStr.includes('/sync/pull')) {
        return new Response(
          JSON.stringify({ changes: [], nextCursor: 0, hasMore: false }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    // Injected random returning 0.5 means jitter factor is 0.8 + 0.5 * 0.4 = 1.0 (exact base delays: 2s, 4s, 8s)
    const worker = new SyncWorker({
      db,
      fetch: mockFetch,
      tokenStore,
      random: () => 0.5,
      config: { serverUrl: 'http://127.0.0.1:3000', syncIntervalMs: 30_000 },
    });

    // Start worker -> triggers attempt 1 immediately
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(healthCalls).toBe(1);
    expect(worker.getStatus().state).toBe('offline');

    // Attempt 1 failed -> delay = nextDelayMs(0) = 2000ms
    // Advance 1999ms -> health probe should NOT fire yet
    await vi.advanceTimersByTimeAsync(1999);
    expect(healthCalls).toBe(1);

    // Advance 1ms (reaching 2000ms) -> attempt 2 fires
    await vi.advanceTimersByTimeAsync(1);
    expect(healthCalls).toBe(2);

    // Attempt 2 failed -> delay = nextDelayMs(1) = 4000ms
    await vi.advanceTimersByTimeAsync(3999);
    expect(healthCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(healthCalls).toBe(3);

    // Attempt 3 failed -> delay = nextDelayMs(2) = 8000ms
    // Now make server healthy before attempt 4
    healthOk = true;
    await vi.advanceTimersByTimeAsync(8000);
    expect(healthCalls).toBe(4);
    expect(worker.getStatus().state).toBe('online_idle');

    // On success: backoff resets, regular interval is 30,000ms
    await vi.advanceTimersByTimeAsync(29_999);
    expect(healthCalls).toBe(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(healthCalls).toBe(5);

    worker.stop();
  });

  it('single-flight: concurrent syncNow calls share the same execution cycle', async () => {
    let pushCalls = 0;
    let resolvePush: (() => void) | null = null;

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (urlStr.includes('/sync/push')) {
        pushCalls++;
        await new Promise<void>((resolve) => {
          resolvePush = resolve;
        });
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (urlStr.includes('/sync/pull')) {
        return new Response(
          JSON.stringify({ changes: [], nextCursor: 0, hasMore: false }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const eventId = generateUuidV7();
    insertOutboxEvent(eventId, 1, 'invoice.created', { invoiceId: eventId });

    const worker = new SyncWorker({
      db,
      fetch: mockFetch,
      tokenStore,
      config: { serverUrl: 'http://127.0.0.1:3000' },
    });

    // Start 1st syncNow
    const sync1Promise = worker.syncNow();
    expect(worker.getStatus().state).toBe('syncing');

    // Call 2nd syncNow concurrently while 1st is in flight
    const sync2Promise = worker.syncNow();

    // Wait until 1st sync execution reaches the pending push
    while (!resolvePush) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // Verify only 1 push call is running
    expect(pushCalls).toBe(1);

    // Release the push
    const doResolve = resolvePush as unknown as (() => void);
    doResolve();

    const [res1, res2] = await Promise.all([sync1Promise, sync2Promise]);
    expect(res1.state).toBe('online_idle');
    expect(res2.state).toBe('online_idle');
    expect(pushCalls).toBe(1);

    worker.stop();
  });

  it('auth_error stops sync: HTTP 401 transitions to auth_error and halts timer', async () => {
    vi.useFakeTimers();

    let fetchCount = 0;
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      fetchCount++;
      const urlStr = url.toString();
      if (urlStr.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (urlStr.includes('/sync/push')) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized', message: 'Token revoked' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const eventId = generateUuidV7();
    insertOutboxEvent(eventId, 1, 'invoice.created', { invoiceId: eventId });

    const worker = new SyncWorker({
      db,
      fetch: mockFetch,
      tokenStore,
      config: { serverUrl: 'http://127.0.0.1:3000' },
    });

    const status = await worker.syncNow();
    expect(status.state).toBe('auth_error');
    expect(status.lastError).toContain('Authentication failed');

    // Outbox event must NOT be deleted
    const outboxRow = db.prepare('SELECT status FROM outbox WHERE id = ?').get(eventId) as { status: string };
    expect(outboxRow.status).toBe('pending');

    // Advance fake timers by 5 minutes: no further fetch calls should happen
    const countBefore = fetchCount;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchCount).toBe(countBefore);

    worker.stop();
  });

  it('retry_later triggers pull then second push in the same run', async () => {
    const eventId = generateUuidV7();
    const pulledProductId = generateUuidV7();
    insertOutboxEvent(eventId, 1, 'invoice.created', {
      invoiceId: eventId,
      productId: pulledProductId,
    });

    const callOrder: string[] = [];

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.endsWith('/health')) {
        callOrder.push('health');
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (urlStr.includes('/sync/push')) {
        callOrder.push('push');
        // First push returns retry_later
        if (callOrder.filter((c) => c === 'push').length === 1) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  eventId,
                  status: 'retry_later',
                  error: 'Referenced product does not exist yet',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        // Second push returns accepted
        return new Response(
          JSON.stringify({
            results: [{ eventId, status: 'accepted' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('/sync/pull')) {
        callOrder.push('pull');
        return new Response(
          JSON.stringify({
            changes: [
              {
                seq: 1,
                entity: 'products',
                op: 'upsert',
                entityId: pulledProductId,
                data: {
                  brandName: 'Panadol 500mg',
                  genericName: 'Paracetamol',
                  taxCategoryId: 'tax-1',
                  mrpPaisa: 5000,
                  isActive: true,
                },
              },
            ],
            nextCursor: 1,
            hasMore: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const worker = new SyncWorker({
      db,
      fetch: mockFetch,
      tokenStore,
      config: { serverUrl: 'http://127.0.0.1:3000' },
    });

    const status = await worker.syncNow();
    expect(status.state).toBe('online_idle');

    // Verify exact sequence: health -> push 1 -> pull -> push 2
    expect(callOrder).toEqual(['health', 'push', 'pull', 'push']);

    // Event should be acknowledged
    const outboxRow = db.prepare('SELECT status FROM outbox WHERE id = ?').get(eventId) as { status: string };
    expect(outboxRow.status).toBe('acked');

    worker.stop();
  });

  it('stop() cancels timers and prevents further sync cycles', async () => {
    vi.useFakeTimers();

    let healthCalls = 0;
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.endsWith('/health')) {
        healthCalls++;
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      if (urlStr.includes('/sync/pull')) {
        return new Response(
          JSON.stringify({ changes: [], nextCursor: 0, hasMore: false }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const worker = new SyncWorker({
      db,
      fetch: mockFetch,
      tokenStore,
      config: { serverUrl: 'http://127.0.0.1:3000', syncIntervalMs: 30_000 },
    });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(healthCalls).toBe(1);

    // Call stop()
    worker.stop();

    // Advance 60 seconds
    await vi.advanceTimersByTimeAsync(60_000);
    expect(healthCalls).toBe(1); // No new calls
  });

  it('offlineLevel reporting: accurately computes offline duration, level and outbox counts', async () => {
    const fixedNow = new Date('2026-10-26T12:00:00.000Z');

    // 1. last_online_at 80 hours ago (> 72 hours maxOfflineHours -> exceeded)
    const eightyHoursAgo = new Date(fixedNow.getTime() - 80 * 3600 * 1000).toISOString();
    db.prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_online_at', ?)").run(
      eightyHoursAgo
    );

    // Insert 2 pending events and 1 exception event
    insertOutboxEvent('evt-1', 1, 'invoice.created', {}, 'pending');
    insertOutboxEvent('evt-2', 2, 'invoice.created', {}, 'pending');
    insertOutboxEvent('evt-3', 3, 'invoice.created', {}, 'exception');

    // Insert 1 open sync_exception record
    db.prepare(`
      INSERT INTO sync_exceptions (id, event_id, code, message, payload, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?)
    `).run('exc-1', 'evt-3', 'TEST_ERR', 'Error msg', '{}', eightyHoursAgo);

    const mockFetch = vi.fn() as unknown as typeof fetch;

    const worker = new SyncWorker({
      db,
      fetch: mockFetch,
      tokenStore,
      clock: { now: () => fixedNow },
      config: { maxOfflineHours: 72 },
    });

    const status = worker.getStatus();
    expect(status.offlineLevel).toBe('exceeded');
    expect(status.hoursOffline).toBeCloseTo(80, 1);
    expect(status.percentUsed).toBeGreaterThan(100);
    expect(status.pendingCount).toBe(2);
    expect(status.exceptionCount).toBe(1);

    // 2. Set last_online_at to 40 hours ago (40/72 = ~55% -> warning)
    const fortyHoursAgo = new Date(fixedNow.getTime() - 40 * 3600 * 1000).toISOString();
    db.prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_online_at', ?)").run(
      fortyHoursAgo
    );

    const status2 = worker.getStatus();
    expect(status2.offlineLevel).toBe('warning');
    expect(status2.hoursOffline).toBeCloseTo(40, 1);

    // 3. Set last_online_at to 10 hours ago (10/72 = ~13% -> ok)
    const tenHoursAgo = new Date(fixedNow.getTime() - 10 * 3600 * 1000).toISOString();
    db.prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_online_at', ?)").run(
      tenHoursAgo
    );

    const status3 = worker.getStatus();
    expect(status3.offlineLevel).toBe('ok');
    expect(status3.hoursOffline).toBeCloseTo(10, 1);
  });
});
