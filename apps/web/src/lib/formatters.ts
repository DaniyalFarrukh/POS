/**
 * Rule 1: Money is always integer paisa.
 * Formats integer paisa as PKR currency string: "Rs. 1,250.00"
 */
export function formatPaisa(paisa: number): string {
  const rupees = (paisa || 0) / 100;
  return `Rs. ${rupees.toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Rule 8: Timestamps stored in UTC ISO string;
 * display strictly formatted in Asia/Karachi time zone.
 */
export function formatKarachiDateTime(utcIsoString: string | null | undefined): string {
  if (!utcIsoString) return '—';
  try {
    const date = new Date(utcIsoString);
    return new Intl.DateTimeFormat('en-PK', {
      timeZone: 'Asia/Karachi',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return utcIsoString;
  }
}

/**
 * Formats UTC ISO string or YYYY-MM-DD date strictly in Asia/Karachi date format: "26 Oct 2026"
 */
export function formatKarachiDateOnly(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString.length === 10 ? `${dateString}T00:00:00Z` : dateString);
    return new Intl.DateTimeFormat('en-PK', {
      timeZone: 'Asia/Karachi',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateString;
  }
}
