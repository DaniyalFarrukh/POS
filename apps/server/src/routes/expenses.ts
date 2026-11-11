import type { FastifyPluginAsync } from 'fastify';
import { eq, and, sql, desc, asc, ilike, or } from 'drizzle-orm';
import {
  z,
  generateUuidV7,
  toKarachiBusinessDate,
  getKarachiBusinessDate,
  roundHalfUp,
} from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  pharmacies,
  branches,
  accounts,
  expenseCategories,
  erpExpenses,
  recurringExpenses,
  journalLines,
} from '../db/schema';
import { postExpenseCompleted } from '../ledger/posting-engine';
import { reverseJournalEntry } from '../ledger/service';

const CreateExpenseCategorySchema = z.object({
  name: z.string().min(1),
  accountId: z.string().uuid(),
  description: z.string().nullable().optional(),
});

const CreateExpenseSchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid(),
  amountPaisa: z.number().int().min(1),
  expenseDate: z.string().min(1),
  paymentType: z.enum(['paid', 'credit']),
  paymentMethod: z.enum(['cash', 'bank', 'wallet']).nullable().optional(),
  vendorName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const ReverseExpenseSchema = z.object({
  reversalReason: z.string().min(1),
});

const CreateRecurringExpenseSchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  categoryId: z.string().uuid(),
  amountPaisa: z.number().int().min(1),
  frequency: z.enum(['monthly', 'weekly', 'quarterly', 'yearly']).default('monthly'),
  dayOfMonth: z.number().int().min(1).max(31).default(1),
  paymentType: z.enum(['paid', 'credit']).default('paid'),
  paymentMethod: z.enum(['cash', 'bank', 'wallet']).nullable().optional(),
  vendorName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const GenerateRecurringSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM period format'),
});

