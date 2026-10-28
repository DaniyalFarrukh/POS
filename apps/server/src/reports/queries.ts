import { eq, and, sql, gte, lte, desc, asc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getKarachiDayStartUtc, getKarachiDayEndUtc } from '@pos/shared';
import * as schema from '../db/schema';
import {
  invoices,
  invoiceLines,
  stockMovements,
  batches,
  products,
  branches,
  counters,
  users,
  stockAlerts,
} from '../db/schema';

export type DbClient = NodePgDatabase<typeof schema>;

export interface DashboardOverviewResult {
  todaySalesPaisa: number;
  todayInvoiceCount: number;
  topProducts: Array<{
    productId: string;
    brandName: string;
    unitsSold: number;
    revenuePaisa: number;
  }>;
  expiringBatches: Array<{
    batchId: string;
    batchNo: string;
    brandName: string;
    expiryDate: string;
    currentStock: number;
  }>;
  lowStockProducts: Array<{
    productId: string;
    brandName: string;
    currentStock: number;
  }>;
  recentAlerts: Array<{
    id: string;
    type: string;
    message: string;
    severity: string;
    createdAt: string;
  }>;
}

export interface SalesReportParams {
  pharmacyId: string;
  startDate?: string;
  endDate?: string;
  branchId?: string;
  cashierUserId?: string;
}

export interface SalesReportResult {
  totals: {
    invoiceCount: number;
    subtotalPaisa: number;
    discountPaisa: number;
    taxPaisa: number;
    totalPaisa: number;
  };
  byDay: Array<{
    date: string;
    invoiceCount: number;
    totalPaisa: number;
  }>;
  byBranch: Array<{
    branchId: string;
    branchName: string;
    invoiceCount: number;
    totalPaisa: number;
  }>;
  byCashier: Array<{
    cashierUserId: string;
    cashierName: string;
    invoiceCount: number;
    totalPaisa: number;
  }>;
}

export interface StockExpiryReportItem {
  productId: string;
  brandName: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  branchId: string;
  branchName: string;
  quantity: number;
  costPaisa: number;
  mrpPaisa: number;
  status: 'good' | 'expiring_soon' | 'expired';
}

export interface ProfitPerBatchItem {
  batchId: string;
  batchNo: string;
  productId: string;
  brandName: string;
  expiryDate: string;
  unitsSold: number;
  unitCostPaisa: number;
  revenuePaisa: number;
  costPaisa: number;
  profitPaisa: number;
  marginPercent: number;
}

export interface SupplierLedgerItem {
  supplierId: string | null;
  supplierName: string;
  purchaseCount: number;
  totalQuantity: number;
  totalCostPaisa: number;
  lastPurchaseDate: string | null;
}

/**
 * 1. Overview Page Query: today's sales, invoice count, top products, expiring soon, low stock.
 */
