import { eq, and } from 'drizzle-orm';
import {
  ShiftOpenedPayloadSchema,
  ShiftClosedPayloadSchema,
} from '@pos/shared';
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
  if (ctx.counterId && counterId !== ctx.counterId) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Device counterId (${ctx.counterId}) does not match shift counterId (${counterId})`
    );
  }

  const counterRows = await tx
    .select({ id: counters.id, branchId: counters.branchId })
    .from(counters)
    .where(and(eq(counters.id, counterId), eq(counters.pharmacyId, ctx.pharmacyId)))
    .limit(1);

  const counter = counterRows[0];
  if (!counter) {
    const [crossCounter] = await tx
      .select({ id: counters.id })
      .from(counters)
      .where(eq(counters.id, counterId))
      .limit(1);

    if (crossCounter) {
      throw new SyncRejectedError(
        'CROSS_TENANT_REFERENCE',
        `Referenced counter ${counterId} belongs to another pharmacy tenant`
      );
    }

    throw new SyncRetryLaterError(
      'UNKNOWN_COUNTER',
      `Counter ${counterId} not found for pharmacy ${ctx.pharmacyId}`
    );
  }

  if (ctx.branchId && counter.branchId !== ctx.branchId) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Device branchId (${ctx.branchId}) does not match counter branchId (${counter.branchId})`
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

