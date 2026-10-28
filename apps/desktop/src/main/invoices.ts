import type { Database as DatabaseInstance } from 'better-sqlite3';
import { getDatabase } from './db';
import {
  generateUuidV7,
  computeInvoiceTotals,
  getKarachiBusinessDate,
  getKarachiDayStartUtc,
  getKarachiDayEndUtc,
  type AuthSession,
  type CreateInvoiceInput,
  CreateInvoiceInputSchema,
  type InvoiceRecord,
  type InvoiceLineRecord,
  type PaymentRecord,
} from '@pos/shared';
import { getSession, assertRole } from './auth';

/**
 * Creates a finalized customer invoice, along with invoice lines, payment,
 * signed stock deductions, and an outbox event in ONE atomic transaction.
 * Strictly adheres to Rules 1, 2, 3, 4, 5, 7, and 8.
 */
export function createInvoice(
  input: CreateInvoiceInput,
  session: AuthSession,
  rawDb?: DatabaseInstance
): InvoiceRecord {
  const data = CreateInvoiceInputSchema.parse(input);
  const db = rawDb ?? getDatabase();

  if (!session?.branch?.id || !session?.counter?.id || !session?.user?.id) {
    throw new Error('Valid active session with branch, counter, and user is required to issue an invoice.');
  }

  const branchId = session.branch.id;
  const counterId = session.counter.id;
  const userId = session.user.id;
  const now = new Date().toISOString();
  const dateKey = getKarachiBusinessDate(now); // YYYY-MM-DD in Asia/Karachi

  // 1. Calculate invoice monetary totals via @pos/shared
  const computed = computeInvoiceTotals(
    data.lines.map((l) => ({
      unitPricePaisa: l.unitPricePaisa,
      quantity: l.quantity,
      discountBp: l.discountType === 'percent' ? l.discountBp : undefined,
      flatDiscountPaisa: l.discountType === 'flat' ? l.flatDiscountPaisa : undefined,
      taxRateBp: l.taxRateBp,
      isTaxExempt: l.isTaxExempt,
    }))
  );

  const grandTotalPaisa = computed.grandTotalPaisa;

  // 2. Validate and calculate payment
  let amountPaisa = grandTotalPaisa;
  let tenderedPaisa = data.tenderedPaisa ?? grandTotalPaisa;
  let changePaisa = 0;

  if (data.paymentMethod === 'cash') {
    if (tenderedPaisa < grandTotalPaisa) {
      throw new Error(`Insufficient cash tendered: expected at least ${grandTotalPaisa} paisa, received ${tenderedPaisa}.`);
    }
    changePaisa = tenderedPaisa - grandTotalPaisa;
    amountPaisa = grandTotalPaisa;
  } else {
    // Non-cash payments (card, bank transfer) are exact
    tenderedPaisa = grandTotalPaisa;
    changePaisa = 0;
    amountPaisa = grandTotalPaisa;
  }

  // 3. Generate sequential invoice number (e.g. INV-20261026-0001)
  const countRow = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM invoices i
      JOIN counters c ON i.counter_id = c.id
      WHERE c.branch_id = ? AND i.created_at >= ?
    `)
    .get(branchId, getKarachiDayStartUtc(dateKey)) as { count: number } | undefined;
  const seq = (countRow?.count ?? 0) + 1;
  const compactDate = dateKey.replace(/-/g, '');
  const invoiceNumber = `INV-${compactDate}-${String(seq).padStart(4, '0')}`;

  const invoiceId = generateUuidV7();
  const paymentId = generateUuidV7();
  const clientRequestId = generateUuidV7();

  // Prepare batch lookup if line batchId was not explicitly passed
  const findBatchStmt = db.prepare<[string, string]>(`
    SELECT b.id, b.batch_no as batchNo, b.expiry_date as expiryDate,
           COALESCE(SUM(sm.quantity_signed), 0) as balance
    FROM batches b
    LEFT JOIN stock_movements sm ON b.id = sm.batch_id AND sm.branch_id = ?
    WHERE b.product_id = ?
    GROUP BY b.id
    HAVING balance > 0
    ORDER BY b.expiry_date ASC
    LIMIT 1
  `);

  const fallbackBatchStmt = db.prepare<[string]>(`
    SELECT id, batch_no as batchNo, expiry_date as expiryDate
    FROM batches
    WHERE product_id = ?
    ORDER BY expiry_date ASC
    LIMIT 1
  `);

  const productLookupStmt = db.prepare<[string]>(`
    SELECT brand_name, generic_name, strength, form
    FROM products
    WHERE id = ?
  `);

  // 4. Execute atomic transaction (Rule 5)
  const executeTx = db.transaction(() => {
    // Insert invoice header
    db.prepare(`
      INSERT INTO invoices (
        id, counter_id, cashier_user_id, invoice_number, client_request_id,
        status, subtotal_paisa, discount_paisa, tax_paisa, total_paisa,
        notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoiceId,
      counterId,
      userId,
      invoiceNumber,
      clientRequestId,
      'finalized',
      computed.netTotalPaisa,
      computed.totalDiscountPaisa,
      computed.totalTaxPaisa,
      grandTotalPaisa,
      data.notes ?? data.customerName ?? null,
      now
    );

    const createdLines: (InvoiceLineRecord & { movementId?: string })[] = [];

    // Insert invoice lines & stock movements
    const insertLineStmt = db.prepare(`
      INSERT INTO invoice_lines (
        id, invoice_id, product_id, batch_id,
        quantity, unit_price_paisa, discount_paisa,
        tax_rate_bp, tax_paisa, line_total_paisa
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMovementStmt = db.prepare(`
      INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type,
        quantity_signed, reference_type, reference_id,
        reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < data.lines.length; i++) {
      const lineInput = data.lines[i]!;
      const lineComputed = computed.lines[i]!;
      const lineId = generateUuidV7();

      // Resolve batch
      let batchId = lineInput.batchId ?? null;
      let batchNo = lineInput.batchNo ?? null;
      let expiryDate = lineInput.expiryDate ?? null;

      if (!batchId) {
        const found = findBatchStmt.get(branchId, lineInput.productId) as {
          id: string;
          batchNo: string;
          expiryDate: string;
        } | undefined;

        if (found) {
          batchId = found.id;
          batchNo = found.batchNo;
          expiryDate = found.expiryDate;
        } else {
          const fallback = fallbackBatchStmt.get(lineInput.productId) as {
            id: string;
            batchNo: string;
            expiryDate: string;
          } | undefined;
          if (fallback) {
            batchId = fallback.id;
            batchNo = fallback.batchNo;
            expiryDate = fallback.expiryDate;
          }
        }
      }

      // Insert line row
      insertLineStmt.run(
        lineId,
        invoiceId,
        lineInput.productId,
        batchId,
        lineInput.quantity,
        lineInput.unitPricePaisa,
        lineComputed.discountPaisa,
        lineComputed.taxRateBp,
        lineComputed.taxAmountPaisa,
        lineComputed.lineTotalPaisa
      );

      // Insert negative stock movement (Rule 2 & Rule 4: preserve client movementId)
      const movementId = generateUuidV7();
      if (batchId) {
        insertMovementStmt.run(
          movementId,
          lineInput.productId,
          batchId,
          branchId,
          'sale',
          -lineInput.quantity, // Negative quantity decrements inventory
          'invoice',
          invoiceId,
          `Sale #${invoiceNumber}`,
          now,
          now
        );
      }

      const prodInfo = productLookupStmt.get(lineInput.productId) as {
        brand_name: string;
        generic_name: string;
        strength: string;
        form: string;
      } | undefined;

      createdLines.push({
        id: lineId,
        movementId,
        invoiceId,
        productId: lineInput.productId,
        batchId,
        batchNo,
        expiryDate,
        quantity: lineInput.quantity,
        unitPricePaisa: lineInput.unitPricePaisa,
        discountBp: lineInput.discountBp ?? 0,
        discountPaisa: lineComputed.discountPaisa,
        taxRateBp: lineComputed.taxRateBp,
        taxPaisa: lineComputed.taxAmountPaisa,
        lineTotalPaisa: lineComputed.lineTotalPaisa,
        brandName: prodInfo?.brand_name,
        genericName: prodInfo?.generic_name,
        strength: prodInfo?.strength,
        form: prodInfo?.form,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Insert payment row
    const paymentMethod: 'cash' | 'card' | 'wallet' =
      data.paymentMethod === 'card'
        ? 'card'
        : data.paymentMethod === 'cash'
          ? 'cash'
          : 'wallet';

    db.prepare(`
      INSERT INTO payments (
        id, invoice_id, method, amount_paisa
      ) VALUES (?, ?, ?, ?)
    `).run(
      paymentId,
      invoiceId,
      paymentMethod,
      amountPaisa
    );

    // Insert fiscal submission record
    db.prepare(`
      INSERT INTO fiscal_submissions (
        id, invoice_id, status, fiscal_invoice_number, qr_payload, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateUuidV7(),
      invoiceId,
      'not_required',
      null,
      null,
      now,
      now
    );

    const paymentRecord: PaymentRecord = {
      id: paymentId,
      invoiceId,
      paymentMethod: data.paymentMethod,
      amountPaisa,
      tenderedPaisa,
      changePaisa,
      reference: data.paymentReference ?? null,
      createdAt: now,
    };

    const invoiceRecord: InvoiceRecord = {
      id: invoiceId,
      invoiceNumber,
      branchId,
      counterId,
      userId,
      customerName: data.customerName ?? null,
      customerPhone: data.customerPhone ?? null,
      doctorName: data.doctorName ?? null,
      notes: data.notes ?? null,
      subtotalPaisa: computed.netTotalPaisa,
      discountPaisa: computed.totalDiscountPaisa,
      taxPaisa: computed.totalTaxPaisa,
      grandTotalPaisa,
      paidPaisa: amountPaisa,
      changePaisa,
      status: 'finalized',
      fiscalStatus: 'not_required',
      createdAt: now,
      updatedAt: now,
      lines: createdLines,
      payment: paymentRecord,
      userName: session.user.name,
      counterName: session.counter.name,
    };

    // Insert outbox event for offline cloud sync matching InvoiceCreatedPayloadSchema (Rule 5 & 7)
    const outboxEventId = generateUuidV7();
    const outboxPayload = {
      id: invoiceId,
      counterId,
      cashierUserId: userId,
      invoiceNumber,
      clientRequestId,
      status: 'finalized' as const,
      subtotalPaisa: computed.netTotalPaisa,
      discountPaisa: computed.totalDiscountPaisa,
      taxPaisa: computed.totalTaxPaisa,
      totalPaisa: grandTotalPaisa,
      notes: data.notes ?? data.customerName ?? null,
      createdAt: now,
      lines: createdLines.map((l) => ({
        id: l.id,
        movementId: l.movementId,
        invoiceId: l.invoiceId,
        productId: l.productId,
        batchId: l.batchId ?? null,
        quantity: l.quantity,
        unitPricePaisa: l.unitPricePaisa,
        discountPaisa: l.discountPaisa,
        taxRateBp: l.taxRateBp,
        taxPaisa: l.taxPaisa,
        lineTotalPaisa: l.lineTotalPaisa,
      })),
      payments: [
        {
          id: paymentId,
          invoiceId,
          method: paymentMethod,
          amountPaisa,
        },
      ],
    };
    db.prepare(`
      INSERT INTO outbox (
        id, event_id, device_seq, type, event_type, entity_id, payload, occurred_at, status, attempts, created_at, synced_at
      ) VALUES (
        ?, ?, (SELECT COALESCE(MAX(device_seq), 0) + 1 FROM outbox), 'invoice.created', 'invoice.created', ?, ?, ?, 'pending', 0, ?, null
      )
    `).run(
      outboxEventId,
      outboxEventId,
      invoiceRecord.id,
      JSON.stringify(outboxPayload),
      now,
      now
    );

    return invoiceRecord;
  });

  return executeTx();
}

/**
 * Retrieves recent finalized invoices for cashier terminal history.
 */
import {
  finalizeSale,
  type FinalizedInvoice,
  type FinalizeSaleInput as CoreFinalizeSaleInput,
} from './finalizeSale';
import {
  FinalizeSaleInputSchema,
  type InvoiceSearchParams,
  type FinalizeSaleInput,
} from '@pos/shared';

interface RawInvoiceRow {
  id: string;
  invoice_number: string;
  branch_id: string;
  counter_id: string;
  cashier_user_id: string;
  client_request_id: string;
  notes: string | null;
  subtotal_paisa: number;
  discount_paisa: number;
  tax_paisa: number;
  total_paisa: number;
  status: 'finalized';
  created_at: string;
  user_name: string | null;
  counter_name: string | null;
}

interface RawLineRow {
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
  strength: string | null;
  form: string | null;
}

interface RawPaymentRow {
  id: string;
  invoice_id: string;
  method: 'cash' | 'card' | 'wallet';
  amount_paisa: number;
}

function mapInvoiceRows(
  db: DatabaseInstance,
  rows: RawInvoiceRow[]
): InvoiceRecord[] {
  const lineStmt = db.prepare<[string]>(`
    SELECT
      il.*,
      p.brand_name,
      p.generic_name,
      p.strength,
      p.form,
      b.batch_no,
      b.expiry_date
    FROM invoice_lines il
    LEFT JOIN products p ON il.product_id = p.id
    LEFT JOIN batches b ON il.batch_id = b.id
    WHERE il.invoice_id = ?
    ORDER BY il.rowid ASC
  `);

  const paymentStmt = db.prepare<[string]>(`
    SELECT * FROM payments WHERE invoice_id = ? ORDER BY rowid ASC
  `);

  return rows.map((r) => {
    const rawLines = lineStmt.all(r.id) as RawLineRow[];
    const lines: InvoiceLineRecord[] = rawLines.map((l) => ({
      id: l.id,
      invoiceId: l.invoice_id,
      productId: l.product_id,
      batchId: l.batch_id,
      batchNo: l.batch_no,
      expiryDate: l.expiry_date,
      quantity: l.quantity,
      unitPricePaisa: l.unit_price_paisa,
      discountBp: 0,
      discountPaisa: l.discount_paisa,
      taxRateBp: l.tax_rate_bp,
      taxPaisa: l.tax_paisa,
      lineTotalPaisa: l.line_total_paisa,
      brandName: l.brand_name ?? undefined,
      genericName: l.generic_name ?? undefined,
      strength: l.strength ?? undefined,
      form: l.form ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.created_at,
    }));

    const rawPayments = paymentStmt.all(r.id) as RawPaymentRow[];
    const payments: PaymentRecord[] = rawPayments.map((p) => ({
      id: p.id,
      invoiceId: p.invoice_id,
      paymentMethod: (p.method === 'wallet' ? 'bank' : p.method) as 'cash' | 'card' | 'bank',
      amountPaisa: p.amount_paisa,
      tenderedPaisa: p.amount_paisa,
      changePaisa: 0,
      reference: null,
      createdAt: r.created_at,
    }));

    const primaryPayment = payments[0];

    let customerName: string | null = null;
    let customerPhone: string | null = null;
    let doctorName: string | null = null;
    let notes: string | null = r.notes;

    if (r.notes) {
      const parts = r.notes.split(' | ');
      let hasPrefixedPart = false;
      for (const p of parts) {
        if (p.startsWith('Customer: ')) {
          customerName = p.replace('Customer: ', '').trim();
          hasPrefixedPart = true;
        } else if (p.startsWith('Phone: ')) {
          customerPhone = p.replace('Phone: ', '').trim();
          hasPrefixedPart = true;
        } else if (p.startsWith('Doctor: ')) {
          doctorName = p.replace('Doctor: ', '').trim();
          hasPrefixedPart = true;
        } else if (p.startsWith('Note: ')) {
          notes = p.replace('Note: ', '').trim();
          hasPrefixedPart = true;
        }
      }
      if (!hasPrefixedPart && !r.notes.includes(' | ')) {
        customerName = r.notes.trim();
      }
    }

    return {
      id: r.id,
      invoiceNumber: r.invoice_number,
      branchId: r.branch_id,
      counterId: r.counter_id,
      userId: r.cashier_user_id,
      customerName,
      customerPhone,
      doctorName,
      notes,
      subtotalPaisa: r.subtotal_paisa,
      discountPaisa: r.discount_paisa,
      taxPaisa: r.tax_paisa,
      grandTotalPaisa: r.total_paisa,
      paidPaisa: r.total_paisa,
      changePaisa: 0,
      status: r.status,
      fiscalStatus: 'not_required',
      fiscalInvoiceNumber: null,
      qrPayload: null,
      createdAt: r.created_at,
      updatedAt: r.created_at,
      lines,
      payment: primaryPayment,
      payments,
      userName: r.user_name ?? undefined,
      counterName: r.counter_name ?? undefined,
    };
  });
}

/**
 * Searches finalized invoices with optional query (number/notes), date range, and pagination.
 */
export function searchInvoices(
  branchId?: string,
  params?: InvoiceSearchParams,
  rawDb?: DatabaseInstance
): InvoiceRecord[] {
  const db = rawDb ?? getDatabase();
  const queryParams: unknown[] = [];
  const whereClauses: string[] = [];

  if (branchId) {
    whereClauses.push('c.branch_id = ?');
    queryParams.push(branchId);
  }

  if (params?.query && params.query.trim()) {
    const q = `%${params.query.trim()}%`;
    whereClauses.push('(i.invoice_number LIKE ? OR i.notes LIKE ?)');
    queryParams.push(q, q);
  }

  if (params?.dateFrom) {
    whereClauses.push('i.created_at >= ?');
    queryParams.push(getKarachiDayStartUtc(params.dateFrom));
  }

  if (params?.dateTo) {
    whereClauses.push('i.created_at <= ?');
    queryParams.push(getKarachiDayEndUtc(params.dateTo));
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;
  queryParams.push(limit, offset);

  const rows = db
    .prepare(`
      SELECT
        i.*,
        c.branch_id,
        u.name as user_name,
        c.name as counter_name
      FROM invoices i
      LEFT JOIN users u ON i.cashier_user_id = u.id
      LEFT JOIN counters c ON i.counter_id = c.id
      ${whereSql}
      ORDER BY i.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...queryParams) as RawInvoiceRow[];

  return mapInvoiceRows(db, rows);
}

/**
 * Retrieves a single finalized invoice by ID with all lines and payments.
 */
export function getInvoiceById(
  invoiceId: string,
  rawDb?: DatabaseInstance
): InvoiceRecord | null {
  const db = rawDb ?? getDatabase();
  const rows = db
    .prepare(`
      SELECT
        i.*,
        c.branch_id,
        u.name as user_name,
        c.name as counter_name
      FROM invoices i
      LEFT JOIN users u ON i.cashier_user_id = u.id
      LEFT JOIN counters c ON i.counter_id = c.id
      WHERE i.id = ?
      LIMIT 1
    `)
    .all(invoiceId) as RawInvoiceRow[];

  const results = mapInvoiceRows(db, rows);
  return results[0] ?? null;
}

/**
 * Retrieves recent finalized invoices for cashier terminal history.
 */
export function getRecentInvoices(
  branchId?: string,
  limit = 20,
  rawDb?: DatabaseInstance
): InvoiceRecord[] {
  return searchInvoices(branchId, { limit, offset: 0 }, rawDb);
}

/**
 * Role-guarded IPC entry points. Cashiers, Pharmacists, and Owners can finalize sales.
 */
export async function roleGuardedFinalizeSale(
  input: FinalizeSaleInput,
  rawDb?: DatabaseInstance
): Promise<FinalizedInvoice> {
  const session = assertRole(getSession(), ['cashier', 'pharmacist', 'owner']);
  const validated = FinalizeSaleInputSchema.parse(input);

  const fullInput: CoreFinalizeSaleInput = {
    clientRequestId: validated.clientRequestId,
    counterId: session.counter.id,
    cashierUserId: session.user.id,
    lines: validated.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      discountPaisa: l.discountPaisa ?? 0,
    })),
    payments: validated.payments,
    notes: validated.notes ?? null,
  };

  return finalizeSale(fullInput, { db: rawDb });
}

export async function roleGuardedCreateInvoice(
  input: CreateInvoiceInput,
  rawDb?: DatabaseInstance
): Promise<InvoiceRecord> {
  const session = assertRole(getSession(), ['cashier', 'pharmacist', 'owner']);
  return createInvoice(input, session, rawDb);
}

export async function roleGuardedGetRecentInvoices(
  limit = 20,
  rawDb?: DatabaseInstance
): Promise<InvoiceRecord[]> {
  const session = assertRole(getSession(), ['cashier', 'pharmacist', 'owner']);
  return getRecentInvoices(session.branch.id, limit, rawDb);
}

export async function roleGuardedSearchInvoices(
  params?: InvoiceSearchParams,
  rawDb?: DatabaseInstance
): Promise<InvoiceRecord[]> {
  const session = assertRole(getSession(), ['cashier', 'pharmacist', 'owner']);
  return searchInvoices(session.branch.id, params, rawDb);
}

export async function roleGuardedGetInvoiceById(
  invoiceId: string,
  rawDb?: DatabaseInstance
): Promise<InvoiceRecord | null> {
  assertRole(getSession(), ['cashier', 'pharmacist', 'owner']);
  return getInvoiceById(invoiceId, rawDb);
}

