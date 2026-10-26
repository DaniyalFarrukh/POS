import type {
  SetupInput,
  LoginInput,
  UnlockInput,
  PublicUser,
  AuthSession,
  CreateProductInput,
  UpdateProductInput,
  ProductSearchParams,
  ProductWithTax,
  ProductListResult,
  TaxCategory,
  Supplier,
  CreateSupplierInput,
  UpdateSupplierInput,
  ReceiveGrnInput,
  PurchaseRecord,
  StockAdjustmentInput,
  StockFilterParams,
  CreateInvoiceInput,
  InvoiceRecord,
  FinalizeSaleInput,
  InvoiceSearchParams,
  ReturnableLineItem,
  ProcessReturnInput,
  CreditNoteRecord,
  ShiftRecord,
  OpenShiftInput,
  CloseShiftInput,
} from '@pos/shared';
import type { FinalizedInvoice } from '../main/finalizeSale';
import type { SyncStatus, SyncExceptionRecord } from '../main/sync/core/types';

export interface DbMetadata {
  dbPath: string;
  schemaVersion: number;
  journalMode: string;
  foreignKeys: boolean;
  migrationsApplied: number;
}

export interface CsvImportSummary {
  importedCount: number;
  skippedCount: number;
  errors: { rowNumber: number; barcode?: string; reason: string }[];
}

export interface PosCatalogItem {
  id: string;
  brandName: string;
  genericName: string;
  strength: string;
  form: string;
  manufacturer: string;
  barcode: string | null;
  mrpPaisa: number;
  taxCategoryId: string;
  taxCategoryName: string;
  taxRateBp: number;
  isControlled: boolean;
  totalStock: number;
  earliestBatch: {
    id: string;
    batchNo: string;
    expiryDate: string;
    balance: number;
  } | null;
}

export interface ProductApi {
  getProducts: (params: ProductSearchParams) => Promise<ProductListResult>;
  getProduct: (id: string) => Promise<ProductWithTax | null>;
  createProduct: (input: CreateProductInput) => Promise<ProductWithTax>;
  updateProduct: (id: string, input: UpdateProductInput) => Promise<ProductWithTax>;
  getTaxCategories: () => Promise<TaxCategory[]>;
  importProductsCsv: (rows: CreateProductInput[]) => Promise<CsvImportSummary>;
  seedProducts: () => Promise<{ seededCount: number; defaultTaxCategoryId: string }>;
  searchPosCatalog: (query: string, branchId?: string) => Promise<PosCatalogItem[]>;
  getSubstitutes: (genericName: string, excludeProductId?: string, branchId?: string) => Promise<PosCatalogItem[]>;
}

export interface PurchasingApi {
  getSuppliers: () => Promise<Supplier[]>;
  getSupplier: (id: string) => Promise<Supplier | null>;
  createSupplier: (input: CreateSupplierInput) => Promise<Supplier>;
  updateSupplier: (id: string, input: UpdateSupplierInput) => Promise<Supplier>;
  deleteSupplier: (id: string) => Promise<{ success: boolean }>;
  receiveGrn: (input: ReceiveGrnInput) => Promise<PurchaseRecord>;
}

export interface StockApi {
  getOverviewProducts: (params: StockFilterParams) => Promise<StockOverviewResult<StockOverviewProduct>>;
  getOverviewBatches: (params: StockFilterParams) => Promise<StockOverviewResult<StockOverviewBatch>>;
  adjustStock: (input: StockAdjustmentInput) => Promise<{ success: boolean; movementId: string; newBalance: number }>;
  getBatchesForProduct: (productId: string) => Promise<{
    id: string;
    batchNo: string;
    expiryDate: string;
    costPaisa: number;
    mrpPaisa: number;
    balance: number;
  }[]>;
}

