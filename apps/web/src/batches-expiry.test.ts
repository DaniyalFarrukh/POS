import { describe, it, expect } from 'vitest';
import {
  getExpiryStatusDetails,
  validateWriteOffInput,
  validateDiscountInput,
} from './lib/stock-utils';

describe('Batches & Expiry Management Page Logic', () => {
  it('correctly maps batch expiry days into urgency buckets', () => {
    // 1. Expired batches: negative days
    const expired = getExpiryStatusDetails('2026-10-25', -10);
    expect(expired.isExpired).toBe(true);
    expect(expired.isCritical).toBe(true);
    expect(expired.label).toBe('Expired (10d ago)');

    // 2. Exactly 0 days (today)
    const expiresToday = getExpiryStatusDetails('2026-11-04', 0);
    expect(expiresToday.isExpired).toBe(false);
    expect(expiresToday.isCritical).toBe(true);
    expect(expiresToday.label).toBe('Expires in 0d');

    // 3. Expiring within 30 days (urgent markdown candidate)
    const in25Days = getExpiryStatusDetails('2026-11-29', 25);
    expect(in25Days.isExpired).toBe(false);
    expect(in25Days.isCritical).toBe(true);
    expect(in25Days.label).toBe('Expires in 25d');

    // 4. Expiring in 60 days
    const in50Days = getExpiryStatusDetails('2026-12-24', 50);
    expect(in50Days.isExpired).toBe(false);
    expect(in50Days.isCritical).toBe(false);
    expect(in50Days.label).toBe('Expires in 50d');

    // 5. Expiring in 90 days
    const in85Days = getExpiryStatusDetails('2027-01-28', 85);
    expect(in85Days.isExpired).toBe(false);
    expect(in85Days.isCritical).toBe(false);
    expect(in85Days.label).toBe('Expires in 85d');
  });

  it('validates write-off quantities and prevents write-off of zero or negative units', () => {
    // Positive integer within on-hand
    expect(validateWriteOffInput(15, 20, 'Damaged seals').isValid).toBe(true);
    // Boundary: exactly on-hand quantity
    expect(validateWriteOffInput(20, 20, 'Full batch destruction').isValid).toBe(true);

    // Over on-hand
    const over = validateWriteOffInput(21, 20, 'Expired');
    expect(over.isValid).toBe(false);
    expect(over.error).toContain('On-hand quantity is 20');

    // Zero or negative
    expect(validateWriteOffInput(0, 20, 'Expired').isValid).toBe(false);
    expect(validateWriteOffInput(-1, 20, 'Expired').isValid).toBe(false);

    // Missing reason
    expect(validateWriteOffInput(5, 20, '').isValid).toBe(false);
    expect(validateWriteOffInput(5, 20, '   ').isValid).toBe(false);
  });

  it('validates batch discount price updates in integer paisa', () => {
    // Valid retail price in paisa: Rs. 150.00 = 15000 paisa
    expect(validateDiscountInput(15000).isValid).toBe(true);
    // Free sample / 100% markdown: 0 paisa
    expect(validateDiscountInput(0).isValid).toBe(true);

    // Fractional paisa or negative
    expect(validateDiscountInput(-1).isValid).toBe(false);
    expect(validateDiscountInput(120.45).isValid).toBe(false);
  });
});
