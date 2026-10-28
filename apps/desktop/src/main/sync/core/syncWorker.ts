import { EventEmitter } from 'node:events';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { nextDelayMs } from './backoff';
import { computeOfflineLevel } from './offlineLevel';
import { createOutboxRepo, type OutboxRepository } from './outboxRepo';
import { pushPending } from './pushPending';
import { pullAndApply } from './pullAndApply';
import type { TokenStore } from './registration';
import type {
  SyncConfig,
  SyncConnectionState,
  SyncStatus,
} from './types';

export interface SyncWorkerDependencies {
  db: DatabaseInstance;
  fetch: typeof fetch;
  tokenStore: TokenStore;
  config?: Partial<SyncConfig>;
  clock?: { now: () => Date };
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
  random?: () => number;
  outboxRepo?: OutboxRepository;
}

export class SyncWorker extends EventEmitter {
  private db: DatabaseInstance;
  private fetchFn: typeof fetch;
  private tokenStore: TokenStore;
  private config: SyncConfig;
  private clock: { now: () => Date };
  private logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
  private random: () => number;
  private outboxRepo: OutboxRepository;

  private state: SyncConnectionState = 'offline';
  private consecutiveFailures = 0;
  private lastError: string | null = null;
  private isStarted = false;
  private isStopped = false;
  private scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSyncPromise: Promise<SyncStatus> | null = null;
  private hasPendingRerun = false;

  constructor(deps: SyncWorkerDependencies) {
    super();
    this.db = deps.db;
    this.fetchFn = deps.fetch;
    this.tokenStore = deps.tokenStore;
    this.clock = deps.clock || { now: () => new Date() };
    this.logger = deps.logger;
    this.random = deps.random || Math.random;
    this.outboxRepo = deps.outboxRepo || createOutboxRepo(this.db);

    // Initial config resolution with defaults
    this.config = {
      serverUrl: deps.config?.serverUrl || this.readStateKey('server_url') || 'http://127.0.0.1:3000',
      maxOfflineHours: deps.config?.maxOfflineHours ?? 72,
      syncIntervalMs: deps.config?.syncIntervalMs ?? 30_000,
      requestTimeoutMs: deps.config?.requestTimeoutMs ?? 15_000,
    };
  }

  public override on(event: 'status-changed', listener: (status: SyncStatus) => void): this {
    return super.on(event, listener);
  }

  public override off(event: 'status-changed', listener: (status: SyncStatus) => void): this {
    return super.off(event, listener);
  }

  public override emit(event: 'status-changed', status: SyncStatus): boolean {
    return super.emit(event, status);
  }

  /**
   * Starts the sync worker: initiates the initial sync cycle and enables scheduling.
   */
  public start(): void {
    if (this.isStarted && !this.isStopped) return;
    this.isStarted = true;
    this.isStopped = false;
    this.logger?.info('Sync worker started');
    void this.syncNow();
  }

  /**
   * Stops the sync worker: cancels all timers and disables further scheduled cycles.
   */
  public stop(): void {
    this.isStopped = true;
    this.isStarted = false;
    this.clearScheduledTimer();
    this.clearDebounceTimer();
    this.logger?.info('Sync worker stopped');
  }

