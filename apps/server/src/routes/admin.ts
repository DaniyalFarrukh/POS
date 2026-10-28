import type { FastifyPluginAsync } from 'fastify';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { generateUuidV7 } from '@pos/shared';
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

interface CreateUserBody {
  name: string;
  role: 'owner' | 'pharmacist' | 'cashier';
  pin: string;
}

interface UpdateUserBody {
  role?: 'owner' | 'pharmacist' | 'cashier';
  isActive?: boolean;
}

interface CreateBranchBody {
  name: string;
  address?: string;
  phone?: string;
}

interface CreateCounterBody {
  branchId: string;
  name: string;
  code?: string;
}

interface CreateRegCodeBody {
  branchId: string;
  counterId: string;
  expiresInHours?: number;
}

interface AuditLogQuery {
  page?: string;
  limit?: string;
  entity?: string;
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // All admin routes strictly enforce owner role
  fastify.addHook('preHandler', requireUserAuth(['owner']));

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
    const { name, role, pin } = request.body || {};

    if (!name || !name.trim()) {
      return reply.status(400).send({ statusCode: 400, message: 'Name is required' });
    }
    if (!role || !['owner', 'pharmacist', 'cashier'].includes(role)) {
      return reply.status(400).send({ statusCode: 400, message: 'Invalid role' });
    }
    const pinRegex = role === 'owner' ? /^\d{8}$/ : /^\d{6,8}$/;
    if (!pin || !pinRegex.test(pin.trim())) {
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

  fastify.patch<{ Params: { id: string }; Body: UpdateUserBody }>('/users/:id', async (request, reply) => {
    const userContext = request.userContext!;
    const { id } = request.params;
    const { role, isActive } = request.body || {};

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
    const { id } = request.params;
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
    const { name, address, phone } = request.body || {};

    if (!name || !name.trim()) {
      return reply.status(400).send({ statusCode: 400, message: 'Branch name is required' });
    }

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
      .innerJoin(branches, eq(counters.branchId, branches.id))
      .where(eq(counters.pharmacyId, userContext.pharmacyId))
      .orderBy(asc(counters.name));

    return reply.status(200).send({ items: counterList });
  });

  fastify.post<{ Body: CreateCounterBody }>('/counters', async (request, reply) => {
    const userContext = request.userContext!;
    const { branchId, name, code } = request.body || {};

    if (!branchId || !name || !name.trim()) {
      return reply.status(400).send({ statusCode: 400, message: 'Branch ID and counter name are required' });
    }

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
      .leftJoin(branches, eq(devices.branchId, branches.id))
      .leftJoin(counters, eq(devices.counterId, counters.id))
      .where(eq(devices.pharmacyId, userContext.pharmacyId))
      .orderBy(desc(devices.createdAt));

    return reply.status(200).send({ items: deviceList });
  });

  fastify.patch<{ Params: { id: string }; Body: { isRevoked: boolean } }>('/devices/:id/revoke', async (request, reply) => {
    const userContext = request.userContext!;
    const { id } = request.params;
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

  fastify.post<{ Body: CreateRegCodeBody }>('/registration-codes', async (request, reply) => {
    const userContext = request.userContext!;
    const { branchId, counterId, expiresInHours = 24 } = request.body || {};

    if (!branchId || !counterId) {
      return reply.status(400).send({ statusCode: 400, message: 'branchId and counterId are required' });
    }

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
