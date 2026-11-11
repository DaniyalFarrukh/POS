import type { FastifyPluginAsync } from 'fastify';
import { eq, and, desc, asc, ilike, or, inArray } from 'drizzle-orm';
import { z, generateUuidV7 } from '@pos/shared';
import { requirePermission } from '../auth/user-auth';
import { getDb } from '../db';
import { suppliers, journalEntries, journalLines, fiscalPeriods } from '../db/schema';
import { getPharmacyAccountMap } from '../ledger/coa-seed';
import { postJournalEntry } from '../ledger/service';
import { insertChangeLog } from '../sync/change-log';

const CreateSupplierSchema = z.object({
  name: z.string().trim().min(1, 'Supplier name is required'),
  contactPerson: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().email('Invalid email address').optional().nullable().or(z.literal('')),
  address: z.string().trim().optional().nullable(),
  taxNumber: z.string().trim().optional().nullable(),
  paymentTermsDays: z
    .number()
    .int('Payment terms must be an integer')
    .nonnegative('Payment terms cannot be negative')
    .default(30),
  creditLimitPaisa: z
    .number()
    .int('Credit limit must be an integer paisa')
    .nonnegative('Credit limit cannot be negative')
    .default(0),
  openingBalancePaisa: z
    .number()
    .int('Opening balance must be an integer paisa')
    .nonnegative('Opening balance cannot be negative')
    .default(0),
});

const UpdateSupplierSchema = z.object({
  name: z.string().trim().min(1, 'Supplier name is required').optional(),
  contactPerson: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().email('Invalid email address').optional().nullable().or(z.literal('')),
  address: z.string().trim().optional().nullable(),
  taxNumber: z.string().trim().optional().nullable(),
  paymentTermsDays: z
    .number()
    .int('Payment terms must be an integer')
    .nonnegative('Payment terms cannot be negative')
    .optional(),
  creditLimitPaisa: z
    .number()
    .int('Credit limit must be an integer paisa')
    .nonnegative('Credit limit cannot be negative')
    .optional(),
  isActive: z.boolean().optional(),
});

const MergeSuppliersSchema = z.object({
  targetSupplierId: z.string().uuid(),
  sourceSupplierId: z.string().uuid(),
});

function normalizePhone(p?: string | null): string {
  if (!p) return '';
  return p.replace(/[\s\-+()]/g, '');
}

