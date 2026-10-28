import type { Database as DatabaseInstance } from 'better-sqlite3';
import { getDatabase } from './db';
import {
  generateUuidV7,
  allocateFefo,
  type FefoBatchInput,
  computeInvoiceTotals,
  multiplyByQuantity,
  roundHalfUp,
  assertIntegerPaisa,
  getKarachiBusinessDate,
} from '@pos/shared';

export interface FinalizeSaleLineInput {
  productId: string;
  quantity: number;
  discountPaisa?: number; // Integer paisa, defaults to 0
}

export interface FinalizeSalePaymentInput {
  method: 'cash' | 'card' | 'wallet';
  amountPaisa: number;
}

export interface FinalizeSaleInput {
  clientRequestId: string;
  counterId: string;
  cashierUserId: string;
  lines: FinalizeSaleLineInput[];
  payments: FinalizeSalePaymentInput[];
  notes?: string | null;
}

export interface FinalizedInvoiceLine {
  id: string;
  movementId?: string;
  invoiceId: string;
  productId: string;
  batchId: string | null;
  batchNo?: string;
  expiryDate?: string;
  brandName?: string;
  genericName?: string;
  quantity: number;
  unitPricePaisa: number;
  discountPaisa: number;
  taxRateBp: number;
  taxPaisa: number;
  lineTotalPaisa: number;
}

export interface FinalizedInvoicePayment {
  id: string;
  invoiceId: string;
  method: 'cash' | 'card' | 'wallet';
  amountPaisa: number;
}

export interface FinalizedInvoice {
  id: string;
  invoiceNumber: string;
  counterId: string;
  cashierUserId: string;
  clientRequestId: string;
  status: 'finalized';
  subtotalPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
  notes: string | null;
  createdAt: string;
  lines: FinalizedInvoiceLine[];
  payments: FinalizedInvoicePayment[];
  fiscalSubmissionId?: string;
}

export interface FiscalService {
  onInvoiceFinalized(invoice: FinalizedInvoice): Promise<void> | void;
}

export class NoOpFiscalService implements FiscalService {
  onInvoiceFinalized(_invoice: FinalizedInvoice): void {
    void _invoice;
  }
}

export interface FinalizeSaleOptions {
  db?: DatabaseInstance;
  fiscalService?: FiscalService;
  today?: string; // YYYY-MM-DD
}

interface ProductDbRow {
  id: string;
  brand_name: string;
  generic_name: string;
  strength: string;
  form: string;
  manufacturer: string;
  barcode: string | null;
  mrp_paisa: number;
  is_controlled: number;
  is_active: number;
  tax_category_id: string;
  created_at: string;
  rate_bp: number;
  is_exempt: number;
}

interface BatchBalanceRow {
  batchId: string;
  expiryDate: string;
  batchNo: string;
  costPaisa: number;
  mrpPaisa: number;
  createdAt: string;
  available: number;
}

interface CounterDbRow {
  id: string;
  branch_id: string;
  name: string;
  code: string | null;
  last_invoice_seq: number;
}

interface UserDbRow {
  id: string;
  name: string;
  role: 'owner' | 'pharmacist' | 'cashier';
  pin_hash: string;
  is_active: number;
  created_at: string;
}

interface InvoiceDbRow {
  id: string;
  counter_id: string;
  cashier_user_id: string;
  invoice_number: string;
  client_request_id: string;
  status: 'finalized';
  subtotal_paisa: number;
  discount_paisa: number;
  tax_paisa: number;
  total_paisa: number;
  notes: string | null;
  created_at: string;
}

/**
 * Loads an existing finalized invoice with all lines, payments, and fiscal info.
 */
