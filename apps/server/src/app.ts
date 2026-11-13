import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getSharedInfo, type AppPermission } from '@pos/shared';
import * as schema from './db/schema';
import { getDb } from './db';
import cors from '@fastify/cors';
import { deviceRoutes } from './routes/devices';
import { syncRoutes } from './routes/sync';
import { authRoutes } from './routes/auth';
import { dashboardRoutes } from './routes/dashboard';
import { reportRoutes } from './routes/reports';
import { adminRoutes } from './routes/admin';
import { financeRoutes } from './routes/finance';
import { paymentRoutes } from './routes/payments';
import { expenseRoutes } from './routes/expenses';
import { arRoutes } from './routes/ar';
import { apRoutes } from './routes/ap';
import { cashBankRoutes } from './routes/cash-bank';
import { salesLedgerRoutes } from './routes/sales-ledger';
import { financialReportsRoutes } from './routes/financial-reports';
import { budgetRoutes } from './routes/budgets';
import { supplierRoutes } from './routes/suppliers';
import { purchaseOrderRoutes } from './routes/purchase-orders';
import { stockLocationRoutes } from './routes/stock-locations';
import { stockTransferRoutes } from './routes/stock-transfers';
import { stockCountRoutes } from './routes/stock-counts';
import { supplierReturnRoutes } from './routes/supplier-returns';
import { stockRoutes } from './routes/stock';
import { customerRoutes } from './routes/customers';
import { prescriptionRoutes } from './routes/prescriptions';
import { hrLeaveRoutes } from './routes/hr-leave';
import { payrollRoutes } from './routes/payroll';
import { notificationRoutes } from './routes/notifications';
import { searchRoutes } from './routes/search';
import { requireDeviceAuth } from './auth/device-auth';

export interface BuildAppOptions {
  logger?: boolean | object;
  db?: NodePgDatabase<typeof schema>;
  trustProxy?: boolean | string | string[];
  deviceRateLimitMax?: number;
  deviceRateLimitWindow?: string | number;
  loginRateLimitMax?: number;
  loginRateLimitWindow?: string | number;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
  const redactPaths = [
    'req.headers.authorization',
    'req.headers.cookie',
    '*.pin',
    '*.pinHash',
    '*.token',
    '*.refreshToken',
    '*.code',
    '*.codeHash',
    '*.secret',
    '*.password',
  ];

  const loggerConfig =
    options.logger !== undefined
      ? options.logger
      : isTest
        ? false
        : {
            level: process.env.LOG_LEVEL || 'info',
            redact: {
              paths: redactPaths,
              censor: '[REDACTED]',
            },
          };

  const trustProxyEnv = process.env.TRUST_PROXY;
  const trustProxyConfig: boolean | string | string[] =
    options.trustProxy !== undefined
      ? options.trustProxy
      : trustProxyEnv === 'true'
        ? true
        : trustProxyEnv && trustProxyEnv !== 'false'
          ? trustProxyEnv
          : false;

  const app = Fastify({
    logger: loggerConfig,
    bodyLimit: 1048576, // 1 MiB max request body size
    trustProxy: trustProxyConfig,
  });
  const sharedInfo = getSharedInfo();

  // Decorate with database client (injected or default)
  const db = options.db || getDb();
  app.decorate('db', db);

