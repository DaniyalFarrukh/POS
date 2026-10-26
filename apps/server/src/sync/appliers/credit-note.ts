import { eq, and, inArray } from 'drizzle-orm';
import { generateUuidV7, CreditNoteCreatedPayloadSchema } from '@pos/shared';
import {
  creditNotes,
  creditNoteLines,
  stockMovements,
  invoices,
  products,
  batches,
  changeLog,
} from '../../db/schema';
import { SyncRejectedError, SyncRetryLaterError } from '../errors';
import type { ApplierContext, DbClient } from '../types';

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

  // 1. Totals validation (Rule 1 & docs/SYNC.md)
  const lineSum = payload.lines.reduce((sum, l) => sum + l.lineTotalPaisa, 0);
  if (lineSum !== payload.totalPaisa) {
    throw new SyncRejectedError(
      'TOTALS_MISMATCH',
      `Credit note lines sum (${lineSum} paisa) does not match totalPaisa (${payload.totalPaisa} paisa)`
    );
  }

  // 2. Verify original invoice exists for this pharmacy
  const invoiceRows = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.id, payload.originalInvoiceId),
        eq(invoices.pharmacyId, ctx.pharmacyId)
      )
    )
    .limit(1);

  if (!invoiceRows[0]) {
    throw new SyncRetryLaterError(
      'UNKNOWN_INVOICE',
      `Original invoice ${payload.originalInvoiceId} does not exist for pharmacy ${ctx.pharmacyId}`
    );
  }

  // 3. Verify referenced products exist for this pharmacy
  const productIds = Array.from(new Set(payload.lines.map((l) => l.productId)));
  const productRows = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.pharmacyId, ctx.pharmacyId),
        inArray(products.id, productIds)
      )
    );

  const foundProductIds = new Set(productRows.map((p) => p.id));
  for (const pid of productIds) {
    if (!foundProductIds.has(pid)) {
      throw new SyncRetryLaterError(
        'UNKNOWN_PRODUCT',
        `Referenced product ${pid} does not exist for pharmacy ${ctx.pharmacyId}`
      );
    }
  }

  // 4. Verify referenced batches exist for this pharmacy
  const batchIds = Array.from(
    new Set(payload.lines.map((l) => l.batchId).filter((id): id is string => Boolean(id)))
  );

  if (batchIds.length > 0) {
    const batchRows = await tx
      .select({ id: batches.id })
      .from(batches)
      .where(
        and(
          eq(batches.pharmacyId, ctx.pharmacyId),
          inArray(batches.id, batchIds)
        )
      );

    const foundBatchIds = new Set(batchRows.map((b) => b.id));
    for (const bid of batchIds) {
      if (!foundBatchIds.has(bid)) {
        throw new SyncRetryLaterError(
          'UNKNOWN_BATCH',
          `Referenced batch ${bid} does not exist for pharmacy ${ctx.pharmacyId}`
        );
      }
    }
  }

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

  await tx.insert(changeLog).values({
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

    await tx.insert(changeLog).values({
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
}
