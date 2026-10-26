import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  isPostgresReachable,
  createTestContext,
  type TestDatabaseContext,
} from './test-helper';
import {
  pharmacies,
  branches,
  counters,
  users,
  invoices,
  processedEvents,
  changeLog,
} from './schema';
import crypto from 'node:crypto';

describe('Server PostgreSQL Database & Migrations (Phase 3)', () => {
  let isAvailable = false;
  let ctx: TestDatabaseContext | null = null;

  beforeAll(async () => {
    isAvailable = await isPostgresReachable();
    if (isAvailable) {
      ctx = await createTestContext();
    }
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  it('verifies whether PostgreSQL / Docker is running', () => {
    if (!isAvailable) {
      console.warn(
        '\n[NOTICE] Docker / PostgreSQL is not currently running. ' +
          'To execute live tests against PostgreSQL 16, start Docker Desktop and run: ' +
          '"docker compose up -d" in Windows PowerShell.\n'
      );
    }
    expect(typeof isAvailable).toBe('boolean');
  });

  describe('When PostgreSQL is running', () => {
    it('applies all 20 migrations cleanly on an empty database/schema', async (context) => {
      if (!isAvailable || !ctx) {
        context.skip();
        return;
      }

      // Check that all 20 tables exist in this isolated schema
      const res = await ctx.client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name;
      `, [ctx.schemaName]);

      const tableNames = res.rows.map((r) => r.table_name);
      expect(tableNames).toContain('pharmacies');
      expect(tableNames).toContain('branches');
      expect(tableNames).toContain('counters');
      expect(tableNames).toContain('devices');
      expect(tableNames).toContain('device_registration_codes');
      expect(tableNames).toContain('users');
      expect(tableNames).toContain('tax_categories');
      expect(tableNames).toContain('products');
      expect(tableNames).toContain('suppliers');
      expect(tableNames).toContain('batches');
      expect(tableNames).toContain('stock_movements');
      expect(tableNames).toContain('invoices');
      expect(tableNames).toContain('invoice_lines');
      expect(tableNames).toContain('payments');
      expect(tableNames).toContain('credit_notes');
      expect(tableNames).toContain('credit_note_lines');
      expect(tableNames).toContain('processed_events');
      expect(tableNames).toContain('rejected_events');
      expect(tableNames).toContain('stock_alerts');
      expect(tableNames).toContain('change_log');
      expect(tableNames.length).toBeGreaterThanOrEqual(20);
    });

    it('enforces UNIQUE (pharmacy_id, event_id) on processed_events to guarantee idempotency', async (context) => {
      if (!isAvailable || !ctx) {
        context.skip();
        return;
      }

      const pharmacyId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Setup pharmacy
      await ctx.db.insert(pharmacies).values({
        id: pharmacyId,
        name: 'Apex Health Pharmacy',
        createdAt: now,
        updatedAt: now,
      });

      // First insert must succeed
      await ctx.db.insert(processedEvents).values({
        pharmacyId,
        eventId,
        processedAt: now,
      });

      // Second duplicate insert for the SAME pharmacy must reject
      await expect(
        ctx.db.insert(processedEvents).values({
          pharmacyId,
          eventId,
          processedAt: new Date().toISOString(),
        })
      ).rejects.toThrow();

      // However, another pharmacy can process the same eventId without collision
      const pharmacy2Id = crypto.randomUUID();
      await ctx.db.insert(pharmacies).values({
        id: pharmacy2Id,
        name: 'City Care Pharmacy',
        createdAt: now,
        updatedAt: now,
      });

      await expect(
        ctx.db.insert(processedEvents).values({
          pharmacyId: pharmacy2Id,
          eventId,
          processedAt: new Date().toISOString(),
        })
      ).resolves.not.toThrow();
    });

    it('enforces UNIQUE (pharmacy_id, invoice_number) on invoices', async (context) => {
      if (!isAvailable || !ctx) {
        context.skip();
        return;
      }

      const pharmacy1Id = crypto.randomUUID();
      const pharmacy2Id = crypto.randomUUID();
      const branch1Id = crypto.randomUUID();
      const branch2Id = crypto.randomUUID();
      const counter1Id = crypto.randomUUID();
      const counter2Id = crypto.randomUUID();
      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();
      const now = new Date().toISOString();

      // Create two pharmacies, branches, counters, and users
      await ctx.db.insert(pharmacies).values([
        { id: pharmacy1Id, name: 'Pharma One', createdAt: now, updatedAt: now },
        { id: pharmacy2Id, name: 'Pharma Two', createdAt: now, updatedAt: now },
      ]);

      await ctx.db.insert(branches).values([
        { id: branch1Id, pharmacyId: pharmacy1Id, name: 'Branch 1', createdAt: now, updatedAt: now },
        { id: branch2Id, pharmacyId: pharmacy2Id, name: 'Branch 2', createdAt: now, updatedAt: now },
      ]);

      await ctx.db.insert(counters).values([
        { id: counter1Id, pharmacyId: pharmacy1Id, branchId: branch1Id, name: 'C1', createdAt: now, updatedAt: now },
        { id: counter2Id, pharmacyId: pharmacy2Id, branchId: branch2Id, name: 'C2', createdAt: now, updatedAt: now },
      ]);

      await ctx.db.insert(users).values([
        { id: user1Id, pharmacyId: pharmacy1Id, name: 'Cashier 1', role: 'cashier', pinHash: 'hash', createdAt: now, updatedAt: now },
        { id: user2Id, pharmacyId: pharmacy2Id, name: 'Cashier 2', role: 'cashier', pinHash: 'hash', createdAt: now, updatedAt: now },
      ]);

      const duplicateInvoiceNumber = 'INV-C1-000001';

      // Insert first invoice for Pharmacy 1
      await ctx.db.insert(invoices).values({
        id: crypto.randomUUID(),
        pharmacyId: pharmacy1Id,
        counterId: counter1Id,
        cashierUserId: user1Id,
        invoiceNumber: duplicateInvoiceNumber,
        clientRequestId: crypto.randomUUID(),
        status: 'finalized',
        subtotalPaisa: 10000,
        discountPaisa: 0,
        taxPaisa: 0,
        totalPaisa: 10000,
        createdAt: now,
      });

      // Attempting duplicate invoice number for the SAME pharmacy must reject
      await expect(
        ctx.db.insert(invoices).values({
          id: crypto.randomUUID(),
          pharmacyId: pharmacy1Id,
          counterId: counter1Id,
          cashierUserId: user1Id,
          invoiceNumber: duplicateInvoiceNumber,
          clientRequestId: crypto.randomUUID(),
          status: 'finalized',
          subtotalPaisa: 20000,
          discountPaisa: 0,
          taxPaisa: 0,
          totalPaisa: 20000,
          createdAt: now,
        })
      ).rejects.toThrow();

      // But Pharmacy 2 can use the SAME invoice number (multi-tenant tenant isolation)
      await expect(
        ctx.db.insert(invoices).values({
          id: crypto.randomUUID(),
          pharmacyId: pharmacy2Id,
          counterId: counter2Id,
          cashierUserId: user2Id,
          invoiceNumber: duplicateInvoiceNumber,
          clientRequestId: crypto.randomUUID(),
          status: 'finalized',
          subtotalPaisa: 15000,
          discountPaisa: 0,
          taxPaisa: 0,
          totalPaisa: 15000,
          createdAt: now,
        })
      ).resolves.not.toThrow();
    });

    it('guarantees change_log.seq increases monotonically on successive inserts', async (context) => {
      if (!isAvailable || !ctx) {
        context.skip();
        return;
      }

      const pharmacyId = crypto.randomUUID();
      const now = new Date().toISOString();

      await ctx.db.insert(pharmacies).values({
        id: pharmacyId,
        name: 'Delta Pharmacy',
        createdAt: now,
        updatedAt: now,
      });

      const entry1 = await ctx.db
        .insert(changeLog)
        .values({
          pharmacyId,
          entity: 'product',
          entityId: crypto.randomUUID(),
          op: 'upsert',
          data: { name: 'Aspirin' },
          createdAt: now,
        })
        .returning({ seq: changeLog.seq });

      const entry2 = await ctx.db
        .insert(changeLog)
        .values({
          pharmacyId,
          entity: 'product',
          entityId: crypto.randomUUID(),
          op: 'upsert',
          data: { name: 'Paracetamol' },
          createdAt: now,
        })
        .returning({ seq: changeLog.seq });

      const entry3 = await ctx.db
        .insert(changeLog)
        .values({
          pharmacyId,
          entity: 'product',
          entityId: crypto.randomUUID(),
          op: 'upsert',
          data: { name: 'Brufen' },
          createdAt: now,
        })
        .returning({ seq: changeLog.seq });

      const seq1 = entry1[0]!.seq;
      const seq2 = entry2[0]!.seq;
      const seq3 = entry3[0]!.seq;

      expect(typeof seq1).toBe('number');
      expect(typeof seq2).toBe('number');
      expect(typeof seq3).toBe('number');

      expect(seq2).toBeGreaterThan(seq1);
      expect(seq3).toBeGreaterThan(seq2);
    });
  });
});
