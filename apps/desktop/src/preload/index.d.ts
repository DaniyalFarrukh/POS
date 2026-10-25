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
  StockOverviewProduct,
  StockOverviewBatch,
  StockOverviewResult,
} from '@pos/shared';

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

export interface ProductApi {
  getProducts: (params: ProductSearchParams) => Promise<ProductListResult>;
  getProduct: (id: string) => Promise<ProductWithTax | null>;
  createProduct: (input: CreateProductInput) => Promise<ProductWithTax>;
  updateProduct: (id: string, input: UpdateProductInput) => Promise<ProductWithTax>;
  getTaxCategories: () => Promise<TaxCategory[]>;
  importProductsCsv: (rows: CreateProductInput[]) => Promise<CsvImportSummary>;
  seedProducts: () => Promise<{ seededCount: number; defaultTaxCategoryId: string }>;
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

export interface DesktopApi {
  ping: () => Promise<string>;
  getDbInfo: () => Promise<DbMetadata>;
  auth: AuthApi;
  products: ProductApi;
  purchasing: PurchasingApi;
  stock: StockApi;
}

declare global {
  interface Window {
    api: DesktopApi;
  }
}
