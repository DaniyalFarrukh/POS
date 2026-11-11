import type { FastifyPluginAsync } from 'fastify';
import { eq, and, sql, desc, asc, lte, gte, lt } from 'drizzle-orm';
import { z, generateUuidV7, getKarachiBusinessDate, toKarachiBusinessDate } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  customers,
  invoices,
  invoiceLines,
  products,
  accounts,
  journalEntries,
  journalLines,
  paymentReminders,
  pharmacyAccountMappings,
  paymentAllocations,
  erpPayments,
} from '../db/schema';

const ReminderSchema = z.object({
  partyType: z.literal('customer'),
  partyId: z.string().uuid(),
  channel: z.enum(['sms', 'whatsapp', 'phone', 'email', 'in_person']).default('sms'),
  recipient: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  amountPaisa: z.number().int().min(0).default(0),
  daysOverdue: z.number().int().min(0).default(0),
  documentId: z.string().uuid().nullable().optional(),
});

function calculateDaysDifference(asOfDateStr: string, entryDateStr: string): number {
  const asOf = new Date(asOfDateStr);
  const entry = new Date(entryDateStr);
  const diffTime = asOf.getTime() - entry.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

function classifyAgingBucket(
  days: number
): 'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'days90Plus' {
  if (days <= 0) return 'current';
  if (days <= 30) return 'days1to30';
  if (days <= 60) return 'days31to60';
  if (days <= 90) return 'days61to90';
  return 'days90Plus';
}

async function getArAccountId(db: ReturnType<typeof getDb>, pharmacyId: string): Promise<string> {
  const [mapped] = await db
    .select({ accountId: pharmacyAccountMappings.accountId })
    .from(pharmacyAccountMappings)
    .where(
      and(
        eq(pharmacyAccountMappings.pharmacyId, pharmacyId),
        eq(pharmacyAccountMappings.role, 'ar')
      )
    )
    .limit(1);

  if (mapped?.accountId) {
    return mapped.accountId;
  }

  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.pharmacyId, pharmacyId), eq(accounts.code, '1100')))
    .limit(1);

  if (!acct) {
    throw new Error(`Accounts Receivable account (code 1100) not found for pharmacy ${pharmacyId}`);
  }
  return acct.id;
}

