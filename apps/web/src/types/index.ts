export interface UserContext {
  id: string;
  name: string;
  role: 'owner' | 'pharmacist' | 'cashier';
  pharmacyId: string;
  pharmacyName: string;
}

export interface DashboardOverview {
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

export interface SalesReport {
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

export interface UserRecord {
  id: string;
  name: string;
  role: 'owner' | 'pharmacist' | 'cashier';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BranchRecord {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  createdAt: string;
}

export interface CounterRecord {
  id: string;
  branchId: string;
  branchName: string;
  name: string;
  code: string | null;
  lastInvoiceSeq: number;
  createdAt: string;
}

export interface DeviceRecord {
  id: string;
  deviceName: string;
  branchId: string | null;
  branchName: string | null;
  counterId: string | null;
  counterName: string | null;
  counterCode: string | null;
  isRevoked: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface AuditLogItem {
  seq: number;
  entity: string;
  entityId: string;
  op: 'upsert' | 'delete';
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
