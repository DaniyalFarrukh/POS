import { describe, it, expect } from 'vitest';
import { roundHalfUp, parsePkrToPaisa, formatPaisa, formatPKR } from './money';
import { calculateProgressiveTax, calculateStatutoryComponentDeduction } from './schema/payroll';
import { calculateUnpaidLeaveDeduction } from './schema/hr';

describe('F-M-05: Rule 1 Money & Rounding Integrity', () => {
  describe('roundHalfUp exact integer divisions', () => {
    it('correctly rounds half up on fractional divisions without float inaccuracies', () => {
      // 5 / 2 = 2.5 -> rounds to 3
      expect(roundHalfUp(5, 2)).toBe(3);
      // 1 / 3 = 0.333... -> 0
      expect(roundHalfUp(1, 3)).toBe(0);
      // 2 / 3 = 0.666... -> 1
      expect(roundHalfUp(2, 3)).toBe(1);
      // 2500000 paisa across 30 days = 83333.333 -> 83333
      expect(roundHalfUp(2500000, 30)).toBe(83333);
      // 2500000 paisa across 12 months = 208333.333 -> 208333
      expect(roundHalfUp(2500000, 12)).toBe(208333);
      // Negative half up: -5 / 2 = -2.5 -> rounds symmetrically to -3
      expect(roundHalfUp(-5, 2)).toBe(-3);
    });
  });

  describe('parsePkrToPaisa input parsing', () => {
    it('parses valid numeric and string inputs into exact integer paisa', () => {
      expect(parsePkrToPaisa('19.99')).toBe(1999);
      expect(parsePkrToPaisa('100')).toBe(10000);
      expect(parsePkrToPaisa('Rs. 1,250.50')).toBe(125050);
      expect(parsePkrToPaisa(35.5)).toBe(3550);
      expect(parsePkrToPaisa(100)).toBe(10000);
      expect(parsePkrToPaisa(0)).toBe(0);
      expect(parsePkrToPaisa(-25.5)).toBe(-2550);
    });

    it('returns default value (0) for empty, null, or invalid inputs safely', () => {
      expect(parsePkrToPaisa('')).toBe(0);
      expect(parsePkrToPaisa(null)).toBe(0);
      expect(parsePkrToPaisa(undefined)).toBe(0);
      expect(parsePkrToPaisa('   ')).toBe(0);
      expect(parsePkrToPaisa('invalid-amount', 100)).toBe(100);
    });
  });

  describe('formatPaisa display formatting', () => {
    it('formats integer paisa via formatPKR', () => {
      expect(formatPaisa(125050)).toBe('Rs. 1,250.50');
      expect(formatPKR(125050)).toBe('Rs. 1,250.50');
      expect(formatPaisa(0)).toBe('Rs. 0.00');
      expect(formatPaisa(125050, { showPrefix: false })).toBe('1,250.50');
    });
  });

  describe('schema payroll & HR integer calculations', () => {
    it('calculateProgressiveTax uses roundHalfUp for progressive tax slabs', () => {
      const slabs = [
        {
          id: 's1',
          slabNumber: 1,
          minMonthlyIncomePaisa: 5000000,
          maxMonthlyIncomePaisa: 10000000,
          baseTaxPaisa: 0,
          excessRatePercentage: '2.5',
        },
      ];
      // Income = 8,000,000. Excess = 3,000,000. Rate = 2.5% = 250 bp. Tax = 75,000
      expect(calculateProgressiveTax(8000000, slabs)).toBe(75000);
    });

    it('calculateStatutoryComponentDeduction uses roundHalfUp for percentage deductions', () => {
      const comp = {
        code: 'EOBI',
        name: 'EOBI Pension',
        calculationType: 'percentage' as const,
        fixedAmountPaisa: 0,
        percentageRate: '5.00',
        accountCode: '2210',
      };
      // 5% of 100,000 paisa (Rs. 1,000) = 5,000 paisa (Rs. 50)
      expect(calculateStatutoryComponentDeduction(100000, comp)).toBe(5000);
    });

    it('calculateUnpaidLeaveDeduction uses roundHalfUp for daily rate', () => {
      const res = calculateUnpaidLeaveDeduction(10000000, 2, 22);
      // 10,000,000 / 22 = 454545.4545 -> roundHalfUp = 454545 paisa/day
      expect(res.dailyRatePaisa).toBe(454545);
      expect(res.deductionPaisa).toBe(454545 * 2);
    });
  });
});
