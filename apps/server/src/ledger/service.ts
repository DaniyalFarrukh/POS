import { eq, and, sql, inArray, lte, gte, asc } from 'drizzle-orm';
import { generateUuidV7, type UserRole } from '@pos/shared';
import type { DbClient } from '../sync/types';
import {
  pharmacies,
  branches,
  accounts,
  fiscalPeriods,
  journalEntries,
  journalLines,
} from '../db/schema';
import { insertChangeLog } from '../sync/change-log';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export type PartyType = 'customer' | 'supplier' | 'employee';

export interface JournalLineInput {
  accountId: string;
  debitPaisa: number;
  creditPaisa: number;
  branchId?: string | null;
  partyType?: PartyType | null;
  partyId?: string | null;
  memo?: string | null;
}

export interface PostJournalEntryInput {
  pharmacyId: string;
  entryDate: string; // YYYY-MM-DD (Karachi business date)
  sourceType?: string | null;
  sourceId?: string | null;
  memo?: string | null;
  createdBy?: string | null;
  lines: JournalLineInput[];
}

export interface JournalEntryWithLines {
  id: string;
  pharmacyId: string;
  entryNo: number;
  entryDate: string;
  sourceType: string | null;
  sourceId: string | null;
  memo: string | null;
  status: 'posted' | 'reversed';
  reversesEntryId: string | null;
  createdBy: string | null;
  createdAt: string;
  lines: Array<typeof journalLines.$inferSelect>;
}

export interface ReverseJournalEntryOptions {
  pharmacyId?: string;
  reversalDate?: string;
  createdBy?: string | null;
}

export interface ClosePeriodInput {
  pharmacyId: string;
  startDate: string;
  endDate: string;
  actorUserId: string;
  actorRole: UserRole;
  reason?: string;
  periodId?: string;
}

export interface ReopenPeriodInput {
  pharmacyId: string;
  periodId: string;
  actorUserId: string;
  actorRole: UserRole;
  reason?: string;
}

function assertValidKarachiDate(dateStr: string, fieldName: string): void {
  if (!ISO_DATE_REGEX.test(dateStr)) {
    throw new Error(`Invalid ${fieldName}: '${dateStr}' (expected YYYY-MM-DD)`);
  }
}

