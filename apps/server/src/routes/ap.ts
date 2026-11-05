import type { FastifyPluginAsync } from 'fastify';
import { eq, and, sql, desc, asc, lte, gte, lt } from 'drizzle-orm';
import { z, generateUuidV7 } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  suppliers,
  purchaseOrders,
  accounts,
  journalEntries,
  journalLines,
  paymentReminders,
  pharmacyAccountMappings,
  paymentAllocations,
  erpPayments,
} from '../db/schema';

const ReminderSchema = z.object({
  partyType: z.literal('supplier'),
  partyId: z.string().uuid(),
  channel: z.enum(['sms', 'whatsapp', 'phone', 'email', 'in_person']).default('phone'),
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

async function getApAccountId(db: ReturnType<typeof getDb>, pharmacyId: string): Promise<string> {
  const [mapped] = await db
    .select({ accountId: pharmacyAccountMappings.accountId })
    .from(pharmacyAccountMappings)
    .where(
      and(
        eq(pharmacyAccountMappings.pharmacyId, pharmacyId),
        eq(pharmacyAccountMappings.role, 'ap')
      )
    )
    .limit(1);

  if (mapped?.accountId) {
    return mapped.accountId;
  }

  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.pharmacyId, pharmacyId), eq(accounts.code, '2000')))
    .limit(1);

  if (!acct) {
    throw new Error(`Accounts Payable account (code 2000) not found for pharmacy ${pharmacyId}`);
  }
  return acct.id;
}

