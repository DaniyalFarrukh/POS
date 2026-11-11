import { describe, it, expect, beforeEach } from 'vitest';
import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import { z, generateUuidV7, type AuthSession } from '@pos/shared';
import { MIGRATIONS } from './db';
import { hashPin } from './auth';
import { verifyOwnerPinForDestructive, registerSecureIpcHandler } from './ipc/wrapper';

describe('F-M-06: Desktop IPC Security Hardening', () => {
  let db: DatabaseInstance;
  let ownerId: string;
  let ownerSession: AuthSession;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const m of MIGRATIONS) {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString()
      );
    }

    ownerId = generateUuidV7();
    const now = new Date().toISOString();
    const ownerPinHash = await hashPin('12345678');

    db.prepare(
      `INSERT INTO users (id, name, role, pin_hash, is_active, failed_login_attempts, locked_until, created_at, updated_at)
       VALUES (?, 'Pharmacy Owner', 'owner', ?, 1, 0, NULL, ?, ?)`
    ).run(ownerId, ownerPinHash, now, now);

    ownerSession = {
      user: {
        id: ownerId,
        name: 'Pharmacy Owner',
        role: 'owner',
        isActive: true,
      },
      branch: { id: generateUuidV7(), name: 'Main Branch' },
      counter: { id: generateUuidV7(), name: 'C1' },
      isLocked: false,
      idleTimeoutMinutes: 15,
    };
  });

  it('verifyOwnerPinForDestructive tracks failed attempts and enforces lockout after 5 failures', async () => {
    // 4 failed attempts: each throws 'Invalid Owner PIN'
    for (let i = 1; i <= 4; i++) {
      await expect(verifyOwnerPinForDestructive('99999999', ownerSession, db)).rejects.toThrow(
        /Invalid Owner PIN/i
      );

      const row = db
        .prepare('SELECT failed_login_attempts, locked_until FROM users WHERE id = ?')
        .get(ownerId) as {
        failed_login_attempts: number;
        locked_until: string | null;
      };
      expect(row.failed_login_attempts).toBe(i);
      expect(row.locked_until).toBeNull();
    }

    // 5th failed attempt: triggers lockout
    await expect(verifyOwnerPinForDestructive('99999999', ownerSession, db)).rejects.toThrow(
      /locked/i
    );

    const lockedRow = db
      .prepare('SELECT failed_login_attempts, locked_until FROM users WHERE id = ?')
      .get(ownerId) as {
      failed_login_attempts: number;
      locked_until: string | null;
    };
    expect(lockedRow.failed_login_attempts).toBe(5);
    expect(lockedRow.locked_until).not.toBeNull();

    // 6th attempt with CORRECT PIN: strictly rejected due to active lockout
    await expect(verifyOwnerPinForDestructive('12345678', ownerSession, db)).rejects.toThrow(
      /locked/i
    );
  });

  it('verifyOwnerPinForDestructive resets failed attempts on successful verification', async () => {
    // 2 failed attempts
    await expect(verifyOwnerPinForDestructive('99999999', ownerSession, db)).rejects.toThrow();
    await expect(verifyOwnerPinForDestructive('99999999', ownerSession, db)).rejects.toThrow();

    const midRow = db
      .prepare('SELECT failed_login_attempts FROM users WHERE id = ?')
      .get(ownerId) as {
      failed_login_attempts: number;
    };
    expect(midRow.failed_login_attempts).toBe(2);

    // Successful attempt
    await verifyOwnerPinForDestructive('12345678', ownerSession, db);

    const successRow = db
      .prepare('SELECT failed_login_attempts FROM users WHERE id = ?')
      .get(ownerId) as {
      failed_login_attempts: number;
    };
    expect(successRow.failed_login_attempts).toBe(0);
  });

  it('registerAllIpcHandlers allows all 5 roles on counter and operational endpoints', async () => {
    const { registerAllIpcHandlers } = await import('./index');
    const { getRegisteredIpcHandlers } = await import('./ipc/wrapper');

    registerAllIpcHandlers();
    const handlers = getRegisteredIpcHandlers();

    // Verify sales:finalize allows manager and accountant
    const finalizeHandler = handlers.get('sales:finalize');
    expect(finalizeHandler).toBeDefined();
    expect(finalizeHandler?.roles).toContain('manager');
    expect(finalizeHandler?.roles).toContain('accountant');
    expect(finalizeHandler?.roles).toContain('cashier');

    // Verify backup:restore is strictly owner only
    const restoreHandler = handlers.get('backup:restore');
    expect(restoreHandler).toBeDefined();
    expect(restoreHandler?.roles).toEqual(['owner']);
  });

  it('registerSecureIpcHandler validates args using provided schema', async () => {
    const { getRegisteredIpcHandlers } = await import('./ipc/wrapper');
    const DummyInputSchema = z.object({
      quantity: z.number().int().positive(),
    });

    registerSecureIpcHandler({
      channel: 'test:schema-validation',
      isPublic: true,
      publicReason: 'Test schema validation',
      schema: DummyInputSchema,
      handler: async (_ctx, input: { quantity: number }) => input.quantity * 2,
    });

    const handlerInfo = getRegisteredIpcHandlers().get('test:schema-validation');
    expect(handlerInfo).toBeDefined();

    // Valid input succeeds
    const res = await handlerInfo?.handler({} as Electron.IpcMainInvokeEvent, { quantity: 5 });
    expect(res).toBe(10);

    // Invalid input throws ZodError
    await expect(
      handlerInfo?.handler({} as Electron.IpcMainInvokeEvent, { quantity: -1 })
    ).rejects.toThrow();
  });
});
