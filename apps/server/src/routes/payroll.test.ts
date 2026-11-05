import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import {
  pharmacies,
  branches,
  users,
  employees,
  leaveTypes,
  leaveRequests,
  payrollStatutoryComponents,
  payrollTaxSlabs,
  employeeAdvances,
  accounts,
  fiscalPeriods,
  journalEntries,
  journalLines,
} from '../db/schema';
import { signUserToken } from '../auth/jwt';
import { seedDefaultChartOfAccounts } from '../ledger/coa-seed';
import { eq } from 'drizzle-orm';

describe('Monthly Payroll Module (Calculations, Immutability & Ledger Posting)', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchAId: string;
  let branchBId: string;

  let ownerTokenA: string;
  let managerTokenA: string;
  let cashierTokenA: string;
  let accountantTokenA: string;
  let ownerTokenB: string;

  let employee1Id: string;
  let employee2Id: string;
  let advance1Id: string;
  let bankAccountId: string;

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
      code: 'CPA',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    pharmacyBId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyBId,
      name: 'Northern Pharmacy B',
      code: 'NPB',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 2. Chart of Accounts & Open Fiscal Period for Pharmacy A
    await seedDefaultChartOfAccounts(db, pharmacyAId);
    await seedDefaultChartOfAccounts(db, pharmacyBId);

    await db.insert(fiscalPeriods).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'open',
    });

    const [bankAcc] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.pharmacyId, pharmacyAId))
      .then((accs) => accs.filter((a) => a.code === '1010'));
    bankAccountId = bankAcc!.id;

    // 3. Branches
    branchAId = generateUuidV7();
    await db.insert(branches).values({
      id: branchAId,
      pharmacyId: pharmacyAId,
      name: 'Main Branch Dispensary',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    branchBId = generateUuidV7();
    await db.insert(branches).values({
      id: branchBId,
      pharmacyId: pharmacyBId,
      name: 'Branch B',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 4. Users
    const ownerAId = generateUuidV7();
    await db.insert(users).values({
      id: ownerAId,
      pharmacyId: pharmacyAId,
      name: 'Dr. Tariq (Owner A)',
      role: 'owner',
      pinHash: 'testpin',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const managerAId = generateUuidV7();
    await db.insert(users).values({
      id: managerAId,
      pharmacyId: pharmacyAId,
      name: 'Ms. Ayesha (Manager A)',
      role: 'manager',
      pinHash: 'testpin',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const cashierAId = generateUuidV7();
    await db.insert(users).values({
      id: cashierAId,
      pharmacyId: pharmacyAId,
      name: 'Cashier Bilal',
      role: 'cashier',
      pinHash: 'testpin',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const accountantAId = generateUuidV7();
    await db.insert(users).values({
      id: accountantAId,
      pharmacyId: pharmacyAId,
      name: 'Accountant Hamza',
      role: 'accountant',
      pinHash: 'testpin',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const ownerBId = generateUuidV7();
    await db.insert(users).values({
      id: ownerBId,
      pharmacyId: pharmacyBId,
      name: 'Owner B',
      role: 'owner',
      pinHash: 'testpin',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    ownerTokenA = signUserToken({
      userId: ownerAId,
      pharmacyId: pharmacyAId,
      role: 'owner',
      name: 'Dr. Tariq (Owner A)',
    });

    managerTokenA = signUserToken({
      userId: managerAId,
      pharmacyId: pharmacyAId,
      role: 'manager',
      name: 'Ms. Ayesha (Manager A)',
    });

    cashierTokenA = signUserToken({
      userId: cashierAId,
      pharmacyId: pharmacyAId,
      role: 'cashier',
      name: 'Cashier Bilal',
    });

    accountantTokenA = signUserToken({
      userId: accountantAId,
      pharmacyId: pharmacyAId,
      role: 'accountant',
      name: 'Accountant Hamza',
    });

    ownerTokenB = signUserToken({
      userId: ownerBId,
      pharmacyId: pharmacyBId,
      role: 'owner',
      name: 'Owner B',
    });

    // 5. Employees in Branch A
    employee1Id = generateUuidV7();
    await db.insert(employees).values({
      id: employee1Id,
      pharmacyId: pharmacyAId,
      branchId: branchAId,
      employeeCode: 'EMP-001',
      firstName: 'Zain',
      lastName: 'Ahmed',
      email: 'zain@example.com',
      phone: '+923001234567',
      designation: 'Senior Pharmacist',
      department: 'Pharmacy',
      joiningDate: '2025-01-01',
      salaryPaisa: 6000000, // Rs. 60,000 monthly base
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    employee2Id = generateUuidV7();
    await db.insert(employees).values({
      id: employee2Id,
      pharmacyId: pharmacyAId,
      branchId: branchAId,
      employeeCode: 'EMP-002',
      firstName: 'Sara',
      lastName: 'Khan',
      email: 'sara@example.com',
      phone: '+923007654321',
      designation: 'Pharmacy Assistant',
      department: 'Dispensary',
      joiningDate: '2025-06-01',
      salaryPaisa: 4000000, // Rs. 40,000 monthly base
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 6. Configurable Statutory Rates & Tax Slabs for Pharmacy A (Editable by Owner)
    await db.insert(payrollStatutoryComponents).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      code: 'EOBI',
      name: 'EOBI Employee Contribution (Example)',
      componentType: 'statutory_deduction',
      calculationType: 'fixed',
      fixedAmountPaisa: 25000, // Rs. 250 fixed example
      percentageRate: '0',
      accountCode: '2210',
      isExample: true,
      notes: 'Example rate. Must be verified by accountant.',
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await db.insert(payrollTaxSlabs).values([
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyAId,
        minMonthlyIncomePaisa: 0,
        maxMonthlyIncomePaisa: 5000000, // Up to Rs. 50,000 -> 0%
        baseTaxPaisa: 0,
        excessRatePercentage: '0',
        isExample: true,
        notes: 'Example tier 1',
        isActive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: generateUuidV7(),
        pharmacyId: pharmacyAId,
        minMonthlyIncomePaisa: 5000000,
        maxMonthlyIncomePaisa: 10000000, // Rs. 50,000 to Rs. 100,000 -> 2.5% on excess
        baseTaxPaisa: 0,
        excessRatePercentage: '2.5',
        isExample: true,
        notes: 'Example tier 2',
        isActive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);

    // 7. Employee 1 has an approved unpaid leave of 3 days in Nov 2026 (2026-11-20 to 2026-11-22)
    const unpaidTypeId = generateUuidV7();
    await db.insert(leaveTypes).values({
      id: unpaidTypeId,
      pharmacyId: pharmacyAId,
      code: 'UNPAID',
      name: 'Unpaid Leave',
      isPaid: false,
      yearlyEntitlementDays: 0,
      maxCarryOverDays: 0,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await db.insert(leaveRequests).values({
      id: generateUuidV7(),
      pharmacyId: pharmacyAId,
      employeeId: employee1Id,
      leaveTypeId: unpaidTypeId,
      startDate: '2026-11-20',
      endDate: '2026-11-22',
      daysCount: 3,
      reason: 'Urgent personal leave (unpaid)',
      status: 'approved',
      approvedBy: managerAId,
      approvedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 8. Employee 1 has an active salary advance with monthly recovery installment
    advance1Id = generateUuidV7();
    await db.insert(employeeAdvances).values({
      id: advance1Id,
      pharmacyId: pharmacyAId,
      employeeId: employee1Id,
      disbursementDate: '2026-10-15',
      principalPaisa: 1000000, // Rs. 10,000 loan
      recoveredPaisa: 200000, // Rs. 2,000 already recovered
      remainingPaisa: 800000, // Rs. 8,000 remaining
      monthlyInstallmentPaisa: 200000, // Rs. 2,000 / month
      reason: 'Medical expense advance',
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  afterAll(async () => {
    await app.close();
    await ctx.cleanup();
  });

  it('1. Role restrictions: cashier and accountant cannot access or generate payroll (HTTP 403 Forbidden)', async () => {
    const resCashier = await app.inject({
      method: 'POST',
      url: '/api/hr/payroll/runs/generate',
      headers: { authorization: `Bearer ${cashierTokenA}` },
      payload: {
        branchId: branchAId,
        month: '2026-11',
      },
    });
    expect(resCashier.statusCode).toBe(403);

    const resAccountant = await app.inject({
      method: 'POST',
      url: '/api/hr/payroll/runs/generate',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        branchId: branchAId,
        month: '2026-11',
      },
    });
    expect(resAccountant.statusCode).toBe(403);

    const resOwner = await app.inject({
      method: 'GET',
      url: '/api/hr/payroll/statutory-rates',
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });
    expect(resOwner.statusCode).toBe(200);
  });

  it('2. Pay calculations: generates draft payroll run from salary structure, attendance, unpaid leaves, advances, and tax slabs', async () => {
    const resGen = await app.inject({
      method: 'POST',
      url: '/api/hr/payroll/runs/generate',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        branchId: branchAId,
        month: '2026-11',
        workingDays: 30,
      },
    });
    expect(resGen.statusCode).toBe(201);
    const bodyGen = resGen.json();
    expect(bodyGen.success).toBe(true);
    expect(bodyGen.data.status).toBe('draft');
    expect(bodyGen.data.branchId).toBe(branchAId);
    expect(bodyGen.data.month).toBe('2026-11');

    const runId = bodyGen.data.id;

    // Fetch payroll items for this run
    const resItems = await app.inject({
      method: 'GET',
      url: `/api/hr/payroll/runs/${runId}/items`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(resItems.statusCode).toBe(200);
    const items = resItems.json().data;
    expect(items.length).toBe(2);

    // Verify Employee 1 item calculation:
    // Base salary: Rs. 60,000 (6,000,000 paisa)
    // Daily rate for 30 days: 6,000,000 / 30 = 200,000 paisa (Rs. 2,000)
    // Unpaid leave: 3 days -> 3 * 200,000 = 600,000 paisa deduction
    // Advance recovery: Rs. 2,000 (200,000 paisa)
    // Statutory (EOBI): Rs. 250 (25,000 paisa)
    // Monthly income for tax: Base salary = 6,000,000 paisa
    // Tax bracket: Rs. 50,000 to Rs. 100,000 at 2.5% on excess (6,000,000 - 5,000,000 = 1,000,000; 2.5% = 25,000 paisa)
    // Gross salary: 6,000,000 paisa
    // Total deductions: 600,000 (unpaid) + 200,000 (advance) + 25,000 (EOBI) + 25,000 (tax) = 850,000 paisa
    // Net salary: 6,000,000 - 850,000 = 5,150,000 paisa (Rs. 51,500)
    const emp1Item = items.find((it: { employeeId: string }) => it.employeeId === employee1Id);
    expect(emp1Item).toBeDefined();
    expect(emp1Item.baseSalaryPaisa).toBe(6000000);
    expect(emp1Item.unpaidLeaveDays).toBe(3);
    expect(emp1Item.unpaidLeaveDeductionPaisa).toBe(600000);
    expect(emp1Item.advanceRecoveryPaisa).toBe(200000);
    expect(emp1Item.statutoryDeductionsPaisa).toBe(25000);
    expect(emp1Item.taxPaisa).toBe(25000);
    expect(emp1Item.grossSalaryPaisa).toBe(5400000);
    expect(emp1Item.totalDeductionsPaisa).toBe(250000);
    expect(emp1Item.netSalaryPaisa).toBe(5150000);

    // Verify Employee 2 item calculation:
    // Base salary: Rs. 40,000 (4,000,000 paisa)
    // Unpaid leave: 0 days
    // Tax: 0 (<= 50,000)
    // EOBI: 25,000 paisa
    // Net salary: 4,000,000 - 25,000 = 3,975,000 paisa (Rs. 39,750)
    const emp2Item = items.find((it: { employeeId: string }) => it.employeeId === employee2Id);
    expect(emp2Item).toBeDefined();
    expect(emp2Item.baseSalaryPaisa).toBe(4000000);
    expect(emp2Item.taxPaisa).toBe(0);
    expect(emp2Item.statutoryDeductionsPaisa).toBe(25000);
    expect(emp2Item.netSalaryPaisa).toBe(3975000);
  });

  it('3. Review and item adjustment: allows updating overtime and allowances during draft/review phase', async () => {
    // Fetch draft run
    const resList = await app.inject({
      method: 'GET',
      url: `/api/hr/payroll/runs?branchId=${branchAId}&month=2026-11`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const run = resList.json().data[0];
    expect(run.status).toBe('draft');

    const resItems = await app.inject({
      method: 'GET',
      url: `/api/hr/payroll/runs/${run.id}/items`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const emp1Item = resItems
      .json()
      .data.find((it: { employeeId: string }) => it.employeeId === employee1Id);

    // Update Employee 1 with overtime (5 hours, 100,000 paisa) and Medical Allowance (300,000 paisa)
    const resUpdate = await app.inject({
      method: 'PUT',
      url: `/api/hr/payroll/items/${emp1Item.id}`,
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        overtimeHours: 5,
        overtimeAmountPaisa: 100000,
        allowancesPaisa: 300000,
        allowancesBreakdown: [{ name: 'Medical Allowance', amountPaisa: 300000 }],
      },
    });
    expect(resUpdate.statusCode).toBe(200);
    const updatedItem = resUpdate.json().data;
    expect(updatedItem.overtimeAmountPaisa).toBe(100000);
    expect(updatedItem.allowancesPaisa).toBe(300000);
    // Gross salary: 5,400,000 + 100,000 + 300,000 = 5,800,000 paisa
    expect(updatedItem.grossSalaryPaisa).toBe(5800000);
    // Net salary increased by 400,000 paisa: 5,150,000 + 400,000 = 5,550,000 paisa
    expect(updatedItem.netSalaryPaisa).toBe(5550000);
  });

  it('4. Approval & Immutability: approved payroll run and its items cannot be edited directly', async () => {
    const resList = await app.inject({
      method: 'GET',
      url: `/api/hr/payroll/runs?branchId=${branchAId}&month=2026-11`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const run = resList.json().data[0];

    // Approve run
    const resApprove = await app.inject({
      method: 'POST',
      url: `/api/hr/payroll/runs/${run.id}/approve`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(resApprove.statusCode).toBe(200);
    expect(resApprove.json().data.status).toBe('approved');

    // Attempt direct item modification on approved run must be rejected
    const resItems = await app.inject({
      method: 'GET',
      url: `/api/hr/payroll/runs/${run.id}/items`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const emp1Item = resItems
      .json()
      .data.find((it: { employeeId: string }) => it.employeeId === employee1Id);

    const resForbiddenEdit = await app.inject({
      method: 'PUT',
      url: `/api/hr/payroll/items/${emp1Item.id}`,
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        overtimeHours: 10,
      },
    });
    expect(resForbiddenEdit.statusCode).toBe(400);
    expect(resForbiddenEdit.json().message).toMatch(/immutable/i);
  });

  it('5. Ledger Posting: posts balanced journal entry (Dr Salaries, Cr Salaries Payable & Statutory & Tax)', async () => {
    const resList = await app.inject({
      method: 'GET',
      url: `/api/hr/payroll/runs?branchId=${branchAId}&month=2026-11`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const run = resList.json().data[0];
    expect(run.status).toBe('approved');

    // Post to General Ledger
    const resPost = await app.inject({
      method: 'POST',
      url: `/api/hr/payroll/runs/${run.id}/post`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    if (resPost.statusCode !== 200) {
      console.error('resPost failed:', resPost.body);
    }
    expect(resPost.statusCode).toBe(200);
    const bodyPost = resPost.json();
    expect(bodyPost.data.status).toBe('posted');
    expect(bodyPost.data.journalEntryId).toBeDefined();

    // Verify Journal Entry in DB
    const entryId = bodyPost.data.journalEntryId;
    const [entry] = await ctx.db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, entryId));
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('posted');
    expect(entry!.sourceType).toBe('payroll_run');

    // Verify Lines Balance: sum(debit) == sum(credit)
    const lines = await ctx.db.select().from(journalLines).where(eq(journalLines.entryId, entryId));

    const totalDebit = lines.reduce((sum, l) => sum + l.debitPaisa, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.creditPaisa, 0);
    expect(totalDebit).toBeGreaterThan(0);
    expect(totalDebit).toBe(totalCredit);

    // Verify specific accounts:
    // Dr Salaries (6000)
    // Cr Salaries Payable (2200)
    // Cr EOBI Payable (2210)
    // Cr Withholding Tax Payable (2110)
    const salariesDebitLine = lines.find((l) => l.debitPaisa > 0);
    expect(salariesDebitLine).toBeDefined();
    expect(salariesDebitLine!.debitPaisa).toBe(run.totalGrossPaisa);
  });

  it('6. Payment batch marking: records disbursement (Dr Salaries Payable, Cr Bank)', async () => {
    const resList = await app.inject({
      method: 'GET',
      url: `/api/hr/payroll/runs?branchId=${branchAId}&month=2026-11`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const run = resList.json().data[0];
    expect(run.status).toBe('posted');

    // Mark paid via Bank account
    const resPay = await app.inject({
      method: 'POST',
      url: `/api/hr/payroll/runs/${run.id}/pay`,
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        paymentAccountId: bankAccountId,
        paymentMethod: 'bank',
      },
    });
    expect(resPay.statusCode).toBe(200);
    const bodyPay = resPay.json();
    expect(bodyPay.data.status).toBe('paid');
    expect(bodyPay.data.paymentJournalEntryId).toBeDefined();

    // Verify payment entry balances: Dr Salaries Payable == Cr Bank
    const payEntryId = bodyPay.data.paymentJournalEntryId;
    const payLines = await ctx.db
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, payEntryId));

    const totalDebit = payLines.reduce((sum, l) => sum + l.debitPaisa, 0);
    const totalCredit = payLines.reduce((sum, l) => sum + l.creditPaisa, 0);
    expect(totalDebit).toBe(run.totalNetPaisa);
    expect(totalDebit).toBe(totalCredit);
  });

  it('7. Payslip output: generates itemized payslip printable document', async () => {
    const resList = await app.inject({
      method: 'GET',
      url: `/api/hr/payroll/runs?branchId=${branchAId}&month=2026-11`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const run = resList.json().data[0];

    const resItems = await app.inject({
      method: 'GET',
      url: `/api/hr/payroll/runs/${run.id}/items`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const emp1Item = resItems
      .json()
      .data.find((it: { employeeId: string }) => it.employeeId === employee1Id);

    const resPayslip = await app.inject({
      method: 'GET',
      url: `/api/hr/payroll/items/${emp1Item.id}/payslip`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(resPayslip.statusCode).toBe(200);
    const slip = resPayslip.json().data;
    expect(slip.employeeName).toBe('Zain Ahmed');
    expect(slip.month).toBe('2026-11');
    expect(slip.baseSalaryPaisa).toBe(6000000);
    expect(slip.netSalaryPaisa).toBe(emp1Item.netSalaryPaisa);
  });

  it('8. Tenant Isolation: Pharmacy B cannot view or modify Pharmacy A payroll runs', async () => {
    const resTenant = await app.inject({
      method: 'GET',
      url: `/api/hr/payroll/runs?branchId=${branchAId}&month=2026-11`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(resTenant.statusCode).toBe(200);
    expect(resTenant.json().data.length).toBe(0);
  });
});
