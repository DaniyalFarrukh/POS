import { describe, it, expect } from 'vitest';
import {
  getKarachiBusinessDate,
  getKarachiDayBoundsUtc,
  getKarachiDayStartUtc,
  getKarachiDayEndUtc,
  getKarachiNextDayStartUtc,
  addDaysToBusinessDate,
  isBatchExpired,
  normalizeBatchExpiry,
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

  it('computes exact UTC boundaries for Asia/Karachi day and next day start', () => {
    const { startUtc, endUtc } = getKarachiDayBoundsUtc('2026-10-28');
    // 2026-10-28 00:00:00 PKT -> 2026-10-27 19:00:00 UTC
    expect(startUtc).toBe('2026-10-27T19:00:00.000Z');
    // 2026-10-28 23:59:59.999 PKT -> 2026-10-28 18:59:59.999 UTC
    expect(endUtc).toBe('2026-10-28T18:59:59.999Z');

    expect(getKarachiDayStartUtc('2026-10-28')).toBe('2026-10-27T19:00:00.000Z');
    expect(getKarachiDayEndUtc('2026-10-28')).toBe('2026-10-28T18:59:59.999Z');

    // Next day start (exclusive upper bound for half-open intervals)
    expect(getKarachiNextDayStartUtc('2026-10-28')).toBe('2026-10-28T19:00:00.000Z');
    expect(getKarachiNextDayStartUtc('2026-10-31')).toBe('2026-10-31T19:00:00.000Z');
    expect(getKarachiNextDayStartUtc('2024-02-28')).toBe('2024-02-28T19:00:00.000Z');
    expect(getKarachiNextDayStartUtc('2024-02-29')).toBe('2024-02-29T19:00:00.000Z');
    expect(getKarachiNextDayStartUtc('2026-12-31')).toBe('2026-12-31T19:00:00.000Z');
  });

  it('throws TypeError when getKarachiBusinessDate is passed a date string with no Z and no UTC offset', () => {
    // Machine-timezone dependent strings must be rejected
    expect(() => getKarachiBusinessDate('2026-11-12')).toThrow(TypeError);
    expect(() => getKarachiBusinessDate('2026-11-12T15:30:00')).toThrow(TypeError);
    expect(() => getKarachiBusinessDate('2026-11-12 15:30:00')).toThrow(TypeError);

    // Strings with Z or explicit offset are valid
    expect(getKarachiBusinessDate('2026-11-12T00:00:00.000Z')).toBe('2026-11-12');
    expect(getKarachiBusinessDate('2026-11-12T05:00:00+05:00')).toBe('2026-11-12');
    expect(getKarachiBusinessDate('2026-11-12T00:00:00+0500')).toBe('2026-11-12');
    expect(getKarachiBusinessDate('2026-11-12T00:00:00-05:00')).toBe('2026-11-12');
  });

  it('adds days to business dates accurately across month ends, leap years, and year ends', () => {
    expect(addDaysToBusinessDate('2026-10-28', 1)).toBe('2026-10-29');
    expect(addDaysToBusinessDate('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysToBusinessDate('2026-12-31', 1)).toBe('2027-01-01');

    // Leap years
    expect(addDaysToBusinessDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToBusinessDate('2024-02-29', 1)).toBe('2024-03-01');
    // Non-leap year
    expect(addDaysToBusinessDate('2023-02-28', 1)).toBe('2023-03-01');

    // Multi-day jumps
    expect(addDaysToBusinessDate('2026-01-01', 45)).toBe('2026-02-15');
    expect(addDaysToBusinessDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToBusinessDate('2024-03-01', -1)).toBe('2024-02-29');

    // Invalid formats
    expect(() => addDaysToBusinessDate('2026/10/28', 1)).toThrow(TypeError);
    expect(() => addDaysToBusinessDate('invalid', 1)).toThrow(TypeError);
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

  describe('C3: Batch Expiry Rules & Normalization', () => {
    it('verifies exact batch expiry behavior on reference date', () => {
      // Is a batch expiring on 2026-11-12 sellable on 2026-11-12?
      expect(isBatchExpired('2026-11-12', '2026-11-12')).toBe(false); // SELLABLE throughout 2026-11-12
      expect(isBatchExpired('2026-11-12', '2026-11-13')).toBe(true); // EXPIRED on 2026-11-13
    });

    it('proves raw unnormalized YYYY-MM string comparison causes premature expiry on first of month', () => {
      // Without normalization, '2026-11' < '2026-11-01' is TRUE due to string length/character comparison
      expect('2026-11' < '2026-11-01').toBe(true);
      expect(isBatchExpired('2026-11', '2026-11-01')).toBe(true);
      expect(isBatchExpired('2026-11', '2026-11-12')).toBe(true);
    });

    it('normalizes month/year inputs to the LAST day of the month according to pharmaceutical standards', () => {
      // Standard YYYY-MM-DD passes through
      expect(normalizeBatchExpiry('2026-11-12')).toBe('2026-11-12');

      // YYYY-MM converts to last day of month
      expect(normalizeBatchExpiry('2026-11')).toBe('2026-11-30');
      expect(normalizeBatchExpiry('2026-12')).toBe('2026-12-31');
      expect(normalizeBatchExpiry('2024-02')).toBe('2024-02-29'); // Leap year
      expect(normalizeBatchExpiry('2025-02')).toBe('2025-02-28'); // Non-leap year

      // MM/YYYY converts to last day of month
      expect(normalizeBatchExpiry('11/2026')).toBe('2026-11-30');
      expect(normalizeBatchExpiry('1/2026')).toBe('2026-01-31');
      expect(normalizeBatchExpiry('02/2024')).toBe('2024-02-29');

      // Normalized 11/2026 is sellable throughout November 2026
      const normalized = normalizeBatchExpiry('11/2026');
      expect(normalized).toBe('2026-11-30');
      expect(isBatchExpired(normalized, '2026-11-01')).toBe(false);
      expect(isBatchExpired(normalized, '2026-11-12')).toBe(false);
      expect(isBatchExpired(normalized, '2026-11-30')).toBe(false);
      expect(isBatchExpired(normalized, '2026-12-01')).toBe(true);

      // Rejects invalid formats
      expect(() => normalizeBatchExpiry('invalid')).toThrow(TypeError);
      expect(() => normalizeBatchExpiry('13/2026')).toThrow(TypeError);
    });
  });
});
