import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, sql, desc, lte, gte } from 'drizzle-orm';
import type * as schema from '../db/schema';
import {
  userNotifications,
  batches,
  products,
  rejectedEvents,
  fiscalPeriods,
  stockMovements,
} from '../db/schema';
import { generateUuidV7, getKarachiBusinessDate } from '@pos/shared';
import type { UserNotification, NotificationType, NotificationSeverity } from '@pos/shared';

export async function getUserNotifications(
  db: NodePgDatabase<typeof schema>,
  pharmacyId: string,
  userId: string
): Promise<{ items: UserNotification[]; unreadCount: number; total: number }> {
  const rows = await db
    .select()
    .from(userNotifications)
    .where(and(eq(userNotifications.pharmacyId, pharmacyId), eq(userNotifications.userId, userId)))
    .orderBy(userNotifications.isRead, desc(userNotifications.createdAt))
    .limit(50);

  const [countRow] = await db
    .select({
      unread: sql<number>`count(*) filter (where ${userNotifications.isRead} = false)`,
      total: sql<number>`count(*)`,
    })
    .from(userNotifications)
    .where(and(eq(userNotifications.pharmacyId, pharmacyId), eq(userNotifications.userId, userId)));

  const unreadCount = Number(countRow?.unread ?? 0);
  const total = Number(countRow?.total ?? 0);

  return {
    items: rows.map((r) => ({
      id: r.id,
      pharmacyId: r.pharmacyId,
      userId: r.userId,
      type: r.type as NotificationType,
      title: r.title,
      message: r.message,
      severity: r.severity as NotificationSeverity,
      entityType: r.entityType,
      entityId: r.entityId,
      link: r.link,
      isRead: r.isRead,
      readAt: r.readAt,
      createdAt: r.createdAt,
    })),
    unreadCount,
    total,
  };
}

export async function markNotificationAsRead(
  db: NodePgDatabase<typeof schema>,
  pharmacyId: string,
  userId: string,
  notificationId: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await db
    .update(userNotifications)
    .set({
      isRead: true,
      readAt: now,
    })
    .where(
      and(
        eq(userNotifications.id, notificationId),
        eq(userNotifications.pharmacyId, pharmacyId),
        eq(userNotifications.userId, userId)
      )
    )
    .returning({ id: userNotifications.id });

  return res.length > 0;
}

export async function markAllNotificationsAsRead(
  db: NodePgDatabase<typeof schema>,
  pharmacyId: string,
  userId: string
): Promise<number> {
  const now = new Date().toISOString();
  const res = await db
    .update(userNotifications)
    .set({
      isRead: true,
      readAt: now,
    })
    .where(
      and(
        eq(userNotifications.pharmacyId, pharmacyId),
        eq(userNotifications.userId, userId),
        eq(userNotifications.isRead, false)
      )
    )
    .returning({ id: userNotifications.id });

  return res.length;
}

