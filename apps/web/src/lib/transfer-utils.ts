import type { StockTransferRecord, StockTransferStatus, StockTransferKPIs } from '../types';

export interface TransferStatusMeta {
  label: string;
  badgeClass: string;
  description: string;
}

export function getTransferStatusDetails(status: StockTransferStatus): TransferStatusMeta {
  switch (status) {
    case 'draft':
      return {
        label: 'Draft',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
        description: 'Created and pending dispatch; stock still sellable at source.',
      };
    case 'in_transit':
      return {
        label: 'In Transit',
        badgeClass: 'bg-blue-100 text-blue-700 border-blue-300',
        description: 'Dispatched from source; stock is in-transit and not sellable at either location.',
      };
    case 'received':
      return {
        label: 'Received',
        badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-300',
        description: 'Received at destination location; sellable at destination branch.',
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        badgeClass: 'bg-rose-100 text-rose-700 border-rose-300',
        description: 'Transfer cancelled before dispatch.',
      };
    default:
      return {
        label: status,
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
        description: 'Unknown status',
      };
  }
}

export function calculateTransferKPIs(transfers: StockTransferRecord[]): StockTransferKPIs {
  let inTransitCount = 0;
  let receivedCount = 0;
  let shortageCount = 0;

  for (const t of transfers) {
    if (t.status === 'in_transit') inTransitCount++;
    if (t.status === 'received') receivedCount++;
    if (t.hasShortage) shortageCount++;
  }

  return {
    totalCount: transfers.length,
    inTransitCount,
    receivedCount,
    shortageCount,
  };
}

export interface CreateTransferLineInput {
  productId: string;
  batchId: string;
  quantityRequested: number;
}

export interface CreateTransferValidation {
  isValid: boolean;
  errors: Record<string, string>;
}

export function validateCreateTransferForm(params: {
  sourceBranchId: string;
  sourceLocationId?: string;
  destinationBranchId: string;
  destinationLocationId?: string;
  lines: CreateTransferLineInput[];
}): CreateTransferValidation {
  const errors: Record<string, string> = {};

  if (!params.sourceBranchId) {
    errors.sourceBranchId = 'Source branch is required';
  }
  if (!params.destinationBranchId) {
    errors.destinationBranchId = 'Destination branch is required';
  }

  if (
    params.sourceBranchId &&
    params.destinationBranchId &&
    params.sourceBranchId === params.destinationBranchId
  ) {
    if (
      params.sourceLocationId &&
      params.destinationLocationId &&
      params.sourceLocationId === params.destinationLocationId
    ) {
      errors.destinationLocationId =
        'Source and destination location cannot be identical in the same branch';
    } else if (!params.sourceLocationId && !params.destinationLocationId) {
      errors.destinationBranchId =
        'Cannot transfer to the exact same branch without differing locations';
    }
  }

  if (!params.lines || params.lines.length === 0) {
    errors.lines = 'At least one line item is required';
  } else {
    params.lines.forEach((line, i) => {
      if (!line.productId) {
        errors[`line_${i}_product`] = 'Product selection is required';
      }
      if (!line.batchId) {
        errors[`line_${i}_batch`] = 'Batch selection is required';
      }
      if (!Number.isInteger(line.quantityRequested) || line.quantityRequested <= 0) {
        errors[`line_${i}_qty`] = 'Quantity must be a positive integer';
      }
    });
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export interface ReceiveLineInput {
  lineId: string;
  quantityDispatched: number;
  quantityReceived: number;
  shortageQuantity: number;
  shortageReason?: string;
}

export function validateReceiveTransferForm(lines: ReceiveLineInput[]): {
  isValid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!lines || lines.length === 0) {
    errors.general = 'No lines to receive';
    return { isValid: false, errors };
  }

  lines.forEach((line, i) => {
    if (!Number.isInteger(line.quantityReceived) || line.quantityReceived < 0) {
      errors[`line_${i}_rec`] = 'Received quantity cannot be negative';
    }
    if (!Number.isInteger(line.shortageQuantity) || line.shortageQuantity < 0) {
      errors[`line_${i}_short`] = 'Shortage quantity cannot be negative';
    }

    if (line.quantityReceived + line.shortageQuantity !== line.quantityDispatched) {
      errors[`line_${i}_balance`] = `Received (${line.quantityReceived}) + Shortage (${line.shortageQuantity}) must equal Dispatched (${line.quantityDispatched})`;
    }

    if (line.shortageQuantity > 0 && (!line.shortageReason || line.shortageReason.trim().length === 0)) {
      errors[`line_${i}_reason`] = 'Shortage reason is required when shortage is reported';
    }
  });

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
