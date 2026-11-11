import type { FastifyPluginAsync } from 'fastify';
import { eq, and, sql, desc, lte, gte } from 'drizzle-orm';
import {
  generateUuidV7,
  calculateLeaveDays,
  calculateProgressiveTax,
  calculateStatutoryComponentDeduction,
  computePayrollItemTotals,
  roundHalfUp,
  CreateStatutoryComponentSchema,
  UpdateStatutoryComponentSchema,
  CreateTaxSlabSchema,
  CreateEmployeeAdvanceSchema,
  GeneratePayrollRunSchema,
  UpdatePayrollItemSchema,
  PayPayrollRunSchema,
  CreateAdjustmentRunSchema,
} from '@pos/shared';
import {
  pharmacies,
  branches,
  employees,
  leaveTypes,
  leaveRequests,
  payrollStatutoryComponents,
  payrollTaxSlabs,
  employeeAdvances,
  payrollRuns,
  payrollItems,
  accounts,
} from '../db/schema';
import { getDb } from '../db';
import { requirePermission } from '../auth/user-auth';
import { postPayrollRunToLedger, postPayrollPaymentBatch } from '../ledger/payroll-posting';
import { postJournalEntry } from '../ledger/service';
import { toKarachiBusinessDate } from '../ledger/posting-engine';