export interface AuthApi {
  getSetupStatus: () => Promise<{ needsSetup: boolean }>;
  completeSetup: (data: SetupInput) => Promise<AuthSession>;
  getUsers: () => Promise<PublicUser[]>;
  login: (data: LoginInput) => Promise<AuthSession>;
  logout: () => Promise<void>;
  lockSession: () => Promise<void>;
  unlockSession: (data: UnlockInput) => Promise<AuthSession>;
  getSession: () => Promise<AuthSession | null>;
  testRoleAction: (
    requiredRole: 'cashier' | 'pharmacist' | 'owner'
  ) => Promise<{ success: boolean; message: string }>;
}

export interface SalesApi {
  finalizeSale: (input: FinalizeSaleInput) => Promise<FinalizedInvoice>;
}

export interface InvoiceApi {
  createInvoice: (input: CreateInvoiceInput) => Promise<InvoiceRecord>;
  getRecentInvoices: (limit?: number) => Promise<InvoiceRecord[]>;
  searchInvoices: (params?: InvoiceSearchParams) => Promise<InvoiceRecord[]>;
  getInvoice: (id: string) => Promise<InvoiceRecord | null>;
  printReceipt: (
    htmlContent: string,
    options?: { silent?: boolean; deviceName?: string }
  ) => Promise<{ success: boolean; error?: string }>;
}

export interface ReturnsApi {
  getReturnableLines: (invoiceId: string) => Promise<ReturnableLineItem[]>;
  processReturn: (input: ProcessReturnInput) => Promise<CreditNoteRecord>;
}

export interface ShiftsApi {
  getCurrentShift: (counterId?: string) => Promise<ShiftRecord | null>;
  openShift: (input: OpenShiftInput) => Promise<ShiftRecord>;
  closeShift: (input: CloseShiftInput) => Promise<ShiftRecord>;
  getShiftHistory: (options?: {
    branchId?: string;
    counterId?: string;
    limit?: number;
    offset?: number;
  }) => Promise<ShiftRecord[]>;
}

export interface SyncApi {
  getStatus: () => Promise<SyncStatus>;
  syncNow: () => Promise<SyncStatus>;
  registerDevice: (
    serverUrl: string,
    code: string,
    deviceName?: string
  ) => Promise<{ success: boolean; deviceId: string; pharmacyId?: string; branchId?: string }>;
  listExceptions: (status?: string) => Promise<SyncExceptionRecord[]>;
  retryException: (id: string) => Promise<{ success: boolean }>;
  dismissException: (id: string, note?: string) => Promise<{ success: boolean }>;
  onStatusChanged: (callback: (status: SyncStatus) => void) => () => void;
}

export interface SystemApi {
  getPrinters: () => Promise<Array<{ name: string; displayName: string; isDefault: boolean }>>;
  exportDiagnostics: () => Promise<{ success: boolean; zipPath?: string; error?: string }>;
  getIntegrityStatus: () => Promise<{ ok: boolean; message: string; dbPath: string }>;
}

export interface BackupRecord {
  filename: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BackupApi {
  create: () => Promise<{ success: boolean; filename: string; path: string; sizeBytes: number }>;
  list: () => Promise<BackupRecord[]>;
  restore: (filename: string) => Promise<{ success: boolean; safetyBackupFile: string }>;
}

export interface UpdaterApi {
  check: () => Promise<{ checking: boolean; updateAvailable?: boolean; error?: string }>;
  getStatus: () => Promise<{ state: string; version?: string; releaseNotes?: string; error?: string }>;
}

export interface DesktopApi {
  ping: () => Promise<string>;
  getDbInfo: () => Promise<DbMetadata>;
  auth: AuthApi;
  products: ProductApi;
  purchasing: PurchasingApi;
  stock: StockApi;
  invoices: InvoiceApi;
  sales: SalesApi;
  returns: ReturnsApi;
  shifts: ShiftsApi;
  sync: SyncApi;
  system: SystemApi;
  backup: BackupApi;
  updater: UpdaterApi;
}

declare global {
  interface Window {
    api: DesktopApi;
  }
}
