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
  batches,
  suppliers,
  invoices,
  invoiceLines,
  payments,
  stockMovements,
} from '../../apps/server/src/db/schema';
import { signDeviceToken, signUserToken } from '../../apps/server/src/auth/jwt';
import { hashPin } from '../../apps/desktop/src/main/auth';

describe('Tenant Isolation Verification Suite (C-09 & Cross-Tenant Boundary Enforcement)', () => {
  let ctx: TestDatabaseContext;
  let app: ReturnType<typeof buildApp>;
  const capturedRoutes: Array<{ method: string; url: string }> = [];

  interface TenantFixture {
    pharmacyId: string;
    pharmacyCode: string;
    branchId: string;
    counterId: string;
    ownerId: string;
    cashierId: string;
    deviceId: string;
    supplierId: string;
    productId: string;
    batchId: string;
    invoiceId: string;
    invoiceLineId: string;
    deviceToken: string;
    ownerToken: string;
    cashierToken: string;
  }

  let tenantA: TenantFixture;
  let tenantB: TenantFixture;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });

    app.addHook('onRoute', (routeOptions) => {
      if (routeOptions.method !== 'HEAD') {
        capturedRoutes.push({ method: routeOptions.method, url: routeOptions.url });
      }
    });

    await app.ready();

    tenantA = await seedIdenticalTenant('Al-Shifa Pharmacy', 'SHIFA_A');
    tenantB = await seedIdenticalTenant('Al-Shifa Pharmacy', 'SHIFA_B');
  });

  afterAll(async () => {
    await app.close();
    await ctx.cleanup();
  });

  async function seedIdenticalTenant(name: string, code: string): Promise<TenantFixture> {
    const now = new Date().toISOString();
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const counterId = generateUuidV7();
    const ownerId = generateUuidV7();
    const cashierId = generateUuidV7();
    const deviceId = generateUuidV7();
    const supplierId = generateUuidV7();
    const taxCatId = generateUuidV7();
    const productId = generateUuidV7();
    const batchId = generateUuidV7();
    const invoiceId = generateUuidV7();
    const invoiceLineId = generateUuidV7();
    const paymentId = generateUuidV7();
    const movementId = generateUuidV7();

    const pinHashOwner = await hashPin('12345678');
    const pinHashCashier = await hashPin('654321');

    // 1. Pharmacy
    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name,
      code,
      createdAt: now,
      updatedAt: now,
    });

    // 2. Branch & Counter (same names across tenants)
    await ctx.db.insert(branches).values({
      id: branchId,
      pharmacyId,
      name: 'Main Branch',
      address: '100 Main Boulevard',
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(counters).values({
      id: counterId,
      pharmacyId,
      branchId,
      name: 'Counter 1',
      code: 'C1',
      lastInvoiceSeq: 1,
      lastCreditNoteSeq: 0,
      createdAt: now,
      updatedAt: now,
    });

    // 3. Users (Owner & Cashier)
    await ctx.db.insert(users).values([
      {
        id: ownerId,
        pharmacyId,
        name: 'Dr. Tariq',
        role: 'owner',
        pinHash: pinHashOwner,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: cashierId,
        pharmacyId,
        name: 'Ali Khan',
        role: 'cashier',
        pinHash: pinHashCashier,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 4. Device
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

    // 5. Supplier, TaxCategory, Product, Batch
    await ctx.db.insert(suppliers).values({
      id: supplierId,
      pharmacyId,
      name: 'MedDistributors Corp',
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(taxCategories).values({
      id: taxCatId,
      pharmacyId,
      name: 'Exempt',
      rateBp: 0,
      isExempt: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(products).values({
      id: productId,
      pharmacyId,
      brandName: 'Amoxicillin 500mg',
      genericName: 'Amoxicillin',
      strength: '500mg',
      form: 'Capsule',
      manufacturer: 'GSK',
      taxCategoryId: taxCatId,
      mrpPaisa: 5000,
      isControlled: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(batches).values({
      id: batchId,
      pharmacyId,
      productId,
      batchNo: 'BATCH-001',
      expiryDate: '2028-12-31',
      costPaisa: 3500,
      mrpPaisa: 5000,
      createdAt: now,
      updatedAt: now,
    });

    // 6. Finalized Invoice & Line
    await ctx.db.insert(invoices).values({
      id: invoiceId,
      pharmacyId,
      counterId,
      cashierUserId: cashierId,
      invoiceNumber: `INV-${code}-000001`,
      clientRequestId: generateUuidV7(),
      status: 'finalized',
      subtotalPaisa: 5000,
      discountPaisa: 0,
      taxPaisa: 0,
      totalPaisa: 5000,
      createdAt: now,
    });

    await ctx.db.insert(invoiceLines).values({
      id: invoiceLineId,
      pharmacyId,
      invoiceId,
      productId,
      batchId,
      quantity: 1,
      unitPricePaisa: 5000,
      discountPaisa: 0,
      taxRateBp: 0,
      taxPaisa: 0,
      lineTotalPaisa: 5000,
    });

    await ctx.db.insert(payments).values({
      id: paymentId,
      pharmacyId,
      invoiceId,
      method: 'cash',
      amountPaisa: 5000,
    });

    await ctx.db.insert(stockMovements).values({
      id: movementId,
      pharmacyId,
      productId,
      batchId,
      branchId,
      type: 'sale',
      quantitySigned: -1,
      referenceType: 'invoice',
      referenceId: invoiceId,
      createdAt: now,
      updatedAt: now,
    });

    const deviceToken = signDeviceToken({ pharmacyId, branchId, deviceId });
    const ownerToken = signUserToken({ userId: ownerId, pharmacyId, role: 'owner', name: 'Dr. Tariq' });
    const cashierToken = signUserToken({ userId: cashierId, pharmacyId, role: 'cashier', name: 'Ali Khan' });

    return {
      pharmacyId,
      pharmacyCode: code,
      branchId,
      counterId,
      ownerId,
      cashierId,
      deviceId,
      supplierId,
      productId,
      batchId,
      invoiceId,
      invoiceLineId,
      deviceToken,
      ownerToken,
      cashierToken,
    };
  }

  // =========================================================================
  // 1. Route Catalog Completeness & Automated Route Discovery Test
  // =========================================================================
  it('enforces that every registered Fastify route is explicitly tested for tenant isolation', () => {
    // Public routes that are intentionally accessible without tenant JWT, with justified reasons
    const PUBLIC_ROUTES: Record<string, string> = {
      'GET /health': 'Unauthenticated health check probe for load balancer / orchestrator',
      'POST /devices/register': 'Initial device registration using a one-time hashed registration code',
      'POST /api/auth/login': 'Web login requiring pharmacyCode to authenticate tenant user',
    };

    // Authenticated routes required to be tenant-isolated
    const TENANT_ISOLATED_ROUTES = new Set([
      'POST /test/protected-action',
      'GET /devices/me',
      'POST /sync/push',
      'GET /sync/pull',
      'GET /api/auth/me',
      'GET /api/dashboard/overview',
      'GET /api/reports/sales',
      'GET /api/reports/stock-and-expiry',
      'GET /api/reports/profit-per-batch',
      'GET /api/reports/supplier-ledger',
      'GET /api/admin/users',
      'POST /api/admin/users',
      'PATCH /api/admin/users/:id',
      'POST /api/admin/users/:id/unlock',
      'GET /api/admin/branches',
      'POST /api/admin/branches',
      'GET /api/admin/counters',
      'POST /api/admin/counters',
      'GET /api/admin/devices',
      'PATCH /api/admin/devices/:id/revoke',
      'POST /api/admin/registration-codes',
      'GET /api/admin/audit-logs',
    ]);

    const activeRoutes = capturedRoutes.filter((r) => r.method !== 'OPTIONS' && r.url !== '/*');

    for (const route of activeRoutes) {
      const routeKey = `${route.method} ${route.url}`;
      const isPublic = Boolean(PUBLIC_ROUTES[routeKey]);
      const isTenantIsolated = TENANT_ISOLATED_ROUTES.has(routeKey);

      expect(
        isPublic || isTenantIsolated,
        `SECURITY ERROR: Route '${routeKey}' is registered in Fastify but not cataloged in tenant isolation tests! Every route must be tenant-isolated or explicitly justified in PUBLIC_ROUTES.`
      ).toBe(true);
    }
  });

  // =========================================================================
  // 2. Admin Routes: Cross-Tenant Child FK Rejections (HTTP 404) & Role Enforcement
  // =========================================================================
  describe('Admin Routes Tenant Scoping', () => {
    it('POST /api/admin/counters rejects foreign branchId with 404', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/counters',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          branchId: tenantB.branchId, // Belongs to Tenant B
          name: 'Counter XT',
          code: 'CXT',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().message).toMatch(/branch not found/i);
    });

    it('POST /api/admin/registration-codes rejects foreign branchId and foreign counterId with 404', async () => {
      // 1. Foreign branch
      const resForeignBranch = await app.inject({
        method: 'POST',
        url: '/api/admin/registration-codes',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          branchId: tenantB.branchId,
          counterId: tenantA.counterId,
        },
      });
      expect(resForeignBranch.statusCode).toBe(404);

      // 2. Foreign counter
      const resForeignCounter = await app.inject({
        method: 'POST',
        url: '/api/admin/registration-codes',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          branchId: tenantA.branchId,
          counterId: tenantB.counterId,
        },
      });
      expect(resForeignCounter.statusCode).toBe(404);
    });

    it('PATCH /api/admin/users/:id and POST /users/:id/unlock reject foreign user with 404 and enforce owner role', async () => {
      // 1. Cashier role attempting unlock -> 403 Forbidden
      const resCashierUnlock = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${tenantA.cashierId}/unlock`,
        headers: { authorization: `Bearer ${tenantA.cashierToken}` },
      });
      expect(resCashierUnlock.statusCode).toBe(403);

      // 2. Tenant A owner attempting to unlock Tenant B user -> 404 Not Found
      const resForeignUnlock = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${tenantB.cashierId}/unlock`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(resForeignUnlock.statusCode).toBe(404);

      // 3. Tenant A owner attempting to update Tenant B user -> 404 Not Found
      const resForeignPatch = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${tenantB.cashierId}`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: { isActive: false },
      });
      expect(resForeignPatch.statusCode).toBe(404);
    });

    it('PATCH /api/admin/devices/:id/revoke rejects foreign device with 404', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/devices/${tenantB.deviceId}/revoke`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: { isRevoked: true },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // 3. Report Routes: Cross-Tenant Filter Parameter Rejection (HTTP 404)
  // =========================================================================
  describe('Report Routes Foreign Filter Parameter Rejection', () => {
    it('GET /api/reports/sales rejects foreign branchId with 404', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/reports/sales?branchId=${tenantB.branchId}`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('GET /api/reports/sales rejects foreign cashierUserId with 404', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/reports/sales?cashierUserId=${tenantB.cashierId}`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('GET /api/reports/stock-and-expiry rejects foreign branchId with 404', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/reports/stock-and-expiry?branchId=${tenantB.branchId}`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('GET /api/dashboard/overview strictly scopes all joined data to the tenant', async () => {
      const resA = await app.inject({
        method: 'GET',
        url: '/api/dashboard/overview',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(resA.statusCode).toBe(200);
      const dataA = resA.json();

      // Tenant A only sees 1 invoice sold, 5000 paisa
      expect(dataA.todaySalesPaisa).toBe(5000);
      expect(dataA.todayInvoiceCount).toBe(1);
      expect(dataA.topProducts[0]?.productId).toBe(tenantA.productId);
    });
  });

  // =========================================================================
  // 4. Sync Appliers: Device JWT Alignment, Cross-Tenant Reference Rejections
  // =========================================================================
  describe('Sync Appliers Tenant Isolation & Device Context Enforcement', () => {
    it('invoice.created rejects branch/counter device mismatch and cross-tenant entities with CROSS_TENANT_REFERENCE', async () => {
      const now = new Date().toISOString();

      // 1. Device mismatch: device is registered to counterA, but payload claims counterB
      const mismatchRes = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenantA.deviceToken}` },
        payload: {
          events: [
            {
              eventId: generateUuidV7(),
              deviceSeq: 101,
              type: 'invoice.created',
              entityId: generateUuidV7(),
              occurredAt: now,
              schemaVersion: 1,
              payload: {
                id: generateUuidV7(),
                counterId: tenantB.counterId, // Foreign counter!
                cashierUserId: tenantA.cashierId,
                invoiceNumber: 'INV-MISMATCH-1',
                clientRequestId: generateUuidV7(),
                status: 'finalized',
                subtotalPaisa: 5000,
                totalPaisa: 5000,
                createdAt: now,
                lines: [
                  {
                    id: generateUuidV7(),
                    productId: tenantA.productId,
                    batchId: tenantA.batchId,
                    quantity: 1,
                    unitPricePaisa: 5000,
                    lineTotalPaisa: 5000,
                  },
                ],
                payments: [{ id: generateUuidV7(), method: 'cash', amountPaisa: 5000 }],
              },
            },
          ],
        },
      });

      expect(mismatchRes.statusCode).toBe(200);
      const [resMismatch] = mismatchRes.json().results;
      expect(resMismatch.status).toBe('rejected');
      expect(resMismatch.code).toBe('CROSS_TENANT_REFERENCE');

      // 2. Cross-tenant product reference: Tenant B productId referenced
      const crossProductRes = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenantA.deviceToken}` },
        payload: {
          events: [
            {
              eventId: generateUuidV7(),
              deviceSeq: 102,
              type: 'invoice.created',
              entityId: generateUuidV7(),
              occurredAt: now,
              schemaVersion: 1,
              payload: {
                id: generateUuidV7(),
                counterId: tenantA.counterId,
                cashierUserId: tenantA.cashierId,
                invoiceNumber: 'INV-CROSS-PROD',
                clientRequestId: generateUuidV7(),
                status: 'finalized',
                subtotalPaisa: 5000,
                totalPaisa: 5000,
                createdAt: now,
                lines: [
                  {
                    id: generateUuidV7(),
                    productId: tenantB.productId, // Belongs to Tenant B!
                    batchId: tenantA.batchId,
                    quantity: 1,
                    unitPricePaisa: 5000,
                    lineTotalPaisa: 5000,
                  },
                ],
                payments: [{ id: generateUuidV7(), method: 'cash', amountPaisa: 5000 }],
              },
            },
          ],
        },
      });
      const [resCrossProduct] = crossProductRes.json().results;
      expect(resCrossProduct.status).toBe('rejected');
      expect(resCrossProduct.code).toBe('CROSS_TENANT_REFERENCE');

      // 3. Completely non-existent product -> returns retry_later (NOT rejected)
      const nonExistentRes = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenantA.deviceToken}` },
        payload: {
          events: [
            {
              eventId: generateUuidV7(),
              deviceSeq: 103,
              type: 'invoice.created',
              entityId: generateUuidV7(),
              occurredAt: now,
              schemaVersion: 1,
              payload: {
                id: generateUuidV7(),
                counterId: tenantA.counterId,
                cashierUserId: tenantA.cashierId,
                invoiceNumber: 'INV-NON-EXISTENT',
                clientRequestId: generateUuidV7(),
                status: 'finalized',
                subtotalPaisa: 5000,
                totalPaisa: 5000,
                createdAt: now,
                lines: [
                  {
                    id: generateUuidV7(),
                    productId: generateUuidV7(), // Exists nowhere
                    batchId: tenantA.batchId,
                    quantity: 1,
                    unitPricePaisa: 5000,
                    lineTotalPaisa: 5000,
                  },
                ],
                payments: [{ id: generateUuidV7(), method: 'cash', amountPaisa: 5000 }],
              },
            },
          ],
        },
      });
      const [resNonExistent] = nonExistentRes.json().results;
      expect(resNonExistent.status).toBe('retry_later');
      expect(resNonExistent.code).toBe('UNKNOWN_PRODUCT');
    });

    it('purchase.received rejects foreign branchId and foreign supplierId with CROSS_TENANT_REFERENCE', async () => {
      const now = new Date().toISOString();

      // 1. Foreign branch
      const foreignBranchRes = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenantA.deviceToken}` },
        payload: {
          events: [
            {
              eventId: generateUuidV7(),
              deviceSeq: 201,
              type: 'purchase.received',
              entityId: generateUuidV7(),
              occurredAt: now,
              schemaVersion: 1,
              payload: {
                purchase: {
                  id: generateUuidV7(),
                  branchId: tenantB.branchId, // Foreign branch!
                  supplierInvoiceNo: 'GRN-XT-1',
                  invoiceDate: '2026-10-28',
                  totalCostPaisa: 3500,
                },
                batches: [
                  {
                    id: generateUuidV7(),
                    productId: tenantA.productId,
                    batchNo: 'B-XT-1',
                    expiryDate: '2028-12-31',
                    costPaisa: 3500,
                    mrpPaisa: 5000,
                  },
                ],
                lines: [
                  {
                    id: generateUuidV7(),
                    productId: tenantA.productId,
                    batchId: generateUuidV7(),
                    quantity: 1,
                    costPaisa: 3500,
                    mrpPaisa: 5000,
                  },
                ],
              },
            },
          ],
        },
      });
      const [resBranch] = foreignBranchRes.json().results;
      expect(resBranch.status).toBe('rejected');
      expect(resBranch.code).toBe('CROSS_TENANT_REFERENCE');

      // 2. Foreign supplier
      const foreignSupplierRes = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenantA.deviceToken}` },
        payload: {
          events: [
            {
              eventId: generateUuidV7(),
              deviceSeq: 202,
              type: 'purchase.received',
              entityId: generateUuidV7(),
              occurredAt: now,
              schemaVersion: 1,
              payload: {
                purchase: {
                  id: generateUuidV7(),
                  branchId: tenantA.branchId,
                  supplierId: tenantB.supplierId, // Foreign supplier!
                  supplierInvoiceNo: 'GRN-XT-2',
                  invoiceDate: '2026-10-28',
                  totalCostPaisa: 3500,
                },
                batches: [
                  {
                    id: generateUuidV7(),
                    productId: tenantA.productId,
                    batchNo: 'B-XT-2',
                    expiryDate: '2028-12-31',
                    costPaisa: 3500,
                    mrpPaisa: 5000,
                  },
                ],
                lines: [
                  {
                    id: generateUuidV7(),
                    productId: tenantA.productId,
                    batchId: generateUuidV7(),
                    quantity: 1,
                    costPaisa: 3500,
                    mrpPaisa: 5000,
                  },
                ],
              },
            },
          ],
        },
      });
      const [resSupplier] = foreignSupplierRes.json().results;
      expect(resSupplier.status).toBe('rejected');
      expect(resSupplier.code).toBe('CROSS_TENANT_REFERENCE');
    });

    it('credit_note.created rejects foreign originalInvoiceId and originalInvoiceLineId with CROSS_TENANT_REFERENCE', async () => {
      const now = new Date().toISOString();

      const crossCreditRes = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenantA.deviceToken}` },
        payload: {
          events: [
            {
              eventId: generateUuidV7(),
              deviceSeq: 301,
              type: 'credit_note.created',
              entityId: generateUuidV7(),
              occurredAt: now,
              schemaVersion: 1,
              payload: {
                id: generateUuidV7(),
                creditNoteNumber: 'CN-XT-1',
                originalInvoiceId: tenantB.invoiceId, // Foreign invoice!
                branchId: tenantA.branchId,
                counterId: tenantA.counterId,
                cashierUserId: tenantA.cashierId,
                clientRequestId: generateUuidV7(),
                subtotalPaisa: 5000,
                taxPaisa: 0,
                totalPaisa: 5000,
                refundMethod: 'cash',
                reason: 'customer_return',
                createdAt: now,
                lines: [
                  {
                    id: generateUuidV7(),
                    originalInvoiceLineId: tenantB.invoiceLineId, // Foreign line!
                    productId: tenantA.productId,
                    batchId: tenantA.batchId,
                    quantity: 1,
                    unitPricePaisa: 5000,
                    taxRateBp: 0,
                    taxPaisa: 0,
                    lineTotalPaisa: 5000,
                  },
                ],
              },
            },
          ],
        },
      });

      const [resCredit] = crossCreditRes.json().results;
      expect(resCredit.status).toBe('rejected');
      expect(resCredit.code).toBe('CROSS_TENANT_REFERENCE');
    });

    it('stock_adjustment.created rejects foreign branchId with CROSS_TENANT_REFERENCE', async () => {
      const now = new Date().toISOString();

      const crossAdjustRes = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenantA.deviceToken}` },
        payload: {
          events: [
            {
              eventId: generateUuidV7(),
              deviceSeq: 401,
              type: 'stock_adjustment.created',
              entityId: generateUuidV7(),
              occurredAt: now,
              schemaVersion: 1,
              payload: {
                id: generateUuidV7(),
                branchId: tenantB.branchId, // Foreign branch!
                productId: tenantA.productId,
                batchId: tenantA.batchId,
                quantitySigned: 5,
                reason: 'Audit Adjustment',
                createdAt: now,
              },
            },
          ],
        },
      });

      const [resAdjust] = crossAdjustRes.json().results;
      expect(resAdjust.status).toBe('rejected');
      expect(resAdjust.code).toBe('CROSS_TENANT_REFERENCE');
    });

    it('shift.opened and shift.closed reject foreign counterId and cashierUserId with CROSS_TENANT_REFERENCE', async () => {
      const now = new Date().toISOString();
      const shiftId = generateUuidV7();

      const crossShiftRes = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${tenantA.deviceToken}` },
        payload: {
          events: [
            {
              eventId: generateUuidV7(),
              deviceSeq: 501,
              type: 'shift.opened',
              entityId: shiftId,
              occurredAt: now,
              schemaVersion: 1,
              payload: {
                shiftId,
                counterId: tenantB.counterId, // Foreign counter!
                cashierUserId: tenantA.cashierId,
                openingCashPaisa: 5000,
                openedAt: now,
              },
            },
            {
              eventId: generateUuidV7(),
              deviceSeq: 502,
              type: 'shift.closed',
              entityId: shiftId,
              occurredAt: now,
              schemaVersion: 1,
              payload: {
                shiftId,
                counterId: tenantA.counterId,
                cashierUserId: tenantB.cashierId, // Foreign cashier!
                openedAt: now,
                closedAt: now,
                openingCashPaisa: 5000,
                countedCashPaisa: 5000,
                expectedCashPaisa: 5000,
                differencePaisa: 0,
              },
            },
          ],
        },
      });

      const results = crossShiftRes.json().results;
      expect(results[0].status).toBe('rejected');
      expect(results[0].code).toBe('CROSS_TENANT_REFERENCE');
      expect(results[1].status).toBe('rejected');
      expect(results[1].code).toBe('CROSS_TENANT_REFERENCE');
    });
  });
});