export const payrollRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. GET /api/hr/payroll/statutory-rates
  fastify.get(
    '/payroll/statutory-rates',
    { preHandler: [requirePermission('hr.payroll.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();

      const rates = await db
        .select()
        .from(payrollStatutoryComponents)
        .where(eq(payrollStatutoryComponents.pharmacyId, pharmacyId))
        .orderBy(payrollStatutoryComponents.code);

      return reply.send({ success: true, data: rates });
    }
  );

  // 2. POST /api/hr/payroll/statutory-rates
  fastify.post(
    '/payroll/statutory-rates',
    { preHandler: [requirePermission('hr.payroll.manage')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = CreateStatutoryComponentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid statutory component',
        });
      }

      const input = parsed.data;
      const nowIso = new Date().toISOString();
      const id = generateUuidV7();

      const [created] = await db
        .insert(payrollStatutoryComponents)
        .values({
          id,
          pharmacyId,
          code: input.code,
          name: input.name,
          componentType: input.componentType,
          calculationType: input.calculationType,
          fixedAmountPaisa: input.fixedAmountPaisa,
          percentageRate: input.percentageRate,
          accountCode: input.accountCode,
          notes:
            input.notes ||
            'Configured rate. Must be reviewed and verified by a licensed accountant before use.',
          isExample: input.isExample,
          isActive: input.isActive,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .returning();

      return reply.status(201).send({ success: true, data: created });
    }
  );

  // 3. PUT /api/hr/payroll/statutory-rates/:id
  fastify.put<{ Params: { id: string } }>(
    '/payroll/statutory-rates/:id',
    { preHandler: [requirePermission('hr.payroll.manage')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      const parsed = UpdateStatutoryComponentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid payload',
        });
      }

      const nowIso = new Date().toISOString();
      const [updated] = await db
        .update(payrollStatutoryComponents)
        .set({
          ...parsed.data,
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(payrollStatutoryComponents.id, id),
            eq(payrollStatutoryComponents.pharmacyId, pharmacyId)
          )
        )
        .returning();

      if (!updated) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Statutory component not found',
        });
      }

      return reply.send({ success: true, data: updated });
    }
  );

  // 4. GET /api/hr/payroll/tax-slabs
  fastify.get(
    '/payroll/tax-slabs',
    { preHandler: [requirePermission('hr.payroll.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();

      const slabs = await db
        .select()
        .from(payrollTaxSlabs)
        .where(eq(payrollTaxSlabs.pharmacyId, pharmacyId))
        .orderBy(payrollTaxSlabs.minMonthlyIncomePaisa);

      return reply.send({ success: true, data: slabs });
    }
  );

  // 5. POST /api/hr/payroll/tax-slabs
  fastify.post(
    '/payroll/tax-slabs',
    { preHandler: [requirePermission('hr.payroll.manage')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = CreateTaxSlabSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid tax slab',
        });
      }

      const input = parsed.data;
      const nowIso = new Date().toISOString();
      const id = generateUuidV7();

      const [created] = await db
        .insert(payrollTaxSlabs)
        .values({
          id,
          pharmacyId,
          minMonthlyIncomePaisa: input.minMonthlyIncomePaisa,
          maxMonthlyIncomePaisa: input.maxMonthlyIncomePaisa || null,
          baseTaxPaisa: input.baseTaxPaisa,
          excessRatePercentage: input.excessRatePercentage,
          notes:
            input.notes ||
            'Configured slab. Must be reviewed and verified by a licensed accountant before use.',
          isExample: input.isExample,
          isActive: input.isActive,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .returning();

      return reply.status(201).send({ success: true, data: created });
    }
  );

  // 6. GET /api/hr/payroll/advances
  fastify.get(
    '/payroll/advances',
    { preHandler: [requirePermission('hr.payroll.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const query = request.query as { employeeId?: string; status?: string };

      const conditions = [eq(employeeAdvances.pharmacyId, pharmacyId)];
      if (query.employeeId) {
        conditions.push(eq(employeeAdvances.employeeId, query.employeeId));
      }
      if (query.status) {
        conditions.push(
          eq(employeeAdvances.status, query.status as 'active' | 'recovered' | 'written_off')
        );
      }

      const advances = await db
        .select({
          id: employeeAdvances.id,
          pharmacyId: employeeAdvances.pharmacyId,
          employeeId: employeeAdvances.employeeId,
          employeeName: sql<string>`concat(${employees.firstName}, ' ', ${employees.lastName})`,
          employeeCode: employees.employeeCode,
          disbursementDate: employeeAdvances.disbursementDate,
          principalPaisa: employeeAdvances.principalPaisa,
          recoveredPaisa: employeeAdvances.recoveredPaisa,
          remainingPaisa: employeeAdvances.remainingPaisa,
          monthlyInstallmentPaisa: employeeAdvances.monthlyInstallmentPaisa,
          reason: employeeAdvances.reason,
          status: employeeAdvances.status,
          createdAt: employeeAdvances.createdAt,
        })
        .from(employeeAdvances)
        .innerJoin(employees, eq(employeeAdvances.employeeId, employees.id))
        .where(and(...conditions))
        .orderBy(desc(employeeAdvances.createdAt));

      return reply.send({ success: true, data: advances });
    }
  );

  // 7. POST /api/hr/payroll/advances
  fastify.post(
    '/payroll/advances',
    { preHandler: [requirePermission('hr.payroll.manage')] },
    async (request, reply) => {
      const { pharmacyId, userId } = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = CreateEmployeeAdvanceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid advance request',
        });
      }

      const input = parsed.data;

      return await db.transaction(async (tx) => {
        // Verify employee
        const [emp] = await tx
          .select()
          .from(employees)
          .where(and(eq(employees.id, input.employeeId), eq(employees.pharmacyId, pharmacyId)));

        if (!emp) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: 'Employee not found',
          });
        }

        // Resolve accounts: Dr 2300 Other Payables, Cr Cash (1000) or Bank (1010)
        const pharmacyAccounts = await tx
          .select()
          .from(accounts)
          .where(eq(accounts.pharmacyId, pharmacyId));

        const advAcc = pharmacyAccounts.find((a) => a.code === '2300');
        if (!advAcc) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Account 2300 (Other Payables / Advances) not found in chart of accounts',
          });
        }

        const paymentAcc = input.paymentAccountId
          ? pharmacyAccounts.find((a) => a.id === input.paymentAccountId)
          : pharmacyAccounts.find((a) => a.code === '1000') ||
            pharmacyAccounts.find((a) => a.code === '1010');

        if (!paymentAcc) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Payment account (1000 Cash or 1010 Bank) not found',
          });
        }

        const nowIso = new Date().toISOString();
        const id = generateUuidV7();

        const [created] = await tx
          .insert(employeeAdvances)
          .values({
            id,
            pharmacyId,
            employeeId: input.employeeId,
            disbursementDate: input.disbursementDate,
            principalPaisa: input.principalPaisa,
            recoveredPaisa: 0,
            remainingPaisa: input.principalPaisa,
            monthlyInstallmentPaisa: input.monthlyInstallmentPaisa,
            reason: input.reason || null,
            status: 'active',
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .returning();

        // Post disbursement journal entry: Dr 2300 / Cr PaymentAccount
        const businessDate = toKarachiBusinessDate(input.disbursementDate);
        await postJournalEntry(tx, {
          pharmacyId,
          entryDate: businessDate,
          sourceType: 'employee_advance',
          sourceId: id,
          memo: `Salary advance disbursement for ${emp.firstName} ${emp.lastName}`,
          createdBy: userId,
          lines: [
            {
              accountId: advAcc.id,
              debitPaisa: input.principalPaisa,
              creditPaisa: 0,
              partyType: 'employee',
              partyId: input.employeeId,
              branchId: emp.branchId || undefined,
              memo: `Salary advance to ${emp.firstName} ${emp.lastName}`,
            },
            {
              accountId: paymentAcc.id,
              debitPaisa: 0,
              creditPaisa: input.principalPaisa,
              branchId: emp.branchId || undefined,
              memo: `Advance disbursement via ${paymentAcc.name}`,
            },
          ],
        });

        return reply.status(201).send({ success: true, data: created });
      });
    }
  );

  // 8. GET /api/hr/payroll/runs
  fastify.get(
    '/payroll/runs',
    { preHandler: [requirePermission('hr.payroll.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const query = request.query as {
        branchId?: string;
        month?: string;
        status?: string;
        limit?: string;
        offset?: string;
      };

      const conditions = [eq(payrollRuns.pharmacyId, pharmacyId)];
      if (query.branchId) {
        conditions.push(eq(payrollRuns.branchId, query.branchId));
      }
      if (query.month) {
        conditions.push(eq(payrollRuns.month, query.month));
      }
      if (query.status) {
        conditions.push(
          eq(
            payrollRuns.status,
            query.status as 'draft' | 'reviewed' | 'approved' | 'posted' | 'paid' | 'cancelled'
          )
        );
      }

      const runs = await db
        .select({
          id: payrollRuns.id,
          pharmacyId: payrollRuns.pharmacyId,
          branchId: payrollRuns.branchId,
          branchName: branches.name,
          month: payrollRuns.month,
          runNumber: payrollRuns.runNumber,
          status: payrollRuns.status,
          isAdjustmentRun: payrollRuns.isAdjustmentRun,
          adjustmentForRunId: payrollRuns.adjustmentForRunId,
          totalBaseSalaryPaisa: payrollRuns.totalBaseSalaryPaisa,
          totalAllowancesPaisa: payrollRuns.totalAllowancesPaisa,
          totalOvertimePaisa: payrollRuns.totalOvertimePaisa,
          totalGrossPaisa: payrollRuns.totalGrossPaisa,
          totalUnpaidLeaveDeductionsPaisa: payrollRuns.totalUnpaidLeaveDeductionsPaisa,
          totalAdvancesRecoveredPaisa: payrollRuns.totalAdvancesRecoveredPaisa,
          totalTaxPaisa: payrollRuns.totalTaxPaisa,
          totalStatutoryPaisa: payrollRuns.totalStatutoryPaisa,
          totalDeductionsPaisa: payrollRuns.totalDeductionsPaisa,
          totalNetPaisa: payrollRuns.totalNetPaisa,
          journalEntryId: payrollRuns.journalEntryId,
          paymentJournalEntryId: payrollRuns.paymentJournalEntryId,
          paymentMethod: payrollRuns.paymentMethod,
          paidAt: payrollRuns.paidAt,
          reviewedBy: payrollRuns.reviewedBy,
          reviewedAt: payrollRuns.reviewedAt,
          approvedBy: payrollRuns.approvedBy,
          approvedAt: payrollRuns.approvedAt,
          createdAt: payrollRuns.createdAt,
        })
        .from(payrollRuns)
        .innerJoin(branches, eq(payrollRuns.branchId, branches.id))
        .where(and(...conditions))
        .orderBy(desc(payrollRuns.createdAt))
        .limit(Math.min(Math.max(Number(query.limit) || 100, 1), 500))
        .offset(Math.max(Number(query.offset) || 0, 0));

      return reply.send({ success: true, data: runs });
    }
  );

  // 9. GET /api/hr/payroll/runs/:id
  fastify.get<{ Params: { id: string } }>(
    '/payroll/runs/:id',
    { preHandler: [requirePermission('hr.payroll.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.id, id), eq(payrollRuns.pharmacyId, pharmacyId)));

      if (!run) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Payroll run not found',
        });
      }

      return reply.send({ success: true, data: run });
    }
  );

  // 10. GET /api/hr/payroll/runs/:id/items
  fastify.get<{ Params: { id: string } }>(
    '/payroll/runs/:id/items',
    { preHandler: [requirePermission('hr.payroll.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      // Verify run belongs to tenant
      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.id, id), eq(payrollRuns.pharmacyId, pharmacyId)));

      if (!run) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Payroll run not found',
        });
      }

      const items = await db
        .select()
        .from(payrollItems)
        .where(and(eq(payrollItems.payrollRunId, id), eq(payrollItems.pharmacyId, pharmacyId)))
        .orderBy(payrollItems.employeeCode);

      return reply.send({ success: true, data: items });
    }
  );

  // 11. POST /api/hr/payroll/runs/generate
  fastify.post(
    '/payroll/runs/generate',
    { preHandler: [requirePermission('hr.payroll.manage')] },
    async (request, reply) => {
      const { pharmacyId, userId } = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = GeneratePayrollRunSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid parameters',
        });
      }

      const { branchId, month, workingDays } = parsed.data;

      // Verify branch
      const [branch] = await db
        .select()
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.pharmacyId, pharmacyId)));

      if (!branch) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Branch not found',
        });
      }

      const nowIso = new Date().toISOString();
      const monthStart = `${month}-01`;
      const monthEnd = `${month}-31`;

      // 1. Fetch active employees in this branch
      const branchEmployees = await db
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.pharmacyId, pharmacyId),
            eq(employees.branchId, branchId),
            eq(employees.isActive, true)
          )
        );

      if (branchEmployees.length === 0) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'No active employees found in this branch',
        });
      }

      // 2. Fetch approved unpaid leaves in the month
      const unpaidLeaves = await db
        .select({
          employeeId: leaveRequests.employeeId,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
        })
        .from(leaveRequests)
        .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
        .where(
          and(
            eq(leaveRequests.pharmacyId, pharmacyId),
            eq(leaveRequests.status, 'approved'),
            eq(leaveTypes.isPaid, false),
            lte(leaveRequests.startDate, monthEnd),
            gte(leaveRequests.endDate, monthStart)
          )
        );

      // 3. Fetch active employee advances
      const activeAdvances = await db
        .select()
        .from(employeeAdvances)
        .where(
          and(eq(employeeAdvances.pharmacyId, pharmacyId), eq(employeeAdvances.status, 'active'))
        );

      // 4. Fetch active statutory components & tax slabs
      const statutoryComps = await db
        .select()
        .from(payrollStatutoryComponents)
        .where(
          and(
            eq(payrollStatutoryComponents.pharmacyId, pharmacyId),
            eq(payrollStatutoryComponents.isActive, true)
          )
        );

      const taxSlabs = await db
        .select()
        .from(payrollTaxSlabs)
        .where(and(eq(payrollTaxSlabs.pharmacyId, pharmacyId), eq(payrollTaxSlabs.isActive, true)))
        .orderBy(payrollTaxSlabs.minMonthlyIncomePaisa);

      // 5. Build run items
      const runId = generateUuidV7();
      const runNumber = `PAY-${month}-${Date.now().toString().slice(-4)}`;

      let totalBaseSalary = 0;
      const totalAllowances = 0;
      const totalOvertime = 0;
      let totalGross = 0;
      let totalUnpaidLeaveDeductions = 0;
      let totalAdvancesRecovered = 0;
      let totalTax = 0;
      let totalStatutory = 0;
      let totalDeductions = 0;
      let totalNet = 0;

      const itemsToInsert = [];

      for (const emp of branchEmployees) {
        const baseSalaryPaisa = emp.salaryPaisa;
        const dailyRatePaisa = roundHalfUp(baseSalaryPaisa, workingDays);

        // Count unpaid leave days in this month
        let unpaidDays = 0;
        for (const ul of unpaidLeaves) {
          if (ul.employeeId === emp.id) {
            const effStart = ul.startDate < monthStart ? monthStart : ul.startDate;
            const effEnd = ul.endDate > monthEnd ? monthEnd : ul.endDate;
            unpaidDays += calculateLeaveDays(effStart, effEnd);
          }
        }

        const unpaidDeductionPaisa = Math.min(baseSalaryPaisa, unpaidDays * dailyRatePaisa);

        // Advance recovery
        const empAdv = activeAdvances.find((a) => a.employeeId === emp.id);
        const advanceRecoveryPaisa = empAdv
          ? Math.min(empAdv.remainingPaisa, empAdv.monthlyInstallmentPaisa)
          : 0;

        // Progressive tax on base salary
        const taxPaisa = calculateProgressiveTax(baseSalaryPaisa, taxSlabs);

        // Statutory deductions
        let statutoryPaisa = 0;
        const statBreakdown = [];
        for (const comp of statutoryComps) {
          const compDeduction = calculateStatutoryComponentDeduction(baseSalaryPaisa, comp);
          statutoryPaisa += compDeduction;
          statBreakdown.push({
            code: comp.code,
            name: comp.name,
            amountPaisa: compDeduction,
          });
        }

        const totals = computePayrollItemTotals({
          baseSalaryPaisa,
          allowancesPaisa: 0,
          overtimeAmountPaisa: 0,
          unpaidLeaveDeductionPaisa: unpaidDeductionPaisa,
          advanceRecoveryPaisa,
          taxPaisa,
          statutoryDeductionsPaisa: statutoryPaisa,
        });

        totalBaseSalary += baseSalaryPaisa;
        totalGross += totals.grossSalaryPaisa;
        totalUnpaidLeaveDeductions += unpaidDeductionPaisa;
        totalAdvancesRecovered += advanceRecoveryPaisa;
        totalTax += taxPaisa;
        totalStatutory += statutoryPaisa;
        totalDeductions += totals.totalDeductionsPaisa;
        totalNet += totals.netSalaryPaisa;

        itemsToInsert.push({
          id: generateUuidV7(),
          pharmacyId,
          payrollRunId: runId,
          employeeId: emp.id,
          employeeCode: emp.employeeCode,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          designation: emp.designation,
          baseSalaryPaisa,
          workingDays,
          attendedDays: Math.max(0, workingDays - unpaidDays),
          unpaidLeaveDays: unpaidDays,
          unpaidLeaveDeductionPaisa: unpaidDeductionPaisa,
          overtimeHours: 0,
          overtimeAmountPaisa: 0,
          allowancesPaisa: 0,
          allowancesBreakdown: '[]',
          advanceRecoveryPaisa,
          advanceId: empAdv ? empAdv.id : null,
          taxPaisa,
          statutoryDeductionsPaisa: statutoryPaisa,
          statutoryBreakdown: JSON.stringify(statBreakdown),
          grossSalaryPaisa: totals.grossSalaryPaisa,
          totalDeductionsPaisa: totals.totalDeductionsPaisa,
          netSalaryPaisa: totals.netSalaryPaisa,
          paymentStatus: 'pending' as const,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }

      // 6. Insert Run & Items
      const [createdRun] = await db
        .insert(payrollRuns)
        .values({
          id: runId,
          pharmacyId,
          branchId,
          month,
          runNumber,
          status: 'draft',
          isAdjustmentRun: false,
          totalBaseSalaryPaisa: totalBaseSalary,
          totalAllowancesPaisa: totalAllowances,
          totalOvertimePaisa: totalOvertime,
          totalGrossPaisa: totalGross,
          totalUnpaidLeaveDeductionsPaisa: totalUnpaidLeaveDeductions,
          totalAdvancesRecoveredPaisa: totalAdvancesRecovered,
          totalTaxPaisa: totalTax,
          totalStatutoryPaisa: totalStatutory,
          totalDeductionsPaisa: totalDeductions,
          totalNetPaisa: totalNet,
          createdBy: userId,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .returning();

      await db.insert(payrollItems).values(itemsToInsert);

      return reply.status(201).send({ success: true, data: createdRun });
    }
  );

  // 12. PUT /api/hr/payroll/items/:id
  fastify.put<{ Params: { id: string } }>(
    '/payroll/items/:id',
    { preHandler: [requirePermission('hr.payroll.manage')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      const parsed = UpdatePayrollItemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid item update payload',
        });
      }

      // 1. Fetch item and check run status
      const [item] = await db
        .select()
        .from(payrollItems)
        .where(and(eq(payrollItems.id, id), eq(payrollItems.pharmacyId, pharmacyId)));

      if (!item) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Payroll item not found',
        });
      }

      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.id, item.payrollRunId));

      if (!run) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Parent payroll run not found',
        });
      }

      // Immutability Check: Approved/posted/paid runs cannot be edited directly!
      if (['approved', 'posted', 'paid'].includes(run.status)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message:
            'Approved payroll run items are immutable. Corrections must be made via an adjustment run.',
        });
      }

      const nowIso = new Date().toISOString();
      const overtimeHours = parsed.data.overtimeHours ?? item.overtimeHours;
      const overtimeAmountPaisa = parsed.data.overtimeAmountPaisa ?? item.overtimeAmountPaisa;
      const allowancesPaisa = parsed.data.allowancesPaisa ?? item.allowancesPaisa;
      const allowancesBreakdown = parsed.data.allowancesBreakdown
        ? JSON.stringify(parsed.data.allowancesBreakdown)
        : item.allowancesBreakdown;
      const advanceRecoveryPaisa = parsed.data.advanceRecoveryPaisa ?? item.advanceRecoveryPaisa;

      const totals = computePayrollItemTotals({
        baseSalaryPaisa: item.baseSalaryPaisa,
        allowancesPaisa,
        overtimeAmountPaisa,
        unpaidLeaveDeductionPaisa: item.unpaidLeaveDeductionPaisa,
        advanceRecoveryPaisa,
        taxPaisa: item.taxPaisa,
        statutoryDeductionsPaisa: item.statutoryDeductionsPaisa,
      });

      const [updatedItem] = await db
        .update(payrollItems)
        .set({
          overtimeHours,
          overtimeAmountPaisa,
          allowancesPaisa,
          allowancesBreakdown,
          advanceRecoveryPaisa,
          grossSalaryPaisa: totals.grossSalaryPaisa,
          totalDeductionsPaisa: totals.totalDeductionsPaisa,
          netSalaryPaisa: totals.netSalaryPaisa,
          updatedAt: nowIso,
        })
        .where(eq(payrollItems.id, item.id))
        .returning();

      // Recalculate parent run totals
      const allItems = await db
        .select()
        .from(payrollItems)
        .where(eq(payrollItems.payrollRunId, run.id));

      const runGross = allItems.reduce((sum, it) => sum + it.grossSalaryPaisa, 0);
      const runAllowances = allItems.reduce((sum, it) => sum + it.allowancesPaisa, 0);
      const runOvertime = allItems.reduce((sum, it) => sum + it.overtimeAmountPaisa, 0);
      const runAdvancesRecovered = allItems.reduce((sum, it) => sum + it.advanceRecoveryPaisa, 0);
      const runTax = allItems.reduce((sum, it) => sum + it.taxPaisa, 0);
      const runStatutory = allItems.reduce((sum, it) => sum + it.statutoryDeductionsPaisa, 0);
      const runDeductions = allItems.reduce((sum, it) => sum + it.totalDeductionsPaisa, 0);
      const runNet = allItems.reduce((sum, it) => sum + it.netSalaryPaisa, 0);

      await db
        .update(payrollRuns)
        .set({
          totalAllowancesPaisa: runAllowances,
          totalOvertimePaisa: runOvertime,
          totalAdvancesRecoveredPaisa: runAdvancesRecovered,
          totalTaxPaisa: runTax,
          totalStatutoryPaisa: runStatutory,
          totalGrossPaisa: runGross,
          totalDeductionsPaisa: runDeductions,
          totalNetPaisa: runNet,
          updatedAt: nowIso,
        })
        .where(eq(payrollRuns.id, run.id));

      return reply.send({ success: true, data: updatedItem });
    }
  );

  // 13. POST /api/hr/payroll/runs/:id/review
  fastify.post<{ Params: { id: string } }>(
    '/payroll/runs/:id/review',
    { preHandler: [requirePermission('hr.payroll.manage')] },
    async (request, reply) => {
      const { pharmacyId, userId } = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.id, id), eq(payrollRuns.pharmacyId, pharmacyId)));

      if (!run) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Payroll run not found',
        });
      }

      if (run.status !== 'draft') {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Cannot review run with status '${run.status}'`,
        });
      }

      const nowIso = new Date().toISOString();
      const [updated] = await db
        .update(payrollRuns)
        .set({
          status: 'reviewed',
          reviewedBy: userId,
          reviewedAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(payrollRuns.id, run.id))
        .returning();

      return reply.send({ success: true, data: updated });
    }
  );

  // 14. POST /api/hr/payroll/runs/:id/approve
  fastify.post<{ Params: { id: string } }>(
    '/payroll/runs/:id/approve',
    { preHandler: [requirePermission('hr.payroll.manage')] },
    async (request, reply) => {
      const { pharmacyId, userId } = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.id, id), eq(payrollRuns.pharmacyId, pharmacyId)));

      if (!run) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Payroll run not found',
        });
      }

      if (!['draft', 'reviewed'].includes(run.status)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Cannot approve run with status '${run.status}'`,
        });
      }

      const nowIso = new Date().toISOString();
      const [updated] = await db
        .update(payrollRuns)
        .set({
          status: 'approved',
          approvedBy: userId,
          approvedAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(payrollRuns.id, run.id))
        .returning();

      return reply.send({ success: true, data: updated });
    }
  );

  // 15. POST /api/hr/payroll/runs/:id/post
  fastify.post<{ Params: { id: string } }>(
    '/payroll/runs/:id/post',
    { preHandler: [requirePermission('hr.payroll.manage')] },
    async (request, reply) => {
      const { pharmacyId, userId } = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      try {
        const result = await postPayrollRunToLedger(db, pharmacyId, id, userId);

        const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, id));

        return reply.send({
          success: true,
          data: run,
          journalEntryId: result.journalEntryId,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Ledger posting failed';
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: msg,
        });
      }
    }
  );

  // 16. POST /api/hr/payroll/runs/:id/pay
  fastify.post<{ Params: { id: string } }>(
    '/payroll/runs/:id/pay',
    { preHandler: [requirePermission('hr.payroll.manage')] },
    async (request, reply) => {
      const { pharmacyId, userId } = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      const parsed = PayPayrollRunSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid payment parameters',
        });
      }

      const { paymentAccountId, paymentMethod } = parsed.data;

      try {
        const result = await postPayrollPaymentBatch(
          db,
          pharmacyId,
          id,
          paymentAccountId,
          paymentMethod,
          userId
        );

        const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, id));

        return reply.send({
          success: true,
          data: run,
          paymentJournalEntryId: result.paymentJournalEntryId,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Disbursement failed';
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: msg,
        });
      }
    }
  );

  // 17. POST /api/hr/payroll/runs/:id/adjustment
  fastify.post<{ Params: { id: string } }>(
    '/payroll/runs/:id/adjustment',
    { preHandler: [requirePermission('hr.payroll.manage')] },
    async (request, reply) => {
      const { pharmacyId, userId } = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      const parsed = CreateAdjustmentRunSchema.safeParse({
        originalRunId: id,
        reason: (request.body as { reason?: string })?.reason,
      });

      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid adjustment parameters',
        });
      }

      const [origRun] = await db
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.id, id), eq(payrollRuns.pharmacyId, pharmacyId)));

      if (!origRun) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Original payroll run not found',
        });
      }

      if (!['approved', 'posted', 'paid'].includes(origRun.status)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Adjustment runs can only be created for approved, posted, or paid runs',
        });
      }

      const nowIso = new Date().toISOString();
      const adjRunId = generateUuidV7();
      const adjRunNumber = `ADJ-${origRun.runNumber}-${Date.now().toString().slice(-4)}`;

      const [adjRun] = await db
        .insert(payrollRuns)
        .values({
          id: adjRunId,
          pharmacyId,
          branchId: origRun.branchId,
          month: origRun.month,
          runNumber: adjRunNumber,
          status: 'draft',
          isAdjustmentRun: true,
          adjustmentForRunId: origRun.id,
          totalBaseSalaryPaisa: 0,
          totalAllowancesPaisa: 0,
          totalOvertimePaisa: 0,
          totalGrossPaisa: 0,
          totalUnpaidLeaveDeductionsPaisa: 0,
          totalAdvancesRecoveredPaisa: 0,
          totalTaxPaisa: 0,
          totalStatutoryPaisa: 0,
          totalDeductionsPaisa: 0,
          totalNetPaisa: 0,
          createdBy: userId,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .returning();

      return reply.status(201).send({ success: true, data: adjRun });
    }
  );

  // 18. GET /api/hr/payroll/items/:id/payslip
  fastify.get<{ Params: { id: string } }>(
    '/payroll/items/:id/payslip',
    { preHandler: [requirePermission('hr.payroll.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      const [item] = await db
        .select()
        .from(payrollItems)
        .where(and(eq(payrollItems.id, id), eq(payrollItems.pharmacyId, pharmacyId)));

      if (!item) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Payroll item not found',
        });
      }

      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.id, item.payrollRunId));

      const [emp] = await db.select().from(employees).where(eq(employees.id, item.employeeId));

      const [pharmacy] = await db.select().from(pharmacies).where(eq(pharmacies.id, pharmacyId));

      return reply.send({
        success: true,
        data: {
          id: item.id,
          pharmacyName: pharmacy?.name || 'Central Pharmacy',
          runNumber: run?.runNumber || '',
          month: run?.month || '',
          employeeId: item.employeeId,
          employeeCode: item.employeeCode,
          employeeName: item.employeeName,
          designation: item.designation,
          department: emp?.department || '',
          joiningDate: emp?.joiningDate || '',
          baseSalaryPaisa: item.baseSalaryPaisa,
          workingDays: item.workingDays,
          attendedDays: item.attendedDays,
          unpaidLeaveDays: item.unpaidLeaveDays,
          earnings: {
            baseSalaryPaisa: item.baseSalaryPaisa,
            allowancesPaisa: item.allowancesPaisa,
            allowancesBreakdown: item.allowancesBreakdown
              ? JSON.parse(item.allowancesBreakdown)
              : [],
            overtimeHours: item.overtimeHours,
            overtimeAmountPaisa: item.overtimeAmountPaisa,
            grossSalaryPaisa: item.grossSalaryPaisa,
          },
          deductions: {
            unpaidLeaveDeductionPaisa: item.unpaidLeaveDeductionPaisa,
            advanceRecoveryPaisa: item.advanceRecoveryPaisa,
            taxPaisa: item.taxPaisa,
            statutoryDeductionsPaisa: item.statutoryDeductionsPaisa,
            statutoryBreakdown: item.statutoryBreakdown ? JSON.parse(item.statutoryBreakdown) : [],
            totalDeductionsPaisa: item.totalDeductionsPaisa,
          },
          netSalaryPaisa: item.netSalaryPaisa,
          paymentStatus: item.paymentStatus,
          isApproved: run ? ['approved', 'posted', 'paid'].includes(run.status) : false,
        },
      });
    }
  );
};
