import { describe, it, expect } from 'vitest';
import { buildApp } from './app';

describe('GET /health', () => {
  it('returns ok: true with shared app info', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ ok: boolean; app: string; version: string }>();
    expect(body.ok).toBe(true);
    expect(body.app).toBe('POS');
    expect(body.version).toBe('0.1.0');
  });
});
