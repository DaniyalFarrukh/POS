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

export type POStatus =
  'draft' | 'approved' | 'sent' | 'partially_received' | 'received' | 'cancelled';
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

export type PaymentDirection = 'receipt' | 'payment';
export type PaymentMethod = 'cash' | 'bank' | 'wallet' | 'cheque';
export type ChequeStatus = 'pending' | 'cleared' | 'bounced';
export type PaymentStatus = 'completed' | 'reversed';

export interface PaymentAllocationRecord {
  id: string;
  paymentId: string;
  documentType: 'invoice' | 'purchase';
  documentId: string;
  documentNumber: string;
  allocatedPaisa: number;
  createdAt: string;
}

export interface PaymentRecord {
  id: string;
  pharmacyId: string;
  branchId: string;
  paymentNumber: string;
  paymentDate: string;
  direction: PaymentDirection;
  partyType: 'customer' | 'supplier';
  partyId: string;
  partyName?: string;
  method: PaymentMethod;
  amountPaisa: number;
  allocatedPaisa: number;
  advancePaisa: number;
  chequeNumber?: string | null;
  chequeDate?: string | null;
  bankName?: string | null;
  chequeStatus?: ChequeStatus | null;
  bounceReason?: string | null;
  bouncedAt?: string | null;
  status: PaymentStatus;
  journalEntryId?: string | null;
  reversalEntryId?: string | null;
  reversalReason?: string | null;
  reversedAt?: string | null;
  referenceNo?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  allocations?: PaymentAllocationRecord[];
  journalLines?: Array<{
    id: string;
    accountId: string;
    debitPaisa: number;
    creditPaisa: number;
    memo?: string | null;
  }>;
}

export interface PaymentKPIs {
  totalReceiptsPaisa: number;
  totalPaymentsPaisa: number;
  netCashFlowPaisa: number;
  pendingChequesCount: number;
  pendingChequesValuePaisa: number;
}

export interface UnpaidDocumentRecord {
  id: string;
  documentType: 'invoice' | 'purchase';
  documentNumber: string;
  totalPaisa: number;
  allocatedPaisa: number;
  balanceDuePaisa: number;
  date: string;
}

export interface CustomerRecord {
  id: string;
  pharmacyId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  creditLimitPaisa: number;
  openingBalancePaisa: number;
  priceTier?: string | null;
  isDuplicate?: boolean;
  duplicateOfId?: string | null;
  currentBalancePaisa?: number;
  creditAvailablePaisa?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerLedgerLine {
  id: string;
  entryId: string;
  entryNo: number;
  entryDate: string;
  sourceType: string | null;
  sourceId: string | null;
  memo: string;
  debitPaisa: number;
  creditPaisa: number;
  runningBalancePaisa: number;
}

export interface CustomerInvoiceSummary {
  id: string;
  invoiceNumber: string;
  totalPaisa: number;
  creditLimitExceeded: boolean;
  createdAt: string;
}

export interface CustomerStatementTransaction {
  id: string;
  date: string;
  entryNo: number;
  reference: string;
  description: string;
  debitPaisa: number;
  creditPaisa: number;
  balancePaisa: number;
}

export interface CustomerStatementData {
  pharmacy: {
    id?: string;
    name?: string;
    code?: string;
  };
  customer: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    creditLimitPaisa: number;
  };
  period: {
    startDate: string;
    endDate: string;
    generatedAt: string;
  };
  openingBalancePaisa: number;
  totalDebitsPaisa: number;
  totalCreditsPaisa: number;
  closingBalancePaisa: number;
  transactions: CustomerStatementTransaction[];
}

export type ExpenseStatus = 'pending_approval' | 'approved' | 'posted' | 'reversed';
export type ExpensePaymentType = 'paid' | 'credit';

