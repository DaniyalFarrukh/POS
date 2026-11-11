import type { FastifyPluginAsync } from 'fastify';
import { eq, and, sql, desc, asc, ilike, or } from 'drizzle-orm';
import { z, generateUuidV7, normalizePhone, isValidUuid } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import { customers, invoices, journalEntries, journalLines, pharmacies } from '../db/schema';
import { getPharmacyAccountMap } from '../ledger/coa-seed';
import { postJournalEntry } from '../ledger/service';
import { insertChangeLog } from '../sync/change-log';
import { toKarachiBusinessDate } from '../ledger/posting-engine';

const CreateCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().nullable().optional(),
  creditLimitPaisa: z.number().int().min(0).default(0),
  openingBalancePaisa: z.number().int().default(0),
  priceTier: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

const UpdateCustomerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().nullable().optional(),
  creditLimitPaisa: z.number().int().min(0).optional(),
  priceTier: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const customerRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/customers
   * Scoped by pharmacy_id.
   * Permission: sales.customer.view
   */
  app.get(
    '/',
    {
      preHandler: [requirePermission('sales.customer.view')],
    },
    async (request, reply) => {
      const pharmacyId = request.userContext!.pharmacyId;
      const db = request.server.db || getDb();
      const query = request.query as {
        search?: string;
        isActive?: string;
        hasBalance?: string;
      };

      const accountMap = await getPharmacyAccountMap(db, pharmacyId);

      // Base query for customers
      let whereClause = eq(customers.pharmacyId, pharmacyId);
      if (query.isActive !== undefined) {
        whereClause = and(whereClause, eq(customers.isActive, query.isActive === 'true'))!;
      }

      if (query.search && query.search.trim()) {
        const s = `%${query.search.trim()}%`;
        whereClause = and(
          whereClause,
          or(ilike(customers.name, s), ilike(customers.phone, s), ilike(customers.email, s))
        )!;
      }

      const allCustomers = await db
        .select()
        .from(customers)
        .where(whereClause)
        .orderBy(asc(customers.name));

      // Calculate ledger AR balance per customer for this pharmacy
      const balances = await db
        .select({
          customerId: journalLines.partyId,
          totalDebit: sql<number>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
          totalCredit: sql<number>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
        })
        .from(journalLines)
        .where(
          and(
            eq(journalLines.pharmacyId, pharmacyId),
            eq(journalLines.accountId, accountMap.ar),
            eq(journalLines.partyType, 'customer')
          )
        )
        .groupBy(journalLines.partyId);

      const balanceMap = new Map<string, number>();
      for (const b of balances) {
        if (b.customerId) {
          balanceMap.set(b.customerId, Number(b.totalDebit) - Number(b.totalCredit));
        }
      }

      const data = allCustomers.map((c) => {
        const currentBalancePaisa = balanceMap.get(c.id) ?? c.openingBalancePaisa;
        const creditLimitPaisa = c.creditLimitPaisa;
        const creditAvailablePaisa = Math.max(0, creditLimitPaisa - currentBalancePaisa);
        return {
          ...c,
          currentBalancePaisa,
          creditAvailablePaisa,
        };
      });

      if (query.hasBalance === 'true') {
        return reply.send({
          success: true,
          data: data.filter((d) => d.currentBalancePaisa > 0),
        });
      }

      return reply.send({
        success: true,
        data,
      });
    }
  );

  /**
   * POST /api/customers
   * Scoped by pharmacy_id.
   * Permission: sales.customer.manage
   */
  app.post(
    '/',
    {
      preHandler: [requirePermission('sales.customer.manage')],
    },
    async (request, reply) => {
      const pharmacyId = request.userContext!.pharmacyId;
      const db = request.server.db || getDb();
      const parseResult = CreateCustomerSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: 'VALIDATION_ERROR',
          message: parseResult.error.message,
        });
      }

      const body = parseResult.data;
      const normalized = normalizePhone(body.phone);

      // Check for duplicate phone among active primary customers
      if (normalized) {
        const [existing] = await db
          .select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(
            and(
              eq(customers.pharmacyId, pharmacyId),
              eq(customers.phone, normalized),
              eq(customers.isDuplicate, false)
            )
          )
          .limit(1);

        if (existing) {
          return reply.status(400).send({
            success: false,
            error: 'PHONE_ALREADY_EXISTS',
            message: `A customer named "${existing.name}" with phone ${normalized} already exists`,
          });
        }
      }

      const customerId = generateUuidV7();
      const nowIso = new Date().toISOString();

      const newCustomer = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(customers)
          .values({
            id: customerId,
            pharmacyId,
            name: body.name.trim(),
            phone: normalized,
            email: body.email?.trim() || null,
            address: body.address?.trim() || null,
            creditLimitPaisa: body.creditLimitPaisa,
            openingBalancePaisa: body.openingBalancePaisa,
            priceTier: body.priceTier || null,
            isActive: body.isActive,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .returning();

        // Post opening balance journal entry if openingBalancePaisa > 0 (D2)
        if (body.openingBalancePaisa > 0) {
          const accountMap = await getPharmacyAccountMap(tx, pharmacyId);
          const entryDate = toKarachiBusinessDate(nowIso);
          await postJournalEntry(tx, {
            pharmacyId,
            entryDate,
            sourceType: 'customer_opening_balance',
            sourceId: customerId,
            memo: `Customer opening balance: ${body.name}`,
            createdBy: request.userContext!.userId,
            lines: [
              {
                accountId: accountMap.ar,
                debitPaisa: body.openingBalancePaisa,
                creditPaisa: 0,
                partyType: 'customer',
                partyId: customerId,
                memo: `Opening balance for ${body.name}`,
              },
              {
                accountId: accountMap.opening_balance_equity,
                debitPaisa: 0,
                creditPaisa: body.openingBalancePaisa,
                memo: `Customer opening balance offset: ${body.name}`,
              },
            ],
          });
        }

        // Sync as master data pull
        await insertChangeLog(tx, {
          pharmacyId,
          entity: 'customer',
          entityId: customerId,
          op: 'upsert',
          data: {
            id: customerId,
            name: inserted!.name,
            phone: inserted!.phone,
            email: inserted!.email,
            address: inserted!.address,
            creditLimitPaisa: inserted!.creditLimitPaisa,
            openingBalancePaisa: inserted!.openingBalancePaisa,
            priceTier: inserted!.priceTier,
            isActive: inserted!.isActive,
            createdAt: nowIso,
          },
          createdAt: nowIso,
        });

        return inserted;
      });

      return reply.status(201).send({
        success: true,
        data: {
          ...newCustomer,
          currentBalancePaisa: body.openingBalancePaisa,
          creditAvailablePaisa: Math.max(0, body.creditLimitPaisa - body.openingBalancePaisa),
        },
      });
    }
  );

  /**
   * GET /api/customers/:id
   * Scoped by pharmacy_id.
   * Permission: sales.customer.view
   */
  app.get(
    '/:id',
    {
      preHandler: [requirePermission('sales.customer.view')],
    },
    async (request, reply) => {
      const pharmacyId = request.userContext!.pharmacyId;
      const { id } = request.params as { id: string };

      if (!isValidUuid(id)) {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_ID',
          message: 'Invalid customer ID format',
        });
      }

      const db = request.server.db || getDb();

      const [customer] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, id), eq(customers.pharmacyId, pharmacyId)))
        .limit(1);

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: 'NOT_FOUND',
          message: 'Customer not found',
        });
      }

      const accountMap = await getPharmacyAccountMap(db, pharmacyId);
      const [bal] = await db
        .select({
          totalDebit: sql<number>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
          totalCredit: sql<number>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
        })
        .from(journalLines)
        .where(
          and(
            eq(journalLines.pharmacyId, pharmacyId),
            eq(journalLines.accountId, accountMap.ar),
            eq(journalLines.partyType, 'customer'),
            eq(journalLines.partyId, id)
          )
        );

      const currentBalancePaisa = bal
        ? Number(bal.totalDebit) - Number(bal.totalCredit)
        : customer.openingBalancePaisa;
      const creditAvailablePaisa = Math.max(0, customer.creditLimitPaisa - currentBalancePaisa);

      return reply.send({
        success: true,
        data: {
          ...customer,
          currentBalancePaisa,
          creditAvailablePaisa,
        },
      });
    }
  );

  /**
   * PUT /api/customers/:id
   * Scoped by pharmacy_id.
   * Permission: sales.customer.manage
   */
  app.put(
    '/:id',
    {
      preHandler: [requirePermission('sales.customer.manage')],
    },
    async (request, reply) => {
      const pharmacyId = request.userContext!.pharmacyId;
      const { id } = request.params as { id: string };

      if (!isValidUuid(id)) {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_ID',
          message: 'Invalid customer ID format',
        });
      }

      const db = request.server.db || getDb();

      const [existing] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, id), eq(customers.pharmacyId, pharmacyId)))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: 'NOT_FOUND',
          message: 'Customer not found',
        });
      }

      const parseResult = UpdateCustomerSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          success: false,
          error: 'VALIDATION_ERROR',
          message: parseResult.error.message,
        });
      }

      const body = parseResult.data;
      const nowIso = new Date().toISOString();

      let normalized = existing.phone;
      if (body.phone !== undefined) {
        normalized = normalizePhone(body.phone);
        if (normalized && normalized !== existing.phone) {
          const [dup] = await db
            .select({ id: customers.id })
            .from(customers)
            .where(
              and(
                eq(customers.pharmacyId, pharmacyId),
                eq(customers.phone, normalized),
                eq(customers.isDuplicate, false)
              )
            )
            .limit(1);

          if (dup && dup.id !== id) {
            return reply.status(400).send({
              success: false,
              error: 'PHONE_ALREADY_EXISTS',
              message: `A customer with phone ${normalized} already exists`,
            });
          }
        }
      }

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(customers)
          .set({
            name: body.name !== undefined ? body.name.trim() : existing.name,
            phone: normalized,
            email:
              body.email !== undefined ? (body.email ? body.email.trim() : null) : existing.email,
            address:
              body.address !== undefined
                ? body.address
                  ? body.address.trim()
                  : null
                : existing.address,
            creditLimitPaisa:
              body.creditLimitPaisa !== undefined
                ? body.creditLimitPaisa
                : existing.creditLimitPaisa,
            priceTier: body.priceTier !== undefined ? body.priceTier : existing.priceTier,
            isActive: body.isActive !== undefined ? body.isActive : existing.isActive,
            updatedAt: nowIso,
          })
          .where(and(eq(customers.id, id), eq(customers.pharmacyId, pharmacyId)))
          .returning();

        await insertChangeLog(tx, {
          pharmacyId,
          entity: 'customer',
          entityId: id,
          op: 'upsert',
          data: {
            id,
            name: row!.name,
            phone: row!.phone,
            email: row!.email,
            address: row!.address,
            creditLimitPaisa: row!.creditLimitPaisa,
            priceTier: row!.priceTier,
            isActive: row!.isActive,
            updatedAt: nowIso,
          },
          createdAt: nowIso,
        });

        return row;
      });

      return reply.send({
        success: true,
        data: updated,
      });
    }
  );

  /**
   * GET /api/customers/:id/invoices
   * Scoped by pharmacy_id.
   * Permission: sales.customer.view
   */
  app.get(
    '/:id/invoices',
    {
      preHandler: [requirePermission('sales.customer.view')],
    },
    async (request, reply) => {
      const pharmacyId = request.userContext!.pharmacyId;
      const { id } = request.params as { id: string };

      if (!isValidUuid(id)) {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_ID',
          message: 'Invalid customer ID format',
        });
      }

      const db = request.server.db || getDb();

      const [customer] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, id), eq(customers.pharmacyId, pharmacyId)))
        .limit(1);

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: 'NOT_FOUND',
          message: 'Customer not found',
        });
      }

      const invList = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.pharmacyId, pharmacyId), eq(invoices.customerId, id)))
        .orderBy(desc(invoices.createdAt));

      return reply.send({
        success: true,
        data: invList,
      });
    }
  );

  /**
   * GET /api/customers/:id/ledger
   * Scoped by pharmacy_id.
   * Permission: sales.customer.view
   */
  app.get(
    '/:id/ledger',
    {
      preHandler: [requirePermission('sales.customer.view')],
    },
    async (request, reply) => {
      const pharmacyId = request.userContext!.pharmacyId;
      const { id } = request.params as { id: string };

      if (!isValidUuid(id)) {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_ID',
          message: 'Invalid customer ID format',
        });
      }

      const db = request.server.db || getDb();
      const query = request.query as {
        startDate?: string;
        endDate?: string;
        branchId?: string;
      };

      const [customer] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, id), eq(customers.pharmacyId, pharmacyId)))
        .limit(1);

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: 'NOT_FOUND',
          message: 'Customer not found',
        });
      }

      const accountMap = await getPharmacyAccountMap(db, pharmacyId);
      const startDate = query.startDate || '1970-01-01';
      const endDate = query.endDate || '2099-12-31';

      // 1. Opening balance prior to startDate
      const [prior] = await db
        .select({
          totalDebit: sql<number>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
          totalCredit: sql<number>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, pharmacyId),
            eq(journalLines.accountId, accountMap.ar),
            eq(journalLines.partyType, 'customer'),
            eq(journalLines.partyId, id),
            sql`${journalEntries.entryDate} < ${startDate}`
          )
        );

      const openingBalancePaisa = prior
        ? Number(prior.totalDebit) - Number(prior.totalCredit)
        : customer.openingBalancePaisa;

      // 2. Period transactions
      const lines = await db
        .select({
          id: journalLines.id,
          entryId: journalLines.entryId,
          entryNo: journalEntries.entryNo,
          entryDate: journalEntries.entryDate,
          sourceType: journalEntries.sourceType,
          sourceId: journalEntries.sourceId,
          memo: sql<string>`COALESCE(${journalLines.memo}, ${journalEntries.memo}, '')`,
          debitPaisa: journalLines.debitPaisa,
          creditPaisa: journalLines.creditPaisa,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, pharmacyId),
            eq(journalLines.accountId, accountMap.ar),
            eq(journalLines.partyType, 'customer'),
            eq(journalLines.partyId, id),
            sql`${journalEntries.entryDate} >= ${startDate}`,
            sql`${journalEntries.entryDate} <= ${endDate}`
          )
        )
        .orderBy(asc(journalEntries.entryDate), asc(journalEntries.entryNo));

      let running = openingBalancePaisa;
      let totalDebits = 0;
      let totalCredits = 0;

      const linesWithRunning = lines.map((l) => {
        totalDebits += l.debitPaisa;
        totalCredits += l.creditPaisa;
        running = running + l.debitPaisa - l.creditPaisa;
        return {
          ...l,
          runningBalancePaisa: running,
        };
      });

      const closingBalancePaisa = running;

      return reply.send({
        success: true,
        data: {
          customer,
          startDate,
          endDate,
          openingBalancePaisa,
          totalDebitsPaisa: totalDebits,
          totalCreditsPaisa: totalCredits,
          closingBalancePaisa,
          lines: linesWithRunning,
        },
      });
    }
  );

  /**
   * GET /api/customers/:id/statement
   * Formatted statement view for printable/PDF rendering.
   * Permission: sales.customer.view
   */
  app.get(
    '/:id/statement',
    {
      preHandler: [requirePermission('sales.customer.view')],
    },
    async (request, reply) => {
      const pharmacyId = request.userContext!.pharmacyId;
      const { id } = request.params as { id: string };

      if (!isValidUuid(id)) {
        return reply.status(400).send({
          success: false,
          error: 'INVALID_ID',
          message: 'Invalid customer ID format',
        });
      }

      const db = request.server.db || getDb();
      const query = request.query as {
        startDate?: string;
        endDate?: string;
      };

      const [pharmacy] = await db
        .select()
        .from(pharmacies)
        .where(eq(pharmacies.id, pharmacyId))
        .limit(1);

      const [customer] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, id), eq(customers.pharmacyId, pharmacyId)))
        .limit(1);

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: 'NOT_FOUND',
          message: 'Customer not found',
        });
      }

      const accountMap = await getPharmacyAccountMap(db, pharmacyId);
      const startDate = query.startDate || '2026-01-01';
      const endDate = query.endDate || toKarachiBusinessDate(new Date().toISOString());

      // 1. Prior balance
      const [prior] = await db
        .select({
          totalDebit: sql<number>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
          totalCredit: sql<number>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, pharmacyId),
            eq(journalLines.accountId, accountMap.ar),
            eq(journalLines.partyType, 'customer'),
            eq(journalLines.partyId, id),
            sql`${journalEntries.entryDate} < ${startDate}`
          )
        );

      const openingBalancePaisa = prior
        ? Number(prior.totalDebit) - Number(prior.totalCredit)
        : customer.openingBalancePaisa;

      // 2. Period lines
      const periodLines = await db
        .select({
          id: journalLines.id,
          date: journalEntries.entryDate,
          entryNo: journalEntries.entryNo,
          reference: sql<string>`COALESCE(${journalEntries.sourceType}, 'Journal')`,
          description: sql<string>`COALESCE(${journalLines.memo}, ${journalEntries.memo}, '')`,
          debitPaisa: journalLines.debitPaisa,
          creditPaisa: journalLines.creditPaisa,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, pharmacyId),
            eq(journalLines.accountId, accountMap.ar),
            eq(journalLines.partyType, 'customer'),
            eq(journalLines.partyId, id),
            sql`${journalEntries.entryDate} >= ${startDate}`,
            sql`${journalEntries.entryDate} <= ${endDate}`
          )
        )
        .orderBy(asc(journalEntries.entryDate), asc(journalEntries.entryNo));

      let running = openingBalancePaisa;
      let totalDebits = 0;
      let totalCredits = 0;

      const transactions = periodLines.map((line) => {
        totalDebits += line.debitPaisa;
        totalCredits += line.creditPaisa;
        running = running + line.debitPaisa - line.creditPaisa;
        return {
          ...line,
          balancePaisa: running,
        };
      });

      return reply.send({
        success: true,
        data: {
          pharmacy: {
            id: pharmacy?.id,
            name: pharmacy?.name,
            code: pharmacy?.code,
          },
          customer: {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            address: customer.address,
            creditLimitPaisa: customer.creditLimitPaisa,
          },
          period: {
            startDate,
            endDate,
            generatedAt: new Date().toISOString(),
          },
          openingBalancePaisa,
          totalDebitsPaisa: totalDebits,
          totalCreditsPaisa: totalCredits,
          closingBalancePaisa: running,
          transactions,
        },
      });
    }
  );
};