export async function refreshSystemNotifications(
  db: NodePgDatabase<typeof schema>,
  pharmacyId: string,
  userId: string,
  userRole?: string
): Promise<number> {
  const nowIso = new Date().toISOString();
  const today = getKarachiBusinessDate(nowIso);
  const thirtyDaysAhead = getKarachiBusinessDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

  let newAlertsCount = 0;

  // 1. Check Expiring Stock (Positive Stock Only, Permitted Roles Only)
  const canViewStock = !userRole || ['owner', 'manager', 'pharmacist'].includes(userRole);
  if (canViewStock) {
    const expiringBatches = await db
      .select({
        batchId: batches.id,
        batchNo: batches.batchNo,
        expiryDate: batches.expiryDate,
        productName: products.brandName,
        stock: sql<number>`COALESCE(SUM(${stockMovements.quantitySigned}), 0)`.mapWith(Number),
      })
      .from(batches)
      .innerJoin(products, eq(batches.productId, products.id))
      .innerJoin(
        stockMovements,
        and(eq(batches.id, stockMovements.batchId), eq(stockMovements.pharmacyId, pharmacyId))
      )
      .where(
        and(
          eq(batches.pharmacyId, pharmacyId),
          gte(batches.expiryDate, today),
          lte(batches.expiryDate, thirtyDaysAhead)
        )
      )
      .groupBy(batches.id, batches.batchNo, batches.expiryDate, products.brandName)
      .having(sql`COALESCE(SUM(${stockMovements.quantitySigned}), 0) > 0`)
      .limit(5);

    for (const b of expiringBatches) {
      // Check if notification already exists for this batch
      const [existing] = await db
        .select({ id: userNotifications.id })
        .from(userNotifications)
        .where(
          and(
            eq(userNotifications.pharmacyId, pharmacyId),
            eq(userNotifications.userId, userId),
            eq(userNotifications.entityId, b.batchId),
            eq(userNotifications.type, 'expiring_stock')
          )
        )
        .limit(1);

      if (!existing) {
        await db.insert(userNotifications).values({
          id: generateUuidV7(),
          pharmacyId,
          userId,
          type: 'expiring_stock',
          title: `Expiring Batch: ${b.productName}`,
          message: `Batch ${b.batchNo} expires on ${b.expiryDate}. Please rotate or return.`,
          severity: 'warning',
          entityType: 'batch',
          entityId: b.batchId,
          link: '/batches-expiry',
          isRead: false,
          createdAt: nowIso,
        });
        newAlertsCount++;
      }
    }
  }

  // 2. Check Sync Exceptions (Owner / Manager Only)
  const canViewSync = !userRole || ['owner', 'manager'].includes(userRole);
  if (canViewSync) {
    const exceptions = await db
      .select({ id: rejectedEvents.id, message: rejectedEvents.message })
      .from(rejectedEvents)
      .where(eq(rejectedEvents.pharmacyId, pharmacyId))
      .limit(3);

    for (const exc of exceptions) {
      const [existing] = await db
        .select({ id: userNotifications.id })
        .from(userNotifications)
        .where(
          and(
            eq(userNotifications.pharmacyId, pharmacyId),
            eq(userNotifications.userId, userId),
            eq(userNotifications.entityId, exc.id),
            eq(userNotifications.type, 'sync_exceptions')
          )
        )
        .limit(1);

      if (!existing) {
        await db.insert(userNotifications).values({
          id: generateUuidV7(),
          pharmacyId,
          userId,
          type: 'sync_exceptions',
          title: 'Sync Conflict Detected',
          message: `Sync payload rejected: ${exc.message.slice(0, 100)}`,
          severity: 'critical',
          entityType: 'rejected_event',
          entityId: exc.id,
          link: '/admin-devices',
          isRead: false,
          createdAt: nowIso,
        });
        newAlertsCount++;
      }
    }
  }

  // 3. Check Period Close Reminders (Owner / Accountant Only)
  const canViewPeriodClose = !userRole || ['owner', 'accountant'].includes(userRole);
  if (canViewPeriodClose) {
    const openPeriods = await db
      .select({ id: fiscalPeriods.id, endDate: fiscalPeriods.endDate })
      .from(fiscalPeriods)
      .where(
        and(
          eq(fiscalPeriods.pharmacyId, pharmacyId),
          eq(fiscalPeriods.status, 'open'),
          lte(fiscalPeriods.endDate, today)
        )
      )
      .limit(1);

    if (openPeriods.length > 0 && openPeriods[0]) {
      const period = openPeriods[0];
      const [existing] = await db
        .select({ id: userNotifications.id })
        .from(userNotifications)
        .where(
          and(
            eq(userNotifications.pharmacyId, pharmacyId),
            eq(userNotifications.userId, userId),
            eq(userNotifications.entityId, period.id),
            eq(userNotifications.type, 'period_close')
          )
        )
        .limit(1);

      if (!existing) {
        await db.insert(userNotifications).values({
          id: generateUuidV7(),
          pharmacyId,
          userId,
          type: 'period_close',
          title: 'Fiscal Period Close Due',
          message: `Fiscal period ended on ${period.endDate} is still open. Please complete period close checklist.`,
          severity: 'info',
          entityType: 'fiscal_period',
          entityId: period.id,
          link: '/finance-period-close',
          isRead: false,
          createdAt: nowIso,
        });
        newAlertsCount++;
      }
    }
  }

  return newAlertsCount;
}
