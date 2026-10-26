import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateUuidV7 } from '@pos/shared';
import {
  startTestServer,
  createTestCounter,
  serverStockForBatch,
  localStockForBatch,
  countServerInvoices,
  countOutbox,
  type TestServer,
  type TestCounter,
} from './harness';

describe('Multi-Counter Sync & Resilience Integration Tests (Phase 3.4b)', () => {
  let server: TestServer;
  let counterA: TestCounter;
  let counterB: TestCounter;

  beforeEach(async () => {
    server = await startTestServer();
    counterA = await createTestCounter('Counter A', server, server.counterAId);
    counterB = await createTestCounter('Counter B', server, server.counterBId);
  });

  afterEach(async () => {
    if (counterA) await counterA.cleanup();
    if (counterB) await counterB.cleanup();
    if (server) await server.stop();
  });

  /**
   * Test 1:
   * Counter A receives a purchase of one batch with quantity 100 and both counters sync.
   * Both go offline. A sells 30 units and B sells 40 units of that batch.
   * Both go online and sync until idle.
   * Assert: the server has both invoices, the server stock for the batch equals 30,
   * local stock on both counters equals 30 after pull, invoice numbers do not collide,
   * outboxes are fully acked.
   */
  it('1. Concurrent offline sales on two counters sync cleanly and inventory balances match (100 - 30 - 40 = 30)', async () => {
    // 1. Counter A receives a purchase of 100 units
    const { batchIds } = counterA.receivePurchase({
      supplierInvoiceNo: 'SUP-CONC-100',
      lines: [
        {
          productId: server.productId,
          batchNo: 'BATCH-CONC-100',
          expiryDate: '2028-12-31',
          quantity: 100,
          costPaisa: 3000,
          mrpPaisa: 5000,
        },
      ],
    });
    const batchId = batchIds[0]!;

    // 2. Both counters sync so batch and initial stock propagate to server and Counter B
    await counterA.syncUntilIdle();
    await counterB.syncUntilIdle();

    expect(localStockForBatch(counterA, batchId)).toBe(100);
    expect(localStockForBatch(counterB, batchId)).toBe(100);
    expect(await serverStockForBatch(server, batchId)).toBe(100);

    // 3. Both counters go offline
    counterA.goOffline();
    counterB.goOffline();
    expect(counterA.isOnline()).toBe(false);
    expect(counterB.isOnline()).toBe(false);

    // 4. Counter A sells 30 units; Counter B sells 40 units (Unit MRP 5000 + 18% GST = 5900 paisa)
    const invA = counterA.finalizeSale({
      clientRequestId: generateUuidV7(),
      lines: [{ productId: server.productId, quantity: 30 }],
      payments: [{ method: 'cash', amountPaisa: 30 * 5900 }],
    });

    const invB = counterB.finalizeSale({
      clientRequestId: generateUuidV7(),
      lines: [{ productId: server.productId, quantity: 40 }],
      payments: [{ method: 'cash', amountPaisa: 40 * 5900 }],
    });

    expect(invA.lines[0]?.quantity).toBe(30);
    expect(invB.lines[0]?.quantity).toBe(40);

    // Local stocks immediately reflect local sales while offline
    expect(localStockForBatch(counterA, batchId)).toBe(70);
    expect(localStockForBatch(counterB, batchId)).toBe(60);

    // 5. Both go online and sync until idle
    counterA.goOnline();
    counterB.goOnline();

    await counterA.syncUntilIdle();
    await counterB.syncUntilIdle();

    // Pull propagation round so each counter receives the other's stock movement
    await counterA.syncUntilIdle();
    await counterB.syncUntilIdle();

    // 6. Assertions
    // Server has both invoices
    const serverInvoices = await countServerInvoices(server);
    expect(serverInvoices).toBe(2);

    // Server stock for the batch equals 30 (100 - 30 - 40)
    const sStock = await serverStockForBatch(server, batchId);
    expect(sStock).toBe(30);

    // Local stock on both counters equals 30 after pull
    expect(localStockForBatch(counterA, batchId)).toBe(30);
    expect(localStockForBatch(counterB, batchId)).toBe(30);

    // Invoice numbers do not collide
    expect(invA.invoiceNumber).not.toBe(invB.invoiceNumber);
    expect(invA.invoiceNumber).toMatch(/^CA-\d+/);
    expect(invB.invoiceNumber).toMatch(/^CB-\d+/);

    // Outboxes are fully acked
    expect(countOutbox(counterA, 'pending')).toBe(0);
    expect(countOutbox(counterB, 'pending')).toBe(0);
    expect(countOutbox(counterA, 'acked')).toBe(2); // 1 purchase + 1 sale
    expect(countOutbox(counterB, 'acked')).toBe(1); // 1 sale
  });

  /**
   * Test 2:
   * Total sold (A sells 70, B sells 50) exceeds stock (100 units):
   * the server accepts both, balance is negative -20, and a stock_alerts row exists.
   * Neither sale is rejected.
   */
  it('2. Concurrent offline overselling (70 + 50 = 120 vs 100 stock): server accepts both, balance = -20, and stock_alert logged', async () => {
    // 1. Counter A receives 100 units of a new batch
    const { batchIds } = counterA.receivePurchase({
      supplierInvoiceNo: 'SUP-NEG-100',
      lines: [
        {
          productId: server.productId,
          batchNo: 'BATCH-NEG-100',
          expiryDate: '2028-12-31',
          quantity: 100,
          costPaisa: 3000,
          mrpPaisa: 5000,
        },
      ],
    });
    const batchId = batchIds[0]!;

    // 2. Both counters sync to discover the batch
    await counterA.syncUntilIdle();
    await counterB.syncUntilIdle();

    expect(localStockForBatch(counterA, batchId)).toBe(100);
    expect(localStockForBatch(counterB, batchId)).toBe(100);

    // 3. Both go offline
    counterA.goOffline();
    counterB.goOffline();

    // 4. Counter A sells 70; Counter B sells 50 (Total = 120 > 100)
    counterA.finalizeSale({
      clientRequestId: generateUuidV7(),
      lines: [{ productId: server.productId, quantity: 70 }],
      payments: [{ method: 'cash', amountPaisa: 70 * 5900 }],
    });

    counterB.finalizeSale({
      clientRequestId: generateUuidV7(),
      lines: [{ productId: server.productId, quantity: 50 }],
      payments: [{ method: 'cash', amountPaisa: 50 * 5900 }],
    });

    // 5. Both go online and sync until idle
    counterA.goOnline();
    counterB.goOnline();

    await counterA.syncUntilIdle();
    await counterB.syncUntilIdle();

    // 6. Assertions
    // Neither sale is rejected
    expect(countOutbox(counterA, 'exception')).toBe(0);
    expect(countOutbox(counterB, 'exception')).toBe(0);
    expect(countOutbox(counterA, 'pending')).toBe(0);
    expect(countOutbox(counterB, 'pending')).toBe(0);

    // Balance on server is negative -20 (100 - 70 - 50 = -20)
    const sStock = await serverStockForBatch(server, batchId);
    expect(sStock).toBe(-20);

    // stock_alerts row exists for this batch
    const alertsRes = await server.runSql(
      `SELECT * FROM stock_alerts WHERE batch_id = $1`,
      [batchId]
    );
    expect(alertsRes.rows.length).toBeGreaterThan(0);
    expect(alertsRes.rows[0]?.type).toBe('negative_stock');
    expect(String(alertsRes.rows[0]?.message)).toContain('-20');
  });

  /**
   * Test 3:
   * Duplicate pushes: replay the same outbox events three times
   * (reset local status to pending through the test helper):
   * server row counts stay the same and results are 'duplicate'.
   */
  it('3. Duplicate pushes: replaying same events 3 times yields "duplicate" and server row counts stay identical', async () => {
    // 0. Counter A receives a purchase so it has stock to sell
    counterA.receivePurchase({
      supplierInvoiceNo: 'SUP-DUP-10',
      lines: [
        {
          productId: server.productId,
          batchNo: 'BATCH-DUP-10',
          expiryDate: '2028-12-31',
          quantity: 10,
          costPaisa: 3000,
          mrpPaisa: 5000,
        },
      ],
    });
    await counterA.syncUntilIdle();

    // 1. Get initial invoice and movement counts on server
    const initialInvoicesRes = await server.runSql('SELECT COUNT(*) as count FROM invoices');
    const initialInvoicesCount = Number(initialInvoicesRes.rows[0]?.count ?? 0);

    const initialMovementsRes = await server.runSql('SELECT COUNT(*) as count FROM stock_movements');
    const initialMovementsCount = Number(initialMovementsRes.rows[0]?.count ?? 0);

    // 2. Counter A creates a fresh sale and syncs it
    const sale = counterA.finalizeSale({
      clientRequestId: generateUuidV7(),
      lines: [{ productId: server.productId, quantity: 1 }],
      payments: [{ method: 'cash', amountPaisa: 5900 }],
    });

    await counterA.syncUntilIdle();

    // The sale has been pushed and acked once
    const afterFirstSyncInvoices = await countServerInvoices(server);
    expect(afterFirstSyncInvoices).toBe(initialInvoicesCount + 1);

    const afterFirstSyncMovementsRes = await server.runSql('SELECT COUNT(*) as count FROM stock_movements');
    const afterFirstSyncMovementsCount = Number(afterFirstSyncMovementsRes.rows[0]?.count ?? 0);
    expect(afterFirstSyncMovementsCount).toBe(initialMovementsCount + 1);

    // Find the outbox event row for this sale
    const outboxRow = counterA.db
      .prepare('SELECT id, event_id FROM outbox WHERE entity_id = ?')
      .get(sale.id) as { id: string; event_id: string } | undefined;
    expect(outboxRow).toBeDefined();

    // 3. Replay the same event 3 times
    for (let replay = 1; replay <= 3; replay++) {
      // Reset local status to pending through test helper
      counterA.db
        .prepare("UPDATE outbox SET status = 'pending', attempts = 0 WHERE id = ?")
        .run(outboxRow!.id);

      expect(countOutbox(counterA, 'pending')).toBe(1);

      // Push again
      const syncRes = await counterA.syncNow();
      expect(syncRes.state).toBe('online_idle');

      // Locally, event transitions to acked
      expect(countOutbox(counterA, 'pending')).toBe(0);

      // Server row counts stay strictly unchanged
      const currentInvoicesCount = await countServerInvoices(server);
      expect(currentInvoicesCount).toBe(afterFirstSyncInvoices);

      const currentMovementsRes = await server.runSql('SELECT COUNT(*) as count FROM stock_movements');
      expect(Number(currentMovementsRes.rows[0]?.count ?? 0)).toBe(afterFirstSyncMovementsCount);
    }
  });

  /**
   * Test 4:
   * A pushes an invoice for a batch that B created and A has not pulled yet:
   * it gets retry_later, then succeeds after a pull, with no manual intervention.
   */
  it('4. Dependent event ordering: A pushes invoice for batch B created before A has pulled -> retry_later, then succeeds after pull', async () => {
    // 1. Counter B receives a purchase creating a new batch, but B does NOT push yet (B goes offline)
    counterB.goOffline();
    const { batchIds } = counterB.receivePurchase({
      supplierInvoiceNo: 'SUP-DEP-999',
      lines: [
        {
          productId: server.productId,
          batchNo: 'BATCH-DEP-999',
          expiryDate: '2029-01-01',
          quantity: 50,
          costPaisa: 3000,
          mrpPaisa: 5000,
        },
      ],
    });
    const batchIdB = batchIds[0]!;

    // 2. Counter A has NOT pulled yet and the batch does not exist on the server either.
    // Counter A receives an outbox event referencing batchIdB (e.g. cross-counter handover)
    const fakeInvoiceId = generateUuidV7();
    const eventId = generateUuidV7();
    const now = new Date().toISOString();
    const invoicePayload = {
      id: fakeInvoiceId,
      counterId: counterA.counterId,
      cashierUserId: counterA.userId,
      invoiceNumber: 'CA-999001',
      clientRequestId: generateUuidV7(),
      status: 'finalized',
      subtotalPaisa: 5000,
      discountPaisa: 0,
      taxPaisa: 900,
      totalPaisa: 5900,
      notes: 'Cross-counter dependent invoice test',
      createdAt: now,
      lines: [
        {
          id: generateUuidV7(),
          productId: server.productId,
          batchId: batchIdB,
          quantity: 1,
          unitPricePaisa: 5000,
          discountPaisa: 0,
          taxRateBp: 1800,
          taxPaisa: 900,
          lineTotalPaisa: 5900,
        },
      ],
      payments: [
        {
          id: generateUuidV7(),
          method: 'cash',
          amountPaisa: 5900,
        },
      ],
    };

    counterA.db.prepare(`
      INSERT INTO outbox (
        id, event_id, device_seq, type, event_type, entity_id, payload, occurred_at, status, attempts, created_at
      ) VALUES (
        ?, ?, (SELECT COALESCE(MAX(device_seq), 0) + 1 FROM outbox), 'invoice.created', 'invoice.created', ?, ?, ?, 'pending', 0, ?
      )
    `).run(eventId, eventId, fakeInvoiceId, JSON.stringify(invoicePayload), now, now);

    expect(countOutbox(counterA, 'pending')).toBe(1);

    // 3. Counter A pushes to the server:
    // The server does not have batchIdB yet -> returns retry_later with UNKNOWN_BATCH
    const pushAttempt1 = await counterA.syncNow();
    expect(pushAttempt1.state).toBe('online_idle');

    // Event stays pending on Counter A with attempts = 1
    const pendingRow = counterA.db
      .prepare('SELECT status, attempts, last_error FROM outbox WHERE id = ?')
      .get(eventId) as { status: string; attempts: number; last_error: string | null } | undefined;

    expect(pendingRow?.status).toBe('pending');
    expect(pendingRow?.attempts).toBe(2); // Attempt 1 + immediate retry after pull in same run
    expect(pendingRow?.last_error).toContain('Referenced batch');

    // 4. Now Counter B goes online and syncs: batchIdB is pushed to server!
    counterB.goOnline();
    await counterB.syncUntilIdle();

    const serverStockB = await serverStockForBatch(server, batchIdB);
    expect(serverStockB).toBe(50);

    // 5. Counter A syncs again:
    // It pulls from the server (pulling batchIdB) and retries the push of its invoice
    await counterA.syncUntilIdle();

    // 6. Assertions:
    // Invoice on Counter A is now acked with zero manual intervention
    const resolvedRow = counterA.db
      .prepare('SELECT status, attempts FROM outbox WHERE id = ?')
      .get(eventId) as { status: string; attempts: number } | undefined;

    expect(resolvedRow?.status).toBe('acked');
    expect(countOutbox(counterA, 'pending')).toBe(0);

    // Server stock for batchIdB reflects the sale (50 - 1 = 49)
    const finalStockB = await serverStockForBatch(server, batchIdB);
    expect(finalStockB).toBe(49);
  });
});
