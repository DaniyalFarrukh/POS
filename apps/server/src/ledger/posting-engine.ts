import { eq, and, inArray } from 'drizzle-orm';
import type {
  InvoiceCreatedPayload,
  CreditNoteCreatedPayload,
  PurchaseReceivedPayload,
} from '@pos/shared';
import type { DbClient } from '../sync/types';
import { batches, invoiceLines, invoices } from '../db/schema';
import { SyncRejectedError } from '../sync/errors';
import { getPharmacyAccountMap, type AccountRole } from './coa-seed';
import { postJournalEntry, type JournalEntryWithLines, type JournalLineInput } from './service';

const ISO_DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const karachiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Karachi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Converts a UTC ISO timestamp or YYYY-MM-DD string into a Karachi business date (YYYY-MM-DD).
 */
export function toKarachiBusinessDate(dateOrIso?: string | null): string {
  if (!dateOrIso) {
    return karachiDateFormatter.format(new Date());
  }
  const trimmed = dateOrIso.trim();
  if (ISO_DATE_ONLY_REGEX.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new SyncRejectedError(
      'INVALID_DATE',
      `Invalid document date '${dateOrIso}' for ledger posting`
    );
  }
  return karachiDateFormatter.format(parsed);
}

/**
 * Loads batch costs for a set of batchIds within a pharmacy and strictly validates
 * that every batch exists and has a positive integer `costPaisa > 0`.
 */
async function loadValidatedBatchCosts(
  tx: DbClient,
  pharmacyId: string,
  batchIds: string[],
  documentLabel: string
): Promise<Map<string, number>> {
  const uniqueIds = Array.from(new Set(batchIds));
  if (uniqueIds.length === 0) {
    throw new SyncRejectedError(
      'MISSING_BATCH_COST',
      `${documentLabel} is missing batch references required for COGS/inventory valuation`
    );
  }

  const rows = await tx
    .select({
      id: batches.id,
      batchNo: batches.batchNo,
      costPaisa: batches.costPaisa,
    })
    .from(batches)
    .where(and(eq(batches.pharmacyId, pharmacyId), inArray(batches.id, uniqueIds)));

  const costByBatchId = new Map<string, number>();
  for (const row of rows) {
    if (!Number.isInteger(row.costPaisa) || row.costPaisa <= 0) {
      throw new SyncRejectedError(
        'MISSING_BATCH_COST',
        `${documentLabel}: batch ${row.batchNo} (${row.id}) has missing or non-positive costPaisa (${row.costPaisa})`
      );
    }
    costByBatchId.set(row.id, row.costPaisa);
  }

  for (const id of uniqueIds) {
    if (!costByBatchId.has(id)) {
      throw new SyncRejectedError(
        'MISSING_BATCH_COST',
        `${documentLabel}: batch ${id} not found or has no batch cost for pharmacy ${pharmacyId}`
      );
    }
  }

  return costByBatchId;
}

function mapPaymentMethodToRole(method: 'cash' | 'card' | 'wallet' | 'credit'): AccountRole {
  switch (method) {
    case 'cash':
      return 'cash';
    case 'card':
      return 'bank';
    case 'wallet':
      return 'wallet';
    case 'credit':
      return 'ar';
  }
}

function mapRefundMethodToRole(method: 'cash' | 'card' | 'wallet' | 'credit'): AccountRole {
  switch (method) {
    case 'cash':
      return 'cash';
    case 'card':
      return 'bank';
    case 'wallet':
      return 'wallet';
    case 'credit':
      return 'ar';
  }
}

