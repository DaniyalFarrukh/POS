import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';

export interface ApplierContext {
  pharmacyId: string;
  branchId: string;
  deviceId: string;
}

export type DbClient = NodePgDatabase<typeof schema>;
