# Desktop Sync Client (Phase 3.2)

## Code structure (important for testing)
- apps/desktop/src/main/sync/core/: all sync logic. It must NOT import from 'electron'. It receives its dependencies by injection: db (better-sqlite3 instance), fetch function, clock (now()), logger, config. This lets tests run it under Vitest with two separate SQLite files and a real server.
- apps/desktop/src/main/sync/adapters/: Electron-specific code only (safeStorage for the token, IPC handlers, app lifecycle).

## Local tables (new migration, do not edit old ones)
- outbox (already exists): ensure it has event_id (UUIDv7, PK), device_seq INTEGER UNIQUE (monotonic per device, assigned in the same transaction that writes the event; backfill existing rows in created order), type, entity_id, payload (JSON), occurred_at, status ('pending'|'acked'|'exception'), attempts, last_error, created_at.
- sync_state (key/value): device_id, server_url, token_encrypted, pull_cursor, last_push_ok_at, last_pull_ok_at, last_online_at.
- sync_exceptions: id, event_id, code, message, payload, status ('open'|'dismissed'|'retried'), note, created_at, resolved_at.

## States
offline | online_idle | syncing | auth_error | error
- Connectivity check: GET {server_url}/health with a 5 s timeout. Any HTTP 200 = online.
- auth_error (HTTP 401/403 on push or pull): stop syncing, keep all events, surface in status. Never delete events.

## Push
- Single-flight: only one sync run at a time.
- Read pending events ORDER BY device_seq ASC, up to 100 per request.
- Per-event results:
  - accepted | duplicate -> status 'acked'.
  - retry_later -> stays 'pending', attempts+1, last_error set. After a push round that had retry_later results, run a pull, then retry once in the same run.
  - rejected -> status 'exception' and a row in sync_exceptions (code, message, payload).
- Whole-request failure (network error, timeout, 5xx): do not change any event, schedule retry with exponential backoff: 2 s, 4 s, 8 s ... capped at 5 min, with +/-20% jitter. Reset backoff on success.
- HTTP 400 for a whole batch means a client bug: set state 'error', keep events, log it. Do not drop events.
- Request timeout 15 s via AbortController.

## Pull
- GET /sync/pull?cursor=<pull_cursor>&limit=200. Loop while hasMore.
- Each page is applied in ONE SQLite transaction together with the cursor update (all or nothing).
- Apply = upsert by id into the local tables for products, tax_categories, branches, counters, users, suppliers, batches, stock_movements. op 'delete' marks the row inactive (or deletes it for stock_movements-type tables that never delete: ignore).
- Applying pulled data must NOT create outbox rows (no echo). Own events coming back are harmless because of upsert by id.
- Never overwrite locally-created, not-yet-acked data with older server data: for stock_movements and batches, insert only if the id does not exist.

## Offline limit
- Config: maxOfflineHours (default 72). Reference time = last_online_at.
- Levels: ok (< 50%), warning (50-80%), critical (80-100%), exceeded (> 100%).
- Sales are NEVER blocked by sync state or offline level. Levels only drive warnings in the UI.

## Scheduling
- Run a sync cycle: on app start, every 30 s when online, on 'syncNow', and right after a sale is finalized (debounced 2 s).
- Offline: probe connectivity with backoff instead of hammering.

## IPC (adapters)
getSyncStatus(), syncNow(), registerDevice(serverUrl, code), listSyncExceptions(), retryException(id), dismissException(id, note), and a push event 'sync-status-changed'. Owner/pharmacist only for exceptions. The token is encrypted with Electron safeStorage and never sent to the renderer.