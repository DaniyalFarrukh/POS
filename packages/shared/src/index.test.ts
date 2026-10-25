import { describe, it, expect } from 'vitest';
import { getSharedInfo } from './index';

describe('getSharedInfo', () => {
  it('returns valid shared application metadata', () => {
    const info = getSharedInfo();
    expect(info.appName).toBe('POS');
    expect(info.version).toBe('0.1.0');
    expect(info.environment).toBe('development');
  });
});