async function executePostJournalEntry(
  tx: DbClient,
  input: Parameters<typeof postJournalEntry>[1]
): Promise<JournalEntryWithLines> {
  try {
    return await postJournalEntry(tx, input);
  } catch (err) {
    if (err instanceof SyncRejectedError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Ledger posting failed';
    throw new SyncRejectedError('LEDGER_POSTING_FAILED', message);
  }
}

export interface PostPurchaseReceivedInput {
  pharmacyId: string;
  createdBy?: string | null;
  payload: PurchaseReceivedPayload;
}

/**
 * Posting rule for `purchase.received`:
 * - Debit `1200 Inventory` by sum(line.quantity * batch.costPaisa)
 * - Debit `1300 Input Sales Tax` by purchase.taxPaisa (if > 0)
 * - Credit `2000 Accounts Payable` by total (with party_type = 'supplier', party_id = supplier_id)
 */
export async function postPurchaseReceived(
  tx: DbClient,
  input: PostPurchaseReceivedInput
): Promise<JournalEntryWithLines> {
  const { pharmacyId, createdBy = null, payload } = input;
  const purchase = payload.purchase;
  const branchId = purchase.branchId;
  const docLabel = `Purchase GRN #${purchase.supplierInvoiceNo} (${purchase.id})`;

  for (let i = 0; i < payload.lines.length; i++) {
    const line = payload.lines[i]!;
    if (!line.batchId) {
      throw new SyncRejectedError(
        'MISSING_BATCH_COST',
        `${docLabel}: line #${i + 1} is missing batchId`
      );
    }
  }

  const batchIds = payload.lines.map((l) => l.batchId);
  const costByBatchId = await loadValidatedBatchCosts(tx, pharmacyId, batchIds, docLabel);

  let inventoryCostPaisa = 0;
  for (const line of payload.lines) {
    const batchCost = costByBatchId.get(line.batchId)!;
    inventoryCostPaisa += line.quantity * batchCost;
  }

  const inputTaxPaisa = Number(purchase.taxPaisa ?? 0);
  if (!Number.isInteger(inputTaxPaisa) || inputTaxPaisa < 0) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `${docLabel}: invalid taxPaisa (${purchase.taxPaisa})`
    );
  }

  const totalApPaisa = inventoryCostPaisa + inputTaxPaisa;
  const accountMap = await getPharmacyAccountMap(tx, pharmacyId);
  const entryDate = toKarachiBusinessDate(purchase.invoiceDate || purchase.createdAt);

  const lines: JournalLineInput[] = [
    {
      accountId: accountMap.inventory,
      debitPaisa: inventoryCostPaisa,
      creditPaisa: 0,
      branchId,
      memo: `GRN ${purchase.supplierInvoiceNo} inventory receipt`,
    },
  ];

  if (inputTaxPaisa > 0) {
    lines.push({
      accountId: accountMap.input_tax,
      debitPaisa: inputTaxPaisa,
      creditPaisa: 0,
      branchId,
      memo: `GRN ${purchase.supplierInvoiceNo} input sales tax`,
    });
  }

  lines.push({
    accountId: accountMap.ap,
    debitPaisa: 0,
    creditPaisa: totalApPaisa,
    branchId,
    partyType: purchase.supplierId ? 'supplier' : null,
    partyId: purchase.supplierId ?? null,
    memo: `GRN ${purchase.supplierInvoiceNo} payable`,
  });

  return executePostJournalEntry(tx, {
    pharmacyId,
    entryDate,
    sourceType: 'purchase',
    sourceId: purchase.id,
    memo: `Purchase received: GRN ${purchase.supplierInvoiceNo}`,
    createdBy: createdBy ?? purchase.createdByUserId ?? null,
    lines,
  });
}

export interface PostInvoiceCreatedInput {
  pharmacyId: string;
  branchId: string;
  createdBy?: string | null;
  invoice: InvoiceCreatedPayload;
}

/**
 * Posting rule for `invoice.created`:
 * 1. Revenue & tax leg:
 *    - Debit `1000 Cash in Hand` / `1010 Bank` / `1020 Mobile Wallets` per payment method
 *    - Credit `4000 Sales` by net revenue (`totalPaisa - taxPaisa`)
 *    - Credit `2100 Output Sales Tax Payable` by `taxPaisa` (if > 0)
 * 2. COGS & inventory leg:
 *    - Debit `5000 Cost of Goods Sold` by sum(line.quantity * batch.costPaisa)
 *    - Credit `1200 Inventory` by sum(line.quantity * batch.costPaisa)
 */
