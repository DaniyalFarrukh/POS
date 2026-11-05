import { z } from 'zod';

export const NotificationTypeSchema = z.enum([
  'expiring_stock',
  'low_stock',
  'overdue_payables',
  'overdue_receivables',
  'sync_exceptions',
  'period_close',
  'general',
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

export const UserNotificationSchema = z.object({
  id: z.string().uuid(),
  pharmacyId: z.string().uuid(),
  userId: z.string().uuid(),
  type: NotificationTypeSchema,
  title: z.string(),
  message: z.string(),
  severity: NotificationSeveritySchema,
  entityType: z.string().nullable().optional(),
  entityId: z.string().uuid().nullable().optional(),
  link: z.string().nullable().optional(),
  isRead: z.boolean(),
  readAt: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type UserNotification = z.infer<typeof UserNotificationSchema>;

export const NotificationsListResponseSchema = z.object({
  items: z.array(UserNotificationSchema),
  unreadCount: z.number(),
  total: z.number(),
});
export type NotificationsListResponse = z.infer<typeof NotificationsListResponseSchema>;

export const AuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  pharmacyId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  userName: z.string(),
  userRole: z.string(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().uuid().nullable().optional(),
  summary: z.string(),
  beforeState: z.record(z.string(), z.unknown()).nullable().optional(),
  afterState: z.record(z.string(), z.unknown()).nullable().optional(),
  ipAddress: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const AuditLogsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  userId: z.string().uuid().optional(),
  entity: z.string().optional(),
  action: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
});
export type AuditLogsQuery = z.infer<typeof AuditLogsQuerySchema>;

export const AuditLogsListResponseSchema = z.object({
  items: z.array(AuditLogEntrySchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});
export type AuditLogsListResponse = z.infer<typeof AuditLogsListResponseSchema>;

export const GlobalSearchResultItemSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['invoice', 'customer', 'product', 'supplier']),
  title: z.string(),
  subtitle: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(),
  link: z.string(),
});
export type GlobalSearchResultItem = z.infer<typeof GlobalSearchResultItemSchema>;

export const GlobalSearchResponseSchema = z.object({
  query: z.string(),
  results: z.object({
    invoices: z.array(GlobalSearchResultItemSchema),
    customers: z.array(GlobalSearchResultItemSchema),
    products: z.array(GlobalSearchResultItemSchema),
    suppliers: z.array(GlobalSearchResultItemSchema),
  }),
  totalCount: z.number(),
});
export type GlobalSearchResponse = z.infer<typeof GlobalSearchResponseSchema>;
