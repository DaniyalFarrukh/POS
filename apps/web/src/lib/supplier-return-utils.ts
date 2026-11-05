import type { SupplierReturnRecord, SupplierReturnKPIs } from '../types';

export interface ReturnStatusMeta {
  label: string;
  badgeClass: string;
}

export function getSupplierReturnStatusDetails(status: string): ReturnStatusMeta {
  switch (status) {
    case 'completed':
      return {
        label: 'Completed & Posted',
        badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-300',
      };
    case 'draft':
      return {
        label: 'Draft',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
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

export function calculateSupplierReturnKPIs(returns: SupplierReturnRecord[]): SupplierReturnKPIs {
  let totalReturnedPaisa = 0;

  for (const r of returns) {
    if (r.status === 'completed') {
      totalReturnedPaisa += r.totalPaisa;
    }
  }

  return {
    totalReturns: returns.length,
    totalReturnedPaisa,
  };
}

export interface SupplierReturnLineInput {
  productId: string;
  batchId: string;
  quantity: number;
  availableOnHand: number;
  unitCostPaisa: number;
  reason?: string;
}

export function validateSupplierReturnForm(params: {
  branchId: string;
  supplierId: string;
  reason: string;
  lines: SupplierReturnLineInput[];
}): { isValid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  if (!params.branchId) {
    errors.branchId = 'Branch selection is required';
  }
  if (!params.supplierId) {
    errors.supplierId = 'Supplier selection is required';
  }
  if (!params.reason || params.reason.trim().length === 0) {
    errors.reason = 'Return reason is required';
  }

  if (!params.lines || params.lines.length === 0) {
    errors.lines = 'At least one item must be added for return';
  } else {
    params.lines.forEach((line, i) => {
      if (!line.productId) {
        errors[`line_${i}_product`] = 'Product is required';
      }
      if (!line.batchId) {
        errors[`line_${i}_batch`] = 'Batch is required';
      }
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        errors[`line_${i}_qty`] = 'Quantity must be greater than zero';
      } else if (line.quantity > line.availableOnHand) {
        errors[`line_${i}_qty`] =
          `Cannot return ${line.quantity} units (only ${line.availableOnHand} on hand)`;
      }
    });
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
