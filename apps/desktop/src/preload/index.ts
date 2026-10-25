import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from './index.d';
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
import type { CsvImportSummary } from './index.d';

const api: DesktopApi = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  getDbInfo: () => ipcRenderer.invoke('get-db-info'),
  auth: {
    getSetupStatus: (): Promise<{ needsSetup: boolean }> =>
      ipcRenderer.invoke('auth:get-setup-status'),
    completeSetup: (data: SetupInput): Promise<AuthSession> =>
      ipcRenderer.invoke('auth:complete-setup', data),
    getUsers: (): Promise<PublicUser[]> => ipcRenderer.invoke('auth:get-users'),
    login: (data: LoginInput): Promise<AuthSession> => ipcRenderer.invoke('auth:login', data),
    logout: (): Promise<void> => ipcRenderer.invoke('auth:logout'),
    lockSession: (): Promise<void> => ipcRenderer.invoke('auth:lock-session'),
    unlockSession: (data: UnlockInput): Promise<AuthSession> =>
      ipcRenderer.invoke('auth:unlock-session', data),
    getSession: (): Promise<AuthSession | null> => ipcRenderer.invoke('auth:get-session'),
    testRoleAction: (
      requiredRole: 'cashier' | 'pharmacist' | 'owner'
    ): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('auth:test-role-action', requiredRole),
  },
  products: {
    getProducts: (params: ProductSearchParams): Promise<ProductListResult> =>
      ipcRenderer.invoke('products:get-all', params),
    getProduct: (id: string): Promise<ProductWithTax | null> =>
      ipcRenderer.invoke('products:get-one', id),
    createProduct: (input: CreateProductInput): Promise<ProductWithTax> =>
      ipcRenderer.invoke('products:create', input),
    updateProduct: (id: string, input: UpdateProductInput): Promise<ProductWithTax> =>
      ipcRenderer.invoke('products:update', id, input),
    getTaxCategories: (): Promise<TaxCategory[]> =>
      ipcRenderer.invoke('products:get-tax-categories'),
    importProductsCsv: (rows: CreateProductInput[]): Promise<CsvImportSummary> =>
      ipcRenderer.invoke('products:import-csv', rows),
    seedProducts: (): Promise<{ seededCount: number; defaultTaxCategoryId: string }> =>
      ipcRenderer.invoke('products:seed'),
  },
  purchasing: {
    getSuppliers: () => ipcRenderer.invoke('purchasing:get-suppliers'),
    getSupplier: (id: string) => ipcRenderer.invoke('purchasing:get-supplier', id),
    createSupplier: (input) => ipcRenderer.invoke('purchasing:create-supplier', input),
    updateSupplier: (id: string, input) => ipcRenderer.invoke('purchasing:update-supplier', id, input),
    deleteSupplier: (id: string) => ipcRenderer.invoke('purchasing:delete-supplier', id),
    receiveGrn: (input) => ipcRenderer.invoke('purchasing:receive-grn', input),
  },
  stock: {
    getOverviewProducts: (params) => ipcRenderer.invoke('stock:get-overview-products', params),
    getOverviewBatches: (params) => ipcRenderer.invoke('stock:get-overview-batches', params),
    adjustStock: (input) => ipcRenderer.invoke('stock:adjust', input),
    getBatchesForProduct: (productId: string) =>
      ipcRenderer.invoke('stock:get-batches-for-product', productId),
  },
};

contextBridge.exposeInMainWorld('api', api);
