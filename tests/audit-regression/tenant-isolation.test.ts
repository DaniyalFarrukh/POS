import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7, getKarachiBusinessDate } from '../../packages/shared/src/index';
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
  invoices,
  invoiceLines,
  payments,
  stockMovements,
  fiscalPeriods,
} from '../../apps/server/src/db/schema';
import { signDeviceToken, signUserToken } from '../../apps/server/src/auth/jwt';
import { hashPin } from '../../apps/desktop/src/main/auth';
import { seedDefaultChartOfAccounts } from '../../apps/server/src/ledger/coa-seed';

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
    const ownerToken = signUserToken({
      userId: ownerId,
      pharmacyId,
      role: 'owner',
      name: 'Dr. Tariq',
    });
    const cashierToken = signUserToken({
      userId: cashierId,
      pharmacyId,
      role: 'cashier',
      name: 'Ali Khan',
    });

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
      'POST /devices/register':
        'Initial device registration using a one-time hashed registration code',
      'POST /api/auth/login': 'Web login requiring pharmacyCode to authenticate tenant user',
    };

    // Authenticated routes required to be tenant-isolated
    const TENANT_ISOLATED_ROUTES = new Set([
      'GET /devices/me',
      'POST /sync/push',
      'GET /sync/pull',
      'GET /api/auth/me',
      'POST /api/auth/logout',
      'POST /api/auth/refresh',
      'POST /api/auth/change-pin',
      'GET /api/dashboard/overview',
      'GET /api/reports/sales',
      'GET /api/reports/stock-and-expiry',
      'GET /api/reports/profit-per-batch',
      'GET /api/reports/supplier-ledger',
      'GET /api/reports/batch-recall',
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
      'GET /api/finance/journals',
      'POST /api/finance/journals',
      'POST /api/finance/journals/:id/post',
      'POST /api/finance/journals/:id/reverse',
      'GET /api/finance/coa',
      'GET /api/finance/reports/trial-balance',
      'GET /api/finance/reports/profit-loss',
      'GET /api/finance/reports/balance-sheet',
      'GET /api/finance/reports/cash-flow',
      'GET /api/finance/reports/general-ledger',
      'GET /api/finance/reports/general-ledger/:accountId',
      'GET /api/finance/accounts/:id/ledger',
      'GET /api/finance/periods',
      'GET /api/finance/periods/checklist',
      'POST /api/finance/periods/close',
      'POST /api/finance/periods/:id/reopen',
      'POST /api/finance/periods/year-end-closing',
      'GET /api/finance/reconciliation',
      'GET /api/finance/account-mappings',
      'PUT /api/finance/account-mappings',
      'POST /api/finance/coa',
      'PATCH /api/finance/coa/:id',
      'GET /api/suppliers',
      'POST /api/suppliers',
      'GET /api/suppliers/:id',
      'PATCH /api/suppliers/:id',
      'GET /api/suppliers/duplicates',
      'POST /api/suppliers/merge',
      'GET /api/purchase-orders',
      'GET /api/purchase-orders/low-stock-suggestions',
      'POST /api/purchase-orders',
      'GET /api/purchase-orders/:id',
      'POST /api/purchase-orders/:id/approve',
      'POST /api/purchase-orders/:id/send',
      'POST /api/purchase-orders/:id/cancel',
      'POST /api/purchase-orders/:id/receive',
      'GET /api/stock-locations',
      'POST /api/stock-locations',
      'PATCH /api/stock-locations/:id',
      'GET /api/stock-transfers',
      'POST /api/stock-transfers',
      'GET /api/stock-transfers/:id',
      'POST /api/stock-transfers/:id/dispatch',
      'POST /api/stock-transfers/:id/receive',
      'POST /api/stock-transfers/:id/cancel',
      'GET /api/stock-counts',
      'POST /api/stock-counts',
      'GET /api/stock-counts/:id',
      'PUT /api/stock-counts/:id/lines',
      'POST /api/stock-counts/:id/submit',
      'POST /api/stock-counts/:id/approve',
      'POST /api/stock-counts/:id/cancel',
      'GET /api/supplier-returns',
      'POST /api/supplier-returns',
      'GET /api/supplier-returns/:id',
      'GET /api/inventory/stock',
      'GET /api/inventory/batches/expiring',
      'POST /api/inventory/batches/:id/discount',
      'POST /api/inventory/batches/:id/write-off',
      'GET /api/inventory/products/:id/stock-detail',
      'GET /api/finance/payments',
      'POST /api/finance/payments',
      'GET /api/finance/payments/unpaid-documents',
      'GET /api/finance/payments/:id',
      'POST /api/finance/payments/:id/clear-cheque',
      'POST /api/finance/payments/:id/bounce-cheque',
      'POST /api/finance/payments/:id/reverse',
      'GET /api/finance/customers',
      'POST /api/finance/customers',
      'GET /api/finance/expense-categories',
      'POST /api/finance/expense-categories',
      'GET /api/finance/expenses',
      'POST /api/finance/expenses',
      'GET /api/finance/expenses/:id',
      'POST /api/finance/expenses/:id/approve',
      'POST /api/finance/expenses/:id/reverse',
      'GET /api/finance/expenses/recurring',
      'POST /api/finance/expenses/recurring',
      'GET /api/finance/expenses/recurring/preview',
      'POST /api/finance/expenses/recurring/generate',
      'GET /api/finance/ar/summary',
      'GET /api/finance/ar/customers',
      'GET /api/finance/ar/products',
      'GET /api/finance/ar/statement/:customerId',
      'GET /api/finance/ar/reminders',
      'POST /api/finance/ar/reminders',
      'GET /api/finance/ap/summary',
      'GET /api/finance/ap/suppliers',
      'GET /api/finance/ap/bills',
      'GET /api/finance/ap/statement/:supplierId',
      'GET /api/finance/ap/reminders',
      'POST /api/finance/ap/reminders',
      'GET /api/finance/cash-bank/accounts',
      'POST /api/finance/cash-bank/accounts',
      'GET /api/finance/cash-bank/transfers',
      'POST /api/finance/cash-bank/transfers',
      'POST /api/finance/cash-bank/transfers/:id/reverse',
      'GET /api/finance/cash-bank/deposits',
      'POST /api/finance/cash-bank/deposits',
      'POST /api/finance/cash-bank/deposits/:id/reverse',
      'GET /api/finance/cash-bank/reconciliation/:bankAccountId/ledger-lines',
      'POST /api/finance/cash-bank/reconciliation/save',
      'GET /api/finance/sales-ledger',
      'GET /api/finance/budgets',
      'POST /api/finance/budgets/batch',
      'GET /api/finance/budgets/actual-vs-budget',
      'POST /api/finance/budgets/copy-previous-year',
      'GET /api/customers',
      'POST /api/customers',
      'GET /api/customers/:id',
      'PUT /api/customers/:id',
      'GET /api/customers/:id/invoices',
      'GET /api/customers/:id/ledger',
      'GET /api/customers/:id/statement',
      'GET /api/prescriptions/refill-reminders',
      'GET /api/prescriptions',
      'POST /api/prescriptions',
      'GET /api/prescriptions/:id',
      'PUT /api/prescriptions/:id',
      'POST /api/prescriptions/:id/dispense',
      'GET /api/prescriptions/:id/audit-trail',
      'GET /api/admin/diagnostics/export',
      'GET /api/hr/employees',
      'POST /api/hr/employees',
      'GET /api/hr/leave/types',
      'POST /api/hr/leave/types',
      'GET /api/hr/leave/balances',
      'POST /api/hr/leave/carry-over',
      'GET /api/hr/leave/requests',
      'POST /api/hr/leave/requests',
      'POST /api/hr/leave/requests/:id/approve',
      'POST /api/hr/leave/requests/:id/reject',
      'GET /api/hr/leave/calendar',
      'GET /api/hr/attendance',
      'GET /api/hr/payroll/preview',
      'GET /api/hr/payroll/statutory-rates',
      'POST /api/hr/payroll/statutory-rates',
      'PUT /api/hr/payroll/statutory-rates/:id',
      'GET /api/hr/payroll/tax-slabs',
      'POST /api/hr/payroll/tax-slabs',
      'GET /api/hr/payroll/advances',
      'POST /api/hr/payroll/advances',
      'GET /api/hr/payroll/runs',
      'GET /api/hr/payroll/runs/:id',
      'GET /api/hr/payroll/runs/:id/items',
      'POST /api/hr/payroll/runs/generate',
      'PUT /api/hr/payroll/items/:id',
      'POST /api/hr/payroll/runs/:id/review',
      'POST /api/hr/payroll/runs/:id/approve',
      'POST /api/hr/payroll/runs/:id/post',
      'POST /api/hr/payroll/runs/:id/pay',
      'POST /api/hr/payroll/runs/:id/adjustment',
      'GET /api/hr/payroll/items/:id/payslip',
      'GET /api/notifications',
      'PATCH /api/notifications/:id/read',
      'POST /api/notifications/mark-all-read',
      'POST /api/notifications/refresh',
      'GET /api/search',
    ]);

    const activeRoutes = capturedRoutes.filter((r) => r.method !== 'OPTIONS' && r.url !== '/*');
    const activeRouteKeys = new Set(activeRoutes.map((r) => `${r.method} ${r.url}`));

    for (const route of activeRoutes) {
      const routeKey = `${route.method} ${route.url}`;
      const isPublic = Boolean(PUBLIC_ROUTES[routeKey]);
      const isTenantIsolated = TENANT_ISOLATED_ROUTES.has(routeKey);

      expect(
        isPublic || isTenantIsolated,
        `SECURITY ERROR: Route '${routeKey}' is registered in Fastify but not cataloged in tenant isolation tests! Every route must be tenant-isolated or explicitly justified in PUBLIC_ROUTES.`
      ).toBe(true);
    }

    // Two-way verification: ensure TENANT_ISOLATED_ROUTES contains no phantom/stale routes
    for (const declaredRoute of TENANT_ISOLATED_ROUTES) {
      expect(
        activeRouteKeys.has(declaredRoute),
        `STALE ROUTE ERROR: '${declaredRoute}' is listed in TENANT_ISOLATED_ROUTES but does not exist in Fastify!`
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
    it('GET /api/reports/sales without params strictly aggregates ONLY Tenant A invoices (Kills M-01)', async () => {
      const resA = await app.inject({
        method: 'GET',
        url: '/api/reports/sales',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(resA.statusCode).toBe(200);
      const jsonA = resA.json();
      expect(jsonA.totals.invoiceCount).toBe(1);
      expect(jsonA.totals.totalPaisa).toBe(5000);
    });

    it('GET /api/reports/batch-recall strictly scopes by tenant', async () => {
      const resA = await app.inject({
        method: 'GET',
        url: '/api/reports/batch-recall?batchNo=BATCH-AUG-01',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(resA.statusCode).toBe(200);
      const jsonA = resA.json();
      expect(
        jsonA.matchingBatches.every((b: { batchId: string }) => b.batchId !== tenantB.batchId)
      ).toBe(true);
    });

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

    it('GET /api/finance/journals and /api/finance/coa strictly scope queries to the authenticated tenant', async () => {
      const resA = await app.inject({
        method: 'GET',
        url: '/api/finance/journals',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(resA.statusCode).toBe(200);
      expect(resA.json().pharmacyId).toBe(tenantA.pharmacyId);

      const resB = await app.inject({
        method: 'GET',
        url: '/api/finance/journals',
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(resB.statusCode).toBe(200);
      expect(resB.json().pharmacyId).toBe(tenantB.pharmacyId);
      expect(resB.json().pharmacyId).not.toBe(tenantA.pharmacyId);
    });

    it('Finance ledger routes enforce tenant isolation on accounts, branches, journals, and periods', async () => {
      const coaA = await seedDefaultChartOfAccounts(ctx.db, tenantA.pharmacyId);
      const coaB = await seedDefaultChartOfAccounts(ctx.db, tenantB.pharmacyId);
      const cashA = coaA.find((a) => a.code === '1000')!;
      const salesA = coaA.find((a) => a.code === '4000')!;
      const cashB = coaB.find((a) => a.code === '1000')!;

      // 1. GET /api/finance/reports/trial-balance rejects foreign branchId with 404
      const resTbBranch = await app.inject({
        method: 'GET',
        url: `/api/finance/reports/trial-balance?branchId=${tenantB.branchId}`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(resTbBranch.statusCode).toBe(404);

      // 2. GET /api/finance/accounts/:id/ledger rejects foreign accountId with 404
      const resForeignLedger = await app.inject({
        method: 'GET',
        url: `/api/finance/accounts/${cashB.id}/ledger`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(resForeignLedger.statusCode).toBe(404);

      // 3. POST /api/finance/journals rejects foreign accountId with 404
      const resForeignJournalAcc = await app.inject({
        method: 'POST',
        url: '/api/finance/journals',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          entryDate: '2026-11-03',
          memo: 'Cross-tenant account test',
          lines: [
            { accountId: cashA.id, debitPaisa: 1000, creditPaisa: 0 },
            { accountId: cashB.id, debitPaisa: 0, creditPaisa: 1000 },
          ],
        },
      });
      expect(resForeignJournalAcc.statusCode).toBe(404);

      // 4. Create valid journal entry in Tenant A, then verify Tenant B cannot reverse it (404)
      const resValidJournal = await app.inject({
        method: 'POST',
        url: '/api/finance/journals',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          entryDate: '2026-11-03',
          memo: 'Tenant A valid entry',
          lines: [
            { accountId: cashA.id, debitPaisa: 5000, creditPaisa: 0 },
            { accountId: salesA.id, debitPaisa: 0, creditPaisa: 5000 },
          ],
        },
      });
      expect(resValidJournal.statusCode).toBe(201);
      const entryAId = resValidJournal.json().entry.id;

      const resForeignReverse = await app.inject({
        method: 'POST',
        url: `/api/finance/journals/${entryAId}/reverse`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
        payload: { reason: 'Cross-tenant reversal attempt' },
      });
      expect(resForeignReverse.statusCode).toBe(404);

      // 5. Close period in Tenant A, then verify Tenant B cannot reopen it (404)
      const resCloseA = await app.inject({
        method: 'POST',
        url: '/api/finance/periods/close',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          reason: 'August close',
        },
      });
      expect(resCloseA.statusCode).toBe(200);
      const periodAId = resCloseA.json().period.id;

      const resForeignReopen = await app.inject({
        method: 'POST',
        url: `/api/finance/periods/${periodAId}/reopen`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
        payload: { reason: 'Cross-tenant reopen attempt' },
      });
      expect(resForeignReopen.statusCode).toBe(404);

      // 5b. Period checklist and year-end closing are strictly tenant scoped
      const resChecklistA = await app.inject({
        method: 'GET',
        url: '/api/finance/periods/checklist?year=2026&month=8',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(resChecklistA.statusCode).toBe(200);
      expect(resChecklistA.json().pharmacyId).toBe(tenantA.pharmacyId);

      // 6. GET /api/finance/reconciliation and GET /api/finance/account-mappings scope to caller's pharmacyId
      const resReconA = await app.inject({
        method: 'GET',
        url: '/api/finance/reconciliation',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(resReconA.statusCode).toBe(200);
      expect(resReconA.json().pharmacyId).toBe(tenantA.pharmacyId);

      const resMapA = await app.inject({
        method: 'GET',
        url: '/api/finance/account-mappings',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(resMapA.statusCode).toBe(200);
      expect(resMapA.json().pharmacyId).toBe(tenantA.pharmacyId);

      // 7. PUT /api/finance/account-mappings rejects foreign accountId with 404
      const resForeignMapUpdate = await app.inject({
        method: 'PUT',
        url: '/api/finance/account-mappings',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          role: 'sales',
          accountId: cashB.id, // Belongs to Tenant B!
        },
      });
      expect(resForeignMapUpdate.statusCode).toBe(404);

      // 8. POST /api/finance/coa adds custom account, rejects foreign parentId with 404
      const resForeignParentCoa = await app.inject({
        method: 'POST',
        url: '/api/finance/coa',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          code: '1005',
          name: 'Custom Drawer',
          type: 'asset',
          parentId: cashB.id, // Belongs to Tenant B!
        },
      });
      expect(resForeignParentCoa.statusCode).toBe(404);

      const resCreateCustomCoa = await app.inject({
        method: 'POST',
        url: '/api/finance/coa',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          code: '1005',
          name: 'Custom Drawer A',
          type: 'asset',
          parentId: cashA.id,
        },
      });
      expect(resCreateCustomCoa.statusCode).toBe(201);
      const customAccountAId = resCreateCustomCoa.json().account.id;

      // 9. PATCH /api/finance/coa/:id protects system account from deactivation
      const resDeactivateSys = await app.inject({
        method: 'PATCH',
        url: `/api/finance/coa/${cashA.id}`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: { isActive: false },
      });
      expect(resDeactivateSys.statusCode).toBe(400);
      expect(resDeactivateSys.json().message).toMatch(/system accounts are protected/i);

      // 10. PATCH /api/finance/coa/:id rejects foreign account with 404
      const resForeignCoaPatch = await app.inject({
        method: 'PATCH',
        url: `/api/finance/coa/${customAccountAId}`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
        payload: { isActive: false },
      });
      expect(resForeignCoaPatch.statusCode).toBe(404);

      // 11. PATCH /api/finance/coa/:id deactivates custom account
      const resDeactivateCustom = await app.inject({
        method: 'PATCH',
        url: `/api/finance/coa/${customAccountAId}`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: { isActive: false },
      });
      expect(resDeactivateCustom.statusCode).toBe(200);
      expect(resDeactivateCustom.json().account.isActive).toBe(false);
    });

    it('Finance payments and customer routes strictly enforce tenant isolation', async () => {
      const nowIso = new Date().toISOString();
      const year = new Date().getFullYear();

      // Seed fiscal periods for Tenant A and Tenant B
      await ctx.db.insert(fiscalPeriods).values([
        {
          id: generateUuidV7(),
          pharmacyId: tenantA.pharmacyId,
          startDate: `${year}-01-01`,
          endDate: `${year}-12-31`,
          status: 'open',
        },
        {
          id: generateUuidV7(),
          pharmacyId: tenantB.pharmacyId,
          startDate: `${year}-01-01`,
          endDate: `${year}-12-31`,
          status: 'open',
        },
      ]);

      // 1. Create Customer in Tenant A
      const custResA = await app.inject({
        method: 'POST',
        url: '/api/finance/customers',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          name: 'Clinic Account A',
          phone: '03001112233',
          creditLimitPaisa: 100000,
        },
      });
      expect(custResA.statusCode).toBe(201);
      const custA = custResA.json().data;

      // 2. Tenant B attempts to create payment referencing Tenant A customer -> 404
      const foreignCustPay = await app.inject({
        method: 'POST',
        url: '/api/finance/payments',
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
        payload: {
          direction: 'receipt',
          partyType: 'customer',
          partyId: custA.id, // Belongs to Tenant A!
          method: 'cash',
          amountPaisa: 5000,
          paymentDate: nowIso.slice(0, 10),
        },
      });
      expect(foreignCustPay.statusCode).toBe(404);

      // 3. Create valid payment in Tenant A
      const validPayResA = await app.inject({
        method: 'POST',
        url: '/api/finance/payments',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          direction: 'receipt',
          partyType: 'customer',
          partyId: custA.id,
          method: 'cheque',
          amountPaisa: 10000,
          paymentDate: nowIso.slice(0, 10),
          chequeNumber: 'CHQ-0099',
          chequeStatus: 'pending',
        },
      });
      expect(validPayResA.statusCode).toBe(201);
      const payA = validPayResA.json().data;

      // 4. Tenant B cannot view Tenant A payment (404)
      const foreignView = await app.inject({
        method: 'GET',
        url: `/api/finance/payments/${payA.id}`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(foreignView.statusCode).toBe(404);

      // 5. Tenant B cannot clear cheque of Tenant A payment (404)
      const foreignClear = await app.inject({
        method: 'POST',
        url: `/api/finance/payments/${payA.id}/clear-cheque`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(foreignClear.statusCode).toBe(404);

      // 6. Tenant B cannot bounce cheque of Tenant A payment (404)
      const foreignBounce = await app.inject({
        method: 'POST',
        url: `/api/finance/payments/${payA.id}/bounce-cheque`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
        payload: { bounceReason: 'Cross tenant bounce' },
      });
      expect(foreignBounce.statusCode).toBe(404);

      // 7. Tenant B cannot reverse Tenant A payment (404)
      const foreignRev = await app.inject({
        method: 'POST',
        url: `/api/finance/payments/${payA.id}/reverse`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
        payload: { reversalReason: 'Cross tenant reverse' },
      });
      expect(foreignRev.statusCode).toBe(404);

      // 8. Tenant B unpaid-documents for Tenant A customer returns no documents
      const foreignUnpaid = await app.inject({
        method: 'GET',
        url: `/api/finance/payments/unpaid-documents?partyType=customer&partyId=${custA.id}`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(foreignUnpaid.statusCode).toBe(200);
      expect(foreignUnpaid.json().data.documents).toHaveLength(0);

      // 9. List payments for Tenant B shows 0 payments
      const listB = await app.inject({
        method: 'GET',
        url: '/api/finance/payments',
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(listB.statusCode).toBe(200);
      expect(listB.json().data.items).toHaveLength(0);
      expect(listB.json().data.kpis.totalReceiptsPaisa).toBe(0);
    });

    it('Finance expenses routes strictly enforce tenant isolation', async () => {
      // 1. Get/seed categories for Tenant A
      const catResA = await app.inject({
        method: 'GET',
        url: '/api/finance/expense-categories',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(catResA.statusCode).toBe(200);
      const catA = catResA.json().data[0];
      expect(catA).toBeDefined();

      // 2. Tenant B attempts to create expense with Tenant A's category -> 404
      const foreignCatExp = await app.inject({
        method: 'POST',
        url: '/api/finance/expenses',
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
        payload: {
          branchId: tenantB.branchId,
          categoryId: catA.id, // Belongs to Tenant A!
          amountPaisa: 5000,
          paymentType: 'paid',
          paymentMethod: 'cash',
          expenseDate: getKarachiBusinessDate(),
        },
      });
      expect(foreignCatExp.statusCode).toBe(404);

      // 3. Create valid expense in Tenant A
      const validExpA = await app.inject({
        method: 'POST',
        url: '/api/finance/expenses',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          branchId: tenantA.branchId,
          categoryId: catA.id,
          amountPaisa: 5000,
          paymentType: 'paid',
          paymentMethod: 'cash',
          expenseDate: getKarachiBusinessDate(),
        },
      });
      expect(validExpA.statusCode).toBe(201);
      const expA = validExpA.json().data;

      // 4. Tenant B cannot view Tenant A expense (404)
      const foreignView = await app.inject({
        method: 'GET',
        url: `/api/finance/expenses/${expA.id}`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(foreignView.statusCode).toBe(404);

      // 5. Tenant B cannot approve Tenant A expense (404)
      const foreignApprove = await app.inject({
        method: 'POST',
        url: `/api/finance/expenses/${expA.id}/approve`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(foreignApprove.statusCode).toBe(404);

      // 6. Tenant B cannot reverse Tenant A expense (404)
      const foreignRev = await app.inject({
        method: 'POST',
        url: `/api/finance/expenses/${expA.id}/reverse`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
        payload: { reversalReason: 'Cross tenant attempt' },
      });
      expect(foreignRev.statusCode).toBe(404);

      // 7. Tenant B lists expenses -> sees 0 expenses
      const listB = await app.inject({
        method: 'GET',
        url: '/api/finance/expenses',
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(listB.statusCode).toBe(200);
      expect(listB.json().data.items).toHaveLength(0);
      expect(listB.json().data.kpis.totalExpensesPaisa).toBe(0);
    });

    it('Customers routes strictly enforce tenant isolation', async () => {
      // 1. Create customer in Tenant A
      const createResA = await app.inject({
        method: 'POST',
        url: '/api/customers',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          name: 'Isolation Test Customer A',
          phone: '03211112233',
          creditLimitPaisa: 50000,
        },
      });
      expect(createResA.statusCode).toBe(201);
      const custA = createResA.json().data;

      // 2. Tenant B cannot access Tenant A customer (404)
      const foreignGet = await app.inject({
        method: 'GET',
        url: `/api/customers/${custA.id}`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(foreignGet.statusCode).toBe(404);

      // 3. Tenant B cannot update Tenant A customer (404)
      const foreignPut = await app.inject({
        method: 'PUT',
        url: `/api/customers/${custA.id}`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
        payload: {
          name: 'Hacked Name',
        },
      });
      expect(foreignPut.statusCode).toBe(404);

      // 4. Tenant B cannot access ledger or invoices of Tenant A customer (404)
      const foreignLedger = await app.inject({
        method: 'GET',
        url: `/api/customers/${custA.id}/ledger`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(foreignLedger.statusCode).toBe(404);

      const foreignInvoices = await app.inject({
        method: 'GET',
        url: `/api/customers/${custA.id}/invoices`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(foreignInvoices.statusCode).toBe(404);

      const foreignStatement = await app.inject({
        method: 'GET',
        url: `/api/customers/${custA.id}/statement`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(foreignStatement.statusCode).toBe(404);

      // 5. Tenant B customer list does not leak Tenant A customer
      const listB = await app.inject({
        method: 'GET',
        url: '/api/customers',
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(listB.statusCode).toBe(200);
      const leaked = listB.json().data.some((c: { id: string }) => c.id === custA.id);
      expect(leaked).toBe(false);
    });

    it('Prescriptions routes strictly enforce tenant isolation', async () => {
      // 1. Create prescription in Tenant A
      const createResA = await app.inject({
        method: 'POST',
        url: '/api/prescriptions',
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: {
          patientName: 'Tenant A Patient',
          prescriptionDate: '2026-11-05',
          items: [
            {
              productId: tenantA.productId,
              dosageInstructions: '1 tablet daily',
              quantityPrescribed: 30,
            },
          ],
        },
      });
      expect(createResA.statusCode).toBe(201);
      const rxA = createResA.json().data;

      // 2. Tenant B cannot access Tenant A prescription (404)
      const foreignGet = await app.inject({
        method: 'GET',
        url: `/api/prescriptions/${rxA.id}`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(foreignGet.statusCode).toBe(404);

      // 3. Tenant B cannot update Tenant A prescription (404)
      const foreignPut = await app.inject({
        method: 'PUT',
        url: `/api/prescriptions/${rxA.id}`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
        payload: {
          patientName: 'Breached Name',
        },
      });
      expect(foreignPut.statusCode).toBe(404);

      // 4. Tenant B cannot view audit trail of Tenant A prescription (404)
      const foreignAudit = await app.inject({
        method: 'GET',
        url: `/api/prescriptions/${rxA.id}/audit-trail`,
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(foreignAudit.statusCode).toBe(404);

      // 5. Tenant B prescription list does not leak Tenant A prescription
      const listB = await app.inject({
        method: 'GET',
        url: '/api/prescriptions',
        headers: { authorization: `Bearer ${tenantB.ownerToken}` },
      });
      expect(listB.statusCode).toBe(200);
      const leaked = listB.json().data.some((r: { id: string }) => r.id === rxA.id);
      expect(leaked).toBe(false);
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

  // =========================================================================
  // 8. Behavioral Tenant Isolation for Remaining Route Families (S2-10)
  // =========================================================================
  describe('Behavioral Tenant Isolation Across ERP Route Families', () => {
    it('isolates suppliers, purchase-orders, stock-locations, stock-transfers, stock-counts, supplier-returns, and stock detail across tenants', async () => {
      // Tenant A querying Tenant B's supplier -> 404
      const suppRes = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${tenantB.supplierId}`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(suppRes.statusCode).toBe(404);

      // Tenant A querying Tenant B's product stock detail -> 404
      const stockDetailRes = await app.inject({
        method: 'GET',
        url: `/api/inventory/products/${tenantB.productId}/stock-detail`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(stockDetailRes.statusCode).toBe(404);

      // Tenant A discounting Tenant B's batch -> 404
      const discountRes = await app.inject({
        method: 'POST',
        url: `/api/inventory/batches/${tenantB.batchId}/discount`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        payload: { mrpPaisa: 4000, reason: 'Cross tenant discount attempt' },
      });
      expect(discountRes.statusCode).toBe(404);

      // Tenant A listing suppliers, POs, stock locations, transfers, counts, supplier returns never includes Tenant B
      const listEndpoints = [
        '/api/suppliers',
        '/api/purchase-orders',
        '/api/stock-locations',
        '/api/stock-transfers',
        '/api/stock-counts',
        '/api/supplier-returns',
      ];
      for (const url of listEndpoints) {
        const res = await app.inject({
          method: 'GET',
          url,
          headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.stringify(res.json())).not.toContain(tenantB.pharmacyId);
        expect(JSON.stringify(res.json())).not.toContain(tenantB.supplierId);
        expect(JSON.stringify(res.json())).not.toContain(tenantB.productId);
      }
    });

    it('isolates finance (AR, AP, cash-bank, budgets, sales-ledger), HR/payroll, notifications, and global search across tenants', async () => {
      // Tenant A requesting AR statement for Tenant B supplier/customer -> 404
      const apStmtRes = await app.inject({
        method: 'GET',
        url: `/api/finance/ap/statement/${tenantB.supplierId}`,
        headers: { authorization: `Bearer ${tenantA.ownerToken}` },
      });
      expect(apStmtRes.statusCode).toBe(404);

      // Finance, HR, Payroll, Notifications, and Search endpoints scoped to Tenant A
      const scopedGetEndpoints = [
        '/api/finance/ar/summary',
        '/api/finance/ap/summary',
        '/api/finance/cash-bank/accounts',
        '/api/finance/cash-bank/transfers',
        '/api/finance/cash-bank/deposits',
        '/api/finance/sales-ledger',
        '/api/finance/budgets?fiscalYear=2026',
        '/api/hr/employees',
        '/api/hr/leave/types',
        '/api/hr/leave/requests',
        '/api/hr/payroll/runs',
        '/api/hr/payroll/advances',
        '/api/notifications',
        '/api/search?q=Product',
      ];

      for (const url of scopedGetEndpoints) {
        const res = await app.inject({
          method: 'GET',
          url,
          headers: { authorization: `Bearer ${tenantA.ownerToken}` },
        });
        expect(res.statusCode).toBe(200);
        const raw = JSON.stringify(res.json());
        expect(raw).not.toContain(tenantB.pharmacyId);
        if (url !== '/api/notifications') {
          expect(raw).not.toContain(tenantB.productId);
          expect(raw).not.toContain(tenantB.supplierId);
          expect(raw).not.toContain(tenantB.invoiceId);
        }
      }
    });
  });
});
