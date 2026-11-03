import { describe, it, expect } from 'vitest';
import {
  calculateReconciliationStatus,
  getExpiryStatusDetails,
  getMovementTypeBadge,
  validateWriteOffInput,
  validateDiscountInput,
} from './lib/stock-utils';

describe('Stock Management & Reconciliation Utilities', () => {
  it('calculates reconciliation status accurately', () => {
    // 1. Perfectly balanced (stock value equals ledger balance)
    const balanced = calculateReconciliationStatus(1500000, 1500000);
    expect(balanced.isBalanced).toBe(true);
    expect(balanced.diffPaisa).toBe(0);
    expect(balanced.badgeText).toContain('Balanced');

    // 2. Stock value exceeds ledger balance by 50,000 paisa (Rs. 500)
    const surplus = calculateReconciliationStatus(1550000, 1500000);
    expect(surplus.isBalanced).toBe(false);
    expect(surplus.diffPaisa).toBe(50000);
    expect(surplus.badgeText).toContain('+Rs. 500.00');

    // 3. Ledger balance exceeds stock value by 20,000 paisa (Rs. 200 deficit)
    const deficit = calculateReconciliationStatus(1480000, 1500000);
    expect(deficit.isBalanced).toBe(false);
    expect(deficit.diffPaisa).toBe(-20000);
    expect(deficit.badgeText).toContain('-Rs. 200.00');
  });

  it('correctly categorizes batch expiry status and windows', () => {
    // Expired 5 days ago
    const exp = getExpiryStatusDetails('2026-10-30', -5);
    expect(exp.isExpired).toBe(true);
    expect(exp.isCritical).toBe(true);
    expect(exp.label).toContain('Expired (5d ago)');

    // Expiring in 15 days (<= 30)
    const exp30 = getExpiryStatusDetails('2026-11-19', 15);
    expect(exp30.isExpired).toBe(false);
    expect(exp30.isCritical).toBe(true);
    expect(exp30.label).toBe('Expires in 15d');

    // Expiring in 45 days (31 - 60)
    const exp60 = getExpiryStatusDetails('2026-12-19', 45);
    expect(exp60.isExpired).toBe(false);
    expect(exp60.isCritical).toBe(false);
    expect(exp60.label).toBe('Expires in 45d');

    // Expiring in 80 days (61 - 90)
    const exp90 = getExpiryStatusDetails('2027-01-23', 80);
    expect(exp90.isExpired).toBe(false);
    expect(exp90.label).toBe('Expires in 80d');

    // Far in the future (300 days)
    const valid = getExpiryStatusDetails('2027-08-31', 300);
    expect(valid.isExpired).toBe(false);
    expect(valid.label).toContain('Valid');
  });

  it('maps stock movement types to human badges', () => {
    expect(getMovementTypeBadge('purchase').label).toContain('Goods Received');
    expect(getMovementTypeBadge('sale').label).toContain('Sale');
    expect(getMovementTypeBadge('return').label).toContain('Return');
    expect(getMovementTypeBadge('adjustment').label).toContain('Adjustment');
    expect(getMovementTypeBadge('transfer_in').label).toContain('Transfer In');
    expect(getMovementTypeBadge('transfer_out').label).toContain('Transfer Out');
  });

  it('validates write-off quantities and reasons', () => {
    // Valid on-hand write off
    expect(validateWriteOffInput(10, 10, 'Expired stock').isValid).toBe(true);
    expect(validateWriteOffInput(5, 10, 'Damaged during handling').isValid).toBe(true);

    // Excess quantity rejected
    const excess = validateWriteOffInput(11, 10, 'Expired');
    expect(excess.isValid).toBe(false);
    expect(excess.error).toContain('On-hand quantity is 10');

    // Non-positive quantity
    expect(validateWriteOffInput(0, 10, 'Expired').isValid).toBe(false);
    expect(validateWriteOffInput(-5, 10, 'Expired').isValid).toBe(false);

    // Empty reason
    expect(validateWriteOffInput(5, 10, '').isValid).toBe(false);
    expect(validateWriteOffInput(5, 10, '   ').isValid).toBe(false);
  });

  it('validates batch discount input', () => {
    expect(validateDiscountInput(25000).isValid).toBe(true);
    expect(validateDiscountInput(0).isValid).toBe(true);
    expect(validateDiscountInput(-100).isValid).toBe(false);
    expect(validateDiscountInput(250.5).isValid).toBe(false); // floats not allowed
  });
});

