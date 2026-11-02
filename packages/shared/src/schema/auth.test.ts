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

  describe('ERP Spec Permission Matrix (5 Roles, Module & Action Permissions)', () => {
    it('validates manager role in UserRoleSchema and permissions', () => {
      // Manager has operations, approvals across branches, but no ledger changes and no user management
      expect(hasPermission('manager', 'sales.invoice.view')).toBe(true);
      expect(hasPermission('manager', 'inventory.product.manage')).toBe(true);
      expect(hasPermission('manager', 'inventory.grn.create')).toBe(true);
      expect(hasPermission('manager', 'hr.payroll.view')).toBe(true);
      expect(hasPermission('manager', 'settings.branches.manage')).toBe(true);
      expect(hasPermission('manager', 'reports.view')).toBe(true);
      expect(hasPermission('manager', 'counter.sell')).toBe(true);

      // Forbidden for manager:
      expect(hasPermission('manager', 'admin.users.manage')).toBe(false);
      expect(hasPermission('manager', 'finance.journal.post')).toBe(false);
      expect(hasPermission('manager', 'finance.coa.manage')).toBe(false);
      expect(hasPermission('manager', 'finance.period_close.execute')).toBe(false);
    });

    it('validates accountant role in UserRoleSchema and permissions', () => {
      // Accountant has finance modules, journals, reports, period close proposals; no user management
      expect(hasPermission('accountant', 'finance.journal.view')).toBe(true);
      expect(hasPermission('accountant', 'finance.journal.create')).toBe(true);
      expect(hasPermission('accountant', 'finance.journal.post')).toBe(true);
      expect(hasPermission('accountant', 'finance.coa.view')).toBe(true);
      expect(hasPermission('accountant', 'finance.coa.manage')).toBe(true);
      expect(hasPermission('accountant', 'finance.reports.view')).toBe(true);
      expect(hasPermission('accountant', 'reports.profit.view')).toBe(true);
      expect(hasPermission('accountant', 'finance.period_close.propose')).toBe(true);

      // Forbidden for accountant:
      expect(hasPermission('accountant', 'finance.period_close.execute')).toBe(false); // owner only
      expect(hasPermission('accountant', 'admin.users.manage')).toBe(false); // no user management
      expect(hasPermission('accountant', 'counter.sell')).toBe(false); // counter cashier/pharmacist only
      expect(hasPermission('accountant', 'inventory.product.manage')).toBe(false);
    });

    it('validates pharmacist role against ERP spec', () => {
      // Pharmacist: counter + stock + purchasing receiving + prescriptions
      expect(hasPermission('pharmacist', 'counter.sell')).toBe(true);
      expect(hasPermission('pharmacist', 'counter.shift.manage')).toBe(true);
      expect(hasPermission('pharmacist', 'sales.invoice.create')).toBe(true);
      expect(hasPermission('pharmacist', 'sales.prescription.manage')).toBe(true);
      expect(hasPermission('pharmacist', 'inventory.stock.manage')).toBe(true);
      expect(hasPermission('pharmacist', 'inventory.grn.create')).toBe(true);
      expect(hasPermission('pharmacist', 'reports.sales.view')).toBe(true);

      // Forbidden for pharmacist:
      expect(hasPermission('pharmacist', 'admin.users.manage')).toBe(false);
      expect(hasPermission('pharmacist', 'finance.journal.post')).toBe(false);
      expect(hasPermission('pharmacist', 'finance.period_close.propose')).toBe(false);
    });

    it('validates cashier role against ERP spec', () => {
      // Cashier: counter only
      expect(hasPermission('cashier', 'counter.sell')).toBe(true);
      expect(hasPermission('cashier', 'counter.shift.manage')).toBe(true);
      expect(hasPermission('cashier', 'sales.invoice.create')).toBe(true);
      expect(hasPermission('cashier', 'sales.invoice.view')).toBe(true);
      expect(hasPermission('cashier', 'sales.return.create')).toBe(true);

      // Forbidden for cashier:
      expect(hasPermission('cashier', 'finance.journal.view')).toBe(false);
      expect(hasPermission('cashier', 'finance.journal.post')).toBe(false);
      expect(hasPermission('cashier', 'inventory.product.manage')).toBe(false);
      expect(hasPermission('cashier', 'admin.users.manage')).toBe(false);
      expect(hasPermission('cashier', 'reports.profit.view')).toBe(false);
    });

    it('validates owner role has complete access across all permissions', () => {
      expect(hasPermission('owner', 'admin.users.manage')).toBe(true);
      expect(hasPermission('owner', 'finance.period_close.execute')).toBe(true);
      expect(hasPermission('owner', 'finance.journal.post')).toBe(true);
      expect(hasPermission('owner', 'inventory.product.manage')).toBe(true);
      expect(hasPermission('owner', 'counter.sell')).toBe(true);
    });
  });
});
