import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { initDatabase, getDatabase, getDbMetadata, type DbMetadata } from './db';
import { createTokenStore } from './sync/adapters/tokenStore';
import { createSyncWorker, type SyncWorker } from './sync/core/syncWorker';
import { registerSyncIpc } from './sync/adapters/syncIpc';
import { registerSecureIpcHandler } from './ipc/wrapper';
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
  deactivateSupplier,
  roleGuardedReceiveGrn,
  getStockOverviewByProduct,
  getStockOverviewByBatch,
  roleGuardedAdjustStock,
  getBatchesForProduct,
} from './purchasing';
import {
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
if (app && typeof app.setName === 'function') {
  app.setName('HexaPharm');
}

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

export function registerAllIpcHandlers(): void {
  // Round-trip diagnostic ping
  registerSecureIpcHandler({
    channel: 'ping',
    isPublic: true,
    publicReason: 'Diagnostic roundtrip ping for IPC connectivity check',
    handler: async () => 'pong',
  });

  // DB Metadata
  registerSecureIpcHandler({
    channel: 'get-db-info',
    isPublic: true,
    publicReason: 'Database diagnostic info and schema version inspection',
    handler: async (): Promise<DbMetadata> => getDbMetadata(),
  });

  // Local Authentication Handlers
  registerSecureIpcHandler({
    channel: 'auth:get-setup-status',
    isPublic: true,
    publicReason: 'Setup wizard status check before any user or owner exists',
    handler: async () => getSetupStatus(),
  });

  registerSecureIpcHandler({
    channel: 'auth:complete-setup',
    isPublic: true,
    publicReason: 'Initial setup wizard establishes initial branch, counter, and owner credentials',
    handler: async (_ctx, data: SetupInput) => completeSetup(data),
  });

  registerSecureIpcHandler({
    channel: 'auth:get-users',
    isPublic: true,
    publicReason: 'Lists active users for PIN login dropdown before user is authenticated',
    handler: async () => getUsers(),
  });

  registerSecureIpcHandler({
    channel: 'auth:login',
    isPublic: true,
    publicReason: 'Accepts user ID and PIN to authenticate session',
    handler: async (_ctx, data: LoginInput) => login(data.userId, data.pin),
  });

  registerSecureIpcHandler({
    channel: 'auth:logout',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async () => {
      logout();
    },
  });

  registerSecureIpcHandler({
    channel: 'auth:lock-session',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async () => {
      lockSession();
    },
  });

  registerSecureIpcHandler({
    channel: 'auth:unlock-session',
    isPublic: true,
    publicReason: 'Accepts PIN to unlock terminal without destroying active session',
    handler: async (_ctx, data: UnlockInput) => unlockSession(data.pin),
  });

  registerSecureIpcHandler({
    channel: 'auth:get-session',
    isPublic: true,
    publicReason: 'Returns current active session or null to allow UI to render login or workspace',
    handler: async () => getSession(),
  });

  // Staff Management (Owner-only)
  registerSecureIpcHandler({
    channel: 'auth:get-staff-list',
    roles: ['owner'],
    handler: async () => getStaffList(),
  });

  registerSecureIpcHandler({
    channel: 'auth:create-staff-member',
    roles: ['owner'],
    handler: async (_ctx, input: CreateStaffInput) => createStaffMember(input),
  });

  registerSecureIpcHandler({
    channel: 'auth:update-staff-member',
    roles: ['owner'],
    handler: async (_ctx, id: string, input: UpdateStaffInput) => updateStaffMember(id, input),
  });

  // Non-packaged Dev / Test Handlers
  if (!app?.isPackaged) {
    registerSecureIpcHandler({
      channel: 'auth:test-role-action',
      roles: ['cashier', 'pharmacist', 'owner'],
      handler: async (_ctx, requiredRole: UserRole) => {
        let allowed: UserRole[] = [];
        if (requiredRole === 'cashier') allowed = ['cashier', 'pharmacist', 'owner'];
        else if (requiredRole === 'pharmacist') allowed = ['pharmacist', 'owner'];
        else allowed = ['owner'];

        const h = requireRole(allowed, (s) => ({
          success: true,
          message: `Action permitted: ${s.user.name} (${s.user.role}) has access to '${requiredRole}' action.`,
        }));
        return h();
      },
    });

    registerSecureIpcHandler({
      channel: 'products:seed',
      roles: ['owner'],
      handler: async () => seedDatabase(),
    });
  }

  // Products & Inventory Handlers
  registerSecureIpcHandler({
    channel: 'products:get-all',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, params: ProductSearchParams) => getProducts(params),
  });

  registerSecureIpcHandler({
    channel: 'products:get-one',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, id: string) => getProduct(id),
  });

  registerSecureIpcHandler({
    channel: 'products:create',
    roles: ['pharmacist', 'owner'],
    handler: async (_ctx, input: CreateProductInput) => roleGuardedCreateProduct(input),
  });

  registerSecureIpcHandler({
    channel: 'products:update',
    roles: ['pharmacist', 'owner'],
    handler: async (_ctx, id: string, input: UpdateProductInput) => roleGuardedUpdateProduct(id, input),
  });

  registerSecureIpcHandler({
    channel: 'products:get-tax-categories',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async () => getTaxCategories(),
  });

  registerSecureIpcHandler({
    channel: 'products:import-csv',
    roles: ['pharmacist', 'owner'],
    handler: async (_ctx, rows: CreateProductInput[]) => roleGuardedImportCsv(rows),
  });

  registerSecureIpcHandler({
    channel: 'products:search-pos-catalog',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, query: string, branchId?: string) => searchPosCatalog(query, branchId),
  });

  registerSecureIpcHandler({
    channel: 'products:get-substitutes',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, genericName: string, excludeProductId?: string, branchId?: string) =>
      getSubstitutes(genericName, excludeProductId, branchId),
  });

  // Purchasing & Suppliers Handlers
  registerSecureIpcHandler({
    channel: 'purchasing:get-suppliers',
    roles: ['pharmacist', 'owner'],
    handler: async () => getSuppliers(),
  });

  registerSecureIpcHandler({
    channel: 'purchasing:get-supplier',
    roles: ['pharmacist', 'owner'],
    handler: async (_ctx, id: string) => getSupplier(id),
  });

  registerSecureIpcHandler({
    channel: 'purchasing:create-supplier',
    roles: ['pharmacist', 'owner'],
    handler: async (_ctx, input: CreateSupplierInput) => roleGuardedCreateSupplier(input),
  });

  registerSecureIpcHandler({
    channel: 'purchasing:update-supplier',
    roles: ['pharmacist', 'owner'],
    handler: async (_ctx, id: string, input: UpdateSupplierInput) =>
      roleGuardedUpdateSupplier(id, input),
  });

  registerSecureIpcHandler({
    channel: 'purchasing:delete-supplier',
    roles: ['pharmacist', 'owner'],
    handler: async (_ctx, id: string) => deactivateSupplier(id),
  });

  registerSecureIpcHandler({
    channel: 'purchasing:receive-grn',
    roles: ['pharmacist', 'owner'],
    handler: async (_ctx, input: ReceiveGrnInput) => roleGuardedReceiveGrn(input),
  });

  // Stock Overview & Adjustment Handlers
  registerSecureIpcHandler({
    channel: 'stock:get-overview-products',
    roles: ['pharmacist', 'owner'],
    handler: async (_ctx, params: StockFilterParams) => getStockOverviewByProduct(params),
  });

  registerSecureIpcHandler({
    channel: 'stock:get-overview-batches',
    roles: ['pharmacist', 'owner'],
    handler: async (_ctx, params: StockFilterParams) => getStockOverviewByBatch(params),
  });

  registerSecureIpcHandler({
    channel: 'stock:adjust',
    roles: ['pharmacist', 'owner'],
    handler: async (_ctx, input: StockAdjustmentInput) => roleGuardedAdjustStock(input),
  });

  registerSecureIpcHandler({
    channel: 'stock:get-batches-for-product',
    roles: ['pharmacist', 'owner'],
    handler: async (_ctx, productId: string) => getBatchesForProduct(productId),
  });

  // Invoice & Sales Handlers
  registerSecureIpcHandler({
    channel: 'sales:finalize',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, input: FinalizeSaleInput) => {
      const result = await roleGuardedFinalizeSale(input);
      if (syncWorker) {
        syncWorker.triggerDebouncedSync(2000);
      }
      return result;
    },
  });

  registerSecureIpcHandler({
    channel: 'invoices:get-recent',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, limit?: number) => roleGuardedGetRecentInvoices(limit),
  });

  registerSecureIpcHandler({
    channel: 'invoices:search',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, params?: InvoiceSearchParams) => roleGuardedSearchInvoices(params),
  });

  registerSecureIpcHandler({
    channel: 'invoices:get-one',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, invoiceId: string) => roleGuardedGetInvoiceById(invoiceId),
  });

  registerSecureIpcHandler({
    channel: 'invoices:print-receipt',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, htmlContent: string, options?: PrintReceiptOptions) =>
      printReceiptHtml(htmlContent, options),
  });

  // Returns & Credit Notes Handlers
  registerSecureIpcHandler({
    channel: 'returns:get-returnable',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, invoiceId: string) => roleGuardedGetReturnableLines(invoiceId),
  });

  registerSecureIpcHandler({
    channel: 'returns:process',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, input) => roleGuardedProcessReturn(input),
  });

  // Shifts & Day-End Handlers
  registerSecureIpcHandler({
    channel: 'shifts:get-current',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, counterId?: string) => roleGuardedGetCurrentShift(counterId),
  });

  registerSecureIpcHandler({
    channel: 'shifts:open',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, input) => roleGuardedOpenShift(input),
  });

  registerSecureIpcHandler({
    channel: 'shifts:close',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, input) => roleGuardedCloseShift(input),
  });

  registerSecureIpcHandler({
    channel: 'shifts:get-history',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async (_ctx, options) => roleGuardedGetShiftHistory(options),
  });

  // System, Diagnostics, and Hardware Handlers
  registerSecureIpcHandler({
    channel: 'system:get-printers',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async () => {
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
    },
  });

  registerSecureIpcHandler({
    channel: 'system:export-diagnostics',
    roles: ['owner'],
    handler: async () => exportDiagnosticsZip(),
  });

  registerSecureIpcHandler({
    channel: 'system:get-integrity-status',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async () => {
      const meta = gatherDiagnosticsMetadata();
      return {
        ok: meta.database.integrityCheck === 'ok',
        message: meta.database.integrityCheck,
        dbPath: meta.database.dbPath,
      };
    },
  });

  // Database Backup & Restore Handlers (Destructive: requires Owner PIN)
  registerSecureIpcHandler({
    channel: 'backup:create',
    roles: ['owner'],
    handler: async () => createDatabaseBackup(),
  });

  registerSecureIpcHandler({
    channel: 'backup:list',
    roles: ['owner'],
    handler: async () => listDatabaseBackups(),
  });

  registerSecureIpcHandler({
    channel: 'backup:restore',
    roles: ['owner'],
    isDestructive: true,
    handler: async (
      _ctx,
      payloadOrFilename: string | { filename: string; ownerPin: string }
    ) => {
      const filename =
        typeof payloadOrFilename === 'object' && payloadOrFilename !== null
          ? payloadOrFilename.filename
          : payloadOrFilename;

      return restoreDatabaseBackup(filename, 'owner', {
        onBeforeRestore: () => {
          if (syncWorker) syncWorker.stop();
        },
      });
    },
  });

  // Auto-Updater Handlers
  registerSecureIpcHandler({
    channel: 'updater:check',
    roles: ['owner'],
    handler: async () => checkForUpdates(),
  });

  registerSecureIpcHandler({
    channel: 'updater:get-status',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async () => getUpdaterStatus(),
  });
}

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

if (app && typeof app.whenReady === 'function') {
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
      registerAllIpcHandlers();
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
}
