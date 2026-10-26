import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getDb, closePool } from './index';
import * as schema from './schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');

/**
 * Executes Drizzle migrations against the provided database instance or global pool.
 */
export async function runMigrations(
  customDb?: NodePgDatabase<typeof schema>,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER
): Promise<void> {
  const db = customDb || getDb();
  await migrate(db, { migrationsFolder });
}

// If executed directly from command line (e.g. pnpm migrate or tsx migrate.ts)
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('migrate.ts') ||
    process.argv[1].endsWith('migrate.js') ||
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));

if (isMainModule) {
  console.log(`[Migrator] Running migrations from: ${DEFAULT_MIGRATIONS_FOLDER}`);
  runMigrations()
    .then(async () => {
      console.log('[Migrator] All migrations applied cleanly.');
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[Migrator] Migration execution failed:', err);
      await closePool();
      process.exit(1);
    });
}
