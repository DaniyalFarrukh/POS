import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7 } from '@pos/shared';
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
  accounts,
  customers,
  invoices,
  invoiceLines,
  batches,
  products,
} from '../db/schema';
import { seedDefaultChartOfAccounts } from './coa-seed';
import { postCreditNoteCreated, postExpenseCompleted, postInvoiceCreated } from './posting-engine';
import { getMonthEndChecklist } from './period-close';
import { eq, and } from 'drizzle-orm';
import { applyCustomerCreated } from '../sync/appliers/customer';

describe('F-C-03: Subledger Control Reconciliation & Opening Balance Equity (D2)', () => {
  let ctx: TestDatabaseContext;

  beforeAll(async () => {
    const reachable = await isPostgresReachable();
    if (!reachable) {
      throw new Error('PostgreSQL must be running for ledger tests.');
    }
    ctx = await createTestContext();
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  async function createFixture() {
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const userId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: 'Subledger Test Pharmacy',
      code: `SUB-${Date.now().toString().slice(-4)}`,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(branches).values({
      id: branchId,
      pharmacyId,
      name: 'Main Branch',
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(counters).values({
      id: counterId,
      pharmacyId,
      branchId,
      name: 'Counter 1',
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(users).values({
      id: userId,
      pharmacyId,
      name: 'Test Owner',
      role: 'owner',
      pinHash: 'hash',
      createdAt: now,
      updatedAt: now,
    });

    await seedDefaultChartOfAccounts(ctx.db, pharmacyId);
    return { pharmacyId, branchId, counterId, userId, now };
  }

  it('F-C-03: postCreditNoteCreated attaches customer partyId when refundMethod is credit', async () => {
    const { pharmacyId, branchId, counterId, userId, now } = await createFixture();

    const customerId = generateUuidV7();
    await ctx.db.insert(customers).values({
      id: customerId,
      pharmacyId,
      name: 'Credit Return Customer',
      phone: `0300${Date.now().toString().slice(-7)}`,
      creditLimitPaisa: 100_000,
      openingBalancePaisa: 0,
      createdAt: now,
      updatedAt: now,
    });

    const productId = generateUuidV7();
    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId,
      brandName: 'Test Med',
      mrpPaisa: 5000,
      createdAt: now,
      updatedAt: now,
    });

    const batchId = generateUuidV7();
    await ctx.db.insert(batches).values({
      id: batchId,
      pharmacyId,
      productId,
      batchNo: 'B-001',
      costPaisa: 3000,
      mrpPaisa: 5000,
      expiryDate: '2028-12-31',
      createdAt: now,
      updatedAt: now,
    });

    // Create an initial invoice on credit
    const invoiceId = generateUuidV7();
    const invLineId = generateUuidV7();
    await ctx.db.insert(invoices).values({
      id: invoiceId,
      pharmacyId,
      branchId,
      counterId,
      cashierUserId: userId,
      customerId,
      invoiceNumber: 'INV-TEST-001',
      clientRequestId: generateUuidV7(),
      status: 'finalized',
      subtotalPaisa: 5000,
      discountPaisa: 0,
      taxPaisa: 0,
      totalPaisa: 5000,
      createdAt: now,
    });

    await ctx.db.insert(invoiceLines).values({
      id: invLineId,
      pharmacyId,
      invoiceId,
      productId,
      batchId,
      quantity: 1,
      unitPricePaisa: 5000,
      discountPaisa: 0,
      taxPaisa: 0,
      lineTotalPaisa: 5000,
      totalPaisa: 5000,
      createdAt: now,
    });

    await ctx.db.transaction(async (tx) => {
      await postInvoiceCreated(tx, {
        pharmacyId,
        invoice: {
          id: invoiceId,
          invoiceNumber: 'INV-TEST-001',
          branchId,
          counterId,
          cashierUserId: userId,
          customerId,
          clientRequestId: generateUuidV7(),
          status: 'finalized',
          subtotalPaisa: 5000,
          discountPaisa: 0,
          taxPaisa: 0,
          totalPaisa: 5000,
          createdAt: now,
          lines: [
            {
              id: invLineId,
              productId,
              batchId,
              quantity: 1,
              unitPricePaisa: 5000,
              discountPaisa: 0,
              taxPaisa: 0,
              totalPaisa: 5000,
            },
          ],
          payments: [{ method: 'credit', amountPaisa: 5000 }],
        },
      });
    });

    // Now post a return with refundMethod: 'credit'
    const returnEntry = await ctx.db.transaction(async (tx) => {
      return await postCreditNoteCreated(tx, {
        pharmacyId,
        creditNote: {
          id: generateUuidV7(),
          creditNoteNumber: 'CN-TEST-001',
          originalInvoiceId: invoiceId,
          branchId,
          counterId,
          cashierUserId: userId,
          clientRequestId: generateUuidV7(),
          subtotalPaisa: 5000,
          taxPaisa: 0,
          totalPaisa: 5000,
          refundMethod: 'credit',
          reason: 'Customer return to store credit',
          createdAt: now,
          lines: [
            {
              id: generateUuidV7(),
              originalInvoiceLineId: invLineId,
              productId,
              batchId,
              quantity: 1,
              unitPricePaisa: 5000,
              taxPaisa: 0,
              totalPaisa: 5000,
            },
          ],
        },
      });
    });

    // Check that the credit line on AR has partyType='customer' and partyId=customerId
    const [arAcc] = await ctx.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.pharmacyId, pharmacyId), eq(accounts.code, '1100')));

    const arCreditLine = returnEntry.lines.find(
      (l) => l.accountId === arAcc!.id && l.creditPaisa === 5000
    );
    expect(arCreditLine).toBeDefined();
    expect(arCreditLine?.partyType).toBe('customer');
    expect(arCreditLine?.partyId).toBe(customerId);

    // Verify month-end checklist shows AR reconciled (count = 0)
    const checklist = await getMonthEndChecklist(ctx.db, pharmacyId, 2026, 11);
    const recon = checklist.items.find((i) => i.id === 'reconciliation_differences')!;
    expect(recon.status).toBe('passed');
    expect(recon.count).toBe(0);
  });

  it('F-C-03: postExpenseCompleted with credit credits 2300 Other Payables when no supplierId is given', async () => {
    const { pharmacyId, branchId, userId } = await createFixture();

    const [rentAcc] = await ctx.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.pharmacyId, pharmacyId), eq(accounts.code, '6010')));

    const [otherPayablesAcc] = await ctx.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.pharmacyId, pharmacyId), eq(accounts.code, '2300')));

    const expenseEntry = await ctx.db.transaction(async (tx) => {
      return await postExpenseCompleted(tx, {
        expenseId: generateUuidV7(),
        expenseNumber: 'EXP-UNLINKED-001',
        pharmacyId,
        branchId,
        expenseDate: '2026-11-05',
        expenseAccountId: rentAcc!.id,
        amountPaisa: 75_000,
        paymentType: 'credit',
        vendorName: 'Building Owner',
        createdBy: userId,
      });
    });

    const creditLine = expenseEntry.lines.find((l) => l.creditPaisa === 75_000);
    expect(creditLine).toBeDefined();
    expect(creditLine?.accountId).toBe(otherPayablesAcc!.id);

    // AP control account (2000) was untouched, so AP reconciliation stays at 0
    const checklist = await getMonthEndChecklist(ctx.db, pharmacyId, 2026, 11);
    const recon = checklist.items.find((i) => i.id === 'reconciliation_differences')!;
    expect(recon.status).toBe('passed');
    expect(recon.count).toBe(0);
  });

  it('F-C-03: applyCustomerCreated posts Dr 1100 AR / Cr 3300 Opening Balance Equity when openingBalancePaisa > 0', async () => {
    const { pharmacyId, branchId, counterId, now } = await createFixture();

    const customerId = generateUuidV7();
    await ctx.db.transaction(async (tx) => {
      await applyCustomerCreated(
        tx,
        {
          pharmacyId,
          branchId,
          counterId,
          deviceId: generateUuidV7(),
        },
        {
          id: customerId,
          name: 'Synced Opening Customer',
          phone: `0311${Date.now().toString().slice(-7)}`,
          openingBalancePaisa: 25_000,
          creditLimitPaisa: 50_000,
          createdAt: now,
        }
      );
    });

    // Check that an opening balance journal entry was posted
    const [openingBalEquityAcc] = await ctx.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.pharmacyId, pharmacyId), eq(accounts.code, '3300')));
    expect(openingBalEquityAcc).toBeDefined();

    const checklist = await getMonthEndChecklist(ctx.db, pharmacyId, 2026, 11);
    const recon = checklist.items.find((i) => i.id === 'reconciliation_differences')!;
    expect(recon.status).toBe('passed');
    expect(recon.count).toBe(0);
  });
});
