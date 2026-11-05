import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../db/schema';
import { auditLogs } from '../db/schema';
import { generateUuidV7 } from '@pos/shared';

export interface AuditEventParams {
  pharmacyId: string;
  userId?: string | null;
  userName: string;
  userRole: string;
  action: string;
  entity: string;
  entityId?: string | null;
  summary: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export async function logAuditEvent(
  db: NodePgDatabase<typeof schema>,
  params: AuditEventParams
): Promise<void> {
  const id = generateUuidV7();
  const now = new Date().toISOString();

  await db.insert(auditLogs).values({
    id,
    pharmacyId: params.pharmacyId,
    userId: params.userId || null,
    userName: params.userName,
    userRole: params.userRole,
    action: params.action,
    entity: params.entity,
    entityId: params.entityId || null,
    summary: params.summary,
    beforeState: params.beforeState || null,
    afterState: params.afterState || null,
    ipAddress: params.ipAddress || null,
    createdAt: now,
  });
}
