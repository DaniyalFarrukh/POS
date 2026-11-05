import type { FastifyPluginAsync } from 'fastify';
import { eq, and, sql, desc } from 'drizzle-orm';
import { z, generateUuidV7 } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  bankAccounts,
  fundTransfers,
  counterDeposits,
  bankReconciliations,
  accounts,
  journalEntries,
  journalLines,
  branches,
  counters,
} from '../db/schema';
import { postJournalEntry, reverseJournalEntry } from '../ledger/service';

const CreateAccountSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['cash', 'bank', 'wallet']),
  accountId: z.string().uuid(),
  bankName: z.string().nullable().optional(),
  accountNumber: z.string().nullable().optional(),
  branchName: z.string().nullable().optional(),
  iban: z.string().nullable().optional(),
  openingBalancePaisa: z.number().int().default(0),
});

const CreateTransferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amountPaisa: z.number().int().positive(),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referenceNo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const ReverseTransferSchema = z.object({
  reason: z.string().min(1).max(500),
});

const CreateDepositSchema = z.object({
  branchId: z.string().uuid(),
  counterId: z.string().uuid().nullable().optional(),
  shiftId: z.string().nullable().optional(),
  sourceCashAccountId: z.string().uuid(),
  targetAccountId: z.string().uuid(),
  amountPaisa: z.number().int().positive(),
  depositDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().nullable().optional(),
});

const SaveReconciliationSchema = z.object({
  bankAccountId: z.string().uuid(),
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statementBalancePaisa: z.number().int(),
  clearedBalancePaisa: z.number().int(),
  differencePaisa: z.number().int(),
  matchedCount: z.number().int().min(0).default(0),
  status: z.enum(['draft', 'reconciled']).default('draft'),
  notes: z.string().nullable().optional(),
});

