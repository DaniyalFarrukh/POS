import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import {
  isPostgresReachable,
  createTestContext,
  type TestDatabaseContext,
} from '../db/test-helper';
import { seedDevEnvironment } from '../scripts/seed-dev';
import { users } from '../db/schema';
import { signUserToken } from './jwt';

describe('Permission Matrix & Route Guard Enforcement', () => {
  let ctx: TestDatabaseContext;
  let app: ReturnType<typeof buildApp>;
  const registeredRoutes: Array<{ method: string; url: string; permission?: string }> = [];

  let pharmacyId: string;
  let ownerToken: string;
  let managerToken: string;
  let accountantToken: string;
  let pharmacistToken: string;
  let cashierToken: string;
  let inactiveToken: string;

  beforeAll(async () => {
    const isAvailable = await isPostgresReachable();
    if (!isAvailable) {
      throw new Error(
        'PostgreSQL is required for this test suite. Ensure Docker is running with "docker compose up -d".'
      );
    }
    ctx = await createTestContext();
    const seeded = await seedDevEnvironment(ctx.db);
    pharmacyId = seeded.pharmacy.id;

    // Create users for each role in our test database
    const now = new Date().toISOString();

    const createUser = async (name: string, role: 'owner' | 'manager' | 'accountant' | 'pharmacist' | 'cashier', isActive = true) => {
      const id = generateUuidV7();
      await ctx.db.insert(users).values({
        id,
        pharmacyId,
        name,
        role,
        pinHash: 'dummy_hash',
        isActive,
        createdAt: now,
        updatedAt: now,
      });
      return signUserToken({
        userId: id,
        pharmacyId,
        role,
        name,
      });
    };

    ownerToken = await createUser('Test Owner', 'owner');
    managerToken = await createUser('Test Manager', 'manager');
    accountantToken = await createUser('Test Accountant', 'accountant');
    pharmacistToken = await createUser('Test Pharmacist', 'pharmacist');
    cashierToken = await createUser('Test Cashier', 'cashier');
    inactiveToken = await createUser('Test Inactive Cashier', 'cashier', false);

    app = buildApp({ db: ctx.db });

    app.addHook('onRoute', (routeOptions) => {
      if (routeOptions.method !== 'HEAD' && routeOptions.method !== 'OPTIONS') {
        const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
        for (const m of methods) {
          registeredRoutes.push({
            method: m,
            url: routeOptions.url,
            permission: (routeOptions.config as { requiredPermission?: string })?.requiredPermission,
          });
        }
      }
    });

    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.cleanup();
  });

  describe('Route Permission Completeness Audit', () => {
    // Approved routes that do not require a user permission, with documented engineering reasons
    const EXEMPT_ROUTES: Record<string, string> = {
      'GET /health': 'Public unauthenticated health check probe for orchestrators and load balancers',
      'POST /devices/register': 'Device registration via one-time cryptographically hashed pre-shared registration code',
      'GET /devices/me': 'Device identity verification guarded by device bearer token',
      'POST /sync/push': 'Counter POS offline sync push protocol guarded by device bearer token',
      'GET /sync/pull': 'Counter POS offline sync pull protocol guarded by device bearer token',
      'POST /api/auth/login': 'Public credential submission endpoint to verify identity and issue JWT',
      'POST /test/protected-action': 'Development / test endpoint guarded by device bearer token',
    };

    it('enforces that every route in the Fastify application has an explicit declared permission or is an approved exempt route', () => {
      expect(registeredRoutes.length).toBeGreaterThan(0);

      const missingDeclarations: Array<{ route: string; reason?: string }> = [];

      for (const r of registeredRoutes) {
        const routeKey = `${r.method} ${r.url}`;
        if (EXEMPT_ROUTES[routeKey]) {
          continue;
        }

        if (!r.permission) {
          missingDeclarations.push({ route: routeKey });
        }
      }

      expect(
        missingDeclarations,
        `The following routes lack declared requiredPermission: ${JSON.stringify(missingDeclarations)}`
      ).toEqual([]);
    });
  });

  describe('Role-Based Access Control and 403 Forbidden Rejections', () => {
    it('rejects cashier token with 403 Forbidden when calling finance routes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/finance/journals',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
    });

    it('allows accountant token to access finance routes and reports, but rejects access to user management', async () => {
      // 1. Accountant can access finance journals
      const finRes = await app.inject({
        method: 'GET',
        url: '/api/finance/journals',
        headers: { authorization: `Bearer ${accountantToken}` },
      });
      expect(finRes.statusCode).toBe(200);

      // 2. Accountant can access sales report
      const repRes = await app.inject({
        method: 'GET',
        url: '/api/reports/sales',
        headers: { authorization: `Bearer ${accountantToken}` },
      });
      expect(repRes.statusCode).toBe(200);

      // 3. Accountant CANNOT manage users
      const userRes = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { authorization: `Bearer ${accountantToken}` },
      });
      expect(userRes.statusCode).toBe(403);
    });

    it('allows pharmacist to access stock and expiry report but rejects finance journals', async () => {
      const stockRes = await app.inject({
        method: 'GET',
        url: '/api/reports/stock-and-expiry',
        headers: { authorization: `Bearer ${pharmacistToken}` },
      });
      expect(stockRes.statusCode).toBe(200);

      const finRes = await app.inject({
        method: 'GET',
        url: '/api/finance/journals',
        headers: { authorization: `Bearer ${pharmacistToken}` },
      });
      expect(finRes.statusCode).toBe(403);
    });

    it('allows owner token to access any route', async () => {
      const resFin = await app.inject({
        method: 'GET',
        url: '/api/finance/journals',
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(resFin.statusCode).toBe(200);

      const resUsers = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(resUsers.statusCode).toBe(200);
    });

    it('allows manager token to access operational reports and branches but rejects user management', async () => {
      const resBranches = await app.inject({
        method: 'GET',
        url: '/api/admin/branches',
        headers: { authorization: `Bearer ${managerToken}` },
      });
      expect(resBranches.statusCode).toBe(200);

      const resUsers = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { authorization: `Bearer ${managerToken}` },
      });
      expect(resUsers.statusCode).toBe(403);
    });

    it('rejects inactive user with 403 Forbidden even with valid token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${inactiveToken}` },
      });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.message).toMatch(/inactive/i);
    });
  });
});
