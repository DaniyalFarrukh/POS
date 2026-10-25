export interface DbMetadata {
  dbPath: string;
  schemaVersion: number;
  journalMode: string;
  foreignKeys: boolean;
  migrationsApplied: number;
}

export interface DesktopApi {
  ping: () => Promise<string>;
  getDbInfo: () => Promise<DbMetadata>;
}

declare global {
  interface Window {
    api: DesktopApi;
  }
}
