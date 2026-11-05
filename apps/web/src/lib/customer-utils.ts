import type { CustomerRecord } from '../types';

export function formatPaisaToPkr(paisa: number): string {
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(paisa);
  const rupees = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}Rs ${rupees.toLocaleString('en-PK')}.${cents.toString().padStart(2, '0')}`;
}

export function calculateCreditUtilization(balancePaisa: number, limitPaisa: number): number {
  if (limitPaisa <= 0) return 0;
  if (balancePaisa <= 0) return 0;
  return Math.round((balancePaisa / limitPaisa) * 100);
}

export function getCreditStatus(
  balancePaisa: number,
  limitPaisa: number
): { status: 'none' | 'normal' | 'warning' | 'exceeded'; badgeText: string; color: string } {
  if (limitPaisa <= 0) {
    return { status: 'none', badgeText: 'No Credit Limit', color: 'bg-gray-100 text-gray-700' };
  }
  const pct = (balancePaisa / limitPaisa) * 100;
  if (pct > 100) {
    return {
      status: 'exceeded',
      badgeText: `Exceeded (${Math.round(pct)}%)`,
      color: 'bg-red-100 text-red-800',
    };
  }
  if (pct >= 80) {
    return {
      status: 'warning',
      badgeText: `Near Limit (${Math.round(pct)}%)`,
      color: 'bg-amber-100 text-amber-800',
    };
  }
  return {
    status: 'normal',
    badgeText: `Normal (${Math.round(pct)}%)`,
    color: 'bg-emerald-100 text-emerald-800',
  };
}

export function filterCustomers(
  customers: CustomerRecord[],
  search: string,
  filterTab: 'all' | 'with_balance' | 'exceeded' | 'duplicates'
): CustomerRecord[] {
  const term = search.toLowerCase().trim();
  return customers.filter((c) => {
    // Search match
    if (term) {
      const matchName = c.name.toLowerCase().includes(term);
      const matchPhone = (c.phone || '').toLowerCase().includes(term);
      const matchEmail = (c.email || '').toLowerCase().includes(term);
      if (!matchName && !matchPhone && !matchEmail) return false;
    }

    // Filter tab
    const bal = c.currentBalancePaisa ?? 0;
    const limit = c.creditLimitPaisa ?? 0;
    if (filterTab === 'with_balance') return bal > 0;
    if (filterTab === 'exceeded') return limit > 0 && bal > limit;
    if (filterTab === 'duplicates') return Boolean(c.isDuplicate);
    return true;
  });
}
