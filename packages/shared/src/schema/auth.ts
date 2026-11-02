import { z } from 'zod';

export const UserRoleSchema = z.enum([
  'owner',
  'manager',
  'accountant',
  'pharmacist',
  'cashier',
]);
export type UserRole = z.infer<typeof UserRoleSchema>;

// 6 to 8 numeric digits for staff, strictly 8 digits for owner
export const StaffPinSchema = z.string().regex(/^\d{6,8}$/, 'PIN must be between 6 and 8 digits');
export const OwnerPinSchema = z.string().regex(/^\d{8}$/, 'Owner PIN must be exactly 8 digits');
export const PinSchema = StaffPinSchema;

export const SetupInputSchema = z.object({
  branchName: z.string().min(2, 'Branch name must be at least 2 characters'),
  counterName: z.string().min(2, 'Counter name must be at least 2 characters'),
  ownerName: z.string().min(2, 'Owner name must be at least 2 characters'),
  pin: OwnerPinSchema,
});
export type SetupInput = z.infer<typeof SetupInputSchema>;

export const LoginInputSchema = z.object({
  userId: z.string().uuid(),
  pin: PinSchema,
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const UnlockInputSchema = z.object({
  pin: PinSchema,
});
export type UnlockInput = z.infer<typeof UnlockInputSchema>;

// Public user object: strictly NO pinHash per Rule 6
export const PublicUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  role: UserRoleSchema,
  isActive: z.boolean(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const AuthSessionSchema = z.object({
  user: PublicUserSchema,
  branch: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
  counter: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
  isLocked: z.boolean(),
  idleTimeoutMinutes: z.number().int().min(1).default(5),
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const ALL_PERMISSIONS = [
  // Sales & Customers
  'sales.invoice.view',
  'sales.invoice.create',
  'sales.return.view',
  'sales.return.create',
  'sales.customer.view',
  'sales.customer.manage',
  'sales.prescription.view',
  'sales.prescription.manage',
  'sales.loyalty.view',
  'sales.loyalty.manage',

  // Inventory
  'inventory.product.view',
  'inventory.product.manage',
  'inventory.stock.view',
  'inventory.stock.manage',
  'inventory.batch.view',
  'inventory.batch.manage',
  'inventory.warehouse.view',
  'inventory.warehouse.manage',
  'inventory.purchase_order.view',
  'inventory.purchase_order.manage',
  'inventory.grn.view',
  'inventory.grn.create',
  'inventory.supplier.view',
  'inventory.supplier.manage',
  'inventory.transfer.view',
  'inventory.transfer.create',
  'inventory.count.view',
  'inventory.count.create',
  'inventory.supplier_return.view',
  'inventory.supplier_return.create',

  // Finance & Accounting
  'finance.dashboard.view',
  'finance.invoice.view',
  'finance.payment.view',
  'finance.payment.create',
  'finance.expense.view',
  'finance.expense.create',
  'finance.ar.view',
  'finance.ap.view',
  'finance.cash_bank.view',
  'finance.cash_bank.manage',
  'finance.sales_ledger.view',
  'finance.journal.view',
  'finance.journal.create',
  'finance.journal.post',
  'finance.coa.view',
  'finance.coa.manage',
  'finance.reports.view',
  'finance.budget.view',
  'finance.budget.manage',
  'finance.period_close.propose',
  'finance.period_close.execute',

  // Human Resources
  'hr.employee.view',
  'hr.employee.manage',
  'hr.attendance.view',
  'hr.attendance.manage',
  'hr.leave.view',
  'hr.leave.manage',
  'hr.payroll.view',
  'hr.payroll.manage',

  // Reports & Analytics
  'reports.view',
  'reports.sales.view',
  'reports.stock.view',
  'reports.profit.view',
  'reports.supplier_ledger.view',

  // Settings
  'settings.profile.view',
  'settings.profile.manage',
  'settings.branches.view',
  'settings.branches.manage',
  'settings.counters.view',
  'settings.counters.manage',
  'settings.tax.view',
  'settings.tax.manage',
  'settings.receipts.view',
  'settings.receipts.manage',
  'settings.devices.view',
  'settings.devices.manage',

  // Admin & Security
  'admin.users.view',
  'admin.users.manage',
  'admin.audit_log.view',

  // Counter operations
  'counter.sell',
  'counter.shift.manage',

  // Session
  'auth.me.view',

  // Legacy permissions for backward compatibility
  'manage_users',
  'manage_products',
  'manage_stock',
  'sell',
  'view_reports',
] as const;

export type AppPermission = (typeof ALL_PERMISSIONS)[number];

const LEGACY_PERMISSION_MAP: Record<string, AppPermission[]> = {
  manage_users: ['admin.users.manage', 'admin.users.view'],
  manage_products: ['inventory.product.manage', 'inventory.product.view'],
  manage_stock: ['inventory.stock.manage', 'inventory.stock.view'],
  sell: ['counter.sell', 'sales.invoice.create'],
  view_reports: ['reports.view', 'reports.sales.view', 'reports.stock.view'],
};

// Owner: everything
const OWNER_PERMISSIONS = new Set<AppPermission>(ALL_PERMISSIONS);

// Manager: operations across branches, approvals, no ledger changes and no user management
const MANAGER_PERMISSIONS = new Set<AppPermission>([
  'sales.invoice.view',
  'sales.invoice.create',
  'sales.return.view',
  'sales.return.create',
  'sales.customer.view',
  'sales.customer.manage',
  'sales.prescription.view',
  'sales.prescription.manage',
  'sales.loyalty.view',
  'sales.loyalty.manage',

  'inventory.product.view',
  'inventory.product.manage',
  'inventory.stock.view',
  'inventory.stock.manage',
  'inventory.batch.view',
  'inventory.batch.manage',
  'inventory.warehouse.view',
  'inventory.warehouse.manage',
  'inventory.purchase_order.view',
  'inventory.purchase_order.manage',
  'inventory.grn.view',
  'inventory.grn.create',
  'inventory.supplier.view',
  'inventory.supplier.manage',
  'inventory.transfer.view',
  'inventory.transfer.create',
  'inventory.count.view',
  'inventory.count.create',
  'inventory.supplier_return.view',
  'inventory.supplier_return.create',

  'hr.employee.view',
  'hr.employee.manage',
  'hr.attendance.view',
  'hr.attendance.manage',
  'hr.leave.view',
  'hr.leave.manage',
  'hr.payroll.view',
  'hr.payroll.manage',

  'reports.view',
  'reports.sales.view',
  'reports.stock.view',
  'reports.supplier_ledger.view',

  'settings.profile.view',
  'settings.branches.view',
  'settings.branches.manage',
  'settings.counters.view',
  'settings.counters.manage',
  'settings.tax.view',
  'settings.receipts.view',
  'settings.devices.view',
  'settings.devices.manage',

  'admin.audit_log.view',
  'admin.users.view',

  'counter.sell',
  'counter.shift.manage',
  'auth.me.view',

  // Legacy mappings
  'sell',
  'manage_products',
  'manage_stock',
  'view_reports',
]);

// Accountant: finance modules, journals, reports, period close proposals; no user management
const ACCOUNTANT_PERMISSIONS = new Set<AppPermission>([
  'finance.dashboard.view',
  'finance.invoice.view',
  'finance.payment.view',
  'finance.payment.create',
  'finance.expense.view',
  'finance.expense.create',
  'finance.ar.view',
  'finance.ap.view',
  'finance.cash_bank.view',
  'finance.cash_bank.manage',
  'finance.sales_ledger.view',
  'finance.journal.view',
  'finance.journal.create',
  'finance.journal.post',
  'finance.coa.view',
  'finance.coa.manage',
  'finance.reports.view',
  'finance.budget.view',
  'finance.budget.manage',
  'finance.period_close.propose',

  'reports.view',
  'reports.sales.view',
  'reports.stock.view',
  'reports.profit.view',
  'reports.supplier_ledger.view',

  'sales.invoice.view',
  'sales.return.view',
  'sales.customer.view',

  'inventory.product.view',
  'inventory.stock.view',
  'inventory.batch.view',
  'inventory.warehouse.view',
  'inventory.purchase_order.view',
  'inventory.grn.view',
  'inventory.supplier.view',

  'admin.audit_log.view',
  'auth.me.view',

  // Legacy mappings
  'view_reports',
]);

// Pharmacist: counter + stock + purchasing receiving + prescriptions
const PHARMACIST_PERMISSIONS = new Set<AppPermission>([
  'counter.sell',
  'counter.shift.manage',

  'sales.invoice.view',
  'sales.invoice.create',
  'sales.return.view',
  'sales.return.create',
  'sales.customer.view',
  'sales.customer.manage',
  'sales.prescription.view',
  'sales.prescription.manage',

  'inventory.product.view',
  'inventory.product.manage',
  'inventory.stock.view',
  'inventory.stock.manage',
  'inventory.batch.view',
  'inventory.batch.manage',
  'inventory.grn.view',
  'inventory.grn.create',
  'inventory.supplier.view',

  'reports.view',
  'reports.sales.view',
  'reports.stock.view',

  'settings.branches.view',
  'auth.me.view',

  // Legacy mappings
  'sell',
  'manage_products',
  'manage_stock',
  'view_reports',
]);

// Cashier: counter only
const CASHIER_PERMISSIONS = new Set<AppPermission>([
  'counter.sell',
  'counter.shift.manage',

  'sales.invoice.view',
  'sales.invoice.create',
  'sales.return.view',
  'sales.return.create',
  'sales.customer.view',

  'auth.me.view',

  // Legacy mappings
  'sell',
]);

export const ROLE_PERMISSIONS: Record<UserRole, Set<AppPermission>> = {
  owner: OWNER_PERMISSIONS,
  manager: MANAGER_PERMISSIONS,
  accountant: ACCOUNTANT_PERMISSIONS,
  pharmacist: PHARMACIST_PERMISSIONS,
  cashier: CASHIER_PERMISSIONS,
};

export function hasPermission(role: UserRole, permission: AppPermission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) {
    return false;
  }
  if (permissions.has(permission)) {
    return true;
  }
  // Check if this is a legacy alias
  const mapped = LEGACY_PERMISSION_MAP[permission];
  if (mapped) {
    return mapped.some((p) => permissions.has(p));
  }
  return false;
}
