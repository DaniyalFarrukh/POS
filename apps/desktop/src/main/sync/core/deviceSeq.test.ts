import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { generateUuidV7 } from '@pos/shared';
import { finalizeSale } from '../../finalizeSale';
import { MIGRATIONS } from '../../db';

describe('device_seq & Outbox Migration (Phase 3.2)', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = memory');
    db.pragma('foreign_keys = ON');

    // Run all migrations
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

  it('device_seq assigned contiguously and uniquely across 100 sales', () => {
    const now = new Date().toISOString();
    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const userId = generateUuidV7();
    const taxCategoryId = generateUuidV7();
    const productId = generateUuidV7();
    const batchId = generateUuidV7();

    // Setup master data
    db.prepare('INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      branchId,
      'Main Branch',
      now,
      now
    );
    db.prepare(
      'INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, last_credit_note_seq, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)'
    ).run(counterId, branchId, 'Counter 1', 'C1', now, now);
    db.prepare(
      'INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    ).run(userId, 'Test Cashier', 'cashier', 'pin_hash', now, now);
    db.prepare(
      'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?)'
    ).run(taxCategoryId, 'Zero Tax', now, now);
    db.prepare(`
      INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer, barcode, tax_category_id, mrp_paisa, is_controlled, is_active, created_at, updated_at
      ) VALUES (?, 'Panadol', 'Paracetamol', '500mg', 'tablet', 'GSK', '123456', ?, 500, 0, 1, ?, ?)
    `).run(productId, taxCategoryId, now, now);

    db.prepare(`
      INSERT INTO batches (
        id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at
      ) VALUES (?, ?, 'B-100', '2028-12-31', 300, 500, ?, ?)
    `).run(batchId, productId, now, now);

    // Initial stock movement (+10,000 units to support 100 sales)
    db.prepare(`
      INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type, quantity_signed, reference_type, reference_id, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'purchase', 10000, 'manual', ?, 'Initial stock', ?, ?)
    `).run(generateUuidV7(), productId, batchId, branchId, generateUuidV7(), now, now);

    // Run 100 sales in a loop
    for (let i = 1; i <= 100; i++) {
      const saleResult = finalizeSale(
        {
          counterId,
          cashierUserId: userId,
          clientRequestId: `sale-seq-req-${i}-${generateUuidV7()}`,
          lines: [{ productId, quantity: 1 }],
          payments: [{ method: 'cash', amountPaisa: 500 }],
        },
        { db }
      );

      expect(saleResult.status).toBe('finalized');
    }

    // Verify outbox rows
    const outboxRows = db
      .prepare('SELECT device_seq, event_id, type, status FROM outbox ORDER BY device_seq ASC')
      .all() as Array<{
      device_seq: number;
      event_id: string;
      type: string;
      status: string;
    }>;

    expect(outboxRows).toHaveLength(100);

    // Contiguous sequence: 1, 2, 3, ..., 100
    for (let i = 0; i < 100; i++) {
      const expectedSeq = i + 1;
      const row = outboxRows[i]!;
      expect(row.device_seq).toBe(expectedSeq);
      expect(row.type).toBe('invoice.created');
      expect(row.status).toBe('pending');
      expect(row.event_id).toBeDefined();
    }

    // Verify UNIQUE constraint rejects duplicate device_seq
    expect(() => {
      db.prepare(`
        INSERT INTO outbox (
          id, event_id, device_seq, type, event_type, payload, occurred_at, status, attempts, created_at
        ) VALUES (?, ?, 50, 'duplicate.test', 'duplicate.test', '{}', ?, 'pending', 0, ?)
      `).run(generateUuidV7(), generateUuidV7(), now, now);
    }).toThrow(/UNIQUE constraint failed/i);
  });

  it('backfill orders old rows correctly by created_at and assigns contiguous device_seq', () => {
    // Create database with migrations 1 through 6 ONLY
    const legacyDb = new Database(':memory:');
    legacyDb.pragma('journal_mode = memory');
    legacyDb.pragma('foreign_keys = ON');

    legacyDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const m of MIGRATIONS.filter((m) => m.version <= 6)) {
      m.up(legacyDb);
      legacyDb.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString()
      );
    }

    // Insert 3 pre-migration outbox rows in arbitrary physical order with distinct created_at timestamps
    const idEarly = generateUuidV7();
    const idMid = generateUuidV7();
    const idLate = generateUuidV7();

    const insertLegacy = legacyDb.prepare(`
      INSERT INTO outbox (id, event_type, payload, created_at, synced_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    // Physical insertion: Late, Early, Mid
    insertLegacy.run(idLate, 'invoice.created', '{"val":"late"}', '2026-10-26T14:00:00.000Z', null);
    insertLegacy.run(idEarly, 'invoice.created', '{"val":"early"}', '2026-10-26T10:00:00.000Z', '2026-10-26T10:05:00.000Z');
    insertLegacy.run(idMid, 'stock.adjusted', '{"val":"mid"}', '2026-10-26T12:00:00.000Z', null);

    // Apply migration 7
    const migration7 = MIGRATIONS.find((m) => m.version === 7)!;
    expect(migration7).toBeDefined();
    migration7.up(legacyDb);

    // Verify backfilled device_seq orders rows strictly by created_at:
    // 1: idEarly (10:00 UTC)
    // 2: idMid   (12:00 UTC)
    // 3: idLate  (14:00 UTC)
    const backfilledRows = legacyDb
      .prepare('SELECT id, event_id, device_seq, type, status, occurred_at FROM outbox ORDER BY device_seq ASC')
      .all() as Array<{
      id: string;
      event_id: string;
      device_seq: number;
      type: string;
      status: string;
      occurred_at: string;
    }>;

    expect(backfilledRows).toHaveLength(3);

    expect(backfilledRows[0]?.id).toBe(idEarly);
    expect(backfilledRows[0]?.device_seq).toBe(1);
    expect(backfilledRows[0]?.event_id).toBe(idEarly);
    expect(backfilledRows[0]?.type).toBe('invoice.created');
    expect(backfilledRows[0]?.status).toBe('acked'); // Was synced_at non-null

    expect(backfilledRows[1]?.id).toBe(idMid);
    expect(backfilledRows[1]?.device_seq).toBe(2);
    expect(backfilledRows[1]?.type).toBe('stock.adjusted');
    expect(backfilledRows[1]?.status).toBe('pending');

    expect(backfilledRows[2]?.id).toBe(idLate);
    expect(backfilledRows[2]?.device_seq).toBe(3);
    expect(backfilledRows[2]?.type).toBe('invoice.created');
    expect(backfilledRows[2]?.status).toBe('pending');
  });
});
