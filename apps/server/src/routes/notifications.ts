import type { FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  refreshSystemNotifications,
} from '../services/notification-service';

export const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  const authMeGuard = requirePermission('auth.me.view');

  /**
   * GET /api/notifications
   * List user notifications with unread count
   */
  fastify.get('/', { preHandler: [authMeGuard] }, async (request, reply) => {
    const userContext = request.userContext!;
    const db = request.server.db || getDb();

    // Dynamically refresh system notifications (expiring stock, sync exceptions, period close)
    await refreshSystemNotifications(db, userContext.pharmacyId, userContext.userId);

    const result = await getUserNotifications(db, userContext.pharmacyId, userContext.userId);
    return reply.status(200).send(result);
  });

  /**
   * PATCH /api/notifications/:id/read
   * Mark a single notification as read
   */
  fastify.patch<{ Params: { id: string } }>(
    '/:id/read',
    { preHandler: [authMeGuard] },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.status(400).send({ statusCode: 400, message: 'Invalid notification ID format' });
      }

      const updated = await markNotificationAsRead(
        db,
        userContext.pharmacyId,
        userContext.userId,
        id
      );
      if (!updated) {
        return reply.status(404).send({ statusCode: 404, message: 'Notification not found' });
      }

      return reply.status(200).send({ success: true, id });
    }
  );

  /**
   * POST /api/notifications/mark-all-read
   * Mark all unread notifications as read
   */
  fastify.post('/mark-all-read', { preHandler: [authMeGuard] }, async (request, reply) => {
    const userContext = request.userContext!;
    const db = request.server.db || getDb();

    const markedCount = await markAllNotificationsAsRead(
      db,
      userContext.pharmacyId,
      userContext.userId
    );
    return reply.status(200).send({ success: true, markedCount });
  });

  /**
   * POST /api/notifications/refresh
   * Manually re-evaluate business state
   */
  fastify.post('/refresh', { preHandler: [authMeGuard] }, async (request, reply) => {
    const userContext = request.userContext!;
    const db = request.server.db || getDb();

    const createdCount = await refreshSystemNotifications(
      db,
      userContext.pharmacyId,
      userContext.userId
    );
    const result = await getUserNotifications(db, userContext.pharmacyId, userContext.userId);
    return reply.status(200).send({ success: true, createdCount, ...result });
  });
};
