import { eq, and } from 'drizzle-orm';
import {
  StockTransferDispatchedPayloadSchema,
  StockTransferReceivedPayloadSchema,
} from '@pos/shared';
import {
  stockTransfers,
  stockTransferLines,
  stockMovements,
  branches,
  stockLocations,
  users,
  products,
  batches,
} from '../../db/schema';
import { SyncRejectedError, SyncRetryLaterError } from '../errors';
import type { ApplierContext, DbClient } from '../types';
import { verifyTenantEntity, verifyTenantEntities } from './common';
import { insertChangeLog } from '../change-log';
import { postStockTransferReceived } from '../../ledger/posting-engine';

export async function applyStockTransferDispatched(
  tx: DbClient,
  ctx: ApplierContext,
  rawPayload: unknown
): Promise<void> {
  const parseResult = StockTransferDispatchedPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Invalid stock_transfer.dispatched payload: ${parseResult.error.message}`
    );
  }

  const payload = parseResult.data;
  const now = new Date().toISOString();

  // 1. Verify branches belong to this pharmacy and align with device branch
  if (ctx.branchId && payload.sourceBranchId !== ctx.branchId) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Device branchId (${ctx.branchId}) does not match transfer sourceBranchId (${payload.sourceBranchId})`
    );
  }

  await verifyTenantEntity(
    tx,
    branches,
    payload.sourceBranchId,
    ctx.pharmacyId,
    'UNKNOWN_BRANCH',
    'sourceBranch'
  );

  await verifyTenantEntity(
    tx,
    branches,
    payload.destinationBranchId,
    ctx.pharmacyId,
    'UNKNOWN_BRANCH',
    'destinationBranch'
  );

  if (payload.sourceLocationId) {
    await verifyTenantEntity(
      tx,
      stockLocations,
      payload.sourceLocationId,
      ctx.pharmacyId,
      'UNKNOWN_LOCATION',
      'sourceLocation'
    );
  }

  if (payload.destinationLocationId) {
    await verifyTenantEntity(
      tx,
      stockLocations,
      payload.destinationLocationId,
      ctx.pharmacyId,
      'UNKNOWN_LOCATION',
      'destinationLocation'
    );
  }

  if (payload.dispatchedByUserId) {
    await verifyTenantEntity(
      tx,
      users,
      payload.dispatchedByUserId,
      ctx.pharmacyId,
      'UNKNOWN_USER',
      'dispatchedByUser'
    );
  }

  // 2. Verify products and batches
  const productIds = payload.lines.map((l) => l.productId);
  await verifyTenantEntities(
    tx,
    products,
    productIds,
    ctx.pharmacyId,
    'UNKNOWN_PRODUCT',
    'product'
  );

  const batchIds = payload.lines.map((l) => l.batchId);
  await verifyTenantEntities(tx, batches, batchIds, ctx.pharmacyId, 'UNKNOWN_BATCH', 'batch');

  // 3. Upsert stock_transfers header
  const [existingTransfer] = await tx
    .select()
    .from(stockTransfers)
    .where(
      and(eq(stockTransfers.id, payload.transferId), eq(stockTransfers.pharmacyId, ctx.pharmacyId))
    );

  if (!existingTransfer) {
    await tx.insert(stockTransfers).values({
      id: payload.transferId,
      pharmacyId: ctx.pharmacyId,
      transferNumber: payload.transferNumber,
      sourceBranchId: payload.sourceBranchId,
      sourceLocationId: payload.sourceLocationId || null,
      destinationBranchId: payload.destinationBranchId,
      destinationLocationId: payload.destinationLocationId || null,
      status: 'in_transit',
      dispatchedBy: payload.dispatchedByUserId || null,
      dispatchedAt: payload.dispatchedAt,
      notes: payload.notes || null,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await tx
      .update(stockTransfers)
      .set({
        status: 'in_transit',
        dispatchedBy: payload.dispatchedByUserId || existingTransfer.dispatchedBy,
        dispatchedAt: payload.dispatchedAt,
        notes: payload.notes || existingTransfer.notes,
        updatedAt: now,
      })
      .where(
        and(
          eq(stockTransfers.id, payload.transferId),
          eq(stockTransfers.pharmacyId, ctx.pharmacyId)
        )
      );
  }

  // 4. Upsert stock_transfer_lines and insert transfer_out movements
  for (const line of payload.lines) {
    const [existingLine] = await tx
      .select()
      .from(stockTransferLines)
      .where(
        and(eq(stockTransferLines.id, line.id), eq(stockTransferLines.pharmacyId, ctx.pharmacyId))
      );

    const movementId = line.dispatchMovementId || line.id;

    if (!existingLine) {
      await tx.insert(stockTransferLines).values({
        id: line.id,
        pharmacyId: ctx.pharmacyId,
        transferId: payload.transferId,
        productId: line.productId,
        batchId: line.batchId,
        quantityRequested: line.quantityDispatched,
        quantityDispatched: line.quantityDispatched,
        quantityReceived: 0,
        shortageQuantity: 0,
        dispatchMovementId: movementId,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Insert stock_movements (transfer_out from source branch & location)
    const [existingMove] = await tx
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.id, movementId), eq(stockMovements.pharmacyId, ctx.pharmacyId)));

    if (!existingMove) {
      const moveData = {
        id: movementId,
        pharmacyId: ctx.pharmacyId,
        productId: line.productId,
        batchId: line.batchId,
        branchId: payload.sourceBranchId,
        locationId: payload.sourceLocationId || null,
        type: 'transfer_out' as const,
        quantitySigned: -line.quantityDispatched,
        referenceType: 'stock_transfer',
        referenceId: payload.transferId,
        reason: `Transfer Out: ${payload.transferNumber}`,
        createdAt: payload.dispatchedAt || now,
        updatedAt: payload.dispatchedAt || now,
      };

      await tx.insert(stockMovements).values(moveData);

      await insertChangeLog(tx, {
        pharmacyId: ctx.pharmacyId,
        branchId: payload.sourceBranchId,
        entity: 'stock_movement',
        entityId: movementId,
        op: 'upsert',
        data: moveData,
        createdAt: now,
      });
    }
  }

  await insertChangeLog(tx, {
    pharmacyId: ctx.pharmacyId,
    entity: 'stock_transfer',
    entityId: payload.transferId,
    op: 'upsert',
    data: {
      id: payload.transferId,
      status: 'in_transit',
      transferNumber: payload.transferNumber,
    },
    createdAt: now,
  });
}

export async function applyStockTransferReceived(
  tx: DbClient,
  ctx: ApplierContext,
  rawPayload: unknown
): Promise<void> {
  const parseResult = StockTransferReceivedPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Invalid stock_transfer.received payload: ${parseResult.error.message}`
    );
  }

  const payload = parseResult.data;
  const now = new Date().toISOString();

  // 1. Fetch existing transfer
  const [transfer] = await tx
    .select()
    .from(stockTransfers)
    .where(
      and(eq(stockTransfers.id, payload.transferId), eq(stockTransfers.pharmacyId, ctx.pharmacyId))
    );

  if (!transfer) {
    // Dispatch has not arrived yet due to sync ordering / race -> retry_later!
    throw new SyncRetryLaterError(
      'TRANSFER_NOT_FOUND',
      `Transfer ${payload.transferId} not found yet; will retry on next sync cycle`
    );
  }

  if (transfer.status === 'received') {
    // Already received -> idempotent success
    return;
  }

  if (ctx.branchId && transfer.destinationBranchId !== ctx.branchId) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Device branchId (${ctx.branchId}) does not match transfer destinationBranchId (${transfer.destinationBranchId})`
    );
  }

  if (payload.receivedByUserId) {
    await verifyTenantEntity(
      tx,
      users,
      payload.receivedByUserId,
      ctx.pharmacyId,
      'UNKNOWN_USER',
      'receivedByUser'
    );
  }

  const productIds = payload.lines.map((l) => l.productId);
  await verifyTenantEntities(
    tx,
    products,
    productIds,
    ctx.pharmacyId,
    'UNKNOWN_PRODUCT',
    'product'
  );

  const batchIds = payload.lines.map((l) => l.batchId);
  await verifyTenantEntities(tx, batches, batchIds, ctx.pharmacyId, 'UNKNOWN_BATCH', 'batch');

  let hasShortage = false;

  // 2. Process receipt lines
  for (const line of payload.lines) {
    const receiveMovementId = line.receiveMovementId || line.lineId;
    const isShortage = line.shortageQuantity > 0;
    if (isShortage) {
      hasShortage = true;
    }

    const updatedLines = await tx
      .update(stockTransferLines)
      .set({
        quantityReceived: line.quantityReceived,
        shortageQuantity: line.shortageQuantity,
        shortageReason: line.shortageReason || null,
        receiveMovementId,
        shortageMovementId: line.shortageMovementId || null,
        updatedAt: now,
      })
      .where(
        and(
          eq(stockTransferLines.id, line.lineId),
          eq(stockTransferLines.transferId, transfer.id),
          eq(stockTransferLines.pharmacyId, ctx.pharmacyId)
        )
      )
      .returning({ id: stockTransferLines.id });

    if (updatedLines.length === 0) {
      throw new SyncRejectedError(
        'CROSS_TENANT_REFERENCE',
        `Transfer line ${line.lineId} does not belong to transfer ${transfer.id} or pharmacy ${ctx.pharmacyId}`
      );
    }

    // Insert transfer_in movement at destination
    if (line.quantityReceived > 0) {
      const [existingIn] = await tx
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.id, receiveMovementId),
            eq(stockMovements.pharmacyId, ctx.pharmacyId)
          )
        );

      if (!existingIn) {
        const moveData = {
          id: receiveMovementId,
          pharmacyId: ctx.pharmacyId,
          productId: line.productId,
          batchId: line.batchId,
          branchId: transfer.destinationBranchId,
          locationId: transfer.destinationLocationId || null,
          type: 'transfer_in' as const,
          quantitySigned: line.quantityReceived,
          referenceType: 'stock_transfer',
          referenceId: transfer.id,
          reason: `Transfer In: ${transfer.transferNumber}`,
          createdAt: payload.receivedAt || now,
          updatedAt: payload.receivedAt || now,
        };

        await tx.insert(stockMovements).values(moveData);

        await insertChangeLog(tx, {
          pharmacyId: ctx.pharmacyId,
          branchId: transfer.destinationBranchId,
          entity: 'stock_movement',
          entityId: receiveMovementId,
          op: 'upsert',
          data: moveData,
          createdAt: now,
        });
      }
    }
  }

  // 3. Mark transfer received
  await tx
    .update(stockTransfers)
    .set({
      status: 'received',
      receivedBy: payload.receivedByUserId || null,
      receivedAt: payload.receivedAt,
      hasShortage,
      updatedAt: now,
    })
    .where(and(eq(stockTransfers.id, transfer.id), eq(stockTransfers.pharmacyId, ctx.pharmacyId)));

  // 4. Auto-post balanced inter-branch journal entry
  await postStockTransferReceived(tx, {
    pharmacyId: ctx.pharmacyId,
    sourceBranchId: transfer.sourceBranchId,
    destinationBranchId: transfer.destinationBranchId,
    transferId: transfer.id,
    transferNumber: transfer.transferNumber,
    createdBy: payload.receivedByUserId || null,
    lines: payload.lines.map((l) => ({
      batchId: l.batchId,
      quantityReceived: l.quantityReceived,
      shortageQuantity: l.shortageQuantity,
    })),
  });

  await insertChangeLog(tx, {
    pharmacyId: ctx.pharmacyId,
    entity: 'stock_transfer',
    entityId: transfer.id,
    op: 'upsert',
    data: {
      id: transfer.id,
      status: 'received',
      hasShortage,
      receivedAt: payload.receivedAt,
    },
    createdAt: now,
  });
}
