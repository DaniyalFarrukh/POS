import { app, BrowserWindow, ipcMain } from 'electron';
import { type z, type AuthSession, type UserRole } from '@pos/shared';
import { getSession, verifyPin } from '../auth';
import { getDatabase } from '../db';

export interface HandlerContext {
  event: Electron.IpcMainInvokeEvent;
  session: AuthSession | null;
  cashierUserId?: string;
  counterId?: string;
  branchId?: string;
  userRole?: UserRole;
}

export interface SecureIpcHandlerConfig<TInput = unknown, TOutput = unknown> {
  channel: string;
  isPublic?: boolean;
  publicReason?: string;
  roles?: UserRole[];
  schema?: z.ZodType<TInput>;
  isDestructive?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (ctx: HandlerContext, ...args: any[]) => Promise<TOutput> | TOutput;
}

export interface RegisteredHandlerInfo {
  channel: string;
  isPublic: boolean;
  publicReason?: string;
  roles?: UserRole[];
  isDestructive: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => Promise<unknown>;
}

const registry = new Map<string, RegisteredHandlerInfo>();

const SENSITIVE_KEYS = new Set([
  'pin_hash',
  'pinHash',
  'password_hash',
  'passwordHash',
  'token',
  'secret',
  'jwt',
]);

/**
 * Sanitizes output recursively, removing any sensitive keys like pin_hash or tokens.
 */
export function sanitizeIpcOutput<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeIpcOutput(item)) as unknown as T;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      continue;
    }
    clean[key] = sanitizeIpcOutput(value);
  }
  return clean as T;
}

/**
 * Validates that the event sender is the main window and origin is authorized.
 */
