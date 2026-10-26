# Phase 3 Sync & Resilience Integration Test Report

## Executive Summary

This document presents the complete test report for Phase 3 sync architecture, multi-counter synchronization, crash recovery, and network resilience. All tests were executed against the real Fastify server, isolated PostgreSQL database schemas, and genuine file-backed SQLite database instances.

- **Status**: **PASSED** (100% of integration test suites passing)
- **Total Integration Tests**: 14 tests across 5 test suites
- **Total Workspace Test Suite**: 37 test files, 287 total tests (Unit, Stress, E2E, and Integration)
- **Zero Electron Dependencies**: Integration test harness and tests run entirely in pure Node.js / TypeScript strict mode.

---

## 1. Test Harness Architecture (`tests/integration/`)

The integration test harness (`@pos/integration-tests`) provides end-to-end integration without mocking server behavior:

1. **`startTestServer()`**:
   - Boots the real Fastify application from `apps/server` on an ephemeral TCP port (`127.0.0.1:0`).
   - Provisions a dynamically generated isolated PostgreSQL schema (`test_<uuid>`) via `createTestContext()`.
   - Seeds pharmacy, branch, Counter A, Counter B, user, product (Panadol 500mg), and tax category (18% GST).
   - Records seed changes into `change_log` so counters discover master data on initial pull.
   - Cleans up schemas and closes TCP servers on teardown.

2. **`createTestCounter(name, server, preferredCounterId)`**:
   - Creates a temporary directory with a dedicated SQLite database file.
   - Applies the real desktop migrations (v1 through v7).
   - Performs authentic device registration handshake (`POST /devices/register`) against the server.
   - Wraps client network calls through a controllable reverse proxy.
   - Instantiates `SyncWorker` and desktop services (`finalizeSale`, `receivePurchase`, `adjustStock`, `processReturn`).
   - Supports `goOffline()`, `goOnline()`, `syncNow()`, `syncUntilIdle()`, `restart()`, and `cleanup()`.

3. **Controllable Reverse Proxy (`createNetworkProxy`)**:
   - Runs on loopback `127.0.0.1`.
   - Supports `setMode('normal')`, `setMode('drop')`, and `setMode('503')`.
   - Supports `setDropNextPushResponse(true)`: forwards request to Fastify, permits server to completely process and commit the transaction, and destroys the client socket before the HTTP response reaches the client.

---

## 2. Test Scenarios & Results

### Suite 1: Failure Modes & Outages (`tests/integration/failure_modes.test.ts`)

| Scenario | Description | Result | Execution Time |
| :--- | :--- | :---: | :---: |
| **1. Server Outage Mid-Push** | 250 purchase events queued on Counter A (`device_seq` 1..250). Proxy drops connection after server processes the first batch of 100 but before response reaches client. Network is restored. All 250 events end up on server exactly once (no duplicates, no gaps), outbox is fully acked, and backoff delays were applied. | **PASSED** | 3,879 ms |
| **2. Server 503 Outage Recovery** | Counter A finalizes sales. Proxy returns HTTP 503 for 3 consecutive sync cycles. Events stay pending with 0 events lost. Proxy restored to normal; status transitions from `offline`/`error` to `online_idle` and all events ack cleanly. | **PASSED** | 1,120 ms |
| **3. Master Product Price Change** | Product price updated on server to 7500 paisa via `change_log`. Both counters pull on next cycle; new price appears locally in SQLite. Sale before pull used old price (5000 MRP); sale after pull uses new price (7500 MRP); stored old invoice remains strictly unchanged (immutability Rule 3). | **PASSED** | 961 ms |
| **4. Master Data Pull Echo Prevention** | Server writes new product, tax category, and supplier to `change_log`. Counter A pulls and applies master records. Local SQLite tables are populated, and outbox count remains strictly unchanged (0 echo outbox rows written). | **PASSED** | 846 ms |
| **5. Device Revocation & Offline Sales** | Server revokes Counter A device registration (`is_revoked = true`). Counter sync receives HTTP 403 Forbidden and transitions to `auth_error`. All events are retained (never deleted). Counter continues finalizing sales offline per Rule 38. | **PASSED** | 908 ms |

