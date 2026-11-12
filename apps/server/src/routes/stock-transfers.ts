import type { FastifyPluginAsync } from 'fastify';
import { eq, and, desc, asc, ilike, or, sql } from 'drizzle-orm';
import { z, generateUuidV7, isValidUuid, getKarachiBusinessDate } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  stockTransfers,
  stockTransferLines,
  stockMovements,
  stockLocations,
  branches,
  products,
  batches,
  users,
} from '../db/schema';
import { postStockTransferReceived } from '../ledger/posting-engine';
import { insertChangeLog } from '../sync/change-log';

const CreateTransferLineSchema = z.object({
  productId: z.string().uuid(),
  batchId: z.string().uuid(),
  quantityRequested: z.number().int().min(1, 'Quantity must be at least 1'),
});

const CreateTransferSchema = z.object({
  sourceBranchId: z.string().uuid(),
  sourceLocationId: z.string().uuid().optional().nullable(),
  destinationBranchId: z.string().uuid(),
  destinationLocationId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(CreateTransferLineSchema).min(1, 'At least one line item is required'),
});

const DispatchLineSchema = z.object({
  lineId: z.string().uuid(),
  quantityDispatched: z.number().int().min(1, 'Dispatched quantity must be at least 1'),
});

const DispatchTransferSchema = z.object({
  lines: z.array(DispatchLineSchema).min(1, 'At least one line item is required'),
});

const ReceiveLineSchema = z.object({
  lineId: z.string().uuid(),
  quantityReceived: z.number().int().min(0, 'Received quantity cannot be negative'),
  shortageQuantity: z.number().int().min(0).default(0),
  shortageReason: z.string().optional().nullable(),
});

const ReceiveTransferSchema = z.object({
  lines: z.array(ReceiveLineSchema).min(1, 'At least one line item is required'),
});

