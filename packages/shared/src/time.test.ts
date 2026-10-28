import { describe, it, expect } from 'vitest';
import {
  getKarachiBusinessDate,
  getKarachiDayBoundsUtc,
  getKarachiDayStartUtc,
  getKarachiDayEndUtc,
  isBatchExpired,
} from './time';

describe('Asia/Karachi Business Date and Time Utilities', () => {
  it('correctly calculates business dates at 23:30, 00:30, and 04:30 Karachi time', () => {
    // 2026-10-28 23:30 PKT (UTC+5) is 2026-10-28T18:30:00.000Z in UTC
    const eveningKarachi = '2026-10-28T18:30:00.000Z';
    expect(getKarachiBusinessDate(eveningKarachi)).toBe('2026-10-28');

    // 2026-10-29 00:30 PKT (UTC+5) is 2026-10-28T19:30:00.000Z in UTC (still Oct 28 in UTC!)
    const pastMidnightKarachi = '2026-10-28T19:30:00.000Z';
    expect(getKarachiBusinessDate(pastMidnightKarachi)).toBe('2026-10-29');

    // 2026-10-29 04:30 PKT (UTC+5) is 2026-10-28T23:30:00.000Z in UTC (still Oct 28 in UTC!)
    const earlyMorningKarachi = '2026-10-28T23:30:00.000Z';
    expect(getKarachiBusinessDate(earlyMorningKarachi)).toBe('2026-10-29');
  });

  it('computes exact UTC boundaries for Asia/Karachi day', () => {
    const { startUtc, endUtc } = getKarachiDayBoundsUtc('2026-10-28');
    // 2026-10-28 00:00:00 PKT -> 2026-10-27 19:00:00 UTC
    expect(startUtc).toBe('2026-10-27T19:00:00.000Z');
    // 2026-10-28 23:59:59.999 PKT -> 2026-10-28 18:59:59.999 UTC
    expect(endUtc).toBe('2026-10-28T18:59:59.999Z');

    expect(getKarachiDayStartUtc('2026-10-28')).toBe('2026-10-27T19:00:00.000Z');
    expect(getKarachiDayEndUtc('2026-10-28')).toBe('2026-10-28T18:59:59.999Z');
  });

  it('validates batch expiry: an item expiring today is still sellable today', () => {
    const today = '2026-10-28';

    // Expiring today -> NOT expired yet, sellable today
    expect(isBatchExpired('2026-10-28', today)).toBe(false);

    // Expiring in the future -> NOT expired, sellable
    expect(isBatchExpired('2026-10-29', today)).toBe(false);
    expect(isBatchExpired('2027-12-31', today)).toBe(false);

    // Expired yesterday -> expired, unsellable
    expect(isBatchExpired('2026-10-27', today)).toBe(true);
    expect(isBatchExpired('2025-01-01', today)).toBe(true);
  });
});

