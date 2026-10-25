import Database, {
  type Database as DatabaseInstance,
  type Statement,
  type Transaction,
} from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema';

export * from './db/schema';

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

export interface BatchStockResult {
  batchId: string;
  productId: string;
  branchId: string;
  batchNo: string;
  expiryDate: string;
  brandName: string;
  genericName: string;
  costPaisa: number;
  mrpPaisa: number;
  balance: number;
}

export const MIGRATIONS: Migration[] = [
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

      const insertMeta: Statement<[string, string]> = db.prepare<[string, string]>(`
        INSERT OR REPLACE INTO app_meta (key, value)
        VALUES (?, ?)
      `);

      const populateMetaTx: Transaction<(entries: [string, string][]) => void> = db.transaction(
        (entries: [string, string][]): void => {
          for (const [k, v] of entries) {
            insertMeta.run(k, v);
          }
        }
      );

      populateMetaTx([
        ['schema_version', '1'],
        ['initialized_at', new Date().toISOString()],
      ]);
    },
  },
  {
    version: 2,
    name: '0002_inventory_schema',
    up: (db: DatabaseInstance) => {
      // Create Phase 1 tables
      db.exec(`
        CREATE TABLE IF NOT EXISTS branches (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS counters (
          id TEXT PRIMARY KEY,
          branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('owner', 'pharmacist', 'cashier')),
          pin_hash TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tax_categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          rate_bp INTEGER NOT NULL,
          is_exempt INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY,
          brand_name TEXT NOT NULL,
          generic_name TEXT NOT NULL,
          strength TEXT NOT NULL,
          form TEXT NOT NULL,
          manufacturer TEXT NOT NULL,
          barcode TEXT UNIQUE,
          tax_category_id TEXT NOT NULL REFERENCES tax_categories(id) ON DELETE RESTRICT,
          mrp_paisa INTEGER NOT NULL,
          is_controlled INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
        CREATE INDEX IF NOT EXISTS idx_products_brand_name ON products(brand_name);
        CREATE INDEX IF NOT EXISTS idx_products_generic_name ON products(generic_name);

        CREATE TABLE IF NOT EXISTS suppliers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        -- Batches table: strictly NO direct quantity column (Rule 4)
        CREATE TABLE IF NOT EXISTS batches (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          batch_no TEXT NOT NULL,
          expiry_date TEXT NOT NULL,
          cost_paisa INTEGER NOT NULL,
          mrp_paisa INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_batches_expiry_date ON batches(expiry_date);
        CREATE INDEX IF NOT EXISTS idx_batches_product_batch ON batches(product_id, batch_no);

        -- Stock movements: all stock balance is the sum of quantity_signed (Rule 4)
        CREATE TABLE IF NOT EXISTS stock_movements (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
          branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
          type TEXT NOT NULL CHECK(type IN ('purchase', 'sale', 'return', 'adjustment', 'transfer_in', 'transfer_out')),
          quantity_signed INTEGER NOT NULL,
          reference_type TEXT,
          reference_id TEXT,
          reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_stock_movements_branch_batch ON stock_movements(branch_id, batch_id);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_branch_product ON stock_movements(branch_id, product_id);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at);

        -- View for aggregating stock by batch and branch
        CREATE VIEW IF NOT EXISTS view_batch_stock AS
        SELECT
          sm.branch_id,
          sm.batch_id,
          b.product_id,
          b.batch_no,
          b.expiry_date,
          b.cost_paisa,
          b.mrp_paisa,
          p.brand_name,
          p.generic_name,
          COALESCE(SUM(sm.quantity_signed), 0) AS balance
        FROM stock_movements sm
        INNER JOIN batches b ON sm.batch_id = b.id
        INNER JOIN products p ON b.product_id = p.id
        GROUP BY sm.branch_id, sm.batch_id;
      `);

      // Update schema_version in app_meta
      db.prepare(`
        INSERT OR REPLACE INTO app_meta (key, value)
        VALUES ('schema_version', '2')
      `).run();
    },
  },
];

let dbInstance: DatabaseInstance | null = null;
let drizzleInstance: BetterSQLite3Database<typeof schema> | null = null;
let cachedMetadata: DbMetadata | null = null;

