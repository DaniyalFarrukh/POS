import { ipcMain, BrowserWindow } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { requireRole } from '../../auth';
import { registerDevice, type TokenStore } from '../core/registration';
import { createOutboxRepo, type OutboxRepository } from '../core/outboxRepo';
import type { SyncWorker } from '../core/syncWorker';
import type { SyncExceptionStatus } from '../core/types';

export interface RegisterSyncIpcParams {
  db: DatabaseInstance;
  syncWorker: SyncWorker;
  tokenStore: TokenStore;
  outboxRepo?: OutboxRepository;
}

/**
 * Registers all Sync IPC handlers and status broadcast per docs/SYNC_CLIENT.md:
 * - getSyncStatus()
 * - syncNow()
 * - registerDevice(serverUrl, code) [Token is encrypted and NEVER sent to renderer]
 * - listSyncExceptions() [Owner/Pharmacist only]
 * - retryException(id) [Owner/Pharmacist only]
 * - dismissException(id, note) [Owner/Pharmacist only]
 * - Push event 'sync-status-changed'
 */
export function registerSyncIpc({
  db,
  syncWorker,
  tokenStore,
  outboxRepo = createOutboxRepo(db),
}: RegisterSyncIpcParams): () => void {
  // Broadcast status changes to all open renderer windows
  const onStatusChanged = (status: unknown) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('sync-status-changed', status);
      }
    }
  };

  syncWorker.on('status-changed', onStatusChanged);

  // 1. Get Status
  const handleGetStatus = async () => {
    return syncWorker.getStatus();
  };
  ipcMain.handle('sync:getStatus', handleGetStatus);
  ipcMain.handle('getSyncStatus', handleGetStatus);

  // 2. Trigger immediate sync
  const handleSyncNow = async () => {
    return syncWorker.syncNow();
  };
  ipcMain.handle('sync:syncNow', handleSyncNow);
  ipcMain.handle('syncNow', handleSyncNow);

  // 3. Register device (Owner / Pharmacist only)
  // Token is stored in safeStorage and NEVER returned to renderer
  const handleRegisterDevice = async (
    _event: Electron.IpcMainInvokeEvent,
    serverUrl: string,
    code: string,
    deviceName = 'Counter Terminal'
  ) => {
    const handler = requireRole(['owner', 'pharmacist'], async () => {
      const result = await registerDevice(
        {
          db,
          fetch: globalThis.fetch,
          tokenStore,
        },
        {
          serverUrl,
          code,
          deviceName,
        }
      );

      // Trigger immediate sync after registration
      void syncWorker.syncNow();

      return {
        success: true,
        deviceId: result.deviceId,
        pharmacyId: result.pharmacyId,
        branchId: result.branchId,
      };
    });

    return handler();
  };
  ipcMain.handle('sync:registerDevice', handleRegisterDevice);
  ipcMain.handle('registerDevice', handleRegisterDevice);

  // 4. List Sync Exceptions (Owner / Pharmacist only)
  const handleListExceptions = async (
    _event: Electron.IpcMainInvokeEvent,
    status?: SyncExceptionStatus
  ) => {
    const handler = requireRole(['owner', 'pharmacist'], async () => {
      return outboxRepo.listExceptions(status);
    });
    return handler();
  };
  ipcMain.handle('sync:listExceptions', handleListExceptions);
  ipcMain.handle('listSyncExceptions', handleListExceptions);

  // 5. Retry Exception (Owner / Pharmacist only)
  const handleRetryException = async (
    _event: Electron.IpcMainInvokeEvent,
    id: string
  ) => {
    const handler = requireRole(['owner', 'pharmacist'], async () => {
      const success = outboxRepo.retryException(id);
      if (success) {
        // Trigger a sync cycle soon to retry the recovered event
        syncWorker.triggerDebouncedSync(500);
      }
      return { success };
    });
    return handler();
  };
  ipcMain.handle('sync:retryException', handleRetryException);
  ipcMain.handle('retryException', handleRetryException);

  // 6. Dismiss Exception (Owner / Pharmacist only)
  const handleDismissException = async (
    _event: Electron.IpcMainInvokeEvent,
    id: string,
    note?: string
  ) => {
    const handler = requireRole(['owner', 'pharmacist'], async () => {
      const success = outboxRepo.dismissException(id, note);
      return { success };
    });
    return handler();
  };
  ipcMain.handle('sync:dismissException', handleDismissException);
  ipcMain.handle('dismissException', handleDismissException);

  // Cleanup function
  return () => {
    syncWorker.off('status-changed', onStatusChanged);
    ipcMain.removeHandler('sync:getStatus');
    ipcMain.removeHandler('getSyncStatus');
    ipcMain.removeHandler('sync:syncNow');
    ipcMain.removeHandler('syncNow');
    ipcMain.removeHandler('sync:registerDevice');
    ipcMain.removeHandler('registerDevice');
    ipcMain.removeHandler('sync:listExceptions');
    ipcMain.removeHandler('listSyncExceptions');
    ipcMain.removeHandler('sync:retryException');
    ipcMain.removeHandler('retryException');
    ipcMain.removeHandler('sync:dismissException');
    ipcMain.removeHandler('dismissException');
  };
}
