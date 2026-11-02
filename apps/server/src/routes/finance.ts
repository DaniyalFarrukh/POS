import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../auth/user-auth';

export const financeRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/finance/journals
   * General journal entry listing scoped to caller's pharmacy.
   */
  fastify.get(
    '/journals',
    {
      config: { requiredPermission: 'finance.journal.view' },
      preHandler: [requirePermission('finance.journal.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      return reply.status(200).send({
        items: [],
        pharmacyId: userContext.pharmacyId,
      });
    }
  );

  /**
   * POST /api/finance/journals
   * Create draft journal entry.
   */
  fastify.post(
    '/journals',
    {
      config: { requiredPermission: 'finance.journal.create' },
      preHandler: [requirePermission('finance.journal.create')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      return reply.status(201).send({
        ok: true,
        pharmacyId: userContext.pharmacyId,
      });
    }
  );

  /**
   * POST /api/finance/journals/:id/post
   * Post/approve journal entry.
   */
  fastify.post(
    '/journals/:id/post',
    {
      config: { requiredPermission: 'finance.journal.post' },
      preHandler: [requirePermission('finance.journal.post')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      return reply.status(200).send({
        ok: true,
        pharmacyId: userContext.pharmacyId,
      });
    }
  );

  /**
   * GET /api/finance/coa
   * Chart of accounts scoped to caller's pharmacy.
   */
  fastify.get(
    '/coa',
    {
      config: { requiredPermission: 'finance.coa.view' },
      preHandler: [requirePermission('finance.coa.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      return reply.status(200).send({
        items: [],
        pharmacyId: userContext.pharmacyId,
      });
    }
  );

  /**
   * GET /api/finance/reports/trial-balance
   * Trial Balance financial statement scoped to caller's pharmacy.
   */
  fastify.get(
    '/reports/trial-balance',
    {
      config: { requiredPermission: 'finance.reports.view' },
      preHandler: [requirePermission('finance.reports.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      return reply.status(200).send({
        items: [],
        pharmacyId: userContext.pharmacyId,
      });
    }
  );
};

