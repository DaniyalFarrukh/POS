import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { devices } from '../db/schema';
import * as schema from '../db/schema';
import { getDb } from '../db';
import { verifyDeviceToken } from './jwt';

export interface DeviceContext {
  pharmacyId: string;
  branchId: string;
  deviceId: string;
  counterId?: string | null;
  deviceName?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    deviceContext: DeviceContext;
  }
  interface FastifyInstance {
    db: NodePgDatabase<typeof schema>;
  }
}

/**
 * Fastify preHandler hook for protected routes.
 * 1. Verifies the Bearer JWT.
 * 2. Loads the device from the database.
 * 3. Rejects revoked devices (HTTP 403).
 * 4. Strictly attaches pharmacyId, branchId, deviceId to request.deviceContext.
 * 
 * Note: Tenancy parameters must NEVER be trusted from the request body or query.
 */
export async function requireDeviceAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
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

  let payload;
  try {
    payload = verifyDeviceToken(token);
  } catch {
    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
    return;
  }

  const db = request.server.db || getDb();

  try {
    const matchingDevices = await db
      .select()
      .from(devices)
      .where(and(eq(devices.id, payload.deviceId), eq(devices.pharmacyId, payload.pharmacyId)))
      .limit(1);

    const device = matchingDevices[0];

    if (!device) {
      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Device not found or does not belong to specified tenant',
      });
      return;
    }

    if (device.isRevoked) {
      reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Device has been revoked',
      });
      return;
    }

    // Attach verified device context to request
    request.deviceContext = {
      pharmacyId: device.pharmacyId,
      branchId: device.branchId || payload.branchId,
      deviceId: device.id,
      counterId: device.counterId,
      deviceName: device.deviceName,
    };
  } catch (err) {
    request.log.error(err, 'Failed to authenticate device');
    reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Failed to verify device authorization',
    });
  }
}
