import type { FastifyPluginAsync } from 'fastify';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  invoices,
  creditNotes,
  erpPayments,
  customers,
  branches,
  counters,
  users,
} from '../db/schema';

export interface SalesLedgerEntry {
  id: string;
  date: string; // ISO or YYYY-MM-DD
  type: 'sale' | 'return' | 'receipt';
  documentNumber: string;
  branchId?: string | null;
  branchName?: string | null;
  counterId?: string | null;
  counterName?: string | null;
  cashierUserId?: string | null;
  cashierName?: string | null;
  partyId?: string | null;
  partyName?: string | null;
  partyPhone?: string | null;
  paymentMethod?: string | null;
  grossPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  netPaisa: number;
  runningNetPaisa: number;
  notes?: string | null;
}

export const salesLedgerRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/finance/sales-ledger
   * Aggregates sales (invoices), returns, and customer credit receipts in running chronological order
   */
  fastify.get(
    '/',
    {
      config: { requiredPermission: 'finance.sales_ledger.view' },
      preHandler: [requirePermission('finance.sales_ledger.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const query = request.query as {
        startDate?: string;
        endDate?: string;
        branchId?: string;
        cashierUserId?: string;
        customerId?: string;
        type?: 'all' | 'sale' | 'return' | 'receipt';
        limit?: string;
        offset?: string;
      };

      const docTypeFilter = query.type || 'all';
      const startDateIso = query.startDate
        ? query.startDate.includes('T')
          ? query.startDate
          : `${query.startDate}T00:00:00.000Z`
        : undefined;
      const endDateIso = query.endDate
        ? query.endDate.includes('T')
          ? query.endDate
          : `${query.endDate}T23:59:59.999Z`
        : undefined;

      // 1. Fetch Invoices (Sales)
      let invoiceRows: Array<{
        id: string;
        date: string;
        invoiceNumber: string;
        branchId: string | null;
        branchName: string | null;
        counterId: string | null;
        counterName: string | null;
        cashierUserId: string | null;
        cashierName: string | null;
        customerId: string | null;
        customerName: string | null;
        customerPhone: string | null;
        subtotalPaisa: number;
        discountPaisa: number;
        taxPaisa: number;
        totalPaisa: number;
      }> = [];

      if (docTypeFilter === 'all' || docTypeFilter === 'sale') {
        const invQuery = db
          .select({
            id: invoices.id,
            date: invoices.createdAt,
            invoiceNumber: invoices.invoiceNumber,
            branchId: counters.branchId,
            branchName: branches.name,
            counterId: invoices.counterId,
            counterName: counters.name,
            cashierUserId: invoices.cashierUserId,
            cashierName: users.name,
            customerId: invoices.customerId,
            customerName: customers.name,
            customerPhone: customers.phone,
            subtotalPaisa: invoices.subtotalPaisa,
            discountPaisa: invoices.discountPaisa,
            taxPaisa: invoices.taxPaisa,
            totalPaisa: invoices.totalPaisa,
          })
          .from(invoices)
          .leftJoin(counters, eq(invoices.counterId, counters.id))
          .leftJoin(branches, eq(counters.branchId, branches.id))
          .leftJoin(users, eq(invoices.cashierUserId, users.id))
          .leftJoin(customers, eq(invoices.customerId, customers.id))
          .where(
            and(
              eq(invoices.pharmacyId, userContext.pharmacyId),
              inArray(invoices.status, ['finalized', 'completed']),
              query.branchId ? eq(counters.branchId, query.branchId) : undefined,
              query.cashierUserId ? eq(invoices.cashierUserId, query.cashierUserId) : undefined,
              query.customerId ? eq(invoices.customerId, query.customerId) : undefined,
              startDateIso ? sql`${invoices.createdAt} >= ${startDateIso}` : undefined,
              endDateIso ? sql`${invoices.createdAt} <= ${endDateIso}` : undefined
            )
          )
          .limit(Math.min(Math.max(Number(query.limit) || 200, 1), 1000))
          .offset(Math.max(Number(query.offset) || 0, 0));

        invoiceRows = await invQuery;
      }

      // 2. Fetch Returns (Sales Returns / Credit Notes)
      let returnRows: Array<{
        id: string;
        date: string;
        creditNoteNumber: string;
        branchId: string | null;
        branchName: string | null;
        counterId: string | null;
        counterName: string | null;
        cashierUserId: string | null;
        cashierName: string | null;
        customerId: string | null;
        customerName: string | null;
        customerPhone: string | null;
        totalRefundPaisa: number;
        reason: string | null;
      }> = [];

      if (docTypeFilter === 'all' || docTypeFilter === 'return') {
        const retQuery = db
          .select({
            id: creditNotes.id,
            date: creditNotes.createdAt,
            creditNoteNumber: creditNotes.creditNoteNumber,
            branchId: creditNotes.branchId,
            branchName: branches.name,
            counterId: creditNotes.counterId,
            counterName: counters.name,
            cashierUserId: creditNotes.cashierUserId,
            cashierName: users.name,
            customerId: invoices.customerId,
            customerName: customers.name,
            customerPhone: customers.phone,
            totalRefundPaisa: creditNotes.totalPaisa,
            reason: creditNotes.reason,
          })
          .from(creditNotes)
          .leftJoin(branches, eq(creditNotes.branchId, branches.id))
          .leftJoin(counters, eq(creditNotes.counterId, counters.id))
          .leftJoin(users, eq(creditNotes.cashierUserId, users.id))
          .leftJoin(invoices, eq(creditNotes.originalInvoiceId, invoices.id))
          .leftJoin(customers, eq(invoices.customerId, customers.id))
          .where(
            and(
              eq(creditNotes.pharmacyId, userContext.pharmacyId),
              query.branchId ? eq(creditNotes.branchId, query.branchId) : undefined,
              query.cashierUserId ? eq(creditNotes.cashierUserId, query.cashierUserId) : undefined,
              query.customerId ? eq(invoices.customerId, query.customerId) : undefined,
              startDateIso ? sql`${creditNotes.createdAt} >= ${startDateIso}` : undefined,
              endDateIso ? sql`${creditNotes.createdAt} <= ${endDateIso}` : undefined
            )
          );

        returnRows = await retQuery;
      }

      // 3. Fetch Customer Receipts (Credit debt collections)
      let receiptRows: Array<{
        id: string;
        date: string;
        paymentNumber: string;
        branchId: string | null;
        branchName: string | null;
        cashierUserId: string | null;
        cashierName: string | null;
        customerId: string | null;
        customerName: string | null;
        customerPhone: string | null;
        amountPaisa: number;
        paymentMethod: string;
        notes: string | null;
      }> = [];

      if (docTypeFilter === 'all' || docTypeFilter === 'receipt') {
        const recQuery = db
          .select({
            id: erpPayments.id,
            date: erpPayments.createdAt,
            paymentNumber: erpPayments.paymentNumber,
            branchId: erpPayments.branchId,
            branchName: branches.name,
            cashierUserId: erpPayments.createdBy,
            cashierName: users.name,
            customerId: erpPayments.partyId,
            customerName: customers.name,
            customerPhone: customers.phone,
            amountPaisa: erpPayments.amountPaisa,
            paymentMethod: erpPayments.method,
            notes: erpPayments.notes,
          })
          .from(erpPayments)
          .leftJoin(branches, eq(erpPayments.branchId, branches.id))
          .leftJoin(users, eq(erpPayments.createdBy, users.id))
          .leftJoin(customers, eq(erpPayments.partyId, customers.id))
          .where(
            and(
              eq(erpPayments.pharmacyId, userContext.pharmacyId),
              eq(erpPayments.direction, 'receipt'),
              eq(erpPayments.partyType, 'customer'),
              sql`${erpPayments.status} != 'reversed'`,
              query.branchId ? eq(erpPayments.branchId, query.branchId) : undefined,
              query.cashierUserId ? eq(erpPayments.createdBy, query.cashierUserId) : undefined,
              query.customerId ? eq(erpPayments.partyId, query.customerId) : undefined,
              startDateIso ? sql`${erpPayments.createdAt} >= ${startDateIso}` : undefined,
              endDateIso ? sql`${erpPayments.createdAt} <= ${endDateIso}` : undefined
            )
          );

        receiptRows = await recQuery;
      }

      // Convert all to common SalesLedgerEntry format
      const allEntries: Omit<SalesLedgerEntry, 'runningNetPaisa'>[] = [];

      for (const inv of invoiceRows) {
        allEntries.push({
          id: inv.id,
          date: inv.date,
          type: 'sale',
          documentNumber: inv.invoiceNumber,
          branchId: inv.branchId,
          branchName: inv.branchName || 'Main',
          counterId: inv.counterId,
          counterName: inv.counterName,
          cashierUserId: inv.cashierUserId,
          cashierName: inv.cashierName || 'Cashier',
          partyId: inv.customerId,
          partyName: inv.customerName || 'Walk-in Customer',
          partyPhone: inv.customerPhone,
          paymentMethod: 'Multiple / Cash',
          grossPaisa: inv.subtotalPaisa,
          discountPaisa: inv.discountPaisa,
          taxPaisa: inv.taxPaisa,
          netPaisa: inv.totalPaisa,
        });
      }

      for (const ret of returnRows) {
        allEntries.push({
          id: ret.id,
          date: ret.date,
          type: 'return',
          documentNumber: ret.creditNoteNumber,
          branchId: ret.branchId,
          branchName: ret.branchName || 'Main',
          counterId: ret.counterId,
          counterName: ret.counterName,
          cashierUserId: ret.cashierUserId,
          cashierName: ret.cashierName || 'Cashier',
          partyId: ret.customerId,
          partyName: ret.customerName || 'Walk-in Customer',
          partyPhone: ret.customerPhone,
          paymentMethod: 'Refund',
          grossPaisa: -ret.totalRefundPaisa,
          discountPaisa: 0,
          taxPaisa: 0,
          netPaisa: -ret.totalRefundPaisa,
          notes: ret.reason,
        });
      }

      for (const rec of receiptRows) {
        allEntries.push({
          id: rec.id,
          date: rec.date,
          type: 'receipt',
          documentNumber: rec.paymentNumber,
          branchId: rec.branchId,
          branchName: rec.branchName || 'Main',
          counterId: null,
          counterName: null,
          cashierUserId: rec.cashierUserId,
          cashierName: rec.cashierName || 'Cashier',
          partyId: rec.customerId,
          partyName: rec.customerName || 'Credit Customer',
          partyPhone: rec.customerPhone,
          paymentMethod: rec.paymentMethod,
          grossPaisa: rec.amountPaisa,
          discountPaisa: 0,
          taxPaisa: 0,
          netPaisa: rec.amountPaisa,
          notes: rec.notes,
        });
      }

      // Sort chronologically ascending
      allEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Calculate running cumulative net sales total
      let running = 0;
      let totalGrossSalesPaisa = 0;
      let totalReturnsPaisa = 0;
      let totalReceiptsPaisa = 0;

      const entriesWithRunning: SalesLedgerEntry[] = allEntries.map((e) => {
        if (e.type === 'sale') {
          running += e.netPaisa;
          totalGrossSalesPaisa += e.netPaisa;
        } else if (e.type === 'return') {
          running += e.netPaisa; // e.netPaisa is already negative
          totalReturnsPaisa += Math.abs(e.netPaisa);
        } else if (e.type === 'receipt') {
          totalReceiptsPaisa += e.netPaisa;
        }

        return {
          ...e,
          runningNetPaisa: running,
        };
      });

      const netSalesPaisa = totalGrossSalesPaisa - totalReturnsPaisa;

      return reply.send({
        success: true,
        data: {
          summary: {
            totalGrossSalesPaisa,
            totalReturnsPaisa,
            totalReceiptsPaisa,
            netSalesPaisa,
            totalCount: entriesWithRunning.length,
          },
          entries: entriesWithRunning,
        },
      });
    }
  );
};
