import type { FastifyPluginAsync } from 'fastify';
import { eq, and, desc, asc, ilike, or, inArray, sql } from 'drizzle-orm';
import { z, generateUuidV7, getKarachiBusinessDate } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  purchaseOrders,
  purchaseOrderLines,
  purchaseOrderReceipts,
  suppliers,
  products,
  branches,
  users,
  stockMovements,
  batches,
} from '../db/schema';
import { postPurchaseReceived } from '../ledger/posting-engine';
import { insertChangeLog } from '../sync/change-log';

const CreatePOLineSchema = z.object({
  productId: z.string().uuid(),
  quantityOrdered: z.number().int().min(1, 'Quantity must be at least 1'),
  expectedCostPaisa: z.number().int().min(0, 'Cost must be non-negative'),
});

const CreatePOSchema = z.object({
  supplierId: z.string().uuid(),
  branchId: z.string().uuid(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'issueDate must be YYYY-MM-DD'),
  expectedDeliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expectedDeliveryDate must be YYYY-MM-DD')
    .optional()
    .nullable(),
  overReceiptPolicy: z.enum(['reject', 'flag']).default('flag'),
  notes: z.string().optional().nullable(),
  lines: z.array(CreatePOLineSchema).min(1, 'At least one line item is required'),
});

const ReceivePOLineSchema = z.object({
  poLineId: z.string().uuid(),
  productId: z.string().uuid(),
  batchNo: z.string().trim().min(1, 'Batch number is required'),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be YYYY-MM-DD'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  costPaisa: z.number().int().min(0, 'Cost must be non-negative'),
  mrpPaisa: z.number().int().min(0, 'MRP must be non-negative'),
  batchId: z.string().uuid().optional(),
});

const ReceivePOSchema = z.object({
  supplierInvoiceNo: z.string().trim().min(1, 'Supplier invoice number is required'),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Receipt date must be YYYY-MM-DD'),
  lines: z.array(ReceivePOLineSchema).min(1, 'At least one line item is required'),
});

