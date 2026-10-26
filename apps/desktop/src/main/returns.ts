import type { Database as DatabaseInstance } from 'better-sqlite3';
import { getDatabase } from './db';
import {
  generateUuidV7,
  roundHalfUp,
  type ProcessReturnInput,
  type CreditNoteRecord,
  type CreditNoteLineRecord,
  type ReturnableLineItem,
  ProcessReturnInputSchema,
} from '@pos/shared';
import { getSession, assertRole } from './auth';

interface RawInvoiceLine {
  id: string;
  invoice_id: string;
  product_id: string;
  batch_id: string | null;
  batch_no: string | null;
  expiry_date: string | null;
  quantity: number;
  unit_price_paisa: number;
  discount_paisa: number;
  tax_rate_bp: number;
  tax_paisa: number;
  line_total_paisa: number;
  brand_name: string | null;
  generic_name: string | null;
}

interface RawCreditNoteRow {
  id: string;
  credit_note_number: string;
  original_invoice_id: string;
  original_invoice_number: string;
  branch_id: string;
  counter_id: string;
  cashier_user_id: string;
  client_request_id: string;
  subtotal_paisa: number;
  tax_paisa: number;
  total_paisa: number;
  refund_method: 'cash' | 'card' | 'wallet' | 'credit';
  reason: 'defective_damaged' | 'expired' | 'customer_return' | 'dispensing_error' | 'other';
  notes: string | null;
  created_at: string;
  cashier_name: string | null;
  counter_name: string | null;
}

/**
 * Loads returnable balance for each line of an invoice (sold minus already returned).
 */
export function getReturnableInvoiceLines(
  invoiceId: string,
  rawDb?: DatabaseInstance
): ReturnableLineItem[] {
  const db = rawDb ?? getDatabase();

  const lines = db
    .prepare(`
      SELECT
        il.*,
        p.brand_name,
        p.generic_name,
        b.batch_no,
        b.expiry_date
      FROM invoice_lines il
      LEFT JOIN products p ON il.product_id = p.id
      LEFT JOIN batches b ON il.batch_id = b.id
      WHERE il.invoice_id = ?
      ORDER BY il.rowid ASC
    `)
    .all(invoiceId) as RawInvoiceLine[];

  const sumReturnedStmt = db.prepare<[string]>(`
    SELECT COALESCE(SUM(quantity), 0) as total_returned
    FROM credit_note_lines
    WHERE original_invoice_line_id = ?
  `);

  return lines.map((l) => {
    const returnedRow = sumReturnedStmt.get(l.id) as { total_returned: number };
    const alreadyReturned = returnedRow.total_returned;
    const returnableQuantity = Math.max(0, l.quantity - alreadyReturned);

    return {
      invoiceLineId: l.id,
      productId: l.product_id,
      brandName: l.brand_name ?? undefined,
      genericName: l.generic_name ?? undefined,
      batchId: l.batch_id,
      batchNo: l.batch_no,
      expiryDate: l.expiry_date,
      soldQuantity: l.quantity,
      alreadyReturnedQuantity: alreadyReturned,
      returnableQuantity,
      unitPricePaisa: l.unit_price_paisa,
      lineTotalPaisa: l.line_total_paisa,
    };
  });
}

/**
 * Loads an existing credit note by ID or clientRequestId.
 */
