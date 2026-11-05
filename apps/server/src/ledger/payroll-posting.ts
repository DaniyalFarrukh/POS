import { eq, and, sql } from 'drizzle-orm';
import { generateUuidV7 } from '@pos/shared';
import {
  payrollRuns,
  payrollItems,
  employeeAdvances,
  accounts,
  journalEntries,
  journalLines,
  fiscalPeriods,
} from '../db/schema';
import type { DbClient } from '../db';

export async function postPayrollRunToLedger(
  db: DbClient,
  pharmacyId: string,
  payrollRunId: string,
  userId: string
): Promise<{ journalEntryId: string }> {
  return await db.transaction(async (tx) => {
    // 1. Fetch payroll run
    const [run] = await tx
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.id, payrollRunId), eq(payrollRuns.pharmacyId, pharmacyId)));

    if (!run) {
      throw new Error('Payroll run not found');
    }

    if (run.status !== 'approved') {
      throw new Error(`Cannot post payroll run with status '${run.status}'. Must be 'approved'.`);
    }

    if (run.journalEntryId) {
      throw new Error('Payroll run is already posted to the ledger');
    }

    const nowIso = new Date().toISOString();
    const karachiDate = nowIso.substring(0, 10);

    // 2. Validate open fiscal period
    const [openPeriod] = await tx
      .select()
      .from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.pharmacyId, pharmacyId), eq(fiscalPeriods.status, 'open')));

    if (!openPeriod) {
      throw new Error('No open fiscal period found for this transaction');
    }

    // 3. Resolve Chart of Accounts
    // 6000: Salaries (expense)
    // 2200: Salaries Payable (liability)
    // 2210: EOBI and Other Statutory Payable (liability)
    // 2110: Withholding Tax Payable (liability)
    // 2300: Other Payables (liability, for advance recoveries)
    const pharmacyAccounts = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.pharmacyId, pharmacyId));

    const salariesExpAcc = pharmacyAccounts.find((a) => a.code === '6000');
    const salariesPayableAcc = pharmacyAccounts.find((a) => a.code === '2200');
    const statutoryPayableAcc = pharmacyAccounts.find((a) => a.code === '2210');
    const taxPayableAcc = pharmacyAccounts.find((a) => a.code === '2110');
    const otherPayablesAcc = pharmacyAccounts.find((a) => a.code === '2300');

    if (!salariesExpAcc || !salariesPayableAcc) {
      throw new Error(
        'Missing core payroll ledger accounts (6000 Salaries, 2200 Salaries Payable)'
      );
    }

    // 4. Create Journal Entry
    const entryId = generateUuidV7();
    const [maxRow] = await tx
      .select({ maxNo: sql<number>`coalesce(max(${journalEntries.entryNo}), 0)` })
      .from(journalEntries)
      .where(eq(journalEntries.pharmacyId, pharmacyId));
    const nextEntryNo = Number(maxRow?.maxNo ?? 0) + 1;

    await tx.insert(journalEntries).values({
      id: entryId,
      pharmacyId,
      entryNo: nextEntryNo,
      entryDate: karachiDate,
      sourceType: 'payroll_run',
      sourceId: run.id,
      memo: `Payroll Run ${run.runNumber} for ${run.month}`,
      status: 'posted',
      createdBy: userId,
      createdAt: nowIso,
    });

    // 5. Build Journal Lines:
    // Dr 6000 Salaries = totalGrossPaisa
    // Cr 2200 Salaries Payable = totalNetPaisa
    // Cr 2210 Statutory Payable = totalStatutoryPaisa
    // Cr 2110 Tax Payable = totalTaxPaisa
    // Cr 2300 Advance Recoveries = totalAdvancesRecoveredPaisa
    const linesToInsert: Array<{
      id: string;
      entryId: string;
      pharmacyId: string;
      accountId: string;
      debitPaisa: number;
      creditPaisa: number;
      branchId: string;
      memo: string;
    }> = [];

    // Dr Salaries
    linesToInsert.push({
      id: generateUuidV7(),
      entryId,
      pharmacyId,
      accountId: salariesExpAcc.id,
      debitPaisa: run.totalGrossPaisa,
      creditPaisa: 0,
      branchId: run.branchId,
      memo: `Gross salary expense for ${run.month} (${run.runNumber})`,
    });

    // Cr Salaries Payable
    linesToInsert.push({
      id: generateUuidV7(),
      entryId,
      pharmacyId,
      accountId: salariesPayableAcc.id,
      debitPaisa: 0,
      creditPaisa: run.totalNetPaisa,
      branchId: run.branchId,
      memo: `Net salaries payable for ${run.month}`,
    });

    // Cr Statutory Deductions (EOBI, etc.)
    if (run.totalStatutoryPaisa > 0 && statutoryPayableAcc) {
      linesToInsert.push({
        id: generateUuidV7(),
        entryId,
        pharmacyId,
        accountId: statutoryPayableAcc.id,
        debitPaisa: 0,
        creditPaisa: run.totalStatutoryPaisa,
        branchId: run.branchId,
        memo: `Statutory withholdings for ${run.month}`,
      });
    }

    // Cr Withholding Tax Payable
    if (run.totalTaxPaisa > 0 && taxPayableAcc) {
      linesToInsert.push({
        id: generateUuidV7(),
        entryId,
        pharmacyId,
        accountId: taxPayableAcc.id,
        debitPaisa: 0,
        creditPaisa: run.totalTaxPaisa,
        branchId: run.branchId,
        memo: `Income tax withheld for ${run.month}`,
      });
    }

    // Cr Advance Recoveries
    if (run.totalAdvancesRecoveredPaisa > 0 && otherPayablesAcc) {
      linesToInsert.push({
        id: generateUuidV7(),
        entryId,
        pharmacyId,
        accountId: otherPayablesAcc.id,
        debitPaisa: 0,
        creditPaisa: run.totalAdvancesRecoveredPaisa,
        branchId: run.branchId,
        memo: `Staff advance loan recoveries for ${run.month}`,
      });
    }

    // Exact balance verification: Sum(Debit) === Sum(Credit)
    const sumDebit = linesToInsert.reduce((sum, l) => sum + l.debitPaisa, 0);
    const sumCredit = linesToInsert.reduce((sum, l) => sum + l.creditPaisa, 0);

    if (sumDebit !== sumCredit) {
      throw new Error(
        `Payroll journal entry is unbalanced: Debits (${sumDebit}) != Credits (${sumCredit})`
      );
    }

    await tx.insert(journalLines).values(linesToInsert);

    // 6. Update Employee Advances: update recovered balances
    const items = await tx.select().from(payrollItems).where(eq(payrollItems.payrollRunId, run.id));

    for (const item of items) {
      if (item.advanceId && item.advanceRecoveryPaisa > 0) {
        const [adv] = await tx
          .select()
          .from(employeeAdvances)
          .where(eq(employeeAdvances.id, item.advanceId));

        if (adv) {
          const newRecovered = adv.recoveredPaisa + item.advanceRecoveryPaisa;
          const newRemaining = Math.max(0, adv.principalPaisa - newRecovered);
          const newStatus = newRemaining <= 0 ? 'recovered' : 'active';

          await tx
            .update(employeeAdvances)
            .set({
              recoveredPaisa: newRecovered,
              remainingPaisa: newRemaining,
              status: newStatus,
              updatedAt: nowIso,
            })
            .where(eq(employeeAdvances.id, adv.id));
        }
      }
    }

    // 7. Update run status to 'posted'
    await tx
      .update(payrollRuns)
      .set({
        status: 'posted',
        journalEntryId: entryId,
        updatedAt: nowIso,
      })
      .where(eq(payrollRuns.id, run.id));

    return { journalEntryId: entryId };
  });
}

