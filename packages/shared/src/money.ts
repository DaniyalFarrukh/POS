/**
 * Central Money & Paisa Module
 * Rule 1: Money is stored as INTEGER paisa. Never use floats for money.
 * All rounding goes through one function in packages/shared with unit tests.
 */

/**
 * Money representation as an integer number of paisa (1 Rupee = 100 paisa).
 */
export type Paisa = number;

/**
 * Validates that an amount is a valid, finite integer number of paisa.
 * Throws a TypeError if the value is not an integer.
 */
export function assertIntegerPaisa(paisa: number, paramName = 'amount'): void {
  if (typeof paisa !== 'number' || isNaN(paisa) || !isFinite(paisa)) {
    throw new TypeError(`${paramName} must be a valid finite number, received: ${paisa}`);
  }
  if (!Number.isInteger(paisa)) {
    throw new TypeError(
      `Rule 1 violation: ${paramName} must be an integer number of paisa, received float: ${paisa}`
    );
  }
}

/**
 * Rounds an amount in paisa to the nearest integer.
 * Ensures the result is always an integer.
 */
export function roundPaisa(paisa: number): Paisa {
  if (typeof paisa !== 'number' || isNaN(paisa) || !isFinite(paisa)) {
    throw new Error(`Cannot round invalid paisa value: ${paisa}`);
  }
  return Math.round(paisa);
}

/**
 * Integer addition of two paisa amounts.
 */
export function add(a: Paisa, b: Paisa): Paisa {
  assertIntegerPaisa(a, 'a');
  assertIntegerPaisa(b, 'b');
  return a + b;
}

/**
 * Integer subtraction of two paisa amounts.
 */
export function subtract(a: Paisa, b: Paisa): Paisa {
  assertIntegerPaisa(a, 'a');
  assertIntegerPaisa(b, 'b');
  return a - b;
}

/**
 * Multiplies an integer unit price in paisa by an integer quantity.
 */
export function multiplyByQuantity(unitPrice: Paisa, quantity: number): Paisa {
  assertIntegerPaisa(unitPrice, 'unitPrice');
  if (typeof quantity !== 'number' || isNaN(quantity) || !isFinite(quantity) || !Number.isInteger(quantity)) {
    throw new TypeError(`quantity must be an integer, received: ${quantity}`);
  }
  if (quantity < 0) {
    throw new Error('quantity cannot be negative');
  }
  return unitPrice * quantity;
}

/**
 * Pure integer Round-Half-Up division:
 * roundHalfUp(N, D) = floor((N + floor(D / 2)) / D) for positive N, D.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    throw new Error(`Denominator must be positive, received: ${denominator}`);
  }
  if (numerator < 0) {
    return -roundHalfUp(-numerator, denominator);
  }
  const half = Math.floor(denominator / 2);
  return Math.floor((numerator + half) / denominator);
}

/**
 * Calculates discount amount in integer paisa from an amount and basis points.
 * 100 bp = 1%, 10000 bp = 100%.
 * Rounds half up per line rule.
 */
export function calculateDiscountAmount(amount: Paisa, discountBp: number): Paisa {
  assertIntegerPaisa(amount, 'amount');
  if (typeof discountBp !== 'number' || isNaN(discountBp) || discountBp < 0) {
    throw new Error(`discountBp must be non-negative, received: ${discountBp}`);
  }
  if (discountBp > 10000) {
    throw new Error(`discountBp cannot exceed 10000 (100%), received: ${discountBp}`);
  }
  if (discountBp === 0 || amount === 0) {
    return 0;
  }
  return roundHalfUp(amount * discountBp, 10000);
}

/**
 * Applies a percentage discount specified in basis points (100 bp = 1%, 10000 bp = 100%).
 * Returns the net amount after discount in integer paisa.
 */
export function applyPercentDiscount(amount: Paisa, discountBp: number): Paisa {
  const discountAmount = calculateDiscountAmount(amount, discountBp);
  return amount - discountAmount;
}

/**
 * Applies a flat discount in paisa to an amount.
 * Result is clamped so that amount never drops below 0.
 */
export function applyFlatDiscount(amount: Paisa, flatDiscount: Paisa): Paisa {
  assertIntegerPaisa(amount, 'amount');
  assertIntegerPaisa(flatDiscount, 'flatDiscount');
  if (flatDiscount < 0) {
    throw new Error('flatDiscount cannot be negative');
  }
  return Math.max(0, amount - flatDiscount);
}

/**
 * Formats an amount in integer paisa to PKR currency notation.
 * E.g., 3550 -> 'Rs. 35.50' (or '35.50' if showPrefix is false).
 */
export function formatPKR(
  paisa: Paisa,
  options: { showPrefix?: boolean; showDecimals?: boolean } = {}
): string {
  const { showPrefix = true, showDecimals = true } = options;
  assertIntegerPaisa(paisa, 'paisa');

  const isNegative = paisa < 0;
  const absPaisa = Math.abs(paisa);
  const rupees = Math.floor(absPaisa / 100);
  const remainingPaisa = absPaisa % 100;

  const formattedRupees = rupees.toLocaleString('en-US');
  let formatted = formattedRupees;

  if (showDecimals) {
    const formattedDecimal = remainingPaisa.toString().padStart(2, '0');
    formatted = `${formattedRupees}.${formattedDecimal}`;
  }

  const sign = isNegative ? '-' : '';
  return showPrefix ? `${sign}Rs. ${formatted}` : `${sign}${formatted}`;
}

/**
 * Formats an integer amount in paisa to a standard Pakistani Rupee representation.
 * (Backwards compatibility alias for formatPKR)
 */
export function formatPaisaToRupees(paisa: Paisa, includePrefix = true): string {
  return formatPKR(paisa, { showPrefix: includePrefix, showDecimals: true });
}

/**
 * Converts a string or numeric representation of Rupees into integer paisa.
 * E.g., '35.50' -> 3550, 'Rs. 450.25' -> 45025, 100 -> 10000.
 */
export function convertRupeesToPaisa(rupees: string | number): Paisa {
  if (typeof rupees === 'number') {
    return roundPaisa(rupees * 100);
  }

  const trimmed = rupees.trim();
  if (!trimmed) {
    throw new Error('Empty monetary string');
  }

  // Strip commas (e.g. '1,250.50' -> '1250.50')
  const stripped = trimmed.replace(/,/g, '');

  // Extract clean numeric part (e.g., 'Rs. 450.25' -> '450.25')
  const match = stripped.match(/^[^0-9]*([0-9]+(?:\.[0-9]+)?)[^0-9]*$/);
  if (!match || !match[1]) {
    throw new Error(`Invalid monetary amount: "${rupees}"`);
  }

  const parts = match[1].split('.');
  const wholePart = parseInt(parts[0] ?? '0', 10);
  if (isNaN(wholePart)) {
    throw new Error(`Invalid monetary amount: "${rupees}"`);
  }

  let decimalPart = 0;
  if (parts.length > 1 && parts[1]) {
    const decStr = (parts[1] + '00').slice(0, 2);
    decimalPart = parseInt(decStr, 10);
  }

  return wholePart * 100 + decimalPart;
}

/**
 * Computes line total in integer paisa from quantity and unit cost in paisa.
 * (Backwards compatibility alias for multiplyByQuantity)
 */
export function calculateLineTotalPaisa(quantity: number, unitCostPaisa: Paisa): Paisa {
  return multiplyByQuantity(unitCostPaisa, quantity);
}
