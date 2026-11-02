import { describe, it, expect } from 'vitest';
import { hasPermission, type UserRole } from '@pos/shared';
import { NAV_PERMISSIONS, type NavItem } from './layout/DashboardLayout';

describe('Web Navigation & Role Permission Filtering', () => {
  const ALL_NAV_ITEMS: NavItem[] = [
    'overview',
    'reports-sales',
    'reports-stock',
    'reports-profit',
    'reports-supplier',
    'admin-users',
    'admin-branches',
    'admin-devices',
    'audit-log',
  ];

  it('guarantees every navigation item has a mapped required permission', () => {
    for (const item of ALL_NAV_ITEMS) {
      expect(NAV_PERMISSIONS[item], `Missing permission mapping for ${item}`).toBeDefined();
    }
  });

  const getVisibleItemsForRole = (role: UserRole): NavItem[] => {
    return ALL_NAV_ITEMS.filter((item) => {
      const permission = NAV_PERMISSIONS[item];
      return hasPermission(role, permission);
    });
  };

  it('gives owner visibility into all modules and routes', () => {
    const visible = getVisibleItemsForRole('owner');
    expect(visible).toEqual(ALL_NAV_ITEMS);
  });

  it('prevents cashier from seeing back-office admin or sensitive financial reports', () => {
    const visible = getVisibleItemsForRole('cashier');
    expect(visible).not.toContain('admin-users');
    expect(visible).not.toContain('admin-branches');
    expect(visible).not.toContain('admin-devices');
    expect(visible).not.toContain('audit-log');
    expect(visible).not.toContain('reports-profit');
    expect(visible).not.toContain('reports-supplier');
  });

  it('allows accountant to see financial reports and audit logs, but forbids user management', () => {
    const visible = getVisibleItemsForRole('accountant');
    expect(visible).toContain('reports-profit');
    expect(visible).toContain('reports-supplier');
    expect(visible).toContain('reports-sales');
    expect(visible).toContain('audit-log');
    expect(visible).not.toContain('admin-users');
  });

  it('allows pharmacist to see stock/sales reports and branch list, but forbids profit per batch and user management', () => {
    const visible = getVisibleItemsForRole('pharmacist');
    expect(visible).toContain('overview');
    expect(visible).toContain('reports-sales');
    expect(visible).toContain('reports-stock');
    expect(visible).toContain('admin-branches'); // Permitted for branch filtering (M-10)
    expect(visible).not.toContain('reports-profit');
    expect(visible).not.toContain('reports-supplier');
    expect(visible).not.toContain('admin-users');
    expect(visible).not.toContain('admin-devices');
    expect(visible).not.toContain('audit-log');
  });

  it('verifies unauthorized direct URL access would be blocked by permission check', () => {
    // Direct attempt to access 'admin-users' by cashier
    const cashierCanAccessUsers = hasPermission('cashier', NAV_PERMISSIONS['admin-users']);
    expect(cashierCanAccessUsers).toBe(false);

    // Direct attempt to access 'reports-profit' by pharmacist
    const pharmacistCanAccessProfit = hasPermission('pharmacist', NAV_PERMISSIONS['reports-profit']);
    expect(pharmacistCanAccessProfit).toBe(false);

    // Direct attempt to access 'admin-users' by accountant
    const accountantCanAccessUsers = hasPermission('accountant', NAV_PERMISSIONS['admin-users']);
    expect(accountantCanAccessUsers).toBe(false);
  });
});

