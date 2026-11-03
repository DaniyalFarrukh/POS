import { formatPaisa } from './formatters';

export interface ReconciliationStatus {
  isBalanced: boolean;
  diffPaisa: number;
  badgeText: string;
  badgeClass: string;
}

export function calculateReconciliationStatus(
  stockValuePaisa: number,
  ledgerBalancePaisa: number
): ReconciliationStatus {
  const diffPaisa = stockValuePaisa - ledgerBalancePaisa;
  const isBalanced = diffPaisa === 0;

  if (isBalanced) {
    return {
      isBalanced: true,
      diffPaisa: 0,
      badgeText: 'Balanced (Diff: Rs. 0.00)',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  }

  const sign = diffPaisa > 0 ? '+' : '';
  return {
    isBalanced: false,
    diffPaisa,
    badgeText: `Difference: ${sign}${formatPaisa(diffPaisa)}`,
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
  };
}

export interface ExpiryStatusDetails {
  label: string;
  colorClass: string;
  isExpired: boolean;
  isCritical: boolean;
}

export function getExpiryStatusDetails(
  expiryDate: string,
  daysUntilExpiry: number
): ExpiryStatusDetails {
  if (daysUntilExpiry < 0) {
    return {
      label: `Expired (${Math.abs(daysUntilExpiry)}d ago)`,
      colorClass: 'bg-rose-100 text-rose-800 border-rose-300',
      isExpired: true,
      isCritical: true,
    };
  }

  if (daysUntilExpiry <= 30) {
    return {
      label: `Expires in ${daysUntilExpiry}d`,
      colorClass: 'bg-rose-50 text-rose-700 border-rose-200',
      isExpired: false,
      isCritical: true,
    };
  }

  if (daysUntilExpiry <= 60) {
    return {
      label: `Expires in ${daysUntilExpiry}d`,
      colorClass: 'bg-amber-50 text-amber-700 border-amber-200',
      isExpired: false,
      isCritical: false,
    };
  }

  if (daysUntilExpiry <= 90) {
    return {
      label: `Expires in ${daysUntilExpiry}d`,
      colorClass: 'bg-blue-50 text-blue-700 border-blue-200',
      isExpired: false,
      isCritical: false,
    };
  }

  return {
    label: `Valid (${expiryDate})`,
    colorClass: 'bg-slate-50 text-slate-700 border-slate-200',
    isExpired: false,
    isCritical: false,
  };
}

export interface MovementBadgeInfo {
  label: string;
  className: string;
}

export function getMovementTypeBadge(type: string): MovementBadgeInfo {
  switch (type) {
    case 'purchase':
      return { label: 'Goods Received (GRN)', className: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
    case 'sale':
      return { label: 'Sale (Invoice)', className: 'bg-blue-100 text-blue-800 border-blue-300' };
    case 'return':
      return { label: 'Return', className: 'bg-purple-100 text-purple-800 border-purple-300' };
    case 'adjustment':
      return { label: 'Adjustment / Write-off', className: 'bg-amber-100 text-amber-800 border-amber-300' };
    case 'transfer_in':
      return { label: 'Transfer In', className: 'bg-teal-100 text-teal-800 border-teal-300' };
    case 'transfer_out':
      return { label: 'Transfer Out', className: 'bg-orange-100 text-orange-800 border-orange-300' };
    default:
      return { label: type, className: 'bg-slate-100 text-slate-800 border-slate-300' };
  }
}

export function validateWriteOffInput(
  quantity: number,
  onHandQuantity: number,
  reason: string
): { isValid: boolean; error?: string } {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { isValid: false, error: 'Write-off quantity must be a positive integer' };
  }
  if (quantity > onHandQuantity) {
    return {
      isValid: false,
      error: `Cannot write off ${quantity} units. On-hand quantity is ${onHandQuantity}.`,
    };
  }
  if (!reason || !reason.trim()) {
    return { isValid: false, error: 'Reason for write-off is required' };
  }
  return { isValid: true };
}

export function validateDiscountInput(
  mrpPaisa: number
): { isValid: boolean; error?: string } {
  if (!Number.isInteger(mrpPaisa) || mrpPaisa < 0) {
    return { isValid: false, error: 'Price must be a non-negative integer in paisa' };
  }
  return { isValid: true };
}
