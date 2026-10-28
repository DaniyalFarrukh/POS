import { contextBridge, ipcRenderer } from 'electron';
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
import type { DesktopApi, CsvImportSummary, StaffMember, CreateStaffInput, UpdateStaffInput } from './index.d';
import type { SyncStatus } from '../main/sync/core/types';

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
    getStaffList: (): Promise<StaffMember[]> => ipcRenderer.invoke('auth:get-staff-list'),
    createStaffMember: (input: CreateStaffInput): Promise<StaffMember> =>
      ipcRenderer.invoke('auth:create-staff-member', input),
    updateStaffMember: (id: string, input: UpdateStaffInput): Promise<StaffMember> =>
      ipcRenderer.invoke('auth:update-staff-member', id, input),
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
    searchPosCatalog: (query: string, branchId?: string) =>
      ipcRenderer.invoke('products:search-pos-catalog', query, branchId),
    getSubstitutes: (genericName: string, excludeProductId?: string, branchId?: string) =>
      ipcRenderer.invoke('products:get-substitutes', genericName, excludeProductId, branchId),
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
  invoices: {
    getRecentInvoices: (limit) => ipcRenderer.invoke('invoices:get-recent', limit),
    searchInvoices: (params) => ipcRenderer.invoke('invoices:search', params),
    getInvoice: (id) => ipcRenderer.invoke('invoices:get-one', id),
    printReceipt: (htmlContent, options) =>
      ipcRenderer.invoke('invoices:print-receipt', htmlContent, options),
  },
  sales: {
    finalizeSale: (input) => ipcRenderer.invoke('sales:finalize', input),
  },
  returns: {
    getReturnableLines: (invoiceId) => ipcRenderer.invoke('returns:get-returnable', invoiceId),
    processReturn: (input) => ipcRenderer.invoke('returns:process', input),
  },
  shifts: {
    getCurrentShift: (counterId) => ipcRenderer.invoke('shifts:get-current', counterId),
    openShift: (input) => ipcRenderer.invoke('shifts:open', input),
    closeShift: (input) => ipcRenderer.invoke('shifts:close', input),
    getShiftHistory: (options) => ipcRenderer.invoke('shifts:get-history', options),
  },
  sync: {
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
    syncNow: () => ipcRenderer.invoke('sync:syncNow'),
    registerDevice: (serverUrl: string, code: string, deviceName?: string) =>
      ipcRenderer.invoke('sync:registerDevice', serverUrl, code, deviceName),
    listExceptions: (status?: string) => ipcRenderer.invoke('sync:listExceptions', status),
    retryException: (id: string) => ipcRenderer.invoke('sync:retryException', id),
    dismissException: (id: string, note?: string) =>
      ipcRenderer.invoke('sync:dismissException', id, note),
    onStatusChanged: (callback: (status: SyncStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: SyncStatus) => callback(status);
      ipcRenderer.on('sync-status-changed', listener);
      return () => ipcRenderer.removeListener('sync-status-changed', listener);
    },
  },
  system: {
    getPrinters: () => ipcRenderer.invoke('system:get-printers'),
    exportDiagnostics: () => ipcRenderer.invoke('system:export-diagnostics'),
    getIntegrityStatus: () => ipcRenderer.invoke('system:get-integrity-status'),
  },
  backup: {
    create: () => ipcRenderer.invoke('backup:create'),
    list: () => ipcRenderer.invoke('backup:list'),
    restore: (filename: string, ownerPin: string) =>
      ipcRenderer.invoke('backup:restore', { filename, ownerPin }),
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    getStatus: () => ipcRenderer.invoke('updater:get-status'),
  },
};

contextBridge.exposeInMainWorld('api', api);
