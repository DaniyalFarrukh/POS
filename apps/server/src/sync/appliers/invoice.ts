import { eq, and, sql } from 'drizzle-orm';
import { generateUuidV7, InvoiceCreatedPayloadSchema } from '@pos/shared';
import {
  invoices,
  invoiceLines,
  payments,
  stockMovements,
  products,
  batches,
  counters,
  users,
  stockAlerts,
} from '../../db/schema';
import { SyncRejectedError, SyncRetryLaterError } from '../errors';
import type { ApplierContext, DbClient } from '../types';
import { verifyTenantEntity, verifyTenantEntities } from './common';
import { insertChangeLog } from '../change-log';

export async function applyInvoiceCreated(
  tx: DbClient,
  ctx: ApplierContext,
  rawPayload: unknown
): Promise<void> {
  const parseResult = InvoiceCreatedPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Invalid invoice.created payload: ${parseResult.error.message}`
    );
  }

  const payload = parseResult.data;
  const now = new Date().toISOString();

  // 1. Totals validation (Rule 1 & docs/SYNC.md)
  const lineSum = payload.lines.reduce((sum, l) => sum + l.lineTotalPaisa, 0);
  if (lineSum !== payload.totalPaisa) {
    throw new SyncRejectedError(
      'TOTALS_MISMATCH',
      `Invoice lines sum (${lineSum} paisa) does not match totalPaisa (${payload.totalPaisa} paisa)`
    );
  }

  const paymentSum = payload.payments.reduce((sum, p) => sum + p.amountPaisa, 0);
  if (paymentSum !== payload.totalPaisa) {
    throw new SyncRejectedError(
      'TOTALS_MISMATCH',
      `Payments sum (${paymentSum} paisa) does not match totalPaisa (${payload.totalPaisa} paisa)`
    );
  }

  // 2. Device alignment & Counter verification
  if (ctx.counterId && payload.counterId !== ctx.counterId) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Device counterId (${ctx.counterId}) does not match payload counterId (${payload.counterId})`
    );
  }

  const counterRows = await tx
    .select({ id: counters.id, branchId: counters.branchId })
    .from(counters)
    .where(
      and(
        eq(counters.id, payload.counterId),
        eq(counters.pharmacyId, ctx.pharmacyId)
      )
    )
    .limit(1);

  const counter = counterRows[0];
  if (!counter) {
    const [crossCounter] = await tx
      .select({ id: counters.id })
      .from(counters)
      .where(eq(counters.id, payload.counterId))
      .limit(1);

    if (crossCounter) {
      throw new SyncRejectedError(
        'CROSS_TENANT_REFERENCE',
        `Referenced counter ${payload.counterId} belongs to another pharmacy tenant`
      );
    }

    throw new SyncRetryLaterError(
      'UNKNOWN_COUNTER',
      `Counter ${payload.counterId} not found for pharmacy ${ctx.pharmacyId}`
    );
  }

  if (ctx.branchId && counter.branchId !== ctx.branchId) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Device branchId (${ctx.branchId}) does not match counter branchId (${counter.branchId})`
    );
  }

  const branchId = counter.branchId;

  // 3. Verify Cashier User belongs to this pharmacy
  await verifyTenantEntity(tx, users, payload.cashierUserId, ctx.pharmacyId, 'UNKNOWN_USER', 'user');

  // 4. Verify referenced products belong to this pharmacy
  const productIds = payload.lines.map((l) => l.productId);
  await verifyTenantEntities(tx, products, productIds, ctx.pharmacyId, 'UNKNOWN_PRODUCT', 'product');

  // 5. Verify referenced batches belong to this pharmacy
  const batchIds = payload.lines
    .map((l) => l.batchId)
    .filter((id): id is string => Boolean(id));
  await verifyTenantEntities(tx, batches, batchIds, ctx.pharmacyId, 'UNKNOWN_BATCH', 'batch');

  // 6. Insert Invoice Header
  await tx.insert(invoices).values({
    id: payload.id,
    pharmacyId: ctx.pharmacyId,
    counterId: payload.counterId,
    cashierUserId: payload.cashierUserId,
    invoiceNumber: payload.invoiceNumber,
    clientRequestId: payload.clientRequestId,
    status: payload.status,
    subtotalPaisa: payload.subtotalPaisa,
    discountPaisa: payload.discountPaisa,
    taxPaisa: payload.taxPaisa,
    totalPaisa: payload.totalPaisa,
    notes: payload.notes ?? null,
    createdAt: payload.createdAt,
  });

  await insertChangeLog(tx, {
    pharmacyId: ctx.pharmacyId,
    entity: 'invoice',
    entityId: payload.id,
    op: 'upsert',
    data: {
      id: payload.id,
      invoiceNumber: payload.invoiceNumber,
      totalPaisa: payload.totalPaisa,
    },
    createdAt: now,
  });

  // 7. Insert Invoice Lines
  for (const line of payload.lines) {
    await tx.insert(invoiceLines).values({
      id: line.id,
      pharmacyId: ctx.pharmacyId,
      invoiceId: payload.id,
      productId: line.productId,
      batchId: line.batchId ?? null,
      quantity: line.quantity,
      unitPricePaisa: line.unitPricePaisa,
      discountPaisa: line.discountPaisa,
      taxRateBp: line.taxRateBp,
      taxPaisa: line.taxPaisa,
      lineTotalPaisa: line.lineTotalPaisa,
    });

    await insertChangeLog(tx, {
      pharmacyId: ctx.pharmacyId,
      entity: 'invoice_line',
      entityId: line.id,
      op: 'upsert',
      data: line,
      createdAt: now,
    });

    // 8. Insert Negative Stock Movement for sale (Rule 4)
    if (line.batchId) {
      const movementId = generateUuidV7();
      const movementData = {
        id: movementId,
        pharmacyId: ctx.pharmacyId,
        productId: line.productId,
        batchId: line.batchId,
        branchId,
        type: 'sale' as const,
        quantitySigned: -line.quantity, // Negative for sale
        referenceType: 'invoice',
        referenceId: payload.id,
        reason: `Sale #${payload.invoiceNumber}`,
        createdAt: payload.createdAt,
        updatedAt: payload.createdAt,
      };

      await tx.insert(stockMovements).values(movementData);

      await insertChangeLog(tx, {
        pharmacyId: ctx.pharmacyId,
        branchId,
        entity: 'stock_movement',
        entityId: movementId,
        op: 'upsert',
        data: movementData,
        createdAt: now,
      });

      // 9. Check resulting stock balance; if negative, accept and record alert in stock_alerts
      const [stockBalRow] = await tx
        .select({
          balance: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`,
        })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.pharmacyId, ctx.pharmacyId),
            eq(stockMovements.branchId, branchId),
            eq(stockMovements.batchId, line.batchId)
          )
        );

      const resultingBalance = Number(stockBalRow?.balance ?? 0);
      if (resultingBalance < 0) {
        await tx.insert(stockAlerts).values({
          id: generateUuidV7(),
          pharmacyId: ctx.pharmacyId,
          branchId,
          productId: line.productId,
          batchId: line.batchId,
          type: 'negative_stock',
          severity: 'warning',
          message: `Negative stock balance (${resultingBalance}) for batch ${line.batchId} after sale #${payload.invoiceNumber}`,
          createdAt: now,
        });
      }
    }
  }

  // 10. Insert Payments
  for (const payment of payload.payments) {
    await tx.insert(payments).values({
      id: payment.id,
      pharmacyId: ctx.pharmacyId,
      invoiceId: payload.id,
      method: payment.method,
      amountPaisa: payment.amountPaisa,
    });

    await insertChangeLog(tx, {
      pharmacyId: ctx.pharmacyId,
      entity: 'payment',
      entityId: payment.id,
      op: 'upsert',
      data: payment,
      createdAt: now,
    });
  }
}
