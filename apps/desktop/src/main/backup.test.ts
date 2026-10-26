import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Database from 'better-sqlite3';
import {
  createDatabaseBackup,
  enforceBackupRetention,
  restoreDatabaseBackup,
  checkAndRunDailyBackup,
} from './backup';
import { initDatabase, closeDatabase, getDatabase } from './db';

describe('Safe Database Backup & Restore Service (Phase 5)', () => {
  let tempDir: string;
  let dbPath: string;
  let backupDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-backup-test-'));
    dbPath = path.join(tempDir, 'pos-test.db');
    backupDir = path.join(tempDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    // Initialize clean database with table
    initDatabase(dbPath);
    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS sample_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      INSERT INTO sample_items (id, name) VALUES ('item-1', 'Panadol 500mg');
    `);
  });

  afterEach(() => {
    try {
      closeDatabase();
    } catch {
      // Ignore cleanup error
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('creates a safe SQLite backup via native db.backup()', async () => {
    const db = getDatabase();
    const backup = await createDatabaseBackup({
      db,
      backupDir,
    });

    expect(backup.filename).toMatch(/^backup-\d{4}-\d{2}-\d{2}-\d{6}\.db$/);
    expect(fs.existsSync(backup.filePath)).toBe(true);
    expect(backup.sizeBytes).toBeGreaterThan(0);

    // Verify backed up database can be opened and has intact data
    const verifyDb = new Database(backup.filePath);
    const row = verifyDb.prepare('SELECT name FROM sample_items WHERE id = ?').get('item-1') as { name: string };
    expect(row).toBeDefined();
    expect(row.name).toBe('Panadol 500mg');
    verifyDb.close();
  });

  it('strictly retains only the last 14 backups', async () => {
    // Create 18 dummy backup files with incrementing mtime
    const now = Date.now();
    for (let i = 1; i <= 18; i++) {
      const filename = `backup-2026-10-26-${String(i).padStart(6, '0')}.db`;
      const filePath = path.join(backupDir, filename);
      fs.writeFileSync(filePath, 'dummy sqlite file content');
      // Set modification times spaced 10 seconds apart
      const mtime = new Date(now - (18 - i) * 10000);
      fs.utimesSync(filePath, mtime, mtime);
    }

    // Pre-condition: 18 files exist
    const initialFiles = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db'));
    expect(initialFiles.length).toBe(18);

    // Enforce retention
    enforceBackupRetention(backupDir, 14);

    const remainingFiles = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db'));
    expect(remainingFiles.length).toBe(14);

    // Oldest backups (1 and 2) should have been pruned
    expect(fs.existsSync(path.join(backupDir, 'backup-2026-10-26-000001.db'))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, 'backup-2026-10-26-000002.db'))).toBe(false);
    // Newest backup (18) must exist
    expect(fs.existsSync(path.join(backupDir, 'backup-2026-10-26-000018.db'))).toBe(true);
  });

  it('rejects restore if role is not owner', async () => {
    const db = getDatabase();
    const backup = await createDatabaseBackup({ db, backupDir });

    await expect(
      restoreDatabaseBackup(backup.filename, 'cashier', {
        customDir: backupDir,
        targetDbPath: dbPath,
      })
    ).rejects.toThrow(/Unauthorized: Database restore is strictly restricted to the Owner role/);

    await expect(
      restoreDatabaseBackup(backup.filename, 'pharmacist', {
        customDir: backupDir,
        targetDbPath: dbPath,
      })
    ).rejects.toThrow(/Unauthorized/);
  });

  it('restores backup successfully for owner with safety pre-restore snapshot', async () => {
    const db = getDatabase();
    // Step 1: Create initial backup with item-1
    const backup = await createDatabaseBackup({ db, backupDir });

    // Step 2: Mutate active database (insert item-2)
    db.exec(`INSERT INTO sample_items (id, name) VALUES ('item-2', 'Brufen 400mg');`);
    const countBefore = (db.prepare('SELECT COUNT(*) as count FROM sample_items').get() as { count: number }).count;
    expect(countBefore).toBe(2);

    // Step 3: Restore initial backup as owner
    const restoreRes = await restoreDatabaseBackup(backup.filename, 'owner', {
      customDir: backupDir,
      targetDbPath: dbPath,
    });

    expect(restoreRes.success).toBe(true);
    expect(restoreRes.safetyBackupFile).toBeDefined();
    expect(fs.existsSync(path.join(backupDir, restoreRes.safetyBackupFile!))).toBe(true);

    // Step 4: Verify restored database state
    const restoredDb = getDatabase();
    const countAfter = (restoredDb.prepare('SELECT COUNT(*) as count FROM sample_items').get() as { count: number }).count;
    expect(countAfter).toBe(1);

    const row = restoredDb.prepare('SELECT name FROM sample_items WHERE id = ?').get('item-1') as { name: string };
    expect(row.name).toBe('Panadol 500mg');
  });

  it('checkAndRunDailyBackup triggers when no backup exists and skips when recent backup exists', async () => {
    const db = getDatabase();

    // 1. Initial run: no backups exist -> should create a backup
    const backup1 = await checkAndRunDailyBackup({ db, customDir: backupDir });
    expect(backup1).not.toBeNull();
    expect(fs.existsSync(backup1!.filePath)).toBe(true);

    // 2. Second run immediately -> should skip (<24 hours old)
    const backup2 = await checkAndRunDailyBackup({ db, customDir: backupDir });
    expect(backup2).toBeNull();
  });
});
