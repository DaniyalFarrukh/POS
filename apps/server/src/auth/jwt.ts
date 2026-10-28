import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export interface DeviceTokenPayload {
  pharmacyId: string;
  branchId: string;
  deviceId: string;
}

export function getJwtSecret(): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const secret = process.env.JWT_SECRET;
  const DEV_DEFAULT = 'dev_pos_jwt_secret_change_in_production';

  if (isProduction) {
    if (!secret) {
      throw new Error('FATAL: JWT_SECRET environment variable is required in production');
    }
    if (secret === DEV_DEFAULT) {
      throw new Error('FATAL: Production JWT_SECRET cannot use default development secret');
    }
  }

  return secret || DEV_DEFAULT;
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
 * Generates a human-friendly one-time registration code, e.g. "REG-A1B2-C3D4".
 */
export function generatePlainRegistrationCode(): string {
  const p1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const p2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `REG-${p1}-${p2}`;
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
  const secret = options?.secret || getJwtSecret();
  const expiresIn = options?.expiresIn ?? '90d';

  return jwt.sign(
    {
      pharmacyId: payload.pharmacyId,
      branchId: payload.branchId,
      deviceId: payload.deviceId,
    },
    secret,
    {
      algorithm: 'HS256',
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
  const secret = options?.secret || getJwtSecret();

  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],
  });

  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid token payload: expected object');
  }

  const { pharmacyId, branchId, deviceId } = decoded as Record<string, unknown>;

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
  role: 'owner' | 'pharmacist' | 'cashier';
  name: string;
}

/**
 * Signs a user session JWT for dashboard/web clients.
 */
export function signUserToken(
  payload: UserTokenPayload,
  options?: SignDeviceTokenOptions
): string {
  const secret = options?.secret || getJwtSecret();
  const expiresIn = options?.expiresIn ?? '7d';

  return jwt.sign(
    {
      userId: payload.userId,
      pharmacyId: payload.pharmacyId,
      role: payload.role,
      name: payload.name,
    },
    secret,
    {
      algorithm: 'HS256',
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
  });

  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid user token payload: expected object');
  }

  const { userId, pharmacyId, role, name } = decoded as Record<string, unknown>;

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
    role: role as 'owner' | 'pharmacist' | 'cashier',
    name,
  };
}

