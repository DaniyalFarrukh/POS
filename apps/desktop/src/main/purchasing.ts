import { getDatabase } from './db';
import { generateUuidV7, roundPaisa } from '@pos/shared';
import type {
  Supplier,
  CreateSupplierInput,
  UpdateSupplierInput,
  ReceiveGrnInput,
  PurchaseRecord,
  PurchaseLineRecord,
  StockAdjustmentInput,
  StockFilterParams,
  StockOverviewProduct,
  StockOverviewBatch,
  StockOverviewResult,
} from '@pos/shared';
import {
  SupplierInputSchema,
  UpdateSupplierInputSchema,
  ReceiveGrnInputSchema,
  StockAdjustmentInputSchema,
  StockFilterParamsSchema,
} from '@pos/shared';
import { getSession, requireRole } from './auth';

// ---------------------------------------------------------------------------
// Helpers: Resolve Branch and User Context
// ---------------------------------------------------------------------------
function getActiveContext(): { branchId: string; userId: string } {
  const session = getSession();
  if (session && session.branch && session.user) {
    return {
      branchId: session.branch.id,
      userId: session.user.id,
    };
  }

  // Fallback for tests / headless CLI runs: fetch first branch and owner
  const db = getDatabase();
  const branchRow = db.prepare('SELECT id FROM branches LIMIT 1').get() as { id: string } | undefined;
  const userRow = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;

  const branchId = branchRow?.id ?? generateUuidV7();
  const userId = userRow?.id ?? generateUuidV7();
  return { branchId, userId };
}

// ---------------------------------------------------------------------------
// 1. Suppliers CRUD
// ---------------------------------------------------------------------------
export function getSuppliers(): Supplier[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, name, contact_person as contactPerson, phone, email, address,
           created_at as createdAt, updated_at as updatedAt
    FROM suppliers
    ORDER BY name ASC
  `).all() as Supplier[];
  return rows;
}

export function getSupplier(id: string): Supplier | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id, name, contact_person as contactPerson, phone, email, address,
           created_at as createdAt, updated_at as updatedAt
    FROM suppliers
    WHERE id = ?
  `).get(id) as Supplier | undefined;
  return row ?? null;
}

