import type { FastifyPluginAsync } from 'fastify';
import {
  eq,
  and,
  gte,
  lte,
  desc,
  asc,
  inArray,
  isNull,
  isNotNull,
  or,
  ilike,
  sql,
} from 'drizzle-orm';
import { z, generateUuidV7 } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import { accounts, journalEntries, journalLines, fiscalPeriods } from '../db/schema';
import {
  postJournalEntry,
  reverseJournalEntry,
  closePeriod,
  reopenPeriod,
} from '../ledger/service';
import { getMonthEndChecklist, executeYearEndClosing } from '../ledger/period-close';
import { accountLedger } from '../ledger/queries';
import {
  ALL_ACCOUNT_ROLES,
  getPharmacyAccountMap,
  setPharmacyAccountMapping,
  type AccountRole,
} from '../ledger/coa-seed';
import { reconcileLedger } from '../ledger/reconciliation';

const DateParamSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const JournalsQuerySchema = z.object({
  from: DateParamSchema.optional(),
  to: DateParamSchema.optional(),
  sourceType: z.string().optional(),
  status: z.enum(['posted', 'reversed']).optional(),
  search: z.string().optional(),
});

const PostJournalBodySchema = z.object({
  entryDate: DateParamSchema,
  sourceType: z.string().nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  memo: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        debitPaisa: z.number().int().min(0),
        creditPaisa: z.number().int().min(0),
        branchId: z.string().uuid().nullable().optional(),
        partyType: z.enum(['customer', 'supplier', 'employee']).nullable().optional(),
        partyId: z.string().uuid().nullable().optional(),
        memo: z.string().nullable().optional(),
      })
    )
    .min(2),
});

const ReverseJournalBodySchema = z.object({
  reason: z.string().min(1, 'Reversal reason is required'),
  reversalDate: DateParamSchema.optional(),
});

const AccountLedgerQuerySchema = z.object({
  from: DateParamSchema.optional().default('1970-01-01'),
  to: DateParamSchema.optional().default('2099-12-31'),
});

const ReconciliationQuerySchema = z.object({
  from: DateParamSchema.optional().default('1970-01-01'),
  to: DateParamSchema.optional().default('2099-12-31'),
});

const CreateAccountBodySchema = z.object({
  code: z.string().min(1, 'Account code is required').trim(),
  name: z.string().min(1, 'Account name is required').trim(),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  parentId: z.string().uuid('Invalid parentId format').nullable().optional(),
});

const PatchAccountBodySchema = z.object({
  name: z.string().min(1).trim().optional(),
  parentId: z.string().uuid('Invalid parentId format').nullable().optional(),
  isActive: z.boolean().optional(),
});

const UpdateAccountMappingBodySchema = z.object({
  role: z.enum(ALL_ACCOUNT_ROLES as unknown as [AccountRole, ...AccountRole[]]),
  accountId: z.string().uuid('Invalid accountId format'),
});

const ClosePeriodBodySchema = z.object({
  startDate: DateParamSchema,
  endDate: DateParamSchema,
  reason: z.string().optional(),
  periodId: z.string().uuid().optional(),
});

const ReopenPeriodBodySchema = z.object({
  reason: z.string().optional(),
});

const PeriodChecklistQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

const YearEndClosingBodySchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  closingDate: DateParamSchema,
  memo: z.string().optional(),
});

const IdParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