export interface ExpenseCategoryRecord {
  id: string;
  pharmacyId: string;
  name: string;
  accountId: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringExpenseRecord {
  id: string;
  pharmacyId: string;
  branchId: string;
  branchName?: string;
  title: string;
  categoryId: string;
  categoryName?: string;
  amountPaisa: number;
  frequency: 'monthly' | 'weekly' | 'quarterly' | 'yearly';
  dayOfMonth: number;
  paymentType: ExpensePaymentType;
  paymentMethod?: 'cash' | 'bank' | 'wallet' | null;
  vendorName?: string | null;
  notes?: string | null;
  isActive: boolean;
  lastGeneratedPeriod?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseRecord {
  id: string;
  pharmacyId: string;
  branchId: string;
  branchName?: string;
  expenseNumber: string;
  expenseDate: string;
  categoryId: string;
  categoryName?: string;
  amountPaisa: number;
  paymentType: ExpensePaymentType;
  paymentMethod?: 'cash' | 'bank' | 'wallet' | null;
  vendorName?: string | null;
  notes?: string | null;
  status: ExpenseStatus;
  approvalThresholdPaisa: number;
  approvedBy?: string | null;
  approvedAt?: string | null;
  recurringExpenseId?: string | null;
  recurringPeriod?: string | null;
  journalEntryId?: string | null;
  reversalEntryId?: string | null;
  reversalReason?: string | null;
  reversedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  journalLines?: Array<{
    id: string;
    accountId: string;
    accountCode?: string;
    accountName?: string;
    debitPaisa: number;
    creditPaisa: number;
    memo?: string | null;
  }>;
}

export interface ExpenseKPIs {
  totalExpensesPaisa: number;
  expenseCount: number;
  averageExpensePaisa: number;
  pendingApprovalCount: number;
}

export interface AgingSummary {
  currentPaisa: number;
  days1to30Paisa: number;
  days31to60Paisa: number;
  days61to90Paisa: number;
  days90PlusPaisa: number;
}

export interface ReconciliationCheck {
  controlAccountBalancePaisa: number;
  sumOfPartyBalancesPaisa: number;
  differencePaisa: number;
  isReconciled: boolean;
}

export interface ARSummaryData {
  totalOutstandingPaisa: number;
  overduePaisa: number;
  collectedThisMonthPaisa: number;
  aging: AgingSummary;
  reconciliation: ReconciliationCheck;
}

export interface APSummaryData {
  totalOutstandingPaisa: number;
  overduePaisa: number;
  paidThisMonthPaisa: number;
  aging: AgingSummary;
  reconciliation: ReconciliationCheck;
}

export interface CustomerARDocument {
  id: string;
  invoiceNumber: string;
  date: string;
  totalPaisa: number;
  paidPaisa: number;
  balanceDuePaisa: number;
  daysOverdue: number;
  agingBucket: 'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'days90Plus';
}

export interface CustomerARRecord {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  creditLimitPaisa: number;
  paymentTermsDays: number;
  outstandingPaisa: number;
  totalInvoicedPaisa: number;
  totalReceivedPaisa: number;
  aging: AgingSummary;
  documents: CustomerARDocument[];
}

export interface SupplierAPDocument {
  id: string;
  billNumber: string;
  date: string;
  totalPaisa: number;
  paidPaisa: number;
  balanceDuePaisa: number;
  daysOverdue: number;
  agingBucket: 'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'days90Plus';
}

export interface SupplierAPRecord {
  id: string;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  paymentTermsDays: number;
  outstandingPaisa: number;
  totalBilledPaisa: number;
  totalPaidPaisa: number;
  aging: AgingSummary;
  bills: SupplierAPDocument[];
}

export interface ProductARRecord {
  productId: string;
  productName: string;
  genericName?: string | null;
  unitsOnCredit: number;
  creditSalesPaisa: number;
  receivablePaisa: number;
  invoiceCount: number;
}

export interface BillAPRecord {
  id: string;
  documentType: 'purchase' | 'expense';
  billNumber: string;
  supplierId: string;
  supplierName: string;
  date: string;
  paymentTermsDays: number;
  totalPaisa: number;
  paidPaisa: number;
  balanceDuePaisa: number;
  daysOverdue: number;
  agingBucket: 'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'days90Plus';
}

export interface PartyStatementLine {
  id: string;
  entryNo: number;
  date: string;
  type: string | null;
  description: string;
  debitPaisa: number;
  creditPaisa: number;
  runningBalancePaisa: number;
}

export interface PartyStatementData {
  customer?: {
    id: string;
    name: string;
    phone?: string | null;
    address?: string | null;
    creditLimitPaisa?: number;
  };
  supplier?: {
    id: string;
    name: string;
    contactPerson?: string | null;
    phone?: string | null;
    paymentTermsDays?: number;
  };
  period: {
    startDate: string;
    endDate: string;
  };
  openingBalancePaisa: number;
  totalDebitsPaisa: number;
  totalCreditsPaisa: number;
  closingBalancePaisa: number;
  lines: PartyStatementLine[];
}

export interface PaymentReminderRecord {
  id: string;
  partyId: string;
  partyName: string;
  channel: 'sms' | 'whatsapp' | 'phone' | 'email' | 'in_person';
  recipient?: string | null;
  message?: string | null;
  amountPaisa: number;
  daysOverdue: number;
  sentAt: string;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Cash & Bank Module Types
// -----------------------------------------------------------------------------

export interface BankAccountRecord {
  id: string;
  pharmacyId: string;
  name: string;
  type: 'cash' | 'bank' | 'wallet';
  accountId: string;
  accountCode?: string;
  accountName?: string;
  bankName?: string | null;
  accountNumber?: string | null;
  branchName?: string | null;
  iban?: string | null;
  openingBalancePaisa: number;
  ledgerBalancePaisa: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FundTransferRecord {
  id: string;
  transferNumber: string;
  fromAccountId: string;
  fromAccountName: string;
  fromAccountType: string;
  toAccountId: string;
  toAccountName: string;
  toAccountType: string;
  amountPaisa: number;
  transferDate: string;
  referenceNo?: string | null;
  notes?: string | null;
  journalEntryId: string;
  status: 'completed' | 'reversed';
  reversalEntryId?: string | null;
  reversalReason?: string | null;
  reversedAt?: string | null;
  createdAt: string;
}

export interface CounterDepositRecord {
  id: string;
  depositNumber: string;
  depositDate: string;
  branchId: string;
  branchName: string;
  counterId?: string | null;
  counterName?: string | null;
  shiftId?: string | null;
  sourceCashAccountId: string;
  sourceCashAccountName: string;
  targetAccountId: string;
  targetAccountName: string;
  amountPaisa: number;
  notes?: string | null;
  journalEntryId: string;
  status: 'completed' | 'reversed';
  reversalEntryId?: string | null;
  reversalReason?: string | null;
  reversedAt?: string | null;
  createdAt: string;
}

export interface BankReconciliationRecord {
  id: string;
  bankAccountId: string;
  statementDate: string;
  statementBalancePaisa: number;
  ledgerBalancePaisa: number;
  clearedBalancePaisa: number;
  differencePaisa: number;
  matchedCount: number;
  status: 'draft' | 'reconciled';
  notes?: string | null;
  createdAt: string;
  reconciledAt?: string | null;
}

// -----------------------------------------------------------------------------
// Sales Ledger Module Types
// -----------------------------------------------------------------------------

export interface SalesLedgerRecord {
  id: string;
  date: string;
  type: 'sale' | 'return' | 'receipt';
  documentNumber: string;
  branchId?: string | null;
  branchName?: string | null;
  counterId?: string | null;
  counterName?: string | null;
  cashierUserId?: string | null;
  cashierName?: string | null;
  partyId?: string | null;
  partyName?: string | null;
  partyPhone?: string | null;
  paymentMethod?: string | null;
  grossPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  netPaisa: number;
  runningNetPaisa: number;
  notes?: string | null;
}

export interface SalesLedgerSummary {
  totalGrossSalesPaisa: number;
  totalReturnsPaisa: number;
  totalReceiptsPaisa: number;
  netSalesPaisa: number;
  totalCount: number;
}

// -----------------------------------------------------------------------------
// Financial Reports Module Types
// -----------------------------------------------------------------------------

export interface ReportVarianceData {
  previousPaisa: number;
  variancePaisa: number;
  varianceBp: number;
}

export interface TrialBalanceRowData {
  accountId: string;
  code: string;
  name: string;
  type: string;
  openingBalancePaisa: number;
  debitPaisa: number;
  creditPaisa: number;
  closingBalancePaisa: number;
  comparison?: ReportVarianceData;
}

export interface TrialBalanceReportData {
  pharmacyId: string;
  startDate: string;
  endDate: string;
  branchId: string | null;
  branchName: string | null;
  totalOpeningDebitPaisa: number;
  totalOpeningCreditPaisa: number;
  totalDebitPaisa: number;
  totalCreditPaisa: number;
  totalClosingDebitPaisa: number;
  totalClosingCreditPaisa: number;
  isBalanced: boolean;
  rows: TrialBalanceRowData[];
  previousPeriod?: {
    startDate: string;
    endDate: string;
    totalDebitPaisa: number;
    totalCreditPaisa: number;
  };
}

export interface PnlAccountLineData {
  accountId: string;
  code: string;
  name: string;
  amountPaisa: number;
  comparison?: ReportVarianceData;
}

export interface ProfitAndLossReportData {
  pharmacyId: string;
  startDate: string;
  endDate: string;
  branchId: string | null;
  branchName: string | null;
  summary: {
    totalRevenuePaisa: number;
    totalCogsPaisa: number;
    grossProfitPaisa: number;
    grossMarginBp: number;
    totalOperatingExpensesPaisa: number;
    netProfitPaisa: number;
    netMarginBp: number;
    comparison?: {
      previousRevenuePaisa: number;
      previousCogsPaisa: number;
      previousGrossProfitPaisa: number;
      previousOperatingExpensesPaisa: number;
      previousNetProfitPaisa: number;
      revenueVariancePaisa: number;
      netProfitVariancePaisa: number;
    };
  };
  sections: {
    revenue: {
      totalPaisa: number;
      rows: PnlAccountLineData[];
    };
    costOfGoodsSold: {
      totalPaisa: number;
      rows: PnlAccountLineData[];
    };
    operatingExpenses: {
      totalPaisa: number;
      rows: PnlAccountLineData[];
    };
  };
}

export interface BalanceSheetAccountLineData {
  accountId: string;
  code: string;
  name: string;
  balancePaisa: number;
  comparison?: ReportVarianceData;
}

export interface BalanceSheetReportData {
  pharmacyId: string;
  startDate: string;
  endDate: string;
  branchId: string | null;
  branchName: string | null;
  summary: {
    totalAssetsPaisa: number;
    totalLiabilitiesPaisa: number;
    totalBaseEquityPaisa: number;
    currentPeriodProfitPaisa: number;
    totalEquityAndReservesPaisa: number;
    totalLiabilitiesAndEquityPaisa: number;
    differencePaisa: number;
  };
  isBalanced: boolean;
  sections: {
    assets: {
      totalPaisa: number;
      rows: BalanceSheetAccountLineData[];
    };
    liabilities: {
      totalPaisa: number;
      rows: BalanceSheetAccountLineData[];
    };
    equity: {
      totalBasePaisa: number;
      currentPeriodProfitPaisa: number;
      totalWithProfitPaisa: number;
      rows: BalanceSheetAccountLineData[];
    };
  };
}

export interface CashFlowCategoryLineData {
  category: string;
  label: string;
  amountPaisa: number;
}

export interface CashFlowReportData {
  pharmacyId: string;
  startDate: string;
  endDate: string;
  branchId: string | null;
  branchName: string | null;
  summary: {
    openingCashPaisa: number;
    totalInflowsPaisa: number;
    totalOutflowsPaisa: number;
    netCashFlowPaisa: number;
    closingCashPaisa: number;
  };
  isReconciled: boolean;
  inflows: CashFlowCategoryLineData[];
  outflows: CashFlowCategoryLineData[];
}

export interface GeneralLedgerAccountSummaryData {
  accountId: string;
  code: string;
  name: string;
  type: string;
  openingBalancePaisa: number;
  periodDebitPaisa: number;
  periodCreditPaisa: number;
  closingBalancePaisa: number;
}

export interface GeneralLedgerLineDetailData {
  lineId: string;
  entryId: string;
  entryNo: number;
  entryDate: string;
  sourceType: string | null;
  sourceId: string | null;
  memo: string | null;
  branchId: string | null;
  branchName: string | null;
  debitPaisa: number;
  creditPaisa: number;
  runningBalancePaisa: number;
}

// -----------------------------------------------------------------------------
// Budget Planning Module Types
// -----------------------------------------------------------------------------

export interface BudgetItemRecord {
  id: string;
  pharmacyId: string;
  branchId: string;
  branchName: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: 'expense' | 'revenue';
  fiscalYear: number;
  month: number;
  amountPaisa: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActualVsBudgetRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: 'expense' | 'revenue';
  branchId: string | null;
  branchName: string | null;
  budgetPaisa: number;
  actualPaisa: number;
  variancePaisa: number;
  varianceBp: number;
  percentageUsed: number;
  alertStatus: 'normal' | 'warning' | 'exceeded' | 'under' | 'on_track' | 'achieved';
}

export interface BudgetAlert {
  accountId: string;
  accountCode: string;
  accountName: string;
  branchId: string | null;
  branchName: string | null;
  budgetPaisa: number;
  actualPaisa: number;
  percentageUsed: number;
  level: 'warning' | 'exceeded';
}

export interface BudgetSummaryKPIs {
  totalExpenseBudgetPaisa: number;
  totalExpenseActualPaisa: number;
  totalExpenseVariancePaisa: number;
  totalRevenueBudgetPaisa: number;
  totalRevenueActualPaisa: number;
  totalRevenueVariancePaisa: number;
  netBudgetPaisa: number;
  netActualPaisa: number;
  netVariancePaisa: number;
  alertCount: number;
}

export interface ActualVsBudgetReportData {
  pharmacyId: string;
  fiscalYear: number;
  month: number | null;
  branchId: string | null;
  branchName: string | null;
  summary: BudgetSummaryKPIs;
  alerts: BudgetAlert[];
  rows: ActualVsBudgetRow[];
}

// -----------------------------------------------------------------------------
// Period Close Types
// -----------------------------------------------------------------------------
export interface FiscalPeriodItem {
  id: string;
  pharmacyId: string;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed';
  closedAt: string | null;
  closedBy: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PeriodChecklistItem {
  id: 'unposted_documents' | 'bank_reconciliation' | 'stock_count' | 'reconciliation_differences';
  title: string;
  status: 'passed' | 'warning';
  count: number;
  description: string;
}

export interface MonthEndChecklistData {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  canClose: boolean;
  items: PeriodChecklistItem[];
}

export interface YearEndClosingResult {
  journalEntryId: string | null;
  netProfitPaisa: number;
  linesCount: number;
}

export interface PrescriptionItemRecord {
  id: string;
  productId: string;
  productName?: string;
  genericName?: string;
  dosageInstructions: string;
  quantityPrescribed: number;
  quantityDispensed: number;
  daysSupply: number;
  isControlled: boolean;
  notes?: string | null;
}

export interface PrescriptionRecord {
  id: string;
  pharmacyId: string;
  prescriptionNumber: string;
  customerId?: string | null;
  customerName?: string | null;
  patientName: string;
  patientPhone?: string | null;
  patientAge?: number | null;
  patientGender?: string | null;
  doctorName?: string | null;
  doctorRegistrationNumber?: string | null;
  doctorClinic?: string | null;
  prescriptionDate: string;
  diagnosis?: string | null;
  repeatCount: number;
  repeatsUsed: number;
  refillIntervalDays: number;
  nextRefillDate?: string | null;
  isControlledDrug: boolean;
  invoiceId?: string | null;
  status: 'active' | 'fulfilled' | 'cancelled' | 'expired';
  notes?: string | null;
  retentionStatus: 'active' | 'retained' | 'archived';
  statutoryRetentionUntil: string;
  items?: PrescriptionItemRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface RefillReminderItem {
  prescriptionId: string;
  prescriptionNumber: string;
  patientName: string;
  patientPhone: string;
  doctorName: string;
  prescriptionDate: string;
  nextRefillDate: string;
  repeatCount: number;
  repeatsUsed: number;
  remainingRepeats: number;
  isControlledDrug: boolean;
  contactSummary: string;
}

export interface PrescriptionAccessLogRecord {
  id: string;
  prescriptionId?: string | null;
  userId: string;
  userRole: string;
  action:
    'view_detail' | 'view_list' | 'view_reminders' | 'create' | 'update' | 'dispense' | 'refill';
  details?: string | null;
  accessedAt: string;
}

export interface ProductRecord {
  id: string;
  brandName: string;
  genericName?: string | null;
  strength?: string | null;
  form?: string | null;
  mrpPaisa?: number;
}

export interface EmployeeRecord {
  id: string;
  pharmacyId: string;
  branchId?: string | null;
  userId?: string | null;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  designation: string;
  department?: string | null;
  joiningDate: string;
  salaryPaisa: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveTypeRecord {
  id: string;
  pharmacyId: string;
  code: string;
  name: string;
  description?: string | null;
  isPaid: boolean;
  yearlyEntitlementDays: number;
  maxCarryOverDays: number;
  isActive: boolean;
}

export interface LeaveAllocationRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  isPaid: boolean;
  year: number;
  entitledDays: number;
  carriedOverDays: number;
  manualAdjustmentDays: number;
  totalAllocatedDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
}

export interface LeaveRequestRecord {
  id: string;
  pharmacyId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  isPaid: boolean;
  startDate: string;
  endDate: string;
  daysCount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  rejectionReason?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveCalendarItem {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  isPaid: boolean;
  startDate: string;
  endDate: string;
  daysCount: number;
  status: 'pending' | 'approved';
  reason: string;
}

export interface AttendanceRecordItem {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  status: 'present' | 'absent' | 'late' | 'half_day' | 'on_leave';
  leaveRequestId?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  notes?: string | null;
}

export interface PayrollPreviewItem {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string;
  month: string;
  baseSalaryPaisa: number;
  workingDaysInMonth: number;
  approvedPaidLeaveDays: number;
  approvedUnpaidLeaveDays: number;
  dailyRatePaisa: number;
  unpaidLeaveDeductionPaisa: number;
  grossSalaryPaisa: number;
  netSalaryPaisa: number;
}

export interface PayrollStatutoryComponentRecord {
  id: string;
  code: string;
  name: string;
  componentType: 'statutory_deduction' | 'tax';
  calculationType: 'fixed' | 'percentage';
  fixedAmountPaisa: number;
  percentageRate: string;
  accountCode: string;
  isExample: boolean;
  notes: string;
  isActive: boolean;
}

export interface PayrollTaxSlabRecord {
  id: string;
  minMonthlyIncomePaisa: number;
  maxMonthlyIncomePaisa?: number | null;
  baseTaxPaisa: number;
  excessRatePercentage: string;
  isExample: boolean;
  notes: string;
  isActive: boolean;
}

export interface EmployeeAdvanceRecord {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeCode?: string;
  disbursementDate: string;
  principalPaisa: number;
  recoveredPaisa: number;
  remainingPaisa: number;
  monthlyInstallmentPaisa: number;
  reason?: string | null;
  status: 'active' | 'recovered' | 'written_off';
  createdAt: string;
}

export interface PayrollRunRecord {
  id: string;
  pharmacyId: string;
  branchId: string;
  branchName?: string;
  month: string;
  runNumber: string;
  status: 'draft' | 'reviewed' | 'approved' | 'posted' | 'paid' | 'cancelled';
  isAdjustmentRun: boolean;
  adjustmentForRunId?: string | null;
  totalBaseSalaryPaisa: number;
  totalAllowancesPaisa: number;
  totalOvertimePaisa: number;
  totalGrossPaisa: number;
  totalUnpaidLeaveDeductionsPaisa: number;
  totalAdvancesRecoveredPaisa: number;
  totalTaxPaisa: number;
  totalStatutoryPaisa: number;
  totalDeductionsPaisa: number;
  totalNetPaisa: number;
  journalEntryId?: string | null;
  paymentJournalEntryId?: string | null;
  paymentAccountId?: string | null;
  paymentMethod?: string | null;
  paidAt?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  employeeCount?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface PayrollItemRecord {
  id: string;
  payrollRunId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string;
  baseSalaryPaisa: number;
  workingDays: number;
  attendedDays: number;
  unpaidLeaveDays: number;
  unpaidLeaveDeductionPaisa: number;
  overtimeHours: number;
  overtimeAmountPaisa: number;
  allowancesPaisa: number;
  allowancesBreakdown?: string | null;
  advanceRecoveryPaisa: number;
  advanceId?: string | null;
  taxPaisa: number;
  statutoryDeductionsPaisa: number;
  statutoryBreakdown?: string | null;
  grossSalaryPaisa: number;
  totalDeductionsPaisa: number;
  netSalaryPaisa: number;
  paymentStatus: 'pending' | 'paid';
}

export interface PayslipRecord {
  id: string;
  pharmacyName: string;
  runNumber: string;
  month: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string;
  department?: string;
  joiningDate?: string;
  baseSalaryPaisa: number;
  workingDays: number;
  attendedDays: number;
  unpaidLeaveDays: number;
  earnings: {
    baseSalaryPaisa: number;
    allowancesPaisa: number;
    allowancesBreakdown: Array<{ name: string; amountPaisa: number }>;
    overtimeHours: number;
    overtimeAmountPaisa: number;
    grossSalaryPaisa: number;
  };
  deductions: {
    unpaidLeaveDeductionPaisa: number;
    advanceRecoveryPaisa: number;
    taxPaisa: number;
    statutoryDeductionsPaisa: number;
    statutoryBreakdown: Array<{ code: string; name: string; amountPaisa: number }>;
    totalDeductionsPaisa: number;
  };
  netSalaryPaisa: number;
  paymentStatus: string;
  isApproved: boolean;
}
