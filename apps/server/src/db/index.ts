import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config();

// Ensure Node TLS permits Supabase self-signed cert chain in serverless environments
if (process.env.NODE_ENV === 'production' || !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const { Pool } = pg;

let globalPool: pg.Pool | null = null;
let globalDb: NodePgDatabase<typeof schema> | null = null;

export function getDatabaseUrl(): string {
  const SUPABASE_DEFAULT =
    'postgresql://postgres.mcljcfeahnmzztrmheyu:oneyeargoal%401122@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require';
  const url = process.env.DATABASE_URL;

  return url || SUPABASE_DEFAULT;
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

    // Strip sslmode from query string so pg does not override rejectUnauthorized: false
    const cleanUrl = url.replace(/[?&]sslmode=[^&]+/g, '');

    globalPool = new Pool({
      connectionString: cleanUrl,
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
      const cleanUrl = poolOrUrl.replace(/[?&]sslmode=[^&]+/g, '');
      const pool = new Pool({
        connectionString: cleanUrl,
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
