import { safeStorage, app } from 'electron';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import type { TokenStore } from '../core/registration';

export class SafeStorageTokenStore implements TokenStore {
  private db: DatabaseInstance;

  constructor(db: DatabaseInstance) {
    this.db = db;
  }

  public async getToken(): Promise<string | null> {
    try {
      const row = this.db
        .prepare<[string], { value: string }>('SELECT value FROM sync_state WHERE key = ?')
        .get('token_encrypted');

      if (!row || !row.value) {
        return null;
      }

      const raw = row.value;

      // Check if fallback plaintext prefix
      if (raw.startsWith('plain:')) {
        return raw.slice(6);
      }

      // If Electron safeStorage is available, decrypt base64 buffer
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const buf = Buffer.from(raw, 'base64');
        return safeStorage.decryptString(buf);
      }

      // If running without safeStorage encryption available, treat raw as token
      return raw;
    } catch {
      return null;
    }
  }

  public async setToken(token: string): Promise<void> {
    let storedValue: string;

    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const encryptedBuffer = safeStorage.encryptString(token);
      storedValue = encryptedBuffer.toString('base64');
    } else {
      if (app && app.isPackaged) {
        console.warn(
          '[SECURITY WARNING] Electron safeStorage encryption is unavailable on this OS/session. Storing device JWT in plaintext fallback.'
        );
      }
      // In headless test or unsupported environments, store with plain prefix
      storedValue = `plain:${token}`;
    }

    this.db
      .prepare<[string, string]>(
        'INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)'
      )
      .run('token_encrypted', storedValue);
  }

  public async clearToken(): Promise<void> {
    this.db
      .prepare<[string]>('DELETE FROM sync_state WHERE key = ?')
      .run('token_encrypted');
  }
}

export function createTokenStore(db: DatabaseInstance): TokenStore {
  return new SafeStorageTokenStore(db);
}
