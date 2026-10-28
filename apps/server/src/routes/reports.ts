import type { FastifyPluginAsync } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { z } from '@pos/shared';
import { requireUserAuth } from '../auth/user-auth';
import {
  getSalesReport,
  getStockAndExpiryReport,
  getProfitPerBatchReport,
  getSupplierLedgerReport,
} from '../reports/queries';
import { branches, users } from '../db/schema';
import { getDb } from '../db';

const SalesQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Invalid startDate format').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Invalid endDate format').optional(),
  branchId: z.string().uuid('Invalid branchId format').optional(),
  cashierUserId: z.string().uuid('Invalid cashierUserId format').optional(),
});

const StockQuerySchema = z.object({
  branchId: z.string().uuid('Invalid branchId format').optional(),
});

type SalesQuery = z.infer<typeof SalesQuerySchema>;
type StockQuery = z.infer<typeof StockQuerySchema>;

export const reportRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/reports/sales
   * Filterable sales by day/branch/cashier.
   */
  fastify.get<{ Querystring: SalesQuery }>(
    '/sales',
    { preHandler: [requireUserAuth(['owner', 'pharmacist'])] },
    async (request, reply) => {
      const parsedQuery = SalesQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsedQuery.error.issues[0]?.message || 'Invalid query parameters',
        });
      }

      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { startDate, endDate, branchId, cashierUserId } = parsedQuery.data;

      if (branchId) {
        const [branch] = await db
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.id, branchId), eq(branches.pharmacyId, userContext.pharmacyId)))
          .limit(1);

        if (!branch) {
          return reply.status(404).send({ statusCode: 404, message: 'Branch not found or belongs to another pharmacy' });
        }
      }

      if (cashierUserId) {
        const [user] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, cashierUserId), eq(users.pharmacyId, userContext.pharmacyId)))
          .limit(1);

        if (!user) {
          return reply.status(404).send({ statusCode: 404, message: 'Cashier user not found or belongs to another pharmacy' });
        }
      }

      const result = await getSalesReport(db, {
        pharmacyId: userContext.pharmacyId,
        startDate,
        endDate,
        branchId,
        cashierUserId,
      });

      return reply.status(200).send(result);
    }
  );

  /**
   * GET /api/reports/stock-and-expiry
   * Cross-branch stock and batch expiry status.
   */
  fastify.get<{ Querystring: StockQuery }>(
    '/stock-and-expiry',
    { preHandler: [requireUserAuth(['owner', 'pharmacist'])] },
    async (request, reply) => {
      const parsedQuery = StockQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsedQuery.error.issues[0]?.message || 'Invalid query parameters',
        });
      }

      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { branchId } = parsedQuery.data;

      if (branchId) {
        const [branch] = await db
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.id, branchId), eq(branches.pharmacyId, userContext.pharmacyId)))
          .limit(1);

        if (!branch) {
          return reply.status(404).send({ statusCode: 404, message: 'Branch not found or belongs to another pharmacy' });
        }
      }

      const result = await getStockAndExpiryReport(
        db,
        userContext.pharmacyId,
        branchId
      );

      return reply.status(200).send({ items: result });
    }
  );

  /**
   * GET /api/reports/profit-per-batch
   * Gross profit per batch (sale price minus batch cost in integer paisa).
   * Restricted to owner role only.
   */
  fastify.get(
    '/profit-per-batch',
    { preHandler: [requireUserAuth(['owner'])] },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const result = await getProfitPerBatchReport(db, userContext.pharmacyId);

      return reply.status(200).send({ items: result });
    }
  );

  /**
   * GET /api/reports/supplier-ledger
   * Purchase breakdown, quantities, and total spend per supplier.
   * Restricted to owner role only.
   */
  fastify.get(
    '/supplier-ledger',
    { preHandler: [requireUserAuth(['owner'])] },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const result = await getSupplierLedgerReport(db, userContext.pharmacyId);

      return reply.status(200).send({ items: result });
    }
  );
};
