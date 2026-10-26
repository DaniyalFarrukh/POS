import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startTestServer,
  createTestCounter,
  serverStockForBatch,
  localStockForBatch,
  countOutbox,
  type TestServer,
  type TestCounter,
} from './harness';

describe('Integration Test Harness Smoke Test (Phase 3.4a)', () => {
  let server: TestServer;
  let counterA: TestCounter;

  beforeAll(async () => {
    server = await startTestServer();
    counterA = await createTestCounter('Counter A', server);
  });

  afterAll(async () => {
    if (counterA) {
      await counterA.cleanup();
    }
    if (server) {
      await server.stop();
    }
  });

  it('counter registers, receives a purchase, syncs, and the server shows the batch with the right stock', async () => {
    // 1. Initial State: Outbox empty, stock 0
    expect(countOutbox(counterA, 'pending')).toBe(0);

    // 2. Counter A receives a GRN purchase of 50 units for the seeded product
    const { batchIds } = counterA.receivePurchase({
      supplierInvoiceNo: 'SUP-SMOKE-001',
      lines: [
        {
          productId: server.productId,
          batchNo: 'BATCH-SMOKE-100',
          expiryDate: '2028-12-31',
          quantity: 50,
          costPaisa: 3000,
          mrpPaisa: 5000,
        },
      ],
    });

    const batchId = batchIds[0]!;
    expect(batchId).toBeDefined();

    // Local stock immediately reflects +50 units
    expect(localStockForBatch(counterA, batchId)).toBe(50);
    expect(countOutbox(counterA, 'pending')).toBe(1);

    // 3. Counter A syncs with server
    const syncResult = await counterA.syncUntilIdle();
    expect(syncResult.state).toBe('online_idle');

    // 4. Assertions: Outbox is acked and server shows batch with 50 stock
    expect(countOutbox(counterA, 'pending')).toBe(0);
    expect(countOutbox(counterA, 'acked')).toBe(1);

    const sStock = await serverStockForBatch(server, batchId);
    expect(sStock).toBe(50);
  });
});