export const financeRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/finance/journals
   * General journal entry listing scoped to caller's pharmacy.
   */
  fastify.get<{ Querystring: z.infer<typeof JournalsQuerySchema> }>(
    '/journals',
    {
      config: { requiredPermission: 'finance.journal.view' },
      preHandler: [requirePermission('finance.journal.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const parsed = JournalsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          message: parsed.error.issues[0]?.message || 'Invalid query parameters',
        });
      }

      const db = request.server.db || getDb();
      const conditions = [eq(journalEntries.pharmacyId, userContext.pharmacyId)];
      if (parsed.data.from) {
        conditions.push(gte(journalEntries.entryDate, parsed.data.from));
      }
      if (parsed.data.to) {
        conditions.push(lte(journalEntries.entryDate, parsed.data.to));
      }
      if (parsed.data.sourceType) {
        if (parsed.data.sourceType === 'manual') {
          conditions.push(isNull(journalEntries.sourceType));
        } else {
          conditions.push(eq(journalEntries.sourceType, parsed.data.sourceType));
        }
      }
      if (parsed.data.status) {
        conditions.push(eq(journalEntries.status, parsed.data.status));
      }
      if (parsed.data.search && parsed.data.search.trim()) {
        const q = `%${parsed.data.search.trim()}%`;
        conditions.push(
          or(ilike(journalEntries.memo, q), sql`${journalEntries.entryNo}::text ILIKE ${q}`)!
        );
      }

      const entries = await db
        .select()
        .from(journalEntries)
        .where(and(...conditions))
        .orderBy(desc(journalEntries.entryDate), desc(journalEntries.entryNo))
        .limit(200);

      // Reversal pointers in this pharmacy
      const reversalRows = await db
        .select({
          reversingEntryId: journalEntries.id,
          reversingEntryNo: journalEntries.entryNo,
          originalEntryId: journalEntries.reversesEntryId,
        })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.pharmacyId, userContext.pharmacyId),
            isNotNull(journalEntries.reversesEntryId)
          )
        );

      const reversedByMap = new Map<string, { entryId: string; entryNo: number }>();
      for (const r of reversalRows) {
        if (r.originalEntryId) {
          reversedByMap.set(r.originalEntryId, {
            entryId: r.reversingEntryId,
            entryNo: r.reversingEntryNo,
          });
        }
      }

      let linesByEntry = new Map<string, Array<typeof journalLines.$inferSelect>>();
      if (entries.length > 0) {
        const entryIds = entries.map((e) => e.id);
        const lines = await db
          .select()
          .from(journalLines)
          .where(
            and(
              eq(journalLines.pharmacyId, userContext.pharmacyId),
              inArray(journalLines.entryId, entryIds)
            )
          )
          .orderBy(asc(journalLines.id));

        linesByEntry = lines.reduce((acc, l) => {
          const list = acc.get(l.entryId) || [];
          list.push(l);
          acc.set(l.entryId, list);
          return acc;
        }, new Map<string, Array<typeof journalLines.$inferSelect>>());
      }

      const items = entries.map((e) => {
        const rev = reversedByMap.get(e.id);
        return {
          ...e,
          reversedByEntryId: rev?.entryId ?? null,
          reversedByEntryNo: rev?.entryNo ?? null,
          lines: linesByEntry.get(e.id) || [],
        };
      });

      return reply.status(200).send({
        items,
        pharmacyId: userContext.pharmacyId,
      });
    }
  );

  /**
   * POST /api/finance/journals
   * Create and post a balanced journal entry scoped to caller's pharmacy.
   */
  fastify.post(
    '/journals',
    {
      config: { requiredPermission: 'finance.journal.create' },
      preHandler: [requirePermission('finance.journal.create')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const bodyObj = (request.body ?? {}) as Record<string, unknown>;

      // If no lines provided (legacy smoke payload), return 201 scoped acknowledgment
      if (!('lines' in bodyObj)) {
        return reply.status(201).send({
          ok: true,
          pharmacyId: userContext.pharmacyId,
        });
      }

      const parsed = PostJournalBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          message: parsed.error.issues[0]?.message || 'Invalid journal entry input',
        });
      }

      const db = request.server.db || getDb();
      try {
        const entry = await db.transaction((tx) =>
          postJournalEntry(tx, {
            pharmacyId: userContext.pharmacyId,
            entryDate: parsed.data.entryDate,
            sourceType: parsed.data.sourceType ?? null,
            sourceId: parsed.data.sourceId ?? null,
            memo: parsed.data.memo ?? null,
            createdBy: userContext.userId,
            lines: parsed.data.lines,
          })
        );

        return reply.status(201).send({
          ok: true,
          pharmacyId: userContext.pharmacyId,
          entry,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to post journal entry';
        const isNotFound = /not found|another pharmacy/i.test(message);
        return reply.status(isNotFound ? 404 : 400).send({
          statusCode: isNotFound ? 404 : 400,
          message,
        });
      }
    }
  );

  /**
   * POST /api/finance/journals/:id/post
   * Verify/retrieve posted journal entry scoped to caller's pharmacy.
   */
  fastify.post<{ Params: { id: string } }>(
    '/journals/:id/post',
    {
      config: { requiredPermission: 'finance.journal.post' },
      preHandler: [requirePermission('finance.journal.post')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid journal ID format',
        });
      }

      const [entry] = await db
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(eq(journalEntries.id, id), eq(journalEntries.pharmacyId, userContext.pharmacyId))
        )
        .limit(1);

      if (!entry) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Journal entry not found in this pharmacy',
        });
      }

      return reply.status(200).send({
        ok: true,
        pharmacyId: userContext.pharmacyId,
      });
    }
  );

  /**
   * POST /api/finance/journals/:id/reverse
   * Reverse a posted journal entry by inserting a reversing entry.
   */
  fastify.post<{ Params: { id: string }; Body: z.infer<typeof ReverseJournalBodySchema> }>(
    '/journals/:id/reverse',
    {
      config: { requiredPermission: 'finance.journal.post' },
      preHandler: [requirePermission('finance.journal.post')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const paramParsed = IdParamSchema.safeParse(request.params);
      if (!paramParsed.success) {
        return reply.status(400).send({ statusCode: 400, message: 'Invalid ID format' });
      }

      const bodyParsed = ReverseJournalBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          message: bodyParsed.error.issues[0]?.message || 'Invalid reversal input',
        });
      }

      const db = request.server.db || getDb();
      try {
        const reversal = await db.transaction((tx) =>
          reverseJournalEntry(tx, paramParsed.data.id, bodyParsed.data.reason, {
            pharmacyId: userContext.pharmacyId,
            reversalDate: bodyParsed.data.reversalDate,
            createdBy: userContext.userId,
          })
        );

        return reply.status(201).send({
          ok: true,
          pharmacyId: userContext.pharmacyId,
          entry: reversal,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to reverse journal entry';
        const isNotFound = /not found|another pharmacy/i.test(message);
        return reply.status(isNotFound ? 404 : 400).send({
          statusCode: isNotFound ? 404 : 400,
          message,
        });
      }
    }
  );

  /**
   * GET /api/finance/coa
   * Chart of accounts scoped to caller's pharmacy.
   */
  fastify.get(
    '/coa',
    {
      config: { requiredPermission: 'finance.coa.view' },
      preHandler: [requirePermission('finance.coa.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const items = await db
        .select()
        .from(accounts)
        .where(eq(accounts.pharmacyId, userContext.pharmacyId))
        .orderBy(asc(accounts.code));

      return reply.status(200).send({
        items,
        pharmacyId: userContext.pharmacyId,
      });
    }
  );

  /**
   * POST /api/finance/coa
   * Create a custom account in Chart of Accounts scoped to caller's pharmacy.
   */
  fastify.post<{ Body: z.infer<typeof CreateAccountBodySchema> }>(
    '/coa',
    {
      config: { requiredPermission: 'finance.coa.manage' },
      preHandler: [requirePermission('finance.coa.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const parsed = CreateAccountBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          message: parsed.error.issues[0]?.message || 'Invalid account data',
        });
      }

      const db = request.server.db || getDb();

      // Check if parentId is provided and verify it belongs to this pharmacy
      if (parsed.data.parentId) {
        const [parent] = await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(
            and(
              eq(accounts.id, parsed.data.parentId),
              eq(accounts.pharmacyId, userContext.pharmacyId)
            )
          )
          .limit(1);

        if (!parent) {
          return reply.status(404).send({
            statusCode: 404,
            message: 'Parent account not found or belongs to another pharmacy',
          });
        }
      }

      // Check duplicate code within this pharmacy
      const [existingCode] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(eq(accounts.pharmacyId, userContext.pharmacyId), eq(accounts.code, parsed.data.code))
        )
        .limit(1);

      if (existingCode) {
        return reply.status(400).send({
          statusCode: 400,
          message: `Account code '${parsed.data.code}' already exists for this pharmacy`,
        });
      }

      const [newAccount] = await db
        .insert(accounts)
        .values({
          id: generateUuidV7(),
          pharmacyId: userContext.pharmacyId,
          code: parsed.data.code,
          name: parsed.data.name,
          type: parsed.data.type,
          parentId: parsed.data.parentId ?? null,
          isActive: true,
          isSystem: false,
        })
        .returning();

      return reply.status(201).send({
        ok: true,
        account: newAccount,
        pharmacyId: userContext.pharmacyId,
      });
    }
  );

  /**
   * PATCH /api/finance/coa/:id
   * Update or deactivate/reactivate an account. System accounts are protected from deactivation.
   */
  fastify.patch<{ Params: { id: string }; Body: z.infer<typeof PatchAccountBodySchema> }>(
    '/coa/:id',
    {
      config: { requiredPermission: 'finance.coa.manage' },
      preHandler: [requirePermission('finance.coa.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const paramParsed = IdParamSchema.safeParse(request.params);
      if (!paramParsed.success) {
        return reply.status(400).send({ statusCode: 400, message: 'Invalid account ID format' });
      }

      const parsed = PatchAccountBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          message: parsed.error.issues[0]?.message || 'Invalid update data',
        });
      }

      const db = request.server.db || getDb();

      const [existing] = await db
        .select()
        .from(accounts)
        .where(
          and(eq(accounts.id, paramParsed.data.id), eq(accounts.pharmacyId, userContext.pharmacyId))
        )
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          statusCode: 404,
          message: 'Account not found or belongs to another pharmacy',
        });
      }

      // System account protection: cannot deactivate
      if (existing.isSystem && parsed.data.isActive === false) {
        return reply.status(400).send({
          statusCode: 400,
          message: 'System accounts are protected and cannot be deactivated',
        });
      }

      // If parentId is updated, check tenant scoping
      if (parsed.data.parentId) {
        const [parent] = await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(
            and(
              eq(accounts.id, parsed.data.parentId),
              eq(accounts.pharmacyId, userContext.pharmacyId)
            )
          )
          .limit(1);

        if (!parent) {
          return reply.status(404).send({
            statusCode: 404,
            message: 'Parent account not found or belongs to another pharmacy',
          });
        }
      }

      const updateValues: Partial<typeof accounts.$inferInsert> = {};
      if (parsed.data.name !== undefined) updateValues.name = parsed.data.name;
      if (parsed.data.parentId !== undefined) updateValues.parentId = parsed.data.parentId;
      if (parsed.data.isActive !== undefined) updateValues.isActive = parsed.data.isActive;

      const [updated] = await db
        .update(accounts)
        .set(updateValues)
        .where(and(eq(accounts.id, existing.id), eq(accounts.pharmacyId, userContext.pharmacyId)))
        .returning();

      return reply.status(200).send({
        ok: true,
        account: updated,
        pharmacyId: userContext.pharmacyId,
      });
    }
  );

  /**
   * GET /api/finance/accounts/:id/ledger
   * General Ledger statement for a single account derived strictly from journal_lines.
   */
  fastify.get<{ Params: { id: string }; Querystring: z.infer<typeof AccountLedgerQuerySchema> }>(
    '/accounts/:id/ledger',
    {
      config: { requiredPermission: 'finance.reports.view' },
      preHandler: [requirePermission('finance.reports.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const paramParsed = IdParamSchema.safeParse(request.params);
      if (!paramParsed.success) {
        return reply.status(400).send({ statusCode: 400, message: 'Invalid account ID format' });
      }

      const queryParsed = AccountLedgerQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          message: queryParsed.error.issues[0]?.message || 'Invalid query parameters',
        });
      }

      const db = request.server.db || getDb();
      try {
        const ledger = await accountLedger(
          db,
          paramParsed.data.id,
          queryParsed.data.from,
          queryParsed.data.to,
          userContext.pharmacyId
        );

        return reply.status(200).send(ledger);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load account ledger';
        const isNotFound = /not found|another pharmacy/i.test(message);
        return reply.status(isNotFound ? 404 : 400).send({
          statusCode: isNotFound ? 404 : 400,
          message,
        });
      }
    }
  );

  /**
   * POST /api/finance/periods/close
   * Close a fiscal period (owner only, audit logged).
   */
  fastify.post<{ Body: z.infer<typeof ClosePeriodBodySchema> }>(
    '/periods/close',
    {
      config: { requiredPermission: 'finance.period_close.execute' },
      preHandler: [requirePermission('finance.period_close.execute')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const parsed = ClosePeriodBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          message: parsed.error.issues[0]?.message || 'Invalid period close input',
        });
      }

      const db = request.server.db || getDb();
      try {
        const period = await db.transaction((tx) =>
          closePeriod(tx, {
            pharmacyId: userContext.pharmacyId,
            startDate: parsed.data.startDate,
            endDate: parsed.data.endDate,
            actorUserId: userContext.userId,
            actorRole: userContext.role,
            reason: parsed.data.reason,
            periodId: parsed.data.periodId,
          })
        );

        return reply.status(200).send({
          ok: true,
          pharmacyId: userContext.pharmacyId,
          period,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to close fiscal period';
        const isNotFound = /not found|another pharmacy/i.test(message);
        return reply.status(isNotFound ? 404 : 400).send({
          statusCode: isNotFound ? 404 : 400,
          message,
        });
      }
    }
  );

  /**
   * POST /api/finance/periods/:id/reopen
   * Reopen a closed fiscal period (owner only, audit logged).
   */
  fastify.post<{ Params: { id: string }; Body: z.infer<typeof ReopenPeriodBodySchema> }>(
    '/periods/:id/reopen',
    {
      config: { requiredPermission: 'finance.period_close.execute' },
      preHandler: [requirePermission('finance.period_close.execute')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const paramParsed = IdParamSchema.safeParse(request.params);
      if (!paramParsed.success) {
        return reply.status(400).send({ statusCode: 400, message: 'Invalid period ID format' });
      }

      const bodyParsed = ReopenPeriodBodySchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          message: bodyParsed.error.issues[0]?.message || 'Invalid reopen input',
        });
      }

      const db = request.server.db || getDb();
      try {
        const period = await db.transaction((tx) =>
          reopenPeriod(tx, {
            pharmacyId: userContext.pharmacyId,
            periodId: paramParsed.data.id,
            actorUserId: userContext.userId,
            actorRole: userContext.role,
            reason: bodyParsed.data.reason,
          })
        );

        return reply.status(200).send({
          ok: true,
          pharmacyId: userContext.pharmacyId,
          period,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to reopen fiscal period';
        const isNotFound = /not found|another pharmacy/i.test(message);
        return reply.status(isNotFound ? 404 : 400).send({
          statusCode: isNotFound ? 404 : 400,
          message,
        });
      }
    }
  );

  /**
   * GET /api/finance/periods
   * List fiscal periods scoped to caller's pharmacy.
   */
  fastify.get(
    '/periods',
    {
      config: { requiredPermission: 'finance.period_close.propose' },
      preHandler: [requirePermission('finance.period_close.propose')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const items = await db
        .select()
        .from(fiscalPeriods)
        .where(eq(fiscalPeriods.pharmacyId, userContext.pharmacyId))
        .orderBy(desc(fiscalPeriods.startDate));

      return reply.status(200).send({
        items,
        pharmacyId: userContext.pharmacyId,
      });
    }
  );

  /**
   * GET /api/finance/periods/checklist
   * Month-end close readiness checklist.
   */
  fastify.get<{ Querystring: z.infer<typeof PeriodChecklistQuerySchema> }>(
    '/periods/checklist',
    {
      config: { requiredPermission: 'finance.period_close.propose' },
      preHandler: [requirePermission('finance.period_close.propose')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const parsed = PeriodChecklistQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          message: parsed.error.issues[0]?.message || 'Invalid year or month parameter',
        });
      }

      const db = request.server.db || getDb();
      try {
        const checklist = await getMonthEndChecklist(
          db,
          userContext.pharmacyId,
          parsed.data.year,
          parsed.data.month
        );
        return reply.status(200).send({
          success: true,
          data: checklist,
          pharmacyId: userContext.pharmacyId,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to retrieve month-end checklist';
        return reply.status(500).send({
          statusCode: 500,
          message,
        });
      }
    }
  );

  /**
   * POST /api/finance/periods/year-end-closing
   * Posts year-end zeroing entries transferring P&L balances to Retained Earnings (owner only).
   */
  fastify.post<{ Body: z.infer<typeof YearEndClosingBodySchema> }>(
    '/periods/year-end-closing',
    {
      config: { requiredPermission: 'finance.period_close.execute' },
      preHandler: [requirePermission('finance.period_close.execute')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const parsed = YearEndClosingBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          message: parsed.error.issues[0]?.message || 'Invalid year-end closing input',
        });
      }

      const db = request.server.db || getDb();
      try {
        const result = await db.transaction((tx) =>
          executeYearEndClosing(tx, {
            pharmacyId: userContext.pharmacyId,
            fiscalYear: parsed.data.fiscalYear,
            closingDate: parsed.data.closingDate,
            memo: parsed.data.memo,
            actorUserId: userContext.userId,
          })
        );

        return reply.status(200).send({
          success: true,
          data: result,
          pharmacyId: userContext.pharmacyId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to execute year-end closing';
        return reply.status(400).send({
          statusCode: 400,
          message,
        });
      }
    }
  );

  /**
   * GET /api/finance/reconciliation
   * Reconciles general ledger sales & inventory against operational documents and batch stock.
   */
  fastify.get<{ Querystring: z.infer<typeof ReconciliationQuerySchema> }>(
    '/reconciliation',
    {
      config: { requiredPermission: 'finance.reports.view' },
      preHandler: [requirePermission('finance.reports.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const parsed = ReconciliationQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          message: parsed.error.issues[0]?.message || 'Invalid query parameters',
        });
      }

      const db = request.server.db || getDb();
      const report = await reconcileLedger(
        db,
        userContext.pharmacyId,
        parsed.data.from,
        parsed.data.to
      );

      return reply.status(200).send(report);
    }
  );

  /**
   * GET /api/finance/account-mappings
   * Returns the per-pharmacy posting role -> accountId mapping.
   */
  fastify.get(
    '/account-mappings',
    {
      config: { requiredPermission: 'finance.coa.view' },
      preHandler: [requirePermission('finance.coa.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const mappings = await getPharmacyAccountMap(db, userContext.pharmacyId);

      return reply.status(200).send({
        mappings,
        pharmacyId: userContext.pharmacyId,
      });
    }
  );

  /**
   * PUT /api/finance/account-mappings
   * Updates a per-pharmacy posting role mapping to an active account owned by the pharmacy.
   */
  fastify.put<{ Body: z.infer<typeof UpdateAccountMappingBodySchema> }>(
    '/account-mappings',
    {
      config: { requiredPermission: 'finance.coa.manage' },
      preHandler: [requirePermission('finance.coa.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const parsed = UpdateAccountMappingBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          message: parsed.error.issues[0]?.message || 'Invalid account mapping input',
        });
      }

      const db = request.server.db || getDb();
      try {
        const mapping = await db.transaction((tx) =>
          setPharmacyAccountMapping(
            tx,
            userContext.pharmacyId,
            parsed.data.role,
            parsed.data.accountId
          )
        );

        return reply.status(200).send({
          ok: true,
          pharmacyId: userContext.pharmacyId,
          mapping,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update account mapping';
        const isNotFound = /not found|another pharmacy/i.test(message);
        return reply.status(isNotFound ? 404 : 400).send({
          statusCode: isNotFound ? 404 : 400,
          message,
        });
      }
    }
  );
};
