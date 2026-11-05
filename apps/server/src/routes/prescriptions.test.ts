import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import {
  pharmacies,
  branches,
  users,
  customers,
  products,
  taxCategories,
  invoices,
  counters,
  prescriptions,
  prescriptionAccessLogs,
} from '../db/schema';
import { signUserToken } from '../auth/jwt';

describe('Prescriptions Module (Sensitive Health Data & Refill Reminders)', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchAId: string;
  let counterAId: string;

  let ownerTokenA: string;
  let managerTokenA: string;
  let pharmacistTokenA: string;
  let cashierTokenA: string;
  let accountantTokenA: string;
  let ownerTokenB: string;

  let customer1Id: string;
  let product1Id: string;
  let product2ControlledId: string;
  let saleInvoiceId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });
    const db = ctx.db;
    const nowIso = new Date().toISOString();

    // 1. Tenants
    pharmacyAId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyAId,
      name: 'Central Pharmacy A',
      code: 'RXPA',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    pharmacyBId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyBId,
      name: 'Pharmacy B',
      code: 'RXPB',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    branchAId = generateUuidV7();
    await db.insert(branches).values({
      id: branchAId,
      pharmacyId: pharmacyAId,
      name: 'Main Branch A',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    counterAId = generateUuidV7();
    await db.insert(counters).values({
      id: counterAId,
      pharmacyId: pharmacyAId,
      branchId: branchAId,
      name: 'Counter 1',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 2. Users for all roles
    const ownerAId = generateUuidV7();
    await db.insert(users).values({
      id: ownerAId,
      pharmacyId: pharmacyAId,
      name: 'Dr. Owner',
      role: 'owner',
      pinHash: '$2b$10$xyz',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    ownerTokenA = signUserToken({
      userId: ownerAId,
      pharmacyId: pharmacyAId,
      role: 'owner',
      name: 'Dr. Owner',
    });

    const managerAId = generateUuidV7();
    await db.insert(users).values({
      id: managerAId,
      pharmacyId: pharmacyAId,
      name: 'Manager Tariq',
      role: 'manager',
      pinHash: '$2b$10$xyz',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    managerTokenA = signUserToken({
      userId: managerAId,
      pharmacyId: pharmacyAId,
      role: 'manager',
      name: 'Manager Tariq',
    });

    const pharmacistAId = generateUuidV7();
    await db.insert(users).values({
      id: pharmacistAId,
      pharmacyId: pharmacyAId,
      name: 'PharmD Zainab',
      role: 'pharmacist',
      pinHash: '$2b$10$xyz',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    pharmacistTokenA = signUserToken({
      userId: pharmacistAId,
      pharmacyId: pharmacyAId,
      role: 'pharmacist',
      name: 'PharmD Zainab',
    });

    const cashierAId = generateUuidV7();
    await db.insert(users).values({
      id: cashierAId,
      pharmacyId: pharmacyAId,
      name: 'Cashier Kamran',
      role: 'cashier',
      pinHash: '$2b$10$xyz',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    cashierTokenA = signUserToken({
      userId: cashierAId,
      pharmacyId: pharmacyAId,
      role: 'cashier',
      name: 'Cashier Kamran',
    });

    const accountantAId = generateUuidV7();
    await db.insert(users).values({
      id: accountantAId,
      pharmacyId: pharmacyAId,
      name: 'Accountant Farooq',
      role: 'accountant',
      pinHash: '$2b$10$xyz',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    accountantTokenA = signUserToken({
      userId: accountantAId,
      pharmacyId: pharmacyAId,
      role: 'accountant',
      name: 'Accountant Farooq',
    });

    const ownerBId = generateUuidV7();
    await db.insert(users).values({
      id: ownerBId,
      pharmacyId: pharmacyBId,
      name: 'Owner B',
      role: 'owner',
      pinHash: '$2b$10$xyz',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    ownerTokenB = signUserToken({
      userId: ownerBId,
      pharmacyId: pharmacyBId,
      role: 'owner',
      name: 'Owner B',
    });

    // 3. Customer & Products
    customer1Id = generateUuidV7();
    await db.insert(customers).values({
      id: customer1Id,
      pharmacyId: pharmacyAId,
      name: 'Mrs. Saima Khan',
      phone: '03001234567',
      address: 'House 14, Street 2, F-8/1, Islamabad',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const taxCatId = generateUuidV7();
    await db.insert(taxCategories).values({
      id: taxCatId,
      pharmacyId: pharmacyAId,
      name: 'Standard 0%',
      rateBp: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    product1Id = generateUuidV7();
    await db.insert(products).values({
      id: product1Id,
      pharmacyId: pharmacyAId,
      brandName: 'Lipiget 20mg',
      genericName: 'Atorvastatin',
      mrpPaisa: 45000,
      taxCategoryId: taxCatId,
      isControlled: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    product2ControlledId = generateUuidV7();
    await db.insert(products).values({
      id: product2ControlledId,
      pharmacyId: pharmacyAId,
      brandName: 'Rivotril 2mg',
      genericName: 'Clonazepam',
      mrpPaisa: 32000,
      taxCategoryId: taxCatId,
      isControlled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    saleInvoiceId = generateUuidV7();
    await db.insert(invoices).values({
      id: saleInvoiceId,
      pharmacyId: pharmacyAId,
      counterId: counterAId,
      cashierUserId: cashierAId,
      invoiceNumber: 'INV-A-1001',
      clientRequestId: 'req-inv-1001',
      subtotalPaisa: 45000,
      taxPaisa: 0,
      totalPaisa: 45000,
      customerId: customer1Id,
      createdAt: nowIso,
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('role restrictions: cashier and accountant are forbidden; pharmacist, manager, owner succeed', async () => {
    // 1. Cashier is forbidden from listing or creating prescriptions
    const cashierGet = await app.inject({
      method: 'GET',
      url: '/api/prescriptions',
      headers: { authorization: `Bearer ${cashierTokenA}` },
    });
    expect(cashierGet.statusCode).toBe(403);

    const cashierPost = await app.inject({
      method: 'POST',
      url: '/api/prescriptions',
      headers: { authorization: `Bearer ${cashierTokenA}` },
      payload: {
        patientName: 'Test Patient',
        prescriptionDate: '2026-11-05',
        items: [
          {
            productId: product1Id,
            dosageInstructions: '1 tablet daily at bedtime',
            quantityPrescribed: 30,
          },
        ],
      },
    });
    expect(cashierPost.statusCode).toBe(403);

    // 2. Accountant is forbidden from viewing sensitive prescription health data
    const accountantGet = await app.inject({
      method: 'GET',
      url: '/api/prescriptions',
      headers: { authorization: `Bearer ${accountantTokenA}` },
    });
    expect(accountantGet.statusCode).toBe(403);

    // 3. Pharmacist, Manager, and Owner succeed
    const pharmGet = await app.inject({
      method: 'GET',
      url: '/api/prescriptions',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
    });
    expect(pharmGet.statusCode).toBe(200);

    const mgrGet = await app.inject({
      method: 'GET',
      url: '/api/prescriptions',
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(mgrGet.statusCode).toBe(200);

    const ownerGet = await app.inject({
      method: 'GET',
      url: '/api/prescriptions',
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });
    expect(ownerGet.statusCode).toBe(200);
  });

  it('creates prescription with patient, PMDC doctor, items, repeats, and statutory retention dates', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/prescriptions',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        customerId: customer1Id,
        patientName: 'Mrs. Saima Khan',
        patientPhone: '03001234567',
        patientAge: 48,
        patientGender: 'female',
        doctorName: 'Dr. Asad Mehmood',
        doctorRegistrationNumber: 'PMDC-76543-P',
        doctorClinic: 'Shifa Consulting Clinics',
        prescriptionDate: '2026-11-01',
        diagnosis: 'Dyslipidemia and Mild Anxiety',
        repeatCount: 3, // Allowed 3 refills
        refillIntervalDays: 30,
        isControlledDrug: true,
        items: [
          {
            productId: product1Id,
            dosageInstructions: '1 tab OD at night',
            quantityPrescribed: 30,
            daysSupply: 30,
            isControlled: false,
          },
          {
            productId: product2ControlledId,
            dosageInstructions: '0.5 tab SOS for acute anxiety',
            quantityPrescribed: 15,
            daysSupply: 30,
            isControlled: true,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('id');
    expect(body.data.prescriptionNumber).toMatch(/^RX-\d{8}-\w+/);
    expect(body.data.isControlledDrug).toBe(true);
    expect(body.data.repeatCount).toBe(3);
    expect(body.data.repeatsUsed).toBe(0);
    // Controlled drug -> statutory retention of 5 years (2026-11-01 -> 2031-11-01)
    expect(body.data.statutoryRetentionUntil).toBe('2031-11-01');
    expect(body.data.items).toHaveLength(2);

    // Verify row in database
    const [saved] = await ctx.db
      .select()
      .from(prescriptions)
      .where(eq(prescriptions.id, body.data.id));
    expect(saved).toBeDefined();
    expect(saved?.patientName).toBe('Mrs. Saima Khan');
    expect(saved?.doctorRegistrationNumber).toBe('PMDC-76543-P');
  });

  it('dispenses prescription against sale invoice: increments repeatsUsed and updates next refill date', async () => {
    // 1. Create prescription with 2 repeats (refill interval 25 days)
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/prescriptions',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        customerId: customer1Id,
        patientName: 'Mrs. Saima Khan',
        patientPhone: '03001234567',
        prescriptionDate: '2026-11-01',
        repeatCount: 2,
        refillIntervalDays: 25,
        items: [
          {
            productId: product1Id,
            dosageInstructions: '1 tab daily',
            quantityPrescribed: 30,
            daysSupply: 25,
          },
        ],
      },
    });
    const rxId = createRes.json().data.id;

    // 2. Dispense against sale invoice
    const dispenseRes = await app.inject({
      method: 'POST',
      url: `/api/prescriptions/${rxId}/dispense`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        invoiceId: saleInvoiceId,
        notes: 'Dispensed 1st cycle at counter',
      },
    });

    expect(dispenseRes.statusCode).toBe(200);
    const body = dispenseRes.json();
    expect(body.data.repeatsUsed).toBe(1);
    expect(body.data.invoiceId).toBe(saleInvoiceId);
    expect(body.data.status).toBe('active');
    // nextRefillDate: today (2026-11-05) + 25 days -> 2026-11-30
    expect(body.data.nextRefillDate).toBe('2026-11-30');
  });

  it('refill reminders endpoint returns call/SMS-ready contact summary for prescriptions due in N days', async () => {
    // 1. Create a prescription due for refill in 3 days (relative to 2026-11-05 -> 2026-11-08)
    const nowIso = new Date().toISOString();
    const rxRefillId = generateUuidV7();
    await ctx.db.insert(prescriptions).values({
      id: rxRefillId,
      pharmacyId: pharmacyAId,
      prescriptionNumber: 'RX-REFILL-001',
      customerId: customer1Id,
      patientName: 'Rashid Mahmood',
      patientPhone: '03219988776',
      doctorName: 'Dr. Tariq Niazi',
      doctorRegistrationNumber: 'PMDC-12345',
      prescriptionDate: '2026-10-09',
      repeatCount: 2,
      repeatsUsed: 1,
      refillIntervalDays: 30,
      nextRefillDate: '2026-11-08', // Due in 3 days
      isControlledDrug: false,
      status: 'active',
      statutoryRetentionUntil: '2028-10-09',
      createdBy: (
        await ctx.db.select().from(users).where(eq(users.pharmacyId, pharmacyAId)).limit(1)
      )[0]!.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 2. Query refill reminders with daysAhead = 7
    const res = await app.inject({
      method: 'GET',
      url: '/api/prescriptions/refill-reminders?daysAhead=7',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.items)).toBe(true);

    const found = body.data.items.find(
      (item: { prescriptionId: string }) => item.prescriptionId === rxRefillId
    );
    expect(found).toBeDefined();
    expect(found.patientName).toBe('Rashid Mahmood');
    expect(found.patientPhone).toBe('03219988776');
    expect(found.remainingRepeats).toBe(1);
    expect(found.nextRefillDate).toBe('2026-11-08');
    expect(found.contactSummary).toContain('Rashid Mahmood');
    expect(found.contactSummary).toContain('03219988776');
  });

  it('sensitive health data access logs: records every detail view in prescription_access_logs', async () => {
    // 1. Create prescription
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/prescriptions',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        patientName: 'Audit Test Patient',
        prescriptionDate: '2026-11-05',
        items: [
          {
            productId: product1Id,
            dosageInstructions: '1 tablet daily',
            quantityPrescribed: 30,
          },
        ],
      },
    });
    const rxId = createRes.json().data.id;

    // 2. Pharmacist views prescription detail
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/prescriptions/${rxId}`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
    });
    expect(detailRes.statusCode).toBe(200);

    // 3. Manager views prescription detail
    await app.inject({
      method: 'GET',
      url: `/api/prescriptions/${rxId}`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });

    // 4. Verify immutable access logs
    const logs = await ctx.db
      .select()
      .from(prescriptionAccessLogs)
      .where(
        and(
          eq(prescriptionAccessLogs.pharmacyId, pharmacyAId),
          eq(prescriptionAccessLogs.prescriptionId, rxId)
        )
      );

    expect(logs.length).toBeGreaterThanOrEqual(2);
    const viewActions = logs.filter((l) => l.action === 'view_detail');
    expect(viewActions.length).toBe(2);
    expect(viewActions.some((l) => l.userRole === 'pharmacist')).toBe(true);
    expect(viewActions.some((l) => l.userRole === 'manager')).toBe(true);

    // Check dedicated audit trail route
    const trailRes = await app.inject({
      method: 'GET',
      url: `/api/prescriptions/${rxId}/audit-trail`,
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });
    expect(trailRes.statusCode).toBe(200);
    expect(trailRes.json().data.logs.length).toBeGreaterThanOrEqual(2);
  });

  it('diagnostics export strictly excludes prescription and patient health data', async () => {
    // Ensure prescription exists
    await app.inject({
      method: 'POST',
      url: '/api/prescriptions',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        patientName: 'Super Secret Patient PHI',
        prescriptionDate: '2026-11-05',
        diagnosis: 'Confidential psychiatric illness',
        items: [
          {
            productId: product2ControlledId,
            dosageInstructions: 'Confidential dosage',
            quantityPrescribed: 10,
          },
        ],
      },
    });

    // Admin diagnostics export
    const diagRes = await app.inject({
      method: 'GET',
      url: '/api/admin/diagnostics/export',
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });

    expect(diagRes.statusCode).toBe(200);
    const rawExport = JSON.stringify(diagRes.json());

    // Verify zero PHI in diagnostics export
    expect(rawExport).not.toContain('Super Secret Patient PHI');
    expect(rawExport).not.toContain('Confidential psychiatric illness');
    expect(rawExport).not.toContain('prescriptions');
    expect(rawExport).not.toContain('prescription_items');
  });

  it('tenant isolation: Pharmacy B cannot access or view Pharmacy A prescription', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/prescriptions',
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        patientName: 'Pharmacy A Patient',
        prescriptionDate: '2026-11-05',
        items: [
          {
            productId: product1Id,
            dosageInstructions: '1 tab daily',
            quantityPrescribed: 30,
          },
        ],
      },
    });
    const rxId = createRes.json().data.id;

    const resB = await app.inject({
      method: 'GET',
      url: `/api/prescriptions/${rxId}`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(resB.statusCode).toBe(404);
  });
});
