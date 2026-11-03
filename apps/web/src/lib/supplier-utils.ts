import type { UserRole } from '@pos/shared';

export interface SupplierItem {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxNumber: string | null;
  paymentTermsDays: number;
  creditLimitPaisa: number;
  openingBalancePaisa: number;
  payableBalancePaisa: number;
  overduePayablePaisa: number;
  isActive: boolean;
  purchaseCount: number;
  lastPurchaseDate: string | null;
}

export interface SupplierFormData {
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  paymentTermsDays: number;
  creditLimitPKR: string;
  openingBalancePKR: string;
}

export interface SupplierFormValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  creditLimitPaisa: number;
  openingBalancePaisa: number;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSupplierForm(data: SupplierFormData): SupplierFormValidationResult {
  const errors: Record<string, string> = {};

  if (!data.name || !data.name.trim()) {
    errors.name = 'Supplier name is required.';
  }

  if (data.email && data.email.trim() && !EMAIL_REGEX.test(data.email.trim())) {
    errors.email = 'Please enter a valid email address.';
  }

  if (
    typeof data.paymentTermsDays !== 'number' ||
    isNaN(data.paymentTermsDays) ||
    data.paymentTermsDays < 0
  ) {
    errors.paymentTermsDays = 'Payment terms must be a non-negative number of days.';
  }

  let creditLimitPaisa = 0;
  if (data.creditLimitPKR !== undefined && data.creditLimitPKR !== '') {
    const parsed = parseFloat(data.creditLimitPKR);
    if (isNaN(parsed) || parsed < 0) {
      errors.creditLimitPKR = 'Credit limit must be a valid positive amount.';
    } else {
      creditLimitPaisa = Math.round(parsed * 100);
    }
  }

  let openingBalancePaisa = 0;
  if (data.openingBalancePKR !== undefined && data.openingBalancePKR !== '') {
    const parsed = parseFloat(data.openingBalancePKR);
    if (isNaN(parsed) || parsed < 0) {
      errors.openingBalancePKR = 'Opening balance must be a valid numeric amount.';
    } else {
      openingBalancePaisa = Math.round(parsed * 100);
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    creditLimitPaisa,
    openingBalancePaisa,
  };
}

export function canManageSuppliers(role: UserRole): boolean {
  return role === 'owner' || role === 'manager' || role === 'accountant';
}

export function canViewSuppliers(role: UserRole): boolean {
  return role === 'owner' || role === 'manager' || role === 'accountant' || role === 'pharmacist';
}

export interface SupplierKPIs {
  totalPayablePaisa: number;
  overduePayablePaisa: number;
  activeSuppliersCount: number;
}

export function calculateSupplierKPIs(suppliers: SupplierItem[]): SupplierKPIs {
  let totalPayablePaisa = 0;
  let overduePayablePaisa = 0;
  let activeSuppliersCount = 0;

  for (const s of suppliers) {
    totalPayablePaisa += s.payableBalancePaisa || 0;
    overduePayablePaisa += s.overduePayablePaisa || 0;
    if (s.isActive) {
      activeSuppliersCount++;
    }
  }

  return {
    totalPayablePaisa,
    overduePayablePaisa,
    activeSuppliersCount,
  };
}

function normalizePhone(p?: string | null): string {
  if (!p) return '';
  return p.replace(/[\s\-+()]/g, '');
}

function normalizeName(n: string): string {
  return n.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface DuplicateGroup {
  reason: string;
  candidates: SupplierItem[];
}

export function findDuplicateSuppliers(suppliers: SupplierItem[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const seenPair = new Set<string>();

  for (let i = 0; i < suppliers.length; i++) {
    for (let j = i + 1; j < suppliers.length; j++) {
      const s1 = suppliers[i]!;
      const s2 = suppliers[j]!;

      const nameMatch = normalizeName(s1.name) === normalizeName(s2.name);
      const phone1 = normalizePhone(s1.phone);
      const phone2 = normalizePhone(s2.phone);
      const phoneMatch = phone1 && phone2 && phone1.length >= 7 && phone1 === phone2;

      if (nameMatch || phoneMatch) {
        const pairKey = [s1.id, s2.id].sort().join(':');
        if (!seenPair.has(pairKey)) {
          seenPair.add(pairKey);
          groups.push({
            reason:
              nameMatch && phoneMatch
                ? 'Matching Name and Phone Number'
                : nameMatch
                ? 'Identical Supplier Name'
                : 'Identical Phone Number',
            candidates: [s1, s2],
          });
        }
      }
    }
  }

  return groups;
}
