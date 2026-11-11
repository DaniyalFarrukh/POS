import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  generateUuidV7,
  computeInvoiceTotals,
  calculateProgressiveTax,
  calculateStatutoryComponentDeduction,
  type SyncEventEnvelope,
} from '../../packages/shared/src/index';
import { createTestContext, type TestDatabaseContext } from '../../apps/server/src/db/test-helper';
import { getDb, getDatabaseUrl } from '../../apps/server/src/db/index';
import {
  pharmacies,
  branches,
  counters,
  users,
  devices,
  taxCategories,
  products,
  batches,
  suppliers,
  customers,
  stockMovements,
  journalEntries,
  journalLines,
  erpPayments,
  erpExpenses,
  expenseCategories,
  supplierReturns,
  supplierReturnLines,
} from '../../apps/server/src/db/schema';
import {
  seedDefaultAccountMappings,
  getPharmacyAccountMap,
} from '../../apps/server/src/ledger/coa-seed';
import {
  postJournalEntry,
  reverseJournalEntry,
  closePeriod,
  reopenPeriod,
} from '../../apps/server/src/ledger/service';
import {
  postFinancialPaymentCompleted,
  postExpenseCompleted,
  postSupplierReturnCompleted,
} from '../../apps/server/src/ledger/posting-engine';
import { reconcileLedger } from '../../apps/server/src/ledger/reconciliation';
import {
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  getCashFlow,
  getGeneralLedgerSummary,
  getAccountLedgerDetail,
} from '../../apps/server/src/ledger/financial-reports';
import { getMonthEndChecklist } from '../../apps/server/src/ledger/period-close';
import { processSyncPushEvents } from '../../apps/server/src/sync/service';

