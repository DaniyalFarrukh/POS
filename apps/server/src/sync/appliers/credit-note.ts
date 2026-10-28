import { generateUuidV7, CreditNoteCreatedPayloadSchema } from '@pos/shared';
import {
  creditNotes,
  creditNoteLines,
  stockMovements,
  invoices,
  invoiceLines,
  products,
  batches,
  branches,
  counters,
  users,
} from '../../db/schema';
import { SyncRejectedError } from '../errors';
import type { ApplierContext, DbClient } from '../types';
import { verifyTenantEntity, verifyTenantEntities } from './common';
import { insertChangeLog } from '../change-log';

export async function applyCreditNoteCreated(
  tx: DbClient,
  ctx: ApplierContext,
  rawPayload: unknown
): Promise<void> {
  const parseResult = CreditNoteCreatedPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Invalid credit_note.created payload: ${parseResult.error.message}`
    );
  }

  const payload = parseResult.data;
  const now = new Date().toISOString();

  // 1. Device alignment
  if (ctx.branchId && payload.branchId !== ctx.branchId) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Device branchId (${ctx.branchId}) does not match credit note branchId (${payload.branchId})`
    );
  }
  if (ctx.counterId && payload.counterId !== ctx.counterId) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Device counterId (${ctx.counterId}) does not match credit note counterId (${payload.counterId})`
    );
  }

  // 2. Totals validation (Rule 1 & docs/SYNC.md)
  const lineSum = payload.lines.reduce((sum, l) => sum + l.lineTotalPaisa, 0);
  if (lineSum !== payload.totalPaisa) {
    throw new SyncRejectedError(
      'TOTALS_MISMATCH',
      `Credit note lines sum (${lineSum} paisa) does not match totalPaisa (${payload.totalPaisa} paisa)`
    );
  }

  // 3. Verify Branch belongs to this pharmacy
  await verifyTenantEntity(
    tx,
    branches,
    payload.branchId,
    ctx.pharmacyId,
    'UNKNOWN_BRANCH',
    'branch'
  );

  // 4. Verify Counter belongs to this pharmacy
  await verifyTenantEntity(
    tx,
    counters,
    payload.counterId,
    ctx.pharmacyId,
    'UNKNOWN_COUNTER',
    'counter'
  );

  // 5. Verify Cashier User belongs to this pharmacy
  await verifyTenantEntity(
    tx,
    users,
    payload.cashierUserId,
    ctx.pharmacyId,
    'UNKNOWN_USER',
    'user'
  );

  // 6. Verify Original Invoice belongs to this pharmacy
  await verifyTenantEntity(
    tx,
    invoices,
    payload.originalInvoiceId,
    ctx.pharmacyId,
    'UNKNOWN_INVOICE',
    'invoice'
  );

  // 7. Verify Original Invoice Lines belong to this pharmacy
  const origLineIds = payload.lines.map((l) => l.originalInvoiceLineId);
  await verifyTenantEntities(
    tx,
    invoiceLines,
    origLineIds,
    ctx.pharmacyId,
    'UNKNOWN_INVOICE_LINE',
    'invoice line'
  );

  // 8. Verify referenced products exist for this pharmacy
  const productIds = payload.lines.map((l) => l.productId);
  await verifyTenantEntities(
    tx,
    products,
    productIds,
    ctx.pharmacyId,
    'UNKNOWN_PRODUCT',
    'product'
  );

  // 9. Verify referenced batches exist for this pharmacy
  const batchIds = payload.lines
    .map((l) => l.batchId)
    .filter((id): id is string => Boolean(id));
  await verifyTenantEntities(
    tx,
    batches,
    batchIds,
    ctx.pharmacyId,
    'UNKNOWN_BATCH',
    'batch'
  );

  // 5. Insert Credit Note Header
  await tx.insert(creditNotes).values({
    id: payload.id,
    pharmacyId: ctx.pharmacyId,
    creditNoteNumber: payload.creditNoteNumber,
    originalInvoiceId: payload.originalInvoiceId,
    branchId: payload.branchId,
    counterId: payload.counterId,
    cashierUserId: payload.cashierUserId,
    clientRequestId: payload.clientRequestId,
    subtotalPaisa: payload.subtotalPaisa,
    taxPaisa: payload.taxPaisa,
    totalPaisa: payload.totalPaisa,
    refundMethod: payload.refundMethod,
    reason: payload.reason,
    notes: payload.notes ?? null,
    createdAt: payload.createdAt,
  });

  await insertChangeLog(tx, {
    pharmacyId: ctx.pharmacyId,
    entity: 'credit_note',
    entityId: payload.id,
    op: 'upsert',
    data: {
      id: payload.id,
      creditNoteNumber: payload.creditNoteNumber,
      totalPaisa: payload.totalPaisa,
    },
    createdAt: now,
  });

  // 6. Insert Credit Note Lines & Positive Return Stock Movements
  for (const line of payload.lines) {
    await tx.insert(creditNoteLines).values({
      id: line.id,
      pharmacyId: ctx.pharmacyId,
      creditNoteId: payload.id,
      originalInvoiceLineId: line.originalInvoiceLineId,
      productId: line.productId,
      batchId: line.batchId ?? null,
      quantity: line.quantity,
      unitPricePaisa: line.unitPricePaisa,
      taxRateBp: line.taxRateBp,
      taxPaisa: line.taxPaisa,
      lineTotalPaisa: line.lineTotalPaisa,
    });

    await insertChangeLog(tx, {
      pharmacyId: ctx.pharmacyId,
      entity: 'credit_note_line',
      entityId: line.id,
      op: 'upsert',
      data: line,
      createdAt: now,
    });

    // 7. Insert positive return stock movement (Rule 4)
    if (line.batchId) {
      const movementId = generateUuidV7();
      const movementData = {
        id: movementId,
        pharmacyId: ctx.pharmacyId,
        productId: line.productId,
        batchId: line.batchId,
        branchId: payload.branchId,
        type: 'return' as const,
        quantitySigned: line.quantity, // Positive for return
        referenceType: 'credit_note',
        referenceId: payload.id,
        reason: `Return #${payload.creditNoteNumber}: ${payload.reason}`,
        createdAt: payload.createdAt,
        updatedAt: payload.createdAt,
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
    }
  }
}
