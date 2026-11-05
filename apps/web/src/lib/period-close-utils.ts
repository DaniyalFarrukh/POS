import type { FiscalPeriodItem, PeriodChecklistItem } from '../types';

export function formatPaisa(paisa: number): string {
  const pkr = paisa / 100;
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pkr);
}

export function formatPeriodDateRange(startDate: string, endDate: string): string {
  if (!startDate || !endDate) return '';
  return `${startDate} to ${endDate}`;
}

export function getChecklistSummary(items: PeriodChecklistItem[]) {
  const total = items.length;
  const passed = items.filter((i) => i.status === 'passed').length;
  const warning = items.filter((i) => i.status === 'warning').length;
  const canClose = total > 0 && warning === 0;
  const readinessScore = total > 0 ? Math.round((passed / total) * 100) : 0;

  return {
    total,
    passed,
    warning,
    canClose,
    readinessScore,
  };
}

export function isYearEndPeriod(month: number): boolean {
  return month === 12;
}

export function validateReopenReason(reason: string): { isValid: boolean; error?: string } {
  const trimmed = reason.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Reopening reason is required' };
  }
  if (trimmed.length < 5) {
    return { isValid: false, error: 'Reopening reason must be at least 5 characters long' };
  }
  return { isValid: true };
}

export function filterPeriodsByYear(periods: FiscalPeriodItem[], year: number): FiscalPeriodItem[] {
  const prefix = `${year}-`;
  return periods.filter((p) => p.startDate.startsWith(prefix) || p.endDate.startsWith(prefix));
}