function getTodayKarachiDate(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

/**
 * Validates and posts a balanced journal entry:
 * - Validates integer paisa, XOR debit/credit > 0 per line, >= 2 lines, and sum(debit) === sum(credit).
 * - Acquires a per-pharmacy row lock (`SELECT id FROM pharmacies WHERE id = $1 FOR UPDATE`) to serialize
 *   entry_no allocation safely under concurrency without gaps.
 * - Handles idempotency when (pharmacyId, sourceType, sourceId) already exists.
 * - Verifies all accounts belong to the pharmacy and are active.
 * - Verifies all referenced branches belong to the pharmacy.
 * - Verifies entryDate does not fall in a closed fiscal period.
 */
export async function postJournalEntry(
  tx: DbClient,
  input: PostJournalEntryInput
): Promise<JournalEntryWithLines> {
  const { pharmacyId, entryDate, sourceType = null, sourceId = null, memo = null, createdBy = null, lines } = input;

  if (!pharmacyId) {
    throw new Error('pharmacyId is required');
  }
  assertValidKarachiDate(entryDate, 'entryDate');

  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error('Journal entry must have at least 2 lines');
  }

  let totalDebitPaisa = 0;
  let totalCreditPaisa = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!Number.isInteger(line.debitPaisa) || !Number.isInteger(line.creditPaisa)) {
      throw new Error(`Line #${i + 1}: debitPaisa and creditPaisa must be integer paisa`);
    }
    if (line.debitPaisa < 0 || line.creditPaisa < 0) {
      throw new Error(`Line #${i + 1}: debitPaisa and creditPaisa cannot be negative`);
    }
    const hasDebit = line.debitPaisa > 0 && line.creditPaisa === 0;
    const hasCredit = line.creditPaisa > 0 && line.debitPaisa === 0;
    if (!hasDebit && !hasCredit) {
      throw new Error(
        `Line #${i + 1}: each line must have strictly one of debitPaisa > 0 or creditPaisa > 0`
      );
    }
    totalDebitPaisa += line.debitPaisa;
    totalCreditPaisa += line.creditPaisa;
  }

  if (totalDebitPaisa <= 0 || totalDebitPaisa !== totalCreditPaisa) {
    throw new Error(
      `Unbalanced journal entry: total debit (${totalDebitPaisa}) !== total credit (${totalCreditPaisa})`
    );
  }

  // 1. Lock the tenant row in `pharmacies` FOR UPDATE so concurrent postings for the same pharmacy
  // serialize cleanly and receive gapless sequential entry_no values.
  const lockedPharmacy = await tx.execute<{ id: string }>(
    sql`SELECT "id" FROM "pharmacies" WHERE "id" = ${pharmacyId} FOR UPDATE`
  );
  if (lockedPharmacy.rows.length === 0) {
    throw new Error('Pharmacy not found');
  }

  // 2. Idempotency check for auto-posted entries (UNIQUE (pharmacy_id, source_type, source_id))
  if (sourceType !== null && sourceId !== null) {
    const [existingEntry] = await tx
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.pharmacyId, pharmacyId),
          eq(journalEntries.sourceType, sourceType),
          eq(journalEntries.sourceId, sourceId)
        )
      )
      .limit(1);

    if (existingEntry) {
      const existingLines = await tx
        .select()
        .from(journalLines)
        .where(
          and(
            eq(journalLines.entryId, existingEntry.id),
            eq(journalLines.pharmacyId, pharmacyId)
          )
        )
        .orderBy(asc(journalLines.id));

      return {
        ...existingEntry,
        lines: existingLines,
      };
    }
  }

  // 3. Validate all accounts belong to pharmacyId and are active
  const uniqueAccountIds = Array.from(new Set(lines.map((l) => l.accountId)));
  const foundAccounts = await tx
    .select({
      id: accounts.id,
      isActive: accounts.isActive,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.pharmacyId, pharmacyId),
        inArray(accounts.id, uniqueAccountIds)
      )
    );

  if (foundAccounts.length !== uniqueAccountIds.length) {
    throw new Error('One or more accounts were not found or belong to another pharmacy');
  }

  for (const acc of foundAccounts) {
    if (!acc.isActive) {
      throw new Error(`Account ${acc.id} is inactive and cannot be posted to`);
    }
  }

  // 4. Validate any branchId on lines belongs to pharmacyId
  const uniqueBranchIds = Array.from(
    new Set(lines.map((l) => l.branchId).filter((b): b is string => Boolean(b)))
  );
  if (uniqueBranchIds.length > 0) {
    const foundBranches = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(
          eq(branches.pharmacyId, pharmacyId),
          inArray(branches.id, uniqueBranchIds)
        )
      );

    if (foundBranches.length !== uniqueBranchIds.length) {
      throw new Error('One or more branches were not found or belong to another pharmacy');
    }
  }

  // 5. Check that entryDate does not fall inside a closed fiscal period for this pharmacy
  const closedPeriods = await tx
    .select({ id: fiscalPeriods.id, startDate: fiscalPeriods.startDate, endDate: fiscalPeriods.endDate })
    .from(fiscalPeriods)
    .where(
      and(
        eq(fiscalPeriods.pharmacyId, pharmacyId),
        eq(fiscalPeriods.status, 'closed'),
        lte(fiscalPeriods.startDate, entryDate),
        gte(fiscalPeriods.endDate, entryDate)
      )
    )
    .limit(1);

  if (closedPeriods.length > 0) {
    const cp = closedPeriods[0]!;
    throw new Error(
      `Cannot post journal entry on ${entryDate}: fiscal period (${cp.startDate} to ${cp.endDate}) is closed`
    );
  }

  // 6. Compute gapless sequential entry_no for this pharmacy
  const [maxRow] = await tx
    .select({
      maxNo: sql<number>`COALESCE(MAX(${journalEntries.entryNo}), 0)`,
    })
    .from(journalEntries)
    .where(eq(journalEntries.pharmacyId, pharmacyId));

  const nextEntryNo = Number(maxRow?.maxNo ?? 0) + 1;
  const entryId = generateUuidV7();
  const now = new Date().toISOString();

  const [insertedEntry] = await tx
    .insert(journalEntries)
    .values({
      id: entryId,
      pharmacyId,
      entryNo: nextEntryNo,
      entryDate,
      sourceType,
      sourceId,
      memo,
      status: 'posted',
      reversesEntryId: null,
      createdBy,
      createdAt: now,
    })
    .returning();

  const lineValues = lines.map((line) => ({
    id: generateUuidV7(),
    entryId,
    pharmacyId,
    accountId: line.accountId,
    debitPaisa: line.debitPaisa,
    creditPaisa: line.creditPaisa,
    branchId: line.branchId ?? null,
    partyType: line.partyType ?? null,
    partyId: line.partyId ?? null,
    memo: line.memo ?? null,
  }));

  const insertedLines = await tx
    .insert(journalLines)
    .values(lineValues)
    .returning();

  return {
    ...insertedEntry!,
    lines: insertedLines,
  };
}

/**
 * Reverses an existing journal entry by inserting a new reversing entry with swapped debits and credits.
 * Accounting records are never updated or deleted: status change to reversed is represented by
 * inserting a reversing entry referencing `reverses_entry_id = entryId`.
 */
