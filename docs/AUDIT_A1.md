# Senior Engineering Audit Report (`AUDIT_A1`)

**Repository:** `d:\POS` (HexaPharm Offline-First Pharmacy POS & Inventory System)  
**Audit Mode:** Strictly Read-Only (only `docs/AUDIT_A1.md` created)  
**Documents Reviewed:** [RULES.md](file:///d:/POS/docs/RULES.md), [ARCHITECTURE.md](file:///d:/POS/docs/ARCHITECTURE.md), [SPEC.md](file:///d:/POS/docs/SPEC.md), [SYNC.md](file:///d:/POS/docs/SYNC.md), [SYNC_CLIENT.md](file:///d:/POS/docs/SYNC_CLIENT.md), [SYNC_STATUS.md](file:///d:/POS/docs/SYNC_STATUS.md)

---

## Executive Summary & Verification Commands Run

| Command | Exit Code | Result Summary |
| :--- | :---: | :--- |
| `pnpm lint` | `0` | `eslint .` passed with 0 errors and 0 warnings (`eslint.config.mjs` omits `**/dist-release/**`). |
| `pnpm typecheck` | `0` | `pnpm -r run typecheck` passed across `@pos/shared`, `@pos/ui`, `@pos/desktop`, `@pos/server`, `@pos/web`, and `@pos/integration-tests`. |
| `pnpm test` | `1` | **Failed:** 40 of 41 test suites passed (316/317 tests); [tests/integration/failure_modes.test.ts:39](file:///d:/POS/tests/integration/failure_modes.test.ts#L39) (`1. Server outage mid-push: queue 250 events, drop response after first 100, then restore network with backoff`) failed with `Error: Test timed out in 5000ms` under full-suite parallel execution (runs in `4836ms` when executed in isolation). |
| `pnpm audit` | `1` | **Failed:** 2 vulnerabilities found — **1 High** (`zod <4.6.6`, `GHSA-mrhx-c7xc-m3w5` via `@pos/shared > zod@3.25.76`) and **1 Moderate** (`esbuild <=0.24.2`, `GHSA-67mh-4wv8-2f99` via `@pos/server > drizzle-kit > @esbuild-kit/* > esbuild@0.18.20`). |

### Overall Assessment
While core domain primitives (`allocateFefo`, `computeInvoiceTotals`, `finalizeSale`, and the core sync state machine) are well-structured, **the repository fails 11 of the 13 non-negotiable engineering rules in [docs/RULES.md](file:///d:/POS/docs/RULES.md)** and contains multiple **Critical production-breaking defects**:
1. **Desktop-to-Server Sync Contract Breakage:** Every Goods Received Note (`receiveGrn` in [purchasing.ts:305-319](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L305-L319)), every shift open/close ([shifts.ts:230-261](file:///d:/POS/apps/desktop/src/main/shifts.ts#L230-L261), [437-476](file:///d:/POS/apps/desktop/src/main/shifts.ts#L437-L476)), and legacy `createInvoice` ([invoices.ts:325-339](file:///d:/POS/apps/desktop/src/main/invoices.ts#L325-L339)) write outbox payloads or event types that are rejected 100% of the time by `/sync/push`. Integration tests masked the GRN bug because [tests/integration/harness.ts:479-602](file:///d:/POS/tests/integration/harness.ts#L479-L602) re-implemented `receivePurchase` inline instead of calling `receiveGrn`.
2. **Unauthenticated Account Takeover on Desktop:** `auth:complete-setup` ([apps/desktop/src/main/auth.ts:52-106](file:///d:/POS/apps/desktop/src/main/auth.ts#L52-L106)) never checks `getSetupStatus(db).needsSetup`. Any unauthenticated caller at the login/lock screen can create a new `owner` user and immediately hijack `activeSession`.
3. **Cross-Tenant Authentication & Missing Tenant Ownership Checks on Server:** `POST /api/auth/login` ([apps/server/src/routes/auth.ts:41-57](file:///d:/POS/apps/server/src/routes/auth.ts#L41-L57)) queries `users` across **all pharmacies** without a `pharmacy_id` filter whenever `pharmacyId` is omitted (and the web app [AuthContext.tsx:58-62](file:///d:/POS/apps/web/src/context/AuthContext.tsx#L58-L62) never sends `pharmacyId`). Furthermore, seeded dev owner login is broken because [seed-dev.ts:123](file:///d:/POS/apps/server/src/scripts/seed-dev.ts#L123) hashes PIN `'1234'` with SHA-256 while [routes/auth.ts:77](file:///d:/POS/apps/server/src/routes/auth.ts#L77) verifies with `bcrypt.compareSync`.
4. **Missing PostgreSQL Immutability Triggers:** SQLite has `BEFORE UPDATE`/`BEFORE DELETE` triggers on `invoices`, `invoice_lines`, `payments`, and `credit_notes`, but PostgreSQL ([apps/server/drizzle/0000_orange_hex.sql](file:///d:/POS/apps/server/drizzle/0000_orange_hex.sql)) has **zero** immutability triggers.
5. **Direct Mutation of `stock_movements` During Sync Pull:** [pullAndApply.ts:173-175](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L173-L175) and [338-341](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L338-L341) execute `UPDATE stock_movements SET id = ? WHERE id = ?` because server sync appliers ([invoice.ts:197](file:///d:/POS/apps/server/src/sync/appliers/invoice.ts#L197), [purchase.ts:85](file:///d:/POS/apps/server/src/sync/appliers/purchase.ts#L85), [credit-note.ts:167](file:///d:/POS/apps/server/src/sync/appliers/credit-note.ts#L167)) generate brand-new UUIDs on the server instead of using client-generated movement IDs.

---

## Part 1: Compliance Matrix Against `docs/RULES.md` (Rules 1–13)

| Rule | Title | Status | Evidence (File Paths & Line Numbers) |
| :---: | :--- | :---: | :--- |
| **Rule 1** | **Money is Integer Paisa** (`roundHalfUp` in `packages/shared` only; no floats/decimals) | **FAIL** | 1. Two different rounding functions exist in `packages/shared`: `roundPaisa` (`Math.round` on float paisa at [packages/shared/src/money.ts:31-36](file:///d:/POS/packages/shared/src/money.ts#L31-L36)) and `roundHalfUp` ([packages/shared/src/money.ts:74-83](file:///d:/POS/packages/shared/src/money.ts#L74-L83)).<br>2. Float division `/ 100`, `.toFixed()`, `parseFloat()`, `Math.round()`, and `Math.ceil()` are used on money across [apps/web/src/lib/formatters.ts:5-11](file:///d:/POS/apps/web/src/lib/formatters.ts#L5-L11), [PaymentModal.tsx:43-44, 64, 68-71, 95, 114-115, 351-352](file:///d:/POS/apps/desktop/src/renderer/components/pos/PaymentModal.tsx#L43-L95), [PosCheckoutScreen.tsx:285, 288, 1083, 1109](file:///d:/POS/apps/desktop/src/renderer/components/pos/PosCheckoutScreen.tsx#L285-L288), [ProductForm.tsx:47, 68-69, 75, 81](file:///d:/POS/apps/desktop/src/renderer/components/products/ProductForm.tsx#L47-L81), [GrnReceivingForm.tsx:173-175](file:///d:/POS/apps/desktop/src/renderer/components/purchasing/GrnReceivingForm.tsx#L173-L175), [ReturnModal.tsx:81, 290](file:///d:/POS/apps/desktop/src/renderer/components/invoices/ReturnModal.tsx#L81), [DayEndReportScreen.tsx:53](file:///d:/POS/apps/desktop/src/renderer/components/shifts/DayEndReportScreen.tsx#L53), [apps/desktop/src/renderer/components/sync/types.ts:192](file:///d:/POS/apps/desktop/src/renderer/components/sync/types.ts#L192), [apps/server/src/reports/queries.ts:483](file:///d:/POS/apps/server/src/reports/queries.ts#L483), [ProfitPerBatchReportPage.tsx:51](file:///d:/POS/apps/web/src/pages/reports/ProfitPerBatchReportPage.tsx#L51), and [seed-products.ts:179, 207](file:///d:/POS/apps/server/src/scripts/seed-products.ts#L179). |
| **Rule 2** | **IDs are UUIDv7, Generated on the Client** | **FAIL** | 1. Server sync appliers generate new `stock_movements` UUIDs on the server instead of receiving client-generated IDs: [apps/server/src/sync/appliers/invoice.ts:197](file:///d:/POS/apps/server/src/sync/appliers/invoice.ts#L197), [purchase.ts:85](file:///d:/POS/apps/server/src/sync/appliers/purchase.ts#L85), [credit-note.ts:167](file:///d:/POS/apps/server/src/sync/appliers/credit-note.ts#L167).<br>2. Non-UUIDv7 IDs inserted into synced tables: `'tax-cat-default'` in [pullAndApply.ts:62-66](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L62-L66) and `'system-return-user'` fallback in [returns.ts:291](file:///d:/POS/apps/desktop/src/main/returns.ts#L291).<br>3. `isValidUuidV7` ([packages/shared/src/uuid.ts:10](file:///d:/POS/packages/shared/src/uuid.ts#L10)) is never used in any Zod schema; all schemas use `.uuid()` which accepts UUIDv1–v8, and [apps/server/src/db/db.test.ts:91-272](file:///d:/POS/apps/server/src/db/db.test.ts#L91-L272) uses `crypto.randomUUID()` (UUIDv4). |
| **Rule 3** | **Invoices are Immutable** (enforced by DB trigger on both SQLite and Postgres) | **FAIL** | SQLite migrations 5 and 6 ([apps/desktop/src/main/db.ts:476-510](file:///d:/POS/apps/desktop/src/main/db.ts#L476-L510), [603-625](file:///d:/POS/apps/desktop/src/main/db.ts#L603-L625)) create `BEFORE UPDATE` and `BEFORE DELETE` triggers on `invoices`, `invoice_lines`, `payments`, `credit_notes`, and `credit_note_lines`. **However, PostgreSQL migrations ([apps/server/drizzle/0000_orange_hex.sql:1-311](file:///d:/POS/apps/server/drizzle/0000_orange_hex.sql#L1-L311)) define NO immutability triggers on any table, and server invoice immutability is untested.** |
| **Rule 4** | **Stock Changes Only Through `stock_movements`** (never `UPDATE` or `DELETE` a row in `stock_movements`) | **FAIL** | While `batches` has no quantity column and stock balances are computed via `SUM(stock_movements.quantity_signed)`, [apps/desktop/src/main/sync/core/pullAndApply.ts:173-175](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L173-L175) and [338-341](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L338-L341) execute `UPDATE stock_movements SET id = ? WHERE id = ?`, directly mutating `stock_movements` rows. Also, legacy `createInvoice` ([apps/desktop/src/main/invoices.ts:207](file:///d:/POS/apps/desktop/src/main/invoices.ts#L207)) skips inserting a `stock_movements` row if `batchId` is `null`. Neither SQLite nor Postgres has `BEFORE UPDATE`/`BEFORE DELETE` triggers on `stock_movements`. |
| **Rule 5** | **Every Multi-Table Write and Outbox Entry is One Transaction** | **FAIL** | 1. Server multi-table writes (`users` + `change_log`, `branches` + `change_log`, `counters` + `change_log`, `products` + `change_log`) run **outside** `db.transaction(...)` in [apps/server/src/routes/admin.ts:98-116, 184-201, 241-260](file:///d:/POS/apps/server/src/routes/admin.ts#L98-L260) and [apps/server/src/scripts/seed-products.ts:57-77, 140-170, 186-205](file:///d:/POS/apps/server/src/scripts/seed-products.ts#L57-L205).<br>2. `PATCH /api/admin/users/:id` ([admin.ts:126-148](file:///d:/POS/apps/server/src/routes/admin.ts#L126-L148)) mutates `users` without writing to `change_log` at all.<br>3. Desktop local mutations in `completeSetup`, `createStaffMember`, `updateStaffMember`, `createProduct`, `updateProduct`, `importProductsCsv`, `createSupplier`, `updateSupplier` never write `outbox` rows, and `seedDatabase` ([apps/desktop/src/main/db/seed.ts:137-145](file:///d:/POS/apps/desktop/src/main/db/seed.ts#L137-L145)) inserts tax categories outside `seedTx`. |
| **Rule 6** | **Strict Electron Security & Typed IPC** (validated with Zod on main side) | **FAIL** | 1. 15+ IPC handlers in [apps/desktop/src/main/index.ts](file:///d:/POS/apps/desktop/src/main/index.ts) and [syncIpc.ts](file:///d:/POS/apps/desktop/src/main/sync/adapters/syncIpc.ts) lack Zod validation (`products:import-csv`, `auth:create-staff-member`, `auth:update-staff-member`, `invoices:print-receipt`, `invoices:search`, `backup:restore`, `sync:registerDevice`, `sync:listExceptions`, `sync:retryException`, `sync:dismissException`, etc.).<br>2. 20+ IPC handlers lack authentication/role guards (`auth:complete-setup` allows unauthenticated owner creation; `products:seed`, `backup:create`, `backup:list`, `system:export-diagnostics`, `invoices:print-receipt` have no auth check; `backup:restore` at [index.ts:444](file:///d:/POS/apps/desktop/src/main/index.ts#L444) forgets to check `!session.isLocked`). |
| **Rule 7** | **Tenant Isolation on the Server** (every query filters by `pharmacy_id` from JWT) | **FAIL** | 1. `POST /api/auth/login` ([apps/server/src/routes/auth.ts:41-57](file:///d:/POS/apps/server/src/routes/auth.ts#L41-L57)) queries `users` without `pharmacy_id` when `pharmacyId` is omitted from the request body.<br>2. `POST /api/admin/counters` ([admin.ts:228-263](file:///d:/POS/apps/server/src/routes/admin.ts#L228-L263)) and `POST /api/admin/registration-codes` ([admin.ts:310-340](file:///d:/POS/apps/server/src/routes/admin.ts#L310-L340)) accept `branchId`/`counterId` without checking that they belong to `userContext.pharmacyId`.<br>3. Sync appliers ([purchase.ts:91](file:///d:/POS/apps/server/src/sync/appliers/purchase.ts#L91), [stock-adjustment.ts:68](file:///d:/POS/apps/server/src/sync/appliers/stock-adjustment.ts#L68), [credit-note.ts:114-116](file:///d:/POS/apps/server/src/sync/appliers/credit-note.ts#L114-L116)) do not verify `branchId`/`counterId`/`cashierUserId` belong to `ctx.pharmacyId`.<br>4. Multi-table JOINs in [apps/server/src/reports/queries.ts:155-518](file:///d:/POS/apps/server/src/reports/queries.ts#L155-L518) and [admin.ts:221, 286-287](file:///d:/POS/apps/server/src/routes/admin.ts#L221) omit `pharmacy_id` on joined tables, and [seed-products.ts:192](file:///d:/POS/apps/server/src/scripts/seed-products.ts#L192) updates `products` by `id` alone. |
| **Rule 8** | **Timestamps are UTC; Display is `Asia/Karachi`** | **FAIL** | 1. Business-day, FEFO expiry, and report date boundaries use UTC (`new Date().toISOString().slice(0, 10)` and `T00:00:00.000Z`..`T23:59:59.999Z`) instead of `Asia/Karachi` (UTC+5) in [finalizeSale.ts:249](file:///d:/POS/apps/desktop/src/main/finalizeSale.ts#L249), [invoices.ts:36, 78, 549-557](file:///d:/POS/apps/desktop/src/main/invoices.ts#L36), [purchasing.ts:378-380, 455-457](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L378-L380), [InvoiceHistoryScreen.tsx:33-47](file:///d:/POS/apps/desktop/src/renderer/components/invoices/InvoiceHistoryScreen.tsx#L33-L47), [apps/server/src/routes/dashboard.ts:18](file:///d:/POS/apps/server/src/routes/dashboard.ts#L18), and [apps/server/src/reports/queries.ts:169, 267, 270, 296, 381](file:///d:/POS/apps/server/src/reports/queries.ts#L169).<br>2. UI components format dates using OS local timezone without `timeZone: 'Asia/Karachi'` in [PosCheckoutScreen.tsx:308](file:///d:/POS/apps/desktop/src/renderer/components/pos/PosCheckoutScreen.tsx#L308), [StaffManagementScreen.tsx:544-548](file:///d:/POS/apps/desktop/src/renderer/components/staff/StaffManagementScreen.tsx#L544-L548), and [SettingsScreen.tsx:835](file:///d:/POS/apps/desktop/src/renderer/components/settings/SettingsScreen.tsx#L835). |
| **Rule 9** | **TypeScript Strict Mode Everywhere** (no `any`, `as any`, `@ts-ignore`, `@ts-expect-error`) | **FAIL** | While `strict: true` is enabled in [tsconfig.base.json:9-13](file:///d:/POS/tsconfig.base.json#L9-L13) and no `any` or `@ts-ignore` exists, `@ts-expect-error` is used in production server routes [apps/server/src/routes/sync.ts:31, 76](file:///d:/POS/apps/server/src/routes/sync.ts#L31) (`// @ts-expect-error custom error payload for 400`) and in [packages/shared/src/money.test.ts:34](file:///d:/POS/packages/shared/src/money.test.ts#L34). |
| **Rule 10** | **Desktop UI is Plain CSS + Bundled Fonts; Web UI is React + Tailwind** (no external CDNs or web fonts) | **FAIL** | 1. [apps/desktop/index.html:8-13](file:///d:/POS/apps/desktop/index.html#L8-L13) loads `Inter` and `JetBrains Mono` from external Google Fonts CDN (`https://fonts.googleapis.com` / `https://fonts.gstatic.com`), directly violating Rule 10 ("no external CDNs or web fonts (the app must work offline)").<br>2. [packages/ui/src/components/Select.tsx:15, 25](file:///d:/POS/packages/ui/src/components/Select.tsx#L15), [Table.tsx:57](file:///d:/POS/packages/ui/src/components/Table.tsx#L57), and [Button.tsx:40](file:///d:/POS/packages/ui/src/components/Button.tsx#L40) use non-RTL-safe physical properties (`pr-8`, `right-0`, `text-left`, `-ml-1 mr-2`). |
| **Rule 11** | **Database Engines** (`better-sqlite3` with WAL + FK ON + `integrity_check`; Postgres 16 + Drizzle) | **PASS** | Verified in [apps/desktop/src/main/db.ts:805-827](file:///d:/POS/apps/desktop/src/main/db.ts#L805-L827) (`journal_mode = WAL`, `foreign_keys = ON`, `PRAGMA integrity_check`) and [apps/server/src/db/index.ts:1-30](file:///d:/POS/apps/server/src/db/index.ts#L1-L30) + [docker-compose.yml:4](file:///d:/POS/docker-compose.yml#L4) (`postgres:16-alpine` with `drizzle-orm/node-postgres`). |
| **Rule 12** | **Backups are Restorable, Not Just Created** (atomic `.bak` + `VACUUM INTO`, tested in CI) | **PASS** | Verified in [apps/desktop/src/main/backup.ts:94-264](file:///d:/POS/apps/desktop/src/main/backup.ts#L94-L264) (`VACUUM INTO`, zip archive with `manifest.json` SHA-256 checksum, `PRAGMA integrity_check` on staging DB before swap, atomic `.pre-restore.bak` swap and rollback on failure) and tested end-to-end in [apps/desktop/src/main/backup.test.ts:1-220](file:///d:/POS/apps/desktop/src/main/backup.test.ts#L1-L220). |
| **Rule 13** | **Definition of Done per Phase** (`pnpm lint`, `pnpm typecheck`, `pnpm test` green; no `TODO`/`FIXME` in critical paths; no `.skip`/`.only`) | **FAIL** | 1. `pnpm test` fails (`exit code 1`) due to timeout in [tests/integration/failure_modes.test.ts:39](file:///d:/POS/tests/integration/failure_modes.test.ts#L39).<br>2. 28 conditional `context.skip()` calls exist in `apps/server/src/**/*.test.ts` ([db.test.ts:49, 87, 139, 231](file:///d:/POS/apps/server/src/db/db.test.ts#L49), [auth.test.ts:473](file:///d:/POS/apps/server/src/auth/auth.test.ts#L473), [sync-pull.test.ts:520](file:///d:/POS/apps/server/src/sync/sync-pull.test.ts#L520), [sync-push.test.ts:1244](file:///d:/POS/apps/server/src/sync/sync-push.test.ts#L1244), [sync-e2e.test.ts:177, 411, 610, 748, 805](file:///d:/POS/apps/server/src/sync/sync-e2e.test.ts#L177), [reports.test.ts:436-892](file:///d:/POS/apps/server/src/reports/reports.test.ts#L436-L892)). |

---

## Part 2: Findings Grouped by Severity

### Critical Severity (C-01 to C-11)

- **C-01 — Desktop `receiveGrn` Outbox Payload Fails Server `PurchaseReceivedPayloadSchema` (100% GRN Sync Rejection)**
  - **Location:** [apps/desktop/src/main/purchasing.ts:305-319](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L305-L319) vs. [packages/shared/src/schema/sync.ts:56-69](file:///d:/POS/packages/shared/src/schema/sync.ts#L56-L69) & [apps/server/src/sync/appliers/purchase.ts:12](file:///d:/POS/apps/server/src/sync/appliers/purchase.ts#L12)
  - **Evidence:** `receiveGrn` writes `{ purchaseId, supplierId, supplierInvoiceNo, totalCostPaisa, lineCount }` into `outbox.payload_json`. The server validates `purchase.received` against `PurchaseReceivedPayloadSchema`, which requires `{ purchase: { id, branchId, supplierId, invoiceNumber, receivedByUserId, subtotalPaisa, taxPaisa, totalPaisa, notes, receivedAt }, batches: [...], lines: [...] }`. Every GRN received in the desktop app is permanently rejected with `INVALID_PAYLOAD` and quarantined in `sync_exceptions`.
- **C-02 — Desktop `openShift` and `closeShift` Write Unsupported Outbox Event Types (`shift.opened`, `shift.closed`)**
  - **Location:** [apps/desktop/src/main/shifts.ts:230-261](file:///d:/POS/apps/desktop/src/main/shifts.ts#L230-L261), [437-476](file:///d:/POS/apps/desktop/src/main/shifts.ts#L437-L476) vs. [packages/shared/src/schema/sync.ts:3-8](file:///d:/POS/packages/shared/src/schema/sync.ts#L3-L8) & [apps/server/src/sync/service.ts:59-77](file:///d:/POS/apps/server/src/sync/service.ts#L59-L77)
  - **Evidence:** `openShift` and `closeShift` enqueue `'shift.opened'` and `'shift.closed'` into `outbox`. `SyncEventTypeSchema` only permits `'purchase.received' | 'invoice.created' | 'credit_note.created' | 'stock_adjustment.created'`. When `pushPending` includes a shift event in a batch of up to 100 events, `SyncPushRequestSchema.safeParse(request.body)` at [apps/server/src/routes/sync.ts:28](file:///d:/POS/apps/server/src/routes/sync.ts#L28) **rejects the entire HTTP 400 push batch**, blocking all subsequent sales, returns, and stock adjustments on that counter from syncing!
- **C-03 — Unauthenticated Account Takeover via `auth:complete-setup` IPC**
  - **Location:** [apps/desktop/src/main/index.ts:193-195](file:///d:/POS/apps/desktop/src/main/index.ts#L193-L195), [apps/desktop/src/main/auth.ts:52-106](file:///d:/POS/apps/desktop/src/main/auth.ts#L52-L106)
  - **Evidence:** `completeSetup(db, rawInput)` never checks `getSetupStatus(db).needsSetup`. At any time after initial setup (including when the terminal is logged out or locked), calling `window.api.auth.completeSetup(...)` creates a new `'owner'` user in SQLite and sets `activeSession` to that `'owner'` user ([auth.ts:95-103](file:///d:/POS/apps/desktop/src/main/auth.ts#L95-L103)).
- **C-04 — Cross-Tenant User Login & Missing `pharmacy_id` Filter on `POST /api/auth/login`**
  - **Location:** [apps/server/src/routes/auth.ts:41-57](file:///d:/POS/apps/server/src/routes/auth.ts#L41-L57), [apps/web/src/context/AuthContext.tsx:58-62](file:///d:/POS/apps/web/src/context/AuthContext.tsx#L58-L62)
  - **Evidence:** `POST /api/auth/login` only filters by `users.pharmacyId` if `pharmacyId` is provided in the request body, and `AuthContext.tsx:58-62` sends `{ name, pin }` without `pharmacyId`. The server runs `SELECT ... FROM users WHERE name = $1 LIMIT 1` across **all tenants**. If two pharmacies have a user named `"Owner"` or `"Admin"`, one tenant is locked out or authenticates into the wrong tenant if PINs match.
- **C-05 — Seeded Dev Owner Cannot Log In (SHA-256 vs. `bcrypt` Mismatch)**
  - **Location:** [apps/server/src/scripts/seed-dev.ts:123](file:///d:/POS/apps/server/src/scripts/seed-dev.ts#L123) vs. [apps/server/src/routes/auth.ts:77](file:///d:/POS/apps/server/src/routes/auth.ts#L77)
  - **Evidence:** `seed-dev.ts:123` hashes PIN `'1234'` with `crypto.createHash('sha256').update('1234').digest('hex')`, whereas `POST /api/auth/login` verifies `pinHash` with `bcrypt.compareSync(pin.trim(), user.pinHash)`. `bcrypt.compareSync` always returns `false` on a SHA-256 hash.
- **C-06 — Newly Created Cloud Users Cannot Log In on POS Counters (`pinHash` Omitted from `change_log`)**
  - **Location:** [apps/server/src/routes/admin.ts:109-116](file:///d:/POS/apps/server/src/routes/admin.ts#L109-L116) vs. [apps/desktop/src/main/sync/core/pullAndApply.ts:261-269](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L261-L269)
  - **Evidence:** `POST /api/admin/users` writes `data: { id, name, role, isActive }` to `change_log` without `pinHash`. When counters pull the user via `pullAndApply.ts:267`, `pin_hash` is set to `String(data.pinHash ?? '')` (`''`), making PIN login impossible on all desktop counters.
- **C-07 — Missing Immutability Triggers on PostgreSQL Server Database**
  - **Location:** [apps/server/drizzle/0000_orange_hex.sql:1-311](file:///d:/POS/apps/server/drizzle/0000_orange_hex.sql#L1-L311)
  - **Evidence:** Rule 3 mandates DB triggers on both SQLite and Postgres preventing `UPDATE` and `DELETE` on `invoices`, `invoice_lines`, and `payments`. Postgres migrations contain zero triggers.
- **C-08 — Hardcoded Fallback `JWT_SECRET` in Production Server**
  - **Location:** [apps/server/src/auth/jwt.ts:10-12](file:///d:/POS/apps/server/src/auth/jwt.ts#L10-L12)
  - **Evidence:** `getJwtSecret()` returns `process.env.JWT_SECRET || 'dev_pos_jwt_secret_change_in_production'` without throwing if `JWT_SECRET` is unset, and neither [.env.example](file:///d:/POS/.env.example) nor [apps/server/.env.example](file:///d:/POS/apps/server/.env.example) includes `JWT_SECRET`.
- **C-09 — Unvalidated Cross-Tenant Foreign Keys in Server Admin Routes & Sync Appliers**
  - **Location:** [apps/server/src/routes/admin.ts:228-263, 310-340](file:///d:/POS/apps/server/src/routes/admin.ts#L228-L340), [apps/server/src/sync/appliers/credit-note.ts:110-180](file:///d:/POS/apps/server/src/sync/appliers/credit-note.ts#L110-L180), [purchase.ts:91](file:///d:/POS/apps/server/src/sync/appliers/purchase.ts#L91), [stock-adjustment.ts:68](file:///d:/POS/apps/server/src/sync/appliers/stock-adjustment.ts#L68)
  - **Evidence:** `POST /api/admin/counters` and `POST /api/admin/registration-codes` do not verify that `branchId`/`counterId` belong to `userContext.pharmacyId`. Similarly, `applyCreditNoteCreated` never verifies that `branchId`, `counterId`, `cashierUserId`, or `originalInvoiceLineId` belong to `ctx.pharmacyId`, and `applyPurchaseReceived`/`applyStockAdjustmentCreated` do not verify `branchId` belongs to `ctx.pharmacyId`. Because Postgres FKs reference single-column `(id)` rather than composite `(pharmacy_id, id)`, cross-tenant UUIDs satisfy FK constraints.
- **C-10 — Legacy `createInvoice` IPC Bypasses FEFO, Skips `stock_movements`, Trusts Client Prices, and Breaks Sync**
  - **Location:** [apps/desktop/src/main/invoices.ts:20-345](file:///d:/POS/apps/desktop/src/main/invoices.ts#L20-L345), registered at [apps/desktop/src/main/index.ts:346-352](file:///d:/POS/apps/desktop/src/main/index.ts#L346-L352)
  - **Evidence:** `invoices:create` does not use `allocateFefo`, falls back to expired/zero-stock batches ([invoices.ts:175-189](file:///d:/POS/apps/desktop/src/main/invoices.ts#L175-L189)), skips inserting `stock_movements` when `batchId === null` ([invoices.ts:207](file:///d:/POS/apps/desktop/src/main/invoices.ts#L207)), trusts client-supplied `unitPricePaisa`/`taxRateBp`, computes invoice numbers via `SELECT COUNT(*)` in UTC ([invoices.ts:71-81](file:///d:/POS/apps/desktop/src/main/invoices.ts#L71-L81)), and writes an `InvoiceRecord` to `outbox` that fails server `InvoiceCreatedPayloadSchema`.
- **C-11 — Local Master-Data Mutations Never Sync to Server, Blocking Downstream Transactions**
  - **Location:** [apps/desktop/src/main/auth.ts:52-106, 304-431](file:///d:/POS/apps/desktop/src/main/auth.ts#L52-L106), [products.ts:207-384](file:///d:/POS/apps/desktop/src/main/products.ts#L207-L384), [purchasing.ts:72-148](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L72-L148), [apps/server/src/scripts/seed-dev.ts:30-169](file:///d:/POS/apps/server/src/scripts/seed-dev.ts#L30-L169)
  - **Evidence:** Creating staff, products, or suppliers on desktop never writes to `outbox`, and `seed-dev.ts` never writes seeded `branches`, `counters`, or `users` to `change_log`. Consequently, sales or purchases referencing locally-created entities loop indefinitely in `retry_later` (`UNKNOWN_USER`, `UNKNOWN_PRODUCT`, `UNKNOWN_SUPPLIER`).

---

### High Severity (H-01 to H-16)

- **H-01 — Server Generates New UUIDs for `stock_movements` & Desktop Executes `UPDATE stock_movements SET id = ?`**
  - **Location:** [apps/server/src/sync/appliers/invoice.ts:197](file:///d:/POS/apps/server/src/sync/appliers/invoice.ts#L197), [purchase.ts:85](file:///d:/POS/apps/server/src/sync/appliers/purchase.ts#L85), [credit-note.ts:167](file:///d:/POS/apps/server/src/sync/appliers/credit-note.ts#L167), and [apps/desktop/src/main/sync/core/pullAndApply.ts:167-175, 329-344](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L167-L175)
  - **Evidence:** Violates Rule 2 (client-generated UUIDv7) and Rule 4 (never `UPDATE` a row in `stock_movements`). Furthermore, if an invoice or GRN has two lines for the same `(batch_id, quantity_signed)`, `findLocalMovementStmt` (`LIMIT 1` without `AND id != ?`) can match the wrong row.
- **H-02 — `convertRupeesToPaisa` Strips Minus Signs and Truncates >2 Decimal Places**
  - **Location:** [packages/shared/src/money.ts:166-198](file:///d:/POS/packages/shared/src/money.ts#L166-L198)
  - **Evidence:** Regex `/^[^0-9]*([0-9]+(?:\.[0-9]+)?)[^0-9]*$/` at line 180 strips leading `'-'`, turning `convertRupeesToPaisa('-35.50')` into `+3550` paisa! Line 193 (`(parts[1] + '00').slice(0, 2)`) truncates `'35.509'` to `3550` instead of rounding via `roundHalfUp`.
- **H-03 — `loadCreditNote` Snake_Case vs. CamelCase Bug Breaks Idempotent Return Replays**
  - **Location:** [apps/desktop/src/main/returns.ts:128-178, 266-272](file:///d:/POS/apps/desktop/src/main/returns.ts#L128-L178)
  - **Evidence:** `SELECT cnl.*, p.brand_name ... FROM credit_note_lines cnl` returns snake_case columns (`credit_note_id`, `original_invoice_line_id`, `batch_id`, `unit_price_paisa`, `tax_rate_bp`, `tax_paisa`, `line_total_paisa`), but `lines.map` at lines 142–157 reads camelCase properties (`l.creditNoteId`, `l.originalInvoiceLineId`, `l.unitPricePaisa`, etc.), returning `undefined` for all those fields when `processReturn` replays an existing `clientRequestId`.
- **H-04 — Locked Terminal Bypass on `backup:restore` and Unauthenticated IPC Write/Diagnostic Channels**
  - **Location:** [apps/desktop/src/main/index.ts:270-276, 366-371, 418-454](file:///d:/POS/apps/desktop/src/main/index.ts#L270-L454)
  - **Evidence:** `backup:restore` ([index.ts:444](file:///d:/POS/apps/desktop/src/main/index.ts#L444)) checks `session.user.role !== 'owner'` without checking `session.isLocked`. `products:seed` ([index.ts:274](file:///d:/POS/apps/desktop/src/main/index.ts#L274)), `backup:create` ([index.ts:434](file:///d:/POS/apps/desktop/src/main/index.ts#L434)), `backup:list` ([index.ts:438](file:///d:/POS/apps/desktop/src/main/index.ts#L438)), `system:export-diagnostics` ([index.ts:418](file:///d:/POS/apps/desktop/src/main/index.ts#L418)), and `invoices:print-receipt` ([index.ts:366](file:///d:/POS/apps/desktop/src/main/index.ts#L366)) have **no auth checks at all**.
- **H-05 — Missing Rate Limiting on `POST /api/auth/login` + Synchronous `bcrypt` Event-Loop Blocking**
  - **Location:** [apps/server/src/app.ts:37-39](file:///d:/POS/apps/server/src/app.ts#L37-L39), [apps/server/src/routes/auth.ts:20, 77](file:///d:/POS/apps/server/src/routes/auth.ts#L20), [apps/server/src/routes/admin.ts:96](file:///d:/POS/apps/server/src/routes/admin.ts#L96)
  - **Evidence:** `@fastify/rate-limit` is registered with `{ global: false }`, and `/api/auth/login` sets no `config.rateLimit`, allowing unlimited brute-forcing of 4-digit PINs while blocking the Node event loop with `bcrypt.compareSync`.
- **H-06 — Server Sync Push Catch-All Permanently Rejects Transient Errors Without Logging to `rejected_events`**
  - **Location:** [apps/server/src/sync/service.ts:117-124](file:///d:/POS/apps/server/src/sync/service.ts#L117-L124)
  - **Evidence:** Any unexpected DB error (e.g. deadlock, connection drop, or unique constraint collision on `(pharmacy_id, invoice_number)` when two counters share code `'C1'`) returns `status: 'rejected', code: 'INTERNAL_ERROR'` **without inserting into `rejected_events`** (violating [docs/SYNC.md:30](file:///d:/POS/docs/SYNC.md#L30)) and causes the client to permanently quarantine the event into `sync_exceptions`.
- **H-07 — Server Multi-Table Mutations Without Transactions & `PATCH /api/admin/users/:id` Missing `change_log`**
  - **Location:** [apps/server/src/routes/admin.ts:98-116, 126-148, 184-201, 241-260](file:///d:/POS/apps/server/src/routes/admin.ts#L98-L260), [apps/server/src/scripts/seed-products.ts:57-77, 140-170, 186-205](file:///d:/POS/apps/server/src/scripts/seed-products.ts#L57-L205)
  - **Evidence:** Admin user/branch/counter creations write to the entity table and `change_log` outside a transaction. `PATCH /api/admin/users/:id` updates `role`/`isActive` in `users` without writing to `change_log`, so deactivating a cashier in the web admin portal never revokes their access on POS counters.
- **H-08 — `seed-products.ts` Price Update Corrupts Product Columns on Counter Sync Pull**
  - **Location:** [apps/server/src/scripts/seed-products.ts:194-205](file:///d:/POS/apps/server/src/scripts/seed-products.ts#L194-L205) vs. [apps/desktop/src/main/sync/core/pullAndApply.ts:192-206](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L192-L206)
  - **Evidence:** `seed-products.ts` writes a partial product payload (`{ id, brandName, mrpPaisa, taxCategoryId, isActive, updatedAt }`) to `change_log`. When `pullAndApply.ts` applies `product` upsert, it overwrites `generic_name`, `strength`, `form`, `manufacturer` with `''` and `barcode` with `null`!
- **H-09 — `pullChangeLog` In-Memory Branch Filtering Causes Empty Pull Pages & Premature Sync Termination**
  - **Location:** [apps/server/src/sync/pull-service.ts:31-80](file:///d:/POS/apps/server/src/sync/pull-service.ts#L31-L80)
  - **Evidence:** `pullChangeLog` queries `limit + 1` rows from `change_log` for the pharmacy and filters out other branches' rows in JavaScript ([lines 54-68](file:///d:/POS/apps/server/src/sync/pull-service.ts#L54-L68)), which can return `changes: [], hasMore: true` when another branch has `>= limit` consecutive changes.
- **H-10 — `pullAndApply` Supplier Delete Breaks Foreign Keys & Tax Category Delete Makes Products Tax-Exempt**
  - **Location:** [apps/desktop/src/main/sync/core/pullAndApply.ts:101-103, 150-152, 214-215, 279-280](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L101-L280)
  - **Evidence:** `DELETE FROM suppliers WHERE id = ?` fails with `SQLITE_CONSTRAINT_FOREIGNKEY` if any local `purchases` row references the supplier, wedging sync pull forever. Deleting a `tax_category` executes `UPDATE tax_categories SET is_exempt = 1`, silently making all products in that category tax-exempt.
- **H-11 — `SyncWorker.executeCycle` Ignores Errors on `retryPushSummary`**
  - **Location:** [apps/desktop/src/main/sync/core/syncWorker.ts:281-319](file:///d:/POS/apps/desktop/src/main/sync/core/syncWorker.ts#L281-L319)
  - **Evidence:** When `pushSummary.retryLaterCount > 0`, `executeCycle` pulls and re-runs `pushPending` (`retryPushSummary`), but ignores `retryPushSummary.failedRequest` and `retryPushSummary.clientBug`, resetting `consecutiveFailures = 0` and transitioning to `'online_idle'` even when the retry push failed.
- **H-12 — Main Process Crash on Window Re-Creation (`Duplicate ipcMain.handle`)**
  - **Location:** [apps/desktop/src/main/index.ts:128-174, 528-532](file:///d:/POS/apps/desktop/src/main/index.ts#L128-L174)
  - **Evidence:** `registerIpcHandlers(db)` is called inside `createWindow(db)` without removing existing handlers. If `activate` triggers `createWindow(db)` when `BrowserWindow.getAllWindows().length === 0`, Electron throws `Error: Attempted to register a second handler for 'ping'`.
- **H-13 — External Google Fonts CDN Loaded in Desktop & Web (`index.html`)**
  - **Location:** [apps/desktop/index.html:8-13](file:///d:/POS/apps/desktop/index.html#L8-L13), [apps/web/index.html:8-13](file:///d:/POS/apps/web/index.html#L8-L13)
  - **Evidence:** Directly violates Rule 10 ("No external CDNs or web fonts (the app must work offline)").
- **H-14 — Money Rounding & Division Bugs in `PaymentModal.tsx` and `ReturnModal.tsx`**
  - **Location:** [apps/desktop/src/renderer/components/pos/PaymentModal.tsx:351-352](file:///d:/POS/apps/desktop/src/renderer/components/pos/PaymentModal.tsx#L351-L352), [apps/desktop/src/renderer/components/invoices/ReturnModal.tsx:81, 290](file:///d:/POS/apps/desktop/src/renderer/components/invoices/ReturnModal.tsx#L81)
  - **Evidence:** `PaymentModal.tsx:351` initializes split cash with `(grandTotalPaisa / 100).toFixed(0)`, truncating fractional rupees so `exactMatch` fails. `ReturnModal.tsx:81` computes `Math.round(line.lineTotalPaisa / line.soldQuantity) * returnQty`, disagreeing with backend `roundHalfUp(line.lineTotalPaisa * returnQty, line.soldQuantity)` ([returns.ts:340-343](file:///d:/POS/apps/desktop/src/main/returns.ts#L340-L343)).
- **H-15 — UTC vs. `Asia/Karachi` Date Boundary Bugs Across FEFO, Invoices, Purchasing, Dashboard, and Reports**
  - **Location:** [apps/desktop/src/main/finalizeSale.ts:249](file:///d:/POS/apps/desktop/src/main/finalizeSale.ts#L249), [invoices.ts:36, 78, 549-557](file:///d:/POS/apps/desktop/src/main/invoices.ts#L36), [purchasing.ts:378-380, 455-457](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L378-L380), [apps/server/src/routes/dashboard.ts:18](file:///d:/POS/apps/server/src/routes/dashboard.ts#L18), [apps/server/src/reports/queries.ts:169, 267, 270, 296, 381](file:///d:/POS/apps/server/src/reports/queries.ts#L169)
  - **Evidence:** Using `new Date().toISOString().slice(0, 10)` and `T00:00:00.000Z`..`T23:59:59.999Z` causes a 5-hour error window every night between `00:00` and `05:00 PKT` where expired batches can still be allocated by FEFO and sales are bucketed into the previous calendar day.
- **H-16 — High-Severity `zod` Vulnerability & Moderate `esbuild` Vulnerability in `pnpm audit`**
  - **Location:** [packages/shared/package.json:24](file:///d:/POS/packages/shared/package.json#L24) (`"zod": "^3.25.76"`), [apps/server/package.json:32](file:///d:/POS/apps/server/package.json#L32) (`"drizzle-kit": "^0.30.6"`)
  - **Evidence:** `pnpm audit` reports `GHSA-mrhx-c7xc-m3w5` (High: `zod <4.6.6` memory exhaustion on oversized constrained collections) and `GHSA-67mh-4wv8-2f99` (Moderate: `esbuild <=0.24.2`).

---

### Medium Severity (M-01 to M-14)

- **M-01 — SQL String Interpolation in `purchasing.ts` (`getStockOverviewProducts` & `getStockOverviewBatches`)**
  - **Location:** [apps/desktop/src/main/purchasing.ts:385, 387, 389, 462, 464, 466](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L385-L466)
  - **Evidence:** Interpolates `'${d60}'`, `'${d90}'`, `'${today}'` directly into SQL query strings instead of using `?` parameters.
- **M-02 — Missing `pharmacy_id` Filter on Multi-Table JOIN Clauses in Server Reports & Admin Routes**
  - **Location:** [apps/server/src/reports/queries.ts:155-156, 179-180, 200, 289-290, 301, 315-316, 330-331, 398-400, 458-460, 518](file:///d:/POS/apps/server/src/reports/queries.ts#L155-L518), [apps/server/src/routes/admin.ts:221, 286-287](file:///d:/POS/apps/server/src/routes/admin.ts#L221)
  - **Evidence:** Primary tables filter by `pharmacy_id`, but `innerJoin`/`leftJoin` clauses join solely on `.id` without `eq(joinedTable.pharmacyId, pharmacyId)`.
- **M-03 — Plaintext Device JWT Fallback in `SafeStorageTokenStore`**
  - **Location:** [apps/desktop/src/main/sync/adapters/tokenStore.ts:48-51](file:///d:/POS/apps/desktop/src/main/sync/adapters/tokenStore.ts#L48-L51)
  - **Evidence:** Falls back to storing `plain:${token}` in SQLite `sync_state` when `safeStorage.isEncryptionAvailable()` is `false`.
- **M-04 — Wide-Open CORS (`origin: true, credentials: true`) & Exposed `/test/protected-action` Endpoint in Server**
  - **Location:** [apps/server/src/app.ts:31-34, 69-83](file:///d:/POS/apps/server/src/app.ts#L31-L83)
  - **Evidence:** Reflects any origin with credentials enabled, and registers `/test/protected-action` unconditionally in `buildApp`.
- **M-05 — Missing Zod Validation on Server Auth, Admin, Device Registration, and Report Routes**
  - **Location:** [apps/server/src/routes/auth.ts:20](file:///d:/POS/apps/server/src/routes/auth.ts#L20), [admin.ts:79, 126, 172, 228, 294, 310, 345](file:///d:/POS/apps/server/src/routes/admin.ts#L79-L345), [devices.ts:36](file:///d:/POS/apps/server/src/routes/devices.ts#L36), [reports.ts:27, 50](file:///d:/POS/apps/server/src/routes/reports.ts#L27-L50)
  - **Evidence:** Manual `if` checks are used instead of Zod schemas; invalid UUID path params (`:id`) or non-numeric `expiresInHours` cause unhandled Postgres/JS exceptions (HTTP 500).
- **M-06 — Server Port Mismatch (`3001` in `server.ts` vs. `3000` in `.env.example` and `apps/web/vite.config.ts`)**
  - **Location:** [apps/server/src/server.ts:4](file:///d:/POS/apps/server/src/server.ts#L4), [apps/server/.env.example:5](file:///d:/POS/apps/server/.env.example#L5), [apps/web/vite.config.ts:10](file:///d:/POS/apps/web/vite.config.ts#L10)
  - **Evidence:** `server.ts` hardcodes `const port = 3001;` (ignoring `process.env.PORT`), while `apps/web/vite.config.ts` proxies `/api` to `http://localhost:3000`.
- **M-07 — Broken Supplier Ledger Report & Unused `suppliers` Table in Server Sync**
  - **Location:** [apps/server/src/reports/queries.ts:504-536](file:///d:/POS/apps/server/src/reports/queries.ts#L504-L536), [apps/server/src/sync/appliers/purchase.ts:1-120](file:///d:/POS/apps/server/src/sync/appliers/purchase.ts#L1-L120)
  - **Evidence:** `getSupplierLedgerReport` groups by `stockMovements.reason` (`"GRN: <invoiceNumber>"`) instead of querying `suppliers`, returning `supplierId: null` and treating every invoice number as a separate supplier.
- **M-08 — `counters.lastInvoiceSeq` and `lastCreditNoteSeq` Never Updated on Server**
  - **Location:** [apps/server/src/db/schema.ts:53-54](file:///d:/POS/apps/server/src/db/schema.ts#L53-L54), [apps/web/src/pages/admin/BranchesCountersPage.tsx:262](file:///d:/POS/apps/web/src/pages/admin/BranchesCountersPage.tsx#L262)
  - **Evidence:** Neither `applyInvoiceCreated` nor `applyCreditNoteCreated` increments `counters.lastInvoiceSeq` / `lastCreditNoteSeq`, so the web dashboard always shows `0` invoices issued per counter.
- **M-09 — `devices.lastSeenAt` Never Updated After Registration**
  - **Location:** [apps/server/src/auth/device-auth.ts:67-100](file:///d:/POS/apps/server/src/auth/device-auth.ts#L67-L100), [apps/server/src/routes/sync.ts:19-95](file:///d:/POS/apps/server/src/routes/sync.ts#L19-L95)
  - **Evidence:** Device authentication on `/sync/push` and `/sync/pull` never updates `devices.lastSeenAt`.
- **M-10 — Pharmacist Role Blocked from Branch Filter on Web Sales & Stock Reports**
  - **Location:** [apps/web/src/pages/reports/SalesReportPage.tsx:47](file:///d:/POS/apps/web/src/pages/reports/SalesReportPage.tsx#L47), [StockExpiryReportPage.tsx:31](file:///d:/POS/apps/web/src/pages/reports/StockExpiryReportPage.tsx#L31), [apps/server/src/routes/admin.ts:54](file:///d:/POS/apps/server/src/routes/admin.ts#L54)
  - **Evidence:** Report pages fetch branches from `GET /api/admin/branches`, which requires `['owner']` role, returning `403 Forbidden` for `pharmacist` users.
- **M-11 — Inconsistent User Shape Between `/api/auth/login` (`id`) and `/api/auth/me` (`userId`)**
  - **Location:** [apps/server/src/routes/auth.ts:102-108, 130-133](file:///d:/POS/apps/server/src/routes/auth.ts#L102-L133), [apps/web/src/types/index.ts:1-7](file:///d:/POS/apps/web/src/types/index.ts#L1-L7)
  - **Evidence:** `/api/auth/login` returns `user.id`, while `/api/auth/me` spreads `request.userContext` (`user.userId`).
- **M-12 — Broken Active/Inactive Pagination in Desktop `ProductList.tsx`**
  - **Location:** [apps/desktop/src/renderer/components/products/ProductList.tsx:86-93, 121-124, 202](file:///d:/POS/apps/desktop/src/renderer/components/products/ProductList.tsx#L86-L124)
  - **Evidence:** Fetches 25 products from SQLite without passing `isActive` and filters the 25 rows in memory, breaking page sizes and total counts.
- **M-13 — `roundHalfUp`, `computeLineTax`, and `computeInvoiceTotals` Input Validation Gaps in `@pos/shared`**
  - **Location:** [packages/shared/src/money.ts:74-83, 90-102](file:///d:/POS/packages/shared/src/money.ts#L74-L102), [packages/shared/src/tax.ts:37-52, 116-124](file:///d:/POS/packages/shared/src/tax.ts#L37-L124)
  - **Evidence:** `roundHalfUp` does not check `Number.isInteger` or `Number.isFinite` and returns `-0` at line 79; `computeInvoiceTotals` silently ignores negative `discountBp` and negative `flatDiscountPaisa` at lines 116 and 121.
- **M-14 — Integration Test `failure_modes.test.ts:39` Fails Under Default 5000ms Timeout**
  - **Location:** [tests/integration/failure_modes.test.ts:39](file:///d:/POS/tests/integration/failure_modes.test.ts#L39)
  - **Evidence:** Queuing and syncing 250 events against live Postgres + SQLite times out at 5000ms when `pnpm test` runs all 41 suites in parallel.

---

### Low Severity (L-01 to L-09)

- **L-01 — Server Sync Appliers Pollute `change_log` with Unsupported Entity Types (`invoice`, `invoice_line`, `payment`, `credit_note`, `credit_note_line`)**
  - **Location:** [apps/server/src/sync/appliers/invoice.ts:160-191, 265-272](file:///d:/POS/apps/server/src/sync/appliers/invoice.ts#L160-L191), [credit-note.ts:130-163](file:///d:/POS/apps/server/src/sync/appliers/credit-note.ts#L130-L163) vs. [docs/SYNC.md:36](file:///d:/POS/docs/SYNC.md#L36) & [apps/desktop/src/main/sync/core/pullAndApply.ts:363](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L363)
- **L-02 — Duplicate `negative_stock` Alerts Never Deduplicated or Resolved on Positive Stock Movements**
  - **Location:** [apps/server/src/sync/appliers/invoice.ts:239-251](file:///d:/POS/apps/server/src/sync/appliers/invoice.ts#L239-L251), [stock-adjustment.ts:104-116](file:///d:/POS/apps/server/src/sync/appliers/stock-adjustment.ts#L104-L116), and `recentAlerts` never rendered in [apps/web/src/pages/OverviewPage.tsx:25](file:///d:/POS/apps/web/src/pages/OverviewPage.tsx#L25).
- **L-03 — `adjustStock` Outbox Row Writes Mismatched `type` (`'stock_adjustment.created'`) vs. `event_type` (`'stock.adjusted'`)**
  - **Location:** [apps/desktop/src/main/purchasing.ts:595](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L595)
- **L-04 — `getShiftsHistory` Allows Caller `options` to Override Terminal `branchId` and `counterId`**
  - **Location:** [apps/desktop/src/main/shifts.ts:642-650](file:///d:/POS/apps/desktop/src/main/shifts.ts#L642-L650)
- **L-05 — Non-RTL-Safe Physical CSS Utilities & Missing Modal Accessibility Attributes in `@pos/ui`**
  - **Location:** [packages/ui/src/components/Select.tsx:15, 25](file:///d:/POS/packages/ui/src/components/Select.tsx#L15), [Table.tsx:57](file:///d:/POS/packages/ui/src/components/Table.tsx#L57), [Button.tsx:40](file:///d:/POS/packages/ui/src/components/Button.tsx#L40), [Modal.tsx:57, 68-73](file:///d:/POS/packages/ui/src/components/Modal.tsx#L57)
- **L-06 — Phantom & Unused Dependencies Across Workspace `package.json` Files**
  - **Location:** [apps/desktop/package.json](file:///d:/POS/apps/desktop/package.json), [apps/server/package.json](file:///d:/POS/apps/server/package.json), [apps/web/package.json](file:///d:/POS/apps/web/package.json), [packages/shared/package.json](file:///d:/POS/packages/shared/package.json), [packages/ui/package.json](file:///d:/POS/packages/ui/package.json), [tests/integration/package.json](file:///d:/POS/tests/integration/package.json) (full list in Section 10).
- **L-07 — Circular Import Between `schema/index.ts` and `schema/product.ts` & Duplicate Wildcard Exports in `packages/shared/src/index.ts`**
  - **Location:** [packages/shared/src/index.ts:16-24](file:///d:/POS/packages/shared/src/index.ts#L16-L24), [packages/shared/src/schema/index.ts:48-62](file:///d:/POS/packages/shared/src/schema/index.ts#L48-L62), [packages/shared/src/schema/product.ts:2, 60-61](file:///d:/POS/packages/shared/src/schema/product.ts#L2)
- **L-08 — `system:run-integrity-check` Does Not Update Cached `currentIntegrityStatus`**
  - **Location:** [apps/desktop/src/main/index.ts:27, 422-432](file:///d:/POS/apps/desktop/src/main/index.ts#L422-L432)
- **L-09 — Database Connection Pool Leak When Re-Initializing `getDb(connectionString)`**
  - **Location:** [apps/server/src/db/index.ts:22-27](file:///d:/POS/apps/server/src/db/index.ts#L22-L27)

---

## Part 3: Detailed Audit of the 11 Specific Areas

### 1. Money
- **Multiple Rounding Utilities in `@pos/shared`:**
  - [packages/shared/src/money.ts:31-36](file:///d:/POS/packages/shared/src/money.ts#L31-L36): `roundPaisa(paisa: number)` uses `Math.round(paisa)` on floats (`roundPaisa(-50.5) === -50`).
  - [packages/shared/src/money.ts:74-83](file:///d:/POS/packages/shared/src/money.ts#L74-L83): `roundHalfUp(numerator, denominator)` uses symmetric integer floor division (`roundHalfUp(-505, 10) === -51`, and returns `-0` when `numerator = -4999, denominator = 10000`).
- **Bugs in `convertRupeesToPaisa` ([packages/shared/src/money.ts:166-198](file:///d:/POS/packages/shared/src/money.ts#L166-L198)):**
  - Line 168: `roundPaisa(rupees * 100)` uses float multiplication on `number` inputs.
  - Line 180: `/^[^0-9]*([0-9]+(?:\.[0-9]+)?)[^0-9]*$/` strips leading `'-'`, turning `'-35.50'` into `+3550` paisa.
  - Line 193: `(parts[1] + '00').slice(0, 2)` truncates >2 decimal places on strings instead of rounding.
- **Every Float, Division (`/`), `.toFixed()`, `parseFloat()`, or Rounding Outside `packages/shared`:**
  - [apps/desktop/src/main/purchasing.ts:213](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L213): `const lineCostPaisa = roundPaisa(line.quantity * line.costPaisa);`
  - [apps/desktop/src/renderer/components/pos/PaymentModal.tsx:43-44](file:///d:/POS/apps/desktop/src/renderer/components/pos/PaymentModal.tsx#L43-L44): `(grandTotalPaisa / 100).toFixed(0)` and `(grandTotalPaisa / 100).toFixed(2)`
  - [apps/desktop/src/renderer/components/pos/PaymentModal.tsx:64, 68-71](file:///d:/POS/apps/desktop/src/renderer/components/pos/PaymentModal.tsx#L64-L71): `Math.round(Number(singleTenderedRupees || 0) * 100)` and `Math.round(Number(split...Rupees || 0) * 100)`
  - [apps/desktop/src/renderer/components/pos/PaymentModal.tsx:95](file:///d:/POS/apps/desktop/src/renderer/components/pos/PaymentModal.tsx#L95): `Math.ceil(grandTotalPaisa / 100)`
  - [apps/desktop/src/renderer/components/pos/PaymentModal.tsx:114-115](file:///d:/POS/apps/desktop/src/renderer/components/pos/PaymentModal.tsx#L114-L115): `(remainingToTargetPaisa / 100).toFixed(0)` and `.toFixed(2)`
  - [apps/desktop/src/renderer/components/pos/PaymentModal.tsx:351-352](file:///d:/POS/apps/desktop/src/renderer/components/pos/PaymentModal.tsx#L351-L352): `const r = (grandTotalPaisa / 100).toFixed(0);` (truncates paisa in split payment initialization)
  - [apps/desktop/src/renderer/components/pos/PosCheckoutScreen.tsx:285, 288](file:///d:/POS/apps/desktop/src/renderer/components/pos/PosCheckoutScreen.tsx#L285-L288): `Math.round(value * 100)` for discount basis points and flat discount paisa
  - [apps/desktop/src/renderer/components/pos/PosCheckoutScreen.tsx:1083, 1109](file:///d:/POS/apps/desktop/src/renderer/components/pos/PosCheckoutScreen.tsx#L1083): `line.flatDiscountPaisa / 100`
  - [apps/desktop/src/renderer/components/products/ProductForm.tsx:47, 68-69, 75, 81](file:///d:/POS/apps/desktop/src/renderer/components/products/ProductForm.tsx#L47-L81): `(product.mrpPaisa / 100).toFixed(2)`, `parseFloat(mrpRupees)`, `Math.round(parsedPrice * 100)`, `Math.round(priceNum * 100)`
  - [apps/desktop/src/renderer/components/purchasing/GrnReceivingForm.tsx:173-175](file:///d:/POS/apps/desktop/src/renderer/components/purchasing/GrnReceivingForm.tsx#L173-L175): `(p.mrpPaisa * 0.8 / 100).toFixed(2)`, `Math.round(p.mrpPaisa * 0.8)`, `(p.mrpPaisa / 100).toFixed(2)`
  - [apps/desktop/src/renderer/components/invoices/ReturnModal.tsx:81, 290](file:///d:/POS/apps/desktop/src/renderer/components/invoices/ReturnModal.tsx#L81): `Math.round(line.lineTotalPaisa / line.soldQuantity)`
  - [apps/desktop/src/renderer/components/shifts/DayEndReportScreen.tsx:53](file:///d:/POS/apps/desktop/src/renderer/components/shifts/DayEndReportScreen.tsx#L53): `(active.expectedCashPaisa / 100).toString()`
  - [apps/desktop/src/renderer/components/sync/types.ts:192](file:///d:/POS/apps/desktop/src/renderer/components/sync/types.ts#L192): `(totalPaisa / 100).toFixed(2)`
  - [apps/web/src/lib/formatters.ts:5-11](file:///d:/POS/apps/web/src/lib/formatters.ts#L5-L11): `const rupees = (paisa || 0) / 100;`
  - [apps/server/src/reports/queries.ts:483](file:///d:/POS/apps/server/src/reports/queries.ts#L483) & [apps/web/src/pages/reports/ProfitPerBatchReportPage.tsx:51](file:///d:/POS/apps/web/src/pages/reports/ProfitPerBatchReportPage.tsx#L51): `Math.round((profitPaisa / revenuePaisa) * 1000) / 10`
  - [apps/server/src/scripts/seed-products.ts:179, 207](file:///d:/POS/apps/server/src/scripts/seed-products.ts#L179): `(p.mrpPaisa / 100).toFixed(2)` and `(newPricePaisa / 100).toFixed(2)`

---

### 2. IDs and Time
- **Non-UUIDv7 IDs & Server-Generated IDs:**
  - Server sync appliers generate `stock_movements.id` on the server via `generateUuidV7()` at [apps/server/src/sync/appliers/invoice.ts:197](file:///d:/POS/apps/server/src/sync/appliers/invoice.ts#L197), [purchase.ts:85](file:///d:/POS/apps/server/src/sync/appliers/purchase.ts#L85), and [credit-note.ts:167](file:///d:/POS/apps/server/src/sync/appliers/credit-note.ts#L167).
  - Non-UUID strings in DB tables: `'tax-cat-default'` ([apps/desktop/src/main/sync/core/pullAndApply.ts:62-66](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L62-L66)) and `'system-return-user'` ([apps/desktop/src/main/returns.ts:291](file:///d:/POS/apps/desktop/src/main/returns.ts#L291)).
  - UUIDv4 (`crypto.randomUUID()`) used in [apps/server/src/db/db.test.ts:91-272](file:///d:/POS/apps/server/src/db/db.test.ts#L91-L272).
  - All Zod schemas in `packages/shared/src/schema/**` use `.uuid()` instead of `isValidUuidV7()`.
- **Time & Timezone (`UTC` Storage vs. `Asia/Karachi` Business Day / Display):**
  - All stored DB timestamps use UTC ISO strings (`new Date().toISOString()`). `Date.now()` is used only for elapsed-time math, backoff timers, backup filenames, and ephemeral UI keys ([PosCheckoutScreen.tsx:110, 310](file:///d:/POS/apps/desktop/src/renderer/components/pos/PosCheckoutScreen.tsx#L110)).
  - **However**, calendar-day slicing and filtering use UTC (`new Date().toISOString().slice(0, 10)` and `T00:00:00.000Z`..`T23:59:59.999Z`) instead of `Asia/Karachi` in [finalizeSale.ts:249](file:///d:/POS/apps/desktop/src/main/finalizeSale.ts#L249), [invoices.ts:36, 78, 549-557](file:///d:/POS/apps/desktop/src/main/invoices.ts#L36), [purchasing.ts:378-380, 455-457](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L378-L380), [InvoiceHistoryScreen.tsx:33-47](file:///d:/POS/apps/desktop/src/renderer/components/invoices/InvoiceHistoryScreen.tsx#L33-L47), [GrnReceivingForm.tsx:28-30, 86-88](file:///d:/POS/apps/desktop/src/renderer/components/purchasing/GrnReceivingForm.tsx#L28-L30), [apps/desktop/src/renderer/components/pos/types.ts:95](file:///d:/POS/apps/desktop/src/renderer/components/pos/types.ts#L95), [apps/server/src/routes/dashboard.ts:18](file:///d:/POS/apps/server/src/routes/dashboard.ts#L18), and [apps/server/src/reports/queries.ts:169, 267, 270, 296, 381](file:///d:/POS/apps/server/src/reports/queries.ts#L169).
  - UI components missing `timeZone: 'Asia/Karachi'`: [PosCheckoutScreen.tsx:308](file:///d:/POS/apps/desktop/src/renderer/components/pos/PosCheckoutScreen.tsx#L308), [StaffManagementScreen.tsx:544-548](file:///d:/POS/apps/desktop/src/renderer/components/staff/StaffManagementScreen.tsx#L544-L548), [SettingsScreen.tsx:835](file:///d:/POS/apps/desktop/src/renderer/components/settings/SettingsScreen.tsx#L835).

---

### 3. Invoices
- **No Application Code Executes `UPDATE` or `DELETE` on `invoices`, `invoice_lines`, or `payments`:** Verified across `apps/desktop/src/**` and `apps/server/src/**`.
- **SQLite Immutability Triggers Exist and Are Tested:**
  - Defined in Migration 5 ([apps/desktop/src/main/db.ts:476-510](file:///d:/POS/apps/desktop/src/main/db.ts#L476-L510)) for `invoices`, `invoice_lines`, and `payments` (`BEFORE UPDATE` and `BEFORE DELETE` raising `ABORT`), and Migration 6 ([db.ts:603-625](file:///d:/POS/apps/desktop/src/main/db.ts#L603-L625)) for `credit_notes` and `credit_note_lines`.
  - Tested in [apps/desktop/src/main/invoices-schema.test.ts:95-190](file:///d:/POS/apps/desktop/src/main/invoices-schema.test.ts#L95-L190), [finalizeSale.test.ts:419-468](file:///d:/POS/apps/desktop/src/main/finalizeSale.test.ts#L419-L468), and [returns-and-shifts.test.ts:166-205](file:///d:/POS/apps/desktop/src/main/returns-and-shifts.test.ts#L166-L205).
- **PostgreSQL Immutability Triggers Are MISSING and Untested:**
  - [apps/server/drizzle/0000_orange_hex.sql:1-311](file:///d:/POS/apps/server/drizzle/0000_orange_hex.sql#L1-L311) contains **no triggers** on `invoices`, `invoice_lines`, `payments`, `credit_notes`, or `credit_note_lines`.

---

### 4. Stock
- **No Direct Stock Quantity Column Exists:** Neither SQLite ([apps/desktop/src/main/db.ts:154-184](file:///d:/POS/apps/desktop/src/main/db.ts#L154-L184)) nor PostgreSQL ([apps/server/src/db/schema.ts:186-225](file:///d:/POS/apps/server/src/db/schema.ts#L186-L225)) has a stock quantity column on `products` or `batches`; all balances are derived from `SUM(stock_movements.quantity_signed)`.
- **Direct `UPDATE` on `stock_movements` (Rule 4 Violation):**
  - [apps/desktop/src/main/sync/core/pullAndApply.ts:173-175](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L173-L175) and [338-341](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L338-L341) execute `UPDATE stock_movements SET id = ? WHERE id = ?`.
- **Skipped `stock_movements` Row in Legacy `createInvoice`:**
  - [apps/desktop/src/main/invoices.ts:207](file:///d:/POS/apps/desktop/src/main/invoices.ts#L207) skips inserting a `stock_movements` row when `batchId` is `null`.

---

### 5. Transactions
- **Desktop Core Transactional Operations:** `finalizeSale` ([finalizeSale.ts:487-662](file:///d:/POS/apps/desktop/src/main/finalizeSale.ts#L487-L662)), `processReturn` ([returns.ts:368-473](file:///d:/POS/apps/desktop/src/main/returns.ts#L368-L473)), `receiveGrn` ([purchasing.ts:238-334](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L238-L334)), `adjustStock` ([purchasing.ts:552-631](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L552-L631)), `openShift` ([shifts.ts:194-269](file:///d:/POS/apps/desktop/src/main/shifts.ts#L194-L269)), and `closeShift` ([shifts.ts:392-484](file:///d:/POS/apps/desktop/src/main/shifts.ts#L392-L484)) each wrap their SQLite table writes and `outbox` insert in a single `db.transaction(...)`.
- **Multi-Table Writes Outside a Single Transaction:**
  - [apps/server/src/routes/admin.ts:98-116](file:///d:/POS/apps/server/src/routes/admin.ts#L98-L116) (`POST /api/admin/users`: `users` + `changeLog` not in a transaction).
  - [apps/server/src/routes/admin.ts:184-201](file:///d:/POS/apps/server/src/routes/admin.ts#L184-L201) (`POST /api/admin/branches`: `branches` + `changeLog` not in a transaction).
  - [apps/server/src/routes/admin.ts:241-260](file:///d:/POS/apps/server/src/routes/admin.ts#L241-L260) (`POST /api/admin/counters`: `counters` + `changeLog` not in a transaction).
  - [apps/server/src/scripts/seed-products.ts:57-77, 140-170, 186-205](file:///d:/POS/apps/server/src/scripts/seed-products.ts#L57-L205) (`taxCategories`/`products` + `changeLog` not in a transaction).
  - [apps/server/src/scripts/seed-dev.ts:30-169](file:///d:/POS/apps/server/src/scripts/seed-dev.ts#L30-L169) (5 tables inserted without a transaction and without `changeLog` entries).
  - [apps/desktop/src/main/db/seed.ts:137-145](file:///d:/POS/apps/desktop/src/main/db/seed.ts#L137-L145) (`tax_categories` inserted outside `seedTx`).
  - [apps/desktop/src/main/sync/core/pullAndApply.ts:62-66, 496-501](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L62-L66) (fallback tax category insert and `last_pull_ok_at` update run outside `applyPageTx`).

---

### 6. Security
- **Electron Settings:**
  - Main window ([apps/desktop/src/main/index.ts:141-146](file:///d:/POS/apps/desktop/src/main/index.ts#L141-L146)): `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
  - Hidden print window ([apps/desktop/src/main/printService.ts:34-37](file:///d:/POS/apps/desktop/src/main/printService.ts#L34-L37)): `sandbox: true`, `contextIsolation: true` (`nodeIntegration: false` not explicitly specified, though default in Electron).
  - Preload ([apps/desktop/src/preload/index.ts:1-225](file:///d:/POS/apps/desktop/src/preload/index.ts#L1-L225)): Narrow channel wrappers via `contextBridge`; never exposes raw `ipcRenderer.invoke`.
- **IPC Handlers Missing Auth/Role Checks or Zod Validation:**
  - Detailed in **C-03**, **H-04**, and **Rule 6** above (20+ handlers lack auth checks; 15+ handlers lack Zod schemas).
- **Secrets / Tokens / Credentials / `.env` / PIN Hashing / SQL Concatenation:**
  - `.env` files are properly gitignored (`git status --ignored -s` confirmed only `.env.example` and `apps/server/.env.example` are tracked).
  - Hardcoded fallback credentials exist in [apps/server/src/auth/jwt.ts:11](file:///d:/POS/apps/server/src/auth/jwt.ts#L11) (`'dev_pos_jwt_secret_change_in_production'`), [apps/server/src/db/index.ts:15](file:///d:/POS/apps/server/src/db/index.ts#L15), [apps/server/drizzle.config.ts:11](file:///d:/POS/apps/server/drizzle.config.ts#L11), and [docker-compose.yml:10](file:///d:/POS/docker-compose.yml#L10) (`pos_dev_secret`).
  - PIN hashing uses `bcryptjs` (`cost = 10`) in [apps/desktop/src/main/auth.ts:78, 326, 381](file:///d:/POS/apps/desktop/src/main/auth.ts#L78) and [apps/server/src/routes/admin.ts:96](file:///d:/POS/apps/server/src/routes/admin.ts#L96), **except** [apps/server/src/scripts/seed-dev.ts:123](file:///d:/POS/apps/server/src/scripts/seed-dev.ts#L123) which uses `sha256` (breaking dev owner login).
  - SQL string interpolation exists in [apps/desktop/src/main/purchasing.ts:385, 387, 389, 462, 464, 466](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L385-L466) and [apps/server/src/db/test-helper.ts:58, 92, 99](file:///d:/POS/apps/server/src/db/test-helper.ts#L58).

---

### 7. Sync
- **Idempotency by `eventId`:** Implemented via `sync_events` check inside per-event transaction ([apps/server/src/sync/service.ts:27-57](file:///d:/POS/apps/server/src/sync/service.ts#L27-L57)).
- **Ordering by `device_seq`:** Sorted ascending on server ([apps/server/src/sync/service.ts:19](file:///d:/POS/apps/server/src/sync/service.ts#L19)) and queried `ORDER BY device_seq ASC` on client ([apps/desktop/src/main/sync/core/outboxRepo.ts:62](file:///d:/POS/apps/desktop/src/main/sync/core/outboxRepo.ts#L62)).
- **Events Dropped / Quarantined on Error Paths:**
  - Server catch-all ([apps/server/src/sync/service.ts:117-124](file:///d:/POS/apps/server/src/sync/service.ts#L117-L124)) returns `status: 'rejected', code: 'INTERNAL_ERROR'` on any non-`SyncError` exception without recording a row in `rejected_events`, causing the client ([pushPending.ts:138-151](file:///d:/POS/apps/desktop/src/main/sync/core/pushPending.ts#L138-L151)) to permanently move transient DB failures into `sync_exceptions`.
  - Desktop `receiveGrn`, `openShift`, `closeShift`, and legacy `createInvoice` emit invalid outbox payloads/types (**C-01**, **C-02**, **C-10**).
- **Cursor Updated Inside Page Transaction:** Verified — [apps/desktop/src/main/sync/core/pullAndApply.ts:371-379](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L371-L379) updates `sync_state.pull_cursor` inside `applyPageTx` (though `last_pull_ok_at` at lines 496–501 is updated after the loop).
- **Pulled Data Creating Outbox Rows:** Verified — `pullAndApply.ts` writes directly to SQLite tables without calling domain functions or inserting into `outbox`.
- **Tenant (`pharmacy_id`) Taken from JWT on Sync Routes:** Verified in [apps/server/src/routes/sync.ts:24, 69](file:///d:/POS/apps/server/src/routes/sync.ts#L24) (`request.deviceContext` from `requireDeviceAuth` JWT). However, appliers do not verify that `payload.branchId` / `counterId` / `cashierUserId` belong to `ctx.pharmacyId` (**C-09**).

---

### 8. Tenant Isolation
Every server query missing a `pharmacy_id` filter or tenant ownership check:
1. [apps/server/src/routes/auth.ts:41-57](file:///d:/POS/apps/server/src/routes/auth.ts#L41-L57): `POST /api/auth/login` queries `users` without `pharmacy_id` when `pharmacyId` is omitted from body (**C-04**).
2. [apps/server/src/routes/admin.ts:228-263](file:///d:/POS/apps/server/src/routes/admin.ts#L228-L263): `POST /api/admin/counters` does not verify `branchId` belongs to `userContext.pharmacyId` (**C-09**).
3. [apps/server/src/routes/admin.ts:310-340](file:///d:/POS/apps/server/src/routes/admin.ts#L310-L340): `POST /api/admin/registration-codes` does not verify `branchId` and `counterId` belong to `userContext.pharmacyId` (**C-09**).
4. [apps/server/src/sync/appliers/credit-note.ts:110-180](file:///d:/POS/apps/server/src/sync/appliers/credit-note.ts#L110-L180), [purchase.ts:91](file:///d:/POS/apps/server/src/sync/appliers/purchase.ts#L91), [stock-adjustment.ts:68](file:///d:/POS/apps/server/src/sync/appliers/stock-adjustment.ts#L68): Missing tenant ownership checks on `branchId`, `counterId`, `cashierUserId`, and `originalInvoiceLineId` (**C-09**).
5. [apps/server/src/scripts/seed-products.ts:192](file:///d:/POS/apps/server/src/scripts/seed-products.ts#L192): `.where(eq(products.id, productToUpdate.id))` missing `pharmacy_id`.
6. [apps/server/src/reports/queries.ts:155-156, 179-180, 200, 289-290, 301, 315-316, 330-331, 398-400, 458-460, 518](file:///d:/POS/apps/server/src/reports/queries.ts#L155-L518) and [apps/server/src/routes/admin.ts:221, 286-287](file:///d:/POS/apps/server/src/routes/admin.ts#L221): JOIN conditions omit `eq(joinedTable.pharmacyId, pharmacyId)` (**M-02**).

---

### 9. Tests
- **Execution Result:** 40/41 suites passed; [tests/integration/failure_modes.test.ts:39](file:///d:/POS/tests/integration/failure_modes.test.ts#L39) timed out at 5000ms during `pnpm test`.
- **Tests That Cannot Fail / Mock Away Core Logic:**
  1. [apps/server/src/sync/sync-push.test.ts:1242-1251](file:///d:/POS/apps/server/src/sync/sync-push.test.ts#L1242-L1251) (`"applies events end-to-end against live PostgreSQL container"`): Creates an in-memory `createSyncMockDb()` instead of using the live Postgres `ctx.db` and only asserts `expect(tenant.pharmacyId).toBeDefined()` and `expect(typeof isAvailable).toBe('boolean')`.
  2. [packages/shared/src/schema/auth.test.ts:55-64](file:///d:/POS/packages/shared/src/schema/auth.test.ts#L55-L64) (`"enforces that PublicUserSchema does not contain pinHash"`): Passes an input object that has no `pinHash` property and asserts `expect(parsed).not.toHaveProperty('pinHash')`.
  3. [tests/integration/harness.ts:479-602](file:///d:/POS/tests/integration/harness.ts#L479-L602): Re-implements `receivePurchase` inline with a hand-crafted `PurchaseReceivedPayloadSchema` object instead of calling desktop's `receiveGrn` ([apps/desktop/src/main/purchasing.ts:171](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L171)), completely masking **C-01** (`receiveGrn` outbox payload mismatch).
  4. [tests/integration/failure_modes.test.ts:1, 25, 37, 137-142](file:///d:/POS/tests/integration/failure_modes.test.ts#L37): Claims to test exponential backoff with fake timers (`"(use fake timers)"`), imports `vi`, calls `vi.useRealTimers()`, but never calls `vi.useFakeTimers()` or asserts backoff delays.
  5. [apps/desktop/src/main/sync/core/pullAndApply.test.ts:342-391](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.test.ts#L342-L391): Explicitly asserts that `stock_movements.id` is mutated via `UPDATE` (codifying a violation of Rule 4).
  6. [apps/server/src/auth/auth.test.ts:113-182](file:///d:/POS/apps/server/src/auth/auth.test.ts#L113-L182), [sync-push.test.ts:31-299](file:///d:/POS/apps/server/src/sync/sync-push.test.ts#L31-L299), and [sync-pull.test.ts:22-160](file:///d:/POS/apps/server/src/sync/sync-pull.test.ts#L22-L160): Use regex/token-scraping mock DBs (`extractSqlValues`) that do not enforce SQL foreign keys or constraints.
- **What Is Untested:**
  - **`apps/web` (0 tests):** No test files or `"test"` script exist in `apps/web`.
  - **Desktop IPC & Auth Guards (0 tests):** [apps/desktop/src/main/index.ts](file:///d:/POS/apps/desktop/src/main/index.ts) and [syncIpc.ts](file:///d:/POS/apps/desktop/src/main/sync/adapters/syncIpc.ts) have zero tests.
  - **Desktop Renderer Components:** Zero component tests for `PosCheckoutScreen`, `PaymentModal`, `ReturnModal`, `GrnReceivingForm`, `ProductForm`, `ProductList`, `DayEndReportScreen`, `SettingsScreen`, `StaffManagementScreen`.
  - **Desktop-to-Server Outbox Schema Compatibility:** Zero tests validating `receiveGrn`, `openShift`, `closeShift`, or `createInvoice` outbox payloads against `@pos/shared` sync schemas.
  - **Server Invoice/CreditNote Immutability:** Zero tests on PostgreSQL.
  - **Multi-Tenant Isolation on `/api/reports/*`, `/api/dashboard/overview`, and `/api/admin/*`:** [apps/server/src/reports/reports.test.ts](file:///d:/POS/apps/server/src/reports/reports.test.ts) seeds only a single pharmacy.
  - **`packages/shared` Edge Cases:** Negative tests for `isValidUuidV7` (UUIDv4 rejection), negative strings and >2 decimals in `convertRupeesToPaisa`, and 6 schema files (`invoice.ts`, `creditNote.ts`, `purchasing.ts`, `shift.ts`, `sync.ts`, `product.ts`) have 0 dedicated unit tests.

---

### 10. Dependencies
- **`pnpm audit` Vulnerabilities:**
  1. **HIGH (`GHSA-mrhx-c7xc-m3w5`)**: `zod <4.6.6` (installed `3.25.76` via `packages/shared/package.json:24`) — *"Zod can exhaust memory while validating oversized constrained collections"* (Patched: `>=4.6.6`).
  2. **MODERATE (`GHSA-67mh-4wv8-2f99`)**: `esbuild <=0.24.2` (installed `0.18.20` via `apps/server > drizzle-kit@0.30.6 > @esbuild-kit/esm-loader > @esbuild-kit/core-utils > esbuild`) — *"esbuild enables any website to send any requests to the development server and read the response"* (Patched: `>=0.25.0`).
- **Dependencies Imported/Used in a Package Calling `vitest` / `tsc` Without Listing Them in That Package's `package.json`:**
  - `vitest` and `typescript` are used in [packages/shared/package.json:16-17](file:///d:/POS/packages/shared/package.json#L16-L17), [apps/desktop/package.json:9, 12](file:///d:/POS/apps/desktop/package.json#L9) (plus 21 `.test.ts` files), and [apps/server/package.json:8-10](file:///d:/POS/apps/server/package.json#L8-L10) (plus 7 `.test.ts` files), relying on root hoisting from [package.json:30, 32](file:///d:/POS/package.json#L30-L32).
  - `zod` is imported directly (`import { z } from 'zod'`) in [apps/desktop/src/main/auth.ts:4](file:///d:/POS/apps/desktop/src/main/auth.ts#L4), [apps/server/src/routes/admin.ts:4](file:///d:/POS/apps/server/src/routes/admin.ts#L4), [apps/server/src/db/test-helper.ts](file:///d:/POS/apps/server/src/db/test-helper.ts), etc., without being listed in `apps/desktop/package.json` or `apps/server/package.json` (relying on pnpm hoisting from `@pos/shared`).
- **Unused Dependencies Listed in `package.json`:**
  - [apps/desktop/package.json:16](file:///d:/POS/apps/desktop/package.json#L16): `"@fontsource/noto-nastaliq-urdu": "^5.3.0"` (never imported; local `.woff2` files are used instead) and line 28 `"@types/bcryptjs": "^3.0.0"` (redundant with `bcryptjs@^3.0.3`).
  - [apps/server/package.json:28](file:///d:/POS/apps/server/package.json#L28): `"@types/bcryptjs": "^3.0.0"` (redundant).
  - [apps/web/package.json:13, 15, 19, 22](file:///d:/POS/apps/web/package.json#L13-L22): `"@pos/shared": "workspace:*"`, `"clsx": "^2.1.1"`, `"tailwind-merge": "^3.5.4"`, `"@types/node": "^24.19.2"` (none are imported anywhere in `apps/web`).
  - [packages/shared/package.json:20](file:///d:/POS/packages/shared/package.json#L20): `"@types/node": "^24.19.2"` (no Node APIs used).
  - [packages/ui/package.json:21, 25, 27](file:///d:/POS/packages/ui/package.json#L21-L27): `"react-dom"` and `"@types/react-dom"` (never imported in `packages/ui`).
  - [tests/integration/package.json:16, 17, 22](file:///d:/POS/tests/integration/package.json#L16-L22): `"fastify"`, `"pg"`, `"@types/pg"` (never imported in `tests/integration`).

---

### 11. Dead Code, TODOs, FIXMEs, Skipped Tests (`.skip`, `.only`), and `console.log`
- **`TODO` / `FIXME` / `.only`:** `0` occurrences across the repository. (Placeholder URL string exists in [apps/desktop/src/renderer/components/settings/SettingsScreen.tsx:926](file:///d:/POS/apps/desktop/src/renderer/components/settings/SettingsScreen.tsx#L926) and [apps/desktop/src/main/updater.ts:13](file:///d:/POS/apps/desktop/src/main/updater.ts#L13)).
- **Skipped Tests (`context.skip()`):** 28 conditional `context.skip()` calls in `apps/server`:
  - [apps/server/src/db/db.test.ts:49, 87, 139, 231](file:///d:/POS/apps/server/src/db/db.test.ts#L49)
  - [apps/server/src/auth/auth.test.ts:473](file:///d:/POS/apps/server/src/auth/auth.test.ts#L473)
  - [apps/server/src/sync/sync-pull.test.ts:520](file:///d:/POS/apps/server/src/sync/sync-pull.test.ts#L520)
  - [apps/server/src/sync/sync-push.test.ts:1244](file:///d:/POS/apps/server/src/sync/sync-push.test.ts#L1244)
  - [apps/server/src/sync/sync-e2e.test.ts:177, 411, 610, 748, 805](file:///d:/POS/apps/server/src/sync/sync-e2e.test.ts#L177)
  - [apps/server/src/reports/reports.test.ts:436, 455, 470, 486, 511, 539, 569, 611, 629, 662, 702, 734, 763, 795, 837, 892](file:///d:/POS/apps/server/src/reports/reports.test.ts#L436-L892)
- **`console.log` / `console.warn` / `console.error`:**
  - [apps/server/src/scripts/seed-dev.ts:175-203](file:///d:/POS/apps/server/src/scripts/seed-dev.ts#L175-L203): Logs registration code and SHA-256 `Code Hash` to stdout (`line 193`).
  - Also present in [apps/desktop/src/main/db.ts:793, 810, 816, 821, 826, 851, 870, 928](file:///d:/POS/apps/desktop/src/main/db.ts#L793-L928), [apps/desktop/src/main/index.ts:121, 474-519](file:///d:/POS/apps/desktop/src/main/index.ts#L121), [apps/desktop/src/main/logger.ts:62, 91, 93, 95](file:///d:/POS/apps/desktop/src/main/logger.ts#L62), [apps/desktop/src/main/sync/core/pullAndApply.ts:363, 396](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L363), [apps/desktop/src/main/sync/core/syncWorker.ts:121, 207, 290, 336](file:///d:/POS/apps/desktop/src/main/sync/core/syncWorker.ts#L121), [apps/server/src/server.ts:8, 11](file:///d:/POS/apps/server/src/server.ts#L8), [apps/server/src/db/migrate.ts:30, 33, 38](file:///d:/POS/apps/server/src/db/migrate.ts#L30), and [apps/server/src/sync/service.ts:108](file:///d:/POS/apps/server/src/sync/service.ts#L108).
- **Dead Code:**
  - [apps/desktop/src/main/invoices.ts:20-345](file:///d:/POS/apps/desktop/src/main/invoices.ts#L20-L345): Legacy `createInvoice` (superseded by `finalizeSale.ts`, never called by renderer UI, but still wired to `invoices:create` IPC).
  - [apps/desktop/src/main/sync/core/syncWorker.ts:52](file:///d:/POS/apps/desktop/src/main/sync/core/syncWorker.ts#L52): Unused private field `private hasPendingRerun = false;`.
  - [apps/server/src/app.ts:69-83](file:///d:/POS/apps/server/src/app.ts#L69-L83): Test-only endpoint `POST /test/protected-action` in production `buildApp`.
  - [apps/web/src/pages/OverviewPage.tsx:25](file:///d:/POS/apps/web/src/pages/OverviewPage.tsx#L25): `data.recentAlerts` fetched from `/api/dashboard/overview` but never rendered.
  - 60+ exported schemas/types in `packages/shared/src/**` and `TableFooter` in [packages/ui/src/components/Table.tsx:27](file:///d:/POS/packages/ui/src/components/Table.tsx#L27) are never imported outside their defining file.

---

## Part 4: Prioritized Fix List

### Priority 0 — Critical Security & Data-Integrity Blockers (Fix Immediately)
1. **Fix Desktop Outbox Payloads & Event Types ([purchasing.ts:305-319](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L305-L319), [shifts.ts:230-261, 437-476](file:///d:/POS/apps/desktop/src/main/shifts.ts#L230-L261), [invoices.ts:20-345](file:///d:/POS/apps/desktop/src/main/invoices.ts#L20-L345)):**
   - Update `receiveGrn` to emit a valid `PurchaseReceivedPayloadSchema` payload (including `purchase`, `batches`, and `lines` with client-generated `movementId`s) and test `receiveGrn` directly in `tests/integration/harness.ts`.
   - Either add `shift.opened`/`shift.closed` appliers on the server or stop writing shift events into the sync `outbox` (so they do not break `SyncPushRequestSchema` batch validation).
   - Remove legacy `createInvoice` and the `invoices:create` IPC channel.
2. **Lock Down `auth:complete-setup` and Unprotected IPC Channels ([apps/desktop/src/main/auth.ts:52-106](file:///d:/POS/apps/desktop/src/main/auth.ts#L52-L106), [index.ts:182-465](file:///d:/POS/apps/desktop/src/main/index.ts#L182-L465)):**
   - In `completeSetup`, throw immediately if `!getSetupStatus(db).needsSetup`.
   - Enforce `requireAuth()` / `requireRole()` on all IPC handlers (`backup:create`, `backup:list`, `backup:restore` with `!session.isLocked`, `products:seed`, `system:export-diagnostics`, `invoices:print-receipt`, etc.) and validate all IPC inputs with Zod schemas.
3. **Fix Server Authentication, Tenant Isolation & PIN Hashing ([apps/server/src/routes/auth.ts:41-77](file:///d:/POS/apps/server/src/routes/auth.ts#L41-L77), [seed-dev.ts:123](file:///d:/POS/apps/server/src/scripts/seed-dev.ts#L123), [admin.ts:109-148, 228-340](file:///d:/POS/apps/server/src/routes/admin.ts#L109-L340), [jwt.ts:10-12](file:///d:/POS/apps/server/src/auth/jwt.ts#L10-L12)):**
   - Require `pharmacyId` (or unique tenant slug/code) on `POST /api/auth/login` and configure `@fastify/rate-limit` on `/api/auth/login` with async `bcrypt.compare`.
   - Fix `seed-dev.ts:123` to use `bcrypt.hashSync('1234', 10)` and record seeded `branches`, `counters`, and `users` in `change_log`.
   - Include `pinHash` in `change_log` on `POST /api/admin/users` and write a `change_log` entry on `PATCH /api/admin/users/:id`.
   - Verify `branchId`, `counterId`, `cashierUserId`, and `originalInvoiceLineId` belong to `pharmacyId` in all admin routes and sync appliers, and add `pharmacy_id` equality conditions to all JOINs in `reports/queries.ts`.
   - Throw on startup if `JWT_SECRET` or `DATABASE_URL` is missing in production.
4. **Add PostgreSQL Immutability Triggers ([apps/server/drizzle/](file:///d:/POS/apps/server/drizzle/0000_orange_hex.sql)):**
   - Add a migration creating `BEFORE UPDATE OR DELETE` triggers on `invoices`, `invoice_lines`, `payments`, `credit_notes`, `credit_note_lines`, and `stock_movements` in PostgreSQL (and add `stock_movements` immutability triggers in SQLite).
5. **Eliminate Server-Generated `stock_movements` UUIDs & Desktop `UPDATE stock_movements` ([invoice.ts:197](file:///d:/POS/apps/server/src/sync/appliers/invoice.ts#L197), [purchase.ts:85](file:///d:/POS/apps/server/src/sync/appliers/purchase.ts#L85), [credit-note.ts:167](file:///d:/POS/apps/server/src/sync/appliers/credit-note.ts#L167), [pullAndApply.ts:173-175, 338-341](file:///d:/POS/apps/desktop/src/main/sync/core/pullAndApply.ts#L173-L175)):**
   - Include the client-generated `movementId` on each line of `invoice.created`, `purchase.received`, and `credit_note.created` payloads so server and client share identical UUIDv7s and `pullAndApply` only uses `INSERT OR IGNORE INTO stock_movements`.

### Priority 1 — High-Priority Money, Timezone, Transaction & Sync Fixes
6. **Consolidate All Money Math & Rounding in `@pos/shared` ([packages/shared/src/money.ts](file:///d:/POS/packages/shared/src/money.ts)):**
   - Remove `roundPaisa`, fix `convertRupeesToPaisa` (reject or preserve negative signs consistently, round >2 decimals via `roundHalfUp`), and replace all `/ 100`, `.toFixed()`, `parseFloat()`, and `Math.round()` calls in `apps/desktop/src/renderer/**`, `apps/web/src/lib/formatters.ts`, and `apps/server/src/reports/queries.ts` with `@pos/shared` helpers.
7. **Fix `loadCreditNote` Column Mapping ([apps/desktop/src/main/returns.ts:128-178](file:///d:/POS/apps/desktop/src/main/returns.ts#L128-L178)):**
   - Map snake_case SQLite columns (`l.credit_note_id`, `l.original_invoice_line_id`, `l.unit_price_paisa`, etc.) properly in `loadCreditNote`.
8. **Use `Asia/Karachi` Date Boundaries Everywhere ([finalizeSale.ts:249](file:///d:/POS/apps/desktop/src/main/finalizeSale.ts#L249), [purchasing.ts:378, 455](file:///d:/POS/apps/desktop/src/main/purchasing.ts#L378), [invoices.ts:549-557](file:///d:/POS/apps/desktop/src/main/invoices.ts#L549-L557), [dashboard.ts:18](file:///d:/POS/apps/server/src/routes/dashboard.ts#L18), [queries.ts:169, 267, 270, 296, 381](file:///d:/POS/apps/server/src/reports/queries.ts#L169)):**
   - Add a shared `getKarachiDateString(now?: Date)` and `getKarachiDayBoundsUtc(dateStr: string)` utility in `@pos/shared` and use `AT TIME ZONE 'Asia/Karachi'` in Postgres `TO_CHAR` grouping.
9. **Wrap All Server Multi-Table Writes in `db.transaction(...)` & Fix `pullChangeLog` SQL Filtering:**
   - Wrap admin and seed writes in `db.transaction(...)`, filter `branchId` in SQL in `pullChangeLog`, and record unexpected push failures in `rejected_events` (or return `retry_later` for transient DB errors).
10. **Bundle `Inter` and `JetBrains Mono` Fonts Locally ([apps/desktop/index.html:8-13](file:///d:/POS/apps/desktop/index.html#L8-L13)):**
    - Remove Google Fonts `<link>` tags and bundle `.woff2` files under `apps/desktop/src/renderer/assets/fonts/`.

### Priority 2 — Medium & Low Priority Cleanup
11. **Upgrade Vulnerable Dependencies & Clean Up `package.json` Manifests:**
    - Upgrade `zod` and `drizzle-kit` to resolve `pnpm audit` advisories; declare `vitest`, `typescript`, and `zod` explicitly where used; remove unused dependencies (`@fontsource/noto-nastaliq-urdu`, `clsx`/`tailwind-merge` in `apps/web`, etc.).
12. **Fix Remaining Server/Web/Desktop Polish Issues:**
    - Fix `server.ts` port (`process.env.PORT || 3000`), update `counters.lastInvoiceSeq`/`lastCreditNoteSeq` and `devices.lastSeenAt` during sync, join `suppliers` properly in `getSupplierLedgerReport`, move IPC handler registration out of `createWindow()`, and increase the timeout or optimize batching in [tests/integration/failure_modes.test.ts:39](file:///d:/POS/tests/integration/failure_modes.test.ts#L39).

---

## Part 5: Things I Could Not Verify

1. **Physical Thermal Printer Spooler Output (80mm / 58mm Hardware):**
   - I read [apps/desktop/src/main/printService.ts](file:///d:/POS/apps/desktop/src/main/printService.ts) and [apps/desktop/src/renderer/utils/receiptGenerator.ts](file:///d:/POS/apps/desktop/src/renderer/utils/receiptGenerator.ts), and ran [receipt-and-invoices.test.ts](file:///d:/POS/apps/desktop/src/main/receipt-and-invoices.test.ts), which verifies HTML generation and paper-width CSS classes. However, I could not verify physical thermal printer rendering, paper-cut commands, or Windows print spooler behavior (`win.webContents.print`) on physical 80mm/58mm POS hardware.
2. **Physical USB Barcode Scanner HID Timing:**
   - I read the keyboard wedge / barcode input handling in [PosCheckoutScreen.tsx](file:///d:/POS/apps/desktop/src/renderer/components/pos/PosCheckoutScreen.tsx) and [ProductForm.tsx](file:///d:/POS/apps/desktop/src/renderer/components/products/ProductForm.tsx), but could not test physical USB HID scanner keystroke cadence or focus stealing on physical POS terminal hardware.
3. **Packaged Windows NSIS Installer & DPAPI `safeStorage` in Production `.exe`:**
   - I did not run `pnpm --filter @pos/desktop package` (which would write build artifacts outside `docs/AUDIT_A1.md`, violating the read-only constraint). Therefore, I could not verify the packaged NSIS installer execution or Windows DPAPI `safeStorage.isEncryptionAvailable()` behavior inside a packaged Electron binary.
4. **FBR (Pakistan Federal Board of Revenue) Production Fiscalization API:**
   - Per [docs/SPEC.md:62](file:///d:/POS/docs/SPEC.md#L62), real FBR integration is out of scope (`fiscal_status` defaults to `'not_applicable'`); no external FBR integration exists to verify.
