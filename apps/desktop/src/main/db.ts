import Database, {
  type Database as DatabaseInstance,
  type Statement,
  type Transaction,
} from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export interface DbMetadata {
  dbPath: string;
  schemaVersion: number;
  journalMode: string;
  foreignKeys: boolean;
  migrationsApplied: number;
}

export interface MetaRow {
  key: string;
  value: string;
}

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseInstance) => void;
}

// Prompt 0.2 scope: Only the single app_meta table holding schema_version and initialized_at
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '0001_initial_schema',
    up: (db: DatabaseInstance) => {
      // 1. Create single app_meta table
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      // 2. Typed prepare usage
      const insertMeta: Statement<[string, string]> = db.prepare<[string, string]>(`
        INSERT OR REPLACE INTO app_meta (key, value)
        VALUES (?, ?)
      `);

      // 3. Typed transaction usage
      const populateMetaTx: Transaction<(entries: [string, string][]) => void> = db.transaction(
        (entries: [string, string][]): void => {
          for (const [k, v] of entries) {
            insertMeta.run(k, v);
          }
        }
      );

      // Execute typed transaction with schema_version and initialized_at
      populateMetaTx([
        ['schema_version', '1'],
        ['initialized_at', new Date().toISOString()],
      ]);
    },
  },
];

let dbInstance: DatabaseInstance | null = null;
let cachedMetadata: DbMetadata | null = null;

function resolveNativeBinding(): string | undefined {
  if (app.isPackaged) {
    const candidate = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'better-sqlite3',
      'prebuilds',
      `${process.platform}-${process.arch}.node`
    );
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function initDatabase(): DbMetadata {
  if (cachedMetadata && dbInstance) {
    return cachedMetadata;
  }

  const userDataDir = app.getPath('userData');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const dbPath = path.join(userDataDir, 'pharmacy.db');
  console.log(`[Database] Initializing SQLite database at: ${dbPath}`);

  const nativeBinding = resolveNativeBinding();
  if (nativeBinding) {
    console.log(`[Database] Using unpacked native binding: ${nativeBinding}`);
  }

  const db = new Database(dbPath, {
    nativeBinding,
  });

  // 1. Typed pragma: WAL mode
  const journalResult = db.pragma('journal_mode = WAL', { simple: true }) as string;
  console.log(`[Database] Journal mode: ${journalResult}`);

  // 2. Typed pragma: Foreign keys
  db.pragma('foreign_keys = ON');
  const fkResult = db.pragma('foreign_keys', { simple: true }) as number;
  const foreignKeysEnabled = fkResult === 1;
  console.log(`[Database] Foreign keys enabled: ${foreignKeysEnabled}`);

  // 3. Minimal migration tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  // Typed statements for migration tracking
  const getAppliedMigrations: Statement<[], { version: number }> = db.prepare<
    [],
    { version: number }
  >('SELECT version FROM schema_migrations ORDER BY version ASC');
  const appliedRows = getAppliedMigrations.all();
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  let newlyApplied = 0;
  const insertMigration: Statement<[number, string, string]> = db.prepare<[number, string, string]>(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  );

  const runMigrationTx: Transaction<(m: Migration) => void> = db.transaction(
    (m: Migration): void => {
      console.log(`[Database] Applying migration ${m.version}: ${m.name}`);
      m.up(db);
      insertMigration.run(m.version, m.name, new Date().toISOString());
    }
  );

  for (const migration of MIGRATIONS) {
    if (!appliedVersions.has(migration.version)) {
      runMigrationTx(migration);
      newlyApplied++;
    }
  }

  // Read schema version from app_meta via typed query
  const getMetaStmt: Statement<[string], MetaRow> = db.prepare<[string], MetaRow>(
    'SELECT key, value FROM app_meta WHERE key = ?'
  );
  const versionRow = getMetaStmt.get('schema_version');
  const schemaVersion = versionRow ? parseInt(versionRow.value, 10) : 0;
  console.log(
    `[Database] Current schema version: ${schemaVersion} (${newlyApplied} applied this run)`
  );

  dbInstance = db;
  cachedMetadata = {
    dbPath,
    schemaVersion,
    journalMode: journalResult,
    foreignKeys: foreignKeysEnabled,
    migrationsApplied: MIGRATIONS.length,
  };

  return cachedMetadata;
}

export function getDbMetadata(): DbMetadata {
  if (!cachedMetadata) {
    return initDatabase();
  }
  return cachedMetadata;
}
