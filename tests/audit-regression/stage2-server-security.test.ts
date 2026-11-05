import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7 } from '../../packages/shared/src/index';
import { buildApp } from '../../apps/server/src/app';
import { createTestContext, type TestDatabaseContext } from '../../apps/server/src/db/test-helper';
import { pharmacies, branches, counters, users } from '../../apps/server/src/db/schema';
import { getJwtSecret, signUserToken } from '../../apps/server/src/auth/jwt';
import { initDatabase, closeDatabase, getDatabase } from '../../apps/desktop/src/main/db';
import {
  hashPin,
  login as desktopLogin,
  unlockSession as desktopUnlockSession,
  lockSession as desktopLockSession,
  createStaffMember,
  completeSetup,
} from '../../apps/desktop/src/main/auth';

describe('Stage 2 Server Security Regression Suite — Commit 1 (Auth, Tokens, PIN Policy & Lockout)', () => {
  let ctx: TestDatabaseContext;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000, loginRateLimitMax: 1000 });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await ctx.cleanup();
  });

  async function createPharmacyAndOwner(prefix: string, pin = '48291037') {
    const now = new Date().toISOString();
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const ownerId = generateUuidV7();
    const pharmacyCode = `${prefix}_${pharmacyId.slice(0, 8)}`.toUpperCase();

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: `${prefix} Pharmacy`,
      code: pharmacyCode,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(branches).values({
      id: branchId,
      pharmacyId,
      name: 'Main Branch',
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(counters).values({
      id: counterId,
      pharmacyId,
      branchId,
      name: 'Counter 1',
      code: 'C1',
      createdAt: now,
      updatedAt: now,
    });

    const pinHash = await hashPin(pin);
    await ctx.db.insert(users).values({
      id: ownerId,
      pharmacyId,
      name: 'Dr. Owner',
      role: 'owner',
      pinHash,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const ownerToken = signUserToken({
      userId: ownerId,
      pharmacyId,
      role: 'owner',
      name: 'Dr. Owner',
    });

    return { pharmacyId, pharmacyCode, branchId, counterId, ownerId, ownerToken };
  }

  it('S2-06: getJwtSecret enforces minimum length >= 32 characters in production', () => {
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';

    try {
      process.env.JWT_SECRET = 'too_short_secret_12345';
      expect(() => getJwtSecret()).toThrow(/at least 32 characters/i);

      process.env.JWT_SECRET = 'a_very_strong_production_jwt_secret_at_least_32_chars';
      expect(getJwtSecret()).toBe('a_very_strong_production_jwt_secret_at_least_32_chars');
    } finally {
      if (prevEnv !== undefined) process.env.NODE_ENV = prevEnv;
      else delete process.env.NODE_ENV;
      if (prevSecret !== undefined) process.env.JWT_SECRET = prevSecret;
      else delete process.env.JWT_SECRET;
    }
  });

  it('S2-07: user tokens include jti, support POST /api/auth/logout revocation, and POST /api/auth/refresh rotation', async () => {
    const tenant = await createPharmacyAndOwner('S207');

    // 1. Login to get fresh user token
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        pharmacyCode: tenant.pharmacyCode,
        name: 'Dr. Owner',
        pin: '48291037',
      },
    });
    expect(loginRes.statusCode).toBe(200);
    const { token } = loginRes.json<{ token: string }>();

    // 2. Refresh token rotates to a new valid token
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(refreshRes.statusCode).toBe(200);
    const { token: refreshedToken } = refreshRes.json<{ token: string }>();
    expect(typeof refreshedToken).toBe('string');
    expect(refreshedToken).not.toBe(token);

    // Old token should be revoked after rotation
    const meWithOldToken = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meWithOldToken.statusCode).toBe(401);

    // New token works on /api/auth/me
    const meWithNewToken = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${refreshedToken}` },
    });
    expect(meWithNewToken.statusCode).toBe(200);

    // 3. Logout revokes the refreshed token immediately
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${refreshedToken}` },
    });
    expect(logoutRes.statusCode).toBe(200);

    const meAfterLogout = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${refreshedToken}` },
    });
    expect(meAfterLogout.statusCode).toBe(401);
  });

  it('S2-08: rejects trivial repeating PINs on user creation and PIN change, while allowing legacy 4-8 digit PINs to log in with pinChangeRequired migration flag', async () => {
    const tenant = await createPharmacyAndOwner('S208');
    const now = new Date().toISOString();

    // 1. Reject trivial repeating PINs on POST /api/admin/users
    for (const trivialPin of ['000000', '111111', '999999', '00000000', '11111111', '121212']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users',
        headers: { authorization: `Bearer ${tenant.ownerToken}` },
        payload: {
          name: `Trivial_${trivialPin}`,
          role: trivialPin.length === 8 ? 'owner' : 'cashier',
          pin: trivialPin,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/trivial|repeating|weak/i);
    }

    // 2. Seed a legacy user in Postgres with a 4-digit PIN ('1234')
    const legacyUserId = generateUuidV7();
    await ctx.db.insert(users).values({
      id: legacyUserId,
      pharmacyId: tenant.pharmacyId,
      name: 'Legacy 4Digit User',
      role: 'owner',
      pinHash: await hashPin('1234'),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Legacy user can log in and receives pinChangeRequired: true
    const legacyLoginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        pharmacyCode: tenant.pharmacyCode,
        name: 'Legacy 4Digit User',
        pin: '1234',
      },
    });
    expect(legacyLoginRes.statusCode).toBe(200);
    const legacyBody = legacyLoginRes.json<{
      token: string;
      pinChangeRequired?: boolean;
      user: { pinChangeRequired?: boolean };
    }>();
    expect(legacyBody.pinChangeRequired).toBe(true);

    // 3. Legacy user calls POST /api/auth/change-pin: trivial/sequential new PIN is rejected, strong PIN succeeds
    const weakChangeRes = await app.inject({
      method: 'POST',
      url: '/api/auth/change-pin',
      headers: { authorization: `Bearer ${legacyBody.token}` },
      payload: {
        currentPin: '1234',
        newPin: '11111111',
      },
    });
    expect(weakChangeRes.statusCode).toBe(400);

    const validChangeRes = await app.inject({
      method: 'POST',
      url: '/api/auth/change-pin',
      headers: { authorization: `Bearer ${legacyBody.token}` },
      payload: {
        currentPin: '1234',
        newPin: '59283746',
      },
    });
    expect(validChangeRes.statusCode).toBe(200);

    // Re-login with new strong PIN returns pinChangeRequired: false
    const reloginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        pharmacyCode: tenant.pharmacyCode,
        name: 'Legacy 4Digit User',
        pin: '59283746',
      },
    });
    expect(reloginRes.statusCode).toBe(200);
    expect(reloginRes.json().pinChangeRequired).toBe(false);

    // 4. Desktop SQLite legacy 4-digit owner ("Dr. Tariq") can log in and unlock session without Zod regex rejection
    closeDatabase();
    initDatabase(':memory:');
    const sqlite = getDatabase();

    const bId = generateUuidV7();
    const cId = generateUuidV7();
    const legacyOwnerId = generateUuidV7();
    sqlite
      .prepare('INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(bId, 'Main', now, now);
    sqlite
      .prepare(
        'INSERT INTO counters (id, branch_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(cId, bId, 'Counter 1', now, now);
    sqlite
      .prepare(
        'INSERT INTO users (id, name, role, pin_hash, is_active, failed_login_attempts, locked_until, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, NULL, ?, ?)'
      )
      .run(legacyOwnerId, 'Dr. Tariq', 'owner', await hashPin('1234'), now, now);

    const desktopSession = await desktopLogin(legacyOwnerId, '1234', sqlite);
    expect(desktopSession.user.name).toBe('Dr. Tariq');
    expect(desktopSession.pinChangeRequired).toBe(true);

    desktopLockSession();
    const unlockedSession = await desktopUnlockSession('1234', sqlite);
    expect(unlockedSession.isLocked).toBe(false);

    // Desktop createStaffMember rejects trivial repeating PIN
    await expect(
      createStaffMember(
        { name: 'Trivial Staff', role: 'cashier', pin: '000000' },
        desktopSession,
        sqlite
      )
    ).rejects.toThrow(/trivial|repeating/i);

    // Desktop completeSetup on fresh DB rejects trivial repeating PIN
    closeDatabase();
    initDatabase(':memory:');
    const freshSqlite = getDatabase();
    await expect(
      completeSetup(
        {
          branchName: 'Main Branch',
          counterName: 'Counter 1',
          ownerName: 'Dr. Tariq',
          pin: '00000000',
        },
        freshSqlite
      )
    ).rejects.toThrow(/trivial|repeating/i);
    closeDatabase();
  });

  it('S2-09: login enforces exponential lockout backoff on repeated failed attempts (>= 5) and per-IP rate limiting across usernames', async () => {
    const tenant = await createPharmacyAndOwner('S209', '83920471');

    // 5 failed attempts -> ~15 min lockout; 6th failed attempt -> ~30 min lockout (exponential backoff)
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          pharmacyCode: tenant.pharmacyCode,
          name: 'Dr. Owner',
          pin: '99999999',
        },
      });
      expect(res.statusCode).toBe(401);
    }

    const after5 = await ctx.client.query<{ failed_login_attempts: number; locked_until: string }>(
      'SELECT failed_login_attempts, locked_until FROM users WHERE id = $1',
      [tenant.ownerId]
    );
    const lock5Ms = new Date(after5.rows[0]!.locked_until).getTime() - Date.now();
    expect(lock5Ms).toBeGreaterThan(14 * 60 * 1000);
    expect(lock5Ms).toBeLessThanOrEqual(16 * 60 * 1000);

    // 6th failed attempt increases lockout to ~30 minutes (2^1 * 15m)
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        pharmacyCode: tenant.pharmacyCode,
        name: 'Dr. Owner',
        pin: '99999999',
      },
    });

    const after6 = await ctx.client.query<{ failed_login_attempts: number; locked_until: string }>(
      'SELECT failed_login_attempts, locked_until FROM users WHERE id = $1',
      [tenant.ownerId]
    );
    const lock6Ms = new Date(after6.rows[0]!.locked_until).getTime() - Date.now();
    expect(lock6Ms).toBeGreaterThan(28 * 60 * 1000);

    // Per-IP rate limiting across distinct usernames (username spraying defense)
    const rateLimitedApp = buildApp({
      db: ctx.db,
      loginRateLimitMax: 4,
      loginRateLimitWindow: '1 minute',
    });
    await rateLimitedApp.ready();

    try {
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await rateLimitedApp.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: {
            pharmacyCode: tenant.pharmacyCode,
            name: `SprayedUser_${i}`,
            pin: '12345678',
          },
        });
        statuses.push(res.statusCode);
      }
      expect(statuses).toContain(429);
    } finally {
      await rateLimitedApp.close();
    }
  });
});