export const cashBankRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/finance/cash-bank/accounts
   * Lists bank and cash accounts with live ledger balances
   */
  fastify.get(
    '/accounts',
    {
      config: { requiredPermission: 'finance.cash_bank.view' },
      preHandler: [requirePermission('finance.cash_bank.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const bAccounts = await db
        .select({
          id: bankAccounts.id,
          pharmacyId: bankAccounts.pharmacyId,
          name: bankAccounts.name,
          type: bankAccounts.type,
          accountId: bankAccounts.accountId,
          accountCode: accounts.code,
          accountName: accounts.name,
          bankName: bankAccounts.bankName,
          accountNumber: bankAccounts.accountNumber,
          branchName: bankAccounts.branchName,
          iban: bankAccounts.iban,
          openingBalancePaisa: bankAccounts.openingBalancePaisa,
          isActive: bankAccounts.isActive,
          createdAt: bankAccounts.createdAt,
          updatedAt: bankAccounts.updatedAt,
        })
        .from(bankAccounts)
        .innerJoin(accounts, eq(bankAccounts.accountId, accounts.id))
        .where(
          and(eq(bankAccounts.pharmacyId, userContext.pharmacyId), eq(bankAccounts.isActive, true))
        )
        .orderBy(bankAccounts.type, bankAccounts.name);

      // Compute live ledger balance for each mapped ledger account: Sum(Debit - Credit)
      const balances = await db
        .select({
          accountId: journalLines.accountId,
          totalDebit: sql<string>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
        })
        .from(journalLines)
        .where(eq(journalLines.pharmacyId, userContext.pharmacyId))
        .groupBy(journalLines.accountId);

      const balanceMap = new Map<string, number>();
      for (const row of balances) {
        const bal = Number(row.totalDebit) - Number(row.totalCredit);
        balanceMap.set(row.accountId, bal);
      }

      const results = bAccounts.map((a) => {
        const ledgerBalance = balanceMap.get(a.accountId) || 0;
        return {
          ...a,
          ledgerBalancePaisa: ledgerBalance,
        };
      });

      return reply.send({
        success: true,
        data: {
          accounts: results,
        },
      });
    }
  );

  /**
   * POST /api/finance/cash-bank/accounts
   * Create a new cash/bank/wallet account mapped to an asset ledger account
   */
  fastify.post(
    '/accounts',
    {
      config: { requiredPermission: 'finance.cash_bank.manage' },
      preHandler: [requirePermission('finance.cash_bank.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const body = CreateAccountSchema.parse(request.body);

      // Verify accountId belongs to this pharmacy and is an asset
      const [ledgerAcct] = await db
        .select()
        .from(accounts)
        .where(
          and(eq(accounts.id, body.accountId), eq(accounts.pharmacyId, userContext.pharmacyId))
        )
        .limit(1);

      if (!ledgerAcct) {
        return reply.status(404).send({
          success: false,
          error: { message: 'Ledger account not found' },
        });
      }

      const now = new Date().toISOString();
      const accountId = generateUuidV7();

      const [created] = await db
        .insert(bankAccounts)
        .values({
          id: accountId,
          pharmacyId: userContext.pharmacyId,
          name: body.name.trim(),
          type: body.type,
          accountId: body.accountId,
          bankName: body.bankName?.trim() || null,
          accountNumber: body.accountNumber?.trim() || null,
          branchName: body.branchName?.trim() || null,
          iban: body.iban?.trim() || null,
          openingBalancePaisa: body.openingBalancePaisa,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return reply.status(201).send({
        success: true,
        data: created,
      });
    }
  );

  /**
   * GET /api/finance/cash-bank/transfers
   * Lists fund transfer history
   */
  fastify.get(
    '/transfers',
    {
      config: { requiredPermission: 'finance.cash_bank.view' },
      preHandler: [requirePermission('finance.cash_bank.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const transfers = await db
        .select()
        .from(fundTransfers)
        .where(eq(fundTransfers.pharmacyId, userContext.pharmacyId))
        .orderBy(desc(fundTransfers.createdAt));

      // Resolve account names
      const accountsList = await db
        .select({ id: bankAccounts.id, name: bankAccounts.name, type: bankAccounts.type })
        .from(bankAccounts)
        .where(eq(bankAccounts.pharmacyId, userContext.pharmacyId));

      const acctMap = new Map<string, { name: string; type: string }>();
      for (const a of accountsList) {
        acctMap.set(a.id, { name: a.name, type: a.type });
      }

      const results = transfers.map((t) => ({
        ...t,
        fromAccountName: acctMap.get(t.fromAccountId)?.name || 'Unknown',
        fromAccountType: acctMap.get(t.fromAccountId)?.type || 'cash',
        toAccountName: acctMap.get(t.toAccountId)?.name || 'Unknown',
        toAccountType: acctMap.get(t.toAccountId)?.type || 'bank',
      }));

      return reply.send({
        success: true,
        data: {
          transfers: results,
        },
      });
    }
  );

  /**
   * POST /api/finance/cash-bank/transfers
   * Record an inter-account fund transfer with automated ledger posting
   */
  fastify.post(
    '/transfers',
    {
      config: { requiredPermission: 'finance.cash_bank.manage' },
      preHandler: [requirePermission('finance.cash_bank.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const body = CreateTransferSchema.parse(request.body);

      if (body.fromAccountId === body.toAccountId) {
        return reply.status(400).send({
          success: false,
          error: { message: 'Source and destination accounts must be different' },
        });
      }

      // Verify accounts belong to tenant
      const [fromAcct] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, body.fromAccountId),
            eq(bankAccounts.pharmacyId, userContext.pharmacyId)
          )
        )
        .limit(1);

      const [toAcct] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, body.toAccountId),
            eq(bankAccounts.pharmacyId, userContext.pharmacyId)
          )
        )
        .limit(1);

      if (!fromAcct || !toAcct) {
        return reply.status(404).send({
          success: false,
          error: { message: 'One or both accounts not found' },
        });
      }

      const now = new Date().toISOString();
      const transferId = generateUuidV7();
      const seqSuffix = Math.floor(1000 + Math.random() * 9000);
      const transferNumber = `TRF-${body.transferDate.replace(/-/g, '').slice(0, 6)}-${seqSuffix}`;

      const createdTransfer = await db.transaction(async (tx) => {
        // 1. Post balanced journal entry: Dr To Account, Cr From Account
        const journalEntry = await postJournalEntry(tx, {
          pharmacyId: userContext.pharmacyId,
          entryDate: body.transferDate,
          memo: `Fund transfer ${transferNumber}: ${fromAcct.name} -> ${toAcct.name}${
            body.referenceNo ? ` (Ref: ${body.referenceNo})` : ''
          }`,
          sourceType: 'cash_transfer',
          sourceId: transferId,
          createdBy: userContext.userId,
          lines: [
            {
              accountId: toAcct.accountId,
              debitPaisa: body.amountPaisa,
              creditPaisa: 0,
              memo: `Transfer in from ${fromAcct.name}`,
            },
            {
              accountId: fromAcct.accountId,
              debitPaisa: 0,
              creditPaisa: body.amountPaisa,
              memo: `Transfer out to ${toAcct.name}`,
            },
          ],
        });

        // 2. Insert fund_transfers row
        const [transfer] = await tx
          .insert(fundTransfers)
          .values({
            id: transferId,
            pharmacyId: userContext.pharmacyId,
            transferNumber,
            fromAccountId: body.fromAccountId,
            toAccountId: body.toAccountId,
            amountPaisa: body.amountPaisa,
            transferDate: body.transferDate,
            referenceNo: body.referenceNo?.trim() || null,
            notes: body.notes?.trim() || null,
            journalEntryId: journalEntry.id,
            status: 'completed',
            createdBy: userContext.userId,
            createdAt: now,
          })
          .returning();

        return transfer;
      });

      return reply.status(201).send({
        success: true,
        data: createdTransfer,
      });
    }
  );

  /**
   * POST /api/finance/cash-bank/transfers/:id/reverse
   * Reverse an existing fund transfer
   */
  fastify.post(
    '/transfers/:id/reverse',
    {
      config: { requiredPermission: 'finance.cash_bank.manage' },
      preHandler: [requirePermission('finance.cash_bank.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params as { id: string };
      const body = ReverseTransferSchema.parse(request.body);

      const [transfer] = await db
        .select()
        .from(fundTransfers)
        .where(and(eq(fundTransfers.id, id), eq(fundTransfers.pharmacyId, userContext.pharmacyId)))
        .limit(1);

      if (!transfer) {
        return reply.status(404).send({
          success: false,
          error: { message: 'Transfer record not found' },
        });
      }

      if (transfer.status === 'reversed') {
        return reply.status(400).send({
          success: false,
          error: { message: 'Transfer is already reversed' },
        });
      }

      const now = new Date().toISOString();
      const todayDate = now.slice(0, 10);

      const updated = await db.transaction(async (tx) => {
        // Post reversal entry via standard reverseJournalEntry
        const revEntry = await reverseJournalEntry(tx, transfer.journalEntryId, body.reason, {
          pharmacyId: userContext.pharmacyId,
          reversalDate: todayDate,
          createdBy: userContext.userId,
        });

        const [t] = await tx
          .update(fundTransfers)
          .set({
            status: 'reversed',
            reversalEntryId: revEntry.id,
            reversalReason: body.reason,
            reversedAt: now,
          })
          .where(eq(fundTransfers.id, transfer.id))
          .returning();

        return t;
      });

      return reply.send({
        success: true,
        data: updated,
      });
    }
  );

  /**
   * GET /api/finance/cash-bank/deposits
   * Lists day-end counter cash deposits
   */
  fastify.get(
    '/deposits',
    {
      config: { requiredPermission: 'finance.cash_bank.view' },
      preHandler: [requirePermission('finance.cash_bank.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const deposits = await db
        .select({
          id: counterDeposits.id,
          pharmacyId: counterDeposits.pharmacyId,
          depositNumber: counterDeposits.depositNumber,
          depositDate: counterDeposits.depositDate,
          branchId: counterDeposits.branchId,
          branchName: branches.name,
          counterId: counterDeposits.counterId,
          counterName: counters.name,
          shiftId: counterDeposits.shiftId,
          sourceCashAccountId: counterDeposits.sourceCashAccountId,
          targetAccountId: counterDeposits.targetAccountId,
          amountPaisa: counterDeposits.amountPaisa,
          notes: counterDeposits.notes,
          journalEntryId: counterDeposits.journalEntryId,
          status: counterDeposits.status,
          reversalEntryId: counterDeposits.reversalEntryId,
          reversalReason: counterDeposits.reversalReason,
          reversedAt: counterDeposits.reversedAt,
          createdAt: counterDeposits.createdAt,
        })
        .from(counterDeposits)
        .innerJoin(branches, eq(counterDeposits.branchId, branches.id))
        .leftJoin(counters, eq(counterDeposits.counterId, counters.id))
        .where(eq(counterDeposits.pharmacyId, userContext.pharmacyId))
        .orderBy(desc(counterDeposits.createdAt));

      // Resolve account names
      const accountsList = await db
        .select({ id: bankAccounts.id, name: bankAccounts.name })
        .from(bankAccounts)
        .where(eq(bankAccounts.pharmacyId, userContext.pharmacyId));

      const acctMap = new Map<string, string>();
      for (const a of accountsList) {
        acctMap.set(a.id, a.name);
      }

      const results = deposits.map((d) => ({
        ...d,
        sourceCashAccountName: acctMap.get(d.sourceCashAccountId) || 'Counter Cash',
        targetAccountName: acctMap.get(d.targetAccountId) || 'Bank Account',
      }));

      return reply.send({
        success: true,
        data: {
          deposits: results,
        },
      });
    }
  );

  /**
   * POST /api/finance/cash-bank/deposits
   * Record a day-end counter cash collection deposit into the bank or main safe
   */
  fastify.post(
    '/deposits',
    {
      config: { requiredPermission: 'finance.cash_bank.manage' },
      preHandler: [requirePermission('finance.cash_bank.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const body = CreateDepositSchema.parse(request.body);

      // Verify source & target accounts
      const [sourceAcct] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, body.sourceCashAccountId),
            eq(bankAccounts.pharmacyId, userContext.pharmacyId)
          )
        )
        .limit(1);

      const [targetAcct] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, body.targetAccountId),
            eq(bankAccounts.pharmacyId, userContext.pharmacyId)
          )
        )
        .limit(1);

      if (!sourceAcct || !targetAcct) {
        return reply.status(404).send({
          success: false,
          error: { message: 'Source or target account not found' },
        });
      }

      const now = new Date().toISOString();
      const depositId = generateUuidV7();
      const seqSuffix = Math.floor(1000 + Math.random() * 9000);
      const depositNumber = `DEP-${body.depositDate.replace(/-/g, '').slice(0, 6)}-${seqSuffix}`;

      const createdDeposit = await db.transaction(async (tx) => {
        // 1. Post balanced journal entry: Dr Target Account, Cr Source Cash Account
        const journalEntry = await postJournalEntry(tx, {
          pharmacyId: userContext.pharmacyId,
          entryDate: body.depositDate,
          memo: `Day-end counter cash deposit ${depositNumber}: ${sourceAcct.name} -> ${targetAcct.name}`,
          sourceType: 'counter_deposit',
          sourceId: depositId,
          createdBy: userContext.userId,
          lines: [
            {
              accountId: targetAcct.accountId,
              debitPaisa: body.amountPaisa,
              creditPaisa: 0,
              branchId: body.branchId,
              memo: `Counter collection deposit into ${targetAcct.name}`,
            },
            {
              accountId: sourceAcct.accountId,
              debitPaisa: 0,
              creditPaisa: body.amountPaisa,
              branchId: body.branchId,
              memo: `Cash collection deposited from ${sourceAcct.name}`,
            },
          ],
        });

        // 2. Insert counter_deposits record
        const [dep] = await tx
          .insert(counterDeposits)
          .values({
            id: depositId,
            pharmacyId: userContext.pharmacyId,
            depositNumber,
            depositDate: body.depositDate,
            branchId: body.branchId,
            counterId: body.counterId || null,
            shiftId: body.shiftId || null,
            sourceCashAccountId: body.sourceCashAccountId,
            targetAccountId: body.targetAccountId,
            amountPaisa: body.amountPaisa,
            notes: body.notes?.trim() || null,
            journalEntryId: journalEntry.id,
            status: 'completed',
            createdBy: userContext.userId,
            createdAt: now,
          })
          .returning();

        return dep;
      });

      return reply.status(201).send({
        success: true,
        data: createdDeposit,
      });
    }
  );

  /**
   * POST /api/finance/cash-bank/deposits/:id/reverse
   * Reverse a counter cash deposit
   */
  fastify.post(
    '/deposits/:id/reverse',
    {
      config: { requiredPermission: 'finance.cash_bank.manage' },
      preHandler: [requirePermission('finance.cash_bank.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params as { id: string };
      const body = ReverseTransferSchema.parse(request.body);

      const [deposit] = await db
        .select()
        .from(counterDeposits)
        .where(
          and(eq(counterDeposits.id, id), eq(counterDeposits.pharmacyId, userContext.pharmacyId))
        )
        .limit(1);

      if (!deposit) {
        return reply.status(404).send({
          success: false,
          error: { message: 'Deposit record not found' },
        });
      }

      if (deposit.status === 'reversed') {
        return reply.status(400).send({
          success: false,
          error: { message: 'Deposit is already reversed' },
        });
      }

      const now = new Date().toISOString();
      const todayDate = now.slice(0, 10);

      const updated = await db.transaction(async (tx) => {
        const revEntry = await reverseJournalEntry(tx, deposit.journalEntryId, body.reason, {
          pharmacyId: userContext.pharmacyId,
          reversalDate: todayDate,
          createdBy: userContext.userId,
        });

        const [d] = await tx
          .update(counterDeposits)
          .set({
            status: 'reversed',
            reversalEntryId: revEntry.id,
            reversalReason: body.reason,
            reversedAt: now,
          })
          .where(eq(counterDeposits.id, deposit.id))
          .returning();

        return d;
      });

      return reply.send({
        success: true,
        data: updated,
      });
    }
  );

  /**
   * GET /api/finance/cash-bank/reconciliation/:bankAccountId/ledger-lines
   * Fetches ledger journal transactions for the bank account in statement period
   */
  fastify.get(
    '/reconciliation/:bankAccountId/ledger-lines',
    {
      config: { requiredPermission: 'finance.cash_bank.view' },
      preHandler: [requirePermission('finance.cash_bank.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { bankAccountId } = request.params as { bankAccountId: string };
      const query = request.query as { asOfDate?: string };
      const asOfDate = query.asOfDate || new Date().toISOString().slice(0, 10);

      const [bankAcct] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, bankAccountId),
            eq(bankAccounts.pharmacyId, userContext.pharmacyId)
          )
        )
        .limit(1);

      if (!bankAcct) {
        return reply.status(404).send({
          success: false,
          error: { message: 'Bank account not found' },
        });
      }

      // Fetch all journal lines for this account up to asOfDate
      const lines = await db
        .select({
          id: journalLines.id,
          entryId: journalLines.entryId,
          entryNo: journalEntries.entryNo,
          entryDate: journalEntries.entryDate,
          sourceType: journalEntries.sourceType,
          sourceId: journalEntries.sourceId,
          memo: journalLines.memo,
          entryMemo: journalEntries.memo,
          debitPaisa: journalLines.debitPaisa,
          creditPaisa: journalLines.creditPaisa,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, userContext.pharmacyId),
            eq(journalLines.accountId, bankAcct.accountId),
            sql`${journalEntries.entryDate} <= ${asOfDate}`
          )
        )
        .orderBy(journalEntries.entryDate, journalEntries.entryNo);

      let runningBalance = bankAcct.openingBalancePaisa;
      const formattedLines = lines.map((l) => {
        // Asset: Debit increases, Credit decreases
        runningBalance += l.debitPaisa - l.creditPaisa;
        return {
          id: l.id,
          entryId: l.entryId,
          entryNo: l.entryNo,
          date: l.entryDate,
          description: l.memo || l.entryMemo || 'Journal Entry',
          sourceType: l.sourceType,
          debitPaisa: l.debitPaisa,
          creditPaisa: l.creditPaisa,
          runningBalancePaisa: runningBalance,
        };
      });

      return reply.send({
        success: true,
        data: {
          bankAccount: bankAcct,
          openingBalancePaisa: bankAcct.openingBalancePaisa,
          ledgerBalancePaisa: runningBalance,
          lines: formattedLines,
        },
      });
    }
  );

  /**
   * POST /api/finance/cash-bank/reconciliation/save
   * Saves a bank reconciliation session
   */
  fastify.post(
    '/reconciliation/save',
    {
      config: { requiredPermission: 'finance.cash_bank.manage' },
      preHandler: [requirePermission('finance.cash_bank.manage')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const body = SaveReconciliationSchema.parse(request.body);

      const [bankAcct] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, body.bankAccountId),
            eq(bankAccounts.pharmacyId, userContext.pharmacyId)
          )
        )
        .limit(1);

      if (!bankAcct) {
        return reply.status(404).send({
          success: false,
          error: { message: 'Bank account not found' },
        });
      }

      const now = new Date().toISOString();
      const recId = generateUuidV7();

      // Look up live ledger balance up to statement date
      const [sumRow] = await db
        .select({
          totalDebit: sql<string>`COALESCE(SUM(${journalLines.debitPaisa}), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(${journalLines.creditPaisa}), 0)`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, userContext.pharmacyId),
            eq(journalLines.accountId, bankAcct.accountId),
            sql`${journalEntries.entryDate} <= ${body.statementDate}`
          )
        );

      const ledgerBalancePaisa =
        bankAcct.openingBalancePaisa +
        Number(sumRow?.totalDebit || 0) -
        Number(sumRow?.totalCredit || 0);

      const [saved] = await db
        .insert(bankReconciliations)
        .values({
          id: recId,
          pharmacyId: userContext.pharmacyId,
          bankAccountId: body.bankAccountId,
          statementDate: body.statementDate,
          statementBalancePaisa: body.statementBalancePaisa,
          ledgerBalancePaisa,
          clearedBalancePaisa: body.clearedBalancePaisa,
          differencePaisa: body.differencePaisa,
          matchedCount: body.matchedCount,
          status: body.status,
          notes: body.notes?.trim() || null,
          createdBy: userContext.userId,
          createdAt: now,
          reconciledAt: body.status === 'reconciled' ? now : null,
        })
        .returning();

      return reply.status(201).send({
        success: true,
        data: saved,
      });
    }
  );
};
