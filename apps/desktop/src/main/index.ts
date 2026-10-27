import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { initDatabase, getDatabase, getDbMetadata, type DbMetadata } from './db';
import { createTokenStore } from './sync/adapters/tokenStore';
import { createSyncWorker, type SyncWorker } from './sync/core/syncWorker';
import { registerSyncIpc } from './sync/adapters/syncIpc';
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
  getStaffList,
  createStaffMember,
  updateStaffMember,
  type CreateStaffInput,
  type UpdateStaffInput,
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
  FinalizeSaleInput,
  InvoiceSearchParams,
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
import {
  roleGuardedCreateInvoice,
  roleGuardedGetRecentInvoices,
  roleGuardedFinalizeSale,
  roleGuardedSearchInvoices,
  roleGuardedGetInvoiceById,
} from './invoices';
import { roleGuardedProcessReturn, roleGuardedGetReturnableLines } from './returns';
import {
  roleGuardedOpenShift,
  roleGuardedCloseShift,
  roleGuardedGetCurrentShift,
  roleGuardedGetShiftHistory,
} from './shifts';
import { printReceiptHtml, type PrintReceiptOptions } from './printService';
import { seedDatabase } from './db/seed';
import {
  createDatabaseBackup,
  listDatabaseBackups,
  restoreDatabaseBackup,
  checkAndRunDailyBackup,
} from './backup';
import { logError, exportDiagnosticsZip, gatherDiagnosticsMetadata } from './logger';
import { initAutoUpdater, checkForUpdates, getUpdaterStatus } from './updater';

// Process-level unhandled exception hooks
process.on('uncaughtException', (err) => {
  logError('Process', `Uncaught Exception in Main: ${err.stack || err}`);
});

process.on('unhandledRejection', (reason) => {
  logError('Process', `Unhandled Promise Rejection in Main: ${reason}`);
});

// Explicitly set application name so userData resolves cleanly to %APPDATA%\HexaPharm (no @ or slashes)
app.setName('HexaPharm');

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
let syncWorker: SyncWorker | null = null;

