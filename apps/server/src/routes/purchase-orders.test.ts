import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import {
  pharmacies,
  users,
  branches,
  products,
  suppliers,
  journalLines,
  fiscalPeriods,
} from '../db/schema';
import { signUserToken } from '../auth/jwt';
import { seedDefaultChartOfAccounts, getPharmacyAccountMap } from '../ledger/coa-seed';
import { eq, and } from 'drizzle-orm';

describe('Purchase Orders Module & Ledger Integration', () => {
  let ctx: TestDatabaseContext;
  let app: ReturnType<typeof buildApp>;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchAId: string;
  let branchBId: string;

  let ownerTokenA: string;
  let managerTokenA: string;
  let pharmacistTokenA: string;
  let cashierTokenA: string;
  let ownerTokenB: string;

  let supplierAId: string;
  let product1Id: string;
  let product2Id: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });
    const db = ctx.db;

    const now = new Date().toISOString();

    // 1. Setup Pharmacy A
    pharmacyAId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyAId,
      name: 'PO Pharmacy A',
      code: 'POPHA',
      createdAt: now,
      updatedAt: now,
    });

    branchAId = generateUuidV7();
    await db.insert(branches).values({
      id: branchAId,
      pharmacyId: pharmacyAId,
      name: 'Branch Main A',
      createdAt: now,
      updatedAt: now,
    });

    // 2. Setup Pharmacy B (for tenant isolation)
    pharmacyBId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyBId,
      name: 'PO Pharmacy B',
      code: 'POPHB',
      createdAt: now,
      updatedAt: now,
    });

    branchBId = generateUuidV7();
    await db.insert(branches).values({
      id: branchBId,
      pharmacyId: pharmacyBId,
      name: 'Branch Main B',
      createdAt: now,
      updatedAt: now,
    });

    // 3. Seed Charts of Accounts & Open Fiscal Periods
    await seedDefaultChartOfAccounts(db, pharmacyAId);
    await seedDefaultChartOfAccounts(db, pharmacyBId);

    const year = new Date().getFullYear();
    await db.insert(fiscalPeriods).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      status: 'open',
    });
    await db.insert(fiscalPeriods).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyBId,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      status: 'open',
    });

    // 4. Create Users & JWTs
    const ownerAId = generateUuidV7();
    await db.insert(users).values({
      id: ownerAId,
      pharmacyId: pharmacyAId,
      name: 'Owner Alice',
      role: 'owner',
      pinHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
      createdAt: now,
      updatedAt: now,
    });
    ownerTokenA = signUserToken({
      userId: ownerAId,
      pharmacyId: pharmacyAId,
      role: 'owner',
      name: 'Owner Alice',
    });

    const managerAId = generateUuidV7();
    await db.insert(users).values({
      id: managerAId,
      pharmacyId: pharmacyAId,
      name: 'Manager Bob',
      role: 'manager',
      pinHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
      createdAt: now,
      updatedAt: now,
    });
    managerTokenA = signUserToken({
      userId: managerAId,
      pharmacyId: pharmacyAId,
      role: 'manager',
      name: 'Manager Bob',
    });

    const pharmacistAId = generateUuidV7();
    await db.insert(users).values({
      id: pharmacistAId,
      pharmacyId: pharmacyAId,
      name: 'Pharmacist Charlie',
      role: 'pharmacist',
      pinHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
      createdAt: now,
      updatedAt: now,
    });
    pharmacistTokenA = signUserToken({
      userId: pharmacistAId,
      pharmacyId: pharmacyAId,
      role: 'pharmacist',
      name: 'Pharmacist Charlie',
    });

    const cashierAId = generateUuidV7();
    await db.insert(users).values({
      id: cashierAId,
      pharmacyId: pharmacyAId,
      name: 'Cashier Dave',
      role: 'cashier',
      pinHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
      createdAt: now,
      updatedAt: now,
    });
    cashierTokenA = signUserToken({
      userId: cashierAId,
      pharmacyId: pharmacyAId,
      role: 'cashier',
      name: 'Cashier Dave',
    });

    const ownerBId = generateUuidV7();
    await db.insert(users).values({
      id: ownerBId,
      pharmacyId: pharmacyBId,
      name: 'Owner Eve',
      role: 'owner',
      pinHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
      createdAt: now,
      updatedAt: now,
    });
    ownerTokenB = signUserToken({
      userId: ownerBId,
      pharmacyId: pharmacyBId,
      role: 'owner',
      name: 'Owner Eve',
    });

    // 5. Create Supplier & Products in Pharmacy A
    supplierAId = generateUuidV7();
    await db.insert(suppliers).values({
      id: supplierAId,
      pharmacyId: pharmacyAId,
      name: 'PharmaDistributors Ltd',
      contactPerson: 'Ali Khan',
      phone: '03001234567',
      paymentTermsDays: 30,
      creditLimitPaisa: 50000000,
      openingBalancePaisa: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    product1Id = generateUuidV7();
    await db.insert(products).values({
      id: product1Id,
      pharmacyId: pharmacyAId,
      brandName: 'Panadol 500mg',
      genericName: 'Paracetamol',
      mrpPaisa: 3500,
      reorderLevel: 50,
      reorderQuantity: 200,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    product2Id = generateUuidV7();
    await db.insert(products).values({
      id: product2Id,
      pharmacyId: pharmacyAId,
      brandName: 'Augmentin 625mg',
      genericName: 'Amoxicillin + Clavulanate',
      mrpPaisa: 25000,
      reorderLevel: 20,
      reorderQuantity: 100,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.cleanup();
  });

  it('rejects unauthorized requests without permission', async () => {
    const resNoAuth = await app.inject({
      method: 'GET',
      url: '/api/purchase-orders',
    });
    expect(resNoAuth.statusCode).toBe(401);

    const resCashier = await app.inject({
      method: 'GET',
      url: '/api/purchase-orders',
      headers: { authorization: `Bearer ${cashierTokenA}` },
    });
    expect(resCashier.statusCode).toBe(403);
  });

  it('creates draft purchase order with lines and validates expected costs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        supplierId: supplierAId,
        branchId: branchAId,
        issueDate: '2026-11-03',
        expectedDeliveryDate: '2026-11-10',
        overReceiptPolicy: 'flag',
        notes: 'Urgent antibiotics stock order',
        lines: [
          {
            productId: product1Id,
            quantityOrdered: 100,
            expectedCostPaisa: 2800,
          },
          {
            productId: product2Id,
            quantityOrdered: 50,
            expectedCostPaisa: 19000,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.poNumber).toMatch(/^PO-/);
    expect(body.data.status).toBe('draft');
    // 100 * 2800 + 50 * 19000 = 280,000 + 950,000 = 1,230,000 paisa
    expect(body.data.totalExpectedCostPaisa).toBe(1230000);
    expect(body.data.lines).toHaveLength(2);
    expect(body.data.lines[0].quantityOrdered).toBe(100);
    expect(body.data.lines[0].quantityReceived).toBe(0);
  });

  it('enforces status transitions and role permissions (only manager or owner can approve)', async () => {
    // 1. Create a draft PO
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        supplierId: supplierAId,
        branchId: branchAId,
        issueDate: '2026-11-03',
        lines: [
          {
            productId: product1Id,
            quantityOrdered: 40,
            expectedCostPaisa: 2800,
          },
        ],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const poId = createRes.json().data.id;

    // 2. Pharmacist attempts to approve -> 403 Forbidden
    const phApproveRes = await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${poId}/approve`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
    });
    expect(phApproveRes.statusCode).toBe(403);

    // 3. Manager approves -> 200 OK
    const mgrApproveRes = await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${poId}/approve`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(mgrApproveRes.statusCode).toBe(200);
    expect(mgrApproveRes.json().data.status).toBe('approved');
    expect(mgrApproveRes.json().data.approvedBy).toBeDefined();

    // 4. Mark as sent
    const sendRes = await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${poId}/send`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(sendRes.statusCode).toBe(200);
    expect(sendRes.json().data.status).toBe('sent');

    // 5. Cancel sent PO (with 0 receipts)
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${poId}/cancel`,
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: { reason: 'Supplier out of stock' },
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().data.status).toBe('cancelled');
  });

  it('suggests purchase orders from products below reorder level', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/purchase-orders/low-stock-suggestions',
      headers: { authorization: `Bearer ${managerTokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    // product1 has 0 stock and reorderLevel 50 -> must be suggested
    const p1Suggestion = body.items.find((i: { productId: string }) => i.productId === product1Id);
    expect(p1Suggestion).toBeDefined();
    expect(p1Suggestion.currentStock).toBe(0);
    expect(p1Suggestion.reorderLevel).toBe(50);
    expect(p1Suggestion.suggestedQuantity).toBe(200); // reorderQuantity
  });

  it('handles partial receipts and updates status to partially_received then received', async () => {
    // 1. Create and approve a PO for 100 units of product1
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        supplierId: supplierAId,
        branchId: branchAId,
        issueDate: '2026-11-03',
        overReceiptPolicy: 'reject',
        lines: [
          {
            productId: product1Id,
            quantityOrdered: 100,
            expectedCostPaisa: 2800,
          },
        ],
      },
    });
    const po = createRes.json().data;
    const poLineId = po.lines[0].id;

    await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${po.id}/approve`,
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });

    // 2. First delivery: 40 units received
    const batch1Id = generateUuidV7();
    const grn1Res = await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${po.id}/receive`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        supplierInvoiceNo: 'INV-DELIVERY-01',
        receiptDate: '2026-11-03',
        lines: [
          {
            poLineId,
            productId: product1Id,
            batchNo: 'BATCH-DEL-01',
            expiryDate: '2027-12-31',
            quantity: 40,
            costPaisa: 2800,
            mrpPaisa: 3500,
            batchId: batch1Id,
          },
        ],
      },
    });

    expect(grn1Res.statusCode).toBe(200);
    const grn1Body = grn1Res.json();
    expect(grn1Body.purchaseOrder.status).toBe('partially_received');
    expect(grn1Body.purchaseOrder.lines[0].quantityReceived).toBe(40);

    // 3. Second delivery: remaining 60 units received
    const batch2Id = generateUuidV7();
    const grn2Res = await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${po.id}/receive`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        supplierInvoiceNo: 'INV-DELIVERY-02',
        receiptDate: '2026-11-04',
        lines: [
          {
            poLineId,
            productId: product1Id,
            batchNo: 'BATCH-DEL-02',
            expiryDate: '2027-12-31',
            quantity: 60,
            costPaisa: 2800,
            mrpPaisa: 3500,
            batchId: batch2Id,
          },
        ],
      },
    });

    expect(grn2Res.statusCode).toBe(200);
    const grn2Body = grn2Res.json();
    expect(grn2Body.purchaseOrder.status).toBe('received');
    expect(grn2Body.purchaseOrder.lines[0].quantityReceived).toBe(100);

    // 4. Detail view shows receiving history
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/purchase-orders/${po.id}`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json().data;
    expect(detail.receipts).toHaveLength(2);
    expect(detail.receipts[0].supplierInvoiceNo).toBe('INV-DELIVERY-01');
    expect(detail.receipts[1].supplierInvoiceNo).toBe('INV-DELIVERY-02');
  });

  it('enforces over-receipt policy: reject policy rejects excess receipt', async () => {
    // Create PO with policy 'reject'
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        supplierId: supplierAId,
        branchId: branchAId,
        issueDate: '2026-11-03',
        overReceiptPolicy: 'reject',
        lines: [
          {
            productId: product1Id,
            quantityOrdered: 50,
            expectedCostPaisa: 2800,
          },
        ],
      },
    });
    const po = createRes.json().data;
    const poLineId = po.lines[0].id;

    await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${po.id}/approve`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });

    // Attempt to receive 60 units (10 over ordered 50)
    const overRes = await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${po.id}/receive`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        supplierInvoiceNo: 'INV-OVER-REJECT',
        receiptDate: '2026-11-03',
        lines: [
          {
            poLineId,
            productId: product1Id,
            batchNo: 'BATCH-OVER-1',
            expiryDate: '2027-12-31',
            quantity: 60,
            costPaisa: 2800,
            mrpPaisa: 3500,
          },
        ],
      },
    });

    expect(overRes.statusCode).toBe(400);
    expect(overRes.json().message).toMatch(/over-receipt/i);
  });

  it('enforces over-receipt policy: flag policy allows excess receipt and flags lines', async () => {
    // Create PO with policy 'flag'
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        supplierId: supplierAId,
        branchId: branchAId,
        issueDate: '2026-11-03',
        overReceiptPolicy: 'flag',
        lines: [
          {
            productId: product1Id,
            quantityOrdered: 50,
            expectedCostPaisa: 2800,
          },
        ],
      },
    });
    const po = createRes.json().data;
    const poLineId = po.lines[0].id;

    await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${po.id}/approve`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });

    // Receive 65 units (15 over ordered 50)
    const overRes = await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${po.id}/receive`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        supplierInvoiceNo: 'INV-OVER-FLAG',
        receiptDate: '2026-11-03',
        lines: [
          {
            poLineId,
            productId: product1Id,
            batchNo: 'BATCH-FLAG-1',
            expiryDate: '2027-12-31',
            quantity: 65,
            costPaisa: 2800,
            mrpPaisa: 3500,
          },
        ],
      },
    });

    expect(overRes.statusCode).toBe(200);
    const body = overRes.json();
    expect(body.purchaseOrder.status).toBe('received');
    expect(body.purchaseOrder.lines[0].quantityReceived).toBe(65);
  });

  it('receiving a PO delivery auto-posts balanced journal entry (Dr Inventory, Cr AP)', async () => {
    const db = ctx.db;
    const accountMap = await getPharmacyAccountMap(db, pharmacyAId);
    const apAccountId = accountMap.ap;
    const invAccountId = accountMap.inventory;

    // Get baseline AP balance for supplierA
    const preLines = await db
      .select()
      .from(journalLines)
      .where(
        and(
          eq(journalLines.pharmacyId, pharmacyAId),
          eq(journalLines.accountId, apAccountId),
          eq(journalLines.partyId, supplierAId)
        )
      );
    const preAPBalance = preLines.reduce((sum, l) => sum + (l.creditPaisa - l.debitPaisa), 0);

    // Create & approve PO
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        supplierId: supplierAId,
        branchId: branchAId,
        issueDate: '2026-11-03',
        lines: [
          {
            productId: product2Id,
            quantityOrdered: 10,
            expectedCostPaisa: 19000,
          },
        ],
      },
    });
    const po = createRes.json().data;

    await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${po.id}/approve`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });

    // Receive delivery: 10 * 19,000 = 190,000 paisa
    const grnRes = await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${po.id}/receive`,
      headers: { authorization: `Bearer ${pharmacistTokenA}` },
      payload: {
        supplierInvoiceNo: 'INV-PAYABLE-POST',
        receiptDate: '2026-11-03',
        lines: [
          {
            poLineId: po.lines[0].id,
            productId: product2Id,
            batchNo: 'BATCH-AUG-01',
            expiryDate: '2028-05-31',
            quantity: 10,
            costPaisa: 19000,
            mrpPaisa: 25000,
          },
        ],
      },
    });

    expect(grnRes.statusCode).toBe(200);

    // Verify AP balance increased by exactly 190,000 paisa
    const postLines = await db
      .select()
      .from(journalLines)
      .where(
        and(
          eq(journalLines.pharmacyId, pharmacyAId),
          eq(journalLines.accountId, apAccountId),
          eq(journalLines.partyId, supplierAId)
        )
      );
    const postAPBalance = postLines.reduce((sum, l) => sum + (l.creditPaisa - l.debitPaisa), 0);
    expect(postAPBalance - preAPBalance).toBe(190000);

    // Verify inventory account was debited by 190,000 paisa
    const invLines = await db
      .select()
      .from(journalLines)
      .where(
        and(eq(journalLines.pharmacyId, pharmacyAId), eq(journalLines.accountId, invAccountId))
      );
    const invDebitTotal = invLines.reduce((sum, l) => sum + l.debitPaisa, 0);
    expect(invDebitTotal).toBeGreaterThanOrEqual(190000);
  });

  it('enforces tenant isolation: pharmacy B cannot access pharmacy A purchase orders', async () => {
    // 1. Create a PO in pharmacy A
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        supplierId: supplierAId,
        branchId: branchAId,
        issueDate: '2026-11-03',
        lines: [
          {
            productId: product1Id,
            quantityOrdered: 20,
            expectedCostPaisa: 2800,
          },
        ],
      },
    });
    const poAId = createRes.json().data.id;

    // 2. Pharmacy B owner attempts to view pharmacy A's PO -> 404 Not Found
    const viewRes = await app.inject({
      method: 'GET',
      url: `/api/purchase-orders/${poAId}`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(viewRes.statusCode).toBe(404);

    // 3. Pharmacy B owner attempts to approve pharmacy A's PO -> 404 Not Found
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/purchase-orders/${poAId}/approve`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(approveRes.statusCode).toBe(404);

    // 4. Pharmacy B list POs returns empty
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/purchase-orders',
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items).toHaveLength(0);
  });

  describe('Server Route Expiry Validation Hardening', () => {
    it('rejects raw YYYY-MM (e.g. 2026-11) through PO receiving route with 400', async () => {
      // 1. Create and approve a PO
      const poRes = await app.inject({
        method: 'POST',
        url: '/api/purchase-orders',
        headers: { authorization: `Bearer ${managerTokenA}` },
        payload: {
          supplierId: supplierAId,
          branchId: branchAId,
          issueDate: '2026-11-03',
          lines: [{ productId: product1Id, quantityOrdered: 10, expectedCostPaisa: 2800 }],
        },
      });
      const poId = poRes.json().data.id;
      const poLineId = poRes.json().data.lines[0].id;

      await app.inject({
        method: 'POST',
        url: `/api/purchase-orders/${poId}/approve`,
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });

      // 2. Attempt receiving with raw YYYY-MM -> must be rejected with 400
      const rawYmRes = await app.inject({
        method: 'POST',
        url: `/api/purchase-orders/${poId}/receive`,
        headers: { authorization: `Bearer ${pharmacistTokenA}` },
        payload: {
          supplierInvoiceNo: 'INV-RAW-YM',
          receiptDate: '2026-11-04',
          lines: [
            {
              poLineId,
              productId: product1Id,
              batchNo: 'BATCH-RAW-YM',
              expiryDate: '2026-11', // Raw month format
              quantity: 10,
              costPaisa: 2800,
              mrpPaisa: 3500,
            },
          ],
        },
      });

      expect(rawYmRes.statusCode).toBe(400);
      expect(rawYmRes.json().code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(rawYmRes.json())).toMatch(/expiry/i);
    });

    it('rejects impossible dates (e.g. 2026-02-31, 2026-04-31) with 400', async () => {
      // 1. Create and approve a PO
      const poRes = await app.inject({
        method: 'POST',
        url: '/api/purchase-orders',
        headers: { authorization: `Bearer ${managerTokenA}` },
        payload: {
          supplierId: supplierAId,
          branchId: branchAId,
          issueDate: '2026-11-03',
          lines: [{ productId: product1Id, quantityOrdered: 10, expectedCostPaisa: 2800 }],
        },
      });
      const poId = poRes.json().data.id;
      const poLineId = poRes.json().data.lines[0].id;

      await app.inject({
        method: 'POST',
        url: `/api/purchase-orders/${poId}/approve`,
        headers: { authorization: `Bearer ${ownerTokenA}` },
      });

      // 2. Attempt receiving with impossible date 2026-02-31
      const res = await app.inject({
        method: 'POST',
        url: `/api/purchase-orders/${poId}/receive`,
        headers: { authorization: `Bearer ${pharmacistTokenA}` },
        payload: {
          supplierInvoiceNo: 'INV-IMPOSSIBLE-EXP',
          receiptDate: '2026-11-04',
          lines: [
            {
              poLineId,
              productId: product1Id,
              batchNo: 'BATCH-IMPOSSIBLE',
              expiryDate: '2026-02-31',
              quantity: 10,
              costPaisa: 2800,
              mrpPaisa: 3500,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.json())).toMatch(/expiry/i);
    });
  });
});
