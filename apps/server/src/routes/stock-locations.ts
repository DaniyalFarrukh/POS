import type { FastifyPluginAsync } from 'fastify';
import { eq, and, asc } from 'drizzle-orm';
import { z, generateUuidV7 } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import { stockLocations, branches } from '../db/schema';
import { insertChangeLog } from '../sync/change-log';

const CreateLocationSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().trim().min(1, 'Location name is required'),
  code: z.string().trim().optional().nullable(),
  isDefault: z.boolean().default(false),
});

const UpdateLocationSchema = z.object({
  name: z.string().trim().min(1).optional(),
  code: z.string().trim().optional().nullable(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const stockLocationRoutes: FastifyPluginAsync = async (app) => {
  // 1. GET /api/stock-locations
  app.get(
    '/api/stock-locations',
    { preHandler: [requirePermission('inventory.warehouse.view')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const { branchId } = request.query as { branchId?: string };

      const conditions = [eq(stockLocations.pharmacyId, pharmacyId)];
      if (branchId) {
        conditions.push(eq(stockLocations.branchId, branchId));
      }

      const rows = await db
        .select({
          location: stockLocations,
          branchName: branches.name,
        })
        .from(stockLocations)
        .innerJoin(branches, eq(stockLocations.branchId, branches.id))
        .where(and(...conditions))
        .orderBy(asc(stockLocations.name));

      return reply.status(200).send({
        items: rows.map((r) => ({
          ...r.location,
          branchName: r.branchName,
        })),
      });
    }
  );

  // 2. POST /api/stock-locations
  app.post(
    '/api/stock-locations',
    { preHandler: [requirePermission('inventory.warehouse.manage')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const parsed = CreateLocationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid location payload',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const data = parsed.data;

      // Verify branch belongs to pharmacy
      const [branch] = await db
        .select()
        .from(branches)
        .where(and(eq(branches.id, data.branchId), eq(branches.pharmacyId, pharmacyId)));
      if (!branch) {
        return reply.status(400).send({
          code: 'INVALID_BRANCH',
          message: 'Branch does not exist for this pharmacy',
        });
      }

      // Check unique name in branch
      const [existing] = await db
        .select()
        .from(stockLocations)
        .where(
          and(
            eq(stockLocations.pharmacyId, pharmacyId),
            eq(stockLocations.branchId, data.branchId),
            eq(stockLocations.name, data.name)
          )
        );

      if (existing) {
        return reply.status(400).send({
          code: 'DUPLICATE_LOCATION',
          message: `Location '${data.name}' already exists in this branch`,
        });
      }

      const id = generateUuidV7();
      const now = new Date().toISOString();

      if (data.isDefault) {
        // Reset existing defaults in this branch
        await db
          .update(stockLocations)
          .set({ isDefault: false, updatedAt: now })
          .where(
            and(eq(stockLocations.pharmacyId, pharmacyId), eq(stockLocations.branchId, data.branchId))
          );
      }

      const [inserted] = await db
        .insert(stockLocations)
        .values({
          id,
          pharmacyId,
          branchId: data.branchId,
          name: data.name,
          code: data.code || null,
          isDefault: data.isDefault,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await insertChangeLog(db, {
        pharmacyId,
        branchId: data.branchId,
        entity: 'stock_location',
        entityId: id,
        op: 'upsert',
        data: inserted!,
        createdAt: now,
      });

      return reply.status(201).send({ data: inserted });
    }
  );

  // 3. PATCH /api/stock-locations/:id
  app.patch(
    '/api/stock-locations/:id',
    { preHandler: [requirePermission('inventory.warehouse.manage')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      const [location] = await db
        .select()
        .from(stockLocations)
        .where(and(eq(stockLocations.id, id), eq(stockLocations.pharmacyId, pharmacyId)));

      if (!location) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Location not found',
        });
      }

      const parsed = UpdateLocationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid payload',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const data = parsed.data;
      const now = new Date().toISOString();

      if (data.isDefault) {
        await db
          .update(stockLocations)
          .set({ isDefault: false, updatedAt: now })
          .where(
            and(
              eq(stockLocations.pharmacyId, pharmacyId),
              eq(stockLocations.branchId, location.branchId)
            )
          );
      }

      const [updated] = await db
        .update(stockLocations)
        .set({
          name: data.name ?? location.name,
          code: data.code !== undefined ? data.code : location.code,
          isDefault: data.isDefault !== undefined ? data.isDefault : location.isDefault,
          isActive: data.isActive !== undefined ? data.isActive : location.isActive,
          updatedAt: now,
        })
        .where(eq(stockLocations.id, id))
        .returning();

      await insertChangeLog(db, {
        pharmacyId,
        branchId: location.branchId,
        entity: 'stock_location',
        entityId: id,
        op: 'upsert',
        data: updated!,
        createdAt: now,
      });

      return reply.status(200).send({ data: updated });
    }
  );
};