export async function postInvoiceCreated(
  tx: DbClient,
  input: PostInvoiceCreatedInput
): Promise<JournalEntryWithLines> {
  const { pharmacyId, branchId, createdBy = null, invoice } = input;
  const docLabel = `Invoice #${invoice.invoiceNumber} (${invoice.id})`;

  const batchIds: string[] = [];
  for (let i = 0; i < invoice.lines.length; i++) {
    const line = invoice.lines[i]!;
    if (!line.batchId) {
      throw new SyncRejectedError(
        'MISSING_BATCH_COST',
        `${docLabel}: invoice line #${i + 1} (${line.id}) is missing batchId required for COGS`
      );
    }
    batchIds.push(line.batchId);
  }

  const costByBatchId = await loadValidatedBatchCosts(tx, pharmacyId, batchIds, docLabel);

  let totalCogsPaisa = 0;
  for (const line of invoice.lines) {
    const batchCost = costByBatchId.get(line.batchId!)!;
    totalCogsPaisa += line.quantity * batchCost;
  }

  const netSalesPaisa = invoice.totalPaisa - invoice.taxPaisa;
  if (netSalesPaisa < 0) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `${docLabel}: taxPaisa (${invoice.taxPaisa}) exceeds totalPaisa (${invoice.totalPaisa})`
    );
  }

  const accountMap = await getPharmacyAccountMap(tx, pharmacyId);
  const entryDate = toKarachiBusinessDate(invoice.createdAt);

  // Aggregate payment debits by mapped accountId while preserving order
  const paymentDebitsByAccount = new Map<string, { amountPaisa: number; methods: string[] }>();
  for (const p of invoice.payments) {
    const role = mapPaymentMethodToRole(p.method);
    const accountId = accountMap[role];
    const existing = paymentDebitsByAccount.get(accountId);
    if (existing) {
      existing.amountPaisa += p.amountPaisa;
      if (!existing.methods.includes(p.method)) {
        existing.methods.push(p.method);
      }
    } else {
      paymentDebitsByAccount.set(accountId, {
        amountPaisa: p.amountPaisa,
        methods: [p.method],
      });
    }
  }

  const lines: JournalLineInput[] = [];

  for (const [accountId, info] of paymentDebitsByAccount.entries()) {
    if (info.amountPaisa > 0) {
      const isArAccount = accountId === accountMap.ar;
      lines.push({
        accountId,
        debitPaisa: info.amountPaisa,
        creditPaisa: 0,
        branchId,
        partyType: isArAccount && invoice.customerId ? 'customer' : undefined,
        partyId: isArAccount && invoice.customerId ? invoice.customerId : undefined,
        memo: `Sale #${invoice.invoiceNumber} payment (${info.methods.join(', ')})`,
      });
    }
  }

  if (netSalesPaisa > 0) {
    lines.push({
      accountId: accountMap.sales,
      debitPaisa: 0,
      creditPaisa: netSalesPaisa,
      branchId,
      memo: `Sale #${invoice.invoiceNumber} net revenue`,
    });
  }

  if (invoice.taxPaisa > 0) {
    lines.push({
      accountId: accountMap.output_tax,
      debitPaisa: 0,
      creditPaisa: invoice.taxPaisa,
      branchId,
      memo: `Sale #${invoice.invoiceNumber} output sales tax`,
    });
  }

  lines.push(
    {
      accountId: accountMap.cogs,
      debitPaisa: totalCogsPaisa,
      creditPaisa: 0,
      branchId,
      memo: `Sale #${invoice.invoiceNumber} cost of goods sold`,
    },
    {
      accountId: accountMap.inventory,
      debitPaisa: 0,
      creditPaisa: totalCogsPaisa,
      branchId,
      memo: `Sale #${invoice.invoiceNumber} inventory relief`,
    }
  );

  return executePostJournalEntry(tx, {
    pharmacyId,
    entryDate,
    sourceType: 'invoice',
    sourceId: invoice.id,
    memo: `POS Sale #${invoice.invoiceNumber}`,
    createdBy: createdBy ?? invoice.cashierUserId,
    lines,
  });
}

export interface PostCreditNoteCreatedInput {
  pharmacyId: string;
  createdBy?: string | null;
  creditNote: CreditNoteCreatedPayload;
}

/**
 * Posting rule for `credit_note.created` (customer return):
 * 1. Contra-revenue & tax reversal leg:
 *    - Debit `4090 Sales Returns and Discounts` by `totalPaisa - taxPaisa`
 *    - Debit `2100 Output Sales Tax Payable` by `taxPaisa` (if > 0)
 *    - Credit `1000 Cash` / `1010 Bank` / `1020 Wallet` / `1100 AR` by `totalPaisa`
 * 2. Inventory & COGS reversal leg:
 *    - Debit `1200 Inventory` by sum(line.quantity * batch.costPaisa)
 *    - Credit `5000 Cost of Goods Sold` by sum(line.quantity * batch.costPaisa)
 */
