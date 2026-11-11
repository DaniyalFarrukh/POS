import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { getDb } from '../db';
import {
  pharmacies,
  branches,
  counters,
  users,
  taxCategories,
  products,
  suppliers,
  customers,
  batches,
  invoices,
  invoiceLines,
  userNotifications,
  auditLogs,
} from '../db/schema';
import { signUserToken } from '../auth/jwt';
import { eq } from 'drizzle-orm';
import { generateUuidV7 } from '@pos/shared';

describe('Notifications, Audit Log & Global Search Integration Tests', () => {
  let app: FastifyInstance;
  const db = getDb();

  const pharmacyAId = generateUuidV7();
  const pharmacyBId = generateUuidV7();

  const branchAId = generateUuidV7();
  const branchBId = generateUuidV7();

  const counterAId = generateUuidV7();
  const counterBId = generateUuidV7();

  const ownerAId = generateUuidV7();
  const cashierAId = generateUuidV7();
  const ownerBId = generateUuidV7();

  let ownerTokenA: string;
  let cashierTokenA: string;
  let ownerTokenB: string;

  const productAId = generateUuidV7();
  const productBId = generateUuidV7();

  const supplierAId = generateUuidV7();
  const supplierBId = generateUuidV7();

  const customerAId = generateUuidV7();
  const customerBId = generateUuidV7();

  const invoiceAId = generateUuidV7();
  const invoiceBId = generateUuidV7();

  const now = new Date().toISOString();

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Seed Pharmacies
    await db.insert(pharmacies).values([
      {
        id: pharmacyAId,
        name: 'Search Pharmacy A',
        code: `SPA-${Date.now()}`,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: pharmacyBId,
        name: 'Search Pharmacy B',
        code: `SPB-${Date.now()}`,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 2. Seed Branches & Counters
    await db.insert(branches).values([
      { id: branchAId, pharmacyId: pharmacyAId, name: 'Main A', createdAt: now, updatedAt: now },
      { id: branchBId, pharmacyId: pharmacyBId, name: 'Main B', createdAt: now, updatedAt: now },
    ]);
    await db.insert(counters).values([
      {
        id: counterAId,
        pharmacyId: pharmacyAId,
        branchId: branchAId,
        name: 'Counter A',
        code: 'C-A',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: counterBId,
        pharmacyId: pharmacyBId,
        branchId: branchBId,
        name: 'Counter B',
        code: 'C-B',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 3. Seed Users
    await db.insert(users).values([
      {
        id: ownerAId,
        pharmacyId: pharmacyAId,
        name: 'Owner A',
        role: 'owner',
        pinHash: 'hash',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: cashierAId,
        pharmacyId: pharmacyAId,
        name: 'Cashier A',
        role: 'cashier',
        pinHash: 'hash',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ownerBId,
        pharmacyId: pharmacyBId,
        name: 'Owner B',
        role: 'owner',
        pinHash: 'hash',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    ownerTokenA = signUserToken({
      userId: ownerAId,
      pharmacyId: pharmacyAId,
      role: 'owner',
      name: 'Owner A',
    });
    cashierTokenA = signUserToken({
      userId: cashierAId,
      pharmacyId: pharmacyAId,
      role: 'cashier',
      name: 'Cashier A',
    });
    ownerTokenB = signUserToken({
      userId: ownerBId,
      pharmacyId: pharmacyBId,
      role: 'owner',
      name: 'Owner B',
    });

    // 4. Seed Products
    const taxCatA = generateUuidV7();
    const taxCatB = generateUuidV7();
    await db.insert(taxCategories).values([
      {
        id: taxCatA,
        pharmacyId: pharmacyAId,
        name: 'Standard A',
        rateBp: 0,
        isExempt: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: taxCatB,
        pharmacyId: pharmacyBId,
        name: 'Standard B',
        rateBp: 0,
        isExempt: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(products).values([
      {
        id: productAId,
        pharmacyId: pharmacyAId,
        taxCategoryId: taxCatA,
        brandName: 'Panadol Extra 500mg',
        genericName: 'Paracetamol',
        barcode: '89640001',
        mrpPaisa: 5000,
        reorderLevel: 20,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: productBId,
        pharmacyId: pharmacyBId,
        taxCategoryId: taxCatB,
        brandName: 'Panadol Extra 500mg',
        genericName: 'Paracetamol',
        barcode: '89640002',
        mrpPaisa: 5000,
        reorderLevel: 20,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 5. Seed Suppliers
    await db.insert(suppliers).values([
      {
        id: supplierAId,
        pharmacyId: pharmacyAId,
        name: 'GlaxoSmithKline Pakistan',
        contactPerson: 'GSK Rep A',
        phone: '03001234567',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: supplierBId,
        pharmacyId: pharmacyBId,
        name: 'GlaxoSmithKline Pakistan',
        contactPerson: 'GSK Rep B',
        phone: '03009876543',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 6. Seed Customers
    await db.insert(customers).values([
      {
        id: customerAId,
        pharmacyId: pharmacyAId,
        name: 'Ahmed Ali Khan',
        phone: '03211112233',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: customerBId,
        pharmacyId: pharmacyBId,
        name: 'Ahmed Ali Khan',
        phone: '03214445566',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 7. Seed Invoices
    const batchA = generateUuidV7();
    const batchB = generateUuidV7();
    await db.insert(batches).values([
      {
        id: batchA,
        pharmacyId: pharmacyAId,
        productId: productAId,
        batchNo: 'BAT-A01',
        expiryDate: '2027-12-31',
        costPaisa: 3500,
        mrpPaisa: 5000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: batchB,
        pharmacyId: pharmacyBId,
        productId: productBId,
        batchNo: 'BAT-B01',
        expiryDate: '2027-12-31',
        costPaisa: 3500,
        mrpPaisa: 5000,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(invoices).values([
      {
        id: invoiceAId,
        pharmacyId: pharmacyAId,
        counterId: counterAId,
        cashierUserId: cashierAId,
        invoiceNumber: 'INV-A-1001',
        clientRequestId: generateUuidV7(),
        status: 'finalized',
        subtotalPaisa: 5000,
        totalPaisa: 5000,
        createdAt: now,
      },
      {
        id: invoiceBId,
        pharmacyId: pharmacyBId,
        counterId: counterBId,
        cashierUserId: ownerBId,
        invoiceNumber: 'INV-B-2001',
        clientRequestId: generateUuidV7(),
        status: 'finalized',
        subtotalPaisa: 5000,
        totalPaisa: 5000,
        createdAt: now,
      },
    ]);

    await db.insert(invoiceLines).values([
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyAId,
        invoiceId: invoiceAId,
        productId: productAId,
        batchId: batchA,
        quantity: 1,
        unitPricePaisa: 5000,
        lineTotalPaisa: 5000,
      },
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyBId,
        invoiceId: invoiceBId,
        productId: productBId,
        batchId: batchB,
        quantity: 1,
        unitPricePaisa: 5000,
        lineTotalPaisa: 5000,
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Pillar 1: Notifications with per-user read state', () => {
    it('manages notifications per user and strictly isolates across tenants', async () => {
      const notifAId = generateUuidV7();
      const notifBId = generateUuidV7();

      // Seed notification for Owner A in Pharmacy A
      await db.insert(userNotifications).values([
        {
          id: notifAId,
          pharmacyId: pharmacyAId,
          userId: ownerAId,
          type: 'expiring_stock',
          title: 'Batch Expiring Soon',
          message: 'Batch BAT-A01 has 15 units expiring in 20 days.',
          severity: 'warning',
          isRead: false,
          createdAt: now,
        },
        {
          id: notifBId,
          pharmacyId: pharmacyBId,
          userId: ownerBId,
          type: 'low_stock',
          title: 'Product Low Stock',
          message: 'Panadol Extra in Pharmacy B is below reorder level.',
          severity: 'critical',
          isRead: false,
          createdAt: now,
        },
      ]);

      // 1. Owner A fetches notifications: sees notifAId, NEVER sees notifBId
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/notifications',
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(listRes.statusCode).toBe(200);
      const dataA = listRes.json();
      expect(dataA.items.length).toBeGreaterThanOrEqual(1);
      expect(dataA.items.some((n: { id: string }) => n.id === notifAId)).toBe(true);
      expect(dataA.items.some((n: { id: string }) => n.id === notifBId)).toBe(false);
      expect(dataA.unreadCount).toBeGreaterThanOrEqual(1);

      // 2. Owner A marks notifAId as read
      const readRes = await app.inject({
        method: 'PATCH',
        url: `/api/notifications/${notifAId}/read`,
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(readRes.statusCode).toBe(200);

      // Verify isRead is true in DB
      const [updatedA] = await db
        .select()
        .from(userNotifications)
        .where(eq(userNotifications.id, notifAId));
      expect(updatedA?.isRead).toBe(true);
      expect(updatedA?.readAt).not.toBeNull();

      // 3. Cross-tenant safety: Owner A tries to mark Pharmacy B's notifBId as read -> 404
      const crossRes = await app.inject({
        method: 'PATCH',
        url: `/api/notifications/${notifBId}/read`,
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(crossRes.statusCode).toBe(404);

      // 4. Mark all read for Owner A
      const markAllRes = await app.inject({
        method: 'POST',
        url: '/api/notifications/mark-all-read',
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(markAllRes.statusCode).toBe(200);
      const afterMarkAll = await app.inject({
        method: 'GET',
        url: '/api/notifications',
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(afterMarkAll.json().unreadCount).toBe(0);
    });
  });

  describe('Pillar 2: Audit Log Screen with Before and After Summaries', () => {
    it('records and queries audit logs with role protection and diff summaries', async () => {
      const auditId = generateUuidV7();

      // Seed audit log in Pharmacy A
      await db.insert(auditLogs).values({
        id: auditId,
        pharmacyId: pharmacyAId,
        userId: ownerAId,
        userName: 'Owner A',
        userRole: 'owner',
        action: 'fiscal_period.close',
        entity: 'fiscal_period',
        entityId: generateUuidV7(),
        summary: 'Closed fiscal period 2026-Q3 for audit close',
        beforeState: { status: 'open', period: '2026-Q3' },
        afterState: { status: 'closed', closedAt: now },
        ipAddress: '127.0.0.1',
        createdAt: now,
      });

      // 1. Cashier A is blocked from audit logs (403 Forbidden)
      const cashierRes = await app.inject({
        method: 'GET',
        url: '/api/admin/audit-logs',
        headers: { authorization: `Bearer ${cashierTokenA}` },
      });
      expect(cashierRes.statusCode).toBe(403);

      // 2. Owner A can view audit logs
      const ownerRes = await app.inject({
        method: 'GET',
        url: '/api/admin/audit-logs?entity=fiscal_period',
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(ownerRes.statusCode).toBe(200);
      const ownerData = ownerRes.json();
      expect(ownerData.items.length).toBeGreaterThanOrEqual(1);
      const item = ownerData.items.find((l: { id: string }) => l.id === auditId);
      expect(item).toBeDefined();
      expect(item.beforeState).toEqual({ status: 'open', period: '2026-Q3' });
      expect(item.afterState.status).toBe('closed');

      // 3. Cross-tenant isolation: Owner B cannot see Pharmacy A's audit entry
      const bRes = await app.inject({
        method: 'GET',
        url: '/api/admin/audit-logs',
        headers: { authorization: `Bearer ${ownerTokenB}` },
      });
      expect(bRes.statusCode).toBe(200);
      expect(bRes.json().items.some((l: { id: string }) => l.id === auditId)).toBe(false);
    });
  });

  describe('Pillar 3: Global Search with Permission Filtering', () => {
    it('searches across invoices, customers, products, suppliers and strictly enforces permissions and tenancy', async () => {
      // 1. Owner A searches for "Panadol"
      const searchResA = await app.inject({
        method: 'GET',
        url: '/api/search?q=Panadol',
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(searchResA.statusCode).toBe(200);
      const dataPanadol = searchResA.json();
      // Should find Panadol Extra 500mg from Pharmacy A, but NEVER Pharmacy B
      expect(dataPanadol.results.products.length).toBe(1);
      expect(dataPanadol.results.products[0].id).toBe(productAId);
      expect(dataPanadol.results.products[0].title).toBe('Panadol Extra 500mg');

      // 2. Owner A searches for "Glaxo" (Supplier)
      const searchResGSK = await app.inject({
        method: 'GET',
        url: '/api/search?q=Glaxo',
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(searchResGSK.statusCode).toBe(200);
      const dataGSK = searchResGSK.json();
      expect(dataGSK.results.suppliers.length).toBe(1);
      expect(dataGSK.results.suppliers[0].id).toBe(supplierAId);

      // 3. Owner A searches for "Ahmed" (Customer)
      const searchResCustomer = await app.inject({
        method: 'GET',
        url: '/api/search?q=Ahmed',
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(searchResCustomer.statusCode).toBe(200);
      const dataCust = searchResCustomer.json();
      expect(dataCust.results.customers.length).toBe(1);
      expect(dataCust.results.customers[0].id).toBe(customerAId);

      // 4. Owner A searches for "INV-A" (Invoice)
      const searchResInv = await app.inject({
        method: 'GET',
        url: '/api/search?q=INV-A',
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(searchResInv.statusCode).toBe(200);
      const dataInv = searchResInv.json();
      expect(dataInv.results.invoices.length).toBe(1);
      expect(dataInv.results.invoices[0].id).toBe(invoiceAId);
      expect(dataInv.results.invoices[0].link).toBe(
        `/finance-sales-ledger?invoiceId=${invoiceAId}`
      );
      expect(dataInv.results.invoices[0].subtitle).toContain('Rs. 50.00');

      // 5. RBAC Permission Guard:
      // Cashier A searches for "Glaxo" (Supplier). Cashier has NO supplier permissions.
      // Search API MUST omit suppliers completely (empty list) rather than leaking supplier data.
      const searchCashierSuppliers = await app.inject({
        method: 'GET',
        url: '/api/search?q=Glaxo',
        headers: { authorization: `Bearer ${cashierTokenA}` },
      });
      expect(searchCashierSuppliers.statusCode).toBe(200);
      const cashierGSKData = searchCashierSuppliers.json();
      expect(cashierGSKData.results.suppliers).toEqual([]); // Empty because cashier has no supplier permission!

      // 6. Cashier A searches for "Panadol" (Product). Cashier HAS sales/counter product permission.
      const searchCashierProducts = await app.inject({
        method: 'GET',
        url: '/api/search?q=Panadol',
        headers: { authorization: `Bearer ${cashierTokenA}` },
      });
      expect(searchCashierProducts.statusCode).toBe(200);
      const cashierProdData = searchCashierProducts.json();
      expect(cashierProdData.results.products.length).toBe(1);
      expect(cashierProdData.results.products[0].id).toBe(productAId);

      // 7. Tenant Isolation:
      // Owner B searches for "INV-A" (Pharmacy A invoice). Must return 0 results.
      const searchBInv = await app.inject({
        method: 'GET',
        url: '/api/search?q=INV-A',
        headers: { authorization: `Bearer ${ownerTokenB}` },
      });
      expect(searchBInv.statusCode).toBe(200);
      expect(searchBInv.json().results.invoices).toEqual([]);
    });
  });
});
