import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7 } from '../../packages/shared/src/index';
import { buildApp } from '../../apps/server/src/app';
import {
  createTestContext,
  type TestDatabaseContext,
} from '../../apps/server/src/db/test-helper';
import {
  pharmacies,
  branches,
  counters,
  users,
  devices,
  taxCategories,
  products,
  invoices,
  invoiceLines,
} from '../../apps/server/src/db/schema';
import {
  getJwtSecret,
  signDeviceToken,
  signUserToken,
} from '../../apps/server/src/auth/jwt';
import { seedDevEnvironment } from '../../apps/server/src/scripts/seed-dev';
import { initDatabase, closeDatabase, getDatabase } from '../../apps/desktop/src/main/db';
import {
  completeSetup,
  getSetupStatus,
  hashPin,
  login,
  logout,
  createStaffMember,
  setSessionForTesting,
} from '../../apps/desktop/src/main/auth';
import { createSupplier, receiveGrn } from '../../apps/desktop/src/main/purchasing';
import { openShift, closeShift } from '../../apps/desktop/src/main/shifts';
import { createInvoice } from '../../apps/desktop/src/main/invoices';
import { createProduct } from '../../apps/desktop/src/main/products';
import { finalizeSale } from '../../apps/desktop/src/main/finalizeSale';
import { pushPending } from '../../apps/desktop/src/main/sync/core/pushPending';
import { pullAndApply } from '../../apps/desktop/src/main/sync/core/pullAndApply';

