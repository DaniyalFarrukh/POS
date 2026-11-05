/**
 * Normalize Pakistani phone numbers:
 * - Strips all non-digit characters (+, -, space, parens)
 * - Converts country code 923XXXXXXXXX (12 digits) -> 03XXXXXXXXX (11 digits)
 * - Converts 3XXXXXXXXX (10 digits) -> 03XXXXXXXXX (11 digits)
 * - Returns 03XXXXXXXXX if standard 11 digits
 * - Returns null if raw is null/empty/non-digits
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith('923')) {
    return '0' + digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('03')) {
    return digits;
  }
  if (digits.length === 10 && digits.startsWith('3')) {
    return '0' + digits;
  }
  return digits;
}
