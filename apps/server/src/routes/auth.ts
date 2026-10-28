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
  pharmacyCode?: string;
  pharmacyId?: string;
}

const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export interface AuthRoutesOptions {
  loginRateLimitMax?: number;
  loginRateLimitWindow?: string | number;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (fastify, opts) => {
  /**
   * POST /api/auth/login
   * Authenticates user against users table using pharmacy identifier, username and PIN hash.
   */
  fastify.post<{ Body: LoginBody }>(
    '/login',
    {
      config: {
        rateLimit: {
          max: opts.loginRateLimitMax ?? 5,
          timeWindow: opts.loginRateLimitWindow ?? '1 minute',
          hook: 'preHandler',
          keyGenerator: (req) => {
            const body = req.body as LoginBody | undefined;
            const userKey = (body?.name || 'anonymous').toLowerCase().trim();
            return `${req.ip}_${userKey}`;
          },
        },
      },
    },
    async (request, reply) => {
      const { name, pin, pharmacyCode, pharmacyId } = request.body || {};

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

      if (!pharmacyCode && !pharmacyId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Pharmacy identifier is required',
        });
      }

      const db = request.server.db || getDb();

      // Look up pharmacy by human-friendly code or UUID id
      let pharmacy: typeof pharmacies.$inferSelect | undefined;
      if (pharmacyCode) {
        const matchingPharmacies = await db
          .select()
          .from(pharmacies)
          .where(eq(pharmacies.code, pharmacyCode.trim()))
          .limit(1);
        pharmacy = matchingPharmacies[0];
      } else if (pharmacyId) {
        const matchingPharmacies = await db
          .select()
          .from(pharmacies)
          .where(eq(pharmacies.id, pharmacyId))
          .limit(1);
        pharmacy = matchingPharmacies[0];
      }

      // If pharmacy not found, perform dummy bcrypt compare to prevent timing enumeration
      if (!pharmacy) {
        await bcrypt.compare(pin.trim(), DUMMY_HASH);
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid credentials',
        });
      }

      // Look up user strictly within the tenant pharmacy
      const matchingUsers = await db
        .select({
          id: users.id,
          pharmacyId: users.pharmacyId,
          name: users.name,
          role: users.role,
          pinHash: users.pinHash,
          isActive: users.isActive,
          failedLoginAttempts: users.failedLoginAttempts,
          lockedUntil: users.lockedUntil,
        })
        .from(users)
        .where(and(eq(users.pharmacyId, pharmacy.id), eq(users.name, name.trim())))
        .limit(1);

      const user = matchingUsers[0];

      // If user not found, perform dummy bcrypt compare
      if (!user) {
        await bcrypt.compare(pin.trim(), DUMMY_HASH);
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

      // Check temporary account lockout (15 minutes after 5 consecutive failed attempts)
      if (user.lockedUntil) {
        const lockExpiration = new Date(user.lockedUntil).getTime();
        if (lockExpiration > Date.now()) {
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Account is temporarily locked due to too many failed attempts',
          });
        }
      }

      const isMatch = await bcrypt.compare(pin.trim(), user.pinHash);
      if (!isMatch) {
        const newAttempts = (user.failedLoginAttempts || 0) + 1;
        const now = new Date().toISOString();
        const updateFields: { failedLoginAttempts: number; lockedUntil?: string; updatedAt: string } = {
          failedLoginAttempts: newAttempts,
          updatedAt: now,
        };

        if (newAttempts >= 5) {
          updateFields.lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        }

        await db.update(users).set(updateFields).where(eq(users.id, user.id));

        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid credentials',
        });
      }

      // Reset lockout and failed attempts counter on successful authentication
      if (user.failedLoginAttempts > 0 || user.lockedUntil !== null) {
        await db
          .update(users)
          .set({
            failedLoginAttempts: 0,
            lockedUntil: null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(users.id, user.id));
      }

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
          userId: user.id,
          name: user.name,
          role: user.role,
          pharmacyId: user.pharmacyId,
          pharmacyName: pharmacy.name,
        },
      });
    }
  );

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
          id: userContext.userId,
          ...userContext,
          pharmacyName: pharmacy?.name ?? 'Pharmacy',
        },
      });
    }
  );
};
