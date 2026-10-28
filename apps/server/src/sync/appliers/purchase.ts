import { eq, and } from 'drizzle-orm';
import { generateUuidV7, PurchaseReceivedPayloadSchema } from '@pos/shared';
import {
  batches,
  stockMovements,
  products,
  branches,
  suppliers,
  users,
} from '../../db/schema';
import { SyncRejectedError } from '../errors';
import type { ApplierContext, DbClient } from '../types';
import { verifyTenantEntity, verifyTenantEntities } from './common';
import { insertChangeLog } from '../change-log';

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

  // 1. Device alignment
  if (ctx.branchId && payload.purchase.branchId !== ctx.branchId) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Device branchId (${ctx.branchId}) does not match purchase branchId (${payload.purchase.branchId})`
    );
  }

  // 2. Verify Branch belongs to this pharmacy
  await verifyTenantEntity(
    tx,
    branches,
    payload.purchase.branchId,
    ctx.pharmacyId,
    'UNKNOWN_BRANCH',
    'branch'
  );

  // 3. Verify Supplier belongs to this pharmacy if specified
  if (payload.purchase.supplierId) {
    await verifyTenantEntity(
      tx,
      suppliers,
      payload.purchase.supplierId,
      ctx.pharmacyId,
      'UNKNOWN_SUPPLIER',
      'supplier'
    );
  }

  // 4. Verify CreatedBy User belongs to this pharmacy if specified
  if (payload.purchase.createdByUserId) {
    await verifyTenantEntity(
      tx,
      users,
      payload.purchase.createdByUserId,
      ctx.pharmacyId,
      'UNKNOWN_USER',
      'user'
    );
  }

  // 5. Verify referenced products exist for this pharmacy
  const productIds = [
    ...payload.batches.map((b) => b.productId),
    ...payload.lines.map((l) => l.productId),
  ];
  await verifyTenantEntities(
    tx,
    products,
    productIds,
    ctx.pharmacyId,
    'UNKNOWN_PRODUCT',
    'product'
  );

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

      await insertChangeLog(tx, {
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

    await insertChangeLog(tx, {
      pharmacyId: ctx.pharmacyId,
      branchId: payload.purchase.branchId,
      entity: 'stock_movement',
      entityId: movementId,
      op: 'upsert',
      data: movementData,
      createdAt: now,
    });
  }
}
