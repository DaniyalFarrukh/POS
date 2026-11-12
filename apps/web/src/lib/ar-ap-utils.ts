import type { AgingSummary, ReconciliationCheck } from '../types';

export type AgingBucketKey = 'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'days90Plus';

export function getAgingBucketMeta(bucket: AgingBucketKey): {
  label: string;
  badgeClass: string;
} {
  switch (bucket) {
    case 'current':
      return {
        label: 'Current (0d)',
        badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      };
    case 'days1to30':
      return {
        label: '1 - 30 Days',
        badgeClass: 'bg-blue-50 text-[#2F64D8] border border-blue-200',
      };
    case 'days31to60':
      return {
        label: '31 - 60 Days',
        badgeClass: 'bg-amber-50 text-amber-800 border border-amber-200',
      };
    case 'days61to90':
      return {
        label: '61 - 90 Days',
        badgeClass: 'bg-orange-50 text-orange-800 border border-orange-200',
      };
    case 'days90Plus':
      return {
        label: '90+ Days',
        badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200 font-semibold',
      };
  }
}

export function calculateDaysDifference(asOfDateStr: string, entryDateStr: string): number {
  const asOf = new Date(asOfDateStr);
  const entry = new Date(entryDateStr);
  const diffTime = asOf.getTime() - entry.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

export function classifyAgingBucket(days: number): AgingBucketKey {
  if (days <= 0) return 'current';
  if (days <= 30) return 'days1to30';
  if (days <= 60) return 'days31to60';
  if (days <= 90) return 'days61to90';
  return 'days90Plus';
}

export function checkReconciliation(
  controlAccountBalancePaisa: number,
  sumOfPartyBalancesPaisa: number
): ReconciliationCheck {
  const differencePaisa = controlAccountBalancePaisa - sumOfPartyBalancesPaisa;
  return {
    controlAccountBalancePaisa,
    sumOfPartyBalancesPaisa,
    differencePaisa,
    isReconciled: differencePaisa === 0,
  };
}

export function computeAgingPercentages(
  aging: AgingSummary,
  totalPaisa: number
): Record<AgingBucketKey, number> {
  if (totalPaisa <= 0) {
    return {
      current: 0,
      days1to30: 0,
      days31to60: 0,
      days61to90: 0,
      days90Plus: 0,
    };
  }

  return {
    current: Math.round((aging.currentPaisa / totalPaisa) * 100),
    days1to30: Math.round((aging.days1to30Paisa / totalPaisa) * 100),
    days31to60: Math.round((aging.days31to60Paisa / totalPaisa) * 100),
    days61to90: Math.round((aging.days61to90Paisa / totalPaisa) * 100),
    days90Plus: Math.round((aging.days90PlusPaisa / totalPaisa) * 100),
  };
}
