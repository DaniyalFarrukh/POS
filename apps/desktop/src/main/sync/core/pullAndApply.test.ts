import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { generateUuidV7 } from '@pos/shared';
import { MIGRATIONS } from '../../db';
import { pullAndApply } from './pullAndApply';

describe('pullAndApply (Phase 3.2)', () => {
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

    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at)
      VALUES ('tax-default', 'Standard', 0, 0, ?, ?)
    `).run(now, now);
  });

  it('multi-page pull with correct cursor progression', async () => {
    const prod1Id = generateUuidV7();
    const prod2Id = generateUuidV7();

    const page1 = {
      changes: [
        {
          seq: 1,
          entity: 'product',
          entityId: prod1Id,
          op: 'upsert',
          data: {
            brandName: 'Product Page 1',
            genericName: 'Gen 1',
            mrpPaisa: 500,
          },
        },
      ],
      nextCursor: 1,
      hasMore: true,
    };

    const page2 = {
      changes: [
        {
          seq: 2,
          entity: 'product',
          entityId: prod2Id,
          op: 'upsert',
          data: {
            brandName: 'Product Page 2',
            genericName: 'Gen 2',
            mrpPaisa: 1000,
          },
        },
      ],
      nextCursor: 2,
      hasMore: false,
    };

    const requestedUrls: string[] = [];

    const fakeFetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      requestedUrls.push(urlStr);

      if (urlStr.includes('cursor=0')) {
        return new Response(JSON.stringify(page1), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('cursor=1')) {
        return new Response(JSON.stringify(page2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    const summary = await pullAndApply(
      { db, fetch: fakeFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'jwt_token' }
    );

    expect(summary).toEqual({
      pages: 2,
      changesApplied: 2,
      newCursor: 2,
      failedRequest: false,
      authError: false,
    });

    expect(requestedUrls[0]).toContain('cursor=0');
    expect(requestedUrls[1]).toContain('cursor=1');

    // Verify both products exist locally
    const p1 = db.prepare('SELECT brand_name, mrp_paisa FROM products WHERE id = ?').get(prod1Id) as {
      brand_name: string;
      mrp_paisa: number;
    };
    expect(p1.brand_name).toBe('Product Page 1');

    const p2 = db.prepare('SELECT brand_name, mrp_paisa FROM products WHERE id = ?').get(prod2Id) as {
      brand_name: string;
      mrp_paisa: number;
    };
    expect(p2.brand_name).toBe('Product Page 2');

    // Verify cursor updated in sync_state
    const cursor = db.prepare('SELECT value FROM sync_state WHERE key = ?').get('pull_cursor') as {
      value: string;
    };
    expect(cursor.value).toBe('2');

    // Verify last_pull_ok_at and last_online_at updated
    const lastPull = db.prepare('SELECT value FROM sync_state WHERE key = ?').get('last_pull_ok_at') as {
      value: string;
    };
    expect(lastPull.value).toBeDefined();
  });

  it('page failure mid-way keeps the old cursor and no partial data from the failed page', async () => {
    const prod1Id = generateUuidV7();
    const prod2Id = generateUuidV7();

    const page1 = {
      changes: [
        {
          seq: 10,
          entity: 'product',
          entityId: prod1Id,
          op: 'upsert',
          data: {
            brandName: 'Committed Product',
            mrpPaisa: 500,
          },
        },
      ],
      nextCursor: 10,
      hasMore: true,
    };

    let fetchCallCount = 0;
    const fakeFetch = async (url: string | URL | Request) => {
      fetchCallCount++;
      const urlStr = String(url);

      if (urlStr.includes('cursor=0')) {
        return new Response(JSON.stringify(page1), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Page 2 network failure / timeout
      throw new Error('Connection reset by peer');
    };

    const summary = await pullAndApply(
      { db, fetch: fakeFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'token' }
    );

    expect(fetchCallCount).toBe(2);
    expect(summary.failedRequest).toBe(true);
    expect(summary.pages).toBe(1);
    expect(summary.newCursor).toBe(10); // Page 1 cursor was committed

    // Page 1 is in database
    const p1 = db.prepare('SELECT brand_name FROM products WHERE id = ?').get(prod1Id);
    expect(p1).toBeDefined();

    // Page 2 product was never committed
    const p2 = db.prepare('SELECT brand_name FROM products WHERE id = ?').get(prod2Id);
    expect(p2).toBeUndefined();

    // Cursor in DB remains at 10
    const cursor = db.prepare('SELECT value FROM sync_state WHERE key = ?').get('pull_cursor') as {
      value: string;
    };
    expect(cursor.value).toBe('10');
  });

  it('own stock movement coming back is not duplicated (insert-only-if-missing)', async () => {
    const branchId = generateUuidV7();
    const productId = generateUuidV7();
    const batchId = generateUuidV7();
    const movementId = generateUuidV7();
    const now = new Date().toISOString();

    // Locally insert branch, product, batch, and movement
    db.prepare('INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      branchId,
      'Main Branch',
      now,
      now
    );
    db.prepare(`
      INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer, tax_category_id, mrp_paisa, created_at, updated_at
      ) VALUES (?, 'Panadol', 'PCM', '500mg', 'tab', 'GSK', 'tax-default', 200, ?, ?)
    `).run(productId, now, now);
    db.prepare(`
      INSERT INTO batches (
        id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at
      ) VALUES (?, ?, 'B1', '2028-01-01', 100, 200, ?, ?)
    `).run(batchId, productId, now, now);

    db.prepare(`
      INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type, quantity_signed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'sale', -5, ?, ?)
    `).run(movementId, productId, batchId, branchId, now, now);

    const movementCountBefore = (
      db.prepare('SELECT COUNT(*) as c FROM stock_movements').get() as { c: number }
    ).c;
    expect(movementCountBefore).toBe(1);

    // Server echoes back this exact movement
    const page = {
      changes: [
        {
          seq: 1,
          entity: 'stock_movement',
          entityId: movementId,
          op: 'upsert',
          data: {
            id: movementId,
            productId,
            batchId,
            branchId,
            type: 'sale',
            quantitySigned: -5,
          },
        },
      ],
      nextCursor: 1,
      hasMore: false,
    };

    const fakeFetch = async () =>
      new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const summary = await pullAndApply(
      { db, fetch: fakeFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'token' }
    );

    expect(summary.changesApplied).toBe(1);

    // Count must remain 1: NOT duplicated
    const movementCountAfter = (
      db.prepare('SELECT COUNT(*) as c FROM stock_movements').get() as { c: number }
    ).c;
    expect(movementCountAfter).toBe(1);
  });

  it('price update replaces local price', async () => {
    const productId = generateUuidV7();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer, tax_category_id, mrp_paisa, created_at, updated_at
      ) VALUES (?, 'Calpol', 'PCM', '120mg', 'syrup', 'GSK', 'tax-default', 150, ?, ?)
    `).run(productId, now, now);

    const page = {
      changes: [
        {
          seq: 1,
          entity: 'product',
          entityId: productId,
          op: 'upsert',
          data: {
            id: productId,
            brandName: 'Calpol',
            genericName: 'PCM',
            mrpPaisa: 250, // Price updated to 250
          },
        },
      ],
      nextCursor: 1,
      hasMore: false,
    };

    const fakeFetch = async () =>
      new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await pullAndApply(
      { db, fetch: fakeFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'token' }
    );

    const updated = db
      .prepare('SELECT mrp_paisa FROM products WHERE id = ?')
      .get(productId) as { mrp_paisa: number };
    expect(updated.mrp_paisa).toBe(250);
  });

  it('deleted product becomes inactive (is_active = 0)', async () => {
    const productId = generateUuidV7();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer, tax_category_id, mrp_paisa, is_active, created_at, updated_at
      ) VALUES (?, 'Discontinued Med', 'Disc', '10mg', 'tab', 'Pharma', 'tax-default', 100, 1, ?, ?)
    `).run(productId, now, now);

    const page = {
      changes: [
        {
          seq: 1,
          entity: 'product',
          entityId: productId,
          op: 'delete',
          data: { id: productId },
        },
      ],
      nextCursor: 1,
      hasMore: false,
    };

    const fakeFetch = async () =>
      new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await pullAndApply(
      { db, fetch: fakeFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'token' }
    );

    const product = db
      .prepare('SELECT is_active FROM products WHERE id = ?')
      .get(productId) as { is_active: number };
    expect(product.is_active).toBe(0);
  });

  it('applying pulled data must NOT write any outbox rows (no echo loop)', async () => {
    const outboxCountBefore = (
      db.prepare('SELECT COUNT(*) as c FROM outbox').get() as { c: number }
    ).c;
    expect(outboxCountBefore).toBe(0);

    const page = {
      changes: [
        {
          seq: 1,
          entity: 'product',
          entityId: generateUuidV7(),
          op: 'upsert',
          data: { brandName: 'Echo Test Product', mrpPaisa: 300 },
        },
        {
          seq: 2,
          entity: 'tax_category',
          entityId: generateUuidV7(),
          op: 'upsert',
          data: { name: 'GST 18%', rateBp: 1800 },
        },
      ],
      nextCursor: 2,
      hasMore: false,
    };

    const fakeFetch = async () =>
      new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await pullAndApply(
      { db, fetch: fakeFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'token' }
    );

    const outboxCountAfter = (
      db.prepare('SELECT COUNT(*) as c FROM outbox').get() as { c: number }
    ).c;
    expect(outboxCountAfter).toBe(0); // Zero outbox rows created!
  });

  it('unknown entity type in page is skipped with warning, cursor still advances', async () => {
    const page = {
      changes: [
        {
          seq: 1,
          entity: 'future_unsupported_entity_type',
          entityId: generateUuidV7(),
          op: 'upsert',
          data: { anyField: 'value' },
        },
      ],
      nextCursor: 5,
      hasMore: false,
    };

    const fakeFetch = async () =>
      new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    let warnLogged = false;
    const logger = {
      info: () => { },
      warn: (msg: string) => {
        if (msg.includes('future_unsupported_entity_type')) {
          warnLogged = true;
        }
      },
      error: () => { },
    };

    const summary = await pullAndApply(
      { db, fetch: fakeFetch as typeof fetch, logger },
      { serverUrl: 'http://localhost:3001', token: 'token' }
    );

    expect(summary.newCursor).toBe(5);
    expect(summary.failedRequest).toBe(false);
    expect(warnLogged).toBe(true);
  });

  it('HTTP 401/403 handled with authError: true', async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const summary = await pullAndApply(
      { db, fetch: fakeFetch as typeof fetch },
      { serverUrl: 'http://localhost:3001', token: 'invalid_token' }
    );

    expect(summary.authError).toBe(true);
    expect(summary.failedRequest).toBe(false);
  });
});