export async function postCreditNoteCreated(
  tx: DbClient,
  input: PostCreditNoteCreatedInput
): Promise<JournalEntryWithLines> {
  const { pharmacyId, createdBy = null, creditNote } = input;
  const branchId = creditNote.branchId;
  const docLabel = `Credit Note #${creditNote.creditNoteNumber} (${creditNote.id})`;

  // Resolve batchId for each line (falling back to original_invoice_lines.batch_id if omitted)
  const resolvedBatchIdByLineId = new Map<string, string>();
  const missingOrigLineIds: string[] = [];

  for (const line of creditNote.lines) {
    if (line.batchId) {
      resolvedBatchIdByLineId.set(line.id, line.batchId);
    } else {
      missingOrigLineIds.push(line.originalInvoiceLineId);
    }
  }

  if (missingOrigLineIds.length > 0) {
    const origLines = await tx
      .select({
        id: invoiceLines.id,
        batchId: invoiceLines.batchId,
      })
      .from(invoiceLines)
      .where(
        and(eq(invoiceLines.pharmacyId, pharmacyId), inArray(invoiceLines.id, missingOrigLineIds))
      );

    const origBatchMap = new Map<string, string | null>(origLines.map((ol) => [ol.id, ol.batchId]));

    for (const line of creditNote.lines) {
      if (!line.batchId) {
        const fallbackBatchId = origBatchMap.get(line.originalInvoiceLineId);
        if (!fallbackBatchId) {
          throw new SyncRejectedError(
            'MISSING_BATCH_COST',
            `${docLabel}: line ${line.id} has no batchId and original invoice line ${line.originalInvoiceLineId} has no batchId`
          );
        }
        resolvedBatchIdByLineId.set(line.id, fallbackBatchId);
      }
    }
  }

  const allBatchIds = Array.from(resolvedBatchIdByLineId.values());
  const costByBatchId = await loadValidatedBatchCosts(tx, pharmacyId, allBatchIds, docLabel);

  let totalReturnCostPaisa = 0;
  for (const line of creditNote.lines) {
    const batchId = resolvedBatchIdByLineId.get(line.id)!;
    const batchCost = costByBatchId.get(batchId)!;
    totalReturnCostPaisa += line.quantity * batchCost;
  }

  const netReturnPaisa = creditNote.totalPaisa - creditNote.taxPaisa;
  if (netReturnPaisa < 0) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `${docLabel}: taxPaisa (${creditNote.taxPaisa}) exceeds totalPaisa (${creditNote.totalPaisa})`
    );
  }

  const accountMap = await getPharmacyAccountMap(tx, pharmacyId);
  const refundRole = mapRefundMethodToRole(creditNote.refundMethod);
  const refundAccountId = accountMap[refundRole];
  const entryDate = toKarachiBusinessDate(creditNote.createdAt);

  let customerId = (creditNote as { customerId?: string | null }).customerId || null;
  if (!customerId && creditNote.refundMethod === 'credit') {
    const [origInv] = await tx
      .select({ customerId: invoices.customerId })
      .from(invoices)
      .where(
        and(eq(invoices.pharmacyId, pharmacyId), eq(invoices.id, creditNote.originalInvoiceId))
      )
      .limit(1);
    customerId = origInv?.customerId ?? null;
  }

  const lines: JournalLineInput[] = [];

  if (netReturnPaisa > 0) {
    lines.push({
      accountId: accountMap.sales_returns,
      debitPaisa: netReturnPaisa,
      creditPaisa: 0,
      branchId,
      memo: `Return #${creditNote.creditNoteNumber} sales return`,
    });
  }

  if (creditNote.taxPaisa > 0) {
    lines.push({
      accountId: accountMap.output_tax,
      debitPaisa: creditNote.taxPaisa,
      creditPaisa: 0,
      branchId,
      memo: `Return #${creditNote.creditNoteNumber} output tax reversal`,
    });
  }

  if (creditNote.totalPaisa > 0) {
    const isCredit = creditNote.refundMethod === 'credit';
    lines.push({
      accountId: refundAccountId,
      debitPaisa: 0,
      creditPaisa: creditNote.totalPaisa,
      branchId,
      partyType: isCredit && customerId ? 'customer' : null,
      partyId: isCredit && customerId ? customerId : null,
      memo: `Return #${creditNote.creditNoteNumber} refund (${creditNote.refundMethod})`,
    });
  }

  lines.push(
    {
      accountId: accountMap.inventory,
      debitPaisa: totalReturnCostPaisa,
      creditPaisa: 0,
      branchId,
      memo: `Return #${creditNote.creditNoteNumber} inventory restock`,
    },
    {
      accountId: accountMap.cogs,
      debitPaisa: 0,
      creditPaisa: totalReturnCostPaisa,
      branchId,
      memo: `Return #${creditNote.creditNoteNumber} COGS reversal`,
    }
  );

  return executePostJournalEntry(tx, {
    pharmacyId,
    entryDate,
    sourceType: 'credit_note',
    sourceId: creditNote.id,
    memo: `Credit Note #${creditNote.creditNoteNumber}: ${creditNote.reason}`,
    createdBy: createdBy ?? creditNote.cashierUserId,
    lines,
  });
}

