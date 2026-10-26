import { eq, and, gt, asc } from 'drizzle-orm';
import { changeLog } from '../db/schema';
import type { DbClient } from './types';
import type { SyncChangeItem, SyncPullResponse } from '@pos/shared';

export interface PullContext {
  pharmacyId: string;
  branchId?: string | null;
}

export interface PullParams {
  cursor: number;
  limit: number;
}

/**
 * Reads changes from change_log for the authenticated pharmacy and cursor.
 * - Filters by pharmacy_id (Rule: never include data from another pharmacy).
 * - Filters branch-scoped entities by the device's branch where applicable.
 * - Orders by seq ascending.
 * - Computes nextCursor and hasMore gap-free.
 */
export async function pullChangeLog(
  db: DbClient,
  ctx: PullContext,
  params: PullParams
): Promise<SyncPullResponse> {
  const { cursor, limit } = params;

  // Query limit + 1 to reliably determine hasMore without extra roundtrips
  const rawRows = await db
    .select({
      seq: changeLog.seq,
      entity: changeLog.entity,
      entityId: changeLog.entityId,
      op: changeLog.op,
      data: changeLog.data,
      createdAt: changeLog.createdAt,
    })
    .from(changeLog)
    .where(
      and(
        eq(changeLog.pharmacyId, ctx.pharmacyId),
        gt(changeLog.seq, cursor)
      )
    )
    .orderBy(asc(changeLog.seq))
    .limit(limit + 1);

  const hasMore = rawRows.length > limit;
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;

  // Filter branch-scoped records by the device's branch
  const filteredChanges = pageRows.filter((r) => {
    if (!ctx.branchId) {
      return true;
    }
    const data = r.data as Record<string, unknown> | null;
    if (!data) {
      return true;
    }
    // Check branchId / branch_id if present on the entity
    const entityBranchId = data.branchId || data.branch_id;
    if (entityBranchId && typeof entityBranchId === 'string' && entityBranchId !== ctx.branchId) {
      return false;
    }
    return true;
  });

  const changes: SyncChangeItem[] = filteredChanges.map((r) => ({
    seq: Number(r.seq),
    entity: r.entity,
    entityId: r.entityId,
    op: r.op as 'upsert' | 'delete',
    data: (r.data as Record<string, unknown>) || {},
    createdAt: r.createdAt,
  }));

  const nextCursor = pageRows.length > 0 ? Number(pageRows[pageRows.length - 1]!.seq) : cursor;

  return {
    changes,
    nextCursor,
    hasMore,
  };
}
