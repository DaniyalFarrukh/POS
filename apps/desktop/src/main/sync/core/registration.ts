import type { Database as DatabaseInstance } from 'better-sqlite3';

export interface TokenStore {
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
}

export interface RegisterDeviceDependencies {
  db: DatabaseInstance;
  fetch: typeof fetch;
  tokenStore: TokenStore;
  clock?: { now: () => Date };
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface RegisterDeviceParams {
  serverUrl: string;
  code: string;
  deviceName: string;
}

export interface RegisterDeviceResult {
  deviceId: string;
  token: string;
  pharmacyId?: string;
  branchId?: string;
}

/**
 * Registers a terminal counter device with the central server per docs/SYNC_CLIENT.md.
 * Calls POST /devices/register, stores the encrypted JWT token, and records device tenancy in sync_state.
 */
export async function registerDevice(
  deps: RegisterDeviceDependencies,
  params: RegisterDeviceParams
): Promise<RegisterDeviceResult> {
  const normalizedUrl = params.serverUrl.replace(/\/+$/, '');
  const registerEndpoint = `${normalizedUrl}/devices/register`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  let response: Response;
  try {
    response = await deps.fetch(registerEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: params.code.trim(),
        deviceName: params.deviceName.trim(),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    deps.logger?.error('Failed to connect to server during device registration', err);
    throw new Error(
      `Cannot connect to server at ${normalizedUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let errorMsg = `Registration failed with HTTP ${response.status}`;
    try {
      const errBody = (await response.json()) as { message?: string; error?: string };
      errorMsg = errBody.message || errBody.error || errorMsg;
    } catch {
      // Keep default errorMsg
    }
    throw new Error(errorMsg);
  }

  const result = (await response.json()) as {
    deviceId: string;
    token: string;
    pharmacyId?: string;
    branchId?: string;
  };

  if (!result.deviceId || !result.token) {
    throw new Error('Invalid registration response: missing deviceId or token');
  }

  // 1. Store token securely via injected TokenStore
  await deps.tokenStore.setToken(result.token);

  // 2. Save device metadata in sync_state
  const now = (deps.clock ? deps.clock.now() : new Date()).toISOString();
  const updateState = deps.db.prepare(`
    INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)
  `);

  const tx = deps.db.transaction(() => {
    updateState.run('device_id', result.deviceId);
    updateState.run('server_url', normalizedUrl);
    updateState.run('last_online_at', now);
  });
  tx();

  return {
    deviceId: result.deviceId,
    token: result.token,
    pharmacyId: result.pharmacyId,
    branchId: result.branchId,
  };
}