export const purchaseOrderRoutes: FastifyPluginAsync = async (app) => {
  // 1. GET /api/purchase-orders - List with status tabs and KPI summaries
  app.get(
    '/api/purchase-orders',
    { preHandler: [requirePermission('inventory.purchase_order.view')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const { status, supplierId, branchId, search } = request.query as {
        status?: string;
        supplierId?: string;
        branchId?: string;
        search?: string;
      };

      const conditions = [eq(purchaseOrders.pharmacyId, pharmacyId)];

      if (status && status !== 'all') {
        conditions.push(
          eq(
            purchaseOrders.status,
            status as
              'draft' | 'approved' | 'sent' | 'partially_received' | 'received' | 'cancelled'
          )
        );
      }
      if (supplierId) {
        conditions.push(eq(purchaseOrders.supplierId, supplierId));
      }
      if (branchId) {
        conditions.push(eq(purchaseOrders.branchId, branchId));
      }

      if (search && search.trim()) {
        const s = `%${search.trim()}%`;
        conditions.push(
          or(
            ilike(purchaseOrders.poNumber, s),
            ilike(purchaseOrders.notes, s),
            ilike(suppliers.name, s)
          )!
        );
      }

      const rows = await db
        .select({
          po: purchaseOrders,
          supplierName: suppliers.name,
          branchName: branches.name,
          creatorName: users.name,
        })
        .from(purchaseOrders)
        .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .innerJoin(branches, eq(purchaseOrders.branchId, branches.id))
        .leftJoin(users, eq(purchaseOrders.createdBy, users.id))
        .where(and(...conditions))
        .orderBy(desc(purchaseOrders.createdAt));

      // Calculate KPI aggregates for all POs of this pharmacy
      const allPharmacyPOs = await db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.pharmacyId, pharmacyId));

      const todayStr = getKarachiBusinessDate();

      let openCount = 0;
      let pendingApprovalCount = 0;
      let committedPaisa = 0;
      let overdueCount = 0;

      for (const p of allPharmacyPOs) {
        if (['draft', 'approved', 'sent', 'partially_received'].includes(p.status)) {
          openCount++;
        }
        if (p.status === 'draft') {
          pendingApprovalCount++;
        }
        if (['approved', 'sent', 'partially_received'].includes(p.status)) {
          committedPaisa += Number(p.totalExpectedCostPaisa);
        }
        if (
          ['approved', 'sent', 'partially_received'].includes(p.status) &&
          p.expectedDeliveryDate &&
          p.expectedDeliveryDate < todayStr
        ) {
          overdueCount++;
        }
      }

      const items = rows.map((r) => ({
        ...r.po,
        supplierName: r.supplierName,
        branchName: r.branchName,
        creatorName: r.creatorName,
      }));

      return reply.status(200).send({
        kpis: {
          openCount,
          pendingApprovalCount,
          committedPaisa,
          overdueCount,
        },
        items,
      });
    }
  );

  // 2. GET /api/purchase-orders/low-stock-suggestions
  app.get(
    '/api/purchase-orders/low-stock-suggestions',
    { preHandler: [requirePermission('inventory.purchase_order.view')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      // 1. Get all active products for this pharmacy
      const allProducts = await db
        .select()
        .from(products)
        .where(and(eq(products.pharmacyId, pharmacyId), eq(products.isActive, true)));

      // 2. Compute stock balances from stock_movements
      const stockSums = await db
        .select({
          productId: stockMovements.productId,
          totalStock: sql<number>`sum(${stockMovements.quantitySigned})`.mapWith(Number),
        })
        .from(stockMovements)
        .where(eq(stockMovements.pharmacyId, pharmacyId))
        .groupBy(stockMovements.productId);

      const stockMap = new Map<string, number>();
      for (const s of stockSums) {
        stockMap.set(s.productId, s.totalStock ?? 0);
      }

      // 3. Find products with stock <= reorderLevel
      const suggestions = [];
      for (const prod of allProducts) {
        const reorderLevel = prod.reorderLevel;
        if (reorderLevel <= 0) continue;

        const currentStock = stockMap.get(prod.id) ?? 0;
        if (currentStock <= reorderLevel) {
          const suggestedQuantity = Math.max(
            prod.reorderQuantity,
            reorderLevel - currentStock > 0 ? reorderLevel - currentStock : prod.reorderQuantity
          );

          suggestions.push({
            productId: prod.id,
            brandName: prod.brandName,
            genericName: prod.genericName,
            currentStock,
            reorderLevel,
            reorderQuantity: prod.reorderQuantity,
            suggestedQuantity,
            mrpPaisa: prod.mrpPaisa,
          });
        }
      }

      return reply.status(200).send({ items: suggestions });
    }
  );

  // 3. POST /api/purchase-orders - Create draft PO
  app.post(
    '/api/purchase-orders',
    { preHandler: [requirePermission('inventory.purchase_order.manage')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const parsed = CreatePOSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid purchase order payload',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const data = parsed.data;
      const now = new Date().toISOString();

      // Verify supplier exists in this pharmacy
      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, data.supplierId), eq(suppliers.pharmacyId, pharmacyId)));
      if (!supplier) {
        return reply.status(400).send({
          code: 'INVALID_SUPPLIER',
          message: 'Supplier does not exist for this pharmacy',
        });
      }

      // Verify branch exists in this pharmacy
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

      // Verify products exist (deduplicate productIds so duplicate local IDs cannot mask a foreign ID)
      const uniqueProductIds = Array.from(new Set(data.lines.map((l) => l.productId)));
      const matchedProducts = await db
        .select()
        .from(products)
        .where(and(eq(products.pharmacyId, pharmacyId), inArray(products.id, uniqueProductIds)));
      if (matchedProducts.length !== uniqueProductIds.length) {
        return reply.status(400).send({
          code: 'INVALID_PRODUCT',
          message: 'One or more products do not belong to this pharmacy',
        });
      }

      const poId = generateUuidV7();
      const year = new Date().getFullYear();

      // Get next sequential PO number for this pharmacy
      const [maxPo] = await db
        .select({ poNumber: purchaseOrders.poNumber })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.pharmacyId, pharmacyId))
        .orderBy(desc(purchaseOrders.poNumber))
        .limit(1);

      let seq = 1;
      if (maxPo && maxPo.poNumber) {
        const match = maxPo.poNumber.match(/-(\d+)$/);
        if (match && match[1]) {
          seq = parseInt(match[1], 10) + 1;
        }
      }
      const poNumber = `PO-${year}-${String(seq).padStart(4, '0')}`;

      let totalExpectedCostPaisa = 0;
      const linesToInsert = data.lines.map((l) => {
        const lineTotalPaisa = l.quantityOrdered * l.expectedCostPaisa;
        totalExpectedCostPaisa += lineTotalPaisa;
        return {
          id: generateUuidV7(),
          pharmacyId,
          purchaseOrderId: poId,
          productId: l.productId,
          quantityOrdered: l.quantityOrdered,
          quantityReceived: 0,
          expectedCostPaisa: l.expectedCostPaisa,
          totalCostPaisa: lineTotalPaisa,
          createdAt: now,
          updatedAt: now,
        };
      });

      const poRecord = {
        id: poId,
        pharmacyId,
        poNumber,
        supplierId: data.supplierId,
        branchId: data.branchId,
        status: 'draft' as const,
        overReceiptPolicy: data.overReceiptPolicy,
        issueDate: data.issueDate,
        expectedDeliveryDate: data.expectedDeliveryDate || null,
        totalExpectedCostPaisa,
        notes: data.notes || null,
        createdBy: user.userId,
        createdAt: now,
        updatedAt: now,
      };

      await db.transaction(async (tx) => {
        await tx.insert(purchaseOrders).values(poRecord);
        await tx.insert(purchaseOrderLines).values(linesToInsert);

        await insertChangeLog(tx, {
          pharmacyId,
          entity: 'purchase_order',
          entityId: poId,
          op: 'upsert',
          data: poRecord,
          createdAt: now,
        });
      });

      return reply.status(201).send({
        data: {
          ...poRecord,
          lines: linesToInsert,
          supplierName: supplier.name,
          branchName: branch.name,
        },
      });
    }
  );

  // 4. GET /api/purchase-orders/:id - Detail view with lines and receipts
  app.get(
    '/api/purchase-orders/:id',
    { preHandler: [requirePermission('inventory.purchase_order.view')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      const [poRow] = await db
        .select({
          po: purchaseOrders,
          supplier: suppliers,
          branch: branches,
          creator: {
            id: users.id,
            pharmacyId: users.pharmacyId,
            name: users.name,
            role: users.role,
            isActive: users.isActive,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
          },
        })
        .from(purchaseOrders)
        .innerJoin(
          suppliers,
          and(eq(purchaseOrders.supplierId, suppliers.id), eq(suppliers.pharmacyId, pharmacyId))
        )
        .innerJoin(
          branches,
          and(eq(purchaseOrders.branchId, branches.id), eq(branches.pharmacyId, pharmacyId))
        )
        .leftJoin(
          users,
          and(eq(purchaseOrders.createdBy, users.id), eq(users.pharmacyId, pharmacyId))
        )
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.pharmacyId, pharmacyId)));

      if (!poRow) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Purchase order not found',
        });
      }

      const lines = await db
        .select({
          line: purchaseOrderLines,
          product: products,
        })
        .from(purchaseOrderLines)
        .innerJoin(products, eq(purchaseOrderLines.productId, products.id))
        .where(
          and(
            eq(purchaseOrderLines.purchaseOrderId, id),
            eq(purchaseOrderLines.pharmacyId, pharmacyId)
          )
        )
        .orderBy(asc(products.brandName));

      const receipts = await db
        .select()
        .from(purchaseOrderReceipts)
        .where(
          and(
            eq(purchaseOrderReceipts.purchaseOrderId, id),
            eq(purchaseOrderReceipts.pharmacyId, pharmacyId)
          )
        )
        .orderBy(asc(purchaseOrderReceipts.createdAt));

      return reply.status(200).send({
        data: {
          ...poRow.po,
          supplier: poRow.supplier,
          branch: poRow.branch,
          creator: poRow.creator,
          lines: lines.map((l) => ({
            ...l.line,
            product: l.product,
          })),
          receipts,
        },
      });
    }
  );

  // 5. POST /api/purchase-orders/:id/approve - Approve draft (Manager or Owner strictly)
  app.post(
    '/api/purchase-orders/:id/approve',
    { preHandler: [requirePermission('inventory.purchase_order.manage')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      // Strictly owner or manager required
      if (user.role !== 'owner' && user.role !== 'manager') {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'Only managers or owners can approve purchase orders',
        });
      }

      const [po] = await db
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.pharmacyId, pharmacyId)));

      if (!po) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Purchase order not found',
        });
      }

      if (po.status !== 'draft') {
        return reply.status(400).send({
          code: 'INVALID_STATUS',
          message: `Cannot approve PO with status '${po.status}'. Must be 'draft'`,
        });
      }

      const now = new Date().toISOString();
      const [updated] = await db
        .update(purchaseOrders)
        .set({
          status: 'approved',
          approvedBy: user.userId,
          approvedAt: now,
          updatedAt: now,
        })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.pharmacyId, pharmacyId)))
        .returning();

      return reply.status(200).send({ data: updated });
    }
  );

  // 6. POST /api/purchase-orders/:id/send - Mark as sent
  app.post(
    '/api/purchase-orders/:id/send',
    { preHandler: [requirePermission('inventory.purchase_order.manage')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      const [po] = await db
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.pharmacyId, pharmacyId)));

      if (!po) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Purchase order not found',
        });
      }

      if (po.status !== 'approved') {
        return reply.status(400).send({
          code: 'INVALID_STATUS',
          message: `Cannot send PO with status '${po.status}'. Must be 'approved'`,
        });
      }

      const now = new Date().toISOString();
      const [updated] = await db
        .update(purchaseOrders)
        .set({
          status: 'sent',
          updatedAt: now,
        })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.pharmacyId, pharmacyId)))
        .returning();

      return reply.status(200).send({ data: updated });
    }
  );

  // 7. POST /api/purchase-orders/:id/cancel - Cancel PO
  app.post(
    '/api/purchase-orders/:id/cancel',
    { preHandler: [requirePermission('inventory.purchase_order.manage')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      const [po] = await db
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.pharmacyId, pharmacyId)));

      if (!po) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Purchase order not found',
        });
      }

      if (po.status === 'received' || po.status === 'partially_received') {
        return reply.status(400).send({
          code: 'INVALID_STATUS',
          message: 'Cannot cancel a purchase order that has already received deliveries',
        });
      }

      const now = new Date().toISOString();
      const [updated] = await db
        .update(purchaseOrders)
        .set({
          status: 'cancelled',
          updatedAt: now,
        })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.pharmacyId, pharmacyId)))
        .returning();

      return reply.status(200).send({ data: updated });
    }
  );

  // 8. POST /api/purchase-orders/:id/receive - Goods Received against PO
  app.post(
    '/api/purchase-orders/:id/receive',
    { preHandler: [requirePermission('inventory.grn.create')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      const parsed = ReceivePOSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid receipt payload',
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const [po] = await db
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.pharmacyId, pharmacyId)));

      if (!po) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Purchase order not found',
        });
      }

      if (!['approved', 'sent', 'partially_received'].includes(po.status)) {
        return reply.status(400).send({
          code: 'INVALID_STATUS',
          message: `Cannot receive against PO with status '${po.status}'. Must be approved, sent, or partially_received`,
        });
      }

      const existingLines = await db
        .select()
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.purchaseOrderId, id),
            eq(purchaseOrderLines.pharmacyId, pharmacyId)
          )
        );

      const lineMap = new Map(existingLines.map((l) => [l.id, l]));

      // Check over-receipt policy and productId alignment
      const data = parsed.data;
      for (const item of data.lines) {
        const line = lineMap.get(item.poLineId);
        if (!line) {
          return reply.status(400).send({
            code: 'INVALID_LINE',
            message: `PO Line '${item.poLineId}' does not belong to this purchase order`,
          });
        }

        if (item.productId !== line.productId) {
          return reply.status(400).send({
            code: 'INVALID_PRODUCT',
            message: `Product '${item.productId}' does not match PO line product '${line.productId}'`,
          });
        }

        if (item.batchId) {
          const [crossBatch] = await db
            .select({ id: batches.id, pharmacyId: batches.pharmacyId })
            .from(batches)
            .where(eq(batches.id, item.batchId))
            .limit(1);
          if (crossBatch && crossBatch.pharmacyId !== pharmacyId) {
            return reply.status(400).send({
              code: 'INVALID_BATCH',
              message: 'Batch ID belongs to another pharmacy tenant',
            });
          }
        }

        if (po.overReceiptPolicy === 'reject') {
          if (line.quantityReceived + item.quantity > line.quantityOrdered) {
            return reply.status(400).send({
              code: 'OVER_RECEIPT_REJECTED',
              message: `Over-receipt rejected by policy: product quantity (${line.quantityReceived + item.quantity}) exceeds ordered quantity (${line.quantityOrdered})`,
            });
          }
        }
      }

      const receiptId = generateUuidV7();
      const now = new Date().toISOString();

      let deliveryTotalCostPaisa = 0;
      const batchesToInsert: Array<{
        id: string;
        pharmacyId: string;
        productId: string;
        batchNo: string;
        expiryDate: string;
        costPaisa: number;
        mrpPaisa: number;
        createdAt: string;
        updatedAt: string;
      }> = [];

      const payloadBatches: Array<{
        id: string;
        productId: string;
        batchNo: string;
        expiryDate: string;
        costPaisa: number;
        mrpPaisa: number;
      }> = [];

      const payloadLines: Array<{
        id: string;
        productId: string;
        batchId: string;
        quantity: number;
        costPaisa: number;
        mrpPaisa: number;
        movementId: string;
      }> = [];

      for (const item of data.lines) {
        const batchId = item.batchId ?? generateUuidV7();
        const movementId = generateUuidV7();
        const lineTotal = item.quantity * item.costPaisa;
        deliveryTotalCostPaisa += lineTotal;

        batchesToInsert.push({
          id: batchId,
          pharmacyId,
          productId: item.productId,
          batchNo: item.batchNo,
          expiryDate: item.expiryDate,
          costPaisa: item.costPaisa,
          mrpPaisa: item.mrpPaisa,
          createdAt: now,
          updatedAt: now,
        });

        payloadBatches.push({
          id: batchId,
          productId: item.productId,
          batchNo: item.batchNo,
          expiryDate: item.expiryDate,
          costPaisa: item.costPaisa,
          mrpPaisa: item.mrpPaisa,
        });

        payloadLines.push({
          id: generateUuidV7(),
          productId: item.productId,
          batchId,
          quantity: item.quantity,
          costPaisa: item.costPaisa,
          mrpPaisa: item.mrpPaisa,
          movementId,
        });
      }

      let updatedPOStatus: 'partially_received' | 'received' = 'partially_received';

      await db.transaction(async (tx) => {
        // 1. Insert batches
        for (const b of batchesToInsert) {
          const [existingBatch] = await tx
            .select()
            .from(batches)
            .where(and(eq(batches.id, b.id), eq(batches.pharmacyId, pharmacyId)));
          if (!existingBatch) {
            await tx.insert(batches).values(b);
            await insertChangeLog(tx, {
              pharmacyId,
              branchId: po.branchId,
              entity: 'batch',
              entityId: b.id,
              op: 'upsert',
              data: b,
              createdAt: now,
            });
          }
        }

        // 2. Insert stock movements
        for (const line of payloadLines) {
          const movementData = {
            id: line.movementId,
            pharmacyId,
            productId: line.productId,
            batchId: line.batchId,
            branchId: po.branchId,
            type: 'purchase' as const,
            quantitySigned: line.quantity,
            referenceType: 'purchase',
            referenceId: receiptId,
            reason: `PO GRN: ${data.supplierInvoiceNo} (PO #${po.poNumber})`,
            createdAt: now,
            updatedAt: now,
          };

          await tx.insert(stockMovements).values(movementData);

          await insertChangeLog(tx, {
            pharmacyId,
            branchId: po.branchId,
            entity: 'stock_movement',
            entityId: line.movementId,
            op: 'upsert',
            data: movementData,
            createdAt: now,
          });
        }

        // 3. Post double-entry accounting journal entry
        await postPurchaseReceived(tx, {
          pharmacyId,
          createdBy: user.userId,
          payload: {
            purchase: {
              id: receiptId,
              branchId: po.branchId,
              supplierId: po.supplierId,
              supplierInvoiceNo: data.supplierInvoiceNo,
              invoiceDate: data.receiptDate,
              totalCostPaisa: deliveryTotalCostPaisa,
              taxPaisa: 0,
              createdByUserId: user.userId,
              createdAt: now,
            },
            batches: payloadBatches,
            lines: payloadLines,
          },
        });

        // 4. Update purchase order lines quantityReceived
        for (const item of data.lines) {
          const line = lineMap.get(item.poLineId)!;
          const newQty = line.quantityReceived + item.quantity;
          line.quantityReceived = newQty; // update local

          await tx
            .update(purchaseOrderLines)
            .set({
              quantityReceived: newQty,
              updatedAt: now,
            })
            .where(
              and(eq(purchaseOrderLines.id, line.id), eq(purchaseOrderLines.pharmacyId, pharmacyId))
            );
        }

        // 5. Determine overall PO status
        const isAllFulfilled = Array.from(lineMap.values()).every(
          (l) => l.quantityReceived >= l.quantityOrdered
        );
        updatedPOStatus = isAllFulfilled ? 'received' : 'partially_received';

        await tx
          .update(purchaseOrders)
          .set({
            status: updatedPOStatus,
            updatedAt: now,
          })
          .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.pharmacyId, pharmacyId)));

        // 6. Record purchase order receipt linking row
        await tx.insert(purchaseOrderReceipts).values({
          id: generateUuidV7(),
          pharmacyId,
          purchaseOrderId: id,
          receiptReferenceId: receiptId,
          supplierInvoiceNo: data.supplierInvoiceNo,
          receiptDate: data.receiptDate,
          totalCostPaisa: deliveryTotalCostPaisa,
          createdBy: user.userId,
          createdAt: now,
        });
      });

      // Fetch fresh PO with updated lines
      const updatedLines = await db
        .select()
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.purchaseOrderId, id),
            eq(purchaseOrderLines.pharmacyId, pharmacyId)
          )
        );

      return reply.status(200).send({
        receiptId,
        purchaseOrder: {
          ...po,
          status: updatedPOStatus,
          lines: updatedLines,
        },
      });
    }
  );
};
