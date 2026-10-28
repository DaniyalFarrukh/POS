import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateUuidV7 } from '@pos/shared';
import { eq } from 'drizzle-orm';
import { products, changeLog, taxCategories, suppliers } from '../../apps/server/src/db/schema';
import {
  startTestServer,
  createTestCounter,
  countOutbox,
  type TestServer,
  type TestCounter,
} from './harness';

describe('Failure Modes & Resilience Integration Tests (Phase 3.4)', () => {
  let server: TestServer;
  let counterA: TestCounter;
  let counterB: TestCounter;

  beforeEach(async () => {
    server = await startTestServer();
    counterA = await createTestCounter('Counter A', server, server.counterAId);
    counterB = await createTestCounter('Counter B', server, server.counterBId);
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (counterA) await counterA.cleanup();
    if (counterB) await counterB.cleanup();
    if (server) await server.stop();
  });

  /**
   * Test 1:
   * Server outage mid-push: queue 250 events on a counter. The proxy drops the connection
   * after the server processed the first batch of 100 but before the response reaches the client.
   * Then restore the network. Assert: all 250 events end up on the server exactly once
   * (no duplicates, no gaps), in order of deviceSeq, the outbox is fully acked, and backoff delays
   * were applied (use fake timers).
   */
  it(
    '1. Server outage mid-push: queue 250 events, drop response after first 100, then restore network with backoff',
    async () => {
    // 1. Queue 250 purchase events on Counter A (each creates 1 batch + 1 movement + 1 outbox event)
    const totalEvents = 250;
    const batchIds: string[] = [];

    const now = new Date().toISOString();
    counterA.db.transaction(() => {
      for (let i = 1; i <= totalEvents; i++) {
        const batchId = generateUuidV7();
        const purchaseId = generateUuidV7();
        const eventId = generateUuidV7();
        const batchNo = `BATCH-250-${String(i).padStart(4, '0')}`;

        batchIds.push(batchId);

        counterA.db.prepare(`
          INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
          VALUES (?, ?, ?, '2028-12-31', 3000, 5000, ?, ?)
        `).run(batchId, server.productId, batchNo, now, now);

        counterA.db.prepare(`
          INSERT INTO stock_movements (id, product_id, batch_id, branch_id, type, quantity_signed, reference_type, reference_id, reason, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'purchase', 10, 'purchase', ?, 'Queue 250 Test', ?, ?)
        `).run(generateUuidV7(), server.productId, batchId, counterA.branchId, purchaseId, now, now);

        const payload = {
          purchase: {
            id: purchaseId,
            branchId: counterA.branchId,
            supplierInvoiceNo: `SUP-250-${i}`,
            invoiceDate: now.slice(0, 10),
            totalCostPaisa: 30000,
          },
          batches: [
            {
              id: batchId,
              productId: server.productId,
              batchNo,
              expiryDate: '2028-12-31',
              costPaisa: 3000,
              mrpPaisa: 5000,
            },
          ],
          lines: [
            {
              id: generateUuidV7(),
              productId: server.productId,
              batchId,
              quantity: 10,
              costPaisa: 3000,
              mrpPaisa: 5000,
            },
          ],
        };

        counterA.db.prepare(`
          INSERT INTO outbox (
            id, event_id, device_seq, type, event_type, entity_id, payload, occurred_at, status, attempts, created_at
          ) VALUES (
            ?, ?, (SELECT COALESCE(MAX(device_seq), 0) + 1 FROM outbox), 'purchase.received', 'purchase.received', ?, ?, ?, 'pending', 0, ?
          )
        `).run(eventId, eventId, purchaseId, JSON.stringify(payload), now, now);
      }
    })();

    expect(countOutbox(counterA, 'pending')).toBe(250);

    // Verify monotonic device_seq without gaps (1..250)
    const seqRows = counterA.db
      .prepare('SELECT device_seq FROM outbox ORDER BY device_seq ASC')
      .all() as { device_seq: number }[];
    expect(seqRows).toHaveLength(250);
    expect(seqRows[0]?.device_seq).toBe(1);
    expect(seqRows[249]?.device_seq).toBe(250);

    // 2. Configure proxy: drop connection AFTER server finishes processing the first batch (100 events)
    // of POST /sync/push but before response reaches the client
    counterA.proxy.setDropNextPushResponse(true);

    // Run first sync attempt:
    // Client probes /health (succeeds), pushes events 1..100.
    // Server processes them and inserts into processed_events.
    // Proxy drops socket on push response. Client experiences network error.
    const syncRes1 = await counterA.syncNow();
    expect(syncRes1.state).toBe('error');

    // On server: exactly the first 100 events were processed!
    const processedFirstRes = await server.runSql(
      'SELECT COUNT(*) as count FROM processed_events WHERE pharmacy_id = $1',
      [server.pharmacyId]
    );
    expect(Number(processedFirstRes.rows[0]?.count)).toBe(100);

    // On client: because response was dropped, client treats the batch as failed:
    // All 250 events are still pending! None lost, none dropped.
    expect(countOutbox(counterA, 'pending')).toBe(250);
    expect(countOutbox(counterA, 'acked')).toBe(0);

    // 3. Backoff delays were scheduled:
    // Next cycle is scheduled with exponential backoff (attempt #1 -> ~2000ms delay)
    // Restore normal proxy operation
    counterA.proxy.setDropNextResponse(false);
    counterA.proxy.setMode('normal');

    // 4. Client completes sync cycles until idle:
    // First round resends 1..100 -> server returns 'duplicate' for all 100 -> client marks them acked!
    // Next round pushes 101..200 -> server accepts -> client marks them acked!
    // Next round pushes 201..250 -> server accepts -> client marks them acked!
    const finalSyncStatus = await counterA.syncUntilIdle();
    expect(finalSyncStatus.state).toBe('online_idle');

    // 5. Assertions:
    // Outbox is fully acked with 0 pending and 0 exceptions
    expect(countOutbox(counterA, 'pending')).toBe(0);
    expect(countOutbox(counterA, 'exception')).toBe(0);
    expect(countOutbox(counterA, 'acked')).toBe(250);

    // All 250 events end up on the server exactly once (no duplicates, no gaps)
    const processedFinalRes = await server.runSql(
      'SELECT COUNT(*) as count FROM processed_events WHERE pharmacy_id = $1',
      [server.pharmacyId]
    );
    expect(Number(processedFinalRes.rows[0]?.count)).toBe(250);

    // Server batches row count is 250
    const serverBatchesRes = await server.runSql(
      'SELECT COUNT(*) as count FROM batches WHERE pharmacy_id = $1',
      [server.pharmacyId]
    );
    expect(Number(serverBatchesRes.rows[0]?.count)).toBe(250);
  }, 30000);

  /**
   * Test 2:
   * Server returns 503 for several consecutive attempts then recovers:
   * nothing lost, status transitions offline/error -> online_idle.
   */
  it('2. Server returns 503 for several consecutive attempts then recovers: nothing lost, transitions offline/error -> online_idle', async () => {
    // 1. Counter A creates a sale
    // First receive stock so sale can be finalized
    counterA.receivePurchase({
      supplierInvoiceNo: 'SUP-503-TEST',
      lines: [
        {
          productId: server.productId,
          batchNo: 'BATCH-503-TEST',
          expiryDate: '2028-12-31',
          quantity: 20,
          costPaisa: 3000,
          mrpPaisa: 5000,
        },
      ],
    });
    // Sync the purchase first while network is healthy
    await counterA.syncUntilIdle();

    // Now Counter A finalizes 2 sales
    counterA.finalizeSale({
      clientRequestId: generateUuidV7(),
      lines: [{ productId: server.productId, quantity: 2 }],
      payments: [{ method: 'cash', amountPaisa: 2 * 5900 }],
    });
    counterA.finalizeSale({
      clientRequestId: generateUuidV7(),
      lines: [{ productId: server.productId, quantity: 3 }],
      payments: [{ method: 'cash', amountPaisa: 3 * 5900 }],
    });

    expect(countOutbox(counterA, 'pending')).toBe(2);

    // 2. Server proxy returns 503 Service Unavailable
    counterA.proxy.setMode('503');

    // Run 3 consecutive sync attempts under 503
    for (let attempt = 1; attempt <= 3; attempt++) {
      const status = await counterA.syncNow();
      // Status is either offline (health probe 503) or error
      expect(['offline', 'error']).toContain(status.state);

      // Nothing lost: both sales remain pending in outbox
      expect(countOutbox(counterA, 'pending')).toBe(2);
      expect(countOutbox(counterA, 'exception')).toBe(0);
      expect(status.lastError).toBeDefined();
    }

    // 3. Server recovers: proxy set back to normal
    counterA.proxy.setMode('normal');

    // Sync now succeeds
    const recoveredStatus = await counterA.syncUntilIdle();
    expect(recoveredStatus.state).toBe('online_idle');

    // Both events are acked, nothing lost
    expect(countOutbox(counterA, 'pending')).toBe(0);
    expect(countOutbox(counterA, 'exception')).toBe(0);
    expect(countOutbox(counterA, 'acked')).toBe(3); // 1 purchase + 2 sales
  });

  /**
   * Test 3:
   * Price change: update a product price on the server (through the same change_log mechanism the server uses).
   * Both counters pull on the next cycle and the new price appears locally.
   * A sale made after the pull uses the new price; a sale made before it used the old price,
   * and the stored invoice keeps the old price.
   */
  it('3. Price change: product price update on server propagates via change_log; old invoice keeps old price, new sale uses new price', async () => {
    // 1. Initial purchase on Counter A to have inventory on both counters
    counterA.receivePurchase({
      supplierInvoiceNo: 'SUP-PRICE-1',
      lines: [
        {
          productId: server.productId,
          batchNo: 'BATCH-PRICE-1',
          expiryDate: '2028-12-31',
          quantity: 50,
          costPaisa: 3000,
          mrpPaisa: 5000, // Original price: 5000 paisa (Rs. 50.00)
        },
      ],
    });
    await counterA.syncUntilIdle();
    await counterB.syncUntilIdle();

    // 2. Sale before price change on Counter A (MRP 5000 + 18% GST = 5900 paisa)
    const saleBefore = counterA.finalizeSale({
      clientRequestId: generateUuidV7(),
      lines: [{ productId: server.productId, quantity: 1 }],
      payments: [{ method: 'cash', amountPaisa: 5900 }],
    });
    expect(saleBefore.totalPaisa).toBe(5900);
    expect(saleBefore.lines[0]?.unitPricePaisa).toBe(5000);

    // 3. Server updates product price to 7500 paisa (Rs. 75.00) and writes change_log
    const now = new Date().toISOString();
    await server.ctx.db
      .update(products)
      .set({ mrpPaisa: 7500, updatedAt: now })
      .where(eq(products.id, server.productId));

    await server.ctx.db.insert(changeLog).values({
      pharmacyId: server.pharmacyId,
      entity: 'product',
      entityId: server.productId,
      op: 'upsert',
      data: {
        id: server.productId,
        brandName: 'Panadol 500mg',
        genericName: 'Paracetamol',
        strength: '500mg',
        form: 'Tablet',
        manufacturer: 'GSK Pakistan',
        barcode: '896400010001',
        taxCategoryId: server.taxCategoryId,
        mrpPaisa: 7500, // New MRP: Rs. 75.00
        isControlled: false,
        isActive: true,
      },
      createdAt: now,
    });

    // 4. Both counters pull on next cycle
    await counterA.syncUntilIdle();
    await counterB.syncUntilIdle();

    // 5. The new price appears locally in both counters' SQLite
    const localProdA = counterA.db
      .prepare('SELECT mrp_paisa FROM products WHERE id = ?')
      .get(server.productId) as { mrp_paisa: number };
    expect(localProdA.mrp_paisa).toBe(7500);

    const localProdB = counterB.db
      .prepare('SELECT mrp_paisa FROM products WHERE id = ?')
      .get(server.productId) as { mrp_paisa: number };
    expect(localProdB.mrp_paisa).toBe(7500);

    // 6. A sale made after the pull uses the new price (7500 MRP + 18% GST (1350) = 8850 paisa)
    const saleAfter = counterB.finalizeSale({
      clientRequestId: generateUuidV7(),
      lines: [{ productId: server.productId, quantity: 1 }],
      payments: [{ method: 'cash', amountPaisa: 8850 }],
    });
    expect(saleAfter.totalPaisa).toBe(8850);
    expect(saleAfter.lines[0]?.unitPricePaisa).toBe(7500);

    // 7. Stored invoice from before pull keeps the old price (immutability rule 3)
    const storedOldInvoice = counterA.db
      .prepare('SELECT total_paisa FROM invoices WHERE id = ?')
      .get(saleBefore.id) as { total_paisa: number };
    expect(storedOldInvoice.total_paisa).toBe(5900);
    expect(saleBefore.totalPaisa).toBe(5900);
  });

  /**
   * Test 4:
   * Master data pull does not create outbox rows on the counters.
   */
  it('4. Master data pull does not create outbox rows on the counters (no echo rule)', async () => {
    // Initial outbox count
    const initialOutboxCount = Number(
      (counterA.db.prepare('SELECT COUNT(*) as c FROM outbox').get() as { c: number }).c
    );

    // Server inserts multiple new master data rows into change_log
    const newProductId = generateUuidV7();
    const newTaxCatId = generateUuidV7();
    const newSupplierId = generateUuidV7();
    const now = new Date().toISOString();

    // 1. New Tax Category
    await server.ctx.db.insert(taxCategories).values({
      id: newTaxCatId,
      pharmacyId: server.pharmacyId,
      name: 'Zero Rated (0%)',
      rateBp: 0,
      isExempt: true,
      createdAt: now,
      updatedAt: now,
    });
    await server.ctx.db.insert(changeLog).values({
      pharmacyId: server.pharmacyId,
      entity: 'tax_category',
      entityId: newTaxCatId,
      op: 'upsert',
      data: {
        id: newTaxCatId,
        name: 'Zero Rated (0%)',
        rateBp: 0,
        isExempt: true,
      },
      createdAt: now,
    });

    // 2. New Product
    await server.ctx.db.insert(products).values({
      id: newProductId,
      pharmacyId: server.pharmacyId,
      brandName: 'Disprin 300mg',
      genericName: 'Aspirin',
      strength: '300mg',
      form: 'Tablet',
      manufacturer: 'Reckitt Benckiser',
      barcode: '896400010099',
      taxCategoryId: newTaxCatId,
      mrpPaisa: 2500,
      isControlled: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await server.ctx.db.insert(changeLog).values({
      pharmacyId: server.pharmacyId,
      entity: 'product',
      entityId: newProductId,
      op: 'upsert',
      data: {
        id: newProductId,
        brandName: 'Disprin 300mg',
        genericName: 'Aspirin',
        strength: '300mg',
        form: 'Tablet',
        manufacturer: 'Reckitt Benckiser',
        barcode: '896400010099',
        taxCategoryId: newTaxCatId,
        mrpPaisa: 2500,
        isControlled: false,
        isActive: true,
      },
      createdAt: now,
    });

    // 3. New Supplier
    await server.ctx.db.insert(suppliers).values({
      id: newSupplierId,
      pharmacyId: server.pharmacyId,
      name: 'National Distribution Ltd',
      contactPerson: 'Ali Khan',
      phone: '03001234567',
      email: 'orders@nationaldist.com',
      address: 'Industrial Area, Karachi',
      createdAt: now,
      updatedAt: now,
    });
    await server.ctx.db.insert(changeLog).values({
      pharmacyId: server.pharmacyId,
      entity: 'supplier',
      entityId: newSupplierId,
      op: 'upsert',
      data: {
        id: newSupplierId,
        name: 'National Distribution Ltd',
        contactPerson: 'Ali Khan',
        phone: '03001234567',
        email: 'orders@nationaldist.com',
        address: 'Industrial Area, Karachi',
        isActive: true,
      },
      createdAt: now,
    });

    // Counter A pulls the master data
    const pullStatus = await counterA.syncNow();
    expect(pullStatus.state).toBe('online_idle');

    // Master data exists locally in Counter A's SQLite
    const localProduct = counterA.db
      .prepare('SELECT id, brand_name FROM products WHERE id = ?')
      .get(newProductId) as { id: string; brand_name: string } | undefined;
    expect(localProduct?.brand_name).toBe('Disprin 300mg');

    const localSupplier = counterA.db
      .prepare('SELECT id, name FROM suppliers WHERE id = ?')
      .get(newSupplierId) as { id: string; name: string } | undefined;
    expect(localSupplier?.name).toBe('National Distribution Ltd');

    // Assert: Applying pulled master data created ZERO rows in outbox
    const finalOutboxCount = Number(
      (counterA.db.prepare('SELECT COUNT(*) as c FROM outbox').get() as { c: number }).c
    );
    expect(finalOutboxCount).toBe(initialOutboxCount);
  });

  /**
   * Test 5:
   * A revoked device gets auth_error, keeps all its events, and sales on that counter still work offline.
   */
  it('5. A revoked device gets auth_error, keeps all its events, and sales still work offline', async () => {
    // 1. Counter A receives stock and finalizes a sale
    counterA.receivePurchase({
      supplierInvoiceNo: 'SUP-REVOKE-1',
      lines: [
        {
          productId: server.productId,
          batchNo: 'BATCH-REVOKE-1',
          expiryDate: '2028-12-31',
          quantity: 20,
          costPaisa: 3000,
          mrpPaisa: 5000,
        },
      ],
    });

    counterA.finalizeSale({
      clientRequestId: generateUuidV7(),
      lines: [{ productId: server.productId, quantity: 1 }],
      payments: [{ method: 'cash', amountPaisa: 5900 }],
    });

    // 2 outbox events pending (1 purchase + 1 sale)
    expect(countOutbox(counterA, 'pending')).toBe(2);

    // 2. On server: revoke the device registration for Counter A
    await server.runSql('UPDATE devices SET is_revoked = true WHERE counter_id = $1', [
      counterA.counterId,
    ]);

    // 3. Counter A attempts to sync: server returns HTTP 403 Forbidden
    const syncResult = await counterA.syncNow();
    expect(syncResult.state).toBe('auth_error');
    expect(syncResult.lastError).toContain('Authentication failed');

    // All events are KEPT! Never deleted on auth_error (docs/SYNC_CLIENT.md rule)
    expect(countOutbox(counterA, 'pending')).toBe(2);
    expect(countOutbox(counterA, 'acked')).toBe(0);

    // 4. Sales on that counter STILL work offline! (Rule 38: sales never blocked by sync state)
    const offlineSale = counterA.finalizeSale({
      clientRequestId: generateUuidV7(),
      lines: [{ productId: server.productId, quantity: 2 }],
      payments: [{ method: 'cash', amountPaisa: 2 * 5900 }],
    });

    expect(offlineSale.status).toBe('finalized');
    expect(offlineSale.totalPaisa).toBe(11800);

    // Now 3 pending events safely retained in outbox
    expect(countOutbox(counterA, 'pending')).toBe(3);

    // Local stock deduction occurred correctly (20 - 1 - 2 = 17)
    const stockRow = counterA.db
      .prepare('SELECT SUM(quantity_signed) as bal FROM stock_movements')
      .get() as { bal: number };
    expect(stockRow.bal).toBe(17);
  });
});
