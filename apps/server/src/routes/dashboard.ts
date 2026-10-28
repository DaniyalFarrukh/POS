import type { FastifyPluginAsync } from 'fastify';
import { getKarachiBusinessDate } from '@pos/shared';
import { requireUserAuth } from '../auth/user-auth';
import { getDashboardOverview } from '../reports/queries';
import { getDb } from '../db';

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/dashboard/overview
   * Returns executive KPIs: today's sales paisa, invoice count, top products, expiring soon, low stock.
   */
  fastify.get(
    '/overview',
    { preHandler: [requireUserAuth(['owner', 'pharmacist'])] },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const today = getKarachiBusinessDate();
      const overview = await getDashboardOverview(db, userContext.pharmacyId, today);

      return reply.status(200).send(overview);
    }
  );
};
