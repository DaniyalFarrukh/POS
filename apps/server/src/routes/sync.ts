import type { FastifyPluginAsync } from 'fastify';
import {
  SyncPushRequestSchema,
  SyncPullQuerySchema,
  type SyncPushResponse,
  type SyncPullResponse,
} from '@pos/shared';
import { requireDeviceAuth } from '../auth/device-auth';
import { processSyncPushEvents } from '../sync/service';
import { pullChangeLog } from '../sync/pull-service';
import { getDb } from '../db';

export const syncRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /sync/push
   * Synchronizes counter outbox events into the central database.
   * - Validates envelope with shared zod schema (max 100 events).
   * - Device identity & tenancy strictly from verified JWT (request.deviceContext).
   * - Each event processes in its own transaction (idempotency, appliers, change_log).
   * - Returns per-event results in the exact same order.
   */
  fastify.post<{ Reply: SyncPushResponse }>(
    '/push',
    {
      preHandler: [requireDeviceAuth],
    },
    async (request, reply) => {
      const parseResult = SyncPushRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          // @ts-expect-error custom error payload for 400
          statusCode: 400,
          error: 'Bad Request',
          message: parseResult.error.issues[0]?.message || 'Invalid sync push request payload',
        });
      }

      const db = request.server.db || getDb();
      const deviceCtx = request.deviceContext;

      const results = await processSyncPushEvents(
        db,
        {
          pharmacyId: deviceCtx.pharmacyId,
          branchId: deviceCtx.branchId,
          deviceId: deviceCtx.deviceId,
        },
        parseResult.data.events
      );

      return reply.status(200).send({ results });
    }
  );

  /**
   * GET /sync/pull?cursor=<int>&limit=<int, max 500>
   * Returns central changes from change_log for this pharmacy.
   * - Cursor starts at 0.
   * - Default limit 200, max 500.
   * - Branch-scoped changes filtered by device branch.
   * - Gap-free pagination via nextCursor and hasMore.
   */
  fastify.get<{
    Querystring: { cursor?: string | number; limit?: string | number };
    Reply: SyncPullResponse;
  }>(
    '/pull',
    {
      preHandler: [requireDeviceAuth],
    },
    async (request, reply) => {
      const parseResult = SyncPullQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          // @ts-expect-error custom error payload for 400
          statusCode: 400,
          error: 'Bad Request',
          message: parseResult.error.issues[0]?.message || 'Invalid cursor or limit parameter',
        });
      }

      const db = request.server.db || getDb();
      const deviceCtx = request.deviceContext;

      const response = await pullChangeLog(
        db,
        {
          pharmacyId: deviceCtx.pharmacyId,
          branchId: deviceCtx.branchId,
        },
        parseResult.data
      );

      return reply.status(200).send(response);
    }
  );
};
