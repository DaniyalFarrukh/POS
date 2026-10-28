import { describe, it, expect } from 'vitest';
import {
  roundHalfUp,
  computeLineTax,
  computeInvoiceTotals,
  type InvoiceLineInput,
} from './tax';

describe('Tax & Invoice Calculation Utilities (Phase 2)', () => {
  describe('roundHalfUp (Documented ONE Rounding Rule)', () => {
    it('rounds exact fractional halves up to the next integer', () => {
      // 0.5 -> 1
      expect(roundHalfUp(5, 10)).toBe(1);
      expect(roundHalfUp(5000, 10000)).toBe(1);

      // 1.5 -> 2
      expect(roundHalfUp(15, 10)).toBe(2);
      expect(roundHalfUp(15000, 10000)).toBe(2);

      // 2.5 -> 3
      expect(roundHalfUp(25, 10)).toBe(3);
      expect(roundHalfUp(25000, 10000)).toBe(3);
    });

    it('rounds strictly less than half down to the previous integer', () => {
      // 0.4999 -> 0
      expect(roundHalfUp(4999, 10000)).toBe(0);
      expect(roundHalfUp(4, 10)).toBe(0);

      // 1.4999 -> 1
      expect(roundHalfUp(14999, 10000)).toBe(1);
    });

    it('rounds strictly greater than half up', () => {
      // 0.5001 -> 1
      expect(roundHalfUp(5001, 10000)).toBe(1);

      // 1.5001 -> 2
      expect(roundHalfUp(15001, 10000)).toBe(2);
    });

    it('handles zero and exact integers without modification', () => {
      expect(roundHalfUp(0, 10000)).toBe(0);
      expect(roundHalfUp(10000, 10000)).toBe(1);
      expect(roundHalfUp(20000, 10000)).toBe(2);
      expect(roundHalfUp(50000, 10000)).toBe(5);
    });

    it('handles negative numbers symmetrically and avoids -0', () => {
      expect(roundHalfUp(-5000, 10000)).toBe(-1);
      expect(roundHalfUp(-4999, 10000)).toBe(0);
      expect(Object.is(roundHalfUp(-4999, 10000), 0)).toBe(true);
      expect(roundHalfUp(-15000, 10000)).toBe(-2);
    });

    it('rejects non-integer, NaN, and Infinity in numerator and denominator', () => {
      expect(() => roundHalfUp(NaN, 10000)).toThrow(/must be finite integers/);
      expect(() => roundHalfUp(100, NaN)).toThrow(/must be finite integers/);
      expect(() => roundHalfUp(Infinity, 10000)).toThrow(/must be finite integers/);
      expect(() => roundHalfUp(10.5, 10000)).toThrow(/must be finite integers/);
      expect(() => roundHalfUp(100, 10.5)).toThrow(/must be finite integers/);
    });

    it('throws if denominator is non-positive', () => {
      expect(() => roundHalfUp(100, 0)).toThrow(/Denominator must be positive/);
      expect(() => roundHalfUp(100, -5)).toThrow(/Denominator must be positive/);
    });
  });

  describe('computeLineTax', () => {
    it('computes standard Pakistani sales tax / GST rates', () => {
      // 17% GST (1700 bp) on Rs. 100.00 (10,000 paisa) = Rs. 17.00 (1700 paisa)
      expect(computeLineTax(10000, 1700)).toBe(1700);

      // 18% GST (1800 bp) on Rs. 100.00 (10,000 paisa) = Rs. 18.00 (1800 paisa)
      expect(computeLineTax(10000, 1800)).toBe(1800);

      // 5% reduced rate (500 bp) on Rs. 100.00 = Rs. 5.00 (500 paisa)
      expect(computeLineTax(10000, 500)).toBe(500);

      // 0% rate = 0 paisa
      expect(computeLineTax(10000, 0)).toBe(0);
    });

    it('adheres strictly to ONE documented rounding rule (round half up per line)', () => {
      // Rs. 0.99 (99 paisa) @ 17% (1700 bp):
      // 99 * 1700 = 168300 / 10000 = 16.83 paisa -> 17 paisa
      expect(computeLineTax(99, 1700)).toBe(17);

      // 101 paisa @ 17%:
      // 101 * 1700 = 171700 / 10000 = 17.17 paisa -> 17 paisa
      expect(computeLineTax(101, 1700)).toBe(17);

      // Net = 3530 paisa @ 17%:
      // 3530 * 1700 = 6001000 / 10000 = 600.1 paisa -> 600 paisa
      expect(computeLineTax(3530, 1700)).toBe(600);

      // Net = 3535 paisa @ 17%:
      // 3535 * 1700 = 6009500 / 10000 = 600.95 paisa -> 601 paisa
      expect(computeLineTax(3535, 1700)).toBe(601);
    });

    it('supports tax-exempt items regardless of specified rate', () => {
      // When isTaxExempt is true, tax is always 0
      expect(computeLineTax(10000, 1700, true)).toBe(0);
      expect(computeLineTax(45000, 1800, true)).toBe(0);
      expect(computeLineTax(1, 1700, true)).toBe(0);
    });

    it('validates integer paisa input and non-negative rates', () => {
      expect(() => computeLineTax(10.5, 1700)).toThrow(/Rule 1 violation/);
      expect(() => computeLineTax(1000, -100)).toThrow(/rateBp must be non-negative/);
    });
  });

  describe('computeInvoiceTotals', () => {
    it('computes totals for a typical multi-item pharmacy invoice with discounts and GST', () => {
      const lines: InvoiceLineInput[] = [
        // Line 1: Panadol (3 packs @ Rs. 35.00 = 3500 paisa), 10% discount (1000 bp), 18% GST (1800 bp)
        // Gross: 10500 paisa. Discount: 1050 paisa. Net: 9450 paisa.
        // Tax: 9450 * 1800 / 10000 = 1701 paisa. Line Total: 9450 + 1701 = 11151 paisa.
        {
          unitPricePaisa: 3500,
          quantity: 3,
          discountBp: 1000,
          taxRateBp: 1800,
          isTaxExempt: false,
        },
        // Line 2: Augmentin (1 pack @ Rs. 450.00 = 45000 paisa), Tax-Exempt life-saving medicine
        // Gross: 45000 paisa. Discount: 0. Net: 45000 paisa. Tax: 0. Line Total: 45000 paisa.
        {
          unitPricePaisa: 45000,
          quantity: 1,
          discountBp: 0,
          taxRateBp: 1800,
          isTaxExempt: true,
        },
        // Line 3: Saniplast (5 packs @ Rs. 20.00 = 2000 paisa), flat discount Rs. 10.00 (1000 paisa), 18% GST
        // Gross: 10000 paisa. Discount: 1000 paisa. Net: 9000 paisa.
        // Tax: 9000 * 1800 / 10000 = 1620 paisa. Line Total: 9000 + 1620 = 10620 paisa.
        {
          unitPricePaisa: 2000,
          quantity: 5,
          flatDiscountPaisa: 1000,
          taxRateBp: 1800,
          isTaxExempt: false,
        },
      ];

      const totals = computeInvoiceTotals(lines);

      // Verify computed lines
      expect(totals.lines[0]?.grossAmountPaisa).toBe(10500);
      expect(totals.lines[0]?.discountPaisa).toBe(1050);
      expect(totals.lines[0]?.netAmountPaisa).toBe(9450);
      expect(totals.lines[0]?.taxAmountPaisa).toBe(1701);
      expect(totals.lines[0]?.lineTotalPaisa).toBe(11151);

      expect(totals.lines[1]?.grossAmountPaisa).toBe(45000);
      expect(totals.lines[1]?.discountPaisa).toBe(0);
      expect(totals.lines[1]?.netAmountPaisa).toBe(45000);
      expect(totals.lines[1]?.taxAmountPaisa).toBe(0); // Tax exempt!
      expect(totals.lines[1]?.lineTotalPaisa).toBe(45000);

      expect(totals.lines[2]?.grossAmountPaisa).toBe(10000);
      expect(totals.lines[2]?.discountPaisa).toBe(1000);
      expect(totals.lines[2]?.netAmountPaisa).toBe(9000);
      expect(totals.lines[2]?.taxAmountPaisa).toBe(1620);
      expect(totals.lines[2]?.lineTotalPaisa).toBe(10620);

      // Subtotal = 10500 + 45000 + 10000 = 65500 paisa (Rs. 655.00)
      expect(totals.subtotalPaisa).toBe(65500);

      // Total Discount = 1050 + 0 + 1000 = 2050 paisa (Rs. 20.50)
      expect(totals.totalDiscountPaisa).toBe(2050);

      // Net Total = 9450 + 45000 + 9000 = 63450 paisa (Rs. 634.50)
      expect(totals.netTotalPaisa).toBe(63450);

      // Total Tax = 1701 + 0 + 1620 = 3321 paisa (Rs. 33.21)
      expect(totals.totalTaxPaisa).toBe(3321);

      // Grand Total = 11151 + 45000 + 10620 = 66771 paisa (Rs. 667.71)
      expect(totals.grandTotalPaisa).toBe(66771);

      // Verify exact invariant: Net + Tax === Grand Total
      expect(totals.netTotalPaisa + totals.totalTaxPaisa).toBe(totals.grandTotalPaisa);

      // Verify exact invariant: Sum of line totals === Grand Total
      const lineSum = totals.lines.reduce((acc, l) => acc + l.lineTotalPaisa, 0);
      expect(lineSum).toBe(totals.grandTotalPaisa);
    });

    it('handles empty line array gracefully', () => {
      const totals = computeInvoiceTotals([]);
      expect(totals.subtotalPaisa).toBe(0);
      expect(totals.totalDiscountPaisa).toBe(0);
      expect(totals.netTotalPaisa).toBe(0);
      expect(totals.totalTaxPaisa).toBe(0);
      expect(totals.grandTotalPaisa).toBe(0);
      expect(totals.lines).toHaveLength(0);
    });

    it('rejects negative discountBp and negative flatDiscountPaisa', () => {
      expect(() =>
        computeInvoiceTotals([
          {
            unitPricePaisa: 1000,
            quantity: 1,
            discountBp: -100,
            taxRateBp: 0,
            isTaxExempt: true,
          },
        ])
      ).toThrow(/discountBp/i);

      expect(() =>
        computeInvoiceTotals([
          {
            unitPricePaisa: 1000,
            quantity: 1,
            flatDiscountPaisa: -50,
            taxRateBp: 0,
            isTaxExempt: true,
          },
        ])
      ).toThrow(/flatDiscountPaisa/i);
    });
  });

  describe('Property-Style Tests (1,000 Invoices Invariant)', () => {
    // Deterministic Linear Congruential Generator for reproducible pseudo-random property tests
    let seed = 123456789;
    const nextRandom = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const randInt = (min: number, max: number): number => {
      return Math.floor(nextRandom() * (max - min + 1)) + min;
    };

    it('Property: totals NEVER differ by even 1 paisa between computing per line and summing (1000 randomized invoices)', () => {
      const TAX_RATES = [0, 500, 1700, 1800, 2000]; // 0%, 5%, 17%, 18%, 20%
      const DISCOUNT_BP_OPTIONS = [0, 250, 500, 1000, 1500, 2500, 5000, 10000];

      for (let iteration = 0; iteration < 1000; iteration++) {
        const lineCount = randInt(1, 20);
        const lines: InvoiceLineInput[] = [];

        for (let i = 0; i < lineCount; i++) {
          const unitPricePaisa = randInt(1, 250000); // 1 paisa to Rs. 2,500.00
          const quantity = randInt(1, 50);
          const discountBp = DISCOUNT_BP_OPTIONS[randInt(0, DISCOUNT_BP_OPTIONS.length - 1)]!;
          const flatDiscountPaisa = randInt(0, 1) === 1 ? randInt(0, 1000) : 0;
          const taxRateBp = TAX_RATES[randInt(0, TAX_RATES.length - 1)]!;
          const isTaxExempt = randInt(0, 5) === 0; // ~16% chance of tax exemption

          lines.push({
            unitPricePaisa,
            quantity,
            discountBp,
            flatDiscountPaisa,
            taxRateBp,
            isTaxExempt,
          });
        }

        const totals = computeInvoiceTotals(lines);

        // 1. Invariant: Sum of individual line totals MUST EXACTLY EQUAL grand total
        const sumOfLineTotals = totals.lines.reduce((acc, l) => acc + l.lineTotalPaisa, 0);
        expect(sumOfLineTotals).toBe(totals.grandTotalPaisa);

        // Difference must be strictly 0 paisa (never even 1 paisa!)
        const diffFromSum = Math.abs(sumOfLineTotals - totals.grandTotalPaisa);
        expect(diffFromSum).toBe(0);

        // 2. Invariant: Net Total + Total Tax MUST EXACTLY EQUAL grand total
        const netPlusTax = totals.netTotalPaisa + totals.totalTaxPaisa;
        expect(netPlusTax).toBe(totals.grandTotalPaisa);

        // 3. Invariant: Subtotal - Total Discount MUST EXACTLY EQUAL net total
        const subtotalMinusDiscount = totals.subtotalPaisa - totals.totalDiscountPaisa;
        expect(subtotalMinusDiscount).toBe(totals.netTotalPaisa);

        // 4. Property: NO FLOATS ANYWHERE (Rule 1)
        expect(Number.isInteger(totals.subtotalPaisa)).toBe(true);
        expect(Number.isInteger(totals.totalDiscountPaisa)).toBe(true);
        expect(Number.isInteger(totals.netTotalPaisa)).toBe(true);
        expect(Number.isInteger(totals.totalTaxPaisa)).toBe(true);
        expect(Number.isInteger(totals.grandTotalPaisa)).toBe(true);

        for (const line of totals.lines) {
          expect(Number.isInteger(line.grossAmountPaisa)).toBe(true);
          expect(Number.isInteger(line.discountPaisa)).toBe(true);
          expect(Number.isInteger(line.netAmountPaisa)).toBe(true);
          expect(Number.isInteger(line.taxAmountPaisa)).toBe(true);
          expect(Number.isInteger(line.lineTotalPaisa)).toBe(true);
          expect(line.netAmountPaisa + line.taxAmountPaisa).toBe(line.lineTotalPaisa);

          if (line.isTaxExempt) {
            expect(line.taxAmountPaisa).toBe(0);
            expect(line.lineTotalPaisa).toBe(line.netAmountPaisa);
          }
        }
      }
    });

    it('Property: extreme boundaries and large values maintain integer integrity', () => {
      // Very large invoice: 100 items each Rs. 100,000 (10,000,000 paisa)
      const lines: InvoiceLineInput[] = Array.from({ length: 50 }, () => ({
        unitPricePaisa: 10000000,
        quantity: 10,
        discountBp: 1500, // 15% discount
        taxRateBp: 1800, // 18% GST
        isTaxExempt: false,
      }));

      const totals = computeInvoiceTotals(lines);

      // Subtotal = 50 * 10 * 10,000,000 = 5,000,000,000 paisa (Rs. 50,000,000.00)
      expect(totals.subtotalPaisa).toBe(5000000000);
      expect(Number.isInteger(totals.grandTotalPaisa)).toBe(true);
      expect(totals.netTotalPaisa + totals.totalTaxPaisa).toBe(totals.grandTotalPaisa);

      const sumOfLines = totals.lines.reduce((acc, l) => acc + l.lineTotalPaisa, 0);
      expect(sumOfLines).toBe(totals.grandTotalPaisa);
    });
  });
});
