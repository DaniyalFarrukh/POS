import { eq, and, gt, asc, isNull, or } from 'drizzle-orm';
import { changeLog } from '../db/schema';
import type { DbClient } from './types';
import type { SyncChangeItem, SyncPullResponse } from '@pos/shared';

export const CURSOR_OVERLAP = 50;

export interface PullContext {
  pharmacyId: string;
  branchId?: string | null;
}

export interface PullParams {
  cursor: number;
  limit: number;
  overlap?: number;
}

/**
 * Reads changes from change_log for the authenticated pharmacy and cursor.
 * - Filters by pharmacy_id (Rule: never include data from another pharmacy).
 * - Filters branch-scoped entities by the device's branch directly in SQL before limit.
 * - Under concurrent PostgreSQL transactions, sequence numbers may commit out-of-order.
 *   Uses a CURSOR_OVERLAP safety window to capture any out-of-order commits.
 * - Orders by seq ascending.
 * - Computes nextCursor and hasMore gap-free.
 */
export async function pullChangeLog(
  db: DbClient,
  ctx: PullContext,
  params: PullParams
): Promise<SyncPullResponse> {
  const { cursor, limit, overlap = 0 } = params;

  // docs/SYNC.md & PostgreSQL sequence commit ordering:
  // Under PostgreSQL concurrent transactions, rows can be assigned a `bigserial` sequence number
  // out of order with respect to their commit times. An earlier sequence number might commit slightly
  // after a higher sequence number. To guarantee that no changes are missed due to commit order skew,
  // the client reads with a safety overlap: Math.max(0, cursor - CURSOR_OVERLAP).
  // The client deduplicates and idempotently applies changes in monotonic seq order.
  const effectiveCursor = Math.max(0, cursor - overlap);

  const conditions = [
    eq(changeLog.pharmacyId, ctx.pharmacyId),
    gt(changeLog.seq, effectiveCursor),
  ];

  if (ctx.branchId) {
    conditions.push(or(isNull(changeLog.branchId), eq(changeLog.branchId, ctx.branchId))!);
  }

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
    .where(and(...conditions))
    .orderBy(asc(changeLog.seq))
    .limit(limit + 1);

  const hasMore = rawRows.length > limit;
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;

  const changes: SyncChangeItem[] = pageRows.map((r) => ({
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
