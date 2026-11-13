import { eq, and } from 'drizzle-orm';
import { ShiftOpenedPayloadSchema, ShiftClosedPayloadSchema } from '@pos/shared';
import { counters, users } from '../../db/schema';
import { SyncRejectedError, SyncRetryLaterError } from '../errors';
import type { ApplierContext, DbClient } from '../types';
import { verifyTenantEntity } from './common';
import { insertChangeLog } from '../change-log';

async function verifyShiftCounterAndCashier(
  tx: DbClient,
  ctx: ApplierContext,
  counterId: string,
  cashierUserId: string,
  explicitBranchId?: string
): Promise<string> {
  const targetCounterId = ctx.counterId || counterId;

  const counterRows = await tx
    .select({ id: counters.id, branchId: counters.branchId })
    .from(counters)
    .where(and(eq(counters.id, targetCounterId), eq(counters.pharmacyId, ctx.pharmacyId)))
    .limit(1);

  let counter = counterRows[0];
  if (!counter && ctx.branchId) {
    const branchCounters = await tx
      .select({ id: counters.id, branchId: counters.branchId })
      .from(counters)
      .where(and(eq(counters.branchId, ctx.branchId), eq(counters.pharmacyId, ctx.pharmacyId)))
      .limit(1);
    counter = branchCounters[0];
  }

  if (!counter) {
    const [crossCounter] = await tx
      .select({ id: counters.id })
      .from(counters)
      .where(eq(counters.id, targetCounterId))
      .limit(1);

    if (crossCounter) {
      throw new SyncRejectedError(
        'CROSS_TENANT_REFERENCE',
        `Referenced counter ${targetCounterId} belongs to another pharmacy tenant`
      );
    }

    throw new SyncRetryLaterError(
      'UNKNOWN_COUNTER',
      `Counter ${targetCounterId} not found for pharmacy ${ctx.pharmacyId}`
    );
  }

  if (explicitBranchId && explicitBranchId !== counter.branchId) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Shift branchId (${explicitBranchId}) does not match counter branchId (${counter.branchId})`
    );
  }

  await verifyTenantEntity(tx, users, cashierUserId, ctx.pharmacyId, 'UNKNOWN_USER', 'user');

  return counter.branchId;
}

export async function applyShiftOpened(
  tx: DbClient,
  ctx: ApplierContext,
  rawPayload: unknown
): Promise<void> {
  const parseResult = ShiftOpenedPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Invalid shift.opened payload: ${parseResult.error.message}`
    );
  }

  const payload = parseResult.data;
  const now = new Date().toISOString();

  const branchId = await verifyShiftCounterAndCashier(
    tx,
    ctx,
    payload.counterId,
    payload.cashierUserId,
    payload.branchId
  );

  await insertChangeLog(tx, {
    pharmacyId: ctx.pharmacyId,
    branchId,
    entity: 'shift',
    entityId: payload.shiftId,
    op: 'upsert',
    data: {
      id: payload.shiftId,
      shiftId: payload.shiftId,
      branchId,
      counterId: payload.counterId,
      cashierUserId: payload.cashierUserId,
      status: 'open',
      openingCashPaisa: payload.openingCashPaisa,
      openedAt: payload.openedAt,
      notes: payload.notes ?? null,
    },
    createdAt: now,
  });
}

export async function applyShiftClosed(
  tx: DbClient,
  ctx: ApplierContext,
  rawPayload: unknown
): Promise<void> {
  const parseResult = ShiftClosedPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Invalid shift.closed payload: ${parseResult.error.message}`
    );
  }

  const payload = parseResult.data;
  const now = new Date().toISOString();

  const branchId = await verifyShiftCounterAndCashier(
    tx,
    ctx,
    payload.counterId,
    payload.cashierUserId,
    payload.branchId
  );

  await insertChangeLog(tx, {
    pharmacyId: ctx.pharmacyId,
    branchId,
    entity: 'shift',
    entityId: payload.shiftId,
    op: 'upsert',
    data: {
      id: payload.shiftId,
      shiftId: payload.shiftId,
      branchId,
      counterId: payload.counterId,
      cashierUserId: payload.cashierUserId,
      status: 'closed',
      openedAt: payload.openedAt,
      closedAt: payload.closedAt,
      openingCashPaisa: payload.openingCashPaisa,
      countedCashPaisa: payload.countedCashPaisa,
      expectedCashPaisa: payload.expectedCashPaisa,
      differencePaisa: payload.differencePaisa,
      salesCashPaisa: payload.salesCashPaisa,
      salesCardPaisa: payload.salesCardPaisa,
      salesWalletPaisa: payload.salesWalletPaisa,
      returnsCashPaisa: payload.returnsCashPaisa,
      notes: payload.notes ?? null,
    },
    createdAt: now,
  });
}