export async function getDashboardOverview(
  db: DbClient,
  pharmacyId: string,
  todayIsoDate: string // YYYY-MM-DD
): Promise<DashboardOverviewResult> {
  const startOfDay = getKarachiDayStartUtc(todayIsoDate);
  const endOfDay = getKarachiDayEndUtc(todayIsoDate);

  // (a) Today's sales and invoice count
  const [salesSummary] = await db
    .select({
      totalPaisa: sql<number>`COALESCE(SUM(${invoices.totalPaisa}), 0)`,
      invoiceCount: sql<number>`COUNT(${invoices.id})`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.pharmacyId, pharmacyId),
        gte(invoices.createdAt, startOfDay),
        lte(invoices.createdAt, endOfDay)
      )
    );

  // (b) Top 5 products by quantity sold today
  const topProductsRaw = await db
    .select({
      productId: invoiceLines.productId,
      brandName: products.brandName,
      unitsSold: sql<number>`COALESCE(SUM(${invoiceLines.quantity}), 0)`,
      revenuePaisa: sql<number>`COALESCE(SUM(${invoiceLines.lineTotalPaisa}), 0)`,
    })
    .from(invoiceLines)
    .innerJoin(
      invoices,
      and(eq(invoiceLines.invoiceId, invoices.id), eq(invoices.pharmacyId, pharmacyId))
    )
    .innerJoin(
      products,
      and(eq(invoiceLines.productId, products.id), eq(products.pharmacyId, pharmacyId))
    )
    .where(
      and(
        eq(invoiceLines.pharmacyId, pharmacyId),
        eq(invoices.pharmacyId, pharmacyId),
        gte(invoices.createdAt, startOfDay),
        lte(invoices.createdAt, endOfDay)
      )
    )
    .groupBy(invoiceLines.productId, products.brandName)
    .orderBy(desc(sql`SUM(${invoiceLines.quantity})`))
    .limit(5);

  // (c) Expiring soon (<90 days from today) with currentStock > 0
  const d90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const expiringRaw = await db
    .select({
      batchId: batches.id,
      batchNo: batches.batchNo,
      brandName: products.brandName,
      expiryDate: batches.expiryDate,
      currentStock: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`,
    })
    .from(batches)
    .innerJoin(
      products,
      and(eq(batches.productId, products.id), eq(products.pharmacyId, pharmacyId))
    )
    .leftJoin(
      stockMovements,
      and(eq(batches.id, stockMovements.batchId), eq(stockMovements.pharmacyId, pharmacyId))
    )
    .where(
      and(
        eq(batches.pharmacyId, pharmacyId),
        lte(batches.expiryDate, d90)
      )
    )
    .groupBy(batches.id, batches.batchNo, products.brandName, batches.expiryDate)
    .having(sql`COALESCE(SUM(${stockMovements.quantitySigned}), 0) > 0`)
    .orderBy(asc(batches.expiryDate))
    .limit(10);

  // (d) Low stock products (total across branches <= 10)
  const lowStockRaw = await db
    .select({
      productId: products.id,
      brandName: products.brandName,
      currentStock: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`,
    })
    .from(products)
    .leftJoin(
      stockMovements,
      and(eq(products.id, stockMovements.productId), eq(stockMovements.pharmacyId, pharmacyId))
    )
    .where(
      and(
        eq(products.pharmacyId, pharmacyId),
        eq(products.isActive, true)
      )
    )
    .groupBy(products.id, products.brandName)
    .having(sql`COALESCE(SUM(${stockMovements.quantitySigned}), 0) <= 10`)
    .orderBy(asc(sql`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`))
    .limit(10);

  // (e) Recent stock alerts
  const alertsRaw = await db
    .select({
      id: stockAlerts.id,
      type: stockAlerts.type,
      message: stockAlerts.message,
      severity: stockAlerts.severity,
      createdAt: stockAlerts.createdAt,
    })
    .from(stockAlerts)
    .where(eq(stockAlerts.pharmacyId, pharmacyId))
    .orderBy(desc(stockAlerts.createdAt))
    .limit(5);

  return {
    todaySalesPaisa: Number(salesSummary?.totalPaisa ?? 0),
    todayInvoiceCount: Number(salesSummary?.invoiceCount ?? 0),
    topProducts: topProductsRaw.map((p) => ({
      productId: p.productId,
      brandName: p.brandName,
      unitsSold: Number(p.unitsSold),
      revenuePaisa: Number(p.revenuePaisa),
    })),
    expiringBatches: expiringRaw.map((b) => ({
      batchId: b.batchId,
      batchNo: b.batchNo,
      brandName: b.brandName,
      expiryDate: b.expiryDate,
      currentStock: Number(b.currentStock),
    })),
    lowStockProducts: lowStockRaw.map((p) => ({
      productId: p.productId,
      brandName: p.brandName,
      currentStock: Number(p.currentStock),
    })),
    recentAlerts: alertsRaw.map((a) => ({
      id: a.id,
      type: a.type,
      message: a.message,
      severity: a.severity,
      createdAt: a.createdAt,
    })),
  };
}

