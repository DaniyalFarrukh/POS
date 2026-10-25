import type { Database as DatabaseInstance } from 'better-sqlite3';
import { getDatabase } from './db';
import {
  generateUuidV7,
  computeInvoiceTotals,
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
  const dateKey = now.slice(0, 10); // YYYY-MM-DD

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
    .prepare('SELECT COUNT(*) as count FROM invoices WHERE branch_id = ? AND created_at >= ?')
    .get(branchId, `${dateKey}T00:00:00.000Z`) as { count: number } | undefined;
  const seq = (countRow?.count ?? 0) + 1;
  const compactDate = dateKey.replace(/-/g, '');
  const invoiceNumber = `INV-${compactDate}-${String(seq).padStart(4, '0')}`;

  const invoiceId = generateUuidV7();
  const paymentId = generateUuidV7();

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
        id, invoice_number, branch_id, counter_id, user_id,
        customer_name, customer_phone, doctor_name, notes,
        subtotal_paisa, discount_paisa, tax_paisa, grand_total_paisa,
        paid_paisa, change_paisa, status, fiscal_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoiceId,
      invoiceNumber,
      branchId,
      counterId,
      userId,
      data.customerName ?? null,
      data.customerPhone ?? null,
      data.doctorName ?? null,
      data.notes ?? null,
      computed.netTotalPaisa,
      computed.totalDiscountPaisa,
      computed.totalTaxPaisa,
      grandTotalPaisa,
      amountPaisa,
      changePaisa,
      'finalized',
      'not_required',
      now,
      now
    );

    const createdLines: InvoiceLineRecord[] = [];

    // Insert invoice lines & stock movements
    const insertLineStmt = db.prepare(`
      INSERT INTO invoice_lines (
        id, invoice_id, product_id, batch_id, batch_no, expiry_date,
        quantity, unit_price_paisa, discount_bp, discount_paisa,
        tax_rate_bp, tax_paisa, line_total_paisa, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        batchNo,
        expiryDate,
        lineInput.quantity,
        lineInput.unitPricePaisa,
        lineInput.discountBp ?? 0,
        lineComputed.discountPaisa,
        lineComputed.taxRateBp,
        lineComputed.taxAmountPaisa,
        lineComputed.lineTotalPaisa,
        now,
        now
      );

      // Insert negative stock movement (Rule 4: signed movement for sale)
      if (batchId) {
        insertMovementStmt.run(
          generateUuidV7(),
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
    db.prepare(`
      INSERT INTO payments (
        id, invoice_id, payment_method, amount_paisa,
        tendered_paisa, change_paisa, reference, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      paymentId,
      invoiceId,
      data.paymentMethod,
      amountPaisa,
      tenderedPaisa,
      changePaisa,
      data.paymentReference ?? null,
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

    // Insert outbox event for offline cloud sync (Rule 5 & 7)
    db.prepare(`
      INSERT INTO outbox (id, event_type, payload, created_at, synced_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      generateUuidV7(),
      'invoice.created',
      JSON.stringify(invoiceRecord),
      now,
      null
    );

    return invoiceRecord;
  });

  return executeTx();
}

/**
 * Retrieves recent finalized invoices for cashier terminal history.
 */
export function getRecentInvoices(
  branchId?: string,
  limit = 20,
  rawDb?: DatabaseInstance
): InvoiceRecord[] {
  const db = rawDb ?? getDatabase();
  const queryParams: unknown[] = [];
  let whereClause = '';

  if (branchId) {
    whereClause = 'WHERE i.branch_id = ?';
    queryParams.push(branchId);
  }

  queryParams.push(limit);

  const rows = db
    .prepare(`
      SELECT
        i.*,
        u.name as user_name,
        c.name as counter_name
      FROM invoices i
      LEFT JOIN users u ON i.user_id = u.id
      LEFT JOIN counters c ON i.counter_id = c.id
      ${whereClause}
      ORDER BY i.created_at DESC
      LIMIT ?
    `)
    .all(...queryParams) as {
    id: string;
    invoice_number: string;
    branch_id: string;
    counter_id: string;
    user_id: string;
    customer_name: string | null;
    customer_phone: string | null;
    doctor_name: string | null;
    notes: string | null;
    subtotal_paisa: number;
    discount_paisa: number;
    tax_paisa: number;
    grand_total_paisa: number;
    paid_paisa: number;
    change_paisa: number;
    status: 'finalized' | 'cancelled' | 'refunded';
    fiscal_status: 'not_required' | 'pending' | 'submitted' | 'failed';
    fiscal_invoice_number: string | null;
    qr_payload: string | null;
    created_at: string;
    updated_at: string;
    user_name: string | null;
    counter_name: string | null;
  }[];

  const lineStmt = db.prepare<[string]>(`
    SELECT
      il.*,
      p.brand_name,
      p.generic_name,
      p.strength,
      p.form
    FROM invoice_lines il
    LEFT JOIN products p ON il.product_id = p.id
    WHERE il.invoice_id = ?
  `);

  const paymentStmt = db.prepare<[string]>(`
    SELECT * FROM payments WHERE invoice_id = ? LIMIT 1
  `);

  return rows.map((r) => {
    const rawLines = lineStmt.all(r.id) as {
      id: string;
      invoice_id: string;
      product_id: string;
      batch_id: string | null;
      batch_no: string | null;
      expiry_date: string | null;
      quantity: number;
      unit_price_paisa: number;
      discount_bp: number;
      discount_paisa: number;
      tax_rate_bp: number;
      tax_paisa: number;
      line_total_paisa: number;
      created_at: string;
      updated_at: string;
      brand_name: string | null;
      generic_name: string | null;
      strength: string | null;
      form: string | null;
    }[];

    const lines: InvoiceLineRecord[] = rawLines.map((l) => ({
      id: l.id,
      invoiceId: l.invoice_id,
      productId: l.product_id,
      batchId: l.batch_id,
      batchNo: l.batch_no,
      expiryDate: l.expiry_date,
      quantity: l.quantity,
      unitPricePaisa: l.unit_price_paisa,
      discountBp: l.discount_bp,
      discountPaisa: l.discount_paisa,
      taxRateBp: l.tax_rate_bp,
      taxPaisa: l.tax_paisa,
      lineTotalPaisa: l.line_total_paisa,
      brandName: l.brand_name ?? undefined,
      genericName: l.generic_name ?? undefined,
      strength: l.strength ?? undefined,
      form: l.form ?? undefined,
      createdAt: l.created_at,
      updatedAt: l.updated_at,
    }));

    const rawPayment = paymentStmt.get(r.id) as {
      id: string;
      invoice_id: string;
      payment_method: 'cash' | 'card' | 'bank' | 'other';
      amount_paisa: number;
      tendered_paisa: number | null;
      change_paisa: number | null;
      reference: string | null;
      created_at: string;
    } | undefined;

    const payment: PaymentRecord | undefined = rawPayment
      ? {
          id: rawPayment.id,
          invoiceId: rawPayment.invoice_id,
          paymentMethod: rawPayment.payment_method,
          amountPaisa: rawPayment.amount_paisa,
          tenderedPaisa: rawPayment.tendered_paisa,
          changePaisa: rawPayment.change_paisa,
          reference: rawPayment.reference,
          createdAt: rawPayment.created_at,
        }
      : undefined;

    return {
      id: r.id,
      invoiceNumber: r.invoice_number,
      branchId: r.branch_id,
      counterId: r.counter_id,
      userId: r.user_id,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      doctorName: r.doctor_name,
      notes: r.notes,
      subtotalPaisa: r.subtotal_paisa,
      discountPaisa: r.discount_paisa,
      taxPaisa: r.tax_paisa,
      grandTotalPaisa: r.grand_total_paisa,
      paidPaisa: r.paid_paisa,
      changePaisa: r.change_paisa,
      status: r.status,
      fiscalStatus: r.fiscal_status,
      fiscalInvoiceNumber: r.fiscal_invoice_number,
      qrPayload: r.qr_payload,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lines,
      payment,
      userName: r.user_name ?? undefined,
      counterName: r.counter_name ?? undefined,
    };
  });
}

/**
 * Role-guarded IPC entry points. Cashiers, Pharmacists, and Owners can create invoices.
 */
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