export function createSupplier(input: CreateSupplierInput): Supplier {
  const validated = SupplierInputSchema.parse(input);
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = generateUuidV7();

  db.prepare(`
    INSERT INTO suppliers (id, name, contact_person, phone, email, address, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    validated.name,
    validated.contactPerson ?? null,
    validated.phone ?? null,
    validated.email ?? null,
    validated.address ?? null,
    now,
    now
  );

  return {
    id,
    name: validated.name,
    contactPerson: validated.contactPerson ?? null,
    phone: validated.phone ?? null,
    email: validated.email ?? null,
    address: validated.address ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateSupplier(id: string, input: UpdateSupplierInput): Supplier {
  const validated = UpdateSupplierInputSchema.parse(input);
  const db = getDatabase();
  const existing = getSupplier(id);
  if (!existing) {
    throw new Error(`Supplier with id "${id}" not found`);
  }

  const now = new Date().toISOString();
  const updated: Supplier = {
    ...existing,
    ...validated,
    updatedAt: now,
  };

  db.prepare(`
    UPDATE suppliers
    SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, updated_at = ?
    WHERE id = ?
  `).run(
    updated.name,
    updated.contactPerson ?? null,
    updated.phone ?? null,
    updated.email ?? null,
    updated.address ?? null,
    now,
    id
  );

  return updated;
}

export function deleteSupplier(id: string): { success: boolean } {
  const db = getDatabase();
  // Check if supplier has purchases
  const usage = db.prepare('SELECT COUNT(*) as count FROM purchases WHERE supplier_id = ?').get(id) as {
    count: number;
  };
  if (usage.count > 0) {
    throw new Error(`Cannot delete supplier: ${usage.count} purchase record(s) exist`);
  }

  const res = db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
  return { success: res.changes > 0 };
}

// ---------------------------------------------------------------------------
// 2. Purchase Receiving (GRN) with Batch Merging (Rule 5 & Rule 1)
// ---------------------------------------------------------------------------
export function receiveGrn(input: ReceiveGrnInput): PurchaseRecord {
  const validated = ReceiveGrnInputSchema.parse(input);
  const db = getDatabase();
  const now = new Date().toISOString();
  const { branchId, userId } = getActiveContext();

  // Validate supplier exists
  const supplier = getSupplier(validated.supplierId);
  if (!supplier) {
    throw new Error(`Supplier with ID "${validated.supplierId}" not found`);
  }

  // Pre-fetch product names to ensure existence and enrich response
  const checkProductStmt = db.prepare('SELECT id, brand_name, generic_name FROM products WHERE id = ?');
  for (const line of validated.lines) {
    const p = checkProductStmt.get(line.productId) as { id: string } | undefined;
    if (!p) {
      throw new Error(`Product with ID "${line.productId}" not found`);
    }
  }

  // Statements for single-transaction write
  const findBatchStmt = db.prepare<[string, string]>(`
    SELECT id, cost_paisa, mrp_paisa, expiry_date
    FROM batches
    WHERE product_id = ? AND batch_no = ?
    LIMIT 1
  `);

  const insertBatchStmt = db.prepare(`
    INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPurchaseStmt = db.prepare(`
    INSERT INTO purchases (id, branch_id, supplier_id, supplier_invoice_no, invoice_date, total_cost_paisa, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLineStmt = db.prepare(`
    INSERT INTO purchase_lines (id, purchase_id, product_id, batch_id, batch_no, expiry_date, quantity, cost_paisa, mrp_paisa, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMovementStmt = db.prepare(`
    INSERT INTO stock_movements (id, product_id, batch_id, branch_id, type, quantity_signed, reference_type, reference_id, reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'purchase', ?, 'purchase', ?, ?, ?, ?)
  `);

  const insertOutboxStmt = db.prepare(`
    INSERT INTO outbox (id, event_type, payload, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const purchaseId = generateUuidV7();
  let totalCostPaisa = 0;
  for (const line of validated.lines) {
    totalCostPaisa += roundPaisa(line.quantity * line.costPaisa);
  }

  const createdLines: PurchaseLineRecord[] = [];

  // Rule 5: Writes touching multiple rows happen in ONE database transaction.
  const receiveTx = db.transaction(() => {
    // 1. Insert purchase document header
    insertPurchaseStmt.run(
      purchaseId,
      branchId,
      validated.supplierId,
      validated.supplierInvoiceNo,
      validated.invoiceDate,
      totalCostPaisa,
      userId,
      now,
      now
    );

    // 2. Process each line
    for (const line of validated.lines) {
      // Create or merge batch: check if (productId, batchNo) exists
      const existingBatch = findBatchStmt.get(line.productId, line.batchNo) as
        | { id: string; cost_paisa: number; mrp_paisa: number; expiry_date: string }
        | undefined;

      let batchId: string;
      if (existingBatch) {
        // Reuse existing batch ID (merging batch per requirement!)
        batchId = existingBatch.id;
      } else {
        // Create new batch
        batchId = generateUuidV7();
        insertBatchStmt.run(
          batchId,
          line.productId,
          line.batchNo,
          line.expiryDate,
          line.costPaisa,
          line.mrpPaisa,
          now,
          now
        );
      }

      // Insert purchase line
      const lineId = generateUuidV7();
      insertLineStmt.run(
        lineId,
        purchaseId,
        line.productId,
        batchId,
        line.batchNo,
        line.expiryDate,
        line.quantity,
        line.costPaisa,
        line.mrpPaisa,
        now,
        now
      );

      // Insert stock movement (Rule 4: stock balance = sum of movements)
      const movementId = generateUuidV7();
      insertMovementStmt.run(
        movementId,
        line.productId,
        batchId,
        branchId,
        line.quantity, // Positive signed quantity for purchase
        purchaseId,
        `GRN Invoice: ${validated.supplierInvoiceNo}`,
        now,
        now
      );

      createdLines.push({
        id: lineId,
        purchaseId,
        productId: line.productId,
        batchId,
        batchNo: line.batchNo,
        expiryDate: line.expiryDate,
        quantity: line.quantity,
        costPaisa: line.costPaisa,
        mrpPaisa: line.mrpPaisa,
        createdAt: now,
        updatedAt: now,
      });
    }

    // 3. Write outbox event in same transaction (Rule 5)
    insertOutboxStmt.run(
      generateUuidV7(),
      'purchase.received',
      JSON.stringify({
        purchaseId,
        supplierId: validated.supplierId,
        supplierInvoiceNo: validated.supplierInvoiceNo,
        totalCostPaisa,
        lineCount: validated.lines.length,
      }),
      now
    );
  });

  receiveTx();

  return {
    id: purchaseId,
    branchId,
    supplierId: validated.supplierId,
    supplierName: supplier.name,
    supplierInvoiceNo: validated.supplierInvoiceNo,
    invoiceDate: validated.invoiceDate,
    totalCostPaisa,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
    lines: createdLines,
  };
}

// ---------------------------------------------------------------------------
// 3. Stock Overview Queries (By Product & By Batch)
// ---------------------------------------------------------------------------
export function getStockOverviewByProduct(rawParams: StockFilterParams): StockOverviewResult<StockOverviewProduct> {
  const params = StockFilterParamsSchema.parse(rawParams);
  const db = getDatabase();
  const context = getActiveContext();
  const branchId = params.branchId ?? context.branchId;

  const conditions: string[] = ['p.is_active = 1'];
  const queryArgs: unknown[] = [branchId];

  if (params.search.trim()) {
    conditions.push('(p.brand_name LIKE ? OR p.generic_name LIKE ? OR p.barcode LIKE ?)');
    const term = `%${params.search.trim()}%`;
    queryArgs.push(term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Calculate product balance strictly from stock_movements (Rule 4)
  const baseSql = `
    FROM products p
    LEFT JOIN (
      SELECT product_id, COALESCE(SUM(quantity_signed), 0) AS total_balance
      FROM stock_movements
      WHERE branch_id = ?
      GROUP BY product_id
    ) sm ON p.id = sm.product_id
    LEFT JOIN (
      SELECT product_id, COUNT(id) as batch_count, MIN(expiry_date) as earliest_expiry
      FROM batches
      GROUP BY product_id
    ) b ON p.id = b.product_id
    ${whereClause}
  `;

  // Filter application on computed balance or expiry
  let filterHaving = '';
  const today = new Date().toISOString().slice(0, 10);
  const d60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const d90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

  if (params.filter === 'low_stock') {
    filterHaving = 'AND COALESCE(sm.total_balance, 0) <= 10';
  } else if (params.filter === 'expiring_60') {
    filterHaving = `AND b.earliest_expiry IS NOT NULL AND b.earliest_expiry <= '${d60}' AND b.earliest_expiry >= '${today}'`;
  } else if (params.filter === 'expiring_90') {
    filterHaving = `AND b.earliest_expiry IS NOT NULL AND b.earliest_expiry <= '${d90}' AND b.earliest_expiry >= '${today}'`;
  } else if (params.filter === 'expired') {
    filterHaving = `AND b.earliest_expiry IS NOT NULL AND b.earliest_expiry < '${today}'`;
  }

  const countSql = `SELECT COUNT(*) as count ${baseSql} ${filterHaving}`;
  const totalRow = db.prepare(countSql).get(...queryArgs) as { count: number };
  const total = totalRow.count;

  const offset = (params.page - 1) * params.pageSize;
  const dataSql = `
    SELECT
      p.id as productId,
      p.brand_name as brandName,
      p.generic_name as genericName,
      p.form,
      p.strength,
      p.is_controlled as isControlled,
      COALESCE(sm.total_balance, 0) as totalBalance,
      COALESCE(b.batch_count, 0) as batchCount,
      b.earliest_expiry as earliestExpiry
    ${baseSql}
    ${filterHaving}
    ORDER BY p.brand_name ASC
    LIMIT ? OFFSET ?
  `;

  type RawProductOverviewRow = Omit<StockOverviewProduct, 'isControlled'> & {
    isControlled: number;
  };

  const rows = db.prepare(dataSql).all(...queryArgs, params.pageSize, offset) as RawProductOverviewRow[];
  const items: StockOverviewProduct[] = rows.map((r) => ({
    productId: r.productId,
    brandName: r.brandName,
    genericName: r.genericName,
    form: r.form,
    strength: r.strength,
    totalBalance: r.totalBalance,
    batchCount: r.batchCount,
    earliestExpiry: r.earliestExpiry,
    isControlled: Boolean(r.isControlled),
  }));

  return {
    items,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

export function getStockOverviewByBatch(rawParams: StockFilterParams): StockOverviewResult<StockOverviewBatch> {
  const params = StockFilterParamsSchema.parse(rawParams);
  const db = getDatabase();
  const context = getActiveContext();
  const branchId = params.branchId ?? context.branchId;

  const conditions: string[] = ['1 = 1'];
  const queryArgs: unknown[] = [branchId];

  if (params.search.trim()) {
    conditions.push('(p.brand_name LIKE ? OR p.generic_name LIKE ? OR b.batch_no LIKE ?)');
    const term = `%${params.search.trim()}%`;
    queryArgs.push(term, term, term);
  }

  const today = new Date().toISOString().slice(0, 10);
  const d60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const d90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

  if (params.filter === 'low_stock') {
    conditions.push('COALESCE(sm.balance, 0) <= 10');
  } else if (params.filter === 'expiring_60') {
    conditions.push(`b.expiry_date <= '${d60}' AND b.expiry_date >= '${today}'`);
  } else if (params.filter === 'expiring_90') {
    conditions.push(`b.expiry_date <= '${d90}' AND b.expiry_date >= '${today}'`);
  } else if (params.filter === 'expired') {
    conditions.push(`b.expiry_date < '${today}'`);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const baseSql = `
    FROM batches b
    INNER JOIN products p ON b.product_id = p.id
    LEFT JOIN (
      SELECT batch_id, COALESCE(SUM(quantity_signed), 0) AS balance
      FROM stock_movements
      WHERE branch_id = ?
      GROUP BY batch_id
    ) sm ON b.id = sm.batch_id
    ${whereClause}
  `;

  const countSql = `SELECT COUNT(*) as count ${baseSql}`;
  const totalRow = db.prepare(countSql).get(...queryArgs) as { count: number };
  const total = totalRow.count;

  const offset = (params.page - 1) * params.pageSize;
  const dataSql = `
    SELECT
      b.id as batchId,
      b.product_id as productId,
      b.batch_no as batchNo,
      b.expiry_date as expiryDate,
      b.cost_paisa as costPaisa,
      b.mrp_paisa as mrpPaisa,
      p.brand_name as brandName,
      p.generic_name as genericName,
      p.form,
      p.strength,
      COALESCE(sm.balance, 0) as balance
    ${baseSql}
    ORDER BY b.expiry_date ASC, p.brand_name ASC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(dataSql).all(...queryArgs, params.pageSize, offset) as (Omit<StockOverviewBatch, 'daysUntilExpiry' | 'status'>)[];

  const nowMs = Date.now();
  const items: StockOverviewBatch[] = rows.map((r) => {
    const expDate = new Date(r.expiryDate);
    const diffDays = Math.ceil((expDate.getTime() - nowMs) / (1000 * 60 * 60 * 24));

    let status: StockOverviewBatch['status'] = 'good';
    if (diffDays < 0) {
      status = 'expired';
    } else if (diffDays <= 60) {
      status = 'expiring_60';
    } else if (diffDays <= 90) {
      status = 'expiring_90';
    }

    return {
      ...r,
      daysUntilExpiry: diffDays,
      status,
    };
  });

  return {
    items,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

// ---------------------------------------------------------------------------
// 4. Stock Adjustment (Rule 4 & Rule 5)
// ---------------------------------------------------------------------------
export function adjustStock(input: StockAdjustmentInput): {
  success: boolean;
  movementId: string;
  newBalance: number;
} {
  const validated = StockAdjustmentInputSchema.parse(input);
  const db = getDatabase();
  const now = new Date().toISOString();
  const context = getActiveContext();
  const branchId = validated.branchId ?? context.branchId;

  // Validate product and batch exist
  const batchRow = db.prepare(`
    SELECT b.id, b.product_id, b.batch_no, p.brand_name
    FROM batches b
    INNER JOIN products p ON b.product_id = p.id
    WHERE b.id = ? AND b.product_id = ?
  `).get(validated.batchId, validated.productId) as { id: string } | undefined;

  if (!batchRow) {
    throw new Error(`Batch ID "${validated.batchId}" does not match Product ID "${validated.productId}"`);
  }

  const movementId = generateUuidV7();
  const formattedReason = `[${validated.reasonType.toUpperCase()}] ${validated.reason.trim()}`;

  let newBalance = 0;

  // Rule 5: Writes touching more than one table happen in ONE database transaction
  const adjustTx = db.transaction(() => {
    // 1. Insert stock_movements record (Rule 4)
    db.prepare(`
      INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type, quantity_signed,
        reference_type, reference_id, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'adjustment', ?, 'stock_adjustment', ?, ?, ?, ?)
    `).run(
      movementId,
      validated.productId,
      validated.batchId,
      branchId,
      validated.quantitySigned,
      movementId,
      formattedReason,
      now,
      now
    );

    // 2. Insert outbox record in same transaction (Rule 5)
    db.prepare(`
      INSERT INTO outbox (id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      generateUuidV7(),
      'stock.adjusted',
      JSON.stringify({
        movementId,
        productId: validated.productId,
        batchId: validated.batchId,
        branchId,
        quantitySigned: validated.quantitySigned,
        reasonType: validated.reasonType,
        reason: validated.reason,
      }),
      now
    );

    // 3. Compute updated balance for this batch in this branch
    const balRow = db.prepare(`
      SELECT COALESCE(SUM(quantity_signed), 0) as balance
      FROM stock_movements
      WHERE branch_id = ? AND batch_id = ?
    `).get(branchId, validated.batchId) as { balance: number };
    newBalance = balRow.balance;
  });

  adjustTx();

  return {
    success: true,
    movementId,
    newBalance,
  };
}

export function getBatchesForProduct(productId: string): {
  id: string;
  batchNo: string;
  expiryDate: string;
  costPaisa: number;
  mrpPaisa: number;
  balance: number;
}[] {
  const db = getDatabase();
  const context = getActiveContext();

  const rows = db.prepare(`
    SELECT
      b.id,
      b.batch_no as batchNo,
      b.expiry_date as expiryDate,
      b.cost_paisa as costPaisa,
      b.mrp_paisa as mrpPaisa,
      COALESCE(sm.balance, 0) as balance
    FROM batches b
    LEFT JOIN (
      SELECT batch_id, COALESCE(SUM(quantity_signed), 0) as balance
      FROM stock_movements
      WHERE branch_id = ?
      GROUP BY batch_id
    ) sm ON b.id = sm.batch_id
    WHERE b.product_id = ?
    ORDER BY b.expiry_date ASC
  `).all(context.branchId, productId) as {
    id: string;
    batchNo: string;
    expiryDate: string;
    costPaisa: number;
    mrpPaisa: number;
    balance: number;
  }[];

  return rows;
}

// ---------------------------------------------------------------------------
// 5. Role-Guarded IPC Wrappers (Rule 6: Pharmacist or Owner required)
// ---------------------------------------------------------------------------
export const roleGuardedCreateSupplier = requireRole(
  ['pharmacist', 'owner'],
  async (_session, input: CreateSupplierInput) => createSupplier(input)
);

export const roleGuardedUpdateSupplier = requireRole(
  ['pharmacist', 'owner'],
  async (_session, id: string, input: UpdateSupplierInput) => updateSupplier(id, input)
);

export const roleGuardedDeleteSupplier = requireRole(
  ['pharmacist', 'owner'],
  async (_session, id: string) => deleteSupplier(id)
);

export const roleGuardedReceiveGrn = requireRole(
  ['pharmacist', 'owner'],
  async (_session, input: ReceiveGrnInput) => receiveGrn(input)
);

export const roleGuardedAdjustStock = requireRole(
  ['pharmacist', 'owner'],
  async (_session, input: StockAdjustmentInput) => adjustStock(input)
);
