import type { StockCountRecord, StockCountStatus, StockCountKPIs } from '../types';

export interface CountStatusMeta {
  label: string;
  badgeClass: string;
}

export function getCountStatusDetails(status: StockCountStatus): CountStatusMeta {
  switch (status) {
    case 'draft':
      return {
        label: 'Draft',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
      };
    case 'submitted':
      return {
        label: 'Pending Approval',
        badgeClass: 'bg-blue-100 text-blue-700 border-blue-300',
      };
    case 'approved':
      return {
        label: 'Approved & Posted',
        badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-300',
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        badgeClass: 'bg-rose-100 text-rose-700 border-rose-300',
      };
    default:
      return {
        label: status,
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
      };
  }
}

export function calculateCountKPIs(counts: StockCountRecord[]): StockCountKPIs {
  let draftCount = 0;
  let submittedCount = 0;
  let approvedCount = 0;
  let totalVariancePaisa = 0;

  for (const c of counts) {
    if (c.status === 'draft') draftCount++;
    if (c.status === 'submitted') submittedCount++;
    if (c.status === 'approved') approvedCount++;

    if (c.lines) {
      for (const line of c.lines) {
        totalVariancePaisa += line.variancePaisa;
      }
    }
  }

  return {
    totalCounts: counts.length,
    draftCount,
    submittedCount,
    approvedCount,
    totalVariancePaisa,
  };
}

export function calculateLineVariance(
  systemQty: number,
  countedQty: number,
  costPaisa: number
): { varianceQuantity: number; variancePaisa: number } {
  const varianceQuantity = countedQty - systemQty;
  const variancePaisa = varianceQuantity * costPaisa;
  return { varianceQuantity, variancePaisa };
}

export function canApproveCount(role?: string): boolean {
  return role === 'owner' || role === 'manager';
}

