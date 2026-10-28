import type { FastifyPluginAsync } from 'fastify';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { generateUuidV7, z } from '@pos/shared';
import {
  users,
  branches,
  counters,
  devices,
  deviceRegistrationCodes,
  changeLog,
} from '../db/schema';
import { requireUserAuth } from '../auth/user-auth';
import { hashRegistrationCode, generatePlainRegistrationCode } from '../auth/jwt';
import { getDb } from '../db';
import { insertChangeLog } from '../sync/change-log';

const IdParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

const CreateUserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['owner', 'pharmacist', 'cashier']),
  pin: z.string().min(6).max(8),
});

const UpdateUserSchema = z.object({
  role: z.enum(['owner', 'pharmacist', 'cashier']).optional(),
  isActive: z.boolean().optional(),
});

const CreateBranchSchema = z.object({
  name: z.string().min(1, 'Branch name is required'),
  address: z.string().optional(),
  phone: z.string().optional(),
});

const CreateCounterSchema = z.object({
  branchId: z.string().uuid('Valid branchId is required'),
  name: z.string().min(1, 'Counter name is required'),
  code: z.string().optional(),
});

const CreateRegCodeSchema = z.object({
  branchId: z.string().uuid('Valid branchId is required'),
  counterId: z.string().uuid('Valid counterId is required'),
  expiresInHours: z.number().int().positive().optional().default(24),
});

type CreateUserBody = z.infer<typeof CreateUserSchema>;
type CreateBranchBody = z.infer<typeof CreateBranchSchema>;

interface AuditLogQuery {
  page?: string;
  limit?: string;
  entity?: string;
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // All admin routes enforce owner role; GET /branches permits pharmacist for report filtering (M-10)
  fastify.addHook('preHandler', async (request, reply) => {
    const isBranchesGet =
      request.method === 'GET' && request.url.includes('/branches');
    const allowedRoles: ('owner' | 'pharmacist')[] = isBranchesGet ? ['owner', 'pharmacist'] : ['owner'];
    return requireUserAuth(allowedRoles)(request, reply);
  });

  // -------------------------------------------------------------------------
  // 1. User Management
  // -------------------------------------------------------------------------
  fastify.get('/users', async (request, reply) => {
    const userContext = request.userContext!;
    const db = request.server.db || getDb();

    const userList = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.pharmacyId, userContext.pharmacyId))
      .orderBy(desc(users.createdAt));