function loadCreditNote(
  db: DatabaseInstance,
  cnId: string
): CreditNoteRecord | null {
  const row = db
    .prepare(`
      SELECT
        cn.*,
        inv.invoice_number as original_invoice_number,
        u.name as cashier_name,
        c.name as counter_name
      FROM credit_notes cn
      LEFT JOIN invoices inv ON cn.original_invoice_id = inv.id
      LEFT JOIN users u ON cn.cashier_user_id = u.id
      LEFT JOIN counters c ON cn.counter_id = c.id
      WHERE cn.id = ?
    `)
    .get(cnId) as RawCreditNoteRow | undefined;

  if (!row) return null;

  const lines = db
    .prepare(`
      SELECT
        cnl.*,
        p.brand_name,
        p.generic_name,
        b.batch_no,
        b.expiry_date
      FROM credit_note_lines cnl
      LEFT JOIN products p ON cnl.product_id = p.id
      LEFT JOIN batches b ON cnl.batch_id = b.id
      WHERE cnl.credit_note_id = ?
      ORDER BY cnl.rowid ASC
    `)
    .all(row.id) as (CreditNoteLineRecord & { brand_name?: string; generic_name?: string })[];

  return {
    id: row.id,
    creditNoteNumber: row.credit_note_number,
    originalInvoiceId: row.original_invoice_id,
    originalInvoiceNumber: row.original_invoice_number,
    branchId: row.branch_id,
    counterId: row.counter_id,
    cashierUserId: row.cashier_user_id,
    clientRequestId: row.client_request_id,
    subtotalPaisa: row.subtotal_paisa,
    taxPaisa: row.tax_paisa,
    totalPaisa: row.total_paisa,
    refundMethod: row.refund_method,
    reason: row.reason,
    notes: row.notes,
    createdAt: row.created_at,
    cashierName: row.cashier_name ?? undefined,
    counterName: row.counter_name ?? undefined,
    lines: lines.map((l) => ({
      id: l.id,
      creditNoteId: l.creditNoteId,
      originalInvoiceLineId: l.originalInvoiceLineId,
      productId: l.productId,
      batchId: l.batchId,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      quantity: l.quantity,
      unitPricePaisa: l.unitPricePaisa,
      taxRateBp: l.taxRateBp,
      taxPaisa: l.taxPaisa,
      lineTotalPaisa: l.lineTotalPaisa,
      brandName: l.brandName,
      genericName: l.genericName,
    })),
  };
}

export interface ProcessReturnOptions {
  db?: DatabaseInstance;
  counterId?: string;
  cashierUserId?: string;
  branchId?: string;
}

/**
 * Processes an invoice return inside ONE SQLite transaction:
 * 1. Idempotency: checks clientRequestId.
 * 2. Validates return quantities <= sold - already returned.
 * 3. Proportional refund calculation for subtotal, tax, and line total.
 * 4. Increments counters.last_credit_note_seq.
 * 5. Creates immutable credit_notes and credit_note_lines.
 * 6. Creates POSITIVE stock_movements (type: 'return') back into the original batch.
 * 7. Creates outbox record ('credit_note.created').
 */