  /**
   * Triggers a debounced sync cycle (default 2s delay), typically invoked after a sale is finalized.
   */
  public triggerDebouncedSync(delayMs = 2000): void {
    if (this.isStopped) return;
    this.clearDebounceTimer();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.isStopped) {
        void this.syncNow();
      }
    }, delayMs);
  }

  /**
   * Forces an immediate single-flight sync cycle.
   * If a cycle is already running, joins and returns the active execution promise.
   */
  public async syncNow(): Promise<SyncStatus> {
    if (this.isStopped) {
      return this.getStatus();
    }

    // Single-flight: return active promise if already executing
    if (this.currentSyncPromise) {
      return this.currentSyncPromise;
    }

    this.clearScheduledTimer();

    this.currentSyncPromise = this.executeCycle()
      .catch((err) => {
        this.logger?.error('Unhandled error in sync cycle', err);
        this.transitionTo('error', err instanceof Error ? err.message : String(err));
        this.scheduleBackoffRetry();
        return this.getStatus();
      })
      .finally(() => {
        this.currentSyncPromise = null;
      });

    return this.currentSyncPromise;
  }

  /**
   * Returns current sync client status snapshot per docs/SYNC_CLIENT.md.
   */
  public getStatus(): SyncStatus {
    const counts = this.outboxRepo.counts();
    const lastOnlineAt = this.readStateKey('last_online_at');
    const lastPushOkAt = this.readStateKey('last_push_ok_at');
    const lastPullOkAt = this.readStateKey('last_pull_ok_at');

    const offlineLevelResult = computeOfflineLevel(
      lastOnlineAt,
      this.clock.now(),
      this.config.maxOfflineHours
    );

    return {
      state: this.state,
      offlineLevel: offlineLevelResult.level,
      hoursOffline: offlineLevelResult.hoursOffline,
      percentUsed: offlineLevelResult.percentUsed,
      pendingCount: counts.pending,
      exceptionCount: counts.exception,
      lastPushOkAt,
      lastPullOkAt,
      lastOnlineAt,
      lastError: this.lastError,
    };
  }

  /**
   * Core sync execution cycle:
   * 1. Health/connectivity probe (GET /health, 5s timeout)
   * 2. Push pending events
   * 3. Pull server changes
   * 4. If push had retryLater results, pull then retry push once in the same run
   * 5. Schedule next interval or backoff delay
   */
  private async executeCycle(): Promise<SyncStatus> {
    this.transitionTo('syncing', null);

    const serverUrl = (
      this.readStateKey('server_url') ||
      this.config.serverUrl
    ).replace(/\/+$/, '');

    // 1. Connectivity check: GET {server_url}/health with a 5s timeout
    const isHealthy = await this.checkHealth(serverUrl);
    if (!isHealthy) {
      this.transitionTo('offline', 'Central server unreachable or health check failed');
      this.scheduleBackoffRetry();
      return this.getStatus();
    }

    // Health check succeeded -> device is online
    const nowIso = this.clock.now().toISOString();
    this.writeStateKey('last_online_at', nowIso);

    // 2. Read authentication token
    const token = await this.tokenStore.getToken();
    if (!token) {
      this.logger?.info('Server reachable but device not registered (no token)');
      this.transitionTo('online_idle', null);
      this.scheduleRegularSync();
      return this.getStatus();
    }

    // 3. Push pending events
    const pushSummary = await pushPending(
      {
        db: this.db,
        fetch: this.fetchFn,
        clock: this.clock,
        logger: this.logger,
        outboxRepo: this.outboxRepo,
      },
      {
        serverUrl,
        token,
        limit: 100,
      }
    );

    if (pushSummary.authError) {
      this.transitionTo('auth_error', 'Authentication failed (HTTP 401/403) on push');
      // Per docs: stop syncing, keep all events, surface in status
      return this.getStatus();
    }

    if (pushSummary.clientBug) {
      this.transitionTo('error', 'Push rejected with HTTP 400 (client bug)');
      this.scheduleBackoffRetry();
      return this.getStatus();
    }

    if (pushSummary.failedRequest) {
      this.transitionTo('error', 'Push failed: server or network error');
      this.scheduleBackoffRetry();
      return this.getStatus();
    }

    if (pushSummary.sent > 0 && pushSummary.acked > 0) {
      this.writeStateKey('last_push_ok_at', this.clock.now().toISOString());
    }

    // 4. Pull changes from server
    const pullSummary = await pullAndApply(
      {
        db: this.db,
        fetch: this.fetchFn,
        clock: this.clock,
        logger: this.logger,
      },
      {
        serverUrl,
        token,
        limit: 200,
      }
    );

    if (pullSummary.authError) {
      this.transitionTo('auth_error', 'Authentication failed (HTTP 401/403) on pull');
      return this.getStatus();
    }

    if (pullSummary.failedRequest) {
      this.transitionTo('error', 'Pull failed: server or network error');
      this.scheduleBackoffRetry();
      return this.getStatus();
    }

    // 5. If push had retry_later results: pull already ran, now retry push once in same run
    if (pushSummary.retryLater > 0) {
      this.logger?.info(`Push had ${pushSummary.retryLater} retry_later results, retrying push once...`);
      const retryPushSummary = await pushPending(
        {
          db: this.db,
          fetch: this.fetchFn,
          clock: this.clock,
          logger: this.logger,
          outboxRepo: this.outboxRepo,
        },
        {
          serverUrl,
          token,
          limit: 100,
        }
      );

      if (retryPushSummary.authError) {
        this.transitionTo('auth_error', 'Authentication failed (HTTP 401/403) on push retry');
        return this.getStatus();
      }

      if (retryPushSummary.clientBug) {
        this.transitionTo('error', 'Push retry rejected with HTTP 400 (client bug)');
        this.scheduleBackoffRetry();
        return this.getStatus();
      }

      if (retryPushSummary.failedRequest) {
        this.transitionTo('error', 'Push retry failed: server or network error');
        this.scheduleBackoffRetry();
        return this.getStatus();
      }

      if (retryPushSummary.sent > 0 && retryPushSummary.acked > 0) {
        this.writeStateKey('last_push_ok_at', this.clock.now().toISOString());
      }
    }

    // Cycle succeeded! Reset consecutive failures and schedule next regular interval
    this.consecutiveFailures = 0;
    this.transitionTo('online_idle', null);
    this.scheduleRegularSync();

    return this.getStatus();
  }

  /**
   * Health probe per docs/SYNC_CLIENT.md:
   * GET {server_url}/health with a 5 s timeout. Any HTTP 200 = online.
   */
  private async checkHealth(serverUrl: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await this.fetchFn(`${serverUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private transitionTo(newState: SyncConnectionState, error: string | null): void {
    const changed = this.state !== newState || this.lastError !== error;
    this.state = newState;
    this.lastError = error;

    if (changed) {
      const status = this.getStatus();
      this.emit('status-changed', status);
    }
  }

  private scheduleRegularSync(): void {
    if (this.isStopped) return;
    this.clearScheduledTimer();
    this.scheduledTimer = setTimeout(() => {
      this.scheduledTimer = null;
      void this.syncNow();
    }, this.config.syncIntervalMs);
  }

  private scheduleBackoffRetry(): void {
    if (this.isStopped) return;
    this.clearScheduledTimer();

    const delayMs = nextDelayMs(this.consecutiveFailures, this.random);
    this.consecutiveFailures += 1;

    this.logger?.info(`Scheduling sync retry in ${delayMs}ms (attempt #${this.consecutiveFailures})`);
    this.scheduledTimer = setTimeout(() => {
      this.scheduledTimer = null;
      void this.syncNow();
    }, delayMs);
  }

  private clearScheduledTimer(): void {
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private readStateKey(key: string): string | null {
    try {
      const row = this.db
        .prepare<[string], { value: string }>('SELECT value FROM sync_state WHERE key = ?')
        .get(key);
      return row ? row.value : null;
    } catch {
      return null;
    }
  }

  private writeStateKey(key: string, value: string): void {
    try {
      this.db
        .prepare<[string, string]>('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)')
        .run(key, value);
    } catch (err) {
      this.logger?.warn(`Failed to write sync_state key "${key}"`, err);
    }
  }
}

export function createSyncWorker(
  deps: SyncWorkerDependencies
): SyncWorker {
  return new SyncWorker(deps);
}
