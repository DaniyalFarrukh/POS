import type { FastifyPluginAsync } from 'fastify';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { z, generateUuidV7 } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  stockCounts,
  stockCountLines,
  stockMovements,
  stockLocations,
  branches,
  products,
  batches,
  users,
  stockAlerts,
} from '../db/schema';
import { insertChangeLog } from '../sync/change-log';
import { postStockAdjustmentCreated } from '../ledger/posting-engine';

const CreateStockCountSchema = z.object({
  branchId: z.string().uuid(),
  locationId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  batches: z
    .array(
      z.object({
        productId: z.string().uuid(),
        batchId: z.string().uuid(),
      })
    )
    .min(1, 'At least one product/batch is required'),
});

const UpdateLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        countedQuantity: z.number().int().min(0, 'Counted quantity cannot be negative'),
        notes: z.string().optional().nullable(),
      })
    )
    .min(1, 'At least one line must be updated'),
});

export const stockCountRoutes: FastifyPluginAsync = async (app) => {
  // 1. GET /api/stock-counts - List count sessions
  app.get(
    '/api/stock-counts',
    { preHandler: [requirePermission('inventory.count.view')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const { branchId, locationId, status } = request.query as {
        branchId?: string;
        locationId?: string;
        status?: string;
      };

      const conditions = [eq(stockCounts.pharmacyId, pharmacyId)];
      if (branchId) conditions.push(eq(stockCounts.branchId, branchId));
      if (locationId) conditions.push(eq(stockCounts.locationId, locationId));
      if (status && status !== 'all') {
        conditions.push(
          eq(stockCounts.status, status as 'draft' | 'submitted' | 'approved' | 'cancelled')
        );
      }

      const rows = await db
        .select({
          count: stockCounts,
          branchName: branches.name,
          locationName: stockLocations.name,
          createdByName: users.name,
        })
        .from(stockCounts)
        .innerJoin(branches, eq(stockCounts.branchId, branches.id))
        .leftJoin(stockLocations, eq(stockCounts.locationId, stockLocations.id))
        .leftJoin(users, eq(stockCounts.createdBy, users.id))
        .where(and(...conditions))
        .orderBy(desc(stockCounts.createdAt));

      return reply.status(200).send({
        items: rows.map((r) => ({
          ...r.count,
          branchName: r.branchName,
          locationName: r.locationName,
          createdByName: r.createdByName,
        })),
      });
    }
  );

  // 2. POST /api/stock-counts - Create count session (draft)
  app.post(
    '/api/stock-counts',
    { preHandler: [requirePermission('inventory.count.create')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const parsed = CreateStockCountSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid stock count payload',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const { branchId, locationId, notes, batches: inputBatches } = parsed.data;

      // Verify branch belongs to pharmacy
      const [branch] = await db
        .select()
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.pharmacyId, pharmacyId)));
      if (!branch) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Branch not found',
        });
      }

      const now = new Date().toISOString();
      const countId = generateUuidV7();

      // Sequential human readable count number: SC-YYYYMM-XXXX
      const datePrefix = `SC-${now.slice(0, 4)}${now.slice(5, 7)}`;
      const countRows = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(stockCounts)
        .where(eq(stockCounts.pharmacyId, pharmacyId));
      const existingCount = countRows[0]?.count ?? 0;
      const countNumber = `${datePrefix}-${String(existingCount + 1).padStart(4, '0')}`;

      // Calculate system on-hand for each requested batch
      const linesToInsert: Array<typeof stockCountLines.$inferInsert> = [];

      for (const item of inputBatches) {
        const [batch] = await db
          .select()
          .from(batches)
          .where(and(eq(batches.id, item.batchId), eq(batches.pharmacyId, pharmacyId)));
        if (!batch) continue;

        // Query current on-hand for this batch at this branch (and location if set)
        const conditions = [
          eq(stockMovements.pharmacyId, pharmacyId),
          eq(stockMovements.branchId, branchId),
          eq(stockMovements.batchId, item.batchId),
        ];
        if (locationId) {
          conditions.push(eq(stockMovements.locationId, locationId));
        }

        const [balRow] = await db
          .select({
            balance: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`.mapWith(
              Number
            ),
          })
          .from(stockMovements)
          .where(and(...conditions));

        const systemQty = balRow?.balance ?? 0;
        const lineId = generateUuidV7();

        linesToInsert.push({
          id: lineId,
          pharmacyId,
          countId,
          productId: item.productId,
          batchId: item.batchId,
          systemQuantity: systemQty,
          countedQuantity: systemQty, // default initial count to system
          varianceQuantity: 0,
          costPaisa: batch.costPaisa,
          variancePaisa: 0,
          createdAt: now,
          updatedAt: now,
        });
      }

      await db.transaction(async (tx) => {
        await tx.insert(stockCounts).values({
          id: countId,
          pharmacyId,
          branchId,
          locationId: locationId || null,
          countNumber,
          status: 'draft',
          notes: notes || null,
          createdBy: user.userId,
          createdAt: now,
          updatedAt: now,
        });

        if (linesToInsert.length > 0) {
          await tx.insert(stockCountLines).values(linesToInsert);
        }
      });

      // Fetch created record with lines
      const [newCount] = await db.select().from(stockCounts).where(eq(stockCounts.id, countId));

      return reply.status(201).send({
        data: {
          ...newCount,
          lines: linesToInsert,
        },
      });
    }
  );

  // 3. GET /api/stock-counts/:id - Detail with lines & batch metadata
  app.get(
    '/api/stock-counts/:id',
    { preHandler: [requirePermission('inventory.count.view')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      const [count] = await db
        .select({
          count: stockCounts,
          branchName: branches.name,
          locationName: stockLocations.name,
          createdByName: users.name,
        })
        .from(stockCounts)
        .innerJoin(branches, eq(stockCounts.branchId, branches.id))
        .leftJoin(stockLocations, eq(stockCounts.locationId, stockLocations.id))
        .leftJoin(users, eq(stockCounts.createdBy, users.id))
        .where(and(eq(stockCounts.id, id), eq(stockCounts.pharmacyId, pharmacyId)));

      if (!count) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Stock count session not found',
        });
      }

      const lines = await db
        .select({
          line: stockCountLines,
          product: products,
          batch: batches,
        })
        .from(stockCountLines)
        .innerJoin(products, eq(stockCountLines.productId, products.id))
        .innerJoin(batches, eq(stockCountLines.batchId, batches.id))
        .where(and(eq(stockCountLines.countId, id), eq(stockCountLines.pharmacyId, pharmacyId)))
        .orderBy(asc(products.brandName));

      return reply.status(200).send({
        data: {
          ...count.count,
          branchName: count.branchName,
          locationName: count.locationName,
          createdByName: count.createdByName,
          lines: lines.map((l) => ({
            ...l.line,
            product: l.product,
            batch: l.batch,
          })),
        },
      });
    }
  );

  // 4. PUT /api/stock-counts/:id/lines - Update recorded counts & calculate variance
  app.put(
    '/api/stock-counts/:id/lines',
    { preHandler: [requirePermission('inventory.count.create')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      const parsed = UpdateLinesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid lines update payload',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const [count] = await db
        .select()
        .from(stockCounts)
        .where(and(eq(stockCounts.id, id), eq(stockCounts.pharmacyId, pharmacyId)));

      if (!count) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Stock count session not found',
        });
      }

      if (count.status === 'approved' || count.status === 'cancelled') {
        return reply.status(400).send({
          code: 'INVALID_STATUS',
          message: `Cannot edit lines on a '${count.status}' count session`,
        });
      }

      const now = new Date().toISOString();

      await db.transaction(async (tx) => {
        for (const item of parsed.data.lines) {
          const [line] = await tx
            .select()
            .from(stockCountLines)
            .where(
              and(
                eq(stockCountLines.id, item.lineId),
                eq(stockCountLines.countId, id),
                eq(stockCountLines.pharmacyId, pharmacyId)
              )
            );

          if (!line) continue;

          const varianceQty = item.countedQuantity - line.systemQuantity;
          const variancePaisa = varianceQty * line.costPaisa;

          await tx
            .update(stockCountLines)
            .set({
              countedQuantity: item.countedQuantity,
              varianceQuantity: varianceQty,
              variancePaisa,
              notes: item.notes !== undefined ? item.notes : line.notes,
              updatedAt: now,
            })
            .where(eq(stockCountLines.id, line.id));
        }

        await tx.update(stockCounts).set({ updatedAt: now }).where(eq(stockCounts.id, id));
      });

      const updatedLines = await db
        .select()
        .from(stockCountLines)
        .where(and(eq(stockCountLines.countId, id), eq(stockCountLines.pharmacyId, pharmacyId)));

      return reply.status(200).send({
        data: {
          ...count,
          lines: updatedLines,
        },
      });
    }
  );

  // 5. POST /api/stock-counts/:id/submit - Submit count session for approval
  app.post(
    '/api/stock-counts/:id/submit',
    { preHandler: [requirePermission('inventory.count.create')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      const [count] = await db
        .select()
        .from(stockCounts)
        .where(and(eq(stockCounts.id, id), eq(stockCounts.pharmacyId, pharmacyId)));

      if (!count) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Stock count session not found',
        });
      }

      if (count.status !== 'draft') {
        return reply.status(400).send({
          code: 'INVALID_STATUS',
          message: `Cannot submit count session with status '${count.status}'`,
        });
      }

      const now = new Date().toISOString();
      await db
        .update(stockCounts)
        .set({ status: 'submitted', updatedAt: now })
        .where(eq(stockCounts.id, id));

      return reply.status(200).send({
        data: {
          ...count,
          status: 'submitted',
          updatedAt: now,
        },
      });
    }
  );

  // 6. POST /api/stock-counts/:id/approve - Manager / Owner approves count session -> generates stock adjustments & postings
  app.post(
    '/api/stock-counts/:id/approve',
    { preHandler: [requirePermission('inventory.count.approve')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      const [count] = await db
        .select()
        .from(stockCounts)
        .where(and(eq(stockCounts.id, id), eq(stockCounts.pharmacyId, pharmacyId)));

      if (!count) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Stock count session not found',
        });
      }

      if (count.status !== 'submitted' && count.status !== 'draft') {
        return reply.status(400).send({
          code: 'INVALID_STATUS',
          message: `Cannot approve count session with status '${count.status}'`,
        });
      }

      const lines = await db
        .select()
        .from(stockCountLines)
        .where(and(eq(stockCountLines.countId, id), eq(stockCountLines.pharmacyId, pharmacyId)));

      const now = new Date().toISOString();

      await db.transaction(async (tx) => {
        for (const line of lines) {
          if (line.varianceQuantity === 0) continue;

          const movementId = generateUuidV7();

          const moveData = {
            id: movementId,
            pharmacyId,
            productId: line.productId,
            batchId: line.batchId,
            branchId: count.branchId,
            locationId: count.locationId || null,
            type: 'adjustment' as const,
            quantitySigned: line.varianceQuantity,
            referenceType: 'stock_count',
            referenceId: count.id,
            reason: `Stock count variance (${line.varianceQuantity > 0 ? '+' : ''}${line.varianceQuantity}) on #${count.countNumber}`,
            createdAt: now,
            updatedAt: now,
          };

          await tx.insert(stockMovements).values(moveData);

          await insertChangeLog(tx, {
            pharmacyId,
            branchId: count.branchId,
            entity: 'stock_movement',
            entityId: movementId,
            op: 'upsert',
            data: moveData,
            createdAt: now,
          });

          await tx
            .update(stockCountLines)
            .set({ adjustmentMovementId: movementId, updatedAt: now })
            .where(eq(stockCountLines.id, line.id));

          // Post balanced journal entry via existing ledger posting rule
          await postStockAdjustmentCreated(tx, {
            pharmacyId,
            movementId,
            branchId: count.branchId,
            productId: line.productId,
            batchId: line.batchId,
            quantitySigned: line.varianceQuantity,
            reason: `Stock count variance on #${count.countNumber}`,
            createdAt: now,
            createdBy: user.userId,
          });

          // Check if balance dropped negative -> alert
          const [balRow] = await tx
            .select({
              balance: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`.mapWith(
                Number
              ),
            })
            .from(stockMovements)
            .where(
              and(
                eq(stockMovements.pharmacyId, pharmacyId),
                eq(stockMovements.branchId, count.branchId),
                eq(stockMovements.batchId, line.batchId)
              )
            );

          if (balRow && balRow.balance < 0) {
            await tx.insert(stockAlerts).values({
              id: generateUuidV7(),
              pharmacyId,
              branchId: count.branchId,
              productId: line.productId,
              batchId: line.batchId,
              type: 'negative_stock',
              severity: 'warning',
              message: `Negative stock balance (${balRow.balance}) after count approval #${count.countNumber}`,
              createdAt: now,
            });
          }
        }

        await tx
          .update(stockCounts)
          .set({
            status: 'approved',
            approvedBy: user.userId,
            approvedAt: now,
            updatedAt: now,
          })
          .where(eq(stockCounts.id, id));
      });

      return reply.status(200).send({
        data: {
          ...count,
          status: 'approved',
          approvedBy: user.userId,
          approvedAt: now,
          updatedAt: now,
        },
      });
    }
  );

  // 7. POST /api/stock-counts/:id/cancel
  app.post(
    '/api/stock-counts/:id/cancel',
    { preHandler: [requirePermission('inventory.count.create')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      const [count] = await db
        .select()
        .from(stockCounts)
        .where(and(eq(stockCounts.id, id), eq(stockCounts.pharmacyId, pharmacyId)));

      if (!count) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Stock count session not found',
        });
      }

      if (count.status === 'approved') {
        return reply.status(400).send({
          code: 'INVALID_STATUS',
          message: 'Cannot cancel an approved count session',
        });
      }

      const now = new Date().toISOString();
      await db
        .update(stockCounts)
        .set({ status: 'cancelled', updatedAt: now })
        .where(eq(stockCounts.id, id));

      return reply.status(200).send({
        data: {
          ...count,
          status: 'cancelled',
          updatedAt: now,
        },
      });
    }
  );
};
