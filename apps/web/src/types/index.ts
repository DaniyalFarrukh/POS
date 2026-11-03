import type { UserRole } from '@pos/shared';

export interface UserContext {
  id: string;
  name: string;
  role: UserRole;
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

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface AccountRecord {
  id: string;
  pharmacyId: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  currency: string;
  isActive: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AccountMappingRole =
  | 'cash'
  | 'bank'
  | 'wallet'
  | 'ar'
  | 'inventory'
  | 'ap'
  | 'sales'
  | 'output_tax'
  | 'input_tax'
  | 'cogs'
  | 'stock_variance'
  | 'retained_earnings';

export interface JournalLineRecord {
  id: string;
  journalEntryId: string;
  pharmacyId: string;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  branchId: string | null;
  debitPaisa: number;
  creditPaisa: number;
  memo: string | null;
  partyType: string | null;
  partyId: string | null;
  createdAt: string;
}

export interface JournalEntryRecord {
  id: string;
  pharmacyId: string;
  entryNo: number;
  entryDate: string;
  periodId: string;
  sourceType: string | null;
  sourceId: string | null;
  memo: string;
  status: 'posted' | 'reversed';
  reversesEntryId: string | null;
  reversedByEntryId?: string | null;
  reversedByEntryNo?: number | null;
  reversalReason: string | null;
  createdBy: string;
  postedAt: string;
  lines: JournalLineRecord[];
}

export interface JournalListFilters {
  from?: string;
  to?: string;
  sourceType?: string;
  status?: string;
  search?: string;
}

export interface SupplierRecord {
  id: string;
  pharmacyId: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxNumber: string | null;
  paymentTermsDays: number;
  creditLimitPaisa: number;
  openingBalancePaisa: number;
  payableBalancePaisa: number;
  overduePayablePaisa: number;
  isActive: boolean;
  purchaseCount: number;
  lastPurchaseDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierLedgerEntry {
  id: string;
  entryId: string;
  entryNo: number;
  entryDate: string;
  sourceType: string | null;
  sourceId: string | null;
  memo: string | null;
  lineMemo: string | null;
  debitPaisa: number;
  creditPaisa: number;
  runningBalancePaisa: number;
  createdAt: string;
}

export interface SupplierPurchaseEntry {
  id: string;
  entryNo: number;
  entryDate: string;
  sourceId: string | null;
  memo: string | null;
  postedAt: string;
}

export type POStatus = 'draft' | 'approved' | 'sent' | 'partially_received' | 'received' | 'cancelled';
export type OverReceiptPolicy = 'reject' | 'flag';

export interface PurchaseOrderLineRecord {
  id: string;
  purchaseOrderId: string;
  productId: string;
  quantityOrdered: number;
  quantityReceived: number;
  expectedCostPaisa: number;
  totalCostPaisa: number;
  createdAt: string;
  updatedAt: string;
  product?: {
    id: string;
    brandName: string;
    genericName?: string | null;
    mrpPaisa?: number;
  };
}

export interface PurchaseOrderReceiptRecord {
  id: string;
  purchaseOrderId: string;
  receiptReferenceId: string;
  supplierInvoiceNo: string;
  receiptDate: string;
  totalCostPaisa: number;
  createdBy?: string | null;
  createdAt: string;
}

export interface PurchaseOrderRecord {
  id: string;
  pharmacyId: string;
  poNumber: string;
  supplierId: string;
  supplierName?: string;
  branchId: string;
  branchName?: string;
  status: POStatus;
  overReceiptPolicy: OverReceiptPolicy;
  issueDate: string;
  expectedDeliveryDate?: string | null;
  totalExpectedCostPaisa: number;
  notes?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdBy?: string | null;
  creatorName?: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: PurchaseOrderLineRecord[];
  receipts?: PurchaseOrderReceiptRecord[];
}

export interface PurchaseOrderKPIs {
  openCount: number;
  pendingApprovalCount: number;
  committedPaisa: number;
  overdueCount: number;
}

export interface LowStockSuggestionItem {
  productId: string;
  brandName: string;
  genericName?: string | null;
  currentStock: number;
  reorderLevel: number;
  reorderQuantity: number;
  suggestedQuantity: number;
  mrpPaisa: number;
}

export type StockTransferStatus = 'draft' | 'in_transit' | 'received' | 'cancelled';

export interface StockLocationRecord {
  id: string;
  pharmacyId: string;
  branchId: string;
  branchName?: string;
  name: string;
  code?: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockTransferLineRecord {
  id: string;
  transferId: string;
  productId: string;
  batchId: string;
  quantityRequested: number;
  quantityDispatched: number;
  quantityReceived: number;
  shortageQuantity: number;
  shortageReason?: string | null;
  product?: {
    id: string;
    brandName: string;
    genericName?: string | null;
  };
  batch?: {
    id: string;
    batchNo: string;
    expiryDate: string;
    costPaisa: number;
    mrpPaisa: number;
  };
}

export interface StockTransferRecord {
  id: string;
  pharmacyId: string;
  transferNumber: string;
  sourceBranchId: string;
  sourceBranchName?: string;
  sourceLocationId?: string | null;
  sourceLocationName?: string | null;
  destinationBranchId: string;
  destinationBranchName?: string;
  destinationLocationId?: string | null;
  destinationLocationName?: string | null;
  status: StockTransferStatus;
  dispatchedBy?: string | null;
  dispatchedByName?: string | null;
  dispatchedAt?: string | null;
  receivedBy?: string | null;
  receivedByName?: string | null;
  receivedAt?: string | null;
  hasShortage: boolean;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: StockTransferLineRecord[];
}

export interface StockTransferKPIs {
  totalCount: number;
  inTransitCount: number;
  receivedCount: number;
  shortageCount: number;
}

export type StockCountStatus = 'draft' | 'submitted' | 'approved' | 'cancelled';

export interface StockCountLineRecord {
  id: string;
  countId: string;
  productId: string;
  batchId: string;
  systemQuantity: number;
  countedQuantity: number;
  varianceQuantity: number;
  costPaisa: number;
  variancePaisa: number;
  notes?: string | null;
  adjustmentMovementId?: string | null;
  product?: {
    id: string;
    brandName: string;
    genericName?: string | null;
  };
  batch?: {
    id: string;
    batchNo: string;
    expiryDate: string;
    costPaisa: number;
  };
}

export interface StockCountRecord {
  id: string;
  pharmacyId: string;
  branchId: string;
  branchName?: string;
  locationId?: string | null;
  locationName?: string | null;
  countNumber: string;
  status: StockCountStatus;
  notes?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  approvedBy?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: StockCountLineRecord[];
}

export interface StockCountKPIs {
  totalCounts: number;
  draftCount: number;
  submittedCount: number;
  approvedCount: number;
  totalVariancePaisa: number;
}

export type SupplierReturnStatus = 'draft' | 'completed' | 'cancelled';

export interface SupplierReturnLineRecord {
  id: string;
  returnId: string;
  productId: string;
  batchId: string;
  quantity: number;
  unitCostPaisa: number;
  taxRateBp: number;
  taxPaisa: number;
  totalPaisa: number;
  movementId?: string | null;
  reason?: string | null;
  product?: {
    id: string;
    brandName: string;
    genericName?: string | null;
  };
  batch?: {
    id: string;
    batchNo: string;
    expiryDate: string;
    costPaisa: number;
  };
}

export interface SupplierReturnRecord {
  id: string;
  pharmacyId: string;
  branchId: string;
  branchName?: string;
  supplierId: string;
  supplierName?: string;
  returnNumber: string;
  debitNoteNumber: string;
  returnDate: string;
  status: SupplierReturnStatus;
  subtotalPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
  reason: string;
  notes?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: SupplierReturnLineRecord[];
}

export interface SupplierReturnKPIs {
  totalReturns: number;
  totalReturnedPaisa: number;
}

export interface StockProductRecord {
  id: string;
  brandName: string;
  genericName?: string | null;
  strength?: string | null;
  form?: string | null;
  manufacturer?: string | null;
  barcode?: string | null;
  reorderLevel: number;
  reorderQuantity: number;
  mrpPaisa: number;
  isActive: boolean;
  totalStock: number;
  stockValuePaisa: number;
  isLowStock: boolean;
  hasNearExpiry: boolean;
  hasExpired: boolean;
}

export interface StockBatchRecord {
  batchId: string;
  batchNo: string;
  productId: string;
  productName: string;
  genericName?: string | null;
  barcode?: string | null;
  branchId: string;
  branchName: string;
  locationId?: string | null;
  locationName?: string | null;
  expiryDate: string;
  daysUntilExpiry: number;
  costPaisa: number;
  mrpPaisa: number;
  onHandQuantity: number;
  stockValuePaisa: number;
  isExpired: boolean;
  isNearExpiry: boolean;
}

export interface StockKPIs {
  totalStockValuePaisa: number;
  ledgerInventoryBalancePaisa: number;
  reconciliationDifferencePaisa: number;
  lowStockCount: number;
  nearExpiryCount: number;
  expiredCount: number;
}

export interface ExpiringBatchRecord {
  batchId: string;
  batchNo: string;
  productId: string;
  productName: string;
  genericName?: string | null;
  barcode?: string | null;
  branchId: string;
  branchName: string;
  locationId?: string | null;
  locationName?: string | null;
  expiryDate: string;
  daysUntilExpiry: number;
  costPaisa: number;
  mrpPaisa: number;
  onHandQuantity: number;
  stockValuePaisa: number;
  bucket: 'expired' | '30' | '60' | '90' | 'distant';
}

export interface ExpiringBatchesSummary {
  expired: number;
  expiring30: number;
  expiring60: number;
  expiring90: number;
  totalExpiringCount: number;
  totalExpiringValuePaisa: number;
}

export interface StockMovementTimelineRecord {
  id: string;
  type: 'purchase' | 'sale' | 'return' | 'adjustment' | 'transfer_in' | 'transfer_out';
  quantitySigned: number;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  createdAt: string;
  batchId: string;
  batchNo: string;
  branchId: string;
  branchName: string;
  locationName?: string | null;
}

export interface ProductStockDetailData {
  product: StockProductRecord;
  batches: StockBatchRecord[];
  movements: StockMovementTimelineRecord[];
}




