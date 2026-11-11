import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import { pharmacies, users, prescriptions } from '../db/schema';
import { signUserToken } from '../auth/jwt';

describe('Audit Findings F-H-02 & F-M-08: Transactions & Validation Hardening', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;
  let pharmacyId: string;
  let ownerToken: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = await buildApp({ db: ctx.db });
    await app.ready();

    pharmacyId = generateUuidV7();
    userId = generateUuidV7();

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: 'Validation Test Pharmacy',
      code: 'VTP',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await ctx.db.insert(users).values({
      id: userId,
      pharmacyId,
      name: 'Owner Admin',
      role: 'owner',
      pinHash: 'hash',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    ownerToken = signUserToken({
      userId,
      pharmacyId,
      role: 'owner',
      tokenVersion: 1,
      name: 'Owner Admin',
    });
  });

  afterAll(async () => {
    await app.close();
    await ctx.cleanup();
  });

  it('cash-bank endpoints return 400 (not 500) on invalid body payloads (F-M-08)', async () => {
    // 1. POST /api/finance/cash-bank/accounts with invalid payload
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/finance/cash-bank/accounts',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {},
    });
    expect(res1.statusCode).toBe(400);

    // 2. POST /api/finance/cash-bank/transfers with invalid payload
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/finance/cash-bank/transfers',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {},
    });
    expect(res2.statusCode).toBe(400);

    // 3. POST /api/finance/cash-bank/deposits with invalid payload
    const res3 = await app.inject({
      method: 'POST',
      url: '/api/finance/cash-bank/deposits',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {},
    });
    expect(res3.statusCode).toBe(400);

    // 4. POST /api/finance/cash-bank/reconciliation/save with invalid payload
    const res4 = await app.inject({
      method: 'POST',
      url: '/api/finance/cash-bank/reconciliation/save',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {},
    });
    expect(res4.statusCode).toBe(400);
  });

  it('routes reject non-UUID params with 400 instead of Postgres 22P02 500 (F-M-08)', async () => {
    const invalidId = 'not-a-valid-uuid-123';

    // Customers
    const custRes = await app.inject({
      method: 'GET',
      url: `/api/customers/${invalidId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(custRes.statusCode).toBe(400);

    // Prescriptions
    const rxRes = await app.inject({
      method: 'GET',
      url: `/api/prescriptions/${invalidId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(rxRes.statusCode).toBe(400);

    // Suppliers
    const supRes = await app.inject({
      method: 'GET',
      url: `/api/suppliers/${invalidId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(supRes.statusCode).toBe(400);

    // Stock Locations
    const locRes = await app.inject({
      method: 'PATCH',
      url: `/api/stock-locations/${invalidId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'Updated' },
    });
    expect(locRes.statusCode).toBe(400);
  });

  it('rejects dispensing against cancelled or fulfilled prescriptions or exhausted repeats (F-M-08)', async () => {
    const rxId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(prescriptions).values({
      id: rxId,
      pharmacyId,
      prescriptionNumber: 'RX-CANCELLED-01',
      prescriptionDate: '2026-10-28',
      patientName: 'Jane Doe',
      repeatCount: 1,
      repeatsUsed: 1,
      refillIntervalDays: 30,
      isControlledDrug: false,
      status: 'cancelled',
      retentionStatus: 'active',
      statutoryRetentionUntil: '2031-10-28',
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/prescriptions/${rxId}/dispense`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        invoiceId: generateUuidV7(),
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('INVALID_STATUS');
  });
});
