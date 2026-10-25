import { describe, it, expect } from 'vitest';
import {
  assertIntegerPaisa,
  add,
  subtract,
  multiplyByQuantity,
  calculateDiscountAmount,
  applyPercentDiscount,
  applyFlatDiscount,
  formatPKR,
  roundPaisa,
  convertRupeesToPaisa,
  formatPaisaToRupees,
  calculateLineTotalPaisa,
} from './money';

describe('Rule 1: Money and Paisa Calculations', () => {
  describe('assertIntegerPaisa', () => {
    it('accepts integer paisa numbers', () => {
      expect(() => assertIntegerPaisa(0)).not.toThrow();
      expect(() => assertIntegerPaisa(3500)).not.toThrow();
      expect(() => assertIntegerPaisa(-100)).not.toThrow();
    });

    it('rejects floating point paisa numbers (Rule 1 violation)', () => {
      expect(() => assertIntegerPaisa(12.5)).toThrow(/Rule 1 violation/);
      expect(() => assertIntegerPaisa(0.01)).toThrow(/Rule 1 violation/);
      expect(() => assertIntegerPaisa(100.00001)).toThrow(/Rule 1 violation/);
    });

    it('rejects NaN, Infinity, and non-number types', () => {
      expect(() => assertIntegerPaisa(NaN)).toThrow(/must be a valid finite number/);
      expect(() => assertIntegerPaisa(Infinity)).toThrow(/must be a valid finite number/);
      // @ts-expect-error test non-number
      expect(() => assertIntegerPaisa('100')).toThrow(/must be a valid finite number/);
    });
  });

  describe('add and subtract', () => {
    it('adds two integer paisa amounts correctly', () => {
      expect(add(1000, 2500)).toBe(3500);
      expect(add(0, 500)).toBe(500);
      expect(add(100, -50)).toBe(50);
    });

    it('rejects non-integer paisa in add', () => {
      expect(() => add(10.5, 20)).toThrow(/Rule 1 violation/);
      expect(() => add(10, 20.2)).toThrow(/Rule 1 violation/);
    });

    it('subtracts two integer paisa amounts correctly', () => {
      expect(subtract(3500, 1000)).toBe(2500);
      expect(subtract(500, 500)).toBe(0);
      expect(subtract(100, 250)).toBe(-150);
    });

    it('rejects non-integer paisa in subtract', () => {
      expect(() => subtract(10.5, 5)).toThrow(/Rule 1 violation/);
      expect(() => subtract(10, 5.5)).toThrow(/Rule 1 violation/);
    });
  });

  describe('multiplyByQuantity', () => {
    it('multiplies integer unit price by integer quantity', () => {
      expect(multiplyByQuantity(3500, 3)).toBe(10500); // 3 * Rs. 35.00 = Rs. 105.00
      expect(multiplyByQuantity(45025, 2)).toBe(90050);
      expect(multiplyByQuantity(5000, 0)).toBe(0);
    });

    it('throws if quantity is negative or non-integer', () => {
      expect(() => multiplyByQuantity(1000, -2)).toThrow(/cannot be negative/);
      expect(() => multiplyByQuantity(1000, 1.5)).toThrow(/must be an integer/);
    });

    it('rejects non-integer unit price', () => {
      expect(() => multiplyByQuantity(12.5, 4)).toThrow(/Rule 1 violation/);
    });

    it('calculateLineTotalPaisa acts as an alias for multiplyByQuantity', () => {
      expect(calculateLineTotalPaisa(3, 3500)).toBe(10500);
      expect(calculateLineTotalPaisa(0, 5000)).toBe(0);
    });
  });

  describe('Discounts: applyPercentDiscount and applyFlatDiscount', () => {
    it('calculates percent discount in basis points accurately (100 bp = 1%, 10000 bp = 100%)', () => {
      // Rs. 100 (10,000 paisa) with 5% discount (500 bp) = Rs. 5 discount (500 paisa)
      expect(calculateDiscountAmount(10000, 500)).toBe(500);
      expect(applyPercentDiscount(10000, 500)).toBe(9500); // Net = Rs. 95.00

      // 0% discount
      expect(calculateDiscountAmount(10000, 0)).toBe(0);
      expect(applyPercentDiscount(10000, 0)).toBe(10000);

      // 100% discount
      expect(calculateDiscountAmount(10000, 10000)).toBe(10000);
      expect(applyPercentDiscount(10000, 10000)).toBe(0);

      // 17.5% discount (1750 bp) on 1000 paisa (Rs. 10.00) = 175 paisa
      expect(calculateDiscountAmount(1000, 1750)).toBe(175);
      expect(applyPercentDiscount(1000, 1750)).toBe(825);
    });

    it('applies round half up when discount produces a fractional paisa', () => {
      // 333 paisa with 10% (1000 bp) discount -> 333 * 1000 / 10000 = 33.3 paisa -> 33 paisa
      expect(calculateDiscountAmount(333, 1000)).toBe(33);
      expect(applyPercentDiscount(333, 1000)).toBe(300);

      // 335 paisa with 10% (1000 bp) discount -> 335 * 1000 / 10000 = 33.5 paisa -> 34 paisa (half up!)
      expect(calculateDiscountAmount(335, 1000)).toBe(34);
      expect(applyPercentDiscount(335, 1000)).toBe(301);
    });

    it('validates basis points range (0 to 10000)', () => {
      expect(() => calculateDiscountAmount(1000, -10)).toThrow(/must be non-negative/);
      expect(() => calculateDiscountAmount(1000, 10001)).toThrow(/cannot exceed 10000/);
    });

    it('applies flat discount and clamps at 0', () => {
      expect(applyFlatDiscount(5000, 1000)).toBe(4000);
      expect(applyFlatDiscount(5000, 5000)).toBe(0);
      expect(applyFlatDiscount(5000, 8000)).toBe(0); // clamped at 0
    });

    it('rejects negative flat discount', () => {
      expect(() => applyFlatDiscount(5000, -500)).toThrow(/cannot be negative/);
    });
  });

  describe('formatPKR and formatPaisaToRupees', () => {
    it('formats integer paisa to standard Rupee representation', () => {
      expect(formatPKR(3550)).toBe('Rs. 35.50');
      expect(formatPKR(10000)).toBe('Rs. 100.00');
      expect(formatPKR(5)).toBe('Rs. 0.05');
      expect(formatPKR(0)).toBe('Rs. 0.00');
      expect(formatPKR(125050)).toBe('Rs. 1,250.50');
    });

    it('formats without prefix or without decimals when configured', () => {
      expect(formatPKR(3550, { showPrefix: false })).toBe('35.50');
      expect(formatPKR(125050, { showPrefix: false })).toBe('1,250.50');
      expect(formatPKR(3550, { showPrefix: true, showDecimals: false })).toBe('Rs. 35');
      expect(formatPKR(3550, { showPrefix: false, showDecimals: false })).toBe('35');
    });

    it('formats negative amounts with correct negative signs', () => {
      expect(formatPKR(-3550)).toBe('-Rs. 35.50');
      expect(formatPKR(-3550, { showPrefix: false })).toBe('-35.50');
    });

    it('formatPaisaToRupees behaves identically', () => {
      expect(formatPaisaToRupees(3550)).toBe('Rs. 35.50');
      expect(formatPaisaToRupees(3550, false)).toBe('35.50');
    });
  });

  describe('convertRupeesToPaisa', () => {
    it('converts basic string rupees to integer paisa', () => {
      expect(convertRupeesToPaisa('35.50')).toBe(3550);
      expect(convertRupeesToPaisa('100')).toBe(10000);
      expect(convertRupeesToPaisa('0.25')).toBe(25);
      expect(convertRupeesToPaisa('0.05')).toBe(5);
    });

    it('converts currency with prefix, comma separators and whitespace', () => {
      expect(convertRupeesToPaisa('Rs. 450.25')).toBe(45025);
      expect(convertRupeesToPaisa(' Rs. 1,250.50 ')).toBe(125050);
      expect(convertRupeesToPaisa('Rs. 0.99')).toBe(99);
    });

    it('handles numeric input', () => {
      expect(convertRupeesToPaisa(35.5)).toBe(3550);
      expect(convertRupeesToPaisa(100)).toBe(10000);
    });

    it('throws on invalid formats', () => {
      expect(() => convertRupeesToPaisa('')).toThrow(/Empty monetary string/);
      expect(() => convertRupeesToPaisa('abc')).toThrow(/Invalid monetary amount/);
    });
  });

  describe('roundPaisa', () => {
    it('rounds numbers to nearest integer paisa', () => {
      expect(roundPaisa(100.4)).toBe(100);
      expect(roundPaisa(100.5)).toBe(101);
      expect(roundPaisa(100.6)).toBe(101);
      expect(roundPaisa(0)).toBe(0);
    });

    it('handles negative paisa rounding', () => {
      expect(roundPaisa(-50.2)).toBe(-50);
      expect(roundPaisa(-50.8)).toBe(-51);
    });

    it('throws on NaN or infinite numbers', () => {
      expect(() => roundPaisa(NaN)).toThrow(/Cannot round invalid paisa value/);
      expect(() => roundPaisa(Infinity)).toThrow(/Cannot round invalid paisa value/);
    });
  });
});