function resolveNativeBinding(): string | undefined {
  if (app && app.isPackaged) {
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

export function initDatabase(customPath?: string): DbMetadata {
  if (!customPath && cachedMetadata && dbInstance) {
    return cachedMetadata;
  }

  let dbPath = customPath;
  if (!dbPath) {
    if (app && typeof app.getPath === 'function') {
      const userDataDir = app.getPath('userData');
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }
      dbPath = path.join(userDataDir, 'pharmacy.db');
    } else if (process.env.APPDATA) {
      const userDataDir = path.join(process.env.APPDATA, 'POS Counter');
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }
      dbPath = path.join(userDataDir, 'pharmacy.db');
    } else {
      // In unit test runner outside of Electron process
      dbPath = ':memory:';
    }
  }

  console.log(`[Database] Initializing SQLite database at: ${dbPath}`);

  const nativeBinding = resolveNativeBinding();
  if (nativeBinding) {
    console.log(`[Database] Using unpacked native binding: ${nativeBinding}`);
  }

  const db = new Database(dbPath, {
    nativeBinding,
  });

  // 1. Typed pragma: WAL mode (WAL does not apply to in-memory databases)
  const isMemory = dbPath === ':memory:';
  const journalResult = isMemory
    ? 'memory'
    : (db.pragma('journal_mode = WAL', { simple: true }) as string);
  console.log(`[Database] Journal mode: ${journalResult}`);

  // 2. Typed pragma: Foreign keys
  db.pragma('foreign_keys = ON');
  const fkResult = db.pragma('foreign_keys', { simple: true }) as number;
  const foreignKeysEnabled = fkResult === 1;
  console.log(`[Database] Foreign keys enabled: ${foreignKeysEnabled}`);

  // 3. Migration tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

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

  // Read schema version from app_meta
  const getMetaStmt: Statement<[string], MetaRow> = db.prepare<[string], MetaRow>(
    'SELECT key, value FROM app_meta WHERE key = ?'
  );
  const versionRow = getMetaStmt.get('schema_version');
  const schemaVersion = versionRow ? parseInt(versionRow.value, 10) : 0;
  console.log(
    `[Database] Current schema version: ${schemaVersion} (${newlyApplied} applied this run)`
  );

  dbInstance = db;
  drizzleInstance = drizzle(db, { schema });

  cachedMetadata = {
    dbPath,
    schemaVersion,
    journalMode: journalResult,
    foreignKeys: foreignKeysEnabled,
    migrationsApplied: MIGRATIONS.length,
  };

  return cachedMetadata;
}

export function getDatabase(): DatabaseInstance {
  if (!dbInstance) {
    initDatabase();
  }
  return dbInstance!;
}

export function setDatabaseForTesting(db: DatabaseInstance): void {
  dbInstance = db;
  drizzleInstance = drizzle(db, { schema });
}

export function getDrizzle(): BetterSQLite3Database<typeof schema> {
  if (!drizzleInstance) {
    initDatabase();
  }
  return drizzleInstance!;
}

export function getDbMetadata(): DbMetadata {
  if (!cachedMetadata) {
    return initDatabase();
  }
  return cachedMetadata;
}

/**
 * Computes the real-time stock balance for each batch in a given branch.
 * Stock balance is strictly computed as the sum of signed stock_movements (Rule 4).
 */
export function getStockByBatch(
  branchId: string,
  drizzleDb?: BetterSQLite3Database<typeof schema>
): BatchStockResult[] {
  const db = drizzleDb ?? getDrizzle();

  const rows = db
    .select({
      batchId: schema.batches.id,
      productId: schema.batches.productId,
      branchId: schema.stockMovements.branchId,
      batchNo: schema.batches.batchNo,
      expiryDate: schema.batches.expiryDate,
      costPaisa: schema.batches.costPaisa,
      mrpPaisa: schema.batches.mrpPaisa,
      brandName: schema.products.brandName,
      genericName: schema.products.genericName,
      balance: sql<number>`COALESCE(SUM(${schema.stockMovements.quantitySigned}), 0)`.mapWith(Number),
    })
    .from(schema.stockMovements)
    .innerJoin(schema.batches, eq(schema.stockMovements.batchId, schema.batches.id))
    .innerJoin(schema.products, eq(schema.batches.productId, schema.products.id))
    .where(eq(schema.stockMovements.branchId, branchId))
    .groupBy(
      schema.stockMovements.branchId,
      schema.stockMovements.batchId,
      schema.batches.id,
      schema.products.id
    )
    .all();

  return rows;
}
