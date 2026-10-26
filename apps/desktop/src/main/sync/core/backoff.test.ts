import { describe, it, expect } from 'vitest';
import { nextDelayMs } from './backoff';

describe('backoff: nextDelayMs (Phase 3.2)', () => {
  it('grows exponentially with a 2-second initial delay doubling each attempt (neutral jitter = 0%)', () => {
    // When random() returns 0.5, jitterFactor = 0.8 + 0.5 * 0.4 = 1.0 (0% jitter)
    const neutralRandom = () => 0.5;

    expect(nextDelayMs(0, neutralRandom)).toBe(2_000);   // 2s
    expect(nextDelayMs(1, neutralRandom)).toBe(4_000);   // 4s
    expect(nextDelayMs(2, neutralRandom)).toBe(8_000);   // 8s
    expect(nextDelayMs(3, neutralRandom)).toBe(16_000);  // 16s
    expect(nextDelayMs(4, neutralRandom)).toBe(32_000);  // 32s
    expect(nextDelayMs(5, neutralRandom)).toBe(64_000);  // 64s
    expect(nextDelayMs(6, neutralRandom)).toBe(128_000); // 128s
    expect(nextDelayMs(7, neutralRandom)).toBe(256_000); // 256s
  });

  it('caps backoff strictly at 5 minutes (300,000 ms)', () => {
    const neutralRandom = () => 0.5;

    // 2s * 2^8 = 512,000 ms -> must be capped at 300,000 ms
    expect(nextDelayMs(8, neutralRandom)).toBe(300_000);
    expect(nextDelayMs(10, neutralRandom)).toBe(300_000);
    expect(nextDelayMs(20, neutralRandom)).toBe(300_000);
  });

  it('strictly respects +/- 20% jitter bounds across all attempts', () => {
    const minRandom = () => 0; // Jitter factor = 0.8 (-20%)
    const maxRandom = () => 1; // Jitter factor = 1.2 (+20%)

    // For attempt 0 (base 2000ms):
    // min: 2000 * 0.8 = 1600ms
    // max: 2000 * 1.2 = 2400ms
    expect(nextDelayMs(0, minRandom)).toBe(1_600);
    expect(nextDelayMs(0, maxRandom)).toBe(2_400);

    // For capped 5-minute delay (300,000ms):
    // min: 300,000 * 0.8 = 240,000ms
    // max: 300,000 * 1.2 = 360,000ms
    expect(nextDelayMs(10, minRandom)).toBe(240_000);
    expect(nextDelayMs(10, maxRandom)).toBe(360_000);

    // Any random float in [0, 1) must remain strictly within [0.8 * base, 1.2 * base]
    for (let attempt = 0; attempt <= 10; attempt++) {
      const delayMin = nextDelayMs(attempt, minRandom);
      const delayMid = nextDelayMs(attempt, () => 0.5);
      const delayMax = nextDelayMs(attempt, maxRandom);

      expect(delayMin).toBeLessThanOrEqual(delayMid);
      expect(delayMid).toBeLessThanOrEqual(delayMax);
    }
  });

  it('handles negative or decimal attempt counts safely', () => {
    const neutralRandom = () => 0.5;
    expect(nextDelayMs(-1, neutralRandom)).toBe(2_000);
    expect(nextDelayMs(1.9, neutralRandom)).toBe(4_000);
  });
});
