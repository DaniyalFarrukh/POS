import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { MIGRATIONS } from './db';
import {
  hashPin,
  verifyPin,
  getSetupStatus,
  completeSetup,
  getUsers,
  login,
  lockSession,
  unlockSession,
  logout,
  getSession,
  assertRole,
  requireRole,
  setSessionForTesting,
  getStaffList,
  createStaffMember,
  updateStaffMember,
  AuthError,
  ForbiddenError,
} from './auth';
import { generateUuidV7 } from '@pos/shared';

describe('Local Authentication & IPC Role Guard', () => {
  let rawDb: DatabaseInstance;

  beforeEach(() => {
    logout();
    rawDb = new Database(':memory:');
    rawDb.pragma('foreign_keys = ON');

    // Run migrations
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const m of MIGRATIONS) {
      m.up(rawDb);
      rawDb
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, new Date().toISOString());
    }
  });

  describe('bcryptjs PIN Hashing', () => {
    it('correctly hashes and validates numeric PINs', async () => {
      const pin = '123456';
      const hash = await hashPin(pin);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(pin);
      expect(hash.startsWith('$2a$') || hash.startsWith('$2b$')).toBe(true);

      expect(await verifyPin('123456', hash)).toBe(true);
      expect(await verifyPin('999999', hash)).toBe(false);
      expect(await verifyPin('1234567', hash)).toBe(false);
    });
  });

  describe('First-run Setup', () => {
    it('detects fresh setup requirement and creates branch, counter, and owner in one transaction', async () => {
      // 1. Initially needs setup
      expect(getSetupStatus(rawDb)).toEqual({ needsSetup: true });

      // 2. Complete setup
      const session = await completeSetup(
        {
          branchName: 'City Pharmacy - Saddar',
          counterName: 'Counter 01',
          ownerName: 'Dr. Tariq',
          pin: '12345678',
        },
        rawDb
      );

      expect(session).toBeDefined();
      expect(session.user.name).toBe('Dr. Tariq');
      expect(session.user.role).toBe('owner');
      expect(session.branch.name).toBe('City Pharmacy - Saddar');
      expect(session.counter.name).toBe('Counter 01');
      expect(session.isLocked).toBe(false);

      // 3. Needs setup is now false
      expect(getSetupStatus(rawDb)).toEqual({ needsSetup: false });

      // 4. Verify DB records
      const branchRow = rawDb.prepare('SELECT name FROM branches').get() as { name: string };
      const counterRow = rawDb.prepare('SELECT name FROM counters').get() as { name: string };
      const userRow = rawDb
        .prepare('SELECT name, role, pin_hash FROM users')
        .get() as { name: string; role: string; pin_hash: string };

      expect(branchRow.name).toBe('City Pharmacy - Saddar');
      expect(counterRow.name).toBe('Counter 01');
      expect(userRow.name).toBe('Dr. Tariq');
      expect(userRow.role).toBe('owner');
      expect(await verifyPin('12345678', userRow.pin_hash)).toBe(true);

      // 5. Rule 6: getUsers() never returns pin_hash
      const users = getUsers(rawDb);
      expect(users).toHaveLength(1);
      const firstUser = users[0];
      expect(firstUser).toBeDefined();
      if (!firstUser) throw new Error('Expected first user');
      expect(firstUser.name).toBe('Dr. Tariq');
      expect(firstUser.role).toBe('owner');
      expect(firstUser).not.toHaveProperty('pin_hash');
      expect(firstUser).not.toHaveProperty('pinHash');
    });
  });

  describe('User Login & Session Management', () => {
    let ownerId: string;
    let pharmacistId: string;
    let cashierId: string;

    beforeEach(async () => {
      const now = new Date().toISOString();
      const branchId = generateUuidV7();
      const counterId = generateUuidV7();
      ownerId = generateUuidV7();
      pharmacistId = generateUuidV7();
      cashierId = generateUuidV7();

      rawDb
        .prepare('INSERT INTO branches (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(branchId, 'Main Branch', now, now);
      rawDb
        .prepare(
          'INSERT INTO counters (id, branch_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(counterId, branchId, 'Counter 1', now, now);

      rawDb
        .prepare(
          'INSERT INTO users (id, name, role, pin_hash, is_active, failed_login_attempts, locked_until, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, NULL, ?, ?)'
        )
        .run(ownerId, 'Owner User', 'owner', await hashPin('11112222'), now, now);

      rawDb
        .prepare(
          'INSERT INTO users (id, name, role, pin_hash, is_active, failed_login_attempts, locked_until, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, NULL, ?, ?)'
        )
        .run(pharmacistId, 'Pharmacist User', 'pharmacist', await hashPin('222233'), now, now);

      rawDb
        .prepare(
          'INSERT INTO users (id, name, role, pin_hash, is_active, failed_login_attempts, locked_until, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, NULL, ?, ?)'
        )
        .run(cashierId, 'Cashier User', 'cashier', await hashPin('333344'), now, now);
    });

    it('logs in successfully with valid PIN and updates active session', async () => {
      const session = await login(cashierId, '333344', rawDb);
      expect(session.user.id).toBe(cashierId);
      expect(session.user.role).toBe('cashier');
      expect(session.isLocked).toBe(false);
      expect(getSession()?.user.id).toBe(cashierId);
    });

    it('rejects invalid PIN with AuthError', async () => {
      await expect(login(cashierId, '999999', rawDb)).rejects.toThrow(AuthError);
      await expect(login(cashierId, '999999', rawDb)).rejects.toThrow(/Invalid PIN/);
      expect(getSession()).toBeNull();
    });

    it('locks and unlocks session with user PIN', async () => {
      await login(pharmacistId, '222233', rawDb);
      expect(getSession()?.isLocked).toBe(false);

      // Lock session
      lockSession();
      expect(getSession()?.isLocked).toBe(true);

      // Attempt unlocking with wrong PIN
      await expect(unlockSession('000000', rawDb)).rejects.toThrow(/Invalid PIN/);
      expect(getSession()?.isLocked).toBe(true);

      // Unlock with correct PIN
      const unlocked = await unlockSession('222233', rawDb);
      expect(unlocked.isLocked).toBe(false);
      expect(getSession()?.isLocked).toBe(false);
    });
  });

  describe('IPC Role Guard: requireRole() and assertRole()', () => {
    it('rejects calls when no session is active', async () => {
      logout();
      const protectedHandler = requireRole(['owner'], async () => 'secret_data');
      await expect(protectedHandler()).rejects.toThrow(AuthError);
      await expect(protectedHandler()).rejects.toThrow(/Authentication required/);
    });

    it('rejects calls when session is auto-locked', async () => {
      setSessionForTesting({
        user: { id: generateUuidV7(), name: 'Tariq', role: 'owner', isActive: true },
        branch: { id: generateUuidV7(), name: 'B1' },
        counter: { id: generateUuidV7(), name: 'C1' },
        isLocked: true,
        idleTimeoutMinutes: 5,
      });

      const protectedHandler = requireRole(['owner'], async () => 'data');
      await expect(protectedHandler()).rejects.toThrow(AuthError);
      await expect(protectedHandler()).rejects.toThrow(/Session is locked/);
    });

    it('validates session and role directly via assertRole()', () => {
      const validSession = {
        user: { id: generateUuidV7(), name: 'Tariq', role: 'owner' as const, isActive: true },
        branch: { id: generateUuidV7(), name: 'B1' },
        counter: { id: generateUuidV7(), name: 'C1' },
        isLocked: false,
        idleTimeoutMinutes: 5,
      };

      expect(assertRole(validSession, ['owner'])).toBe(validSession);
      expect(() => assertRole(null, ['owner'])).toThrow(AuthError);
      expect(() => assertRole({ ...validSession, isLocked: true }, ['owner'])).toThrow(AuthError);
      expect(() => assertRole(validSession, ['cashier'])).toThrow(ForbiddenError);
    });

    it('enforces cashier role restrictions', async () => {
      setSessionForTesting({
        user: { id: generateUuidV7(), name: 'Bilal', role: 'cashier', isActive: true },
        branch: { id: generateUuidV7(), name: 'B1' },
        counter: { id: generateUuidV7(), name: 'C1' },
        isLocked: false,
        idleTimeoutMinutes: 5,
      });

      // Cashier can sell
      const sellHandler = requireRole(['cashier', 'pharmacist', 'owner'], async () => 'sale_ok');
      await expect(sellHandler()).resolves.toBe('sale_ok');

      // Cashier CANNOT manage products or stock
      const productHandler = requireRole(['pharmacist', 'owner'], async () => 'product_saved');
      await expect(productHandler()).rejects.toThrow(ForbiddenError);
      await expect(productHandler()).rejects.toThrow(/Access denied: role 'cashier' is not authorized/);

      // Cashier CANNOT manage users
      const userHandler = requireRole(['owner'], async () => 'user_created');
      await expect(userHandler()).rejects.toThrow(ForbiddenError);
    });

    it('enforces pharmacist role restrictions', async () => {
      setSessionForTesting({
        user: { id: generateUuidV7(), name: 'Dr. Ayesha', role: 'pharmacist', isActive: true },
        branch: { id: generateUuidV7(), name: 'B1' },
        counter: { id: generateUuidV7(), name: 'C1' },
        isLocked: false,
        idleTimeoutMinutes: 5,
      });

      // Pharmacist can sell
      const sellHandler = requireRole(['cashier', 'pharmacist', 'owner'], async () => 'sale_ok');
      await expect(sellHandler()).resolves.toBe('sale_ok');

      // Pharmacist can manage products and stock
      const productHandler = requireRole(['pharmacist', 'owner'], async () => 'product_saved');
      await expect(productHandler()).resolves.toBe('product_saved');

      // Pharmacist CANNOT manage users
      const userHandler = requireRole(['owner'], async () => 'user_created');
      await expect(userHandler()).rejects.toThrow(ForbiddenError);
      await expect(userHandler()).rejects.toThrow(/Access denied: role 'pharmacist' is not authorized/);
    });

    it('permits owner role for all actions', async () => {
      setSessionForTesting({
        user: { id: generateUuidV7(), name: 'Owner Tariq', role: 'owner', isActive: true },
        branch: { id: generateUuidV7(), name: 'B1' },
        counter: { id: generateUuidV7(), name: 'C1' },
        isLocked: false,
        idleTimeoutMinutes: 5,
      });

      const sellHandler = requireRole(['cashier', 'pharmacist', 'owner'], async () => 'sell_ok');
      const productHandler = requireRole(['pharmacist', 'owner'], async () => 'product_ok');
      const userHandler = requireRole(['owner'], async () => 'user_ok');

      await expect(sellHandler()).resolves.toBe('sell_ok');
      await expect(productHandler()).resolves.toBe('product_ok');
      await expect(userHandler()).resolves.toBe('user_ok');
    });
  });

  describe('Staff & Roles Management', () => {
    let ownerSession: Awaited<ReturnType<typeof completeSetup>>;

    beforeEach(async () => {
      ownerSession = await completeSetup(
        {
          branchName: 'City Pharmacy - Saddar',
          counterName: 'Counter 01',
          ownerName: 'Dr. Tariq',
          pin: '12345678',
        },
        rawDb
      );
      setSessionForTesting(ownerSession);
    });

    it('lists all staff members including created date and role', () => {
      const staff = getStaffList(ownerSession, rawDb);
      expect(staff).toHaveLength(1);
      expect(staff[0]!.name).toBe('Dr. Tariq');
      expect(staff[0]!.role).toBe('owner');
      expect(staff[0]!.isActive).toBe(true);
      expect((staff[0] as unknown as { pin_hash?: string }).pin_hash).toBeUndefined();
    });

    it('creates new cashier and pharmacist staff members with hashed PIN', async () => {
      const cashier = await createStaffMember(
        {
          name: 'Bilal Cashier',
          role: 'cashier',
          pin: '123456',
        },
        ownerSession,
        rawDb
      );

      expect(cashier.id).toBeDefined();
      expect(cashier.name).toBe('Bilal Cashier');
      expect(cashier.role).toBe('cashier');
      expect(cashier.isActive).toBe(true);

      const pharmacist = await createStaffMember(
        {
          name: 'Sara Pharmacist',
          role: 'pharmacist',
          pin: '567890',
        },
        ownerSession,
        rawDb
      );

      expect(pharmacist.name).toBe('Sara Pharmacist');
      expect(pharmacist.role).toBe('pharmacist');

      const all = getStaffList(ownerSession, rawDb);
      expect(all).toHaveLength(3);

      // Verify created cashier can log in
      const cashierSession = await login(cashier.id, '123456', rawDb);
      expect(cashierSession.user.name).toBe('Bilal Cashier');
      expect(cashierSession.user.role).toBe('cashier');
    });

    it('updates staff member role and PIN', async () => {
      const staff = await createStaffMember(
        {
          name: 'Kamran Ali',
          role: 'cashier',
          pin: '112233',
        },
        ownerSession,
        rawDb
      );

      // Promote to pharmacist and update PIN
      const updated = await updateStaffMember(
        staff.id,
        {
          role: 'pharmacist',
          pin: '998877',
        },
        ownerSession,
        rawDb
      );

      expect(updated.role).toBe('pharmacist');

      // Old PIN fails, new PIN succeeds
      await expect(login(staff.id, '112233', rawDb)).rejects.toThrow(AuthError);
      const newSession = await login(staff.id, '998877', rawDb);
      expect(newSession.user.role).toBe('pharmacist');
    });

    it('prevents owner from deactivating or demoting their own active account', async () => {
      await expect(
        updateStaffMember(
          ownerSession.user.id,
          { isActive: false },
          ownerSession,
          rawDb
        )
      ).rejects.toThrow(AuthError);

      await expect(
        updateStaffMember(
          ownerSession.user.id,
          { role: 'cashier' },
          ownerSession,
          rawDb
        )
      ).rejects.toThrow(AuthError);
    });

    it('forbids cashier or pharmacist from managing staff accounts', async () => {
      const cashierSession = {
        user: { id: generateUuidV7(), name: 'Cashier 1', role: 'cashier' as const, isActive: true },
        branch: { id: generateUuidV7(), name: 'B1' },
        counter: { id: generateUuidV7(), name: 'C1' },
        isLocked: false,
        idleTimeoutMinutes: 5,
      };

      expect(() => getStaffList(cashierSession, rawDb)).toThrow(ForbiddenError);
      await expect(
        createStaffMember(
          { name: 'Test', role: 'cashier', pin: '123456' },
          cashierSession,
          rawDb
        )
      ).rejects.toThrow(ForbiddenError);
    });
  });
});

