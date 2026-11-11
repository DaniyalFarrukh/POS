import { eq, and } from 'drizzle-orm';
import {
  payrollRuns,
  payrollItems,
  employeeAdvances,
  accounts,
} from '../db/schema';
import type { DbClient } from '../db';
import { postJournalEntry } from './service';
import { toKarachiBusinessDate } from './posting-engine';

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
    const entryDate = toKarachiBusinessDate(nowIso);

    // 2. Resolve Chart of Accounts
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

    // 3. Build Journal Lines:
    // Dr 6000 Salaries = totalGrossPaisa
    // Cr 2200 Salaries Payable = totalNetPaisa
    // Cr 2210 Statutory Payable = totalStatutoryPaisa
    // Cr 2110 Tax Payable = totalTaxPaisa
    // Cr 2300 Advance Recoveries = totalAdvancesRecoveredPaisa (with employee party attribution)
    const linesToPost: Array<{
      accountId: string;
      debitPaisa: number;
      creditPaisa: number;
      branchId?: string;
      partyType?: 'customer' | 'supplier' | 'employee';
      partyId?: string;
      memo?: string;
    }> = [];

    // Dr Salaries
    linesToPost.push({
      accountId: salariesExpAcc.id,
      debitPaisa: run.totalGrossPaisa,
      creditPaisa: 0,
      branchId: run.branchId || undefined,
      memo: `Gross salary expense for ${run.month} (${run.runNumber})`,
    });

    // Cr Salaries Payable
    linesToPost.push({
      accountId: salariesPayableAcc.id,
      debitPaisa: 0,
      creditPaisa: run.totalNetPaisa,
      branchId: run.branchId || undefined,
      memo: `Net salaries payable for ${run.month}`,
    });

    // Cr Statutory Deductions (EOBI, etc.)
    if (run.totalStatutoryPaisa > 0 && statutoryPayableAcc) {
      linesToPost.push({
        accountId: statutoryPayableAcc.id,
        debitPaisa: 0,
        creditPaisa: run.totalStatutoryPaisa,
        branchId: run.branchId || undefined,
        memo: `Statutory withholdings for ${run.month}`,
      });
    }

    // Cr Withholding Tax Payable
    if (run.totalTaxPaisa > 0 && taxPayableAcc) {
      linesToPost.push({
        accountId: taxPayableAcc.id,
        debitPaisa: 0,
        creditPaisa: run.totalTaxPaisa,
        branchId: run.branchId || undefined,
        memo: `Income tax withheld for ${run.month}`,
      });
    }

    // Cr Advance Recoveries per employee item
    const items = await tx.select().from(payrollItems).where(eq(payrollItems.payrollRunId, run.id));

    if (run.totalAdvancesRecoveredPaisa > 0 && otherPayablesAcc) {
      let sumItemRecoveries = 0;
      for (const item of items) {
        if (item.advanceRecoveryPaisa > 0) {
          linesToPost.push({
            accountId: otherPayablesAcc.id,
            debitPaisa: 0,
            creditPaisa: item.advanceRecoveryPaisa,
            partyType: 'employee',
            partyId: item.employeeId,
            branchId: run.branchId || undefined,
            memo: `Staff advance loan recovery for ${run.month}`,
          });
          sumItemRecoveries += item.advanceRecoveryPaisa;
        }
      }
      const remainder = run.totalAdvancesRecoveredPaisa - sumItemRecoveries;
      if (remainder > 0) {
        linesToPost.push({
          accountId: otherPayablesAcc.id,
          debitPaisa: 0,
          creditPaisa: remainder,
          branchId: run.branchId || undefined,
          memo: `Staff advance loan recoveries for ${run.month}`,
        });
      }
    }

    // Post via standard postJournalEntry service
    const entry = await postJournalEntry(tx, {
      pharmacyId,
      entryDate,
      sourceType: 'payroll_run',
      sourceId: run.id,
      memo: `Payroll Run ${run.runNumber} for ${run.month}`,
      createdBy: userId,
      lines: linesToPost,
    });

    // 4. Update Employee Advances: update recovered balances
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

    // 5. Update run status to 'posted'
    await tx
      .update(payrollRuns)
      .set({
        status: 'posted',
        journalEntryId: entry.id,
        updatedAt: nowIso,
      })
      .where(eq(payrollRuns.id, run.id));

    return { journalEntryId: entry.id };
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
    const entryDate = toKarachiBusinessDate(nowIso);

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

    // 3. Post Payment Journal Entry via standard postJournalEntry service
    const entry = await postJournalEntry(tx, {
      pharmacyId,
      entryDate,
      sourceType: 'payroll_payment',
      sourceId: run.id,
      memo: `Salary disbursement for ${run.runNumber} via ${paymentAcc.name}`,
      createdBy: userId,
      lines: [
        {
          accountId: salariesPayableAcc.id,
          debitPaisa: run.totalNetPaisa,
          creditPaisa: 0,
          branchId: run.branchId || undefined,
          memo: `Salary settlement for ${run.month}`,
        },
        {
          accountId: paymentAcc.id,
          debitPaisa: 0,
          creditPaisa: run.totalNetPaisa,
          branchId: run.branchId || undefined,
          memo: `Disbursement from ${paymentAcc.name}`,
        },
      ],
    });

    // 4. Update items to 'paid'
    await tx
      .update(payrollItems)
      .set({
        paymentStatus: 'paid',
        updatedAt: nowIso,
      })
      .where(eq(payrollItems.payrollRunId, run.id));

    // 5. Update run to 'paid'
    await tx
      .update(payrollRuns)
      .set({
        status: 'paid',
        paymentJournalEntryId: entry.id,
        paymentAccountId: paymentAcc.id,
        paymentMethod,
        paidAt: nowIso,
        updatedAt: nowIso,
      })
      .where(eq(payrollRuns.id, run.id));

    return { paymentJournalEntryId: entry.id };
  });
}
