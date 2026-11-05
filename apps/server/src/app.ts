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

  // Enable CORS for web client (never reflect arbitrary origins when credentials are enabled)
  const defaultAllowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
  ];

  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : process.env.NODE_ENV === 'production'
      ? false
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
