import { describe, it, expect } from 'vitest';
import {
  SetupInputSchema,
  LoginInputSchema,
  UnlockInputSchema,
  PublicUserSchema,
  hasPermission,
} from './auth';
import { generateUuidV7 } from '../uuid';

describe('Auth Zod Schemas & Permissions', () => {
  it('validates a correct setup input', () => {
    const valid = {
      branchName: 'Saddar Branch',
      counterName: 'Counter 1',
      ownerName: 'Dr. Tariq',
      pin: '12345678',
    };
    const parsed = SetupInputSchema.parse(valid);
    expect(parsed.pin).toBe('12345678');
    expect(parsed.ownerName).toBe('Dr. Tariq');
  });

  it('rejects invalid PIN formats (non-digits or length out of range)', () => {
    const tooShort = {
      branchName: 'Main',
      counterName: 'C1',
      ownerName: 'Owner',
      pin: '1234567', // less than 8 digits for owner setup
    };
    expect(() => SetupInputSchema.parse(tooShort)).toThrow();

    const nonNumeric = {
      branchName: 'Main',
      counterName: 'C1',
      ownerName: 'Owner',
      pin: 'abcdefgh', // letters not allowed
    };
    expect(() => SetupInputSchema.parse(nonNumeric)).toThrow();
  });

  it('validates login and unlock inputs', () => {
    const validLogin = {
      userId: generateUuidV7(),
      pin: '987654',
    };
    expect(LoginInputSchema.parse(validLogin).pin).toBe('987654');

    const validUnlock = {
      pin: '654321',
    };
    expect(UnlockInputSchema.parse(validUnlock).pin).toBe('654321');
  });

  it('enforces that PublicUserSchema does not contain pinHash', () => {
    const user = {
      id: generateUuidV7(),
      name: 'Ali Khan',
      role: 'cashier',
      isActive: true,
    };
    const parsed = PublicUserSchema.parse(user);
    expect(parsed).not.toHaveProperty('pinHash');
  });

  it('evaluates role permissions correctly', () => {
    // Cashier
    expect(hasPermission('cashier', 'sell')).toBe(true);
    expect(hasPermission('cashier', 'manage_products')).toBe(false);
    expect(hasPermission('cashier', 'manage_users')).toBe(false);

    // Pharmacist
    expect(hasPermission('pharmacist', 'sell')).toBe(true);
    expect(hasPermission('pharmacist', 'manage_products')).toBe(true);
    expect(hasPermission('pharmacist', 'manage_stock')).toBe(true);
    expect(hasPermission('pharmacist', 'manage_users')).toBe(false);

    // Owner
    expect(hasPermission('owner', 'sell')).toBe(true);
    expect(hasPermission('owner', 'manage_products')).toBe(true);
    expect(hasPermission('owner', 'manage_stock')).toBe(true);
    expect(hasPermission('owner', 'manage_users')).toBe(true);
    expect(hasPermission('owner', 'view_reports')).toBe(true);
  });
});
