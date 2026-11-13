import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { generateUuidV7, type UserRole } from '@pos/shared';
import { revokedTokens } from '../db/schema';

const revokedUserTokenJtis = new Map<string, number>();

export function revokeUserToken(jti: string, ttlMs = 7 * 24 * 60 * 60 * 1000): void {
  if (!jti) return;
  revokedUserTokenJtis.set(jti, Date.now() + ttlMs);
}

export async function persistRevokedToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  jti: string,
  userId?: string,
  ttlMs = 7 * 24 * 60 * 60 * 1000
): Promise<void> {
  if (!jti) return;
  revokeUserToken(jti, ttlMs);
  if (db && typeof db.insert === 'function') {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const now = new Date().toISOString();
    await db
      .insert(revokedTokens)
      .values({
        jti,
        userId: userId || null,
        expiresAt,
        createdAt: now,
      })
      .onConflictDoNothing();
  }
}

export function isUserTokenRevoked(jti?: string): boolean {
  if (!jti) return false;
  const expiresAt = revokedUserTokenJtis.get(jti);
  if (expiresAt === undefined) return false;
  if (Date.now() > expiresAt) {
    revokedUserTokenJtis.delete(jti);
    return false;
  }
  return true;
}

export interface DeviceTokenPayload {
  pharmacyId: string;
  branchId: string;
  deviceId: string;
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const DEFAULT_SECRET = 'hexapharm_pos_production_secure_jwt_secret_2026_default_key_64_chars_min';
  return secret || DEFAULT_SECRET;
}

export function getDeviceJwtSecret(): string {
  const secret = process.env.DEVICE_JWT_SECRET;
  const DEFAULT_DEVICE_SECRET =
    'hexapharm_pos_production_secure_device_jwt_secret_2026_default_key_64_chars_min';
  return secret || DEFAULT_DEVICE_SECRET;
}

/**
 * Normalizes and hashes a one-time registration code using SHA-256.
 * The database only stores this hash.
 */
export function hashRegistrationCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Generates a human-friendly one-time registration code with 64 bits of entropy: "REG-A1B2-C3D4-E5F6-7890".
 */
export function generatePlainRegistrationCode(): string {
  const p1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const p2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const p3 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const p4 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `REG-${p1}-${p2}-${p3}-${p4}`;
}

export interface SignDeviceTokenOptions {
  secret?: string;
  expiresIn?: string | number;
}

/**
 * Signs a JWT containing device and pharmacy tenancy context.
 */
export function signDeviceToken(
  payload: DeviceTokenPayload,
  options?: SignDeviceTokenOptions
): string {
  const secret = options?.secret || getDeviceJwtSecret();
  const expiresIn = options?.expiresIn ?? '90d';

  return jwt.sign(
    {
      pharmacyId: payload.pharmacyId,
      branchId: payload.branchId,
      deviceId: payload.deviceId,
      typ: 'device',
    },
    secret,
    {
      algorithm: 'HS256',
      audience: 'pos:device',
      expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
    }
  );
}

export interface VerifyDeviceTokenOptions {
  secret?: string;
}

/**
 * Verifies a device JWT and validates its required claims.
 * Throws an Error if invalid or missing required claims.
 */
export function verifyDeviceToken(
  token: string,
  options?: VerifyDeviceTokenOptions
): DeviceTokenPayload {
  const secret = options?.secret || getDeviceJwtSecret();

  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],
    audience: 'pos:device',
  });

  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid token payload: expected object');
  }

  const { pharmacyId, branchId, deviceId, typ } = decoded as Record<string, unknown>;

  if (typ !== 'device') {
    throw new Error('Invalid token type: expected device token');
  }

  if (
    typeof pharmacyId !== 'string' ||
    typeof branchId !== 'string' ||
    typeof deviceId !== 'string'
  ) {
    throw new Error('Token payload missing required tenancy claims');
  }

  return {
    pharmacyId,
    branchId,
    deviceId,
  };
}

export interface UserTokenPayload {
  userId: string;
  pharmacyId: string;
  role: UserRole;
  name: string;
  jti?: string;
}

/**
 * Signs a user session JWT for dashboard/web clients.
 */
export function signUserToken(payload: UserTokenPayload, options?: SignDeviceTokenOptions): string {
  const secret = options?.secret || getJwtSecret();
  const expiresIn = options?.expiresIn ?? '12h';
  const jti = payload.jti || generateUuidV7();

  return jwt.sign(
    {
      userId: payload.userId,
      pharmacyId: payload.pharmacyId,
      role: payload.role,
      name: payload.name,
      typ: 'user',
      jti,
    },
    secret,
    {
      algorithm: 'HS256',
      audience: 'pos:user',
      expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
    }
  );
}

/**
 * Verifies a user session JWT and validates required tenancy and identity claims.
 */
export function verifyUserToken(
  token: string,
  options?: VerifyDeviceTokenOptions
): UserTokenPayload {
  const secret = options?.secret || getJwtSecret();

  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],
    audience: 'pos:user',
  });

  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid user token payload: expected object');
  }

  const { userId, pharmacyId, role, name, typ, jti } = decoded as Record<string, unknown>;

  if (typ !== 'user') {
    throw new Error('Invalid token type: expected user token');
  }

  if (typeof jti === 'string' && isUserTokenRevoked(jti)) {
    throw new Error('User token has been revoked');
  }

  if (
    typeof userId !== 'string' ||
    typeof pharmacyId !== 'string' ||
    typeof role !== 'string' ||
    typeof name !== 'string'
  ) {
    throw new Error('User token payload missing required identity claims');
  }

  return {
    userId,
    pharmacyId,
    role: role as UserRole,
    name,
    ...(typeof jti === 'string' ? { jti } : {}),
  };
}
