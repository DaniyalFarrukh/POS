/**
 * Asia/Karachi Business Date and Time Utilities
 *
 * Rule 8: Timestamps stored in UTC ISO string; display strictly formatted
 * in Asia/Karachi time zone (UTC+5 continuously, no daylight savings).
 */

const karachiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Karachi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Returns the business date in Asia/Karachi time zone as YYYY-MM-DD.
 * Handles inputs as Date instances, UTC ISO strings, or epoch milliseconds.
 */
export function getKarachiBusinessDate(date: Date | string | number = new Date()): string {
  const d = typeof date === 'object' ? date : new Date(date);
  if (isNaN(d.getTime())) {
    throw new TypeError(`Invalid date: ${date}`);
  }
  return karachiDateFormatter.format(d);
}

/**
 * Returns the exact UTC ISO timestamps for the start (00:00:00.000)
 * and end (23:59:59.999) of a given business date in Asia/Karachi.
 *
 * E.g., for '2026-10-28':
 *   - Start: 2026-10-28 00:00:00.000+05:00 -> 2026-10-27T19:00:00.000Z
 *   - End:   2026-10-28 23:59:59.999+05:00 -> 2026-10-28T18:59:59.999Z
 */
export function getKarachiDayBoundsUtc(businessDate: string): { startUtc: string; endUtc: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new Error(`Invalid business date format (expected YYYY-MM-DD): "${businessDate}"`);
  }
  const startUtc = new Date(`${businessDate}T00:00:00.000+05:00`).toISOString();
  const endUtc = new Date(`${businessDate}T23:59:59.999+05:00`).toISOString();
  return { startUtc, endUtc };
}

/**
 * Returns the UTC ISO string for 00:00:00.000 in Asia/Karachi for a given date.
 */
export function getKarachiDayStartUtc(businessDate: string): string {
  return getKarachiDayBoundsUtc(businessDate).startUtc;
}

/**
 * Returns the UTC ISO string for 23:59:59.999 in Asia/Karachi for a given date.
 */
export function getKarachiDayEndUtc(businessDate: string): string {
  return getKarachiDayBoundsUtc(businessDate).endUtc;
}

/**
 * Validates batch expiry according to standard FEFO pharmaceutical rule:
 * An item with expiryDate = D is still sellable throughout the business day of D.
 * It is expired only when expiryDate < referenceDate.
 */
export function isBatchExpired(
  expiryDate: string,
  referenceDate: string = getKarachiBusinessDate()
): boolean {
  return expiryDate < referenceDate;
}