/**
 * 2. Sales Report: Aggregated by Day, Branch, and Cashier with filters.
 */
export async function getSalesReport(
  db: DbClient,
  params: SalesReportParams
): Promise<SalesReportResult> {
  const conditions = [eq(invoices.pharmacyId, params.pharmacyId)];

  if (params.startDate) {
    conditions.push(gte(invoices.createdAt, getKarachiDayStartUtc(params.startDate)));
  }
  if (params.endDate) {
    conditions.push(lte(invoices.createdAt, getKarachiDayEndUtc(params.endDate)));
  }
  if (params.branchId) {
    conditions.push(eq(counters.branchId, params.branchId));
  }
  if (params.cashierUserId) {
    conditions.push(eq(invoices.cashierUserId, params.cashierUserId));
  }

  // Totals
  const [totalsRaw] = await db
    .select({
      invoiceCount: sql<number>`COUNT(DISTINCT ${invoices.id})`,
      subtotalPaisa: sql<number>`COALESCE(SUM(${invoices.subtotalPaisa}), 0)`,
      discountPaisa: sql<number>`COALESCE(SUM(${invoices.discountPaisa}), 0)`,
      taxPaisa: sql<number>`COALESCE(SUM(${invoices.taxPaisa}), 0)`,
      totalPaisa: sql<number>`COALESCE(SUM(${invoices.totalPaisa}), 0)`,
    })
    .from(invoices)
    .innerJoin(
      counters,
      and(eq(invoices.counterId, counters.id), eq(counters.pharmacyId, params.pharmacyId))
    )
    .innerJoin(
      branches,
      and(eq(counters.branchId, branches.id), eq(branches.pharmacyId, params.pharmacyId))
    )
    .where(and(...conditions));

  // By Day
  const byDayRaw = await db
    .select({
      date: sql<string>`TO_CHAR(${invoices.createdAt} AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD')`,
      invoiceCount: sql<number>`COUNT(${invoices.id})`,
      totalPaisa: sql<number>`COALESCE(SUM(${invoices.totalPaisa}), 0)`,
    })
    .from(invoices)
    .innerJoin(
      counters,
      and(eq(invoices.counterId, counters.id), eq(counters.pharmacyId, params.pharmacyId))
    )
    .where(and(...conditions))
    .groupBy(sql`TO_CHAR(${invoices.createdAt} AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD')`)
    .orderBy(desc(sql`TO_CHAR(${invoices.createdAt} AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD')`));

  // By Branch
  const byBranchRaw = await db
    .select({
      branchId: branches.id,
      branchName: branches.name,
      invoiceCount: sql<number>`COUNT(${invoices.id})`,
      totalPaisa: sql<number>`COALESCE(SUM(${invoices.totalPaisa}), 0)`,
    })
    .from(invoices)
    .innerJoin(
      counters,
      and(eq(invoices.counterId, counters.id), eq(counters.pharmacyId, params.pharmacyId))
    )
    .innerJoin(
      branches,
      and(eq(counters.branchId, branches.id), eq(branches.pharmacyId, params.pharmacyId))
    )
    .where(and(...conditions))
    .groupBy(branches.id, branches.name)
    .orderBy(desc(sql`SUM(${invoices.totalPaisa})`));

  // By Cashier
  const byCashierRaw = await db
    .select({
      cashierUserId: invoices.cashierUserId,
      cashierName: users.name,
      invoiceCount: sql<number>`COUNT(${invoices.id})`,
      totalPaisa: sql<number>`COALESCE(SUM(${invoices.totalPaisa}), 0)`,
    })
    .from(invoices)
    .innerJoin(
      users,
      and(eq(invoices.cashierUserId, users.id), eq(users.pharmacyId, params.pharmacyId))
    )
    .innerJoin(
      counters,
      and(eq(invoices.counterId, counters.id), eq(counters.pharmacyId, params.pharmacyId))
    )
    .where(and(...conditions))
    .groupBy(invoices.cashierUserId, users.name)
    .orderBy(desc(sql`SUM(${invoices.totalPaisa})`));

  const totals = {
    invoiceCount: Number(totalsRaw?.invoiceCount ?? 0),
    subtotalPaisa: Number(totalsRaw?.subtotalPaisa ?? 0),
    discountPaisa: Number(totalsRaw?.discountPaisa ?? 0),
    taxPaisa: Number(totalsRaw?.taxPaisa ?? 0),
    totalPaisa: Number(totalsRaw?.totalPaisa ?? 0),
  };

  return {
    totals,
    byDay: byDayRaw.map((d) => ({
      date: String(d.date),
      invoiceCount: Number(d.invoiceCount),
      totalPaisa: Number(d.totalPaisa),
    })),
    byBranch: byBranchRaw.map((b) => ({
      branchId: b.branchId,
      branchName: b.branchName,
      invoiceCount: Number(b.invoiceCount),
      totalPaisa: Number(b.totalPaisa),
    })),
    byCashier: byCashierRaw.map((c) => ({
      cashierUserId: c.cashierUserId,
      cashierName: c.cashierName,
      invoiceCount: Number(c.invoiceCount),
      totalPaisa: Number(c.totalPaisa),
    })),
  };
}

