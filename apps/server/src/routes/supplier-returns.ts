import type { FastifyPluginAsync } from 'fastify';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { z, generateUuidV7 } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  supplierReturns,
  supplierReturnLines,
  stockMovements,
  branches,
  suppliers,
  products,
  batches,
  users,
} from '../db/schema';
import { insertChangeLog } from '../sync/change-log';
import { postSupplierReturnCompleted } from '../ledger/posting-engine';

const CreateReturnLineSchema = z.object({
  productId: z.string().uuid(),
  batchId: z.string().uuid(),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  reason: z.string().optional().nullable(),
});

const CreateSupplierReturnSchema = z.object({
  branchId: z.string().uuid(),
  supplierId: z.string().uuid(),
  reason: z.string().min(1, 'Return reason is required'),
  notes: z.string().optional().nullable(),
  lines: z.array(CreateReturnLineSchema).min(1, 'At least one line is required'),
});

export const supplierReturnRoutes: FastifyPluginAsync = async (app) => {
  // 1. GET /api/supplier-returns - List with filters & KPIs
  app.get(
    '/api/supplier-returns',
    { preHandler: [requirePermission('inventory.supplier_return.view')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const { branchId, supplierId, status } = request.query as {
        branchId?: string;
        supplierId?: string;
        status?: string;
      };

      const conditions = [eq(supplierReturns.pharmacyId, pharmacyId)];
      if (branchId) conditions.push(eq(supplierReturns.branchId, branchId));
      if (supplierId) conditions.push(eq(supplierReturns.supplierId, supplierId));
      if (status && status !== 'all') {
        conditions.push(eq(supplierReturns.status, status as 'draft' | 'completed' | 'cancelled'));
      }

      const rows = await db
        .select({
          returnRecord: supplierReturns,
          branchName: branches.name,
          supplierName: suppliers.name,
          createdByName: users.name,
        })
        .from(supplierReturns)
        .innerJoin(branches, eq(supplierReturns.branchId, branches.id))
        .innerJoin(suppliers, eq(supplierReturns.supplierId, suppliers.id))
        .leftJoin(users, eq(supplierReturns.createdBy, users.id))
        .where(and(...conditions))
        .orderBy(desc(supplierReturns.createdAt));

      return reply.status(200).send({
        items: rows.map((r) => ({
          ...r.returnRecord,
          branchName: r.branchName,
          supplierName: r.supplierName,
          createdByName: r.createdByName,
        })),
      });
    }
  );

  // 2. POST /api/supplier-returns - Create and complete supplier return & debit note
  app.post(
    '/api/supplier-returns',
    { preHandler: [requirePermission('inventory.supplier_return.create')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const parsed = CreateSupplierReturnSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid supplier return payload',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const { branchId, supplierId, reason, notes, lines: inputLines } = parsed.data;

      // Verify branch and supplier belong to pharmacy
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

      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, supplierId), eq(suppliers.pharmacyId, pharmacyId)));
      if (!supplier) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Supplier not found',
        });
      }

      // Check on-hand stock for each batch: CANNOT return more than on hand
      for (const line of inputLines) {
        const [balRow] = await db
          .select({
            balance: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`.mapWith(
              Number
            ),
          })
          .from(stockMovements)
          .where(
            and(
              eq(stockMovements.pharmacyId, pharmacyId),
              eq(stockMovements.branchId, branchId),
              eq(stockMovements.batchId, line.batchId)
            )
          );

        const onHand = balRow?.balance ?? 0;
        if (line.quantity > onHand) {
          return reply.status(400).send({
            code: 'CANNOT_RETURN_MORE_THAN_ON_HAND',
            message: `Cannot return ${line.quantity} units of batch ${line.batchId}. Current on-hand quantity is ${onHand}.`,
          });
        }
      }

      const now = new Date().toISOString();
      const returnDate = now.slice(0, 10);
      const returnId = generateUuidV7();

      // Sequential human readable identifiers: SR-YYYYMM-XXXX and DN-YYYYMM-XXXX
      const datePrefix = `${now.slice(0, 4)}${now.slice(5, 7)}`;
      const countRows = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(supplierReturns)
        .where(eq(supplierReturns.pharmacyId, pharmacyId));
      const existingCount = countRows[0]?.count ?? 0;

      const seqNumber = String(existingCount + 1).padStart(4, '0');
      const returnNumber = `SR-${datePrefix}-${seqNumber}`;
      const debitNoteNumber = `DN-${datePrefix}-${seqNumber}`;

      let subtotalPaisa = 0;
      const totalTaxPaisa = 0;

      const preparedLines: Array<{
        id: string;
        productId: string;
        batchId: string;
        quantity: number;
        unitCostPaisa: number;
        taxRateBp: number;
        taxPaisa: number;
        totalPaisa: number;
        movementId: string;
        reason?: string | null;
      }> = [];

      for (const line of inputLines) {
        const [batch] = await db
          .select()
          .from(batches)
          .where(and(eq(batches.id, line.batchId), eq(batches.pharmacyId, pharmacyId)));

        if (!batch) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: `Batch ${line.batchId} not found`,
          });
        }

        const lineCostPaisa = line.quantity * batch.costPaisa;
        subtotalPaisa += lineCostPaisa;
        const movementId = generateUuidV7();

        preparedLines.push({
          id: generateUuidV7(),
          productId: line.productId,
          batchId: line.batchId,
          quantity: line.quantity,
          unitCostPaisa: batch.costPaisa,
          taxRateBp: 0,
          taxPaisa: 0,
          totalPaisa: lineCostPaisa,
          movementId,
          reason: line.reason || null,
        });
      }

      const totalPaisa = subtotalPaisa + totalTaxPaisa;

      await db.transaction(async (tx) => {
        // 1. Insert header
        await tx.insert(supplierReturns).values({
          id: returnId,
          pharmacyId,
          branchId,
          supplierId,
          returnNumber,
          debitNoteNumber,
          returnDate,
          status: 'completed',
          subtotalPaisa,
          taxPaisa: totalTaxPaisa,
          totalPaisa,
          reason,
          notes: notes || null,
          createdBy: user.userId,
          createdAt: now,
          updatedAt: now,
        });

        // 2. Insert lines and stock movements (negative quantity for supplier return)
        for (const line of preparedLines) {
          await tx.insert(supplierReturnLines).values({
            id: line.id,
            pharmacyId,
            returnId,
            productId: line.productId,
            batchId: line.batchId,
            quantity: line.quantity,
            unitCostPaisa: line.unitCostPaisa,
            taxRateBp: line.taxRateBp,
            taxPaisa: line.taxPaisa,
            totalPaisa: line.totalPaisa,
            movementId: line.movementId,
            reason: line.reason || null,
            createdAt: now,
            updatedAt: now,
          });

          const moveData = {
            id: line.movementId,
            pharmacyId,
            productId: line.productId,
            batchId: line.batchId,
            branchId,
            type: 'return' as const,
            quantitySigned: -line.quantity,
            referenceType: 'supplier_return',
            referenceId: returnId,
            reason: `Supplier Return: ${returnNumber}`,
            createdAt: now,
            updatedAt: now,
          };

          await tx.insert(stockMovements).values(moveData);

          await insertChangeLog(tx, {
            pharmacyId,
            branchId,
            entity: 'stock_movement',
            entityId: line.movementId,
            op: 'upsert',
            data: moveData,
            createdAt: now,
          });
        }

        // 3. Post Debit Note journal entry reducing Accounts Payable
        await postSupplierReturnCompleted(tx, {
          pharmacyId,
          branchId,
          supplierId,
          returnId,
          returnNumber,
          debitNoteNumber,
          subtotalPaisa,
          taxPaisa: totalTaxPaisa,
          totalPaisa,
          returnDate,
          createdBy: user.userId,
        });
      });

      const [created] = await db
        .select()
        .from(supplierReturns)
        .where(eq(supplierReturns.id, returnId));

      return reply.status(201).send({
        data: {
          ...created,
          lines: preparedLines,
        },
      });
    }
  );

  // 3. GET /api/supplier-returns/:id - Detail view
  app.get(
    '/api/supplier-returns/:id',
    { preHandler: [requirePermission('inventory.supplier_return.view')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      const [returnRecord] = await db
        .select({
          returnRecord: supplierReturns,
          branchName: branches.name,
          supplierName: suppliers.name,
          createdByName: users.name,
        })
        .from(supplierReturns)
        .innerJoin(branches, eq(supplierReturns.branchId, branches.id))
        .innerJoin(suppliers, eq(supplierReturns.supplierId, suppliers.id))
        .leftJoin(users, eq(supplierReturns.createdBy, users.id))
        .where(and(eq(supplierReturns.id, id), eq(supplierReturns.pharmacyId, pharmacyId)));

      if (!returnRecord) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Supplier return not found',
        });
      }

      const lines = await db
        .select({
          line: supplierReturnLines,
          product: products,
          batch: batches,
        })
        .from(supplierReturnLines)
        .innerJoin(products, eq(supplierReturnLines.productId, products.id))
        .innerJoin(batches, eq(supplierReturnLines.batchId, batches.id))
        .where(
          and(eq(supplierReturnLines.returnId, id), eq(supplierReturnLines.pharmacyId, pharmacyId))
        )
        .orderBy(asc(products.brandName));

      return reply.status(200).send({
        data: {
          ...returnRecord.returnRecord,
          branchName: returnRecord.branchName,
          supplierName: returnRecord.supplierName,
          createdByName: returnRecord.createdByName,
          lines: lines.map((l) => ({
            ...l.line,
            product: l.product,
            batch: l.batch,
          })),
        },
      });
    }
  );
};
