import { describe, it, expect } from 'vitest';
import {
  formatPaisaToPkr,
  calculateCreditUtilization,
  getCreditStatus,
  filterCustomers,
} from './lib/customer-utils';
import type { CustomerRecord } from './types';

describe('Customer Utilities', () => {
  it('formats paisa to PKR properly', () => {
    expect(formatPaisaToPkr(100000)).toBe('Rs 1,000.00');
    expect(formatPaisaToPkr(5050)).toBe('Rs 50.50');
    expect(formatPaisaToPkr(0)).toBe('Rs 0.00');
    expect(formatPaisaToPkr(-2500)).toBe('-Rs 25.00');
  });

  it('calculates credit utilization percentage', () => {
    expect(calculateCreditUtilization(50000, 100000)).toBe(50);
    expect(calculateCreditUtilization(120000, 100000)).toBe(120);
    expect(calculateCreditUtilization(0, 100000)).toBe(0);
    expect(calculateCreditUtilization(50000, 0)).toBe(0);
  });

  it('evaluates credit status thresholds and badges', () => {
    expect(getCreditStatus(50000, 100000).status).toBe('normal');
    expect(getCreditStatus(85000, 100000).status).toBe('warning');
    expect(getCreditStatus(105000, 100000).status).toBe('exceeded');
    expect(getCreditStatus(50000, 0).status).toBe('none');
  });

  it('filters customers by search term and tab selection', () => {
    const list: CustomerRecord[] = [
      {
        id: '1',
        pharmacyId: 'p1',
        name: 'Ahmed Khan',
        phone: '03001234567',
        creditLimitPaisa: 100000,
        openingBalancePaisa: 0,
        currentBalancePaisa: 50000,
        isDuplicate: false,
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: '2',
        pharmacyId: 'p1',
        name: 'Bilal Hassan',
        phone: '03112223344',
        creditLimitPaisa: 50000,
        openingBalancePaisa: 0,
        currentBalancePaisa: 70000, // Exceeded
        isDuplicate: false,
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: '3',
        pharmacyId: 'p1',
        name: 'Bilal Duplicate',
        phone: '03112223344',
        creditLimitPaisa: 0,
        openingBalancePaisa: 0,
        currentBalancePaisa: 0,
        isDuplicate: true,
        duplicateOfId: '2',
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ];

    expect(filterCustomers(list, 'ahmed', 'all')).toHaveLength(1);
    expect(filterCustomers(list, '', 'with_balance')).toHaveLength(2);
    expect(filterCustomers(list, '', 'exceeded')).toHaveLength(1);
    expect(filterCustomers(list, '', 'exceeded')[0]!.id).toBe('2');
    expect(filterCustomers(list, '', 'duplicates')).toHaveLength(1);
    expect(filterCustomers(list, '', 'duplicates')[0]!.id).toBe('3');
  });
});
