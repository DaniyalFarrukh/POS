import type { FastifyPluginAsync } from 'fastify';
import { eq, and, sql, gte, lte, inArray } from 'drizzle-orm';
import {
  generateUuidV7,
  calculateLeaveDays,
  calculateCarryOver,
  calculateUnpaidLeaveDeduction,
  CreateEmployeeSchema,
  CreateLeaveTypeSchema,
  CreateLeaveRequestSchema,
  RejectLeaveRequestSchema,
  CarryOverLeavesSchema,
  LeaveCalendarQuerySchema,
  PayrollPreviewQuerySchema,
} from '@pos/shared';
import {
  employees,
  leaveTypes,
  leaveAllocations,
  leaveRequests,
  attendanceRecords,
} from '../db/schema';
import { getDb } from '../db';
import { requirePermission } from '../auth/user-auth';

export const hrLeaveRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. GET /api/hr/employees
  fastify.get(
    '/employees',
    { preHandler: [requirePermission('hr.employee.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();

      const list = await db
        .select()
        .from(employees)
        .where(eq(employees.pharmacyId, pharmacyId))
        .orderBy(employees.employeeCode);

      return reply.send({ success: true, data: list });
    }
  );

  // 2. POST /api/hr/employees
  fastify.post(
    '/employees',
    { preHandler: [requirePermission('hr.employee.manage')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = CreateEmployeeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid employee payload',
        });
      }

      const input = parsed.data;
      const nowIso = new Date().toISOString();
      const id = generateUuidV7();

      const [created] = await db
        .insert(employees)
        .values({
          id,
          pharmacyId,
          branchId: input.branchId || null,
          userId: input.userId || null,
          employeeCode: input.employeeCode,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email || null,
          phone: input.phone || null,
          designation: input.designation,
          department: input.department || null,
          joiningDate: input.joiningDate,
          salaryPaisa: input.salaryPaisa,
          isActive: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .returning();

      return reply.status(201).send({ success: true, data: created });
    }
  );

  // 3. GET /api/hr/leave/types
  fastify.get(
    '/leave/types',
    { preHandler: [requirePermission('hr.leave.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();

      const types = await db
        .select()
        .from(leaveTypes)
        .where(eq(leaveTypes.pharmacyId, pharmacyId))
        .orderBy(leaveTypes.code);

      return reply.send({ success: true, data: types });
    }
  );

  // 4. POST /api/hr/leave/types
  fastify.post(
    '/leave/types',
    { preHandler: [requirePermission('hr.leave.manage')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = CreateLeaveTypeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid leave type payload',
        });
      }

      const input = parsed.data;
      const nowIso = new Date().toISOString();
      const id = generateUuidV7();

      const [created] = await db
        .insert(leaveTypes)
        .values({
          id,
          pharmacyId,
          code: input.code,
          name: input.name,
          description: input.description || null,
          isPaid: input.isPaid,
          yearlyEntitlementDays: input.yearlyEntitlementDays,
          maxCarryOverDays: input.maxCarryOverDays,
          isActive: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .returning();

      return reply.status(201).send({ success: true, data: created });
    }
  );

  // 5. GET /api/hr/leave/balances
  fastify.get(
    '/leave/balances',
    { preHandler: [requirePermission('hr.leave.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const query = request.query as { employeeId?: string; year?: string };

      const year = query.year ? parseInt(query.year, 10) : new Date().getFullYear();

      // If specific employee queried, verify tenancy
      if (query.employeeId) {
        const [emp] = await db
          .select()
          .from(employees)
          .where(and(eq(employees.id, query.employeeId), eq(employees.pharmacyId, pharmacyId)));

        if (!emp) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: 'Employee not found',
          });
        }
      }

      // Get all active leave types for pharmacy
      const allTypes = await db
        .select()
        .from(leaveTypes)
        .where(and(eq(leaveTypes.pharmacyId, pharmacyId), eq(leaveTypes.isActive, true)));

      // Get employees
      const emps = query.employeeId
        ? await db
            .select()
            .from(employees)
            .where(and(eq(employees.id, query.employeeId), eq(employees.pharmacyId, pharmacyId)))
        : await db
            .select()
            .from(employees)
            .where(and(eq(employees.pharmacyId, pharmacyId), eq(employees.isActive, true)));

      const results = [];

      for (const emp of emps) {
        for (const lt of allTypes) {
          // Find or create allocation
          let [alloc] = await db
            .select()
            .from(leaveAllocations)
            .where(
              and(
                eq(leaveAllocations.pharmacyId, pharmacyId),
                eq(leaveAllocations.employeeId, emp.id),
                eq(leaveAllocations.leaveTypeId, lt.id),
                eq(leaveAllocations.year, year)
              )
            );

          if (!alloc) {
            const nowIso = new Date().toISOString();
            const allocId = generateUuidV7();
            [alloc] = await db
              .insert(leaveAllocations)
              .values({
                id: allocId,
                pharmacyId,
                employeeId: emp.id,
                leaveTypeId: lt.id,
                year,
                entitledDays: lt.yearlyEntitlementDays,
                carriedOverDays: 0,
                manualAdjustmentDays: 0,
                usedDays: 0,
                pendingDays: 0,
                createdAt: nowIso,
                updatedAt: nowIso,
              })
              .returning();
          }

          if (!alloc) {
            continue;
          }

          const totalAllocatedDays =
            alloc.entitledDays + alloc.carriedOverDays + alloc.manualAdjustmentDays;
          const remainingDays = totalAllocatedDays - alloc.usedDays - alloc.pendingDays;

          results.push({
            id: alloc.id,
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            employeeCode: emp.employeeCode,
            leaveTypeId: lt.id,
            leaveTypeCode: lt.code,
            leaveTypeName: lt.name,
            isPaid: lt.isPaid,
            year: alloc.year,
            entitledDays: alloc.entitledDays,
            carriedOverDays: alloc.carriedOverDays,
            manualAdjustmentDays: alloc.manualAdjustmentDays,
            totalAllocatedDays,
            usedDays: alloc.usedDays,
            pendingDays: alloc.pendingDays,
            remainingDays,
          });
        }
      }

      return reply.send({ success: true, data: results });
    }
  );

  // 6. POST /api/hr/leave/carry-over
  fastify.post(
    '/leave/carry-over',
    { preHandler: [requirePermission('hr.leave.manage')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = CarryOverLeavesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid carry-over parameters',
        });
      }

      const { fromYear, toYear, employeeId } = parsed.data;
      const nowIso = new Date().toISOString();

      // Get leave types with maxCarryOverDays > 0
      const eligibleTypes = await db
        .select()
        .from(leaveTypes)
        .where(
          and(
            eq(leaveTypes.pharmacyId, pharmacyId),
            sql`${leaveTypes.maxCarryOverDays} > 0`,
            eq(leaveTypes.isActive, true)
          )
        );

      const empFilter = employeeId
        ? and(eq(employees.pharmacyId, pharmacyId), eq(employees.id, employeeId))
        : and(eq(employees.pharmacyId, pharmacyId), eq(employees.isActive, true));

      const targetEmployees = await db.select().from(employees).where(empFilter);

      let totalCarriedOver = 0;

      for (const emp of targetEmployees) {
        for (const lt of eligibleTypes) {
          // Look up fromYear allocation
          const [fromAlloc] = await db
            .select()
            .from(leaveAllocations)
            .where(
              and(
                eq(leaveAllocations.pharmacyId, pharmacyId),
                eq(leaveAllocations.employeeId, emp.id),
                eq(leaveAllocations.leaveTypeId, lt.id),
                eq(leaveAllocations.year, fromYear)
              )
            );

          const fromUnusedDays = fromAlloc
            ? fromAlloc.entitledDays +
              fromAlloc.carriedOverDays +
              fromAlloc.manualAdjustmentDays -
              fromAlloc.usedDays
            : 0;

          const carried = calculateCarryOver(fromUnusedDays, lt.maxCarryOverDays);
          totalCarriedOver += carried;

          // Target allocation for toYear
          const [toAlloc] = await db
            .select()
            .from(leaveAllocations)
            .where(
              and(
                eq(leaveAllocations.pharmacyId, pharmacyId),
                eq(leaveAllocations.employeeId, emp.id),
                eq(leaveAllocations.leaveTypeId, lt.id),
                eq(leaveAllocations.year, toYear)
              )
            );

          if (toAlloc) {
            await db
              .update(leaveAllocations)
              .set({
                carriedOverDays: carried,
                updatedAt: nowIso,
              })
              .where(eq(leaveAllocations.id, toAlloc.id));
          } else {
            await db.insert(leaveAllocations).values({
              id: generateUuidV7(),
              pharmacyId,
              employeeId: emp.id,
              leaveTypeId: lt.id,
              year: toYear,
              entitledDays: lt.yearlyEntitlementDays,
              carriedOverDays: carried,
              manualAdjustmentDays: 0,
              usedDays: 0,
              pendingDays: 0,
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          }
        }
      }

      return reply.send({
        success: true,
        data: {
          fromYear,
          toYear,
          carriedOverDays: totalCarriedOver,
        },
      });
    }
  );

  // 7. GET /api/hr/leave/requests
  fastify.get(
    '/leave/requests',
    { preHandler: [requirePermission('hr.leave.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const query = request.query as {
        employeeId?: string;
        status?: string;
        startDate?: string;
        endDate?: string;
      };

      const conditions = [eq(leaveRequests.pharmacyId, pharmacyId)];

      if (query.employeeId) {
        conditions.push(eq(leaveRequests.employeeId, query.employeeId));
      }
      if (query.status) {
        conditions.push(
          eq(
            leaveRequests.status,
            query.status as 'pending' | 'approved' | 'rejected' | 'cancelled'
          )
        );
      }
      if (query.startDate) {
        conditions.push(gte(leaveRequests.endDate, query.startDate));
      }
      if (query.endDate) {
        conditions.push(lte(leaveRequests.startDate, query.endDate));
      }

      const requests = await db
        .select({
          id: leaveRequests.id,
          pharmacyId: leaveRequests.pharmacyId,
          employeeId: leaveRequests.employeeId,
          employeeName: sql<string>`concat(${employees.firstName}, ' ', ${employees.lastName})`,
          employeeCode: employees.employeeCode,
          leaveTypeId: leaveRequests.leaveTypeId,
          leaveTypeCode: leaveTypes.code,
          leaveTypeName: leaveTypes.name,
          isPaid: leaveTypes.isPaid,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          daysCount: leaveRequests.daysCount,
          reason: leaveRequests.reason,
          status: leaveRequests.status,
          rejectionReason: leaveRequests.rejectionReason,
          approvedBy: leaveRequests.approvedBy,
          approvedAt: leaveRequests.approvedAt,
          createdAt: leaveRequests.createdAt,
          updatedAt: leaveRequests.updatedAt,
        })
        .from(leaveRequests)
        .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
        .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
        .where(and(...conditions))
        .orderBy(sql`${leaveRequests.createdAt} DESC`);

      return reply.send({ success: true, data: requests });
    }
  );

  // 8. POST /api/hr/leave/requests
  fastify.post(
    '/leave/requests',
    { preHandler: [requirePermission('hr.leave.manage')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = CreateLeaveRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid leave request',
        });
      }

      const input = parsed.data;

      // 1. Verify employee
      const [emp] = await db
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

      // 2. Verify leave type
      const [lt] = await db
        .select()
        .from(leaveTypes)
        .where(and(eq(leaveTypes.id, input.leaveTypeId), eq(leaveTypes.pharmacyId, pharmacyId)));

      if (!lt) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Leave type not found',
        });
      }

      const daysCount = calculateLeaveDays(input.startDate, input.endDate);
      const reqYear = parseInt(input.startDate.substring(0, 4), 10);

      // 3. Overlap check: An employee cannot have overlapping pending/approved leave requests
      const overlapping = await db
        .select()
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.pharmacyId, pharmacyId),
            eq(leaveRequests.employeeId, input.employeeId),
            inArray(leaveRequests.status, ['pending', 'approved']),
            lte(leaveRequests.startDate, input.endDate),
            gte(leaveRequests.endDate, input.startDate)
          )
        );

      if (overlapping.length > 0) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message:
            'Overlapping leave request already exists for this employee in the selected date range',
        });
      }

      const nowIso = new Date().toISOString();

      // 4. If paid leave, check allocation balance and reserve pending days
      if (lt.isPaid) {
        let [alloc] = await db
          .select()
          .from(leaveAllocations)
          .where(
            and(
              eq(leaveAllocations.pharmacyId, pharmacyId),
              eq(leaveAllocations.employeeId, input.employeeId),
              eq(leaveAllocations.leaveTypeId, lt.id),
              eq(leaveAllocations.year, reqYear)
            )
          );

        if (!alloc) {
          const allocId = generateUuidV7();
          [alloc] = await db
            .insert(leaveAllocations)
            .values({
              id: allocId,
              pharmacyId,
              employeeId: input.employeeId,
              leaveTypeId: lt.id,
              year: reqYear,
              entitledDays: lt.yearlyEntitlementDays,
              carriedOverDays: 0,
              manualAdjustmentDays: 0,
              usedDays: 0,
              pendingDays: 0,
              createdAt: nowIso,
              updatedAt: nowIso,
            })
            .returning();
        }

        if (!alloc) {
          return reply.status(500).send({
            statusCode: 500,
            error: 'Internal Server Error',
            message: 'Failed to initialize leave allocation',
          });
        }

        const totalAllocated =
          alloc.entitledDays + alloc.carriedOverDays + alloc.manualAdjustmentDays;
        const remaining = totalAllocated - alloc.usedDays - alloc.pendingDays;

        if (remaining < daysCount) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: `Insufficient leave balance: requested ${daysCount} days, but only ${remaining} days remaining`,
          });
        }

        // Reserve pending days
        await db
          .update(leaveAllocations)
          .set({
            pendingDays: alloc.pendingDays + daysCount,
            updatedAt: nowIso,
          })
          .where(eq(leaveAllocations.id, alloc.id));
      }

      const reqId = generateUuidV7();
      const [created] = await db
        .insert(leaveRequests)
        .values({
          id: reqId,
          pharmacyId,
          employeeId: input.employeeId,
          leaveTypeId: input.leaveTypeId,
          startDate: input.startDate,
          endDate: input.endDate,
          daysCount,
          reason: input.reason,
          status: 'pending',
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .returning();

      return reply.status(201).send({ success: true, data: created });
    }
  );

  // 9. POST /api/hr/leave/requests/:id/approve
  fastify.post<{ Params: { id: string } }>(
    '/leave/requests/:id/approve',
    { preHandler: [requirePermission('hr.leave.manage')] },
    async (request, reply) => {
      const { pharmacyId, userId } = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      const [req] = await db
        .select()
        .from(leaveRequests)
        .where(and(eq(leaveRequests.id, id), eq(leaveRequests.pharmacyId, pharmacyId)));

      if (!req) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Leave request not found',
        });
      }

      if (req.status !== 'pending') {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Cannot approve request with status '${req.status}'`,
        });
      }

      const [lt] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, req.leaveTypeId));

      const [emp] = await db.select().from(employees).where(eq(employees.id, req.employeeId));

      const nowIso = new Date().toISOString();
      const reqYear = parseInt(req.startDate.substring(0, 4), 10);

      // 1. Update allocation: move from pending to used
      if (lt && lt.isPaid) {
        const [alloc] = await db
          .select()
          .from(leaveAllocations)
          .where(
            and(
              eq(leaveAllocations.pharmacyId, pharmacyId),
              eq(leaveAllocations.employeeId, req.employeeId),
              eq(leaveAllocations.leaveTypeId, lt.id),
              eq(leaveAllocations.year, reqYear)
            )
          );

        if (alloc) {
          await db
            .update(leaveAllocations)
            .set({
              pendingDays: Math.max(0, alloc.pendingDays - req.daysCount),
              usedDays: alloc.usedDays + req.daysCount,
              updatedAt: nowIso,
            })
            .where(eq(leaveAllocations.id, alloc.id));
        }
      }

      // 2. Mark attendance records as on_leave for all dates in range
      const startDateObj = new Date(`${req.startDate}T00:00:00Z`);
      const endDateObj = new Date(`${req.endDate}T00:00:00Z`);
      const curDate = new Date(startDateObj);

      while (curDate <= endDateObj) {
        const dateStr = curDate.toISOString().substring(0, 10);

        const [existingAtt] = await db
          .select()
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.pharmacyId, pharmacyId),
              eq(attendanceRecords.employeeId, req.employeeId),
              eq(attendanceRecords.date, dateStr)
            )
          );

        if (existingAtt) {
          await db
            .update(attendanceRecords)
            .set({
              status: 'on_leave',
              leaveRequestId: req.id,
              updatedAt: nowIso,
            })
            .where(eq(attendanceRecords.id, existingAtt.id));
        } else {
          await db.insert(attendanceRecords).values({
            id: generateUuidV7(),
            pharmacyId,
            branchId: emp?.branchId || null,
            employeeId: req.employeeId,
            date: dateStr,
            status: 'on_leave',
            leaveRequestId: req.id,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }

        curDate.setUTCDate(curDate.getUTCDate() + 1);
      }

      // 3. Mark request approved
      const [updatedReq] = await db
        .update(leaveRequests)
        .set({
          status: 'approved',
          approvedBy: userId,
          approvedAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(leaveRequests.id, req.id))
        .returning();

      return reply.send({ success: true, data: updatedReq });
    }
  );

  // 10. POST /api/hr/leave/requests/:id/reject
  fastify.post<{ Params: { id: string } }>(
    '/leave/requests/:id/reject',
    { preHandler: [requirePermission('hr.leave.manage')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      const parsed = RejectLeaveRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Rejection reason is required',
        });
      }

      const [req] = await db
        .select()
        .from(leaveRequests)
        .where(and(eq(leaveRequests.id, id), eq(leaveRequests.pharmacyId, pharmacyId)));

      if (!req) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Leave request not found',
        });
      }

      if (req.status !== 'pending') {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Cannot reject request with status '${req.status}'`,
        });
      }

      const [lt] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, req.leaveTypeId));

      const nowIso = new Date().toISOString();
      const reqYear = parseInt(req.startDate.substring(0, 4), 10);

      // Restore pending days
      if (lt && lt.isPaid) {
        const [alloc] = await db
          .select()
          .from(leaveAllocations)
          .where(
            and(
              eq(leaveAllocations.pharmacyId, pharmacyId),
              eq(leaveAllocations.employeeId, req.employeeId),
              eq(leaveAllocations.leaveTypeId, lt.id),
              eq(leaveAllocations.year, reqYear)
            )
          );

        if (alloc) {
          await db
            .update(leaveAllocations)
            .set({
              pendingDays: Math.max(0, alloc.pendingDays - req.daysCount),
              updatedAt: nowIso,
            })
            .where(eq(leaveAllocations.id, alloc.id));
        }
      }

      const [updatedReq] = await db
        .update(leaveRequests)
        .set({
          status: 'rejected',
          rejectionReason: parsed.data.rejectionReason,
          updatedAt: nowIso,
        })
        .where(eq(leaveRequests.id, req.id))
        .returning();

      return reply.send({ success: true, data: updatedReq });
    }
  );

  // 11. GET /api/hr/leave/calendar
  fastify.get(
    '/leave/calendar',
    { preHandler: [requirePermission('hr.leave.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = LeaveCalendarQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid calendar query',
        });
      }

      const { month, startDate, endDate, branchId } = parsed.data;

      const conditions = [
        eq(leaveRequests.pharmacyId, pharmacyId),
        inArray(leaveRequests.status, ['approved', 'pending']),
      ];

      if (month) {
        const monthStart = `${month}-01`;
        const monthEnd = `${month}-31`;
        conditions.push(lte(leaveRequests.startDate, monthEnd));
        conditions.push(gte(leaveRequests.endDate, monthStart));
      } else if (startDate && endDate) {
        conditions.push(lte(leaveRequests.startDate, endDate));
        conditions.push(gte(leaveRequests.endDate, startDate));
      }

      if (branchId) {
        conditions.push(eq(employees.branchId, branchId));
      }

      const list = await db
        .select({
          id: leaveRequests.id,
          employeeId: leaveRequests.employeeId,
          employeeName: sql<string>`concat(${employees.firstName}, ' ', ${employees.lastName})`,
          employeeCode: employees.employeeCode,
          leaveTypeId: leaveRequests.leaveTypeId,
          leaveTypeCode: leaveTypes.code,
          leaveTypeName: leaveTypes.name,
          isPaid: leaveTypes.isPaid,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          daysCount: leaveRequests.daysCount,
          status: leaveRequests.status,
          reason: leaveRequests.reason,
        })
        .from(leaveRequests)
        .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
        .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
        .where(and(...conditions))
        .orderBy(leaveRequests.startDate);

      return reply.send({ success: true, data: list });
    }
  );

  // 12. GET /api/hr/attendance
  fastify.get(
    '/attendance',
    { preHandler: [requirePermission('hr.attendance.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();
      const query = request.query as {
        employeeId?: string;
        startDate?: string;
        endDate?: string;
        branchId?: string;
      };

      const conditions = [eq(attendanceRecords.pharmacyId, pharmacyId)];

      if (query.employeeId) {
        conditions.push(eq(attendanceRecords.employeeId, query.employeeId));
      }
      if (query.startDate) {
        conditions.push(gte(attendanceRecords.date, query.startDate));
      }
      if (query.endDate) {
        conditions.push(lte(attendanceRecords.date, query.endDate));
      }
      if (query.branchId) {
        conditions.push(eq(attendanceRecords.branchId, query.branchId));
      }

      const records = await db
        .select({
          id: attendanceRecords.id,
          pharmacyId: attendanceRecords.pharmacyId,
          employeeId: attendanceRecords.employeeId,
          employeeName: sql<string>`concat(${employees.firstName}, ' ', ${employees.lastName})`,
          date: attendanceRecords.date,
          status: attendanceRecords.status,
          leaveRequestId: attendanceRecords.leaveRequestId,
          checkInTime: attendanceRecords.checkInTime,
          checkOutTime: attendanceRecords.checkOutTime,
          notes: attendanceRecords.notes,
        })
        .from(attendanceRecords)
        .innerJoin(employees, eq(attendanceRecords.employeeId, employees.id))
        .where(and(...conditions))
        .orderBy(attendanceRecords.date);

      return reply.send({ success: true, data: records });
    }
  );

  // 13. GET /api/hr/payroll/preview
  fastify.get(
    '/payroll/preview',
    { preHandler: [requirePermission('hr.payroll.view')] },
    async (request, reply) => {
      const { pharmacyId } = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = PayrollPreviewQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid payroll preview parameters',
        });
      }

      const { month, employeeId, workingDaysInMonth } = parsed.data;
      const monthStart = `${month}-01`;
      const monthEnd = `${month}-31`;

      const empFilter = employeeId
        ? and(eq(employees.pharmacyId, pharmacyId), eq(employees.id, employeeId))
        : and(eq(employees.pharmacyId, pharmacyId), eq(employees.isActive, true));

      const emps = await db.select().from(employees).where(empFilter);

      if (employeeId && emps.length === 0) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Employee not found',
        });
      }

      // Query approved leave requests in the month
      const approvedLeaves = await db
        .select({
          employeeId: leaveRequests.employeeId,
          isPaid: leaveTypes.isPaid,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          daysCount: leaveRequests.daysCount,
        })
        .from(leaveRequests)
        .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
        .where(
          and(
            eq(leaveRequests.pharmacyId, pharmacyId),
            eq(leaveRequests.status, 'approved'),
            lte(leaveRequests.startDate, monthEnd),
            gte(leaveRequests.endDate, monthStart)
          )
        );

      const payrollList = emps.map((emp) => {
        // Find leaves for this employee overlapping the month
        let paidDays = 0;
        let unpaidDays = 0;

        for (const req of approvedLeaves) {
          if (req.employeeId !== emp.id) continue;

          // Calculate overlap days in this month
          const effectiveStart = req.startDate < monthStart ? monthStart : req.startDate;
          const effectiveEnd = req.endDate > monthEnd ? monthEnd : req.endDate;
          const days = calculateLeaveDays(effectiveStart, effectiveEnd);

          if (req.isPaid) {
            paidDays += days;
          } else {
            unpaidDays += days;
          }
        }

        const deductionMath = calculateUnpaidLeaveDeduction(
          emp.salaryPaisa,
          unpaidDays,
          workingDaysInMonth
        );

        return {
          employeeId: emp.id,
          employeeCode: emp.employeeCode,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          designation: emp.designation,
          month,
          baseSalaryPaisa: emp.salaryPaisa,
          workingDaysInMonth,
          approvedPaidLeaveDays: paidDays,
          approvedUnpaidLeaveDays: unpaidDays,
          dailyRatePaisa: deductionMath.dailyRatePaisa,
          unpaidLeaveDeductionPaisa: deductionMath.deductionPaisa,
          grossSalaryPaisa: deductionMath.grossSalaryPaisa,
          netSalaryPaisa: deductionMath.netSalaryPaisa,
        };
      });

      if (employeeId) {
        return reply.send({ success: true, data: payrollList[0] });
      }

      return reply.send({ success: true, data: payrollList });
    }
  );
};
