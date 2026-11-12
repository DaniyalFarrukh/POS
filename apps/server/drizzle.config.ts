import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.DATABASE_URL || 'postgresql://pos:pos_dev_secret@localhost:5432/pos_server';
const isRemote =
  url.includes('supabase.co') ||
  url.includes('pooler.supabase.com') ||
  url.includes('sslmode=require') ||
  process.env.DB_SSL === 'true';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url,
    ssl: isRemote ? { rejectUnauthorized: false } : undefined,
  },
});
