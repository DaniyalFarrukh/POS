import type { FastifyPluginAsync } from 'fastify';
import { eq, and, sql, desc, asc, ilike, or } from 'drizzle-orm';
import { z, generateUuidV7 } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import {
  erpPayments,
  paymentAllocations,
  customers,
  suppliers,
  invoices,
  journalEntries,
  journalLines,
  purchaseOrders,
  branches,
} from '../db/schema';
import { postFinancialPaymentCompleted, toKarachiBusinessDate } from '../ledger/posting-engine';
import { postJournalEntry, reverseJournalEntry } from '../ledger/service';
import { getPharmacyAccountMap } from '../ledger/coa-seed';
import { insertChangeLog } from '../sync/change-log';

const PaymentAllocationInputSchema = z.object({
  documentType: z.enum(['invoice', 'purchase']),
  documentId: z.string().uuid(),
  documentNumber: z.string().min(1),
  allocatedPaisa: z.number().int().min(1),
});

const CreatePaymentBodySchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  direction: z.enum(['receipt', 'payment']),
  partyType: z.enum(['customer', 'supplier']),
  partyId: z.string().uuid(),
  method: z.enum(['cash', 'bank', 'wallet', 'cheque']),
  amountPaisa: z.number().int().min(1),
  paymentDate: z.string().min(1),
  chequeNumber: z.string().nullable().optional(),
  chequeDate: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  chequeStatus: z.enum(['pending', 'cleared', 'bounced']).nullable().optional(),
  referenceNo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  allocations: z.array(PaymentAllocationInputSchema).optional().default([]),
});

const ReverseBodySchema = z.object({
  reversalReason: z.string().min(1),
});

const BounceBodySchema = z.object({
  bounceReason: z.string().min(1),
});

const CreateCustomerBodySchema = z.object({
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().nullable().optional(),
  creditLimitPaisa: z.number().int().min(0).optional().default(0),
  openingBalancePaisa: z.number().int().min(0).optional().default(0),
});

