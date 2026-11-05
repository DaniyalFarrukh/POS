import type { PayrollRunRecord } from '../types';

export function formatPKR(paisa: number): string {
  const rs = (paisa / 100).toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Rs. ${rs}`;
}

export function getPayrollStatusBadge(status: PayrollRunRecord['status']): {
  label: string;
  variant: 'default' | 'success' | 'destructive' | 'warning' | 'secondary';
} {
  switch (status) {
    case 'draft':
      return { label: 'Draft', variant: 'secondary' };
    case 'reviewed':
      return { label: 'Reviewed', variant: 'warning' };
    case 'approved':
      return { label: 'Approved (Locked)', variant: 'default' };
    case 'posted':
      return { label: 'Posted to Ledger', variant: 'warning' };
    case 'paid':
      return { label: 'Paid & Disbursed', variant: 'success' };
    case 'cancelled':
      return { label: 'Cancelled', variant: 'destructive' };
    default:
      return { label: status, variant: 'default' };
  }
}

export function formatAllowancesSummary(breakdownJson?: string | null): string {
  if (!breakdownJson) return 'None';
  try {
    const list = JSON.parse(breakdownJson);
    if (!Array.isArray(list) || list.length === 0) return 'None';
    return list
      .map((a: { name: string; amountPaisa: number }) => `${a.name}: ${formatPKR(a.amountPaisa)}`)
      .join(', ');
  } catch {
    return 'None';
  }
}

export function formatStatutorySummary(breakdownJson?: string | null): string {
  if (!breakdownJson) return 'None';
  try {
    const list = JSON.parse(breakdownJson);
    if (!Array.isArray(list) || list.length === 0) return 'None';
    return list
      .map((s: { code: string; amountPaisa: number }) => `${s.code}: ${formatPKR(s.amountPaisa)}`)
      .join(', ');
  } catch {
    return 'None';
  }
}

export function filterPayrollRuns(
  runs: PayrollRunRecord[],
  filter: { branchId?: string; month?: string; status?: string }
): PayrollRunRecord[] {
  return runs.filter((run) => {
    if (filter.branchId && filter.branchId !== 'all' && run.branchId !== filter.branchId) {
      return false;
    }
    if (filter.month && filter.month !== 'all' && run.month !== filter.month) {
      return false;
    }
    if (filter.status && filter.status !== 'all' && run.status !== filter.status) {
      return false;
    }
    return true;
  });
}
