import { eq, and, inArray } from 'drizzle-orm';
import type { AnyPgTable, PgColumn } from 'drizzle-orm/pg-core';
import type { DbClient } from '../types';
import { SyncRejectedError, SyncRetryLaterError } from '../errors';

export type TenantTable = AnyPgTable & {
  id: PgColumn;
  pharmacyId: PgColumn;
};

/**
 * Verifies that a single referenced ID belongs to the current tenant.
 * - If found for ctxPharmacyId: returns void.
 * - If not found for ctxPharmacyId, but exists in another pharmacy: throws SyncRejectedError('CROSS_TENANT_REFERENCE', ...).
 * - If not found anywhere: throws SyncRetryLaterError(notFoundCode, ...).
 */
export async function verifyTenantEntity(
  tx: DbClient,
  table: TenantTable,
  id: string,
  ctxPharmacyId: string,
  notFoundCode: string,
  entityName: string
): Promise<void> {
  const [local] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.pharmacyId, ctxPharmacyId)))
    .limit(1);

  if (local) return;

  const [other] = await tx
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);

  if (other) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Referenced ${entityName} ${id} belongs to another pharmacy tenant`
    );
  }

  throw new SyncRetryLaterError(
    notFoundCode,
    `Referenced ${entityName} ${id} not found for pharmacy ${ctxPharmacyId}`
  );
}

/**
 * Verifies that multiple referenced IDs belong to the current tenant.
 * - If all found for ctxPharmacyId: returns void.
 * - If any not found for ctxPharmacyId, but exists in another pharmacy: throws SyncRejectedError('CROSS_TENANT_REFERENCE', ...).
 * - If not found anywhere: throws SyncRetryLaterError(notFoundCode, ...).
 */
export async function verifyTenantEntities(
  tx: DbClient,
  table: TenantTable,
  ids: string[],
  ctxPharmacyId: string,
  notFoundCode: string,
  entityName: string
): Promise<void> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  const localRows = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.pharmacyId, ctxPharmacyId), inArray(table.id, uniqueIds)));

  const localSet = new Set(localRows.map((r) => String(r.id)));
  const missingIds = uniqueIds.filter((id) => !localSet.has(id));

  if (missingIds.length === 0) return;

  // Check if any missing ID exists in any other pharmacy
  const otherRows = await tx
    .select({ id: table.id })
    .from(table)
    .where(inArray(table.id, missingIds));

  const firstOther = otherRows[0];
  if (firstOther) {
    const crossTenantId = String(firstOther.id);
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Referenced ${entityName} ${crossTenantId} belongs to another pharmacy tenant`
    );
  }

  const firstMissing = missingIds[0] || 'unknown';
  throw new SyncRetryLaterError(
    notFoundCode,
    `Referenced ${entityName} ${firstMissing} not found for pharmacy ${ctxPharmacyId}`
  );
}