export function validateSenderFrame(event: Electron.IpcMainInvokeEvent): void {
  if (!event || !event.sender) {
    return;
  }
  const senderFrame = event.senderFrame;
  if (!senderFrame) {
    return;
  }
  if (senderFrame.parent !== null) {
    throw new Error('IPC security violation: Child frames and iframes are forbidden.');
  }
  const url = senderFrame.url || '';
  const isDev = !app?.isPackaged;
  const isAllowedDev =
    isDev && (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:'));
  const isAllowedProd = url.startsWith('file://');

  if (!isAllowedDev && !isAllowedProd) {
    throw new Error(`IPC security violation: Untrusted origin frame URL '${url}'.`);
  }

  const win = BrowserWindow?.fromWebContents
    ? BrowserWindow.fromWebContents(event.sender)
    : null;
  if (win && win.isDestroyed()) {
    throw new Error('IPC security violation: Window is destroyed.');
  }
}

/**
 * Verifies owner PIN for destructive operations.
 */
export async function verifyOwnerPinForDestructive(
  ownerPin: string,
  session: AuthSession,
  rawDb?: ReturnType<typeof getDatabase>
): Promise<void> {
  if (session.user.role !== 'owner') {
    throw new Error('Unauthorized: Destructive operations strictly require Owner role.');
  }
  if (!ownerPin) {
    throw new Error('Owner PIN confirmation is required for destructive operations.');
  }
  const db = rawDb ?? getDatabase();
  const owner = db
    .prepare('SELECT pin_hash FROM users WHERE id = ?')
    .get(session.user.id) as { pin_hash: string } | undefined;
  if (!owner || !owner.pin_hash) {
    throw new Error('Owner credentials not found in database.');
  }
  const isValid = await verifyPin(ownerPin, owner.pin_hash);
  if (!isValid) {
    throw new Error('Invalid Owner PIN.');
  }
}

/**
 * Registers an IPC handler with security wrapper:
 * - Sender frame origin validation
 * - Session unlocked check & role enforcement
 * - Zod input validation
 * - Main-process context injection (cashierUserId, counterId, branchId)
 * - Owner PIN verification for destructive actions
 * - Output data sanitization
 */
export function registerSecureIpcHandler<TInput = unknown, TOutput = unknown>(
  config: SecureIpcHandlerConfig<TInput, TOutput>
): void {
  const { channel, isPublic = false, publicReason, roles, schema, isDestructive = false, handler } =
    config;

  if (isPublic && !publicReason) {
    throw new Error(`Public IPC handler '${channel}' must document a publicReason.`);
  }

  const wrappedHandler = async (
    event: Electron.IpcMainInvokeEvent,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): Promise<unknown> => {
    // 1. Frame validation
    validateSenderFrame(event);

    // 2. Session and Role Authorization
    let session: AuthSession | null = null;
    if (!isPublic) {
      session = getSession();
      if (!session) {
        throw new Error(`Unauthorized: No active session for '${channel}'.`);
      }
      if (session.isLocked) {
        throw new Error(`Unauthorized: Terminal session is locked. Action '${channel}' blocked.`);
      }
      if (roles && roles.length > 0 && !roles.includes(session.user.role)) {
        throw new Error(
          `Access denied: Role '${session.user.role}' cannot execute '${channel}'. Required: ${roles.join(', ')}.`
        );
      }
    } else {
      session = getSession();
    }

    // 3. Destructive Action Check (Owner PIN)
    if (isDestructive) {
      if (!session || session.user.role !== 'owner') {
        throw new Error(`Unauthorized: '${channel}' requires an active Owner session.`);
      }
      const firstArg = args[0] as Record<string, unknown> | undefined;
      const ownerPin =
        typeof firstArg === 'object' && firstArg !== null && typeof firstArg.ownerPin === 'string'
          ? firstArg.ownerPin
          : typeof args[1] === 'string'
          ? args[1]
          : '';
      await verifyOwnerPinForDestructive(ownerPin, session);
    }

    // 4. Input Schema Validation
    if (schema && args.length > 0) {
      args[0] = schema.parse(args[0]);
    }

    // 5. Context Injection
    const ctx: HandlerContext = {
      event,
      session,
      cashierUserId: session?.user.id,
      counterId: session?.counter.id,
      branchId: session?.branch.id,
      userRole: session?.user.role,
    };

    // Override any caller-supplied session identities in payload objects
    if (session && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const payload = args[0] as Record<string, unknown>;
      if ('cashierUserId' in payload) {
        payload.cashierUserId = session.user.id;
      }
      if ('counterId' in payload) {
        payload.counterId = session.counter.id;
      }
      if ('branchId' in payload) {
        payload.branchId = session.branch.id;
      }
    }

    // 6. Execute Handler
    const result = await handler(ctx, ...args);

    // 7. Sanitize Output
    return sanitizeIpcOutput(result);
  };

  // Remove previous if already registered
  try {
    if (ipcMain && typeof ipcMain.removeHandler === 'function') {
      ipcMain.removeHandler(channel);
    }
  } catch {
    // Ignore error if not previously registered
  }

  if (ipcMain && typeof ipcMain.handle === 'function') {
    ipcMain.handle(channel, wrappedHandler);
  }

  registry.set(channel, {
    channel,
    isPublic,
    publicReason,
    roles,
    isDestructive,
    handler: wrappedHandler,
  });
}

/**
 * Removes a secure handler
 */
export function removeSecureIpcHandler(channel: string): void {
  try {
    if (ipcMain && typeof ipcMain.removeHandler === 'function') {
      ipcMain.removeHandler(channel);
    }
  } catch {
    // Ignore error
  }
  registry.delete(channel);
}

/**
 * Clear all handlers (for tests)
 */
export function clearAllSecureIpcHandlers(): void {
  for (const channel of registry.keys()) {
    try {
      if (ipcMain && typeof ipcMain.removeHandler === 'function') {
        ipcMain.removeHandler(channel);
      }
    } catch {
      // Ignore
    }
  }
  registry.clear();
}

/**
 * Returns read-only view of the registry for automated security auditing tests
 */
export function getRegisteredIpcHandlers(): ReadonlyMap<string, RegisteredHandlerInfo> {
  return registry;
}
