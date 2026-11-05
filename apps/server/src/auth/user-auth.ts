import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { users } from '../db/schema';
import { getDb } from '../db';
import { verifyUserToken, type UserTokenPayload } from './jwt';
import { hasPermission, type AppPermission, type UserRole } from '@pos/shared';

export interface UserContext {
  userId: string;
  pharmacyId: string;
  role: UserRole;
  name: string;
  jti?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    userContext?: UserContext;
  }
  interface FastifyContextConfig {
    requiredPermission?: AppPermission;
  }
}

/**
 * Creates a Fastify preHandler hook enforcing that the authenticated user possesses the declared permission.
 * 1. Verifies Bearer JWT user token.
 * 2. Checks active status in database.
 * 3. Enforces permission from the shared ERP permission matrix.
 * 4. Attaches verified tenancy context (request.userContext).
 */
export function requirePermission(permission: AppPermission) {
  const handler = async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header',
      });
      return;
    }

    const token = authHeader.slice(7).trim();

    let payload: UserTokenPayload;
    try {
      payload = verifyUserToken(token);
    } catch {
      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or expired session token',
      });
      return;
    }

    const db = request.server.db || getDb();

    try {
      const [user] = await db
        .select({
          id: users.id,
          pharmacyId: users.pharmacyId,
          role: users.role,
          name: users.name,
          isActive: users.isActive,
        })
        .from(users)
        .where(and(eq(users.id, payload.userId), eq(users.pharmacyId, payload.pharmacyId)))
        .limit(1);

      if (!user) {
        reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'User account not found or tenant mismatch',
        });
        return;
      }

      if (!user.isActive) {
        reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'User account is inactive',
        });
        return;
      }

      const role = user.role as UserRole;
      if (!hasPermission(role, permission)) {
        reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: `Insufficient permissions: user role '${role}' lacks permission '${permission}'`,
        });
        return;
      }

      request.userContext = {
        userId: user.id,
        pharmacyId: user.pharmacyId,
        role,
        name: user.name,
        ...(payload.jti ? { jti: payload.jti } : {}),
      };
    } catch (err) {
      request.log.error({ err }, 'Error during user auth verification');
      reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Database error verifying user session',
      });
    }
  };

  (handler as { requiredPermission?: AppPermission }).requiredPermission = permission;
  return handler;
}
