import type { SetupInput, LoginInput, UnlockInput, PublicUser, AuthSession } from '@pos/shared';

export interface DbMetadata {
  dbPath: string;
  schemaVersion: number;
  journalMode: string;
  foreignKeys: boolean;
  migrationsApplied: number;
}

export interface AuthApi {
  getSetupStatus: () => Promise<{ needsSetup: boolean }>;
  completeSetup: (data: SetupInput) => Promise<AuthSession>;
  getUsers: () => Promise<PublicUser[]>;
  login: (data: LoginInput) => Promise<AuthSession>;
  logout: () => Promise<void>;
  lockSession: () => Promise<void>;
  unlockSession: (data: UnlockInput) => Promise<AuthSession>;
  getSession: () => Promise<AuthSession | null>;
  testRoleAction: (
    requiredRole: 'cashier' | 'pharmacist' | 'owner'
  ) => Promise<{ success: boolean; message: string }>;
}

export interface DesktopApi {
  ping: () => Promise<string>;
  getDbInfo: () => Promise<DbMetadata>;
  auth: AuthApi;
}

declare global {
  interface Window {
    api: DesktopApi;
  }
}
