import { describe, it, expect } from 'vitest';
import { registerDevice } from './registration';

describe('M-06: Desktop WAN registration TLS enforcement in production', () => {
  it('rejects unencrypted HTTP URLs in production for remote servers', async () => {
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      const mockDeps = {
        fetch: async () => new Response('{}', { status: 200 }),
        storeSecret: async () => {},
        db: {} as any,
      };

      await expect(
        registerDevice(mockDeps, {
          serverUrl: 'http://api.hexapharm.pk:3000',
          code: 'REG-1234-5678',
          deviceName: 'Counter 1',
        })
      ).rejects.toThrow(/Insecure HTTP is not allowed in production for remote servers/);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('allows localhost plain HTTP even in production', async () => {
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      const mockDeps = {
        fetch: async () =>
          new Response(
            JSON.stringify({
              token: 'jwt-token',
              deviceId: '018f-dummy-device',
              pharmacyId: '018f-dummy-pharm',
              branchId: '018f-dummy-branch',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ),
        tokenStore: {
          getToken: async () => null,
          setToken: async () => {},
          clearToken: async () => {},
        },
        db: {
          prepare: () => ({ run: () => {} }),
          transaction: (fn: () => void) => fn,
        } as any,
      };

      const result = await registerDevice(mockDeps, {
        serverUrl: 'http://localhost:3000',
        code: 'REG-1234-5678',
        deviceName: 'Counter 1',
      });

      expect(result.deviceId).toBe('018f-dummy-device');
      expect(result.token).toBe('jwt-token');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});
