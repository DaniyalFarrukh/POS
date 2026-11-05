import type { ExpenseRecord, ExpenseStatus, ExpensePaymentType, ExpenseKPIs } from '../types';

/**
 * Returns label and badge styling classes for an expense status.
 */
export function getExpenseStatusMeta(status: ExpenseStatus): {
  label: string;
  badgeClass: string;
} {
  switch (status) {
    case 'pending_approval':
      return {
        label: 'Pending Approval',
        badgeClass: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
      };
    case 'approved':
      return {
        label: 'Approved',
        badgeClass: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
      };
    case 'posted':
      return {
        label: 'Posted',
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
      };
    case 'reversed':
      return {
        label: 'Reversed',
        badgeClass: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
      };
    default:
      return {
        label: status,
        badgeClass: 'bg-slate-500/10 text-slate-400 border border-slate-500/20',
      };
  }
}

/**
 * Returns label and badge styling for payment type (paid immediately vs credit payable).
 */
export function getPaymentTypeMeta(type: ExpensePaymentType): {
  label: string;
  badgeClass: string;
} {
  switch (type) {
    case 'paid':
      return {
        label: 'Paid (Immediate)',
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
      };
    case 'credit':
      return {
        label: 'Credit (Payable)',
        badgeClass: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
      };
  }
}

/**
 * Calculates summary KPI metrics from a list of expense records.
 */
export function calculateExpenseKPIs(expenses: ExpenseRecord[]): ExpenseKPIs {
  let totalExpensesPaisa = 0;
  let expenseCount = 0;
  let pendingApprovalCount = 0;

  for (const e of expenses) {
    if (e.status === 'posted') {
      totalExpensesPaisa += e.amountPaisa;
      expenseCount += 1;
    } else if (e.status === 'pending_approval') {
      pendingApprovalCount += 1;
    }
  }

  const averageExpensePaisa = expenseCount > 0 ? Math.round(totalExpensesPaisa / expenseCount) : 0;

  return {
    totalExpensesPaisa,
    expenseCount,
    averageExpensePaisa,
    pendingApprovalCount,
  };
}

/**
 * Checks whether an expense amount exceeds the approval threshold.
 */
export function isApprovalRequired(amountPaisa: number, thresholdPaisa: number): boolean {
  return amountPaisa > thresholdPaisa;
}
