import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { getDatabase, getDbPath, closeDatabase, initDatabase } from './db';

export interface BackupInfo {
  filename: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string; // ISO string
  isPreRestore?: boolean;
}

export interface RestoreResult {
  success: boolean;
  message: string;
  safetyBackupFile?: string;
}

/**
 * Returns the default directory for database backups.
 * Located at %APPDATA%/HexaPharm/backups
 */
export function getBackupDirectory(customDir?: string): string {
  if (customDir) return customDir;

  let baseDir: string;
  if (app && typeof app.getPath === 'function') {
    baseDir = app.getPath('userData');
  } else if (process.env.APPDATA) {
    baseDir = path.join(process.env.APPDATA, 'HexaPharm');
  } else {
    baseDir = path.join(process.cwd(), 'backups');
  }

  const backupDir = path.join(baseDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  return backupDir;
}

/**
 * Formats a Date object to a safe timestamp string for filenames: YYYY-MM-DD-HHmmss
 */
function getTimestampString(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${y}-${m}-${d}-${hh}${mm}${ss}`;
}

/**
 * Enforces the retention policy: keeps only the LAST 14 regular backups.
 * Removes older backups exceeding 14.
 */
export function enforceBackupRetention(backupDir: string, maxBackups = 14): void {
  if (!fs.existsSync(backupDir)) return;

  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.endsWith('.db') && !f.startsWith('pre-restore-safety'))
    .map((f) => {
      const fullPath = path.join(backupDir, f);
      const stat = fs.statSync(fullPath);
      return { filename: f, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs); // Oldest first

  if (files.length > maxBackups) {
    const toRemove = files.slice(0, files.length - maxBackups);
    for (const item of toRemove) {
      try {
        fs.unlinkSync(item.fullPath);
        console.log(
          `[Backup] Removed expired backup to retain last ${maxBackups}: ${item.filename}`
        );
      } catch (err) {
        console.warn(`[Backup] Failed to remove expired backup: ${item.filename}`, err);
      }
    }
  }
}

/**
 * Safe local database backup using better-sqlite3 native online backup API.
 * This runs safe transactional page copies while WAL is active and accepts writes.
 */
export async function createDatabaseBackup(
  options: {
    db?: DatabaseInstance;
    backupDir?: string;
    isPreRestore?: boolean;
  } = {}
): Promise<BackupInfo> {
  const db = options.db ?? getDatabase();
  const backupDir = getBackupDirectory(options.backupDir);
  const timestamp = getTimestampString();

  const filename = options.isPreRestore
    ? `pre-restore-safety-${timestamp}.db`
    : `backup-${timestamp}.db`;

  const destPath = path.join(backupDir, filename);

  // Execute native better-sqlite3 online backup API
  await db.backup(destPath);

  const stats = fs.statSync(destPath);
  const info: BackupInfo = {
    filename,
    filePath: destPath,
    sizeBytes: stats.size,
    createdAt: new Date().toISOString(),
    isPreRestore: options.isPreRestore,
  };

  // Enforce retention limit (14 backups)
  if (!options.isPreRestore) {
    enforceBackupRetention(backupDir, 14);
  }

  console.log(
    `[Backup] Safe SQLite backup created successfully: ${destPath} (${stats.size} bytes)`
  );
  return info;
}

/**
 * Lists all available database backups sorted by creation date descending (newest first).
 */
export function listDatabaseBackups(customDir?: string): BackupInfo[] {
  const backupDir = getBackupDirectory(customDir);
  if (!fs.existsSync(backupDir)) return [];

  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const fullPath = path.join(backupDir, f);
      const stat = fs.statSync(fullPath);
      return {
        filename: f,
        filePath: fullPath,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        isPreRestore: f.startsWith('pre-restore-safety'),
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return files;
}

/**
 * Checks if a daily backup is needed and triggers it in the background if the newest backup > 24 hours old.
 */
export async function checkAndRunDailyBackup(
  options: {
    db?: DatabaseInstance;
    backupDir?: string;
    customDir?: string;
  } = {}
): Promise<BackupInfo | null> {
  const dir = options.backupDir || options.customDir;
  const backups = listDatabaseBackups(dir).filter((b) => !b.isPreRestore);
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  if (backups.length > 0 && backups[0]) {
    const latestTime = new Date(backups[0].createdAt).getTime();
    if (now - latestTime < ONE_DAY_MS) {
      // Recent backup exists, no action required
      return null;
    }
  }

  console.log('[Backup] No backup in the last 24h. Initiating automated daily backup...');
  return createDatabaseBackup({
    db: options.db,
    backupDir: dir,
  });
}

/**
 * Restores a selected backup file over the active SQLite database.
 * RESTRICTED TO OWNER ROLE ONLY.
 * Includes a safety pre-restore backup of the current database before replacement.
 */
export async function restoreDatabaseBackup(
  backupFilename: string,
  userRole: string,
  options: {
    customDir?: string;
    targetDbPath?: string;
    onBeforeRestore?: () => void;
    shouldRelaunch?: boolean;
  } = {}
): Promise<RestoreResult> {
  if (userRole !== 'owner') {
    throw new Error('Unauthorized: Database restore is strictly restricted to the Owner role.');
  }

  const backupDir = getBackupDirectory(options.customDir);
  const backupFilePath = path.join(backupDir, path.basename(backupFilename));

  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file '${backupFilename}' does not exist.`);
  }

  const targetDbPath = options.targetDbPath ?? getDbPath();

  console.log(`[Backup] Initiating safe database restore from: ${backupFilePath}`);

  // (b) Restore into temporary file
  const tempDbPath = `${targetDbPath}.restore-tmp`;
  if (fs.existsSync(tempDbPath)) {
    try {
      fs.unlinkSync(tempDbPath);
    } catch {
      // Ignore
    }
  }
  fs.copyFileSync(backupFilePath, tempDbPath);

  // (c) Execute PRAGMA integrity_check on temporary file
  let tempDb: DatabaseInstance | null = null;
  try {
    tempDb = new Database(tempDbPath, { readonly: true, fileMustExist: true });
    const checkResult = tempDb.pragma('integrity_check', { simple: true }) as string;
    if (checkResult !== 'ok') {
      throw new Error(`Restored database failed integrity check: ${checkResult}`);
    }
  } finally {
    if (tempDb) {
      tempDb.close();
    }
  }

  // (a) Create automated safety backup of current active DB
  let safetyBackupFile: string | undefined;
  if (fs.existsSync(targetDbPath)) {
    try {
      const safety = await createDatabaseBackup({
        backupDir,
        isPreRestore: true,
      });
      safetyBackupFile = safety.filename;
      console.log(`[Backup] Pre-restore safety snapshot created: ${safety.filePath}`);
    } catch (safetyErr) {
      console.warn('[Backup] Could not create pre-restore safety snapshot:', safetyErr);
    }
  }

  if (options.onBeforeRestore) {
    options.onBeforeRestore();
  }

  // Close active database connection to release WAL and lock handles
  closeDatabase();

  // Remove existing WAL and SHM journal files if present
  const walPath = `${targetDbPath}-wal`;
  const shmPath = `${targetDbPath}-shm`;
  if (fs.existsSync(walPath)) {
    try {
      fs.unlinkSync(walPath);
    } catch {
      // Ignore if wal already removed
    }
  }
  if (fs.existsSync(shmPath)) {
    try {
      fs.unlinkSync(shmPath);
    } catch {
      // Ignore if shm already removed
    }
  }

  // (d) Swap file
  fs.copyFileSync(tempDbPath, targetDbPath);
  try {
    fs.unlinkSync(tempDbPath);
  } catch {
    // Ignore
  }

  // Re-open active database
  initDatabase(targetDbPath);
  console.log(`[Backup] Database restored and verified successfully from '${backupFilename}'`);

  // (e) Restart app if requested and in app environment
  if (
    options.shouldRelaunch !== false &&
    app &&
    typeof app.relaunch === 'function' &&
    process.env.NODE_ENV !== 'test'
  ) {
    try {
      app.relaunch();
      app.exit(0);
    } catch {
      // Ignore in non-electron runner
    }
  }

  return {
    success: true,
    message: `Database successfully restored from ${backupFilename}`,
    safetyBackupFile,
  };
}
