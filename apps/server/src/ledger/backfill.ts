import { eq, and, asc } from 'drizzle-orm';
import type { PurchaseBatchInput, PurchaseLineInputItem } from '@pos/shared';
import type { DbClient } from '../sync/types';
import {
  pharmacies,
  counters,
  batches,
  invoices,
  invoiceLines,
  payments,
  creditNotes,
  creditNoteLines,
  stockMovements,
  journalEntries,
} from '../db/schema';
import {
  postPurchaseReceived,
  postInvoiceCreated,
  postCreditNoteCreated,
  postStockAdjustmentCreated,
  toKarachiBusinessDate,
} from './posting-engine';

export interface BackfillBucketSummary {
  count: number;
  totalPaisa: number;
}

export interface BackfillLedgerSummary {
  dryRun: boolean;
  pharmacyId?: string;
  purchases: BackfillBucketSummary;
  invoices: BackfillBucketSummary;
  creditNotes: BackfillBucketSummary;
  stockAdjustments: BackfillBucketSummary;
  totalEntriesPosted: number;
}

export interface BackfillLedgerOptions {
  pharmacyId?: string;
  dryRun?: boolean;
}

async function runInTx<T>(db: DbClient, fn: (tx: DbClient) => Promise<T>): Promise<T> {
  const maybeTxCapable = db as DbClient & {
    transaction?: <R>(cb: (tx: DbClient) => Promise<R>) => Promise<R>;
  };
  if (typeof maybeTxCapable.transaction === 'function') {
    return maybeTxCapable.transaction(fn);
  }
  return fn(db);
}

/**
 * Finds all operational documents (`purchase`, `invoice`, `credit_note`, `stock_adjustment`)
 * that have no corresponding `journal_entries` row and posts their balanced journal entries.
 * Idempotent: safe to run repeatedly. Supports `dryRun: true` to inspect counts and totals without writing.
 */
