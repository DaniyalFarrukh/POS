import { BrowserWindow } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { registerSecureIpcHandler, removeSecureIpcHandler } from '../../ipc/wrapper';
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
 * - sync:getStatus()
 * - sync:syncNow()
 * - sync:registerDevice(serverUrl, code, deviceName, confirmReRegistration) [Owner only; requires confirmation if already registered]
 * - sync:listExceptions() [Owner/Pharmacist only]
 * - sync:retryException(id) [Owner/Pharmacist only]
 * - sync:dismissException(id, note) [Owner/Pharmacist only]
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
  registerSecureIpcHandler({
    channel: 'sync:getStatus',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async () => {
      return syncWorker.getStatus();
    },
  });

  // 2. Trigger immediate sync
  registerSecureIpcHandler({
    channel: 'sync:syncNow',
    roles: ['cashier', 'pharmacist', 'owner'],
    handler: async () => {
      return syncWorker.syncNow();
    },
  });

  // 3. Register device (Owner only)
  // Token is stored in safeStorage and NEVER returned to renderer
  registerSecureIpcHandler({
    channel: 'sync:registerDevice',
    roles: ['owner'],
    handler: async (
      _ctx,
      serverUrlOrPayload: string | { serverUrl: string; code: string; deviceName?: string; confirmReRegistration?: boolean },
      codeArg?: string,
      deviceNameArg?: string,
      confirmArg?: boolean
    ) => {
      let serverUrl: string;
      let code: string;
      let deviceName = 'Counter Terminal';
      let confirmReRegistration = false;

      if (typeof serverUrlOrPayload === 'object' && serverUrlOrPayload !== null) {
        serverUrl = serverUrlOrPayload.serverUrl;
        code = serverUrlOrPayload.code;
        if (serverUrlOrPayload.deviceName) deviceName = serverUrlOrPayload.deviceName;
        if (serverUrlOrPayload.confirmReRegistration) confirmReRegistration = serverUrlOrPayload.confirmReRegistration;
      } else {
        serverUrl = serverUrlOrPayload;
        code = codeArg || '';
        if (deviceNameArg) deviceName = deviceNameArg;
        if (confirmArg) confirmReRegistration = confirmArg;
      }

      // Check if already registered
      const existingToken = await tokenStore.getToken();
      const existingDevice = db
        .prepare("SELECT value FROM app_meta WHERE key = 'device_id'")
        .get() as { value: string } | undefined;

      if ((existingToken || existingDevice) && !confirmReRegistration) {
        throw new Error('Device is already registered. Confirmation required to re-register.');
      }

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
    },
  });

  // 4. List Sync Exceptions (Owner / Pharmacist only)
  registerSecureIpcHandler({
    channel: 'sync:listExceptions',
    roles: ['owner', 'pharmacist'],
    handler: async (_ctx, status?: SyncExceptionStatus) => {
      return outboxRepo.listExceptions(status);
    },
  });

  // 5. Retry Exception (Owner / Pharmacist only)
  registerSecureIpcHandler({
    channel: 'sync:retryException',
    roles: ['owner', 'pharmacist'],
    handler: async (_ctx, idArg: string | { id: string }) => {
      const id = typeof idArg === 'object' && idArg !== null ? idArg.id : idArg;
      const success = outboxRepo.retryException(id);
      if (success) {
        syncWorker.triggerDebouncedSync(500);
      }
      return { success };
    },
  });

  // 6. Dismiss Exception (Owner / Pharmacist only)
  registerSecureIpcHandler({
    channel: 'sync:dismissException',
    roles: ['owner', 'pharmacist'],
    handler: async (
      _ctx,
      idOrPayload: string | { id: string; note?: string },
      noteArg?: string
    ) => {
      let id: string;
      let note: string | undefined;
      if (typeof idOrPayload === 'object' && idOrPayload !== null) {
        id = idOrPayload.id;
        note = idOrPayload.note;
      } else {
        id = idOrPayload;
        note = noteArg;
      }
      const success = outboxRepo.dismissException(id, note);
      return { success };
    },
  });

  // Cleanup function
  return () => {
    syncWorker.off('status-changed', onStatusChanged);
    removeSecureIpcHandler('sync:getStatus');
    removeSecureIpcHandler('sync:syncNow');
    removeSecureIpcHandler('sync:registerDevice');
    removeSecureIpcHandler('sync:listExceptions');
    removeSecureIpcHandler('sync:retryException');
    removeSecureIpcHandler('sync:dismissException');
  };
}