export async function reverseJournalEntry(
  tx: DbClient,
  entryId: string,
  reason: string,
  options: ReverseJournalEntryOptions = {}
): Promise<JournalEntryWithLines> {
  if (!entryId) {
    throw new Error('entryId is required');
  }
  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    throw new Error('Reversal reason is required');
  }

  const conditions = [eq(journalEntries.id, entryId)];
  if (options.pharmacyId) {
    conditions.push(eq(journalEntries.pharmacyId, options.pharmacyId));
  }

  const [original] = await tx
    .select()
    .from(journalEntries)
    .where(and(...conditions))
    .limit(1);

  if (!original) {
    throw new Error('Journal entry not found or belongs to another pharmacy');
  }

  const pharmacyId = original.pharmacyId;

  // Lock pharmacy row FOR UPDATE to serialize reversal check + entry_no assignment
  await tx.execute(
    sql`SELECT "id" FROM "pharmacies" WHERE "id" = ${pharmacyId} FOR UPDATE`
  );

  // Reject if this entry is itself a reversing entry or has already been reversed
  if (original.reversesEntryId !== null) {
    throw new Error(`Journal entry #${original.entryNo} is a reversal entry and cannot be reversed`);
  }

  const [existingReversal] = await tx
    .select({ id: journalEntries.id, entryNo: journalEntries.entryNo })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.pharmacyId, pharmacyId),
        eq(journalEntries.reversesEntryId, original.id)
      )
    )
    .limit(1);

  if (existingReversal) {
    throw new Error(
      `Journal entry #${original.entryNo} is already reversed by entry #${existingReversal.entryNo}`
    );
  }

  const originalLines = await tx
    .select()
    .from(journalLines)
    .where(
      and(
        eq(journalLines.entryId, original.id),
        eq(journalLines.pharmacyId, pharmacyId)
      )
    )
    .orderBy(asc(journalLines.id));

  if (originalLines.length < 2) {
    throw new Error('Original journal entry has invalid lines');
  }

  const reversalDate = options.reversalDate || original.entryDate || getTodayKarachiDate();
  assertValidKarachiDate(reversalDate, 'reversalDate');

  // Verify reversalDate does not fall inside a closed fiscal period
  const closedPeriods = await tx
    .select({ id: fiscalPeriods.id, startDate: fiscalPeriods.startDate, endDate: fiscalPeriods.endDate })
    .from(fiscalPeriods)
    .where(
      and(
        eq(fiscalPeriods.pharmacyId, pharmacyId),
        eq(fiscalPeriods.status, 'closed'),
        lte(fiscalPeriods.startDate, reversalDate),
        gte(fiscalPeriods.endDate, reversalDate)
      )
    )
    .limit(1);

  if (closedPeriods.length > 0) {
    const cp = closedPeriods[0]!;
    throw new Error(
      `Cannot reverse journal entry on ${reversalDate}: fiscal period (${cp.startDate} to ${cp.endDate}) is closed`
    );
  }

  // Verify all accounts on original entry are still active and belong to pharmacy
  const uniqueAccountIds = Array.from(new Set(originalLines.map((l) => l.accountId)));
  const foundAccounts = await tx
    .select({ id: accounts.id, isActive: accounts.isActive })
    .from(accounts)
    .where(
      and(
        eq(accounts.pharmacyId, pharmacyId),
        inArray(accounts.id, uniqueAccountIds)
      )
    );

  if (foundAccounts.length !== uniqueAccountIds.length) {
    throw new Error('One or more accounts on the original entry were not found');
  }

  const [maxRow] = await tx
    .select({
      maxNo: sql<number>`COALESCE(MAX(${journalEntries.entryNo}), 0)`,
    })
    .from(journalEntries)
    .where(eq(journalEntries.pharmacyId, pharmacyId));

  const nextEntryNo = Number(maxRow?.maxNo ?? 0) + 1;
  const reversalEntryId = generateUuidV7();
  const now = new Date().toISOString();

  const [insertedReversal] = await tx
    .insert(journalEntries)
    .values({
      id: reversalEntryId,
      pharmacyId,
      entryNo: nextEntryNo,
      entryDate: reversalDate,
      sourceType: original.sourceType ? `${original.sourceType}.reversal` : 'manual.reversal',
      sourceId: original.id,
      memo: `Reversal of entry #${original.entryNo}: ${trimmedReason}`,
      status: 'reversed',
      reversesEntryId: original.id,
      createdBy: options.createdBy ?? original.createdBy ?? null,
      createdAt: now,
    })
    .returning();

  const reversedLineValues = originalLines.map((line) => ({
    id: generateUuidV7(),
    entryId: reversalEntryId,
    pharmacyId,
    accountId: line.accountId,
    debitPaisa: line.creditPaisa,
    creditPaisa: line.debitPaisa,
    branchId: line.branchId,
    partyType: line.partyType,
    partyId: line.partyId,
    memo: line.memo ? `Reversal: ${line.memo}` : `Reversal of entry #${original.entryNo}`,
  }));

  const insertedLines = await tx
    .insert(journalLines)
    .values(reversedLineValues)
    .returning();

  return {
    ...insertedReversal!,
    lines: insertedLines,
  };
}

