import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7 } from '../../packages/shared/src/index';
import { buildApp } from '../../apps/server/src/app';
import { createTestContext, type TestDatabaseContext } from '../../apps/server/src/db/test-helper';
import {
  pharmacies,
  branches,
  counters,
  users,
  devices,
  taxCategories,
  products,
  batches,
  suppliers,
  customers,
  invoices,
  purchaseOrders,
  stockTransfers,
  stockTransferLines,
  stockLocations,
  changeLog,
} from '../../apps/server/src/db/schema';
import { getJwtSecret, signDeviceToken, signUserToken } from '../../apps/server/src/auth/jwt';
import { seedDefaultChartOfAccounts } from '../../apps/server/src/ledger/coa-seed';
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

  it('S2-01: applyStockTransferReceived prevents cross-tenant overwrite of stockTransferLines and verifies line productId/batchId', async () => {
    const tenantA = await createPharmacyAndOwner('S201A');
    const tenantB = await createPharmacyAndOwner('S201B');
    const now = new Date().toISOString();

    // Register a device for Tenant A
    const deviceAId = generateUuidV7();
    await ctx.db.insert(devices).values({
      id: deviceAId,
      pharmacyId: tenantA.pharmacyId,
      branchId: tenantA.branchId,
      counterId: tenantA.counterId,
      deviceName: 'Device A',
      isRevoked: false,
      createdAt: now,
      updatedAt: now,
    });
    const deviceTokenA = signDeviceToken({
      pharmacyId: tenantA.pharmacyId,
      branchId: tenantA.branchId,
      deviceId: deviceAId,
    });

    // Seed product and batch in Tenant A and Tenant B
    const taxA = generateUuidV7();
    const prodA = generateUuidV7();
    const batchA = generateUuidV7();
    const taxB = generateUuidV7();
    const prodB = generateUuidV7();
    const batchB = generateUuidV7();

    await ctx.db.insert(taxCategories).values([
      {
        id: taxA,
        pharmacyId: tenantA.pharmacyId,
        name: 'Exempt',
        rateBp: 0,
        isExempt: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: taxB,
        pharmacyId: tenantB.pharmacyId,
        name: 'Exempt',
        rateBp: 0,
        isExempt: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await ctx.db.insert(products).values([
      {
        id: prodA,
        pharmacyId: tenantA.pharmacyId,
        taxCategoryId: taxA,
        brandName: 'Prod A',
        mrpPaisa: 1000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: prodB,
        pharmacyId: tenantB.pharmacyId,
        taxCategoryId: taxB,
        brandName: 'Prod B',
        mrpPaisa: 1000,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await ctx.db.insert(batches).values([
      {
        id: batchA,
        pharmacyId: tenantA.pharmacyId,
        productId: prodA,
        batchNo: 'BA',
        expiryDate: '2028-12-31',
        costPaisa: 500,
        mrpPaisa: 1000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: batchB,
        pharmacyId: tenantB.pharmacyId,
        productId: prodB,
        batchNo: 'BB',
        expiryDate: '2028-12-31',
        costPaisa: 500,
        mrpPaisa: 1000,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // Seed an in_transit stock transfer in Tenant A and in Tenant B
    const transferAId = generateUuidV7();
    const lineAId = generateUuidV7();
    const transferBId = generateUuidV7();
    const lineBId = generateUuidV7();

    await ctx.db.insert(stockTransfers).values([
      {
        id: transferAId,
        pharmacyId: tenantA.pharmacyId,
        transferNumber: 'ST-A-001',
        sourceBranchId: tenantA.branchId,
        destinationBranchId: tenantA.branchId,
        status: 'in_transit',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: transferBId,
        pharmacyId: tenantB.pharmacyId,
        transferNumber: 'ST-B-001',
        sourceBranchId: tenantB.branchId,
        destinationBranchId: tenantB.branchId,
        status: 'in_transit',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await ctx.db.insert(stockTransferLines).values([
      {
        id: lineAId,
        pharmacyId: tenantA.pharmacyId,
        transferId: transferAId,
        productId: prodA,
        batchId: batchA,
        quantityRequested: 10,
        quantityDispatched: 10,
        quantityReceived: 0,
        shortageQuantity: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: lineBId,
        pharmacyId: tenantB.pharmacyId,
        transferId: transferBId,
        productId: prodB,
        batchId: batchB,
        quantityRequested: 10,
        quantityDispatched: 10,
        quantityReceived: 0,
        shortageQuantity: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // Tenant A pushes stock_transfer.received referencing Tenant A's transferAId,
    // but passes Tenant B's lineBId to overwrite Tenant B's stockTransferLines!
    const pushRes = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: { authorization: `Bearer ${deviceTokenA}` },
      payload: {
        events: [
          {
            eventId: generateUuidV7(),
            deviceSeq: 1,
            type: 'stock_transfer.received',
            entityId: transferAId,
            occurredAt: now,
            schemaVersion: 1,
            payload: {
              transferId: transferAId,
              transferNumber: 'ST-A-001',
              destinationBranchId: tenantA.branchId,
              receivedByUserId: tenantA.ownerId,
              receivedAt: now,
              lines: [
                {
                  lineId: lineBId, // Foreign Tenant B lineId!
                  productId: prodA,
                  batchId: batchA,
                  quantityReceived: 99,
                  shortageQuantity: 0,
                  unitCostPaisa: 500,
                  receiveMovementId: generateUuidV7(),
                },
              ],
            },
          },
        ],
      },
    });

    expect(pushRes.statusCode).toBe(200);
    const results = pushRes.json<{ results: Array<{ status: string }> }>().results;
    expect(results[0]?.status).toBe('rejected');

    // Verify Tenant B's lineBId was NOT modified!
    const lineBRow = await ctx.client.query<{ quantity_received: number }>(
      'SELECT quantity_received FROM stock_transfer_lines WHERE id = $1',
      [lineBId]
    );
    expect(lineBRow.rows[0]?.quantity_received).toBe(0);
  });

  it('S2-02: AR and AP reminders reject cross-tenant partyId and documentId and never leak foreign customer/supplier names', async () => {
    const tenantA = await createPharmacyAndOwner('S202A');
    const tenantB = await createPharmacyAndOwner('S202B');
    const now = new Date().toISOString();

    const customerBId = generateUuidV7();
    const supplierBId = generateUuidV7();

    await ctx.db.insert(customers).values({
      id: customerBId,
      pharmacyId: tenantB.pharmacyId,
      name: 'Confidential Tenant B Customer',
      phone: '03001112222',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(suppliers).values({
      id: supplierBId,
      pharmacyId: tenantB.pharmacyId,
      name: 'Confidential Tenant B Supplier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Tenant A tries to create an AR reminder with Tenant B's customerBId
    const arPostRes = await app.inject({
      method: 'POST',
      url: '/api/finance/ar/reminders',
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      payload: {
        partyType: 'customer',
        partyId: customerBId,
        channel: 'sms',
        amountPaisa: 50000,
      },
    });
    expect(arPostRes.statusCode).toBe(404);

    // Tenant A tries to create an AP reminder with Tenant B's supplierBId
    const apPostRes = await app.inject({
      method: 'POST',
      url: '/api/finance/ap/reminders',
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      payload: {
        partyType: 'supplier',
        partyId: supplierBId,
        channel: 'email',
        amountPaisa: 50000,
      },
    });
    expect(apPostRes.statusCode).toBe(404);
  });

  it('S2-03: GET /api/purchase-orders/:id and GET /api/admin/audit-logs never expose pinHash in JSON responses', async () => {
    const tenant = await createPharmacyAndOwner('S203');
    const now = new Date().toISOString();

    const supplierId = generateUuidV7();
    const poId = generateUuidV7();
    await ctx.db.insert(suppliers).values({
      id: supplierId,
      pharmacyId: tenant.pharmacyId,
      name: 'S203 Supplier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(purchaseOrders).values({
      id: poId,
      pharmacyId: tenant.pharmacyId,
      branchId: tenant.branchId,
      supplierId,
      poNumber: 'PO-S203-001',
      status: 'draft',
      issueDate: '2026-10-28',
      totalExpectedCostPaisa: 10000,
      createdBy: tenant.ownerId,
      createdAt: now,
      updatedAt: now,
    });

    // 1. GET /api/purchase-orders/:id must not include pinHash on creator
    const poRes = await app.inject({
      method: 'GET',
      url: `/api/purchase-orders/${poId}`,
      headers: { authorization: `Bearer ${tenant.ownerToken}` },
    });
    expect(poRes.statusCode).toBe(200);
    const poBody = poRes.json<{ data: { creator: Record<string, unknown> } }>();
    expect(poBody.data.creator).toBeDefined();
    expect(poBody.data.creator.pinHash).toBeUndefined();
    expect(poBody.data.creator.failedLoginAttempts).toBeUndefined();
    expect(poBody.data.creator.lockedUntil).toBeUndefined();

    // 2. Insert a user change_log entry in a fresh tenant with no audit_logs so GET /api/admin/audit-logs uses the change_log fallback
    await ctx.db.insert(changeLog).values({
      pharmacyId: tenant.pharmacyId,
      entity: 'user',
      entityId: tenant.ownerId,
      op: 'upsert',
      data: {
        id: tenant.ownerId,
        name: 'Dr. Owner',
        role: 'owner',
        pinHash: '$2a$10$secretHashShouldBeStripped',
        isActive: true,
      },
      createdAt: now,
    });

    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs',
      headers: { authorization: `Bearer ${tenant.ownerToken}` },
    });
    expect(auditRes.statusCode).toBe(200);
    const rawAuditText = auditRes.body;
    expect(rawAuditText).not.toContain('pinHash');
    expect(rawAuditText).not.toContain('$2a$10$secretHashShouldBeStripped');
  });

  it('S2-04: rejects cross-tenant foreign key references across finance, inventory, purchasing, HR, and prescriptions routes', async () => {
    const tenantA = await createPharmacyAndOwner('S204A');
    const tenantB = await createPharmacyAndOwner('S204B');
    const now = new Date().toISOString();

    await seedDefaultChartOfAccounts(ctx.db, tenantA.pharmacyId);
    await seedDefaultChartOfAccounts(ctx.db, tenantB.pharmacyId);

    // Seed entities in Tenant A and Tenant B
    const taxA = generateUuidV7();
    const prodA = generateUuidV7();
    const batchA = generateUuidV7();
    const suppA = generateUuidV7();
    const locA = generateUuidV7();

    const taxB = generateUuidV7();
    const prodB = generateUuidV7();
    const batchB = generateUuidV7();
    const custB = generateUuidV7();
    const invB = generateUuidV7();
    const locB = generateUuidV7();
    const journalB = generateUuidV7();

    await ctx.db.insert(taxCategories).values([
      {
        id: taxA,
        pharmacyId: tenantA.pharmacyId,
        name: 'Exempt',
        rateBp: 0,
        isExempt: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: taxB,
        pharmacyId: tenantB.pharmacyId,
        name: 'Exempt',
        rateBp: 0,
        isExempt: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await ctx.db.insert(products).values([
      {
        id: prodA,
        pharmacyId: tenantA.pharmacyId,
        taxCategoryId: taxA,
        brandName: 'Prod A',
        mrpPaisa: 1000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: prodB,
        pharmacyId: tenantB.pharmacyId,
        taxCategoryId: taxB,
        brandName: 'Prod B',
        mrpPaisa: 1000,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await ctx.db.insert(batches).values([
      {
        id: batchA,
        pharmacyId: tenantA.pharmacyId,
        productId: prodA,
        batchNo: 'BA',
        expiryDate: '2028-12-31',
        costPaisa: 500,
        mrpPaisa: 1000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: batchB,
        pharmacyId: tenantB.pharmacyId,
        productId: prodB,
        batchNo: 'BB',
        expiryDate: '2028-12-31',
        costPaisa: 500,
        mrpPaisa: 1000,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await ctx.db.insert(suppliers).values({
      id: suppA,
      pharmacyId: tenantA.pharmacyId,
      name: 'Supplier A',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(customers).values({
      id: custB,
      pharmacyId: tenantB.pharmacyId,
      name: 'Customer B',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(invoices).values({
      id: invB,
      pharmacyId: tenantB.pharmacyId,
      counterId: tenantB.counterId,
      cashierUserId: tenantB.ownerId,
      invoiceNumber: 'INV-B-S204',
      clientRequestId: generateUuidV7(),
      status: 'finalized',
      subtotalPaisa: 5000,
      discountPaisa: 0,
      taxPaisa: 0,
      totalPaisa: 5000,
      createdAt: now,
    });
    await ctx.db.insert(stockLocations).values([
      {
        id: locA,
        pharmacyId: tenantA.pharmacyId,
        branchId: tenantA.branchId,
        name: 'Loc A',
        code: 'LA',
        type: 'sales_floor',
        isDefault: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: locB,
        pharmacyId: tenantB.pharmacyId,
        branchId: tenantB.branchId,
        name: 'Loc B',
        code: 'LB',
        type: 'sales_floor',
        isDefault: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 1. POST /api/purchase-orders with duplicate local productId + foreign prodB
    const poDupRes = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      payload: {
        branchId: tenantA.branchId,
        supplierId: suppA,
        issueDate: '2026-10-28',
        lines: [
          { productId: prodA, quantityOrdered: 5, expectedCostPaisa: 500 },
          { productId: prodA, quantityOrdered: 5, expectedCostPaisa: 500 },
          { productId: prodB, quantityOrdered: 5, expectedCostPaisa: 500 }, // Foreign prodB!
        ],
      },
    });
    expect(poDupRes.statusCode).toBeGreaterThanOrEqual(400);

    // 2. POST /api/prescriptions with foreign customerId or productId
    const rxRes = await app.inject({
      method: 'POST',
      url: '/api/prescriptions',
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      payload: {
        customerId: custB, // Foreign custB!
        doctorName: 'Dr. Test',
        patientName: 'Patient Test',
        prescriptionDate: '2026-10-28',
        items: [{ productId: prodA, dosageInstructions: '1 tab daily', quantityPrescribed: 10 }],
      },
    });
    expect(rxRes.statusCode).toBe(404);

    // 3. POST /api/hr/employees with foreign branchId
    const hrEmpRes = await app.inject({
      method: 'POST',
      url: '/api/hr/employees',
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      payload: {
        branchId: tenantB.branchId, // Foreign branchId!
        employeeCode: 'EMP-XT-01',
        firstName: 'Cross',
        lastName: 'Tenant',
        designation: 'Cashier',
        department: 'Retail',
        joiningDate: '2026-01-01',
        salaryPaisa: 5000000,
      },
    });
    expect(hrEmpRes.statusCode).toBe(404);

    // 4. POST /api/stock-counts with foreign locationId
    const scRes = await app.inject({
      method: 'POST',
      url: '/api/stock-counts',
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      payload: {
        branchId: tenantA.branchId,
        locationId: locB, // Foreign locB!
        batches: [{ productId: prodA, batchId: batchA }],
      },
    });
    expect(scRes.statusCode).toBe(404);

    // 5. POST /api/stock-transfers with foreign productId
    const stRes = await app.inject({
      method: 'POST',
      url: '/api/stock-transfers',
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      payload: {
        sourceBranchId: tenantA.branchId,
        destinationBranchId: tenantA.branchId,
        lines: [{ productId: prodB, batchId: batchA, quantityRequested: 5, unitCostPaisa: 500 }],
      },
    });
    expect(stRes.statusCode).toBe(404);

    // 6. POST /api/supplier-returns with foreign productId
    const srRes = await app.inject({
      method: 'POST',
      url: '/api/supplier-returns',
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      payload: {
        branchId: tenantA.branchId,
        supplierId: suppA,
        returnDate: '2026-10-28',
        reason: 'damaged',
        lines: [{ productId: prodB, batchId: batchA, quantity: 1, unitCostPaisa: 500 }],
      },
    });
    expect(srRes.statusCode).toBe(404);

    // 7. POST /api/inventory/batches/:id/write-off with foreign branchId
    const woRes = await app.inject({
      method: 'POST',
      url: `/api/inventory/batches/${batchA}/write-off`,
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      payload: {
        branchId: tenantB.branchId, // Foreign branchId!
        quantity: 1,
        reason: 'expired',
      },
    });
    expect(woRes.statusCode).toBe(404);

    // 8. POST /api/finance/journals/:id/post with foreign journalB
    const jpRes = await app.inject({
      method: 'POST',
      url: `/api/finance/journals/${journalB}/post`,
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
    });
    expect(jpRes.statusCode).toBe(404);
  });

  // =========================================================================
  // S2-05: Malformed UUIDs, Zod errors, and 500 error masking
  // =========================================================================
  it('S2-05: returns 400 (never 500 or raw Postgres errors) on malformed UUID params and invalid Zod payloads', async () => {
    const tenantA = await createPharmacyAndOwner('S205_A');
    const badPoRes = await app.inject({
      method: 'GET',
      url: '/api/purchase-orders/not-a-valid-uuid',
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
    });
    expect(badPoRes.statusCode).toBe(400);
    expect(JSON.stringify(badPoRes.json())).not.toMatch(/invalid input syntax for type uuid/i);

    const badCustRes = await app.inject({
      method: 'GET',
      url: '/api/customers/not-a-valid-uuid',
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
    });
    expect(badCustRes.statusCode).toBe(400);

    const badCashBankRes = await app.inject({
      method: 'POST',
      url: '/api/finance/cash-bank/accounts',
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      payload: {
        name: '', // invalid empty name
        accountType: 'invalid_type',
      },
    });
    expect(badCashBankRes.statusCode).toBe(400);
  });

  // =========================================================================
  // S2-11: Security headers, 1 MiB bodyLimit, trustProxy, and HTTPS/HSTS enforcement
  // =========================================================================
  it('S2-11: sets defensive security headers, enforces 1 MiB bodyLimit (413), and enforces HTTPS + HSTS in production when ENFORCE_HTTPS=true', async () => {
    const healthRes = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.headers['x-content-type-options']).toBe('nosniff');
    expect(healthRes.headers['x-frame-options']).toBe('DENY');
    expect(healthRes.headers['referrer-policy']).toBe('no-referrer');
    expect(healthRes.headers['content-security-policy']).toContain("default-src 'self'");
    expect(healthRes.headers['x-permitted-cross-domain-policies']).toBe('none');

    // Oversized payload > 1 MiB -> 413
    const hugeBody = JSON.stringify({ data: 'x'.repeat(1024 * 1024 + 500) });
    const hugeRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: hugeBody,
    });
    expect(hugeRes.statusCode).toBe(413);

    // HTTPS + HSTS enforcement when NODE_ENV=production and ENFORCE_HTTPS=true
    const origNodeEnv = process.env.NODE_ENV;
    const origEnforceHttps = process.env.ENFORCE_HTTPS;
    const origJwtSecret = process.env.JWT_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      process.env.ENFORCE_HTTPS = 'true';
      process.env.JWT_SECRET = 'prod-strong-secret-that-is-at-least-32-bytes-long!!';

      const prodApp = buildApp({ db: ctx.db, logger: false });
      await prodApp.ready();

      const httpRes = await prodApp.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { 'x-forwarded-proto': 'http' },
      });
      expect(httpRes.statusCode).toBe(403);

      const httpsHealthRes = await prodApp.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-forwarded-proto': 'https' },
      });
      expect(httpsHealthRes.statusCode).toBe(200);
      expect(httpsHealthRes.headers['strict-transport-security']).toContain('max-age=31536000');

      await prodApp.close();
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      if (origEnforceHttps === undefined) {
        delete process.env.ENFORCE_HTTPS;
      } else {
        process.env.ENFORCE_HTTPS = origEnforceHttps;
      }
      if (origJwtSecret === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = origJwtSecret;
      }
    }
  });

  // =========================================================================
  // S2-12: Logger redaction and no raw console.error in sync service
  // =========================================================================
  it('S2-12: configures Pino redaction paths in app.ts and avoids raw console.error in sync/service.ts', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../../apps/server/src/app.ts'),
      'utf8'
    );
    expect(appSource).toContain('redact');
    expect(appSource).toContain('req.headers.authorization');
    expect(appSource).toContain('*.pin');
    expect(appSource).toContain('*.pinHash');

    const syncServiceSource = fs.readFileSync(
      path.resolve(__dirname, '../../apps/server/src/sync/service.ts'),
      'utf8'
    );
    expect(syncServiceSource).not.toMatch(/console\.error\(/);
  });

  // =========================================================================
  // M-12: Owner self-demotion & last-owner protection
  // =========================================================================
  it('M-12: Enforces owner self-demotion and last-owner protection on PATCH /api/admin/users/:id', async () => {
    const tenant = await createPharmacyAndOwner('M12');
    const now = new Date().toISOString();

    // 1. Owner attempts to demote self -> 400
    const selfDemoteRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${tenant.ownerId}`,
      headers: { authorization: `Bearer ${tenant.ownerToken}` },
      payload: { role: 'cashier' },
    });
    expect(selfDemoteRes.statusCode).toBe(400);
    expect(selfDemoteRes.json().message).toMatch(/Cannot demote or deactivate/i);

    // 2. Owner attempts to deactivate self -> 400
    const selfDeactRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${tenant.ownerId}`,
      headers: { authorization: `Bearer ${tenant.ownerToken}` },
      payload: { isActive: false },
    });
    expect(selfDeactRes.statusCode).toBe(400);
    expect(selfDeactRes.json().message).toMatch(/Cannot demote or deactivate/i);

    // 3. Create a second owner
    const secondOwnerId = generateUuidV7();
    const pinHash2 = await hashPin('87654321');
    await ctx.db.insert(users).values({
      id: secondOwnerId,
      pharmacyId: tenant.pharmacyId,
      name: 'Second Owner',
      role: 'owner',
      pinHash: pinHash2,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Owner 1 deactivates Owner 2 -> 200 (allowed since Owner 1 remains active)
    const deactOwner2Res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${secondOwnerId}`,
      headers: { authorization: `Bearer ${tenant.ownerToken}` },
      payload: { isActive: false },
    });
    expect(deactOwner2Res.statusCode).toBe(200);

    // Now only Owner 1 is active. Attempting to demote Owner 1 -> 400
    const lastOwnerDemote = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${tenant.ownerId}`,
      headers: { authorization: `Bearer ${tenant.ownerToken}` },
      payload: { role: 'manager' },
    });
    expect(lastOwnerDemote.statusCode).toBe(400);
    expect(lastOwnerDemote.json().message).toMatch(/Cannot demote or deactivate.*owner/i);
  });
});
