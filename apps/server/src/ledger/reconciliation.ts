import { eq, and, gte, lte, sql } from 'drizzle-orm';
import type { DbClient } from '../sync/types';
import {
  accounts,
  batches,
  creditNotes,
  invoices,
  journalEntries,
  journalLines,
  stockMovements,
} from '../db/schema';
import { getPharmacyAccountMap } from './coa-seed';
import { toKarachiBusinessDate } from './posting-engine';

export interface LedgerReconciliationResult {
  pharmacyId: string;
  from: string;
  to: string;
  // Gross sales reconciliation (Invoice totals minus Credit Note totals vs Ledger Revenue + Output Tax)
  ledgerSalesTotalPaisa: number;
  documentsSalesTotalPaisa: number;
  salesDifferencePaisa: number;
  // Net revenue reconciliation (Ledger 4000 Sales minus 4090 Sales Returns vs Invoice net minus Credit Note net)
  ledgerNetSalesPaisa: number;
  documentsNetSalesPaisa: number;
  netSalesDifferencePaisa: number;
  // Inventory valuation reconciliation as of `to` (Ledger 1200 Inventory vs sum of batch_stock * batch_cost)
  ledgerInventoryValuePaisa: number;
  batchesInventoryValuePaisa: number;
  inventoryDifferencePaisa: number;
  isReconciled: boolean;
}

/**
 * Reconciles the general ledger against operational documents and batch stock movements:
 * 1. For `[from, to]`, verifies ledger sales total equals the sum of invoice totals minus credit notes
 *    (both gross including output tax and net revenue excluding output tax).
 * 2. As of `to`, verifies ledger inventory value (`1200 Inventory`) equals `sum(batch_stock * batch_cost)`.
 */