function loadExistingInvoice(
  db: DatabaseInstance,
  inv: InvoiceDbRow
): FinalizedInvoice {
  const lineRows = db
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
    .all(inv.id) as {
    id: string;
    invoice_id: string;
    product_id: string;
    batch_id: string | null;
    batch_no: string | null;
    expiry_date: string | null;
    brand_name: string | null;
    generic_name: string | null;
    quantity: number;
    unit_price_paisa: number;
    discount_paisa: number;
    tax_rate_bp: number;
    tax_paisa: number;
    line_total_paisa: number;
  }[];

  const paymentRows = db
    .prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY rowid ASC')
    .all(inv.id) as {
    id: string;
    invoice_id: string;
    method: 'cash' | 'card' | 'wallet';
    amount_paisa: number;
  }[];

  const fiscalRow = db
    .prepare('SELECT id FROM fiscal_submissions WHERE invoice_id = ? LIMIT 1')
    .get(inv.id) as { id: string } | undefined;

  return {
    id: inv.id,
    invoiceNumber: inv.invoice_number,
    counterId: inv.counter_id,
    cashierUserId: inv.cashier_user_id,
    clientRequestId: inv.client_request_id,
    status: inv.status,
    subtotalPaisa: inv.subtotal_paisa,
    discountPaisa: inv.discount_paisa,
    taxPaisa: inv.tax_paisa,
    totalPaisa: inv.total_paisa,
    notes: inv.notes,
    createdAt: inv.created_at,
    lines: lineRows.map((r) => ({
      id: r.id,
      invoiceId: r.invoice_id,
      productId: r.product_id,
      batchId: r.batch_id,
      batchNo: r.batch_no ?? undefined,
      expiryDate: r.expiry_date ?? undefined,
      brandName: r.brand_name ?? undefined,
      genericName: r.generic_name ?? undefined,
      quantity: r.quantity,
      unitPricePaisa: r.unit_price_paisa,
      discountPaisa: r.discount_paisa,
      taxRateBp: r.tax_rate_bp,
      taxPaisa: r.tax_paisa,
      lineTotalPaisa: r.line_total_paisa,
    })),
    payments: paymentRows.map((p) => ({
      id: p.id,
      invoiceId: p.invoice_id,
      method: p.method,
      amountPaisa: p.amount_paisa,
    })),
    fiscalSubmissionId: fiscalRow?.id,
  };
}

/**
 * Main-process service: finalizeSale(input).
 *
 * Runs inside ONE better-sqlite3 transaction started with .immediate():
 * 1. Idempotency: returns existing invoice if clientRequestId was already finalized.
 * 2. Loads products and tax categories from DB. Validates prices, active state, quantities > 0.
 * 3. Loads current batch balances and allocates via allocateFefo (all-or-nothing).
 * 4. Computes line tax, line totals and invoice totals with shared utilities. Verifies payments.
 * 5. Increments counters.last_invoice_seq and formats invoice number as {counterCode}-{seq padded to 6 digits}.
 * 6. Inserts invoices, invoice_lines, payments, and negative stock_movements (type 'sale').
 * 7. Inserts outbox event ('invoice.created').
 * 8. Inserts fiscal_submissions and calls FiscalService (errors do not roll back sale).
 */
