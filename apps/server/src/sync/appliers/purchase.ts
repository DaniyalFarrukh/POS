import { eq, and, inArray } from 'drizzle-orm';
import { generateUuidV7, PurchaseReceivedPayloadSchema } from '@pos/shared';
import { batches, stockMovements, products, changeLog } from '../../db/schema';
import { SyncRejectedError, SyncRetryLaterError } from '../errors';
import type { ApplierContext, DbClient } from '../types';

export async function applyPurchaseReceived(
  tx: DbClient,
  ctx: ApplierContext,
  rawPayload: unknown
): Promise<void> {
  const parseResult = PurchaseReceivedPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Invalid purchase.received payload: ${parseResult.error.message}`
    );
  }

  const payload = parseResult.data;
  const now = new Date().toISOString();

  // 1. Verify referenced products exist for this pharmacy
  const productIds = Array.from(
    new Set([
      ...payload.batches.map((b) => b.productId),
      ...payload.lines.map((l) => l.productId),
    ])
  );

  const existingProducts = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.pharmacyId, ctx.pharmacyId),
        inArray(products.id, productIds)
      )
    );

  const foundProductIds = new Set(existingProducts.map((p) => p.id));
  for (const pid of productIds) {
    if (!foundProductIds.has(pid)) {
      throw new SyncRetryLaterError(
        'UNKNOWN_PRODUCT',
        `Referenced product ${pid} does not exist for pharmacy ${ctx.pharmacyId}`
      );
    }
  }

  // 2. Insert or update Batches
  for (const b of payload.batches) {
    const existing = await tx
      .select({ id: batches.id })
      .from(batches)
      .where(and(eq(batches.id, b.id), eq(batches.pharmacyId, ctx.pharmacyId)))
      .limit(1);

    if (!existing[0]) {
      await tx.insert(batches).values({
        id: b.id,
        pharmacyId: ctx.pharmacyId,
        productId: b.productId,
        batchNo: b.batchNo,
        expiryDate: b.expiryDate,
        costPaisa: b.costPaisa,
        mrpPaisa: b.mrpPaisa,
        createdAt: b.createdAt || now,
        updatedAt: b.createdAt || now,
      });

      await tx.insert(changeLog).values({
        pharmacyId: ctx.pharmacyId,
        entity: 'batch',
        entityId: b.id,
        op: 'upsert',
        data: b,
        createdAt: now,
      });
    }
  }

  // 3. Insert Purchase Stock Movements (Rule 4: signed quantity for purchase)
  for (const line of payload.lines) {
    const movementId = generateUuidV7();
    const movementData = {
      id: movementId,
      pharmacyId: ctx.pharmacyId,
      productId: line.productId,
      batchId: line.batchId,
      branchId: payload.purchase.branchId,
      type: 'purchase' as const,
      quantitySigned: line.quantity,
      referenceType: 'purchase',
      referenceId: payload.purchase.id,
      reason: `GRN: ${payload.purchase.supplierInvoiceNo}`,
      createdAt: now,
      updatedAt: now,
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
  }
}
