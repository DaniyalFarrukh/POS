import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import {
  isPostgresReachable,
  createTestContext,
  type TestDatabaseContext,
} from '../db/test-helper';
import {
  pharmacies,
  branches,
  counters,
  users,
  products,
  batches,
  stockMovements,
  invoices,
  invoiceLines,
  devices,
  changeLog,
} from '../db/schema';
import { signUserToken } from '../auth/jwt';

describe('Phase 4: Reports, RBAC, and Owner Dashboard Integration Tests', () => {
  let isAvailable = false;
  let ctx: TestDatabaseContext | null = null;
  let app: ReturnType<typeof buildApp>;

  // Fixture IDs
  let pharmacyId: string;
  let branchEastId: string;
  let branchWestId: string;
  let counterEastId: string;
  let counterWestId: string;
  let ownerId: string;
  let pharmacistId: string;
  let cashierAliceId: string;
  let cashierBobId: string;
  let productAId: string;
  let productBId: string;
  let batchB1Id: string;
  let batchB2Id: string;
  let batchB3Id: string;

  // Tokens
  let ownerToken: string;
  let pharmacistToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    isAvailable = await isPostgresReachable();
    if (!isAvailable) {
      return;
    }

    ctx = await createTestContext();
    app = buildApp({ db: ctx.db });
    const now = new Date();
    const nowIso = now.toISOString();

    // 1. Pharmacy
    pharmacyId = generateUuidV7();
    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: 'MediCare Central',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 2. Branches
    branchEastId = generateUuidV7();
    branchWestId = generateUuidV7();
    await ctx.db.insert(branches).values([
      {
        id: branchEastId,
        pharmacyId,
        name: 'Branch East',
        address: 'Gulberg III, Lahore',
        phone: '+92-42-35800001',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: branchWestId,
        pharmacyId,
        name: 'Branch West',
        address: 'DHA Phase 5, Lahore',
        phone: '+92-42-35800002',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);

    // 3. Counters
    counterEastId = generateUuidV7();
    counterWestId = generateUuidV7();
    await ctx.db.insert(counters).values([
      {
        id: counterEastId,
        pharmacyId,
        branchId: branchEastId,
        name: 'Counter E1',
        code: 'CE1',
        lastInvoiceSeq: 1,
        lastCreditNoteSeq: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: counterWestId,
        pharmacyId,
        branchId: branchWestId,
        name: 'Counter W1',
        code: 'CW1',
        lastInvoiceSeq: 1,
        lastCreditNoteSeq: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);

    // 4. Users
    ownerId = generateUuidV7();
    pharmacistId = generateUuidV7();
    cashierAliceId = generateUuidV7();
    cashierBobId = generateUuidV7();

    const pinHash1234 = bcrypt.hashSync('1234', 10);
    await ctx.db.insert(users).values([
      {
        id: ownerId,
        pharmacyId,
        name: 'Dr. Tariq (Owner)',
        role: 'owner',
        pinHash: pinHash1234,
        isActive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: pharmacistId,
        pharmacyId,
        name: 'Fatima (Pharmacist)',
        role: 'pharmacist',
        pinHash: pinHash1234,
        isActive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: cashierAliceId,
        pharmacyId,
        name: 'Alice (Cashier)',
        role: 'cashier',
        pinHash: pinHash1234,
        isActive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: cashierBobId,
        pharmacyId,
        name: 'Bob (Cashier)',
        role: 'cashier',
        pinHash: pinHash1234,
        isActive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);

    // Sign Tokens
    ownerToken = signUserToken({
      userId: ownerId,
      pharmacyId,
      role: 'owner',
      name: 'Dr. Tariq',
    });
    pharmacistToken = signUserToken({
      userId: pharmacistId,
      pharmacyId,
      role: 'pharmacist',
      name: 'Fatima',
    });
    cashierToken = signUserToken({
      userId: cashierAliceId,
      pharmacyId,
      role: 'cashier',
      name: 'Alice',
    });

    // 5. Products & Batches
    productAId = generateUuidV7();
    productBId = generateUuidV7();

    await ctx.db.insert(products).values([
      {
        id: productAId,
        pharmacyId,
        brandName: 'Panadol 500mg',
        genericName: 'Paracetamol',
        manufacturer: 'GSK',
        mrpPaisa: 5000,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: productBId,
        pharmacyId,
        brandName: 'Augmentin 625mg',
        genericName: 'Amoxicillin + Clavulanic Acid',
        manufacturer: 'GSK',
        mrpPaisa: 20000,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);

    batchB1Id = generateUuidV7();
    batchB2Id = generateUuidV7();
    batchB3Id = generateUuidV7();

    // Expiries:
    // B1: 1 year from now (good)
    // B2: 15 days from now (expiring_soon)
    // B3: 30 days ago (expired)
    const futureDate = new Date(now.getTime() + 365 * 86400000).toISOString().slice(0, 10);
    const soonDate = new Date(now.getTime() + 15 * 86400000).toISOString().slice(0, 10);
    const pastDate = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

    await ctx.db.insert(batches).values([
      {
        id: batchB1Id,
        pharmacyId,
        productId: productAId,
        batchNo: 'B-PAN-01',
        expiryDate: futureDate,
        costPaisa: 3000, // Rs. 30.00
        mrpPaisa: 5000, // Rs. 50.00
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: batchB2Id,
        pharmacyId,
        productId: productAId,
        batchNo: 'B-PAN-02-SOON',
        expiryDate: soonDate,
        costPaisa: 3200, // Rs. 32.00
        mrpPaisa: 5000, // Rs. 50.00
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: batchB3Id,
        pharmacyId,
        productId: productBId,
        batchNo: 'B-AUG-03-EXP',
        expiryDate: pastDate,
        costPaisa: 15000, // Rs. 150.00
        mrpPaisa: 20000, // Rs. 200.00
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);

    // 6. Stock Movements (Rule 4: signed balance)
    // Supplier Alpha Pharma:
    // +100 to East (B1)
    // +50 to West (B1)
    // Supplier Beta Meds:
    // +30 to East (B2)
    // +10 to West (B3)
    await ctx.db.insert(stockMovements).values([
      {
        id: generateUuidV7(),
        pharmacyId,
        branchId: branchEastId,
        productId: productAId,
        batchId: batchB1Id,
        type: 'purchase',
        quantitySigned: 100,
        reason: 'Supplier Alpha Pharma',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: generateUuidV7(),
        pharmacyId,
        branchId: branchWestId,
        productId: productAId,
        batchId: batchB1Id,
        type: 'purchase',
        quantitySigned: 50,
        reason: 'Supplier Alpha Pharma',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: generateUuidV7(),
        pharmacyId,
        branchId: branchEastId,
        productId: productAId,
        batchId: batchB2Id,
        type: 'purchase',
        quantitySigned: 30,
        reason: 'Supplier Beta Meds',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: generateUuidV7(),
        pharmacyId,
        branchId: branchWestId,
        productId: productBId,
        batchId: batchB3Id,
        type: 'purchase',
        quantitySigned: 10,
        reason: 'Supplier Beta Meds',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);

    // 7. Invoices & Sales:
    // Invoice 1: Alice at Branch East sells 10 units of Batch B1 @ 5000 paisa
    // subtotal = 50,000, tax = 9000, total = 59,000 paisa
    const inv1Id = generateUuidV7();
    await ctx.db.insert(invoices).values({
      id: inv1Id,
      pharmacyId,
      counterId: counterEastId,
      cashierUserId: cashierAliceId,
      invoiceNumber: 'INV-E1-000001',
      clientRequestId: generateUuidV7(),
      status: 'completed',
      subtotalPaisa: 50000,
      discountPaisa: 0,
      taxPaisa: 9000,
      totalPaisa: 59000,
      createdAt: nowIso,
    });

    await ctx.db.insert(invoiceLines).values({
      id: generateUuidV7(),
      pharmacyId,
      invoiceId: inv1Id,
      productId: productAId,
      batchId: batchB1Id,
      quantity: 10,
      unitPricePaisa: 5000,
      discountPaisa: 0,
      taxRateBp: 1800,
      taxPaisa: 9000,
      lineTotalPaisa: 50000,
    });

    // Stock deduction for sale
    await ctx.db.insert(stockMovements).values({
      id: generateUuidV7(),
      pharmacyId,
      branchId: branchEastId,
      productId: productAId,
      batchId: batchB1Id,
      type: 'sale',
      quantitySigned: -10,
      referenceType: 'invoice',
      referenceId: inv1Id,
      reason: 'Sale INV-E1-000001',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // Invoice 2: Bob at Branch West sells 5 units of Batch B1 @ 5000 paisa
    // subtotal = 25,000, tax = 4500, total = 29,500 paisa
    const inv2Id = generateUuidV7();
    await ctx.db.insert(invoices).values({
      id: inv2Id,
      pharmacyId,
      counterId: counterWestId,
      cashierUserId: cashierBobId,
      invoiceNumber: 'INV-W1-000001',
      clientRequestId: generateUuidV7(),
      status: 'completed',
      subtotalPaisa: 25000,
      discountPaisa: 0,
      taxPaisa: 4500,
      totalPaisa: 29500,
      createdAt: nowIso,
    });

    await ctx.db.insert(invoiceLines).values({
      id: generateUuidV7(),
      pharmacyId,
      invoiceId: inv2Id,
      productId: productAId,
      batchId: batchB1Id,
      quantity: 5,
      unitPricePaisa: 5000,
      discountPaisa: 0,
      taxRateBp: 1800,
      taxPaisa: 4500,
      lineTotalPaisa: 25000,
    });

    // Stock deduction for sale
    await ctx.db.insert(stockMovements).values({
      id: generateUuidV7(),
      pharmacyId,
      branchId: branchWestId,
      productId: productAId,
      batchId: batchB1Id,
      type: 'sale',
      quantitySigned: -5,
      referenceType: 'invoice',
      referenceId: inv2Id,
      reason: 'Sale INV-W1-000001',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  // =========================================================================
  // 1. Authentication & Tenancy
  // =========================================================================
  describe('Authentication & Tenancy', () => {
    it('authenticates valid user credentials and returns JWT token', async (context) => {
      if (!isAvailable) return context.skip();

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          name: 'Dr. Tariq (Owner)',
          pin: '1234',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ token: string; user: { id: string; role: string; pharmacyName: string } }>();
      expect(body.token).toBeDefined();
      expect(body.user.role).toBe('owner');
      expect(body.user.pharmacyName).toBe('MediCare Central');
    });

    it('rejects invalid credentials with 401', async (context) => {
      if (!isAvailable) return context.skip();

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          name: 'Dr. Tariq (Owner)',
          pin: '9999', // Wrong pin
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 for unauthenticated requests', async (context) => {
      if (!isAvailable) return context.skip();

      const res = await app.inject({
        method: 'GET',
        url: '/api/dashboard/overview',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // 2. Role-Based Access Control (RBAC)
  // =========================================================================
  describe('Role-Based Access Control (RBAC)', () => {
    it('allows owner to access all reports and admin routes', async (context) => {
      if (!isAvailable) return context.skip();

      const resOverview = await app.inject({
        method: 'GET',
        url: '/api/dashboard/overview',
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(resOverview.statusCode).toBe(200);

      const resProfit = await app.inject({
        method: 'GET',
        url: '/api/reports/profit-per-batch',
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(resProfit.statusCode).toBe(200);

      const resUsers = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(resUsers.statusCode).toBe(200);
    });

    it('allows pharmacist to access overview and sales, but denies profit and admin', async (context) => {
      if (!isAvailable) return context.skip();

      // Allowed
      const resSales = await app.inject({
        method: 'GET',
        url: '/api/reports/sales',
        headers: { authorization: `Bearer ${pharmacistToken}` },
      });
      expect(resSales.statusCode).toBe(200);

      // Denied profit per batch (owner only)
      const resProfit = await app.inject({
        method: 'GET',
        url: '/api/reports/profit-per-batch',
        headers: { authorization: `Bearer ${pharmacistToken}` },
      });
      expect(resProfit.statusCode).toBe(403);

      // Denied admin users
      const resAdmin = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { authorization: `Bearer ${pharmacistToken}` },
      });
      expect(resAdmin.statusCode).toBe(403);
    });

    it('denies cashier access to dashboard overview, reports, and admin', async (context) => {
      if (!isAvailable) return context.skip();

      const resOverview = await app.inject({
        method: 'GET',
        url: '/api/dashboard/overview',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(resOverview.statusCode).toBe(403);

      const resSales = await app.inject({
        method: 'GET',
        url: '/api/reports/sales',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(resSales.statusCode).toBe(403);

      const resAdmin = await app.inject({
        method: 'GET',
        url: '/api/admin/branches',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(resAdmin.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // 3. Known Fixtures & Report Calculations
  // =========================================================================
  describe('Report Queries with Known Fixtures', () => {
    it('calculates exact sales report totals and breakdowns', async (context) => {
      if (!isAvailable) return context.skip();

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/sales',
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<{
        totals: {
          invoiceCount: number;
          subtotalPaisa: number;
          taxPaisa: number;
          totalPaisa: number;
        };
        byBranch: Array<{ branchId: string; invoiceCount: number; totalPaisa: number }>;
        byCashier: Array<{ cashierUserId: string; invoiceCount: number; totalPaisa: number }>;
      }>();

      // Rule 1: Integer paisa precision
      expect(data.totals.invoiceCount).toBe(2);
      expect(data.totals.subtotalPaisa).toBe(75000); // 50,000 + 25,000
      expect(data.totals.taxPaisa).toBe(13500); // 9,000 + 4,500
      expect(data.totals.totalPaisa).toBe(88500); // 59,000 + 29,500

      // Branch breakdown
      const east = data.byBranch.find((b) => b.branchId === branchEastId);
      const west = data.byBranch.find((b) => b.branchId === branchWestId);
      expect(east?.totalPaisa).toBe(59000);
      expect(east?.invoiceCount).toBe(1);
      expect(west?.totalPaisa).toBe(29500);
      expect(west?.invoiceCount).toBe(1);

      // Cashier breakdown
      const alice = data.byCashier.find((c) => c.cashierUserId === cashierAliceId);
      const bob = data.byCashier.find((c) => c.cashierUserId === cashierBobId);
      expect(alice?.totalPaisa).toBe(59000);
      expect(bob?.totalPaisa).toBe(29500);
    });

    it('filters sales report by branchId', async (context) => {
      if (!isAvailable) return context.skip();

      const res = await app.inject({
        method: 'GET',
        url: `/api/reports/sales?branchId=${branchEastId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<{
        totals: { invoiceCount: number; totalPaisa: number };
      }>();

      expect(data.totals.invoiceCount).toBe(1);
      expect(data.totals.totalPaisa).toBe(59000);
    });

    it('calculates profit per batch strictly in integer paisa', async (context) => {
      if (!isAvailable) return context.skip();

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/profit-per-batch',
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<{
        items: Array<{
          batchId: string;
          batchNo: string;
          unitsSold: number;
          unitCostPaisa: number;
          revenuePaisa: number;
          costPaisa: number;
          profitPaisa: number;
          marginPercent: number;
        }>;
      }>();

      const b1 = data.items.find((i) => i.batchId === batchB1Id);
      expect(b1).toBeDefined();
      expect(b1?.unitsSold).toBe(15); // 10 from Alice + 5 from Bob
      expect(b1?.unitCostPaisa).toBe(3000); // Rs. 30.00
      expect(b1?.revenuePaisa).toBe(75000); // 15 * 5000 paisa
      expect(b1?.costPaisa).toBe(45000); // 15 * 3000 paisa
      expect(b1?.profitPaisa).toBe(30000); // 75,000 - 45,000 = 30,000 paisa (Rs. 300.00)
      expect(b1?.marginPercent).toBe(40); // 30,000 / 75,000 * 100 = 40%
    });

    it('computes stock balance cross-branch and verifies expiry status (Rule 4)', async (context) => {
      if (!isAvailable) return context.skip();

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/stock-and-expiry',
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<{
        items: Array<{
          batchId: string;
          branchId: string;
          quantity: number;
          status: string;
        }>;
      }>();

      // Branch East Batch B1: +100 - 10 = 90
      const eastB1 = data.items.find((i) => i.batchId === batchB1Id && i.branchId === branchEastId);
      expect(eastB1?.quantity).toBe(90);
      expect(eastB1?.status).toBe('good');

      // Branch West Batch B1: +50 - 5 = 45
      const westB1 = data.items.find((i) => i.batchId === batchB1Id && i.branchId === branchWestId);
      expect(westB1?.quantity).toBe(45);
      expect(westB1?.status).toBe('good');

      // Branch East Batch B2: 30, expiring_soon
      const eastB2 = data.items.find((i) => i.batchId === batchB2Id && i.branchId === branchEastId);
      expect(eastB2?.quantity).toBe(30);
      expect(eastB2?.status).toBe('expiring_soon');

      // Branch West Batch B3: 10, expired
      const westB3 = data.items.find((i) => i.batchId === batchB3Id && i.branchId === branchWestId);
      expect(westB3?.quantity).toBe(10);
      expect(westB3?.status).toBe('expired');
    });

    it('summarizes supplier ledger purchases correctly', async (context) => {
      if (!isAvailable) return context.skip();

      const res = await app.inject({
        method: 'GET',
        url: '/api/reports/supplier-ledger',
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<{
        items: Array<{
          supplierName: string;
          purchaseCount: number;
          totalQuantity: number;
          totalCostPaisa: number;
        }>;
      }>();

      const alpha = data.items.find((i) => i.supplierName === 'Supplier Alpha Pharma');
      expect(alpha).toBeDefined();
      expect(alpha?.purchaseCount).toBe(2);
      expect(alpha?.totalQuantity).toBe(150); // 100 + 50
      expect(alpha?.totalCostPaisa).toBe(450000); // 150 * 3000

      const beta = data.items.find((i) => i.supplierName === 'Supplier Beta Meds');
      expect(beta).toBeDefined();
      expect(beta?.purchaseCount).toBe(2);
      expect(beta?.totalQuantity).toBe(40); // 30 + 10
      expect(beta?.totalCostPaisa).toBe(246000); // (30 * 3200) + (10 * 15000) = 96,000 + 150,000 = 246,000
    });

    it('delivers overview KPIs on /api/dashboard/overview', async (context) => {
      if (!isAvailable) return context.skip();

      const res = await app.inject({
        method: 'GET',
        url: '/api/dashboard/overview',
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<{
        todaySalesPaisa: number;
        todayInvoiceCount: number;
        topProducts: Array<{ brandName: string; unitsSold: number; revenuePaisa: number }>;
        expiringBatches: Array<{ batchNo: string; currentStock: number }>;
      }>();

      expect(data.todaySalesPaisa).toBe(88500);
      expect(data.todayInvoiceCount).toBe(2);
      expect(data.topProducts[0]?.brandName).toBe('Panadol 500mg');
      expect(data.topProducts[0]?.unitsSold).toBe(15);
      expect(data.expiringBatches.some((b) => b.batchNo === 'B-PAN-02-SOON')).toBe(true);
    });
  });

  // =========================================================================
  // 4. Admin Management Endpoints
  // =========================================================================
  describe('Admin Management Endpoints', () => {
    it('creates a new cashier user and logs it to change_log', async (context) => {
      if (!isAvailable) return context.skip();

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          name: 'Usman Cashier',
          role: 'cashier',
          pin: '7788',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string; name: string; role: string; isActive: boolean }>();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Usman Cashier');
      expect(body.role).toBe('cashier');

      // Verify stored in DB with hashed PIN
      const [stored] = await ctx!.db.select().from(users).where(eq(users.id, body.id)).limit(1);
      expect(stored).toBeDefined();
      expect(stored!.pinHash).not.toBe('7788');
      expect(bcrypt.compareSync('7788', stored!.pinHash)).toBe(true);

      // Verify change_log entry
      const logs = await ctx!.db.select().from(changeLog).where(eq(changeLog.entityId, body.id));
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]?.entity).toBe('user');
    });

    it('creates branches and counters and retrieves them', async (context) => {
      if (!isAvailable) return context.skip();

      const branchRes = await app.inject({
        method: 'POST',
        url: '/api/admin/branches',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          name: 'Branch North',
          address: 'North Nazimabad, Karachi',
          phone: '+92-21-36600000',
        },
      });

      expect(branchRes.statusCode).toBe(201);
      const branchBody = branchRes.json<{ id: string; name: string }>();

      const counterRes = await app.inject({
        method: 'POST',
        url: '/api/admin/counters',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          branchId: branchBody.id,
          name: 'Counter N1',
          code: 'CN1',
        },
      });

      expect(counterRes.statusCode).toBe(201);

      // Fetch counters
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/admin/counters',
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(listRes.statusCode).toBe(200);
      const countersList = listRes.json<{ items: Array<{ name: string; code: string }> }>();
      expect(countersList.items.some((c) => c.code === 'CN1')).toBe(true);
    });

    it('generates a registration code and lists registered devices', async (context) => {
      if (!isAvailable) return context.skip();

      // Generate registration code
      const codeRes = await app.inject({
        method: 'POST',
        url: '/api/admin/registration-codes',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          branchId: branchEastId,
          counterId: counterEastId,
          expiresInHours: 48,
        },
      });

      expect(codeRes.statusCode).toBe(201);
      const codeData = codeRes.json<{ id: string; code: string }>();
      expect(codeData.code).toMatch(/^REG-[0-9A-F]{4}-[0-9A-F]{4}$/);

      // Add dummy device and test revocation
      const deviceId = generateUuidV7();
      await ctx!.db.insert(devices).values({
        id: deviceId,
        pharmacyId,
        branchId: branchEastId,
        counterId: counterEastId,
        deviceName: 'POS Terminal Test 1',
        isRevoked: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Revoke device
      const revokeRes = await app.inject({
        method: 'PATCH',
        url: `/api/admin/devices/${deviceId}/revoke`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { isRevoked: true },
      });

      expect(revokeRes.statusCode).toBe(200);

      // Verify list
      const devicesRes = await app.inject({
        method: 'GET',
        url: '/api/admin/devices',
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(devicesRes.statusCode).toBe(200);
      const devList = devicesRes.json<{ items: Array<{ id: string; isRevoked: boolean }> }>();
      const revoked = devList.items.find((d) => d.id === deviceId);
      expect(revoked?.isRevoked).toBe(true);
    });

    it('queries read-only audit logs with pagination', async (context) => {
      if (!isAvailable) return context.skip();

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/audit-logs?page=1&limit=10',
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<{
        items: Array<{ seq: number; entity: string; op: string }>;
        total: number;
        page: number;
        totalPages: number;
      }>();

      expect(Array.isArray(data.items)).toBe(true);
      expect(data.total).toBeGreaterThan(0);
      expect(data.page).toBe(1);
    });
  });
});
