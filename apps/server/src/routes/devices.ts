import type { FastifyPluginAsync } from 'fastify';
import { eq, and, isNull } from 'drizzle-orm';
import { generateUuidV7 } from '@pos/shared';
import { deviceRegistrationCodes, devices } from '../db/schema';
import { hashRegistrationCode, signDeviceToken } from '../auth/jwt';
import { requireDeviceAuth } from '../auth/device-auth';
import { getDb } from '../db';

interface RegisterDeviceBody {
  code?: string;
  deviceName?: string;
  deviceFingerprint?: string;
  // If a malicious client passes pharmacyId or branchId in the body, it must be ignored!
  pharmacyId?: string;
  branchId?: string;
}

export interface DeviceRoutesOptions {
  registerRateLimitMax?: number;
  registerRateLimitWindow?: string | number;
}

export const deviceRoutes: FastifyPluginAsync<DeviceRoutesOptions> = async (
  fastify,
  options
) => {
  const registerMax = options.registerRateLimitMax ?? 5;
  const registerWindow = options.registerRateLimitWindow ?? '1 minute';

  /**
   * POST /devices/register
   * Validates one-time registration code, registers device, consumes code,
   * and returns JWT token containing { pharmacyId, branchId, deviceId }.
   * Rate-limited to prevent brute-force code guessing.
   */
  fastify.post<{ Body: RegisterDeviceBody }>(
    '/register',
    {
      config: {
        rateLimit: {
          max: registerMax,
          timeWindow: registerWindow,
        },
      },
    },
    async (request, reply) => {
      const { code, deviceName, deviceFingerprint } = request.body || {};

      if (!code || typeof code !== 'string' || !code.trim()) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Registration code is required',
        });
      }

      if (!deviceName || typeof deviceName !== 'string' || !deviceName.trim()) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Device name is required',
        });
      }

      const db = request.server.db || getDb();
      const codeHash = hashRegistrationCode(code);

      // 1. Look up code by hash
      const matchingCodes = await db
        .select()
        .from(deviceRegistrationCodes)
        .where(eq(deviceRegistrationCodes.codeHash, codeHash))
        .limit(1);

      const codeRecord = matchingCodes[0];

      if (!codeRecord) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid registration code',
        });
      }

      // 2. Check if already used
      if (codeRecord.usedAt !== null) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Registration code has already been used',
        });
      }

      // 3. Check if expired
      const expiresAt = new Date(codeRecord.expiresAt).getTime();
      if (Number.isNaN(expiresAt) || expiresAt < Date.now()) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Registration code has expired',
        });
      }

      const deviceId = generateUuidV7();
      const now = new Date().toISOString();

      // 4. Atomically mark code as used and insert device in ONE transaction (Rule 5)
      try {
        await db.transaction(async (tx) => {
          const updated = await tx
            .update(deviceRegistrationCodes)
            .set({ usedAt: now })
            .where(
              and(
                eq(deviceRegistrationCodes.id, codeRecord.id),
                isNull(deviceRegistrationCodes.usedAt)
              )
            )
            .returning({ id: deviceRegistrationCodes.id });

          if (updated.length === 0) {
            throw new Error('CODE_ALREADY_USED');
          }

          await tx.insert(devices).values({
            id: deviceId,
            pharmacyId: codeRecord.pharmacyId,
            branchId: codeRecord.branchId,
            counterId: codeRecord.counterId,
            deviceName: deviceName.trim(),
            deviceFingerprint: deviceFingerprint ? deviceFingerprint.trim() : null,
            isRevoked: false,
            lastSeenAt: now,
            createdAt: now,
            updatedAt: now,
          });
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'CODE_ALREADY_USED') {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Registration code has already been used',
          });
        }
        request.log.error(err, 'Failed to complete device registration');
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Failed to complete device registration',
        });
      }

      // 5. Sign JWT containing tenancy and device identity
      const token = signDeviceToken({
        pharmacyId: codeRecord.pharmacyId,
        branchId: codeRecord.branchId,
        deviceId,
      });

      return reply.status(201).send({
        ok: true,
        deviceId,
        pharmacyId: codeRecord.pharmacyId,
        branchId: codeRecord.branchId,
        token,
      });
    }
  );

  /**
   * GET /devices/me
   * Protected endpoint for testing authentication and returning device info.
   */
  fastify.get(
    '/me',
    {
      preHandler: [requireDeviceAuth],
    },
    async (request) => {
      return {
        ok: true,
        deviceContext: request.deviceContext,
      };
    }
  );
};
