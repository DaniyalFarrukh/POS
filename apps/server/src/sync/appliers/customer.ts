import { eq, and } from 'drizzle-orm';
import { CustomerCreatedPayloadSchema, normalizePhone } from '@pos/shared';
import { customers } from '../../db/schema';
import { SyncRejectedError } from '../errors';
import type { ApplierContext, DbClient } from '../types';
import { insertChangeLog } from '../change-log';

export async function applyCustomerCreated(
  tx: DbClient,
  ctx: ApplierContext,
  rawPayload: unknown,
  entityId?: string
): Promise<void> {
  const parseResult = CustomerCreatedPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Invalid customer.created payload: ${parseResult.error.message}`
    );
  }

  const payload = parseResult.data;
  if (entityId && payload.id !== entityId) {
    throw new SyncRejectedError(
      'INVALID_PAYLOAD',
      `Payload id (${payload.id}) does not match event entityId (${entityId})`
    );
  }

  const now = new Date().toISOString();
  const normalized = normalizePhone(payload.phone);

  const [existingCustomerById] = await tx
    .select({ id: customers.id, pharmacyId: customers.pharmacyId })
    .from(customers)
    .where(eq(customers.id, payload.id))
    .limit(1);

  if (existingCustomerById && existingCustomerById.pharmacyId !== ctx.pharmacyId) {
    throw new SyncRejectedError(
      'CROSS_TENANT_REFERENCE',
      `Customer ${payload.id} belongs to another pharmacy tenant`
    );
  }

  let isDuplicate = false;
  let duplicateOfId: string | null = null;

  if (normalized) {
    const [existing] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.pharmacyId, ctx.pharmacyId),
          eq(customers.phone, normalized),
          eq(customers.isDuplicate, false)
        )
      )
      .limit(1);

    if (existing && existing.id !== payload.id) {
      isDuplicate = true;
      duplicateOfId = existing.id;
    }
  }

  await tx
    .insert(customers)
    .values({
      id: payload.id,
      pharmacyId: ctx.pharmacyId,
      name: payload.name,
      phone: normalized,
      email: payload.email ?? null,
      address: payload.address ?? null,
      creditLimitPaisa: payload.creditLimitPaisa ?? 0,
      openingBalancePaisa: payload.openingBalancePaisa ?? 0,
      priceTier: payload.priceTier ?? null,
      isDuplicate,
      duplicateOfId,
      isActive: true,
      createdAt: payload.createdAt,
      updatedAt: payload.createdAt,
    })
    .onConflictDoNothing();

  await insertChangeLog(tx, {
    pharmacyId: ctx.pharmacyId,
    entity: 'customer',
    entityId: payload.id,
    op: 'upsert',
    data: {
      id: payload.id,
      name: payload.name,
      phone: normalized,
      email: payload.email ?? null,
      address: payload.address ?? null,
      creditLimitPaisa: payload.creditLimitPaisa ?? 0,
      openingBalancePaisa: payload.openingBalancePaisa ?? 0,
      priceTier: payload.priceTier ?? null,
      isDuplicate,
      duplicateOfId,
      isActive: true,
      createdAt: payload.createdAt,
    },
    createdAt: now,
  });
}
