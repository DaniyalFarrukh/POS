import bcrypt from 'bcryptjs';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import {
  generateUuidV7,
  type UserRole,
  type SetupInput,
  type PublicUser,
  type AuthSession,
  SetupInputSchema,
  LoginInputSchema,
  UnlockInputSchema,
  UserRoleSchema,
  PinSchema,
} from '@pos/shared';
import { getDatabase } from './db';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

let activeSession: AuthSession | null = null;

export function hashPin(pin: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(pin, salt);
}

export function verifyPin(pin: string, hash: string): boolean {
  return bcrypt.compareSync(pin, hash);
}

export function getSetupStatus(dbInstance?: DatabaseInstance): { needsSetup: boolean } {
  const db = dbInstance ?? getDatabase();
  const userRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  const branchRow = db.prepare('SELECT COUNT(*) as count FROM branches').get() as { count: number };

  return {
    needsSetup: userRow.count === 0 || branchRow.count === 0,
  };
}

export function completeSetup(data: SetupInput, dbInstance?: DatabaseInstance): AuthSession {
  const validated = SetupInputSchema.parse(data);
  const db = dbInstance ?? getDatabase();

  const now = new Date().toISOString();
  const branchId = generateUuidV7();
  const counterId = generateUuidV7();
  const ownerId = generateUuidV7();
  const hashedPin = hashPin(validated.pin);

  // Rule 5: Any write that touches more than one table happens in ONE transaction
  const setupTx = db.transaction(() => {
    // 1. Insert Branch
    db.prepare(`
      INSERT INTO branches (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(branchId, validated.branchName, now, now);

    // 2. Insert Counter
    db.prepare(`
      INSERT INTO counters (id, branch_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(counterId, branchId, validated.counterName, now, now);

    // 3. Insert Owner User
    db.prepare(`
      INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at)
      VALUES (?, ?, 'owner', ?, 1, ?, ?)
    `).run(ownerId, validated.ownerName, hashedPin, now, now);
  });

  setupTx();

  const session: AuthSession = {
    user: {
      id: ownerId,
      name: validated.ownerName,
      role: 'owner',
      isActive: true,
    },
    branch: {
      id: branchId,
      name: validated.branchName,
    },
    counter: {
      id: counterId,
      name: validated.counterName,
    },
    isLocked: false,
    idleTimeoutMinutes: 5,
  };

  activeSession = session;
  return session;
}

export function getUsers(dbInstance?: DatabaseInstance): PublicUser[] {
  const db = dbInstance ?? getDatabase();
  // Strictly avoid selecting pin_hash to guarantee hashes are never sent across IPC
  const rows = db
    .prepare('SELECT id, name, role, is_active FROM users WHERE is_active = 1 ORDER BY name ASC')
    .all() as { id: string; name: string; role: UserRole; is_active: number }[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    isActive: r.is_active === 1,
  }));
}

export function login(userId: string, pin: string, dbInstance?: DatabaseInstance): AuthSession {
  LoginInputSchema.parse({ userId, pin });
  const db = dbInstance ?? getDatabase();

  const user = db
    .prepare('SELECT id, name, role, pin_hash, is_active FROM users WHERE id = ?')
    .get(userId) as
    | { id: string; name: string; role: UserRole; pin_hash: string; is_active: number }
    | undefined;

  if (!user || user.is_active !== 1) {
    throw new AuthError('User not found or inactive');
  }

  const isValid = verifyPin(pin, user.pin_hash);
  if (!isValid) {
    throw new AuthError('Invalid PIN');
  }

  // Retrieve active branch and counter
  const counter = db
    .prepare('SELECT id, branch_id, name FROM counters ORDER BY created_at ASC LIMIT 1')
    .get() as { id: string; branch_id: string; name: string } | undefined;

  let branch: { id: string; name: string } = { id: generateUuidV7(), name: 'Main Branch' };
  let counterObj: { id: string; name: string } = { id: generateUuidV7(), name: 'Counter 1' };

  if (counter) {
    counterObj = { id: counter.id, name: counter.name };
    const branchRow = db
      .prepare('SELECT id, name FROM branches WHERE id = ?')
      .get(counter.branch_id) as { id: string; name: string } | undefined;
    if (branchRow) {
      branch = { id: branchRow.id, name: branchRow.name };
    }
  }

  const session: AuthSession = {
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      isActive: true,
    },
    branch,
    counter: counterObj,
    isLocked: false,
    idleTimeoutMinutes: 5,
  };

  activeSession = session;
  return session;
}

export function lockSession(): void {
  if (activeSession) {
    activeSession.isLocked = true;
  }
}

export function unlockSession(pin: string, dbInstance?: DatabaseInstance): AuthSession {
  UnlockInputSchema.parse({ pin });
  if (!activeSession) {
    throw new AuthError('No active session to unlock');
  }

  const db = dbInstance ?? getDatabase();
  const user = db
    .prepare('SELECT pin_hash FROM users WHERE id = ?')
    .get(activeSession.user.id) as { pin_hash: string } | undefined;

  if (!user) {
    throw new AuthError('User account not found');
  }

  if (!verifyPin(pin, user.pin_hash)) {
    throw new AuthError('Invalid PIN');
  }

  activeSession.isLocked = false;
  return activeSession;
}

export function logout(): void {
  activeSession = null;
}

