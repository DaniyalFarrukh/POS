import { describe, it, expect } from 'vitest';
import { hasPermission, type UserRole } from '@pos/shared';
import { NAV_PERMISSIONS, type NavItem } from './layout/DashboardLayout';

describe('Web Navigation & Role Permission Filtering', () => {
  const ALL_NAV_ITEMS: NavItem[] = [
    'overview',
    'customers',
    'prescriptions',
    'hr-leave',
    'hr-payroll',
    'stock-management',
    'batches-expiry',
    'stock-transfers',
    'stock-locations',
    'stock-counts',
    'supplier-returns',
    'purchase-orders',
    'suppliers',
    'finance-coa',
    'finance-journals',
    'finance-payments',
    'finance-expenses',
    'finance-ar',
    'finance-ap',
    'finance-cash-bank',
    'finance-sales-ledger',
    'finance-reports',
    'finance-budgets',
    'finance-period-close',
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
    expect(visible).not.toContain('stock-management');
    expect(visible).not.toContain('batches-expiry');
    expect(visible).not.toContain('stock-transfers');
    expect(visible).not.toContain('stock-locations');
    expect(visible).not.toContain('stock-counts');
    expect(visible).not.toContain('supplier-returns');
    expect(visible).not.toContain('purchase-orders');
    expect(visible).not.toContain('suppliers');
    expect(visible).not.toContain('finance-coa');
    expect(visible).not.toContain('finance-journals');
    expect(visible).not.toContain('finance-payments');
    expect(visible).not.toContain('finance-expenses');
    expect(visible).not.toContain('finance-ar');
    expect(visible).not.toContain('finance-ap');
    expect(visible).not.toContain('finance-cash-bank');
    expect(visible).not.toContain('finance-sales-ledger');
    expect(visible).not.toContain('finance-reports');
    expect(visible).not.toContain('finance-budgets');
    expect(visible).not.toContain('finance-period-close');
    expect(visible).not.toContain('admin-users');
    expect(visible).not.toContain('admin-branches');
    expect(visible).not.toContain('admin-devices');
    expect(visible).not.toContain('audit-log');
    expect(visible).not.toContain('reports-profit');
    expect(visible).not.toContain('reports-supplier');
    expect(visible).not.toContain('prescriptions');
    expect(visible).not.toContain('hr-leave');
    expect(visible).not.toContain('hr-payroll');
  });

  it('allows accountant to see financial reports, finance ledger screens, and audit logs, but forbids user management', () => {
    const visible = getVisibleItemsForRole('accountant');
    expect(visible).toContain('customers');
    expect(visible).toContain('suppliers');
    expect(visible).toContain('finance-coa');
    expect(visible).toContain('finance-journals');
    expect(visible).toContain('finance-payments');
    expect(visible).toContain('finance-expenses');
    expect(visible).toContain('finance-ar');
    expect(visible).toContain('finance-ap');
    expect(visible).toContain('finance-cash-bank');
    expect(visible).toContain('finance-sales-ledger');
    expect(visible).toContain('finance-reports');
    expect(visible).toContain('finance-budgets');
    expect(visible).toContain('finance-period-close');
    expect(visible).toContain('reports-profit');
    expect(visible).toContain('reports-supplier');
    expect(visible).toContain('reports-sales');
    expect(visible).toContain('stock-management');
    expect(visible).toContain('batches-expiry');
    expect(visible).toContain('audit-log');
    expect(visible).not.toContain('prescriptions');
    expect(visible).not.toContain('hr-leave');
    expect(visible).not.toContain('hr-payroll');
    expect(visible).not.toContain('admin-users');
  });

  it('allows pharmacist to see stock/sales reports, suppliers, and branch list, but forbids profit per batch, finance ledger, and user management', () => {
    const visible = getVisibleItemsForRole('pharmacist');
    expect(visible).toContain('overview');
    expect(visible).toContain('customers');
    expect(visible).toContain('prescriptions');
    expect(visible).toContain('stock-management');
    expect(visible).toContain('batches-expiry');
    expect(visible).toContain('stock-transfers');
    expect(visible).toContain('stock-locations');
    expect(visible).toContain('stock-counts');
    expect(visible).toContain('supplier-returns');
    expect(visible).toContain('purchase-orders');
    expect(visible).toContain('suppliers');
    expect(visible).toContain('reports-sales');
    expect(visible).toContain('reports-stock');
    expect(visible).toContain('admin-branches'); // Permitted for branch filtering (M-10)
    expect(visible).not.toContain('finance-coa');
    expect(visible).not.toContain('finance-journals');
    expect(visible).not.toContain('finance-payments');
    expect(visible).not.toContain('finance-expenses');
    expect(visible).not.toContain('finance-ar');
    expect(visible).not.toContain('finance-ap');
    expect(visible).not.toContain('finance-cash-bank');
    expect(visible).not.toContain('finance-sales-ledger');
    expect(visible).not.toContain('finance-reports');
    expect(visible).not.toContain('finance-budgets');
    expect(visible).not.toContain('finance-period-close');
    expect(visible).not.toContain('reports-profit');
    expect(visible).not.toContain('reports-supplier');
    expect(visible).not.toContain('hr-leave');
    expect(visible).not.toContain('hr-payroll');
    expect(visible).not.toContain('admin-users');
    expect(visible).not.toContain('admin-devices');
    expect(visible).not.toContain('audit-log');
  });

  it('verifies unauthorized direct URL access would be blocked by permission check', () => {
    // Direct attempt to access 'admin-users' by cashier
    const cashierCanAccessUsers = hasPermission('cashier', NAV_PERMISSIONS['admin-users']);
    expect(cashierCanAccessUsers).toBe(false);

    // Direct attempt to access 'reports-profit' by pharmacist
    const pharmacistCanAccessProfit = hasPermission(
      'pharmacist',
      NAV_PERMISSIONS['reports-profit']
    );
    expect(pharmacistCanAccessProfit).toBe(false);

    // Direct attempt to access 'admin-users' by accountant
    const accountantCanAccessUsers = hasPermission('accountant', NAV_PERMISSIONS['admin-users']);
    expect(accountantCanAccessUsers).toBe(false);

    // Direct attempt to access sensitive PHI 'prescriptions' by cashier
    const cashierCanAccessPrescriptions = hasPermission(
      'cashier',
      NAV_PERMISSIONS['prescriptions']
    );
    expect(cashierCanAccessPrescriptions).toBe(false);

    // Pharmacist is authorized for 'prescriptions'
    const pharmacistCanAccessPrescriptions = hasPermission(
      'pharmacist',
      NAV_PERMISSIONS['prescriptions']
    );
    expect(pharmacistCanAccessPrescriptions).toBe(true);

    // Direct attempt to access 'hr-leave' by cashier
    const cashierCanAccessLeave = hasPermission('cashier', NAV_PERMISSIONS['hr-leave']);
    expect(cashierCanAccessLeave).toBe(false);

    // Direct attempt to access 'hr-payroll' by cashier
    const cashierCanAccessPayroll = hasPermission('cashier', NAV_PERMISSIONS['hr-payroll']);
    expect(cashierCanAccessPayroll).toBe(false);

    // Manager and Owner are authorized for 'hr-leave' and 'hr-payroll'
    const managerCanAccessLeave = hasPermission('manager', NAV_PERMISSIONS['hr-leave']);
    expect(managerCanAccessLeave).toBe(true);
    const ownerCanAccessLeave = hasPermission('owner', NAV_PERMISSIONS['hr-leave']);
    expect(ownerCanAccessLeave).toBe(true);

    const managerCanAccessPayroll = hasPermission('manager', NAV_PERMISSIONS['hr-payroll']);
    expect(managerCanAccessPayroll).toBe(true);
    const ownerCanAccessPayroll = hasPermission('owner', NAV_PERMISSIONS['hr-payroll']);
    expect(ownerCanAccessPayroll).toBe(true);
  });
});
