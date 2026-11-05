import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { generateUuidV7, normalizePhone } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import {
  pharmacies,
  branches,
  counters,
  users,
  devices,
  products,
  batches,
  taxCategories,
  customers,
  invoices,
  journalLines,
  erpPayments,
} from '../db/schema';
import { seedDefaultChartOfAccounts, getPharmacyAccountMap } from '../ledger/coa-seed';
import { signUserToken, signDeviceToken } from '../auth/jwt';

describe('Customers & Master Data Sync, Credit Sales & Counter Receipts', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchA1Id: string;
  let counterA1Id: string;
  let counterA2Id: string;
  let deviceA1Id: string;
  let deviceA2Id: string;
  let deviceTokenA1: string;
  let deviceTokenA2: string;

  let ownerTokenA: string;
  let cashierTokenA: string;
  let ownerTokenB: string;

  let productId: string;
  let batchId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });
    const db = ctx.db;
    const nowIso = new Date().toISOString();

    // 1. Setup Pharmacy A
    pharmacyAId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyAId,
      name: 'Customer Test Pharmacy A',
      code: 'CTPA',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await seedDefaultChartOfAccounts(db, pharmacyAId);

    // 2. Setup Pharmacy B (for isolation checks)
    pharmacyBId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyBId,
      name: 'Customer Test Pharmacy B',
      code: 'CTPB',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await seedDefaultChartOfAccounts(db, pharmacyBId);

    // 3. Branch & Counters for Pharmacy A
    branchA1Id = generateUuidV7();
    await db.insert(branches).values({
      id: branchA1Id,
      pharmacyId: pharmacyAId,
      name: 'Main Branch A1',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    counterA1Id = generateUuidV7();
    await db.insert(counters).values({
      id: counterA1Id,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      name: 'Counter 1',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    counterA2Id = generateUuidV7();
    await db.insert(counters).values({
      id: counterA2Id,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      name: 'Counter 2',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 4. Users & Auth Tokens
    const ownerAId = generateUuidV7();
    await db.insert(users).values({
      id: ownerAId,
      pharmacyId: pharmacyAId,
      name: 'Owner A',
      role: 'owner',
      pinHash: '$2b$10$xyz',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    ownerTokenA = signUserToken({
      userId: ownerAId,
      pharmacyId: pharmacyAId,
      role: 'owner',
      name: 'Owner A',
    });

    const cashierAId = generateUuidV7();
    await db.insert(users).values({
      id: cashierAId,
      pharmacyId: pharmacyAId,
      name: 'Cashier A',
      role: 'cashier',
      pinHash: '$2b$10$xyz',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    cashierTokenA = signUserToken({
      userId: cashierAId,
      pharmacyId: pharmacyAId,
      role: 'cashier',
      name: 'Cashier A',
    });

    const ownerBId = generateUuidV7();
    await db.insert(users).values({
      id: ownerBId,
      pharmacyId: pharmacyBId,
      name: 'Owner B',
      role: 'owner',
      pinHash: '$2b$10$xyz',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    ownerTokenB = signUserToken({
      userId: ownerBId,
      pharmacyId: pharmacyBId,
      role: 'owner',
      name: 'Owner B',
    });

    // 5. Devices
    deviceA1Id = generateUuidV7();
    await db.insert(devices).values({
      id: deviceA1Id,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      counterId: counterA1Id,
      deviceName: 'Terminal 1',
      deviceFingerprint: 'fp-1',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    deviceTokenA1 = signDeviceToken({
      deviceId: deviceA1Id,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
    });

    deviceA2Id = generateUuidV7();
    await db.insert(devices).values({
      id: deviceA2Id,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
      counterId: counterA2Id,
      deviceName: 'Terminal 2',
      deviceFingerprint: 'fp-2',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    deviceTokenA2 = signDeviceToken({
      deviceId: deviceA2Id,
      pharmacyId: pharmacyAId,
      branchId: branchA1Id,
    });

    // 6. Product and Batch for Sales
    const taxCatId = generateUuidV7();
    await db.insert(taxCategories).values({
      id: taxCatId,
      pharmacyId: pharmacyAId,
      name: 'Standard GST',
      rateBp: 0,
      isExempt: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    productId = generateUuidV7();
    await db.insert(products).values({
      id: productId,
      pharmacyId: pharmacyAId,
      brandName: 'Panadol 500mg',
      genericName: 'Paracetamol',
      mrpPaisa: 1000, // 10 PKR
      taxCategoryId: taxCatId,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    batchId = generateUuidV7();
    await db.insert(batches).values({
      id: batchId,
      pharmacyId: pharmacyAId,
      productId,
      batchNo: 'B-PANA-01',
      expiryDate: '2027-12-31',
      costPaisa: 600, // 6 PKR
      mrpPaisa: 1000,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('phone normalization formats Pakistani numbers properly', () => {
    expect(normalizePhone('03001234567')).toBe('03001234567');
    expect(normalizePhone('+923001234567')).toBe('03001234567');
    expect(normalizePhone('923001234567')).toBe('03001234567');
    expect(normalizePhone('0300-1234567')).toBe('03001234567');
    expect(normalizePhone('0300 1234567')).toBe('03001234567');
    expect(normalizePhone('3001234567')).toBe('03001234567');
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('counter pushes customer.created event; duplicates flagged by phone', async () => {
    const customer1Id = generateUuidV7();
    const customer2Id = generateUuidV7();
    const commonPhone = '+92 300 9876543'; // Normalizes to 03009876543
    const nowIso = new Date().toISOString();

    // 1. Counter 1 creates Customer 1
    const res1 = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: {
        authorization: `Bearer ${deviceTokenA1}`,
      },
      payload: {
        events: [
          {
            eventId: generateUuidV7(),
            deviceSeq: 1,
            type: 'customer.created',
            entityId: customer1Id,
            occurredAt: nowIso,
            schemaVersion: 1,
            payload: {
              id: customer1Id,
              name: 'Muhammad Ali',
              phone: commonPhone,
              creditLimitPaisa: 1000000, // 10,000 PKR credit limit
              openingBalancePaisa: 0,
              priceTier: 'retail',
              createdAt: nowIso,
            },
          },
        ],
      },
    });

    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.results[0].status).toBe('accepted');

    const [savedC1] = await ctx.db.select().from(customers).where(eq(customers.id, customer1Id));
    expect(savedC1).toBeDefined();
    expect(savedC1?.name).toBe('Muhammad Ali');
    expect(savedC1?.phone).toBe('03009876543');
    expect(savedC1?.isDuplicate).toBe(false);
    expect(savedC1?.duplicateOfId).toBeNull();

    // 2. Counter 2 creates Customer 2 with same phone -> must be flagged as duplicate
    const res2 = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: {
        authorization: `Bearer ${deviceTokenA2}`,
      },
      payload: {
        events: [
          {
            eventId: generateUuidV7(),
            deviceSeq: 1,
            type: 'customer.created',
            entityId: customer2Id,
            occurredAt: nowIso,
            schemaVersion: 1,
            payload: {
              id: customer2Id,
              name: 'M. Ali Duplicate',
              phone: '0300-9876543', // Same normalized phone
              creditLimitPaisa: 500000,
              createdAt: nowIso,
            },
          },
        ],
      },
    });

    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.results[0].status).toBe('accepted');

    const [savedC2] = await ctx.db.select().from(customers).where(eq(customers.id, customer2Id));
    expect(savedC2).toBeDefined();
    expect(savedC2?.isDuplicate).toBe(true);
    expect(savedC2?.duplicateOfId).toBe(customer1Id);
  });

  it('two counters sell on credit to one customer offline, then sync; flags credit limit exceeded without rejecting', async () => {
    const customerId = generateUuidV7();
    const nowIso = new Date().toISOString();

    // Create a customer with 50,000 paisa (Rs 500) credit limit
    await ctx.db.insert(customers).values({
      id: customerId,
      pharmacyId: pharmacyAId,
      name: 'Credit Test Customer',
      phone: '03112223344',
      creditLimitPaisa: 50000, // 500 PKR limit
      openingBalancePaisa: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const invoice1Id = generateUuidV7();
    const invoice2Id = generateUuidV7();

    // Counter 1 sells 30,000 paisa (30 units @ 10 PKR) on credit (within 50,000 limit)
    const res1 = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: {
        authorization: `Bearer ${deviceTokenA1}`,
      },
      payload: {
        events: [
          {
            eventId: generateUuidV7(),
            deviceSeq: 2,
            type: 'invoice.created',
            entityId: invoice1Id,
            occurredAt: nowIso,
            schemaVersion: 1,
            payload: {
              id: invoice1Id,
              counterId: counterA1Id,
              cashierUserId: (
                await ctx.db.select().from(users).where(eq(users.pharmacyId, pharmacyAId)).limit(1)
              )[0]!.id,
              invoiceNumber: 'INV-A1-001',
              clientRequestId: 'req-inv-1',
              subtotalPaisa: 30000,
              taxPaisa: 0,
              totalPaisa: 30000,
              customerId,
              createdAt: nowIso,
              lines: [
                {
                  id: generateUuidV7(),
                  productId,
                  batchId,
                  quantity: 30,
                  unitPricePaisa: 1000,
                  taxPaisa: 0,
                  lineTotalPaisa: 30000,
                },
              ],
              payments: [
                {
                  id: generateUuidV7(),
                  method: 'credit',
                  amountPaisa: 30000,
                },
              ],
            },
          },
        ],
      },
    });

    expect(res1.statusCode).toBe(200);
    expect(res1.json().results[0].status).toBe('accepted');

    const [inv1] = await ctx.db.select().from(invoices).where(eq(invoices.id, invoice1Id));
    expect(inv1).toBeDefined();
    expect(inv1?.creditLimitExceeded).toBe(false);

    // Counter 2 sells 35,000 paisa on credit offline (Total = 65,000 > 50,000 limit)
    // Rule: Offline credit sales exceeding limit must be recorded and flagged for review, NOT dropped or rejected!
    const res2 = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: {
        authorization: `Bearer ${deviceTokenA2}`,
      },
      payload: {
        events: [
          {
            eventId: generateUuidV7(),
            deviceSeq: 2,
            type: 'invoice.created',
            entityId: invoice2Id,
            occurredAt: nowIso,
            schemaVersion: 1,
            payload: {
              id: invoice2Id,
              counterId: counterA2Id,
              cashierUserId: (
                await ctx.db.select().from(users).where(eq(users.pharmacyId, pharmacyAId)).limit(1)
              )[0]!.id,
              invoiceNumber: 'INV-A2-001',
              clientRequestId: 'req-inv-2',
              subtotalPaisa: 35000,
              taxPaisa: 0,
              totalPaisa: 35000,
              customerId,
              createdAt: nowIso,
              lines: [
                {
                  id: generateUuidV7(),
                  productId,
                  batchId,
                  quantity: 35,
                  unitPricePaisa: 1000,
                  taxPaisa: 0,
                  lineTotalPaisa: 35000,
                },
              ],
              payments: [
                {
                  id: generateUuidV7(),
                  method: 'credit',
                  amountPaisa: 35000,
                },
              ],
            },
          },
        ],
      },
    });

    expect(res2.statusCode).toBe(200);
    expect(res2.json().results[0].status).toBe('accepted');

    const [inv2] = await ctx.db.select().from(invoices).where(eq(invoices.id, invoice2Id));
    expect(inv2).toBeDefined();
    expect(inv2?.creditLimitExceeded).toBe(true); // Flagged for review!
  });

  it('customer balance equals ledger sum of party lines; counter customer receipt decrements balance', async () => {
    const customerId = generateUuidV7();
    const nowIso = new Date().toISOString();

    // 1. Create customer
    await ctx.db.insert(customers).values({
      id: customerId,
      pharmacyId: pharmacyAId,
      name: 'Ledger Audit Customer',
      phone: '03335557788',
      creditLimitPaisa: 100000,
      openingBalancePaisa: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 2. Credit sale of 40,000 paisa
    const invoiceId = generateUuidV7();
    await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: {
        authorization: `Bearer ${deviceTokenA1}`,
      },
      payload: {
        events: [
          {
            eventId: generateUuidV7(),
            deviceSeq: 3,
            type: 'invoice.created',
            entityId: invoiceId,
            occurredAt: nowIso,
            schemaVersion: 1,
            payload: {
              id: invoiceId,
              counterId: counterA1Id,
              cashierUserId: (
                await ctx.db.select().from(users).where(eq(users.pharmacyId, pharmacyAId)).limit(1)
              )[0]!.id,
              invoiceNumber: 'INV-A1-002',
              clientRequestId: 'req-inv-3',
              subtotalPaisa: 40000,
              taxPaisa: 0,
              totalPaisa: 40000,
              customerId,
              createdAt: nowIso,
              lines: [
                {
                  id: generateUuidV7(),
                  productId,
                  batchId,
                  quantity: 40,
                  unitPricePaisa: 1000,
                  taxPaisa: 0,
                  lineTotalPaisa: 40000,
                },
              ],
              payments: [
                {
                  id: generateUuidV7(),
                  method: 'credit',
                  amountPaisa: 40000,
                },
              ],
            },
          },
        ],
      },
    });

    // Verify balance via customer API
    const resGet1 = await app.inject({
      method: 'GET',
      url: `/api/customers/${customerId}`,
      headers: {
        authorization: `Bearer ${cashierTokenA}`,
      },
    });
    expect(resGet1.statusCode).toBe(200);
    const bodyGet1 = resGet1.json();
    expect(bodyGet1.data.currentBalancePaisa).toBe(40000);

    // Verify against direct General Ledger lines for AR (1100) and this customer party
    const accountMap = await getPharmacyAccountMap(ctx.db, pharmacyAId);
    const jlRows = await ctx.db
      .select()
      .from(journalLines)
      .where(
        and(
          eq(journalLines.pharmacyId, pharmacyAId),
          eq(journalLines.accountId, accountMap.ar),
          eq(journalLines.partyType, 'customer'),
          eq(journalLines.partyId, customerId)
        )
      );
    const ledgerSum1 = jlRows.reduce((acc, l) => acc + l.debitPaisa - l.creditPaisa, 0);
    expect(bodyGet1.data.currentBalancePaisa).toBe(ledgerSum1);

    // 3. Counter collects cash customer receipt of 25,000 paisa
    const receiptPaymentId = generateUuidV7();
    const resReceipt = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: {
        authorization: `Bearer ${deviceTokenA1}`,
      },
      payload: {
        events: [
          {
            eventId: generateUuidV7(),
            deviceSeq: 4,
            type: 'customer_receipt.created',
            entityId: receiptPaymentId,
            occurredAt: nowIso,
            schemaVersion: 1,
            payload: {
              id: receiptPaymentId,
              paymentNumber: 'CR-A1-001',
              counterId: counterA1Id,
              customerId,
              customerName: 'Ledger Audit Customer',
              amountPaisa: 25000,
              method: 'cash',
              receiptDate: '2026-11-05',
              notes: 'Partial payment on counter',
              createdAt: nowIso,
            },
          },
        ],
      },
    });

    expect(resReceipt.statusCode).toBe(200);
    expect(resReceipt.json().results[0].status).toBe('accepted');

    // Verify ERP payment row was created
    const [savedPayment] = await ctx.db
      .select()
      .from(erpPayments)
      .where(eq(erpPayments.id, receiptPaymentId));
    expect(savedPayment).toBeDefined();
    expect(savedPayment?.amountPaisa).toBe(25000);
    expect(savedPayment?.direction).toBe('receipt');
    expect(savedPayment?.partyType).toBe('customer');

    // 4. Verify new balance matches ledger
    const resGet2 = await app.inject({
      method: 'GET',
      url: `/api/customers/${customerId}`,
      headers: {
        authorization: `Bearer ${cashierTokenA}`,
      },
    });
    expect(resGet2.statusCode).toBe(200);
    expect(resGet2.json().data.currentBalancePaisa).toBe(15000); // 40,000 - 25,000

    const jlRowsAfter = await ctx.db
      .select()
      .from(journalLines)
      .where(
        and(
          eq(journalLines.pharmacyId, pharmacyAId),
          eq(journalLines.accountId, accountMap.ar),
          eq(journalLines.partyType, 'customer'),
          eq(journalLines.partyId, customerId)
        )
      );
    const ledgerSumAfter = jlRowsAfter.reduce((acc, l) => acc + l.debitPaisa - l.creditPaisa, 0);
    expect(resGet2.json().data.currentBalancePaisa).toBe(ledgerSumAfter);
  });

  it('customer ledger and statement endpoints return correct balances and statement data', async () => {
    const customerId = generateUuidV7();
    const nowIso = new Date().toISOString();

    await ctx.db.insert(customers).values({
      id: customerId,
      pharmacyId: pharmacyAId,
      name: 'Statement Test Customer',
      phone: '03441112233',
      creditLimitPaisa: 200000,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // Ledger endpoint
    const resLedger = await app.inject({
      method: 'GET',
      url: `/api/customers/${customerId}/ledger`,
      headers: {
        authorization: `Bearer ${ownerTokenA}`,
      },
    });
    expect(resLedger.statusCode).toBe(200);
    expect(resLedger.json().data).toHaveProperty('lines');
    expect(resLedger.json().data).toHaveProperty('openingBalancePaisa');
    expect(resLedger.json().data).toHaveProperty('closingBalancePaisa');

    // Statement endpoint
    const resStatement = await app.inject({
      method: 'GET',
      url: `/api/customers/${customerId}/statement`,
      headers: {
        authorization: `Bearer ${ownerTokenA}`,
      },
    });
    expect(resStatement.statusCode).toBe(200);
    expect(resStatement.json().data).toHaveProperty('customer');
    expect(resStatement.json().data).toHaveProperty('pharmacy');
    expect(resStatement.json().data).toHaveProperty('period');
  });

  it('tenant isolation: Pharmacy B cannot access Pharmacy A customer', async () => {
    const customerId = generateUuidV7();
    const nowIso = new Date().toISOString();

    await ctx.db.insert(customers).values({
      id: customerId,
      pharmacyId: pharmacyAId,
      name: 'Tenant Private Customer',
      phone: '03998887766',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const resB = await app.inject({
      method: 'GET',
      url: `/api/customers/${customerId}`,
      headers: {
        authorization: `Bearer ${ownerTokenB}`,
      },
    });
    expect(resB.statusCode).toBe(404);
  });
});
