import type { FastifyPluginAsync } from 'fastify';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { users, pharmacies } from '../db/schema';
import { signUserToken } from '../auth/jwt';
import { requireUserAuth } from '../auth/user-auth';
import { getDb } from '../db';

interface LoginBody {
  name?: string;
  pin?: string;
  pharmacyId?: string;
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/auth/login
   * Authenticates user against users table using username and PIN hash.
   */
  fastify.post<{ Body: LoginBody }>('/login', async (request, reply) => {
    const { name, pin, pharmacyId } = request.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Username / Name is required',
      });
    }

    if (!pin || typeof pin !== 'string' || !pin.trim()) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'PIN is required',
      });
    }

    const db = request.server.db || getDb();

    const conditions = [eq(users.name, name.trim())];
    if (pharmacyId) {
      conditions.push(eq(users.pharmacyId, pharmacyId));
    }

    const matchingUsers = await db
      .select({
        id: users.id,
        pharmacyId: users.pharmacyId,
        name: users.name,
        role: users.role,
        pinHash: users.pinHash,
        isActive: users.isActive,
      })
      .from(users)
      .where(and(...conditions))
      .limit(1);

    const user = matchingUsers[0];

    if (!user) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid credentials',
      });
    }

    if (!user.isActive) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Account has been deactivated. Please contact the administrator.',
      });
    }

    const isMatch = bcrypt.compareSync(pin.trim(), user.pinHash);
    if (!isMatch) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid credentials',
      });
    }

    // Fetch pharmacy name
    const [pharmacy] = await db
      .select({ name: pharmacies.name })
      .from(pharmacies)
      .where(eq(pharmacies.id, user.pharmacyId))
      .limit(1);

    const token = signUserToken({
      userId: user.id,
      pharmacyId: user.pharmacyId,
      role: user.role,
      name: user.name,
    });

    return reply.status(200).send({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        pharmacyId: user.pharmacyId,
        pharmacyName: pharmacy?.name ?? 'Pharmacy',
      },
    });
  });

  /**
   * GET /api/auth/me
   * Returns current authenticated user and tenancy context.
   */
  fastify.get(
    '/me',
    { preHandler: [requireUserAuth(['owner', 'pharmacist', 'cashier'])] },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const [pharmacy] = await db
        .select({ name: pharmacies.name })
        .from(pharmacies)
        .where(eq(pharmacies.id, userContext.pharmacyId))
        .limit(1);

      return reply.status(200).send({
        user: {
          ...userContext,
          pharmacyName: pharmacy?.name ?? 'Pharmacy',
        },
      });
    }
  );
};
