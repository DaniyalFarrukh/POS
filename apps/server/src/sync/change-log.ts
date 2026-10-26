import type { DbClient } from './types';
import { changeLog } from '../db/schema';

export type MasterDataEntity =
  | 'product'
  | 'tax_category'
  | 'branch'
  | 'counter'
  | 'user'
  | 'supplier'
  | 'batch'
  | 'stock_movement'
  | 'invoice'
  | 'credit_note';

export interface RecordChangeLogParams {
  pharmacyId: string;
  entity: MasterDataEntity;
  entityId: string;
  op: 'upsert' | 'delete';
  data: Record<string, unknown>;
}

/**
 * Server-side function that appends a row to change_log when master data
 * (products, tax_categories, branches, counters, users, suppliers, etc.)
 * is created, updated, or deleted.
 * Returns the auto-incremented change_log sequence number.
 */
export async function recordMasterDataChange(
  db: DbClient,
  params: RecordChangeLogParams
): Promise<number> {
  const [entry] = await db
    .insert(changeLog)
    .values({
      pharmacyId: params.pharmacyId,
      entity: params.entity,
      entityId: params.entityId,
      op: params.op,
      data: params.data,
      createdAt: new Date().toISOString(),
    })
    .returning({ seq: changeLog.seq });

  return entry?.seq ?? 0;
}
