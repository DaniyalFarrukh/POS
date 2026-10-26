import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateUuidV7 } from '@pos/shared';
import { products, changeLog, taxCategories } from '../../apps/server/src/db/schema';
import {
  startTestServer,
  createTestCounter,
  countServerInvoices,
  countOutbox,
  type TestServer,
  type TestCounter,
} from './harness';

describe('Crash & Transactional Integrity Integration Tests (Phase 3.4)', () => {
  let server: TestServer;
  let counterA: TestCounter;

  beforeEach(async () => {
    server = await startTestServer();
    counterA = await createTestCounter('Counter A', server, server.counterAId);
  });

  afterEach(async () => {
    if (counterA) await counterA.cleanup();
    if (server) await server.stop();
  });

  /**
   * Test 1:
   * Crash after outbox write: a counter finalizes a sale, then the process is killed
   * (simulate by closing the db and discarding the worker without any sync).
   * restart() builds a new instance on the same SQLite file.
   * Assert: the event is still pending and syncs once, producing exactly one server invoice.
   */
  it('1. Crash after outbox write: worker killed before sync; restart() recovers pending event and pushes exactly once', async () => {
    // 1. Initial purchase so counter has inventory, sync once
    counterA.receivePurchase({
      supplierInvoiceNo: 'SUP-CRASH-1',
      lines: [
        {
          productId: server.productId,
          batchNo: 'BATCH-CRASH-1',
          expiryDate: '2028-12-31',
          quantity: 20,
          costPaisa: 3000,
          mrpPaisa: 5000,
        },
      ],
    });
    await counterA.syncUntilIdle();

    const serverInvoicesInitial = await countServerInvoices(server);
    expect(serverInvoicesInitial).toBe(0);

    // 2. Finalize sale locally, writing invoice, line, movement, and outbox in atomic transaction
    const sale = counterA.finalizeSale({
      clientRequestId: generateUuidV7(),
      lines: [{ productId: server.productId, quantity: 1 }],
      payments: [{ method: 'cash', amountPaisa: 5900 }],
    });
    expect(sale.status).toBe('finalized');

    // 3. Process is killed immediately before sync occurs!
    // restart() closes db and worker, and instantiates a new worker on the exact same SQLite file
    await counterA.restart();

    // 4. Assert: after restart, the event is still pending in local SQLite
    expect(countOutbox(counterA, 'pending')).toBe(1);
    expect(countOutbox(counterA, 'acked')).toBe(1); // the earlier purchase was acked

    const pendingRow = counterA.db
      .prepare('SELECT id, status, attempts FROM outbox WHERE status = ?')
      .get('pending') as { id: string; status: string; attempts: number } | undefined;
    expect(pendingRow).toBeDefined();
    expect(pendingRow?.attempts).toBe(0);

    // 5. Worker syncs: event is pushed and acked
    const syncStatus = await counterA.syncUntilIdle();
    expect(syncStatus.state).toBe('online_idle');

    expect(countOutbox(counterA, 'pending')).toBe(0);
    expect(countOutbox(counterA, 'acked')).toBe(2);

    // 6. Assert: exactly one server invoice was created
    const serverInvoicesFinal = await countServerInvoices(server);
    expect(serverInvoicesFinal).toBe(1);

    const serverInvRes = await server.runSql(
      'SELECT id, invoice_number, total_paisa FROM invoices WHERE id = $1',
      [sale.id]
    );
    expect(serverInvRes.rows).toHaveLength(1);
    expect(serverInvRes.rows[0]?.invoice_number).toBe(sale.invoiceNumber);
    expect(Number(serverInvRes.rows[0]?.total_paisa)).toBe(5900);
  });

  /**
   * Test 2:
   * Crash during pull: make a page apply fail halfway (throw inside the transaction).
   * The cursor does not move and no partial data exists. Next cycle succeeds.
   */
  it('2. Crash during pull: error inside page transaction rolls back cursor and partial data; next cycle succeeds cleanly', async () => {
    // 1. Record initial cursor
    const initialCursorRow = counterA.db
      .prepare("SELECT value FROM sync_state WHERE key = 'pull_cursor'")
      .get() as { value: string };
    const initialCursor = initialCursorRow.value;

    // 2. Server creates two new master data entities in change_log:
    // First a tax category, then a product
    const now = new Date().toISOString();
    const newTaxCatId = generateUuidV7();
    const newProductId = generateUuidV7();

    await server.ctx.db.insert(taxCategories).values({
      id: newTaxCatId,
      pharmacyId: server.pharmacyId,
      name: 'Partial Test Tax (10%)',
      rateBp: 1000,
      isExempt: false,
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
        name: 'Partial Test Tax (10%)',
        rateBp: 1000,
        isExempt: false,
      },
      createdAt: now,
    });

    await server.ctx.db.insert(products).values({
      id: newProductId,
      pharmacyId: server.pharmacyId,
      brandName: 'Simulated Crash Product',
      genericName: 'Crashium',
      strength: '10mg',
      form: 'Tablet',
      manufacturer: 'Crash Pharma',
      barcode: '896400010077',
      taxCategoryId: newTaxCatId,
      mrpPaisa: 1500,
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
        brandName: 'Simulated Crash Product',
        genericName: 'Crashium',
        strength: '10mg',
        form: 'Tablet',
        manufacturer: 'Crash Pharma',
        barcode: '896400010077',
        taxCategoryId: newTaxCatId,
        mrpPaisa: 1500,
        isControlled: false,
        isActive: true,
      },
      createdAt: now,
    });

    // 3. Make page apply fail halfway:
    // Create an SQLite trigger on products table that raises a failure on insert
    counterA.db.exec(`
      CREATE TRIGGER fail_product_pull_insert
      BEFORE INSERT ON products
      BEGIN
        SELECT RAISE(FAIL, 'Simulated mid-page transaction crash');
      END;
    `);

    // 4. Run pull: the page transaction throws when applying the product change
    const failedPullStatus = await counterA.syncNow();
    expect(failedPullStatus.state).toBe('error');
    expect(failedPullStatus.lastError).toContain('Pull failed');

    // 5. Assert: The cursor did NOT move!
    const cursorAfterFail = counterA.db
      .prepare("SELECT value FROM sync_state WHERE key = 'pull_cursor'")
      .get() as { value: string };
    expect(cursorAfterFail.value).toBe(initialCursor);

    // 6. Assert: NO partial data exists (atomic rollback of the whole page transaction)
    // The tax category was before the product in the page, but must be rolled back too!
    const localTaxCat = counterA.db
      .prepare('SELECT id FROM tax_categories WHERE id = ?')
      .get(newTaxCatId);
    expect(localTaxCat).toBeUndefined();

    const localProduct = counterA.db
      .prepare('SELECT id FROM products WHERE id = ?')
      .get(newProductId);
    expect(localProduct).toBeUndefined();

    // 7. Remove the failure trigger (simulate fix/recovery)
    counterA.db.exec('DROP TRIGGER fail_product_pull_insert;');

    // 8. Next cycle succeeds cleanly!
    const successPullStatus = await counterA.syncUntilIdle();
    expect(successPullStatus.state).toBe('online_idle');

    // Cursor has now advanced
    const finalCursor = counterA.db
      .prepare("SELECT value FROM sync_state WHERE key = 'pull_cursor'")
      .get() as { value: string };
    expect(Number(finalCursor.value)).toBeGreaterThan(Number(initialCursor));

    // Both entities now exist in local SQLite
    expect(
      counterA.db.prepare('SELECT id FROM tax_categories WHERE id = ?').get(newTaxCatId)
    ).toBeDefined();
    expect(
      counterA.db.prepare('SELECT id FROM products WHERE id = ?').get(newProductId)
    ).toBeDefined();
  });

  /**
   * Test 3:
   * Crash after the server accepted a push but before the client marked it acked:
   * after restart, the resend returns duplicate and the invoice exists once.
   */
  it('3. Crash after server accepted push before client marked acked: restart resend returns duplicate, invoice exists once', async () => {
    // 1. Initial purchase so counter has inventory
    counterA.receivePurchase({
      supplierInvoiceNo: 'SUP-DUP-TEST',
      lines: [
        {
          productId: server.productId,
          batchNo: 'BATCH-DUP-TEST',
          expiryDate: '2028-12-31',
          quantity: 20,
          costPaisa: 3000,
          mrpPaisa: 5000,
        },
      ],
    });
    await counterA.syncUntilIdle();

    const initialInvoicesCount = await countServerInvoices(server);
    expect(initialInvoicesCount).toBe(0);

    // 2. Finalize sale
    const sale = counterA.finalizeSale({
      clientRequestId: generateUuidV7(),
      lines: [{ productId: server.productId, quantity: 1 }],
      payments: [{ method: 'cash', amountPaisa: 5900 }],
    });

    // 3. Configure proxy: drop response of POST /sync/push after server processes it
    counterA.proxy.setDropNextPushResponse(true);

    // Push attempt:
    // Fastify accepts the push, writes to invoices and processed_events.
    // Proxy drops the response socket before the client can mark the event acked.
    const failPush = await counterA.syncNow();
    expect(failPush.state).toBe('error');

    // Server accepted and saved the invoice!
    const serverInvoicesAfterFirstPush = await countServerInvoices(server);
    expect(serverInvoicesAfterFirstPush).toBe(1);

    // 4. Crash and restart client process
    await counterA.restart();

    // Event is still pending locally
    expect(countOutbox(counterA, 'pending')).toBe(1);

    // 5. Normal network restored
    counterA.proxy.setDropNextPushResponse(false);
    counterA.proxy.setMode('normal');

    // 6. After restart, client resends:
    // Server sees eventId in processed_events -> returns status: 'duplicate'
    // Client marks it acked!
    const resendStatus = await counterA.syncUntilIdle();
    expect(resendStatus.state).toBe('online_idle');

    expect(countOutbox(counterA, 'pending')).toBe(0);
    expect(countOutbox(counterA, 'acked')).toBe(2); // 1 purchase + 1 sale

    // 7. Assert: invoice exists exactly ONCE on server
    const serverInvoicesFinal = await countServerInvoices(server);
    expect(serverInvoicesFinal).toBe(1);

    const allInvoicesRes = await server.runSql(
      'SELECT id, invoice_number FROM invoices WHERE pharmacy_id = $1',
      [server.pharmacyId]
    );
    expect(allInvoicesRes.rows).toHaveLength(1);
    expect(allInvoicesRes.rows[0]?.id).toBe(sale.id);
  });
});
