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
}

declare global {
  interface Window {
    api: DesktopApi;
  }
}
