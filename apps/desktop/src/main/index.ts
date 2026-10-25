import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { initDatabase, getDbMetadata, type DbMetadata } from './db';
import {
  getSetupStatus,
  completeSetup,
  getUsers,
  login,
  logout,
  lockSession,
  unlockSession,
  getSession,
  requireRole,
} from './auth';
import type {
  SetupInput,
  LoginInput,
  UnlockInput,
  UserRole,
  CreateProductInput,
  UpdateProductInput,
  ProductSearchParams,
  CreateSupplierInput,
  UpdateSupplierInput,
  ReceiveGrnInput,
  StockAdjustmentInput,
  StockFilterParams,
  CreateInvoiceInput,
} from '@pos/shared';
import {
  getProducts,
  getProduct,
  getTaxCategories,
  roleGuardedCreateProduct,
  roleGuardedUpdateProduct,
  roleGuardedImportCsv,
  searchPosCatalog,
  getSubstitutes,
} from './products';
import {
  getSuppliers,
  getSupplier,
  roleGuardedCreateSupplier,
  roleGuardedUpdateSupplier,
  roleGuardedDeleteSupplier,
  roleGuardedReceiveGrn,
  getStockOverviewByProduct,
  getStockOverviewByBatch,
  roleGuardedAdjustStock,
  getBatchesForProduct,
} from './purchasing';
import { roleGuardedCreateInvoice, roleGuardedGetRecentInvoices } from './invoices';
import { seedDatabase } from './db/seed';

// Explicitly set application name so userData resolves cleanly to %APPDATA%\POS Counter (no @ or slashes)
app.setName('POS Counter');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '..');

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

