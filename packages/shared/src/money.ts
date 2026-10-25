/**
 * Central Money & Paisa Module
 * Rule 1: Money is stored as INTEGER paisa. Never use floats for money.
 * All rounding goes through one function in packages/shared with unit tests.
 */

/**
 * Rounds an amount in paisa to the nearest integer.
 * Ensures the result is always an integer.
 */
export function roundPaisa(paisa: number): number {
  if (isNaN(paisa) || !isFinite(paisa)) {
    throw new Error(`Cannot round invalid paisa value: ${paisa}`);
  }
  return Math.round(paisa);
}

/**
 * Converts a string or numeric representation of Rupees into integer paisa.
 * E.g., '35.50' -> 3550, 'Rs. 450.25' -> 45025, 100 -> 10000.
 */
export function convertRupeesToPaisa(rupees: string | number): number {
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
 * Formats an integer amount in paisa to a standard Pakistani Rupee representation.
 * E.g., 3550 -> 'Rs. 35.50' (or '35.50' if includePrefix is false).
 */
export function formatPaisaToRupees(paisa: number, includePrefix = true): string {
  const isNegative = paisa < 0;
  const absPaisa = Math.abs(roundPaisa(paisa));
  const rupees = Math.floor(absPaisa / 100);
  const remainingPaisa = absPaisa % 100;

  const formattedRupees = rupees.toLocaleString('en-US');
  const formattedDecimal = remainingPaisa.toString().padStart(2, '0');
  const formatted = `${formattedRupees}.${formattedDecimal}`;

  const sign = isNegative ? '-' : '';
  return includePrefix ? `${sign}Rs. ${formatted}` : `${sign}${formatted}`;
}

/**
 * Computes line total in integer paisa from quantity and unit cost in paisa.
 */
export function calculateLineTotalPaisa(quantity: number, unitCostPaisa: number): number {
  if (quantity < 0 || unitCostPaisa < 0) {
    throw new Error('Quantity and unit cost must not be negative');
  }
  return roundPaisa(quantity * unitCostPaisa);
}
