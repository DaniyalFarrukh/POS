import type { FastifyPluginAsync } from 'fastify';
import { z } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  getCashFlow,
  getGeneralLedgerSummary,
  getAccountLedgerDetail,
} from '../ledger/financial-reports';

const ReportQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD')
    .optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD')
    .optional(),
  branchId: z.string().uuid().optional(),
  compareWithPrevious: z
    .union([z.boolean(), z.string().transform((val) => val === 'true')])
    .optional(),
});

function resolveDateRange(query: z.infer<typeof ReportQuerySchema>): {
  startDate: string;
  endDate: string;
  branchId?: string | null;
  compareWithPrevious: boolean;
} {
  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = `${today.slice(0, 7)}-01`;

  const startDate = query.startDate || query.from || startOfMonth;
  const endDate = query.endDate || query.to || today;

  return {
    startDate,
    endDate,
    branchId: query.branchId || null,
    compareWithPrevious: Boolean(query.compareWithPrevious),
  };
}

export const financialReportsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/finance/reports/trial-balance
   * Trial Balance derived strictly from journal lines with optional comparison.
   */
  fastify.get(
    '/trial-balance',
    {
      config: { requiredPermission: 'finance.reports.view' },
      preHandler: [requirePermission('finance.reports.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const parsed = ReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { message: parsed.error.issues[0]?.message || 'Invalid query parameters' },
        });
      }

      const db = request.server.db || getDb();
      const range = resolveDateRange(parsed.data);

      try {
        const report = await getTrialBalance(db, userContext.pharmacyId, range);
        return reply.send({
          success: true,
          data: {
            ...report,
            accounts: report.rows,
            summary: {
              isBalanced: report.isBalanced,
              totalClosingDebitPaisa: report.totalClosingDebitPaisa,
              totalClosingCreditPaisa: report.totalClosingCreditPaisa,
            },
          },
          ...report,
          items: report.rows,
          accounts: report.rows,
          pharmacyId: userContext.pharmacyId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate trial balance';
        const isNotFound = /not found|another pharmacy/i.test(message);
        return reply.status(isNotFound ? 404 : 400).send({
          success: false,
          error: { message },
        });
      }
    }
  );

  /**
   * GET /api/finance/reports/profit-loss
   * Profit & Loss statement derived strictly from revenue, COGS, and operating expense journal lines.
   */
  fastify.get(
    '/profit-loss',
    {
      config: { requiredPermission: 'finance.reports.view' },
      preHandler: [requirePermission('finance.reports.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const parsed = ReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { message: parsed.error.issues[0]?.message || 'Invalid query parameters' },
        });
      }

      const db = request.server.db || getDb();
      const range = resolveDateRange(parsed.data);

      try {
        const report = await getProfitAndLoss(db, userContext.pharmacyId, range);
        return reply.send({
          success: true,
          data: report,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate profit & loss';
        const isNotFound = /not found|another pharmacy/i.test(message);
        return reply.status(isNotFound ? 404 : 400).send({
          success: false,
          error: { message },
        });
      }
    }
  );

  /**
   * GET /api/finance/reports/balance-sheet
   * Balance Sheet where Assets = Liabilities + Equity + Current Period Profit (difference = 0).
   */
  fastify.get(
    '/balance-sheet',
    {
      config: { requiredPermission: 'finance.reports.view' },
      preHandler: [requirePermission('finance.reports.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const parsed = ReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { message: parsed.error.issues[0]?.message || 'Invalid query parameters' },
        });
      }

      const db = request.server.db || getDb();
      const range = resolveDateRange(parsed.data);

      try {
        const report = await getBalanceSheet(db, userContext.pharmacyId, range);
        return reply.send({
          success: true,
          data: report,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate balance sheet';
        const isNotFound = /not found|another pharmacy/i.test(message);
        return reply.status(isNotFound ? 404 : 400).send({
          success: false,
          error: { message },
        });
      }
    }
  );

  /**
   * GET /api/finance/reports/cash-flow
   * Simple Cash Flow statement derived from Cash & Bank account movements.
   */
  fastify.get(
    '/cash-flow',
    {
      config: { requiredPermission: 'finance.reports.view' },
      preHandler: [requirePermission('finance.reports.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const parsed = ReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { message: parsed.error.issues[0]?.message || 'Invalid query parameters' },
        });
      }

      const db = request.server.db || getDb();
      const range = resolveDateRange(parsed.data);

      try {
        const report = await getCashFlow(db, userContext.pharmacyId, range);
        return reply.send({
          success: true,
          data: report,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate cash flow';
        const isNotFound = /not found|another pharmacy/i.test(message);
        return reply.status(isNotFound ? 404 : 400).send({
          success: false,
          error: { message },
        });
      }
    }
  );

  /**
   * GET /api/finance/reports/general-ledger
   * General Ledger summary across all accounts.
   */
  fastify.get(
    '/general-ledger',
    {
      config: { requiredPermission: 'finance.reports.view' },
      preHandler: [requirePermission('finance.reports.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const parsed = ReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { message: parsed.error.issues[0]?.message || 'Invalid query parameters' },
        });
      }

      const db = request.server.db || getDb();
      const range = resolveDateRange(parsed.data);

      try {
        const report = await getGeneralLedgerSummary(db, userContext.pharmacyId, range);
        return reply.send({
          success: true,
          data: report,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load general ledger';
        const isNotFound = /not found|another pharmacy/i.test(message);
        return reply.status(isNotFound ? 404 : 400).send({
          success: false,
          error: { message },
        });
      }
    }
  );

  /**
   * GET /api/finance/reports/general-ledger/:accountId
   * Detailed chronological movements for a single account.
   */
  fastify.get<{ Params: { accountId: string } }>(
    '/general-ledger/:accountId',
    {
      config: { requiredPermission: 'finance.reports.view' },
      preHandler: [requirePermission('finance.reports.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const { accountId } = request.params;
      if (!accountId) {
        return reply.status(400).send({
          success: false,
          error: { message: 'accountId parameter is required' },
        });
      }

      const parsed = ReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { message: parsed.error.issues[0]?.message || 'Invalid query parameters' },
        });
      }

      const db = request.server.db || getDb();
      const range = resolveDateRange(parsed.data);

      try {
        const detail = await getAccountLedgerDetail(db, userContext.pharmacyId, accountId, range);
        return reply.send({
          success: true,
          data: detail,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load account ledger details';
        const isNotFound = /not found|another pharmacy/i.test(message);
        return reply.status(isNotFound ? 404 : 400).send({
          success: false,
          error: { message },
        });
      }
    }
  );
};