export function getSession(): AuthSession | null {
  return activeSession;
}

export function setSessionForTesting(session: AuthSession | null): void {
  activeSession = session;
}

/**
 * Role guard helper for the IPC layer.
 * Enforces:
 * 1. An active session must exist (otherwise throws AuthError).
 * 2. Session must not be locked (otherwise throws AuthError).
 * 3. Session user's role must be in allowedRoles (otherwise throws ForbiddenError).
 */
export function assertRole(
  session: AuthSession | null,
  allowedRoles: UserRole[]
): AuthSession {
  if (!session) {
    throw new AuthError('Authentication required. Please log in.');
  }

  if (session.isLocked) {
    throw new AuthError('Session is locked. Please enter your PIN to continue.');
  }

  if (!allowedRoles.includes(session.user.role)) {
    throw new ForbiddenError(
      `Access denied: role '${session.user.role}' is not authorized. Required: ${allowedRoles.join(', ')}`
    );
  }

  return session;
}

export function requireRole<TArgs extends unknown[], TReturn>(
  allowedRoles: UserRole[],
  handler: (session: AuthSession, ...args: TArgs) => Promise<TReturn> | TReturn
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const session = assertRole(activeSession, allowedRoles);
    return handler(session, ...args);
  };
}

export interface StaffMember {
  id: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export interface CreateStaffInput {
  name: string;
  role: UserRole;
  pin: string;
}

export interface UpdateStaffInput {
  name?: string;
  role?: UserRole;
  pin?: string;
  isActive?: boolean;
}

export function getStaffList(
  sessionOverride?: AuthSession | null,
  dbInstance?: DatabaseInstance
): StaffMember[] {
  const session = sessionOverride !== undefined ? sessionOverride : activeSession;
  assertRole(session, ['owner']);

  const db = dbInstance ?? getDatabase();
  const rows = db
    .prepare('SELECT id, name, role, is_active, created_at FROM users ORDER BY created_at ASC')
    .all() as {
      id: string;
      name: string;
      role: UserRole;
      is_active: number;
      created_at: string;
    }[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
  }));
}

export function createStaffMember(
  input: CreateStaffInput,
  sessionOverride?: AuthSession | null,
  dbInstance?: DatabaseInstance
): StaffMember {
  const session = sessionOverride !== undefined ? sessionOverride : activeSession;
  assertRole(session, ['owner']);

  const trimmedName = input.name ? input.name.trim() : '';
  if (trimmedName.length < 2) {
    throw new AuthError('Staff member name must be at least 2 characters');
  }

  UserRoleSchema.parse(input.role);
  PinSchema.parse(input.pin);

  const db = dbInstance ?? getDatabase();
  const id = generateUuidV7();
  const now = new Date().toISOString();
  const hashedPin = hashPin(input.pin);

  db.prepare(`
    INSERT INTO users (id, name, role, pin_hash, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).run(id, trimmedName, input.role, hashedPin, now, now);

  return {
    id,
    name: trimmedName,
    role: input.role,
    isActive: true,
    createdAt: now,
  };
}

export function updateStaffMember(
  id: string,
  input: UpdateStaffInput,
  sessionOverride?: AuthSession | null,
  dbInstance?: DatabaseInstance
): StaffMember {
  const session = sessionOverride !== undefined ? sessionOverride : activeSession;
  assertRole(session, ['owner']);

  const db = dbInstance ?? getDatabase();
  const existing = db
    .prepare('SELECT id, name, role, is_active, created_at FROM users WHERE id = ?')
    .get(id) as
    | { id: string; name: string; role: UserRole; is_active: number; created_at: string }
    | undefined;

  if (!existing) {
    throw new AuthError('Staff member not found');
  }

  // Safety guard: cannot deactivate yourself or strip yourself of owner role
  if (session && session.user.id === id) {
    if (input.isActive === false) {
      throw new AuthError('You cannot deactivate your own active owner account');
    }
    if (input.role && input.role !== 'owner') {
      throw new AuthError('You cannot change your own role away from owner');
    }
  }

  if (input.role) {
    UserRoleSchema.parse(input.role);
  }

  if (input.pin) {
    PinSchema.parse(input.pin);
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  const now = new Date().toISOString();

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length < 2) throw new AuthError('Staff member name must be at least 2 characters');
    updates.push('name = ?');
    params.push(trimmed);
  }

  if (input.role !== undefined) {
    updates.push('role = ?');
    params.push(input.role);
  }

  if (input.isActive !== undefined) {
    updates.push('is_active = ?');
    params.push(input.isActive ? 1 : 0);
  }

  if (input.pin !== undefined) {
    updates.push('pin_hash = ?');
    params.push(hashPin(input.pin));
  }

  if (updates.length === 0) {
    return {
      id: existing.id,
      name: existing.name,
      role: existing.role,
      isActive: existing.is_active === 1,
      createdAt: existing.created_at,
    };
  }

  updates.push('updated_at = ?');
  params.push(now);

  params.push(id);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db
    .prepare('SELECT id, name, role, is_active, created_at FROM users WHERE id = ?')
    .get(id) as { id: string; name: string; role: UserRole; is_active: number; created_at: string };

  return {
    id: updated.id,
    name: updated.name,
    role: updated.role,
    isActive: updated.is_active === 1,
    createdAt: updated.created_at,
  };
}

