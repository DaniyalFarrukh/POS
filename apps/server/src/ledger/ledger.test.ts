import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { eq, and } from 'drizzle-orm';
import { generateUuidV7 } from '@pos/shared';
import {
  isPostgresReachable,
  createTestContext,
  type TestDatabaseContext,
} from '../db/test-helper';
import { getDatabaseUrl } from '../db';
import * as schema from '../db/schema';
import {
  pharmacies,
  branches,
  users,
  accounts,
  journalEntries,
  changeLog,
} from '../db/schema';
import { DEFAULT_CHART_OF_ACCOUNTS, seedDefaultChartOfAccounts } from './coa-seed';
import { seedChartOfAccountsForAllPharmacies } from '../scripts/seed-coa';
import {
  postJournalEntry,
  reverseJournalEntry,
  closePeriod,
  reopenPeriod,
} from './service';
import { trialBalance, accountLedger } from './queries';
import { drizzle } from 'drizzle-orm/node-postgres';

const { Pool } = pg;

// Deterministic PRNG (Mulberry32) for reproducible property-based tests
function createPrng(seed: number) {
  let state = seed >>> 0;
  return {
    nextFloat(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    nextInt(min: number, max: number): number {
      return Math.floor(this.nextFloat() * (max - min + 1)) + min;
    },
    pick<T>(arr: readonly T[]): T {
      return arr[this.nextInt(0, arr.length - 1)]!;
    },
  };
}

describe('Ledger Core Suite (ERP Spec Phase 7)', () => {
  let ctx: TestDatabaseContext;

  beforeAll(async () => {
    const reachable = await isPostgresReachable();
    if (!reachable) {
      throw new Error('PostgreSQL must be running for ledger tests.');
    }
    ctx = await createTestContext();
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  async function createTenantFixture(codeSuffix: string) {
    const now = new Date().toISOString();
    const pharmacyId = generateUuidV7();
    const branch1Id = generateUuidV7();
    const branch2Id = generateUuidV7();
    const ownerId = generateUuidV7();
    const accountantId = generateUuidV7();

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: `Ledger Pharmacy ${codeSuffix}`,
      code: `LP_${codeSuffix}`,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(branches).values([
      {
        id: branch1Id,
        pharmacyId,
        name: 'Branch One',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: branch2Id,
        pharmacyId,
        name: 'Branch Two',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await ctx.db.insert(users).values([
      {
        id: ownerId,
        pharmacyId,
        name: `Owner ${codeSuffix}`,
        role: 'owner',
        pinHash: 'dummy_hash',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: accountantId,
        pharmacyId,
        name: `Accountant ${codeSuffix}`,
        role: 'accountant',
        pinHash: 'dummy_hash',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await seedDefaultChartOfAccounts(ctx.db, pharmacyId);

    const coa = await ctx.db
      .select()
      .from(accounts)
      .where(eq(accounts.pharmacyId, pharmacyId));

    const byCode = new Map(coa.map((a) => [a.code, a]));

    return {
      pharmacyId,
      branch1Id,
      branch2Id,
      ownerId,
      accountantId,
      coa,
      byCode,
    };
  }

  // =========================================================================
  // 1. Default Chart of Accounts Seed & Idempotency
  // =========================================================================
  describe('Default Chart of Accounts Seeding', () => {
    it('seeds all 33 default accounts from docs/ERP_SPEC.md and is idempotent on repeat runs', async () => {
      const tenant = await createTenantFixture('COA');

      expect(DEFAULT_CHART_OF_ACCOUNTS.length).toBe(33);
      expect(tenant.coa.length).toBe(33);

      // Verify specific required accounts and types from ERP_SPEC.md
      expect(tenant.byCode.get('1000')?.name).toBe('Cash in Hand');
      expect(tenant.byCode.get('1000')?.type).toBe('asset');
      expect(tenant.byCode.get('1200')?.name).toBe('Inventory');
      expect(tenant.byCode.get('2000')?.name).toBe('Accounts Payable');
      expect(tenant.byCode.get('2000')?.type).toBe('liability');
      expect(tenant.byCode.get('3000')?.name).toBe('Owner Capital');
      expect(tenant.byCode.get('3000')?.type).toBe('equity');
      expect(tenant.byCode.get('4000')?.name).toBe('Sales');
      expect(tenant.byCode.get('4000')?.type).toBe('revenue');
      expect(tenant.byCode.get('4090')?.name).toBe('Sales Returns and Discounts');
      expect(tenant.byCode.get('4090')?.type).toBe('revenue');
      expect(tenant.byCode.get('5000')?.name).toBe('Cost of Goods Sold');
      expect(tenant.byCode.get('5000')?.type).toBe('expense');
      expect(tenant.byCode.get('6900')?.name).toBe('Miscellaneous');
      expect(tenant.byCode.get('6900')?.type).toBe('expense');

      // Run seed again — must be idempotent and not duplicate or change account IDs
      await seedDefaultChartOfAccounts(ctx.db, tenant.pharmacyId);
      const afterSecondSeed = await ctx.db
        .select()
        .from(accounts)
        .where(eq(accounts.pharmacyId, tenant.pharmacyId));

      expect(afterSecondSeed.length).toBe(33);
      for (const acc of tenant.coa) {
        const matching = afterSecondSeed.find((a) => a.code === acc.code);
        expect(matching?.id).toBe(acc.id);
      }

      // Also verify seedChartOfAccountsForAllPharmacies script works on existing pharmacies without COA
      const barePharmacyId = generateUuidV7();
      const now = new Date().toISOString();
      await ctx.db.insert(pharmacies).values({
        id: barePharmacyId,
        name: 'Bare Existing Pharmacy',
        code: 'BARE_EXIST',
        createdAt: now,
        updatedAt: now,
      });

      const scriptResults = await seedChartOfAccountsForAllPharmacies(ctx.db);
      const bareResult = scriptResults.find((r) => r.pharmacyId === barePharmacyId);
      expect(bareResult?.accountCount).toBe(33);
    });
  });

  // =========================================================================
  // 2. Unbalanced Entries & Line Constraint Rejections (Service + DB Trigger)
  // =========================================================================
  describe('Balance Enforcement & Database Constraint Triggers', () => {
    it('rejects unbalanced entries in postJournalEntry', async () => {
      const tenant = await createTenantFixture('UNBAL_SVC');
      const cashId = tenant.byCode.get('1000')!.id;
      const salesId = tenant.byCode.get('4000')!.id;

      await expect(
        ctx.db.transaction((tx) =>
          postJournalEntry(tx, {
            pharmacyId: tenant.pharmacyId,
            entryDate: '2026-11-03',
            memo: 'Unbalanced sale',
            createdBy: tenant.ownerId,
            lines: [
              { accountId: cashId, debitPaisa: 10000, creditPaisa: 0 },
              { accountId: salesId, debitPaisa: 0, creditPaisa: 9500 },
            ],
          })
        )
      ).rejects.toThrow(/unbalanced|balance/i);
    });

    it('rejects entries with fewer than 2 lines or invalid debit/credit XOR in service and DB', async () => {
      const tenant = await createTenantFixture('XOR');
      const cashId = tenant.byCode.get('1000')!.id;
      const salesId = tenant.byCode.get('4000')!.id;

      // Both debit and credit > 0 on same line
      await expect(
        ctx.db.transaction((tx) =>
          postJournalEntry(tx, {
            pharmacyId: tenant.pharmacyId,
            entryDate: '2026-11-03',
            lines: [
              { accountId: cashId, debitPaisa: 5000, creditPaisa: 5000 },
              { accountId: salesId, debitPaisa: 5000, creditPaisa: 5000 },
            ],
          })
        )
      ).rejects.toThrow();

      // Zero amount line
      await expect(
        ctx.db.transaction((tx) =>
          postJournalEntry(tx, {
            pharmacyId: tenant.pharmacyId,
            entryDate: '2026-11-03',
            lines: [
              { accountId: cashId, debitPaisa: 0, creditPaisa: 0 },
              { accountId: salesId, debitPaisa: 0, creditPaisa: 0 },
            ],
          })
        )
      ).rejects.toThrow();
    });

    it('rejects unbalanced entries directly at the PostgreSQL database commit level via constraint trigger', async () => {
      const tenant = await createTenantFixture('UNBAL_DB');
      const cashId = tenant.byCode.get('1000')!.id;
      const salesId = tenant.byCode.get('4000')!.id;
      const entryId = generateUuidV7();
      const now = new Date().toISOString();

      // Attempt raw SQL bypass inside a transaction; COMMIT must fail due to DEFERRABLE constraint trigger
      await ctx.client.query('BEGIN');
      let commitError: Error | null = null;
      try {
        await ctx.client.query(
          `INSERT INTO "${ctx.schemaName}"."journal_entries"
           ("id", "pharmacy_id", "entry_no", "entry_date", "memo", "status", "created_at")
           VALUES ($1, $2, 999, '2026-11-03', 'Direct SQL unbalanced', 'posted', $3)`,
          [entryId, tenant.pharmacyId, now]
        );
        await ctx.client.query(
          `INSERT INTO "${ctx.schemaName}"."journal_lines"
           ("id", "entry_id", "pharmacy_id", "account_id", "debit_paisa", "credit_paisa")
           VALUES ($1, $2, $3, $4, 15000, 0), ($5, $2, $3, $6, 0, 12000)`,
          [generateUuidV7(), entryId, tenant.pharmacyId, cashId, generateUuidV7(), salesId]
        );
        await ctx.client.query('COMMIT');
      } catch (err) {
        commitError = err as Error;
        await ctx.client.query('ROLLBACK');
      }

      expect(commitError).not.toBeNull();
      expect(commitError?.message).toMatch(/unbalanced journal entry/i);

      // Verify entry was rolled back
      const remaining = await ctx.db
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.id, entryId));
      expect(remaining.length).toBe(0);
    });

    it('rejects a journal entry with 0 lines at database commit level via constraint trigger', async () => {
      const tenant = await createTenantFixture('EMPTY_DB');
      const entryId = generateUuidV7();
      const now = new Date().toISOString();

      await ctx.client.query('BEGIN');
      let commitError: Error | null = null;
      try {
        await ctx.client.query(
          `INSERT INTO "${ctx.schemaName}"."journal_entries"
           ("id", "pharmacy_id", "entry_no", "entry_date", "memo", "status", "created_at")
           VALUES ($1, $2, 998, '2026-11-03', 'Empty entry', 'posted', $3)`,
          [entryId, tenant.pharmacyId, now]
        );
        await ctx.client.query('COMMIT');
      } catch (err) {
        commitError = err as Error;
        await ctx.client.query('ROLLBACK');
      }

      expect(commitError).not.toBeNull();
      expect(commitError?.message).toMatch(/at least 2 lines/i);
    });

    it('rejects inactive accounts when posting a journal entry', async () => {
      const tenant = await createTenantFixture('INACTIVE_ACC');
      const cashId = tenant.byCode.get('1000')!.id;
      const miscId = tenant.byCode.get('6900')!.id;

      // Deactivate 6900
      await ctx.db
        .update(accounts)
        .set({ isActive: false })
        .where(eq(accounts.id, miscId));

      await expect(
        ctx.db.transaction((tx) =>
          postJournalEntry(tx, {
            pharmacyId: tenant.pharmacyId,
            entryDate: '2026-11-03',
            lines: [
              { accountId: miscId, debitPaisa: 5000, creditPaisa: 0 },
              { accountId: cashId, debitPaisa: 0, creditPaisa: 5000 },
            ],
          })
        )
      ).rejects.toThrow(/inactive/i);
    });

    it('enforces idempotency via UNIQUE (pharmacy_id, source_type, source_id) for auto-posted entries', async () => {
      const tenant = await createTenantFixture('IDEMPOTENT');
      const cashId = tenant.byCode.get('1000')!.id;
      const salesId = tenant.byCode.get('4000')!.id;
      const sourceId = generateUuidV7();

      const first = await ctx.db.transaction((tx) =>
        postJournalEntry(tx, {
          pharmacyId: tenant.pharmacyId,
          entryDate: '2026-11-03',
          sourceType: 'invoice.created',
          sourceId,
          memo: 'Auto-posted sale',
          lines: [
            { accountId: cashId, debitPaisa: 25000, creditPaisa: 0 },
            { accountId: salesId, debitPaisa: 0, creditPaisa: 25000 },
          ],
        })
      );

      // Calling postJournalEntry again with the same (pharmacyId, sourceType, sourceId) returns the same entry without creating a second one
      const second = await ctx.db.transaction((tx) =>
        postJournalEntry(tx, {
          pharmacyId: tenant.pharmacyId,
          entryDate: '2026-11-03',
          sourceType: 'invoice.created',
          sourceId,
          memo: 'Auto-posted sale replay',
          lines: [
            { accountId: cashId, debitPaisa: 25000, creditPaisa: 0 },
            { accountId: salesId, debitPaisa: 0, creditPaisa: 25000 },
          ],
        })
      );

      expect(second.id).toBe(first.id);
      expect(second.entryNo).toBe(first.entryNo);

      // Direct DB insert of duplicate (pharmacy_id, source_type, source_id) must fail unique constraint
      await expect(
        ctx.client.query(
          `INSERT INTO "${ctx.schemaName}"."journal_entries"
           ("id", "pharmacy_id", "entry_no", "entry_date", "source_type", "source_id", "status", "created_at")
           VALUES ($1, $2, 999, '2026-11-03', 'invoice.created', $3, 'posted', $4)`,
          [generateUuidV7(), tenant.pharmacyId, sourceId, new Date().toISOString()]
        )
      ).rejects.toThrow(/uq_journal_entries_pharmacy_source|unique/i);
    });
  });

  // =========================================================================
  // 3. Database-Level Immutability (Rejects UPDATE and DELETE)
  // =========================================================================
  describe('Database-Level Immutability Triggers', () => {
    it('rejects UPDATE and DELETE on journal_entries and journal_lines at the database level', async () => {
      const tenant = await createTenantFixture('IMMUTABLE');
      const cashId = tenant.byCode.get('1000')!.id;
      const salesId = tenant.byCode.get('4000')!.id;

      const entry = await ctx.db.transaction((tx) =>
        postJournalEntry(tx, {
          pharmacyId: tenant.pharmacyId,
          entryDate: '2026-11-03',
          memo: 'Original immutable entry',
          lines: [
            { accountId: cashId, debitPaisa: 10000, creditPaisa: 0 },
            { accountId: salesId, debitPaisa: 0, creditPaisa: 10000 },
          ],
        })
      );

      // 1. UPDATE journal_entries (including trying to set status = 'reversed') must fail
      await expect(
        ctx.client.query(
          `UPDATE "${ctx.schemaName}"."journal_entries" SET "status" = 'reversed' WHERE "id" = $1`,
          [entry.id]
        )
      ).rejects.toThrow(/immutable/i);

      await expect(
        ctx.db
          .update(journalEntries)
          .set({ memo: 'Tampered memo' })
          .where(eq(journalEntries.id, entry.id))
      ).rejects.toThrow();

      // 2. DELETE journal_entries must fail
      await expect(
        ctx.client.query(
          `DELETE FROM "${ctx.schemaName}"."journal_entries" WHERE "id" = $1`,
          [entry.id]
        )
      ).rejects.toThrow(/immutable/i);

      // 3. UPDATE journal_lines must fail
      const firstLineId = entry.lines[0]!.id;
      await expect(
        ctx.client.query(
          `UPDATE "${ctx.schemaName}"."journal_lines" SET "debit_paisa" = 20000 WHERE "id" = $1`,
          [firstLineId]
        )
      ).rejects.toThrow(/immutable/i);

      // 4. DELETE journal_lines must fail
      await expect(
        ctx.client.query(
          `DELETE FROM "${ctx.schemaName}"."journal_lines" WHERE "id" = $1`,
          [firstLineId]
        )
      ).rejects.toThrow(/immutable/i);
    });
  });

  // =========================================================================
  // 4. Reversals (Status Change via Inserting Reversing Entry, Nets to Zero)
  // =========================================================================
  describe('Reversing Entries', () => {
    it('reverses an entry by inserting a reversing entry without updating the original, and nets trialBalance and accountLedger to zero', async () => {
      const tenant = await createTenantFixture('REVERSE');
      const cashId = tenant.byCode.get('1000')!.id;
      const salesId = tenant.byCode.get('4000')!.id;

      const original = await ctx.db.transaction((tx) =>
        postJournalEntry(tx, {
          pharmacyId: tenant.pharmacyId,
          entryDate: '2026-11-03',
          memo: 'Entry to be reversed',
          createdBy: tenant.ownerId,
          lines: [
            {
              accountId: cashId,
              debitPaisa: 45000,
              creditPaisa: 0,
              branchId: tenant.branch1Id,
              memo: 'Cash leg',
            },
            {
              accountId: salesId,
              debitPaisa: 0,
              creditPaisa: 45000,
              branchId: tenant.branch1Id,
              memo: 'Sales leg',
            },
          ],
        })
      );

      expect(original.entryNo).toBe(1);

      const reversing = await ctx.db.transaction((tx) =>
        reverseJournalEntry(tx, original.id, 'Incorrect cashier entry', {
          pharmacyId: tenant.pharmacyId,
          reversalDate: '2026-11-04',
          createdBy: tenant.ownerId,
        })
      );

      expect(reversing.entryNo).toBe(2);
      expect(reversing.reversesEntryId).toBe(original.id);
      expect(reversing.memo).toContain('Incorrect cashier entry');
      expect(reversing.lines.length).toBe(2);

      // Swapped debits and credits
      const revCashLine = reversing.lines.find((l) => l.accountId === cashId)!;
      const revSalesLine = reversing.lines.find((l) => l.accountId === salesId)!;
      expect(revCashLine.debitPaisa).toBe(0);
      expect(revCashLine.creditPaisa).toBe(45000);
      expect(revSalesLine.debitPaisa).toBe(45000);
      expect(revSalesLine.creditPaisa).toBe(0);

      // Double reversal of the same original entry must be rejected
      await expect(
        ctx.db.transaction((tx) =>
          reverseJournalEntry(tx, original.id, 'Second reversal attempt', {
            pharmacyId: tenant.pharmacyId,
          })
        )
      ).rejects.toThrow(/already reversed/i);

      // Trial balance across the date range must net to 0 for every account
      const tb = await trialBalance(ctx.db, tenant.pharmacyId, '2026-11-01', '2026-11-30');
      expect(tb.totalDebitPaisa).toBe(90000);
      expect(tb.totalCreditPaisa).toBe(90000);
      expect(tb.isBalanced).toBe(true);
      for (const row of tb.rows) {
        expect(row.netBalancePaisa).toBe(0);
      }

      // Account ledger for Cash must have closing balance = 0
      const cashLedger = await accountLedger(
        ctx.db,
        cashId,
        '2026-11-01',
        '2026-11-30',
        tenant.pharmacyId
      );
      expect(cashLedger.openingBalancePaisa).toBe(0);
      expect(cashLedger.lines.length).toBe(2);
      expect(cashLedger.lines[0]!.runningBalancePaisa).toBe(45000);
      expect(cashLedger.lines[1]!.runningBalancePaisa).toBe(0);
      expect(cashLedger.closingBalancePaisa).toBe(0);
    });
  });

  // =========================================================================
  // 5. Fiscal Period Close & Reopen (Owner Only, DB Trigger, Audit Logged)
  // =========================================================================
  describe('Fiscal Period Close & Reopen', () => {
    it('rejects posting into a closed period (service & DB trigger), enforces owner-only close/reopen, and writes audit logs', async () => {
      const tenant = await createTenantFixture('PERIOD');
      const cashId = tenant.byCode.get('1000')!.id;
      const salesId = tenant.byCode.get('4000')!.id;

      // 1. Non-owner (accountant) cannot close period
      await expect(
        ctx.db.transaction((tx) =>
          closePeriod(tx, {
            pharmacyId: tenant.pharmacyId,
            startDate: '2026-10-01',
            endDate: '2026-10-31',
            actorUserId: tenant.accountantId,
            actorRole: 'accountant',
            reason: 'Month end close',
          })
        )
      ).rejects.toThrow(/owner/i);

      // 2. Owner closes October 2026
      const closedPeriod = await ctx.db.transaction((tx) =>
        closePeriod(tx, {
          pharmacyId: tenant.pharmacyId,
          startDate: '2026-10-01',
          endDate: '2026-10-31',
          actorUserId: tenant.ownerId,
          actorRole: 'owner',
          reason: 'October 2026 finalized',
        })
      );

      expect(closedPeriod.status).toBe('closed');

      // Verify audit log written in change_log
      const closeLogs = await ctx.db
        .select()
        .from(changeLog)
        .where(
          and(
            eq(changeLog.pharmacyId, tenant.pharmacyId),
            eq(changeLog.entity, 'fiscal_period'),
            eq(changeLog.entityId, closedPeriod.id)
          )
        );
      expect(closeLogs.length).toBe(1);
      expect((closeLogs[0]!.data as Record<string, unknown>).status).toBe('closed');
      expect((closeLogs[0]!.data as Record<string, unknown>).action).toBe('close');

      // 3. Posting into closed period (2026-10-15) fails via service
      await expect(
        ctx.db.transaction((tx) =>
          postJournalEntry(tx, {
            pharmacyId: tenant.pharmacyId,
            entryDate: '2026-10-15',
            memo: 'Backdated entry in closed period',
            lines: [
              { accountId: cashId, debitPaisa: 1000, creditPaisa: 0 },
              { accountId: salesId, debitPaisa: 0, creditPaisa: 1000 },
            ],
          })
        )
      ).rejects.toThrow(/closed/i);

      // 4. Posting into closed period directly via SQL also fails via DB trigger
      await expect(
        ctx.client.query(
          `INSERT INTO "${ctx.schemaName}"."journal_entries"
           ("id", "pharmacy_id", "entry_no", "entry_date", "memo", "status", "created_at")
           VALUES ($1, $2, 500, '2026-10-20', 'Direct SQL into closed period', 'posted', $3)`,
          [generateUuidV7(), tenant.pharmacyId, new Date().toISOString()]
        )
      ).rejects.toThrow(/closed fiscal period/i);

      // 5. Posting into open date (2026-11-01) succeeds
      const novEntry = await ctx.db.transaction((tx) =>
        postJournalEntry(tx, {
          pharmacyId: tenant.pharmacyId,
          entryDate: '2026-11-01',
          memo: 'November entry',
          lines: [
            { accountId: cashId, debitPaisa: 5000, creditPaisa: 0 },
            { accountId: salesId, debitPaisa: 0, creditPaisa: 5000 },
          ],
        })
      );
      expect(novEntry.entryNo).toBe(1);

      // 6. Non-owner cannot reopen period
      await expect(
        ctx.db.transaction((tx) =>
          reopenPeriod(tx, {
            pharmacyId: tenant.pharmacyId,
            periodId: closedPeriod.id,
            actorUserId: tenant.accountantId,
            actorRole: 'accountant',
            reason: 'Adjustment needed',
          })
        )
      ).rejects.toThrow(/owner/i);

      // 7. Owner reopens October 2026
      const reopened = await ctx.db.transaction((tx) =>
        reopenPeriod(tx, {
          pharmacyId: tenant.pharmacyId,
          periodId: closedPeriod.id,
          actorUserId: tenant.ownerId,
          actorRole: 'owner',
          reason: 'Audit adjustment approved by owner',
        })
      );
      expect(reopened.status).toBe('open');

      // Audit log now has 2 entries (close + reopen)
      const allPeriodLogs = await ctx.db
        .select()
        .from(changeLog)
        .where(
          and(
            eq(changeLog.pharmacyId, tenant.pharmacyId),
            eq(changeLog.entity, 'fiscal_period'),
            eq(changeLog.entityId, closedPeriod.id)
          )
        );
      expect(allPeriodLogs.length).toBe(2);

      // 8. Posting into October 2026 now succeeds
      const octEntry = await ctx.db.transaction((tx) =>
        postJournalEntry(tx, {
          pharmacyId: tenant.pharmacyId,
          entryDate: '2026-10-15',
          memo: 'Approved October adjustment',
          lines: [
            { accountId: cashId, debitPaisa: 3000, creditPaisa: 0 },
            { accountId: salesId, debitPaisa: 0, creditPaisa: 3000 },
          ],
        })
      );
      expect(octEntry.entryNo).toBe(2);
    });
  });

  // =========================================================================
  // 6. Concurrent Posting -> Unique, Gapless entry_no per Pharmacy
  // =========================================================================
  describe('Concurrency & Gapless Sequential entry_no', () => {
    it('assigns unique, gapless entry_no (1..N) under concurrent transactions across a connection pool', async () => {
      const tenantA = await createTenantFixture('CONC_A');
      const tenantB = await createTenantFixture('CONC_B');

      const pool = new Pool({
        connectionString: getDatabaseUrl(),
        max: 10,
      });

      // Set search_path on every pool connection so it targets our isolated test schema
      pool.on('connect', (client) => {
        client.query(`SET search_path TO "${ctx.schemaName}", public;`);
      });

      const poolDb = drizzle(pool, { schema });

      try {
        const cashA = tenantA.byCode.get('1000')!.id;
        const salesA = tenantA.byCode.get('4000')!.id;
        const cashB = tenantB.byCode.get('1000')!.id;
        const salesB = tenantB.byCode.get('4000')!.id;

        const CONCURRENT_COUNT = 25;

        const tasksA = Array.from({ length: CONCURRENT_COUNT }, (_, idx) =>
          poolDb.transaction((tx) =>
            postJournalEntry(tx, {
              pharmacyId: tenantA.pharmacyId,
              entryDate: '2026-11-03',
              memo: `Concurrent A #${idx + 1}`,
              lines: [
                { accountId: cashA, debitPaisa: (idx + 1) * 100, creditPaisa: 0 },
                { accountId: salesA, debitPaisa: 0, creditPaisa: (idx + 1) * 100 },
              ],
            })
          )
        );

        const tasksB = Array.from({ length: 10 }, (_, idx) =>
          poolDb.transaction((tx) =>
            postJournalEntry(tx, {
              pharmacyId: tenantB.pharmacyId,
              entryDate: '2026-11-03',
              memo: `Concurrent B #${idx + 1}`,
              lines: [
                { accountId: cashB, debitPaisa: (idx + 1) * 200, creditPaisa: 0 },
                { accountId: salesB, debitPaisa: 0, creditPaisa: (idx + 1) * 200 },
              ],
            })
          )
        );

        const [resultsA, resultsB] = await Promise.all([
          Promise.all(tasksA),
          Promise.all(tasksB),
        ]);

        const entryNosA = resultsA.map((e) => e.entryNo).sort((a, b) => a - b);
        const expectedA = Array.from({ length: CONCURRENT_COUNT }, (_, i) => i + 1);
        expect(entryNosA).toEqual(expectedA);

        const entryNosB = resultsB.map((e) => e.entryNo).sort((a, b) => a - b);
        const expectedB = Array.from({ length: 10 }, (_, i) => i + 1);
        expect(entryNosB).toEqual(expectedB);
      } finally {
        await pool.end();
      }
    });
  });

  // =========================================================================
  // 7. Property-Based Test: Random Balanced Entries & Reversals -> Zero-Sum Trial Balance
  // =========================================================================
  describe('Property-Based Accounting Invariants', () => {
    it('guarantees that 100+ randomized multi-line balanced journal entries and reversals always produce a zero-sum trial balance and balanced accounting equation', async () => {
      const tenant = await createTenantFixture('PROP');
      const prng = createPrng(20261103);

      const activeAccounts = tenant.coa;
      const branchesList = [tenant.branch1Id, tenant.branch2Id, null];
      const dates = [
        '2026-11-01',
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
        '2026-11-05',
      ];

      const postedEntryIds: string[] = [];
      const reversedOriginalIds = new Set<string>();

      const TOTAL_ITERATIONS = 120;

      for (let i = 0; i < TOTAL_ITERATIONS; i++) {
        // 20% chance to reverse a previously posted un-reversed entry
        if (postedEntryIds.length > 5 && prng.nextFloat() < 0.2) {
          const candidates = postedEntryIds.filter((id) => !reversedOriginalIds.has(id));
          if (candidates.length > 0) {
            const targetId = prng.pick(candidates);
            reversedOriginalIds.add(targetId);
            await ctx.db.transaction((tx) =>
              reverseJournalEntry(tx, targetId, `Random reversal #${i}`, {
                pharmacyId: tenant.pharmacyId,
                reversalDate: prng.pick(dates),
                createdBy: tenant.ownerId,
              })
            );
            continue;
          }
        }

        // Generate 2 to 6 random debit lines and 1 to 4 random credit lines that sum to the exact same total
        const numDebits = prng.nextInt(1, 4);
        const numCredits = prng.nextInt(1, 4);
        const branchId = prng.pick(branchesList);

        const debitAmounts: number[] = [];
        let totalPaisa = 0;
        for (let d = 0; d < numDebits; d++) {
          const amt = prng.nextInt(100, 500_000);
          debitAmounts.push(amt);
          totalPaisa += amt;
        }

        const creditAmounts: number[] = [];
        let remainingCredit = totalPaisa;
        for (let c = 0; c < numCredits - 1; c++) {
          const maxForLine = Math.max(1, Math.floor(remainingCredit / 2));
          const amt = prng.nextInt(1, maxForLine);
          creditAmounts.push(amt);
          remainingCredit -= amt;
        }
        creditAmounts.push(remainingCredit);

        const lines = [
          ...debitAmounts.map((amt) => ({
            accountId: prng.pick(activeAccounts).id,
            debitPaisa: amt,
            creditPaisa: 0,
            branchId,
          })),
          ...creditAmounts.map((amt) => ({
            accountId: prng.pick(activeAccounts).id,
            debitPaisa: 0,
            creditPaisa: amt,
            branchId,
          })),
        ];

        const entry = await ctx.db.transaction((tx) =>
          postJournalEntry(tx, {
            pharmacyId: tenant.pharmacyId,
            entryDate: prng.pick(dates),
            memo: `Prop entry #${i + 1}`,
            createdBy: tenant.ownerId,
            lines,
          })
        );
        postedEntryIds.push(entry.id);
      }

      // 1. Full Trial Balance must balance to 0 difference
      const fullTb = await trialBalance(ctx.db, tenant.pharmacyId, '2026-11-01', '2026-11-30');
      expect(fullTb.totalDebitPaisa).toBeGreaterThan(0);
      expect(fullTb.totalDebitPaisa).toBe(fullTb.totalCreditPaisa);
      expect(fullTb.isBalanced).toBe(true);

      const sumNetSigned = fullTb.rows.reduce(
        (acc, r) => acc + (r.totalDebitPaisa - r.totalCreditPaisa),
        0
      );
      expect(sumNetSigned).toBe(0);

      // 2. Accounting Equation Check:
      // Assets (debit - credit) = Liabilities (credit - debit) + Equity (credit - debit) + Revenue (credit - debit) - Expense (debit - credit)
      let assetsNet = 0;
      let liabilitiesNet = 0;
      let equityNet = 0;
      let revenueNet = 0;
      let expenseNet = 0;

      for (const row of fullTb.rows) {
        if (row.type === 'asset') {
          assetsNet += row.totalDebitPaisa - row.totalCreditPaisa;
        } else if (row.type === 'liability') {
          liabilitiesNet += row.totalCreditPaisa - row.totalDebitPaisa;
        } else if (row.type === 'equity') {
          equityNet += row.totalCreditPaisa - row.totalDebitPaisa;
        } else if (row.type === 'revenue') {
          revenueNet += row.totalCreditPaisa - row.totalDebitPaisa;
        } else if (row.type === 'expense') {
          expenseNet += row.totalDebitPaisa - row.totalCreditPaisa;
        }
      }

      const currentPeriodProfit = revenueNet - expenseNet;
      expect(assetsNet).toBe(liabilitiesNet + equityNet + currentPeriodProfit);

      // 3. Branch-filtered Trial Balance also balances because every entry's lines shared a branchId
      for (const bId of [tenant.branch1Id, tenant.branch2Id]) {
        const branchTb = await trialBalance(
          ctx.db,
          tenant.pharmacyId,
          '2026-11-01',
          '2026-11-30',
          bId
        );
        expect(branchTb.totalDebitPaisa).toBe(branchTb.totalCreditPaisa);
        expect(branchTb.isBalanced).toBe(true);
      }

      // 4. Sub-date range Trial Balance also balances
      const subDateTb = await trialBalance(
        ctx.db,
        tenant.pharmacyId,
        '2026-11-01',
        '2026-11-02'
      );
      expect(subDateTb.totalDebitPaisa).toBe(subDateTb.totalCreditPaisa);

      const afterSubDateLedger = await accountLedger(
        ctx.db,
        tenant.byCode.get('1000')!.id,
        '2026-11-03',
        '2026-11-05',
        tenant.pharmacyId
      );
      const cashRowNov1To2 = subDateTb.rows.find((r) => r.code === '1000');
      const expectedOpening = cashRowNov1To2 ? cashRowNov1To2.netBalancePaisa : 0;
      expect(afterSubDateLedger.openingBalancePaisa).toBe(expectedOpening);
    });
  });

  // =========================================================================
  // 8. Service-Level Tenant Isolation
  // =========================================================================
  describe('Service-Level Tenant Isolation', () => {
    it('rejects cross-tenant accounts, branches, entries, and periods across all ledger functions', async () => {
      const tenant1 = await createTenantFixture('ISO_1');
      const tenant2 = await createTenantFixture('ISO_2');

      const cash1 = tenant1.byCode.get('1000')!.id;
      const sales1 = tenant1.byCode.get('4000')!.id;
      const sales2 = tenant2.byCode.get('4000')!.id;

      // 1. Cross-tenant account in postJournalEntry -> rejected
      await expect(
        ctx.db.transaction((tx) =>
          postJournalEntry(tx, {
            pharmacyId: tenant1.pharmacyId,
            entryDate: '2026-11-03',
            lines: [
              { accountId: cash1, debitPaisa: 1000, creditPaisa: 0 },
              { accountId: sales2, debitPaisa: 0, creditPaisa: 1000 }, // belongs to tenant2!
            ],
          })
        )
      ).rejects.toThrow(/account.*not found|another pharmacy/i);

      // 2. Cross-tenant branch in postJournalEntry -> rejected
      await expect(
        ctx.db.transaction((tx) =>
          postJournalEntry(tx, {
            pharmacyId: tenant1.pharmacyId,
            entryDate: '2026-11-03',
            lines: [
              {
                accountId: cash1,
                debitPaisa: 1000,
                creditPaisa: 0,
                branchId: tenant2.branch1Id, // belongs to tenant2!
              },
              { accountId: sales1, debitPaisa: 0, creditPaisa: 1000 },
            ],
          })
        )
      ).rejects.toThrow(/branch.*not found|another pharmacy/i);

      // 3. Cross-tenant reverseJournalEntry -> rejected
      const entry1 = await ctx.db.transaction((tx) =>
        postJournalEntry(tx, {
          pharmacyId: tenant1.pharmacyId,
          entryDate: '2026-11-03',
          lines: [
            { accountId: cash1, debitPaisa: 2000, creditPaisa: 0 },
            { accountId: sales1, debitPaisa: 0, creditPaisa: 2000 },
          ],
        })
      );

      await expect(
        ctx.db.transaction((tx) =>
          reverseJournalEntry(tx, entry1.id, 'Cross-tenant hijack attempt', {
            pharmacyId: tenant2.pharmacyId,
          })
        )
      ).rejects.toThrow(/not found/i);

      // 4. Cross-tenant accountLedger -> rejected
      await expect(
        accountLedger(ctx.db, cash1, '2026-11-01', '2026-11-30', tenant2.pharmacyId)
      ).rejects.toThrow(/not found/i);

      // 5. Cross-tenant reopenPeriod -> rejected
      const p1 = await ctx.db.transaction((tx) =>
        closePeriod(tx, {
          pharmacyId: tenant1.pharmacyId,
          startDate: '2026-09-01',
          endDate: '2026-09-30',
          actorUserId: tenant1.ownerId,
          actorRole: 'owner',
        })
      );

      await expect(
        ctx.db.transaction((tx) =>
          reopenPeriod(tx, {
            pharmacyId: tenant2.pharmacyId,
            periodId: p1.id,
            actorUserId: tenant2.ownerId,
            actorRole: 'owner',
            reason: 'Cross-tenant reopen attempt',
          })
        )
      ).rejects.toThrow(/not found/i);
    });
  });
});