export function processReturn(
  input: ProcessReturnInput,
  options: ProcessReturnOptions = {}
): CreditNoteRecord {
  const validated = ProcessReturnInputSchema.parse(input);
  const db = options.db ?? getDatabase();

  const selectExistingStmt = db.prepare<[string]>(
    'SELECT id FROM credit_notes WHERE client_request_id = ?'
  );
  const selectInvoiceStmt = db.prepare<[string]>(
    'SELECT id, counter_id, invoice_number, status FROM invoices WHERE id = ?'
  );
  const selectCounterStmt = db.prepare<[string]>(
    'SELECT id, branch_id, name, code, last_credit_note_seq FROM counters WHERE id = ?'
  );
  const selectLineStmt = db.prepare<[string]>(`
    SELECT
      il.*,
      p.brand_name,
      p.generic_name,
      b.batch_no,
      b.expiry_date
    FROM invoice_lines il
    LEFT JOIN products p ON il.product_id = p.id
    LEFT JOIN batches b ON il.batch_id = b.id
    WHERE il.id = ?
  `);
  const sumReturnedStmt = db.prepare<[string]>(`
    SELECT COALESCE(SUM(quantity), 0) as total_returned
    FROM credit_note_lines
    WHERE original_invoice_line_id = ?
  `);
  const updateCounterSeqStmt = db.prepare<[string]>(
    'UPDATE counters SET last_credit_note_seq = last_credit_note_seq + 1 WHERE id = ?'
  );
  const insertCreditNoteStmt = db.prepare(`
    INSERT INTO credit_notes (
      id, credit_note_number, original_invoice_id, branch_id,
      counter_id, cashier_user_id, client_request_id,
      subtotal_paisa, tax_paisa, total_paisa,
      refund_method, reason, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCreditLineStmt = db.prepare(`
    INSERT INTO credit_note_lines (
      id, credit_note_id, original_invoice_line_id, product_id,
      batch_id, quantity, unit_price_paisa, tax_rate_bp,
      tax_paisa, line_total_paisa
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMovementStmt = db.prepare(`
    INSERT INTO stock_movements (
      id, product_id, batch_id, branch_id, type,
      quantity_signed, reference_type, reference_id,
      reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'return', ?, 'credit_note', ?, ?, ?, ?)
  `);
  const insertOutboxStmt = db.prepare(`
    INSERT INTO outbox (
      id, event_id, device_seq, type, event_type, entity_id, payload, occurred_at, status, attempts, created_at, synced_at
    ) VALUES (
      ?, ?, (SELECT COALESCE(MAX(device_seq), 0) + 1 FROM outbox), 'credit_note.created', 'credit_note.created', ?, ?, ?, 'pending', 0, ?, null
    )
  `);

  const executeReturnTx = db.transaction(() => {
    // 1. Idempotency Check
    const existing = selectExistingStmt.get(validated.clientRequestId) as
      | { id: string }
      | undefined;
    if (existing) {
      const loaded = loadCreditNote(db, existing.id);
      if (loaded) return loaded;
    }

    // 2. Load and validate original invoice
    const invoice = selectInvoiceStmt.get(validated.originalInvoiceId) as
      | { id: string; counter_id: string; invoice_number: string; status: string }
      | undefined;
    if (!invoice) {
      throw new Error(`Original invoice not found with id: ${validated.originalInvoiceId}`);
    }

    const counterId = options.counterId || invoice.counter_id;
    const counter = selectCounterStmt.get(counterId) as
      | { id: string; branch_id: string; name: string; code: string | null; last_credit_note_seq: number }
      | undefined;
    if (!counter) {
      throw new Error(`Counter not found with id: ${counterId}`);
    }

    const branchId = options.branchId || counter.branch_id;
    const cashierUserId = options.cashierUserId || 'system-return-user';
    const counterCode = counter.code || 'C1';

    // 3. Validate lines and calculate proportional totals
    interface ReturnComputedLine {
      originalLineId: string;
      productId: string;
      batchId: string | null;
      batchNo?: string;
      expiryDate?: string;
      brandName?: string;
      genericName?: string;
      quantity: number;
      unitPricePaisa: number;
      taxRateBp: number;
      taxPaisa: number;
      lineTotalPaisa: number;
      subtotalPaisa: number;
    }

    const computedLines: ReturnComputedLine[] = [];
    let creditSubtotalPaisa = 0;
    let creditTaxPaisa = 0;
    let creditTotalPaisa = 0;

    for (const item of validated.lines) {
      const origLine = selectLineStmt.get(item.invoiceLineId) as RawInvoiceLine | undefined;
      if (!origLine || origLine.invoice_id !== invoice.id) {
        throw new Error(
          `Invoice line ${item.invoiceLineId} does not belong to invoice #${invoice.invoice_number}`
        );
      }

      if (item.quantity <= 0) {
        throw new Error(`Return quantity must be strictly positive, received: ${item.quantity}`);
      }

      // Check remaining returnable quantity
      const returnedRow = sumReturnedStmt.get(origLine.id) as { total_returned: number };
      const alreadyReturned = returnedRow.total_returned;
      const remainingReturnable = origLine.quantity - alreadyReturned;

      if (item.quantity > remainingReturnable) {
        throw new Error(
          `Cannot return ${item.quantity} units for line ${origLine.id}: only ${remainingReturnable} unit(s) remain returnable.`
        );
      }

      // Proportional refund calculation
      const lineRefundTotalPaisa = roundHalfUp(
        origLine.line_total_paisa * item.quantity,
        origLine.quantity
      );
      const lineRefundTaxPaisa = roundHalfUp(
        origLine.tax_paisa * item.quantity,
        origLine.quantity
      );
      const lineRefundSubtotalPaisa = lineRefundTotalPaisa - lineRefundTaxPaisa;

      creditSubtotalPaisa += lineRefundSubtotalPaisa;
      creditTaxPaisa += lineRefundTaxPaisa;
      creditTotalPaisa += lineRefundTotalPaisa;

      computedLines.push({
        originalLineId: origLine.id,
        productId: origLine.product_id,
        batchId: origLine.batch_id,
        batchNo: origLine.batch_no ?? undefined,
        expiryDate: origLine.expiry_date ?? undefined,
        brandName: origLine.brand_name ?? undefined,
        genericName: origLine.generic_name ?? undefined,
        quantity: item.quantity,
        unitPricePaisa: origLine.unit_price_paisa,
        taxRateBp: origLine.tax_rate_bp,
        taxPaisa: lineRefundTaxPaisa,
        lineTotalPaisa: lineRefundTotalPaisa,
        subtotalPaisa: lineRefundSubtotalPaisa,
      });
    }

    // 4. Generate next credit note number
    updateCounterSeqStmt.run(counterId);
    const updatedCounter = selectCounterStmt.get(counterId) as typeof counter;
    const newSeq = updatedCounter.last_credit_note_seq;
    const creditNoteNumber = `CN-${counterCode}-${String(newSeq).padStart(6, '0')}`;

    const now = new Date().toISOString();
    const creditNoteId = generateUuidV7();

    // 5. Insert Credit Note header
    insertCreditNoteStmt.run(
      creditNoteId,
      creditNoteNumber,
      invoice.id,
      branchId,
      counterId,
      cashierUserId,
      validated.clientRequestId,
      creditSubtotalPaisa,
      creditTaxPaisa,
      creditTotalPaisa,
      validated.refundMethod,
      validated.reason,
      validated.notes ?? null,
      now
    );

    // 6. Insert Credit Note lines & POSITIVE stock movements back to original batch
    const createdLines: CreditNoteLineRecord[] = [];

    for (const cl of computedLines) {
      const lineId = generateUuidV7();

      // Insert credit note line
      insertCreditLineStmt.run(
        lineId,
        creditNoteId,
        cl.originalLineId,
        cl.productId,
        cl.batchId,
        cl.quantity,
        cl.unitPricePaisa,
        cl.taxRateBp,
        cl.taxPaisa,
        cl.lineTotalPaisa
      );

      // Insert positive stock movement (Rule 4: return increases stock)
      insertMovementStmt.run(
        generateUuidV7(),
        cl.productId,
        cl.batchId,
        branchId,
        cl.quantity, // POSITIVE SIGNED QUANTITY
        creditNoteId,
        `Credit Note #${creditNoteNumber} for Invoice #${invoice.invoice_number}`,
        now,
        now
      );

      createdLines.push({
        id: lineId,
        creditNoteId,
        originalInvoiceLineId: cl.originalLineId,
        productId: cl.productId,
        batchId: cl.batchId,
        batchNo: cl.batchNo,
        expiryDate: cl.expiryDate,
        quantity: cl.quantity,
        unitPricePaisa: cl.unitPricePaisa,
        taxRateBp: cl.taxRateBp,
        taxPaisa: cl.taxPaisa,
        lineTotalPaisa: cl.lineTotalPaisa,
        brandName: cl.brandName,
        genericName: cl.genericName,
      });
    }

    const creditNoteRecord: CreditNoteRecord = {
      id: creditNoteId,
      creditNoteNumber,
      originalInvoiceId: invoice.id,
      originalInvoiceNumber: invoice.invoice_number,
      branchId,
      counterId,
      cashierUserId,
      clientRequestId: validated.clientRequestId,
      subtotalPaisa: creditSubtotalPaisa,
      taxPaisa: creditTaxPaisa,
      totalPaisa: creditTotalPaisa,
      refundMethod: validated.refundMethod,
      reason: validated.reason,
      notes: validated.notes ?? null,
      createdAt: now,
      lines: createdLines,
    };

    // 7. Insert outbox record (Rule 5 & Rule 7)
    const outboxEventId = generateUuidV7();
    insertOutboxStmt.run(
      outboxEventId,
      outboxEventId,
      creditNoteRecord.id,
      JSON.stringify(creditNoteRecord),
      now,
      now
    );

    return creditNoteRecord;
  });

  return executeReturnTx.immediate();
}

/**
 * Role-guarded entry points for IPC.
 */
export async function roleGuardedProcessReturn(
  input: ProcessReturnInput,
  rawDb?: DatabaseInstance
): Promise<CreditNoteRecord> {
  const session = assertRole(getSession(), ['cashier', 'pharmacist', 'owner']);
  return processReturn(input, {
    db: rawDb,
    counterId: session.counter.id,
    cashierUserId: session.user.id,
    branchId: session.branch.id,
  });
}

export async function roleGuardedGetReturnableLines(
  invoiceId: string,
  rawDb?: DatabaseInstance
): Promise<ReturnableLineItem[]> {
  assertRole(getSession(), ['cashier', 'pharmacist', 'owner']);
  return getReturnableInvoiceLines(invoiceId, rawDb);
}