export const expenseRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/finance/expense-categories
   * List expense categories. Automatically seeds standard categories if none exist.
   */
  fastify.get(
    '/expense-categories',
    {
      config: { requiredPermission: 'finance.expense.view' },
      preHandler: [requirePermission('finance.expense.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      let categories = await db
        .select()
        .from(expenseCategories)
        .where(
          and(
            eq(expenseCategories.pharmacyId, userContext.pharmacyId),
            eq(expenseCategories.isActive, true)
          )
        )
        .orderBy(asc(expenseCategories.name));

      // Auto-seed default categories if empty
      if (categories.length === 0) {
        const expenseAccs = await db
          .select()
          .from(accounts)
          .where(
            and(eq(accounts.pharmacyId, userContext.pharmacyId), eq(accounts.type, 'expense'))
          );

        const accByCode = new Map(expenseAccs.map((a) => [a.code, a.id]));
        const nowIso = new Date().toISOString();

        const defaultSeedDefs = [
          { name: 'Rent', code: '6010', desc: 'Building and space lease payments' },
          { name: 'Utilities', code: '6020', desc: 'Electricity, water, gas, internet' },
          {
            name: 'Marketing & Advertising',
            code: '6030',
            desc: 'Promotions, digital ads, banners',
          },
          { name: 'Office Supplies', code: '6040', desc: 'Stationery, packaging, small items' },
          {
            name: 'Repairs & Maintenance',
            code: '6050',
            desc: 'Equipment, AC, and fixture upkeep',
          },
          { name: 'Miscellaneous Expenses', code: '6900', desc: 'Sundry operating costs' },
        ];

        for (const def of defaultSeedDefs) {
          const accId = accByCode.get(def.code);
          if (accId) {
            await db
              .insert(expenseCategories)
              .values({
                id: generateUuidV7(),
                pharmacyId: userContext.pharmacyId,
                name: def.name,
                accountId: accId,
                description: def.desc,
                isActive: true,
                createdAt: nowIso,
                updatedAt: nowIso,
              })
              .onConflictDoNothing();
          }
        }

        categories = await db
          .select()
          .from(expenseCategories)
          .where(
            and(
              eq(expenseCategories.pharmacyId, userContext.pharmacyId),
              eq(expenseCategories.isActive, true)
            )
          )
          .orderBy(asc(expenseCategories.name));
      }

      return reply.send({
        success: true,
        data: categories,
      });
    }
  );

  /**
   * POST /api/finance/expense-categories
   * Create custom expense category mapped to a COA expense account.
   */
  fastify.post(
    '/expense-categories',
    {
      config: { requiredPermission: 'finance.expense.create' },
      preHandler: [requirePermission('finance.expense.create')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = CreateExpenseCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          message: parsed.error.issues[0]?.message || 'Invalid expense category data',
        });
      }

      // Verify Account
      const [acc] = await db
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.id, parsed.data.accountId),
            eq(accounts.pharmacyId, userContext.pharmacyId),
            eq(accounts.type, 'expense')
          )
        )
        .limit(1);

      if (!acc) {
        return reply.status(404).send({
          success: false,
          message: 'Account not found or is not an active expense account in this pharmacy',
        });
      }

      const nowIso = new Date().toISOString();
      const [created] = await db
        .insert(expenseCategories)
        .values({
          id: generateUuidV7(),
          pharmacyId: userContext.pharmacyId,
          name: parsed.data.name.trim(),
          accountId: parsed.data.accountId,
          description: parsed.data.description?.trim() || null,
          isActive: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .returning();

      return reply.status(201).send({
        success: true,
        data: created,
      });
    }
  );

  /**
   * GET /api/finance/expenses
   * Paginated expenses list with summary KPIs and filtering.
   */
  fastify.get(
    '/expenses',
    {
      config: { requiredPermission: 'finance.expense.view' },
      preHandler: [requirePermission('finance.expense.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const q = request.query as Record<string, string | undefined>;

      const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize || '20', 10) || 20));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(erpExpenses.pharmacyId, userContext.pharmacyId)];

      if (q.branchId) {
        conditions.push(eq(erpExpenses.branchId, q.branchId));
      }
      if (q.categoryId) {
        conditions.push(eq(erpExpenses.categoryId, q.categoryId));
      }
      if (q.paymentType && (q.paymentType === 'paid' || q.paymentType === 'credit')) {
        conditions.push(eq(erpExpenses.paymentType, q.paymentType));
      }
      if (q.status && ['pending_approval', 'approved', 'posted', 'reversed'].includes(q.status)) {
        conditions.push(
          eq(
            erpExpenses.status,
            q.status as 'pending_approval' | 'approved' | 'posted' | 'reversed'
          )
        );
      }
      if (q.startDate) {
        conditions.push(sql`${erpExpenses.expenseDate} >= ${q.startDate}`);
      }
      if (q.endDate) {
        conditions.push(sql`${erpExpenses.expenseDate} <= ${q.endDate}`);
      }
      if (q.search) {
        const searchPattern = `%${q.search.trim()}%`;
        conditions.push(
          or(
            ilike(erpExpenses.expenseNumber, searchPattern),
            ilike(erpExpenses.vendorName, searchPattern),
            ilike(erpExpenses.notes, searchPattern)
          )!
        );
      }

      const whereClause = and(...conditions);

      // Paginated items joined with category name and branch name
      const items = await db
        .select({
          id: erpExpenses.id,
          pharmacyId: erpExpenses.pharmacyId,
          branchId: erpExpenses.branchId,
          branchName: branches.name,
          expenseNumber: erpExpenses.expenseNumber,
          expenseDate: erpExpenses.expenseDate,
          categoryId: erpExpenses.categoryId,
          categoryName: expenseCategories.name,
          amountPaisa: erpExpenses.amountPaisa,
          paymentType: erpExpenses.paymentType,
          paymentMethod: erpExpenses.paymentMethod,
          vendorName: erpExpenses.vendorName,
          notes: erpExpenses.notes,
          status: erpExpenses.status,
          approvalThresholdPaisa: erpExpenses.approvalThresholdPaisa,
          approvedBy: erpExpenses.approvedBy,
          approvedAt: erpExpenses.approvedAt,
          journalEntryId: erpExpenses.journalEntryId,
          reversalEntryId: erpExpenses.reversalEntryId,
          reversalReason: erpExpenses.reversalReason,
          reversedAt: erpExpenses.reversedAt,
          createdAt: erpExpenses.createdAt,
          updatedAt: erpExpenses.updatedAt,
        })
        .from(erpExpenses)
        .innerJoin(expenseCategories, eq(erpExpenses.categoryId, expenseCategories.id))
        .innerJoin(branches, eq(erpExpenses.branchId, branches.id))
        .where(whereClause)
        .orderBy(desc(erpExpenses.expenseDate), desc(erpExpenses.createdAt))
        .limit(pageSize)
        .offset(offset);

      // Total items count
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(erpExpenses)
        .where(whereClause);
      const total = countResult?.count ?? 0;

      // KPIs calculation across pharmacy
      const allExpenses = await db
        .select({
          status: erpExpenses.status,
          amountPaisa: erpExpenses.amountPaisa,
        })
        .from(erpExpenses)
        .where(eq(erpExpenses.pharmacyId, userContext.pharmacyId));

      let totalExpensesPaisa = 0;
      let expenseCount = 0;
      let pendingApprovalCount = 0;

      for (const e of allExpenses) {
        if (e.status === 'posted') {
          totalExpensesPaisa += e.amountPaisa;
          expenseCount += 1;
        } else if (e.status === 'pending_approval') {
          pendingApprovalCount += 1;
        }
      }

      const averageExpensePaisa =
        expenseCount > 0 ? roundHalfUp(totalExpensesPaisa, expenseCount) : 0;

      return reply.send({
        success: true,
        data: {
          items,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
          kpis: {
            totalExpensesPaisa,
            expenseCount,
            averageExpensePaisa,
            pendingApprovalCount,
          },
        },
      });
    }
  );

  /**
   * GET /api/finance/expenses/:id
   * Expense detail with allocations and journal lines.
   */
  fastify.get(
    '/expenses/:id',
    {
      config: { requiredPermission: 'finance.expense.view' },
      preHandler: [requirePermission('finance.expense.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params as { id: string };

      const [expense] = await db
        .select({
          id: erpExpenses.id,
          pharmacyId: erpExpenses.pharmacyId,
          branchId: erpExpenses.branchId,
          branchName: branches.name,
          expenseNumber: erpExpenses.expenseNumber,
          expenseDate: erpExpenses.expenseDate,
          categoryId: erpExpenses.categoryId,
          categoryName: expenseCategories.name,
          amountPaisa: erpExpenses.amountPaisa,
          paymentType: erpExpenses.paymentType,
          paymentMethod: erpExpenses.paymentMethod,
          vendorName: erpExpenses.vendorName,
          notes: erpExpenses.notes,
          status: erpExpenses.status,
          approvalThresholdPaisa: erpExpenses.approvalThresholdPaisa,
          approvedBy: erpExpenses.approvedBy,
          approvedAt: erpExpenses.approvedAt,
          journalEntryId: erpExpenses.journalEntryId,
          reversalEntryId: erpExpenses.reversalEntryId,
          reversalReason: erpExpenses.reversalReason,
          reversedAt: erpExpenses.reversedAt,
          createdAt: erpExpenses.createdAt,
          updatedAt: erpExpenses.updatedAt,
        })
        .from(erpExpenses)
        .innerJoin(expenseCategories, eq(erpExpenses.categoryId, expenseCategories.id))
        .innerJoin(branches, eq(erpExpenses.branchId, branches.id))
        .where(and(eq(erpExpenses.id, id), eq(erpExpenses.pharmacyId, userContext.pharmacyId)))
        .limit(1);

      if (!expense) {
        return reply.status(404).send({
          success: false,
          message: 'Expense not found or belongs to another pharmacy',
        });
      }

      let journalLinesList: unknown[] = [];
      if (expense.journalEntryId) {
        journalLinesList = await db
          .select()
          .from(journalLines)
          .where(
            and(
              eq(journalLines.entryId, expense.journalEntryId),
              eq(journalLines.pharmacyId, userContext.pharmacyId)
            )
          )
          .orderBy(asc(journalLines.id));
      }

      return reply.send({
        success: true,
        data: {
          ...expense,
          journalLines: journalLinesList,
        },
      });
    }
  );

  /**
   * POST /api/finance/expenses
   * Record a business expense with immediate GL posting or approval workflow gate.
   */
  fastify.post(
    '/expenses',
    {
      config: { requiredPermission: 'finance.expense.create' },
      preHandler: [requirePermission('finance.expense.create')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = CreateExpenseSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          message: parsed.error.issues[0]?.message || 'Invalid expense data',
        });
      }

      const body = parsed.data;

      // Verify Category
      const [category] = await db
        .select()
        .from(expenseCategories)
        .where(
          and(
            eq(expenseCategories.id, body.categoryId),
            eq(expenseCategories.pharmacyId, userContext.pharmacyId)
          )
        )
        .limit(1);

      if (!category) {
        return reply.status(404).send({
          success: false,
          message: 'Expense category not found or belongs to another pharmacy',
        });
      }

      // Verify or Resolve Branch
      let targetBranchId = body.branchId;
      if (targetBranchId) {
        const [branch] = await db
          .select({ id: branches.id })
          .from(branches)
          .where(
            and(eq(branches.id, targetBranchId), eq(branches.pharmacyId, userContext.pharmacyId))
          )
          .limit(1);
        if (!branch) {
          return reply.status(404).send({
            success: false,
            message: 'Branch not found or belongs to another pharmacy',
          });
        }
      } else {
        const [firstBranch] = await db
          .select({ id: branches.id })
          .from(branches)
          .where(eq(branches.pharmacyId, userContext.pharmacyId))
          .limit(1);
        if (!firstBranch) {
          return reply.status(400).send({
            success: false,
            message: 'No active branch found for this pharmacy',
          });
        }
        targetBranchId = firstBranch.id;
      }

      // Pharmacy Threshold Check
      const [pharmacy] = await db
        .select({
          threshold: pharmacies.expenseApprovalThresholdPaisa,
        })
        .from(pharmacies)
        .where(eq(pharmacies.id, userContext.pharmacyId))
        .limit(1);

      const thresholdPaisa = pharmacy?.threshold ?? 2500000;
      const requiresApproval = body.amountPaisa > thresholdPaisa;

      const expenseId = generateUuidV7();
      const randNum = Math.floor(100000 + Math.random() * 900000);
      const expenseNumber = `EXP-${randNum}`;
      const nowIso = new Date().toISOString();
      const dateOnly = toKarachiBusinessDate(body.expenseDate);

      // Execute Posting or Queue Pending Approval
      const result = await db.transaction(async (tx) => {
        let journalEntryId: string | null = null;
        const initialStatus = requiresApproval ? 'pending_approval' : 'posted';

        if (!requiresApproval) {
          const journal = await postExpenseCompleted(tx, {
            expenseId,
            expenseNumber,
            pharmacyId: userContext.pharmacyId,
            branchId: targetBranchId,
            expenseDate: dateOnly,
            expenseAccountId: category.accountId,
            amountPaisa: body.amountPaisa,
            paymentType: body.paymentType,
            paymentMethod: body.paymentMethod,
            vendorName: body.vendorName,
            notes: body.notes,
            createdBy: userContext.userId,
          });
          journalEntryId = journal.id;
        }

        const [created] = await tx
          .insert(erpExpenses)
          .values({
            id: expenseId,
            pharmacyId: userContext.pharmacyId,
            branchId: targetBranchId,
            expenseNumber,
            expenseDate: dateOnly,
            categoryId: body.categoryId,
            amountPaisa: body.amountPaisa,
            paymentType: body.paymentType,
            paymentMethod: body.paymentMethod || 'cash',
            vendorName: body.vendorName || null,
            notes: body.notes || null,
            status: initialStatus,
            approvalThresholdPaisa: thresholdPaisa,
            approvedBy: requiresApproval ? null : userContext.userId,
            approvedAt: requiresApproval ? null : nowIso,
            journalEntryId,
            createdBy: userContext.userId,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .returning();

        return {
          ...created,
          categoryName: category.name,
        };
      });

      return reply.status(201).send({
        success: true,
        data: result,
      });
    }
  );

  /**
   * POST /api/finance/expenses/:id/approve
   * Approve an expense above the approval threshold and trigger GL posting.
   */
  fastify.post(
    '/expenses/:id/approve',
    {
      config: { requiredPermission: 'finance.expense.approve' },
      preHandler: [requirePermission('finance.expense.approve')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params as { id: string };

      const [expense] = await db
        .select()
        .from(erpExpenses)
        .where(and(eq(erpExpenses.id, id), eq(erpExpenses.pharmacyId, userContext.pharmacyId)))
        .limit(1);

      if (!expense) {
        return reply.status(404).send({
          success: false,
          message: 'Expense not found or belongs to another pharmacy',
        });
      }

      if (expense.status !== 'pending_approval') {
        return reply.status(400).send({
          success: false,
          message: `Cannot approve expense with status '${expense.status}' (expected pending_approval)`,
        });
      }

      const [category] = await db
        .select()
        .from(expenseCategories)
        .where(eq(expenseCategories.id, expense.categoryId))
        .limit(1);

      if (!category) {
        return reply.status(404).send({
          success: false,
          message: 'Expense category missing',
        });
      }

      const nowIso = new Date().toISOString();

      const updated = await db.transaction(async (tx) => {
        // Post to GL
        const journal = await postExpenseCompleted(tx, {
          expenseId: expense.id,
          expenseNumber: expense.expenseNumber,
          pharmacyId: userContext.pharmacyId,
          branchId: expense.branchId,
          expenseDate: expense.expenseDate,
          expenseAccountId: category.accountId,
          amountPaisa: expense.amountPaisa,
          paymentType: expense.paymentType,
          paymentMethod: expense.paymentMethod,
          vendorName: expense.vendorName,
          notes: expense.notes,
          createdBy: userContext.userId,
        });

        const [u] = await tx
          .update(erpExpenses)
          .set({
            status: 'posted',
            journalEntryId: journal.id,
            approvedBy: userContext.userId,
            approvedAt: nowIso,
            updatedAt: nowIso,
          })
          .where(and(eq(erpExpenses.id, id), eq(erpExpenses.pharmacyId, userContext.pharmacyId)))
          .returning();

        return u;
      });

      return reply.send({
        success: true,
        data: updated,
      });
    }
  );

  /**
   * POST /api/finance/expenses/:id/reverse
   * Reverse an expense with immutable reversing journal entry.
   */
  fastify.post(
    '/expenses/:id/reverse',
    {
      config: { requiredPermission: 'finance.expense.create' },
      preHandler: [requirePermission('finance.expense.create')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params as { id: string };

      const parsed = ReverseExpenseSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          message: parsed.error.issues[0]?.message || 'Reversal reason is required',
        });
      }

      const [expense] = await db
        .select()
        .from(erpExpenses)
        .where(and(eq(erpExpenses.id, id), eq(erpExpenses.pharmacyId, userContext.pharmacyId)))
        .limit(1);

      if (!expense) {
        return reply.status(404).send({
          success: false,
          message: 'Expense not found or belongs to another pharmacy',
        });
      }

      if (expense.status === 'reversed') {
        return reply.status(400).send({
          success: false,
          message: 'Expense is already reversed',
        });
      }

      const nowIso = new Date().toISOString();

      const updated = await db.transaction(async (tx) => {
        let revEntryId: string | null = null;
        if (expense.journalEntryId) {
          const rev = await reverseJournalEntry(
            tx,
            expense.journalEntryId,
            parsed.data.reversalReason,
            { pharmacyId: userContext.pharmacyId }
          );
          revEntryId = rev.id;
        }

        const [u] = await tx
          .update(erpExpenses)
          .set({
            status: 'reversed',
            reversalEntryId: revEntryId,
            reversalReason: parsed.data.reversalReason,
            reversedAt: nowIso,
            updatedAt: nowIso,
          })
          .where(and(eq(erpExpenses.id, id), eq(erpExpenses.pharmacyId, userContext.pharmacyId)))
          .returning();

        return u;
      });

      return reply.send({
        success: true,
        data: updated,
      });
    }
  );

  /**
   * GET /api/finance/expenses/recurring
   * List recurring expense templates.
   */
  fastify.get(
    '/expenses/recurring',
    {
      config: { requiredPermission: 'finance.expense.view' },
      preHandler: [requirePermission('finance.expense.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const templates = await db
        .select({
          id: recurringExpenses.id,
          pharmacyId: recurringExpenses.pharmacyId,
          branchId: recurringExpenses.branchId,
          branchName: branches.name,
          title: recurringExpenses.title,
          categoryId: recurringExpenses.categoryId,
          categoryName: expenseCategories.name,
          amountPaisa: recurringExpenses.amountPaisa,
          frequency: recurringExpenses.frequency,
          dayOfMonth: recurringExpenses.dayOfMonth,
          paymentType: recurringExpenses.paymentType,
          paymentMethod: recurringExpenses.paymentMethod,
          vendorName: recurringExpenses.vendorName,
          notes: recurringExpenses.notes,
          isActive: recurringExpenses.isActive,
          lastGeneratedPeriod: recurringExpenses.lastGeneratedPeriod,
          createdAt: recurringExpenses.createdAt,
          updatedAt: recurringExpenses.updatedAt,
        })
        .from(recurringExpenses)
        .innerJoin(expenseCategories, eq(recurringExpenses.categoryId, expenseCategories.id))
        .innerJoin(branches, eq(recurringExpenses.branchId, branches.id))
        .where(
          and(
            eq(recurringExpenses.pharmacyId, userContext.pharmacyId),
            eq(recurringExpenses.isActive, true)
          )
        )
        .orderBy(asc(recurringExpenses.title));

      return reply.send({
        success: true,
        data: templates,
      });
    }
  );

  /**
   * POST /api/finance/expenses/recurring
   * Create recurring expense template.
   */
  fastify.post(
    '/expenses/recurring',
    {
      config: { requiredPermission: 'finance.expense.create' },
      preHandler: [requirePermission('finance.expense.create')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = CreateRecurringExpenseSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          message: parsed.error.issues[0]?.message || 'Invalid recurring expense template',
        });
      }

      const body = parsed.data;

      // Verify category
      const [category] = await db
        .select()
        .from(expenseCategories)
        .where(
          and(
            eq(expenseCategories.id, body.categoryId),
            eq(expenseCategories.pharmacyId, userContext.pharmacyId)
          )
        )
        .limit(1);

      if (!category) {
        return reply.status(404).send({
          success: false,
          message: 'Expense category not found',
        });
      }

      // Branch resolution
      let targetBranchId = body.branchId;
      if (targetBranchId) {
        const [verifiedBranch] = await db
          .select({ id: branches.id })
          .from(branches)
          .where(
            and(eq(branches.id, targetBranchId), eq(branches.pharmacyId, userContext.pharmacyId))
          )
          .limit(1);
        if (!verifiedBranch) {
          return reply.status(404).send({
            success: false,
            message: 'Branch not found for this pharmacy',
          });
        }
      } else {
        const [firstBranch] = await db
          .select({ id: branches.id })
          .from(branches)
          .where(eq(branches.pharmacyId, userContext.pharmacyId))
          .limit(1);
        if (!firstBranch) {
          return reply.status(400).send({
            success: false,
            message: 'No branch found for this pharmacy',
          });
        }
        targetBranchId = firstBranch.id;
      }

      const nowIso = new Date().toISOString();
      const [created] = await db
        .insert(recurringExpenses)
        .values({
          id: generateUuidV7(),
          pharmacyId: userContext.pharmacyId,
          branchId: targetBranchId,
          title: body.title.trim(),
          categoryId: body.categoryId,
          amountPaisa: body.amountPaisa,
          frequency: body.frequency,
          dayOfMonth: body.dayOfMonth,
          paymentType: body.paymentType,
          paymentMethod: body.paymentMethod || 'cash',
          vendorName: body.vendorName?.trim() || null,
          notes: body.notes?.trim() || null,
          isActive: true,
          createdBy: userContext.userId,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .returning();

      return reply.status(201).send({
        success: true,
        data: created,
      });
    }
  );

  /**
   * GET /api/finance/expenses/recurring/preview
   * Preview recurring expenses to be generated for a specific period (e.g. 2026-11).
   */
  fastify.get(
    '/expenses/recurring/preview',
    {
      config: { requiredPermission: 'finance.expense.view' },
      preHandler: [requirePermission('finance.expense.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const query = request.query as { period?: string };

      const period = query.period || getKarachiBusinessDate().slice(0, 7);

      const templates = await db
        .select({
          id: recurringExpenses.id,
          title: recurringExpenses.title,
          amountPaisa: recurringExpenses.amountPaisa,
          categoryName: expenseCategories.name,
          paymentType: recurringExpenses.paymentType,
          paymentMethod: recurringExpenses.paymentMethod,
          vendorName: recurringExpenses.vendorName,
          lastGeneratedPeriod: recurringExpenses.lastGeneratedPeriod,
        })
        .from(recurringExpenses)
        .innerJoin(expenseCategories, eq(recurringExpenses.categoryId, expenseCategories.id))
        .where(
          and(
            eq(recurringExpenses.pharmacyId, userContext.pharmacyId),
            eq(recurringExpenses.isActive, true)
          )
        );

      // Check which ones have already been generated for this period
      const existing = await db
        .select({
          recurringExpenseId: erpExpenses.recurringExpenseId,
        })
        .from(erpExpenses)
        .where(
          and(
            eq(erpExpenses.pharmacyId, userContext.pharmacyId),
            eq(erpExpenses.recurringPeriod, period),
            sql`${erpExpenses.status} != 'reversed'`
          )
        );

      const generatedSet = new Set(existing.map((e) => e.recurringExpenseId));

      const pending = templates.filter((t) => !generatedSet.has(t.id));

      return reply.send({
        success: true,
        data: {
          period,
          pendingCount: pending.length,
          alreadyGeneratedCount: generatedSet.size,
          templates: pending,
        },
      });
    }
  );

  /**
   * POST /api/finance/expenses/recurring/generate
   * Idempotently generates recurring expenses for the period.
   */
  fastify.post(
    '/expenses/recurring/generate',
    {
      config: { requiredPermission: 'finance.expense.create' },
      preHandler: [requirePermission('finance.expense.create')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = GenerateRecurringSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          message: parsed.error.issues[0]?.message || 'Invalid period format (expected YYYY-MM)',
        });
      }

      const { period } = parsed.data;

      const templates = await db
        .select()
        .from(recurringExpenses)
        .where(
          and(
            eq(recurringExpenses.pharmacyId, userContext.pharmacyId),
            eq(recurringExpenses.isActive, true)
          )
        );

      // Find already generated templates for this period
      const existing = await db
        .select({
          recurringExpenseId: erpExpenses.recurringExpenseId,
        })
        .from(erpExpenses)
        .where(
          and(
            eq(erpExpenses.pharmacyId, userContext.pharmacyId),
            eq(erpExpenses.recurringPeriod, period),
            sql`${erpExpenses.status} != 'reversed'`
          )
        );

      const generatedSet = new Set(existing.map((e) => e.recurringExpenseId));
      const toGenerate = templates.filter((t) => !generatedSet.has(t.id));

      if (toGenerate.length === 0) {
        return reply.send({
          success: true,
          data: {
            period,
            generatedCount: 0,
            message: 'All recurring expenses have already been generated for this period',
          },
        });
      }

      // Threshold lookup
      const [pharmacy] = await db
        .select({ threshold: pharmacies.expenseApprovalThresholdPaisa })
        .from(pharmacies)
        .where(eq(pharmacies.id, userContext.pharmacyId))
        .limit(1);

      const thresholdPaisa = pharmacy?.threshold ?? 2500000;
      const nowIso = new Date().toISOString();

      let count = 0;
      await db.transaction(async (tx) => {
        for (const t of toGenerate) {
          const expenseId = generateUuidV7();
          const randNum = Math.floor(100000 + Math.random() * 900000);
          const expenseNumber = `EXP-${randNum}`;
          const expenseDate = `${period}-${String(t.dayOfMonth).padStart(2, '0')}`;

          const requiresApproval = t.amountPaisa > thresholdPaisa;
          const initialStatus = requiresApproval ? 'pending_approval' : 'posted';

          let journalEntryId: string | null = null;
          if (!requiresApproval) {
            const [cat] = await tx
              .select({ accountId: expenseCategories.accountId })
              .from(expenseCategories)
              .where(eq(expenseCategories.id, t.categoryId))
              .limit(1);

            if (cat) {
              const journal = await postExpenseCompleted(tx, {
                expenseId,
                expenseNumber,
                pharmacyId: userContext.pharmacyId,
                branchId: t.branchId,
                expenseDate,
                expenseAccountId: cat.accountId,
                amountPaisa: t.amountPaisa,
                paymentType: t.paymentType,
                paymentMethod: t.paymentMethod,
                vendorName: t.vendorName,
                notes: `Generated recurring: ${t.title}`,
                createdBy: userContext.userId,
              });
              journalEntryId = journal.id;
            }
          }

          await tx.insert(erpExpenses).values({
            id: expenseId,
            pharmacyId: userContext.pharmacyId,
            branchId: t.branchId,
            expenseNumber,
            expenseDate,
            categoryId: t.categoryId,
            amountPaisa: t.amountPaisa,
            paymentType: t.paymentType,
            paymentMethod: t.paymentMethod || 'cash',
            vendorName: t.vendorName,
            notes: `Auto-generated recurring: ${t.title}`,
            status: initialStatus,
            approvalThresholdPaisa: thresholdPaisa,
            approvedBy: requiresApproval ? null : userContext.userId,
            approvedAt: requiresApproval ? null : nowIso,
            recurringExpenseId: t.id,
            recurringPeriod: period,
            journalEntryId,
            createdBy: userContext.userId,
            createdAt: nowIso,
            updatedAt: nowIso,
          });

          await tx
            .update(recurringExpenses)
            .set({
              lastGeneratedPeriod: period,
              updatedAt: nowIso,
            })
            .where(eq(recurringExpenses.id, t.id));

          count++;
        }
      });

      return reply.send({
        success: true,
        data: {
          period,
          generatedCount: count,
        },
      });
    }
  );
};
