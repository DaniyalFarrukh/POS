import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { users } from '../db/schema';
import { getDb } from '../db';
import { verifyUserToken, type UserTokenPayload } from './jwt';

export interface UserContext {
  userId: string;
  pharmacyId: string;
  role: 'owner' | 'pharmacist' | 'cashier';
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    userContext?: UserContext;
  }
}

/**
 * Creates a Fastify preHandler hook for user authentication and role-based access control (RBAC).
 * 1. Verifies Bearer JWT user token.
 * 2. Checks active status in database.
 * 3. Enforces permitted roles (default: ['owner']).
 * 4. Attaches verified tenancy context (request.userContext).
 */
export function requireUserAuth(
  allowedRoles: Array<'owner' | 'pharmacist' | 'cashier'> = ['owner']
) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
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

      if (!allowedRoles.includes(user.role)) {
        reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: `Insufficient permissions: required one of [${allowedRoles.join(', ')}], found ${user.role}`,
        });
        return;
      }

      request.userContext = {
        userId: user.id,
        pharmacyId: user.pharmacyId,
        role: user.role,
        name: user.name,
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
}
