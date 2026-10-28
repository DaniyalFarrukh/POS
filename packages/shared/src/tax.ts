/**
 * Central Tax & Invoice Calculation Module
 *
 * Rounding Rule (Rule 1 & Rule 9):
 * ONE documented rounding rule is applied consistently across all tax computations:
 * ROUND HALF UP PER LINE.
 *
 * Mathematical definition:
 * For numerator N and denominator D (where D = 10,000 for basis points):
 * roundHalfUp(N, D) = floor((N + floor(D / 2)) / D)
 * E.g., for D = 10,000, half = 5,000.
 * Any fraction >= 0.5 rounds up to the next integer paisa.
 * Any fraction < 0.5 rounds down to the previous integer paisa.
 *
 * This integer-only arithmetic guarantees zero floating-point imprecision.
 */

import {
  type Paisa,
  assertIntegerPaisa,
  multiplyByQuantity,
  calculateDiscountAmount,
  roundHalfUp,
  add,
  subtract,
} from './money';

export { roundHalfUp };

/**
 * Computes tax amount in integer paisa for a line item from its net amount and rate in basis points.
 * 100 bp = 1%, 1700 bp = 17%, 1800 bp = 18%.
 *
 * Documented Rule: Round half up per line.
 * Supports tax-exempt items (returns 0 paisa).
 */
export function computeLineTax(
  netAmountPaisa: Paisa,
  rateBp: number,
  isTaxExempt = false
): Paisa {
  assertIntegerPaisa(netAmountPaisa, 'netAmountPaisa');
  if (typeof rateBp !== 'number' || isNaN(rateBp) || rateBp < 0) {
    throw new Error(`rateBp must be non-negative, received: ${rateBp}`);
  }
  if (isTaxExempt || rateBp === 0 || netAmountPaisa === 0) {
    return 0;
  }

  // Calculate tax with documented round half up per line
  return roundHalfUp(netAmountPaisa * rateBp, 10000);
}

/**
 * Input definition for an invoice line item.
 */
export interface InvoiceLineInput {
  unitPricePaisa: Paisa;
  quantity: number;
  discountBp?: number; // Optional percentage discount in basis points (e.g. 500 = 5%)
  flatDiscountPaisa?: Paisa; // Optional flat discount in paisa
  taxRateBp: number; // Tax rate in basis points (e.g. 1700 = 17% GST, 1800 = 18%)
  isTaxExempt?: boolean; // Tax exemption flag
}

/**
 * Computed line item containing gross, discount, net, tax, and line total in integer paisa.
 */
export interface ComputedInvoiceLine {
  unitPricePaisa: Paisa;
  quantity: number;
  grossAmountPaisa: Paisa;
  discountPaisa: Paisa;
  netAmountPaisa: Paisa;
  taxRateBp: number;
  isTaxExempt: boolean;
  taxAmountPaisa: Paisa;
  lineTotalPaisa: Paisa;
}

/**
 * Aggregated invoice totals.
 * Invariant: grandTotalPaisa === sum of lineTotalPaisa === netTotalPaisa + totalTaxPaisa.
 */
export interface InvoiceTotals {
  lines: ComputedInvoiceLine[];
  subtotalPaisa: Paisa;
  totalDiscountPaisa: Paisa;
  netTotalPaisa: Paisa;
  totalTaxPaisa: Paisa;
  grandTotalPaisa: Paisa;
}

/**
 * Computes complete invoice totals from individual line items.
 *
 * Enforces and verifies the fundamental accounting invariants:
 * 1. Line Total = Net Amount + Line Tax
 * 2. Sum of Line Totals = Grand Total (0 paisa difference)
 * 3. Net Total + Total Tax = Grand Total (0 paisa difference)
 * 4. All amounts are strictly integer paisa (no floats anywhere)
 */