export function finalizeSale(
  input: FinalizeSaleInput,
  options: FinalizeSaleOptions = {}
): FinalizedInvoice {
  const db = options.db ?? getDatabase();
  const fiscalService = options.fiscalService ?? new NoOpFiscalService();
  const today = options.today ?? getKarachiBusinessDate();

  // Validate structural inputs
  if (!input.clientRequestId || typeof input.clientRequestId !== 'string') {
    throw new Error('clientRequestId is required');
  }
  if (!input.counterId || typeof input.counterId !== 'string') {
    throw new Error('counterId is required');
  }
  if (!input.cashierUserId || typeof input.cashierUserId !== 'string') {
    throw new Error('cashierUserId is required');
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error('Invoice must contain at least one line item');
  }
  if (!Array.isArray(input.payments) || input.payments.length === 0) {
    throw new Error('Invoice must contain at least one payment');
  }

  // Pre-prepare reusable statements
  const selectExistingStmt = db.prepare<[string]>(
    'SELECT * FROM invoices WHERE client_request_id = ?'
  );
  const selectCounterStmt = db.prepare<[string]>(
    'SELECT id, branch_id, name, code, last_invoice_seq FROM counters WHERE id = ?'
  );
  const selectCashierStmt = db.prepare<[string]>(
    'SELECT id, name, role, pin_hash, is_active, created_at FROM users WHERE id = ?'
  );
  const selectProductStmt = db.prepare<[string]>(`
    SELECT
      p.id, p.brand_name, p.generic_name, p.strength, p.form, p.manufacturer, p.barcode,
      p.mrp_paisa, p.is_controlled, p.is_active, p.tax_category_id, p.created_at,
      tc.rate_bp, tc.is_exempt
    FROM products p
    JOIN tax_categories tc ON p.tax_category_id = tc.id
    WHERE p.id = ?
  `);
  const selectBatchBalancesStmt = db.prepare<[string, string]>(`
    SELECT
      b.id as batchId,
      b.expiry_date as expiryDate,
      b.batch_no as batchNo,
      b.cost_paisa as costPaisa,
      b.mrp_paisa as mrpPaisa,
      b.created_at as createdAt,
      COALESCE(SUM(sm.quantity_signed), 0) as available
    FROM batches b
    LEFT JOIN stock_movements sm ON b.id = sm.batch_id AND sm.branch_id = ?
    WHERE b.product_id = ?
    GROUP BY b.id
    HAVING available > 0
  `);
  const updateCounterSeqStmt = db.prepare<[string]>(
    'UPDATE counters SET last_invoice_seq = last_invoice_seq + 1 WHERE id = ?'
  );
  const insertInvoiceStmt = db.prepare(`
    INSERT INTO invoices (
      id, counter_id, cashier_user_id, invoice_number, client_request_id,
      status, subtotal_paisa, discount_paisa, tax_paisa, total_paisa,
      notes, created_at
    ) VALUES (?, ?, ?, ?, ?, 'finalized', ?, ?, ?, ?, ?, ?)
  `);
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
    ) VALUES (?, ?, ?, ?, 'sale', ?, 'invoice', ?, ?, ?, ?)
  `);
  const insertPaymentStmt = db.prepare(`
    INSERT INTO payments (id, invoice_id, method, amount_paisa)
    VALUES (?, ?, ?, ?)
  `);
  const insertFiscalStmt = db.prepare(`
    INSERT INTO fiscal_submissions (
      id, invoice_id, status, fiscal_invoice_number, qr_payload, created_at, updated_at
    ) VALUES (?, ?, 'not_required', null, null, ?, ?)
  `);
  const insertOutboxStmt = db.prepare(`
    INSERT INTO outbox (
      id, event_id, device_seq, type, event_type, entity_id, payload, occurred_at, status, attempts, created_at, synced_at
    ) VALUES (
      ?, ?, (SELECT COALESCE(MAX(device_seq), 0) + 1 FROM outbox), 'invoice.created', 'invoice.created', ?, ?, ?, 'pending', 0, ?, null
    )
  `);

  // Run everything inside ONE better-sqlite3 transaction started with .immediate()
  const executeSaleTransaction = db.transaction(() => {
    // 1. Idempotency Check
    const existing = selectExistingStmt.get(input.clientRequestId) as
      | InvoiceDbRow
      | undefined;
    if (existing) {
      return {
        isExisting: true,
        invoice: loadExistingInvoice(db, existing),
      };
    }

    // 2. Validate Counter & Cashier
    const counter = selectCounterStmt.get(input.counterId) as
      | CounterDbRow
      | undefined;
    if (!counter) {
      throw new Error(`Counter not found with id: ${input.counterId}`);
    }
    const branchId = counter.branch_id;
    const counterCode = counter.code || 'C1';

    const cashier = selectCashierStmt.get(input.cashierUserId) as
      | UserDbRow
      | undefined;
    if (!cashier) {
      throw new Error(`Cashier user not found with id: ${input.cashierUserId}`);
    }
    if (cashier.is_active !== 1) {
      throw new Error(`Cashier user ${cashier.name} is inactive`);
    }

    // 3. Product & Batch FEFO Allocation
    interface LineAllocationItem {
      productId: string;
      batchId: string;
      batchNo: string;
      expiryDate: string;
      brandName: string;
      genericName: string;
      quantity: number;
      unitPricePaisa: number;
      discountPaisa: number;
      taxRateBp: number;
      isTaxExempt: boolean;
    }

    const allocationItems: LineAllocationItem[] = [];
    const productSnapshotsMap = new Map<
      string,
      {
        id: string;
        brandName: string;
        genericName: string;
        strength: string;
        form: string;
        manufacturer: string;
        barcode: string | null;
        taxCategoryId: string;
        mrpPaisa: number;
        isControlled: boolean;
        isActive: boolean;
        createdAt: string;
      }
    >();
    const batchSnapshotsMap = new Map<
      string,
      {
        id: string;
        productId: string;
        batchNo: string;
        expiryDate: string;
        costPaisa: number;
        mrpPaisa: number;
        createdAt: string;
      }
    >();

    for (let lineIdx = 0; lineIdx < input.lines.length; lineIdx++) {
      const line = input.lines[lineIdx]!;
      const qty = line.quantity;

      // Quantity must be a strictly positive integer
      if (
        typeof qty !== 'number' ||
        isNaN(qty) ||
        !isFinite(qty) ||
        !Number.isInteger(qty) ||
        qty <= 0
      ) {
        throw new Error(
          `Line ${lineIdx + 1}: quantity must be a positive integer, received: ${qty}`
        );
      }

      // Query product & tax category from DB
      const prod = selectProductStmt.get(line.productId) as
        | ProductDbRow
        | undefined;
      if (!prod) {
        throw new Error(
          `Line ${lineIdx + 1}: unknown product with id: ${line.productId}`
        );
      }
      if (prod.is_active !== 1) {
        throw new Error(
          `Line ${lineIdx + 1}: product ${prod.brand_name} is inactive and cannot be sold`
        );
      }

      productSnapshotsMap.set(prod.id, {
        id: prod.id,
        brandName: prod.brand_name,
        genericName: prod.generic_name,
        strength: prod.strength,
        form: prod.form,
        manufacturer: prod.manufacturer,
        barcode: prod.barcode,
        taxCategoryId: prod.tax_category_id,
        mrpPaisa: prod.mrp_paisa,
        isControlled: prod.is_controlled === 1,
        isActive: prod.is_active === 1,
        createdAt: prod.created_at,
      });

      const unitPricePaisa = prod.mrp_paisa;
      const grossLinePaisa = multiplyByQuantity(unitPricePaisa, qty);
      const discountPaisa = line.discountPaisa ?? 0;

      assertIntegerPaisa(discountPaisa, `line[${lineIdx}].discountPaisa`);
      if (discountPaisa < 0) {
        throw new Error(`Line ${lineIdx + 1}: discount cannot be negative`);
      }
      if (discountPaisa > grossLinePaisa) {
        throw new Error(
          `Line ${lineIdx + 1}: discount (${discountPaisa}) exceeds line total (${grossLinePaisa})`
        );
      }

      // Load batch balances for this branch
      const batchRows = selectBatchBalancesStmt.all(
        branchId,
        line.productId
      ) as BatchBalanceRow[];

      const fefoInputs: FefoBatchInput[] = batchRows.map((b) => ({
        batchId: b.batchId,
        expiryDate: b.expiryDate,
        available: b.available,
      }));

      // Allocate via allocateFefo (throws InsufficientStockError if short on stock)
      const allocations = allocateFefo(qty, fefoInputs, today);

      // Apportion line discount across batch allocations
      let discountRemaining = discountPaisa;

      for (let allocIdx = 0; allocIdx < allocations.length; allocIdx++) {
        const alloc = allocations[allocIdx]!;
        const matchingBatch = batchRows.find((b) => b.batchId === alloc.batchId);
        if (matchingBatch) {
          batchSnapshotsMap.set(matchingBatch.batchId, {
            id: matchingBatch.batchId,
            productId: line.productId,
            batchNo: matchingBatch.batchNo,
            expiryDate: matchingBatch.expiryDate,
            costPaisa: matchingBatch.costPaisa,
            mrpPaisa: matchingBatch.mrpPaisa,
            createdAt: matchingBatch.createdAt,
          });
        }

        let allocDiscount = 0;
        if (discountPaisa > 0) {
          if (allocIdx === allocations.length - 1) {
            allocDiscount = discountRemaining;
          } else {
            allocDiscount = roundHalfUp(discountPaisa * alloc.qty, qty);
            discountRemaining -= allocDiscount;
          }
        }

        allocationItems.push({
          productId: line.productId,
          batchId: alloc.batchId,
          batchNo: matchingBatch?.batchNo ?? '',
          expiryDate: matchingBatch?.expiryDate ?? '',
          brandName: prod.brand_name,
          genericName: prod.generic_name,
          quantity: alloc.qty,
          unitPricePaisa,
          discountPaisa: allocDiscount,
          taxRateBp: prod.rate_bp,
          isTaxExempt: Boolean(prod.is_exempt),
        });
      }
    }

    // 4. Compute Line Tax, Line Totals, and Invoice Totals with Shared Utilities
    const invoiceTotals = computeInvoiceTotals(
      allocationItems.map((item) => ({
        unitPricePaisa: item.unitPricePaisa,
        quantity: item.quantity,
        flatDiscountPaisa: item.discountPaisa,
        taxRateBp: item.taxRateBp,
        isTaxExempt: item.isTaxExempt,
      }))
    );

    // Validate payments
    let totalPaidPaisa = 0;
    for (const p of input.payments) {
      if (!['cash', 'card', 'wallet'].includes(p.method)) {
        throw new Error(
          `Invalid payment method: "${p.method}". Must be 'cash', 'card', or 'wallet'.`
        );
      }
      assertIntegerPaisa(p.amountPaisa, 'payment.amountPaisa');
      if (p.amountPaisa <= 0) {
        throw new Error(`Payment amount must be positive, received: ${p.amountPaisa}`);
      }
      totalPaidPaisa += p.amountPaisa;
    }

    if (totalPaidPaisa !== invoiceTotals.grandTotalPaisa) {
      throw new Error(
        `Payment total (${totalPaidPaisa} paisa) does not match invoice total (${invoiceTotals.grandTotalPaisa} paisa)`
      );
    }

    // 5. Increment Counter Sequence & Format Invoice Number (atomic rollback on failure)
    updateCounterSeqStmt.run(input.counterId);
    const updatedCounter = selectCounterStmt.get(input.counterId) as CounterDbRow;
    const newSeq = updatedCounter.last_invoice_seq;
    const counterCodeVal = updatedCounter.code || counterCode;
    const invoiceNumber = `${counterCodeVal}-${String(newSeq).padStart(6, '0')}`;

    const now = new Date().toISOString();
    const invoiceId = generateUuidV7();

    // 6. Insert Invoice Header
    insertInvoiceStmt.run(
      invoiceId,
      input.counterId,
      input.cashierUserId,
      invoiceNumber,
      input.clientRequestId,
      invoiceTotals.subtotalPaisa,
      invoiceTotals.totalDiscountPaisa,
      invoiceTotals.totalTaxPaisa,
      invoiceTotals.grandTotalPaisa,
      input.notes ?? null,
      now
    );

    // 7. Insert Invoice Lines & Negative Stock Movements
    const finalizedLines: FinalizedInvoiceLine[] = [];

    for (let i = 0; i < allocationItems.length; i++) {
      const item = allocationItems[i]!;
      const computedLine = invoiceTotals.lines[i]!;
      const lineId = generateUuidV7();

      // Insert invoice line
      insertLineStmt.run(
        lineId,
        invoiceId,
        item.productId,
        item.batchId,
        item.quantity,
        item.unitPricePaisa,
        item.discountPaisa,
        item.taxRateBp,
        computedLine.taxAmountPaisa,
        computedLine.lineTotalPaisa
      );

      // Insert negative stock movement (Rule 2 & Rule 4: preserve client movementId)
      const movementId = generateUuidV7();
      insertMovementStmt.run(
        movementId,
        item.productId,
        item.batchId,
        branchId,
        -item.quantity, // Negative quantity
        invoiceId,
        `Sale #${invoiceNumber}`,
        now,
        now
      );

      finalizedLines.push({
        id: lineId,
        movementId,
        invoiceId,
        productId: item.productId,
        batchId: item.batchId,
        batchNo: item.batchNo,
        expiryDate: item.expiryDate,
        brandName: item.brandName,
        genericName: item.genericName,
        quantity: item.quantity,
        unitPricePaisa: item.unitPricePaisa,
        discountPaisa: item.discountPaisa,
        taxRateBp: item.taxRateBp,
        taxPaisa: computedLine.taxAmountPaisa,
        lineTotalPaisa: computedLine.lineTotalPaisa,
      });
    }

    // 8. Insert Payments
    const finalizedPayments: FinalizedInvoicePayment[] = [];
    for (const p of input.payments) {
      const paymentId = generateUuidV7();
      insertPaymentStmt.run(paymentId, invoiceId, p.method, p.amountPaisa);
      finalizedPayments.push({
        id: paymentId,
        invoiceId,
        method: p.method,
        amountPaisa: p.amountPaisa,
      });
    }

    // 9. Insert Fiscal Submission Row (status: 'not_required')
    const fiscalSubmissionId = generateUuidV7();
    insertFiscalStmt.run(fiscalSubmissionId, invoiceId, now, now);

    const finalizedInvoice: FinalizedInvoice = {
      id: invoiceId,
      invoiceNumber,
      counterId: input.counterId,
      cashierUserId: input.cashierUserId,
      clientRequestId: input.clientRequestId,
      status: 'finalized',
      subtotalPaisa: invoiceTotals.subtotalPaisa,
      discountPaisa: invoiceTotals.totalDiscountPaisa,
      taxPaisa: invoiceTotals.totalTaxPaisa,
      totalPaisa: invoiceTotals.grandTotalPaisa,
      notes: input.notes ?? null,
      createdAt: now,
      lines: finalizedLines,
      payments: finalizedPayments,
      fiscalSubmissionId,
    };

    // 10. Insert Outbox Row
    const outboxEventId = generateUuidV7();
    insertOutboxStmt.run(
      outboxEventId,
      outboxEventId,
      invoiceId,
      JSON.stringify({
        ...finalizedInvoice,
        cashierUser: {
          id: cashier.id,
          name: cashier.name,
          role: cashier.role,
          pinHash: cashier.pin_hash,
          isActive: cashier.is_active === 1,
          createdAt: cashier.created_at,
        },
        products: Array.from(productSnapshotsMap.values()),
        batches: Array.from(batchSnapshotsMap.values()),
      }),
      now,
      now
    );

    return {
      isExisting: false,
      invoice: finalizedInvoice,
    };
  });

  // Execute transaction with BEGIN IMMEDIATE
  const result = executeSaleTransaction.immediate();

  // If newly finalized, notify FiscalService (safe against errors)
  if (!result.isExisting) {
    try {
      fiscalService.onInvoiceFinalized(result.invoice);
    } catch (err) {
      console.error(
        '[FiscalService] onInvoiceFinalized error (ignoring to prevent sale rollback):',
        err
      );
    }
  }

  return result.invoice;
}
