import type { DbClient } from './types';
import { changeLog } from '../db/schema';

/**
 * Explicit list of entity types whose data is strictly scoped to a single branch.
 *
 * Reasoning:
 * - stock_movement: Physical stock movements are localized to a branch's physical inventory.
 * - counter: POS counters physically exist within a specific branch.
 * - device: POS devices are bound to a counter/branch.
 * - stock_alert: Low/negative stock warnings are local to a specific branch's inventory.
 *
 * All other entities (product, tax_category, supplier, batch, user, branch, invoice, credit_note)
 * have branchId = NULL (pharmacy-wide) so they reach every branch.
 */
export const BRANCH_SCOPED_ENTITIES = new Set<string>([
  'stock_movement',
  'counter',
  'device',
  'stock_alert',
  'shift',
]);

/**
 * Single source of truth helper to resolve whether a change_log row receives a branchId.
 * Only explicitly branch-scoped entities are assigned a branchId; all others are forced to null.
 */
export function resolveChangeLogBranchId(
  entity: string,
  explicitBranchId?: string | null,
  data?: Record<string, unknown>
): string | null {
  if (BRANCH_SCOPED_ENTITIES.has(entity)) {
    if (explicitBranchId) {
      return explicitBranchId;
    }
    if (data) {
      const dataBranchId = data.branchId ?? data.branch_id;
      if (typeof dataBranchId === 'string' && dataBranchId) {
        return dataBranchId;
      }
    }
  }
  return null;
}

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
  | 'credit_note'
  | 'device'
  | 'stock_alert';

export interface InsertChangeLogParams {
  pharmacyId: string;
  entity: string;
  entityId: string;
  op: 'upsert' | 'delete';
  data: Record<string, unknown>;
  branchId?: string | null;
  createdAt?: string;
}

/**
 * Central server helper used by every change_log write across the server.
 * Ensures consistent branch scoping via resolveChangeLogBranchId and returns seq.
 */
export async function insertChangeLog(
  db: DbClient,
  params: InsertChangeLogParams
): Promise<number> {
  const branchId = resolveChangeLogBranchId(params.entity, params.branchId, params.data);
  const [entry] = await db
    .insert(changeLog)
    .values({
      pharmacyId: params.pharmacyId,
      branchId,
      entity: params.entity,
      entityId: params.entityId,
      op: params.op,
      data: params.data,
      createdAt: params.createdAt || new Date().toISOString(),
    })
    .returning({ seq: changeLog.seq });

  return entry?.seq ?? 0;
}

/**
 * Backwards-compatible alias for master data writes.
 */
export async function recordMasterDataChange(
  db: DbClient,
  params: InsertChangeLogParams
): Promise<number> {
  return insertChangeLog(db, params);
}
