import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateUuidV7 } from '@pos/shared';
import {
  isPostgresReachable,
  createTestContext,
  type TestDatabaseContext,
} from '../db/test-helper';
import {
  pharmacies,
  branches,
  users,
  employees,
  accounts,
  journalLines,
  payrollRuns,
  payrollItems,
} from '../db/schema';
import { seedDefaultChartOfAccounts } from './coa-seed';
import { postPayrollRunToLedger } from './payroll-posting';
import { buildApp } from '../app';
import { signUserToken } from '../auth/jwt';
import { eq, and } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

describe('F-H-03: Payroll Posting & Employee Advance Disbursement Accounting', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  beforeAll(async () => {
    const reachable = await isPostgresReachable();
    if (!reachable) {
      throw new Error('PostgreSQL must be running for ledger tests.');
    }
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (ctx) {
      await ctx.cleanup();
    }
  });

  it('F-H-03: advances endpoint posts disbursement journal entry and payroll posting recovers it to 0 net balance', async () => {
    const pharmacyId = generateUuidV7();
    const branchId = generateUuidV7();
    const userId = generateUuidV7();
    const now = new Date().toISOString();

    await ctx.db.insert(pharmacies).values({
      id: pharmacyId,
      name: 'Payroll Test Pharmacy',
      code: `PAY-${Date.now().toString().slice(-4)}`,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(branches).values({
      id: branchId,
      pharmacyId,
      name: 'Main Branch',
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(users).values({
      id: userId,
      pharmacyId,
      name: 'Owner User',
      role: 'owner',
      pinHash: 'hash',
      createdAt: now,
      updatedAt: now,
    });

    await seedDefaultChartOfAccounts(ctx.db, pharmacyId);

    const employeeId = generateUuidV7();
    await ctx.db.insert(employees).values({
      id: employeeId,
      pharmacyId,
      branchId,
      employeeCode: 'EMP-001',
      firstName: 'Ahmed',
      lastName: 'Ali',
      designation: 'Pharmacist',
      department: 'Pharmacy',
      baseSalaryPaisa: 10_000_000,
      joiningDate: '2026-01-01',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    const token = signUserToken({
      userId,
      pharmacyId,
      role: 'owner',
      name: 'Owner User',
    });

    // 1. Disburse an employee salary advance of 10,000 PKR (1,000,000 paisa)
    const advRes = await app.inject({
      method: 'POST',
      url: '/api/hr/payroll/advances',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        employeeId,
        disbursementDate: '2026-11-01',
        principalPaisa: 1_000_000,
        monthlyInstallmentPaisa: 1_000_000,
        reason: 'Emergency advance',
      },
    });

    expect(advRes.statusCode).toBe(201);
    const advBody = advRes.json<{ success: boolean; data: { id: string } }>();
    expect(advBody.success).toBe(true);
    const advanceId = advBody.data.id;

    // Check that a disbursement journal entry was posted: Dr 2300 / Cr 1000
    const [advAcc] = await ctx.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.pharmacyId, pharmacyId), eq(accounts.code, '2300')));
    expect(advAcc).toBeDefined();

    const advDebits = await ctx.db
      .select()
      .from(journalLines)
      .where(and(eq(journalLines.pharmacyId, pharmacyId), eq(journalLines.accountId, advAcc!.id)));
    expect(advDebits.length).toBeGreaterThanOrEqual(1);
    const disbursementLine = advDebits.find((l) => l.debitPaisa === 1_000_000);
    expect(disbursementLine).toBeDefined();
    expect(disbursementLine?.partyType).toBe('employee');
    expect(disbursementLine?.partyId).toBe(employeeId);

    // 2. Create and approve a payroll run with advance recovery of 1,000,000 paisa
    const runId = generateUuidV7();
    const itemId = generateUuidV7();
    await ctx.db.insert(payrollRuns).values({
      id: runId,
      pharmacyId,
      branchId,
      runNumber: 'PR-202611-001',
      month: '2026-11',
      periodStartDate: '2026-11-01',
      periodEndDate: '2026-11-30',
      totalGrossPaisa: 10_000_000,
      totalNetPaisa: 9_000_000,
      totalDeductionsPaisa: 1_000_000,
      totalAdvancesRecoveredPaisa: 1_000_000,
      totalTaxPaisa: 0,
      totalStatutoryPaisa: 0,
      employeeCount: 1,
      status: 'approved',
      approvedBy: userId,
      approvedAt: now,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(payrollItems).values({
      id: itemId,
      pharmacyId,
      payrollRunId: runId,
      employeeId,
      employeeCode: 'EMP-001',
      employeeName: 'Ahmed Ali',
      designation: 'Pharmacist',
      baseSalaryPaisa: 10_000_000,
      grossSalaryPaisa: 10_000_000,
      advanceId,
      advanceRecoveryPaisa: 1_000_000,
      taxPaisa: 0,
      totalDeductionsPaisa: 1_000_000,
      netSalaryPaisa: 9_000_000,
      paymentStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    });

    // 3. Post payroll run to ledger - should succeed even without pre-existing fiscal period row
    const postRes = await postPayrollRunToLedger(ctx.db, pharmacyId, runId, userId);
    expect(postRes.journalEntryId).toBeTruthy();

    // 4. Verify account 2300: debit 1,000,000, credit 1,000,000, net balance = 0
    const advLines = await ctx.db
      .select()
      .from(journalLines)
      .where(and(eq(journalLines.pharmacyId, pharmacyId), eq(journalLines.accountId, advAcc!.id)));

    const sumDebits = advLines.reduce((s, l) => s + l.debitPaisa, 0);
    const sumCredits = advLines.reduce((s, l) => s + l.creditPaisa, 0);
    expect(sumDebits).toBe(1_000_000);
    expect(sumCredits).toBe(1_000_000);
    expect(sumDebits - sumCredits).toBe(0);
  });
});
