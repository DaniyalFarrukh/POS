import { contextBridge, ipcRenderer } from 'electron';
import type { DbMetadata, DesktopApi } from './index.d';

const api: DesktopApi = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  getDbInfo: (): Promise<DbMetadata> => ipcRenderer.invoke('get-db-info'),
};

contextBridge.exposeInMainWorld('api', api);
