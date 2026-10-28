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
  if (
    typeof numerator !== 'number' ||
    typeof denominator !== 'number' ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    !Number.isInteger(numerator) ||
    !Number.isInteger(denominator)
  ) {
    throw new TypeError(
      `numerator and denominator must be finite integers, received: (${numerator}, ${denominator})`
    );
  }
  if (denominator <= 0) {
    throw new Error(`Denominator must be positive, received: ${denominator}`);
  }
  if (numerator === 0) {
    return 0;
  }
  if (numerator < 0) {
    const res = -roundHalfUp(-numerator, denominator);
    return res === 0 ? 0 : res;
  }
  const half = Math.floor(denominator / 2);
  const res = Math.floor((numerator + half) / denominator);
  return res === 0 ? 0 : res;
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
  options: { showPrefix?: boolean; showDecimals?: boolean; useGrouping?: boolean } = {}
): string {
  const { showPrefix = true, showDecimals = true, useGrouping = true } = options;
  assertIntegerPaisa(paisa, 'paisa');

  const isNegative = paisa < 0;
  const absPaisa = Math.abs(paisa);
  const rupees = Math.floor(absPaisa / 100);
  const remainingPaisa = absPaisa % 100;

  const formattedRupees = useGrouping ? rupees.toLocaleString('en-US') : rupees.toString();
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
 * Preserves signs for negative numbers and returns.
 * Rejects inputs with more than 2 decimal places, NaN, Infinity, and empty inputs.
 */
export function convertRupeesToPaisa(rupees: string | number): Paisa {
  if (typeof rupees === 'number') {
    if (isNaN(rupees) || !isFinite(rupees)) {
      throw new TypeError(`Monetary amount must be a valid finite number, received: ${rupees}`);
    }
    const scaled = Math.abs(rupees * 100);
    const roundedScaled = Math.round(scaled);
    if (Math.abs(scaled - roundedScaled) > 1e-4) {
      throw new Error(`Monetary amount cannot have more than 2 decimal places: ${rupees}`);
    }
    return rupees < 0 ? -roundedScaled : roundedScaled;
  }

  if (typeof rupees !== 'string') {
    throw new TypeError(`Monetary amount must be a string or number, received: ${typeof rupees}`);
  }

  const trimmed = rupees.trim();
  if (!trimmed) {
    throw new Error('Empty monetary string');
  }

  // Detect negative sign: leading '-', or '-Rs.', or 'Rs. -'
  const isNegative = /^([-\u2212]|(?:Rs\.?|PKR)\s*([-\u2212])|([-\u2212])\s*(?:Rs\.?|PKR))/i.test(trimmed);

  // Remove commas, currency prefixes, whitespace, and negative signs
  let cleaned = trimmed.replace(/,/g, '');
  cleaned = cleaned.replace(/^(?:Rs\.?|PKR)\s*|\s*(?:Rs\.?|PKR)$/gi, '').trim();
  cleaned = cleaned.replace(/^([-\u2212+])\s*/, '').trim();
  cleaned = cleaned.replace(/^(?:Rs\.?|PKR)\s*/gi, '').trim();

  // Validate clean number format: one or more digits, optional decimal point with digits
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Invalid monetary amount: "${rupees}"`);
  }

  const parts = cleaned.split('.');
  const wholeStr = parts[0]!;
  const decStr = parts[1];

  if (decStr !== undefined && decStr.length > 2) {
    throw new Error(`Monetary amount cannot have more than 2 decimal places: "${rupees}"`);
  }

  const wholePart = parseInt(wholeStr, 10);
  if (isNaN(wholePart)) {
    throw new Error(`Invalid monetary amount: "${rupees}"`);
  }

  let decimalPart = 0;
  if (decStr !== undefined) {
    decimalPart = parseInt((decStr + '00').slice(0, 2), 10);
  }

  const totalPaisa = wholePart * 100 + decimalPart;
  return isNegative ? -totalPaisa : totalPaisa;
}

/**
 * Computes line total in integer paisa from quantity and unit cost in paisa.
 * (Backwards compatibility alias for multiplyByQuantity)
 */
export function calculateLineTotalPaisa(quantity: number, unitCostPaisa: Paisa): Paisa {
  return multiplyByQuantity(unitCostPaisa, quantity);
}