/**
 * Closes a fiscal period (owner only, audit logged in change_log).
 */
export async function closePeriod(
  tx: DbClient,
  input: ClosePeriodInput
): Promise<typeof fiscalPeriods.$inferSelect> {
  const { pharmacyId, startDate, endDate, actorUserId, actorRole, reason, periodId } = input;

  if (actorRole !== 'owner') {
    throw new Error('Only an owner can close a fiscal period');
  }

  assertValidKarachiDate(startDate, 'startDate');
  assertValidKarachiDate(endDate, 'endDate');
  if (startDate > endDate) {
    throw new Error('startDate must be less than or equal to endDate');
  }

  // Verify pharmacy exists
  const [pharmacy] = await tx
    .select({ id: pharmacies.id })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1);

  if (!pharmacy) {
    throw new Error('Pharmacy not found');
  }

  let period: typeof fiscalPeriods.$inferSelect | undefined;

  if (periodId) {
    const [existingById] = await tx
      .select()
      .from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.id, periodId), eq(fiscalPeriods.pharmacyId, pharmacyId)))
      .limit(1);

    if (!existingById) {
      throw new Error('Fiscal period not found or belongs to another pharmacy');
    }

    const [updated] = await tx
      .update(fiscalPeriods)
      .set({ status: 'closed' })
      .where(and(eq(fiscalPeriods.id, periodId), eq(fiscalPeriods.pharmacyId, pharmacyId)))
      .returning();
    period = updated!;
  } else {
    const [existingByRange] = await tx
      .select()
      .from(fiscalPeriods)
      .where(
        and(
          eq(fiscalPeriods.pharmacyId, pharmacyId),
          eq(fiscalPeriods.startDate, startDate),
          eq(fiscalPeriods.endDate, endDate)
        )
      )
      .limit(1);

    if (existingByRange) {
      const [updated] = await tx
        .update(fiscalPeriods)
        .set({ status: 'closed' })
        .where(
          and(
            eq(fiscalPeriods.id, existingByRange.id),
            eq(fiscalPeriods.pharmacyId, pharmacyId)
          )
        )
        .returning();
      period = updated!;
    } else {
      const newId = generateUuidV7();
      const [inserted] = await tx
        .insert(fiscalPeriods)
        .values({
          id: newId,
          pharmacyId,
          startDate,
          endDate,
          status: 'closed',
        })
        .returning();
      period = inserted!;
    }
  }

  await insertChangeLog(tx, {
    pharmacyId,
    entity: 'fiscal_period',
    entityId: period.id,
    op: 'upsert',
    data: {
      id: period.id,
      startDate: period.startDate,
      endDate: period.endDate,
      status: 'closed',
      action: 'close',
      actorUserId,
      actorRole,
      reason: reason ?? null,
    },
  });

  return period;
}

/**
 * Reopens a closed fiscal period (owner only, audit logged in change_log).
 */
export async function reopenPeriod(
  tx: DbClient,
  input: ReopenPeriodInput
): Promise<typeof fiscalPeriods.$inferSelect> {
  const { pharmacyId, periodId, actorUserId, actorRole, reason } = input;

  if (actorRole !== 'owner') {
    throw new Error('Only an owner can reopen a fiscal period');
  }

  const [existing] = await tx
    .select()
    .from(fiscalPeriods)
    .where(and(eq(fiscalPeriods.id, periodId), eq(fiscalPeriods.pharmacyId, pharmacyId)))
    .limit(1);

  if (!existing) {
    throw new Error('Fiscal period not found or belongs to another pharmacy');
  }

  const [updated] = await tx
    .update(fiscalPeriods)
    .set({ status: 'open' })
    .where(and(eq(fiscalPeriods.id, periodId), eq(fiscalPeriods.pharmacyId, pharmacyId)))
    .returning();

  const period = updated!;

  await insertChangeLog(tx, {
    pharmacyId,
    entity: 'fiscal_period',
    entityId: period.id,
    op: 'upsert',
    data: {
      id: period.id,
      startDate: period.startDate,
      endDate: period.endDate,
      status: 'open',
      action: 'reopen',
      actorUserId,
      actorRole,
      reason: reason ?? null,
    },
  });

  return period;
}

