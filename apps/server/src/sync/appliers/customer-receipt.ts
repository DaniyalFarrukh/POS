import { eq } from 'drizzle-orm';
import { CustomerReceiptCreatedPayloadSchema } from '@pos/shared';
import { customers, erpPayments, branches, counters, users } from '../../db/schema';
import { SyncRejectedError, SyncRetryLaterError } from '../errors';
import type { ApplierContext, DbClient } from '../types';
import { verifyTenantEntity } from './common';
import { insertChangeLog } from '../change-log';
import { postFinancialPaymentCompleted } from '../../ledger/posting-engine';

export async function applyCustomerReceiptCreated(
  tx: DbClient,
  ctx: ApplierContext,
  rawPayload: unknown,
  entityId?: string
): Promise<void> {
  const parseResult = CustomerReceiptCreatedPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Invalid customer_receipt.created payload: ${parseResult.error.message}`
    );
  }

  const payload = parseResult.data;
  if (entityId && payload.id !== entityId) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Payload id (${payload.id}) does not match event entityId (${entityId})`
    );
  }

  // 1. Verify Customer
  const [cust] = await tx
    .select({ id: customers.id, pharmacyId: customers.pharmacyId, name: customers.name })
    .from(customers)
    .where(eq(customers.id, payload.customerId))
    .limit(1);

  if (!cust) {
    throw new SyncRetryLaterError(
      'UNKNOWN_CUSTOMER',
      `Customer ${payload.customerId} not found for pharmacy ${ctx.pharmacyId}`
    );
  }

  if (cust.pharmacyId !== ctx.pharmacyId) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Referenced customer ${payload.customerId} belongs to another pharmacy tenant`
    );
  }

  // 2. Resolve and verify Branch ID, Counter ID, and Cashier User ID
  if (payload.branchId) {
    if (ctx.branchId && payload.branchId !== ctx.branchId) {
      throw new SyncRejectedError(
        'CROSS_TENANT_REFERENCE',
        `Device branchId (${ctx.branchId}) does not match receipt branchId (${payload.branchId})`
      );
    }
    await verifyTenantEntity(
      tx,
      branches,
      payload.branchId,
      ctx.pharmacyId,
      'UNKNOWN_BRANCH',
      'branch'
    );
  }

  if (payload.counterId) {
    await verifyTenantEntity(
      tx,
      counters,
      payload.counterId,
      ctx.pharmacyId,
      'UNKNOWN_COUNTER',
      'counter'
    );
  }

  if (payload.cashierUserId) {
    await verifyTenantEntity(
      tx,
      users,
      payload.cashierUserId,
      ctx.pharmacyId,
      'UNKNOWN_USER',
      'cashierUser'
    );
  }

  let branchId: string | undefined = payload.branchId ?? ctx.branchId;
  if (!branchId) {
    const [b] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.pharmacyId, ctx.pharmacyId))
      .limit(1);
    branchId = b?.id;
  }

  if (!branchId) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Unable to resolve branchId for customer receipt ${payload.id}`
    );
  }
  const resolvedBranchId: string = branchId;

  const now = new Date().toISOString();
  const paymentMethod: 'cash' | 'bank' | 'wallet' =
    payload.method === 'card' ? 'bank' : payload.method;

  // 3. Post Financial Journal Entry
  let journalEntryId: string | null = null;
  if (typeof (tx as { execute?: unknown }).execute === 'function') {
    const entry = await postFinancialPaymentCompleted(tx, {
      pharmacyId: ctx.pharmacyId,
      paymentId: payload.id,
      paymentNumber: payload.paymentNumber,
      paymentDate: payload.receiptDate,
      branchId: resolvedBranchId,
      direction: 'receipt',
      partyType: 'customer',
      partyId: payload.customerId,
      partyName: payload.customerName || cust.name,
      method: paymentMethod,
      amountPaisa: payload.amountPaisa,
      allocatedPaisa: payload.amountPaisa,
      advancePaisa: 0,
      createdBy: payload.cashierUserId ?? null,
    });
    journalEntryId = entry.id;
  }

  // 4. Insert erpPayments record
  await tx.insert(erpPayments).values({
    id: payload.id,
    pharmacyId: ctx.pharmacyId,
    branchId: resolvedBranchId,
    paymentNumber: payload.paymentNumber,
    paymentDate: payload.receiptDate,
    direction: 'receipt',
    partyType: 'customer',
    partyId: payload.customerId,
    method: paymentMethod,
    amountPaisa: payload.amountPaisa,
    allocatedPaisa: payload.amountPaisa,
    advancePaisa: 0,
    counterId: payload.counterId ?? ctx.counterId ?? null,
    status: 'posted',
    journalEntryId,
    notes: payload.notes ?? null,
    createdBy: payload.cashierUserId ?? null,
    createdAt: payload.createdAt || now,
    updatedAt: payload.createdAt || now,
  });

  // 5. Change Log
  await insertChangeLog(tx, {
    pharmacyId: ctx.pharmacyId,
    entity: 'payment',
    entityId: payload.id,
    op: 'upsert',
    data: {
      id: payload.id,
      paymentNumber: payload.paymentNumber,
      direction: 'receipt',
      partyType: 'customer',
      partyId: payload.customerId,
      amountPaisa: payload.amountPaisa,
      method: payload.method,
    },
    createdAt: now,
  });
}
