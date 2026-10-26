import { describe, it, expect } from 'vitest';
import {
  getSyncStateStyle,
  formatKarachiDateTime,
  getOfflineBannerInfo,
  summarizePayload,
} from './types';

describe('Sync UI Helper Utilities', () => {
  describe('getSyncStateStyle', () => {
    it('returns green styling for online_idle', () => {
      const style = getSyncStateStyle('online_idle');
      expect(style.label).toBe('Online');
      expect(style.dotColor).toBe('#16a34a');
      expect(style.badgeBg).toBe('#f0fdf4');
    });

    it('returns amber styling for syncing', () => {
      const style = getSyncStateStyle('syncing');
      expect(style.label).toBe('Syncing...');
      expect(style.dotColor).toBe('#d97706');
    });

    it('returns gray styling for offline', () => {
      const style = getSyncStateStyle('offline');
      expect(style.label).toBe('Offline');
      expect(style.dotColor).toBe('#64748b');
    });

    it('returns red styling for auth_error', () => {
      const style = getSyncStateStyle('auth_error');
      expect(style.label).toBe('Auth Error');
      expect(style.dotColor).toBe('#dc2626');
    });

    it('returns rose styling for generic error', () => {
      const style = getSyncStateStyle('error');
      expect(style.label).toBe('Sync Error');
      expect(style.dotColor).toBe('#e11d48');
    });
  });

  describe('formatKarachiDateTime (Rule 8)', () => {
    it('returns "Never" for null/undefined/empty string', () => {
      expect(formatKarachiDateTime(null)).toBe('Never');
      expect(formatKarachiDateTime(undefined)).toBe('Never');
      expect(formatKarachiDateTime('')).toBe('Never');
    });

    it('returns "Invalid Date" for malformed string', () => {
      expect(formatKarachiDateTime('invalid-iso')).toBe('Invalid Date');
    });

    it('formats UTC ISO timestamp into Asia/Karachi (UTC+5)', () => {
      // 2026-10-26T12:00:00.000Z in UTC is 5:00 PM (17:00) in Asia/Karachi
      const formatted = formatKarachiDateTime('2026-10-26T12:00:00.000Z');
      expect(formatted).toContain('2026');
      expect(formatted).toContain('05:00:00 PM');
      expect(formatted).toContain('PKT');
    });
  });

  describe('getOfflineBannerInfo', () => {
    it('does not show banner when level is ok', () => {
      const banner = getOfflineBannerInfo('ok', 10, 13.8);
      expect(banner.showBanner).toBe(false);
    });

    it('shows warning banner when level is warning', () => {
      const banner = getOfflineBannerInfo('warning', 40, 55.5);
      expect(banner.showBanner).toBe(true);
      expect(banner.title).toContain('Approaching');
      expect(banner.message).toContain('40.0h');
      expect(banner.message).toContain('56%');
    });

    it('shows critical banner when level is critical', () => {
      const banner = getOfflineBannerInfo('critical', 65, 90.2);
      expect(banner.showBanner).toBe(true);
      expect(banner.title).toContain('Critical');
      expect(banner.message).toContain('65.0h');
      expect(banner.message).toContain('90%');
    });

    it('shows exceeded banner when level is exceeded and notes sales remain enabled', () => {
      const banner = getOfflineBannerInfo('exceeded', 80, 111.1);
      expect(banner.showBanner).toBe(true);
      expect(banner.title).toContain('Exceeded');
      expect(banner.message).toContain('80.0h');
      expect(banner.message).toContain('Local sales remain enabled');
    });
  });

  describe('summarizePayload', () => {
    it('summarizes invoice payload cleanly', () => {
      const summary = summarizePayload({
        invoice_number: 'INV-2026-0042',
        total_paisa: 150000,
        items: [{ id: '1' }, { id: '2' }],
      });
      expect(summary.type).toBe('Invoice Event');
      expect(summary.summary).toContain('INV-2026-0042');
      expect(summary.summary).toContain('Rs. 1500.00');
      expect(summary.details).toEqual([
        { label: 'Invoice No', value: 'INV-2026-0042' },
        { label: 'Total', value: 'Rs. 1500.00' },
        { label: 'Items Count', value: '2' },
      ]);
    });

    it('summarizes GRN payload', () => {
      const summary = summarizePayload({
        grn_number: 'GRN-101',
        lines: [{ id: '1' }],
      });
      expect(summary.type).toBe('Goods Receiving (GRN)');
      expect(summary.summary).toContain('GRN-101');
    });

    it('summarizes credit note payload', () => {
      const summary = summarizePayload({
        credit_note_number: 'CN-88',
        lines: [{ id: '1' }],
      });
      expect(summary.type).toBe('Credit Note / Return');
      expect(summary.summary).toContain('CN-88');
    });

    it('summarizes stock adjustment payload', () => {
      const summary = summarizePayload({
        reason: 'Damaged vial',
        batch_id: 'batch-123',
        quantity: -5,
      });
      expect(summary.type).toBe('Stock Adjustment');
      expect(summary.summary).toBe('Damaged vial');
    });

    it('handles null/undefined gracefully', () => {
      const summary = summarizePayload(null);
      expect(summary.type).toBe('unknown');
    });
  });
});
