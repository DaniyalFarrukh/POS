import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { getDb } from '../db';
import { getDatabaseUrl } from '../db';
import { pharmacies, users } from '../db/schema';
import { generateUuidV7 } from '@pos/shared';
import bcrypt from 'bcryptjs';

describe('Audit Fixes Regression: C-01, C-02, H-01, H-02', () => {
  let app: FastifyInstance;
  const db = getDb();
  const pharmacyId = generateUuidV7();
  const pharmacyCode = `AUD-${Date.now()}`;
  const deactivatedUserId = generateUuidV7();
  const activeUserId = generateUuidV7();
  const now = new Date().toISOString();

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    await db.insert(pharmacies).values({
      id: pharmacyId,
      name: 'Audit Pharmacy',
      code: pharmacyCode,
      createdAt: now,
      updatedAt: now,
    });

    const pinHash = await bcrypt.hash('12345678', 10);

    await db.insert(users).values([
      {
        id: deactivatedUserId,
        pharmacyId,
        name: 'Deactivated User',
        role: 'cashier',
        pinHash,
        isActive: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: activeUserId,
        pharmacyId,
        name: 'Active User',
        role: 'owner',
        pinHash,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('C-01: DATABASE_URL production fail-fast check', () => {
    it('throws fatal error in production when DATABASE_URL is unset or uses dev default', () => {
      const origEnv = process.env.NODE_ENV;
      const origDbUrl = process.env.DATABASE_URL;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.DATABASE_URL;

        expect(() => getDatabaseUrl()).toThrow(/FATAL: DATABASE_URL environment variable is required in production/);

        process.env.DATABASE_URL = 'postgresql://pos:pos_dev_secret@localhost:5432/pos_server';
        expect(() => getDatabaseUrl()).toThrow(/FATAL: Production DATABASE_URL cannot use default development credentials/);
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origDbUrl) {
          process.env.DATABASE_URL = origDbUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
      }
    });
  });

  describe('C-02: Deactivated user timing-safe authentication', () => {
    it('returns 401 Invalid Credentials when PIN is wrong, even if user is deactivated', async () => {
      // Attacker attempts login with deactivated username and WRONG PIN
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          pharmacyCode,
          name: 'Deactivated User',
          pin: '99999999', // Wrong PIN
        },
      });

      // MUST return 401 Invalid credentials, NOT 403 Account deactivated!
      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe('Invalid credentials');
    });

    it('returns 403 Forbidden only when PIN matches and account is deactivated', async () => {
      // Legitimate credentials for deactivated user
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          pharmacyCode,
          name: 'Deactivated User',
          pin: '12345678', // Correct PIN
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('Account has been deactivated');
    });
  });

  describe('H-01: Sync service turns transient/unexpected errors into retry_later', () => {
    it('returns retry_later with TRANSIENT_ERROR on unexpected exceptions rather than permanent rejection', async () => {
      const { processSyncPushEvents } = await import('../sync/service');

      // Create a mock DB where transaction throws an unexpected runtime error (e.g. connection reset)
      const mockDb = {
        transaction: async () => {
          throw new Error('Connection reset by peer');
        },
      } as any;

      const dummyEvent = {
        eventId: generateUuidV7(),
        eventType: 'invoice.created',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        deviceId: generateUuidV7(),
        deviceSeq: 1,
        payload: {},
      };

      const results = await processSyncPushEvents(
        mockDb,
        { pharmacyId, deviceId: dummyEvent.deviceId, branchId: generateUuidV7() },
        [dummyEvent as any]
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe('retry_later');
      expect(results[0]?.code).toBe('TRANSIENT_ERROR');
      expect(results[0]?.message).not.toContain('Connection reset');
    });
  });

  describe('H-02: Strict CORS origin validation with credentials', () => {
    it('rejects unapproved untrusted origins from credentialed CORS reflection', async () => {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/auth/login',
        headers: {
          origin: 'http://malicious-site.com',
          'access-control-request-method': 'POST',
        },
      });

      // Wildcard reflection must NOT be present when credentials are true
      const allowOrigin = res.headers['access-control-allow-origin'];
      expect(allowOrigin).not.toBe('http://malicious-site.com');
      expect(allowOrigin).not.toBe('*');
    });
  });
});