  // Enforce HTTPS in production when ENFORCE_HTTPS=true
  app.addHook('onRequest', async (request, reply) => {
    if (process.env.NODE_ENV === 'production' && process.env.ENFORCE_HTTPS === 'true') {
      const isHttps =
        request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https';
      if (!isHttps && request.url !== '/health') {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'HTTPS is required in production',
        });
      }
    }
  });

  // Set defensive security headers on every response
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'");
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');

    const forwardedProto = request.headers['x-forwarded-proto'];
    const isHttps =
      forwardedProto === 'https' ||
      request.protocol === 'https' ||
      (process.env.NODE_ENV === 'production' && process.env.ENFORCE_HTTPS === 'true');
    if (isHttps) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  });

  // Central error handler: convert ZodError and invalid Postgres UUID/numeric syntax to 400, mask 500 details
  app.setErrorHandler((error, request, reply) => {
    const errObj = error as unknown as {
      name?: string;
      statusCode?: number;
      code?: string;
      message?: string;
      issues?: Array<{ message?: string }>;
      cause?: { code?: string; message?: string };
    };

    // 1. Zod validation errors -> 400 Bad Request
    if (errObj.name === 'ZodError' || Array.isArray(errObj.issues)) {
      const firstIssue = errObj.issues?.[0]?.message || 'Validation error';
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: firstIssue,
      });
    }

    // 2. Postgres invalid_text_representation (22P02, e.g. invalid UUID) or numeric_value_out_of_range (22003) -> 400 Bad Request
    const pgCode = errObj.code || errObj.cause?.code;
    const rawMsg = `${errObj.message || ''} ${errObj.cause?.message || ''}`;
    if (
      pgCode === '22P02' ||
      pgCode === '22003' ||
      /invalid input syntax for type (uuid|integer|numeric)/i.test(rawMsg)
    ) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid identifier or parameter format',
      });
    }

    const statusCode =
      typeof errObj.statusCode === 'number' && errObj.statusCode >= 400 ? errObj.statusCode : 500;

    if (statusCode < 500) {
      return reply.status(statusCode).send({
        statusCode,
        error: errObj.name || 'Request Error',
        message: errObj.message || 'Bad request',
      });
    }

    request.log.error(error);
    request.log.error(error);
    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
  });

  // Enable CORS for web client (never reflect arbitrary origins when credentials are enabled)
  const defaultAllowedOrigins: (string | RegExp)[] = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
    /https:\/\/([a-z0-9-]+\.)?hexalogictechandsolutions\.com$/,
    /https:\/\/([a-z0-9-]+\.)?vercel\.app$/,
  ];

  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : defaultAllowedOrigins;

  app.register(cors, {
    origin: corsOrigin,
    credentials: true,
  });

  // Register rate limit plugin (global: false so only specifically configured routes are limited)
  app.register(rateLimit, {
    global: false,
  });

  // Global onRoute hook to associate declared permissions from preHandlers to route configs
  app.addHook('onRoute', (routeOptions) => {
    if (routeOptions.preHandler) {
      const handlers = Array.isArray(routeOptions.preHandler)
        ? routeOptions.preHandler
        : [routeOptions.preHandler];
      for (const h of handlers) {
        const handlerWithPerm = h as unknown as { requiredPermission?: AppPermission };
        if (handlerWithPerm?.requiredPermission) {
          routeOptions.config = routeOptions.config || {};
          routeOptions.config.requiredPermission = handlerWithPerm.requiredPermission;
        }
      }
    }
  });

  // Root welcome route for browser and tunnel testing
  app.get('/', async () => {
    return {
      status: 'online',
      app: 'HexaPharm POS Server',
      version: sharedInfo.version,
      database: 'Supabase Connected',
      endpoints: {
        health: '/health',
        login: '/api/auth/login',
        dashboard: '/api/dashboard/overview',
        sync: '/sync',
      },
    };
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
  app.register(financeRoutes, { prefix: '/api/finance' });
  app.register(paymentRoutes, { prefix: '/api/finance' });
  app.register(expenseRoutes, { prefix: '/api/finance' });
  app.register(arRoutes, { prefix: '/api/finance/ar' });
  app.register(apRoutes, { prefix: '/api/finance/ap' });
  app.register(cashBankRoutes, { prefix: '/api/finance/cash-bank' });
  app.register(salesLedgerRoutes, { prefix: '/api/finance/sales-ledger' });
  app.register(financialReportsRoutes, { prefix: '/api/finance/reports' });
  app.register(budgetRoutes, { prefix: '/api/finance/budgets' });
  app.register(supplierRoutes);
  app.register(purchaseOrderRoutes);
  app.register(stockLocationRoutes);
  app.register(stockTransferRoutes);
  app.register(stockCountRoutes);
  app.register(supplierReturnRoutes);
  app.register(stockRoutes, { prefix: '/api/inventory' });
  app.register(customerRoutes, { prefix: '/api/customers' });
  app.register(prescriptionRoutes, { prefix: '/api/prescriptions' });
  app.register(hrLeaveRoutes, { prefix: '/api/hr' });
  app.register(payrollRoutes, { prefix: '/api/hr' });
  app.register(notificationRoutes, { prefix: '/api/notifications' });
  app.register(searchRoutes, { prefix: '/api/search' });

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
