import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import {
  signUserToken,
  signDeviceToken,
  verifyDeviceToken,
  getDeviceJwtSecret,
  persistRevokedToken,
} from './jwt';
import { revokedTokens, users, pharmacies } from '../db/schema';

describe('F-H-09: Server Auth & Proxy Hardening', () => {
  let ctx: TestDatabaseContext;
  let pharmacyId: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    pharmacyId = generateUuidV7();
    userId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: 'Security Test Pharmacy',
      code: `SEC-${Date.now().toString().slice(-4)}`,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(users).values({
      id: userId,
      pharmacyId,
      name: 'Owner User',
      role: 'owner',
      pinHash: 'dummy_hash',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('trustProxy is disabled by default: ignores spoofed X-Forwarded-For for client IP', async () => {
    const app = await buildApp({ db: ctx.db });
    try {
      let seenIp = '';
      app.get('/test-ip', async (req) => {
        seenIp = req.ip;
        return { ip: req.ip };
      });

      await app.inject({
        method: 'GET',
        url: '/test-ip',
        headers: {
          'x-forwarded-for': '198.51.100.42',
        },
      });

      // When trustProxy is disabled, req.ip is the loopback socket IP (127.0.0.1 or ::1), not the spoofed header
      expect(seenIp).not.toBe('198.51.100.42');
      expect(['127.0.0.1', '::1', 'localhost']).toContain(seenIp);
    } finally {
      await app.close();
    }
  });

  it('requires distinct DEVICE_JWT_SECRET in production and throws if missing or equal to JWT_SECRET', () => {
    const originalEnv = { ...process.env };
    try {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a_very_secure_long_user_jwt_secret_32_chars!';

      // 1. Missing DEVICE_JWT_SECRET
      delete process.env.DEVICE_JWT_SECRET;
      expect(() => getDeviceJwtSecret()).toThrow(
        /FATAL: DEVICE_JWT_SECRET environment variable is required in production/i
      );

      // 2. DEVICE_JWT_SECRET equals JWT_SECRET
      process.env.DEVICE_JWT_SECRET = process.env.JWT_SECRET;
      expect(() => getDeviceJwtSecret()).toThrow(
        /FATAL: Production DEVICE_JWT_SECRET must be distinct from JWT_SECRET/i
      );

      // 3. Valid distinct DEVICE_JWT_SECRET
      process.env.DEVICE_JWT_SECRET = 'a_different_distinct_device_secret_32_chars!';
      expect(getDeviceJwtSecret()).toBe('a_different_distinct_device_secret_32_chars!');
    } finally {
      process.env = originalEnv;
    }
  });

  it('device tokens and user tokens use separated secrets in production', () => {
    const originalEnv = { ...process.env };
    try {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a_very_secure_long_user_jwt_secret_32_chars!';
      process.env.DEVICE_JWT_SECRET = 'a_different_distinct_device_secret_32_chars!';

      const devToken = signDeviceToken({
        pharmacyId,
        branchId: generateUuidV7(),
        deviceId: generateUuidV7(),
      });

      // Verify with device secret succeeds
      expect(verifyDeviceToken(devToken)).toBeDefined();

      // Attempting to verify device token with user JWT secret fails signature verification
      expect(() => verifyDeviceToken(devToken, { secret: process.env.JWT_SECRET })).toThrow(
        /invalid signature/i
      );
    } finally {
      process.env = originalEnv;
    }
  });

  it('persists revoked token JTIs into PostgreSQL revoked_tokens table and rejects session', async () => {
    const app = await buildApp({ db: ctx.db });
    try {
      const jti = generateUuidV7();
      const token = signUserToken({
        userId,
        pharmacyId,
        role: 'owner',
        name: 'Owner User',
        jti,
      });

      // 1. Token initially valid
      const res1 = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res1.statusCode).toBe(200);

      // 2. Revoke token and persist to Postgres
      await persistRevokedToken(ctx.db, jti, userId);

      // Verify row in Postgres
      const [revokedRow] = await ctx.db
        .select()
        .from(revokedTokens)
        .where(eq(revokedTokens.jti, jti));
      expect(revokedRow).toBeDefined();
      expect(revokedRow?.jti).toBe(jti);

      // 3. Request rejected with 401
      const res2 = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res2.statusCode).toBe(401);
      expect(res2.json().message).toMatch(/revoked|invalid/i);
    } finally {
      await app.close();
    }
  });
});