### Suite 2: Crash & Transactional Integrity (`tests/integration/crash_recovery.test.ts`)

| Scenario | Description | Result | Execution Time |
| :--- | :--- | :---: | :---: |
| **1. Crash After Outbox Write** | Counter finalizes a sale; process is killed immediately before sync occurs. `restart()` builds a new instance on the same SQLite file. Event remains pending, syncs on startup, and produces exactly one server invoice. | **PASSED** | 1,474 ms |
| **2. Crash During Pull** | SQLite trigger simulates an unexpected crash halfway through applying a page of changes. The atomic transaction rolls back completely: `pull_cursor` does not advance, and zero partial data is committed. Trigger removed; subsequent cycle succeeds cleanly. | **PASSED** | 895 ms |
| **3. Crash After Server Accepted Push** | Server accepts push and commits invoice, but response socket is dropped before client marks event acked. Process crashes and restarts. Resend on restart returns `duplicate`; client marks event acked; invoice exists exactly once on server. | **PASSED** | 935 ms |

### Suite 3: Multi-Counter Sync & Concurrency (`tests/integration/multicounter.test.ts`)

| Scenario | Description | Result | Execution Time |
| :--- | :--- | :---: | :---: |
| **1. Concurrent Offline Sales** | Counter A receives 100 units; both counters sync; both go offline. Counter A sells 30 units; Counter B sells 40 units offline. Both go online and sync until idle: server has both invoices, server batch stock = 30 ($100 - 30 - 40 = 30$), both local stocks = 30, invoice numbers do not collide (`CA-000001` vs `CB-000001`), outboxes acked. | **PASSED** | 1,692 ms |
| **2. Concurrent Offline Overselling** | Total sold (A sells 70, B sells 50 = 120 units) exceeds batch stock (100 units). Server accepts both sales without rejection, resulting balance on server is -20, and a `stock_alerts` row with `type: 'negative_stock'` and balance `-20` is logged. Neither sale rejected. | **PASSED** | 1,090 ms |
| **3. Duplicate Push Replay** | Replaying outbox events 3 times via local status reset to `pending`: server responds with `'duplicate'`, server invoice and movement row counts remain unchanged, and client outbox cleanly transitions back to `acked`. | **PASSED** | 1,179 ms |
| **4. Dependent Event Ordering** | Counter B receives purchase creating batch while offline. Counter A pushes invoice referencing that batch before pulling $\to$ server returns `retry_later` (`UNKNOWN_BATCH`). Counter B syncs batch. Counter A syncs again $\to$ auto-recovers push $\to$ invoice is acked with 0 manual intervention; server stock = 49. | **PASSED** | 1,131 ms |

### Suite 4: Full-Day Two-Counter Chaos Simulation (`tests/integration/simulation.test.ts`)

| Scenario | Description | Result | Execution Time |
| :--- | :--- | :---: | :---: |
| **Full Day Simulation (600 Ops)** | Two counters execute 300 operations each using a seeded PRNG (Mulberry32, seed 42): random mix of purchases, sales, returns, and adjustments, with intermittent offline toggles, 503 bursts, and simulated process crashes. At the end, both go online and sync until idle. | **PASSED** | 8,984 ms |

#### Invariants Verified in Simulation:
1. **Zero Unresolved Events**: Outbox pending count = 0 and exception count = 0 on both Counter A and Counter B.
2. **Stock Movement Balance Conservation**: For every batch created across the simulation, `serverStockForBatch(batchId)` equals $\sum \text{quantity\_signed}$ of all server stock movements.
3. **Local and Server Stock Convergence**: Server stock for every batch equals Counter A's local stock and Counter B's local stock.
4. **Invoice Total Financial Integrity**: Every invoice total (`total_paisa`) on the server matches the exact local invoice total on the originating counter.

