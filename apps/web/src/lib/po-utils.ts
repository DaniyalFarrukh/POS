import type { POStatus, OverReceiptPolicy } from '../types';

export interface POLineInput {
  productId: string;
  quantityOrdered: number;
  expectedCostPaisa: number;
}

export interface POFormState {
  supplierId: string;
  branchId: string;
  issueDate: string;
  expectedDeliveryDate: string;
  overReceiptPolicy: OverReceiptPolicy;
  notes: string;
  lines: POLineInput[];
}

export interface POFormErrors {
  supplierId?: string;
  branchId?: string;
  issueDate?: string;
  lines?: string;
}

export function validatePOForm(form: POFormState): { isValid: boolean; errors: POFormErrors } {
  const errors: POFormErrors = {};

  if (!form.supplierId) {
    errors.supplierId = 'Supplier is required';
  }

  if (!form.branchId) {
    errors.branchId = 'Branch is required';
  }

  if (!form.issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(form.issueDate)) {
    errors.issueDate = 'Valid issue date (YYYY-MM-DD) is required';
  }

  if (!form.lines || form.lines.length === 0) {
    errors.lines = 'At least one line item is required';
  } else {
    for (let i = 0; i < form.lines.length; i++) {
      const line = form.lines[i]!;
      if (!line.productId) {
        errors.lines = `Line #${i + 1} product is required`;
        break;
      }
      if (!Number.isInteger(line.quantityOrdered) || line.quantityOrdered <= 0) {
        errors.lines = `Line #${i + 1} quantity must be a positive integer`;
        break;
      }
      if (!Number.isInteger(line.expectedCostPaisa) || line.expectedCostPaisa < 0) {
        errors.lines = `Line #${i + 1} cost must be non-negative integer paisa`;
        break;
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function calculatePOTotals(lines: Array<{ quantityOrdered: number; expectedCostPaisa: number }>): {
  totalQuantity: number;
  totalCostPaisa: number;
} {
  let totalQuantity = 0;
  let totalCostPaisa = 0;

  for (const line of lines) {
    totalQuantity += line.quantityOrdered;
    totalCostPaisa += line.quantityOrdered * line.expectedCostPaisa;
  }

  return {
    totalQuantity,
    totalCostPaisa,
  };
}

export function canApprovePO(role?: string): boolean {
  return role === 'owner' || role === 'manager';
}

export function canManagePO(role?: string): boolean {
  return role === 'owner' || role === 'manager';
}

export function canReceivePO(role?: string): boolean {
  return role === 'owner' || role === 'manager' || role === 'pharmacist';
}

export function getPOStatusDetails(status: POStatus): { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'outline' } {
  switch (status) {
    case 'draft':
      return { label: 'Draft', variant: 'outline' };
    case 'approved':
      return { label: 'Approved', variant: 'default' };
    case 'sent':
      return { label: 'Sent to Supplier', variant: 'warning' };
    case 'partially_received':
      return { label: 'Partially Received', variant: 'warning' };
    case 'received':
      return { label: 'Received (Completed)', variant: 'success' };
    case 'cancelled':
      return { label: 'Cancelled', variant: 'destructive' };
    default:
      return { label: status, variant: 'outline' };
  }
}