function resolvePreloadPath(): string {
  const candidates = [
    path.join(__dirname, 'preload.cjs'),
    path.join(__dirname, 'index.cjs'),
    path.join(__dirname, 'index.mjs'),
    path.join(__dirname, 'preload.mjs'),
    path.join(__dirname, 'index.js'),
    path.join(__dirname, 'preload.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(__dirname, 'preload.cjs');
}

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    title: 'POS Counter Terminal',
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 600,
    center: true,
    show: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: resolvePreloadPath(),
    },
  });

  win.once('ready-to-show', () => {
    if (win) {
      console.log('[Window] ready-to-show fired');
      win.show();
      win.focus();
      win.setAlwaysOnTop(true);
      setTimeout(() => {
        if (win && !win.isDestroyed()) {
          win.setAlwaysOnTop(false);
        }
      }, 1000);
    }
  });

  win.webContents.on('did-finish-load', () => {
    console.log('[WebContents] did-finish-load successfully');
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[WebContents] did-fail-load:', errorCode, errorDescription);
  });

  // Handle round-trip IPC ping
  ipcMain.handle('ping', async (): Promise<string> => {
    console.log('[IPC] ping called -> returning pong');
    return 'pong';
  });

  // Handle DB info query
  ipcMain.handle('get-db-info', async (): Promise<DbMetadata> => {
    const meta = getDbMetadata();
    console.log('[IPC] get-db-info called -> returning:', JSON.stringify(meta));
    return meta;
  });

  // Local Authentication Handlers
  ipcMain.handle('auth:get-setup-status', async () => {
    return getSetupStatus();
  });

  ipcMain.handle('auth:complete-setup', async (_event, data: SetupInput) => {
    return completeSetup(data);
  });

  ipcMain.handle('auth:get-users', async () => {
    return getUsers();
  });

  ipcMain.handle('auth:login', async (_event, data: LoginInput) => {
    return login(data.userId, data.pin);
  });

  ipcMain.handle('auth:logout', async () => {
    logout();
  });

  ipcMain.handle('auth:lock-session', async () => {
    lockSession();
  });

  ipcMain.handle('auth:unlock-session', async (_event, data: UnlockInput) => {
    return unlockSession(data.pin);
  });

  ipcMain.handle('auth:get-session', async () => {
    return getSession();
  });

  ipcMain.handle('auth:test-role-action', async (_event, requiredRole: UserRole) => {
    let allowed: UserRole[] = [];
    if (requiredRole === 'cashier') allowed = ['cashier', 'pharmacist', 'owner'];
    else if (requiredRole === 'pharmacist') allowed = ['pharmacist', 'owner'];
    else allowed = ['owner'];

    const handler = requireRole(allowed, (session) => {
      return {
        success: true,
        message: `Action permitted: ${session.user.name} (${session.user.role}) has access to '${requiredRole}' action.`,
      };
    });

    return handler();
  });

  // Product & Inventory Handlers
  ipcMain.handle('products:get-all', async (_event, params: ProductSearchParams) => {
    return getProducts(params);
  });

  ipcMain.handle('products:get-one', async (_event, id: string) => {
    return getProduct(id);
  });

  ipcMain.handle('products:create', async (_event, input: CreateProductInput) => {
    return roleGuardedCreateProduct(input);
  });

  ipcMain.handle('products:update', async (_event, id: string, input: UpdateProductInput) => {
    return roleGuardedUpdateProduct(id, input);
  });

  ipcMain.handle('products:get-tax-categories', async () => {
    return getTaxCategories();
  });

  ipcMain.handle('products:import-csv', async (_event, rows: CreateProductInput[]) => {
    return roleGuardedImportCsv(rows);
  });

  ipcMain.handle('products:seed', async () => {
    return seedDatabase();
  });

  ipcMain.handle('products:search-pos-catalog', async (_event, query: string, branchId?: string) => {
    return searchPosCatalog(query, branchId);
  });

  ipcMain.handle('products:get-substitutes', async (_event, genericName: string, excludeProductId?: string, branchId?: string) => {
    return getSubstitutes(genericName, excludeProductId, branchId);
  });

  // Purchasing & Suppliers Handlers
  ipcMain.handle('purchasing:get-suppliers', async () => {
    return getSuppliers();
  });

  ipcMain.handle('purchasing:get-supplier', async (_event, id: string) => {
    return getSupplier(id);
  });

  ipcMain.handle('purchasing:create-supplier', async (_event, input: CreateSupplierInput) => {
    return roleGuardedCreateSupplier(input);
  });

  ipcMain.handle('purchasing:update-supplier', async (_event, id: string, input: UpdateSupplierInput) => {
    return roleGuardedUpdateSupplier(id, input);
  });

  ipcMain.handle('purchasing:delete-supplier', async (_event, id: string) => {
    return roleGuardedDeleteSupplier(id);
  });

  ipcMain.handle('purchasing:receive-grn', async (_event, input: ReceiveGrnInput) => {
    return roleGuardedReceiveGrn(input);
  });

  // Stock Overview & Adjustment Handlers
  ipcMain.handle('stock:get-overview-products', async (_event, params: StockFilterParams) => {
    return getStockOverviewByProduct(params);
  });

  ipcMain.handle('stock:get-overview-batches', async (_event, params: StockFilterParams) => {
    return getStockOverviewByBatch(params);
  });

  ipcMain.handle('stock:adjust', async (_event, input: StockAdjustmentInput) => {
    return roleGuardedAdjustStock(input);
  });

  ipcMain.handle('stock:get-batches-for-product', async (_event, productId: string) => {
    return getBatchesForProduct(productId);
  });

  // Invoice Handlers
  ipcMain.handle('invoices:create', async (_event, input: CreateInvoiceInput) => {
    return roleGuardedCreateInvoice(input);
  });

  ipcMain.handle('invoices:get-recent', async (_event, limit?: number) => {
    return roleGuardedGetRecentInvoices(limit);
  });

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  const devUrl =
    process.env['VITE_DEV_SERVER_URL'] || (isDev ? 'http://localhost:5173' : undefined);

  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  try {
    initDatabase();
    // Seed initial tax categories and 200 pharmacy products for development
    seedDatabase();
  } catch (err) {
    console.error('[Main] Failed to initialize SQLite database on launch:', err);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