export const paymentRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/finance/payments/unpaid-documents
   * Fetches open documents (credit invoices for customers, purchase bills for suppliers)
   * with calculated balance due.
   */
  fastify.get(
    '/payments/unpaid-documents',
    {
      config: { requiredPermission: 'finance.payment.view' },
      preHandler: [requirePermission('finance.payment.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const query = request.query as { partyType?: string; partyId?: string };

      if (!query.partyType || !query.partyId) {
        return reply.status(400).send({
          success: false,
          message: 'partyType and partyId query parameters are required',
        });
      }

      if (query.partyType === 'customer') {
        // 1. Fetch finalized invoices for this customer in this pharmacy
        const customerInvoices = await db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            totalPaisa: invoices.totalPaisa,
            createdAt: invoices.createdAt,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.pharmacyId, userContext.pharmacyId),
              eq(invoices.customerId, query.partyId),
              eq(invoices.status, 'finalized')
            )
          )
          .orderBy(asc(invoices.createdAt));

        const resultDocs = [];
        for (const inv of customerInvoices) {
          // Calculate allocated paisa from non-reversed payments
          const allocRecords = await db
            .select({
              allocatedPaisa: paymentAllocations.allocatedPaisa,
            })
            .from(paymentAllocations)
            .innerJoin(erpPayments, eq(paymentAllocations.paymentId, erpPayments.id))
            .where(
              and(
                eq(paymentAllocations.pharmacyId, userContext.pharmacyId),
                eq(paymentAllocations.documentType, 'invoice'),
                eq(paymentAllocations.documentId, inv.id),
                sql`${erpPayments.status} != 'reversed'`
              )
            );

          const allocatedPaisa = allocRecords.reduce((sum, a) => sum + a.allocatedPaisa, 0);
          const balanceDuePaisa = inv.totalPaisa - allocatedPaisa;

          if (balanceDuePaisa > 0) {
            resultDocs.push({
              id: inv.id,
              documentType: 'invoice',
              documentNumber: inv.invoiceNumber,
              totalPaisa: inv.totalPaisa,
              allocatedPaisa,
              balanceDuePaisa,
              date: inv.createdAt.slice(0, 10),
            });
          }
        }

        return reply.send({
          success: true,
          data: {
            documents: resultDocs,
          },
        });
      }

      if (query.partyType === 'supplier') {
        // 2. Fetch purchase orders / bills for this supplier
        const seenDocIds = new Set<string>();
        const resultDocs = [];

        // Check purchaseOrders table
        const pos = await db
          .select()
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.pharmacyId, userContext.pharmacyId),
              eq(purchaseOrders.supplierId, query.partyId),
              eq(purchaseOrders.status, 'received')
            )
          );

        for (const po of pos) {
          seenDocIds.add(po.id);
          const allocRecords = await db
            .select({
              allocatedPaisa: paymentAllocations.allocatedPaisa,
            })
            .from(paymentAllocations)
            .innerJoin(erpPayments, eq(paymentAllocations.paymentId, erpPayments.id))
            .where(
              and(
                eq(paymentAllocations.pharmacyId, userContext.pharmacyId),
                eq(paymentAllocations.documentType, 'purchase'),
                eq(paymentAllocations.documentId, po.id),
                sql`${erpPayments.status} != 'reversed'`
              )
            );

          const allocatedPaisa = allocRecords.reduce((sum, a) => sum + a.allocatedPaisa, 0);
          const balanceDuePaisa = po.totalExpectedCostPaisa - allocatedPaisa;

          if (balanceDuePaisa > 0) {
            resultDocs.push({
              id: po.id,
              documentType: 'purchase',
              documentNumber: po.poNumber,
              totalPaisa: po.totalExpectedCostPaisa,
              allocatedPaisa,
              balanceDuePaisa,
              date: po.createdAt.slice(0, 10),
            });
          }
        }

        // Also check AP journal lines with sourceType in ('purchase.received', 'purchase_order')
        const apLines = await db
          .select({
            entryId: journalEntries.id,
            sourceId: journalEntries.sourceId,
            memo: journalEntries.memo,
            entryDate: journalEntries.entryDate,
            creditPaisa: journalLines.creditPaisa,
          })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
          .where(
            and(
              eq(journalLines.pharmacyId, userContext.pharmacyId),
              eq(journalLines.partyType, 'supplier'),
              eq(journalLines.partyId, query.partyId),
              sql`${journalLines.creditPaisa} > 0`,
              sql`${journalEntries.sourceType} IN ('purchase.received', 'purchase_order')`
            )
          );

        for (const line of apLines) {
          const docId = line.sourceId || line.entryId;
          if (seenDocIds.has(docId)) continue;
          seenDocIds.add(docId);

          const allocRecords = await db
            .select({
              allocatedPaisa: paymentAllocations.allocatedPaisa,
            })
            .from(paymentAllocations)
            .innerJoin(erpPayments, eq(paymentAllocations.paymentId, erpPayments.id))
            .where(
              and(
                eq(paymentAllocations.pharmacyId, userContext.pharmacyId),
                eq(paymentAllocations.documentType, 'purchase'),
                eq(paymentAllocations.documentId, docId),
                sql`${erpPayments.status} != 'reversed'`
              )
            );

          const allocatedPaisa = allocRecords.reduce((sum, a) => sum + a.allocatedPaisa, 0);
          const balanceDuePaisa = line.creditPaisa - allocatedPaisa;

          if (balanceDuePaisa > 0) {
            const docNum =
              line.memo?.match(/GRN-[\w-]+|PO-[\w-]+/)?.[0] || 'BILL-' + docId.slice(0, 8);
            resultDocs.push({
              id: docId,
              documentType: 'purchase',
              documentNumber: docNum,
              totalPaisa: line.creditPaisa,
              allocatedPaisa,
              balanceDuePaisa,
              date: line.entryDate,
            });
          }
        }

        return reply.send({
          success: true,
          data: {
            documents: resultDocs,
          },
        });
      }

      return reply.status(400).send({
        success: false,
        message: 'Invalid partyType: must be customer or supplier',
      });
    }
  );

  /**
   * GET /api/finance/payments
   * Paginated payments list with KPI cards and filtering.
   */
  fastify.get(
    '/payments',
    {
      config: { requiredPermission: 'finance.payment.view' },
      preHandler: [requirePermission('finance.payment.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const q = request.query as Record<string, string | undefined>;

      const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize || '20', 10) || 20));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(erpPayments.pharmacyId, userContext.pharmacyId)];

      if (q.direction && (q.direction === 'receipt' || q.direction === 'payment')) {
        conditions.push(eq(erpPayments.direction, q.direction));
      }
      if (q.partyType && (q.partyType === 'customer' || q.partyType === 'supplier')) {
        conditions.push(eq(erpPayments.partyType, q.partyType));
      }
      if (q.partyId) {
        conditions.push(eq(erpPayments.partyId, q.partyId));
      }
      if (q.method && ['cash', 'bank', 'wallet', 'cheque'].includes(q.method)) {
        conditions.push(eq(erpPayments.method, q.method as 'cash' | 'bank' | 'wallet' | 'cheque'));
      }
      if (q.chequeStatus && ['pending', 'cleared', 'bounced'].includes(q.chequeStatus)) {
        conditions.push(
          eq(erpPayments.chequeStatus, q.chequeStatus as 'pending' | 'cleared' | 'bounced')
        );
      }
      if (q.status && (q.status === 'posted' || q.status === 'reversed')) {
        conditions.push(eq(erpPayments.status, q.status));
      }
      if (q.startDate) {
        conditions.push(sql`${erpPayments.paymentDate} >= ${q.startDate}`);
      }
      if (q.endDate) {
        conditions.push(sql`${erpPayments.paymentDate} <= ${q.endDate}`);
      }
      if (q.search) {
        const searchPattern = `%${q.search.trim()}%`;
        conditions.push(
          or(
            ilike(erpPayments.paymentNumber, searchPattern),
            ilike(erpPayments.chequeNumber, searchPattern),
            ilike(erpPayments.bankName, searchPattern),
            ilike(erpPayments.referenceNo, searchPattern),
            ilike(erpPayments.notes, searchPattern)
          )!
        );
      }

      const whereClause = and(...conditions);

      // Query paginated items
      const items = await db
        .select()
        .from(erpPayments)
        .where(whereClause)
        .orderBy(desc(erpPayments.paymentDate), desc(erpPayments.createdAt))
        .limit(pageSize)
        .offset(offset);

      // Total count
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(erpPayments)
        .where(whereClause);
      const total = countResult?.count ?? 0;

      // KPIs calculation across this pharmacy
      const allPayments = await db
        .select({
          direction: erpPayments.direction,
          method: erpPayments.method,
          chequeStatus: erpPayments.chequeStatus,
          status: erpPayments.status,
          amountPaisa: erpPayments.amountPaisa,
        })
        .from(erpPayments)
        .where(eq(erpPayments.pharmacyId, userContext.pharmacyId));

      let totalReceiptsPaisa = 0;
      let totalPaymentsPaisa = 0;
      let pendingChequesCount = 0;
      let pendingChequesValuePaisa = 0;

      for (const p of allPayments) {
        if (p.status !== 'reversed') {
          if (p.direction === 'receipt') {
            totalReceiptsPaisa += p.amountPaisa;
          } else if (p.direction === 'payment') {
            totalPaymentsPaisa += p.amountPaisa;
          }

          if (p.method === 'cheque' && p.chequeStatus === 'pending') {
            pendingChequesCount += 1;
            pendingChequesValuePaisa += p.amountPaisa;
          }
        }
      }

      const netCashFlowPaisa = totalReceiptsPaisa - totalPaymentsPaisa;

      return reply.send({
        success: true,
        data: {
          items,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
          kpis: {
            totalReceiptsPaisa,
            totalPaymentsPaisa,
            netCashFlowPaisa,
            pendingChequesCount,
            pendingChequesValuePaisa,
          },
        },
      });
    }
  );

  /**
   * GET /api/finance/payments/:id
   * Payment details with allocations and journal lines.
   */
  fastify.get(
    '/payments/:id',
    {
      config: { requiredPermission: 'finance.payment.view' },
      preHandler: [requirePermission('finance.payment.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params as { id: string };

      const [payment] = await db
        .select()
        .from(erpPayments)
        .where(and(eq(erpPayments.id, id), eq(erpPayments.pharmacyId, userContext.pharmacyId)))
        .limit(1);

      if (!payment) {
        return reply.status(404).send({
          success: false,
          message: 'Payment not found',
        });
      }

      const allocations = await db
        .select()
        .from(paymentAllocations)
        .where(
          and(
            eq(paymentAllocations.paymentId, id),
            eq(paymentAllocations.pharmacyId, userContext.pharmacyId)
          )
        );

      let journalLinesList: unknown[] = [];
      if (payment.journalEntryId) {
        journalLinesList = await db
          .select()
          .from(journalLines)
          .where(
            and(
              eq(journalLines.entryId, payment.journalEntryId),
              eq(journalLines.pharmacyId, userContext.pharmacyId)
            )
          )
          .orderBy(asc(journalLines.id));
      }

      let partyName = '';
      if (payment.partyType === 'customer' && payment.partyId) {
        const [cust] = await db
          .select({ name: customers.name })
          .from(customers)
          .where(eq(customers.id, payment.partyId))
          .limit(1);
        partyName = cust?.name || '';
      } else if (payment.partyType === 'supplier' && payment.partyId) {
        const [sup] = await db
          .select({ name: suppliers.name })
          .from(suppliers)
          .where(eq(suppliers.id, payment.partyId))
          .limit(1);
        partyName = sup?.name || '';
      }

      return reply.send({
        success: true,
        data: {
          ...payment,
          partyName,
          allocations,
          journalLines: journalLinesList,
        },
      });
    }
  );

  /**
   * POST /api/finance/payments
   * Record a customer receipt or supplier payment with allocation and automatic ledger posting.
   */
  fastify.post(
    '/payments',
    {
      config: { requiredPermission: 'finance.payment.create' },
      preHandler: [requirePermission('finance.payment.create')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = CreatePaymentBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          message: parsed.error.issues[0]?.message || 'Invalid payment request',
        });
      }

      const body = parsed.data;

      // Validate Branch
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
            message: 'No branch found for this pharmacy',
          });
        }
        targetBranchId = firstBranch.id;
      }

      // Validate Party
      let partyName = '';
      if (body.partyType === 'customer') {
        const [cust] = await db
          .select()
          .from(customers)
          .where(
            and(eq(customers.id, body.partyId), eq(customers.pharmacyId, userContext.pharmacyId))
          )
          .limit(1);
        if (!cust) {
          return reply.status(404).send({
            success: false,
            message: 'Customer not found or belongs to another pharmacy',
          });
        }
        partyName = cust.name;
      } else {
        const [sup] = await db
          .select()
          .from(suppliers)
          .where(
            and(eq(suppliers.id, body.partyId), eq(suppliers.pharmacyId, userContext.pharmacyId))
          )
          .limit(1);
        if (!sup) {
          return reply.status(404).send({
            success: false,
            message: 'Supplier not found or belongs to another pharmacy',
          });
        }
        partyName = sup.name;
      }

      // Validate Allocation Sum
      const totalAllocatedPaisa = body.allocations.reduce((sum, a) => sum + a.allocatedPaisa, 0);
      if (totalAllocatedPaisa > body.amountPaisa) {
        return reply.status(400).send({
          success: false,
          message: 'Total allocated amount cannot exceed total payment amount',
        });
      }
      const advancePaisa = body.amountPaisa - totalAllocatedPaisa;

      const paymentId = generateUuidV7();
      const prefix = body.direction === 'receipt' ? 'RCP' : 'PMT';
      const randNum = Math.floor(100000 + Math.random() * 900000);
      const paymentNumber = `${prefix}-${randNum}`;

      const nowIso = new Date().toISOString();
      const dateOnly = body.paymentDate.slice(0, 10);

      // Execute in Transaction
      const result = await db.transaction(async (tx) => {
        // 1. Post to GL
        const journal = await postFinancialPaymentCompleted(tx, {
          paymentId,
          paymentNumber,
          pharmacyId: userContext.pharmacyId,
          branchId: targetBranchId,
          paymentDate: dateOnly,
          direction: body.direction,
          partyType: body.partyType,
          partyId: body.partyId,
          partyName,
          method: body.method,
          amountPaisa: body.amountPaisa,
          allocatedPaisa: totalAllocatedPaisa,
          advancePaisa,
          notes: body.notes,
          createdBy: userContext.userId,
        });

        // 2. Insert Payment Record
        const [createdPayment] = await tx
          .insert(erpPayments)
          .values({
            id: paymentId,
            pharmacyId: userContext.pharmacyId,
            branchId: targetBranchId,
            paymentNumber,
            paymentDate: dateOnly,
            direction: body.direction,
            partyType: body.partyType,
            partyId: body.partyId,
            method: body.method,
            amountPaisa: body.amountPaisa,
            allocatedPaisa: totalAllocatedPaisa,
            advancePaisa,
            chequeNumber: body.chequeNumber,
            chequeDate: body.chequeDate,
            bankName: body.bankName,
            chequeStatus: body.method === 'cheque' ? body.chequeStatus || 'pending' : null,
            status: 'posted',
            journalEntryId: journal.id,
            referenceNo: body.referenceNo,
            notes: body.notes,
            createdBy: userContext.userId,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .returning();

        // 3. Insert Allocations (verifying each document belongs to this pharmacy)
        const createdAllocations = [];
        for (const alloc of body.allocations) {
          if (alloc.documentType === 'invoice') {
            const [inv] = await tx
              .select({ id: invoices.id })
              .from(invoices)
              .where(
                and(
                  eq(invoices.id, alloc.documentId),
                  eq(invoices.pharmacyId, userContext.pharmacyId)
                )
              )
              .limit(1);
            if (!inv) {
              throw Object.assign(new Error('Allocated invoice not found in this pharmacy'), {
                statusCode: 404,
              });
            }
          } else if (alloc.documentType === 'purchase') {
            const [po] = await tx
              .select({ id: purchaseOrders.id })
              .from(purchaseOrders)
              .where(
                and(
                  eq(purchaseOrders.id, alloc.documentId),
                  eq(purchaseOrders.pharmacyId, userContext.pharmacyId)
                )
              )
              .limit(1);
            const [je] = !po
              ? await tx
                  .select({ id: journalEntries.id })
                  .from(journalEntries)
                  .where(
                    and(
                      or(
                        eq(journalEntries.id, alloc.documentId),
                        eq(journalEntries.sourceId, alloc.documentId)
                      ),
                      eq(journalEntries.pharmacyId, userContext.pharmacyId)
                    )
                  )
                  .limit(1)
              : [po];
            if (!je) {
              throw Object.assign(new Error('Allocated purchase not found in this pharmacy'), {
                statusCode: 404,
              });
            }
          }

          const allocId = generateUuidV7();
          const [inserted] = await tx
            .insert(paymentAllocations)
            .values({
              id: allocId,
              pharmacyId: userContext.pharmacyId,
              paymentId,
              documentType: alloc.documentType,
              documentId: alloc.documentId,
              documentNumber: alloc.documentNumber,
              allocatedPaisa: alloc.allocatedPaisa,
              createdAt: nowIso,
            })
            .returning();
          createdAllocations.push(inserted);
        }

        return {
          ...createdPayment,
          partyName,
          allocations: createdAllocations,
        };
      });

      return reply.status(201).send({
        success: true,
        data: result,
      });
    }
  );

  /**
   * POST /api/finance/payments/:id/clear-cheque
   * Clears a pending cheque.
   */
  fastify.post(
    '/payments/:id/clear-cheque',
    {
      config: { requiredPermission: 'finance.payment.create' },
      preHandler: [requirePermission('finance.payment.create')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params as { id: string };

      const [payment] = await db
        .select()
        .from(erpPayments)
        .where(and(eq(erpPayments.id, id), eq(erpPayments.pharmacyId, userContext.pharmacyId)))
        .limit(1);

      if (!payment) {
        return reply.status(404).send({
          success: false,
          message: 'Payment not found',
        });
      }

      if (payment.status === 'reversed') {
        return reply.status(400).send({
          success: false,
          message: 'Cannot clear a reversed payment',
        });
      }

      const [updated] = await db
        .update(erpPayments)
        .set({
          chequeStatus: 'cleared',
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(erpPayments.id, id), eq(erpPayments.pharmacyId, userContext.pharmacyId)))
        .returning();

      return reply.send({
        success: true,
        data: updated,
      });
    }
  );

  /**
   * POST /api/finance/payments/:id/bounce-cheque
   * Bounces a cheque and posts immutable reversing journal entry.
   */
  fastify.post(
    '/payments/:id/bounce-cheque',
    {
      config: { requiredPermission: 'finance.payment.create' },
      preHandler: [requirePermission('finance.payment.create')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params as { id: string };

      const parsed = BounceBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          message: parsed.error.issues[0]?.message || 'Bounce reason is required',
        });
      }

      const [payment] = await db
        .select()
        .from(erpPayments)
        .where(and(eq(erpPayments.id, id), eq(erpPayments.pharmacyId, userContext.pharmacyId)))
        .limit(1);

      if (!payment) {
        return reply.status(404).send({
          success: false,
          message: 'Payment not found',
        });
      }

      if (payment.status === 'reversed') {
        return reply.status(400).send({
          success: false,
          message: 'Payment is already reversed',
        });
      }

      const nowIso = new Date().toISOString();

      const updated = await db.transaction(async (tx) => {
        // Reverse the original journal entry
        let revEntryId: string | null = null;
        if (payment.journalEntryId) {
          const rev = await reverseJournalEntry(
            tx,
            payment.journalEntryId,
            `Cheque Bounced: ${parsed.data.bounceReason}`,
            {
              pharmacyId: userContext.pharmacyId,
            }
          );
          revEntryId = rev.id;
        }

        const [u] = await tx
          .update(erpPayments)
          .set({
            chequeStatus: 'bounced',
            status: 'reversed',
            bounceReason: parsed.data.bounceReason,
            bouncedAt: nowIso,
            reversalEntryId: revEntryId,
            reversalReason: `Cheque Bounced: ${parsed.data.bounceReason}`,
            reversedAt: nowIso,
            updatedAt: nowIso,
          })
          .where(and(eq(erpPayments.id, id), eq(erpPayments.pharmacyId, userContext.pharmacyId)))
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
   * POST /api/finance/payments/:id/reverse
   * Reverses a completed payment and posts immutable reversing journal entry.
   */
  fastify.post(
    '/payments/:id/reverse',
    {
      config: { requiredPermission: 'finance.payment.create' },
      preHandler: [requirePermission('finance.payment.create')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const { id } = request.params as { id: string };

      const parsed = ReverseBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          message: parsed.error.issues[0]?.message || 'Reversal reason is required',
        });
      }

      const [payment] = await db
        .select()
        .from(erpPayments)
        .where(and(eq(erpPayments.id, id), eq(erpPayments.pharmacyId, userContext.pharmacyId)))
        .limit(1);

      if (!payment) {
        return reply.status(404).send({
          success: false,
          message: 'Payment not found',
        });
      }

      if (payment.status === 'reversed') {
        return reply.status(400).send({
          success: false,
          message: 'Payment is already reversed',
        });
      }

      const nowIso = new Date().toISOString();

      const updated = await db.transaction(async (tx) => {
        let revEntryId: string | null = null;
        if (payment.journalEntryId) {
          const rev = await reverseJournalEntry(
            tx,
            payment.journalEntryId,
            parsed.data.reversalReason,
            {
              pharmacyId: userContext.pharmacyId,
            }
          );
          revEntryId = rev.id;
        }

        const [u] = await tx
          .update(erpPayments)
          .set({
            status: 'reversed',
            reversalEntryId: revEntryId,
            reversalReason: parsed.data.reversalReason,
            reversedAt: nowIso,
            updatedAt: nowIso,
          })
          .where(and(eq(erpPayments.id, id), eq(erpPayments.pharmacyId, userContext.pharmacyId)))
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
   * GET /api/finance/customers
   * List customers with pagination and optional search.
   */
  fastify.get(
    '/customers',
    {
      config: { requiredPermission: 'finance.payment.view' },
      preHandler: [requirePermission('finance.payment.view')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();
      const q = request.query as { search?: string; page?: string; pageSize?: string };

      const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize || '50', 10) || 50));
      const offset = (page - 1) * pageSize;

      const conditions = [
        eq(customers.pharmacyId, userContext.pharmacyId),
        eq(customers.isActive, true),
      ];

      if (q.search) {
        const searchPattern = `%${q.search.trim()}%`;
        conditions.push(
          or(
            ilike(customers.name, searchPattern),
            ilike(customers.phone, searchPattern),
            ilike(customers.email, searchPattern)
          )!
        );
      }

      const items = await db
        .select()
        .from(customers)
        .where(and(...conditions))
        .orderBy(asc(customers.name))
        .limit(pageSize)
        .offset(offset);

      return reply.send({
        success: true,
        data: items,
      });
    }
  );

  /**
   * POST /api/finance/customers
   * Create a new customer for credit invoicing and receipt tracking.
   */
  fastify.post(
    '/customers',
    {
      config: { requiredPermission: 'finance.payment.create' },
      preHandler: [requirePermission('finance.payment.create')],
    },
    async (request, reply) => {
      const userContext = request.userContext!;
      const db = request.server.db || getDb();

      const parsed = CreateCustomerBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          message: parsed.error.issues[0]?.message || 'Invalid customer data',
        });
      }

      const body = parsed.data;
      const nowIso = new Date().toISOString();
      const customerId = generateUuidV7();

      const created = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(customers)
          .values({
            id: customerId,
            pharmacyId: userContext.pharmacyId,
            name: body.name,
            phone: body.phone,
            email: body.email,
            address: body.address,
            creditLimitPaisa: body.creditLimitPaisa,
            openingBalancePaisa: body.openingBalancePaisa,
            isActive: true,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .returning();

        if (body.openingBalancePaisa > 0) {
          const accountMap = await getPharmacyAccountMap(tx, userContext.pharmacyId);
          const entryDate = toKarachiBusinessDate(nowIso);
          await postJournalEntry(tx, {
            pharmacyId: userContext.pharmacyId,
            entryDate,
            sourceType: 'customer_opening_balance',
            sourceId: customerId,
            memo: `Customer opening balance: ${body.name}`,
            createdBy: userContext.userId,
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

        await insertChangeLog(tx, {
          pharmacyId: userContext.pharmacyId,
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
            isActive: inserted!.isActive,
            createdAt: nowIso,
          },
          createdAt: nowIso,
        });

        return inserted;
      });

      return reply.status(201).send({
        success: true,
        data: created,
      });
    }
  );
};