function normalizeName(n: string): string {
  return n
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export const supplierRoutes: FastifyPluginAsync = async (app) => {
  // 1. GET /api/suppliers - List with live balances and KPI summaries
  app.get(
    '/api/suppliers',
    { preHandler: [requirePermission('inventory.supplier.view')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const query = request.query as {
        search?: string;
        isActive?: string;
      };

      const accountMap = await getPharmacyAccountMap(db, pharmacyId);
      const apAccountId = accountMap.ap;

      // Base supplier filter
      const conditions = [eq(suppliers.pharmacyId, pharmacyId)];

      if (query.isActive === 'true') {
        conditions.push(eq(suppliers.isActive, true));
      } else if (query.isActive === 'false') {
        conditions.push(eq(suppliers.isActive, false));
      }

      if (query.search?.trim()) {
        const s = `%${query.search.trim()}%`;
        conditions.push(
          or(
            ilike(suppliers.name, s),
            ilike(suppliers.contactPerson, s),
            ilike(suppliers.phone, s)
          )!
        );
      }

      const supplierRows = await db
        .select()
        .from(suppliers)
        .where(and(...conditions))
        .orderBy(asc(suppliers.name));

      // Fetch all AP lines for this pharmacy
      const apLines = await db
        .select({
          partyId: journalLines.partyId,
          debitPaisa: journalLines.debitPaisa,
          creditPaisa: journalLines.creditPaisa,
          entryDate: journalEntries.entryDate,
          sourceType: journalEntries.sourceType,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, pharmacyId),
            eq(journalLines.accountId, apAccountId),
            eq(journalLines.partyType, 'supplier'),
            eq(journalEntries.status, 'posted')
          )
        );

      // Group AP lines by partyId
      const partyMap = new Map<
        string,
        {
          balance: number;
          purchaseCount: number;
          lastPurchaseDate: string | null;
          unpaidCreditLines: Array<{ creditPaisa: number; entryDate: string }>;
        }
      >();

      for (const line of apLines) {
        if (!line.partyId) continue;
        let entry = partyMap.get(line.partyId);
        if (!entry) {
          entry = {
            balance: 0,
            purchaseCount: 0,
            lastPurchaseDate: null,
            unpaidCreditLines: [],
          };
          partyMap.set(line.partyId, entry);
        }

        entry.balance += line.creditPaisa - line.debitPaisa;

        if (
          line.sourceType === 'purchase' ||
          line.sourceType === 'purchase.received' ||
          line.sourceType === 'po_receipt'
        ) {
          entry.purchaseCount += 1;
          if (!entry.lastPurchaseDate || line.entryDate > entry.lastPurchaseDate) {
            entry.lastPurchaseDate = line.entryDate;
          }
        }

        if (line.creditPaisa > 0) {
          entry.unpaidCreditLines.push({
            creditPaisa: line.creditPaisa,
            entryDate: line.entryDate,
          });
        }
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      const todayTime = new Date(todayStr).getTime();

      let totalPayablePaisa = 0;
      let totalOverduePayablePaisa = 0;
      let activeSuppliersCount = 0;

      const items = supplierRows.map((s) => {
        const partyData = partyMap.get(s.id);
        const payableBalancePaisa = partyData ? partyData.balance : 0;
        const purchaseCount = partyData ? partyData.purchaseCount : 0;
        const lastPurchaseDate = partyData ? partyData.lastPurchaseDate : null;

        // Calculate overdue amount
        let overduePayablePaisa = 0;
        if (payableBalancePaisa > 0 && partyData) {
          const termsMs = (s.paymentTermsDays || 30) * 24 * 60 * 60 * 1000;
          for (const cLine of partyData.unpaidCreditLines) {
            const dueDate = new Date(cLine.entryDate).getTime() + termsMs;
            if (todayTime > dueDate) {
              overduePayablePaisa += cLine.creditPaisa;
            }
          }
          if (overduePayablePaisa > payableBalancePaisa) {
            overduePayablePaisa = payableBalancePaisa;
          }
        }

        totalPayablePaisa += payableBalancePaisa;
        totalOverduePayablePaisa += overduePayablePaisa;
        if (s.isActive) {
          activeSuppliersCount++;
        }

        return {
          ...s,
          payableBalancePaisa,
          overduePayablePaisa,
          purchaseCount,
          lastPurchaseDate,
        };
      });

      return reply.status(200).send({
        kpis: {
          totalPayablePaisa,
          overduePayablePaisa: totalOverduePayablePaisa,
          activeSuppliersCount,
        },
        items,
      });
    }
  );

  // 2. POST /api/suppliers - Create supplier & optional opening balance entry
  app.post(
    '/api/suppliers',
    { preHandler: [requirePermission('inventory.supplier.manage')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const parsed = CreateSupplierSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid supplier input',
        });
      }

      const data = parsed.data;
      const now = new Date().toISOString();
      const supplierId = generateUuidV7();

      const created = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(suppliers)
          .values({
            id: supplierId,
            pharmacyId,
            name: data.name,
            contactPerson: data.contactPerson ?? null,
            phone: data.phone ?? null,
            email: data.email ? data.email : null,
            address: data.address ?? null,
            taxNumber: data.taxNumber ?? null,
            paymentTermsDays: data.paymentTermsDays,
            creditLimitPaisa: data.creditLimitPaisa,
            openingBalancePaisa: data.openingBalancePaisa,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        if (!inserted) {
          throw new Error('Failed to insert supplier');
        }

        // If opening balance > 0, post balanced journal entry
        if (data.openingBalancePaisa > 0) {
          // Find open period
          const [period] = await tx
            .select()
            .from(fiscalPeriods)
            .where(and(eq(fiscalPeriods.pharmacyId, pharmacyId), eq(fiscalPeriods.status, 'open')))
            .limit(1);

          if (!period) {
            // Auto-create current year open period
            const currentYear = new Date().getFullYear();
            const periodId = generateUuidV7();
            await tx.insert(fiscalPeriods).values({
              id: periodId,
              pharmacyId,
              startDate: `${currentYear}-01-01`,
              endDate: `${currentYear}-12-31`,
              status: 'open',
            });
          }

          const accountMap = await getPharmacyAccountMap(tx, pharmacyId);
          const apAccountId = accountMap.ap;
          const equityAccountId = accountMap.opening_balance_equity;

          await postJournalEntry(tx, {
            pharmacyId,
            entryDate: now.slice(0, 10),
            sourceType: 'supplier_opening',
            sourceId: supplierId,
            memo: `Opening balance for supplier ${data.name}`,
            createdBy: user.userId,
            lines: [
              {
                accountId: equityAccountId,
                debitPaisa: data.openingBalancePaisa,
                creditPaisa: 0,
                memo: 'Initial supplier opening balance (Equity offset)',
              },
              {
                accountId: apAccountId,
                debitPaisa: 0,
                creditPaisa: data.openingBalancePaisa,
                partyType: 'supplier',
                partyId: supplierId,
                memo: `Accounts Payable: ${data.name}`,
              },
            ],
          });
        }

        // Emit changeLog entry for sync
        await insertChangeLog(tx, {
          pharmacyId,
          entity: 'supplier',
          entityId: supplierId,
          op: 'upsert',
          data: {
            id: supplierId,
            name: inserted.name,
            contactPerson: inserted.contactPerson,
            phone: inserted.phone,
            email: inserted.email,
            address: inserted.address,
            isActive: inserted.isActive,
            createdAt: inserted.createdAt,
            updatedAt: inserted.updatedAt,
          },
          createdAt: now,
        });

        return inserted;
      });

      return reply.status(201).send({ data: created });
    }
  );

  // 3. GET /api/suppliers/duplicates - Duplicate candidates detection
  app.get(
    '/api/suppliers/duplicates',
    { preHandler: [requirePermission('inventory.supplier.manage')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const allSuppliers = await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.pharmacyId, pharmacyId))
        .orderBy(asc(suppliers.name));

      const groups: Array<{
        reason: string;
        candidateIds: string[];
        candidates: typeof allSuppliers;
      }> = [];

      const seenPair = new Set<string>();

      for (let i = 0; i < allSuppliers.length; i++) {
        for (let j = i + 1; j < allSuppliers.length; j++) {
          const s1 = allSuppliers[i]!;
          const s2 = allSuppliers[j]!;

          const nameMatch = normalizeName(s1.name) === normalizeName(s2.name);
          const phone1 = normalizePhone(s1.phone);
          const phone2 = normalizePhone(s2.phone);
          const phoneMatch = phone1 && phone2 && phone1.length >= 7 && phone1 === phone2;

          if (nameMatch || phoneMatch) {
            const pairKey = [s1.id, s2.id].sort().join(':');
            if (!seenPair.has(pairKey)) {
              seenPair.add(pairKey);
              groups.push({
                reason:
                  nameMatch && phoneMatch
                    ? 'Matching Name and Phone'
                    : nameMatch
                      ? 'Matching Supplier Name'
                      : 'Matching Phone Number',
                candidateIds: [s1.id, s2.id],
                candidates: [s1, s2],
              });
            }
          }
        }
      }

      return reply.status(200).send({ groups });
    }
  );

  // 4. POST /api/suppliers/merge - Merge two duplicate suppliers
  app.post(
    '/api/suppliers/merge',
    { preHandler: [requirePermission('inventory.supplier.manage')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;

      const parsed = MergeSuppliersSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Target and source supplier IDs are required',
        });
      }

      const { targetSupplierId, sourceSupplierId } = parsed.data;
      if (targetSupplierId === sourceSupplierId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Target and source suppliers must be different',
        });
      }

      // Verify both suppliers belong to this tenant
      const [targetSupplier] = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, targetSupplierId), eq(suppliers.pharmacyId, pharmacyId)));

      const [sourceSupplier] = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, sourceSupplierId), eq(suppliers.pharmacyId, pharmacyId)));

      if (!targetSupplier || !sourceSupplier) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'One or both suppliers do not exist in this pharmacy',
        });
      }

      const now = new Date().toISOString();

      await db.transaction(async (tx) => {
        // 1. Calculate source supplier's current AP balance
        const accountMap = await getPharmacyAccountMap(tx, pharmacyId);
        const apAccountId = accountMap.ap;

        const sourceLines = await tx
          .select({
            debitPaisa: journalLines.debitPaisa,
            creditPaisa: journalLines.creditPaisa,
          })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
          .where(
            and(
              eq(journalLines.pharmacyId, pharmacyId),
              eq(journalLines.accountId, apAccountId),
              eq(journalLines.partyType, 'supplier'),
              eq(journalLines.partyId, sourceSupplierId),
              eq(journalEntries.status, 'posted')
            )
          );

        const sourceBalance = sourceLines.reduce(
          (sum, l) => sum + (l.creditPaisa - l.debitPaisa),
          0
        );

        // 2. Post reclassification journal entry if source has non-zero balance
        if (sourceBalance !== 0) {
          const [period] = await tx
            .select()
            .from(fiscalPeriods)
            .where(and(eq(fiscalPeriods.pharmacyId, pharmacyId), eq(fiscalPeriods.status, 'open')))
            .limit(1);

          if (!period) {
            const currentYear = new Date().getFullYear();
            const periodId = generateUuidV7();
            await tx.insert(fiscalPeriods).values({
              id: periodId,
              pharmacyId,
              startDate: `${currentYear}-01-01`,
              endDate: `${currentYear}-12-31`,
              status: 'open',
            });
          }

          if (sourceBalance > 0) {
            // Source has payable balance: Dr Source AP, Cr Target AP
            await postJournalEntry(tx, {
              pharmacyId,
              entryDate: now.slice(0, 10),
              sourceType: 'supplier_merge',
              sourceId: sourceSupplierId,
              memo: `Reclassify payable: Merge ${sourceSupplier.name} into ${targetSupplier.name}`,
              createdBy: user.userId,
              lines: [
                {
                  accountId: apAccountId,
                  debitPaisa: sourceBalance,
                  creditPaisa: 0,
                  partyType: 'supplier',
                  partyId: sourceSupplierId,
                  memo: `Reclassified balance transferred to ${targetSupplier.name}`,
                },
                {
                  accountId: apAccountId,
                  debitPaisa: 0,
                  creditPaisa: sourceBalance,
                  partyType: 'supplier',
                  partyId: targetSupplierId,
                  memo: `Reclassified balance transferred from ${sourceSupplier.name}`,
                },
              ],
            });
          } else {
            // Source has debit balance: Dr Target AP, Cr Source AP
            const absBalance = Math.abs(sourceBalance);
            await postJournalEntry(tx, {
              pharmacyId,
              entryDate: now.slice(0, 10),
              sourceType: 'supplier_merge',
              sourceId: sourceSupplierId,
              memo: `Reclassify advance: Merge ${sourceSupplier.name} into ${targetSupplier.name}`,
              createdBy: user.userId,
              lines: [
                {
                  accountId: apAccountId,
                  debitPaisa: absBalance,
                  creditPaisa: 0,
                  partyType: 'supplier',
                  partyId: targetSupplierId,
                  memo: `Reclassified debit balance from ${sourceSupplier.name}`,
                },
                {
                  accountId: apAccountId,
                  debitPaisa: 0,
                  creditPaisa: absBalance,
                  partyType: 'supplier',
                  partyId: sourceSupplierId,
                  memo: `Reclassified debit balance to ${targetSupplier.name}`,
                },
              ],
            });
          }
        }

        // 3. Deactivate source supplier
        await tx
          .update(suppliers)
          .set({
            isActive: false,
            updatedAt: now,
          })
          .where(eq(suppliers.id, sourceSupplierId));

        // 4. Emit change logs
        await insertChangeLog(tx, {
          pharmacyId,
          entity: 'supplier',
          entityId: sourceSupplierId,
          op: 'upsert',
          data: { id: sourceSupplierId, isActive: false, updatedAt: now },
          createdAt: now,
        });

        await insertChangeLog(tx, {
          pharmacyId,
          entity: 'supplier',
          entityId: targetSupplierId,
          op: 'upsert',
          data: { id: targetSupplierId, updatedAt: now },
          createdAt: now,
        });
      });

      return reply.status(200).send({
        success: true,
        targetSupplierId,
        mergedSupplierId: sourceSupplierId,
      });
    }
  );

  // 5. GET /api/suppliers/:id - Detail view with ledger lines and purchases
  app.get(
    '/api/suppliers/:id',
    { preHandler: [requirePermission('inventory.supplier.view')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, id), eq(suppliers.pharmacyId, pharmacyId)));

      if (!supplier) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Supplier not found',
        });
      }

      const accountMap = await getPharmacyAccountMap(db, pharmacyId);
      const apAccountId = accountMap.ap;

      // AP Ledger lines
      const lines = await db
        .select({
          id: journalLines.id,
          entryId: journalLines.entryId,
          entryNo: journalEntries.entryNo,
          entryDate: journalEntries.entryDate,
          sourceType: journalEntries.sourceType,
          sourceId: journalEntries.sourceId,
          memo: journalEntries.memo,
          lineMemo: journalLines.memo,
          debitPaisa: journalLines.debitPaisa,
          creditPaisa: journalLines.creditPaisa,
          createdAt: journalEntries.createdAt,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.pharmacyId, pharmacyId),
            eq(journalLines.accountId, apAccountId),
            eq(journalLines.partyType, 'supplier'),
            eq(journalLines.partyId, id),
            eq(journalEntries.status, 'posted')
          )
        )
        .orderBy(asc(journalEntries.entryDate), asc(journalEntries.createdAt));

      let runningBalancePaisa = 0;
      const ledger = lines.map((l) => {
        runningBalancePaisa += l.creditPaisa - l.debitPaisa;
        return {
          ...l,
          runningBalancePaisa,
        };
      });

      // Purchase history (from purchase journal entries or movements)
      const purchaseEntries = await db
        .select({
          id: journalEntries.id,
          entryNo: journalEntries.entryNo,
          entryDate: journalEntries.entryDate,
          sourceId: journalEntries.sourceId,
          memo: journalEntries.memo,
          postedAt: journalEntries.createdAt,
        })
        .from(journalEntries)
        .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalEntries.pharmacyId, pharmacyId),
            inArray(journalEntries.sourceType, ['purchase', 'purchase.received', 'po_receipt']),
            eq(journalLines.partyType, 'supplier'),
            eq(journalLines.partyId, id),
            eq(journalEntries.status, 'posted')
          )
        )
        .groupBy(
          journalEntries.id,
          journalEntries.entryNo,
          journalEntries.entryDate,
          journalEntries.sourceId,
          journalEntries.memo,
          journalEntries.createdAt
        )
        .orderBy(desc(journalEntries.entryDate));

      return reply.status(200).send({
        supplier: {
          ...supplier,
          payableBalancePaisa: runningBalancePaisa,
        },
        ledger,
        purchases: purchaseEntries,
      });
    }
  );

  // 6. PATCH /api/suppliers/:id - Update or deactivate supplier
  app.patch(
    '/api/suppliers/:id',
    { preHandler: [requirePermission('inventory.supplier.manage')] },
    async (request, reply) => {
      const db = request.server.db || getDb();
      const user = request.userContext!;
      const pharmacyId = user.pharmacyId;
      const { id } = request.params as { id: string };

      const parsed = UpdateSupplierSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message || 'Invalid supplier update',
        });
      }

      const [existing] = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, id), eq(suppliers.pharmacyId, pharmacyId)));

      if (!existing) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Supplier not found',
        });
      }

      const data = parsed.data;
      const now = new Date().toISOString();

      const [updated] = await db
        .update(suppliers)
        .set({
          name: data.name !== undefined ? data.name : existing.name,
          contactPerson:
            data.contactPerson !== undefined ? data.contactPerson : existing.contactPerson,
          phone: data.phone !== undefined ? data.phone : existing.phone,
          email: data.email !== undefined ? (data.email ? data.email : null) : existing.email,
          address: data.address !== undefined ? data.address : existing.address,
          taxNumber: data.taxNumber !== undefined ? data.taxNumber : existing.taxNumber,
          paymentTermsDays:
            data.paymentTermsDays !== undefined ? data.paymentTermsDays : existing.paymentTermsDays,
          creditLimitPaisa:
            data.creditLimitPaisa !== undefined ? data.creditLimitPaisa : existing.creditLimitPaisa,
          isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
          updatedAt: now,
        })
        .where(eq(suppliers.id, id))
        .returning();

      if (!updated) {
        return reply.status(500).send({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update supplier',
        });
      }

      // Emit changeLog
      await insertChangeLog(db, {
        pharmacyId,
        entity: 'supplier',
        entityId: id,
        op: 'upsert',
        data: {
          id,
          name: updated.name,
          contactPerson: updated.contactPerson,
          phone: updated.phone,
          email: updated.email,
          address: updated.address,
          isActive: updated.isActive,
          updatedAt: now,
        },
        createdAt: now,
      });

      return reply.status(200).send({ data: updated });
    }
  );
};
