import type { Paisa } from '@pos/shared';

export interface PosCatalogItem {
  id: string;
  brandName: string;
  genericName: string;
  strength: string;
  form: string;
  manufacturer: string;
  barcode: string | null;
  mrpPaisa: number;
  taxCategoryId: string;
  taxCategoryName: string;
  taxRateBp: number;
  isControlled: boolean;
  totalStock: number;
  earliestBatch: {
    id: string;
    batchNo: string;
    expiryDate: string;
    balance: number;
  } | null;
}

export type DiscountType = 'none' | 'percent' | 'flat';

export interface CartItem {
  id: string; // unique identifier for the line in cart
  product: PosCatalogItem;
  batchId?: string;
  batchNo?: string;
  expiryDate?: string;
  unitPricePaisa: Paisa;
  quantity: number;
  discountType: DiscountType;
  discountBp: number; // e.g. 1000 = 10%
  flatDiscountPaisa: Paisa;
  taxRateBp: number;
  isTaxExempt: boolean;
}

export interface CustomerInfo {
  name: string;
  phone: string;
  doctorName: string;
  notes: string;
}

export interface HeldCart {
  id: string;
  heldAt: string;
  cartLines: CartItem[];
  customer: CustomerInfo;
  totalPaisa: Paisa;
  note?: string;
}

export interface LineWarning {
  type: 'none' | 'near-expiry' | 'expired' | 'out-of-stock' | 'low-stock';
  message: string;
  daysToExpiry?: number;
  stockAvailable: number;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
}

export function computeLineWarning(line: CartItem): LineWarning {
  // 1. Check stock
  if (line.product.totalStock <= 0) {
    return {
      type: 'out-of-stock',
      message: 'Out of Stock (0 in stock)',
      stockAvailable: 0,
      color: '#b91c1c',
      bgColor: '#fee2e2',
      borderColor: '#fca5a5',
      icon: '⚠️',
    };
  }

  if (line.quantity > line.product.totalStock) {
    return {
      type: 'low-stock',
      message: `Exceeds Stock (${line.product.totalStock} available)`,
      stockAvailable: line.product.totalStock,
      color: '#c2410c',
      bgColor: '#ffedd5',
      borderColor: '#fdba74',
      icon: '⚠️',
    };
  }

  // 2. Check expiry if batch has expiry date
  if (line.expiryDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(line.expiryDate);
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) {
      return {
        type: 'expired',
        message: `Expired (Exp: ${line.expiryDate})`,
        stockAvailable: line.product.totalStock,
        daysToExpiry: diffDays,
        color: '#dc2626',
        bgColor: '#fef2f2',
        borderColor: '#fecaca',
        icon: '❌',
      };
    }

    if (diffDays <= 90) {
      return {
        type: 'near-expiry',
        message: `Near Expiry: ${diffDays}d left (Exp: ${line.expiryDate})`,
        stockAvailable: line.product.totalStock,
        daysToExpiry: diffDays,
        color: '#b45309',
        bgColor: '#fffbeb',
        borderColor: '#fde68a',
        icon: '⏳',
      };
    }
  }

  return {
    type: 'none',
    message: '',
    stockAvailable: line.product.totalStock,
    color: '',
    bgColor: '',
    borderColor: '',
    icon: '',
  };
}
