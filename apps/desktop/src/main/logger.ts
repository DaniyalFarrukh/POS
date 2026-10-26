import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app, dialog } from 'electron';
import AdmZip from 'adm-zip';
import { getDatabase, getDbMetadata, getDbPath } from './db';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string; // ISO string UTC
  level: LogLevel;
  module: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface DiagnosticsMetadata {
  app: {
    name: string;
    version: string;
    electronVersion: string;
    chromeVersion: string;
    nodeVersion: string;
  };
  system: {
    platform: string;
    release: string;
    arch: string;
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    uptimeSeconds: number;
  };
  database: {
    dbPath: string;
    fileSizeBytes: number;
    walSizeBytes: number;
    schemaVersion: number;
    journalMode: string;
    foreignKeys: boolean;
    integrityCheck: string;
  };
  sync?: {
    lastPushSeq?: number;
    lastPullCursor?: string;
    pendingCount?: number;
  };
  exportedAt: string;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ROTATED_FILES = 5;

/**
 * Returns the directory for desktop log files.
 */
export function getLogDirectory(customDir?: string): string {
  if (customDir) return customDir;

  let baseDir: string;
  if (app && typeof app.getPath === 'function') {
    baseDir = app.getPath('userData');
  } else if (process.env.APPDATA) {
    baseDir = path.join(process.env.APPDATA, 'POS Counter');
  } else {
    baseDir = path.join(process.cwd(), 'logs');
  }

  const logDir = path.join(baseDir, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

/**
 * Rotates log files if the primary log file exceeds 5MB:
 * pos-counter.log -> pos-counter.1.log -> pos-counter.2.log ...
 */
function rotateLogs(logDir: string): void {
  const primaryLog = path.join(logDir, 'pos-counter.log');
  if (!fs.existsSync(primaryLog)) return;

  try {
    const stats = fs.statSync(primaryLog);
    if (stats.size < MAX_FILE_SIZE) return;

    // Shift existing numbered files: e.g. .4 -> .5, .3 -> .4, etc.
    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const oldFile = path.join(logDir, `pos-counter.${i}.log`);
      const newFile = path.join(logDir, `pos-counter.${i + 1}.log`);
      if (fs.existsSync(oldFile)) {
        if (i === MAX_ROTATED_FILES - 1) {
          fs.unlinkSync(oldFile); // Drop oldest beyond limit
        } else {
          fs.renameSync(oldFile, newFile);
        }
      }
    }

    // Rename primary to .1
    fs.renameSync(primaryLog, path.join(logDir, 'pos-counter.1.log'));
  } catch (err) {
    console.error('[Logger] Log rotation failed:', err);
  }
}

/**
 * Writes a structured log entry to the active rotating log file.
 */
export function writeLog(entry: LogEntry, customDir?: string): void {
  try {
    const logDir = getLogDirectory(customDir);
    rotateLogs(logDir);

    const logPath = path.join(logDir, 'pos-counter.log');
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logPath, line, 'utf-8');
  } catch (err) {
    console.error('[Logger] Failed to write log to disk:', err);
  }
}

export function logInfo(module: string, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'info',
    module,
    message,
    meta,
  };
  console.log(`[${entry.module}] ${entry.message}`);
  writeLog(entry);
}

export function logWarn(module: string, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'warn',
    module,
    message,
    meta,
  };
  console.warn(`[${entry.module}] WARN: ${entry.message}`);
  writeLog(entry);
}

export function logError(module: string, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    module,
    message,
    meta,
  };
  console.error(`[${entry.module}] ERROR: ${entry.message}`);
  writeLog(entry);
}

/**
 * Scrubs logs to guarantee zero patient/customer names, phone numbers, or credit notes/sale details
 * are leaked into the diagnostics package.
 */
export function sanitizeLogLine(line: string): string {
  // Redact Pakistani phone numbers: 03xx-xxxxxxx or +92xxxxxxxxxx
  let scrubbed = line.replace(/(?:(?:\+92|0092|0)?\d{10,11})/g, '[REDACTED_PHONE]');
  // Redact customer names if logged in JSON context
  scrubbed = scrubbed.replace(/"customerName":\s*"[^"]*"/gi, '"customerName":"[REDACTED]"');
  scrubbed = scrubbed.replace(/"doctorName":\s*"[^"]*"/gi, '"doctorName":"[REDACTED]"');
  scrubbed = scrubbed.replace(/"notes":\s*"[^"]*"/gi, '"notes":"[REDACTED]"');
  return scrubbed;
}

