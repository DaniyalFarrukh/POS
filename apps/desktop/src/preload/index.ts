import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from './index.d';
import type { SetupInput, LoginInput, UnlockInput, PublicUser, AuthSession } from '@pos/shared';

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
};

contextBridge.exposeInMainWorld('api', api);
