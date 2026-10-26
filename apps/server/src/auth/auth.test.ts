import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { generateUuidV7 } from '@pos/shared';
import {
  hashRegistrationCode,
  generatePlainRegistrationCode,
  signDeviceToken,
  verifyDeviceToken,
} from './jwt';
import { buildApp } from '../app';
import {
  isPostgresReachable,
  createTestContext,
  type TestDatabaseContext,
} from '../db/test-helper';
import { seedDevEnvironment } from '../scripts/seed-dev';
import { devices, deviceRegistrationCodes } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';

describe('Device Registration & Authentication (Phase 3)', () => {
  describe('JWT and Code Hashing Utilities', () => {
    it('generates, hashes and verifies device registration code formats', () => {
      const code = generatePlainRegistrationCode();
      expect(code).toMatch(/^REG-[0-9A-F]{4}-[0-9A-F]{4}$/);

      const hash1 = hashRegistrationCode(code);
      const hash2 = hashRegistrationCode(code.toLowerCase());
      const hash3 = hashRegistrationCode(`  ${code}  `);

      // Normalization check: lowercase and whitespace should produce identical hashes
      expect(hash1).toBe(hash2);
      expect(hash1).toBe(hash3);
      expect(hash1).toHaveLength(64); // SHA-256 hex string
    });

    it('signs and verifies device tokens containing tenancy context', () => {
      const payload = {
        pharmacyId: generateUuidV7(),
        branchId: generateUuidV7(),
        deviceId: generateUuidV7(),
      };

      const token = signDeviceToken(payload);
      expect(typeof token).toBe('string');

      const verified = verifyDeviceToken(token);
      expect(verified.pharmacyId).toBe(payload.pharmacyId);
      expect(verified.branchId).toBe(payload.branchId);
      expect(verified.deviceId).toBe(payload.deviceId);
    });

    it('rejects tampered or forged JWTs', () => {
      const payload = {
        pharmacyId: generateUuidV7(),
        branchId: generateUuidV7(),
        deviceId: generateUuidV7(),
      };

      // Sign with forged secret
      const forgedToken = jwt.sign(payload, 'wrong-secret-signature');

      expect(() => verifyDeviceToken(forgedToken)).toThrow();
    });

    it('rejects expired tokens', () => {
      const payload = {
        pharmacyId: generateUuidV7(),
        branchId: generateUuidV7(),
        deviceId: generateUuidV7(),
      };

      const expiredToken = signDeviceToken(payload, { expiresIn: -10 });
      expect(() => verifyDeviceToken(expiredToken)).toThrow();
    });

    it('rejects tokens missing required tenancy claims', () => {
      const secret = process.env.JWT_SECRET || 'dev_pos_jwt_secret_change_in_production';
      const incompleteToken = jwt.sign({ pharmacyId: generateUuidV7() }, secret);

      expect(() => verifyDeviceToken(incompleteToken)).toThrow(
        /missing required tenancy claims/i
      );
    });
  });

  describe('Fastify Auth Hook & Endpoints (with in-memory store)', () => {
    interface InMemCode {
      id: string;
      pharmacyId: string;
      branchId: string;
      counterId: string;
      codeHash: string;
      expiresAt: string;
      usedAt: string | null;
      createdAt: string;
    }

    interface InMemDevice {
      id: string;
      pharmacyId: string;
      branchId: string | null;
      counterId: string | null;
      deviceName: string;
      deviceFingerprint: string | null;
      isRevoked: boolean;
      lastSeenAt: string | null;
      createdAt: string;
      updatedAt: string;
    }

    function createMockDb() {
      const codes: InMemCode[] = [];
      const devList: InMemDevice[] = [];

      const dbMock = {
        _codes: codes,
        _devices: devList,
        select: () => ({
          from: (table: unknown) => ({
            where: (condition: unknown) => ({
              limit: async () => {
                if (table === deviceRegistrationCodes) {
                  // Find matching code
                  const hash = (condition as { right?: { value?: string } })?.right?.value;
                  const found = codes.find((c) => !hash || c.codeHash === hash);
                  return found ? [{ ...found }] : [];
                }
                if (table === devices) {
                  // Find matching device
                  // Check deviceId and pharmacyId
                  const conditions = (condition as { operands?: Array<{ right?: { value?: string } }> })?.operands;
                  const devId = conditions?.[0]?.right?.value;
                  const pharmId = conditions?.[1]?.right?.value;
                  const found = devList.find(
                    (d) => (!devId || d.id === devId) && (!pharmId || d.pharmacyId === pharmId)
                  );
                  return found ? [{ ...found }] : [];
                }
                return [];
              },
            }),
          }),
        }),
        transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
          const txMock = {
            update: (table: unknown) => ({
              set: (values: Partial<InMemCode>) => ({
                where: () => ({
                  returning: async () => {
                    if (table === deviceRegistrationCodes) {
                      const unusedIndex = codes.findIndex((c) => c.usedAt === null);
                      if (unusedIndex !== -1) {
                        codes[unusedIndex]!.usedAt = (values.usedAt as string) || new Date().toISOString();
                        return [{ id: codes[unusedIndex]!.id }];
                      }
                      return [];
                    }
                    return [];
                  },
                }),
              }),
            }),
            insert: (table: unknown) => ({
              values: async (vals: InMemDevice) => {
                if (table === devices) {
                  devList.push({ ...vals });
                }
                return [{ id: vals.id }];
              },
            }),
          };
          return callback(txMock);
        },
      };

      return dbMock as unknown as NodePgDatabase<typeof schema> & {
        _codes: InMemCode[];
        _devices: InMemDevice[];
      };
    }

    it('completes valid device registration and returns JWT', async () => {
      const mockDb = createMockDb();
      const plainCode = 'REG-1111-2222';
      const pharmacyId = generateUuidV7();
      const branchId = generateUuidV7();
      const counterId = generateUuidV7();

      mockDb._codes.push({
        id: generateUuidV7(),
        pharmacyId,
        branchId,
        counterId,
        codeHash: hashRegistrationCode(plainCode),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        usedAt: null,
        createdAt: new Date().toISOString(),
      });

      const app = buildApp({ db: mockDb });

      const response = await app.inject({
        method: 'POST',
        url: '/devices/register',
        payload: {
          code: plainCode,
          deviceName: 'Checkout Terminal 1',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<{
        ok: boolean;
        deviceId: string;
        pharmacyId: string;
        branchId: string;
        token: string;
      }>();

      expect(body.ok).toBe(true);
      expect(body.pharmacyId).toBe(pharmacyId);
      expect(body.branchId).toBe(branchId);
      expect(body.deviceId).toBeDefined();

      const verified = verifyDeviceToken(body.token);
      expect(verified.pharmacyId).toBe(pharmacyId);
      expect(verified.deviceId).toBe(body.deviceId);
      expect(mockDb._codes[0]!.usedAt).not.toBeNull();
    });

    it('rejects reused registration code', async () => {
      const mockDb = createMockDb();
      const plainCode = 'REG-REUSE-CODE';

      mockDb._codes.push({
        id: generateUuidV7(),
        pharmacyId: generateUuidV7(),
        branchId: generateUuidV7(),
        counterId: generateUuidV7(),
        codeHash: hashRegistrationCode(plainCode),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        usedAt: new Date().toISOString(), // Already used!
        createdAt: new Date().toISOString(),
      });

      const app = buildApp({ db: mockDb });

      const response = await app.inject({
        method: 'POST',
        url: '/devices/register',
        payload: {
          code: plainCode,
          deviceName: 'Attempt 2 Terminal',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ message: string }>();
      expect(body.message).toContain('already been used');
    });

    it('rejects expired registration code', async () => {
      const mockDb = createMockDb();
      const plainCode = 'REG-EXPIRED-99';

      mockDb._codes.push({
        id: generateUuidV7(),
        pharmacyId: generateUuidV7(),
        branchId: generateUuidV7(),
        counterId: generateUuidV7(),
        codeHash: hashRegistrationCode(plainCode),
        expiresAt: new Date(Date.now() - 3600000).toISOString(), // Expired 1 hour ago
        usedAt: null,
        createdAt: new Date(Date.now() - 7200000).toISOString(),
      });

      const app = buildApp({ db: mockDb });

      const response = await app.inject({
        method: 'POST',
        url: '/devices/register',
        payload: {
          code: plainCode,
          deviceName: 'Expired Terminal',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ message: string }>();
      expect(body.message).toContain('expired');
    });

    it('rejects unknown or invalid registration code', async () => {
      const mockDb = createMockDb();
      const app = buildApp({ db: mockDb });

      const response = await app.inject({
        method: 'POST',
        url: '/devices/register',
        payload: {
          code: 'REG-DOES-NOT-EXIST',
          deviceName: 'Unknown Terminal',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ message: string }>();
      expect(body.message).toContain('Invalid registration code');
    });

    it('rejects missing or malformed token in auth hook', async () => {
      const mockDb = createMockDb();
      const app = buildApp({ db: mockDb });

      // No header
      const res1 = await app.inject({
        method: 'GET',
        url: '/devices/me',
      });
      expect(res1.statusCode).toBe(401);

      // Malformed header
      const res2 = await app.inject({
        method: 'GET',
        url: '/devices/me',
        headers: { authorization: 'Basic 1234' },
      });
      expect(res2.statusCode).toBe(401);

      // Random string token
      const res3 = await app.inject({
        method: 'GET',
        url: '/devices/me',
        headers: { authorization: 'Bearer invalid.jwt.string' },
      });
      expect(res3.statusCode).toBe(401);
    });

    it('rejects revoked device in auth hook', async () => {
      const mockDb = createMockDb();
      const pharmacyId = generateUuidV7();
      const branchId = generateUuidV7();
      const deviceId = generateUuidV7();

      // Device stored as revoked
      mockDb._devices.push({
        id: deviceId,
        pharmacyId,
        branchId,
        counterId: generateUuidV7(),
        deviceName: 'Stolen Terminal',
        deviceFingerprint: null,
        isRevoked: true, // REVOKED!
        lastSeenAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const token = signDeviceToken({ pharmacyId, branchId, deviceId });
      const app = buildApp({ db: mockDb });

      const response = await app.inject({
        method: 'GET',
        url: '/devices/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json<{ message: string }>();
      expect(body.message).toContain('revoked');
    });

    it('strictly ignores request-body pharmacyId and uses JWT context', async () => {
      const mockDb = createMockDb();
      const legitimatePharmacyId = generateUuidV7();
      const genuineBranchId = generateUuidV7();
      const deviceId = generateUuidV7();

      mockDb._devices.push({
        id: deviceId,
        pharmacyId: legitimatePharmacyId,
        branchId: genuineBranchId,
        counterId: null,
        deviceName: 'Authorized Terminal',
        deviceFingerprint: null,
        isRevoked: false,
        lastSeenAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const token = signDeviceToken({
        pharmacyId: legitimatePharmacyId,
        branchId: genuineBranchId,
        deviceId,
      });

      const app = buildApp({ db: mockDb });

      // Malicious client sends a fake/spoofed pharmacyId in body
      const roguePharmacyId = '00000000-0000-7000-8000-000000000000';
      const response = await app.inject({
        method: 'POST',
        url: '/test/protected-action',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          pharmacyId: roguePharmacyId,
          branchId: '00000000-0000-7000-8000-000000000001',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        ok: boolean;
        authenticatedPharmacyId: string;
        authenticatedBranchId: string;
        authenticatedDeviceId: string;
      }>();

      // Tenant identity MUST match the authenticated JWT token, NOT the rogue body payload
      expect(body.authenticatedPharmacyId).toBe(legitimatePharmacyId);
      expect(body.authenticatedPharmacyId).not.toBe(roguePharmacyId);
      expect(body.authenticatedDeviceId).toBe(deviceId);
    });

    it('enforces rate limiting on /devices/register', async () => {
      const mockDb = createMockDb();
      // Configure low limit: 3 requests per minute
      const app = buildApp({
        db: mockDb,
        deviceRateLimitMax: 3,
        deviceRateLimitWindow: '1 minute',
      });

      const makeRequest = () =>
        app.inject({
          method: 'POST',
          url: '/devices/register',
          payload: { code: 'REG-RATE-TEST', deviceName: 'Terminal' },
        });

      const res1 = await makeRequest();
      const res2 = await makeRequest();
      const res3 = await makeRequest();
      const res4 = await makeRequest(); // Should trigger 429

      expect([res1.statusCode, res2.statusCode, res3.statusCode]).not.toContain(429);
      expect(res4.statusCode).toBe(429);
    });
  });

  describe('PostgreSQL Live Integration (when PostgreSQL is active)', () => {
    let isAvailable = false;
    let ctx: TestDatabaseContext | null = null;

    beforeAll(async () => {
      isAvailable = await isPostgresReachable();
      if (isAvailable) {
        ctx = await createTestContext();
      }
    });

    afterAll(async () => {
      if (ctx) {
        await ctx.cleanup();
      }
    });

    it('verifies live integration when PostgreSQL container is available', async (context) => {
      if (!isAvailable || !ctx) {
        context.skip();
        return;
      }

      // 1. Seed dev environment in isolated schema
      const seedResult = await seedDevEnvironment(ctx.db);
      expect(seedResult.pharmacy.id).toBeDefined();
      expect(seedResult.registrationCode.plainCode).toBeDefined();

      const app = buildApp({ db: ctx.db });

      // 2. Register device using the live seeded registration code
      const registerRes = await app.inject({
        method: 'POST',
        url: '/devices/register',
        payload: {
          code: seedResult.registrationCode.plainCode,
          deviceName: 'Live Postgres Terminal',
        },
      });

      expect(registerRes.statusCode).toBe(201);
      const regBody = registerRes.json<{
        ok: boolean;
        deviceId: string;
        token: string;
      }>();

      // 3. Verify device was stored in live Postgres
      const liveDevices = await ctx.db
        .select()
        .from(devices)
        .where(eq(devices.id, regBody.deviceId))
        .limit(1);

      expect(liveDevices[0]).toBeDefined();
      expect(liveDevices[0]!.deviceName).toBe('Live Postgres Terminal');
      expect(liveDevices[0]!.isRevoked).toBe(false);

      // 4. Verify code is marked used in live Postgres
      const liveCodes = await ctx.db
        .select()
        .from(deviceRegistrationCodes)
        .where(eq(deviceRegistrationCodes.id, seedResult.registrationCode.id))
        .limit(1);

      expect(liveCodes[0]!.usedAt).not.toBeNull();

      // 5. Verify calling protected endpoint with live JWT returns deviceContext
      const meRes = await app.inject({
        method: 'GET',
        url: '/devices/me',
        headers: { authorization: `Bearer ${regBody.token}` },
      });

      expect(meRes.statusCode).toBe(200);
      const meBody = meRes.json<{
        ok: boolean;
        deviceContext: { pharmacyId: string; deviceId: string };
      }>();
      expect(meBody.deviceContext.pharmacyId).toBe(seedResult.pharmacy.id);
      expect(meBody.deviceContext.deviceId).toBe(regBody.deviceId);
    });
  });
});
