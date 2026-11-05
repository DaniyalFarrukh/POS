import type { FastifyPluginAsync } from 'fastify';
import { z } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  getBudgets,
  batchUpsertBudgets,
  getActualVsBudget,
  copyPreviousYearBudget,
} from '../ledger/budget-service';

const GetBudgetsQuerySchema = z.object({
  fiscalYear: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
  branchId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
});

const BatchUpsertSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  branchId: z.string().uuid(),
  items: z.array(
    z.object({
      accountId: z.string().uuid(),
      month: z.number().int().min(1).max(12),
      amountPaisa: z.number().int().nonnegative(),
      notes: z.string().max(500).optional().nullable(),
    })
  ),
});

const ActualVsBudgetQuerySchema = z.object({
  fiscalYear: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
  branchId: z.string().uuid().optional(),
  accountType: z.enum(['expense', 'revenue']).optional(),
});

const CopyPreviousYearSchema = z.object({
  sourceYear: z.number().int().min(2000).max(2100),
  targetYear: z.number().int().min(2000).max(2100),
  branchId: z.string().uuid().optional(),
  percentageAdjustmentBp: z.number().int().min(-10000).max(100000).optional(),
  overwrite: z.boolean().optional(),
});

export const budgetRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. GET /api/finance/budgets - Get raw budget entries
  fastify.get(
    '/',
    {
      config: { requiredPermission: 'finance.budget.view' },
      preHandler: [requirePermission('finance.budget.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext;
      if (!userContext) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const parseRes = GetBudgetsQuerySchema.safeParse(request.query);
      if (!parseRes.success) {
        return reply.status(400).send({
          error: 'Validation error',
          details: parseRes.error.flatten(),
        });
      }

      const db = request.server.db || getDb();
      const rows = await getBudgets(db, userContext.pharmacyId, {
        fiscalYear: parseRes.data.fiscalYear,
        month: parseRes.data.month,
        branchId: parseRes.data.branchId,
        accountId: parseRes.data.accountId,
      });

      return reply.send({
        success: true,
        data: { budgets: rows },
      });
    }
  );

  // 2. POST /api/finance/budgets/batch - Save monthly budget items
  fastify.post(
    '/batch',
    {
      config: { requiredPermission: 'finance.budget.manage' },
      preHandler: [requirePermission('finance.budget.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext;
      if (!userContext) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const parseRes = BatchUpsertSchema.safeParse(request.body);
      if (!parseRes.success) {
        return reply.status(400).send({
          error: 'Validation error',
          details: parseRes.error.flatten(),
        });
      }

      const db = request.server.db || getDb();
      try {
        const result = await batchUpsertBudgets(db, {
          pharmacyId: userContext.pharmacyId,
          branchId: parseRes.data.branchId,
          fiscalYear: parseRes.data.fiscalYear,
          userId: userContext.userId,
          items: parseRes.data.items,
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to save budgets';
        return reply.status(400).send({
          error: message,
        });
      }
    }
  );

  // 3. GET /api/finance/budgets/actual-vs-budget - Actual vs Budget comparison & alerts
  fastify.get(
    '/actual-vs-budget',
    {
      config: { requiredPermission: 'finance.budget.view' },
      preHandler: [requirePermission('finance.budget.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext;
      if (!userContext) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const parseRes = ActualVsBudgetQuerySchema.safeParse(request.query);
      if (!parseRes.success) {
        return reply.status(400).send({
          error: 'Validation error',
          details: parseRes.error.flatten(),
        });
      }

      const db = request.server.db || getDb();
      try {
        const report = await getActualVsBudget(db, userContext.pharmacyId, {
          fiscalYear: parseRes.data.fiscalYear,
          month: parseRes.data.month,
          branchId: parseRes.data.branchId,
          accountType: parseRes.data.accountType,
        });

        return reply.send({
          success: true,
          data: report,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to compute actual vs budget';
        return reply.status(400).send({
          error: message,
        });
      }
    }
  );

  // 4. POST /api/finance/budgets/copy-previous-year - Copy last year's budget
  fastify.post(
    '/copy-previous-year',
    {
      config: { requiredPermission: 'finance.budget.manage' },
      preHandler: [requirePermission('finance.budget.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext;
      if (!userContext) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const parseRes = CopyPreviousYearSchema.safeParse(request.body);
      if (!parseRes.success) {
        return reply.status(400).send({
          error: 'Validation error',
          details: parseRes.error.flatten(),
        });
      }

      const db = request.server.db || getDb();
      try {
        const result = await copyPreviousYearBudget(db, {
          pharmacyId: userContext.pharmacyId,
          sourceYear: parseRes.data.sourceYear,
          targetYear: parseRes.data.targetYear,
          branchId: parseRes.data.branchId,
          percentageAdjustmentBp: parseRes.data.percentageAdjustmentBp,
          overwrite: parseRes.data.overwrite,
          userId: userContext.userId,
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to copy previous year budget';
        return reply.status(400).send({
          error: message,
        });
      }
    }
  );
};
