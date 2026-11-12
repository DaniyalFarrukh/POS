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
 * Handles inputs as Date instances, UTC ISO strings (with Z or timezone offset), or epoch milliseconds.
 *
 * Throws TypeError for date strings without Z or UTC offset, because they depend on machine timezone.
 */
export function getKarachiBusinessDate(date: Date | string | number = new Date()): string {
  if (typeof date === 'string') {
    // Strings must include a time component and 'Z' or a UTC timezone offset (e.g. '+05:00', '-04:00', '+0500', '+05')
    // Date strings with no Z and no UTC offset (such as date-only 'YYYY-MM-DD' or naive 'YYYY-MM-DDTHH:mm:ss')
    // depend on machine timezone when parsed by Date.
    const hasUtcOffset =
      /(?:T|\s)\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(date.trim());
    if (!hasUtcOffset) {
      throw new TypeError(
        `Date string must include a UTC offset or "Z" to avoid machine-timezone dependence: "${date}"`
      );
    }
  }
  const d = typeof date === 'object' ? date : new Date(date);
  if (isNaN(d.getTime())) {
    throw new TypeError(`Invalid date: ${date}`);
  }
  return karachiDateFormatter.format(d);
}

export const toKarachiBusinessDate = getKarachiBusinessDate;

/**
 * Adds integer n days to a YYYY-MM-DD business date string using UTC arithmetic.
 * Completely immune to local machine timezone effects and daylight savings.
 */
export function addDaysToBusinessDate(dateString: string, n: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new TypeError(`Invalid business date format (expected YYYY-MM-DD): "${dateString}"`);
  }
  const parts = dateString.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const utcDate = new Date(Date.UTC(y, m - 1, d + n));
  const year = utcDate.getUTCFullYear();
  const month = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the exact UTC ISO timestamps for the start (00:00:00.000)
 * and end (23:59:59.999) of a given business date in Asia/Karachi.
 *
 * @deprecated Prefer half-open day intervals with getKarachiDayStartUtc and getKarachiNextDayStartUtc
 */
export function getKarachiDayBoundsUtc(businessDate: string): {
  startUtc: string;
  /** @deprecated Use getKarachiNextDayStartUtc instead of inclusive endUtc */
  endUtc: string;
} {
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
 * Returns the UTC ISO string for 00:00:00.000 in Asia/Karachi for the day following a given business date.
 * E.g., for '2026-10-28', returns '2026-10-28T19:00:00.000Z' (which is 2026-10-29 00:00:00+05:00).
 * Use this as the exclusive upper bound for half-open day intervals:
 *   timestamp >= startUtc AND timestamp < nextDayStartUtc
 */
export function getKarachiNextDayStartUtc(businessDate: string): string {
  const nextDate = addDaysToBusinessDate(businessDate, 1);
  return getKarachiDayStartUtc(nextDate);
}

/**
 * Returns the UTC ISO string for 23:59:59.999 in Asia/Karachi for a given date.
 *
 * @deprecated Use getKarachiNextDayStartUtc with half-open intervals: timestamp >= startUtc AND timestamp < nextDayStartUtc
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
