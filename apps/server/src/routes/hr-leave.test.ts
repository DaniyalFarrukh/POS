import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateUuidV7 } from '@pos/shared';
import { buildApp } from '../app';
import { createTestContext, type TestDatabaseContext } from '../db/test-helper';
import { pharmacies, branches, users, employees, leaveTypes, leaveAllocations } from '../db/schema';
import { signUserToken } from '../auth/jwt';

describe('HR Leave Management, Approvals, Attendance & Payroll', () => {
  let ctx: TestDatabaseContext;
  let app: FastifyInstance;

  let pharmacyAId: string;
  let pharmacyBId: string;
  let branchAId: string;

  let ownerTokenA: string;
  let managerTokenA: string;
  let cashierTokenA: string;
  let accountantTokenA: string;
  let ownerTokenB: string;

  let managerUserAId: string;
  let employee1Id: string;
  let employee2Id: string;
  let annualLeaveTypeId: string;
  let unpaidLeaveTypeId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    app = buildApp({ db: ctx.db, deviceRateLimitMax: 1000 });
    const db = ctx.db;
    const nowIso = new Date().toISOString();

    // 1. Tenants
    pharmacyAId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyAId,
      name: 'Central Hospital Pharmacy A',
      code: 'CHPA',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    pharmacyBId = generateUuidV7();
    await db.insert(pharmacies).values({
      id: pharmacyBId,
      name: 'North Branch Pharmacy B',
      code: 'NBPB',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 2. Branch A
    branchAId = generateUuidV7();
    await db.insert(branches).values({
      id: branchAId,
      pharmacyId: pharmacyAId,
      name: 'Main Dispensary',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 3. Users in Pharmacy A
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

    managerUserAId = generateUuidV7();
    await db.insert(users).values({
      id: managerUserAId,
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
      name: 'Bilal Cashier A',
      role: 'cashier',
      pinHash: 'testpin',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const accountantAId = generateUuidV7();
    await db.insert(users).values({
      id: accountantAId,
      pharmacyId: pharmacyAId,
      name: 'Hamza Accountant A',
      role: 'accountant',
      pinHash: 'testpin',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // User in Pharmacy B
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
      userId: managerUserAId,
      pharmacyId: pharmacyAId,
      role: 'manager',
      name: 'Ms. Ayesha (Manager A)',
    });

    cashierTokenA = signUserToken({
      userId: cashierAId,
      pharmacyId: pharmacyAId,
      role: 'cashier',
      name: 'Bilal Cashier A',
    });

    accountantTokenA = signUserToken({
      userId: accountantAId,
      pharmacyId: pharmacyAId,
      role: 'accountant',
      name: 'Hamza Accountant A',
    });

    ownerTokenB = signUserToken({
      userId: ownerBId,
      pharmacyId: pharmacyBId,
      role: 'owner',
      name: 'Owner B',
    });

    // 4. Seed Employee in Pharmacy A
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
      salaryPaisa: 6000000, // Rs. 60,000 monthly
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
      designation: 'Pharmacy Technician',
      department: 'Dispensary',
      joiningDate: '2025-06-01',
      salaryPaisa: 4500000, // Rs. 45,000 monthly
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 5. Seed Leave Types: Annual (paid, 14 days, max 5 carry-over) and Unpaid (unpaid, 0 entitlement)
    annualLeaveTypeId = generateUuidV7();
    await db.insert(leaveTypes).values({
      id: annualLeaveTypeId,
      pharmacyId: pharmacyAId,
      code: 'ANNUAL',
      name: 'Annual Paid Leave',
      description: 'Standard yearly vacation entitlement',
      isPaid: true,
      yearlyEntitlementDays: 14,
      maxCarryOverDays: 5,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    unpaidLeaveTypeId = generateUuidV7();
    await db.insert(leaveTypes).values({
      id: unpaidLeaveTypeId,
      pharmacyId: pharmacyAId,
      code: 'UNPAID',
      name: 'Unpaid Leave',
      description: 'Leave without pay - deducts from payroll',
      isPaid: false,
      yearlyEntitlementDays: 0,
      maxCarryOverDays: 0,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  afterAll(async () => {
    await app.close();
    await ctx.cleanup();
  });

  it('1. Role restriction: cashier & accountant cannot access HR leave endpoints (HTTP 403 Forbidden)', async () => {
    const resOwner = await app.inject({
      method: 'GET',
      url: '/api/hr/leave/requests',
      headers: { authorization: `Bearer ${ownerTokenA}` },
    });
    expect(resOwner.statusCode).toBe(200);

    const resCashier = await app.inject({
      method: 'GET',
      url: '/api/hr/leave/requests',
      headers: { authorization: `Bearer ${cashierTokenA}` },
    });
    expect(resCashier.statusCode).toBe(403);

    const resAccountant = await app.inject({
      method: 'POST',
      url: '/api/hr/leave/requests',
      headers: { authorization: `Bearer ${accountantTokenA}` },
      payload: {
        employeeId: employee1Id,
        leaveTypeId: annualLeaveTypeId,
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        reason: 'Family trip',
      },
    });
    expect(resAccountant.statusCode).toBe(403);
  });

  it('2. Balance math & carry-over rules: initializes yearly entitlement and enforces max carry-over cap', async () => {
    // Check initial balance for employee 1 in year 2026
    const resInit = await app.inject({
      method: 'GET',
      url: `/api/hr/leave/balances?employeeId=${employee1Id}&year=2026`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(resInit.statusCode).toBe(200);
    const bodyInit = resInit.json();
    expect(bodyInit.success).toBe(true);

    const annualBal = bodyInit.data.find(
      (b: { leaveTypeCode: string }) => b.leaveTypeCode === 'ANNUAL'
    );
    expect(annualBal).toBeDefined();
    expect(annualBal.entitledDays).toBe(14);
    expect(annualBal.carriedOverDays).toBe(0);
    expect(annualBal.usedDays).toBe(0);
    expect(annualBal.pendingDays).toBe(0);
    expect(annualBal.remainingDays).toBe(14);

    // Simulate carry-over from 2025 to 2026 where employee had 8 unused days in 2025, but maxCarryOverDays is 5
    // Seed 2025 allocation with 8 remaining
    const alloc2025Id = generateUuidV7();
    const nowIso = new Date().toISOString();
    await ctx.db.insert(leaveAllocations).values({
      id: alloc2025Id,
      pharmacyId: pharmacyAId,
      employeeId: employee2Id,
      leaveTypeId: annualLeaveTypeId,
      year: 2025,
      entitledDays: 14,
      carriedOverDays: 0,
      usedDays: 6, // 14 - 6 = 8 unused days remaining
      pendingDays: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const resCarry = await app.inject({
      method: 'POST',
      url: '/api/hr/leave/carry-over',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        fromYear: 2025,
        toYear: 2026,
        employeeId: employee2Id,
      },
    });
    expect(resCarry.statusCode).toBe(200);
    const bodyCarry = resCarry.json();
    expect(bodyCarry.success).toBe(true);
    // Should be capped at 5 days (maxCarryOverDays)
    expect(bodyCarry.data.carriedOverDays).toBe(5);

    // Verify employee 2 balance in 2026
    const resBal2 = await app.inject({
      method: 'GET',
      url: `/api/hr/leave/balances?employeeId=${employee2Id}&year=2026`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const bodyBal2 = resBal2.json();
    const annualBal2 = bodyBal2.data.find(
      (b: { leaveTypeCode: string }) => b.leaveTypeCode === 'ANNUAL'
    );
    expect(annualBal2.entitledDays).toBe(14);
    expect(annualBal2.carriedOverDays).toBe(5);
    expect(annualBal2.totalAllocatedDays).toBe(19);
    expect(annualBal2.remainingDays).toBe(19);
  });

  it('3. Overlapping leave requests: rejects request when dates overlap an existing pending/approved request', async () => {
    // Request A: 2026-11-10 to 2026-11-15 (6 days)
    const resReqA = await app.inject({
      method: 'POST',
      url: '/api/hr/leave/requests',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        employeeId: employee1Id,
        leaveTypeId: annualLeaveTypeId,
        startDate: '2026-11-10',
        endDate: '2026-11-15',
        reason: 'Annual family holiday',
      },
    });
    expect(resReqA.statusCode).toBe(201);
    const bodyReqA = resReqA.json();
    expect(bodyReqA.success).toBe(true);
    expect(bodyReqA.data.daysCount).toBe(6);
    expect(bodyReqA.data.status).toBe('pending');

    // Balance check: pendingDays should now be 6, remainingDays should be 8 (14 - 6)
    const resBal = await app.inject({
      method: 'GET',
      url: `/api/hr/leave/balances?employeeId=${employee1Id}&year=2026`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const annualBal = resBal
      .json()
      .data.find((b: { leaveTypeCode: string }) => b.leaveTypeCode === 'ANNUAL');
    expect(annualBal.pendingDays).toBe(6);
    expect(annualBal.remainingDays).toBe(8);

    // Overlapping Request B: 2026-11-12 to 2026-11-18 (overlaps Nov 12 - 15)
    const resReqB = await app.inject({
      method: 'POST',
      url: '/api/hr/leave/requests',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        employeeId: employee1Id,
        leaveTypeId: annualLeaveTypeId,
        startDate: '2026-11-12',
        endDate: '2026-11-18',
        reason: 'Overlapping request attempt',
      },
    });
    expect(resReqB.statusCode).toBe(400);
    expect(resReqB.json().message).toMatch(/overlapping/i);

    // Non-overlapping Request C: 2026-11-20 to 2026-11-22 (3 days) -> Allowed
    const resReqC = await app.inject({
      method: 'POST',
      url: '/api/hr/leave/requests',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        employeeId: employee1Id,
        leaveTypeId: annualLeaveTypeId,
        startDate: '2026-11-20',
        endDate: '2026-11-22',
        reason: 'Conference trip',
      },
    });
    expect(resReqC.statusCode).toBe(201);
  });

  it('4. Manager Approval workflow: updates allocation and marks attendance records as on_leave', async () => {
    // Fetch pending request A
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/hr/leave/requests?employeeId=${employee1Id}&status=pending`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const pendingRequests = listRes.json().data;
    const reqA = pendingRequests.find((r: { startDate: string }) => r.startDate === '2026-11-10');
    expect(reqA).toBeDefined();

    // Manager approves Request A
    const resApprove = await app.inject({
      method: 'POST',
      url: `/api/hr/leave/requests/${reqA.id}/approve`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(resApprove.statusCode).toBe(200);
    const bodyApprove = resApprove.json();
    expect(bodyApprove.data.status).toBe('approved');
    expect(bodyApprove.data.approvedBy).toBe(managerUserAId);
    expect(bodyApprove.data.approvedAt).toBeDefined();

    // Verify allocation: pendingDays reduced by 6, usedDays increased by 6
    const resBal = await app.inject({
      method: 'GET',
      url: `/api/hr/leave/balances?employeeId=${employee1Id}&year=2026`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const annualBal = resBal
      .json()
      .data.find((b: { leaveTypeCode: string }) => b.leaveTypeCode === 'ANNUAL');
    expect(annualBal.usedDays).toBe(6);
    expect(annualBal.pendingDays).toBe(3); // from Request C (3 days)
    expect(annualBal.remainingDays).toBe(5); // 14 - 6 - 3 = 5

    // Verify attendance records generated for the 6 dates (2026-11-10 to 2026-11-15)
    const attRes = await app.inject({
      method: 'GET',
      url: `/api/hr/attendance?employeeId=${employee1Id}&startDate=2026-11-10&endDate=2026-11-15`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(attRes.statusCode).toBe(200);
    const attList = attRes.json().data;
    expect(attList.length).toBe(6);
    for (const record of attList) {
      expect(record.status).toBe('on_leave');
      expect(record.leaveRequestId).toBe(reqA.id);
    }
  });

  it('5. Manager Rejection workflow: restores pending balance and records rejection reason', async () => {
    // Find pending Request C
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/hr/leave/requests?employeeId=${employee1Id}&status=pending`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const reqC = listRes
      .json()
      .data.find((r: { startDate: string }) => r.startDate === '2026-11-20');
    expect(reqC).toBeDefined();

    // Manager rejects Request C
    const resReject = await app.inject({
      method: 'POST',
      url: `/api/hr/leave/requests/${reqC.id}/reject`,
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        rejectionReason: 'Branch staff shortage during peak dates',
      },
    });
    expect(resReject.statusCode).toBe(200);
    const bodyReject = resReject.json();
    expect(bodyReject.data.status).toBe('rejected');
    expect(bodyReject.data.rejectionReason).toBe('Branch staff shortage during peak dates');

    // Balance check: pendingDays restored from 3 back to 0
    const resBal = await app.inject({
      method: 'GET',
      url: `/api/hr/leave/balances?employeeId=${employee1Id}&year=2026`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    const annualBal = resBal
      .json()
      .data.find((b: { leaveTypeCode: string }) => b.leaveTypeCode === 'ANNUAL');
    expect(annualBal.usedDays).toBe(6);
    expect(annualBal.pendingDays).toBe(0);
    expect(annualBal.remainingDays).toBe(8); // 14 - 6 = 8
  });

  it('6. Calendar View: returns comprehensive calendar representation across employees', async () => {
    const resCal = await app.inject({
      method: 'GET',
      url: `/api/hr/leave/calendar?month=2026-11`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(resCal.statusCode).toBe(200);
    const bodyCal = resCal.json();
    expect(bodyCal.success).toBe(true);
    expect(Array.isArray(bodyCal.data)).toBe(true);
    const approvedEvent = bodyCal.data.find(
      (ev: { employeeId: string; status: string }) =>
        ev.employeeId === employee1Id && ev.status === 'approved'
    );
    expect(approvedEvent).toBeDefined();
    expect(approvedEvent.startDate).toBe('2026-11-10');
    expect(approvedEvent.endDate).toBe('2026-11-15');
    expect(approvedEvent.employeeName).toBe('Zain Ahmed');
    expect(approvedEvent.leaveTypeName).toBe('Annual Paid Leave');
  });

  it('7. Payroll impact: paid leave causes zero deduction, unpaid leave deducts exact integer paisa', async () => {
    // 1. Employee 1 currently has 6 approved paid leave days in Nov 2026
    // Base salary = Rs. 60,000 (6,000,000 paisa)
    // Daily rate for 30 days = 6,000,000 / 30 = 200,000 paisa
    // Since annual leave is paid, unpaidLeaveDays = 0, deduction = 0
    const resPayroll1 = await app.inject({
      method: 'GET',
      url: `/api/hr/payroll/preview?month=2026-11&employeeId=${employee1Id}`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(resPayroll1.statusCode).toBe(200);
    const p1 = resPayroll1.json().data;
    expect(p1.baseSalaryPaisa).toBe(6000000);
    expect(p1.approvedPaidLeaveDays).toBe(6);
    expect(p1.approvedUnpaidLeaveDays).toBe(0);
    expect(p1.unpaidLeaveDeductionPaisa).toBe(0);
    expect(p1.grossSalaryPaisa).toBe(6000000);
    expect(p1.netSalaryPaisa).toBe(6000000);

    // 2. Submit and approve 3 days of UNPAID leave for Employee 1 (2026-11-25 to 2026-11-27)
    const resUnpaidReq = await app.inject({
      method: 'POST',
      url: '/api/hr/leave/requests',
      headers: { authorization: `Bearer ${managerTokenA}` },
      payload: {
        employeeId: employee1Id,
        leaveTypeId: unpaidLeaveTypeId,
        startDate: '2026-11-25',
        endDate: '2026-11-27',
        reason: 'Urgent personal work (unpaid)',
      },
    });
    expect(resUnpaidReq.statusCode).toBe(201);
    const unpaidReqId = resUnpaidReq.json().data.id;

    // Approve unpaid leave
    await app.inject({
      method: 'POST',
      url: `/api/hr/leave/requests/${unpaidReqId}/approve`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });

    // 3. Now re-check payroll preview for Nov 2026
    // Daily rate = 200,000 paisa (Rs. 2,000)
    // Unpaid days = 3 days -> deduction = 3 * 200,000 = 600,000 paisa (Rs. 6,000)
    // Net salary = 6,000,000 - 600,000 = 5,400,000 paisa (Rs. 54,000)
    const resPayroll2 = await app.inject({
      method: 'GET',
      url: `/api/hr/payroll/preview?month=2026-11&employeeId=${employee1Id}`,
      headers: { authorization: `Bearer ${managerTokenA}` },
    });
    expect(resPayroll2.statusCode).toBe(200);
    const p2 = resPayroll2.json().data;
    expect(p2.baseSalaryPaisa).toBe(6000000);
    expect(p2.approvedPaidLeaveDays).toBe(6);
    expect(p2.approvedUnpaidLeaveDays).toBe(3);
    expect(p2.dailyRatePaisa).toBe(200000);
    expect(p2.unpaidLeaveDeductionPaisa).toBe(600000);
    expect(p2.grossSalaryPaisa).toBe(6000000);
    expect(p2.netSalaryPaisa).toBe(5400000);
  });

  it('8. Tenant Isolation: Pharmacy B cannot view or approve Pharmacy A leave requests', async () => {
    // Query requests by Pharmacy B
    const resTenant = await app.inject({
      method: 'GET',
      url: '/api/hr/leave/requests',
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    expect(resTenant.statusCode).toBe(200);
    expect(resTenant.json().data.length).toBe(0);

    // Attempt by Pharmacy B to query Employee 1 balance
    const resTenantBal = await app.inject({
      method: 'GET',
      url: `/api/hr/leave/balances?employeeId=${employee1Id}&year=2026`,
      headers: { authorization: `Bearer ${ownerTokenB}` },
    });
    // Must be 404 Not Found (or empty list)
    expect(resTenantBal.statusCode).toBe(404);
  });
});
