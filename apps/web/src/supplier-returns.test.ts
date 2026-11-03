import { describe, it, expect } from 'vitest';
import {
  getSupplierReturnStatusDetails,
  calculateSupplierReturnKPIs,
  validateSupplierReturnForm,
  type SupplierReturnLineInput,
} from './lib/supplier-return-utils';
import type { SupplierReturnRecord } from './types';

describe('Supplier Returns Web Utilities & Logic', () => {
  it('correctly maps status details and badges', () => {
    const completed = getSupplierReturnStatusDetails('completed');
    expect(completed.label).toBe('Completed & Posted');
    expect(completed.badgeClass).toContain('emerald');

    const draft = getSupplierReturnStatusDetails('draft');
    expect(draft.label).toBe('Draft');
    expect(draft.badgeClass).toContain('slate');

    const cancelled = getSupplierReturnStatusDetails('cancelled');
    expect(cancelled.label).toBe('Cancelled');
    expect(cancelled.badgeClass).toContain('rose');
  });

  it('calculates KPI metrics across supplier return records', () => {
    const mockReturns: Partial<SupplierReturnRecord>[] = [
      { id: '1', status: 'completed', totalPaisa: 500000 },
      { id: '2', status: 'completed', totalPaisa: 250000 },
      { id: '3', status: 'cancelled', totalPaisa: 100000 },
    ];

    const kpis = calculateSupplierReturnKPIs(mockReturns as SupplierReturnRecord[]);
    expect(kpis.totalReturns).toBe(3);
    expect(kpis.totalReturnedPaisa).toBe(750000);
  });

  describe('Supplier Return Form Validation & On-Hand Constraint', () => {
    it('rejects missing branch, supplier, or reason', () => {
      const result = validateSupplierReturnForm({
        branchId: '',
        supplierId: '',
        reason: '',
        lines: [
          {
            productId: 'p1',
            batchId: 'b1',
            quantity: 5,
            availableOnHand: 10,
            unitCostPaisa: 1000,
          },
        ],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.branchId).toBeDefined();
      expect(result.errors.supplierId).toBeDefined();
      expect(result.errors.reason).toBeDefined();
    });

    it('rejects attempt to return more than on-hand quantity', () => {
      const lines: SupplierReturnLineInput[] = [
        {
          productId: 'p1',
          batchId: 'b1',
          quantity: 25,
          availableOnHand: 20, // requested 25 > 20 available!
          unitCostPaisa: 1500,
        },
      ];

      const result = validateSupplierReturnForm({
        branchId: 'branch-1',
        supplierId: 'supp-1',
        reason: 'Damaged bottles',
        lines,
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.line_0_qty).toMatch(/cannot return 25 units/i);
    });

    it('accepts valid return when quantity is within available on-hand stock', () => {
      const lines: SupplierReturnLineInput[] = [
        {
          productId: 'p1',
          batchId: 'b1',
          quantity: 15,
          availableOnHand: 20,
          unitCostPaisa: 1500,
        },
      ];

      const result = validateSupplierReturnForm({
        branchId: 'branch-1',
        supplierId: 'supp-1',
        reason: 'Expired packaging',
        lines,
      });

      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });
  });
});