export function computeInvoiceTotals(lines: InvoiceLineInput[]): InvoiceTotals {
  let subtotalPaisa = 0;
  let totalDiscountPaisa = 0;
  let netTotalPaisa = 0;
  let totalTaxPaisa = 0;
  let grandTotalPaisa = 0;

  const computedLines: ComputedInvoiceLine[] = lines.map((line, idx) => {
    // 1. Gross amount = unitPrice * quantity
    const grossAmountPaisa = multiplyByQuantity(line.unitPricePaisa, line.quantity);

    // 2. Compute discount (percent discount + flat discount)
    let percentDiscountPaisa = 0;
    if (line.discountBp !== undefined && line.discountBp !== null) {
      if (typeof line.discountBp !== 'number' || !Number.isFinite(line.discountBp) || line.discountBp < 0) {
        throw new RangeError(`line[${idx}].discountBp must be non-negative, received: ${line.discountBp}`);
      }
      if (line.discountBp > 0) {
        percentDiscountPaisa = calculateDiscountAmount(grossAmountPaisa, line.discountBp);
      }
    }

    let flatDiscountPaisa = 0;
    if (line.flatDiscountPaisa !== undefined && line.flatDiscountPaisa !== null) {
      assertIntegerPaisa(line.flatDiscountPaisa, `line[${idx}].flatDiscountPaisa`);
      if (line.flatDiscountPaisa < 0) {
        throw new RangeError(`line[${idx}].flatDiscountPaisa must be non-negative, received: ${line.flatDiscountPaisa}`);
      }
      flatDiscountPaisa = line.flatDiscountPaisa;
    }

    // Total line discount cannot exceed gross amount
    const totalLineDiscountPaisa = Math.min(
      grossAmountPaisa,
      add(percentDiscountPaisa, flatDiscountPaisa)
    );

    // 3. Net amount = Gross - Discount
    const netAmountPaisa = subtract(grossAmountPaisa, totalLineDiscountPaisa);

    // 4. Line tax (round half up per line)
    const isExempt = Boolean(line.isTaxExempt);
    const taxAmountPaisa = computeLineTax(netAmountPaisa, line.taxRateBp, isExempt);

    // 5. Line Total = Net + Tax
    const lineTotalPaisa = add(netAmountPaisa, taxAmountPaisa);

    // Accumulate invoice totals
    subtotalPaisa = add(subtotalPaisa, grossAmountPaisa);
    totalDiscountPaisa = add(totalDiscountPaisa, totalLineDiscountPaisa);
    netTotalPaisa = add(netTotalPaisa, netAmountPaisa);
    totalTaxPaisa = add(totalTaxPaisa, taxAmountPaisa);
    grandTotalPaisa = add(grandTotalPaisa, lineTotalPaisa);

    return {
      unitPricePaisa: line.unitPricePaisa,
      quantity: line.quantity,
      grossAmountPaisa,
      discountPaisa: totalLineDiscountPaisa,
      netAmountPaisa,
      taxRateBp: line.taxRateBp,
      isTaxExempt: isExempt,
      taxAmountPaisa,
      lineTotalPaisa,
    };
  });

  // Verify invariant: sum of line totals MUST equal grandTotalPaisa
  const sumOfLines = computedLines.reduce((acc, l) => acc + l.lineTotalPaisa, 0);
  if (sumOfLines !== grandTotalPaisa) {
    throw new Error(
      `Accounting invariant violation: sum of line totals (${sumOfLines}) differs from grand total (${grandTotalPaisa})`
    );
  }

  // Verify invariant: Net Total + Total Tax MUST equal grandTotalPaisa
  if (netTotalPaisa + totalTaxPaisa !== grandTotalPaisa) {
    throw new Error(
      `Accounting invariant violation: net total (${netTotalPaisa}) + tax (${totalTaxPaisa}) !== grand total (${grandTotalPaisa})`
    );
  }

  return {
    lines: computedLines,
    subtotalPaisa,
    totalDiscountPaisa,
    netTotalPaisa,
    totalTaxPaisa,
    grandTotalPaisa,
  };
}
