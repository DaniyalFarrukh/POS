import type { FastifyPluginAsync } from 'fastify';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { z, isWeakOrSequentialPin } from '@pos/shared';
import { users, pharmacies } from '../db/schema';
import { signUserToken, revokeUserToken } from '../auth/jwt';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import { insertChangeLog } from '../sync/change-log';
import { logAuditEvent } from '../services/audit-service';

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
  const ipRateLimitCounters = new Map<string, { count: number; resetAt: number }>();
  const ipMaxAttempts = opts.loginRateLimitMax ?? 5;
  const ipWindowMs = 60 * 1000;

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
      // Enforce per-IP sliding window limit across all accounts (username spraying defense)
      const nowMs = Date.now();
      const ipKey = request.ip || '127.0.0.1';
      const existingIpWindow = ipRateLimitCounters.get(ipKey);
      if (!existingIpWindow || nowMs > existingIpWindow.resetAt) {
        ipRateLimitCounters.set(ipKey, { count: 1, resetAt: nowMs + ipWindowMs });
      } else {
        existingIpWindow.count += 1;
        if (existingIpWindow.count > ipMaxAttempts) {
          return reply.status(429).send({
            statusCode: 429,
            error: 'Too Many Requests',
            message: 'Too many login attempts from this IP. Please try again later.',
          });
        }
      }

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

      if (pharmacyId && !z.string().uuid().safeParse(pharmacyId).success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid pharmacyId format',
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

      // Verify PIN before revealing account status (deactivated or locked)
      const isMatch = await bcrypt.compare(pin.trim(), user.pinHash);
      if (!isMatch) {
        if (user.isActive) {
          const newAttempts = (user.failedLoginAttempts || 0) + 1;
          const now = new Date().toISOString();
          const updateFields: {
            failedLoginAttempts: number;
            lockedUntil?: string;
            updatedAt: string;
          } = {
            failedLoginAttempts: newAttempts,
            updatedAt: now,
          };

          if (newAttempts >= 5) {
            const backoffFactor = Math.pow(2, Math.min(newAttempts - 5, 6));
            updateFields.lockedUntil = new Date(
              Date.now() + 15 * backoffFactor * 60 * 1000
            ).toISOString();
          }

          await db
            .update(users)
            .set(updateFields)
            .where(and(eq(users.id, user.id), eq(users.pharmacyId, pharmacy.id)));
        }

        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid credentials',
        });
      }

      // Check temporary account lockout (exponential backoff starting at 15 minutes after 5 consecutive failed attempts)
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

      if (!user.isActive) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Account has been deactivated. Please contact the administrator.',
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
          .where(and(eq(users.id, user.id), eq(users.pharmacyId, pharmacy.id)));
      }

      const trimmedPin = pin.trim();
      const pinChangeRequired =
        trimmedPin.length < 6 ||
        (user.role === 'owner' && trimmedPin.length < 8) ||
        isWeakOrSequentialPin(trimmedPin);

      const token = signUserToken({
        userId: user.id,
        pharmacyId: user.pharmacyId,
        role: user.role,
        name: user.name,
      });

      return reply.status(200).send({
        token,
        pinChangeRequired,
        user: {
          id: user.id,
          userId: user.id,
          name: user.name,
          role: user.role,
          pharmacyId: user.pharmacyId,
          pharmacyName: pharmacy.name,
          pinChangeRequired,
        },
      });
    }
  );

  /**
   * POST /api/auth/logout
   * Revokes the current user's JWT session token immediately.
   */
  fastify.post(
    '/logout',
    { preHandler: [requirePermission('auth.me.view')] },
    async (request, reply) => {
      const userContext = request.userContext!;
      if (userContext.jti) {
        revokeUserToken(userContext.jti);
      }
      return reply.status(200).send({ ok: true });
    }
  );

  /**
   * POST /api/auth/refresh
   * Rotates the current user's JWT session token and revokes the previous jti.
   */
  fastify.post(
    '/refresh',
    { preHandler: [requirePermission('auth.me.view')] },
    async (request, reply) => {
      const userContext = request.userContext!;
      if (userContext.jti) {
        revokeUserToken(userContext.jti);
      }

      const token = signUserToken({
        userId: userContext.userId,
        pharmacyId: userContext.pharmacyId,
        role: userContext.role,
        name: userContext.name,
      });

      return reply.status(200).send({
        token,
        user: {
          id: userContext.userId,
          userId: userContext.userId,
          name: userContext.name,
          role: userContext.role,
          pharmacyId: userContext.pharmacyId,
        },
      });
    }
  );

  /**
   * POST /api/auth/change-pin
   * Allows an authenticated user (including legacy 4-digit PIN users) to upgrade their PIN to a compliant non-trivial PIN.
   */
  fastify.post<{ Body: { currentPin?: string; newPin?: string } }>(
    '/change-pin',
    { preHandler: [requirePermission('auth.me.view')] },
    async (request, reply) => {
      const userContext = request.userContext!;
      const { currentPin, newPin } = request.body || {};

      if (!currentPin || typeof currentPin !== 'string' || !newPin || typeof newPin !== 'string') {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'currentPin and newPin are required',
        });
      }

      const trimmedNewPin = newPin.trim();
      const pinRegex = userContext.role === 'owner' ? /^\d{8}$/ : /^\d{6,8}$/;
      if (!pinRegex.test(trimmedNewPin)) {
        const msg =
          userContext.role === 'owner'
            ? 'Owner PIN must be exactly 8 digits'
            : 'PIN must be between 6 and 8 digits';
        return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: msg });
      }

      if (isWeakOrSequentialPin(trimmedNewPin)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'New PIN cannot be a trivial repeating or sequential pattern',
        });
      }

      const db = request.server.db || getDb();
      const [user] = await db
        .select({
          id: users.id,
          name: users.name,
          role: users.role,
          pinHash: users.pinHash,
          isActive: users.isActive,
        })
        .from(users)
        .where(and(eq(users.id, userContext.userId), eq(users.pharmacyId, userContext.pharmacyId)))
        .limit(1);

      if (!user) {
        return reply.status(404).send({ statusCode: 404, message: 'User not found' });
      }

      const isCurrentValid = await bcrypt.compare(currentPin.trim(), user.pinHash);
      if (!isCurrentValid) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Current PIN is incorrect',
        });
      }

      const newPinHash = await bcrypt.hash(trimmedNewPin, 10);
      const now = new Date().toISOString();

      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ pinHash: newPinHash, updatedAt: now })
          .where(and(eq(users.id, user.id), eq(users.pharmacyId, userContext.pharmacyId)));

        await insertChangeLog(tx, {
          pharmacyId: userContext.pharmacyId,
          entity: 'user',
          entityId: user.id,
          op: 'upsert',
          data: {
            id: user.id,
            name: user.name,
            role: user.role,
            isActive: user.isActive,
            pinHash: newPinHash,
          },
          createdAt: now,
        });

        await logAuditEvent(tx, {
          pharmacyId: userContext.pharmacyId,
          userId: userContext.userId,
          userName: userContext.name,
          userRole: userContext.role,
          action: 'user.pin_change',
          entity: 'user',
          entityId: user.id,
          summary: `User ${user.name} changed their PIN`,
        });
      });

      return reply.status(200).send({ ok: true });
    }
  );

  /**
   * GET /api/auth/me
   * Returns current authenticated user and tenancy context.
   */
  fastify.get(
    '/me',
    { preHandler: [requirePermission('auth.me.view')] },
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
