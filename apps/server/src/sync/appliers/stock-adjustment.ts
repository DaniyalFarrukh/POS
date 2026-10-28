import { eq, and, sql } from 'drizzle-orm';
import { generateUuidV7, StockAdjustmentCreatedPayloadSchema } from '@pos/shared';
import {
  stockMovements,
  products,
  batches,
  branches,
  stockAlerts,
} from '../../db/schema';
import { SyncRejectedError } from '../errors';
import type { ApplierContext, DbClient } from '../types';
import { verifyTenantEntity } from './common';
import { insertChangeLog } from '../change-log';

export async function applyStockAdjustmentCreated(
  tx: DbClient,
  ctx: ApplierContext,
  rawPayload: unknown
): Promise<void> {
  const parseResult = StockAdjustmentCreatedPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Invalid stock_adjustment.created payload: ${parseResult.error.message}`
    );
  }

  const payload = parseResult.data;
  const now = new Date().toISOString();

  // 1. Device alignment
  if (ctx.branchId && payload.branchId !== ctx.branchId) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Device branchId (${ctx.branchId}) does not match stock adjustment branchId (${payload.branchId})`
    );
  }

  // 2. Verify Branch belongs to this pharmacy
  await verifyTenantEntity(
    tx,
    branches,
    payload.branchId,
    ctx.pharmacyId,
    'UNKNOWN_BRANCH',
    'branch'
  );

  // 3. Verify referenced product belongs to this pharmacy
  await verifyTenantEntity(
    tx,
    products,
    payload.productId,
    ctx.pharmacyId,
    'UNKNOWN_PRODUCT',
    'product'
  );

  // 4. Verify referenced batch belongs to this pharmacy
  await verifyTenantEntity(
    tx,
    batches,
    payload.batchId,
    ctx.pharmacyId,
    'UNKNOWN_BATCH',
    'batch'
  );

  // 3. Insert stock movement row
  const movementId = payload.movementId || payload.id || generateUuidV7();
  const movementData = {
    id: movementId,
    pharmacyId: ctx.pharmacyId,
    productId: payload.productId,
    batchId: payload.batchId,
    branchId: payload.branchId,
    type: 'adjustment' as const,
    quantitySigned: payload.quantitySigned,
    referenceType: 'stock_adjustment',
    referenceId: movementId,
    reason: payload.reason,
    createdAt: payload.createdAt || now,
    updatedAt: payload.createdAt || now,
  };

  await tx.insert(stockMovements).values(movementData);

  await insertChangeLog(tx, {
    pharmacyId: ctx.pharmacyId,
    branchId: payload.branchId,
    entity: 'stock_movement',
    entityId: movementId,
    op: 'upsert',
    data: movementData,
    createdAt: now,
  });

  // 4. Check resulting stock balance; if negative, record alert in stock_alerts
  const [stockBalRow] = await tx
    .select({
      balance: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.pharmacyId, ctx.pharmacyId),
        eq(stockMovements.branchId, payload.branchId),
        eq(stockMovements.batchId, payload.batchId)
      )
    );

  const resultingBalance = Number(stockBalRow?.balance ?? 0);
  if (resultingBalance < 0) {
    await tx.insert(stockAlerts).values({
      id: generateUuidV7(),
      pharmacyId: ctx.pharmacyId,
      branchId: payload.branchId,
      productId: payload.productId,
      batchId: payload.batchId,
      type: 'negative_stock',
      severity: 'warning',
      message: `Negative stock balance (${resultingBalance}) for batch ${payload.batchId} after adjustment: ${payload.reason}`,
      createdAt: now,
    });
  }
}
