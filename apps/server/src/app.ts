import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getSharedInfo } from '@pos/shared';
import * as schema from './db/schema';
import { getDb } from './db';
import cors from '@fastify/cors';
import { deviceRoutes } from './routes/devices';
import { syncRoutes } from './routes/sync';
import { authRoutes } from './routes/auth';
import { dashboardRoutes } from './routes/dashboard';
import { reportRoutes } from './routes/reports';
import { adminRoutes } from './routes/admin';
import { requireDeviceAuth } from './auth/device-auth';

export interface BuildAppOptions {
  db?: NodePgDatabase<typeof schema>;
  deviceRateLimitMax?: number;
  deviceRateLimitWindow?: string | number;
  loginRateLimitMax?: number;
  loginRateLimitWindow?: string | number;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const sharedInfo = getSharedInfo();

  // Decorate with database client (injected or default)
  const db = options.db || getDb();
  app.decorate('db', db);

  // Enable CORS for web client
  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : process.env.NODE_ENV === 'production'
      ? false
      : true;

  app.register(cors, {
    origin: corsOrigin,
    credentials: true,
  });

  // Register rate limit plugin (global: false so only specifically configured routes are limited)
  app.register(rateLimit, {
    global: false,
  });

  // Health check route
  app.get('/health', async () => {
    return {
      ok: true,
      app: sharedInfo.appName,
      version: sharedInfo.version,
    };
  });

  // Device registration and management routes
  app.register(deviceRoutes, {
    prefix: '/devices',
    registerRateLimitMax: options.deviceRateLimitMax,
    registerRateLimitWindow: options.deviceRateLimitWindow,
  });

  // Sync protocol routes (Phase 3)
  app.register(syncRoutes, {
    prefix: '/sync',
  });

  // Phase 4 Web API routes
  app.register(authRoutes, {
    prefix: '/api/auth',
    loginRateLimitMax: options.loginRateLimitMax,
    loginRateLimitWindow: options.loginRateLimitWindow,
  });
  app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  app.register(reportRoutes, { prefix: '/api/reports' });
  app.register(adminRoutes, { prefix: '/api/admin' });

  // Test protected endpoint to prove tenant identity is strictly read from JWT/deviceContext (development/test only)
  if (process.env.NODE_ENV !== 'production') {
    app.post(
      '/test/protected-action',
      {
        preHandler: [requireDeviceAuth],
      },
      async (request) => {
        // Tenancy context strictly from authenticated deviceContext, NEVER from body
        return {
          ok: true,
          authenticatedPharmacyId: request.deviceContext.pharmacyId,
          authenticatedBranchId: request.deviceContext.branchId,
          authenticatedDeviceId: request.deviceContext.deviceId,
        };
      }
    );
  }

  return app;
}