export async function postPayrollPaymentBatch(
  db: DbClient,
  pharmacyId: string,
  payrollRunId: string,
  paymentAccountId: string,
  paymentMethod: string,
  userId: string
): Promise<{ paymentJournalEntryId: string }> {
  return await db.transaction(async (tx) => {
    // 1. Fetch payroll run
    const [run] = await tx
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.id, payrollRunId), eq(payrollRuns.pharmacyId, pharmacyId)));

    if (!run) {
      throw new Error('Payroll run not found');
    }

    if (run.status !== 'posted') {
      throw new Error(`Cannot disburse payroll run with status '${run.status}'. Must be 'posted'.`);
    }

    if (run.paymentJournalEntryId) {
      throw new Error('Payment batch has already been recorded for this payroll run');
    }

    const nowIso = new Date().toISOString();
    const karachiDate = nowIso.substring(0, 10);

    // 2. Resolve accounts
    const pharmacyAccounts = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.pharmacyId, pharmacyId));

    const salariesPayableAcc = pharmacyAccounts.find((a) => a.code === '2200');
    const paymentAcc = pharmacyAccounts.find((a) => a.id === paymentAccountId);

    if (!salariesPayableAcc) {
      throw new Error('Salaries Payable account (2200) not found in chart of accounts');
    }

    if (!paymentAcc) {
      throw new Error('Selected payment cash/bank account not found');
    }

    // 3. Create Payment Journal Entry
    const entryId = generateUuidV7();
    const [maxRow] = await tx
      .select({ maxNo: sql<number>`coalesce(max(${journalEntries.entryNo}), 0)` })
      .from(journalEntries)
      .where(eq(journalEntries.pharmacyId, pharmacyId));
    const nextEntryNo = Number(maxRow?.maxNo ?? 0) + 1;

    await tx.insert(journalEntries).values({
      id: entryId,
      pharmacyId,
      entryNo: nextEntryNo,
      entryDate: karachiDate,
      sourceType: 'payroll_payment',
      sourceId: run.id,
      memo: `Salary disbursement for ${run.runNumber} via ${paymentAcc.name}`,
      status: 'posted',
      createdBy: userId,
      createdAt: nowIso,
    });

    // 4. Create Payment Lines:
    // Dr 2200 Salaries Payable = totalNetPaisa
    // Cr Cash/Bank = totalNetPaisa
    await tx.insert(journalLines).values([
      {
        id: generateUuidV7(),
        entryId,
        pharmacyId,
        accountId: salariesPayableAcc.id,
        debitPaisa: run.totalNetPaisa,
        creditPaisa: 0,
        branchId: run.branchId,
        memo: `Salary settlement for ${run.month}`,
      },
      {
        id: generateUuidV7(),
        entryId,
        pharmacyId,
        accountId: paymentAcc.id,
        debitPaisa: 0,
        creditPaisa: run.totalNetPaisa,
        branchId: run.branchId,
        memo: `Disbursement from ${paymentAcc.name}`,
      },
    ]);

    // 5. Update items to 'paid'
    await tx
      .update(payrollItems)
      .set({
        paymentStatus: 'paid',
        updatedAt: nowIso,
      })
      .where(eq(payrollItems.payrollRunId, run.id));

    // 6. Update run to 'paid'
    await tx
      .update(payrollRuns)
      .set({
        status: 'paid',
        paymentJournalEntryId: entryId,
        paymentAccountId: paymentAcc.id,
        paymentMethod,
        paidAt: nowIso,
        updatedAt: nowIso,
      })
      .where(eq(payrollRuns.id, run.id));

    return { paymentJournalEntryId: entryId };
  });
}