### Suite 5: Smoke Test (`tests/integration/smoke.test.ts`)

| Scenario | Description | Result | Execution Time |
| :--- | :--- | :---: | :---: |
| **Smoke Test** | Counter device registers against central server, receives purchase of 100 units, syncs with server, and server displays batch with correct stock (100 units). | **PASSED** | 1,419 ms |

---

## 3. Bugs Discovered & Resolved

### Bug 1: Stock Movement Duplication on Pull
- **File**: `apps/desktop/src/main/sync/core/pullAndApply.ts`
- **Cause**: Local transactions generate client-side UUIDv7s for `stock_movements`. When server push appliers (`purchase.ts` and `invoice.ts`) apply events, they generate server UUIDs and write them to `change_log`. When the originating counter pulled, `INSERT OR IGNORE INTO stock_movements` evaluated `change.entityId` against local movement `id`. Because the IDs differed, the query inserted a duplicate stock movement row, erroneously doubling local stock balances upon pulling.
- **Fix**: Reconciled echoed stock movements by matching existing local movements on `(reference_type, reference_id, batch_id, quantity_signed)` and updating `id = change.entityId` to canonicalize the ID without adding duplicate inventory.

### Bug 2: Indiscriminate Mid-Flight Response Dropping in Test Proxy
- **File**: `tests/integration/proxy.ts`
- **Cause**: `setDropNextResponse(true)` destroyed the socket on the first request to hit the proxy. Because `SyncWorker` performs a `GET /health` check prior to pushing, the health probe response was dropped rather than the `POST /sync/push` response.
- **Fix**: Introduced `setDropNextPushResponse(true)` to filter specifically for `POST /sync/push` requests, allowing the health check to succeed and dropping the socket immediately after the server commits the push batch.

### Bug 3: Sequence Number Collision Across Test Cases
- **File**: `tests/integration/multicounter.test.ts`
- **Cause**: Counters re-created with initial invoice sequence 0 in subsequent tests generated invoice number `CA-000001`, colliding with the PostgreSQL constraint `uq_invoices_pharmacy_invoice_number` created in previous tests.
- **Fix**: Isolated the PostgreSQL schema per test run by instantiating `startTestServer()` in `beforeEach` and tearing down in `afterEach`.

---

## 4. Test Exclusions & Non-Tested Scope

To report results honestly, the following items were not tested in this automated test suite:

1. **Physical Hardware Peripherals**:
   - Thermal ESC/POS receipt printers (character encoding, paper cutting, cash drawer kick pulse).
   - Physical USB barcode scanners (keyboard emulation wedge).
2. **Operating System & Display Specifics**:
   - Physical monitor scaling at 1366x768 (UI components are tested for styling and rendering, but not against physical display drivers).
   - Windows installer and auto-updater packages.
3. **Transport Security (TLS / HTTPS)**:
   - Tests execute over loopback HTTP (`127.0.0.1`) without TLS certificates. Production deployment will require reverse proxy TLS termination (e.g. Caddy/Nginx) or HTTPS.
4. **Multi-Year Production Volume**:
   - The simulation validated 600 operations and ~1,000 movements in rapid succession. Long-term multi-year scale (> 1,000,000 rows per SQLite database) was not subjected to soak testing, though database indexes are configured.

---

## 5. Verification & Quality Gates Summary

All quality gates passed cleanly across the entire monorepo:

- **Lint (`pnpm lint`)**: 0 errors, 0 warnings across all packages.
- **Typecheck (`pnpm typecheck`)**: Clean pass across all 4 workspace projects:
  - `@pos/shared`
  - `@pos/server`
  - `@pos/desktop`
  - `@pos/integration-tests`
- **Test Suite (`pnpm test`)**:
  - **37 test files passed** (37 / 37)
  - **287 total tests passed** (287 / 287)
  - Total test run duration: **14.8 seconds**
