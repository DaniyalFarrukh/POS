import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { generateUuidV7 } from '@pos/shared';
import { MIGRATIONS } from './db';
import { pullAndApply } from './sync/core/pullAndApply';
import { finalizeSale } from './finalizeSale';
import { getCustomers, getCustomerById, recordCustomerReceipt } from './customers';

describe('Desktop Customers, Credit Sales, and Topological Pull (F-H-07, F-M-07, D3)', () => {
  let db: DatabaseInstance;
  let branchId: string;
  let counterId: string;
  let cashierUserId: string;
  let taxCatId: string;
  let productId: string;
  let batchId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const m of MIGRATIONS) {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString()
      );
    }

    const now = '2026-10-26T10:00:00.000Z';
    branchId = generateUuidV7();
    counterId = generateUuidV7();
    cashierUserId = generateUuidV7();
    taxCatId = generateUuidV7();
    productId = generateUuidV7();
    batchId = generateUuidV7();

    db.prepare(
      `INSERT INTO branches (id, name, created_at, updated_at)
       VALUES (?, 'Main Branch', ?, ?)`
    ).run(branchId, now, now);

    db.prepare(
      `INSERT INTO counters (id, branch_id, name, code, last_invoice_seq, last_credit_note_seq, created_at, updated_at)
       VALUES (?, ?, 'Counter 1', 'C1', 0, 0, ?, ?)`
    ).run(counterId, branchId, now, now);

    db.prepare(
      `INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at)
       VALUES (?, 'Cashier One', 'cashier', 'hash', 1, ?, ?)`
    ).run(cashierUserId, now, now);

    db.prepare(
      `INSERT INTO tax_categories (id, name, rate_bp, is_exempt, created_at, updated_at)
       VALUES (?, 'Standard', 0, 0, ?, ?)`
    ).run(taxCatId, now, now);

    db.prepare(
      `INSERT INTO products (
        id, brand_name, generic_name, form, strength, manufacturer,
        tax_category_id, mrp_paisa, is_controlled, is_active, created_at, updated_at
      ) VALUES (?, 'Panadol', 'Paracetamol', 'tablet', '500mg', 'GSK', ?, 10000, 0, 1, ?, ?)`
    ).run(productId, taxCatId, now, now);

    db.prepare(
      `INSERT INTO batches (
        id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at
      ) VALUES (?, ?, 'B123', '2027-12-31', 6000, 10000, ?, ?)`
    ).run(batchId, productId, now, now);

    db.prepare(
      `INSERT INTO stock_movements (
        id, product_id, batch_id, branch_id, type, quantity_signed,
        reference_type, reference_id, reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'adjustment', 100, 'manual', 'init', 'Opening Stock', ?, ?)`
    ).run(generateUuidV7(), productId, batchId, branchId, now, now);
  });

  it('pulls customer changes and applies them correctly', async () => {
    const customerId = generateUuidV7();

    const pullResponse = {
      changes: [
        {
          seq: 1,
          entity: 'customer',
          entityId: customerId,
          op: 'upsert',
          data: {
            id: customerId,
            name: 'John Doe',
            phone: '03001234567',
            creditLimitPaisa: 50000,
            balancePaisa: 0,
            isActive: true,
          },
        },
      ],
      nextCursor: 1,
      hasMore: false,
    };

    await pullAndApply(
      {
        db,
        fetch: async () => new Response(JSON.stringify(pullResponse), { status: 200 }),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      },
      { serverUrl: 'http://localhost:3000', token: 'tok' }
    );

    const cust = getCustomerById(db, customerId);
    expect(cust).toBeDefined();
    expect(cust?.name).toBe('John Doe');
    expect(cust?.phone).toBe('03001234567');
    expect(cust?.credit_limit_paisa).toBe(50000);
    expect(cust?.balance_paisa).toBe(0);

    // Test search
    const results = getCustomers(db, '0300123');
    expect(results.length).toBe(1);
    expect(results[0]?.id).toBe(customerId);

    // Test soft-delete
    const deleteResponse = {
      changes: [
        {
          seq: 2,
          entity: 'customer',
          entityId: customerId,
          op: 'delete',
          data: {},
        },
      ],
      nextCursor: 2,
      hasMore: false,
    };

    await pullAndApply(
      {
        db,
        fetch: async () => new Response(JSON.stringify(deleteResponse), { status: 200 }),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      },
      { serverUrl: 'http://localhost:3000', token: 'tok' }
    );

    const deletedCust = getCustomerById(db, customerId);
    expect(deletedCust?.is_active).toBe(0);
    expect(getCustomers(db).length).toBe(0);
  });

  it('topologically sorts incoming pull changes so products precede batches regardless of seq order', async () => {
    const newProdId = generateUuidV7();
    const newBatchId = generateUuidV7();

    // Notice batch has seq: 10, product has seq: 20.
    // In naive seq sorting, batch would insert first and fail with FOREIGN KEY constraint!
    const pullResponse = {
      changes: [
        {
          seq: 10,
          entity: 'batch',
          entityId: newBatchId,
          op: 'upsert',
          data: {
            id: newBatchId,
            productId: newProdId,
            batchNo: 'TOP-001',
            expiryDate: '2028-01-01',
            costPaisa: 5000,
            mrpPaisa: 8000,
          },
        },
        {
          seq: 20,
          entity: 'product',
          entityId: newProdId,
          op: 'upsert',
          data: {
            id: newProdId,
            brandName: 'Topological Med',
            genericName: 'Order Test',
            taxCategoryId: taxCatId,
            mrpPaisa: 8000,
          },
        },
      ],
      nextCursor: 20,
      hasMore: false,
    };

    await expect(
      pullAndApply(
        {
          db,
          fetch: async () => new Response(JSON.stringify(pullResponse), { status: 200 }),
          logger: { info: () => {}, warn: () => {}, error: () => {} },
        },
        { serverUrl: 'http://localhost:3000', token: 'tok' }
      )
    ).resolves.not.toThrow();

    const batchRow = db.prepare('SELECT * FROM batches WHERE id = ?').get(newBatchId);
    expect(batchRow).toBeDefined();
  });

  it('finalizes a credit sale, updates customer balance, and writes to outbox', () => {
    const customerId = generateUuidV7();
    const now = '2026-10-26T10:00:00.000Z';
    db.prepare(
      `INSERT INTO customers (
        id, name, phone, email, address, cnic, credit_limit_paisa, balance_paisa, is_active, created_at, updated_at
      ) VALUES (?, 'Credit Customer', '03111111111', null, null, null, 100000, 10000, 1, ?, ?)`
    ).run(customerId, now, now);

    const saleResult = finalizeSale(
      {
        clientRequestId: generateUuidV7(),
        counterId,
        cashierUserId,
        customerId,
        lines: [{ productId, quantity: 2, discountPaisa: 0 }],
        payments: [{ method: 'credit', amountPaisa: 20000 }],
      },
      { db }
    );

    expect(saleResult.customerId).toBe(customerId);
    expect(saleResult.totalPaisa).toBe(20000);
    expect(saleResult.payments[0]?.method).toBe('credit');

    // Verify customer balance updated: 10,000 + 20,000 = 30,000
    const cust = getCustomerById(db, customerId);
    expect(cust?.balance_paisa).toBe(30000);

    // Verify outbox contains the credit sale with customerId
    const outboxRow = db.prepare('SELECT * FROM outbox WHERE entity_id = ?').get(saleResult.id) as {
      payload: string;
    };
    expect(outboxRow).toBeDefined();
    const parsedPayload = JSON.parse(outboxRow.payload);
    expect(parsedPayload.customerId).toBe(customerId);
    expect(parsedPayload.payments[0].method).toBe('credit');
  });

  it('rejects credit sale if customer credit limit is exceeded', () => {
    const customerId = generateUuidV7();
    const now = '2026-10-26T10:00:00.000Z';
    db.prepare(
      `INSERT INTO customers (
        id, name, phone, email, address, cnic, credit_limit_paisa, balance_paisa, is_active, created_at, updated_at
      ) VALUES (?, 'Strict Customer', '03222222222', null, null, null, 15000, 10000, 1, ?, ?)`
    ).run(customerId, now, now);

    // Attempting a 20,000 credit sale when remaining limit is 5,000 (15,000 limit - 10,000 balance)
    expect(() =>
      finalizeSale(
        {
          clientRequestId: generateUuidV7(),
          counterId,
          cashierUserId,
          customerId,
          lines: [{ productId, quantity: 2, discountPaisa: 0 }],
          payments: [{ method: 'credit', amountPaisa: 20000 }],
        },
        { db }
      )
    ).toThrow(/Credit limit exceeded/);

    // Balance remains unchanged
    const cust = getCustomerById(db, customerId);
    expect(cust?.balance_paisa).toBe(10000);
  });

  it('records customer receipt reducing balance and writing to outbox', () => {
    const customerId = generateUuidV7();
    const now = '2026-10-26T10:00:00.000Z';
    db.prepare(
      `INSERT INTO customers (
        id, name, phone, email, address, cnic, credit_limit_paisa, balance_paisa, is_active, created_at, updated_at
      ) VALUES (?, 'Receiving Customer', '03333333333', null, null, null, 50000, 30000, 1, ?, ?)`
    ).run(customerId, now, now);

    const receipt = recordCustomerReceipt(db, {
      customerId,
      amountPaisa: 12000,
      method: 'cash',
      counterId,
      cashierUserId,
      branchId,
      notes: 'Partial payment',
    });

    expect(receipt.newBalancePaisa).toBe(18000); // 30,000 - 12,000

    const updatedCust = getCustomerById(db, customerId);
    expect(updatedCust?.balance_paisa).toBe(18000);

    // Verify outbox entry
    const outboxRow = db.prepare('SELECT * FROM outbox WHERE entity_id = ?').get(receipt.id) as {
      type: string;
      payload: string;
    };
    expect(outboxRow).toBeDefined();
    expect(outboxRow.type).toBe('customer_receipt.created');
    const payload = JSON.parse(outboxRow.payload);
    expect(payload.customerId).toBe(customerId);
    expect(payload.amountPaisa).toBe(12000);
    expect(payload.method).toBe('cash');
  });
});
