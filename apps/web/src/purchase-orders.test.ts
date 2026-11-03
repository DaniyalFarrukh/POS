import { describe, it, expect } from 'vitest';
import {
  validatePOForm,
  calculatePOTotals,
  canApprovePO,
  canManagePO,
  canReceivePO,
  getPOStatusDetails,
} from './lib/po-utils';

describe('Web Purchase Orders Domain Utilities & Validation', () => {
  it('accepts a fully valid purchase order form', () => {
    const res = validatePOForm({
      supplierId: '0192e212-32b0-7111-9a41-111111111111',
      branchId: '0192e212-32b0-7111-9a41-222222222222',
      issueDate: '2026-11-03',
      expectedDeliveryDate: '2026-11-10',
      overReceiptPolicy: 'flag',
      notes: 'Urgent medical inventory order',
      lines: [
        {
          productId: '0192e212-32b0-7111-9a41-333333333333',
          quantityOrdered: 50,
          expectedCostPaisa: 2500,
        },
      ],
    });

    expect(res.isValid).toBe(true);
    expect(Object.keys(res.errors)).toHaveLength(0);
  });

  it('rejects purchase order with missing supplier or branch', () => {
    const res = validatePOForm({
      supplierId: '',
      branchId: '',
      issueDate: '2026-11-03',
      expectedDeliveryDate: '',
      overReceiptPolicy: 'reject',
      notes: '',
      lines: [
        {
          productId: '0192e212-32b0-7111-9a41-333333333333',
          quantityOrdered: 10,
          expectedCostPaisa: 1000,
        },
      ],
    });

    expect(res.isValid).toBe(false);
    expect(res.errors.supplierId).toBeDefined();
    expect(res.errors.branchId).toBeDefined();
  });

  it('rejects purchase order with invalid line items (zero qty or negative cost)', () => {
    const resZeroQty = validatePOForm({
      supplierId: '0192e212-32b0-7111-9a41-111111111111',
      branchId: '0192e212-32b0-7111-9a41-222222222222',
      issueDate: '2026-11-03',
      expectedDeliveryDate: '',
      overReceiptPolicy: 'flag',
      notes: '',
      lines: [
        {
          productId: '0192e212-32b0-7111-9a41-333333333333',
          quantityOrdered: 0,
          expectedCostPaisa: 1000,
        },
      ],
    });

    expect(resZeroQty.isValid).toBe(false);
    expect(resZeroQty.errors.lines).toMatch(/quantity must be a positive integer/i);

    const resNegCost = validatePOForm({
      supplierId: '0192e212-32b0-7111-9a41-111111111111',
      branchId: '0192e212-32b0-7111-9a41-222222222222',
      issueDate: '2026-11-03',
      expectedDeliveryDate: '',
      overReceiptPolicy: 'flag',
      notes: '',
      lines: [
        {
          productId: '0192e212-32b0-7111-9a41-333333333333',
          quantityOrdered: 10,
          expectedCostPaisa: -500,
        },
      ],
    });

    expect(resNegCost.isValid).toBe(false);
    expect(resNegCost.errors.lines).toMatch(/cost must be non-negative/i);
  });

  it('correctly calculates total ordered quantity and total expected cost in paisa', () => {
    const lines = [
      { quantityOrdered: 100, expectedCostPaisa: 2500 }, // 250,000 paisa
      { quantityOrdered: 40, expectedCostPaisa: 18000 }, // 720,000 paisa
      { quantityOrdered: 10, expectedCostPaisa: 500 },   // 5,000 paisa
    ];

    const totals = calculatePOTotals(lines);
    expect(totals.totalQuantity).toBe(150);
    expect(totals.totalCostPaisa).toBe(975000);
  });

  it('strictly validates approval and management role permissions', () => {
    expect(canApprovePO('owner')).toBe(true);
    expect(canApprovePO('manager')).toBe(true);
    expect(canApprovePO('accountant')).toBe(false);
    expect(canApprovePO('pharmacist')).toBe(false);
    expect(canApprovePO('cashier')).toBe(false);

    expect(canManagePO('owner')).toBe(true);
    expect(canManagePO('manager')).toBe(true);
    expect(canManagePO('pharmacist')).toBe(false);

    expect(canReceivePO('owner')).toBe(true);
    expect(canReceivePO('manager')).toBe(true);
    expect(canReceivePO('pharmacist')).toBe(true);
    expect(canReceivePO('cashier')).toBe(false);
  });

  it('maps all PO workflow statuses to appropriate badge variants', () => {
    expect(getPOStatusDetails('draft').label).toBe('Draft');
    expect(getPOStatusDetails('approved').label).toBe('Approved');
    expect(getPOStatusDetails('sent').label).toBe('Sent to Supplier');
    expect(getPOStatusDetails('partially_received').label).toBe('Partially Received');
    expect(getPOStatusDetails('received').variant).toBe('success');
    expect(getPOStatusDetails('cancelled').variant).toBe('destructive');
  });
});

