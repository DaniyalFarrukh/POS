import { describe, it, expect } from 'vitest';
import { getKarachiBusinessDate, toKarachiBusinessDate } from '@pos/shared';

describe('F-H-04: Asia/Karachi Business Date Consistency Across Timezones', () => {
  it('returns next calendar day during early morning PKT (20:30 UTC = 01:30 PKT next day)', () => {
    // 2026-02-28 21:30:00 UTC is 2026-03-01 02:30:00 Asia/Karachi
    const lateUtcNight = new Date('2026-02-28T21:30:00.000Z');

    const utcDate = lateUtcNight.toISOString().slice(0, 10);
    expect(utcDate).toBe('2026-02-28'); // UTC returns yesterday

    // Karachi business date must return March 1st!
    const karachiDate = getKarachiBusinessDate(lateUtcNight);
    expect(karachiDate).toBe('2026-03-01');

    const aliasDate = toKarachiBusinessDate(lateUtcNight);
    expect(aliasDate).toBe('2026-03-01');
  });

  it('correctly formats at midnight boundary (19:00:00 UTC = 00:00:00 PKT)', () => {
    // Exactly 00:00:00 PKT on Nov 1st is 19:00:00 UTC on Oct 31st
    const midnightPkt = new Date('2026-10-31T19:00:00.000Z');
    expect(getKarachiBusinessDate(midnightPkt)).toBe('2026-11-01');

    // 1 millisecond before midnight PKT (18:59:59.999 UTC) is still Oct 31st
    const beforeMidnightPkt = new Date('2026-10-31T18:59:59.999Z');
    expect(getKarachiBusinessDate(beforeMidnightPkt)).toBe('2026-10-31');
  });
});
