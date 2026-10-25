import { z } from 'zod';
import { UserRoleSchema, type UserRole } from './index';

// 4 to 8 numeric digits for offline terminal PIN
export const PinSchema = z.string().regex(/^\d{4,8}$/, 'PIN must be between 4 and 8 digits');

export const SetupInputSchema = z.object({
  branchName: z.string().min(2, 'Branch name must be at least 2 characters'),
  counterName: z.string().min(2, 'Counter name must be at least 2 characters'),
  ownerName: z.string().min(2, 'Owner name must be at least 2 characters'),
  pin: PinSchema,
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
