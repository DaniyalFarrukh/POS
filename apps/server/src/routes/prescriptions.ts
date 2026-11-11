import type { FastifyPluginAsync } from 'fastify';
import { eq, and, desc, asc, sql, ilike, or } from 'drizzle-orm';
import {
  generateUuidV7,
  isValidUuid,
  CreatePrescriptionInputSchema,
  UpdatePrescriptionInputSchema,
  DispensePrescriptionInputSchema,
  RefillReminderQuerySchema,
} from '@pos/shared';
import type { DbClient } from '../sync/types';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  prescriptions,
  prescriptionItems,
  prescriptionAccessLogs,
  customers,
  invoices,
  products,
} from '../db/schema';
import { insertChangeLog } from '../sync/change-log';
import { toKarachiBusinessDate } from '../ledger/posting-engine';

function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  date.setUTCDate(date.getUTCDate() + days);
  return toKarachiBusinessDate(date);
}

function addYearsToDate(dateStr: string, years: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetYear = y! + years;
  return `${targetYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const prescriptionRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Helper to write immutable prescription access log entry
   */
  async function logPrescriptionAccess(
    client: DbClient,
    pharmacyId: string,
    prescriptionId: string | null,
    userId: string,
    userRole: string,
    action:
      'view_detail' | 'view_list' | 'view_reminders' | 'create' | 'update' | 'dispense' | 'refill',
    details?: string
  ) {
    await client.insert(prescriptionAccessLogs).values({
      id: generateUuidV7(),
      pharmacyId,
      prescriptionId,
      userId,
      userRole,
      action,
      details: details ?? null,
      accessedAt: new Date().toISOString(),
    });
  }

  /**
   * GET /api/prescriptions/refill-reminders
   * Must be registered before /:id route!
   * Refill reminders list due in the next N days.
   * Permission: sales.prescription.view
   */
  app.get(
    '/refill-reminders',
    {
      preHandler: [requirePermission('sales.prescription.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const pharmacyId = userContext.pharmacyId;
      const db = request.server.db || getDb();

      const parseQuery = RefillReminderQuerySchema.safeParse(request.query);
      const query = parseQuery.success ? parseQuery.data : { daysAhead: 7 };

      const today = toKarachiBusinessDate(new Date().toISOString());
      const cutoffDate = addDaysToDate(today, query.daysAhead);

      // Query active prescriptions with remaining repeats where nextRefillDate <= cutoffDate
      let whereClause = and(
        eq(prescriptions.pharmacyId, pharmacyId),
        eq(prescriptions.status, 'active'),
        sql`${prescriptions.repeatsUsed} < ${prescriptions.repeatCount}`,
        sql`${prescriptions.nextRefillDate} IS NOT NULL`,
        sql`${prescriptions.nextRefillDate} <= ${cutoffDate}`
      )!;

      if (query.isControlled) {
        whereClause = and(
          whereClause,
          eq(prescriptions.isControlledDrug, query.isControlled === 'true')
        )!;
      }

      const rows = await db
        .select({
          id: prescriptions.id,
          prescriptionNumber: prescriptions.prescriptionNumber,
          patientName: prescriptions.patientName,
          patientPhone: prescriptions.patientPhone,
          doctorName: prescriptions.doctorName,
          doctorPhone: prescriptions.doctorClinic,
          prescriptionDate: prescriptions.prescriptionDate,
          repeatCount: prescriptions.repeatCount,
          repeatsUsed: prescriptions.repeatsUsed,
          nextRefillDate: prescriptions.nextRefillDate,
          isControlledDrug: prescriptions.isControlledDrug,
          customerId: prescriptions.customerId,
          customerPhone: customers.phone,
        })
        .from(prescriptions)
        .leftJoin(customers, eq(prescriptions.customerId, customers.id))
        .where(whereClause)
        .orderBy(asc(prescriptions.nextRefillDate));

      const items = rows.map((r) => {
        const remainingRepeats = r.repeatCount - r.repeatsUsed;
        const phone = r.patientPhone || r.customerPhone || 'N/A';
        const contactSummary = `Patient: ${r.patientName} | Phone: ${phone} | Rx: ${r.prescriptionNumber} | Next Refill Due: ${r.nextRefillDate} | Remaining Refills: ${remainingRepeats}`;
        return {
          prescriptionId: r.id,
          prescriptionNumber: r.prescriptionNumber,
          patientName: r.patientName,
          patientPhone: phone,
          doctorName: r.doctorName || 'N/A',
          prescriptionDate: r.prescriptionDate,
          nextRefillDate: r.nextRefillDate,
          repeatCount: r.repeatCount,
          repeatsUsed: r.repeatsUsed,
          remainingRepeats,
          isControlledDrug: r.isControlledDrug,
          contactSummary,
        };
      });

      await logPrescriptionAccess(
        db,
        pharmacyId,
        null,
        userContext.userId,
        userContext.role,
        'view_reminders',
        `Queried refill reminders with window of ${query.daysAhead} days (${items.length} records found)`
      );

      return reply.send({
        success: true,
        data: {
          today,
          cutoffDate,
          daysAhead: query.daysAhead,
          total: items.length,
          items,
        },
      });
    }
  );

  /**
   * GET /api/prescriptions
   * Scoped by pharmacyId.
   * Permission: sales.prescription.view
   */
  app.get(
    '/',
    {
      preHandler: [requirePermission('sales.prescription.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const pharmacyId = userContext.pharmacyId;
      const db = request.server.db || getDb();
      const query = request.query as {
        status?: string;
        isControlled?: string;
        customerId?: string;
        search?: string;
        limit?: string;
        offset?: string;
      };

      let whereClause = eq(prescriptions.pharmacyId, pharmacyId);

      if (query.status) {
        whereClause = and(
          whereClause,
          eq(prescriptions.status, query.status as 'active' | 'fulfilled' | 'cancelled' | 'expired')
        )!;
      }

      if (query.isControlled !== undefined) {
        whereClause = and(
          whereClause,
          eq(prescriptions.isControlledDrug, query.isControlled === 'true')
        )!;
      }

      if (query.customerId) {
        whereClause = and(whereClause, eq(prescriptions.customerId, query.customerId))!;
      }

      if (query.search && query.search.trim()) {
        const s = `%${query.search.trim()}%`;
        whereClause = and(
          whereClause,
          or(
            ilike(prescriptions.patientName, s),
            ilike(prescriptions.prescriptionNumber, s),
            ilike(prescriptions.doctorName, s),
            ilike(prescriptions.patientPhone, s)
          )
        )!;
      }

      const list = await db
        .select({
          id: prescriptions.id,
          prescriptionNumber: prescriptions.prescriptionNumber,
          patientName: prescriptions.patientName,
          patientPhone: prescriptions.patientPhone,
          patientAge: prescriptions.patientAge,
          patientGender: prescriptions.patientGender,
          doctorName: prescriptions.doctorName,
          doctorRegistrationNumber: prescriptions.doctorRegistrationNumber,
          prescriptionDate: prescriptions.prescriptionDate,
          repeatCount: prescriptions.repeatCount,
          repeatsUsed: prescriptions.repeatsUsed,
          refillIntervalDays: prescriptions.refillIntervalDays,
          nextRefillDate: prescriptions.nextRefillDate,
          isControlledDrug: prescriptions.isControlledDrug,
          invoiceId: prescriptions.invoiceId,
          status: prescriptions.status,
          statutoryRetentionUntil: prescriptions.statutoryRetentionUntil,
          createdAt: prescriptions.createdAt,
          customerId: prescriptions.customerId,
          customerName: customers.name,
        })
        .from(prescriptions)
        .leftJoin(customers, eq(prescriptions.customerId, customers.id))
        .where(whereClause)
        .orderBy(desc(prescriptions.prescriptionDate), desc(prescriptions.createdAt))
        .limit(Math.min(Math.max(Number(query.limit) || 100, 1), 500))
        .offset(Math.max(Number(query.offset) || 0, 0));

      await logPrescriptionAccess(
        db,
        pharmacyId,
        null,
        userContext.userId,
        userContext.role,
        'view_list',
        `Prescription listing viewed (${list.length} records)`
      );

      return reply.send({
        success: true,
        data: list,
      });
    }
  );

  /**
   * POST /api/prescriptions
   * Scoped by pharmacyId.
   * Permission: sales.prescription.manage
   */
  app.post(
    '/',
    {
      preHandler: [requirePermission('sales.prescription.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const pharmacyId = userContext.pharmacyId;
      const db = request.server.db || getDb();

      const parseResult = CreatePrescriptionInputSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: 'VALIDATION_ERROR',
          message: parseResult.error.message,
        });
      }

      const body = parseResult.data;
      const nowIso = new Date().toISOString();

      // Check if any line has controlled medication
      const hasControlledItem = body.items.some((i) => Boolean(i.isControlled));
      const isControlled = Boolean(body.isControlledDrug || hasControlledItem);

      // Calculate statutory retention: 5 years for controlled, 2 years for standard
      const statutoryRetentionUntil = isControlled
        ? addYearsToDate(body.prescriptionDate, 5)
        : addYearsToDate(body.prescriptionDate, 2);

      // Initial next refill date
      let nextRefillDate: string | null = null;
      if (body.repeatCount > 0) {
        nextRefillDate = addDaysToDate(body.prescriptionDate, body.refillIntervalDays);
      }

      // Verify customerId belongs to this pharmacy if provided
      if (body.customerId) {
        const [cust] = await db
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.id, body.customerId), eq(customers.pharmacyId, pharmacyId)))
          .limit(1);
        if (!cust) {
          return reply.status(404).send({
            success: false,
            error: 'NOT_FOUND',
            message: 'Customer not found in this pharmacy',
          });
        }
      }

      // Verify invoiceId belongs to this pharmacy if provided
      if (body.invoiceId) {
        const [inv] = await db
          .select({ id: invoices.id })
          .from(invoices)
          .where(and(eq(invoices.id, body.invoiceId), eq(invoices.pharmacyId, pharmacyId)))
          .limit(1);
        if (!inv) {
          return reply.status(404).send({
            success: false,
            error: 'NOT_FOUND',
            message: 'Invoice not found in this pharmacy',
          });
        }
      }

      // Verify all item productIds belong to this pharmacy
      for (const item of body.items) {
        const [prod] = await db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, item.productId), eq(products.pharmacyId, pharmacyId)))
          .limit(1);
        if (!prod) {
          return reply.status(404).send({
            success: false,
            error: 'NOT_FOUND',
            message: `Product ${item.productId} not found in this pharmacy`,
          });
        }
      }

      const prescriptionId = generateUuidV7();
      const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString();
      const datePart = body.prescriptionDate.replace(/-/g, '');
      const prescriptionNumber = `RX-${datePart}-${randomSuffix}`;

      const result = await db.transaction(async (tx) => {
        // Insert prescription header
        const [newRx] = await tx
          .insert(prescriptions)
          .values({
            id: prescriptionId,
            pharmacyId,
            prescriptionNumber,
            customerId: body.customerId || null,
            patientName: body.patientName.trim(),
            patientPhone: body.patientPhone?.trim() || null,
            patientAge: body.patientAge ?? null,
            patientGender: body.patientGender || null,
            doctorName: body.doctorName?.trim() || null,
            doctorRegistrationNumber: body.doctorRegistrationNumber?.trim() || null,
            doctorClinic: body.doctorClinic?.trim() || null,
            prescriptionDate: body.prescriptionDate,
            diagnosis: body.diagnosis?.trim() || null,
            repeatCount: body.repeatCount,
            repeatsUsed: 0,
            refillIntervalDays: body.refillIntervalDays,
            nextRefillDate,
            isControlledDrug: isControlled,
            invoiceId: body.invoiceId || null,
            status: 'active',
            notes: body.notes?.trim() || null,
            retentionStatus: 'active',
            statutoryRetentionUntil,
            createdBy: userContext.userId,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .returning();

        // Insert prescription items
        const itemRows = body.items.map((item) => ({
          id: item.id || generateUuidV7(),
          pharmacyId,
          prescriptionId,
          productId: item.productId,
          dosageInstructions: item.dosageInstructions.trim(),
          quantityPrescribed: item.quantityPrescribed,
          quantityDispensed: 0,
          daysSupply: item.daysSupply,
          isControlled: Boolean(item.isControlled),
          notes: item.notes?.trim() || null,
          createdAt: nowIso,
        }));

        await tx.insert(prescriptionItems).values(itemRows);

        // Log creation in access audit log
        await logPrescriptionAccess(
          tx,
          pharmacyId,
          prescriptionId,
          userContext.userId,
          userContext.role,
          'create',
          `Prescription ${prescriptionNumber} registered with ${body.items.length} items (Controlled: ${isControlled})`
        );

        // Non-PHI change log for sync (no patient medical details leaked into change_log)
        await insertChangeLog(tx, {
          pharmacyId,
          entity: 'prescription',
          entityId: prescriptionId,
          op: 'upsert',
          data: {
            id: prescriptionId,
            prescriptionNumber,
            prescriptionDate: body.prescriptionDate,
            isControlledDrug: isControlled,
            status: 'active',
          },
          createdAt: nowIso,
        });

        return {
          ...newRx,
          items: itemRows,
        };
      });

      return reply.status(201).send({
        success: true,
        data: result,
      });
    }
  );

  /**
   * GET /api/prescriptions/:id
   * Scoped by pharmacyId.
   * Logs view_detail in audit log.
   * Permission: sales.prescription.view
   */
  app.get(
    '/:id',
    {
      preHandler: [requirePermission('sales.prescription.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const pharmacyId = userContext.pharmacyId;
      const { id } = request.params as { id: string };
      if (!isValidUuid(id)) {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_ID',
          message: 'Invalid prescription ID format',
        });
      }
      const db = request.server.db || getDb();

      const [rx] = await db
        .select()
        .from(prescriptions)
        .where(and(eq(prescriptions.id, id), eq(prescriptions.pharmacyId, pharmacyId)))
        .limit(1);

      if (!rx) {
        return reply.status(404).send({
          success: false,
          error: 'NOT_FOUND',
          message: 'Prescription not found',
        });
      }

      // Fetch items joined with product names
      const items = await db
        .select({
          id: prescriptionItems.id,
          productId: prescriptionItems.productId,
          productName: products.brandName,
          genericName: products.genericName,
          dosageInstructions: prescriptionItems.dosageInstructions,
          quantityPrescribed: prescriptionItems.quantityPrescribed,
          quantityDispensed: prescriptionItems.quantityDispensed,
          daysSupply: prescriptionItems.daysSupply,
          isControlled: prescriptionItems.isControlled,
          notes: prescriptionItems.notes,
        })
        .from(prescriptionItems)
        .innerJoin(
          products,
          and(eq(prescriptionItems.productId, products.id), eq(products.pharmacyId, pharmacyId))
        )
        .where(
          and(
            eq(prescriptionItems.prescriptionId, id),
            eq(prescriptionItems.pharmacyId, pharmacyId)
          )
        );

      // Fetch linked customer if available
      let customer = null;
      if (rx.customerId) {
        const [c] = await db
          .select({
            id: customers.id,
            name: customers.name,
            phone: customers.phone,
            address: customers.address,
          })
          .from(customers)
          .where(and(eq(customers.id, rx.customerId), eq(customers.pharmacyId, pharmacyId)))
          .limit(1);
        customer = c || null;
      }

      // Fetch linked invoice if dispensed
      let invoice = null;
      if (rx.invoiceId) {
        const [inv] = await db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            totalPaisa: invoices.totalPaisa,
            createdAt: invoices.createdAt,
          })
          .from(invoices)
          .where(and(eq(invoices.id, rx.invoiceId), eq(invoices.pharmacyId, pharmacyId)))
          .limit(1);
        invoice = inv || null;
      }

      // Audit log view
      await logPrescriptionAccess(
        db,
        pharmacyId,
        id,
        userContext.userId,
        userContext.role,
        'view_detail',
        `Prescription ${rx.prescriptionNumber} detail viewed by ${userContext.name}`
      );

      return reply.send({
        success: true,
        data: {
          ...rx,
          items,
          customer,
          invoice,
        },
      });
    }
  );

  /**
   * PUT /api/prescriptions/:id
   * Scoped by pharmacyId.
   * Permission: sales.prescription.manage
   */
  app.put(
    '/:id',
    {
      preHandler: [requirePermission('sales.prescription.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const pharmacyId = userContext.pharmacyId;
      const { id } = request.params as { id: string };

      if (!isValidUuid(id)) {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_ID',
          message: 'Invalid prescription ID format',
        });
      }

      const db = request.server.db || getDb();

      const [existing] = await db
        .select()
        .from(prescriptions)
        .where(and(eq(prescriptions.id, id), eq(prescriptions.pharmacyId, pharmacyId)))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: 'NOT_FOUND',
          message: 'Prescription not found',
        });
      }

      const parseResult = UpdatePrescriptionInputSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: 'VALIDATION_ERROR',
          message: parseResult.error.message,
        });
      }

      const body = parseResult.data;
      const nowIso = new Date().toISOString();

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(prescriptions)
          .set({
            patientName:
              body.patientName !== undefined ? body.patientName.trim() : existing.patientName,
            patientPhone:
              body.patientPhone !== undefined
                ? body.patientPhone?.trim() || null
                : existing.patientPhone,
            patientAge: body.patientAge !== undefined ? body.patientAge : existing.patientAge,
            patientGender:
              body.patientGender !== undefined ? body.patientGender : existing.patientGender,
            doctorName:
              body.doctorName !== undefined ? body.doctorName?.trim() || null : existing.doctorName,
            doctorRegistrationNumber:
              body.doctorRegistrationNumber !== undefined
                ? body.doctorRegistrationNumber?.trim() || null
                : existing.doctorRegistrationNumber,
            doctorClinic:
              body.doctorClinic !== undefined
                ? body.doctorClinic?.trim() || null
                : existing.doctorClinic,
            diagnosis:
              body.diagnosis !== undefined ? body.diagnosis?.trim() || null : existing.diagnosis,
            repeatCount: body.repeatCount !== undefined ? body.repeatCount : existing.repeatCount,
            refillIntervalDays:
              body.refillIntervalDays !== undefined
                ? body.refillIntervalDays
                : existing.refillIntervalDays,
            isControlledDrug:
              body.isControlledDrug !== undefined
                ? body.isControlledDrug
                : existing.isControlledDrug,
            status: body.status !== undefined ? body.status : existing.status,
            notes: body.notes !== undefined ? body.notes?.trim() || null : existing.notes,
            updatedAt: nowIso,
          })
          .where(and(eq(prescriptions.id, id), eq(prescriptions.pharmacyId, pharmacyId)))
          .returning();

        await logPrescriptionAccess(
          tx,
          pharmacyId,
          id,
          userContext.userId,
          userContext.role,
          'update',
          `Prescription ${existing.prescriptionNumber} updated`
        );

        return row;
      });

      return reply.send({
        success: true,
        data: updated,
      });
    }
  );

  /**
   * POST /api/prescriptions/:id/dispense
   * Links prescription to a finalized sale invoice, increments repeatsUsed, recalculates nextRefillDate.
   * Permission: sales.prescription.manage
   */
  app.post(
    '/:id/dispense',
    {
      preHandler: [requirePermission('sales.prescription.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const pharmacyId = userContext.pharmacyId;
      const { id } = request.params as { id: string };

      if (!isValidUuid(id)) {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_ID',
          message: 'Invalid prescription ID format',
        });
      }

      const db = request.server.db || getDb();

      const [existing] = await db
        .select()
        .from(prescriptions)
        .where(and(eq(prescriptions.id, id), eq(prescriptions.pharmacyId, pharmacyId)))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: 'NOT_FOUND',
          message: 'Prescription not found',
        });
      }

      if (
        existing.status === 'cancelled' ||
        existing.status === 'fulfilled' ||
        existing.status === 'expired'
      ) {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_STATUS',
          message: `Cannot dispense prescription with status '${existing.status}'`,
        });
      }

      if (existing.repeatsUsed >= existing.repeatCount) {
        return reply.status(400).send({
          success: false,
          error: 'REPEATS_EXHAUSTED',
          message: `Prescription has already used all ${existing.repeatCount} allowed dispensations`,
        });
      }

      const parseResult = DispensePrescriptionInputSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: 'VALIDATION_ERROR',
          message: parseResult.error.message,
        });
      }

      const { invoiceId, notes } = parseResult.data;

      // Verify invoice belongs to this pharmacy tenant
      const [inv] = await db
        .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.pharmacyId, pharmacyId)))
        .limit(1);

      if (!inv) {
        return reply.status(404).send({
          success: false,
          error: 'INVOICE_NOT_FOUND',
          message: `Sale invoice ${invoiceId} not found in this pharmacy`,
        });
      }

      const repeatsUsed = existing.repeatsUsed + 1;
      const isFulfilled = repeatsUsed >= existing.repeatCount;
      const nowIso = new Date().toISOString();
      const today = toKarachiBusinessDate(nowIso);

      let nextRefillDate: string | null = null;
      if (!isFulfilled) {
        nextRefillDate = addDaysToDate(today, existing.refillIntervalDays);
      }

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(prescriptions)
          .set({
            invoiceId,
            repeatsUsed,
            status: isFulfilled ? 'fulfilled' : 'active',
            nextRefillDate,
            notes: notes ? `${existing.notes || ''}\n${notes}`.trim() : existing.notes,
            updatedAt: nowIso,
          })
          .where(and(eq(prescriptions.id, id), eq(prescriptions.pharmacyId, pharmacyId)))
          .returning();

        await logPrescriptionAccess(
          tx,
          pharmacyId,
          id,
          userContext.userId,
          userContext.role,
          'dispense',
          `Prescription ${existing.prescriptionNumber} dispensed against Invoice #${inv.invoiceNumber} (Repeats: ${repeatsUsed}/${existing.repeatCount})`
        );

        return row;
      });

      return reply.send({
        success: true,
        data: updated,
      });
    }
  );

  /**
   * GET /api/prescriptions/:id/audit-trail
   * Immutable access audit log for regulatory compliance.
   * Permission: sales.prescription.view
   */
  app.get(
    '/:id/audit-trail',
    {
      preHandler: [requirePermission('sales.prescription.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const pharmacyId = userContext.pharmacyId;
      const { id } = request.params as { id: string };
      if (!isValidUuid(id)) {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_ID',
          message: 'Invalid prescription ID format',
        });
      }
      const db = request.server.db || getDb();

      const [rx] = await db
        .select({ id: prescriptions.id, prescriptionNumber: prescriptions.prescriptionNumber })
        .from(prescriptions)
        .where(and(eq(prescriptions.id, id), eq(prescriptions.pharmacyId, pharmacyId)))
        .limit(1);

      if (!rx) {
        return reply.status(404).send({
          success: false,
          error: 'NOT_FOUND',
          message: 'Prescription not found',
        });
      }

      const logs = await db
        .select()
        .from(prescriptionAccessLogs)
        .where(
          and(
            eq(prescriptionAccessLogs.pharmacyId, pharmacyId),
            eq(prescriptionAccessLogs.prescriptionId, id)
          )
        )
        .orderBy(desc(prescriptionAccessLogs.accessedAt));

      return reply.send({
        success: true,
        data: {
          prescriptionNumber: rx.prescriptionNumber,
          logs,
        },
      });
    }
  );
};
