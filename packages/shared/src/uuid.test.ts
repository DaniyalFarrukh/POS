import { describe, it, expect } from 'vitest';
import { generateUuidV7, isValidUuidV7 } from './uuid';

describe('UUIDv7 Utility', () => {
  it('generates valid RFC 9562 UUIDv7 strings', () => {
    const id = generateUuidV7();
    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
    expect(isValidUuidV7(id)).toBe(true);

    // Character 14 should be '7' indicating version 7
    expect(id.charAt(14)).toBe('7');
    // Variant should be 8, 9, a, or b
    expect(['8', '9', 'a', 'b']).toContain(id.charAt(19).toLowerCase());
  });

  it('generates monotonic sequential IDs over time', async () => {
    const id1 = generateUuidV7();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const id2 = generateUuidV7();

    expect(isValidUuidV7(id1)).toBe(true);
    expect(isValidUuidV7(id2)).toBe(true);
    expect(id1).not.toBe(id2);
    // UUIDv7 is lexicographically sortable by time
    expect(id1 < id2).toBe(true);
  });
});