export async function reconcileLedger(
  db: DbClient,
  pharmacyId: string,
  from: string,
  to: string
): Promise<LedgerReconciliationResult> {
  const accountMap = await getPharmacyAccountMap(db, pharmacyId);

  // 1. Operational documents in [from, to] (using Karachi business date)
  const allInvoices = await db
    .select({
      totalPaisa: invoices.totalPaisa,
      taxPaisa: invoices.taxPaisa,
      createdAt: invoices.createdAt,
    })
    .from(invoices)
    .where(eq(invoices.pharmacyId, pharmacyId));

  let docInvoiceGrossPaisa = 0;
  let docInvoiceNetPaisa = 0;
  for (const inv of allInvoices) {
    const bizDate = toKarachiBusinessDate(inv.createdAt);
    if (bizDate >= from && bizDate <= to) {
      docInvoiceGrossPaisa += Number(inv.totalPaisa);
      docInvoiceNetPaisa += Number(inv.totalPaisa) - Number(inv.taxPaisa);
    }
  }

  const allCreditNotes = await db
    .select({
      totalPaisa: creditNotes.totalPaisa,
      taxPaisa: creditNotes.taxPaisa,
      createdAt: creditNotes.createdAt,
    })
    .from(creditNotes)
    .where(eq(creditNotes.pharmacyId, pharmacyId));

  let docCreditNoteGrossPaisa = 0;
  let docCreditNoteNetPaisa = 0;
  for (const cn of allCreditNotes) {
    const bizDate = toKarachiBusinessDate(cn.createdAt);
    if (bizDate >= from && bizDate <= to) {
      docCreditNoteGrossPaisa += Number(cn.totalPaisa);
      docCreditNoteNetPaisa += Number(cn.totalPaisa) - Number(cn.taxPaisa);
    }
  }

  const documentsSalesTotalPaisa = docInvoiceGrossPaisa - docCreditNoteGrossPaisa;
  const documentsNetSalesPaisa = docInvoiceNetPaisa - docCreditNoteNetPaisa;

  // 2. Ledger revenue & output tax lines in [from, to]
  const periodLines = await db
    .select({
      accountId: journalLines.accountId,
      accountCode: accounts.code,
      accountType: accounts.type,
      sourceType: journalEntries.sourceType,
      debitPaisa: journalLines.debitPaisa,
      creditPaisa: journalLines.creditPaisa,
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      and(
        eq(journalLines.entryId, journalEntries.id),
        eq(journalEntries.pharmacyId, pharmacyId)
      )
    )
    .innerJoin(
      accounts,
      and(
        eq(journalLines.accountId, accounts.id),
        eq(accounts.pharmacyId, pharmacyId)
      )
    )
    .where(
      and(
        eq(journalLines.pharmacyId, pharmacyId),
        gte(journalEntries.entryDate, from),
        lte(journalEntries.entryDate, to)
      )
    );

  let ledgerNetSalesPaisa = 0;
  let ledgerOutputTaxNetPaisa = 0;

  for (const line of periodLines) {
    const debit = Number(line.debitPaisa);
    const credit = Number(line.creditPaisa);

    const isSalesOrReturnAccount =
      line.accountId === accountMap.sales ||
      line.accountId === accountMap.sales_returns ||
      (line.accountType === 'revenue' &&
        (line.sourceType === 'invoice' || line.sourceType === 'credit_note'));

    if (isSalesOrReturnAccount) {
      ledgerNetSalesPaisa += credit - debit;
    } else if (
      line.accountId === accountMap.output_tax &&
      (line.sourceType === 'invoice' || line.sourceType === 'credit_note')
    ) {
      ledgerOutputTaxNetPaisa += credit - debit;
    }
  }

  const ledgerSalesTotalPaisa = ledgerNetSalesPaisa + ledgerOutputTaxNetPaisa;
  const salesDifferencePaisa = ledgerSalesTotalPaisa - documentsSalesTotalPaisa;
  const netSalesDifferencePaisa = ledgerNetSalesPaisa - documentsNetSalesPaisa;

  // 3. Inventory valuation reconciliation as of `to`
  // 3a. Ledger 1200 Inventory balance up to `to`
  const [invLedgerRow] = await db
    .select({
      totalDebit: sql<number>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
      totalCredit: sql<number>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      and(
        eq(journalLines.entryId, journalEntries.id),
        eq(journalEntries.pharmacyId, pharmacyId)
      )
    )
    .where(
      and(
        eq(journalLines.pharmacyId, pharmacyId),
        eq(journalLines.accountId, accountMap.inventory),
        lte(journalEntries.entryDate, to)
      )
    );

  const ledgerInventoryValuePaisa =
    Number(invLedgerRow?.totalDebit ?? 0) - Number(invLedgerRow?.totalCredit ?? 0);

  // 3b. Sum of (batch_stock * batch_cost) from stock_movements up to `to`
  const movementRows = await db
    .select({
      batchId: stockMovements.batchId,
      quantitySigned: stockMovements.quantitySigned,
      createdAt: stockMovements.createdAt,
      costPaisa: batches.costPaisa,
    })
    .from(stockMovements)
    .innerJoin(
      batches,
      and(
        eq(stockMovements.batchId, batches.id),
        eq(batches.pharmacyId, pharmacyId)
      )
    )
    .where(eq(stockMovements.pharmacyId, pharmacyId));

  const stockByBatch = new Map<string, { qty: number; costPaisa: number }>();
  for (const row of movementRows) {
    const movDate = toKarachiBusinessDate(row.createdAt);
    if (movDate <= to) {
      const existing = stockByBatch.get(row.batchId);
      if (existing) {
        existing.qty += Number(row.quantitySigned);
      } else {
        stockByBatch.set(row.batchId, {
          qty: Number(row.quantitySigned),
          costPaisa: Number(row.costPaisa),
        });
      }
    }
  }

  let batchesInventoryValuePaisa = 0;
  for (const info of stockByBatch.values()) {
    batchesInventoryValuePaisa += info.qty * info.costPaisa;
  }

  const inventoryDifferencePaisa =
    ledgerInventoryValuePaisa - batchesInventoryValuePaisa;

  const isReconciled =
    salesDifferencePaisa === 0 &&
    netSalesDifferencePaisa === 0 &&
    inventoryDifferencePaisa === 0;

  return {
    pharmacyId,
    from,
    to,
    ledgerSalesTotalPaisa,
    documentsSalesTotalPaisa,
    salesDifferencePaisa,
    ledgerNetSalesPaisa,
    documentsNetSalesPaisa,
    netSalesDifferencePaisa,
    ledgerInventoryValuePaisa,
    batchesInventoryValuePaisa,
    inventoryDifferencePaisa,
    isReconciled,
  };
}

