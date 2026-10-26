import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateUuidV7 } from '@pos/shared';
import {
  startTestServer,
  createTestCounter,
  serverStockForBatch,
  localStockForBatch,
  countOutbox,
  type TestServer,
  type TestCounter,
} from './harness';

/**
 * Deterministic pseudo-random number generator (Mulberry32)
 */
function createPrng(seed: number) {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Full Day Multi-Counter Simulation (Phase 3.4)', () => {
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
   * Test 4:
   * Full day simulation with two counters: each counter does a random mix of purchases,
   * sales, returns and adjustments (seeded random, 300 operations each), with random network
   * drops and restarts. At the end both go online and sync until idle.
   * Assert:
   * 1. Server stock per batch equals the sum of all movements
   * 2. Server stock equals each counter's local stock per batch (after pull)
   * 3. No outbox events left pending or in exceptions
   * 4. Invoice totals on the server equal local totals
   */
  it(
    '4. Full day simulation: 2 counters, 300 operations each with random network drops and restarts, then sync until idle',
    async () => {
      const rand = createPrng(42);
      const allBatchIds = new Set<string>();

      interface CounterState {
        counter: TestCounter;
        name: string;
        batchIds: string[];
        invoices: Array<{ id: string; lines: Array<{ id: string; quantity: number }> }>;
        operationsCompleted: number;
      }

      const stateA: CounterState = {
        counter: counterA,
        name: 'Counter A',
        batchIds: [],
        invoices: [],
        operationsCompleted: 0,
      };

      const stateB: CounterState = {
        counter: counterB,
        name: 'Counter B',
        batchIds: [],
        invoices: [],
        operationsCompleted: 0,
      };

      // 1. Initial inventory: seed 2 initial purchases per counter (200 units each)
      for (const st of [stateA, stateB]) {
        for (let b = 1; b <= 2; b++) {
          const batchNo = `INIT-${st.name.replace(/\s+/g, '')}-B${b}`;
          const res = st.counter.receivePurchase({
            supplierInvoiceNo: `SUP-${batchNo}`,
            lines: [
              {
                productId: server.productId,
                batchNo,
                expiryDate: '2028-12-31',
                quantity: 200,
                costPaisa: 3000,
                mrpPaisa: 5000,
              },
            ],
          });
          st.batchIds.push(...res.batchIds);
          res.batchIds.forEach((id) => allBatchIds.add(id));
        }
      }

      // Initial sync so initial inventory is discoverable
      await counterA.syncUntilIdle();
      await counterB.syncUntilIdle();

      // 2. Main Simulation Loop: 300 operations each (600 total)
      const operationsTarget = 300;
      let totalOps = 0;

      while (stateA.operationsCompleted < operationsTarget || stateB.operationsCompleted < operationsTarget) {
        // Alternate or pick counter
        const activeState = (totalOps % 2 === 0 ? stateA : stateB);
        if (activeState.operationsCompleted >= operationsTarget) {
          const other = activeState === stateA ? stateB : stateA;
          if (other.operationsCompleted >= operationsTarget) break;
        }

        const currentCounter = activeState === stateA && stateA.operationsCompleted < operationsTarget ? stateA : stateB;
        const c = currentCounter.counter;
        totalOps++;
        currentCounter.operationsCompleted++;

        const opTypeRoll = rand();

        // Check local stock
        const stockRow = c.db
          .prepare('SELECT COALESCE(SUM(quantity_signed), 0) as bal FROM stock_movements')
          .get() as { bal: number };
        const localBal = stockRow.bal;

        // Operation 1: Purchase (always available, preferred if local stock is low)
        if (localBal < 20 || opTypeRoll < 0.25) {
          const batchSeq = currentCounter.operationsCompleted;
          const batchNo = `SIM-${currentCounter.name.slice(-1)}-${batchSeq}`;
          const qty = 20 + Math.floor(rand() * 30); // 20..49 units
          const pRes = c.receivePurchase({
            supplierInvoiceNo: `SUP-SIM-${batchSeq}`,
            lines: [
              {
                productId: server.productId,
                batchNo,
                expiryDate: '2028-12-31',
                quantity: qty,
                costPaisa: 3000,
                mrpPaisa: 5000,
              },
            ],
          });
          currentCounter.batchIds.push(...pRes.batchIds);
          pRes.batchIds.forEach((id) => allBatchIds.add(id));
        }
        // Operation 2: Sale (if localBal >= 3)
        else if (localBal >= 3 && opTypeRoll < 0.65) {
          const saleQty = 1 + Math.floor(rand() * 3); // 1..3 units
          const paymentTotal = saleQty * 5900;
          try {
            const sale = c.finalizeSale({
              clientRequestId: generateUuidV7(),
              lines: [{ productId: server.productId, quantity: saleQty }],
              payments: [{ method: 'cash', amountPaisa: paymentTotal }],
            });
            currentCounter.invoices.push({
              id: sale.id,
              lines: sale.lines.map((l) => ({ id: l.id, quantity: l.quantity })),
            });
          } catch {
            // Insufficient stock or allocation skip
          }
        }
        // Operation 3: Return / Credit Note (if invoices exist with lines)
        else if (currentCounter.invoices.length > 0 && opTypeRoll < 0.80) {
          const invIdx = Math.floor(rand() * currentCounter.invoices.length);
          const targetInv = currentCounter.invoices[invIdx]!;
          if (targetInv.lines.length > 0) {
            const targetLine = targetInv.lines[0]!;
            try {
              c.processReturn({
                originalInvoiceId: targetInv.id,
                lines: [{ invoiceLineId: targetLine.id, quantity: 1 }],
                refundMethod: 'cash',
                reason: 'Customer return in simulation',
              });
            } catch {
              // Return limit reached or already returned
            }
          }
        }
        // Operation 4: Stock Adjustment
        else if (currentCounter.batchIds.length > 0 && opTypeRoll < 0.90) {
          const batchId = currentCounter.batchIds[Math.floor(rand() * currentCounter.batchIds.length)]!;
          const adjQty = rand() > 0.5 ? 2 : -1;
          c.adjustStock({
            productId: server.productId,
            batchId,
            quantitySigned: adjQty,
            reason: `Simulation adjustment (${adjQty > 0 ? '+2' : '-1'})`,
          });
        }
        // Operation 5: Chaos / Network Fluctuation / Restart
        else {
          const chaosRoll = rand();
          if (chaosRoll < 0.35) {
            // Toggle offline / online
            if (c.isOnline()) {
              c.goOffline();
            } else {
              c.goOnline();
            }
          } else if (chaosRoll < 0.60) {
            // 503 outage burst
            c.proxy.setMode('503');
            void c.syncNow().catch(() => {});
            c.proxy.setMode('normal');
          } else if (chaosRoll < 0.85) {
            // Process restart
            await c.restart();
          } else {
            // In-flight sync
            if (c.isOnline()) {
              void c.syncNow().catch(() => {});
            }
          }
        }
      }

      // 3. Simulation Finished: Re-establish Network and Sync Until Idle
      counterA.goOnline();
      counterB.goOnline();
      counterA.proxy.setMode('normal');
      counterB.proxy.setMode('normal');
      counterA.proxy.setDropNextResponse(false);
      counterB.proxy.setDropNextResponse(false);
      counterA.proxy.setDropNextPushResponse(false);
      counterB.proxy.setDropNextPushResponse(false);

      // Convergence rounds: each counter syncs until idle, propagating purchases and sales to server and other counter
      for (let round = 1; round <= 6; round++) {
        await counterA.syncUntilIdle();
        await counterB.syncUntilIdle();
      }

      // 4. Assertions

      // (a) No outbox events left pending or in exceptions
      expect(countOutbox(counterA, 'pending')).toBe(0);
      expect(countOutbox(counterA, 'exception')).toBe(0);
      expect(countOutbox(counterB, 'pending')).toBe(0);
      expect(countOutbox(counterB, 'exception')).toBe(0);

      // (b) Server stock per batch equals the sum of all movements
      for (const batchId of allBatchIds) {
        const sStock = await serverStockForBatch(server, batchId);

        const sumRes = await server.runSql(
          'SELECT COALESCE(SUM(quantity_signed), 0) as total FROM stock_movements WHERE batch_id = $1',
          [batchId]
        );
        const expectedSum = Number(sumRes.rows[0]?.total ?? 0);
        expect(sStock).toBe(expectedSum);

        // (c) Server stock equals each counter's local stock per batch (after pull)
        const localStockA = localStockForBatch(counterA, batchId);
        const localStockB = localStockForBatch(counterB, batchId);

        expect(localStockA).toBe(sStock);
        expect(localStockB).toBe(sStock);
      }

      // (d) Invoice totals on the server equal local totals
      const serverInvoicesRes = await server.runSql(
        'SELECT id, invoice_number, total_paisa FROM invoices WHERE pharmacy_id = $1',
        [server.pharmacyId]
      );
      expect(serverInvoicesRes.rows.length).toBeGreaterThan(0);

      for (const sInv of serverInvoicesRes.rows) {
        const invId = String(sInv.id);
        const serverTotal = Number(sInv.total_paisa);

        // Find invoice on Counter A or Counter B
        const localInvA = counterA.db
          .prepare('SELECT total_paisa FROM invoices WHERE id = ?')
          .get(invId) as { total_paisa: number } | undefined;

        const localInvB = counterB.db
          .prepare('SELECT total_paisa FROM invoices WHERE id = ?')
          .get(invId) as { total_paisa: number } | undefined;

        const localTotal = localInvA?.total_paisa ?? localInvB?.total_paisa;
        expect(localTotal).toBeDefined();
        expect(serverTotal).toBe(localTotal);
      }
    },
    90000 // 90s timeout for full-day 600-op simulation
  );
});
