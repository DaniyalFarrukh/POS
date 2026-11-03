import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and, sql } from 'drizzle-orm';
import { generateUuidV7, type SyncEventEnvelope } from '@pos/shared';
import {
  isPostgresReachable,
  createTestContext,
  type TestDatabaseContext,
} from '../db/test-helper';
import {
  pharmacies,
  branches,
  counters,
  users,
  devices,
  products,
  batches,
  suppliers,
  invoices,
  invoiceLines,
  payments,
  creditNotes,
  creditNoteLines,
  stockMovements,
  rejectedEvents,
  accounts,
  journalEntries,
  journalLines,
} from '../db/schema';
import {
  seedDefaultChartOfAccounts,
  seedDefaultAccountMappings,
  getPharmacyAccountMap,
  setPharmacyAccountMapping,
} from './coa-seed';
import { closePeriod } from './service';
import { trialBalance } from './queries';
import {
  postInvoiceCreated,
  postCreditNoteCreated,
  postPurchaseReceived,
  postStockAdjustmentCreated,
} from './posting-engine';
import { reconcileLedger } from './reconciliation';
import { backfillLedgerEntries } from './backfill';
import { processSyncPushEvents } from '../sync/service';
import type { DeviceContext } from '../auth/device-auth';

// Deterministic PRNG (Mulberry32) for reproducible 1,000-transaction acceptance test
function createPrng(seed: number) {
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

describe('Ledger Posting Engine, Backfill & Reconciliation (ERP Spec Phase 7)', () => {
  let ctx: TestDatabaseContext;

  beforeAll(async () => {
    const reachable = await isPostgresReachable();
    if (!reachable) {
      throw new Error('PostgreSQL must be running for posting engine tests.');
    }
    ctx = await createTestContext();
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  async function createPharmacyFixture(suffix: string) {
    const now = new Date().toISOString();
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const branch2Id = generateUuidV7();
    const counterId = generateUuidV7();
    const ownerUserId = generateUuidV7();
    const cashierUserId = generateUuidV7();
    const deviceId = generateUuidV7();
    const supplierId = generateUuidV7();

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: `Posting Pharmacy ${suffix}`,
      code: `PP_${suffix}`,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(branches).values([
      {
        id: branchId,
        pharmacyId,
        name: `Main Branch ${suffix}`,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: branch2Id,
        pharmacyId,
        name: `Second Branch ${suffix}`,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await ctx.db.insert(counters).values({
      id: counterId,
      pharmacyId,
      branchId,
      name: `Counter 1 ${suffix}`,
      code: `C1_${suffix}`,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(users).values([
      {
        id: ownerUserId,
        pharmacyId,
        name: `Owner ${suffix}`,
        role: 'owner',
        pinHash: 'dummy_pin_hash',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: cashierUserId,
        pharmacyId,
        name: `Cashier ${suffix}`,
        role: 'cashier',
        pinHash: 'dummy_pin_hash',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await ctx.db.insert(devices).values({
      id: deviceId,
      pharmacyId,
      branchId,
      counterId,
      deviceName: `POS Terminal ${suffix}`,
      isRevoked: false,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(suppliers).values({
      id: supplierId,
      pharmacyId,
      name: `Prime Pharma Distributors ${suffix}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const seededAccounts = await seedDefaultChartOfAccounts(ctx.db, pharmacyId);
    await seedDefaultAccountMappings(ctx.db, pharmacyId);
    const byCode = new Map(seededAccounts.map((a) => [a.code, a]));

    const deviceContext: DeviceContext = {
      deviceId,
      pharmacyId,
      branchId,
      counterId,
    };

    return {
      pharmacyId,
      branchId,
      branch2Id,
      counterId,
      ownerUserId,
      cashierUserId,
      deviceId,
      supplierId,
      byCode,
      deviceContext,
    };
  }

  it('1. purchase.received posts balanced entry (Dr 1200 Inventory, Dr 1300 Input Tax, Cr 2000 AP with supplier party)', async () => {
    const f = await createPharmacyFixture('PUR01');
    const now = '2026-11-03T10:00:00.000Z';
    const productId = generateUuidV7();
    const batch1Id = generateUuidV7();
    const batch2Id = generateUuidV7();
    const purchaseId = generateUuidV7();

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId: f.pharmacyId,
      brandName: 'Augmentin 625mg',
      mrpPaisa: 120000,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Purchase with 2 batches + input tax
    // Batch 1: 50 units @ 80000 paisa = 4,000,000 paisa
    // Batch 2: 20 units @ 90000 paisa = 1,800,000 paisa
    // Total inventory = 5,800,000 paisa, input tax = 200,000 paisa, AP = 6,000,000 paisa
    const purchaseEvent: SyncEventEnvelope = {
      eventId: generateUuidV7(),
      deviceSeq: 1,
      type: 'purchase.received',
      entityId: purchaseId,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        purchase: {
          id: purchaseId,
          branchId: f.branchId,
          supplierId: f.supplierId,
          supplierInvoiceNo: 'SUP-INV-1001',
          invoiceDate: '2026-11-03',
          totalCostPaisa: 6000000,
          taxPaisa: 200000,
          createdByUserId: f.ownerUserId,
          createdAt: now,
        },
        batches: [
          {
            id: batch1Id,
            productId,
            batchNo: 'AUG-B1',
            expiryDate: '2028-06-30',
            costPaisa: 80000,
            mrpPaisa: 120000,
          },
          {
            id: batch2Id,
            productId,
            batchNo: 'AUG-B2',
            expiryDate: '2028-12-31',
            costPaisa: 90000,
            mrpPaisa: 125000,
          },
        ],
        lines: [
          {
            id: generateUuidV7(),
            productId,
            batchId: batch1Id,
            quantity: 50,
            costPaisa: 80000,
            mrpPaisa: 120000,
          },
          {
            id: generateUuidV7(),
            productId,
            batchId: batch2Id,
            quantity: 20,
            costPaisa: 90000,
            mrpPaisa: 125000,
          },
        ],
      },
    };

    const results = await processSyncPushEvents(ctx.db, f.deviceContext, [purchaseEvent]);
    expect(results[0]?.status).toBe('accepted');

    const [entry] = await ctx.db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.pharmacyId, f.pharmacyId),
          eq(journalEntries.sourceType, 'purchase'),
          eq(journalEntries.sourceId, purchaseId)
        )
      );

    expect(entry).toBeDefined();
    expect(entry!.entryDate).toBe('2026-11-03');

    const lines = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, entry!.id));

    expect(lines).toHaveLength(3);

    const invAccId = f.byCode.get('1200')!.id;
    const inputTaxAccId = f.byCode.get('1300')!.id;
    const apAccId = f.byCode.get('2000')!.id;

    const invLine = lines.find((l) => l.accountId === invAccId);
    const taxLine = lines.find((l) => l.accountId === inputTaxAccId);
    const apLine = lines.find((l) => l.accountId === apAccId);

    expect(invLine?.debitPaisa).toBe(5800000);
    expect(invLine?.creditPaisa).toBe(0);
    expect(invLine?.branchId).toBe(f.branchId);

    expect(taxLine?.debitPaisa).toBe(200000);
    expect(taxLine?.creditPaisa).toBe(0);

    expect(apLine?.debitPaisa).toBe(0);
    expect(apLine?.creditPaisa).toBe(6000000);
    expect(apLine?.partyType).toBe('supplier');
    expect(apLine?.partyId).toBe(f.supplierId);
  });

  it('2. multi-batch invoice.created and tax-exempt invoice.created post exact revenue, tax, payment, COGS and inventory lines', async () => {
    const f = await createPharmacyFixture('INV02');
    const now = '2026-11-03T11:30:00.000Z';
    const productId = generateUuidV7();
    const batchAId = generateUuidV7();
    const batchBId = generateUuidV7();

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId: f.pharmacyId,
      brandName: 'Panadol Extra',
      mrpPaisa: 1000,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Seed two batches with distinct costs: Batch A = 400 paisa, Batch B = 650 paisa
    await ctx.db.insert(batches).values([
      {
        id: batchAId,
        pharmacyId: f.pharmacyId,
        productId,
        batchNo: 'PAN-A',
        expiryDate: '2028-01-01',
        costPaisa: 400,
        mrpPaisa: 1000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: batchBId,
        pharmacyId: f.pharmacyId,
        productId,
        batchNo: 'PAN-B',
        expiryDate: '2028-06-01',
        costPaisa: 650,
        mrpPaisa: 1000,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // Multi-batch invoice with discount, tax, and split payments (cash + card + wallet)
    // Line 1: 5 units of Batch A (cost = 5 * 400 = 2000), unitPrice 1000, discount 200, tax 300, lineTotal = 5100
    // Line 2: 4 units of Batch B (cost = 4 * 650 = 2600), unitPrice 1000, discount 100, tax 200, lineTotal = 4100
    // Total COGS = 2000 + 2600 = 4600 paisa
    // Invoice subtotal = 9000, discount = 300, tax = 500, total = 9200
    // Net sales revenue = total (9200) - tax (500) = 8700
    const invoice1Id = generateUuidV7();
    const invoice1Event: SyncEventEnvelope = {
      eventId: generateUuidV7(),
      deviceSeq: 1,
      type: 'invoice.created',
      entityId: invoice1Id,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        id: invoice1Id,
        counterId: f.counterId,
        cashierUserId: f.cashierUserId,
        invoiceNumber: 'INV-MB-0001',
        clientRequestId: generateUuidV7(),
        status: 'finalized',
        subtotalPaisa: 9000,
        discountPaisa: 300,
        taxPaisa: 500,
        totalPaisa: 9200,
        createdAt: now,
        lines: [
          {
            id: generateUuidV7(),
            productId,
            batchId: batchAId,
            quantity: 5,
            unitPricePaisa: 1000,
            discountPaisa: 200,
            taxRateBp: 600,
            taxPaisa: 300,
            lineTotalPaisa: 5100,
          },
          {
            id: generateUuidV7(),
            productId,
            batchId: batchBId,
            quantity: 4,
            unitPricePaisa: 1000,
            discountPaisa: 100,
            taxRateBp: 500,
            taxPaisa: 200,
            lineTotalPaisa: 4100,
          },
        ],
        payments: [
          { id: generateUuidV7(), method: 'cash', amountPaisa: 4000 },
          { id: generateUuidV7(), method: 'card', amountPaisa: 3200 },
          { id: generateUuidV7(), method: 'wallet', amountPaisa: 2000 },
        ],
      },
    };

    const res1 = await processSyncPushEvents(ctx.db, f.deviceContext, [invoice1Event]);
    expect(res1[0]?.status).toBe('accepted');

    const [entry1] = await ctx.db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.pharmacyId, f.pharmacyId),
          eq(journalEntries.sourceType, 'invoice'),
          eq(journalEntries.sourceId, invoice1Id)
        )
      );

    expect(entry1).toBeDefined();
    const lines1 = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, entry1!.id));

    const cashId = f.byCode.get('1000')!.id;
    const bankId = f.byCode.get('1010')!.id;
    const walletId = f.byCode.get('1020')!.id;
    const salesId = f.byCode.get('4000')!.id;
    const outputTaxId = f.byCode.get('2100')!.id;
    const cogsId = f.byCode.get('5000')!.id;
    const invId = f.byCode.get('1200')!.id;

    expect(lines1.find((l) => l.accountId === cashId)?.debitPaisa).toBe(4000);
    expect(lines1.find((l) => l.accountId === bankId)?.debitPaisa).toBe(3200);
    expect(lines1.find((l) => l.accountId === walletId)?.debitPaisa).toBe(2000);
    expect(lines1.find((l) => l.accountId === salesId)?.creditPaisa).toBe(8700);
    expect(lines1.find((l) => l.accountId === outputTaxId)?.creditPaisa).toBe(500);
    expect(lines1.find((l) => l.accountId === cogsId)?.debitPaisa).toBe(4600);
    expect(lines1.find((l) => l.accountId === invId)?.creditPaisa).toBe(4600);

    // Tax-exempt invoice (taxPaisa = 0): must NOT create a 2100 Output Sales Tax line
    const invoice2Id = generateUuidV7();
    const invoice2Event: SyncEventEnvelope = {
      eventId: generateUuidV7(),
      deviceSeq: 2,
      type: 'invoice.created',
      entityId: invoice2Id,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        id: invoice2Id,
        counterId: f.counterId,
        cashierUserId: f.cashierUserId,
        invoiceNumber: 'INV-EXEMPT-0002',
        clientRequestId: generateUuidV7(),
        status: 'finalized',
        subtotalPaisa: 3000,
        discountPaisa: 0,
        taxPaisa: 0,
        totalPaisa: 3000,
        createdAt: now,
        lines: [
          {
            id: generateUuidV7(),
            productId,
            batchId: batchAId,
            quantity: 3,
            unitPricePaisa: 1000,
            discountPaisa: 0,
            taxRateBp: 0,
            taxPaisa: 0,
            lineTotalPaisa: 3000,
          },
        ],
        payments: [{ id: generateUuidV7(), method: 'cash', amountPaisa: 3000 }],
      },
    };

    const res2 = await processSyncPushEvents(ctx.db, f.deviceContext, [invoice2Event]);
    expect(res2[0]?.status).toBe('accepted');

    const [entry2] = await ctx.db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.pharmacyId, f.pharmacyId),
          eq(journalEntries.sourceType, 'invoice'),
          eq(journalEntries.sourceId, invoice2Id)
        )
      );

    const lines2 = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, entry2!.id));

    expect(lines2).toHaveLength(4); // Cash, Sales, COGS, Inventory (no tax line)
    expect(lines2.find((l) => l.accountId === outputTaxId)).toBeUndefined();
    expect(lines2.find((l) => l.accountId === salesId)?.creditPaisa).toBe(3000);
    expect(lines2.find((l) => l.accountId === cogsId)?.debitPaisa).toBe(1200);
    expect(lines2.find((l) => l.accountId === invId)?.creditPaisa).toBe(1200);
  });

  it('3. credit_note.created posts balanced return lines (Dr 4090 Sales Returns, Dr 2100 Output Tax, Cr Cash/Bank/Wallet/AR, Dr 1200 Inventory, Cr 5000 COGS)', async () => {
    const f = await createPharmacyFixture('CN03');
    const now = '2026-11-03T12:00:00.000Z';
    const productId = generateUuidV7();
    const batchId = generateUuidV7();
    const invoiceId = generateUuidV7();
    const invLineId = generateUuidV7();

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId: f.pharmacyId,
      brandName: 'Ciprofloxacin 500mg',
      mrpPaisa: 2000,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(batches).values({
      id: batchId,
      pharmacyId: f.pharmacyId,
      productId,
      batchNo: 'CIP-01',
      expiryDate: '2028-09-30',
      costPaisa: 1100,
      mrpPaisa: 2000,
      createdAt: now,
      updatedAt: now,
    });

    // First sync an invoice selling 10 units @ 2000 + 200 tax = 22000
    const invoiceEvent: SyncEventEnvelope = {
      eventId: generateUuidV7(),
      deviceSeq: 1,
      type: 'invoice.created',
      entityId: invoiceId,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        id: invoiceId,
        counterId: f.counterId,
        cashierUserId: f.cashierUserId,
        invoiceNumber: 'INV-CN-01',
        clientRequestId: generateUuidV7(),
        status: 'finalized',
        subtotalPaisa: 20000,
        discountPaisa: 0,
        taxPaisa: 2000,
        totalPaisa: 22000,
        createdAt: now,
        lines: [
          {
            id: invLineId,
            productId,
            batchId,
            quantity: 10,
            unitPricePaisa: 2000,
            discountPaisa: 0,
            taxRateBp: 1000,
            taxPaisa: 2000,
            lineTotalPaisa: 22000,
          },
        ],
        payments: [{ id: generateUuidV7(), method: 'cash', amountPaisa: 22000 }],
      },
    };

    await processSyncPushEvents(ctx.db, f.deviceContext, [invoiceEvent]);

    // Now sync a credit note returning 3 units (subtotal 6000, tax 600, total 6600, cost = 3 * 1100 = 3300)
    const cnId = generateUuidV7();
    const cnEvent: SyncEventEnvelope = {
      eventId: generateUuidV7(),
      deviceSeq: 2,
      type: 'credit_note.created',
      entityId: cnId,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        id: cnId,
        creditNoteNumber: 'CN-0001',
        originalInvoiceId: invoiceId,
        branchId: f.branchId,
        counterId: f.counterId,
        cashierUserId: f.cashierUserId,
        clientRequestId: generateUuidV7(),
        subtotalPaisa: 6000,
        taxPaisa: 600,
        totalPaisa: 6600,
        refundMethod: 'card',
        reason: 'Customer returned unopened blister pack',
        createdAt: now,
        lines: [
          {
            id: generateUuidV7(),
            originalInvoiceLineId: invLineId,
            productId,
            batchId,
            quantity: 3,
            unitPricePaisa: 2000,
            taxRateBp: 1000,
            taxPaisa: 600,
            lineTotalPaisa: 6600,
          },
        ],
      },
    };

    const res = await processSyncPushEvents(ctx.db, f.deviceContext, [cnEvent]);
    expect(res[0]?.status).toBe('accepted');

    const [cnEntry] = await ctx.db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.pharmacyId, f.pharmacyId),
          eq(journalEntries.sourceType, 'credit_note'),
          eq(journalEntries.sourceId, cnId)
        )
      );

    expect(cnEntry).toBeDefined();
    const cnLines = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, cnEntry!.id));

    expect(cnLines).toHaveLength(5);

    const returnsId = f.byCode.get('4090')!.id;
    const outputTaxId = f.byCode.get('2100')!.id;
    const bankId = f.byCode.get('1010')!.id; // card -> 1010 Bank
    const invId = f.byCode.get('1200')!.id;
    const cogsId = f.byCode.get('5000')!.id;

    expect(cnLines.find((l) => l.accountId === returnsId)?.debitPaisa).toBe(6000);
    expect(cnLines.find((l) => l.accountId === outputTaxId)?.debitPaisa).toBe(600);
    expect(cnLines.find((l) => l.accountId === bankId)?.creditPaisa).toBe(6600);
    expect(cnLines.find((l) => l.accountId === invId)?.debitPaisa).toBe(3300);
    expect(cnLines.find((l) => l.accountId === cogsId)?.creditPaisa).toBe(3300);
  });

  it('4. stock_adjustment.created posts balanced lines for both negative write-offs and positive stock gains', async () => {
    const f = await createPharmacyFixture('ADJ04');
    const now = '2026-11-03T13:00:00.000Z';
    const productId = generateUuidV7();
    const batchId = generateUuidV7();

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId: f.pharmacyId,
      brandName: 'Insulin Glargine',
      mrpPaisa: 350000,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(batches).values({
      id: batchId,
      pharmacyId: f.pharmacyId,
      productId,
      batchNo: 'INS-01',
      expiryDate: '2027-05-01',
      costPaisa: 250000,
      mrpPaisa: 350000,
      createdAt: now,
      updatedAt: now,
    });

    // 1. Negative adjustment (-2 units -> 500,000 paisa write-off)
    const negAdjId = generateUuidV7();
    const negAdjEvent: SyncEventEnvelope = {
      eventId: generateUuidV7(),
      deviceSeq: 1,
      type: 'stock_adjustment.created',
      entityId: negAdjId,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        id: negAdjId,
        movementId: negAdjId,
        productId,
        batchId,
        branchId: f.branchId,
        quantitySigned: -2,
        reason: 'Cold chain breakage',
        createdAt: now,
      },
    };

    // 2. Positive adjustment (+3 units -> 750,000 paisa gain)
    const posAdjId = generateUuidV7();
    const posAdjEvent: SyncEventEnvelope = {
      eventId: generateUuidV7(),
      deviceSeq: 2,
      type: 'stock_adjustment.created',
      entityId: posAdjId,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        id: posAdjId,
        movementId: posAdjId,
        productId,
        batchId,
        branchId: f.branchId,
        quantitySigned: 3,
        reason: 'Stock count surplus',
        createdAt: now,
      },
    };

    const res = await processSyncPushEvents(ctx.db, f.deviceContext, [negAdjEvent, posAdjEvent]);
    expect(res[0]?.status).toBe('accepted');
    expect(res[1]?.status).toBe('accepted');

    const adjAccId = f.byCode.get('5010')!.id;
    const invAccId = f.byCode.get('1200')!.id;

    // Verify negative adjustment: Dr 5010 Stock Adjustments, Cr 1200 Inventory
    const [negEntry] = await ctx.db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.pharmacyId, f.pharmacyId),
          eq(journalEntries.sourceType, 'stock_adjustment'),
          eq(journalEntries.sourceId, negAdjId)
        )
      );
    const negLines = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, negEntry!.id));

    expect(negLines.find((l) => l.accountId === adjAccId)?.debitPaisa).toBe(500000);
    expect(negLines.find((l) => l.accountId === invAccId)?.creditPaisa).toBe(500000);

    // Verify positive adjustment: Dr 1200 Inventory, Cr 5010 Stock Adjustments
    const [posEntry] = await ctx.db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.pharmacyId, f.pharmacyId),
          eq(journalEntries.sourceType, 'stock_adjustment'),
          eq(journalEntries.sourceId, posAdjId)
        )
      );
    const posLines = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, posEntry!.id));

    expect(posLines.find((l) => l.accountId === invAccId)?.debitPaisa).toBe(750000);
    expect(posLines.find((l) => l.accountId === adjAccId)?.creditPaisa).toBe(750000);
  });

  it('5. replaying an event or calling posting functions twice with the same source_id creates no second journal entry', async () => {
    const f = await createPharmacyFixture('IDEM05');
    const now = '2026-11-03T14:00:00.000Z';
    const productId = generateUuidV7();
    const batchId = generateUuidV7();
    const invoiceId = generateUuidV7();

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId: f.pharmacyId,
      brandName: 'Metformin 500mg',
      mrpPaisa: 500,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(batches).values({
      id: batchId,
      pharmacyId: f.pharmacyId,
      productId,
      batchNo: 'MET-01',
      expiryDate: '2028-12-31',
      costPaisa: 300,
      mrpPaisa: 500,
      createdAt: now,
      updatedAt: now,
    });

    const invoicePayload = {
      id: invoiceId,
      counterId: f.counterId,
      cashierUserId: f.cashierUserId,
      invoiceNumber: 'INV-IDEM-01',
      clientRequestId: generateUuidV7(),
      status: 'finalized',
      subtotalPaisa: 2000,
      discountPaisa: 0,
      taxPaisa: 0,
      totalPaisa: 2000,
      createdAt: now,
      lines: [
        {
          id: generateUuidV7(),
          productId,
          batchId,
          quantity: 4,
          unitPricePaisa: 500,
          discountPaisa: 0,
          taxRateBp: 0,
          taxPaisa: 0,
          lineTotalPaisa: 2000,
        },
      ],
      payments: [{ id: generateUuidV7(), method: 'cash' as const, amountPaisa: 2000 }],
    };

    const ev: SyncEventEnvelope = {
      eventId: generateUuidV7(),
      deviceSeq: 1,
      type: 'invoice.created',
      entityId: invoiceId,
      occurredAt: now,
      schemaVersion: 1,
      payload: invoicePayload,
    };

    // Push event twice through sync service
    const r1 = await processSyncPushEvents(ctx.db, f.deviceContext, [ev]);
    const r2 = await processSyncPushEvents(ctx.db, f.deviceContext, [ev]);
    expect(r1[0]?.status).toBe('accepted');
    expect(r2[0]?.status).toBe('duplicate');

    // Also invoke postInvoiceCreated directly inside a transaction with the same sourceId
    await ctx.db.transaction(async (tx) => {
      await postInvoiceCreated(tx, {
        pharmacyId: f.pharmacyId,
        branchId: f.branchId,
        createdBy: f.cashierUserId,
        invoice: invoicePayload,
      });
    });

    const entries = await ctx.db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.pharmacyId, f.pharmacyId));

    expect(entries).toHaveLength(1);
  });

  it('6. failed posting (missing batchId, zero batch cost, or closed fiscal period) rolls back the synced document and records MISSING_BATCH_COST in rejected_events', async () => {
    const f = await createPharmacyFixture('FAIL06');
    const now = '2026-11-03T15:00:00.000Z';
    const productId = generateUuidV7();
    const zeroCostBatchId = generateUuidV7();
    const validBatchId = generateUuidV7();

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId: f.pharmacyId,
      brandName: 'Omeprazole 20mg',
      mrpPaisa: 900,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(batches).values([
      {
        id: zeroCostBatchId,
        pharmacyId: f.pharmacyId,
        productId,
        batchNo: 'OME-ZERO',
        expiryDate: '2028-12-31',
        costPaisa: 0, // Invalid zero batch cost!
        mrpPaisa: 900,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: validBatchId,
        pharmacyId: f.pharmacyId,
        productId,
        batchNo: 'OME-VALID',
        expiryDate: '2028-12-31',
        costPaisa: 500,
        mrpPaisa: 900,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // Case A: Invoice line with batchId = null -> must fail with MISSING_BATCH_COST and roll back invoice
    const noBatchInvoiceId = generateUuidV7();
    const noBatchEvent: SyncEventEnvelope = {
      eventId: generateUuidV7(),
      deviceSeq: 1,
      type: 'invoice.created',
      entityId: noBatchInvoiceId,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        id: noBatchInvoiceId,
        counterId: f.counterId,
        cashierUserId: f.cashierUserId,
        invoiceNumber: 'INV-NOBATCH-01',
        clientRequestId: generateUuidV7(),
        status: 'finalized',
        subtotalPaisa: 1800,
        discountPaisa: 0,
        taxPaisa: 0,
        totalPaisa: 1800,
        createdAt: now,
        lines: [
          {
            id: generateUuidV7(),
            productId,
            batchId: null,
            quantity: 2,
            unitPricePaisa: 900,
            discountPaisa: 0,
            taxRateBp: 0,
            taxPaisa: 0,
            lineTotalPaisa: 1800,
          },
        ],
        payments: [{ id: generateUuidV7(), method: 'cash', amountPaisa: 1800 }],
      },
    };

    const resA = await processSyncPushEvents(ctx.db, f.deviceContext, [noBatchEvent]);
    expect(resA[0]?.status).toBe('rejected');
    expect(resA[0]?.code).toBe('MISSING_BATCH_COST');

    // Invoice must NOT exist in DB (transaction rolled back!)
    const [invRowA] = await ctx.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, noBatchInvoiceId));
    expect(invRowA).toBeUndefined();

    // Case B: Invoice line referencing a batch with costPaisa = 0 -> must fail with MISSING_BATCH_COST and roll back
    const zeroCostInvoiceId = generateUuidV7();
    const zeroCostEvent: SyncEventEnvelope = {
      eventId: generateUuidV7(),
      deviceSeq: 2,
      type: 'invoice.created',
      entityId: zeroCostInvoiceId,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        id: zeroCostInvoiceId,
        counterId: f.counterId,
        cashierUserId: f.cashierUserId,
        invoiceNumber: 'INV-ZEROCOST-02',
        clientRequestId: generateUuidV7(),
        status: 'finalized',
        subtotalPaisa: 1800,
        discountPaisa: 0,
        taxPaisa: 0,
        totalPaisa: 1800,
        createdAt: now,
        lines: [
          {
            id: generateUuidV7(),
            productId,
            batchId: zeroCostBatchId,
            quantity: 2,
            unitPricePaisa: 900,
            discountPaisa: 0,
            taxRateBp: 0,
            taxPaisa: 0,
            lineTotalPaisa: 1800,
          },
        ],
        payments: [{ id: generateUuidV7(), method: 'cash', amountPaisa: 1800 }],
      },
    };

    const resB = await processSyncPushEvents(ctx.db, f.deviceContext, [zeroCostEvent]);
    expect(resB[0]?.status).toBe('rejected');
    expect(resB[0]?.code).toBe('MISSING_BATCH_COST');

    const [invRowB] = await ctx.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, zeroCostInvoiceId));
    expect(invRowB).toBeUndefined();

    // Verify both failures were recorded in rejected_events
    const rejected = await ctx.db
      .select()
      .from(rejectedEvents)
      .where(eq(rejectedEvents.pharmacyId, f.pharmacyId));
    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => r.code === 'MISSING_BATCH_COST')).toBe(true);

    // Case C: Close fiscal period 2026-10-01..2026-10-31, then attempt to sync an invoice dated 2026-10-15
    await closePeriod(ctx.db, {
      pharmacyId: f.pharmacyId,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      actorUserId: f.ownerUserId,
      actorRole: 'owner',
      reason: 'October month-end close',
    });

    const closedPeriodInvoiceId = generateUuidV7();
    const closedPeriodEvent: SyncEventEnvelope = {
      eventId: generateUuidV7(),
      deviceSeq: 3,
      type: 'invoice.created',
      entityId: closedPeriodInvoiceId,
      occurredAt: '2026-10-15T10:00:00.000Z',
      schemaVersion: 1,
      payload: {
        id: closedPeriodInvoiceId,
        counterId: f.counterId,
        cashierUserId: f.cashierUserId,
        invoiceNumber: 'INV-CLOSED-03',
        clientRequestId: generateUuidV7(),
        status: 'finalized',
        subtotalPaisa: 1800,
        discountPaisa: 0,
        taxPaisa: 0,
        totalPaisa: 1800,
        createdAt: '2026-10-15T10:00:00.000Z',
        lines: [
          {
            id: generateUuidV7(),
            productId,
            batchId: validBatchId,
            quantity: 2,
            unitPricePaisa: 900,
            discountPaisa: 0,
            taxRateBp: 0,
            taxPaisa: 0,
            lineTotalPaisa: 1800,
          },
        ],
        payments: [{ id: generateUuidV7(), method: 'cash', amountPaisa: 1800 }],
      },
    };

    const resC = await processSyncPushEvents(ctx.db, f.deviceContext, [closedPeriodEvent]);
    expect(resC[0]?.status).toBe('rejected');

    // Verify closed-period invoice was rolled back completely
    const [invRowC] = await ctx.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, closedPeriodInvoiceId));
    expect(invRowC).toBeUndefined();
  });

  it('7. per-pharmacy account mapping customization routes posted lines to the configured account', async () => {
    const f = await createPharmacyFixture('MAP07');
    const now = '2026-11-03T16:00:00.000Z';
    const productId = generateUuidV7();
    const batchId = generateUuidV7();

    // Create a custom Sales account (4010 Retail Counter Sales) and map role 'sales' to it
    const customSalesAccountId = generateUuidV7();
    await ctx.db.insert(accounts).values({
      id: customSalesAccountId,
      pharmacyId: f.pharmacyId,
      code: '4010',
      name: 'Retail Counter Sales',
      type: 'revenue',
      parentId: null,
      isActive: true,
      isSystem: false,
    });

    await setPharmacyAccountMapping(ctx.db, f.pharmacyId, 'sales', customSalesAccountId);

    const mapAfter = await getPharmacyAccountMap(ctx.db, f.pharmacyId);
    expect(mapAfter.sales).toBe(customSalesAccountId);

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId: f.pharmacyId,
      brandName: 'Cetirizine 10mg',
      mrpPaisa: 300,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(batches).values({
      id: batchId,
      pharmacyId: f.pharmacyId,
      productId,
      batchNo: 'CET-01',
      expiryDate: '2028-12-31',
      costPaisa: 150,
      mrpPaisa: 300,
      createdAt: now,
      updatedAt: now,
    });

    const invoiceId = generateUuidV7();
    const ev: SyncEventEnvelope = {
      eventId: generateUuidV7(),
      deviceSeq: 1,
      type: 'invoice.created',
      entityId: invoiceId,
      occurredAt: now,
      schemaVersion: 1,
      payload: {
        id: invoiceId,
        counterId: f.counterId,
        cashierUserId: f.cashierUserId,
        invoiceNumber: 'INV-MAP-01',
        clientRequestId: generateUuidV7(),
        status: 'finalized',
        subtotalPaisa: 1500,
        discountPaisa: 0,
        taxPaisa: 0,
        totalPaisa: 1500,
        createdAt: now,
        lines: [
          {
            id: generateUuidV7(),
            productId,
            batchId,
            quantity: 5,
            unitPricePaisa: 300,
            discountPaisa: 0,
            taxRateBp: 0,
            taxPaisa: 0,
            lineTotalPaisa: 1500,
          },
        ],
        payments: [{ id: generateUuidV7(), method: 'cash', amountPaisa: 1500 }],
      },
    };

    const res = await processSyncPushEvents(ctx.db, f.deviceContext, [ev]);
    expect(res[0]?.status).toBe('accepted');

    const [entry] = await ctx.db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.pharmacyId, f.pharmacyId),
          eq(journalEntries.sourceType, 'invoice'),
          eq(journalEntries.sourceId, invoiceId)
        )
      );

    const lines = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, entry!.id));

    expect(lines.find((l) => l.accountId === customSalesAccountId)?.creditPaisa).toBe(1500);
  });

  it('8. backfillLedgerEntries supports dryRun without writing and idempotently backfills unposted historical documents', async () => {
    const f = await createPharmacyFixture('BF08');
    const now = '2026-11-03T17:00:00.000Z';
    const productId = generateUuidV7();
    const batchId = generateUuidV7();
    const purchaseId = generateUuidV7();
    const invoiceId = generateUuidV7();
    const invLineId = generateUuidV7();
    const cnId = generateUuidV7();
    const adjMovementId = generateUuidV7();

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId: f.pharmacyId,
      brandName: 'Azithromycin 500mg',
      mrpPaisa: 1500,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(batches).values({
      id: batchId,
      pharmacyId: f.pharmacyId,
      productId,
      batchNo: 'AZI-01',
      expiryDate: '2028-12-31',
      costPaisa: 900,
      mrpPaisa: 1500,
      createdAt: now,
      updatedAt: now,
    });

    // Insert historical purchase stock movement directly (no journal entry yet)
    await ctx.db.insert(stockMovements).values({
      id: generateUuidV7(),
      pharmacyId: f.pharmacyId,
      productId,
      batchId,
      branchId: f.branchId,
      type: 'purchase',
      quantitySigned: 40,
      referenceType: 'purchase',
      referenceId: purchaseId,
      reason: 'GRN: SUP-BF-01',
      createdAt: now,
      updatedAt: now,
    });

    // Insert historical invoice + line + payment + sale movement directly (no journal entry yet)
    await ctx.db.insert(invoices).values({
      id: invoiceId,
      pharmacyId: f.pharmacyId,
      counterId: f.counterId,
      cashierUserId: f.cashierUserId,
      invoiceNumber: 'INV-BF-01',
      clientRequestId: generateUuidV7(),
      status: 'finalized',
      subtotalPaisa: 6000,
      discountPaisa: 0,
      taxPaisa: 300,
      totalPaisa: 6300,
      createdAt: now,
    });

    await ctx.db.insert(invoiceLines).values({
      id: invLineId,
      pharmacyId: f.pharmacyId,
      invoiceId,
      productId,
      batchId,
      quantity: 4,
      unitPricePaisa: 1500,
      discountPaisa: 0,
      taxRateBp: 500,
      taxPaisa: 300,
      lineTotalPaisa: 6300,
    });

    await ctx.db.insert(payments).values({
      id: generateUuidV7(),
      pharmacyId: f.pharmacyId,
      invoiceId,
      method: 'cash',
      amountPaisa: 6300,
    });

    await ctx.db.insert(stockMovements).values({
      id: generateUuidV7(),
      pharmacyId: f.pharmacyId,
      productId,
      batchId,
      branchId: f.branchId,
      type: 'sale',
      quantitySigned: -4,
      referenceType: 'invoice',
      referenceId: invoiceId,
      reason: 'Sale #INV-BF-01',
      createdAt: now,
      updatedAt: now,
    });

    // Insert historical credit note + line + return movement directly (no journal entry yet)
    await ctx.db.insert(creditNotes).values({
      id: cnId,
      pharmacyId: f.pharmacyId,
      creditNoteNumber: 'CN-BF-01',
      originalInvoiceId: invoiceId,
      branchId: f.branchId,
      counterId: f.counterId,
      cashierUserId: f.cashierUserId,
      clientRequestId: generateUuidV7(),
      subtotalPaisa: 1500,
      taxPaisa: 75,
      totalPaisa: 1575,
      refundMethod: 'cash',
      reason: 'Damaged outer box',
      createdAt: now,
    });

    await ctx.db.insert(creditNoteLines).values({
      id: generateUuidV7(),
      pharmacyId: f.pharmacyId,
      creditNoteId: cnId,
      originalInvoiceLineId: invLineId,
      productId,
      batchId,
      quantity: 1,
      unitPricePaisa: 1500,
      taxRateBp: 500,
      taxPaisa: 75,
      lineTotalPaisa: 1575,
    });

    await ctx.db.insert(stockMovements).values({
      id: generateUuidV7(),
      pharmacyId: f.pharmacyId,
      productId,
      batchId,
      branchId: f.branchId,
      type: 'return',
      quantitySigned: 1,
      referenceType: 'credit_note',
      referenceId: cnId,
      reason: 'Return #CN-BF-01',
      createdAt: now,
      updatedAt: now,
    });

    // Insert historical stock adjustment directly (no journal entry yet)
    await ctx.db.insert(stockMovements).values({
      id: adjMovementId,
      pharmacyId: f.pharmacyId,
      productId,
      batchId,
      branchId: f.branchId,
      type: 'adjustment',
      quantitySigned: -2,
      referenceType: 'stock_adjustment',
      referenceId: adjMovementId,
      reason: 'Damaged vials',
      createdAt: now,
      updatedAt: now,
    });

    // 1. Run dryRun: true -> must report 4 documents to backfill and write 0 journal entries
    const drySummary = await backfillLedgerEntries(ctx.db, {
      pharmacyId: f.pharmacyId,
      dryRun: true,
    });

    expect(drySummary.dryRun).toBe(true);
    expect(drySummary.purchases.count).toBe(1);
    expect(drySummary.purchases.totalPaisa).toBe(40 * 900);
    expect(drySummary.invoices.count).toBe(1);
    expect(drySummary.invoices.totalPaisa).toBe(6300);
    expect(drySummary.creditNotes.count).toBe(1);
    expect(drySummary.creditNotes.totalPaisa).toBe(1575);
    expect(drySummary.stockAdjustments.count).toBe(1);
    expect(drySummary.stockAdjustments.totalPaisa).toBe(2 * 900);
    expect(drySummary.totalEntriesPosted).toBe(4);

    const entriesAfterDryRun = await ctx.db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.pharmacyId, f.pharmacyId));
    expect(entriesAfterDryRun).toHaveLength(0);

    // 2. Run dryRun: false -> must post all 4 journal entries
    const liveSummary = await backfillLedgerEntries(ctx.db, {
      pharmacyId: f.pharmacyId,
      dryRun: false,
    });
    expect(liveSummary.dryRun).toBe(false);
    expect(liveSummary.totalEntriesPosted).toBe(4);

    const entriesAfterLive = await ctx.db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.pharmacyId, f.pharmacyId));
    expect(entriesAfterLive).toHaveLength(4);

    // 3. Re-run dryRun: false -> idempotent, posts 0 new entries
    const secondRun = await backfillLedgerEntries(ctx.db, {
      pharmacyId: f.pharmacyId,
      dryRun: false,
    });
    expect(secondRun.totalEntriesPosted).toBe(0);

    // 4. Reconcile after backfill -> must reconcile with 0 difference
    const recon = await reconcileLedger(ctx.db, f.pharmacyId, '2026-01-01', '2026-12-31');
    expect(recon.isReconciled).toBe(true);
    expect(recon.salesDifferencePaisa).toBe(0);
    expect(recon.netSalesDifferencePaisa).toBe(0);
    expect(recon.inventoryDifferencePaisa).toBe(0);
  });

  it('9. 1,000-random-transactions acceptance test: trial balance debits = credits, balance sheet equation holds, and reconciliation differences equal zero', async () => {
    const f = await createPharmacyFixture('RAND1000');
    const prng = createPrng(20261103);
    const now = '2026-11-03T12:00:00.000Z';

    // Create 5 products and 10 batches with varying positive costs
    const productIds: string[] = [];
    const batchRecords: Array<{
      id: string;
      productId: string;
      costPaisa: number;
      mrpPaisa: number;
    }> = [];

    const prodRows = [];
    const batchRows = [];

    for (let p = 0; p < 5; p++) {
      const pid = generateUuidV7();
      productIds.push(pid);
      prodRows.push({
        id: pid,
        pharmacyId: f.pharmacyId,
        brandName: `Random Med ${p + 1}`,
        mrpPaisa: (p + 2) * 1000,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      for (let b = 0; b < 2; b++) {
        const bid = generateUuidV7();
        const costPaisa = prng.nextInt(200, 1500);
        const mrpPaisa = costPaisa + prng.nextInt(300, 1000);
        batchRecords.push({ id: bid, productId: pid, costPaisa, mrpPaisa });
        batchRows.push({
          id: bid,
          pharmacyId: f.pharmacyId,
          productId: pid,
          batchNo: `B-${p + 1}-${b + 1}`,
          expiryDate: '2028-12-31',
          costPaisa,
          mrpPaisa,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    await ctx.db.insert(products).values(prodRows);
    await ctx.db.insert(batches).values(batchRows);

    interface RecordedInvoiceLine {
      id: string;
      invoiceId: string;
      productId: string;
      batchId: string;
      quantity: number;
      returnedQty: number;
      unitPricePaisa: number;
      taxRateBp: number;
    }

    const availableInvoiceLines: RecordedInvoiceLine[] = [];
    const dates = [
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ] as const;
    const paymentMethods = ['cash', 'card', 'wallet'] as const;
    const refundMethods = ['cash', 'card', 'wallet', 'credit'] as const;

    // Run 1,000 randomized transactions inside a single transaction for speed, while still invoking
    // the exact posting functions and database-level triggers
    await ctx.db.transaction(async (tx) => {
      for (let i = 0; i < 1000; i++) {
        const dateStr = prng.pick(dates);
        const timestamp = `${dateStr}T10:00:00.000Z`;
        const branchId = i % 3 === 0 ? f.branch2Id : f.branchId;

        // First 50 transactions are purchases so stock is plentiful; afterwards mix all 4 document types
        const roll = i < 50 ? 0 : prng.nextInt(0, 99);

        if (roll < 25) {
          // 1. purchase.received
          const purchaseId = generateUuidV7();
          const numLines = prng.nextInt(1, 3);
          const chosenBatches = [];
          const pLines = [];
          let invCostSum = 0;

          for (let l = 0; l < numLines; l++) {
            const b = prng.pick(batchRecords);
            const qty = prng.nextInt(20, 100);
            invCostSum += qty * b.costPaisa;
            chosenBatches.push({
              id: b.id,
              productId: b.productId,
              batchNo: `B-${l}`,
              expiryDate: '2028-12-31',
              costPaisa: b.costPaisa,
              mrpPaisa: b.mrpPaisa,
            });
            const movId = generateUuidV7();
            pLines.push({
              id: movId,
              movementId: movId,
              productId: b.productId,
              batchId: b.id,
              quantity: qty,
              costPaisa: b.costPaisa,
              mrpPaisa: b.mrpPaisa,
            });

            await tx.insert(stockMovements).values({
              id: movId,
              pharmacyId: f.pharmacyId,
              productId: b.productId,
              batchId: b.id,
              branchId,
              type: 'purchase',
              quantitySigned: qty,
              referenceType: 'purchase',
              referenceId: purchaseId,
              reason: `GRN #${i + 1}`,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }

          const inputTaxPaisa = prng.nextInt(0, 1) === 1 ? prng.nextInt(100, 2000) : 0;
          await postPurchaseReceived(tx, {
            pharmacyId: f.pharmacyId,
            createdBy: f.ownerUserId,
            payload: {
              purchase: {
                id: purchaseId,
                branchId,
                supplierId: f.supplierId,
                supplierInvoiceNo: `SUP-${i + 1}`,
                invoiceDate: dateStr,
                totalCostPaisa: invCostSum + inputTaxPaisa,
                taxPaisa: inputTaxPaisa,
                createdAt: timestamp,
              },
              batches: chosenBatches,
              lines: pLines,
            },
          });
        } else if (roll < 70 || availableInvoiceLines.length === 0) {
          // 2. invoice.created (1 to 3 batch lines, optional discount & tax, 1 or 2 split payments)
          const invoiceId = generateUuidV7();
          const numLines = prng.nextInt(1, 3);
          const invLinesInput = [];
          const invLinesDb = [];
          const movsDb = [];
          let subtotalPaisa = 0;
          let discountPaisa = 0;
          let taxPaisa = 0;
          let totalPaisa = 0;

          for (let l = 0; l < numLines; l++) {
            const b = prng.pick(batchRecords);
            const qty = prng.nextInt(1, 8);
            const unitPricePaisa = b.mrpPaisa;
            const lineSubtotal = qty * unitPricePaisa;
            const lineDiscount = prng.nextInt(0, 1) === 1 ? prng.nextInt(0, Math.floor(lineSubtotal * 0.1)) : 0;
            const taxRateBp = prng.nextInt(0, 1) === 1 ? 500 : 0;
            const netAfterDisc = lineSubtotal - lineDiscount;
            const lineTax = Math.round((netAfterDisc * taxRateBp) / 10000);
            const lineTotal = netAfterDisc + lineTax;
            const lineId = generateUuidV7();

            subtotalPaisa += lineSubtotal;
            discountPaisa += lineDiscount;
            taxPaisa += lineTax;
            totalPaisa += lineTotal;

            invLinesInput.push({
              id: lineId,
              productId: b.productId,
              batchId: b.id,
              quantity: qty,
              unitPricePaisa,
              discountPaisa: lineDiscount,
              taxRateBp,
              taxPaisa: lineTax,
              lineTotalPaisa: lineTotal,
            });

            invLinesDb.push({
              id: lineId,
              pharmacyId: f.pharmacyId,
              invoiceId,
              productId: b.productId,
              batchId: b.id,
              quantity: qty,
              unitPricePaisa,
              discountPaisa: lineDiscount,
              taxRateBp,
              taxPaisa: lineTax,
              lineTotalPaisa: lineTotal,
            });

            movsDb.push({
              id: lineId,
              pharmacyId: f.pharmacyId,
              productId: b.productId,
              batchId: b.id,
              branchId,
              type: 'sale' as const,
              quantitySigned: -qty,
              referenceType: 'invoice',
              referenceId: invoiceId,
              reason: `Sale #INV-${i + 1}`,
              createdAt: timestamp,
              updatedAt: timestamp,
            });

            availableInvoiceLines.push({
              id: lineId,
              invoiceId,
              productId: b.productId,
              batchId: b.id,
              quantity: qty,
              returnedQty: 0,
              unitPricePaisa,
              taxRateBp,
            });
          }

          // Split or single payment
          const invoicePayments = [];
          if (prng.nextInt(0, 1) === 1 && totalPaisa > 200) {
            const firstPart = Math.floor(totalPaisa / 2);
            const secondPart = totalPaisa - firstPart;
            invoicePayments.push(
              { id: generateUuidV7(), method: 'cash' as const, amountPaisa: firstPart },
              { id: generateUuidV7(), method: 'card' as const, amountPaisa: secondPart }
            );
          } else {
            invoicePayments.push({
              id: generateUuidV7(),
              method: prng.pick(paymentMethods),
              amountPaisa: totalPaisa,
            });
          }

          await tx.insert(invoices).values({
            id: invoiceId,
            pharmacyId: f.pharmacyId,
            counterId: f.counterId,
            cashierUserId: f.cashierUserId,
            invoiceNumber: `INV-RND-${i + 1}`,
            clientRequestId: generateUuidV7(),
            status: 'finalized',
            subtotalPaisa,
            discountPaisa,
            taxPaisa,
            totalPaisa,
            createdAt: timestamp,
          });
          await tx.insert(invoiceLines).values(invLinesDb);
          await tx.insert(stockMovements).values(movsDb);
          await tx.insert(payments).values(
            invoicePayments.map((p) => ({
              id: p.id,
              pharmacyId: f.pharmacyId,
              invoiceId,
              method: p.method,
              amountPaisa: p.amountPaisa,
            }))
          );

          await postInvoiceCreated(tx, {
            pharmacyId: f.pharmacyId,
            branchId,
            createdBy: f.cashierUserId,
            invoice: {
              id: invoiceId,
              counterId: f.counterId,
              cashierUserId: f.cashierUserId,
              invoiceNumber: `INV-RND-${i + 1}`,
              clientRequestId: invoiceId,
              status: 'finalized',
              subtotalPaisa,
              discountPaisa,
              taxPaisa,
              totalPaisa,
              createdAt: timestamp,
              lines: invLinesInput,
              payments: invoicePayments,
            },
          });
        } else if (roll < 85) {
          // 3. credit_note.created against a prior invoice line with remaining returnable quantity
          const candidates = availableInvoiceLines.filter((l) => l.quantity - l.returnedQty > 0);
          if (candidates.length === 0) {
            // Fallback to stock adjustment if no returnable invoice lines right now
            const b = prng.pick(batchRecords);
            const movId = generateUuidV7();
            const qtySigned = prng.nextInt(1, 5);
            await tx.insert(stockMovements).values({
              id: movId,
              pharmacyId: f.pharmacyId,
              productId: b.productId,
              batchId: b.id,
              branchId,
              type: 'adjustment',
              quantitySigned: qtySigned,
              referenceType: 'stock_adjustment',
              referenceId: movId,
              reason: `Adj #${i + 1}`,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            await postStockAdjustmentCreated(tx, {
              pharmacyId: f.pharmacyId,
              movementId: movId,
              branchId,
              productId: b.productId,
              batchId: b.id,
              quantitySigned: qtySigned,
              reason: `Adj #${i + 1}`,
              createdAt: timestamp,
              createdBy: f.ownerUserId,
            });
          } else {
            const target = prng.pick(candidates);
            const returnQty = prng.nextInt(1, target.quantity - target.returnedQty);
            target.returnedQty += returnQty;

            const cnId = generateUuidV7();
            const cnLineId = generateUuidV7();
            const subtotalPaisa = returnQty * target.unitPricePaisa;
            const taxPaisa = Math.round((subtotalPaisa * target.taxRateBp) / 10000);
            const totalPaisa = subtotalPaisa + taxPaisa;
            const refundMethod = prng.pick(refundMethods);

            await tx.insert(creditNotes).values({
              id: cnId,
              pharmacyId: f.pharmacyId,
              creditNoteNumber: `CN-RND-${i + 1}`,
              originalInvoiceId: target.invoiceId,
              branchId,
              counterId: f.counterId,
              cashierUserId: f.cashierUserId,
              clientRequestId: generateUuidV7(),
              subtotalPaisa,
              taxPaisa,
              totalPaisa,
              refundMethod,
              reason: 'Customer return',
              createdAt: timestamp,
            });

            await tx.insert(creditNoteLines).values({
              id: cnLineId,
              pharmacyId: f.pharmacyId,
              creditNoteId: cnId,
              originalInvoiceLineId: target.id,
              productId: target.productId,
              batchId: target.batchId,
              quantity: returnQty,
              unitPricePaisa: target.unitPricePaisa,
              taxRateBp: target.taxRateBp,
              taxPaisa,
              lineTotalPaisa: totalPaisa,
            });

            await tx.insert(stockMovements).values({
              id: cnLineId,
              pharmacyId: f.pharmacyId,
              productId: target.productId,
              batchId: target.batchId,
              branchId,
              type: 'return',
              quantitySigned: returnQty,
              referenceType: 'credit_note',
              referenceId: cnId,
              reason: `Return #CN-RND-${i + 1}`,
              createdAt: timestamp,
              updatedAt: timestamp,
            });

            await postCreditNoteCreated(tx, {
              pharmacyId: f.pharmacyId,
              createdBy: f.cashierUserId,
              creditNote: {
                id: cnId,
                creditNoteNumber: `CN-RND-${i + 1}`,
                originalInvoiceId: target.invoiceId,
                branchId,
                counterId: f.counterId,
                cashierUserId: f.cashierUserId,
                clientRequestId: cnId,
                subtotalPaisa,
                taxPaisa,
                totalPaisa,
                refundMethod,
                reason: 'Customer return',
                createdAt: timestamp,
                lines: [
                  {
                    id: cnLineId,
                    originalInvoiceLineId: target.id,
                    productId: target.productId,
                    batchId: target.batchId,
                    quantity: returnQty,
                    unitPricePaisa: target.unitPricePaisa,
                    taxRateBp: target.taxRateBp,
                    taxPaisa,
                    lineTotalPaisa: totalPaisa,
                  },
                ],
              },
            });
          }
        } else {
          // 4. stock_adjustment.created (+ or - units)
          const b = prng.pick(batchRecords);
          const movId = generateUuidV7();
          const sign = prng.nextInt(0, 1) === 1 ? 1 : -1;
          const qtySigned = sign * prng.nextInt(1, 5);

          await tx.insert(stockMovements).values({
            id: movId,
            pharmacyId: f.pharmacyId,
            productId: b.productId,
            batchId: b.id,
            branchId,
            type: 'adjustment',
            quantitySigned: qtySigned,
            referenceType: 'stock_adjustment',
            referenceId: movId,
            reason: `Cycle count #${i + 1}`,
            createdAt: timestamp,
            updatedAt: timestamp,
          });

          await postStockAdjustmentCreated(tx, {
            pharmacyId: f.pharmacyId,
            movementId: movId,
            branchId,
            productId: b.productId,
            batchId: b.id,
            quantitySigned: qtySigned,
            reason: `Cycle count #${i + 1}`,
            createdAt: timestamp,
            createdBy: f.ownerUserId,
          });
        }
      }
    });

    // 1. Verify all 1,000 journal entries were created
    const [entryCountRow] = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(journalEntries)
      .where(eq(journalEntries.pharmacyId, f.pharmacyId));
    expect(Number(entryCountRow?.count)).toBe(1000);

    // 2. Verify Trial Balance has total debits === total credits
    const tb = await trialBalance(ctx.db, f.pharmacyId, '2026-11-01', '2026-11-05');
    expect(tb.isBalanced).toBe(true);
    expect(tb.totalDebitPaisa).toBeGreaterThan(0);
    expect(tb.totalDebitPaisa).toBe(tb.totalCreditPaisa);

    // 3. Verify Balance Sheet equation: Assets = Liabilities + Equity + Current Period Profit (Revenue - Expense)
    // Using normal sign conventions:
    // Asset net (Dr - Cr), Liability net (Cr - Dr), Equity net (Cr - Dr), Revenue net (Cr - Dr), Expense net (Dr - Cr)
    let assetsNetPaisa = 0;
    let liabilitiesNetPaisa = 0;
    let equityNetPaisa = 0;
    let revenueNetPaisa = 0;
    let expenseNetPaisa = 0;

    for (const row of tb.rows) {
      if (row.type === 'asset') {
        assetsNetPaisa += row.totalDebitPaisa - row.totalCreditPaisa;
      } else if (row.type === 'liability') {
        liabilitiesNetPaisa += row.totalCreditPaisa - row.totalDebitPaisa;
      } else if (row.type === 'equity') {
        equityNetPaisa += row.totalCreditPaisa - row.totalDebitPaisa;
      } else if (row.type === 'revenue') {
        revenueNetPaisa += row.totalCreditPaisa - row.totalDebitPaisa;
      } else if (row.type === 'expense') {
        expenseNetPaisa += row.totalDebitPaisa - row.totalCreditPaisa;
      }
    }

    const currentPeriodProfitPaisa = revenueNetPaisa - expenseNetPaisa;
    expect(assetsNetPaisa).toBe(liabilitiesNetPaisa + equityNetPaisa + currentPeriodProfitPaisa);

    // 4. Verify Reconciliation query equals zero across the full date range and sub-ranges
    const reconFull = await reconcileLedger(ctx.db, f.pharmacyId, '2026-11-01', '2026-11-05');
    expect(reconFull.isReconciled).toBe(true);
    expect(reconFull.salesDifferencePaisa).toBe(0);
    expect(reconFull.netSalesDifferencePaisa).toBe(0);
    expect(reconFull.inventoryDifferencePaisa).toBe(0);

    const reconPartial = await reconcileLedger(ctx.db, f.pharmacyId, '2026-11-02', '2026-11-04');
    expect(reconPartial.isReconciled).toBe(true);
    expect(reconPartial.salesDifferencePaisa).toBe(0);
    expect(reconPartial.netSalesDifferencePaisa).toBe(0);
    expect(reconPartial.inventoryDifferencePaisa).toBe(0);
  }, 60000);
});