/**
 * 3. Stock & Expiry Across Branches.
 */
export async function getStockAndExpiryReport(
  db: DbClient,
  pharmacyId: string,
  branchId?: string
): Promise<StockExpiryReportItem[]> {
  const conditions = [
    eq(stockMovements.pharmacyId, pharmacyId),
  ];
  if (branchId) {
    conditions.push(eq(stockMovements.branchId, branchId));
  }

  const today = new Date().toISOString().slice(0, 10);
  const d60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const rows = await db
    .select({
      productId: stockMovements.productId,
      brandName: products.brandName,
      batchId: stockMovements.batchId,
      batchNo: batches.batchNo,
      expiryDate: batches.expiryDate,
      branchId: stockMovements.branchId,
      branchName: branches.name,
      quantity: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`,
      costPaisa: batches.costPaisa,
      mrpPaisa: batches.mrpPaisa,
    })
    .from(stockMovements)
    .innerJoin(
      products,
      and(eq(stockMovements.productId, products.id), eq(products.pharmacyId, pharmacyId))
    )
    .innerJoin(
      batches,
      and(eq(stockMovements.batchId, batches.id), eq(batches.pharmacyId, pharmacyId))
    )
    .innerJoin(
      branches,
      and(eq(stockMovements.branchId, branches.id), eq(branches.pharmacyId, pharmacyId))
    )
    .where(and(...conditions))
    .groupBy(
      stockMovements.productId,
      products.brandName,
      stockMovements.batchId,
      batches.batchNo,
      batches.expiryDate,
      stockMovements.branchId,
      branches.name,
      batches.costPaisa,
      batches.mrpPaisa
    )
    .orderBy(asc(batches.expiryDate), asc(products.brandName));

  return rows.map((r) => {
    let status: StockExpiryReportItem['status'] = 'good';
    if (r.expiryDate < today) {
      status = 'expired';
    } else if (r.expiryDate <= d60) {
      status = 'expiring_soon';
    }

    return {
      productId: r.productId,
      brandName: r.brandName,
      batchId: r.batchId,
      batchNo: r.batchNo,
      expiryDate: r.expiryDate,
      branchId: r.branchId,
      branchName: r.branchName,
      quantity: Number(r.quantity),
      costPaisa: Number(r.costPaisa),
      mrpPaisa: Number(r.mrpPaisa),
      status,
    };
  });
}

/**
 * 4. Profit Per Batch Report: Sale price minus batch cost in integer paisa (Rule 1).
 */
export async function getProfitPerBatchReport(
  db: DbClient,
  pharmacyId: string
): Promise<ProfitPerBatchItem[]> {
  const rows = await db
    .select({
      batchId: invoiceLines.batchId,
      productId: invoiceLines.productId,
      brandName: products.brandName,
      batchNo: batches.batchNo,
      expiryDate: batches.expiryDate,
      unitCostPaisa: batches.costPaisa,
      unitsSold: sql<number>`COALESCE(SUM(${invoiceLines.quantity}), 0)`,
      revenuePaisa: sql<number>`COALESCE(SUM(${invoiceLines.lineTotalPaisa}), 0)`,
    })
    .from(invoiceLines)
    .innerJoin(
      invoices,
      and(eq(invoiceLines.invoiceId, invoices.id), eq(invoices.pharmacyId, pharmacyId))
    )
    .innerJoin(
      products,
      and(eq(invoiceLines.productId, products.id), eq(products.pharmacyId, pharmacyId))
    )
    .innerJoin(
      batches,
      and(eq(invoiceLines.batchId, batches.id), eq(batches.pharmacyId, pharmacyId))
    )
    .where(
      and(
        eq(invoiceLines.pharmacyId, pharmacyId),
        eq(invoices.pharmacyId, pharmacyId),
        sql`${invoiceLines.batchId} IS NOT NULL`
      )
    )
    .groupBy(
      invoiceLines.batchId,
      invoiceLines.productId,
      products.brandName,
      batches.batchNo,
      batches.expiryDate,
      batches.costPaisa
    )
    .orderBy(desc(sql`SUM(${invoiceLines.lineTotalPaisa})`));

  return rows.map((r) => {
    const unitsSold = Number(r.unitsSold);
    const revenuePaisa = Number(r.revenuePaisa);
    const unitCostPaisa = Number(r.unitCostPaisa);
    const costPaisa = unitsSold * unitCostPaisa;
    const profitPaisa = revenuePaisa - costPaisa;
    const marginPercent = revenuePaisa > 0 ? Math.round((profitPaisa / revenuePaisa) * 1000) / 10 : 0;

    return {
      batchId: r.batchId!,
      batchNo: r.batchNo,
      productId: r.productId,
      brandName: r.brandName,
      expiryDate: r.expiryDate,
      unitsSold,
      unitCostPaisa,
      revenuePaisa,
      costPaisa,
      profitPaisa,
      marginPercent,
    };
  });
}

/**
 * 5. Supplier Ledger Report: Purchase quantities, spend in paisa, and purchase history.
 */
export async function getSupplierLedgerReport(
  db: DbClient,
  pharmacyId: string
): Promise<SupplierLedgerItem[]> {
  // Purchases are recorded in stock_movements with type 'purchase'
  const rows = await db
    .select({
      reason: stockMovements.reason,
      totalQuantity: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`,
      purchaseCount: sql<number>`COUNT(${stockMovements.id})`,
      lastPurchaseDate: sql<string>`MAX(${stockMovements.createdAt})`,
      costPaisa: sql<number>`COALESCE(SUM(${batches.costPaisa} * ${stockMovements.quantitySigned}), 0)`,
    })
    .from(stockMovements)
    .innerJoin(
      batches,
      and(eq(stockMovements.batchId, batches.id), eq(batches.pharmacyId, pharmacyId))
    )
    .where(
      and(
        eq(stockMovements.pharmacyId, pharmacyId),
        eq(stockMovements.type, 'purchase')
      )
    )
    .groupBy(stockMovements.reason)
    .orderBy(desc(sql`MAX(${stockMovements.createdAt})`));

  return rows.map((r) => ({
    supplierId: null,
    supplierName: String(r.reason || 'General Supplier'),
    purchaseCount: Number(r.purchaseCount),
    totalQuantity: Number(r.totalQuantity),
    totalCostPaisa: Number(r.costPaisa),
    lastPurchaseDate: r.lastPurchaseDate ? String(r.lastPurchaseDate) : null,
  }));
}
