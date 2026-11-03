import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import {
  createTestContext,
  type TestDatabaseContext,
} from '../db/test-helper';
import {
  pharmacies,
  users,
  suppliers,
  journalEntries,
  journalLines,
  fiscalPeriods,
} from '../db/schema';
import { signUserToken } from '../auth/jwt';
import { seedDefaultChartOfAccounts, getPharmacyAccountMap } from '../ledger/coa-seed';
import { eq, and } from 'drizzle-orm';

describe('Suppliers Module Server API & Ledger Integration (Phase 8)', () => {
  let ctx: TestDatabaseContext;
  let app: ReturnType<typeof buildApp>;

  let pharmacyAId: string;
  let pharmacyBId: string;

  let ownerTokenA: string;
  let managerTokenA: string;
  let accountantTokenA: string;
  let pharmacistTokenA: string;
  let cashierTokenA: string;

  let ownerTokenB: string;

  let openPeriodAId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });

    pharmacyAId = generateUuidV7();
    pharmacyBId = generateUuidV7();

    const now = new Date().toISOString();

    // Insert pharmacies
    await ctx.db.insert(pharmacies).values([
      { id: pharmacyAId, name: 'Pharmacy Alpha', code: 'PHA', createdAt: now, updatedAt: now },
      { id: pharmacyBId, name: 'Pharmacy Beta', code: 'PHB', createdAt: now, updatedAt: now },
    ]);

    // Seed COA for both pharmacies
    await seedDefaultChartOfAccounts(ctx.db, pharmacyAId);
    await seedDefaultChartOfAccounts(ctx.db, pharmacyBId);

    // Create open fiscal period for Pharmacy A
    openPeriodAId = generateUuidV7();
    await ctx.db.insert(fiscalPeriods).values({
      id: openPeriodAId,
      pharmacyId: pharmacyAId,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'open',
    });

    const pin = 'dummy_pin_hash';

    // Create users for Pharmacy A
    const ownerAId = generateUuidV7();
    const managerAId = generateUuidV7();
    const accountantAId = generateUuidV7();
    const pharmacistAId = generateUuidV7();
    const cashierAId = generateUuidV7();

    await ctx.db.insert(users).values([
      { id: ownerAId, pharmacyId: pharmacyAId, name: 'Owner A', role: 'owner', pinHash: pin, isActive: true, createdAt: now, updatedAt: now },
      { id: managerAId, pharmacyId: pharmacyAId, name: 'Manager A', role: 'manager', pinHash: pin, isActive: true, createdAt: now, updatedAt: now },
      { id: accountantAId, pharmacyId: pharmacyAId, name: 'Accountant A', role: 'accountant', pinHash: pin, isActive: true, createdAt: now, updatedAt: now },
      { id: pharmacistAId, pharmacyId: pharmacyAId, name: 'Pharmacist A', role: 'pharmacist', pinHash: pin, isActive: true, createdAt: now, updatedAt: now },
      { id: cashierAId, pharmacyId: pharmacyAId, name: 'Cashier A', role: 'cashier', pinHash: pin, isActive: true, createdAt: now, updatedAt: now },
    ]);

    ownerTokenA = signUserToken({ userId: ownerAId, pharmacyId: pharmacyAId, role: 'owner', name: 'Owner A' });
    managerTokenA = signUserToken({ userId: managerAId, pharmacyId: pharmacyAId, role: 'manager', name: 'Manager A' });
    accountantTokenA = signUserToken({ userId: accountantAId, pharmacyId: pharmacyAId, role: 'accountant', name: 'Accountant A' });
    pharmacistTokenA = signUserToken({ userId: pharmacistAId, pharmacyId: pharmacyAId, role: 'pharmacist', name: 'Pharmacist A' });
    cashierTokenA = signUserToken({ userId: cashierAId, pharmacyId: pharmacyAId, role: 'cashier', name: 'Cashier A' });

    // Create owner for Pharmacy B
    const ownerBId = generateUuidV7();
    await ctx.db.insert(users).values({
      id: ownerBId, pharmacyId: pharmacyBId, name: 'Owner B', role: 'owner', pinHash: pin, isActive: true, createdAt: now, updatedAt: now,
    });
    ownerTokenB = signUserToken({ userId: ownerBId, pharmacyId: pharmacyBId, role: 'owner', name: 'Owner B' });
  });

  afterAll(async () => {
    await app.close();
    await ctx.cleanup();
  });

  describe('1. Role-Based Access Control', () => {
    it('blocks cashier from accessing supplier list or management routes (403)', async () => {
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${cashierTokenA}` },
      });
      expect(getRes.statusCode).toBe(403);

      const postRes = await app.inject({
        method: 'POST',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${cashierTokenA}` },
        payload: { name: 'Test Distributor' },
      });
      expect(postRes.statusCode).toBe(403);
    });

    it('allows pharmacist to view suppliers but forbids managing them', async () => {
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${pharmacistTokenA}` },
      });
      expect(getRes.statusCode).toBe(200);

      const postRes = await app.inject({
        method: 'POST',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${pharmacistTokenA}` },
        payload: { name: 'Unauthorized Distributor' },
      });
      expect(postRes.statusCode).toBe(403);
    });

    it('allows manager, accountant, and owner to create and update suppliers', async () => {
      const postManager = await app.inject({
        method: 'POST',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${managerTokenA}` },
        payload: {
          name: 'Muller & Phipps Pakistan',
          contactPerson: 'Tariq Mehmood',
          phone: '+92-300-1112233',
          paymentTermsDays: 45,
          creditLimitPaisa: 100000000,
        },
      });
      expect(postManager.statusCode).toBe(201);
      const supplierId = postManager.json().data.id;

      const patchAccountant = await app.inject({
        method: 'PATCH',
        url: `/api/suppliers/${supplierId}`,
        headers: { authorization: `Bearer ${accountantTokenA}` },
        payload: {
          creditLimitPaisa: 150000000,
        },
      });
      expect(patchAccountant.statusCode).toBe(200);
      expect(patchAccountant.json().data.creditLimitPaisa).toBe(150000000);
    });
  });

  describe('2. Input Validation', () => {
    it('rejects empty name or invalid email', async () => {
      const emptyNameRes = await app.inject({
        method: 'POST',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${ownerTokenA}` },
        payload: { name: '   ' },
      });
      expect(emptyNameRes.statusCode).toBe(400);

      const invalidEmailRes = await app.inject({
        method: 'POST',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${ownerTokenA}` },
        payload: { name: 'Valid Name', email: 'not-an-email' },
      });
      expect(invalidEmailRes.statusCode).toBe(400);
    });

    it('rejects negative numbers and non-integer paisa for financial fields', async () => {
      const negativeTermsRes = await app.inject({
        method: 'POST',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${ownerTokenA}` },
        payload: { name: 'Searle Pharma', paymentTermsDays: -10 },
      });
      expect(negativeTermsRes.statusCode).toBe(400);

      const floatPaisaRes = await app.inject({
        method: 'POST',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${ownerTokenA}` },
        payload: { name: 'Searle Pharma', creditLimitPaisa: 100.5 },
      });
      expect(floatPaisaRes.statusCode).toBe(400);
    });
  });

  describe('3. Opening Balance & Invariant: Payable Balance Equals Ledger', () => {
    it('auto-posts a balanced journal entry for opening balance payable and reflects in ledger', async () => {
      const openingBalancePaisa = 5000000; // Rs. 50,000.00
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${ownerTokenA}` },
        payload: {
          name: 'Getz Pharma Distribution',
          contactPerson: 'Ali Raza',
          phone: '+92-321-4455667',
          openingBalancePaisa,
        },
      });

      expect(createRes.statusCode).toBe(201);
      const supplier = createRes.json().data;

      // 1. Verify opening balance entry posted into journal_entries
      const [openingEntry] = await ctx.db
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.pharmacyId, pharmacyAId),
            eq(journalEntries.sourceType, 'supplier_opening'),
            eq(journalEntries.sourceId, supplier.id)
          )
        );

      expect(openingEntry).toBeDefined();
      if (!openingEntry) throw new Error('Expected openingEntry');
      expect(openingEntry.status).toBe('posted');

      // 2. Verify journal lines: Dr Retained Earnings, Cr Accounts Payable (party = supplier)
      const accountMap = await getPharmacyAccountMap(ctx.db, pharmacyAId);
      const apAccountId = accountMap.ap;
      const lines = await ctx.db
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, openingEntry.id));

      expect(lines).toHaveLength(2);
      const apLine = lines.find((l) => l.accountId === apAccountId);
      expect(apLine).toBeDefined();
      expect(apLine?.creditPaisa).toBe(openingBalancePaisa);
      expect(apLine?.debitPaisa).toBe(0);
      expect(apLine?.partyType).toBe('supplier');
      expect(apLine?.partyId).toBe(supplier.id);

      // 3. Verify GET /api/suppliers returns correct payableBalancePaisa
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/suppliers?search=Getz',
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(listRes.statusCode).toBe(200);
      const listSupplier = listRes.json().items.find((s: { id: string }) => s.id === supplier.id);
      expect(listSupplier).toBeDefined();
      expect(listSupplier.payableBalancePaisa).toBe(openingBalancePaisa);

      // 4. Verify detail endpoint /api/suppliers/:id returns ledger lines
      const detailRes = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${supplier.id}`,
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(detailRes.statusCode).toBe(200);
      const detail = detailRes.json();
      expect(detail.supplier.payableBalancePaisa).toBe(openingBalancePaisa);
      expect(detail.ledger).toHaveLength(1);
      expect(detail.ledger[0].creditPaisa).toBe(openingBalancePaisa);
      expect(detail.ledger[0].runningBalancePaisa).toBe(openingBalancePaisa);
    });

    it('guarantees that total payable across all suppliers equals the Accounts Payable control account', async () => {
      // Fetch AP account lines directly
      const accountMap = await getPharmacyAccountMap(ctx.db, pharmacyAId);
      const apAccountId = accountMap.ap;
      const apLines = await ctx.db
        .select()
        .from(journalLines)
        .where(
          and(
            eq(journalLines.pharmacyId, pharmacyAId),
            eq(journalLines.accountId, apAccountId)
          )
        );

      const ledgerControlBalance = apLines.reduce(
        (sum, l) => sum + (l.creditPaisa - l.debitPaisa),
        0
      );

      // Fetch from suppliers KPI endpoint
      const res = await app.inject({
        method: 'GET',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(res.statusCode).toBe(200);
      const { kpis, items } = res.json();

      const sumOfSupplierBalances = items.reduce(
        (sum: number, s: { payableBalancePaisa: number }) => sum + s.payableBalancePaisa,
        0
      );

      expect(kpis.totalPayablePaisa).toBe(ledgerControlBalance);
      expect(sumOfSupplierBalances).toBe(ledgerControlBalance);
    });
  });

  describe('4. Deactivate Instead of Delete', () => {
    it('sets isActive to false upon deactivation and preserves all historical records', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${ownerTokenA}` },
        payload: { name: 'GlaxoSmithKline (GSK)' },
      });
      const supplierId = createRes.json().data.id;

      // Deactivate
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/suppliers/${supplierId}`,
        headers: { authorization: `Bearer ${ownerTokenA}` },
        payload: { isActive: false },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().data.isActive).toBe(false);

      // Verify row still exists in database
      const [dbRow] = await ctx.db
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, supplierId));
      expect(dbRow).toBeDefined();
      if (!dbRow) throw new Error('Expected dbRow');
      expect(dbRow.isActive).toBe(false);

      // Can be reactivated
      const reactivateRes = await app.inject({
        method: 'PATCH',
        url: `/api/suppliers/${supplierId}`,
        headers: { authorization: `Bearer ${ownerTokenA}` },
        payload: { isActive: true },
      });
      expect(reactivateRes.statusCode).toBe(200);
      expect(reactivateRes.json().data.isActive).toBe(true);
    });
  });

  describe('5. Duplicate Candidate Detection & Safe Review Merge', () => {
    it('identifies duplicate candidates matching on name or phone and merges them safely', async () => {
      // 1. Create two suppliers with matching name and phone
      const sup1Res = await app.inject({
        method: 'POST',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${ownerTokenA}` },
        payload: {
          name: 'Hilton Pharma Distribution',
          phone: '+92-333-9988776',
          openingBalancePaisa: 2000000, // Rs 20,000
        },
      });
      const sup1 = sup1Res.json().data;

      const sup2Res = await app.inject({
        method: 'POST',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${ownerTokenA}` },
        payload: {
          name: 'hilton pharma distribution', // lowercase duplicate
          phone: '+92-333-9988776',
          openingBalancePaisa: 3000000, // Rs 30,000
        },
      });
      const sup2 = sup2Res.json().data;

      // 2. Call duplicate detection route
      const dupRes = await app.inject({
        method: 'GET',
        url: '/api/suppliers/duplicates',
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(dupRes.statusCode).toBe(200);
      const groups = dupRes.json().groups;
      expect(groups.length).toBeGreaterThanOrEqual(1);

      const matchingGroup = groups.find((g: { candidateIds: string[] }) =>
        g.candidateIds.includes(sup1.id) && g.candidateIds.includes(sup2.id)
      );
      expect(matchingGroup).toBeDefined();

      // 3. Merge sup2 (source) into sup1 (target)
      const mergeRes = await app.inject({
        method: 'POST',
        url: '/api/suppliers/merge',
        headers: { authorization: `Bearer ${ownerTokenA}` },
        payload: {
          targetSupplierId: sup1.id,
          sourceSupplierId: sup2.id,
        },
      });
      expect(mergeRes.statusCode).toBe(200);

      // 4. Verify sup2 is deactivated and noted
      const [updatedSup2] = await ctx.db
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, sup2.id));
      expect(updatedSup2).toBeDefined();
      if (!updatedSup2) throw new Error('Expected updatedSup2');
      expect(updatedSup2.isActive).toBe(false);

      // 5. Verify sup2 payable balance is netted to 0
      const detailSup2 = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${sup2.id}`,
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(detailSup2.json().supplier.payableBalancePaisa).toBe(0);

      // 6. Verify sup1 now has unified balance (20,000 + 30,000 = 50,000 paisa)
      const detailSup1 = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${sup1.id}`,
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });
      expect(detailSup1.json().supplier.payableBalancePaisa).toBe(5000000);
    });
  });

  describe('6. Cross-Tenant Isolation', () => {
    it('prevents Pharmacy B from seeing or managing Pharmacy A suppliers', async () => {
      // Create supplier in Pharmacy A
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${ownerTokenA}` },
        payload: { name: 'Exclusive Tenant A Supplier' },
      });
      const supplierAId = createRes.json().data.id;

      // Pharmacy B attempts to read
      const getBRes = await app.inject({
        method: 'GET',
        url: `/api/suppliers/${supplierAId}`,
        headers: { authorization: `Bearer ${ownerTokenB}` },
      });
      expect(getBRes.statusCode).toBe(404);

      // Pharmacy B attempts to patch
      const patchBRes = await app.inject({
        method: 'PATCH',
        url: `/api/suppliers/${supplierAId}`,
        headers: { authorization: `Bearer ${ownerTokenB}` },
        payload: { name: 'Hacked Name' },
      });
      expect(patchBRes.statusCode).toBe(404);

      // Pharmacy B list does not contain Pharmacy A supplier
      const listBRes = await app.inject({
        method: 'GET',
        url: '/api/suppliers',
        headers: { authorization: `Bearer ${ownerTokenB}` },
      });
      const foundInB = listBRes.json().items.find((s: { id: string }) => s.id === supplierAId);
      expect(foundInB).toBeUndefined();
    });
  });
});