export interface PostStockAdjustmentCreatedInput {
  pharmacyId: string;
  movementId: string;
  branchId: string;
  productId: string;
  batchId: string;
  quantitySigned: number;
  reason: string;
  createdAt?: string | null;
  createdBy?: string | null;
}

/**
 * Posting rule for `stock_adjustment.created`:
 * - Negative adjustment (`quantitySigned < 0`):
 *   Debit `5010 Stock Adjustments and Write-offs`, Credit `1200 Inventory` by `|qty| * batch.costPaisa`
 * - Positive adjustment (`quantitySigned > 0`):
 *   Debit `1200 Inventory`, Credit `5010 Stock Adjustments and Write-offs` by `qty * batch.costPaisa`
 */
export async function postStockAdjustmentCreated(
  tx: DbClient,
  input: PostStockAdjustmentCreatedInput
): Promise<JournalEntryWithLines> {
  const {
    pharmacyId,
    movementId,
    branchId,
    batchId,
    quantitySigned,
    reason,
    createdAt,
    createdBy = null,
  } = input;

  const docLabel = `Stock Adjustment (${movementId})`;
  if (!batchId) {
    throw new SyncRejectedError('MISSING_BATCH_COST', `${docLabel}: missing batchId`);
  }
  if (!Number.isInteger(quantitySigned) || quantitySigned === 0) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `${docLabel}: quantitySigned must be a non-zero integer`
    );
  }

  const costByBatchId = await loadValidatedBatchCosts(tx, pharmacyId, [batchId], docLabel);
  const batchCostPaisa = costByBatchId.get(batchId)!;
  const adjustmentValuePaisa = Math.abs(quantitySigned) * batchCostPaisa;

  const accountMap = await getPharmacyAccountMap(tx, pharmacyId);
  const entryDate = toKarachiBusinessDate(createdAt);

  const lines: JournalLineInput[] =
    quantitySigned < 0
      ? [
          {
            accountId: accountMap.stock_adjustment,
            debitPaisa: adjustmentValuePaisa,
            creditPaisa: 0,
            branchId,
            memo: `Stock write-off (${quantitySigned}): ${reason}`,
          },
          {
            accountId: accountMap.inventory,
            debitPaisa: 0,
            creditPaisa: adjustmentValuePaisa,
            branchId,
            memo: `Inventory reduction (${quantitySigned}): ${reason}`,
          },
        ]
      : [
          {
            accountId: accountMap.inventory,
            debitPaisa: adjustmentValuePaisa,
            creditPaisa: 0,
            branchId,
            memo: `Inventory gain (+${quantitySigned}): ${reason}`,
          },
          {
            accountId: accountMap.stock_adjustment,
            debitPaisa: 0,
            creditPaisa: adjustmentValuePaisa,
            branchId,
            memo: `Stock surplus (+${quantitySigned}): ${reason}`,
          },
        ];

  return executePostJournalEntry(tx, {
    pharmacyId,
    entryDate,
    sourceType: 'stock_adjustment',
    sourceId: movementId,
    memo: `Stock adjustment: ${reason}`,
    createdBy,
    lines,
  });
}

export interface PostStockTransferReceivedInput {
  pharmacyId: string;
  sourceBranchId: string;
  destinationBranchId: string;
  transferId: string;
  transferNumber: string;
  createdBy?: string | null;
  lines: Array<{
    batchId: string;
    quantityReceived: number;
    shortageQuantity?: number;
  }>;
}

/**
 * Posting rule for `stock_transfer.received` between branches:
 * - Debit `1200 Inventory` (branch_id = destinationBranchId) by sum(batch cost * quantityReceived)
 * - Credit `1200 Inventory` (branch_id = sourceBranchId) by sum(batch cost * quantityReceived)
 * - P&L effect: 0. Inventory stays one account, with branch dimension on lines.
 * - Shortages (if any):
 *   - Debit `5010 Stock Adjustments` (branch_id = sourceBranchId)
 *   - Credit `1200 Inventory` (branch_id = sourceBranchId)
 */
