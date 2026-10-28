import type { FastifyPluginAsync } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { requireUserAuth } from '../auth/user-auth';
import {
  getSalesReport,
  getStockAndExpiryReport,
  getProfitPerBatchReport,
  getSupplierLedgerReport,
} from '../reports/queries';
import { branches, users } from '../db/schema';
import { getDb } from '../db';

interface SalesQuery {
  startDate?: string;
  endDate?: string;
  branchId?: string;
  cashierUserId?: string;
}

interface StockQuery {
  branchId?: string;
}

export const reportRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/reports/sales
   * Filterable sales by day/branch/cashier.
   */
  fastify.get<{ Querystring: SalesQuery }>(
    '/sales',
    { preHandler: [requireUserAuth(['owner', 'pharmacist'])] },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { startDate, endDate, branchId, cashierUserId } = request.query;

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
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { branchId } = request.query;

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
