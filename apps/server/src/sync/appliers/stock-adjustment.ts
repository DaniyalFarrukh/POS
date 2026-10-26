import { eq, and, sql } from 'drizzle-orm';
import { generateUuidV7, StockAdjustmentCreatedPayloadSchema } from '@pos/shared';
import { stockMovements, products, batches, stockAlerts, changeLog } from '../../db/schema';
import { SyncRejectedError, SyncRetryLaterError } from '../errors';
import type { ApplierContext, DbClient } from '../types';

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

  // 1. Verify referenced product exists
  const productRows = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.id, payload.productId),
        eq(products.pharmacyId, ctx.pharmacyId)
      )
    )
    .limit(1);

  if (!productRows[0]) {
    throw new SyncRetryLaterError(
      'UNKNOWN_PRODUCT',
      `Referenced product ${payload.productId} does not exist for pharmacy ${ctx.pharmacyId}`
    );
  }

  // 2. Verify referenced batch exists
  const batchRows = await tx
    .select({ id: batches.id })
    .from(batches)
    .where(
      and(
        eq(batches.id, payload.batchId),
        eq(batches.pharmacyId, ctx.pharmacyId)
      )
    )
    .limit(1);

  if (!batchRows[0]) {
    throw new SyncRetryLaterError(
      'UNKNOWN_BATCH',
      `Referenced batch ${payload.batchId} does not exist for pharmacy ${ctx.pharmacyId}`
    );
  }

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

  await tx.insert(changeLog).values({
    pharmacyId: ctx.pharmacyId,
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