export const arRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/finance/ar/summary
   * KPI cards, aging breakdown, and control account reconciliation check
   */
  fastify.get(
    '/summary',
    {
      config: { requiredPermission: 'finance.ar.view' },
      preHandler: [requirePermission('finance.ar.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const query = request.query as { asOfDate?: string };

      const asOfDate = query.asOfDate || getKarachiBusinessDate();
      const currentMonthPrefix = asOfDate.slice(0, 7);

      const arAccountId = await getArAccountId(db, userContext.pharmacyId);

      // 1. Control Account Balance (Debit - Credit)
      const [ctrlRow] = await db
        .select({
          totalDebit: sql<string>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
        })
        .from(journalLines)
        .where(
          and(
            eq(journalLines.pharmacyId, userContext.pharmacyId),
            eq(journalLines.accountId, arAccountId)
          )
        );

      const controlAccountBalancePaisa =
        Number(ctrlRow?.totalDebit || 0) - Number(ctrlRow?.totalCredit || 0);

      // 2. Party lines for customer balances
      const partyLines = await db
        .select({
          partyId: journalLines.partyId,
          entryDate: journalEntries.entryDate,
          debitPaisa: journalLines.debitPaisa,
          creditPaisa: journalLines.creditPaisa,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, userContext.pharmacyId),
            eq(journalLines.accountId, arAccountId),
            eq(journalLines.partyType, 'customer')
          )
        );

      // Customer net balances
      const customerNetMap = new Map<string, number>();
      for (const line of partyLines) {
        if (!line.partyId) continue;
        const current = customerNetMap.get(line.partyId) || 0;
        customerNetMap.set(line.partyId, current + line.debitPaisa - line.creditPaisa);
      }

      let sumOfPartyBalancesPaisa = 0;
      for (const bal of customerNetMap.values()) {
        sumOfPartyBalancesPaisa += bal;
      }

      // Reconciliation
      const differencePaisa = controlAccountBalancePaisa - sumOfPartyBalancesPaisa;
      const isReconciled = differencePaisa === 0;

      // 3. Aging Buckets from customer debit lines
      // We calculate aging on outstanding debit lines (or invoice dates)
      const aging = {
        currentPaisa: 0,
        days1to30Paisa: 0,
        days31to60Paisa: 0,
        days61to90Paisa: 0,
        days90PlusPaisa: 0,
      };

      for (const line of partyLines) {
        if (line.debitPaisa > 0) {
          const days = calculateDaysDifference(asOfDate, line.entryDate);
          const bucket = classifyAgingBucket(days);
          switch (bucket) {
            case 'current':
              aging.currentPaisa += line.debitPaisa;
              break;
            case 'days1to30':
              aging.days1to30Paisa += line.debitPaisa;
              break;
            case 'days31to60':
              aging.days31to60Paisa += line.debitPaisa;
              break;
            case 'days61to90':
              aging.days61to90Paisa += line.debitPaisa;
              break;
            case 'days90Plus':
              aging.days90PlusPaisa += line.debitPaisa;
              break;
          }
        }
      }

      // 4. Overdue Paisa (> 0 days old)
      const overduePaisa =
        aging.days1to30Paisa +
        aging.days31to60Paisa +
        aging.days61to90Paisa +
        aging.days90PlusPaisa;

      // 5. Collected this month (Credits on AR account in current month)
      const [colRow] = await db
        .select({
          collected: sql<string>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, userContext.pharmacyId),
            eq(journalLines.accountId, arAccountId),
            eq(journalLines.partyType, 'customer'),
            sql`${journalEntries.entryDate} LIKE ${currentMonthPrefix + '%'}`
          )
        );

      const collectedThisMonthPaisa = Number(colRow?.collected || 0);

      return reply.send({
        success: true,
        data: {
          totalOutstandingPaisa: sumOfPartyBalancesPaisa,
          overduePaisa,
          collectedThisMonthPaisa,
          aging,
          reconciliation: {
            controlAccountBalancePaisa,
            sumOfPartyBalancesPaisa,
            differencePaisa,
            isReconciled,
          },
        },
      });
    }
  );

  /**
   * GET /api/finance/ar/customers
   * Customers list with AR aging buckets and expandable open credit invoices
   */
  fastify.get(
    '/customers',
    {
      config: { requiredPermission: 'finance.ar.view' },
      preHandler: [requirePermission('finance.ar.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const query = request.query as { asOfDate?: string; search?: string };
      const asOfDate = query.asOfDate || getKarachiBusinessDate();

      const arAccountId = await getArAccountId(db, userContext.pharmacyId);

      // 1. Fetch all customers of this pharmacy
      const allCustomers = await db
        .select()
        .from(customers)
        .where(eq(customers.pharmacyId, userContext.pharmacyId))
        .orderBy(asc(customers.name));

      // 2. Fetch all AR journal lines for this pharmacy
      const arLines = await db
        .select({
          partyId: journalLines.partyId,
          entryDate: journalEntries.entryDate,
          debitPaisa: journalLines.debitPaisa,
          creditPaisa: journalLines.creditPaisa,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, userContext.pharmacyId),
            eq(journalLines.accountId, arAccountId),
            eq(journalLines.partyType, 'customer')
          )
        );

      // Group aging and total by customer
      const customerStats = new Map<
        string,
        {
          totalDebit: number;
          totalCredit: number;
          aging: {
            currentPaisa: number;
            days1to30Paisa: number;
            days31to60Paisa: number;
            days61to90Paisa: number;
            days90PlusPaisa: number;
          };
        }
      >();

      for (const line of arLines) {
        if (!line.partyId) continue;
        if (!customerStats.has(line.partyId)) {
          customerStats.set(line.partyId, {
            totalDebit: 0,
            totalCredit: 0,
            aging: {
              currentPaisa: 0,
              days1to30Paisa: 0,
              days31to60Paisa: 0,
              days61to90Paisa: 0,
              days90PlusPaisa: 0,
            },
          });
        }
        const st = customerStats.get(line.partyId)!;
        st.totalDebit += line.debitPaisa;
        st.totalCredit += line.creditPaisa;

        if (line.debitPaisa > 0) {
          const days = calculateDaysDifference(asOfDate, line.entryDate);
          const bucket = classifyAgingBucket(days);
          const agingKey = (
            bucket === 'current' ? 'currentPaisa' : `${bucket}Paisa`
          ) as keyof typeof st.aging;
          st.aging[agingKey] += line.debitPaisa;
        }
      }

      // 3. Fetch finalized invoices for expandable document view
      const allInvoices = await db
        .select({
          id: invoices.id,
          customerId: invoices.customerId,
          invoiceNumber: invoices.invoiceNumber,
          totalPaisa: invoices.totalPaisa,
          createdAt: invoices.createdAt,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.pharmacyId, userContext.pharmacyId),
            sql`${invoices.customerId} IS NOT NULL`,
            eq(invoices.status, 'finalized')
          )
        )
        .orderBy(desc(invoices.createdAt));

      // Calculate paid amounts per invoice from payment allocations
      const allocations = await db
        .select({
          documentId: paymentAllocations.documentId,
          allocatedPaisa: paymentAllocations.allocatedPaisa,
        })
        .from(paymentAllocations)
        .innerJoin(erpPayments, eq(paymentAllocations.paymentId, erpPayments.id))
        .where(
          and(
            eq(paymentAllocations.pharmacyId, userContext.pharmacyId),
            eq(paymentAllocations.documentType, 'invoice'),
            sql`${erpPayments.status} != 'reversed'`
          )
        );

      const allocMap = new Map<string, number>();
      for (const a of allocations) {
        allocMap.set(a.documentId, (allocMap.get(a.documentId) || 0) + a.allocatedPaisa);
      }

      const invoiceDocsByCustomer = new Map<string, unknown[]>();
      for (const inv of allInvoices) {
        if (!inv.customerId) continue;
        const paidPaisa = allocMap.get(inv.id) || 0;
        const balanceDuePaisa = inv.totalPaisa - paidPaisa;
        const invDate = toKarachiBusinessDate(inv.createdAt);
        const days = calculateDaysDifference(asOfDate, invDate);

        if (!invoiceDocsByCustomer.has(inv.customerId)) {
          invoiceDocsByCustomer.set(inv.customerId, []);
        }

        invoiceDocsByCustomer.get(inv.customerId)!.push({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          date: invDate,
          totalPaisa: inv.totalPaisa,
          paidPaisa,
          balanceDuePaisa,
          daysOverdue: Math.max(0, days),
          agingBucket: classifyAgingBucket(days),
        });
      }

      const results = allCustomers.map((c) => {
        const stats = customerStats.get(c.id) || {
          totalDebit: 0,
          totalCredit: 0,
          aging: {
            currentPaisa: 0,
            days1to30Paisa: 0,
            days31to60Paisa: 0,
            days61to90Paisa: 0,
            days90PlusPaisa: 0,
          },
        };

        const outstandingPaisa = stats.totalDebit - stats.totalCredit;
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          address: c.address,
          creditLimitPaisa: c.creditLimitPaisa,
          paymentTermsDays: 30,
          outstandingPaisa,
          totalInvoicedPaisa: stats.totalDebit,
          totalReceivedPaisa: stats.totalCredit,
          aging: stats.aging,
          documents: invoiceDocsByCustomer.get(c.id) || [],
        };
      });

      // Filter by search query if present
      let filtered = results;
      if (query.search?.trim()) {
        const q = query.search.trim().toLowerCase();
        filtered = filtered.filter(
          (c) => c.name.toLowerCase().includes(q) || (c.phone && c.phone.toLowerCase().includes(q))
        );
      }

      return reply.send({
        success: true,
        data: {
          customers: filtered,
        },
      });
    }
  );

  /**
   * GET /api/finance/ar/products
   * Group open receivables by product across credit invoices
   */
  fastify.get(
    '/products',
    {
      config: { requiredPermission: 'finance.ar.view' },
      preHandler: [requirePermission('finance.ar.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      // Query invoice lines for finalized credit invoices
      const rows = await db
        .select({
          productId: products.id,
          productName: products.brandName,
          genericName: products.genericName,
          quantity: invoiceLines.quantity,
          lineTotalPaisa: invoiceLines.lineTotalPaisa,
          invoiceId: invoices.id,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .innerJoin(products, eq(invoiceLines.productId, products.id))
        .where(
          and(
            eq(invoices.pharmacyId, userContext.pharmacyId),
            sql`${invoices.customerId} IS NOT NULL`,
            eq(invoices.status, 'finalized')
          )
        );

      const productMap = new Map<
        string,
        {
          productId: string;
          productName: string;
          genericName: string | null;
          unitsOnCredit: number;
          creditSalesPaisa: number;
          receivablePaisa: number;
          invoiceSet: Set<string>;
        }
      >();

      for (const r of rows) {
        if (!productMap.has(r.productId)) {
          productMap.set(r.productId, {
            productId: r.productId,
            productName: r.productName,
            genericName: r.genericName,
            unitsOnCredit: 0,
            creditSalesPaisa: 0,
            receivablePaisa: 0,
            invoiceSet: new Set<string>(),
          });
        }
        const item = productMap.get(r.productId)!;
        item.unitsOnCredit += r.quantity;
        item.creditSalesPaisa += r.lineTotalPaisa;
        item.receivablePaisa += r.lineTotalPaisa;
        item.invoiceSet.add(r.invoiceId);
      }

      const productsList = Array.from(productMap.values()).map((p) => ({
        productId: p.productId,
        productName: p.productName,
        genericName: p.genericName,
        unitsOnCredit: p.unitsOnCredit,
        creditSalesPaisa: p.creditSalesPaisa,
        receivablePaisa: p.receivablePaisa,
        invoiceCount: p.invoiceSet.size,
      }));

      return reply.send({
        success: true,
        data: {
          products: productsList,
        },
      });
    }
  );

  /**
   * GET /api/finance/ar/statement/:customerId
   * Printable Statement of Account with chronological running balances
   */
  fastify.get(
    '/statement/:customerId',
    {
      config: { requiredPermission: 'finance.ar.view' },
      preHandler: [requirePermission('finance.ar.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { customerId } = request.params as { customerId: string };
      const query = request.query as { startDate?: string; endDate?: string };

      const startDate = query.startDate || `${new Date().getFullYear()}-01-01`;
      const endDate = query.endDate || getKarachiBusinessDate();

      // Verify customer exists in pharmacy
      const [customer] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.pharmacyId, userContext.pharmacyId)))
        .limit(1);

      if (!customer) {
        return reply.status(404).send({
          success: false,
          message: 'Customer not found or belongs to another pharmacy',
        });
      }

      const arAccountId = await getArAccountId(db, userContext.pharmacyId);

      // 1. Opening Balance prior to startDate
      const [priorRow] = await db
        .select({
          totalDebit: sql<string>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, userContext.pharmacyId),
            eq(journalLines.accountId, arAccountId),
            eq(journalLines.partyType, 'customer'),
            eq(journalLines.partyId, customerId),
            lt(journalEntries.entryDate, startDate)
          )
        );

      const openingBalancePaisa =
        Number(priorRow?.totalDebit || 0) - Number(priorRow?.totalCredit || 0);

      // 2. Period transactions
      const periodLines = await db
        .select({
          id: journalLines.id,
          entryId: journalEntries.id,
          entryNo: journalEntries.entryNo,
          entryDate: journalEntries.entryDate,
          sourceType: journalEntries.sourceType,
          memo: journalEntries.memo,
          debitPaisa: journalLines.debitPaisa,
          creditPaisa: journalLines.creditPaisa,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, userContext.pharmacyId),
            eq(journalLines.accountId, arAccountId),
            eq(journalLines.partyType, 'customer'),
            eq(journalLines.partyId, customerId),
            gte(journalEntries.entryDate, startDate),
            lte(journalEntries.entryDate, endDate)
          )
        )
        .orderBy(asc(journalEntries.entryDate), asc(journalEntries.entryNo));

      let running = openingBalancePaisa;
      let totalDebitsPaisa = 0;
      let totalCreditsPaisa = 0;

      const linesWithRunning = periodLines.map((l) => {
        running = running + l.debitPaisa - l.creditPaisa;
        totalDebitsPaisa += l.debitPaisa;
        totalCreditsPaisa += l.creditPaisa;
        return {
          id: l.id,
          entryNo: l.entryNo,
          date: l.entryDate,
          type: l.sourceType,
          description: l.memo || 'Ledger transaction',
          debitPaisa: l.debitPaisa,
          creditPaisa: l.creditPaisa,
          runningBalancePaisa: running,
        };
      });

      const closingBalancePaisa = openingBalancePaisa + totalDebitsPaisa - totalCreditsPaisa;

      return reply.send({
        success: true,
        data: {
          customer: {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            address: customer.address,
            creditLimitPaisa: customer.creditLimitPaisa,
          },
          period: {
            startDate,
            endDate,
          },
          openingBalancePaisa,
          totalDebitsPaisa,
          totalCreditsPaisa,
          closingBalancePaisa,
          lines: linesWithRunning,
        },
      });
    }
  );

  /**
   * GET /api/finance/ar/reminders
   * Fetch overdue accounts and reminder logs
   */
  fastify.get(
    '/reminders',
    {
      config: { requiredPermission: 'finance.ar.view' },
      preHandler: [requirePermission('finance.ar.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const remindersList = await db
        .select({
          id: paymentReminders.id,
          partyId: paymentReminders.partyId,
          partyName: customers.name,
          channel: paymentReminders.channel,
          recipient: paymentReminders.recipient,
          message: paymentReminders.message,
          amountPaisa: paymentReminders.amountPaisa,
          daysOverdue: paymentReminders.daysOverdue,
          sentAt: paymentReminders.sentAt,
          createdAt: paymentReminders.createdAt,
        })
        .from(paymentReminders)
        .innerJoin(
          customers,
          and(
            eq(paymentReminders.partyId, customers.id),
            eq(customers.pharmacyId, userContext.pharmacyId)
          )
        )
        .where(
          and(
            eq(paymentReminders.pharmacyId, userContext.pharmacyId),
            eq(paymentReminders.partyType, 'customer')
          )
        )
        .orderBy(desc(paymentReminders.sentAt));

      return reply.send({
        success: true,
        data: {
          reminders: remindersList,
        },
      });
    }
  );

  /**
   * POST /api/finance/ar/reminders
   * Log/record an overdue payment reminder
   */
  fastify.post(
    '/reminders',
    {
      config: { requiredPermission: 'finance.payment.create' },
      preHandler: [requirePermission('finance.payment.create')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = ReminderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          message: parsed.error.issues[0]?.message || 'Invalid reminder data',
        });
      }

      const data = parsed.data;

      // Verify customer belongs to this pharmacy tenant
      const [cust] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(eq(customers.id, data.partyId), eq(customers.pharmacyId, userContext.pharmacyId))
        )
        .limit(1);

      if (!cust) {
        return reply.status(404).send({
          success: false,
          message: 'Customer not found in this pharmacy',
        });
      }

      if (data.documentId) {
        const [inv] = await db
          .select({ id: invoices.id })
          .from(invoices)
          .where(
            and(eq(invoices.id, data.documentId), eq(invoices.pharmacyId, userContext.pharmacyId))
          )
          .limit(1);
        if (!inv) {
          return reply.status(404).send({
            success: false,
            message: 'Referenced invoice not found in this pharmacy',
          });
        }
      }

      const reminderId = generateUuidV7();
      const nowIso = new Date().toISOString();

      await db.insert(paymentReminders).values({
        id: reminderId,
        pharmacyId: userContext.pharmacyId,
        partyType: 'customer',
        partyId: data.partyId,
        documentId: data.documentId || null,
        channel: data.channel,
        recipient: data.recipient || null,
        message: data.message || null,
        amountPaisa: data.amountPaisa,
        daysOverdue: data.daysOverdue,
        sentAt: nowIso,
        createdBy: userContext.userId,
        createdAt: nowIso,
      });

      return reply.send({
        success: true,
        data: {
          id: reminderId,
        },
      });
    }
  );
};