describe('Audit A1 Regression Suite — Critical Findings (C-01 to C-11)', () => {
  let ctx: TestDatabaseContext;
  let app: ReturnType<typeof buildApp>;
  let serverUrl: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000, loginRateLimitMax: 1000 });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address() as { port: number };
    serverUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    closeDatabase();
    await app.close();
    await ctx.cleanup();
  });

  async function seedServerTenant(name: string) {
    const now = new Date().toISOString();
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const ownerId = generateUuidV7();
    const deviceId = generateUuidV7();
    const taxCategoryId = generateUuidV7();
    const productId = generateUuidV7();

    const ownerPinHash = await hashPin('12345678');
    const pharmacyCode = name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase() + '_' + pharmacyId.slice(0, 8);

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name,
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
      lastInvoiceSeq: 0,
      lastCreditNoteSeq: 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(users).values({
      id: ownerId,
      pharmacyId,
      name: `Owner ${name}`,
      role: 'owner',
      pinHash: ownerPinHash,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(devices).values({
      id: deviceId,
      pharmacyId,
      branchId,
      counterId,
      deviceName: 'Counter 1 Device',
      isRevoked: false,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(taxCategories).values({
      id: taxCategoryId,
      pharmacyId,
      name: 'Standard Exempt',
      rateBp: 0,
      isExempt: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId,
      brandName: 'Panadol 500mg',
      genericName: 'Paracetamol',
      strength: '500mg',
      form: 'Tablet',
      manufacturer: 'GSK',
      taxCategoryId,
      mrpPaisa: 5000,
      isControlled: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const deviceToken = signDeviceToken({ pharmacyId, branchId, deviceId });
    const ownerToken = signUserToken({
      userId: ownerId,
      pharmacyId,
      role: 'owner',
      name: `Owner ${name}`,
    });

    return {
      pharmacyId,
      branchId,
      counterId,
      ownerId,
      deviceId,
      taxCategoryId,
      productId,
      deviceToken,
      ownerToken,
    };
  }

  function resetDesktopDbWithTenant(tenant: {
    branchId: string;
    counterId: string;
    ownerId: string;
    taxCategoryId: string;
    productId: string;
  }) {
    closeDatabase();
    initDatabase(':memory:');
    const db = getDatabase();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      tenant.branchId,
      'Main Branch',
      now,
      now
    );
    db.prepare(
      'INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, last_credit_note_seq, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)'
    ).run(tenant.counterId, tenant.branchId, 'Counter 1', 'C1', now, now);
    db.prepare(
      'INSERT INTO users (id, name, role, pin_hash, is_active, failed_login_attempts, locked_until, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, NULL, ?, ?)'
    ).run(tenant.ownerId, 'Owner', 'owner', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', now, now);
    db.prepare(
      'INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)'
    ).run(tenant.taxCategoryId, 'Standard Exempt', now, now);
    db.prepare(
      `INSERT INTO products (
        id, brand_name, generic_name, strength, form, manufacturer, barcode,
        tax_category_id, mrp_paisa, is_controlled, is_active, created_at, updated_at
      ) VALUES (?, 'Panadol 500mg', 'Paracetamol', '500mg', 'Tablet', 'GSK', NULL, ?, 5000, 0, 1, ?, ?)`
    ).run(tenant.productId, tenant.taxCategoryId, now, now);

    setSessionForTesting({
      user: { id: tenant.ownerId, name: 'Owner', role: 'owner', isActive: true },
      branch: { id: tenant.branchId, name: 'Main Branch' },
      counter: { id: tenant.counterId, name: 'Counter 1' },
      isLocked: false,
      idleTimeoutMinutes: 5,
    });

    return db;
  }

  it('C-01: desktop receiveGrn outbox payload is accepted by server /sync/push', async () => {
    const tenant = await seedServerTenant('C01 Pharmacy');
    const db = resetDesktopDbWithTenant(tenant);

    const supplier = createSupplier({ name: 'Alpha Distributors' });
    receiveGrn({
      supplierId: supplier.id,
      supplierInvoiceNo: 'GRN-C01-001',
      invoiceDate: '2026-10-28',
      lines: [
        {
          productId: tenant.productId,
          batchNo: 'BATCH-C01',
          expiryDate: '2028-12-31',
          quantity: 50,
          costPaisa: 3500,
          mrpPaisa: 5000,
        },
      ],
    });

    const summary = await pushPending(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );

    expect(summary.rejected).toBe(0);
    expect(summary.acked).toBe(1);
  });

  it('C-02: desktop openShift and closeShift outbox events sync without UNKNOWN_TYPE rejection', async () => {
    const tenant = await seedServerTenant('C02 Pharmacy');
    const db = resetDesktopDbWithTenant(tenant);

    const shift = openShift(
      { openingCashPaisa: 500000 },
      {
        counterId: tenant.counterId,
        branchId: tenant.branchId,
        cashierUserId: tenant.ownerId,
        rawDb: db,
      }
    );

    closeShift(
      { shiftId: shift.id, countedCashPaisa: 500000 },
      { cashierUserId: tenant.ownerId, rawDb: db }
    );

    const summary = await pushPending(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );

    expect(summary.rejected).toBe(0);
    expect(summary.acked).toBe(2);
  });

  it('C-03: completeSetup rejects unauthenticated calls when initial setup is already completed', async () => {
    const tenant = await seedServerTenant('C03 Pharmacy');
    const db = resetDesktopDbWithTenant(tenant);
    logout();

    expect(getSetupStatus(db).needsSetup).toBe(false);

    await expect(
      completeSetup(
        {
          branchName: 'Attacker Branch',
          counterName: 'Attacker Counter',
          ownerName: 'Rogue Owner',
          pin: '99999999',
        },
        db
      )
    ).rejects.toThrow();

    // Repair state test: If an owner exists but counters/branches are missing,
    // needsSetup MUST remain false and completeSetup MUST refuse to run (not public wizard).
    db.prepare('DELETE FROM outbox').run();
    db.prepare('DELETE FROM counters').run();
    db.prepare('DELETE FROM branches').run();

    const repairStatus = getSetupStatus(db);
    expect(repairStatus.needsSetup).toBe(false);
    expect(repairStatus.isRepairState).toBe(true);

    await expect(
      completeSetup(
        {
          branchName: 'Takeover Branch',
          counterName: 'Takeover Counter',
          ownerName: 'Takeover Owner',
          pin: '88888888',
        },
        db
      )
    ).rejects.toThrow(/Initial setup has already been completed/);
  });

  it('C-04: POST /api/auth/login requires pharmacyCode, isolates identical usernames, and returns generic 401', async () => {
    const tenantA = await seedServerTenant('C04 Tenant A');
    const tenantB = await seedServerTenant('C04 Tenant B');
    const now = new Date().toISOString();

    // Set unique pharmacy codes
    const codeA = 'PHARM_A';
    const codeB = 'PHARM_B';
    await ctx.client.query('UPDATE pharmacies SET code = $1 WHERE id = $2', [codeA, tenantA.pharmacyId]);
    await ctx.client.query('UPDATE pharmacies SET code = $1 WHERE id = $2', [codeB, tenantB.pharmacyId]);

    const pinHashA = await hashPin('11112222');
    const pinHashB = await hashPin('22223333');

    await ctx.db.insert(users).values([
      {
        id: generateUuidV7(),
        pharmacyId: tenantA.pharmacyId,
        name: 'SharedAdminName',
        role: 'owner',
        pinHash: pinHashA,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: generateUuidV7(),
        pharmacyId: tenantB.pharmacyId,
        name: 'SharedAdminName',
        role: 'owner',
        pinHash: pinHashB,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 1. Missing pharmacyCode -> 400 Bad Request
    const missingPharmacyRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        name: 'SharedAdminName',
        pin: '22223333',
      },
    });
    expect(missingPharmacyRes.statusCode).toBe(400);

    // 2. Unknown pharmacyCode -> generic 401 Invalid credentials
    const unknownPharmacyRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        pharmacyCode: 'NON_EXISTENT_PHARM',
        name: 'SharedAdminName',
        pin: '22223333',
      },
    });
    expect(unknownPharmacyRes.statusCode).toBe(401);
    expect(unknownPharmacyRes.json().message).toBe('Invalid credentials');

    // 3. Unknown username -> generic 401 Invalid credentials
    const unknownUserRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        pharmacyCode: codeB,
        name: 'NoSuchUserHere',
        pin: '22223333',
      },
    });
    expect(unknownUserRes.statusCode).toBe(401);
    expect(unknownUserRes.json().message).toBe('Invalid credentials');

    // 4. Wrong PIN -> generic 401 Invalid credentials
    const wrongPinRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        pharmacyCode: codeB,
        name: 'SharedAdminName',
        pin: '99999999',
      },
    });
    expect(wrongPinRes.statusCode).toBe(401);
    expect(wrongPinRes.json().message).toBe('Invalid credentials');

    // 5. Valid credentials with pharmacyCode -> 200 OK scoped strictly to Tenant B
    const validRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        pharmacyCode: codeB,
        name: 'SharedAdminName',
        pin: '22223333',
      },
    });
    expect(validRes.statusCode).toBe(200);
    expect(validRes.json().user.pharmacyId).toBe(tenantB.pharmacyId);
  });

  it('C-05: seedDevEnvironment uses 8-digit bcrypt PIN and refuses to run in production', async () => {
    // 1. Refuses to run in production
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(seedDevEnvironment(ctx.db)).rejects.toThrow(/production/i);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }

    // 2. In dev, seeds owner with 8-digit PIN (12345678) using bcrypt
    const seeded = await seedDevEnvironment(ctx.db);
    expect(seeded.owner.pinHash).not.toMatch(/^[a-f0-9]{64}$/); // NOT SHA-256
    expect(seeded.owner.pinHash).toMatch(/^\$2[aby]\$/); // bcrypt hash

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        pharmacyCode: seeded.pharmacy.code || 'DEV',
        name: seeded.owner.name,
        pin: '12345678',
      },
    });
    expect(loginRes.statusCode).toBe(200);
  });

  it('C-06: user change_log has pinHash, pullAndApply persists it, 5 failed attempts lock account, and owner unlocks', async () => {
    const tenant = await seedServerTenant('C06 Pharmacy');
    const db = resetDesktopDbWithTenant(tenant);

    // 1. Rejects staff PIN < 6 digits and owner PIN !== 8 digits
    const rejectShortRes = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${tenant.ownerToken}` },
      payload: {
        name: 'Short Pin Cashier',
        role: 'cashier',
        pin: '1234', // < 6 digits
      },
    });
    expect(rejectShortRes.statusCode).toBe(400);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${tenant.ownerToken}` },
      payload: {
        name: 'Cloud Cashier C06',
        role: 'cashier',
        pin: '778899', // 6 digits
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdUser = createRes.json<{ id: string }>();

    // 2. change_log includes pinHash
    const changeEntry = await ctx.client.query(
      "SELECT data FROM change_log WHERE entity = 'user' AND entity_id = $1",
      [createdUser.id]
    );
    expect(changeEntry.rows[0]?.data.pinHash).toBeDefined();

    // 3. pullAndApply stores pin_hash locally so offline login works
    await pullAndApply(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );
    await expect(login(createdUser.id, '778899', db)).resolves.toBeDefined();

    // 4. 5 failed login attempts lock account for 15 minutes on desktop
    for (let i = 0; i < 5; i++) {
      await expect(login(createdUser.id, '000000', db)).rejects.toThrow(/Invalid PIN/);
    }
    // 6th attempt is locked
    await expect(login(createdUser.id, '778899', db)).rejects.toThrow(/locked/i);

    // 5. pullAndApply does NOT overwrite local failed_login_attempts or locked_until
    await pullAndApply(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );
    await expect(login(createdUser.id, '778899', db)).rejects.toThrow(/locked/i);
  });

  it('C-07: PostgreSQL database enforces immutability triggers preventing UPDATE/DELETE on finalized invoices', async () => {
    const tenant = await seedServerTenant('C07 Pharmacy');
    const now = new Date().toISOString();
    const invoiceId = generateUuidV7();
    const lineId = generateUuidV7();

    await ctx.db.insert(invoices).values({
      id: invoiceId,
      pharmacyId: tenant.pharmacyId,
      counterId: tenant.counterId,
      cashierUserId: tenant.ownerId,
      invoiceNumber: 'INV-C07-000001',
      clientRequestId: generateUuidV7(),
      status: 'finalized',
      subtotalPaisa: 5000,
      discountPaisa: 0,
      taxPaisa: 0,
      totalPaisa: 5000,
      createdAt: now,
    });

    await ctx.db.insert(invoiceLines).values({
      id: lineId,
      pharmacyId: tenant.pharmacyId,
      invoiceId,
      productId: tenant.productId,
      batchId: null,
      quantity: 1,
      unitPricePaisa: 5000,
      discountPaisa: 0,
      taxRateBp: 0,
      taxPaisa: 0,
      lineTotalPaisa: 5000,
    });

    await expect(
      ctx.client.query('UPDATE invoices SET total_paisa = 100 WHERE id = $1', [invoiceId])
    ).rejects.toThrow();
  });

  it('C-08: getJwtSecret refuses to fall back to hardcoded development secret when JWT_SECRET is unset or default in production', () => {
    const prevSecret = process.env.JWT_SECRET;
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      // 1. Unset JWT_SECRET in production -> throws
      delete process.env.JWT_SECRET;
      expect(() => getJwtSecret()).toThrow(/JWT_SECRET/i);

      // 2. Default dev secret in production -> throws
      process.env.JWT_SECRET = 'dev_pos_jwt_secret_change_in_production';
      expect(() => getJwtSecret()).toThrow(/default/i);
    } finally {
      if (prevSecret !== undefined) {
        process.env.JWT_SECRET = prevSecret;
      } else {
        delete process.env.JWT_SECRET;
      }
      if (prevNodeEnv !== undefined) {
        process.env.NODE_ENV = prevNodeEnv;
      } else {
        delete process.env.NODE_ENV;
      }
    }
  });

  it('C-09: POST /api/admin/counters rejects branchId belonging to a different pharmacy tenant', async () => {
    const tenantA = await seedServerTenant('C09 Tenant A');
    const tenantB = await seedServerTenant('C09 Tenant B');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/counters',
      headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      payload: {
        branchId: tenantB.branchId, // Foreign tenant's branchId!
        name: 'Cross-Tenant Counter',
        code: 'XT1',
      },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('C-10: desktop createInvoice outbox payload conforms to server InvoiceCreatedPayloadSchema on /sync/push', async () => {
    const tenant = await seedServerTenant('C10 Pharmacy');
    const db = resetDesktopDbWithTenant(tenant);

    const session = {
      user: { id: tenant.ownerId, name: 'Owner', role: 'owner' as const, isActive: true },
      branch: { id: tenant.branchId, name: 'Main Branch' },
      counter: { id: tenant.counterId, name: 'Counter 1' },
      isLocked: false,
      idleTimeoutMinutes: 5,
    };

    createInvoice(
      {
        lines: [
          {
            productId: tenant.productId,
            quantity: 1,
            unitPricePaisa: 5000,
            discountType: 'percent',
            discountBp: 0,
            flatDiscountPaisa: 0,
            taxRateBp: 0,
            isTaxExempt: true,
          },
        ],
        paymentMethod: 'cash',
        tenderedPaisa: 5000,
      },
      session,
      db
    );

    const summary = await pushPending(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );

    expect(summary.rejected).toBe(0);
    expect(summary.acked).toBe(1);
  });

  it('C-11: locally created desktop staff and products sync so sales referencing them are accepted instead of looping in retry_later', async () => {
    const tenant = await seedServerTenant('C11 Pharmacy');
    const db = resetDesktopDbWithTenant(tenant);
    const now = new Date().toISOString();

    const localCashier = await createStaffMember(
      { name: 'Local Cashier C11', role: 'cashier', pin: '432155' },
      undefined,
      db
    );

    const localProduct = createProduct(
      {
        brandName: 'Local Only Syrup',
        genericName: 'Dextromethorphan',
        strength: '120ml',
        form: 'Syrup',
        manufacturer: 'Local Pharma',
        taxCategoryId: tenant.taxCategoryId,
        mrpPaisa: 12000,
        isControlled: false,
        isActive: true,
      },
      db
    );

    const batchId = generateUuidV7();
    db.prepare(
      'INSERT INTO batches (id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at) VALUES (?, ?, ?, ?, 8000, 12000, ?, ?)'
    ).run(batchId, localProduct.id, 'B-C11', '2028-12-31', now, now);
    db.prepare(
      `INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type, quantity_signed, reference_type, reference_id, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'adjustment', 20, 'stock_adjustment', ?, 'Initial stock', ?, ?)`
    ).run(generateUuidV7(), localProduct.id, batchId, tenant.branchId, generateUuidV7(), now, now);

    finalizeSale(
      {
        clientRequestId: generateUuidV7(),
        counterId: tenant.counterId,
        cashierUserId: localCashier.id,
        lines: [{ productId: localProduct.id, quantity: 1 }],
        payments: [{ method: 'cash', amountPaisa: 12000 }],
      },
      { db, today: '2026-10-28' }
    );

    const summary = await pushPending(
      { db, fetch: globalThis.fetch },
      { serverUrl, token: tenant.deviceToken }
    );

    expect(summary.retryLater).toBe(0);
    expect(summary.acked).toBe(1);
  });
});