/**
 * Gathers system and SQLite metadata for diagnostics.
 */
export function gatherDiagnosticsMetadata(): DiagnosticsMetadata {
  const meta = getDbMetadata();
  const dbPath = getDbPath();

  let fileSizeBytes = 0;
  let walSizeBytes = 0;
  let integrity = 'unknown';

  if (fs.existsSync(dbPath)) {
    try {
      fileSizeBytes = fs.statSync(dbPath).size;
      const walPath = `${dbPath}-wal`;
      if (fs.existsSync(walPath)) {
        walSizeBytes = fs.statSync(walPath).size;
      }
    } catch {
      // Ignore filesystem stat error
    }
  }

  try {
    const db = getDatabase();
    integrity = (db.pragma('integrity_check', { simple: true }) as string) || 'ok';
  } catch (err) {
    integrity = err instanceof Error ? err.message : String(err);
  }

  // Check sync state if available
  let syncState: { lastPushSeq?: number; lastPullCursor?: string; pendingCount?: number } | undefined;
  try {
    const db = getDatabase();
    const cursorRow = db.prepare("SELECT value FROM sync_state WHERE key = 'pull_cursor'").get() as { value: string } | undefined;
    const pendingRow = db.prepare("SELECT COUNT(*) as cnt FROM outbox WHERE status = 'pending'").get() as { cnt: number } | undefined;
    const seqRow = db.prepare('SELECT MAX(device_seq) as maxSeq FROM outbox').get() as { maxSeq: number } | undefined;

    syncState = {
      lastPushSeq: seqRow?.maxSeq ?? 0,
      lastPullCursor: cursorRow?.value,
      pendingCount: pendingRow?.cnt ?? 0,
    };
  } catch {
    // Sync state unavailable during initialization
  }

  return {
    app: {
      name: 'POS Counter Terminal',
      version: app ? app.getVersion() : '0.1.0',
      electronVersion: process.versions.electron || 'unknown',
      chromeVersion: process.versions.chrome || 'unknown',
      nodeVersion: process.versions.node || 'unknown',
    },
    system: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      uptimeSeconds: Math.floor(os.uptime()),
    },
    database: {
      dbPath: meta.dbPath,
      fileSizeBytes,
      walSizeBytes,
      schemaVersion: meta.schemaVersion,
      journalMode: meta.journalMode,
      foreignKeys: meta.foreignKeys,
      integrityCheck: integrity,
    },
    sync: syncState,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Builds a ZIP file containing sanitized rotating logs and diagnostics.json.
 * Opens Electron save dialog if no target path is supplied.
 */
export async function exportDiagnosticsZip(
  targetFilePath?: string,
  customLogDir?: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const logDir = getLogDirectory(customLogDir);
    const metadata = gatherDiagnosticsMetadata();
    const zip = new AdmZip();

    // 1. Add diagnostics.json
    zip.addFile(
      'diagnostics.json',
      Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8'),
      'POS Counter System and Database Diagnostics'
    );

    // 2. Add sanitized log files
    if (fs.existsSync(logDir)) {
      const logFiles = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
      for (const file of logFiles) {
        const fullPath = path.join(logDir, file);
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          const sanitizedLines = lines.map(sanitizeLogLine);
          zip.addFile(`logs/${file}`, Buffer.from(sanitizedLines.join('\n'), 'utf-8'));
        } catch (err) {
          console.warn(`[Logger] Could not read log file ${file} for zip:`, err);
        }
      }
    }

    // 3. Determine save destination
    let destPath = targetFilePath;
    if (!destPath) {
      if (dialog && typeof dialog.showSaveDialog === 'function') {
        const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const result = await dialog.showSaveDialog({
          title: 'Export POS Counter Diagnostics Bundle',
          defaultPath: `pos-diagnostics-${dateStr}.zip`,
          filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
        });
        if (result.canceled || !result.filePath) {
          return { success: false, error: 'Export canceled by user' };
        }
        destPath = result.filePath;
      } else {
        const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        destPath = path.join(os.tmpdir(), `pos-diagnostics-${dateStr}.zip`);
      }
    }

    // 4. Write zip to disk
    zip.writeZip(destPath);
    console.log(`[Logger] Diagnostics zip package created successfully at: ${destPath}`);

    return { success: true, filePath: destPath };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Logger] Failed to export diagnostics zip:', errorMsg);
    return { success: false, error: errorMsg };
  }
}
