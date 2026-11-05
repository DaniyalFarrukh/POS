import type { ChequeStatus, PaymentMethod, PaymentStatus, UnpaidDocumentRecord } from '../types';

export interface CalculatedAllocation {
  documentType: 'invoice' | 'purchase';
  documentId: string;
  documentNumber: string;
  allocatedPaisa: number;
}

export interface AllocationCalculationResult {
  allocations: CalculatedAllocation[];
  totalAllocatedPaisa: number;
  advancePaisa: number;
}

/**
 * Automatically allocates payment amount across open documents in FIFO order.
 * Any residual amount beyond outstanding balances becomes an advance balance.
 */
export function calculateAutoAllocations(
  amountPaisa: number,
  documents: UnpaidDocumentRecord[]
): AllocationCalculationResult {
  if (amountPaisa <= 0) {
    return {
      allocations: [],
      totalAllocatedPaisa: 0,
      advancePaisa: 0,
    };
  }

  let remainingPaisa = amountPaisa;
  const allocations: CalculatedAllocation[] = [];

  for (const doc of documents) {
    if (remainingPaisa <= 0) break;
    if (doc.balanceDuePaisa <= 0) continue;

    const allocated = Math.min(remainingPaisa, doc.balanceDuePaisa);
    if (allocated > 0) {
      allocations.push({
        documentType: doc.documentType,
        documentId: doc.id,
        documentNumber: doc.documentNumber,
        allocatedPaisa: allocated,
      });
      remainingPaisa -= allocated;
    }
  }

  const totalAllocatedPaisa = amountPaisa - remainingPaisa;
  const advancePaisa = remainingPaisa;

  return {
    allocations,
    totalAllocatedPaisa,
    advancePaisa,
  };
}

/**
 * Validates manual user allocations against a total payment amount.
 */
export function validateAllocations(
  amountPaisa: number,
  allocations: Array<{ allocatedPaisa: number; documentId: string }>
): {
  isValid: boolean;
  totalAllocatedPaisa: number;
  advancePaisa: number;
  error?: string;
} {
  if (amountPaisa <= 0) {
    return {
      isValid: false,
      totalAllocatedPaisa: 0,
      advancePaisa: 0,
      error: 'Payment amount must be greater than zero',
    };
  }

  let totalAllocated = 0;
  for (const a of allocations) {
    if (a.allocatedPaisa < 0) {
      return {
        isValid: false,
        totalAllocatedPaisa: 0,
        advancePaisa: 0,
        error: 'Allocated amount cannot be negative',
      };
    }
    totalAllocated += a.allocatedPaisa;
  }

  if (totalAllocated > amountPaisa) {
    return {
      isValid: false,
      totalAllocatedPaisa: totalAllocated,
      advancePaisa: 0,
      error: 'Total allocated amount cannot exceed payment amount',
    };
  }

  return {
    isValid: true,
    totalAllocatedPaisa: totalAllocated,
    advancePaisa: amountPaisa - totalAllocated,
  };
}

/**
 * Formats cheque status styling and label.
 */
export function getChequeStatusMeta(status?: ChequeStatus | null): {
  label: string;
  badgeClass: string;
} {
  switch (status) {
    case 'cleared':
      return {
        label: 'Cleared',
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
      };
    case 'bounced':
      return {
        label: 'Bounced',
        badgeClass: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
      };
    case 'pending':
    default:
      return {
        label: 'Pending Clearing',
        badgeClass: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
      };
  }
}

/**
 * Formats payment status styling and label.
 */
export function getPaymentStatusMeta(status: PaymentStatus): {
  label: string;
  badgeClass: string;
} {
  switch (status) {
    case 'reversed':
      return {
        label: 'Reversed',
        badgeClass: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
      };
    case 'completed':
    default:
      return {
        label: 'Completed',
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
      };
  }
}

/**
 * Formats payment method styling and label.
 */
export function getPaymentMethodMeta(method: PaymentMethod): {
  label: string;
  badgeClass: string;
} {
  switch (method) {
    case 'cash':
      return {
        label: 'Cash',
        badgeClass: 'bg-green-500/10 text-green-400 border border-green-500/20',
      };
    case 'bank':
      return {
        label: 'Bank Transfer',
        badgeClass: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
      };
    case 'wallet':
      return {
        label: 'Mobile Wallet',
        badgeClass: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
      };
    case 'cheque':
      return {
        label: 'Cheque',
        badgeClass: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
      };
  }
}
