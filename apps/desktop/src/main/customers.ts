import type { Database as DatabaseInstance } from 'better-sqlite3';
import {
  generateUuidV7,
  assertIntegerPaisa,
  getKarachiBusinessDate,
  type CustomerReceiptCreatedPayload,
} from '@pos/shared';

export interface CustomerDbRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  cnic: string | null;
  credit_limit_paisa: number;
  balance_paisa: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CustomerReceiptInput {
  customerId: string;
  amountPaisa: number;
  method: 'cash' | 'card' | 'wallet';
  counterId?: string | null;
  cashierUserId?: string | null;
  branchId?: string | null;
  notes?: string | null;
  receiptDate?: string;
}

export function getCustomers(db: DatabaseInstance, search?: string): CustomerDbRow[] {
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    return db
      .prepare(
        `SELECT * FROM customers 
         WHERE (name LIKE ? OR phone LIKE ? OR cnic LIKE ?) AND is_active = 1 
         ORDER BY name ASC LIMIT 50`
      )
      .all(term, term, term) as CustomerDbRow[];
  }
  return db
    .prepare('SELECT * FROM customers WHERE is_active = 1 ORDER BY name ASC LIMIT 50')
    .all() as CustomerDbRow[];
}

export function getCustomerById(
  db: DatabaseInstance,
  customerId: string
): CustomerDbRow | undefined {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as
    CustomerDbRow | undefined;
}

export function recordCustomerReceipt(
  db: DatabaseInstance,
  input: CustomerReceiptInput
): { id: string; paymentNumber: string; newBalancePaisa: number } {
  assertIntegerPaisa(input.amountPaisa, 'amountPaisa');
  if (input.amountPaisa <= 0) {
    throw new Error(`Receipt amount must be positive, received ${input.amountPaisa}`);
  }

  const customer = getCustomerById(db, input.customerId);
  if (!customer) {
    throw new Error(`Customer not found with id: ${input.customerId}`);
  }
  if (!customer.is_active) {
    throw new Error(`Customer ${customer.name} is inactive`);
  }

  const now = new Date().toISOString();
  const receiptDate = input.receiptDate || getKarachiBusinessDate();
  const receiptId = generateUuidV7();
  const outboxId = generateUuidV7();

  const counterCode = 'C1';
  const paymentNumber = `RCP-${counterCode}-${Date.now().toString().slice(-6)}`;

  const executeTx = db.transaction(() => {
    // 1. Decrement customer balance
    db.prepare(
      `UPDATE customers SET balance_paisa = balance_paisa - ?, updated_at = ? WHERE id = ?`
    ).run(input.amountPaisa, now, input.customerId);

    const updatedCustomer = getCustomerById(db, input.customerId)!;

    // 2. Insert outbox event for sync
    const payload: CustomerReceiptCreatedPayload = {
      id: receiptId,
      paymentNumber,
      branchId: input.branchId || undefined,
      counterId: input.counterId || null,
      cashierUserId: input.cashierUserId || null,
      customerId: input.customerId,
      customerName: customer.name,
      amountPaisa: input.amountPaisa,
      method: input.method,
      receiptDate,
      notes: input.notes || null,
      createdAt: now,
    };

    db.prepare(
      `INSERT INTO outbox (
        id, event_id, device_seq, type, event_type, entity_id, payload, occurred_at, status, attempts, created_at, synced_at
      ) VALUES (
        ?, ?, (SELECT COALESCE(MAX(device_seq), 0) + 1 FROM outbox), 'customer_receipt.created', 'customer_receipt.created', ?, ?, ?, 'pending', 0, ?, null
      )`
    ).run(outboxId, outboxId, receiptId, JSON.stringify(payload), now, now);

    return {
      id: receiptId,
      paymentNumber,
      newBalancePaisa: updatedCustomer.balance_paisa,
    };
  });

  return executeTx();
}