export async function postStockTransferReceived(
  tx: DbClient,
  input: PostStockTransferReceivedInput
): Promise<JournalEntryWithLines | null> {
  const {
    pharmacyId,
    sourceBranchId,
    destinationBranchId,
    transferId,
    transferNumber,
    createdBy = null,
    lines,
  } = input;

  // Intra-branch transfers (within same branch across locations) post no general ledger journal
  if (sourceBranchId === destinationBranchId) {
    return null;
  }

  const docLabel = `Stock Transfer #${transferNumber} (${transferId})`;
  const batchIds = lines.map((l) => l.batchId);
  const costByBatchId = await loadValidatedBatchCosts(tx, pharmacyId, batchIds, docLabel);

  let totalTransferCostPaisa = 0;
  let totalShortageCostPaisa = 0;

  for (const line of lines) {
    const cost = costByBatchId.get(line.batchId)!;
    totalTransferCostPaisa += line.quantityReceived * cost;
    if (line.shortageQuantity && line.shortageQuantity > 0) {
      totalShortageCostPaisa += line.shortageQuantity * cost;
    }
  }

  if (totalTransferCostPaisa === 0 && totalShortageCostPaisa === 0) {
    return null;
  }

  const accountMap = await getPharmacyAccountMap(tx, pharmacyId);
  const invAccountId = accountMap.inventory;
  const adjAccountId = accountMap.stock_adjustment;

  const entryLines: Array<{
    accountId: string;
    debitPaisa: number;
    creditPaisa: number;
    branchId: string;
    memo?: string;
  }> = [];

  if (totalTransferCostPaisa > 0) {
    entryLines.push({
      accountId: invAccountId,
      debitPaisa: totalTransferCostPaisa,
      creditPaisa: 0,
      branchId: destinationBranchId,
      memo: `Stock transfer received from ${sourceBranchId}`,
    });
    entryLines.push({
      accountId: invAccountId,
      debitPaisa: 0,
      creditPaisa: totalTransferCostPaisa,
      branchId: sourceBranchId,
      memo: `Stock transfer dispatched to ${destinationBranchId}`,
    });
  }

  if (totalShortageCostPaisa > 0) {
    entryLines.push({
      accountId: adjAccountId,
      debitPaisa: totalShortageCostPaisa,
      creditPaisa: 0,
      branchId: sourceBranchId,
      memo: `Shortage loss during transit #${transferNumber}`,
    });
    entryLines.push({
      accountId: invAccountId,
      debitPaisa: 0,
      creditPaisa: totalShortageCostPaisa,
      branchId: sourceBranchId,
      memo: `Inventory reduction for transit shortage #${transferNumber}`,
    });
  }

  const today = toKarachiBusinessDate();
  return await executePostJournalEntry(tx, {
    pharmacyId,
    entryDate: today,
    sourceType: 'stock_transfer',
    sourceId: transferId,
    memo: `Stock transfer #${transferNumber}`,
    createdBy,
    lines: entryLines,
  });
}

export interface PostSupplierReturnCompletedInput {
  pharmacyId: string;
  branchId: string;
  supplierId: string;
  returnId: string;
  returnNumber: string;
  debitNoteNumber: string;
  subtotalPaisa: number;
  taxPaisa?: number;
  totalPaisa: number;
  returnDate?: string | null;
  createdBy?: string | null;
}

/**
 * Posting rule for completed supplier return & debit note:
 * - Debit `2000 Accounts Payable` (supplier party) by totalPaisa (reduces payable liability)
 * - Credit `1200 Inventory` by subtotalPaisa (reduces inventory value)
 * - Credit `1300 Input Sales Tax` by taxPaisa (if tax > 0)
 */
export async function postSupplierReturnCompleted(
  tx: DbClient,
  input: PostSupplierReturnCompletedInput
): Promise<JournalEntryWithLines> {
  const {
    pharmacyId,
    branchId,
    supplierId,
    returnId,
    returnNumber,
    debitNoteNumber,
    subtotalPaisa,
    taxPaisa = 0,
    totalPaisa,
    returnDate,
    createdBy = null,
  } = input;

  const accountMap = await getPharmacyAccountMap(tx, pharmacyId);
  const entryDate = toKarachiBusinessDate(returnDate);

  const lines: JournalLineInput[] = [
    {
      accountId: accountMap.ap,
      debitPaisa: totalPaisa,
      creditPaisa: 0,
      branchId,
      partyType: 'supplier',
      partyId: supplierId,
      memo: `Debit Note #${debitNoteNumber} payable reduction (Return #${returnNumber})`,
    },
    {
      accountId: accountMap.inventory,
      debitPaisa: 0,
      creditPaisa: subtotalPaisa,
      branchId,
      memo: `Return #${returnNumber} inventory reduction`,
    },
  ];

  if (taxPaisa > 0) {
    lines.push({
      accountId: accountMap.input_tax,
      debitPaisa: 0,
      creditPaisa: taxPaisa,
      branchId,
      memo: `Debit Note #${debitNoteNumber} input tax adjustment`,
    });
  }

  return executePostJournalEntry(tx, {
    pharmacyId,
    entryDate,
    sourceType: 'supplier_return',
    sourceId: returnId,
    memo: `Supplier Return #${returnNumber} (Debit Note #${debitNoteNumber})`,
    createdBy,
    lines,
  });
}