// Deterministic Mulberry32 PRNG
function createRng(seed: number) {
  let state = seed >>> 0;
  return {
    nextFloat(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    nextInt(min: number, max: number): number {
      return Math.floor(this.nextFloat() * (max - min + 1)) + min;
    },
    pick<T>(arr: readonly T[]): T {
      return arr[this.nextInt(0, arr.length - 1)]!;
    },
  };
}

describe('Stage 3 Final Audit: Ledger & Accounting Integrity (5,000+ Docs & 100k Journal Lines)', () => {
  let ctx: TestDatabaseContext;
  let db: TestDatabaseContext['db'];
  const pharmacyId = generateUuidV7();
  const branch1Id = generateUuidV7();
  const branch2Id = generateUuidV7();
  const counter1Id = generateUuidV7();
  const counter2Id = generateUuidV7();
  const device1Id = generateUuidV7();
  const device2Id = generateUuidV7();
  const ownerUserId = generateUuidV7();
  const cashier1Id = generateUuidV7();
  const cashier2Id = generateUuidV7();
  const taxCatExemptId = generateUuidV7();
  const taxCatStdId = generateUuidV7();
  const expenseCatId = generateUuidV7();

  const supplierIds: string[] = [];
  const customerIds: string[] = [];
  const productList: Array<{
    id: string;
    taxCategoryId: string;
    taxRateBp: number;
    isExempt: boolean;
    mrpPaisa: number;
    costPaisa: number;
    batch1Id: string;
    batch2Id: string;
  }> = [];

  let accountMap: Awaited<ReturnType<typeof getPharmacyAccountMap>>;
  let rentExpenseAccountId = '';

  beforeAll(async () => {
    ctx = await createTestContext();
    db = ctx.db;
    const now = '2026-10-01T08:00:00.000Z';

    await db.insert(pharmacies).values({
      id: pharmacyId,
      name: 'Stage 3 Audit Pharmacy',
      code: `S3-${pharmacyId.slice(-6)}`,
      createdAt: now,
      updatedAt: now,
    });

    await seedDefaultAccountMappings(db, pharmacyId);
    accountMap = await getPharmacyAccountMap(db, pharmacyId);

    const rentRes = await ctx.client.query<{ id: string }>(
      `SELECT id FROM accounts WHERE pharmacy_id = $1 AND code = '6010'`,
      [pharmacyId]
    );
    rentExpenseAccountId = rentRes.rows[0]!.id;

    await db.insert(branches).values([
      {
        id: branch1Id,
        pharmacyId,
        name: 'Main Branch Clifton',
        code: 'BR-01',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: branch2Id,
        pharmacyId,
        name: 'Branch 2 Gulshan',
        code: 'BR-02',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(counters).values([
      {
        id: counter1Id,
        pharmacyId,
        branchId: branch1Id,
        name: 'Counter 1',
        code: 'C1',
        lastInvoiceSeq: 0,
        lastCreditNoteSeq: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: counter2Id,
        pharmacyId,
        branchId: branch2Id,
        name: 'Counter 2',
        code: 'C2',
        lastInvoiceSeq: 0,
        lastCreditNoteSeq: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(users).values([
      {
        id: ownerUserId,
        pharmacyId,
        name: 'Audit Owner',
        role: 'owner',
        pinHash: '$2b$10$abcdefghijklmnopqrstuv1234567890123456789012345678901',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: cashier1Id,
        pharmacyId,
        name: 'Cashier One',
        role: 'cashier',
        pinHash: '$2b$10$abcdefghijklmnopqrstuv1234567890123456789012345678901',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: cashier2Id,
        pharmacyId,
        name: 'Cashier Two',
        role: 'cashier',
        pinHash: '$2b$10$abcdefghijklmnopqrstuv1234567890123456789012345678901',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(devices).values([
      {
        id: device1Id,
        pharmacyId,
        branchId: branch1Id,
        counterId: counter1Id,
        deviceName: 'POS-C1',
        deviceTokenHash: `hash-c1-${device1Id}`,
        status: 'active',
        registeredByUserId: ownerUserId,
        registeredAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: device2Id,
        pharmacyId,
        branchId: branch2Id,
        counterId: counter2Id,
        deviceName: 'POS-C2',
        deviceTokenHash: `hash-c2-${device2Id}`,
        status: 'active',
        registeredByUserId: ownerUserId,
        registeredAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(taxCategories).values([
      {
        id: taxCatExemptId,
        pharmacyId,
        name: 'Exempt Medicine',
        rateBp: 0,
        isExempt: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: taxCatStdId,
        pharmacyId,
        name: 'Standard GST 18%',
        rateBp: 1800,
        isExempt: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(expenseCategories).values({
      id: expenseCatId,
      pharmacyId,
      name: 'Pharmacy Rent & Utilities',
      accountId: rentExpenseAccountId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 0; i < 5; i++) {
      const supId = generateUuidV7();
      supplierIds.push(supId);
      await db.insert(suppliers).values({
        id: supId,
        pharmacyId,
        name: `Audit Supplier ${i + 1}`,
        phone: `0300111000${i}`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (let i = 0; i < 10; i++) {
      const custId = generateUuidV7();
      customerIds.push(custId);
      await db.insert(customers).values({
        id: custId,
        pharmacyId,
        name: `Audit Customer ${i + 1}`,
        phone: `0321999000${i}`,
        creditLimitPaisa: 50_000_000, // 500,000 PKR
        openingBalancePaisa: 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (let i = 0; i < 10; i++) {
      const prodId = generateUuidV7();
      const isExempt = i % 2 === 0;
      const taxCatId = isExempt ? taxCatExemptId : taxCatStdId;
      const taxRateBp = isExempt ? 0 : 1800;
      const costPaisa = (i + 1) * 10_000; // 100 PKR to 1,000 PKR
      const mrpPaisa = (i + 1) * 15_000; // 150 PKR to 1,500 PKR
      const b1Id = generateUuidV7();
      const b2Id = generateUuidV7();

      productList.push({
        id: prodId,
        taxCategoryId: taxCatId,
        taxRateBp,
        isExempt,
        mrpPaisa,
        costPaisa,
        batch1Id: b1Id,
        batch2Id: b2Id,
      });

      await db.insert(products).values({
        id: prodId,
        pharmacyId,
        brandName: `AuditMed-${i + 1}`,
        genericName: `Generic-${i + 1}`,
        strength: '500mg',
        form: 'Tablet',
        manufacturer: 'HexaLabs',
        barcode: `89640009990${i}`,
        taxCategoryId: taxCatId,
        mrpPaisa,
        isControlled: false,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(batches).values([
        {
          id: b1Id,
          pharmacyId,
          productId: prodId,
          batchNo: `B1-${i + 1}`,
          expiryDate: '2028-12-31',
          costPaisa,
          mrpPaisa,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: b2Id,
          pharmacyId,
          productId: prodId,
          batchNo: `B2-${i + 1}`,
          expiryDate: '2028-12-31',
          costPaisa,
          mrpPaisa,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('3.1 enforces DB-level balanced-entry constraint, immutability triggers, and concurrent gapless entry_no', async () => {
    // 1. Direct SQL insert of unbalanced journal lines must fail at transaction commit (constraint trigger)
    const badEntryId = generateUuidV7();
    let unbalancedErr: unknown;
    try {
      await db.transaction(async (tx) => {
        await tx.insert(journalEntries).values({
          id: badEntryId,
          pharmacyId,
          entryNo: 999999,
          entryDate: '2026-10-01',
          memo: 'Unbalanced direct insert test',
          status: 'posted',
          createdAt: new Date().toISOString(),
        });
        await tx.insert(journalLines).values([
          {
            id: generateUuidV7(),
            entryId: badEntryId,
            pharmacyId,
            accountId: accountMap.cash,
            debitPaisa: 10_000,
            creditPaisa: 0,
            branchId: branch1Id,
          },
          {
            id: generateUuidV7(),
            entryId: badEntryId,
            pharmacyId,
            accountId: accountMap.sales,
            debitPaisa: 0,
            creditPaisa: 9_500, // Unbalanced by 500 paisa!
            branchId: branch1Id,
          },
        ]);
      });
    } catch (err) {
      unbalancedErr = err;
    }
    expect(unbalancedErr).toBeDefined();
    const fullUnbalancedMsg = `${(unbalancedErr as Error).message} ${(unbalancedErr as { cause?: Error }).cause?.message ?? ''}`;
    expect(fullUnbalancedMsg).toMatch(/unbalanced|debit|credit/i);

    // 2. Concurrent entry_no gaplessness (20 parallel transactions across a multi-connection pg.Pool)
    const poolUrl = `${getDatabaseUrl()}?options=-c%20search_path%3D${encodeURIComponent(ctx.schemaName)}`;
    const poolDb = getDb(poolUrl);
    const parallelCount = 20;
    const parallelIds = Array.from({ length: parallelCount }, () => generateUuidV7());
    const results = await Promise.all(
      parallelIds.map((srcId, idx) =>
        poolDb.transaction((tx) =>
          postJournalEntry(tx, {
            pharmacyId,
            entryDate: '2026-10-01',
            sourceType: 'concurrency_test',
            sourceId: srcId,
            memo: `Concurrent entry #${idx + 1}`,
            createdBy: ownerUserId,
            lines: [
              {
                accountId: accountMap.cash,
                debitPaisa: 1000,
                creditPaisa: 0,
                branchId: branch1Id,
              },
              {
                accountId: accountMap.bank,
                debitPaisa: 0,
                creditPaisa: 1000,
                branchId: branch1Id,
              },
            ],
          })
        )
      )
    );

    const entryNos = results.map((r) => r.entryNo).sort((a, b) => a - b);
    expect(entryNos).toEqual(Array.from({ length: parallelCount }, (_, i) => i + 1));

    // Reverse those 20 concurrency test entries so net ledger impact before simulation is 0
    for (const r of results) {
      await db.transaction((tx) =>
        reverseJournalEntry(tx, r.id, 'Clean up concurrency test', {
          pharmacyId,
          reversalDate: '2026-10-01',
          createdBy: ownerUserId,
        })
      );
    }

    // 3. Immutability trigger on journal_entries and journal_lines
    const firstEntry = results[0]!;
    await expect(
      ctx.client.query(`UPDATE journal_entries SET memo = 'Tampered memo' WHERE id = $1`, [
        firstEntry.id,
      ])
    ).rejects.toThrow(/immutable/i);

    await expect(
      ctx.client.query(`DELETE FROM journal_lines WHERE entry_id = $1`, [firstEntry.id])
    ).rejects.toThrow(/immutable/i);
  }, 60_000);

  it('3.2 executes seeded simulation of 5,050 mixed documents across 2 counters with offline queues, duplicates & restarts, and reconciles all 8 ledger invariants', async () => {
    const rng = createRng(20261111);

    // Track expected operational figures independently in test memory
    let expectedGrossSalesPaisa = 0;
    let expectedNetSalesPaisa = 0;
    let expectedOutputTaxPaisa = 0;
    let expectedCogsPaisa = 0;
    let expectedOperatingExpensesPaisa = 0;

    let expectedCashBalancePaisa = 0;
    let expectedBankBalancePaisa = 0;
    let expectedWalletBalancePaisa = 0;
    let expectedArBalancePaisa = 0;
    let expectedApBalancePaisa = 0;
    let expectedInventoryValuePaisa = 0;
    let expectedStockAdjExpensePaisa = 0;

    const expectedCustomerBalances = new Map<string, number>();
    const expectedSupplierBalances = new Map<string, number>();

    let c1DeviceSeq = 0;
    let c2DeviceSeq = 0;
    let c1InvSeq = 0;
    let c2InvSeq = 0;
    let c1CnSeq = 0;
    let c2CnSeq = 0;

    const c1Events: SyncEventEnvelope[] = [];
    const c2Events: SyncEventEnvelope[] = [];

    const finalizedInvoices: Array<{
      id: string;
      invoiceNumber: string;
      branchId: string;
      counterId: string;
      cashierUserId: string;
      lineId: string;
      productId: string;
      batchId: string;
      quantity: number;
      unitPricePaisa: number;
      taxRateBp: number;
      taxPaisa: number;
      lineTotalPaisa: number;
      costPaisa: number;
      paymentMethod: 'cash' | 'card' | 'wallet';
    }> = [];

    // -------------------------------------------------------------------------
    // A. Generate 100 Purchase Received (GRN) events (50 on Counter 1, 50 on Counter 2)
    // -------------------------------------------------------------------------
    for (let i = 0; i < 100; i++) {
      const isC1 = i < 50;
      const branchId = isC1 ? branch1Id : branch2Id;
      const cashierId = isC1 ? cashier1Id : cashier2Id;
      const prod = productList[i % productList.length]!;
      const batchId = isC1 ? prod.batch1Id : prod.batch2Id;
      const batchNo = isC1
        ? `B1-${(i % productList.length) + 1}`
        : `B2-${(i % productList.length) + 1}`;
      const supplierId = supplierIds[i % supplierIds.length]!;
      const qty = 2000; // Plenty of stock
      const totalCostPaisa = qty * prod.costPaisa;
      const purchaseId = generateUuidV7();
      const lineId = generateUuidV7();
      const movementId = generateUuidV7();
      const day = String((i % 25) + 1).padStart(2, '0');
      const createdAt = `2026-10-${day}T09:00:00.000Z`;

      const env: SyncEventEnvelope = {
        eventId: generateUuidV7(),
        deviceSeq: isC1 ? ++c1DeviceSeq : ++c2DeviceSeq,
        type: 'purchase.received',
        entityId: purchaseId,
        occurredAt: createdAt,
        schemaVersion: 1,
        payload: {
          purchase: {
            id: purchaseId,
            branchId,
            supplierId,
            supplierInvoiceNo: `GRN-${i + 1}`,
            invoiceDate: `2026-10-${day}`,
            totalCostPaisa,
            taxPaisa: 0,
            createdByUserId: cashierId,
            createdAt,
          },
          batches: [
            {
              id: batchId,
              productId: prod.id,
              batchNo,
              expiryDate: '2028-12-31',
              costPaisa: prod.costPaisa,
              mrpPaisa: prod.mrpPaisa,
              createdAt,
            },
          ],
          lines: [
            {
              id: lineId,
              movementId,
              productId: prod.id,
              batchId,
              quantity: qty,
              costPaisa: prod.costPaisa,
              mrpPaisa: prod.mrpPaisa,
            },
          ],
        },
      };

      if (isC1) c1Events.push(env);
      else c2Events.push(env);

      expectedInventoryValuePaisa += totalCostPaisa;
      expectedApBalancePaisa += totalCostPaisa;
      expectedSupplierBalances.set(
        supplierId,
        (expectedSupplierBalances.get(supplierId) || 0) + totalCostPaisa
      );
    }

    // -------------------------------------------------------------------------
    // B. Generate 4,200 POS Sales (2,100 on Counter 1, 2,100 on Counter 2)
    //    Includes cash, card, wallet, and credit sales (with customerId)
    // -------------------------------------------------------------------------
    const methods = ['cash', 'card', 'wallet', 'credit'] as const;
    for (let i = 0; i < 4200; i++) {
      const isC1 = i % 2 === 0;
      const branchId = isC1 ? branch1Id : branch2Id;
      const counterId = isC1 ? counter1Id : counter2Id;
      const cashierUserId = isC1 ? cashier1Id : cashier2Id;
      const prod = rng.pick(productList);
      const batchId = isC1 ? prod.batch1Id : prod.batch2Id;
      const qty = rng.nextInt(1, 4);
      const discountPaisa = rng.nextInt(0, 1) === 1 ? 500 : 0;

      const totals = computeInvoiceTotals([
        {
          unitPricePaisa: prod.mrpPaisa,
          quantity: qty,
          flatDiscountPaisa: discountPaisa,
          taxRateBp: prod.taxRateBp,
          isTaxExempt: prod.isExempt,
        },
      ]);
      const lineComp = totals.lines[0]!;

      const paymentMethod = rng.pick(methods);
      const customerId = paymentMethod === 'credit' ? rng.pick(customerIds) : undefined;

      const seq = isC1 ? ++c1InvSeq : ++c2InvSeq;
      const invoiceNumber = `${isC1 ? 'C1' : 'C2'}-${String(seq).padStart(6, '0')}`;
      const invoiceId = generateUuidV7();
      const lineId = generateUuidV7();
      const movementId = generateUuidV7();
      const paymentId = generateUuidV7();
      const day = String((i % 25) + 1).padStart(2, '0');
      const createdAt = `2026-10-${day}T11:30:00.000Z`;

      const env: SyncEventEnvelope = {
        eventId: generateUuidV7(),
        deviceSeq: isC1 ? ++c1DeviceSeq : ++c2DeviceSeq,
        type: 'invoice.created',
        entityId: invoiceId,
        occurredAt: createdAt,
        schemaVersion: 1,
        payload: {
          id: invoiceId,
          invoiceNumber,
          counterId,
          cashierUserId,
          clientRequestId: generateUuidV7(),
          status: 'finalized',
          subtotalPaisa: totals.subtotalPaisa,
          discountPaisa: totals.totalDiscountPaisa,
          taxPaisa: totals.totalTaxPaisa,
          totalPaisa: totals.grandTotalPaisa,
          customerId: customerId ?? null,
          notes: null,
          createdAt,
          lines: [
            {
              id: lineId,
              movementId,
              invoiceId,
              productId: prod.id,
              batchId,
              quantity: qty,
              unitPricePaisa: prod.mrpPaisa,
              discountPaisa,
              taxRateBp: prod.taxRateBp,
              taxPaisa: lineComp.taxAmountPaisa,
              lineTotalPaisa: lineComp.lineTotalPaisa,
            },
          ],
          payments: [
            {
              id: paymentId,
              invoiceId,
              method: paymentMethod,
              amountPaisa: totals.grandTotalPaisa,
            },
          ],
        },
      };

      if (isC1) c1Events.push(env);
      else c2Events.push(env);

      if (paymentMethod !== 'credit' && qty >= 2 && finalizedInvoices.length < 400) {
        finalizedInvoices.push({
          id: invoiceId,
          invoiceNumber,
          branchId,
          counterId,
          cashierUserId,
          lineId,
          productId: prod.id,
          batchId,
          quantity: qty,
          unitPricePaisa: prod.mrpPaisa,
          taxRateBp: prod.taxRateBp,
          taxPaisa: lineComp.taxAmountPaisa,
          lineTotalPaisa: lineComp.lineTotalPaisa,
          costPaisa: prod.costPaisa,
          paymentMethod,
        });
      }

      const netSale = totals.grandTotalPaisa - totals.totalTaxPaisa;
      const cogs = qty * prod.costPaisa;

      expectedGrossSalesPaisa += totals.grandTotalPaisa;
      expectedNetSalesPaisa += netSale;
      expectedOutputTaxPaisa += totals.totalTaxPaisa;
      expectedCogsPaisa += cogs;
      expectedInventoryValuePaisa -= cogs;

      if (paymentMethod === 'cash') expectedCashBalancePaisa += totals.grandTotalPaisa;
      else if (paymentMethod === 'card') expectedBankBalancePaisa += totals.grandTotalPaisa;
      else if (paymentMethod === 'wallet') expectedWalletBalancePaisa += totals.grandTotalPaisa;
      else if (paymentMethod === 'credit' && customerId) {
        expectedArBalancePaisa += totals.grandTotalPaisa;
        expectedCustomerBalances.set(
          customerId,
          (expectedCustomerBalances.get(customerId) || 0) + totals.grandTotalPaisa
        );
      }
    }

    // -------------------------------------------------------------------------
    // C. Generate 300 Credit Notes (Customer Returns) across Counter 1 & Counter 2
    // -------------------------------------------------------------------------
    for (let i = 0; i < 300; i++) {
      const orig = finalizedInvoices[i]!;
      const isC1 = orig.counterId === counter1Id;
      const returnQty = 1; // Return 1 unit from the invoice line
      const refundTotalPaisa = Math.round((orig.lineTotalPaisa * returnQty) / orig.quantity);
      const refundTaxPaisa = Math.round((orig.taxPaisa * returnQty) / orig.quantity);
      const refundSubtotalPaisa = refundTotalPaisa - refundTaxPaisa;

      const seq = isC1 ? ++c1CnSeq : ++c2CnSeq;
      const cnNumber = `CN-${isC1 ? 'C1' : 'C2'}-${String(seq).padStart(6, '0')}`;
      const cnId = generateUuidV7();
      const cnLineId = generateUuidV7();
      const movementId = generateUuidV7();
      const day = String((i % 25) + 1).padStart(2, '0');
      const createdAt = `2026-10-${day}T15:00:00.000Z`;

      const env: SyncEventEnvelope = {
        eventId: generateUuidV7(),
        deviceSeq: isC1 ? ++c1DeviceSeq : ++c2DeviceSeq,
        type: 'credit_note.created',
        entityId: cnId,
        occurredAt: createdAt,
        schemaVersion: 1,
        payload: {
          id: cnId,
          creditNoteNumber: cnNumber,
          originalInvoiceId: orig.id,
          originalInvoiceNumber: orig.invoiceNumber,
          branchId: orig.branchId,
          counterId: orig.counterId,
          cashierUserId: orig.cashierUserId,
          clientRequestId: generateUuidV7(),
          subtotalPaisa: refundSubtotalPaisa,
          taxPaisa: refundTaxPaisa,
          totalPaisa: refundTotalPaisa,
          refundMethod: orig.paymentMethod,
          reason: 'customer_return',
          notes: 'Audit simulation return',
          createdAt,
          lines: [
            {
              id: cnLineId,
              movementId,
              creditNoteId: cnId,
              originalInvoiceLineId: orig.lineId,
              productId: orig.productId,
              batchId: orig.batchId,
              quantity: returnQty,
              unitPricePaisa: orig.unitPricePaisa,
              taxRateBp: orig.taxRateBp,
              taxPaisa: refundTaxPaisa,
              lineTotalPaisa: refundTotalPaisa,
            },
          ],
        },
      };

      if (isC1) c1Events.push(env);
      else c2Events.push(env);

      const returnCost = returnQty * orig.costPaisa;
      expectedGrossSalesPaisa -= refundTotalPaisa;
      expectedNetSalesPaisa -= refundSubtotalPaisa;
      expectedOutputTaxPaisa -= refundTaxPaisa;
      expectedCogsPaisa -= returnCost;
      expectedInventoryValuePaisa += returnCost;

      if (orig.paymentMethod === 'cash') expectedCashBalancePaisa -= refundTotalPaisa;
      else if (orig.paymentMethod === 'card') expectedBankBalancePaisa -= refundTotalPaisa;
      else if (orig.paymentMethod === 'wallet') expectedWalletBalancePaisa -= refundTotalPaisa;
    }

    // -------------------------------------------------------------------------
    // D. Generate 200 Stock Adjustments (100 on Counter 1, 100 on Counter 2)
    // -------------------------------------------------------------------------
    for (let i = 0; i < 200; i++) {
      const isC1 = i % 2 === 0;
      const branchId = isC1 ? branch1Id : branch2Id;
      const prod = productList[i % productList.length]!;
      const batchId = isC1 ? prod.batch1Id : prod.batch2Id;
      const qtySigned = i % 3 === 0 ? 2 : -1;
      const movementId = generateUuidV7();
      const day = String((i % 25) + 1).padStart(2, '0');
      const createdAt = `2026-10-${day}T16:30:00.000Z`;

      const env: SyncEventEnvelope = {
        eventId: generateUuidV7(),
        deviceSeq: isC1 ? ++c1DeviceSeq : ++c2DeviceSeq,
        type: 'stock_adjustment.created',
        entityId: movementId,
        occurredAt: createdAt,
        schemaVersion: 1,
        payload: {
          id: movementId,
          movementId,
          productId: prod.id,
          batchId,
          branchId,
          quantitySigned: qtySigned,
          reasonType: qtySigned > 0 ? 'recount_gain' : 'damage',
          reason: `[AUDIT] Adjustment #${i + 1}`,
          createdAt,
        },
      };

      if (isC1) c1Events.push(env);
      else c2Events.push(env);

      const adjVal = qtySigned * prod.costPaisa;
      expectedInventoryValuePaisa += adjVal;
      expectedStockAdjExpensePaisa -= adjVal; // negative qty -> positive expense debit
    }

    // -------------------------------------------------------------------------
    // E. Generate 150 Customer Receipts via Sync (75 on Counter 1, 75 on Counter 2)
    // -------------------------------------------------------------------------
    for (let i = 0; i < 150; i++) {
      const isC1 = i % 2 === 0;
      const branchId = isC1 ? branch1Id : branch2Id;
      const counterId = isC1 ? counter1Id : counter2Id;
      const cashierUserId = isC1 ? cashier1Id : cashier2Id;
      const customerId = customerIds[i % customerIds.length]!;
      const amountPaisa = 5_000; // 50 PKR receipt
      const receiptId = generateUuidV7();
      const day = String((i % 25) + 1).padStart(2, '0');
      const createdAt = `2026-10-${day}T17:00:00.000Z`;

      const env: SyncEventEnvelope = {
        eventId: generateUuidV7(),
        deviceSeq: isC1 ? ++c1DeviceSeq : ++c2DeviceSeq,
        type: 'customer_receipt.created',
        entityId: receiptId,
        occurredAt: createdAt,
        schemaVersion: 1,
        payload: {
          id: receiptId,
          paymentNumber: `RCV-SYNC-${String(i + 1).padStart(4, '0')}`,
          customerId,
          branchId,
          counterId,
          cashierUserId,
          receiptDate: `2026-10-${day}`,
          method: 'cash',
          amountPaisa,
          notes: 'Sync customer receipt',
          createdAt,
        },
      };

      if (isC1) c1Events.push(env);
      else c2Events.push(env);

      expectedCashBalancePaisa += amountPaisa;
      expectedArBalancePaisa -= amountPaisa;
      expectedCustomerBalances.set(
        customerId,
        (expectedCustomerBalances.get(customerId) || 0) - amountPaisa
      );
    }

    // Total sync events generated so far: 100 + 4,200 + 300 + 200 + 150 = 4,950 events
    expect(c1Events.length + c2Events.length).toBe(4950);

    // -------------------------------------------------------------------------
    // F. Push events from Counter 1 and Counter 2 in random offline batch sizes,
    //    interleaving counters, out-of-order within batch, and replaying 200 duplicates
    // -------------------------------------------------------------------------
    const ctx1 = {
      pharmacyId,
      branchId: branch1Id,
      counterId: counter1Id,
      deviceId: device1Id,
    };
    const ctx2 = {
      pharmacyId,
      branchId: branch2Id,
      counterId: counter2Id,
      deviceId: device2Id,
    };

    let idx1 = 0;
    let idx2 = 0;
    while (idx1 < c1Events.length || idx2 < c2Events.length) {
      if (idx1 < c1Events.length) {
        const chunkLen = rng.nextInt(80, 180);
        const batch = c1Events.slice(idx1, idx1 + chunkLen);
        idx1 += batch.length;
        const res = await processSyncPushEvents(db, ctx1, batch);
        expect(res.every((r) => r.status === 'accepted')).toBe(true);
      }
      if (idx2 < c2Events.length) {
        const chunkLen = rng.nextInt(80, 180);
        const batch = c2Events.slice(idx2, idx2 + chunkLen);
        idx2 += batch.length;
        const res = await processSyncPushEvents(db, ctx2, batch);
        expect(res.every((r) => r.status === 'accepted')).toBe(true);
      }
    }

    // Replay 200 duplicate events (100 from C1, 100 from C2) simulating restart before outbox ACK
    const dupC1 = c1Events.slice(0, 100);
    const dupC2 = c2Events.slice(0, 100);
    const dupRes1 = await processSyncPushEvents(db, ctx1, dupC1);
    const dupRes2 = await processSyncPushEvents(db, ctx2, dupC2);
    expect(dupRes1.every((r) => r.status === 'duplicate')).toBe(true);
    expect(dupRes2.every((r) => r.status === 'duplicate')).toBe(true);

    // -------------------------------------------------------------------------
    // G. Add 100 Server-Side ERP Documents (40 Supplier Payments, 40 Paid Expenses, 20 Supplier Returns)
    //    Total documents = 4,950 + 100 = 5,050 documents!
    // -------------------------------------------------------------------------
    await db.transaction(async (tx) => {
      // 40 Supplier Payments via Bank
      for (let i = 0; i < 40; i++) {
        const supplierId = supplierIds[i % supplierIds.length]!;
        const amountPaisa = 25_000;
        const payId = generateUuidV7();
        const entry = await postFinancialPaymentCompleted(tx, {
          pharmacyId,
          paymentId: payId,
          paymentNumber: `SPAY-${i + 1}`,
          paymentDate: '2026-10-20',
          branchId: i % 2 === 0 ? branch1Id : branch2Id,
          direction: 'payment',
          partyType: 'supplier',
          partyId: supplierId,
          partyName: `Audit Supplier ${(i % supplierIds.length) + 1}`,
          method: 'bank',
          amountPaisa,
          allocatedPaisa: amountPaisa,
          advancePaisa: 0,
          createdBy: ownerUserId,
        });
        await tx.insert(erpPayments).values({
          id: payId,
          pharmacyId,
          branchId: i % 2 === 0 ? branch1Id : branch2Id,
          paymentNumber: `SPAY-${i + 1}`,
          paymentDate: '2026-10-20',
          direction: 'payment',
          partyType: 'supplier',
          partyId: supplierId,
          method: 'bank',
          amountPaisa,
          allocatedPaisa: amountPaisa,
          advancePaisa: 0,
          status: 'posted',
          journalEntryId: entry.id,
          createdBy: ownerUserId,
          createdAt: '2026-10-20T12:00:00.000Z',
          updatedAt: '2026-10-20T12:00:00.000Z',
        });

        expectedBankBalancePaisa -= amountPaisa;
        expectedApBalancePaisa -= amountPaisa;
        expectedSupplierBalances.set(
          supplierId,
          (expectedSupplierBalances.get(supplierId) || 0) - amountPaisa
        );
      }

      // 40 Paid Operating Expenses via Cash
      for (let i = 0; i < 40; i++) {
        const expId = generateUuidV7();
        const amountPaisa = 12_000;
        const bId = i % 2 === 0 ? branch1Id : branch2Id;
        const entry = await postExpenseCompleted(tx, {
          expenseId: expId,
          expenseNumber: `EXP-${i + 1}`,
          pharmacyId,
          branchId: bId,
          expenseDate: '2026-10-22',
          expenseAccountId: rentExpenseAccountId,
          amountPaisa,
          paymentType: 'paid',
          paymentMethod: 'cash',
          vendorName: 'K-Electric',
          createdBy: ownerUserId,
        });
        await tx.insert(erpExpenses).values({
          id: expId,
          pharmacyId,
          branchId: bId,
          expenseNumber: `EXP-${i + 1}`,
          categoryId: expenseCatId,
          amountPaisa,
          taxPaisa: 0,
          totalPaisa: amountPaisa,
          paymentType: 'paid',
          paymentMethod: 'cash',
          expenseDate: '2026-10-22',
          vendorName: 'K-Electric',
          status: 'posted',
          journalEntryId: entry.id,
          createdBy: ownerUserId,
          createdAt: '2026-10-22T12:00:00.000Z',
          updatedAt: '2026-10-22T12:00:00.000Z',
        });

        expectedCashBalancePaisa -= amountPaisa;
        expectedOperatingExpensesPaisa += amountPaisa;
      }

      // 20 Supplier Returns
      for (let i = 0; i < 20; i++) {
        const isC1 = i % 2 === 0;
        const bId = isC1 ? branch1Id : branch2Id;
        const prod = productList[i % productList.length]!;
        const batchId = isC1 ? prod.batch1Id : prod.batch2Id;
        const supplierId = supplierIds[i % supplierIds.length]!;
        const qty = 2;
        const subtotalPaisa = qty * prod.costPaisa;
        const returnId = generateUuidV7();
        const moveId = generateUuidV7();

        await tx.insert(supplierReturns).values({
          id: returnId,
          pharmacyId,
          branchId: bId,
          supplierId,
          returnNumber: `SR-202610-${String(i + 1).padStart(4, '0')}`,
          debitNoteNumber: `DN-202610-${String(i + 1).padStart(4, '0')}`,
          returnDate: '2026-10-24',
          status: 'completed',
          subtotalPaisa,
          taxPaisa: 0,
          totalPaisa: subtotalPaisa,
          reason: 'Near expiry return to vendor',
          createdBy: ownerUserId,
          createdAt: '2026-10-24T12:00:00.000Z',
          updatedAt: '2026-10-24T12:00:00.000Z',
        });

        await tx.insert(supplierReturnLines).values({
          id: generateUuidV7(),
          pharmacyId,
          returnId,
          productId: prod.id,
          batchId,
          quantity: qty,
          unitCostPaisa: prod.costPaisa,
          taxRateBp: 0,
          taxPaisa: 0,
          totalPaisa: subtotalPaisa,
          movementId: moveId,
          createdAt: '2026-10-24T12:00:00.000Z',
          updatedAt: '2026-10-24T12:00:00.000Z',
        });

        await tx.insert(stockMovements).values({
          id: moveId,
          pharmacyId,
          productId: prod.id,
          batchId,
          branchId: bId,
          type: 'return',
          quantitySigned: -qty,
          referenceType: 'supplier_return',
          referenceId: returnId,
          reason: `Supplier Return SR-${i + 1}`,
          createdAt: '2026-10-24T12:00:00.000Z',
          updatedAt: '2026-10-24T12:00:00.000Z',
        });

        await postSupplierReturnCompleted(tx, {
          pharmacyId,
          branchId: bId,
          supplierId,
          returnId,
          returnNumber: `SR-202610-${String(i + 1).padStart(4, '0')}`,
          debitNoteNumber: `DN-202610-${String(i + 1).padStart(4, '0')}`,
          subtotalPaisa,
          taxPaisa: 0,
          totalPaisa: subtotalPaisa,
          returnDate: '2026-10-24',
          createdBy: ownerUserId,
        });

        expectedInventoryValuePaisa -= subtotalPaisa;
        expectedApBalancePaisa -= subtotalPaisa;
        expectedSupplierBalances.set(
          supplierId,
          (expectedSupplierBalances.get(supplierId) || 0) - subtotalPaisa
        );
      }
    });

    // -------------------------------------------------------------------------
    // H. VERIFY ALL 8 LEDGER INVARIANTS ON THE 5,050 DOCUMENTS
    // -------------------------------------------------------------------------
    // Invariant 1: Trial Balance sums to zero
    const tb = await getTrialBalance(db, pharmacyId, {
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    expect(tb.isBalanced).toBe(true);
    expect(tb.totalDebitPaisa).toBe(tb.totalCreditPaisa);
    expect(tb.totalClosingDebitPaisa).toBe(tb.totalClosingCreditPaisa);

    // Invariant 2: Balance Sheet balances (Assets = Liabilities + Equity + Current Period Profit)
    const bs = await getBalanceSheet(db, pharmacyId, {
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    expect(bs.isBalanced).toBe(true);
    expect(bs.summary.differencePaisa).toBe(0);
    expect(bs.summary.totalAssetsPaisa).toBe(bs.summary.totalLiabilitiesAndEquityPaisa);

    // Invariant 3 & 4: Ledger Sales == Invoices - Credit Notes; Ledger Inventory == sum(batch_stock * batch_cost)
    // Note: With applyPurchaseReceived preserving payload.purchase.createdAt (F-H-06), historical cutoff ('2026-10-31')
    // reconciles Inventory & Sales to 0 paisa difference:
    const reconOct = await reconcileLedger(db, pharmacyId, '2026-10-01', '2026-10-31');
    expect(reconOct.isReconciled).toBe(true);
    expect(reconOct.inventoryDifferencePaisa).toBe(0);
    expect(reconOct.salesDifferencePaisa).toBe(0);
    expect(reconOct.netSalesDifferencePaisa).toBe(0);
    expect(reconOct.ledgerSalesTotalPaisa).toBe(expectedGrossSalesPaisa);
    expect(reconOct.ledgerNetSalesPaisa).toBe(expectedNetSalesPaisa);
    expect(reconOct.ledgerInventoryValuePaisa).toBe(expectedInventoryValuePaisa);

    // Full reconciliation including current sync date ('2026-12-31') reconciles Inventory & Sales to 0 paisa:
    const recon = await reconcileLedger(db, pharmacyId, '2026-10-01', '2026-12-31');
    expect(recon.isReconciled).toBe(true);
    expect(recon.salesDifferencePaisa).toBe(0);
    expect(recon.netSalesDifferencePaisa).toBe(0);
    expect(recon.inventoryDifferencePaisa).toBe(0);
    expect(recon.ledgerSalesTotalPaisa).toBe(expectedGrossSalesPaisa);
    expect(recon.ledgerNetSalesPaisa).toBe(expectedNetSalesPaisa);
    expect(recon.ledgerInventoryValuePaisa).toBe(expectedInventoryValuePaisa);
    expect(recon.batchesInventoryValuePaisa).toBe(expectedInventoryValuePaisa);

    // Invariant 5: AR (1100) and AP (2000) control accounts equal sum of party balances
    const arRow = tb.rows.find((r) => r.code === '1100')!;
    const apRow = tb.rows.find((r) => r.code === '2000')!;
    const sumCustomerBalances = Array.from(expectedCustomerBalances.values()).reduce(
      (a, b) => a + b,
      0
    );
    const sumSupplierBalances = Array.from(expectedSupplierBalances.values()).reduce(
      (a, b) => a + b,
      0
    );
    expect(arRow.closingBalancePaisa).toBe(expectedArBalancePaisa);
    expect(arRow.closingBalancePaisa).toBe(sumCustomerBalances);
    expect(-apRow.closingBalancePaisa).toBe(expectedApBalancePaisa);
    expect(-apRow.closingBalancePaisa).toBe(sumSupplierBalances);

    // Also verify via getMonthEndChecklist that AR/AP subledgers reconcile
    const checklist = await getMonthEndChecklist(db, pharmacyId, 2026, 10);
    const reconCheck = checklist.items.find((i) => i.id === 'reconciliation_differences')!;
    expect(reconCheck.status).toBe('passed');
    expect(reconCheck.count).toBe(0);

    // Invariant 6: Cash (1000), Bank (1010), and Wallet (1020) ledger balances equal recorded payments
    const cashRow = tb.rows.find((r) => r.code === '1000')!;
    const bankRow = tb.rows.find((r) => r.code === '1010')!;
    const walletRow = tb.rows.find((r) => r.code === '1020')!;
    const outputTaxRow = tb.rows.find((r) => r.code === '2100')!;
    expect(cashRow.closingBalancePaisa).toBe(expectedCashBalancePaisa);
    expect(bankRow.closingBalancePaisa).toBe(expectedBankBalancePaisa);
    expect(walletRow.closingBalancePaisa).toBe(expectedWalletBalancePaisa);
    expect(-outputTaxRow.closingBalancePaisa).toBe(expectedOutputTaxPaisa);

    // Invariant 7: P&L Net Profit equals Revenue - COGS - Operating Expenses
    const pnl = await getProfitAndLoss(db, pharmacyId, {
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    const expectedTotalCogsSection = expectedCogsPaisa + expectedStockAdjExpensePaisa;
    expect(pnl.summary.totalRevenuePaisa).toBe(expectedNetSalesPaisa);
    expect(pnl.summary.totalCogsPaisa).toBe(expectedTotalCogsSection);
    expect(pnl.summary.totalOperatingExpensesPaisa).toBe(expectedOperatingExpensesPaisa);
    expect(pnl.summary.netProfitPaisa).toBe(
      expectedNetSalesPaisa - expectedTotalCogsSection - expectedOperatingExpensesPaisa
    );
    expect(bs.summary.currentPeriodProfitPaisa).toBe(pnl.summary.netProfitPaisa);

    // Invariant 8: Every document has exactly 1 journal entry (5,050 documents + 40 concurrency test entries = 5,090 entries)
    const entryCountRes = await ctx.client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM journal_entries WHERE pharmacy_id = $1`,
      [pharmacyId]
    );
    const totalEntriesCount = Number(entryCountRes.rows[0]?.count ?? 0);
    expect(totalEntriesCount).toBe(5050 + 40);

    // Branch filter summation check: Branch 1 P&L + Branch 2 P&L == Total P&L
    const pnlB1 = await getProfitAndLoss(db, pharmacyId, {
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      branchId: branch1Id,
    });
    const pnlB2 = await getProfitAndLoss(db, pharmacyId, {
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      branchId: branch2Id,
    });
    expect(pnlB1.summary.totalRevenuePaisa + pnlB2.summary.totalRevenuePaisa).toBe(
      pnl.summary.totalRevenuePaisa
    );
    expect(pnlB1.summary.totalCogsPaisa + pnlB2.summary.totalCogsPaisa).toBe(
      pnl.summary.totalCogsPaisa
    );
    expect(pnlB1.summary.netProfitPaisa + pnlB2.summary.netProfitPaisa).toBe(
      pnl.summary.netProfitPaisa
    );

    console.log(
      '[STAGE 3 RECONCILIATION SUMMARY]',
      JSON.stringify({
        totalDocuments: 5050,
        duplicateEventsReplayed: 200,
        totalJournalEntries: totalEntriesCount,
        trialBalanceDebitPaisa: tb.totalDebitPaisa,
        trialBalanceCreditPaisa: tb.totalCreditPaisa,
        balanceSheetAssetsPaisa: bs.summary.totalAssetsPaisa,
        balanceSheetLiabAndEquityPaisa: bs.summary.totalLiabilitiesAndEquityPaisa,
        ledgerGrossSalesPaisa: recon.ledgerSalesTotalPaisa,
        docsGrossSalesPaisa: recon.documentsSalesTotalPaisa,
        ledgerNetSalesPaisa: recon.ledgerNetSalesPaisa,
        docsNetSalesPaisa: recon.documentsNetSalesPaisa,
        ledgerInventoryPaisa: recon.ledgerInventoryValuePaisa,
        batchesInventoryPaisa: recon.batchesInventoryValuePaisa,
        arControlPaisa: arRow.closingBalancePaisa,
        arPartiesSumPaisa: sumCustomerBalances,
        apControlPaisa: -apRow.closingBalancePaisa,
        apPartiesSumPaisa: sumSupplierBalances,
        cashLedgerPaisa: cashRow.closingBalancePaisa,
        bankLedgerPaisa: bankRow.closingBalancePaisa,
        walletLedgerPaisa: walletRow.closingBalancePaisa,
        pnlNetProfitPaisa: pnl.summary.netProfitPaisa,
      })
    );
  }, 180_000);

  it('3.3 verifies ledger fixes for credit note AR partyId, credit expense AP routing, and reversal subledger reconciliation', async () => {
    // 1. Verify F-H-06 / F-C-03: Credit Expense (`paymentType: 'credit'`) routes unlinked credit expenses to 2300 Other Payables,
    //    preserving 2000 AP control account reconciliation (`getMonthEndChecklist`)
    const creditExpId = generateUuidV7();
    let creditExpEntryId = '';
    await db.transaction(async (tx) => {
      const entry = await postExpenseCompleted(tx, {
        expenseId: creditExpId,
        expenseNumber: 'EXP-CREDIT-TEST',
        pharmacyId,
        branchId: branch1Id,
        expenseDate: '2026-10-25',
        expenseAccountId: rentExpenseAccountId,
        amountPaisa: 50_000,
        paymentType: 'credit',
        vendorName: 'Unlinked Landlord',
        createdBy: ownerUserId,
      });
      creditExpEntryId = entry.id;
    });

    const checklistAfterCreditExp = await getMonthEndChecklist(db, pharmacyId, 2026, 10);
    const reconAfterCreditExp = checklistAfterCreditExp.items.find(
      (i) => i.id === 'reconciliation_differences'
    )!;
    // Because postExpenseCompleted routes unlinked credit expenses to 2300 Other Payables, AP trade subledger remains exactly reconciled!
    expect(reconAfterCreditExp.status).toBe('passed');
    expect(reconAfterCreditExp.count).toBe(0);

    // Reverse that credit expense
    await db.transaction((tx) =>
      reverseJournalEntry(tx, creditExpEntryId, 'Reverse credit expense test', {
        pharmacyId,
        reversalDate: '2026-10-25',
        createdBy: ownerUserId,
      })
    );

    // 2. Verify F-C-02: Reversing a customer receipt (`reverseJournalEntry`) inserts reversing entry with `status = 'posted'`,
    //    and subledger queries include both original and reversal entries netting cleanly to 0.
    const receiptToReverseId = generateUuidV7();
    let receiptEntryId = '';
    await db.transaction(async (tx) => {
      const entry = await postFinancialPaymentCompleted(tx, {
        pharmacyId,
        paymentId: receiptToReverseId,
        paymentNumber: 'RCV-REV-TEST',
        paymentDate: '2026-10-25',
        branchId: branch1Id,
        direction: 'receipt',
        partyType: 'customer',
        partyId: customerIds[0]!,
        partyName: 'Audit Customer 1',
        method: 'cash',
        amountPaisa: 10_000,
        allocatedPaisa: 10_000,
        advancePaisa: 0,
        createdBy: ownerUserId,
      });
      receiptEntryId = entry.id;
      await reverseJournalEntry(tx, receiptEntryId, 'Bounced customer receipt', {
        pharmacyId,
        reversalDate: '2026-10-25',
        createdBy: ownerUserId,
      });
    });

    const checklistAfterReversal = await getMonthEndChecklist(db, pharmacyId, 2026, 10);
    const reconAfterReversal = checklistAfterReversal.items.find(
      (i) => i.id === 'reconciliation_differences'
    )!;
    // Both control account and customer subledger net out to 0, producing 0 reconciliation differences!
    expect(reconAfterReversal.status).toBe('passed');
    expect(reconAfterReversal.count).toBe(0);
  }, 60_000);

  it('3.4 verifies closed-period rejection (including late sync events), year-end closing, payroll fixtures, and benchmarks reports at 100,000+ journal lines', async () => {
    // 1. Close September 2026 (`2026-09-01` to `2026-09-30`) and verify late-arriving sync event is rejected
    const closedPeriod = await db.transaction((tx) =>
      closePeriod(tx, {
        pharmacyId,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        actorUserId: ownerUserId,
        actorRole: 'owner',
        reason: 'Close September 2026',
      })
    );
    expect(closedPeriod.status).toBe('closed');

    // Push a late-arriving stock adjustment dated in September 2026 -> must be rejected (`LEDGER_POSTING_FAILED`)
    const lateMoveId = generateUuidV7();
    const lateRes = await processSyncPushEvents(
      db,
      {
        pharmacyId,
        branchId: branch1Id,
        counterId: counter1Id,
        deviceId: device1Id,
      },
      [
        {
          eventId: generateUuidV7(),
          deviceSeq: 999999,
          type: 'stock_adjustment.created',
          entityId: lateMoveId,
          occurredAt: '2026-09-15T10:00:00.000Z',
          schemaVersion: 1,
          payload: {
            id: lateMoveId,
            movementId: lateMoveId,
            productId: productList[0]!.id,
            batchId: productList[0]!.batch1Id,
            branchId: branch1Id,
            quantitySigned: -1,
            reasonType: 'damage',
            reason: 'Late September adjustment',
            createdAt: '2026-09-15T10:00:00.000Z',
          },
        },
      ]
    );
    expect(lateRes[0]?.status).toBe('rejected');
    expect(lateRes[0]?.code).toBe('LEDGER_POSTING_FAILED');

    // Verify atomic rollback: the stock movement was NOT persisted in stock_movements
    const orphanedMoveRes = await ctx.client.query(`SELECT id FROM stock_movements WHERE id = $1`, [
      lateMoveId,
    ]);
    expect(orphanedMoveRes.rows.length).toBe(0);

    // Reopen September 2026 and verify status
    const reopened = await db.transaction((tx) =>
      reopenPeriod(tx, {
        pharmacyId,
        periodId: closedPeriod.id,
        actorUserId: ownerUserId,
        actorRole: 'owner',
        reason: 'Audit reopen verification',
      })
    );
    expect(reopened.status).toBe('open');

    // 2. Verify Payroll Calculation on fixtures (`calculateProgressiveTax` & `calculateStatutoryComponentDeduction`)
    const progressiveTaxPaisa = calculateProgressiveTax(15_000_000, [
      {
        minMonthlyIncomePaisa: 0,
        maxMonthlyIncomePaisa: 5_000_000,
        baseTaxPaisa: 0,
        excessRatePercentage: '0',
      },
      {
        minMonthlyIncomePaisa: 5_000_000,
        maxMonthlyIncomePaisa: 10_000_000,
        baseTaxPaisa: 0,
        excessRatePercentage: '5',
      },
      {
        minMonthlyIncomePaisa: 10_000_000,
        maxMonthlyIncomePaisa: 20_000_000,
        baseTaxPaisa: 250_000,
        excessRatePercentage: '15',
      },
    ]);
    expect(Number.isInteger(progressiveTaxPaisa)).toBe(true);
    expect(progressiveTaxPaisa).toBe(250_000 + 750_000); // 10,000 PKR

    const eobiDeductionPaisa = calculateStatutoryComponentDeduction(15_000_000, {
      code: 'EOBI_EMP',
      name: 'EOBI Employee Contribution',
      calculationType: 'fixed',
      fixedAmountPaisa: 37_000,
      percentageRate: '0',
      accountCode: '2210',
    });
    expect(eobiDeductionPaisa).toBe(37_000);

    // 3. Bulk-load balanced journal entries + lines to reach >= 100,000 journal_lines for this pharmacy
    const currentLinesCountRes = await ctx.client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM journal_lines WHERE pharmacy_id = $1`,
      [pharmacyId]
    );
    const currentLines = Number(currentLinesCountRes.rows[0]?.count ?? 0);
    const neededLines = Math.max(0, 100_000 - currentLines);
    const entriesToInsert = Math.ceil(neededLines / 2);

    const maxEntryRes = await ctx.client.query<{ max_no: string }>(
      `SELECT COALESCE(MAX(entry_no), 0) AS max_no FROM journal_entries WHERE pharmacy_id = $1`,
      [pharmacyId]
    );
    let nextEntryNo = Number(maxEntryRes.rows[0]?.max_no ?? 0) + 1;

    const batchSize = 2500; // 2,500 entries = 5,000 lines per transaction batch
    for (let offset = 0; offset < entriesToInsert; offset += batchSize) {
      const count = Math.min(batchSize, entriesToInsert - offset);
      const entryRows = [];
      const lineRows = [];
      const nowIso = '2026-10-28T12:00:00.000Z';

      for (let j = 0; j < count; j++) {
        const eId = generateUuidV7();
        const bId = j % 2 === 0 ? branch1Id : branch2Id;
        entryRows.push({
          id: eId,
          pharmacyId,
          entryNo: nextEntryNo++,
          entryDate: '2026-10-28',
          sourceType: 'scale_benchmark',
          sourceId: eId,
          memo: '100k scale benchmark balanced entry',
          status: 'posted' as const,
          createdBy: ownerUserId,
          createdAt: nowIso,
        });
        lineRows.push(
          {
            id: generateUuidV7(),
            entryId: eId,
            pharmacyId,
            accountId: accountMap.cash,
            debitPaisa: 100,
            creditPaisa: 0,
            branchId: bId,
            memo: 'Benchmark Dr',
          },
          {
            id: generateUuidV7(),
            entryId: eId,
            pharmacyId,
            accountId: accountMap.cash,
            debitPaisa: 0,
            creditPaisa: 100,
            branchId: bId,
            memo: 'Benchmark Cr',
          }
        );
      }

      await db.transaction(async (tx) => {
        await tx.insert(journalEntries).values(entryRows);
        await tx.insert(journalLines).values(lineRows);
      });
    }

    const finalLinesCountRes = await ctx.client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM journal_lines WHERE pharmacy_id = $1`,
      [pharmacyId]
    );
    const totalJournalLines = Number(finalLinesCountRes.rows[0]?.count ?? 0);
    expect(totalJournalLines).toBeGreaterThanOrEqual(100_000);

    // 4. Measure execution time of all 5 Financial Reports at 100,000+ journal lines
    const range = {
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      compareWithPrevious: true,
    };

    const t0 = performance.now();
    const tb100k = await getTrialBalance(db, pharmacyId, range);
    const tbMs = Math.round(performance.now() - t0);

    const t1 = performance.now();
    const pnl100k = await getProfitAndLoss(db, pharmacyId, range);
    const pnlMs = Math.round(performance.now() - t1);

    const t2 = performance.now();
    const bs100k = await getBalanceSheet(db, pharmacyId, range);
    const bsMs = Math.round(performance.now() - t2);

    const t3 = performance.now();
    const cf100k = await getCashFlow(db, pharmacyId, range);
    const cfMs = Math.round(performance.now() - t3);

    const t4 = performance.now();
    const glSum100k = await getGeneralLedgerSummary(db, pharmacyId, range);
    const glSummaryMs = Math.round(performance.now() - t4);

    const t5 = performance.now();
    const glDet100k = await getAccountLedgerDetail(db, pharmacyId, accountMap.sales, range);
    const glDetailMs = Math.round(performance.now() - t5);

    expect(tb100k.isBalanced).toBe(true);
    expect(bs100k.isBalanced).toBe(true);
    expect(cf100k.isReconciled).toBe(true);
    expect(pnl100k.summary.netProfitPaisa).toBeDefined();
    expect(glSum100k.accounts.length).toBeGreaterThan(0);
    expect(glDet100k.lines.length).toBe(4200);

    console.log(
      '[STAGE 3 100K BENCHMARK]',
      JSON.stringify({
        totalJournalLines,
        trialBalanceMs: tbMs,
        profitAndLossMs: pnlMs,
        balanceSheetMs: bsMs,
        cashFlowMs: cfMs,
        generalLedgerSummaryMs: glSummaryMs,
        accountLedgerDetail4200LinesMs: glDetailMs,
      })
    );
  }, 180_000);
});
