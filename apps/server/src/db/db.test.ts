import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { isPostgresReachable, createTestContext, type TestDatabaseContext } from './test-helper';
import { getDatabaseUrl } from './index';
import * as fullSchema from './schema';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = path.resolve(__dirname, '../../drizzle');

describe('Server PostgreSQL Database & Migrations (Phase 3)', () => {
  let isAvailable = false;
  let ctx: TestDatabaseContext;

  beforeAll(async () => {
    isAvailable = await isPostgresReachable();
    if (!isAvailable) {
      throw new Error(
        'PostgreSQL is required for this test suite. Ensure Docker is running with "docker compose up -d".'
      );
    }
    ctx = await createTestContext();
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  it('verifies whether PostgreSQL / Docker is running', () => {
    expect(isAvailable).toBe(true);
  });

  describe('When PostgreSQL is running', () => {
    it('applies all 20 migrations cleanly on an empty database/schema', async () => {
      // Check that all 20 tables exist in this isolated schema
      const res = await ctx.client.query<{ table_name: string }>(
        `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name;
      `,
        [ctx.schemaName]
      );

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

    it('enforces UNIQUE (pharmacy_id, event_id) on processed_events to guarantee idempotency', async () => {
      const pharmacyId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Setup pharmacy
      await ctx.db.insert(pharmacies).values({
        id: pharmacyId,
        name: 'Apex Health Pharmacy',
        code: 'APEX',
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
        code: 'CITY',
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

    it('enforces UNIQUE (pharmacy_id, invoice_number) on invoices', async () => {
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
        { id: pharmacy1Id, name: 'Pharma One', code: 'P1', createdAt: now, updatedAt: now },
        { id: pharmacy2Id, name: 'Pharma Two', code: 'P2', createdAt: now, updatedAt: now },
      ]);

      await ctx.db.insert(branches).values([
        {
          id: branch1Id,
          pharmacyId: pharmacy1Id,
          name: 'Branch 1',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: branch2Id,
          pharmacyId: pharmacy2Id,
          name: 'Branch 2',
          createdAt: now,
          updatedAt: now,
        },
      ]);

      await ctx.db.insert(counters).values([
        {
          id: counter1Id,
          pharmacyId: pharmacy1Id,
          branchId: branch1Id,
          name: 'C1',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: counter2Id,
          pharmacyId: pharmacy2Id,
          branchId: branch2Id,
          name: 'C2',
          createdAt: now,
          updatedAt: now,
        },
      ]);

      await ctx.db.insert(users).values([
        {
          id: user1Id,
          pharmacyId: pharmacy1Id,
          name: 'Cashier 1',
          role: 'cashier',
          pinHash: 'hash',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: user2Id,
          pharmacyId: pharmacy2Id,
          name: 'Cashier 2',
          role: 'cashier',
          pinHash: 'hash',
          createdAt: now,
          updatedAt: now,
        },
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

    it('guarantees change_log.seq increases monotonically on successive inserts', async () => {
      const pharmacyId = crypto.randomUUID();
      const now = new Date().toISOString();

      await ctx.db.insert(pharmacies).values({
        id: pharmacyId,
        name: 'Delta Pharmacy',
        code: 'DELTA',
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

    it('F-H-01: registers all drizzle/*.sql files in _journal.json and migrates both an empty DB and a previous-version DB via drizzle migrate()', async () => {
      const sqlFiles = fs
        .readdirSync(DRIZZLE_DIR)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => f.replace(/\.sql$/, ''))
        .sort();

      const journalRaw = JSON.parse(
        fs.readFileSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')
      ) as {
        entries: {
          idx: number;
          tag: string;
          when: number;
          version: string;
          breakpoints: boolean;
        }[];
      };

      const journalTags = journalRaw.entries.map((e) => e.tag).sort();
      expect(journalTags).toEqual(sqlFiles);

      // Prepare helper that copies DRIZZLE_DIR to a temp folder with "public". rewritten to target schema
      const makeSchemaMigrationsDir = (targetSchema: string, maxIdx?: number): string => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-drizzle-mig-'));
        fs.mkdirSync(path.join(tmpDir, 'meta'), { recursive: true });
        for (const f of fs.readdirSync(DRIZZLE_DIR).filter((name) => name.endsWith('.sql'))) {
          const content = fs
            .readFileSync(path.join(DRIZZLE_DIR, f), 'utf8')
            .replaceAll('"public".', `"${targetSchema}".`);
          fs.writeFileSync(path.join(tmpDir, f), content, 'utf8');
        }
        const filteredJournal = {
          ...journalRaw,
          entries:
            maxIdx !== undefined
              ? journalRaw.entries.filter((e) => e.idx <= maxIdx)
              : journalRaw.entries,
        };
        fs.writeFileSync(
          path.join(tmpDir, 'meta', '_journal.json'),
          JSON.stringify(filteredJournal, null, 2),
          'utf8'
        );
        return tmpDir;
      };

      const client = new pg.Client({ connectionString: getDatabaseUrl() });
      await client.connect();

      const emptySchema = `test_mig_empty_${crypto.randomUUID().replace(/-/g, '_')}`;
      const prevSchema = `test_mig_prev_${crypto.randomUUID().replace(/-/g, '_')}`;
      let emptyDir = '';
      let prevDir20 = '';
      let prevDirAll = '';

      try {
        // (a) Empty database schema -> full migrate()
        await client.query(`CREATE SCHEMA "${emptySchema}";`);
        await client.query(`SET search_path TO "${emptySchema}";`);
        emptyDir = makeSchemaMigrationsDir(emptySchema);
        const emptyDb = drizzle(client, { schema: fullSchema });
        await migrate(emptyDb, { migrationsFolder: emptyDir, migrationsSchema: emptySchema });

        const emptyTables = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
          [emptySchema]
        );
        const emptyTableNames = emptyTables.rows.map((r) => r.table_name);
        expect(emptyTableNames).toContain('user_notifications');
        expect(emptyTableNames).toContain('audit_logs');

        // (b) Previous-version database schema (up to idx 20) -> then upgrade to full journal
        await client.query(`CREATE SCHEMA "${prevSchema}";`);
        await client.query(`SET search_path TO "${prevSchema}";`);
        prevDir20 = makeSchemaMigrationsDir(prevSchema, 20);
        const prevDb = drizzle(client, { schema: fullSchema });
        await migrate(prevDb, { migrationsFolder: prevDir20, migrationsSchema: prevSchema });

        const beforeUpgrade = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
          [prevSchema]
        );
        expect(beforeUpgrade.rows.map((r) => r.table_name)).not.toContain('user_notifications');

        prevDirAll = makeSchemaMigrationsDir(prevSchema);
        await migrate(prevDb, { migrationsFolder: prevDirAll, migrationsSchema: prevSchema });

        const afterUpgrade = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
          [prevSchema]
        );
        const afterTableNames = afterUpgrade.rows.map((r) => r.table_name);
        expect(afterTableNames).toContain('user_notifications');
        expect(afterTableNames).toContain('audit_logs');
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS "${emptySchema}" CASCADE;`);
        await client.query(`DROP SCHEMA IF EXISTS "${prevSchema}" CASCADE;`);
        await client.end();
        if (emptyDir) fs.rmSync(emptyDir, { recursive: true, force: true });
        if (prevDir20) fs.rmSync(prevDir20, { recursive: true, force: true });
        if (prevDirAll) fs.rmSync(prevDirAll, { recursive: true, force: true });
      }
    });
  });
});