export const apRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/finance/ap/summary
   * KPI cards, aging breakdown, and control account reconciliation check
   */
  fastify.get(
    '/summary',
    {
      config: { requiredPermission: 'finance.ap.view' },
      preHandler: [requirePermission('finance.ap.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const query = request.query as { asOfDate?: string };

      const asOfDate = query.asOfDate || new Date().toISOString().slice(0, 10);
      const currentMonthPrefix = asOfDate.slice(0, 7);

      const apAccountId = await getApAccountId(db, userContext.pharmacyId);

      // 1. Control Account Balance: Credit - Debit (AP is a liability)
      const [ctrlRow] = await db
        .select({
          totalDebit: sql<string>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
        })
        .from(journalLines)
        .where(
          and(
            eq(journalLines.pharmacyId, userContext.pharmacyId),
            eq(journalLines.accountId, apAccountId)
          )
        );

      const controlAccountBalancePaisa =
        Number(ctrlRow?.totalCredit || 0) - Number(ctrlRow?.totalDebit || 0);

      // 2. Party lines for supplier balances
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
            eq(journalLines.accountId, apAccountId),
            eq(journalLines.partyType, 'supplier'),
            sql`${journalEntries.status} != 'reversed'`
          )
        );

      // Supplier net balances (Credit - Debit)
      const supplierNetMap = new Map<string, number>();
      for (const line of partyLines) {
        if (!line.partyId) continue;
        const current = supplierNetMap.get(line.partyId) || 0;
        supplierNetMap.set(line.partyId, current + line.creditPaisa - line.debitPaisa);
      }

      let sumOfPartyBalancesPaisa = 0;
      for (const bal of supplierNetMap.values()) {
        sumOfPartyBalancesPaisa += bal;
      }

      // Reconciliation
      const differencePaisa = controlAccountBalancePaisa - sumOfPartyBalancesPaisa;
      const isReconciled = differencePaisa === 0;

      // 3. Aging Buckets from supplier credit obligations
      const aging = {
        currentPaisa: 0,
        days1to30Paisa: 0,
        days31to60Paisa: 0,
        days61to90Paisa: 0,
        days90PlusPaisa: 0,
      };

      for (const line of partyLines) {
        if (line.creditPaisa > 0) {
          const days = calculateDaysDifference(asOfDate, line.entryDate);
          const bucket = classifyAgingBucket(days);
          switch (bucket) {
            case 'current':
              aging.currentPaisa += line.creditPaisa;
              break;
            case 'days1to30':
              aging.days1to30Paisa += line.creditPaisa;
              break;
            case 'days31to60':
              aging.days31to60Paisa += line.creditPaisa;
              break;
            case 'days61to90':
              aging.days61to90Paisa += line.creditPaisa;
              break;
            case 'days90Plus':
              aging.days90PlusPaisa += line.creditPaisa;
              break;
          }
        }
      }

      // 4. Overdue Paisa
      const overduePaisa =
        aging.days1to30Paisa +
        aging.days31to60Paisa +
        aging.days61to90Paisa +
        aging.days90PlusPaisa;

      // 5. Paid this month (Debits on AP account in current month)
      const [paidRow] = await db
        .select({
          paid: sql<string>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, userContext.pharmacyId),
            eq(journalLines.accountId, apAccountId),
            eq(journalLines.partyType, 'supplier'),
            sql`${journalEntries.status} != 'reversed'`,
            sql`${journalEntries.entryDate} LIKE ${currentMonthPrefix + '%'}`
          )
        );

      const paidThisMonthPaisa = Number(paidRow?.paid || 0);

      return reply.send({
        success: true,
        data: {
          totalOutstandingPaisa: sumOfPartyBalancesPaisa,
          overduePaisa,
          paidThisMonthPaisa,
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
   * GET /api/finance/ap/suppliers
   * Suppliers list with AP aging buckets and expandable purchase bills
   */
  fastify.get(
    '/suppliers',
    {
      config: { requiredPermission: 'finance.ap.view' },
      preHandler: [requirePermission('finance.ap.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const query = request.query as { asOfDate?: string; search?: string };
      const asOfDate = query.asOfDate || new Date().toISOString().slice(0, 10);

      const apAccountId = await getApAccountId(db, userContext.pharmacyId);

      // 1. Fetch all suppliers of this pharmacy
      const allSuppliers = await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.pharmacyId, userContext.pharmacyId))
        .orderBy(asc(suppliers.name));

      // 2. Fetch all AP journal lines for this pharmacy
      const apLines = await db
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
            eq(journalLines.accountId, apAccountId),
            eq(journalLines.partyType, 'supplier'),
            sql`${journalEntries.status} != 'reversed'`
          )
        );

      // Group aging and totals by supplier
      const supplierStats = new Map<
        string,
        {
          totalCredit: number;
          totalDebit: number;
          aging: {
            currentPaisa: number;
            days1to30Paisa: number;
            days31to60Paisa: number;
            days61to90Paisa: number;
            days90PlusPaisa: number;
          };
        }
      >();

      for (const line of apLines) {
        if (!line.partyId) continue;
        if (!supplierStats.has(line.partyId)) {
          supplierStats.set(line.partyId, {
            totalCredit: 0,
            totalDebit: 0,
            aging: {
              currentPaisa: 0,
              days1to30Paisa: 0,
              days31to60Paisa: 0,
              days61to90Paisa: 0,
              days90PlusPaisa: 0,
            },
          });
        }
        const st = supplierStats.get(line.partyId)!;
        st.totalCredit += line.creditPaisa;
        st.totalDebit += line.debitPaisa;

        if (line.creditPaisa > 0) {
          const days = calculateDaysDifference(asOfDate, line.entryDate);
          const bucket = classifyAgingBucket(days);
          const agingKey = (
            bucket === 'current' ? 'currentPaisa' : `${bucket}Paisa`
          ) as keyof typeof st.aging;
          st.aging[agingKey] += line.creditPaisa;
        }
      }

      // 3. Fetch purchase orders with status = 'received' for expandable documents
      const receivedPOs = await db
        .select({
          id: purchaseOrders.id,
          supplierId: purchaseOrders.supplierId,
          poNumber: purchaseOrders.poNumber,
          totalExpectedCostPaisa: purchaseOrders.totalExpectedCostPaisa,
          createdAt: purchaseOrders.createdAt,
        })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.pharmacyId, userContext.pharmacyId),
            eq(purchaseOrders.status, 'received')
          )
        )
        .orderBy(desc(purchaseOrders.createdAt));

      // Calculate paid amounts per purchase from payment allocations
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
            eq(paymentAllocations.documentType, 'purchase'),
            sql`${erpPayments.status} != 'reversed'`
          )
        );

      const allocMap = new Map<string, number>();
      for (const a of allocations) {
        allocMap.set(a.documentId, (allocMap.get(a.documentId) || 0) + a.allocatedPaisa);
      }

      const billsBySupplier = new Map<string, unknown[]>();
      for (const po of receivedPOs) {
        const paidPaisa = allocMap.get(po.id) || 0;
        const balanceDuePaisa = po.totalExpectedCostPaisa - paidPaisa;
        const poDate = po.createdAt.slice(0, 10);
        const days = calculateDaysDifference(asOfDate, poDate);

        if (!billsBySupplier.has(po.supplierId)) {
          billsBySupplier.set(po.supplierId, []);
        }

        billsBySupplier.get(po.supplierId)!.push({
          id: po.id,
          billNumber: po.poNumber,
          date: poDate,
          totalPaisa: po.totalExpectedCostPaisa,
          paidPaisa,
          balanceDuePaisa,
          daysOverdue: Math.max(0, days),
          agingBucket: classifyAgingBucket(days),
        });
      }

      const results = allSuppliers.map((s) => {
        const stats = supplierStats.get(s.id) || {
          totalCredit: 0,
          totalDebit: 0,
          aging: {
            currentPaisa: 0,
            days1to30Paisa: 0,
            days31to60Paisa: 0,
            days61to90Paisa: 0,
            days90PlusPaisa: 0,
          },
        };

        const outstandingPaisa = stats.totalCredit - stats.totalDebit;
        return {
          id: s.id,
          name: s.name,
          contactPerson: s.contactPerson,
          phone: s.phone,
          paymentTermsDays: s.paymentTermsDays,
          outstandingPaisa,
          totalBilledPaisa: stats.totalCredit,
          totalPaidPaisa: stats.totalDebit,
          aging: stats.aging,
          bills: billsBySupplier.get(s.id) || [],
        };
      });

      let filtered = results;
      if (query.search?.trim()) {
        const q = query.search.trim().toLowerCase();
        filtered = filtered.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.contactPerson && s.contactPerson.toLowerCase().includes(q)) ||
            (s.phone && s.phone.toLowerCase().includes(q))
        );
      }

      return reply.send({
        success: true,
        data: {
          suppliers: filtered,
        },
      });
    }
  );

  /**
   * GET /api/finance/ap/bills
   * Flat view of all open purchase bills and obligations
   */
  fastify.get(
    '/bills',
    {
      config: { requiredPermission: 'finance.ap.view' },
      preHandler: [requirePermission('finance.ap.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const query = request.query as { asOfDate?: string };
      const asOfDate = query.asOfDate || new Date().toISOString().slice(0, 10);

      // 1. Fetch received POs
      const receivedPOs = await db
        .select({
          id: purchaseOrders.id,
          supplierId: purchaseOrders.supplierId,
          supplierName: suppliers.name,
          poNumber: purchaseOrders.poNumber,
          totalPaisa: purchaseOrders.totalExpectedCostPaisa,
          paymentTermsDays: suppliers.paymentTermsDays,
          createdAt: purchaseOrders.createdAt,
        })
        .from(purchaseOrders)
        .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .where(
          and(
            eq(purchaseOrders.pharmacyId, userContext.pharmacyId),
            eq(purchaseOrders.status, 'received')
          )
        )
        .orderBy(desc(purchaseOrders.createdAt));

      // Calculate paid amounts
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
            eq(paymentAllocations.documentType, 'purchase'),
            sql`${erpPayments.status} != 'reversed'`
          )
        );

      const allocMap = new Map<string, number>();
      for (const a of allocations) {
        allocMap.set(a.documentId, (allocMap.get(a.documentId) || 0) + a.allocatedPaisa);
      }

      const billsList = receivedPOs.map((po) => {
        const paidPaisa = allocMap.get(po.id) || 0;
        const balanceDuePaisa = po.totalPaisa - paidPaisa;
        const billDate = po.createdAt.slice(0, 10);
        const days = calculateDaysDifference(asOfDate, billDate);

        return {
          id: po.id,
          documentType: 'purchase',
          billNumber: po.poNumber,
          supplierId: po.supplierId,
          supplierName: po.supplierName,
          date: billDate,
          paymentTermsDays: po.paymentTermsDays,
          totalPaisa: po.totalPaisa,
          paidPaisa,
          balanceDuePaisa,
          daysOverdue: Math.max(0, days),
          agingBucket: classifyAgingBucket(days),
        };
      });

      return reply.send({
        success: true,
        data: {
          bills: billsList,
        },
      });
    }
  );

  /**
   * GET /api/finance/ap/statement/:supplierId
   * Printable Statement of Account with chronological running balances
   */
  fastify.get(
    '/statement/:supplierId',
    {
      config: { requiredPermission: 'finance.ap.view' },
      preHandler: [requirePermission('finance.ap.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { supplierId } = request.params as { supplierId: string };
      const query = request.query as { startDate?: string; endDate?: string };

      const startDate = query.startDate || `${new Date().getFullYear()}-01-01`;
      const endDate = query.endDate || new Date().toISOString().slice(0, 10);

      // Verify supplier exists in pharmacy
      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, supplierId), eq(suppliers.pharmacyId, userContext.pharmacyId)))
        .limit(1);

      if (!supplier) {
        return reply.status(404).send({
          success: false,
          message: 'Supplier not found or belongs to another pharmacy',
        });
      }

      const apAccountId = await getApAccountId(db, userContext.pharmacyId);

      // 1. Opening Balance prior to startDate: Credit - Debit (AP liability)
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
            eq(journalLines.accountId, apAccountId),
            eq(journalLines.partyType, 'supplier'),
            eq(journalLines.partyId, supplierId),
            sql`${journalEntries.status} != 'reversed'`,
            lt(journalEntries.entryDate, startDate)
          )
        );

      const openingBalancePaisa =
        Number(priorRow?.totalCredit || 0) - Number(priorRow?.totalDebit || 0);

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
            eq(journalLines.accountId, apAccountId),
            eq(journalLines.partyType, 'supplier'),
            eq(journalLines.partyId, supplierId),
            sql`${journalEntries.status} != 'reversed'`,
            gte(journalEntries.entryDate, startDate),
            lte(journalEntries.entryDate, endDate)
          )
        )
        .orderBy(asc(journalEntries.entryDate), asc(journalEntries.entryNo));

      let running = openingBalancePaisa;
      let totalDebitsPaisa = 0;
      let totalCreditsPaisa = 0;

      const linesWithRunning = periodLines.map((l) => {
        // For AP liability: credit increases balance, debit reduces balance
        running = running + l.creditPaisa - l.debitPaisa;
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

      const closingBalancePaisa = openingBalancePaisa + totalCreditsPaisa - totalDebitsPaisa;

      return reply.send({
        success: true,
        data: {
          supplier: {
            id: supplier.id,
            name: supplier.name,
            contactPerson: supplier.contactPerson,
            phone: supplier.phone,
            paymentTermsDays: supplier.paymentTermsDays,
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
   * GET /api/finance/ap/reminders
   * Fetch overdue supplier bills and reminder logs
   */
  fastify.get(
    '/reminders',
    {
      config: { requiredPermission: 'finance.ap.view' },
      preHandler: [requirePermission('finance.ap.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const remindersList = await db
        .select({
          id: paymentReminders.id,
          partyId: paymentReminders.partyId,
          partyName: suppliers.name,
          channel: paymentReminders.channel,
          recipient: paymentReminders.recipient,
          message: paymentReminders.message,
          amountPaisa: paymentReminders.amountPaisa,
          daysOverdue: paymentReminders.daysOverdue,
          sentAt: paymentReminders.sentAt,
          createdAt: paymentReminders.createdAt,
        })
        .from(paymentReminders)
        .innerJoin(suppliers, eq(paymentReminders.partyId, suppliers.id))
        .where(
          and(
            eq(paymentReminders.pharmacyId, userContext.pharmacyId),
            eq(paymentReminders.partyType, 'supplier')
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
   * POST /api/finance/ap/reminders
   * Log/record an overdue supplier payment note / reminder
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
      const reminderId = generateUuidV7();
      const nowIso = new Date().toISOString();

      await db.insert(paymentReminders).values({
        id: reminderId,
        pharmacyId: userContext.pharmacyId,
        partyType: 'supplier',
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