export const stockTransferRoutes: FastifyPluginAsync = async (app) => {
  // 1. GET /api/stock-transfers - List with status tabs and KPI summaries
  app.get(
    '/api/stock-transfers',
    { preHandler: [requirePermission('inventory.transfer.view')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const {
        status,
        sourceBranchId,
        destinationBranchId,
        search,
        limit: limitStr,
        offset: offsetStr,
      } = request.query as {
        status?: string;
        sourceBranchId?: string;
        destinationBranchId?: string;
        search?: string;
        limit?: string;
        offset?: string;
      };

      const conditions = [eq(stockTransfers.pharmacyId, pharmacyId)];

      if (status && status !== 'all') {
        conditions.push(
          eq(stockTransfers.status, status as 'draft' | 'in_transit' | 'received' | 'cancelled')
        );
      }
      if (sourceBranchId) {
        conditions.push(eq(stockTransfers.sourceBranchId, sourceBranchId));
      }
      if (destinationBranchId) {
        conditions.push(eq(stockTransfers.destinationBranchId, destinationBranchId));
      }
      if (search && search.trim()) {
        const s = `%${search.trim()}%`;
        conditions.push(
          or(ilike(stockTransfers.transferNumber, s), ilike(stockTransfers.notes, s))!
        );
      }

      const limit = Math.min(Math.max(Number(limitStr) || 100, 1), 500);
      const offset = Math.max(Number(offsetStr) || 0, 0);

      const rows = await db
        .select({
          transfer: stockTransfers,
          sourceBranchName: branches.name,
          creatorName: users.name,
        })
        .from(stockTransfers)
        .innerJoin(branches, eq(stockTransfers.sourceBranchId, branches.id))
        .leftJoin(users, eq(stockTransfers.createdBy, users.id))
        .where(and(...conditions))
        .orderBy(desc(stockTransfers.createdAt))
        .limit(limit)
        .offset(offset);

      // Fetch all transfers for KPI calculations
      const allTransfers = await db
        .select()
        .from(stockTransfers)
        .where(eq(stockTransfers.pharmacyId, pharmacyId));

      let openCount = 0;
      let inTransitCount = 0;
      let completedCount = 0;
      let shortageCount = 0;

      for (const t of allTransfers) {
        if (t.status === 'draft') openCount++;
        if (t.status === 'in_transit') inTransitCount++;
        if (t.status === 'received') completedCount++;
        if (t.hasShortage) shortageCount++;
      }

      const items = rows.map((r) => ({
        ...r.transfer,
        sourceBranchName: r.sourceBranchName,
        creatorName: r.creatorName,
      }));

      return reply.status(200).send({
        kpis: {
          openCount,
          inTransitCount,
          completedCount,
          shortageCount,
        },
        items,
      });
    }
  );

  // 2. POST /api/stock-transfers - Create draft transfer
  app.post(
    '/api/stock-transfers',
    { preHandler: [requirePermission('inventory.transfer.create')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const parsed = CreateTransferSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid transfer payload',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const data = parsed.data;
      const now = new Date().toISOString();

      // Verify branches
      const [srcBranch] = await db
        .select()
        .from(branches)
        .where(and(eq(branches.id, data.sourceBranchId), eq(branches.pharmacyId, pharmacyId)));
      const [destBranch] = await db
        .select()
        .from(branches)
        .where(and(eq(branches.id, data.destinationBranchId), eq(branches.pharmacyId, pharmacyId)));

      if (!srcBranch || !destBranch) {
        return reply.status(400).send({
          code: 'INVALID_BRANCH',
          message: 'Source or destination branch does not belong to this pharmacy',
        });
      }

      if (data.sourceLocationId) {
        const [srcLoc] = await db
          .select()
          .from(stockLocations)
          .where(
            and(
              eq(stockLocations.id, data.sourceLocationId),
              eq(stockLocations.pharmacyId, pharmacyId)
            )
          );
        if (!srcLoc) {
          return reply.status(404).send({
            statusCode: 404,
            code: 'INVALID_LOCATION',
            message: 'Source location not found in this pharmacy',
          });
        }
      }

      if (data.destinationLocationId) {
        const [destLoc] = await db
          .select()
          .from(stockLocations)
          .where(
            and(
              eq(stockLocations.id, data.destinationLocationId),
              eq(stockLocations.pharmacyId, pharmacyId)
            )
          );
        if (!destLoc) {
          return reply.status(404).send({
            statusCode: 404,
            code: 'INVALID_LOCATION',
            message: 'Destination location not found in this pharmacy',
          });
        }
      }

      for (const l of data.lines) {
        const [prod] = await db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, l.productId), eq(products.pharmacyId, pharmacyId)));
        if (!prod) {
          return reply.status(404).send({
            statusCode: 404,
            code: 'INVALID_PRODUCT',
            message: `Product ${l.productId} not found in this pharmacy`,
          });
        }
        const [batch] = await db
          .select({ id: batches.id })
          .from(batches)
          .where(
            and(
              eq(batches.id, l.batchId),
              eq(batches.productId, l.productId),
              eq(batches.pharmacyId, pharmacyId)
            )
          );
        if (!batch) {
          return reply.status(404).send({
            statusCode: 404,
            code: 'INVALID_BATCH',
            message: `Batch ${l.batchId} not found in this pharmacy`,
          });
        }
      }

      // Generate transfer number
      const year = parseInt(getKarachiBusinessDate().slice(0, 4), 10);
      const allRows = await db
        .select({ transferNumber: stockTransfers.transferNumber })
        .from(stockTransfers)
        .where(
          and(
            eq(stockTransfers.pharmacyId, pharmacyId),
            ilike(stockTransfers.transferNumber, `TR-${year}-%`)
          )
        );

      let seq = 1;
      for (const r of allRows) {
        const match = r.transferNumber.match(new RegExp(`^TR-${year}-(\\d+)$`));
        if (match && match[1]) {
          const num = parseInt(match[1], 10);
          if (num >= seq) {
            seq = num + 1;
          }
        }
      }
      const transferNumber = `TR-${year}-${String(seq).padStart(4, '0')}`;
      const transferId = generateUuidV7();

      const linesToInsert = data.lines.map((l) => ({
        id: generateUuidV7(),
        pharmacyId,
        transferId,
        productId: l.productId,
        batchId: l.batchId,
        quantityRequested: l.quantityRequested,
        quantityDispatched: 0,
        quantityReceived: 0,
        shortageQuantity: 0,
        createdAt: now,
        updatedAt: now,
      }));

      const transferRecord = {
        id: transferId,
        pharmacyId,
        transferNumber,
        sourceBranchId: data.sourceBranchId,
        sourceLocationId: data.sourceLocationId || null,
        destinationBranchId: data.destinationBranchId,
        destinationLocationId: data.destinationLocationId || null,
        status: 'draft' as const,
        hasShortage: false,
        notes: data.notes || null,
        createdBy: user.userId,
        createdAt: now,
        updatedAt: now,
      };

      await db.transaction(async (tx) => {
        await tx.insert(stockTransfers).values(transferRecord);
        await tx.insert(stockTransferLines).values(linesToInsert);

        await insertChangeLog(tx, {
          pharmacyId,
          entity: 'stock_transfer',
          entityId: transferId,
          op: 'upsert',
          data: transferRecord,
          createdAt: now,
        });
      });

      return reply.status(201).send({
        data: {
          ...transferRecord,
          lines: linesToInsert,
          sourceBranchName: srcBranch.name,
          destinationBranchName: destBranch.name,
        },
      });
    }
  );

  // 3. GET /api/stock-transfers/:id - Detail view with lines
  app.get(
    '/api/stock-transfers/:id',
    { preHandler: [requirePermission('inventory.transfer.view')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      if (!isValidUuid(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid transfer ID format',
        });
      }

      const [transfer] = await db
        .select()
        .from(stockTransfers)
        .where(and(eq(stockTransfers.id, id), eq(stockTransfers.pharmacyId, pharmacyId)));

      if (!transfer) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Stock transfer not found',
        });
      }

      const lines = await db
        .select({
          line: stockTransferLines,
          product: products,
          batch: batches,
        })
        .from(stockTransferLines)
        .innerJoin(products, eq(stockTransferLines.productId, products.id))
        .innerJoin(batches, eq(stockTransferLines.batchId, batches.id))
        .where(
          and(eq(stockTransferLines.transferId, id), eq(stockTransferLines.pharmacyId, pharmacyId))
        )
        .orderBy(asc(products.brandName));

      return reply.status(200).send({
        data: {
          ...transfer,
          lines: lines.map((l) => ({
            ...l.line,
            product: l.product,
            batch: l.batch,
          })),
        },
      });
    }
  );

  // 4. POST /api/stock-transfers/:id/dispatch - Mark in_transit and record transfer_out
  app.post(
    '/api/stock-transfers/:id/dispatch',
    { preHandler: [requirePermission('inventory.transfer.create')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      if (!isValidUuid(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid transfer ID format',
        });
      }

      const parsed = DispatchTransferSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid dispatch payload',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const [transfer] = await db
        .select()
        .from(stockTransfers)
        .where(and(eq(stockTransfers.id, id), eq(stockTransfers.pharmacyId, pharmacyId)));

      if (!transfer) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Stock transfer not found',
        });
      }

      if (transfer.status !== 'draft') {
        return reply.status(400).send({
          code: 'INVALID_STATUS',
          message: `Cannot dispatch transfer with status '${transfer.status}'. Must be 'draft'`,
        });
      }

      const existingLines = await db
        .select()
        .from(stockTransferLines)
        .where(
          and(eq(stockTransferLines.transferId, id), eq(stockTransferLines.pharmacyId, pharmacyId))
        );

      const lineMap = new Map(existingLines.map((l) => [l.id, l]));

      if (
        parsed.data.lines.length !== existingLines.length ||
        !existingLines.every((el) => parsed.data.lines.some((pl) => pl.lineId === el.id))
      ) {
        return reply.status(400).send({
          code: 'MISSING_TRANSFER_LINES',
          message: 'All transfer lines must be included in dispatch payload',
        });
      }

      for (const item of parsed.data.lines) {
        const line = lineMap.get(item.lineId)!;
        if (item.quantityDispatched > line.quantityRequested) {
          return reply.status(400).send({
            code: 'OVER_DISPATCH',
            message: `Dispatched quantity (${item.quantityDispatched}) cannot exceed requested quantity (${line.quantityRequested})`,
          });
        }

        const [stockRow] = await db
          .select({
            total: sql<number>`coalesce(sum(${stockMovements.quantitySigned}), 0)`,
          })
          .from(stockMovements)
          .where(
            and(
              eq(stockMovements.pharmacyId, pharmacyId),
              eq(stockMovements.branchId, transfer.sourceBranchId),
              eq(stockMovements.productId, line.productId),
              eq(stockMovements.batchId, line.batchId)
            )
          );
        const currentStock = Number(stockRow?.total || 0);
        if (currentStock < item.quantityDispatched) {
          return reply.status(400).send({
            code: 'INSUFFICIENT_STOCK',
            message: `Insufficient stock in source branch for batch ${line.batchId}: available ${currentStock}, dispatching ${item.quantityDispatched}`,
          });
        }
      }

      const now = new Date().toISOString();

      await db.transaction(async (tx) => {
        for (const item of parsed.data.lines) {
          const line = lineMap.get(item.lineId);
          if (!line) continue;

          const movementId = generateUuidV7();

          // Update transfer line with dispatched qty
          await tx
            .update(stockTransferLines)
            .set({
              quantityDispatched: item.quantityDispatched,
              dispatchMovementId: movementId,
              updatedAt: now,
            })
            .where(eq(stockTransferLines.id, line.id));

          // Insert transfer_out negative stock movement
          const moveData = {
            id: movementId,
            pharmacyId,
            productId: line.productId,
            batchId: line.batchId,
            branchId: transfer.sourceBranchId,
            locationId: transfer.sourceLocationId || null,
            type: 'transfer_out' as const,
            quantitySigned: -item.quantityDispatched,
            referenceType: 'stock_transfer',
            referenceId: transfer.id,
            reason: `Transfer Out: ${transfer.transferNumber}`,
            createdAt: now,
            updatedAt: now,
          };

          await tx.insert(stockMovements).values(moveData);

          await insertChangeLog(tx, {
            pharmacyId,
            branchId: transfer.sourceBranchId,
            entity: 'stock_movement',
            entityId: movementId,
            op: 'upsert',
            data: moveData,
            createdAt: now,
          });
        }

        // Update transfer to in_transit
        await tx
          .update(stockTransfers)
          .set({
            status: 'in_transit',
            dispatchedBy: user.userId,
            dispatchedAt: now,
            updatedAt: now,
          })
          .where(eq(stockTransfers.id, id));

        await insertChangeLog(tx, {
          pharmacyId,
          entity: 'stock_transfer',
          entityId: id,
          op: 'upsert',
          data: { id, status: 'in_transit', transferNumber: transfer.transferNumber },
          createdAt: now,
        });
      });

      return reply.status(200).send({
        data: {
          ...transfer,
          status: 'in_transit',
          dispatchedBy: user.userId,
          dispatchedAt: now,
        },
      });
    }
  );

  // 5. POST /api/stock-transfers/:id/receive - Mark received and record transfer_in & shortages
  app.post(
    '/api/stock-transfers/:id/receive',
    { preHandler: [requirePermission('inventory.transfer.create')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      if (!isValidUuid(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid transfer ID format',
        });
      }

      const parsed = ReceiveTransferSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid receive payload',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const [transfer] = await db
        .select()
        .from(stockTransfers)
        .where(and(eq(stockTransfers.id, id), eq(stockTransfers.pharmacyId, pharmacyId)));

      if (!transfer) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Stock transfer not found',
        });
      }

      if (transfer.status !== 'in_transit') {
        return reply.status(400).send({
          code: 'INVALID_STATUS',
          message: `Cannot receive transfer with status '${transfer.status}'. Must be 'in_transit'`,
        });
      }

      const existingLines = await db
        .select()
        .from(stockTransferLines)
        .where(
          and(eq(stockTransferLines.transferId, id), eq(stockTransferLines.pharmacyId, pharmacyId))
        );

      const lineMap = new Map(existingLines.map((l) => [l.id, l]));

      if (
        parsed.data.lines.length !== existingLines.length ||
        !existingLines.every((el) => parsed.data.lines.some((pl) => pl.lineId === el.id))
      ) {
        return reply.status(400).send({
          code: 'MISSING_TRANSFER_LINES',
          message: 'All transfer lines must be accounted for upon receipt',
        });
      }

      for (const item of parsed.data.lines) {
        const line = lineMap.get(item.lineId)!;
        if (item.quantityReceived + item.shortageQuantity !== line.quantityDispatched) {
          return reply.status(400).send({
            code: 'QUANTITY_MISMATCH',
            message: `Received quantity (${item.quantityReceived}) plus shortage quantity (${item.shortageQuantity}) must equal dispatched quantity (${line.quantityDispatched})`,
          });
        }
      }

      const now = new Date().toISOString();
      let hasShortage = false;

      const postingLines: Array<{
        batchId: string;
        quantityReceived: number;
        shortageQuantity?: number;
      }> = [];

      await db.transaction(async (tx) => {
        for (const item of parsed.data.lines) {
          const line = lineMap.get(item.lineId);
          if (!line) continue;

          const receiveMovementId = generateUuidV7();

          if (item.shortageQuantity > 0) {
            hasShortage = true;
          }

          postingLines.push({
            batchId: line.batchId,
            quantityReceived: item.quantityReceived,
            shortageQuantity: item.shortageQuantity,
          });

          await tx
            .update(stockTransferLines)
            .set({
              quantityReceived: item.quantityReceived,
              shortageQuantity: item.shortageQuantity,
              shortageReason: item.shortageReason || null,
              receiveMovementId,
              shortageMovementId: null,
              updatedAt: now,
            })
            .where(eq(stockTransferLines.id, line.id));

          // Transfer in movement at destination
          if (item.quantityReceived > 0) {
            const moveIn = {
              id: receiveMovementId,
              pharmacyId,
              productId: line.productId,
              batchId: line.batchId,
              branchId: transfer.destinationBranchId,
              locationId: transfer.destinationLocationId || null,
              type: 'transfer_in' as const,
              quantitySigned: item.quantityReceived,
              referenceType: 'stock_transfer',
              referenceId: transfer.id,
              reason: `Transfer In: ${transfer.transferNumber}`,
              createdAt: now,
              updatedAt: now,
            };

            await tx.insert(stockMovements).values(moveIn);

            await insertChangeLog(tx, {
              pharmacyId,
              branchId: transfer.destinationBranchId,
              entity: 'stock_movement',
              entityId: receiveMovementId,
              op: 'upsert',
              data: moveIn,
              createdAt: now,
            });
          }
        }

        // Mark transfer received
        await tx
          .update(stockTransfers)
          .set({
            status: 'received',
            receivedBy: user.userId,
            receivedAt: now,
            hasShortage,
            updatedAt: now,
          })
          .where(eq(stockTransfers.id, id));

        // Auto-post double-entry journal entry between branches
        await postStockTransferReceived(tx, {
          pharmacyId,
          sourceBranchId: transfer.sourceBranchId,
          destinationBranchId: transfer.destinationBranchId,
          transferId: transfer.id,
          transferNumber: transfer.transferNumber,
          createdBy: user.userId,
          lines: postingLines,
        });

        await insertChangeLog(tx, {
          pharmacyId,
          entity: 'stock_transfer',
          entityId: id,
          op: 'upsert',
          data: { id, status: 'received', hasShortage, receivedAt: now },
          createdAt: now,
        });
      });

      const updatedLines = await db
        .select()
        .from(stockTransferLines)
        .where(
          and(eq(stockTransferLines.transferId, id), eq(stockTransferLines.pharmacyId, pharmacyId))
        );

      return reply.status(200).send({
        data: {
          ...transfer,
          status: 'received',
          hasShortage,
          receivedBy: user.userId,
          receivedAt: now,
          lines: updatedLines,
        },
      });
    }
  );

  // 6. POST /api/stock-transfers/:id/cancel
  app.post(
    '/api/stock-transfers/:id/cancel',
    { preHandler: [requirePermission('inventory.transfer.create')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      if (!isValidUuid(id)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid transfer ID format',
        });
      }

      const [transfer] = await db
        .select()
        .from(stockTransfers)
        .where(and(eq(stockTransfers.id, id), eq(stockTransfers.pharmacyId, pharmacyId)));

      if (!transfer) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Stock transfer not found',
        });
      }

      if (transfer.status === 'received') {
        return reply.status(400).send({
          code: 'INVALID_STATUS',
          message: 'Cannot cancel a stock transfer that has already been received',
        });
      }

      const now = new Date().toISOString();

      await db.transaction(async (tx) => {
        // If in_transit, reverse the transfer_out movement
        if (transfer.status === 'in_transit') {
          const lines = await tx
            .select()
            .from(stockTransferLines)
            .where(
              and(
                eq(stockTransferLines.transferId, id),
                eq(stockTransferLines.pharmacyId, pharmacyId)
              )
            );

          for (const l of lines) {
            if (l.quantityDispatched > 0) {
              const reversalMoveId = generateUuidV7();
              const moveData = {
                id: reversalMoveId,
                pharmacyId,
                productId: l.productId,
                batchId: l.batchId,
                branchId: transfer.sourceBranchId,
                locationId: transfer.sourceLocationId || null,
                type: 'adjustment' as const,
                quantitySigned: l.quantityDispatched,
                referenceType: 'stock_transfer_cancellation',
                referenceId: transfer.id,
                reason: `Reversal for cancelled transfer: ${transfer.transferNumber}`,
                createdAt: now,
                updatedAt: now,
              };

              await tx.insert(stockMovements).values(moveData);

              await insertChangeLog(tx, {
                pharmacyId,
                branchId: transfer.sourceBranchId,
                entity: 'stock_movement',
                entityId: reversalMoveId,
                op: 'upsert',
                data: moveData,
                createdAt: now,
              });
            }
          }
        }

        await tx
          .update(stockTransfers)
          .set({
            status: 'cancelled',
            updatedAt: now,
          })
          .where(eq(stockTransfers.id, id));

        await insertChangeLog(tx, {
          pharmacyId,
          entity: 'stock_transfer',
          entityId: id,
          op: 'upsert',
          data: { id, status: 'cancelled' },
          createdAt: now,
        });
      });

      return reply.status(200).send({
        data: {
          ...transfer,
          status: 'cancelled',
          updatedAt: now,
        },
      });
    }
  );
};
