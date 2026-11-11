import type { FastifyPluginAsync } from 'fastify';
import { eq, and, sql, desc } from 'drizzle-orm';
import { z, generateUuidV7, getKarachiBusinessDate } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  products,
  batches,
  stockLocations,
  stockMovements,
  branches,
  journalLines,
  accounts,
} from '../db/schema';
import { postStockAdjustmentCreated } from '../ledger/posting-engine';

const StockQuerySchema = z.object({
  view: z.enum(['product', 'batch']).default('product'),
  branchId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  search: z.string().optional(),
  status: z.enum(['all', 'low_stock', 'near_expiry', 'expired']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'stock', 'stockValue', 'expiry']).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

const ExpiringBatchesQuerySchema = z.object({
  window: z.enum(['30', '60', '90', 'expired', 'all']).default('all'),
  branchId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const DiscountBatchSchema = z.object({
  mrpPaisa: z.number().int().min(0, 'mrpPaisa must be non-negative integer'),
  reason: z.string().optional(),
});

const WriteOffBatchSchema = z.object({
  branchId: z.string().uuid('branchId must be a valid UUID'),
  locationId: z.string().uuid().optional(),
  quantity: z.number().int().min(1, 'quantity must be at least 1'),
  reason: z.string().min(1, 'reason is required'),
});

export const stockRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/inventory/stock
   * Paginated stock per product or per batch with filters and reconciliation KPIs
   */
  fastify.get(
    '/stock',
    { preHandler: [requirePermission('inventory.stock.view')] },
    async (request, reply) => {
      const parsed = StockQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid query parameters',
        });
      }

      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const { view, branchId, locationId, search, status, page, pageSize, sortBy, sortOrder } =
        parsed.data;

      const now = new Date();
      const nowIsoDate = getKarachiBusinessDate(now);
      const in90DaysDate = getKarachiBusinessDate(new Date(now.getTime() + 90 * 86400 * 1000));

      // --- 1. Compute Pharmacy-Wide Inventory & Reconciliation KPIs ---
      // 1a. Batch on-hand stock and total valuation
      const batchStockBalances = await db
        .select({
          batchId: stockMovements.batchId,
          productId: stockMovements.productId,
          branchId: stockMovements.branchId,
          locationId: stockMovements.locationId,
          onHand: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`.mapWith(Number),
          costPaisa: batches.costPaisa,
          mrpPaisa: batches.mrpPaisa,
          batchNo: batches.batchNo,
          expiryDate: batches.expiryDate,
        })
        .from(stockMovements)
        .innerJoin(
          batches,
          and(eq(stockMovements.batchId, batches.id), eq(batches.pharmacyId, pharmacyId))
        )
        .where(eq(stockMovements.pharmacyId, pharmacyId))
        .groupBy(
          stockMovements.batchId,
          stockMovements.productId,
          stockMovements.branchId,
          stockMovements.locationId,
          batches.costPaisa,
          batches.mrpPaisa,
          batches.batchNo,
          batches.expiryDate
        );

      let totalStockValuePaisa = 0;
      let nearExpiryCount = 0;
      let expiredCount = 0;

      // Track positive on-hand batches for KPIs
      for (const row of batchStockBalances) {
        if (row.onHand > 0) {
          totalStockValuePaisa += row.onHand * row.costPaisa;
          if (row.expiryDate < nowIsoDate) {
            expiredCount++;
          } else if (row.expiryDate <= in90DaysDate) {
            nearExpiryCount++;
          }
        }
      }

      // 1b. General Ledger Balance for Account 1200 Inventory
      const [inventoryAccount] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.pharmacyId, pharmacyId), eq(accounts.code, '1200')));

      let ledgerInventoryBalancePaisa = 0;
      if (inventoryAccount) {
        const [ledgerBalRow] = await db
          .select({
            balance:
              sql<number>`COALESCE(SUM(${journalLines.debitPaisa} - ${journalLines.creditPaisa}), 0)`.mapWith(
                Number
              ),
          })
          .from(journalLines)
          .where(
            and(
              eq(journalLines.pharmacyId, pharmacyId),
              eq(journalLines.accountId, inventoryAccount.id)
            )
          );
        ledgerInventoryBalancePaisa = ledgerBalRow?.balance ?? 0;
      }

      // Reconciliation difference
      const reconciliationDifferencePaisa = totalStockValuePaisa - ledgerInventoryBalancePaisa;

      // 1c. Low Stock Count across products
      const allPharmacyProducts = await db
        .select({
          id: products.id,
          reorderLevel: products.reorderLevel,
        })
        .from(products)
        .where(and(eq(products.pharmacyId, pharmacyId), eq(products.isActive, true)));

      // Aggregate on-hand per product across all branches
      const onHandByProduct = new Map<string, number>();
      for (const row of batchStockBalances) {
        onHandByProduct.set(row.productId, (onHandByProduct.get(row.productId) || 0) + row.onHand);
      }

      let lowStockCount = 0;
      for (const prod of allPharmacyProducts) {
        const stock = onHandByProduct.get(prod.id) || 0;
        if (stock <= prod.reorderLevel) {
          lowStockCount++;
        }
      }

      const kpis = {
        totalStockValuePaisa,
        ledgerInventoryBalancePaisa,
        reconciliationDifferencePaisa,
        lowStockCount,
        nearExpiryCount,
        expiredCount,
      };

      // --- 2. Build Filtered and Paginated Items ---
      if (view === 'product') {
        // Fetch products with their metadata
        const query = db
          .select({
            id: products.id,
            brandName: products.brandName,
            genericName: products.genericName,
            strength: products.strength,
            form: products.form,
            manufacturer: products.manufacturer,
            barcode: products.barcode,
            reorderLevel: products.reorderLevel,
            reorderQuantity: products.reorderQuantity,
            mrpPaisa: products.mrpPaisa,
            isActive: products.isActive,
          })
          .from(products)
          .where(eq(products.pharmacyId, pharmacyId))
          .$dynamic();

        const productRows = await query;

        // Apply filters in memory or SQL
        // Group batch balances filtered by branch/location if specified
        const productValuationMap = new Map<
          string,
          {
            totalStock: number;
            stockValuePaisa: number;
            hasNearExpiry: boolean;
            hasExpired: boolean;
          }
        >();

        for (const b of batchStockBalances) {
          if (branchId && b.branchId !== branchId) continue;
          if (locationId && b.locationId !== locationId) continue;

          const existing = productValuationMap.get(b.productId) || {
            totalStock: 0,
            stockValuePaisa: 0,
            hasNearExpiry: false,
            hasExpired: false,
          };

          existing.totalStock += b.onHand;
          if (b.onHand > 0) {
            existing.stockValuePaisa += b.onHand * b.costPaisa;
            if (b.expiryDate < nowIsoDate) existing.hasExpired = true;
            else if (b.expiryDate <= in90DaysDate) existing.hasNearExpiry = true;
          }

          productValuationMap.set(b.productId, existing);
        }

        let items = productRows.map((prod) => {
          const stats = productValuationMap.get(prod.id) || {
            totalStock: 0,
            stockValuePaisa: 0,
            hasNearExpiry: false,
            hasExpired: false,
          };
          const isLowStock = stats.totalStock <= prod.reorderLevel;

          return {
            ...prod,
            totalStock: stats.totalStock,
            stockValuePaisa: stats.stockValuePaisa,
            isLowStock,
            hasNearExpiry: stats.hasNearExpiry,
            hasExpired: stats.hasExpired,
          };
        });

        // Search filter
        if (search && search.trim()) {
          const s = search.toLowerCase().trim();
          items = items.filter(
            (p) =>
              p.brandName.toLowerCase().includes(s) ||
              (p.genericName && p.genericName.toLowerCase().includes(s)) ||
              (p.barcode && p.barcode.toLowerCase().includes(s))
          );
        }

        // Status filter
        if (status === 'low_stock') {
          items = items.filter((p) => p.isLowStock);
        } else if (status === 'near_expiry') {
          items = items.filter((p) => p.hasNearExpiry);
        } else if (status === 'expired') {
          items = items.filter((p) => p.hasExpired);
        }

        // Sorting
        if (sortBy === 'name') {
          items.sort((a, b) =>
            sortOrder === 'desc'
              ? b.brandName.localeCompare(a.brandName)
              : a.brandName.localeCompare(b.brandName)
          );
        } else if (sortBy === 'stock') {
          items.sort((a, b) =>
            sortOrder === 'desc' ? b.totalStock - a.totalStock : a.totalStock - b.totalStock
          );
        } else if (sortBy === 'stockValue') {
          items.sort((a, b) =>
            sortOrder === 'desc'
              ? b.stockValuePaisa - a.stockValuePaisa
              : a.stockValuePaisa - b.stockValuePaisa
          );
        }

        const total = items.length;
        const totalPages = Math.ceil(total / pageSize) || 1;
        const paginatedItems = items.slice((page - 1) * pageSize, page * pageSize);

        return reply.send({
          success: true,
          data: {
            items: paginatedItems,
            pagination: { page, pageSize, total, totalPages },
            kpis,
          },
        });
      } else {
        // View === 'batch'
        // Join batches with products, branches, stockLocations
        const allBranches = await db
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(eq(branches.pharmacyId, pharmacyId));
        const branchMap = new Map(allBranches.map((b) => [b.id, b.name]));

        const allLocations = await db
          .select({ id: stockLocations.id, name: stockLocations.name })
          .from(stockLocations)
          .where(eq(stockLocations.pharmacyId, pharmacyId));
        const locMap = new Map(allLocations.map((l) => [l.id, l.name]));

        const prodDetails = await db
          .select({
            id: products.id,
            brandName: products.brandName,
            genericName: products.genericName,
            barcode: products.barcode,
          })
          .from(products)
          .where(eq(products.pharmacyId, pharmacyId));
        const prodInfoMap = new Map(prodDetails.map((p) => [p.id, p]));

        let batchItems = batchStockBalances.map((b) => {
          const prod = prodInfoMap.get(b.productId);
          const daysUntilExpiry = Math.ceil(
            (new Date(b.expiryDate).getTime() - now.getTime()) / (86400 * 1000)
          );
          const isExpired = b.expiryDate < nowIsoDate;
          const isNearExpiry = !isExpired && b.expiryDate <= in90DaysDate;

          return {
            batchId: b.batchId,
            batchNo: b.batchNo,
            productId: b.productId,
            productName: prod?.brandName || 'Unknown Product',
            genericName: prod?.genericName || null,
            barcode: prod?.barcode || null,
            branchId: b.branchId,
            branchName: branchMap.get(b.branchId) || 'Unknown Branch',
            locationId: b.locationId,
            locationName: b.locationId ? locMap.get(b.locationId) || null : null,
            expiryDate: b.expiryDate,
            daysUntilExpiry,
            costPaisa: b.costPaisa,
            mrpPaisa: b.mrpPaisa,
            onHandQuantity: b.onHand,
            stockValuePaisa: b.onHand > 0 ? b.onHand * b.costPaisa : 0,
            isExpired,
            isNearExpiry,
          };
        });

        // Apply filters
        if (branchId) {
          batchItems = batchItems.filter((b) => b.branchId === branchId);
        }
        if (locationId) {
          batchItems = batchItems.filter((b) => b.locationId === locationId);
        }
        if (search && search.trim()) {
          const s = search.toLowerCase().trim();
          batchItems = batchItems.filter(
            (b) =>
              b.batchNo.toLowerCase().includes(s) ||
              b.productName.toLowerCase().includes(s) ||
              (b.genericName && b.genericName.toLowerCase().includes(s)) ||
              (b.barcode && b.barcode.toLowerCase().includes(s))
          );
        }
        if (status === 'near_expiry') {
          batchItems = batchItems.filter((b) => b.isNearExpiry && b.onHandQuantity > 0);
        } else if (status === 'expired') {
          batchItems = batchItems.filter((b) => b.isExpired && b.onHandQuantity > 0);
        }

        // Sorting
        if (sortBy === 'expiry') {
          batchItems.sort((a, b) =>
            sortOrder === 'desc'
              ? b.expiryDate.localeCompare(a.expiryDate)
              : a.expiryDate.localeCompare(b.expiryDate)
          );
        } else if (sortBy === 'stock') {
          batchItems.sort((a, b) =>
            sortOrder === 'desc'
              ? b.onHandQuantity - a.onHandQuantity
              : a.onHandQuantity - b.onHandQuantity
          );
        } else if (sortBy === 'stockValue') {
          batchItems.sort((a, b) =>
            sortOrder === 'desc'
              ? b.stockValuePaisa - a.stockValuePaisa
              : a.stockValuePaisa - b.stockValuePaisa
          );
        }

        const total = batchItems.length;
        const totalPages = Math.ceil(total / pageSize) || 1;
        const paginatedItems = batchItems.slice((page - 1) * pageSize, page * pageSize);

        return reply.send({
          success: true,
          data: {
            items: paginatedItems,
            pagination: { page, pageSize, total, totalPages },
            kpis,
          },
        });
      }
    }
  );

  /**
   * GET /api/inventory/batches/expiring
   * Expiring batches filtered by timeframe (30, 60, 90 days, or expired) with days remaining
   */
  fastify.get(
    '/batches/expiring',
    { preHandler: [requirePermission('inventory.batch.view')] },
    async (request, reply) => {
      const parsed = ExpiringBatchesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid query parameters',
        });
      }

      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const { window: timeWindow, branchId, locationId, search, page, pageSize } = parsed.data;

      const now = new Date();
      const nowIsoDate = getKarachiBusinessDate(now);
      const in30Date = getKarachiBusinessDate(new Date(now.getTime() + 30 * 86400 * 1000));
      const in60Date = getKarachiBusinessDate(new Date(now.getTime() + 60 * 86400 * 1000));
      const in90Date = getKarachiBusinessDate(new Date(now.getTime() + 90 * 86400 * 1000));

      // Fetch on-hand batches with product, branch, and location details
      const batchRows = await db
        .select({
          batchId: stockMovements.batchId,
          productId: stockMovements.productId,
          branchId: stockMovements.branchId,
          locationId: stockMovements.locationId,
          onHandQuantity: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`.mapWith(
            Number
          ),
          batchNo: batches.batchNo,
          expiryDate: batches.expiryDate,
          costPaisa: batches.costPaisa,
          mrpPaisa: batches.mrpPaisa,
          productName: products.brandName,
          genericName: products.genericName,
          barcode: products.barcode,
          branchName: branches.name,
          locationName: stockLocations.name,
        })
        .from(stockMovements)
        .innerJoin(
          batches,
          and(eq(stockMovements.batchId, batches.id), eq(batches.pharmacyId, pharmacyId))
        )
        .innerJoin(
          products,
          and(eq(stockMovements.productId, products.id), eq(products.pharmacyId, pharmacyId))
        )
        .innerJoin(
          branches,
          and(eq(stockMovements.branchId, branches.id), eq(branches.pharmacyId, pharmacyId))
        )
        .leftJoin(
          stockLocations,
          and(
            eq(stockMovements.locationId, stockLocations.id),
            eq(stockLocations.pharmacyId, pharmacyId)
          )
        )
        .where(eq(stockMovements.pharmacyId, pharmacyId))
        .groupBy(
          stockMovements.batchId,
          stockMovements.productId,
          stockMovements.branchId,
          stockMovements.locationId,
          batches.batchNo,
          batches.expiryDate,
          batches.costPaisa,
          batches.mrpPaisa,
          products.brandName,
          products.genericName,
          products.barcode,
          branches.name,
          stockLocations.name
        );

      let expired = 0;
      let expiring30 = 0;
      let expiring60 = 0;
      let expiring90 = 0;
      let totalExpiringValuePaisa = 0;

      // Filter only batches with onHand > 0
      const activeExpiringBatches = [];

      for (const b of batchRows) {
        if (b.onHandQuantity <= 0) continue;

        const daysUntilExpiry = Math.ceil(
          (new Date(b.expiryDate).getTime() - now.getTime()) / (86400 * 1000)
        );
        const stockValuePaisa = b.onHandQuantity * b.costPaisa;

        let bucket: 'expired' | '30' | '60' | '90' | 'distant' = 'distant';
        if (b.expiryDate < nowIsoDate) {
          bucket = 'expired';
          expired++;
          totalExpiringValuePaisa += stockValuePaisa;
        } else if (b.expiryDate <= in30Date) {
          bucket = '30';
          expiring30++;
          totalExpiringValuePaisa += stockValuePaisa;
        } else if (b.expiryDate <= in60Date) {
          bucket = '60';
          expiring60++;
          totalExpiringValuePaisa += stockValuePaisa;
        } else if (b.expiryDate <= in90Date) {
          bucket = '90';
          expiring90++;
          totalExpiringValuePaisa += stockValuePaisa;
        }

        if (bucket !== 'distant') {
          activeExpiringBatches.push({
            ...b,
            daysUntilExpiry,
            stockValuePaisa,
            bucket,
          });
        }
      }

      // Filter by selected window
      let filtered = activeExpiringBatches;
      if (timeWindow === 'expired') {
        filtered = filtered.filter((b) => b.bucket === 'expired');
      } else if (timeWindow === '30') {
        filtered = filtered.filter((b) => b.bucket === '30');
      } else if (timeWindow === '60') {
        filtered = filtered.filter((b) => b.bucket === '60');
      } else if (timeWindow === '90') {
        filtered = filtered.filter((b) => b.bucket === '90');
      }

      // Filter by branch / location
      if (branchId) {
        filtered = filtered.filter((b) => b.branchId === branchId);
      }
      if (locationId) {
        filtered = filtered.filter((b) => b.locationId === locationId);
      }

      // Search
      if (search && search.trim()) {
        const s = search.toLowerCase().trim();
        filtered = filtered.filter(
          (b) =>
            b.batchNo.toLowerCase().includes(s) ||
            b.productName.toLowerCase().includes(s) ||
            (b.genericName && b.genericName.toLowerCase().includes(s)) ||
            (b.barcode && b.barcode.toLowerCase().includes(s))
        );
      }

      // Order by expiry date ascending (most critical first)
      filtered.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

      const total = filtered.length;
      const totalPages = Math.ceil(total / pageSize) || 1;
      const items = filtered.slice((page - 1) * pageSize, page * pageSize);

      return reply.send({
        success: true,
        data: {
          items,
          pagination: { page, pageSize, total, totalPages },
          summary: {
            expired,
            expiring30,
            expiring60,
            expiring90,
            totalExpiringCount: expired + expiring30 + expiring60 + expiring90,
            totalExpiringValuePaisa,
          },
        },
      });
    }
  );

  /**
   * POST /api/inventory/batches/:id/discount
   * Adjust MRP / sale price of a batch (e.g. Markdown for near-expiry batch)
   */
  fastify.post<{ Params: { id: string } }>(
    '/batches/:id/discount',
    { preHandler: [requirePermission('inventory.batch.manage')] },
    async (request, reply) => {
      const batchId = request.params.id;
      const parsed = DiscountBatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid discount payload',
        });
      }

      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const { mrpPaisa } = parsed.data;

      const [batch] = await db
        .select()
        .from(batches)
        .where(and(eq(batches.id, batchId), eq(batches.pharmacyId, pharmacyId)));

      if (!batch) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Batch not found or belongs to another pharmacy',
        });
      }

      const nowIso = new Date().toISOString();
      await db
        .update(batches)
        .set({
          mrpPaisa,
          updatedAt: nowIso,
        })
        .where(and(eq(batches.id, batchId), eq(batches.pharmacyId, pharmacyId)));

      return reply.send({
        success: true,
        data: {
          id: batch.id,
          batchNo: batch.batchNo,
          previousMrpPaisa: batch.mrpPaisa,
          mrpPaisa,
          updatedAt: nowIso,
        },
      });
    }
  );

  /**
   * POST /api/inventory/batches/:id/write-off
   * Write off expired/damaged batch stock with negative stock movement and balanced GL posting
   */
  fastify.post<{ Params: { id: string } }>(
    '/batches/:id/write-off',
    { preHandler: [requirePermission('inventory.stock.manage')] },
    async (request, reply) => {
      const batchId = request.params.id;
      const parsed = WriteOffBatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid write-off payload',
        });
      }

      const { pharmacyId, userId } = request.userContext!;
      const db = request.server.db || getDb();
      const { branchId, locationId, quantity, reason } = parsed.data;

      const [batch] = await db
        .select()
        .from(batches)
        .where(and(eq(batches.id, batchId), eq(batches.pharmacyId, pharmacyId)));

      if (!batch) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Batch not found or belongs to another pharmacy',
        });
      }

      const [branch] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.pharmacyId, pharmacyId)));

      if (!branch) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Branch not found or belongs to another pharmacy',
        });
      }

      if (locationId) {
        const [loc] = await db
          .select({ id: stockLocations.id })
          .from(stockLocations)
          .where(and(eq(stockLocations.id, locationId), eq(stockLocations.pharmacyId, pharmacyId)));
        if (!loc) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: 'Location not found or belongs to another pharmacy',
          });
        }
      }

      // Check current on-hand quantity for this batch at this branch/location
      const [balRow] = await db
        .select({
          balance: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`.mapWith(Number),
        })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.pharmacyId, pharmacyId),
            eq(stockMovements.batchId, batchId),
            eq(stockMovements.branchId, branchId),
            locationId ? eq(stockMovements.locationId, locationId) : sql`true`
          )
        );

      const onHand = balRow?.balance ?? 0;
      if (quantity > onHand) {
        return reply.status(400).send({
          statusCode: 400,
          code: 'CANNOT_WRITE_OFF_MORE_THAN_ON_HAND',
          message: `Cannot write off ${quantity} units. Current on-hand quantity is ${onHand}.`,
        });
      }

      const now = new Date().toISOString();
      const movementId = generateUuidV7();
      const writtenOffValuePaisa = quantity * batch.costPaisa;

      let journalEntryId: string | undefined;

      try {
        await db.transaction(async (tx) => {
          // 1. Insert negative stock movement
          await tx.insert(stockMovements).values({
            id: movementId,
            pharmacyId,
            productId: batch.productId,
            batchId: batch.id,
            branchId,
            locationId: locationId || null,
            type: 'adjustment',
            quantitySigned: -quantity,
            referenceType: 'write_off',
            referenceId: movementId,
            reason,
            createdAt: now,
            updatedAt: now,
          });

          // 2. Auto-post balanced journal entry:
          // Dr 5010 Stock Adjustments and Write-offs
          // Cr 1200 Inventory
          const entry = await postStockAdjustmentCreated(tx, {
            pharmacyId,
            movementId,
            branchId,
            productId: batch.productId,
            batchId: batch.id,
            quantitySigned: -quantity,
            reason,
            createdAt: now,
            createdBy: userId,
          });

          journalEntryId = entry.id;
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Internal server error',
        });
      }

      return reply.send({
        success: true,
        data: {
          movementId,
          journalEntryId,
          batchId: batch.id,
          writtenOffQuantity: quantity,
          writtenOffValuePaisa,
        },
      });
    }
  );

  /**
   * GET /api/inventory/products/:id/stock-detail
   * Product details with on-hand batches and chronological stock movements timeline
   */
  fastify.get<{ Params: { id: string }; Querystring: { branchId?: string } }>(
    '/products/:id/stock-detail',
    { preHandler: [requirePermission('inventory.product.view')] },
    async (request, reply) => {
      const productId = request.params.id;
      const { pharmacyId } = request.userContext!;
      const { branchId } = request.query;
      const db = request.server.db || getDb();

      const [product] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, productId), eq(products.pharmacyId, pharmacyId)));

      if (!product) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Product not found or belongs to another pharmacy',
        });
      }

      // Fetch all batches for this product with their current on-hand stock
      const batchRows = await db
        .select({
          batchId: stockMovements.batchId,
          branchId: stockMovements.branchId,
          locationId: stockMovements.locationId,
          onHand: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`.mapWith(Number),
          batchNo: batches.batchNo,
          expiryDate: batches.expiryDate,
          costPaisa: batches.costPaisa,
          mrpPaisa: batches.mrpPaisa,
          branchName: branches.name,
          locationName: stockLocations.name,
        })
        .from(stockMovements)
        .innerJoin(
          batches,
          and(eq(stockMovements.batchId, batches.id), eq(batches.pharmacyId, pharmacyId))
        )
        .innerJoin(
          branches,
          and(eq(stockMovements.branchId, branches.id), eq(branches.pharmacyId, pharmacyId))
        )
        .leftJoin(
          stockLocations,
          and(
            eq(stockMovements.locationId, stockLocations.id),
            eq(stockLocations.pharmacyId, pharmacyId)
          )
        )
        .where(
          and(
            eq(stockMovements.pharmacyId, pharmacyId),
            eq(stockMovements.productId, productId),
            branchId ? eq(stockMovements.branchId, branchId) : sql`true`
          )
        )
        .groupBy(
          stockMovements.batchId,
          stockMovements.branchId,
          stockMovements.locationId,
          batches.batchNo,
          batches.expiryDate,
          batches.costPaisa,
          batches.mrpPaisa,
          branches.name,
          stockLocations.name
        );

      let totalStock = 0;
      let totalStockValuePaisa = 0;
      const nowIsoDate = getKarachiBusinessDate();

      const enrichedBatches = batchRows.map((b) => {
        totalStock += b.onHand;
        if (b.onHand > 0) {
          totalStockValuePaisa += b.onHand * b.costPaisa;
        }
        return {
          id: b.batchId,
          batchNo: b.batchNo,
          expiryDate: b.expiryDate,
          costPaisa: b.costPaisa,
          mrpPaisa: b.mrpPaisa,
          onHandQuantity: b.onHand,
          branchId: b.branchId,
          branchName: b.branchName,
          locationId: b.locationId,
          locationName: b.locationName,
          isExpired: b.expiryDate < nowIsoDate,
        };
      });

      // Stock movements timeline for this product
      const movements = await db
        .select({
          id: stockMovements.id,
          type: stockMovements.type,
          quantitySigned: stockMovements.quantitySigned,
          referenceType: stockMovements.referenceType,
          referenceId: stockMovements.referenceId,
          reason: stockMovements.reason,
          createdAt: stockMovements.createdAt,
          batchId: stockMovements.batchId,
          batchNo: batches.batchNo,
          branchId: stockMovements.branchId,
          branchName: branches.name,
          locationName: stockLocations.name,
        })
        .from(stockMovements)
        .innerJoin(
          batches,
          and(eq(stockMovements.batchId, batches.id), eq(batches.pharmacyId, pharmacyId))
        )
        .innerJoin(
          branches,
          and(eq(stockMovements.branchId, branches.id), eq(branches.pharmacyId, pharmacyId))
        )
        .leftJoin(
          stockLocations,
          and(
            eq(stockMovements.locationId, stockLocations.id),
            eq(stockLocations.pharmacyId, pharmacyId)
          )
        )
        .where(
          and(
            eq(stockMovements.pharmacyId, pharmacyId),
            eq(stockMovements.productId, productId),
            branchId ? eq(stockMovements.branchId, branchId) : sql`true`
          )
        )
        .orderBy(desc(stockMovements.createdAt));

      return reply.send({
        success: true,
        data: {
          product: {
            ...product,
            totalStock,
            totalStockValuePaisa,
            isLowStock: totalStock <= product.reorderLevel,
          },
          batches: enrichedBatches,
          movements,
        },
      });
    }
  );
};