export interface PostFinancialPaymentInput {
  pharmacyId: string;
  paymentId: string;
  paymentNumber: string;
  paymentDate: string; // YYYY-MM-DD
  branchId: string;
  direction: 'receipt' | 'payment';
  partyType: 'customer' | 'supplier';
  partyId: string;
  partyName: string;
  method: 'cash' | 'bank' | 'wallet' | 'cheque';
  amountPaisa: number;
  allocatedPaisa: number;
  advancePaisa: number;
  chequeNumber?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

/**
 * Posting rules for ERP financial payments (Customer Receipts & Supplier Payments):
 * 1. Customer Receipt (direction: 'receipt'):
 *    - Dr 1000 Cash / 1010 Bank / 1020 Mobile Wallets for amountPaisa
 *    - Cr 1100 Accounts Receivable for allocatedPaisa (party_type: 'customer', party_id: customerId)
 *    - Cr 2400 Customer Advances for advancePaisa (party_type: 'customer', party_id: customerId)
 * 2. Supplier Payment (direction: 'payment'):
 *    - Dr 2000 Accounts Payable for allocatedPaisa (party_type: 'supplier', party_id: supplierId)
 *    - Dr 1400 Advances to Suppliers for advancePaisa (party_type: 'supplier', party_id: supplierId)
 *    - Cr 1000 Cash / 1010 Bank / 1020 Mobile Wallets for amountPaisa
 */
export async function postFinancialPaymentCompleted(
  tx: DbClient,
  input: PostFinancialPaymentInput
): Promise<JournalEntryWithLines> {
  const {
    pharmacyId,
    paymentId,
    paymentNumber,
    paymentDate,
    branchId,
    direction,
    partyId,
    partyName,
    method,
    amountPaisa,
    allocatedPaisa,
    advancePaisa,
    chequeNumber,
    createdBy = null,
  } = input;

  if (amountPaisa !== allocatedPaisa + advancePaisa) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Payment amount (${amountPaisa}) must equal allocated (${allocatedPaisa}) + advance (${advancePaisa})`
    );
  }

  const accountMap = await getPharmacyAccountMap(tx, pharmacyId);
  const entryDate = toKarachiBusinessDate(paymentDate);

  // Mapped liquid asset account
  let liquidAccountId = accountMap.cash;
  if (method === 'bank' || method === 'cheque') {
    liquidAccountId = accountMap.bank;
  } else if (method === 'wallet') {
    liquidAccountId = accountMap.wallet;
  }

  const methodLabel =
    method === 'cheque' && chequeNumber ? `Cheque #${chequeNumber}` : method.toUpperCase();
  const lines: JournalLineInput[] = [];

  if (direction === 'receipt') {
    // Dr Liquid Account
    lines.push({
      accountId: liquidAccountId,
      debitPaisa: amountPaisa,
      creditPaisa: 0,
      branchId,
      memo: `Receipt #${paymentNumber} from ${partyName} via ${methodLabel}`,
    });

    // Cr Accounts Receivable for allocated portion
    if (allocatedPaisa > 0) {
      lines.push({
        accountId: accountMap.ar,
        debitPaisa: 0,
        creditPaisa: allocatedPaisa,
        branchId,
        partyType: 'customer',
        partyId,
        memo: `Receipt #${paymentNumber} applied against invoice balance`,
      });
    }

    // Cr Customer Advances for unallocated / overpayment portion
    if (advancePaisa > 0) {
      lines.push({
        accountId: accountMap.customer_advances,
        debitPaisa: 0,
        creditPaisa: advancePaisa,
        branchId,
        partyType: 'customer',
        partyId,
        memo: `Receipt #${paymentNumber} customer advance balance`,
      });
    }
  } else {
    // Direction === 'payment' (Supplier Payment)
    // Dr Accounts Payable for allocated portion
    if (allocatedPaisa > 0) {
      lines.push({
        accountId: accountMap.ap,
        debitPaisa: allocatedPaisa,
        creditPaisa: 0,
        branchId,
        partyType: 'supplier',
        partyId,
        memo: `Payment #${paymentNumber} to ${partyName} applied against purchase bill`,
      });
    }

    // Dr Advances to Suppliers for unallocated / overpayment portion
    if (advancePaisa > 0) {
      lines.push({
        accountId: accountMap.advance_suppliers,
        debitPaisa: advancePaisa,
        creditPaisa: 0,
        branchId,
        partyType: 'supplier',
        partyId,
        memo: `Payment #${paymentNumber} supplier advance balance`,
      });
    }

    // Cr Liquid Account
    lines.push({
      accountId: liquidAccountId,
      debitPaisa: 0,
      creditPaisa: amountPaisa,
      branchId,
      memo: `Payment #${paymentNumber} to ${partyName} via ${methodLabel}`,
    });
  }

  return executePostJournalEntry(tx, {
    pharmacyId,
    entryDate,
    sourceType: direction === 'receipt' ? 'customer_receipt' : 'supplier_payment',
    sourceId: paymentId,
    memo: `${direction === 'receipt' ? 'Customer Receipt' : 'Supplier Payment'} #${paymentNumber} (${partyName})`,
    createdBy,
    lines,
  });
}

export interface PostExpenseInput {
  expenseId: string;
  expenseNumber: string;
  pharmacyId: string;
  branchId: string;
  expenseDate: string; // ISO or YYYY-MM-DD
  expenseAccountId: string;
  amountPaisa: number;
  paymentType: 'paid' | 'credit';
  paymentMethod?: 'cash' | 'bank' | 'wallet' | null;
  supplierId?: string | null;
  vendorName?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

/**
 * Posting rules for ERP Expenses:
 * 1. Paid Expense:
 *    - Dr Expense Account (from Expense Category) for amountPaisa
 *    - Cr 1000 Cash / 1010 Bank / 1020 Mobile Wallets for amountPaisa
 * 2. Credit Expense (Payable):
 *    - Dr Expense Account (from Expense Category) for amountPaisa
 *    - Cr 2000 Accounts Payable for amountPaisa (party_type: 'supplier')
 */
export async function postExpenseCompleted(
  tx: DbClient,
  input: PostExpenseInput
): Promise<JournalEntryWithLines> {
  const {
    pharmacyId,
    expenseId,
    expenseNumber,
    expenseDate,
    expenseAccountId,
    branchId,
    amountPaisa,
    paymentType,
    paymentMethod = 'cash',
    vendorName,
    notes,
    createdBy = null,
  } = input;

  if (amountPaisa <= 0) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Expense amount (${amountPaisa}) must be positive integer paisa`
    );
  }

  const accountMap = await getPharmacyAccountMap(tx, pharmacyId);
  const entryDate = toKarachiBusinessDate(expenseDate);
  const lines: JournalLineInput[] = [];

  // Dr Expense Account
  lines.push({
    accountId: expenseAccountId,
    debitPaisa: amountPaisa,
    creditPaisa: 0,
    branchId,
    partyType: vendorName ? 'supplier' : null,
    memo: `Expense #${expenseNumber}${notes ? ` - ${notes}` : ''}`,
  });

