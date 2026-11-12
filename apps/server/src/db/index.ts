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
    const isRemote =
      url.includes('supabase.co') ||
      url.includes('pooler.supabase.com') ||
      url.includes('sslmode=require') ||
      process.env.DB_SSL === 'true';

    globalPool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }
  return globalPool;
}

export function getDb(poolOrUrl?: pg.Pool | string): NodePgDatabase<typeof schema> {
  if (poolOrUrl) {
    if (typeof poolOrUrl === 'string') {
      const isRemote =
        poolOrUrl.includes('supabase.co') ||
        poolOrUrl.includes('pooler.supabase.com') ||
        poolOrUrl.includes('sslmode=require') ||
        process.env.DB_SSL === 'true';
      const pool = new Pool({
        connectionString: poolOrUrl,
        ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
      });
      return drizzle(pool, { schema });
    }
    return drizzle(poolOrUrl, { schema });
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
