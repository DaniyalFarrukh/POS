import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

let globalPool: pg.Pool | null = null;
let globalDb: NodePgDatabase<typeof schema> | null = null;

export function getDatabaseUrl(): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const url = process.env.DATABASE_URL;
  const DEV_DEFAULT = 'postgresql://pos:pos_dev_secret@localhost:5432/pos_server';

  if (isProduction) {
    if (!url) {
      throw new Error('FATAL: DATABASE_URL environment variable is required in production');
    }
    if (url === DEV_DEFAULT) {
      throw new Error('FATAL: Production DATABASE_URL cannot use default development credentials');
    }
  }

  return url || DEV_DEFAULT;
}

export function getPool(connectionString?: string): pg.Pool {
  const url = connectionString || getDatabaseUrl();
  if (!globalPool || (connectionString && globalPool)) {
    if (globalPool) {
      globalPool.end().catch(() => {});
    }
    globalPool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return globalPool;
}

export function getDb(poolOrUrl?: pg.Pool | string): NodePgDatabase<typeof schema> {
  if (poolOrUrl) {
    const pool =
      typeof poolOrUrl === 'string' ? new Pool({ connectionString: poolOrUrl }) : poolOrUrl;
    return drizzle(pool, { schema });
  }

  if (!globalDb) {
    const pool = getPool();
    globalDb = drizzle(pool, { schema });
  }

  return globalDb;
}

export async function closePool(): Promise<void> {
  if (globalPool) {
    await globalPool.end();
    globalPool = null;
    globalDb = null;
  }
}

export type DbClient = NodePgDatabase<typeof schema>;

export { schema };