function createWindow(): void {
  const appRoot = process.env.APP_ROOT || path.join(__dirname, '..');
  const iconPath = path.join(appRoot, 'src/renderer/assets/hexalogic-icon.png');
  win = new BrowserWindow({
    title: 'HexaPharm Terminal',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
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
    console.log('[WebContents] did-finish-load successfully from URL:', win?.webContents.getURL());
  });

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer Console level=${level}] ${message} (${sourceId}:${line})`);
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

  ipcMain.handle('auth:get-staff-list', async () => {
    return getStaffList();
  });

  ipcMain.handle('auth:create-staff-member', async (_event, input: CreateStaffInput) => {
    return createStaffMember(input);
  });

  ipcMain.handle('auth:update-staff-member', async (_event, id: string, input: UpdateStaffInput) => {
    return updateStaffMember(id, input);
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

  ipcMain.handle(
    'products:search-pos-catalog',
    async (_event, query: string, branchId?: string) => {
      return searchPosCatalog(query, branchId);
    }
  );

  ipcMain.handle(
    'products:get-substitutes',
    async (_event, genericName: string, excludeProductId?: string, branchId?: string) => {
      return getSubstitutes(genericName, excludeProductId, branchId);
    }
  );

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

  ipcMain.handle(
    'purchasing:update-supplier',
    async (_event, id: string, input: UpdateSupplierInput) => {
      return roleGuardedUpdateSupplier(id, input);
    }
  );

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

  // Invoice & Sales Handlers
  ipcMain.handle('sales:finalize', async (_event, input: FinalizeSaleInput) => {
    const result = await roleGuardedFinalizeSale(input);
    if (syncWorker) {
      syncWorker.triggerDebouncedSync(2000);
    }
    return result;
  });

  ipcMain.handle('invoices:create', async (_event, input: CreateInvoiceInput) => {
    const result = await roleGuardedCreateInvoice(input);
    if (syncWorker) {
      syncWorker.triggerDebouncedSync(2000);
    }
    return result;
  });

  ipcMain.handle('invoices:get-recent', async (_event, limit?: number) => {
    return roleGuardedGetRecentInvoices(limit);
  });

  ipcMain.handle('invoices:search', async (_event, params?: InvoiceSearchParams) => {
    return roleGuardedSearchInvoices(params);
  });

  ipcMain.handle('invoices:get-one', async (_event, invoiceId: string) => {
    return roleGuardedGetInvoiceById(invoiceId);
  });

  ipcMain.handle(
    'invoices:print-receipt',
    async (_event, htmlContent: string, options?: PrintReceiptOptions) => {
      return printReceiptHtml(htmlContent, options);
    }
  );

  // Returns & Credit Notes Handlers
  ipcMain.handle('returns:get-returnable', async (_event, invoiceId: string) => {
    return roleGuardedGetReturnableLines(invoiceId);
  });

  ipcMain.handle('returns:process', async (_event, input) => {
    return roleGuardedProcessReturn(input);
  });

  // Shifts & Day-End Handlers
  ipcMain.handle('shifts:get-current', async (_event, counterId?: string) => {
    return roleGuardedGetCurrentShift(counterId);
  });

  ipcMain.handle('shifts:open', async (_event, input) => {
    return roleGuardedOpenShift(input);
  });

  ipcMain.handle('shifts:close', async (_event, input) => {
    return roleGuardedCloseShift(input);
  });

  ipcMain.handle('shifts:get-history', async (_event, options) => {
    return roleGuardedGetShiftHistory(options);
  });

  // -------------------------------------------------------------------------
  // System, Diagnostics, and Hardware Handlers (Phase 5)
  // -------------------------------------------------------------------------
  ipcMain.handle('system:get-printers', async () => {
    if (win && win.webContents) {
      try {
        const printers = await win.webContents.getPrintersAsync();
        return printers.map((p) => ({
          name: p.name,
          displayName: p.displayName || p.name,
          isDefault: Boolean((p as { isDefault?: boolean }).isDefault),
        }));
      } catch (err) {
        logError('System', `Failed to retrieve system printers: ${err}`);
      }
    }
    return [];
  });

  ipcMain.handle('system:export-diagnostics', async () => {
    return exportDiagnosticsZip();
  });

  ipcMain.handle('system:get-integrity-status', async () => {
    const meta = gatherDiagnosticsMetadata();
    return {
      ok: meta.database.integrityCheck === 'ok',
      message: meta.database.integrityCheck,
      dbPath: meta.database.dbPath,
    };
  });

  // -------------------------------------------------------------------------
  // Database Backup & Restore Handlers (Phase 5)
  // -------------------------------------------------------------------------
  ipcMain.handle('backup:create', async () => {
    return createDatabaseBackup();
  });

  ipcMain.handle('backup:list', async () => {
    return listDatabaseBackups();
  });

  ipcMain.handle('backup:restore', async (_event, filename: string) => {
    const session = getSession();
    if (!session || session.user.role !== 'owner') {
      throw new Error('Unauthorized: Only an Owner can restore database backups.');
    }

    return restoreDatabaseBackup(filename, session.user.role, {
      onBeforeRestore: () => {
        if (syncWorker) syncWorker.stop();
      },
    });
  });

  // -------------------------------------------------------------------------
  // Auto-Updater Handlers (Phase 5)
  // -------------------------------------------------------------------------
  ipcMain.handle('updater:check', async () => {
    return checkForUpdates();
  });

  ipcMain.handle('updater:get-status', async () => {
    return getUpdaterStatus();
  });

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  const devUrl =
    process.env['VITE_DEV_SERVER_URL'] || (isDev ? 'http://localhost:5173' : undefined);

  console.log('[Main] isDev:', isDev, '| devUrl:', devUrl);
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
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

    const db = getDatabase();
    const tokenStore = createTokenStore(db);
    syncWorker = createSyncWorker({
      db,
      fetch: globalThis.fetch,
      tokenStore,
      logger: console,
    });
    registerSyncIpc({ db, syncWorker, tokenStore });
    syncWorker.start();

    // Automated daily backup check (Rule of 14)
    checkAndRunDailyBackup().catch((err) => {
      logError('Backup', `Automated daily backup check failed: ${err}`);
    });
  } catch (err) {
    console.error('[Main] Failed to initialize SQLite database on launch:', err);
  }
  createWindow();
  if (win) {
    initAutoUpdater(win);
  }
});

app.on('before-quit', () => {
  if (syncWorker) {
    syncWorker.stop();
  }
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
