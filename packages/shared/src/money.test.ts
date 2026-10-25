import { describe, it, expect } from 'vitest';
import {
  roundPaisa,
  convertRupeesToPaisa,
  formatPaisaToRupees,
  calculateLineTotalPaisa,
} from './money';

describe('Rule 1: Money and Paisa Calculations', () => {
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

  describe('convertRupeesToPaisa', () => {
    it('converts basic string rupees to integer paisa', () => {
      expect(convertRupeesToPaisa('35.50')).toBe(3550);
      expect(convertRupeesToPaisa('100')).toBe(10000);
      expect(convertRupeesToPaisa('0.25')).toBe(25);
      expect(convertRupeesToPaisa('0.05')).toBe(5);
    });

    it('converts currency with prefix and whitespace', () => {
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

  describe('formatPaisaToRupees', () => {
    it('formats integer paisa to Rupee string with prefix', () => {
      expect(formatPaisaToRupees(3550)).toBe('Rs. 35.50');
      expect(formatPaisaToRupees(10000)).toBe('Rs. 100.00');
      expect(formatPaisaToRupees(5)).toBe('Rs. 0.05');
      expect(formatPaisaToRupees(0)).toBe('Rs. 0.00');
    });

    it('formats without prefix when requested', () => {
      expect(formatPaisaToRupees(3550, false)).toBe('35.50');
      expect(formatPaisaToRupees(125050, false)).toBe('1,250.50');
    });

    it('formats negative amounts correctly', () => {
      expect(formatPaisaToRupees(-3550)).toBe('-Rs. 35.50');
      expect(formatPaisaToRupees(-3550, false)).toBe('-35.50');
    });
  });

  describe('calculateLineTotalPaisa', () => {
    it('multiplies quantity by unit cost in integer paisa', () => {
      expect(calculateLineTotalPaisa(10, 3500)).toBe(35000); // 10 * Rs. 35 = Rs. 350
      expect(calculateLineTotalPaisa(1, 45025)).toBe(45025);
      expect(calculateLineTotalPaisa(0, 5000)).toBe(0);
    });

    it('throws if quantity or unit cost is negative', () => {
      expect(() => calculateLineTotalPaisa(-1, 1000)).toThrow(/must not be negative/);
      expect(() => calculateLineTotalPaisa(5, -100)).toThrow(/must not be negative/);
    });
  });
});
