import { z } from 'zod';

export const UserRoleSchema = z.enum(['owner', 'pharmacist', 'cashier']);
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

export type AppPermission =
  | 'manage_users'
  | 'manage_products'
  | 'manage_stock'
  | 'sell'
  | 'view_reports';

export const ROLE_PERMISSIONS: Record<UserRole, AppPermission[]> = {
  owner: ['manage_users', 'manage_products', 'manage_stock', 'sell', 'view_reports'],
  pharmacist: ['manage_products', 'manage_stock', 'sell'],
  cashier: ['sell'],
};

export function hasPermission(role: UserRole, permission: AppPermission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions ? permissions.includes(permission) : false;
}
