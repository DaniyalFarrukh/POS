# Phase 3 Synchronization Protocol: Implementation & Status Report

This document records the implementation status of Phase 3 synchronization according to [`docs/SYNC.md`](file:///d:/POS/docs/SYNC.md) and [`docs/RULES.md`](file:///d:/POS/docs/RULES.md).

---

## 1. Summary of Implemented Components

### 1.1 Database Schema & Migrations (`apps/server/src/db/`)
- **Technology**: Drizzle ORM (`drizzle-orm/node-postgres`), PostgreSQL 16 (running via local Docker container `pos-postgres`).
- **Tenant Isolation**: Every tenant table strictly defines `pharmacy_id uuid NOT NULL` with an index (`idx_<table>_pharmacy`).
- **Integrity Constraints**:
  - `UNIQUE (pharmacy_id, event_id)` on `processed_events` for sync idempotency.
  - `UNIQUE (pharmacy_id, invoice_number)` on `invoices`.
  - `change_log.seq` is a `bigserial` primary key guaranteeing gap-free monotonic sequencing.
  - Money stored strictly as integer paisa (Rule 1). All IDs are UUIDv7 (Rule 2).
- **Tables Implemented**:
  `pharmacies`, `branches`, `counters`, `devices`, `device_registration_codes`, `users`, `tax_categories`, `products`, `suppliers`, `batches`, `stock_movements`, `invoices`, `invoice_lines`, `payments`, `credit_notes`, `credit_note_lines`, `processed_events`, `rejected_events`, `stock_alerts`, `change_log`.

### 1.2 Device Registration & Authentication (`apps/server/src/auth/` & `apps/server/src/routes/devices.ts`)
- **Registration Code CLI / Seed**:
  - [`apps/server/src/scripts/seed-dev.ts`](file:///d:/POS/apps/server/src/scripts/seed-dev.ts) provisions dev tenant, branch, counter, owner user, and generates single-use hashed registration code (`REG-XXXX-XXXX`).
  - Codes are stored as SHA-256 hashes with 24-hour expiration (`expires_at`) and marked single-use with `used_at`.
- **`POST /devices/register`**:
  - Validates one-time code hash, ensures code is unexpired and unused.
  - Atomically creates `devices` record and marks registration code as used.
  - Returns signed JWT containing `{ pharmacyId, branchId, deviceId }`.
  - Rate limited using `@fastify/rate-limit`.
- **Fastify Device Auth Hook (`requireDeviceAuth`)**:
  - Pre-handler hook verifying the Bearer JWT token.
  - Validates device exists in database and checks `is_revoked`.
  - Rejects revoked devices with HTTP 403 Forbidden.
  - Strictly derives tenancy from JWT / DB (`request.deviceContext`), never from request body or query params.

### 1.3 Synchronization Ingestion: `POST /sync/push` (`apps/server/src/sync/service.ts`)
- **Request Validation**: Validates payload with shared Zod schema [`SyncPushRequestSchema`](file:///d:/POS/packages/shared/src/schema/sync.ts), enforcing a maximum of 100 events per request.
- **Event Sequencing & Ordering**: Sorts events by `deviceSeq` ascending before execution, and guarantees the returned `results` array strictly mirrors the incoming request order.
- **Per-Event Transaction Isolation**:
  - Each event executes inside its own dedicated database transaction. A failure or rollback in one event never impacts any other event in the batch.
  - **Idempotency**: Inserts `(pharmacy_id, event_id)` into `processed_events` using `ON CONFLICT DO NOTHING`. If already present, immediately returns `status: "duplicate"` without touching rows.
  - **Schema Validation & Versioning**: Rejects unsupported schema versions (`schemaVersion !== 1`) with `status: "rejected"` (`SCHEMA_VERSION_UNSUPPORTED`).
- **Event Appliers**:
  - `purchase.received`: Inserts batches and purchase stock movements (`quantitySigned > 0`), writing change_log entries for downstream counters.
  - `invoice.created`: Validates totals consistency (`lines` sum === `totalPaisa`, `payments` sum === `totalPaisa`), verifies counter, cashier, products, and batches exist for the pharmacy. Inserts invoice header, lines, payments, and sale stock movements (`quantitySigned < 0`). If resulting batch stock drops below zero, accepts the sale and logs an alert to `stock_alerts`.
  - `credit_note.created`: Validates credit note lines, inserts return stock movements (`quantitySigned > 0`), and appends to change_log.
  - `stock_adjustment.created`: Applies adjustment movements (`quantitySigned != 0`). Records alert in `stock_alerts` if resulting stock is negative.
- **Status Responses**:
  - `accepted`: Event applied and committed.
  - `duplicate`: Event previously processed (treated as client success).
  - `retry_later`: Referenced product, batch, counter, or user does not yet exist on the server (e.g. `UNKNOWN_PRODUCT`, `UNKNOWN_BATCH`).
  - `rejected`: Permanent validation failure (`INVALID_PAYLOAD`, `TOTALS_MISMATCH`, `UNKNOWN_TYPE`). Stored in `rejected_events` for tenant owner visibility.

### 1.4 Central Change Log Pull: `GET /sync/pull` (`apps/server/src/sync/pull-service.ts`)
- **Cursor-based Monotonic Paging**: Reads from `change_log` where `pharmacy_id = JWT.pharmacyId` and `seq > cursor`, ordered by `seq` ascending.
- **Limits**: Defaults to 200, enforces maximum limit of 500.
- **Branch Scoping**: Automatically filters branch-scoped changes by the device's branch where applicable.
- **Multi-Tenant Protection**: Server query strictly enforces `change_log.pharmacy_id = ctx.pharmacyId`; changes from foreign pharmacies are completely unreachable.
- **Master Data Propagation**: [`apps/server/src/sync/change-log.ts`](file:///d:/POS/apps/server/src/sync/change-log.ts) exposes `recordMasterDataChange` to write `change_log` entries when products, tax categories, branches, counters, users, or suppliers are mutated centrally.
- **Seed Utility**: [`apps/server/src/scripts/seed-products.ts`](file:///d:/POS/apps/server/src/scripts/seed-products.ts) seeds master data products to demonstrate pull pagination.

---

## 2. End-to-End Automated Server Test Suite (`apps/server/src/sync/sync-e2e.test.ts`)

The end-to-end test suite executes the real Fastify application against isolated test schemas in the test PostgreSQL database, validating all 5 scenarios:

| # | Scenario | Status | Real Test Results |
|---|---|:---:|---|
| 1 | **Dual Device Interoperability & Stock Balance**<br>Register two devices in the same pharmacy, push events from both, pull from both: both see the same batches and stock movements, and stock balance equals the sum of movements. | **PASS** | Device 1 registered (`Terminal Counter 1`), Device 2 registered (`Terminal Counter 2`). Device 1 pushed `purchase.received` (+100 units). Device 2 pushed `invoice.created` (-30 units). Device 1 pushed `stock_adjustment.created` (+10 units). Both devices pulled: returned identical batch and 3 identical stock movements. Total calculated balance = 80 units; matches `SELECT SUM(quantity_signed)` from database. |
| 2 | **Replay Idempotency (3x)**<br>Replay the same push batch 3 times: results become `duplicate`, row counts unchanged. | **PASS** | Push 1: all events returned `accepted`; rows created in `processed_events`, `batches`, `invoices`, `stock_movements`, `change_log`. Replay 2: all events returned `duplicate`, row counts identical. Replay 3: all events returned `duplicate`, row counts strictly unchanged. |
| 3 | **Bulk Processing with Middle Failure (100 Events)**<br>Send 100 events including one invalid one in the middle: the others are accepted. | **PASS** | Pushed 100 events (deviceSeq 1..100). Event index 49 (deviceSeq 50) had invalid zero quantity. Response HTTP 200 with 100 results: 99 events `accepted`, 1 event `rejected` (`code: INVALID_PAYLOAD`). Exactly 1 row created in `rejected_events`, exactly 99 rows created in `processed_events`. |
| 4 | **Revoked Device Token Guard**<br>Revoked device token rejected on push and pull. | **PASS** | Device registered and verified functional. Marked `is_revoked = true` in DB. Subsequent `POST /sync/push` rejected with HTTP 403 (`Device has been revoked`). Subsequent `GET /sync/pull` rejected with HTTP 403 (`Device has been revoked`). |
| 5 | **Strict Multi-Tenant Isolation**<br>Device from pharmacy A can never read or write pharmacy B data. | **PASS** | Device A (Pharmacy A) pulled from `/sync/pull`: zero items from Pharmacy B returned. Device A attempted to push a stock adjustment referencing Pharmacy B's private product and batch: rejected with `retry_later` (`UNKNOWN_PRODUCT`). Pharmacy B's stock movements and batches remained 100% unaltered. |

---

## 3. Deviations and Architectural Notes

1. **`POST /devices/register` Response Payload**:
   - *docs/SYNC.md*: `{ deviceId, token }`
   - *Implementation*: `{ ok: true, deviceId, pharmacyId, branchId, token }` with HTTP 201 Created. Returning `pharmacyId` and `branchId` allows the client terminal to cache its assigned tenancy details locally on successful handshake without extra roundtrips.

2. **Drizzle Schema Isolation in Test Harness**:
   - *Detail*: In PostgreSQL, `drizzle-kit` generates foreign key DDL qualified with `"public".` (e.g., `REFERENCES "public"."pharmacies"("id")`).
   - *Implementation*: In [`apps/server/src/db/test-helper.ts`](file:///d:/POS/apps/server/src/db/test-helper.ts), the test migration runner dynamically replaces `"public".` with `"${schemaName}".` when creating isolated ephemeral test schemas. This guarantees complete schema isolation across concurrent test files without foreign key cross-contamination.

3. **Event Envelope Schema and Payload Separation**:
   - *Detail*: The outer envelope validates metadata (`eventId`, `deviceSeq`, `type`, `occurredAt`, `schemaVersion`). Appliers validate specific domain schemas (`PurchaseReceivedPayloadSchema`, `InvoiceCreatedPayloadSchema`, etc.) within per-event database transactions.
   - *Benefit*: An invalid event payload (such as totals mismatch or zero adjustment quantity) fails inside its individual transaction and is captured in `rejected_events`, rather than aborting the entire 100-event HTTP request.

4. **Negative Stock Policy**:
   - In accordance with Principle 4 of `docs/SYNC.md`, sales and adjustments that cause negative inventory are never rejected on the server (since goods have already physically left the counter). They are accepted, negative balance is recorded in `stock_movements`, and a `stock_alerts` record is logged for pharmacy management review.

---

### 1.5 Desktop Sync Client Core (`apps/desktop/src/main/sync/core/`)
- **Strict Isolation**: Pure modules with zero Electron imports, receiving `db` (better-sqlite3), `fetch`, `tokenStore`, and `logger` by dependency injection for Vitest testability.
- **Local SQLite Storage (Migration 7)**:
  - `outbox`: Updated with `device_seq INTEGER UNIQUE` (strictly assigned within the same SQLite transaction that writes the event via `(SELECT COALESCE(MAX(device_seq), 0) + 1 FROM outbox)`). Backfilled existing rows in created order.
  - `sync_state`: Key/value store for `server_url`, `device_id`, `pull_cursor`, `last_push_ok_at`, `last_pull_ok_at`, and `last_online_at`.
  - `sync_exceptions`: Stores rejected sync events with failure code, message, original payload, and status (`open` | `dismissed` | `retried`).
- **Pure Core Modules**:
  - `backoff.ts`: Exponential backoff (`nextDelayMs(attempt, random)`) doubling starting at 2 s, capped at 5 min, with +/- 20% jitter.
  - `offlineLevel.ts`: Computes offline warning levels based on `last_online_at` and `maxOfflineHours` (default 72h): `ok` (<50%), `warning` (50-80%), `critical` (80-100%), `exceeded` (>100%). Sales are never blocked by offline levels.
  - `outboxRepo.ts`: Atomic outbox reads, acknowledgments, retries, exceptions, exception listing, retrying, and dismissal.
  - `pushPending.ts`: Sends pending events ordered by `device_seq` ASC (up to 100 per request) with 15s timeout via AbortController. Handles `accepted`/`duplicate` -> `acked`, `retry_later` -> `pending` (attempts+1), `rejected` -> `sync_exceptions`.
  - `pullAndApply.ts`: Loops `GET /sync/pull?cursor=&limit=200` while `hasMore`. Each page applied in ONE SQLite transaction with cursor advancement. Upsert by ID for master tables, delete marks inactive. Insert-only-if-missing for batches and stock movements. Never writes outbox rows (no echo).
  - `registration.ts`: `registerDevice(serverUrl, code, deviceName)` calling `POST /devices/register`, saving encrypted token and tenancy in `sync_state`.
  - `syncWorker.ts`: State machine (`offline` | `online_idle` | `syncing` | `auth_error` | `error`), single-flight concurrency, connectivity probe (`GET /health`, 5s), push-pull-retry cycle, backoff scheduling, debounced 2s sale sync, and status event emitter.

### 1.6 Electron Adapters (`apps/desktop/src/main/sync/adapters/`)
- **`SafeStorageTokenStore` (`tokenStore.ts`)**: Encrypts JWT with Electron `safeStorage` before storing in `sync_state`. Falls back safely in headless test environments.
- **Sync IPC Handlers (`syncIpc.ts`)**:
  - `getSyncStatus()`: Returns current connection state, offline level, hours offline, and outbox counts.
  - `syncNow()`: Forces single-flight immediate cycle.
  - `registerDevice(serverUrl, code)`: Handshake with central server. Token encrypted via `safeStorage` and NEVER sent to renderer.
  - `listSyncExceptions()`, `retryException(id)`, `dismissException(id, note)`: Guarded with role checks (`owner` and `pharmacist` only).
  - Broadcasts `sync-status-changed` to all renderer windows.
  - Debounced 2s trigger hooked into sale finalization in `index.ts` without modifying transaction logic.

### 1.7 Sync Core Resilience Tests (`apps/desktop/src/main/sync/core/resilience.test.ts`)
- **Network Failure & Duplication**: Server drops connection mid-push (`socket.destroy()`); events remain pending, client retries, server returns `duplicate`, and events end up acked exactly once without row count growth.
- **Server 500 & Backoff Schedule**: Server responds with 500 five consecutive times followed by 200 OK; backoff delays follow the 2s, 4s, 8s, 16s, 32s schedule deterministically and 0 events are lost.
- **Process Restart & Crash Recovery**: Worker 1 executes pushes on a file-backed SQLite database; process crashes mid-stream; Worker 2 resumes from the exact same SQLite database file, preserves `pull_cursor`, sends only pending events, and never resends previously acked events.
- **Per-Event Exception Isolation**: Middle event in a batch rejected (`TOTALS_MISMATCH`); rejected event routes to `sync_exceptions` with error code and payload; preceding and subsequent events in the same batch sync successfully.
- **Exception Lifecycle**: `dismissException(id, note)` stamps resolution note and `resolved_at`; `retryException(id)` transitions exception to `retried`, resets outbox row to `pending`, and successfully completes sync on the subsequent push.
- **1,000 Event Queue Batching**: 1,000 contiguous events sync across 10 strictly ordered batches of 100 events each ($1..100$, $101..200$, ... $901..1000$) with zero sequence gaps.

### 1.8 Desktop Sync UI (`apps/desktop/src/renderer/components/sync/`)
- **Top-Bar Indicator (`SyncTopBarIndicator.tsx`)**: Replaces static pill in header. Shows live connection state (`Online` / `Syncing...` / `Offline` / `Auth Error` / `Sync Error`), pulsing animations, pending outbox count (`• N pending`), and red exception badge. Clicking opens the Sync Status modal.
- **Offline Warning Banner (`SyncOfflineBanner.tsx`)**: Prominent banner displayed when approaching or exceeding the 72h offline threshold (`warning`: amber, `critical`: orange-red, `exceeded`: crimson). Details offline hours, limit percentage, notes sales remain enabled per policy, and provides a direct "Sync Now" quick-action button.
- **Sync Status Modal & Dashboard (`SyncStatusModal.tsx`, `SyncDashboardScreen.tsx`)**: Full status dialog and dedicated navigation view showing connection state, `lastOnlineAt`, `lastPushOkAt`, `lastPullOkAt` (formatted in `Asia/Karachi` time per Rule 8), pending count, exception count, visual progress meter for offline limit, and immediate "Retry Now" button.
- **Exceptions Management Screen (`SyncExceptionsView.tsx`)**: Guarded for `owner` and `pharmacist` roles. Filterable by status (`open`, `dismissed`, `retried`, `all`). Displays error code, server rejection message, local timestamp, formatted payload card with JSON inspector, "Retry Event" action, and "Dismiss with Note" dialog with audit logging.
- **Pure Helpers & Test Suite (`syncUi.test.ts`, `types.ts`)**: 17 unit tests verifying status badge colors, Asia/Karachi date/time formatting, offline banner thresholds, and payload summary extractors.

### 1.9 Integration Test Harness & Multi-Counter Sync Resilience (`tests/integration/`)
- **Integration Test Package (`@pos/integration-tests`)**:
  - Independent monorepo package with its own `tsconfig.json` and `package.json` extending root workspace configurations.
  - Zero Electron dependencies: runs directly in Vitest with pure Node.js runtime and PostgreSQL.
- **Harness Infrastructure (`tests/integration/harness.ts`)**:
  - `startTestServer()`: Boots the real Fastify app on an ephemeral TCP port (`127.0.0.1:0`) against an isolated PostgreSQL schema created via `createTestContext()`. Seeds pharmacy, branch, Counter A, Counter B, user, product (Panadol 500mg), tax category (18% GST), and records initial `change_log` entries so counters discover master data on initial pull. Returns `baseUrl`, `createRegistrationCode()`, `runSql()`, `stop()`.
  - `createTestCounter(name, server)`: Allocates an isolated temporary directory with a dedicated SQLite database, executes real desktop migrations, registers through real HTTP handshake (`POST /devices/register`), provisions `SyncWorker` and desktop services (`finalizeSale`, `receivePurchase`), and provides `goOffline()`, `goOnline()`, `isOnline()`, `syncNow()`, `syncUntilIdle()`, `restart()`, and `cleanup()`.
  - `createNetworkProxy(targetUrl)` (`proxy.ts`): Controllable in-process HTTP proxy supporting network modes: `normal` forwarding, socket drop (`req.socket.destroy()`), HTTP 503 Service Unavailable, and millisecond delay.
  - Test helper assertions: `serverStockForBatch(batchId)`, `localStockForBatch(counter, batchId)`, `countServerInvoices()`, `countOutbox(counter, status)`.
- **Smoke Test (`tests/integration/smoke.test.ts`)**:
  - Counter registers, receives purchase of 100 units of a batch, syncs with server, and server displays batch with correct stock (100 units).
- **Multi-Counter Sync Resilience Scenarios (`tests/integration/multicounter.test.ts`)**:
  1. *Concurrent Offline Sales*: Counter A receives 100 units, both sync, both go offline. Counter A sells 30 units and Counter B sells 40 units while offline. Both go online and sync until idle: server contains both invoices, server stock for the batch is exactly 30 ($100 - 30 - 40 = 30$), local stock on both counters reconciles to 30 after pull, invoice numbers do not collide (`CA-000001` vs `CB-000001`), and outboxes are fully acked.
  2. *Concurrent Offline Overselling*: Total sold (Counter A sells 70, Counter B sells 50 = 120 units) exceeds batch stock (100 units). Server accepts both sales without rejection, resulting balance on server is -20, and a `stock_alerts` row with `type: 'negative_stock'` and balance `-20` is recorded. Neither sale is rejected per negative stock policy.
  3. *Duplicate Push Replay*: Replaying outbox events 3 times via local status reset to `pending`: server responds with `'duplicate'`, server invoice and stock movement row counts remain strictly unchanged, and client outbox cleanly transitions back to `acked`.
  4. *Dependent Event Ordering*: Counter B receives a purchase creating a new batch while offline. Counter A pushes an invoice referencing that batch before pulling: server responds with `retry_later` (`UNKNOWN_BATCH`). Counter B goes online and syncs batch. Counter A pulls and retries push: invoice is accepted and acked with zero manual intervention, leaving server stock at 49.
- **Production Bug Exposed & Fixed (`apps/desktop/src/main/sync/core/pullAndApply.ts`)**:
  - *Bug*: When a counter pulled its own purchase or sale echoed back in `change_log`, `stock_movements` were inserted with new server-generated UUIDs because local UUIDs differed from server UUIDs. `INSERT OR IGNORE INTO stock_movements` failed to recognize the movement as already existing, causing inventory balances to erroneously double upon pulling.
  - *Fix*: Handled echo deduplication by checking existing local movements matching `(reference_type, reference_id, batch_id, quantity_signed)` and updating `id = change.entityId` to canonicalize the movement UUID without adding duplicate inventory.

---

## 4. Verification & Quality Gates

All checks run against the live PostgreSQL database and workspace packages:
- **Lint (`pnpm lint`)**: 0 errors, 0 warnings.
- **Typecheck (`pnpm typecheck`)**: Clean pass across all 4 workspace projects (`@pos/shared`, `@pos/server`, `@pos/desktop`, `@pos/integration-tests`).
- **Tests (`pnpm test`)**: 35 test files passed, 278 total unit, integration, stress, and E2E tests passing in ~12.25s.