export async function backfillLedgerEntries(
  db: DbClient,
  options: BackfillLedgerOptions = {}
): Promise<BackfillLedgerSummary> {
  const dryRun = options.dryRun ?? false;

  const targetPharmacies = options.pharmacyId
    ? await db
        .select({ id: pharmacies.id })
        .from(pharmacies)
        .where(eq(pharmacies.id, options.pharmacyId))
    : await db.select({ id: pharmacies.id }).from(pharmacies).orderBy(asc(pharmacies.createdAt));

  const summary: BackfillLedgerSummary = {
    dryRun,
    pharmacyId: options.pharmacyId,
    purchases: { count: 0, totalPaisa: 0 },
    invoices: { count: 0, totalPaisa: 0 },
    creditNotes: { count: 0, totalPaisa: 0 },
    stockAdjustments: { count: 0, totalPaisa: 0 },
    totalEntriesPosted: 0,
  };

  for (const pharm of targetPharmacies) {
    const pharmacyId = pharm.id;

    const existingEntries = await db
      .select({
        sourceType: journalEntries.sourceType,
        sourceId: journalEntries.sourceId,
      })
      .from(journalEntries)
      .where(eq(journalEntries.pharmacyId, pharmacyId));

    const postedKeySet = new Set<string>();
    for (const e of existingEntries) {
      if (e.sourceType && e.sourceId) {
        postedKeySet.add(`${e.sourceType}:${e.sourceId}`);
      }
    }

    // 1. Backfill unposted purchases (grouped from purchase stock_movements)
    const purchaseMovements = await db
      .select({
        movementId: stockMovements.id,
        productId: stockMovements.productId,
        batchId: stockMovements.batchId,
        branchId: stockMovements.branchId,
        quantitySigned: stockMovements.quantitySigned,
        referenceId: stockMovements.referenceId,
        reason: stockMovements.reason,
        createdAt: stockMovements.createdAt,
        batchNo: batches.batchNo,
        expiryDate: batches.expiryDate,
        costPaisa: batches.costPaisa,
        mrpPaisa: batches.mrpPaisa,
      })
      .from(stockMovements)
      .innerJoin(
        batches,
        and(eq(stockMovements.batchId, batches.id), eq(batches.pharmacyId, pharmacyId))
      )
      .where(and(eq(stockMovements.pharmacyId, pharmacyId), eq(stockMovements.type, 'purchase')))
      .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id));

    const purchasesByRef = new Map<string, Array<(typeof purchaseMovements)[number]>>();
    for (const pm of purchaseMovements) {
      const refId = pm.referenceId ?? pm.movementId;
      if (postedKeySet.has(`purchase:${refId}`)) {
        continue;
      }
      const list = purchasesByRef.get(refId) ?? [];
      list.push(pm);
      purchasesByRef.set(refId, list);
    }

    for (const [purchaseId, rows] of purchasesByRef.entries()) {
      const first = rows[0]!;
      let totalCostPaisa = 0;
      const batchSnapshots: PurchaseBatchInput[] = [];
      const lineItems: PurchaseLineInputItem[] = [];

      for (const r of rows) {
        const qty = Math.abs(Number(r.quantitySigned));
        const cost = Number(r.costPaisa);
        totalCostPaisa += qty * cost;

        batchSnapshots.push({
          id: r.batchId,
          productId: r.productId,
          batchNo: r.batchNo,
          expiryDate: r.expiryDate,
          costPaisa: cost,
          mrpPaisa: Number(r.mrpPaisa),
        });

        lineItems.push({
          id: r.movementId,
          movementId: r.movementId,
          productId: r.productId,
          batchId: r.batchId,
          quantity: qty,
          costPaisa: cost,
          mrpPaisa: Number(r.mrpPaisa),
        });
      }

      const supplierInvoiceNo =
        first.reason?.replace(/^GRN:\s*/i, '').trim() || `BF-${purchaseId.slice(0, 8)}`;

      summary.purchases.count += 1;
      summary.purchases.totalPaisa += totalCostPaisa;
      summary.totalEntriesPosted += 1;

      if (!dryRun) {
        await runInTx(db, (tx) =>
          postPurchaseReceived(tx, {
            pharmacyId,
            payload: {
              purchase: {
                id: purchaseId,
                branchId: first.branchId,
                supplierId: null,
                supplierInvoiceNo,
                invoiceDate: toKarachiBusinessDate(first.createdAt),
                totalCostPaisa,
                taxPaisa: 0,
                createdAt: first.createdAt,
              },
              batches: batchSnapshots,
              lines: lineItems,
            },
          })
        );
      }
    }

    // 2. Backfill unposted invoices
    const invoiceRows = await db
      .select({
        invoice: invoices,
        branchId: counters.branchId,
      })
      .from(invoices)
      .innerJoin(
        counters,
        and(eq(invoices.counterId, counters.id), eq(counters.pharmacyId, pharmacyId))
      )
      .where(eq(invoices.pharmacyId, pharmacyId))
      .orderBy(asc(invoices.createdAt), asc(invoices.id));

    for (const row of invoiceRows) {
      const inv = row.invoice;
      if (postedKeySet.has(`invoice:${inv.id}`)) {
        continue;
      }

      const lines = await db
        .select()
        .from(invoiceLines)
        .where(and(eq(invoiceLines.pharmacyId, pharmacyId), eq(invoiceLines.invoiceId, inv.id)))
        .orderBy(asc(invoiceLines.id));

      const invPayments = await db
        .select()
        .from(payments)
        .where(and(eq(payments.pharmacyId, pharmacyId), eq(payments.invoiceId, inv.id)))
        .orderBy(asc(payments.id));

      summary.invoices.count += 1;
      summary.invoices.totalPaisa += Number(inv.totalPaisa);
      summary.totalEntriesPosted += 1;

      if (!dryRun) {
        await runInTx(db, (tx) =>
          postInvoiceCreated(tx, {
            pharmacyId,
            branchId: row.branchId,
            createdBy: inv.cashierUserId,
            invoice: {
              id: inv.id,
              counterId: inv.counterId,
              cashierUserId: inv.cashierUserId,
              invoiceNumber: inv.invoiceNumber,
              clientRequestId: inv.clientRequestId,
              status: inv.status,
              subtotalPaisa: Number(inv.subtotalPaisa),
              discountPaisa: Number(inv.discountPaisa),
              taxPaisa: Number(inv.taxPaisa),
              totalPaisa: Number(inv.totalPaisa),
              notes: inv.notes,
              createdAt: inv.createdAt,
              lines: lines.map((l) => ({
                id: l.id,
                productId: l.productId,
                batchId: l.batchId,
                quantity: Number(l.quantity),
                unitPricePaisa: Number(l.unitPricePaisa),
                discountPaisa: Number(l.discountPaisa),
                taxRateBp: Number(l.taxRateBp),
                taxPaisa: Number(l.taxPaisa),
                lineTotalPaisa: Number(l.lineTotalPaisa),
              })),
              payments: invPayments.map((p) => ({
                id: p.id,
                method: p.method as 'cash' | 'card' | 'wallet',
                amountPaisa: Number(p.amountPaisa),
              })),
            },
          })
        );
      }
    }

    // 3. Backfill unposted credit notes
    const creditNoteRows = await db
      .select()
      .from(creditNotes)
      .where(eq(creditNotes.pharmacyId, pharmacyId))
      .orderBy(asc(creditNotes.createdAt), asc(creditNotes.id));

    for (const cn of creditNoteRows) {
      if (postedKeySet.has(`credit_note:${cn.id}`)) {
        continue;
      }

      const cnLines = await db
        .select()
        .from(creditNoteLines)
        .where(
          and(eq(creditNoteLines.pharmacyId, pharmacyId), eq(creditNoteLines.creditNoteId, cn.id))
        )
        .orderBy(asc(creditNoteLines.id));

      summary.creditNotes.count += 1;
      summary.creditNotes.totalPaisa += Number(cn.totalPaisa);
      summary.totalEntriesPosted += 1;

      if (!dryRun) {
        await runInTx(db, (tx) =>
          postCreditNoteCreated(tx, {
            pharmacyId,
            createdBy: cn.cashierUserId,
            creditNote: {
              id: cn.id,
              creditNoteNumber: cn.creditNoteNumber,
              originalInvoiceId: cn.originalInvoiceId,
              branchId: cn.branchId,
              counterId: cn.counterId,
              cashierUserId: cn.cashierUserId,
              clientRequestId: cn.clientRequestId,
              subtotalPaisa: Number(cn.subtotalPaisa),
              taxPaisa: Number(cn.taxPaisa),
              totalPaisa: Number(cn.totalPaisa),
              refundMethod: cn.refundMethod as 'cash' | 'card' | 'wallet' | 'credit',
              reason: cn.reason,
              notes: cn.notes,
              createdAt: cn.createdAt,
              lines: cnLines.map((l) => ({
                id: l.id,
                originalInvoiceLineId: l.originalInvoiceLineId,
                productId: l.productId,
                batchId: l.batchId,
                quantity: Number(l.quantity),
                unitPricePaisa: Number(l.unitPricePaisa),
                taxRateBp: Number(l.taxRateBp),
                taxPaisa: Number(l.taxPaisa),
                lineTotalPaisa: Number(l.lineTotalPaisa),
              })),
            },
          })
        );
      }
    }

    // 4. Backfill unposted stock adjustments
    const adjustmentRows = await db
      .select({
        movementId: stockMovements.id,
        productId: stockMovements.productId,
        batchId: stockMovements.batchId,
        branchId: stockMovements.branchId,
        quantitySigned: stockMovements.quantitySigned,
        reason: stockMovements.reason,
        createdAt: stockMovements.createdAt,
        costPaisa: batches.costPaisa,
      })
      .from(stockMovements)
      .innerJoin(
        batches,
        and(eq(stockMovements.batchId, batches.id), eq(batches.pharmacyId, pharmacyId))
      )
      .where(and(eq(stockMovements.pharmacyId, pharmacyId), eq(stockMovements.type, 'adjustment')))
      .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id));

    for (const adj of adjustmentRows) {
      if (postedKeySet.has(`stock_adjustment:${adj.movementId}`)) {
        continue;
      }

      const valuePaisa = Math.abs(Number(adj.quantitySigned)) * Number(adj.costPaisa);
      summary.stockAdjustments.count += 1;
      summary.stockAdjustments.totalPaisa += valuePaisa;
      summary.totalEntriesPosted += 1;

      if (!dryRun) {
        await runInTx(db, (tx) =>
          postStockAdjustmentCreated(tx, {
            pharmacyId,
            movementId: adj.movementId,
            branchId: adj.branchId,
            productId: adj.productId,
            batchId: adj.batchId,
            quantitySigned: Number(adj.quantitySigned),
            reason: adj.reason || 'Stock adjustment backfill',
            createdAt: adj.createdAt,
          })
        );
      }
    }
  }

  return summary;
}