    return reply.status(200).send({ items: userList });
  });

  fastify.post<{ Body: CreateUserBody }>('/users', async (request, reply) => {
    const userContext = request.userContext!;
    const parsed = CreateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        message: parsed.error.issues[0]?.message || 'Invalid user input',
      });
    }
    const { name, role, pin } = parsed.data;

    const pinRegex = role === 'owner' ? /^\d{8}$/ : /^\d{6,8}$/;
    if (!pinRegex.test(pin.trim())) {
      const msg = role === 'owner' ? 'Owner PIN must be exactly 8 digits' : 'PIN must be between 6 and 8 digits';
      return reply.status(400).send({ statusCode: 400, message: msg });
    }

    const db = request.server.db || getDb();
    const userId = generateUuidV7();
    const now = new Date().toISOString();
    const pinHash = await bcrypt.hash(pin.trim(), 10);

    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        pharmacyId: userContext.pharmacyId,
        name: name.trim(),
        role,
        pinHash,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      await insertChangeLog(tx, {
        pharmacyId: userContext.pharmacyId,
        entity: 'user',
        entityId: userId,
        op: 'upsert',
        data: { id: userId, name: name.trim(), role, pinHash, isActive: true },
        createdAt: now,
      });
    });

    return reply.status(201).send({
      id: userId,
      name: name.trim(),
      role,
      isActive: true,
    });
  });

  fastify.patch<{ Params: { id: string }; Body: { role?: 'owner' | 'pharmacist' | 'cashier'; isActive?: boolean } }>('/users/:id', async (request, reply) => {
    const userContext = request.userContext!;
    const paramParsed = IdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.status(400).send({ statusCode: 400, message: 'Invalid ID format' });
    }
    const { id } = paramParsed.data;

    const bodyParsed = UpdateUserSchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        message: bodyParsed.error.issues[0]?.message || 'Invalid update input',
      });
    }
    const { role, isActive } = bodyParsed.data;

    const db = request.server.db || getDb();
    const now = new Date().toISOString();

    const updateFields: Record<string, unknown> = { updatedAt: now };
    if (role && ['owner', 'pharmacist', 'cashier'].includes(role)) {
      updateFields.role = role;
    }
    if (typeof isActive === 'boolean') {
      updateFields.isActive = isActive;
    }

    const updatedUser = await db.transaction(async (tx) => {
      const updatedUsers = await tx
        .update(users)
        .set(updateFields)
        .where(and(eq(users.id, id), eq(users.pharmacyId, userContext.pharmacyId)))
        .returning({
          id: users.id,
          name: users.name,
          role: users.role,
          isActive: users.isActive,
          pinHash: users.pinHash,
        });

      if (updatedUsers.length === 0) {
        return null;
      }

      const u = updatedUsers[0]!;
      await insertChangeLog(tx, {
        pharmacyId: userContext.pharmacyId,
        entity: 'user',
        entityId: u.id,
        op: 'upsert',
        data: {
          id: u.id,
          name: u.name,
          role: u.role,
          isActive: u.isActive,
          pinHash: u.pinHash,
        },
        createdAt: now,
      });

      return u;
    });

    if (!updatedUser) {
      return reply.status(404).send({ statusCode: 404, message: 'User not found or belongs to another pharmacy' });
    }

    return reply.status(200).send({ ok: true });
  });

  fastify.post<{ Params: { id: string } }>('/users/:id/unlock', async (request, reply) => {
    const userContext = request.userContext!;
    const paramParsed = IdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.status(400).send({ statusCode: 400, message: 'Invalid ID format' });
    }
    const { id } = paramParsed.data;
    const db = request.server.db || getDb();
    const now = new Date().toISOString();

    const updatedUsers = await db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(and(eq(users.id, id), eq(users.pharmacyId, userContext.pharmacyId)))
      .returning({ id: users.id });

    if (updatedUsers.length === 0) {
      return reply.status(404).send({ statusCode: 404, message: 'User not found or belongs to another pharmacy' });
    }

    return reply.status(200).send({ ok: true, message: 'User account unlocked' });
  });

  // -------------------------------------------------------------------------
  // 2. Branch & Counter Management
  // -------------------------------------------------------------------------
  fastify.get('/branches', async (request, reply) => {
    const userContext = request.userContext!;
    const db = request.server.db || getDb();

    const branchList = await db
      .select({
        id: branches.id,
        name: branches.name,
        address: branches.address,
        phone: branches.phone,
        createdAt: branches.createdAt,
      })
      .from(branches)
      .where(eq(branches.pharmacyId, userContext.pharmacyId))
      .orderBy(asc(branches.name));

    return reply.status(200).send({ items: branchList });
  });

  fastify.post<{ Body: CreateBranchBody }>('/branches', async (request, reply) => {
    const userContext = request.userContext!;
    const parsed = CreateBranchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        message: parsed.error.issues[0]?.message || 'Invalid branch input',
      });
    }
    const { name, address, phone } = parsed.data;

    const db = request.server.db || getDb();
    const branchId = generateUuidV7();
    const now = new Date().toISOString();

    await db.transaction(async (tx) => {
      await tx.insert(branches).values({
        id: branchId,
        pharmacyId: userContext.pharmacyId,
        name: name.trim(),
        address: address?.trim() ?? null,
        phone: phone?.trim() ?? null,
        createdAt: now,
        updatedAt: now,
      });

      await insertChangeLog(tx, {
        pharmacyId: userContext.pharmacyId,
        entity: 'branch',
        entityId: branchId,
        op: 'upsert',
        data: { id: branchId, name: name.trim() },
        createdAt: now,
      });
    });

    return reply.status(201).send({ id: branchId, name: name.trim() });
  });

  fastify.get('/counters', async (request, reply) => {
    const userContext = request.userContext!;
    const db = request.server.db || getDb();

    const counterList = await db
      .select({
        id: counters.id,
        branchId: counters.branchId,
        branchName: branches.name,
        name: counters.name,
        code: counters.code,
        lastInvoiceSeq: counters.lastInvoiceSeq,
        createdAt: counters.createdAt,
      })
      .from(counters)
      .innerJoin(
        branches,
        and(eq(counters.branchId, branches.id), eq(branches.pharmacyId, userContext.pharmacyId))
      )
      .where(eq(counters.pharmacyId, userContext.pharmacyId))
      .orderBy(asc(counters.name));

    return reply.status(200).send({ items: counterList });
  });

  fastify.post<{ Body: { branchId: string; name: string; code?: string } }>('/counters', async (request, reply) => {
    const userContext = request.userContext!;
    const parsed = CreateCounterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid counter input' });
    }
    const { branchId, name, code } = parsed.data;

    const db = request.server.db || getDb();
    const counterId = generateUuidV7();
    const now = new Date().toISOString();
    const codeVal = code?.trim().toUpperCase() || 'C1';

    const created = await db.transaction(async (tx) => {
      // Verify branch belongs to caller's pharmacy tenant
      const [branch] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.pharmacyId, userContext.pharmacyId)))
        .limit(1);

      if (!branch) {
        return null;
      }

      await tx.insert(counters).values({
        id: counterId,
        pharmacyId: userContext.pharmacyId,
        branchId,
        name: name.trim(),
        code: codeVal,
        lastInvoiceSeq: 0,
        lastCreditNoteSeq: 0,
        createdAt: now,
        updatedAt: now,
      });

      await insertChangeLog(tx, {
        pharmacyId: userContext.pharmacyId,
        branchId,
        entity: 'counter',
        entityId: counterId,
        op: 'upsert',
        data: { id: counterId, branchId, name: name.trim(), code: codeVal },
        createdAt: now,
      });

      return counterId;
    });

    if (!created) {
      return reply.status(404).send({ statusCode: 404, message: 'Branch not found or belongs to another pharmacy' });
    }

    return reply.status(201).send({ id: counterId, name: name.trim(), code: codeVal });
  });

  // -------------------------------------------------------------------------
  // 3. Registered Devices
  // -------------------------------------------------------------------------
  fastify.get('/devices', async (request, reply) => {
    const userContext = request.userContext!;
    const db = request.server.db || getDb();

    const deviceList = await db
      .select({
        id: devices.id,
        deviceName: devices.deviceName,
        branchId: devices.branchId,
        branchName: branches.name,
        counterId: devices.counterId,
        counterName: counters.name,
        counterCode: counters.code,
        isRevoked: devices.isRevoked,
        lastSeenAt: devices.lastSeenAt,
        createdAt: devices.createdAt,
      })
      .from(devices)
      .leftJoin(
        branches,
        and(eq(devices.branchId, branches.id), eq(branches.pharmacyId, userContext.pharmacyId))
      )
      .leftJoin(
        counters,
        and(eq(devices.counterId, counters.id), eq(counters.pharmacyId, userContext.pharmacyId))
      )
      .where(eq(devices.pharmacyId, userContext.pharmacyId))
      .orderBy(desc(devices.createdAt));

    return reply.status(200).send({ items: deviceList });
  });

  fastify.patch<{ Params: { id: string }; Body: { isRevoked: boolean } }>('/devices/:id/revoke', async (request, reply) => {
    const userContext = request.userContext!;
    const paramParsed = IdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      return reply.status(400).send({ statusCode: 400, message: 'Invalid ID format' });
    }
    const { id } = paramParsed.data;
    const { isRevoked } = request.body || {};

    const db = request.server.db || getDb();
    const now = new Date().toISOString();

    const updatedDevices = await db
      .update(devices)
      .set({ isRevoked: Boolean(isRevoked), updatedAt: now })
      .where(and(eq(devices.id, id), eq(devices.pharmacyId, userContext.pharmacyId)))
      .returning({ id: devices.id });

    if (updatedDevices.length === 0) {
      return reply.status(404).send({ statusCode: 404, message: 'Device not found or belongs to another pharmacy' });
    }

    return reply.status(200).send({ ok: true, isRevoked: Boolean(isRevoked) });
  });

  fastify.post<{ Body: { branchId: string; counterId: string; expiresInHours?: number } }>('/registration-codes', async (request, reply) => {
    const userContext = request.userContext!;
    const parsed = CreateRegCodeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ statusCode: 400, message: parsed.error.issues[0]?.message || 'Invalid registration code input' });
    }
    const { branchId, counterId, expiresInHours } = parsed.data;

    const db = request.server.db || getDb();

    // Verify branch belongs to caller's pharmacy tenant
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.pharmacyId, userContext.pharmacyId)))
      .limit(1);

    if (!branch) {
      return reply.status(404).send({ statusCode: 404, message: 'Branch not found or belongs to another pharmacy' });
    }

    // Verify counter belongs to caller's pharmacy tenant and to the specified branch
    const [counter] = await db
      .select({ id: counters.id })
      .from(counters)
      .where(
        and(
          eq(counters.id, counterId),
          eq(counters.pharmacyId, userContext.pharmacyId),
          eq(counters.branchId, branchId)
        )
      )
      .limit(1);

    if (!counter) {
      return reply.status(404).send({ statusCode: 404, message: 'Counter not found or does not belong to specified branch' });
    }

    const plainCode = generatePlainRegistrationCode();
    const codeHash = hashRegistrationCode(plainCode);
    const codeId = generateUuidV7();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInHours * 3600000).toISOString();

    await db.insert(deviceRegistrationCodes).values({
      id: codeId,
      pharmacyId: userContext.pharmacyId,
      branchId,
      counterId,
      codeHash,
      expiresAt,
      createdAt: now.toISOString(),
    });

    return reply.status(201).send({
      id: codeId,
      code: plainCode,
      expiresAt,
    });
  });

  // -------------------------------------------------------------------------
  // 4. Audit Log Viewer (Read-only timeline of change_log records)
  // -------------------------------------------------------------------------
  fastify.get<{ Querystring: AuditLogQuery }>('/audit-logs', async (request, reply) => {
    const userContext = request.userContext!;
    const db = request.server.db || getDb();

    const page = Math.max(1, parseInt(request.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const conditions = [eq(changeLog.pharmacyId, userContext.pharmacyId)];
    if (request.query.entity) {
      conditions.push(eq(changeLog.entity, request.query.entity));
    }

    const [countRow] = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(changeLog)
      .where(and(...conditions));

    const total = Number(countRow?.total ?? 0);

    const logs = await db
      .select({
        seq: changeLog.seq,
        entity: changeLog.entity,
        entityId: changeLog.entityId,
        op: changeLog.op,
        data: changeLog.data,
        createdAt: changeLog.createdAt,
      })
      .from(changeLog)
      .where(and(...conditions))
      .orderBy(desc(changeLog.seq))
      .limit(limit)
      .offset(offset);

    return reply.status(200).send({
      items: logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  });
};