  // Cr Credit Account (Liquid Asset if Paid, Accounts Payable if Credit)
  if (paymentType === 'paid') {
    let liquidAccountId = accountMap.cash;
    if (paymentMethod === 'bank') {
      liquidAccountId = accountMap.bank;
    } else if (paymentMethod === 'wallet') {
      liquidAccountId = accountMap.wallet;
    }

    const methodLabel = (paymentMethod || 'cash').toUpperCase();
    lines.push({
      accountId: liquidAccountId,
      debitPaisa: 0,
      creditPaisa: amountPaisa,
      branchId,
      memo: `Expense #${expenseNumber} paid via ${methodLabel}`,
    });
  } else {
    // Payment type === 'credit'
    if (input.supplierId) {
      lines.push({
        accountId: accountMap.ap,
        debitPaisa: 0,
        creditPaisa: amountPaisa,
        branchId,
        partyType: 'supplier',
        partyId: input.supplierId,
        memo: `Expense #${expenseNumber} payable to ${vendorName || 'Vendor'}`,
      });
    } else {
      // Unlinked vendor without supplier record: credit 2300 Other Payables so 2000 Trade AP stays reconciled
      lines.push({
        accountId: accountMap.other_payables,
        debitPaisa: 0,
        creditPaisa: amountPaisa,
        branchId,
        partyType: null,
        partyId: null,
        memo: `Expense #${expenseNumber} payable to ${vendorName || 'Vendor'}`,
      });
    }
  }

  return executePostJournalEntry(tx, {
    pharmacyId,
    entryDate,
    sourceType: 'expense',
    sourceId: expenseId,
    memo: `Expense #${expenseNumber}${vendorName ? ` (${vendorName})` : ''}`,
    createdBy,
    lines,
  });
}
