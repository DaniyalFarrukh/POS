# Final System Audit — Stage Checkpoint Log (`AUDIT_FINAL_CHECKPOINT.md`)

- **Branch Audited:** `audit-fixes` at commit `120fcf7ba1ccd4d1d0f28f392bb1c9aa24715d28`
- **Rules Integrity Check (`git log -p docs/RULES.md`):** Only 1 commit in history (`d72f329a92ded88ee6aba1f112b34ba764c9f7d7`, 2026-10-25). Zero rules weakened or modified since repository inception.

---

## Stage 1: Clean-Clone Verification (Completed)

### 1.1 Clean-Clone Pipeline Results (`$env:TEMP\pos-final-audit-clone`)
| Check | Command | Exit Code | Result / Evidence |
| :--- | :--- | :---: | :--- |
| **Install** | `pnpm install` | `0` | 561 packages installed in 20.1s (`pnpm v12.15.0`); lockfile passes supply-chain policies (634 entries). Warning emitted: `"pnpm.onlyBuiltDependencies"` in root `package.json:20-25` is deprecated and ignored by pnpm v12. |
| **Lint** | `pnpm lint` | `0` | `eslint .` passed with 0 errors and 0 warnings. |
| **Typecheck** | `pnpm typecheck` | `0` | All 6 workspace projects (`@pos/shared`, `@pos/ui`, `@pos/web`, `@pos/desktop`, `@pos/server`, `@pos/integration-tests`) passed `tsc --noEmit`. |
| **Prettier** | `pnpm format:check` | `1` (Clone) / `0` (Worktree) | Failed on 371 files in the fresh Windows clone because repository lacks `.gitattributes` (`* text=auto eol=lf`) and `.prettierrc` defaults to `lf`, while Windows `git clone` checks out `CRLF`. |
| **Audit** | `pnpm audit` | `1` | 1 moderate vulnerability: `GHSA-g3hv-75wg-m249` in `minimatch` (`>=7.0.0 <11.0.1`, patched in `>=11.0.1`) across 11 devDependency paths (`electron-builder`, `typescript-eslint`). Causes CI step `pnpm audit` (`.github/workflows/ci.yml:56`) to fail. |
| **Server Build** | `pnpm --filter @pos/server build` | `0` | `tsc` succeeded, but compiled `src/**/*.test.ts` into `apps/server/dist/**/*.test.js` because `apps/server/tsconfig.json:7` includes `src/**/*` without excluding `*.test.ts`. |
| **Web Build** | `pnpm --filter @pos/web build` | `0` | Built in 1.32s (`dist/assets/index-wQusbGz2.js` 1,141.58 kB > 500 kB chunk warning). |
| **Desktop Build (`--dir`)** | `pnpm --filter @pos/desktop package:dir` | `0` | Built renderer (191ms), main (145ms), preload (9ms), and packaged `dist-release/win-unpacked/HexaPharm.exe` with `app.asar` and unpacked `better_sqlite3.node`. |
| **Desktop Installer (`--win`)** | `pnpm --filter @pos/desktop package` | `1` | NSIS step (`NsisTarget.computeScriptAndSignUninstaller` via `WineVmManager`) failed with `Error: spawn UNKNOWN` on Windows 11 after `win-unpacked` succeeded. |
| **Database Migrate** | `pnpm --filter @pos/server migrate` | `0` | Applied migrations `0000`–`0020`, but **silently skipped `0021_notifications_and_audit_logs.sql`** because `apps/server/drizzle/meta/_journal.json` stops at `idx: 20` (`0020_payroll_module`). |
| **Test Suite (3 Runs)** | `pnpm test` (x3) | `1` | **Deterministic across all 3 clean runs:** 94 test files (92 passed, 2 failed), 688 tests (685 passed, 3 failed, 0 skipped). Additionally, on the very first run before `electron/install.js` completed extraction, 15 parallel Vitest workers collided extracting `electron.zip` (`os error 80: The file exists`). |

### 1.2 Test Suite Comparison & Quality Checks
- **Zero `.skip`, `.only`, `.todo`, `xit`, `xdescribe`, or `context.skip`:** Verified across all 94 test files (`Total test files: 94`, `totalIt: 688`, `totalExpect: 3754`).
- **Comparison against `37bd6a7` (First Audit Baseline) and `7e6118a` (End of Phase 5 / ERP Base):**
  - 85 test files added or expanded (`+25,375` lines, `-1,028` lines; `+2,253` `expect(` lines vs `-62` refactored `expect(` lines).
  - The 28 former `context.skip()` calls in `apps/server` were replaced with hard `throw new Error('PostgreSQL must be running...')` guards.
  - Only `roundPaisa` unit tests in `packages/shared/src/money.test.ts` were removed when duplicate rounding function `roundPaisa` was deleted in favor of `roundHalfUp` (per Rule 1).
  - Zero tests without `expect()` assertions (`suspicious: []`). Mocks (`vi.fn`) are restricted to network transport (`mockFetch`), token store stubs in unit tests, and non-blocking fiscal hook verification.

### 1.3 Findings Identified in Stage 1
- **F-H-01 (High):** Migration `apps/server/drizzle/0021_notifications_and_audit_logs.sql` is missing from `apps/server/drizzle/meta/_journal.json`. On any fresh database migrated via `pnpm --filter @pos/server migrate` (including CI and production deployments), `user_notifications` and `audit_logs` tables are never created (`42P01`), breaking `/api/notifications/*`, `/api/admin/audit-logs`, and all admin routes that write audit logs (`notifications-search-audit.test.ts:348, 431`).
- **F-M-01 (Medium):** Time-bomb test failure in `apps/server/src/routes/prescriptions.test.ts:417` (`dispenses prescription against sale invoice`): hardcodes `expect(body.data.nextRefillDate).toBe('2026-11-30')` assuming current date is `2026-11-05`, whereas `POST /api/prescriptions/:id/dispense` (`apps/server/src/routes/prescriptions.ts:346`) computes `nextRefillDate` from live `getKarachiDateString()` (`2026-11-11 + 25 days = 2026-12-06`). Also line 437 hardcodes `'2026-11-08'` for refill reminders.
- **F-M-02 (Medium):** Running `pnpm --filter @pos/server build` compiles `src/**/*.test.ts` into `apps/server/dist/**/*.test.js` (`apps/server/tsconfig.json:7`), and `vitest.config.ts:5` does not exclude `**/dist/**`, causing subsequent `pnpm test` runs to execute 124 test files (running all 30 server test files twice in parallel).
- **F-M-03 (Medium):** `pnpm audit` fails with exit code `1` (breaking `.github/workflows/ci.yml:56`) due to `GHSA-g3hv-75wg-m249` (moderate DoS in `minimatch < 11.0.1` via `electron-builder` and `typescript-eslint`).
- **F-M-04 (Medium):** CI workflow (`.github/workflows/ci.yml`) is missing `pnpm format:check`, production build verification (`@pos/server build`, `@pos/web build`, `@pos/desktop build`), and `DEVICE_JWT_SECRET` env var, and only triggers on `main` branch.
- **F-L-01 (Low):** Missing `.gitattributes` (`* text=auto eol=lf`) causes `pnpm format:check` to fail on all 371 files in a clean Windows `git clone` (`core.autocrlf=true`).
- **F-L-02 (Low):** Deprecated `"pnpm": { "onlyBuiltDependencies": [...] }` in root `package.json:20-25` emits warnings under `pnpm v12.15.0`, and `electron` lazy extraction races when multiple Vitest workers start concurrently before `electron/install.js` has run.

### 1.4 Remaining Stages
- Stage 2: Rules compliance (`docs/RULES.md` & `docs/ERP_SPEC.md`)
- Stage 3: Ledger and accounting integrity + 5,000-document simulation test
- Stage 4: Sync and offline guarantees + resilience & crash-recovery tests
- Stage 5: Security, tenancy, permissions, sensitive data & secrets
- Stage 6: Desktop, packaging, backup/restore & operations
- Stage 7: Web app and UX quality
- Stage 8: Test quality (15 mutation checks in temporary clone)
- Stage 9 & Final Report (`docs/AUDIT_FINAL.md`)


---

## Stage 2: Rules Compliance (`docs/RULES.md` & `docs/ERP_SPEC.md`) (Completed)

### 2.1 Rule-by-Rule Verdict Table
| Rule | Verdict | Evidence (`file:line`) |
| :--- | :---: | :--- |
| **Rule 1 — Money is always integer paisa; one rounding function (`roundHalfUp`); one display formatter (`formatPaisa`)** | **FAIL** | - Database columns in SQLite (`apps/desktop/src/main/db.ts`) and Postgres (`apps/server/src/db/schema.ts`) store integer paisa (`INTEGER` / `bigint`), and core POS (`packages/shared/src/money.ts:63-88`, `tax.ts:24-46`) uses `roundHalfUp` and `formatPaisa`.<br>- **Violations:**<br>  1. `Math.round` / float division on money in `apps/server/src/ledger/budget-service.ts:514` (`Math.round(line.annualBudgetPaisa / 12)`), `apps/server/src/routes/expenses.ts:335`, `apps/server/src/routes/payroll.ts:557`, `packages/shared/src/schema/hr.ts:153`, `packages/shared/src/schema/payroll.ts:119, 150`.<br>  2. 35+ web form inputs use `Math.round(parseFloat(val) * 100)` instead of `convertRupeesToPaisa` (`apps/web/src/lib/cash-bank-utils.ts:36`, `supplier-utils.ts:67,77`, `CustomersPage.tsx:185,186`, `BudgetPlanningPage.tsx:206`, `CashBankPage.tsx:292-520`, `ExpensesPage.tsx:309,421`, `JournalEntriesPage.tsx:145-197`, `PaymentsPage.tsx:268-382`, `PayrollPage.tsx:454-606`, `BatchesExpiryPage.tsx:151`, `PurchaseOrderDetailPage.tsx:147,603`, `PurchaseOrdersPage.tsx:259,681`).<br>  3. 14 duplicate custom `formatPKR`/`formatPaisa` functions across `apps/web/src/lib/*.ts`, plus inline `(paisa / 100).toFixed(2)` in `apps/server/src/routes/search.ts:65,128` and `apps/web/src/lib/financial-reports-utils.ts:98-260`. |
| **Rule 2 — Client-generated IDs are UUIDv7 and never rewritten** | **PASS** | `packages/shared/src/uuid.ts:19-46` (`generateUuidV7`) is used across desktop and server. Server sync appliers (`apps/server/src/sync/appliers/invoice.ts:115, 139, 154, 174`, `credit-note.ts:106, 128, 144`, `purchase.ts:74, 114, 133, 150`, `stock-adjustment.ts:72`, `shift.ts:46`) preserve client `id` and `movementId` verbatim (`onConflictDoNothing`). |
| **Rule 3 — Finalized accounting & financial records are immutable** | **FAIL (Partial)** | - **SQLite (`apps/desktop/src/main/db.ts:153-209`):** Triggers block `DELETE` on `invoices`, `invoice_lines`, `payments`, `credit_notes`, `credit_note_lines`, `stock_movements`, and block `UPDATE` on finalized `invoices`, `invoice_lines`, `payments` (except `invoice_id`), `credit_notes`, `credit_note_lines`. However, **no `BEFORE UPDATE` trigger exists on `stock_movements` in SQLite**.<br>- **Postgres (`0003_immutable_finalized_records.sql:1-147`, `0005_ledger_core.sql:92-122`):** Triggers block `UPDATE`/`DELETE` on `invoices`, `invoice_lines`, `payments`, `credit_notes`, `credit_note_lines`, `stock_movements`, `journal_entries` (except status -> `'reversed'`), and `journal_lines`.<br>- **Missing DB Immutability on Approved/Paid Payroll Runs:** `0020_payroll_module.sql:1-85` defines **no database trigger** protecting `payroll_runs` or `payroll_items` once `status IN ('approved', 'paid')`; protection is route-only (`apps/server/src/routes/payroll.ts:735`). |
| **Rule 4 — Stock balance is always `SUM(stock_movements.quantity_signed)`** | **FAIL** | - Neither `products` nor `batches` has a mutable stock quantity column in SQLite (`db.ts`) or Postgres (`schema.ts`). Sales, returns, GRNs, supplier returns, and stock counts record movements.<br>- **Violations in `apps/server/src/routes/stock-transfers.ts`:**<br>  1. `POST /api/stock-transfers/:id/dispatch` (`lines 419-465`) deducts `transfer_out` without checking on-hand stock at `sourceBranchId` or `quantityDispatched <= quantityRequested`.<br>  2. `POST /api/stock-transfers/:id/receive` (`lines 554-614`) does not verify `quantityReceived + shortageQuantity === quantityDispatched`, and stores a generated `shortageMovementId` (`lines 560, 579`) without ever inserting a `stock_movements` row for it.<br>  3. `POST /api/stock-transfers/:id/cancel` (`lines 714-734`) inserts a reversal `stock_movements` row for `in_transit` transfers without calling `insertChangeLog(tx, { entity: 'stock_movement', ... })`, so desktop counters never receive the reversal movement. |
| **Rule 5 — Multi-table writes, outbox rows, and journal entries happen in ONE transaction** | **FAIL** | - Desktop core POS writes (`finalizeSale.ts:355-717`, `returns.ts:282-503`, `purchasing.ts:272-418`, `purchasing.ts:692-755`, `shifts.ts:182-303, 378-517`) use a single `db.transaction()` with `outbox` insertion.<br>- **Violations:**<br>  1. `POST /api/customers` (`apps/server/src/routes/customers.ts:182-255`) inserts `customers`, calls `postJournalEntry(db, ...)` for `openingBalancePaisa > 0`, and calls `insertChangeLog(db, ...)` as 3 separate non-transactional operations.<br>  2. `PUT /api/customers/:id` (`customers.ts:302-360`) updates `customers` and inserts `change_log` outside a transaction.<br>  3. `POST /api/hr/payroll/runs/generate` (`apps/server/src/routes/payroll.ts:644-671`) inserts `payrollRuns` and `payrollItems` outside a transaction; `PUT /api/hr/payroll/items/:id` (`payroll.ts:750-795`) updates `payrollItems` and `payrollRuns` outside a transaction.<br>  4. Desktop `createSupplier`, `updateSupplier`, `deleteSupplier`, `deactivateSupplier` (`apps/desktop/src/main/purchasing.ts:82-178`) write to SQLite `suppliers` without creating any `outbox` event. |
| **Rule 6 — Electron security (`contextIsolation`, `sandbox`, `nodeIntegration`, `senderFrame`, shared IPC wrapper, PIN re-entry, no secrets)** | **FAIL** | - `BrowserWindow` (`apps/desktop/src/main/index.ts:95-100`) sets `contextIsolation: true, nodeIntegration: false, sandbox: true`. `printService.ts:698-702` sets the same on the hidden print window.<br>- All 58 IPC channels go through `registerSecureIpcHandler` (`wrapper.ts:161-225`), which validates `event.senderFrame` (`wrapper.ts:52-79`).<br>- **Violations:**<br>  1. **Critical (`F-C-01`):** `apps/desktop/src/main/index.ts:597` unconditionally calls `seedDatabase()` on startup in packaged production builds (`!app.isPackaged` check is missing at line 597), inserting 200 fake medicines with random local UUIDv7s whenever `products` count `< 200`.<br>  2. **0 of 58** `registerSecureIpcHandler` calls pass `schema:` to the wrapper (`index.ts:131-522`, `syncIpc.ts:45-173`), and `wrapper.ts:192` (`if (schema && args.length > 0)`) skips validation when `args.length === 0`.<br>  3. `verifyOwnerPinForDestructive` (`wrapper.ts:100-121`) does not check `locked_until` or increment `failed_login_attempts`.<br>  4. All authenticated desktop IPC channels hardcode `roles: ['cashier', 'pharmacist', 'owner']`, blocking `manager` and `accountant` from all channels including `auth:logout` and `auth:lock-session`.<br>  5. `finalizeSale.ts:699` serializes `pinHash: cashier.pin_hash` into every `invoice.created` outbox payload. |
| **Rule 7 — Offline-first & zero external CDN dependencies** | **PASS** | Scanned `apps/desktop` and `apps/web` HTML/CSS/TSX (`apps/desktop/src/renderer/index.html`, `apps/web/index.html`): zero external scripts, stylesheets, Google Fonts, or analytics URLs. |
| **Rule 8 — UTC ISO timestamps & `Asia/Karachi` business dates** | **FAIL** | **75 occurrences** of `new Date().toISOString().slice(0, 10)` or `.substring(0, 10)` (UTC date slicing) used for business dates across desktop (`purchasing.ts:477, 564`, `InvoiceHistoryScreen.tsx:36,43,48`, `GrnReceivingForm.tsx:34`), server (`reports/queries.ts:177,407,408`, `ap.ts:90,239,438,530`, `ar.ts:92,242,531`, `cash-bank.ts:718`, `expenses.ts:927`, `financial-reports.ts:43`, `hr-leave.ts:713`, `prescriptions.ts:27`, `purchase-orders.ts:123`, `stock.ts:74,448,897`, `suppliers.ts:177`, `supplier-returns.ts:173`, `payroll-posting.ts:40,261`), and web (31 occurrences). Between 00:00 and 05:00 PKT (`UTC+5`), this produces yesterday's date. |
| **Rule 9 — Tenant isolation (`pharmacy_id`)** | **FAIL (Edge Cases)** | Audited in detail in Stage 5 (see Stage 5 checkpoint for route-by-route and applier-by-applier results). |

### 2.2 Complete Electron IPC Channel Inventory (58 Channels)
All 58 channels are registered via `registerSecureIpcHandler` (`apps/desktop/src/main/index.ts:131-522` and `apps/desktop/src/main/sync/adapters/syncIpc.ts:45-173`). None pass `schema:` to the wrapper (`Wrapper Schema = NONE`):

| # | Channel | File:Line | Auth / Roles (`options`) | Service-Layer Validation | Public Reason / Notes |
| :- | :--- | :--- | :--- | :--- | :--- |
| 1 | `ping` | `index.ts:132` | `isPublic: true` | None (0 args) | Health check |
| 2 | `setup:get-status` | `index.ts:137` | `isPublic: true` | None (0 args) | Pre-login initial setup check |
| 3 | `setup:complete` | `index.ts:141` | `isPublic: true` | `CompleteSetupInputSchema.parse` (`setup.ts:94`) | Guarded by `isSetupCompleted(db)` (`setup.ts:90`) |
| 4 | `auth:list-active-users` | `index.ts:149` | `isPublic: true` | None (0 args) | Login screen user picker (returns `id, name, role`) |
| 5 | `auth:list-counters` | `index.ts:153` | `isPublic: true` | None (0 args) | Login screen counter picker |
| 6 | `auth:login` | `index.ts:158` | `isPublic: true` | `LoginInputSchema.parse` (`auth.ts:149`) | PIN login with 5-attempt lockout (`auth.ts:169-219`) |
| 7 | `auth:logout` | `index.ts:177` | `['cashier','pharmacist','owner']` | None | **Bug:** blocks `manager`/`accountant` from logging out |
| 8 | `auth:get-session` | `index.ts:183` | `isPublic: true` | None (0 args) | Session state check on renderer boot |
| 9 | `auth:lock-session` | `index.ts:187` | `['cashier','pharmacist','owner']` | None | **Bug:** blocks `manager`/`accountant` from locking |
| 10 | `auth:unlock-session` | `index.ts:192` | `isPublic: true` | `UnlockInputSchema.parse` (`auth.ts:276`) | Unlock locked counter session |
| 11 | `auth:touch-activity` | `index.ts:199` | `['cashier','pharmacist','owner']` | None | Idle timer reset |
| 12 | `users:list` | `index.ts:207` | `['owner']` | None (`boolean` flag) | Owner user management |
| 13 | `users:create` | `index.ts:212` | `['owner']` | `CreateUserInputSchema.parse` (`auth.ts:368`) | Owner user creation |
| 14 | `users:update` | `index.ts:217` | `['owner']` | `UpdateUserInputSchema.parse` (`auth.ts:413`) | Owner user update |
| 15 | `users:reset-pin` | `index.ts:224` | `['owner']` | `ResetPinInputSchema.parse` (`auth.ts:465`) | Owner PIN reset |
| 16 | `users:deactivate` | `index.ts:229` | `['owner']` | String `userId` check | Owner deactivate user |
| 17 | `users:reactivate` | `index.ts:234` | `['owner']` | String `userId` check | Owner reactivate user |
| 18 | `products:seed` | `index.ts:241` | `['owner']` | None (`!app.isPackaged` guard) | Dev-only seed trigger |
| 19 | `products:search` | `index.ts:251` | `['cashier','pharmacist','owner']` | `ProductSearchParamsSchema.parse` | POS product search |
| 20 | `products:get-by-barcode` | `index.ts:256` | `['cashier','pharmacist','owner']` | String check | Barcode lookup |
| 21 | `products:get` | `index.ts:261` | `['cashier','pharmacist','owner']` | String check | Product detail lookup |
| 22 | `products:create` | `index.ts:266` | `['pharmacist','owner']` | `ProductInputSchema.parse` | Create product |
| 23 | `products:update` | `index.ts:271` | `['pharmacist','owner']` | `UpdateProductInputSchema.parse` | Update product |
| 24 | `products:deactivate` | `index.ts:278` | `['pharmacist','owner']` | String check | Deactivate product |
| 25 | `products:list-tax-categories`| `index.ts:283` | `['cashier','pharmacist','owner']` | None | List tax categories |
| 26 | `sales:finalize` | `index.ts:290` | `['cashier','pharmacist','owner']` | Manual checks (`finalizeSale.ts:263-277`) | Overrides `cashierUserId` & `counterId` from `session` (`index.ts:294-298`) |
| 27 | `sales:list-counters` | `index.ts:304` | `['cashier','pharmacist','owner']` | None | Counter list |
| 28 | `Sales:list-users` | `index.ts:310` | `['cashier','pharmacist','owner']` | None | Active users (`id, name, role`) |
| 29 | `sales:get-stock` | `index.ts:316` | `['cashier','pharmacist','owner']` | None | Branch stock balances |
| 30 | `HeldSales:hold` | `index.ts:331` | `['cashier','pharmacist','owner']` | `HoldCartInputSchema.parse` | Hold cart |
| 31 | `held-sales:list` | `index.ts:336` | `['cashier','pharmacist','owner']` | Optional `counterId` | List held carts |
| 32 | `held-sales:resume` | `index.ts:341` | `['cashier','pharmacist','owner']` | String `id` | Resume held cart |
| 33 | `held-sales:discard` | `index.ts:346` | `['cashier','pharmacist','owner']` | String `id` | Discard held cart |
| 34 | `held-sales:count` | `index.ts:353` | `['cashier','pharmacist','owner']` | Optional `counterId` | Count held carts |
| 35 | `invoices:list` | `index.ts:360` | `['cashier','pharmacist','owner']` | Manual filter SQL params | List local invoices |
| 36 | `invoices:get-detail` | `index.ts:365` | `['cashier','pharmacist','owner']` | String `invoiceId` | Get local invoice detail |
| 37 | `invoices:print-receipt` | `index.ts:370` | `['cashier','pharmacist','owner']` | **NONE** (`ReceiptPrintPayload` unvalidated) | Prints receipt HTML |
| 38 | `suppliers:list` | `index.ts:377` | `['cashier','pharmacist','owner']` | Boolean `includeInactive` | List suppliers |
| 39 | `suppliers:get` | `index.ts:382` | `['cashier','pharmacist','owner']` | String `id` | Get supplier |
| 40 | `suppliers:create` | `index.ts:387` | `['pharmacist','owner']` | `SupplierInputSchema.parse` | Create supplier (no outbox!) |
| 41 | `suppliers:update` | `index.ts:392` | `['pharmacist','owner']` | `UpdateSupplierInputSchema.parse` | Update supplier (no outbox!) |
| 42 | `suppliers:delete` | `index.ts:399` | `['pharmacist','owner']` | String `id` | Deactivate supplier (no outbox!) |
| 43 | `purchases:receive-grn` | `index.ts:406` | `['pharmacist','owner']` | `ReceiveGrnInputSchema.parse` | Receive GRN |
| 44 | `stock:overview-by-product` | `index.ts:413` | `['cashier','pharmacist','owner']` | `StockFilterParamsSchema.parse` | Stock by product |
| 45 | `stock:overview-by-batch` | `index.ts:418` | `['cashier','pharmacist','owner']` | `StockFilterParamsSchema.parse` | Stock by batch |
| 46 | `stock:batches-for-product` | `index.ts:423` | `['cashier','pharmacist','owner']` | String `productId` | Batches for product |
| 47 | `stock:adjust` | `index.ts:428` | `['pharmacist','owner']` | `StockAdjustmentInputSchema.parse` | Stock adjustment |
| 48 | `returns:get-returnable-lines`| `index.ts:435` | `['cashier','pharmacist','owner']` | String `invoiceId` | Returnable invoice lines |
| 49 | `returns:process` | `index.ts:440` | `['cashier','pharmacist','owner']` | `ProcessReturnInputSchema.parse` | Process credit note |
| 50 | `returns:list` | `index.ts:445` | `['cashier','pharmacist','owner']` | Manual filter SQL params | List credit notes |
| 51 | `returns:get-detail` | `index.ts:450` | `['cashier','pharmacist','owner']` | String `creditNoteId` | Get credit note detail |
| 52 | `returns:print-credit-note` | `index.ts:455` | `['cashier','pharmacist','owner']` | String `creditNoteId` | Print credit note |
| 53 | `shifts:open` | `index.ts:467` | `['cashier','pharmacist','owner']` | `OpenShiftInputSchema.parse` | Open shift |
| 54 | `shifts:close` | `index.ts:472` | `['cashier','pharmacist','owner']` | `CloseShiftInputSchema.parse` | Close shift |
| 55 | `shifts:get-current` | `index.ts:477` | `['cashier','pharmacist','owner']` | Optional `counterId` | Get current shift |
| 56 | `shifts:list-history` | `index.ts:482` | `['cashier','pharmacist','owner']` | Manual filter params | Shift history |
| 57 | `shifts:get-z-report` | `index.ts:487` | `['cashier','pharmacist','owner']` | String `shiftId` | Shift Z-report |
| 58 | `shifts:print-z-report` | `index.ts:492` | `['cashier','pharmacist','owner']` | String `shiftId` | Print Z-report |
| 59 | `backup:create` | `index.ts:499` | `['owner']` | Optional `customDir` | Create SQLite backup |
| 60 | `backup:list` | `index.ts:504` | `['owner']` | Optional `customDir` | List backups |
| 61 | `backup:restore` | `index.ts:509` | `['owner']`, `requiresOwnerPin: true` | **No path traversal guard on `backupFilePath`** | Restore SQLite backup |
| 62 | `system:export-diagnostics` | `index.ts:518` | `['owner']` | Optional `targetDir` | Export diagnostics bundle |
| 63 | `sync:getStatus` | `syncIpc.ts:46` | `['cashier','pharmacist','owner']` | None | Sync status |
| 64 | `sync:syncNow` | `syncIpc.ts:59` | `['cashier','pharmacist','owner']` | None | Trigger sync |
| 65 | `sync:listExceptions` | `syncIpc.ts:74` | `['cashier','pharmacist','owner']` | None | List sync exceptions |
| 66 | `sync:retryException` | `syncIpc.ts:89` | `['pharmacist','owner']` | String `id` | Retry sync exception |
| 67 | `sync:retryAllExceptions` | `syncIpc.ts:104`| `['pharmacist','owner']` | None | Retry all exceptions |
| 68 | `sync:dismissException` | `syncIpc.ts:119`| `['owner']` | String `id` | Dismiss sync exception |
| 69 | `sync:exportExceptions` | `syncIpc.ts:134`| `['owner']` | None | Export exceptions JSON |
| 70 | `sync:registerDevice` | `syncIpc.ts:154`| `['owner']` | Manual field check (`syncIpc.ts:158`) | Register device |

*(Note: 58 channels in `index.ts` + 8 channels in `syncIpc.ts` = 66 total IPC channels, all registered via `registerSecureIpcHandler`.)*

### 2.3 New Findings Identified in Stage 2
- **F-C-01 (Critical):** `apps/desktop/src/main/index.ts:597` unconditionally runs `seedDatabase()` on startup in packaged production builds (`if (!app.isPackaged)` is missing around `seedDatabase()`, unlike `products:seed` at line 244). Whenever `SELECT COUNT(*) FROM products < 200` (`apps/desktop/src/main/db/seed.ts:756`), `seedDatabase()` inserts 2 tax categories, 5 demo suppliers, and up to 200 fake medicines with random local UUIDv7s into the production SQLite database.
- **F-H-02 (High):** Non-transactional multi-table writes in `POST /api/customers` (`apps/server/src/routes/customers.ts:182-255`), `PUT /api/customers/:id` (`customers.ts:302-360`), `POST /api/hr/payroll/runs/generate` (`apps/server/src/routes/payroll.ts:644-671`), and `PUT /api/hr/payroll/items/:id` (`payroll.ts:750-795`). If `postJournalEntry` fails during `POST /api/customers` with `openingBalancePaisa > 0`, the customer row remains committed without a corresponding journal entry in `1100` (AR), permanently breaking AR control-account reconciliation.
- **F-H-03 (High):** `postPayrollRunToLedger` and `postPayrollPaymentBatch` (`apps/server/src/ledger/payroll-posting.ts:14-351`) bypass `postJournalEntry`, compute `MAX(entry_no) + 1` without `pg_advisory_xact_lock` (racing under concurrent ledger writes), slice UTC timestamps for `entry_date` (`nowIso.substring(0, 10)` at lines 40 and 261), require an explicit `'open'` row in `fiscal_periods` without checking date boundaries (failing on new tenants where `fiscal_periods` has 0 rows), credit advance recoveries to `2300` without `partyType`/`partyId`, and `POST /api/hr/advances` (`apps/server/src/routes/payroll.ts:242-310`) disburses employee advances without posting any journal entry to the ledger.
- **F-H-04 (High):** 75 occurrences of `new Date().toISOString().slice(0, 10)` (UTC date slicing) used for business dates across desktop, server, and web instead of `Asia/Karachi`, producing yesterday's date between 00:00 and 05:00 PKT (`UTC+5`).
- **F-H-05 (High):** Stock transfer integrity bugs in `apps/server/src/routes/stock-transfers.ts`: (1) `dispatch` (`lines 419-465`) does not check on-hand stock at `sourceBranchId` or `quantityDispatched <= quantityRequested`; (2) `receive` (`lines 554-614`) does not verify `quantityReceived + shortageQuantity === quantityDispatched` and stores a dangling `shortageMovementId` (`lines 560, 579`) without inserting a `stock_movements` row; (3) `cancel` (`lines 714-734`) inserts a reversal `stock_movements` row for `in_transit` transfers without calling `insertChangeLog`, leaving desktop counters out of sync.
- **F-M-05 (Medium):** Rule 1 money violations: `Math.round` / float division on money outside `roundHalfUp` (`budget-service.ts:514`, `expenses.ts:335`, `payroll.ts:557`, `packages/shared/src/schema/hr.ts:153`, `payroll.ts:119,150`), 35+ web input forms using `Math.round(parseFloat(val) * 100)` instead of `convertRupeesToPaisa`, and 14 duplicate `formatPKR`/`formatPaisa` formatters across `apps/web/src/lib/*.ts` plus inline `(paisa / 100).toFixed(2)` in `apps/server/src/routes/search.ts:65,128` and `financial-reports-utils.ts:98-260`.
- **F-M-06 (Medium):** Desktop IPC wrapper (`apps/desktop/src/main/ipc/wrapper.ts`) and handler registration gaps: 0 of 66 `registerSecureIpcHandler` calls pass `schema:`; `wrapper.ts:192` skips validation when `args.length === 0`; `verifyOwnerPinForDestructive` (`wrapper.ts:100-121`) ignores `locked_until` and does not increment `failed_login_attempts`; and all authenticated desktop IPC handlers hardcode `roles: ['cashier', 'pharmacist', 'owner']`, blocking `manager` and `accountant`.

### 2.4 Remaining Stages
- Stage 3: Ledger and accounting integrity + 5,000-document simulation test
- Stage 4: Sync and offline guarantees + resilience & crash-recovery tests
- Stage 5: Security, tenancy, permissions, sensitive data & secrets
- Stage 6: Desktop, packaging, backup/restore & operations
- Stage 7: Web app and UX quality
- Stage 8: Test quality (15 mutation checks in temporary clone)
- Stage 9 & Final Report (`docs/AUDIT_FINAL.md`)


---

## Stage 3: Ledger and Accounting Integrity — COMPLETED

### 3.1 Ledger Core, Triggers & Concurrency Verification
- **Double-entry balance constraint trigger:** Verified in `apps/server/drizzle/0003_ledger_foundation.sql:55-88` (`check_journal_entry_balanced` `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`) and tested in `tests/audit-final/stage3-ledger-simulation.test.ts:371-413`. Direct SQL inserts of unbalanced `journal_lines` or 0-line `journal_entries` fail at transaction `COMMIT`.
- **Immutability triggers:** Verified in `apps/server/drizzle/0003_ledger_foundation.sql:90-108` (`prevent_journal_mutation` on `journal_entries` and `journal_lines`) and tested in `tests/audit-final/stage3-ledger-simulation.test.ts:458-468`. Direct `UPDATE` and `DELETE` fail with `Journal entries and lines are immutable; use a reversal entry`.
- **Gapless `entry_no` under concurrency:** Verified in `apps/server/src/ledger/service.ts:242-262` (`SELECT pg_advisory_xact_lock(hashtext('journal_entry_no:' || pharmacy_id))`) and tested in `tests/audit-final/stage3-ledger-simulation.test.ts:415-447` across 20 parallel transactions on a multi-connection `pg.Pool`, producing exact gapless sequence `[1..20]`.
  - **Exception (`F-H-03`):** `postPayrollRunToLedger` and `postPayrollPaymentBatch` (`apps/server/src/ledger/payroll-posting.ts:138-146, 307-315`) bypass `postJournalEntry` and do NOT acquire the advisory lock before `SELECT COALESCE(MAX(entry_no), 0) + 1`.
- **Idempotency:** Verified `uq_journal_entries_pharmacy_source` (`UNIQUE (pharmacy_id, source_type, source_id)`) in `apps/server/src/db/schema.ts:814` and `postJournalEntry` (`service.ts:169-189`).
  - **Exception (`F-C-02`):** `executeYearEndClosing` (`apps/server/src/ledger/period-close.ts:440`) passes a random `sourceId: generateUuidV7()`, defeating idempotency and allowing duplicate year-end closing entries.

### 3.2 Document-to-Ledger Posting Verification Table
| Document / Event | Source File & Line | Accounts Posted (Dr / Cr) | Party / Branch Tagging | Atomic Tx & Idempotency | Verdict |
|---|---|---|---|---|---|
| POS Sale (cash/card/wallet/credit/split + discount + GST + COGS) | `apps/server/src/sync/appliers/invoice.ts:490` -> `posting-engine.ts:302-406` | Dr `1000`/`1010`/`1020`/`1100`, Cr `4000 Sales`, Cr `2100 Output Tax`; Dr `5000 COGS`, Cr `1200 Inventory` | `partyType='customer', partyId=customerId` on `1100`; `branchId` on all lines | Same tx; `sourceType='invoice', sourceId=invoice.id` | **PASS** |
| Customer Return / Credit Note | `apps/server/src/sync/appliers/credit-note.ts:232` -> `posting-engine.ts:436-520` | Dr `4090 Sales Returns`, Dr `2100 Output Tax`, Cr `1000`/`1010`/`1020`/`1100`; Dr `1200 Inventory`, Cr `5000 COGS` | **FAIL (`F-C-03`):** Omits `partyType`/`partyId` on `1100 AR` when `refundMethod === 'credit'` (`lines 474-482`) | Same tx; `sourceType='credit_note', sourceId=creditNote.id` | **FAIL (`F-C-03`)** |
| Purchase / GRN (Sync & PO Receive) | `purchase.ts:221` & `purchase-orders.ts:797` -> `posting-engine.ts:530-577` | Dr `1200 Inventory` (+ `2110 Input Tax`), Cr `2000 AP` | `partyType='supplier', partyId=supplierId` on `2000 AP` | Same tx; **FAIL (`F-H-06`):** `purchase.ts:202` stamps `stock_movements.createdAt = now` instead of `payload.purchase.createdAt`; `purchase-orders.ts:768-794` omits `change_log` | **FAIL (`F-H-06`)** |
| Supplier Return / Debit Note | `supplier-returns.ts:294` -> `posting-engine.ts:796-851` | Dr `2000 AP`, Cr `1200 Inventory` (+ Cr `2110 Input Tax`) | `partyType='supplier', partyId=supplierId` on `2000 AP` | Same tx; `sourceType='supplier_return'` | **PASS** |
| Stock Adjustment (gain / loss / damage) | `stock-adjustment.ts:124` -> `posting-engine.ts:588-636` | Gain: Dr `1200`, Cr `5010`; Loss: Dr `5010`, Cr `1200` | `branchId` on all lines | Same tx; `sourceType='stock_adjustment'` | **PASS** |
| Batch Write-Off & Batch Discount | `apps/server/src/routes/stock.ts:649-656, 782` -> `posting-engine.ts:741-784` | Write-off: Dr `5020 Expired Write-Off`, Cr `1200 Inventory` | `branchId` on all lines | **FAIL (`F-H-06`):** Neither write-off nor batch discount writes to `change_log` | **FAIL (`F-H-06`)** |
| Stock Transfer (inter-branch & shortage) | `stock-transfers.ts:596` & `stock-transfer.ts:276` -> `posting-engine.ts:643-730` | Inter-branch: Cr `1200` (source), Dr `1200` (dest), Dr `5010` (shortage) | `branchId` per source/dest | **FAIL (`F-H-06`):** Returns `null` when `sourceBranchId === destinationBranchId` even if `shortageQuantity > 0` (`line 648`); in-transit transfers break `1200` reconciliation | **FAIL (`F-H-06`)** |
| Supplier Payment & Advance Application | `ap.ts:448` -> `posting-engine.ts:951-1019` | Dr `2000 AP`, Cr `1000`/`1010`/`1020` | `partyType='supplier', partyId` on `2000 AP` | Same tx; `sourceType='supplier_payment'` | **PASS** |
| Customer Receipt (Web AR & Counter Sync) | `ar.ts:452` & `customer-receipt.ts:116` -> `posting-engine.ts:951-1019` | Dr `1000`/`1010`/`1020`, Cr `1100 AR` | `partyType='customer', partyId` on `1100 AR` | Same tx; `sourceType='customer_receipt'` | **PASS** |
| Customer Opening Balance | `customers.ts:212` vs `sync/appliers/customer.ts:78` | Web: Dr `1100 AR`, Cr `3000 Owner Capital` | Web sets `partyId`; **FAIL (`F-C-03`):** Sync applier `customer.ts:78` inserts `openingBalancePaisa` without posting to ledger | Web outside tx (`F-H-02`); Sync skips ledger (`F-C-03`) | **FAIL (`F-C-03`)** |
| Operating Expense (Paid vs Credit) | `expenses.ts:421` -> `posting-engine.ts:1032-1091` | Dr `6xxx` (+ `2110`), Cr `1000`/`1010` or `2000 AP` | **FAIL (`F-C-03`):** Credit expense sets `partyId: undefined` (`NULL`) on `2000 AP` (`line 1055`), breaking AP subledger reconciliation | Same tx; `sourceType='expense'` | **FAIL (`F-C-03`)** |
| Cash-Bank Transfer | `cash-bank.ts:255` -> `posting-engine.ts:865-937` | Dr `toAccount`, Cr `fromAccount` | `branchId` on all lines | Same tx; `sourceType='cash_transfer'` | **PASS** |
| Payroll Run Approval, Payment & Advances | `payroll.ts:242, 871, 1018` -> `payroll-posting.ts:14-351` | Accrual: Dr `6000`/`6005`, Cr `2200`/`2210`/`2220`/`2300`; Pay: Dr `2200`, Cr Bank/Cash | **FAIL (`F-H-03`):** No `partyId` on `2300` recovery; `POST /api/hr/advances` posts NO journal entry when disbursing advance | Bypasses `postJournalEntry` (`F-H-03`) | **FAIL (`F-H-03`)** |
| Period Close / Reopen & Year-End Close | `service.ts:482-625`, `period-close.ts:32-453` | Year-end: closes `4xxx`/`5xxx`/`6xxx` into `3100 Retained Earnings` | `branchId` preserved | **FAIL (`F-C-02`):** Excludes `status = 'reversed'` entries and lacks idempotency on year-end close | **FAIL (`F-C-02`)** |

### 3.3 Seeded 5,050-Document Multi-Counter Simulation & Reconciliation Results
- **Test File:** `tests/audit-final/stage3-ledger-simulation.test.ts` (Seed `20261111`, 5,050 documents across 2 branches/counters + 200 duplicate sync replays + 40 concurrency test entries).
- **Command & Output:** `pnpm vitest run tests/audit-final/stage3-ledger-simulation.test.ts` -> **4 passed (4), exit code 0 (62.3s)**.

| Invariant / Metric | Expected / Operational Value (Paisa) | Ledger / Report Value (Paisa) | Difference (Paisa) | Verdict |
|---|---:|---:|---:|---|
| 1. Trial Balance (`SUM(debit)` vs `SUM(credit)`) | `12,589,003,971` | `12,589,003,971` | `0` | **PASS** |
| 2. Balance Sheet (`Assets` vs `Liabilities + Equity + Profit`) | `11,359,316,789` | `11,359,316,789` | `0` | **PASS** |
| 3. Gross Sales (`Invoices - Credit Notes` vs `4000 - 4090 + 2100`) | `924,166,789` | `924,166,789` | `0` | **PASS** |
| 4. Net Sales (`Invoices Net - Credit Notes Net` vs `4000 - 4090`) | `840,882,979` | `840,882,979` | `0` | **PASS** |
| 5. Inventory Valuation (`SUM(batch_stock * cost)` vs `1200 Inventory`) | `10,436,630,000` | `10,436,630,000` | `0` (as of sync date; off for past cutoff due to `F-H-06`) | **PASS (with `F-H-06` note)** |
| 6. AR Control (`1100`) vs Sum of Customer Balances | `234,152,020` | `234,152,020` | `0` (for normal receipts; fails after reversal/credit-CN per `F-C-02`/`F-C-03`) | **FAIL on reversal/credit-CN (`F-C-02`, `F-C-03`)** |
| 7. AP Control (`2000`) vs Sum of Supplier Balances | `10,996,800,000` | `10,996,800,000` | `0` (for supplier bills/payments; fails on credit expense per `F-C-03`) | **FAIL on credit expense (`F-C-03`)** |
| 8. Cash (`1000`), Bank (`1010`), Wallet (`1020`) Balances | `244,067,998` / `218,205,986` / `226,260,785` | `244,067,998` / `218,205,986` / `226,260,785` | `0` | **PASS** |
| 9. P&L Net Profit (`Revenue - COGS - OpEx` vs BS Current Profit) | `279,232,979` | `279,232,979` | `0` | **PASS** |
| 10. Branch 1 P&L + Branch 2 P&L == Consolidated P&L | `279,232,979` | `279,232,979` | `0` | **PASS** |
| 11. Journal Entry Count (5,050 docs + 40 concurrency entries, 200 dup replays) | `5,090` | `5,090` | `0` | **PASS** |

### 3.4 Financial Reports Scale Benchmark (100,001 `journal_lines`)
- Measured in `tests/audit-final/stage3-ledger-simulation.test.ts:1443-1575` with `100,001` rows in `journal_lines` (`compareWithPrevious: true`):
  - `getTrialBalance`: **238 ms**
  - `getProfitAndLoss`: **17 ms**
  - `getBalanceSheet`: **177 ms**
  - `getCashFlow`: **89 ms**
  - `getGeneralLedgerSummary`: **244 ms**
  - `getAccountLedgerDetail` (4,200 lines on `4000 Sales`): **42 ms**

### 3.5 Stage 3 Findings Summary
- **`F-C-02` (Critical):** `reverseJournalEntry` (`apps/server/src/ledger/service.ts:426-441`) inserts the **reversing entry** with `status = 'reversed'` while leaving the original entry `status = 'posted'`. However, AR (`ar.ts:129,203,268,563,591`), AP (`ap.ts:127,200,265,562,590`), Month-End Checklist (`period-close.ts:202,248`), and Year-End Closing (`period-close.ts:357`) filter `journal_entries.status != 'reversed'` or `status = 'posted'`, which **includes the original entry and excludes its reversal**! Reversing any receipt/payment permanently breaks AR/AP control account reconciliation (reproduced in `stage3-ledger-simulation.test.ts:1290-1328`), and year-end close closes reversed revenues/expenses without their reversals and is non-idempotent (`period-close.ts:358, 440`).
- **`F-C-03` (Critical):** Missing `partyId` on AR/AP control account postings breaks subledger reconciliation:
  1. `postCreditNoteCreated` (`apps/server/src/ledger/posting-engine.ts:474-482`) credits `1100 Accounts Receivable` when `refundMethod === 'credit'` without `partyType: 'customer'` or `partyId`.
  2. `postExpenseCompleted` (`posting-engine.ts:1050-1057`) credits `2000 Accounts Payable` when `paymentType === 'credit'` with `partyId: undefined` (`NULL`), reproduced in `stage3-ledger-simulation.test.ts:1252-1280`.
  3. `applyCustomerCreated` (`apps/server/src/sync/appliers/customer.ts:78`) inserts `openingBalancePaisa` on `customers` without posting a journal entry to `1100 AR`.
- **`F-H-06` (High):** Inventory-to-ledger and server-to-counter sync gaps:
  1. `applyPurchaseReceived` (`apps/server/src/sync/appliers/purchase.ts:202`) stamps `stock_movements.createdAt = now` instead of `payload.purchase.createdAt`, breaking historical `reconcileLedger` (`reconciliation.ts:184-185`) for offline purchases synced on a later date (reproduced in `stage3-ledger-simulation.test.ts:1138-1144`).
  2. `POST /api/purchase-orders/:id/receive` (`purchase-orders.ts:768-794`) and `POST /api/inventory/batches/:id/write-off` & `/discount` (`stock.ts:649-656, 765-779`) never write to `change_log`, so desktop counters never receive PO stock, write-offs, or batch MRP changes.
  3. `postStockTransferReceived` (`posting-engine.ts:648-650`) returns `null` when `sourceBranchId === destinationBranchId` even when `shortageQuantity > 0`, failing to post the shortage loss (`Dr 5010 / Cr 1200`), and in-transit inter-branch transfers have no `Stock in Transit` ledger entry while `transfer_out` already reduces `stock_movements`.

### Remaining Stages
- Stage 4: Sync and offline guarantees
- Stage 5: Security, tenancy, permissions, sensitive data and secrets
- Stage 6: Desktop, packaging, backup/restore and operations
- Stage 7: Web app and UX quality
- Stage 8: Test quality (mutation sanity in temporary clone)
- Stage 9 & Final Report (`docs/AUDIT_FINAL.md`)


---

## Stage 4: Sync and Offline Guarantees — COMPLETED

### 4.1 Complete Sync Event & Pull Entity Mapping Table

#### A. Push Event Types (`outbox` -> `POST /api/sync/push`)
| Event Type | Shared Zod Schema (`packages/shared/src/schema/sync.ts`) | Desktop Emitter (`apps/desktop/src/main/`) | Server Applier (`apps/server/src/sync/`) | Status & Audit Findings |
|---|---|---|---|---|
| `purchase.received` | `PurchaseReceivedPayloadSchema` (`line 69`) | `purchasing.ts:238` (`receiveGrn`) | `appliers/purchase.ts:10` (`applyPurchaseReceived`) | **FAIL (`F-H-06`):** Applier stamps `stock_movements.createdAt = now` (`line 202`) instead of `payload.purchase.createdAt`. |
| `invoice.created` | `InvoiceCreatedPayloadSchema` (`line 137`) | `finalizeSale.ts:350` & `invoices.ts:372` | `appliers/invoice.ts:18` (`applyInvoiceCreated`) | **FAIL (`F-H-07`):** Desktop SQLite `payments.method` (`db.ts:455`) and `finalizeSale.ts:554` disallow `'credit'`, and `invoices` has no `customer_id` column. Also `invoices.ts:332` (`createInvoice`) omits `products`/`batches`/`cashierUser` snapshots. |
| `credit_note.created` | `CreditNoteCreatedPayloadSchema` (`line 176`) | `returns.ts:278` (`processReturn`) | `appliers/credit-note.ts:10` (`applyCreditNoteCreated`) | **FAIL (`F-C-03`):** When `refundMethod === 'credit'`, `postCreditNoteCreated` (`posting-engine.ts:474`) omits `partyId` on `1100 AR`. |
| `stock_adjustment.created` | `StockAdjustmentCreatedPayloadSchema` (`line 196`) | `purchasing.ts:720` (`adjustStock`) | `appliers/stock-adjustment.ts:10` (`applyStockAdjustmentCreated`) | **PASS** |
| `shift.opened` | `ShiftOpenedPayloadSchema` (`line 261`) | `shifts.ts:248` (`openShift`) | `appliers/shift.ts:9` (`applyShiftOpened`) | **PASS** |
| `shift.closed` | `ShiftClosedPayloadSchema` (`line 272`) | `shifts.ts:478` (`closeShift`) | `appliers/shift.ts:105` (`applyShiftClosed`) | **PASS** |
| `stock_transfer.dispatched` | `StockTransferDispatchedPayloadSchema` (`line 224`) | **NONE (Not implemented in desktop)** | `appliers/stock-transfer.ts:20` (`applyStockTransferDispatched`) | **FAIL (`F-H-07`):** Server applier exists, but desktop has no `stock_transfers` table, UI, or outbox emitter. |
| `stock_transfer.received` | `StockTransferReceivedPayloadSchema` (`line 252`) | **NONE (Not implemented in desktop)** | `appliers/stock-transfer.ts:154` (`applyStockTransferReceived`) | **FAIL (`F-H-07`):** Server applier exists, but desktop has no `stock_transfers` table, UI, or outbox emitter. |
| `customer.created` | `CustomerCreatedPayloadSchema` (`line 292`) | **NONE (Not implemented in desktop)** | `appliers/customer.ts:13` (`applyCustomerCreated`) | **FAIL (`F-H-07`, `F-C-03`):** Desktop has no `customers` table or emitter; server applier skips ledger posting for `openingBalancePaisa`. |
| `customer_receipt.created` | `CustomerReceiptCreatedPayloadSchema` (`line 306`) | **NONE (Not implemented in desktop)** | `appliers/customer-receipt.ts:12` (`applyCustomerReceiptCreated`) | **FAIL (`F-H-07`):** Desktop has no `customers` table, receipt UI, or emitter. |
| Prescriptions & Attendance | **NONE** | **NONE** | **NONE** | **FAIL (`F-H-07`):** Prescriptions and HR Attendance are web-only (`apps/web`); zero desktop tables or sync events exist. |
| Desktop Master-Data Edits (`products`, `suppliers`, `users`) | N/A | `products.ts:216,261`, `purchasing.ts:82,117`, `auth.ts:471,523` | **NONE** | **FAIL (`F-M-07`):** Desktop allows creating/editing products, suppliers, and staff locally without writing to `outbox`, so edits never sync to server (except snapshots attached to a first sale/GRN) and are overwritten on next pull. |

#### B. Pull Entities (`change_log` -> `GET /api/sync/pull` -> `apps/desktop/src/main/sync/core/pullAndApply.ts`)
| `change_log.entity` | Branch Scoped? (`change-log.ts:16`) | Handled in `pullAndApply.ts`? | Behavior & Findings |
|---|---|---|---|
| `product` / `products` | No (`NULL`) | Yes (`lines 193-232`) | Upserts `products`; `delete` sets `is_active = 0`. |
| `tax_category` / `tax_categories` | No (`NULL`) | Yes (`lines 234-249`) | Upserts `tax_categories`. |
| `branch` / `branches` | No (`NULL`) | Yes (`lines 251-262`) | Upserts `branches`. |
| `counter` / `counters` | Yes (`branchId`) | Yes (`lines 264-279`) | Upserts `counters`. |
| `user` / `users` | No (`NULL`) | Yes (`lines 281-305`) | Upserts `users`; preserves existing `pin_hash` if empty. |
| `supplier` / `suppliers` | No (`NULL`) | Yes (`lines 307-324`) | Upserts `suppliers`; `delete` sets `is_active = 0`. |
| `stock_location` / `stock_locations` | No (`NULL`) | Yes (`lines 326-351`) | Upserts `stock_locations`. |
| `batch` / `batches` | No (`NULL`) | Yes (`lines 353-368`) | `INSERT OR IGNORE INTO batches` (`line 171`). **Note (`F-H-06`):** Never updates `mrp_paisa` on existing batches when discounted on server. |
| `stock_movement` / `stock_movements` | Yes (`branchId`) | Yes (`lines 370-404`) | `INSERT OR IGNORE INTO stock_movements` (`line 177`). |
| `shift`, `invoice`, `invoice_line`, `payment`, `credit_note`, `credit_note_line` | `shift`: Yes; others: No | Yes (`lines 406-419`) | Intentional no-op (`break;`). |
| `customer` | No (`NULL`) | **NO (`lines 421-426`)** | **FAIL (`F-H-07`):** Hits `default:` (`Unknown entity type "customer" encountered; skipping row`). Reproduced in `tests/audit-final/stage4-sync-resilience.test.ts:1022-1084`. |

### 4.2 Offline Resilience & Multi-Counter Contention Test Results
- **Test File:** `tests/audit-final/stage4-sync-resilience.test.ts`
- **Command & Output:** `pnpm vitest run tests/audit-final/stage4-sync-resilience.test.ts` -> **3 passed (3), exit code 0 (4.48s)**.
  1. **Test `4.1` (100 offline sales + mid-sale crash injection & restart):**
     - Executed 50 offline sales on a fresh on-disk WAL SQLite database, injected a mid-transaction crash during sale #51 after inserting into `invoices` and `stock_movements` (before `outbox`), abruptly closed and reopened the SQLite file, verified `PRAGMA integrity_check === 'ok'` and complete rollback of sale #51 (`last_invoice_seq === 50`), retried sale #51 idempotently with the same `clientRequestId` (plus duplicate replay), and completed sales 51..100.
     - Verified: `100` invoices (`C1-000001`..`C1-000100`), `100` outbox events (`device_seq` `1..100`), exact stock movement balance (`initialStock - expectedUnitsSold`), and exact cash payments sum (`expectedCashPaisa`).
  2. **Test `4.2` (20 iterations of two counters selling the same batch offline + random network failures):**
     - Across 20 iterations, seeded 20 batches with 10 units each on Server, Counter 1, and Counter 2; Counter 1 sold 8 units offline and Counter 2 sold 8 units offline from the same batch (`10 - 8 - 8 = -6` oversold).
     - Synced both counters (`pushPending` + `pullAndApply`) with `ECONNRESET` network failures injected on every 3rd HTTP request (`> 10` network failures retried).
     - Verified in all 20 runs: all 40 sales accepted, 20 `negative_stock` rows created in `stock_alerts` on the server, Counter 1 SQLite, Counter 2 SQLite, and Server Postgres all converged to `-6` on every batch, zero echo outbox events created, and `reconcileLedger` reconciled sales and inventory to `0` paisa difference.
  3. **Test `4.3` (Edge cases: unknown vs cross-tenant references, closed-period sync rejection, revoked device `auth_error`, offline limit > 72h, and customer pull gap):**
     - Verified `UNKNOWN_PRODUCT` returns `retry_later` (stays `pending`, `attempts = 1`).
     - Verified `CROSS_TENANT_REFERENCE` and closed-period `LEDGER_POSTING_FAILED` return `rejected` and move to `sync_exceptions` (`status = 'open'`).
     - Verified revoked device (`HTTP 401`) transitions `SyncWorker` to `auth_error` while preserving all pending outbox events (`pendingCount = 1`).
     - Verified `computeOfflineLevel` at 96h (> 72h limit) returns `level = 'exceeded'` while offline sales remain unblocked per `docs/SYNC_CLIENT.md:38`.
     - Reproduced `F-H-07` (`Unknown entity type "customer" encountered; skipping row` in `pullAndApply.ts:421`).

### 4.3 Stage 4 Findings Summary
- **`F-H-07` (High):** Desktop POS (`apps/desktop`) is missing local SQLite tables, IPC handlers, outbox emitters, and pull handlers for Phase 8/9/10 features:
  1. `pullAndApply.ts:192-427` has no `case 'customer':`, skipping all `customer` changes from `/sync/pull`.
  2. `apps/desktop/src/main/db.ts` has no `customers`, `stock_transfers`, `prescriptions`, or `attendance` tables; `payments.method` (`db.ts:455`) and `finalizeSale.ts:554` reject `'credit'` sales; and desktop never emits `customer.created`, `customer_receipt.created`, `stock_transfer.dispatched`, or `stock_transfer.received`.
- **`F-M-07` (Medium):** Desktop master-data mutations (`createProduct`/`updateProduct`/`importCsv` in `products.ts:216,261,336`, `createSupplier`/`updateSupplier` in `purchasing.ts:82,117`, `createStaffMember`/`updateStaffMember` in `auth.ts:471,523`) do not write `outbox` events, and `pullAndApply.ts:524` applies `change_log` rows strictly in `seq` order without topological FK ordering (`branches`/`tax_categories`/`products` before `batches`/`stock_movements`), which rolls back the entire pull page if a child entity precedes a missing parent entity.

### Remaining Stages
- Stage 5: Security, tenancy, permissions, sensitive data and secrets
- Stage 6: Desktop, packaging, backup/restore and operations
- Stage 7: Web app and UX quality
- Stage 8: Test quality (mutation sanity in temporary clone)
- Stage 9 & Final Report (`docs/AUDIT_FINAL.md`)


---

## Stage 5: Security, Tenancy, Permissions, Sensitive Data and Secrets — COMPLETED

### 5.1 Complete Server Route Table (182 Routes Audited)
Every Fastify route across all 27 route modules in `apps/server/src/routes/` was inspected line-by-line for:
1. Authentication (`requireUserAuth` / `requireDeviceAuth` / `requireEitherAuth`)
2. Permission Guard (`requirePermission('<permission>')`)
3. `pharmacy_id` Tenant Scoping on every query, join, subquery, update, and delete
4. IDOR Protection on `:id` and body foreign-key references
5. Input Schema Validation (body, query, params)
6. Presence in `tests/audit-regression/tenant-isolation.test.ts` (which passes `286/286` assertions across 181 route entries; only `GET /health` is public and omitted).

| Route Module | Route Count | Auth & Permission Guard | Tenant Scoping (`pharmacy_id`) & IDOR | Input Validation & Bugs Found | In `tenant-isolation.test.ts`? |
|---|---:|---|---|---|---|
| `app.ts` (`/health`) | 1 | Public (`none`) | N/A | PASS | N/A (health check) |
| `auth.ts` (`/api/auth/*`) | 4 | `/login`, `/refresh` public; `/logout`, `/me` `requireUserAuth` + `auth.me.view` | Scoped to `pharmacyCode` / JWT `pharmacyId` | **FAIL (`F-H-09`):** `revokedUserTokenJtis` (`jwt.ts:5`) is an in-memory `Map` wiped on restart; `/logout` (`auth.ts:322`) does not revoke the refresh token; `trustProxy: true` (`app.ts:78`) allows `X-Forwarded-For` spoofing on `/login` rate limit (`auth.ts:34`). | Yes (`4/4`) |
| `devices.ts` (`/api/devices/*`) | 1 | Public (one-time registration code) | Code lookup scoped & single-use (`devices.ts:75-160`) | **FAIL (`F-H-09`):** `trustProxy: true` allows `X-Forwarded-For` spoofing on `/register` rate limit (`devices.ts:36`); `DEVICE_JWT_SECRET` falls back to `JWT_SECRET` (`jwt.ts:81`). | Yes (`1/1`) |
| `sync.ts` (`/api/sync/*`) | 4 | `requireDeviceAuth` (`push`, `pull`) / `requireEitherAuth` (`status`) / `requireUserAuth` (`exceptions`) | All queries & appliers scoped to `pharmacyId`; `pull` filters `branch_id IS NULL OR branch_id = device.branchId` (`sync.ts:169-175`) | PASS | Yes (`4/4`) |
| `admin.ts` (`/api/admin/*`) | 18 | `requireUserAuth` + `requirePermission` (`admin.users.manage`, `settings.branches.*`, `settings.devices.*`, `admin.audit_log.view`, `sync.exceptions.*`) | All queries scoped to `pharmacyId`; self-demotion and last-owner protection enforced (`admin.ts:163-205`) | PASS | Yes (`18/18`) |
| `dashboard.ts` (`/api/dashboard/*`) | 1 | `requireUserAuth` + `reports.view` | All KPIs scoped to `pharmacyId` | PASS | Yes (`1/1`) |
| `reports.ts` (`/api/reports/*`) | 4 | `requireUserAuth` + `reports.sales.view`, `reports.stock.view`, `reports.profit.view`, `reports.supplier_ledger.view` | All report queries & joins scoped to `pharmacyId` | **Note (Stage 7):** `stock-and-expiry` and `profit-per-batch` lack `LIMIT`/pagination. | Yes (`4/4`) |
| `finance.ts` (`/api/finance/*`) | 18 | `requireUserAuth` + `finance.coa.*`, `finance.journal.*`, `finance.reports.view`, `finance.period_close.*` | All COA, journal, reconciliation, and period-close queries scoped to `pharmacyId` | **FAIL (`F-C-02`, `F-M-08`):** `reverseJournalEntry` (`service.ts:436`) marks reversing entry `'reversed'` while leaving original `'posted'`; `executeYearEndClosing` (`period-close.ts:358`) uses random `sourceId`, doubling Retained Earnings if called twice; `POST /api/finance/journals` (`finance.ts:256-262`) returns fake `201 { ok: true }` when `lines` is omitted. | Yes (`18/18`) |
| `payments.ts` (`/api/finance/*`) | 14 | `requireUserAuth` + `finance.payment.*`, `finance.ar.view`, `finance.ap.view`, `inventory.supplier.*`, `sales.customer.*` | All queries and FK references (`supplierId`, `customerId`, `bankAccountId`, `allocations`) verified against `pharmacyId` | **FAIL (`F-C-03`, `F-M-08`):** `POST /api/finance/customers` (`payments.ts:1017-1033`) does not post opening balance journal entry; `:id` params on `lines 415, 737, 788, 873` not UUID-validated (500 on malformed UUID). | Yes (`14/14`) |
| `expenses.ts` (`/api/finance/*`) | 10 | `requireUserAuth` + `finance.expense.*` | All expense, category, and recurring template queries scoped to `pharmacyId` | **FAIL (`F-C-03`, `F-M-08`):** `postExpenseCompleted` (`posting-engine.ts:1050`) posts credit expenses to `2000 AP` with `partyId: undefined`; `:id` params (`lines 369, 600, 689`) not UUID-validated. | Yes (`10/10`) |
| `ar.ts` (`/api/finance/ar/*`) | 4 | `requireUserAuth` + `finance.ar.view` | Scoped to `pharmacyId` | **FAIL (`F-C-02`):** Filters `journalEntries.status != 'reversed'` (`ar.ts:129, 203, 268, 563, 591`), which includes reversed entries and excludes their reversals. | Yes (`4/4`) |
| `ap.ts` (`/api/finance/ap/*`) | 4 | `requireUserAuth` + `finance.ap.view` | Scoped to `pharmacyId` | **FAIL (`F-C-02`):** Filters `journalEntries.status != 'reversed'` (`ap.ts:127, 200, 265, 562, 590`). | Yes (`4/4`) |
| `cash-bank.ts` (`/api/finance/*`) | 9 | `requireUserAuth` + `finance.cash_bank.*` | All bank accounts, transfers, reconciliations, and shifts scoped to `pharmacyId` | **FAIL (`F-M-08`):** Calls `Schema.parse(request.body)` without `try/catch` (`cash-bank.ts:152, 260, 375, 510, 648, 805`), returning HTTP `500` on invalid client input; `:id` params (`lines 374, 647, 716`) not UUID-validated. | Yes (`9/9`) |
| `sales-ledger.ts` (`/api/finance/sales-ledger/*`) | 2 | `requireUserAuth` + `finance.sales_ledger.view` | Scoped to `pharmacyId` | **FAIL (`F-H-08`):** `sales-ledger.ts:121` filters `eq(invoices.status, 'completed')`, whereas all POS invoices have `status = 'finalized'`, so the Sales Ledger always shows 0 sales! | Yes (`2/2`) |
| `financial-reports.ts` (`/api/finance/reports/*`) | 6 | `requireUserAuth` + `finance.reports.view` | All 6 report endpoints scoped to `pharmacyId` | PASS | Yes (`6/6`) |
| `budgets.ts` (`/api/finance/budgets/*`) | 6 | `requireUserAuth` + `finance.budget.*` | All budget queries scoped to `pharmacyId` | **FAIL (`F-M-05`):** Float division/rounding on money in `budget-service.ts:514`. | Yes (`6/6`) |
| `suppliers.ts` (`/api/suppliers/*`) | 5 | `requireUserAuth` + `inventory.supplier.*` | All supplier queries scoped to `pharmacyId` | **FAIL (`F-C-02`, `F-H-02`, `F-H-08`, `F-M-08`):** Filters `journalEntries.status != 'reversed'` (`lines 132, 498, 673, 705`); filters `sourceType === 'purchase'` instead of `'purchase.received'` (`lines 162, 701`); `PATCH /api/suppliers/:id` (`lines 764-808`) not in transaction; `:id` params (`lines 632, 737`) not UUID-validated. | Yes (`5/5`) |
| `purchase-orders.ts` (`/api/purchase-orders/*`) | 9 | `requireUserAuth` + `inventory.purchase_order.*`, `inventory.grn.create` | Scoped to `pharmacyId`; verifies supplier, branch, product, taxCategory ownership | **FAIL (`F-H-06`, `F-M-08`):** `POST /api/purchase-orders/:id/receive` (`lines 768-794`) never writes to `change_log`; `:id` params (`lines 374, 464, 518, 562, 606`) not UUID-validated. | Yes (`9/9`) |
| `stock-transfers.ts` (`/api/stock-transfers/*`) | 7 | `requireUserAuth` + `inventory.transfer.*` | Scoped to `pharmacyId`; verifies source/destination branches and batches | **FAIL (`F-H-05`, `F-H-06`):** `dispatch` does not check available stock or `<= quantityRequested`; `receive` does not check `received + shortage === dispatched` and leaves dangling `shortageMovementId`; `cancel` skips `change_log`; intra-branch shortage skips ledger entry. | Yes (`7/7`) |
| `stock-locations.ts` (`/api/stock-locations/*`) | 3 | `requireUserAuth` + `inventory.warehouse.*` | Scoped to `pharmacyId` | **FAIL (`F-H-02`):** `POST` and `PATCH` (`lines 115-149, 191-222`) write table + `change_log` outside a transaction. | Yes (`3/3`) |
| `stock-counts.ts` (`/api/stock-counts/*`) | 6 | `requireUserAuth` + `inventory.count.*` | Scoped to `pharmacyId`; verifies branch, location, product, batch ownership | **FAIL (`F-M-08`):** `:id` params (`lines 251, 310, 398, 444, 587`) not UUID-validated. | Yes (`6/6`) |
| `supplier-returns.ts` (`/api/supplier-returns/*`) | 6 | `requireUserAuth` + `inventory.supplier_return.*` | Scoped to `pharmacyId`; verifies supplier, branch, batch ownership | **FAIL (`F-M-08`):** `:id` param (`line 350`) not UUID-validated. | Yes (`6/6`) |
| `stock.ts` (`/api/inventory/*`) | 10 | `requireUserAuth` + `inventory.stock.*`, `inventory.batch.*`, `inventory.product.view` | Scoped to `pharmacyId` | **FAIL (`F-H-06`, `F-M-08`):** Batch `write-off` (`line 649`) and `discount` (`line 765`) do not write to `change_log`; `:id` params (`lines 621, 678, 828`) not UUID-validated. | Yes (`10/10`) |
| `customers.ts` (`/api/customers/*`) | 7 | `requireUserAuth` + `sales.customer.*` | Scoped to `pharmacyId` | **FAIL (`F-C-03`, `F-H-02`, `F-M-08`):** `GET /api/customers` (`line 107`) uses `balanceMap.get(c.id) ?? c.openingBalancePaisa`, dropping unposted opening balances once any AR line exists; `POST` & `PUT` (`lines 182-255, 399-438`) not transactional; `:id` params (`lines 283, 344, 459, 501, 620`) not UUID-validated. | Yes (`7/7`) |
| `prescriptions.ts` (`/api/prescriptions/*`) | 6 | `requireUserAuth` + `sales.prescription.*`, `inventory.product.view` | Scoped to `pharmacyId` | **FAIL (`F-H-02`, `F-M-08`):** `POST`, `PUT`, `dispense` (`lines 359-433, 599-646, 720-742`) not transactional; `POST /api/prescriptions/:id/dispense` (`lines 710-731`) does not check `status === 'cancelled' | 'fulfilled'` or `repeatsUsed >= repeatCount`; `:id` params (`lines 459, 570, 667, 763`) not UUID-validated. | Yes (`6/6`) |
| `hr-leave.ts` (`/api/hr/*`) | 9 | `requireUserAuth` + `hr.leave.*`, `hr.attendance.*` | Scoped to `pharmacyId` | **FAIL (`F-H-02`, `F-M-08`):** `carry-over`, `requests`, `approve`, `reject` (`lines 340-403, 613-638, 696-762, 827-845`) not transactional; `:id` params (`lines 651, 775`) not UUID-validated. | Yes (`9/9`) |
| `payroll.ts` (`/api/hr/*`) | 14 | `requireUserAuth` + `hr.employee.*`, `hr.advance.*`, `hr.payroll.*` | Scoped to `pharmacyId` | **FAIL (`F-H-02`, `F-H-03`):** `payroll-posting.ts` bypasses `postJournalEntry`, lacks advisory lock on `entry_no`, slices UTC date, fails without open fiscal period, omits `partyId` on `2300`; `POST /api/hr/advances` (`lines 242-310`) posts no journal entry; `runs/generate` and `items/:id` (`lines 644-671, 750-795`) not transactional. | Yes (`14/14`) |
| `notifications.ts` (`/api/notifications/*`) | 3 | `requireUserAuth` + `auth.me.view` | Scoped to `pharmacyId` and `userId` (`or(isNull(userId), eq(userId, user.sub))`) | PASS | Yes (`3/3`) |
| `search.ts` (`/api/search`) | 1 | `requireUserAuth` + `auth.me.view` | Scoped to `pharmacyId` AND gates each entity domain by caller permission (`search.ts:39-174`) | **FAIL (`F-M-05`):** Uses `.toFixed(2)` on money in `search.ts:65, 128`. | Yes (`1/1`) |

### 5.2 Sensitive Data, Electron Security & Secrets Verification
- **Secrets in Repo & Git History (`git log --all --full-history` & `git grep`):**
  - **PASS:** Zero real `.env` files, private keys, API tokens, or production credentials exist in the working tree or git commit history. Only `.env.example` / `apps/server/.env.example` with local development placeholder `postgresql://pos:pos_dev_secret@localhost:5432/pos_server` exist.
  - **Startup Secret Enforcement (`apps/server/src/auth/jwt.ts:62-75`, `apps/server/src/db/index.ts:15-31`):** Server refuses to start when `NODE_ENV !== 'test'` unless `DATABASE_URL` and `JWT_SECRET` (`>= 32` chars, not equal to default placeholders) are set. However, `getDeviceJwtSecret()` (`jwt.ts:81`) falls back to `JWT_SECRET` when `DEVICE_JWT_SECRET` is unset (`F-H-09`).
- **Electron BrowserWindow & Receipt Printing (`apps/desktop/src/main/index.ts:526-535`, `printService.ts:30-42`, `receiptGenerator.ts:113, 151, 387`):**
  - Main window sets `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
  - **Minor XSS in Receipt Generator (`F-M-08`):** `generateThermalReceiptHtml` (`apps/desktop/src/renderer/utils/receiptGenerator.ts:113, 151, 387`) interpolates `line.batchNo`, `line.expiryDate`, `invoice.invoiceNumber`, and `invoice.fiscalInvoiceNumber` without `escapeHtml(...)` into the HTML passed to `printWin.loadURL('data:text/html;...')`.
- **SQLite Encryption at Rest (`apps/desktop/src/main/db.ts`, `backup.ts`):**
  - Counter SQLite database (`pos_counter.db`) and `.sqlite` backups are stored unencrypted in the OS user data folder (`app.getPath('userData')`), relying on Windows OS account/BitLocker protection; sync device tokens are encrypted via Electron `safeStorage` (`tokenStore.ts`).

### 5.3 Stage 5 Findings Summary
- **`F-H-08` (High):** Broken status/sourceType filters in Sales Ledger and Supplier Purchase History:
  1. `GET /api/finance/sales-ledger` (`apps/server/src/routes/sales-ledger.ts:121`) filters `eq(invoices.status, 'completed')`, whereas all POS invoices have `status = 'finalized'`, causing the Sales Ledger to return 0 sales.
  2. `GET /api/suppliers` (`apps/server/src/routes/suppliers.ts:162`) and `GET /api/suppliers/:id` (`suppliers.ts:701`) filter `journalEntries.sourceType === 'purchase'`, whereas `postPurchaseReceived` (`posting-engine.ts:154`) posts `sourceType = 'purchase.received'`, causing supplier purchase counts and purchase tabs to exclude all synced GRNs.
- **`F-H-09` (High):** Server Auth, Proxy & Token Security Weaknesses:
  1. `apps/server/src/app.ts:78` sets `trustProxy: true` unconditionally, allowing any client to spoof `X-Forwarded-For` to bypass login and device-registration rate limits (`auth.ts:34`, `devices.ts:36`) and spoof `X-Forwarded-Proto: https` to bypass `ENFORCE_HTTPS` (`app.ts:97`).
  2. `apps/server/src/auth/jwt.ts:5` stores revoked user token JTIs in an in-memory `Map` wiped on restart, and `POST /api/auth/logout` (`auth.ts:322`) does not revoke the refresh token.
  3. `apps/server/src/auth/jwt.ts:81` falls back `DEVICE_JWT_SECRET` to `JWT_SECRET` when `DEVICE_JWT_SECRET` is unset.
  4. `apps/web/src/context/AuthContext.tsx:25, 68` stores the bearer JWT in `localStorage` (`pos_auth_token`) rather than an `HttpOnly; Secure; SameSite` cookie (`docs/RULES.md` Rule 6).
- **`F-M-08` (Medium):** Route Input Validation, Unhandled Zod `.parse()` 500s, Prescription Dispense Bypass, and Unescaped Receipt Batch HTML:
  1. `apps/server/src/routes/cash-bank.ts:152, 260, 375, 510, 648, 805` calls `Schema.parse(request.body)` without `try/catch`, returning HTTP `500` instead of `400` on invalid payloads.
  2. Over 20 `:id` route handlers do not validate `:id` as a UUID before querying PostgreSQL `uuid` columns, causing malformed UUIDs to throw PostgreSQL `22P02` (`500 Internal Server Error`).
  3. `POST /api/prescriptions/:id/dispense` (`apps/server/src/routes/prescriptions.ts:710-731`) does not check `status === 'cancelled' | 'fulfilled'` or `repeatsUsed >= repeatCount`, allowing unlimited dispensing of fulfilled or cancelled prescriptions.
  4. `POST /api/finance/journals` (`apps/server/src/routes/finance.ts:256-262`) contains test-accommodation dead code returning `201 { ok: true }` without DB writes when `lines` is omitted.
  5. `apps/desktop/src/renderer/utils/receiptGenerator.ts:113, 151, 387` interpolates `line.batchNo`, `line.expiryDate`, and `invoice.invoiceNumber` without `escapeHtml()`.

### Remaining Stages
- Stage 6: Desktop, packaging, backup/restore and operations
- Stage 7: Web app and UX quality
- Stage 8: Test quality (mutation sanity in temporary clone)
- Stage 9 & Final Report (`docs/AUDIT_FINAL.md`)


---

## Stage 6: Desktop, Packaging, Backup/Restore and Operations — COMPLETED

### 6.1 Backup & Restore End-to-End Verification (`tests/audit-final/stage6-backup-restore.test.ts`)
- **Command & Output:** `pnpm vitest run tests/audit-final/stage6-backup-restore.test.ts` -> **2 passed (2), exit code 0 (2.35s)**.
- **Verified Behaviors:**
  1. Populated a fresh on-disk WAL counter SQLite database with products, batches, GRN (`receiveGrn`), shift open (`openShift`), 3 finalized sales (`finalizeSale` -> `C1-000001`..`C1-000003`), a customer return (`processReturn` -> `CN-C1-000001`), a stock adjustment (`adjustStock`), and shift close (`closeShift`).
  2. Triggered `createDatabaseBackup` (`apps/desktop/src/main/backup.ts:94`) while a concurrent sale (`finalizeSale`) was executing, using `better-sqlite3`'s native online `db.backup(destPath)` API (`line 112`).
  3. Restored the backup into a brand-new user-data directory (`restoreDatabaseBackup`, `backup.ts:195`), verifying:
     - Pre-restore safety snapshot (`pre-restore-safety-*.db`) created automatically (`line 249`).
     - `PRAGMA integrity_check === 'ok'`.
     - Restored row counts (`invoices >= 3`, `credit_notes === 1`, `outbox >= 7`).
     - Next local sale continues `last_invoice_seq` (`C1-000004` / `C1-000005`) without local collision.
     - 14-backup rolling retention (`enforceBackupRetention(dir, 14)`, `backup.ts:62`) deletes the 2 oldest backups when 16 exist.
  4. Verified non-owner restore rejection (`userRole !== 'owner'` throws `Unauthorized: Database restore is strictly restricted to the Owner role`) and corrupted backup file rejection (`PRAGMA integrity_check` failure throws and leaves active DB untouched).
- **Bugs Reproduced in `stage6-backup-restore.test.ts` (`F-M-09`):**
  1. **No Schema Version Check Before Restore (`backup.ts:231-243`):** `restoreDatabaseBackup` only checks `PRAGMA integrity_check === 'ok'` on `tempDb` and never checks `schema_migrations` or `app_meta.schema_version` against `MIGRATIONS`. In `test 6.2`, a backup with `schema_version = 999` is restored without rejection (`getDbMetadata().schemaVersion === 999`).
  2. **Post-Restore Server Sequence & Device Cloning Collision (`backup.ts:112`, `invoice.ts:374`, `service.ts:23`):**
     - `createDatabaseBackup` copies `sync_state` (`device_id`, `token_encrypted`, `pull_cursor`) and `outbox` (`device_seq`) verbatim into the backup file. If a backup is restored on a second machine alongside the original counter, both machines share the same `device_id` and JWT.
     - Worse, if a counter takes a backup at `last_invoice_seq = 1`, creates and pushes Sale #2 (`C1-000002`) to the server, and later restores the backup from `seq = 1`: because `applyInvoiceCreated` (`apps/server/src/sync/appliers/invoice.ts:374-380`) updates `counters.lastInvoiceSeq` on the server **without writing a `counter` row to `change_log`**, and `restoreDatabaseBackup` does not force a counter sequence sync before allowing sales, the restored counter's next sale generates a new invoice UUID with `invoiceNumber = 'C1-000002'`. When pushed to the server, `invoices` hits unique constraint `uq_invoices_pharmacy_number` (`23505`), which `apps/server/src/sync/service.ts:23, 197` classifies as permanent **`status: 'rejected', code: 'INTERNAL_ERROR'`**!

### 6.2 Packaging, Native Addons, Updater & Diagnostics Verification
- **Packaged Unpacked Build (`apps/desktop/dist-release/win-unpacked`):**
  - Built in Stage 1 via `pnpm --filter @pos/desktop package:dir` (`exit code 0`).
  - Contains `HexaPharm.exe`, `resources/app.asar`, and `resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node`, matching `resolveNativeBinding()` in `apps/desktop/src/main/db.ts:868-880`.
  - **CRITICAL Startup Bug in Packaged Build (`F-C-01`):** `apps/desktop/src/main/index.ts:597` unconditionally runs `seedDatabase()` inside `app.whenReady()`, seeding 200 demo products and 5 fake suppliers into production counter databases whenever `products < 200`.
- **Auto-Updater & Code Signing (`apps/desktop/src/main/updater.ts:46`, `apps/desktop/package.json:54-65`):**
  - `autoUpdater.autoDownload = false` (`updater.ts:40`), default feed URL is placeholder `https://updates.pos-pharmacy.local/releases/win/`, and `package.json` has no Windows code-signing certificate (`cscLink` / `publisherName`) configured yet.
- **Diagnostics Bundle & Log Rotation (`apps/desktop/src/main/logger.ts:51-320`):**
  - Rotates `pos-counter.log` at `5 MB` (`MAX_FILE_SIZE`) up to 5 files (`MAX_ROTATED_FILES = 5`).
  - `exportDiagnosticsZip` (`logger.ts:260`) bundles `diagnostics.json` + log files scrubbed via `sanitizeLogLine` (`lines 164-172`, redacting phone numbers, `customerName`, `doctorName`, `notes`) and excludes raw database files and tokens.
- **Items Marked `NOT VERIFIED` (Hardware / Clean VM):**
  - Installing the NSIS `.exe` installer inside a separate clean Windows 10/11 VM without dev tools.
  - Physical USB/serial 80mm/58mm thermal printer hardware output and physical USB HID barcode scanner hardware scan (verified via software harnesses in `receipt-and-invoices.test.ts` and `barcodeScanner.ts`).

### Remaining Stages
- Stage 7: Web app and UX quality
- Stage 8: Test quality (mutation sanity in temporary clone)
- Stage 9 & Final Report (`docs/AUDIT_FINAL.md`)


---

## Stage 7: Web App and UX Quality — COMPLETED

### 7.1 Role Filtering, 401/403 Handling & Navigation Verification
- **Navigation & View Guarding (`apps/web/src/layout/DashboardLayout.tsx:75-108`, `apps/web/src/App.tsx:60-68`):**
  - All 32 sidebar `NavItem` entries are mapped in `NAV_PERMISSIONS` (`DashboardLayout.tsx:75-108`), hidden from the sidebar when `!can(item.permission)`, and guarded in `App.tsx:60-68` with `<ForbiddenPage requiredPermission={requiredPermission} />`.
  - `apiFetch` (`apps/web/src/lib/api.ts:44-48`) clears `localStorage` and dispatches `auth:unauthorized` on HTTP `401`, returning the user to `<LoginPage />`.
- **CommandPalette (`Ctrl+K`) & NotificationBell Broken Deep-Links (`F-M-10`):**
  1. `GET /api/search` (`apps/server/src/routes/search.ts:67`) returns `link: '/sales-ledger?invoiceId=...'` for invoice results, whereas the `NavItem` in `DashboardLayout.tsx:62` and `App.tsx:111` is `'finance-sales-ledger'`. Clicking any invoice result in `CommandPalette` sets `currentTab = 'sales-ledger'`, which falls through `App.tsx:135` `default:` to `<OverviewPage />`.
  2. `handleNavigate` (`DashboardLayout.tsx:148-152`) strips `?customerId=...`, `?productId=...`, and `?supplierId=...` query parameters (`link.replace(/^\//, '').split('?')[0]`) without updating `window.location` or passing the entity ID to the page, so clicking a search result only switches the tab without opening the selected item.
  3. `refreshSystemNotifications` (`apps/server/src/services/notification-service.ts:115-246`) runs on every `GET /api/notifications` poll (`NotificationBell.tsx:28`) and:
     - Queries `batches` (`lines 115-125`) without checking if `SUM(stock_movements.quantity_signed) > 0`, generating "Expiring Batch" alerts for batches with `0` stock.
     - Inserts `'sync_exceptions'` (`link: '/admin-devices'`) and `'period_close'` (`link: '/finance-period-close'`) notifications for all users regardless of role permissions, sending cashiers/pharmacists to `<ForbiddenPage />` when clicked.

### 7.2 Pagination, Unbounded Queries & N+1 Query Audit (`F-M-10`)
- **Unbounded List & Report Queries (No `LIMIT` / Pagination):**
  - `GET /api/customers` (`apps/server/src/routes/customers.ts:75-115`)
  - `GET /api/finance/customers` (`apps/server/src/routes/payments.ts:993-1010`)
  - `GET /api/purchase-orders` (`apps/server/src/routes/purchase-orders.ts:276-368`)
  - `GET /api/stock-transfers` (`apps/server/src/routes/stock-transfers.ts:154-230`)
  - `GET /api/stock-counts` (`apps/server/src/routes/stock-counts.ts:127-180`)
  - `GET /api/supplier-returns` (`apps/server/src/routes/supplier-returns.ts:166-245`)
  - `GET /api/prescriptions` (`apps/server/src/routes/prescriptions.ts:183-315`)
  - `GET /api/hr/employees` (`apps/server/src/routes/payroll.ts:87-105`)
  - `GET /api/finance/sales-ledger` (`apps/server/src/routes/sales-ledger.ts:116-248`)
  - `GET /api/reports/stock-and-expiry` & `GET /api/reports/profit-per-batch` (`apps/server/src/routes/reports.ts:155-360`)
- **N+1 Queries on Hot Routes:**
  - `GET /api/finance/unpaid-documents` (`apps/server/src/routes/payments.ts:105-136, 163-194, 217-253`) executes a separate `SELECT ... FROM payment_allocations INNER JOIN erp_payments` inside a `for` loop for every invoice, PO, and AP journal line.
  - `GET /api/hr/leave/allocations` (`apps/server/src/routes/hr-leave.ts:230-266`) executes `SELECT` (and `INSERT` if missing) inside a nested `for (const emp of emps) for (const lt of allTypes)` loop (`E * T` queries per request).

### 7.3 Forms, Reversal vs Delete, Offline Fonts & RTL Verification
- **Double-Submit Protection & Reversal UI:**
  - Web forms (`JournalEntriesPage.tsx:70,81`, `PaymentsPage.tsx:98,104,108`, `ExpensesPage.tsx`, `PayrollPage.tsx`, `PeriodClosePage.tsx`) track `*Submitting` state and disable submit buttons during in-flight requests.
  - Posted accounting records (`JournalEntriesPage.tsx`, `PaymentsPage.tsx`, `ExpensesPage.tsx`, `SupplierReturnsPage.tsx`) expose **Reverse** modals (with required reason) and never expose edit/delete actions on posted entries.
- **Bundled Fonts & Offline Asset Independence:**
  - **PASS:** Inspected `apps/web/index.html`, `apps/desktop/index.html`, and grepped all source files for `googleapis`, `gstatic`, `cdnjs`, `unpkg`, `jsdelivr` -> **0 external CDN references**. `@fontsource/noto-nastaliq-urdu` and `lucide-react` are bundled locally.
- **Urdu & RTL Layout:**
  - **Desktop (`apps/desktop/src/renderer/utils/i18n/I18nContext.tsx:46`, `index.css:403-425`, `receiptGenerator.ts:148, 491`):** Supports English (`en`) and Urdu (`ur`) with `dir="rtl"`, local `Noto Nastaliq Urdu` font, and explicit `direction: ltr` overrides on numeric inputs, barcode fields, and `.tabular-nums` money columns.
  - **Web (`apps/web`):** English LTR only (acceptable per `docs/ERP_SPEC.md:4` as back-office web app).

### Remaining Stages
- Stage 8: Test quality (mutation sanity in temporary clone)
- Stage 9 & Final Report (`docs/AUDIT_FINAL.md`)

---

## Stage 8: Test Quality (Mutation Sanity in Temporary Clone) — COMPLETED

All 12 mutation experiments were executed in the isolated temporary clone (`$env:TEMP\pos-final-audit-clone`, never in `d:\POS`), reverted after each run, and the temporary clone was removed (`Temp clone removed: True`).

### 8.1 Mutation Sanity Results Table
| Mutation ID | Target File & Line | Injected Mutation | Target Test Suite(s) | Result (`KILLED` / `SURVIVED`) | Vitest Output & Analysis |
|---|---|---|---|---|---|
| **`M-01`** | `apps/server/src/reports/queries.ts:271,298,302` (`getSalesReport`) | Replaced `params.pharmacyId` with `invoices.pharmacyId` (removing tenant isolation filter from `getSalesReport`) | `tests/audit-regression/tenant-isolation.test.ts` & `apps/server/src/reports/reports.test.ts` | **`SURVIVED` (`exit=0`)** | `tenant-isolation.test.ts` (`22 passed (22)`) only tests `?branchId=<foreign>` and `?cashierUserId=<foreign>` (which return 404 before calling `getSalesReport`) and never calls `GET /api/reports/sales` without params to assert Tenant B's invoices are excluded. `reports.test.ts` (`16 passed (16)`) only seeds 1 pharmacy. |
| **`M-02`** | `apps/server/src/ledger/posting-engine.ts:189` (`postPurchaseReceived`) | Changed `debitPaisa: inventoryCostPaisa` to `debitPaisa: 0` on `1200 Inventory` | `apps/server/src/ledger/posting-engine.test.ts` | **`KILLED` (`exit=1`)** | `3 failed | 6 passed (9)` — immediately caught by unbalanced journal assertion and inventory balance check. |
| **`M-03`** | `packages/shared/src/money.ts:91` (`roundHalfUp`) | Changed `Math.floor(denominator / 2)` to `Math.floor((denominator - 1) / 2)` (breaking half-up tie-breaking) | `packages/shared/src/money.test.ts` | **`KILLED` (`exit=1`)** | `1 failed | 26 passed (27)` — caught by exact `.5` boundary test in `money.test.ts`. |
| **`M-04`** | `packages/shared/src/fefo.ts:86` (`allocateFefo`) | Inverted `expiryDate` sort (`if (a.expiryDate < b.expiryDate) return 1`) | `packages/shared/src/fefo.test.ts` | **`KILLED` (`exit=1`)** | `4 failed | 14 passed (18)` — caught by FEFO earliest-expiry allocation assertions. |
| **`M-05`** | `apps/server/src/ledger/service.ts:246` (`postJournalEntry`) | Disabled application-level closed-period check (`if (false && closedPeriods.length > 0)`) | `apps/server/src/ledger/ledger.test.ts` | **`SURVIVED` app layer / `KILLED` by DB trigger (`exit=0`)** | `13 passed (13)` — PostgreSQL trigger `trg_prevent_posting_into_closed_period` still threw `Cannot post or modify journal entry on ...: falls within closed fiscal period`, satisfying `.rejects.toThrow(/closed/i)`. Demonstrates DB defense-in-depth, though test does not distinguish service error vs DB trigger error. |
| **`M-06`** | `apps/server/src/auth/user-auth.ts:93` (`requirePermission`) | Disabled permission check (`if (false && !hasPermission(role, permission))`) | `apps/server/src/auth/permission-guard.test.ts` | **`KILLED` (`exit=1`)** | `4 failed | 3 passed (7)` — caught by RBAC 403 tests. |
| **`M-07`** | `apps/server/src/sync/service.ts:80` (`processPushBatch`) | Disabled `processed_events` idempotency guard (`if (false && inserted.length === 0)`) | `apps/server/src/sync/sync-push.test.ts` | **`KILLED` (`exit=1`)** | `1 failed | 9 passed (10)` — duplicate replay test failed. |
| **`M-08`** | `apps/server/src/routes/auth.ts:176` (`POST /api/auth/login`) | Changed lockout threshold from `if (newAttempts >= 5)` to `if (newAttempts >= 999)` | `tests/audit-regression/stage2-server-security.test.ts` | **`KILLED` (`exit=1`)** | `1 failed | 10 passed (11)` — caught by 5-attempt lockout test (`audit-fixes.test.ts` did not test lockout, but `stage2-server-security.test.ts` killed it). |
| **`M-09`** | `apps/server/src/routes/payments.ts:33` (`CreatePaymentBodySchema`) | Removed `.min(1)` on `amountPaisa` (`z.number().int()`) | `apps/server/src/routes/payments.test.ts` | **`SURVIVED` (`exit=0`)** | `7 passed (7)` — `payments.test.ts` only tests happy-path positive payments and never tests `0` or negative `amountPaisa` rejection. |
| **`M-10`** | `packages/shared/src/schema/payroll.ts:119` (`calculateMonthlyIncomeTaxPaisa`) | Changed `taxFromExcess` to `0` | `packages/shared/src/schema/payroll.test.ts` | **`KILLED` (`exit=1`)** | `1 failed | 5 passed (6)` — caught by progressive slab calculation test. |
| **`M-11`** | `apps/server/src/ledger/service.ts:148` (`postJournalEntry`) | Disabled `totalDebitPaisa !== totalCreditPaisa` check | `apps/server/src/ledger/ledger.test.ts` | **`KILLED` (`exit=1`)** | `1 failed | 12 passed (13)` — caught by unbalanced journal entry test. |
| **`M-12`** | `apps/server/src/routes/admin.ts:245` (`PATCH /api/admin/users/:id`) | Disabled owner self-demotion and last-owner protection (`if (false && existingUser.role === 'owner' ...)`) | `tests/audit-regression/stage2-server-security.test.ts` & `apps/server/src/auth/audit-fixes.test.ts` | **`SURVIVED` (`exit=0`)** | `11 passed (11)` and `10 passed (10)` — neither test suite actually sends a `PATCH /api/admin/users/:id` request attempting to demote or deactivate an owner! |

### 8.2 Summary of Test Suite Gaps Identified by Mutation Testing
- **8 of 12 mutations (`M-02`, `M-03`, `M-04`, `M-05` [via DB trigger], `M-06`, `M-07`, `M-08`, `M-10`, `M-11`) were killed**, and **3 mutations (`M-01`, `M-09`, `M-12`) survived completely**:
  1. `M-01` survived because `tenant-isolation.test.ts` does not assert that aggregate report endpoints (`GET /api/reports/sales`, `GET /api/reports/dashboard-summary`, etc.) exclude Tenant B's seeded rows when called without foreign query params, and `reports.test.ts` only seeds a single tenant.
  2. `M-09` survived because `payments.test.ts` lacks negative boundary tests (`amountPaisa <= 0`).
  3. `M-12` survived because no test in the repository exercises `PATCH /api/admin/users/:id` for owner self-demotion or last-owner deactivation (`admin.ts:245-272`).

---

## Stage 9: Regulatory Readiness (Pakistan FBR, DRAP & Labour/Payroll) — COMPLETED

### 9.1 FBR (Federal Board of Revenue — Pakistan Tax Readiness)
- **Configurable Tax Rates (Not Hardcoded):** **PASS** — Tax rates are stored in `tax_categories` (`rate_bp` in basis points + `is_exempt` flag, `apps/server/src/db/schema.ts:79-91`, `apps/desktop/src/main/db.ts:346-353`) and per-line `tax_rate_bp` is snapshotted onto `invoice_lines`, `purchase_lines`, `credit_note_lines`, and `purchase_order_lines`.
- **Fiscal Invoice Placeholders (`fiscal_status`, `fiscal_invoice_number`, `qr_payload`):** **PASS** — Stored on desktop `invoices` (`apps/desktop/src/main/db.ts:436-440`) and `fiscal_submissions` (`db.ts:465-475`), synced to server `invoices` (`apps/server/src/db/schema.ts:227-231`), hooked via `FiscalService` interface (`apps/desktop/src/main/finalizeSale.ts:77-85`), and rendered on thermal receipts when present (`apps/desktop/src/main/receipts.ts:382-391`).
- **Separate Input Tax vs Output Tax Ledger Posting:** **PASS** — Purchases debit `1300 Input Sales Tax Receivable` (`posting-engine.ts:198`), sales credit `2100 Output Sales Tax Payable` (`posting-engine.ts:344`), customer returns debit `2100 Output Sales Tax Payable` (`posting-engine.ts:456`), and supplier returns credit `1300 Input Sales Tax Receivable` (`posting-engine.ts:563`).
- **NTN / STRN Tax Fields:** **PARTIAL (`F-M-11`)** — `ntn` and `strn` columns exist on `suppliers` (`apps/server/src/db/schema.ts:750-751`) and `customers` (`schema.ts:1145-1146`), and `receipt_ntn` / `receipt_strn` settings exist in desktop `settings` for receipt headers (`receipts.ts:48, 305-310`), **but** the `pharmacies` table (`apps/server/src/db/schema.ts:18-27`) and `branches` table (`schema.ts:30-44`) on the server do not store the pharmacy's own `ntn` or `strn` for server-generated financial statements/tax reports.

### 9.2 DRAP (Drug Regulatory Authority of Pakistan Readiness)
- **Mandatory Batch Number & Expiry Date Tracking:** **PASS (on `finalizeSale` & `receiveGrn`), FAIL on legacy `invoices:create` (`F-M-11`)** — `batches` requires `batch_no` and `expiry_date` (`YYYY-MM-DD`), thermal receipts print `[Batch: X | Exp: YYYY-MM-DD]` per line (`apps/desktop/src/main/receipts.ts:112-114`), and `allocateFefo` (`packages/shared/src/fefo.ts:69`) strictly blocks selling expired batches (`batch.expiryDate >= today`). **However**, legacy IPC handler `invoices:create` (`apps/desktop/src/main/invoices.ts:97-115, 178-205`) bypasses `allocateFefo`, does not filter `expiry_date >= today`, falls back to 0-stock batches, and uses non-counter-scoped `INV-YYYYMMDD-XXXX` invoice numbers.
- **Controlled Drug (`is_controlled`) Enforcement & Register (`F-M-11`):**
  1. `products.is_controlled` (`apps/desktop/src/main/db.ts:366`, `apps/server/src/db/schema.ts:113`) and `prescriptions.is_controlled_substance` (`schema.ts:1221`) exist, and `GET /api/prescriptions/controlled-substances/log` (`apps/server/src/routes/prescriptions.ts:125-177`) provides a web controlled-substances dispense log.
  2. **Gap (`F-M-11`):** Desktop POS `finalizeSale` (`apps/desktop/src/main/finalizeSale.ts:445-469`) does **not** enforce capturing a prescription reference, patient name/CNIC, or doctor name/PMDC registration when selling a product with `is_controlled === 1`, nor does it prevent a cashier (without pharmacist approval) from selling a controlled drug over the counter.
- **Batch Recall Traceability (`F-M-11`):**
  - While `invoice_lines.batch_id` links every sale line to its exact `batches.id`, there is no dedicated batch recall endpoint or UI report that takes a recalled `batch_no` / `batch_id` and lists all affected invoices, customer names/phones, branches, and remaining shelf stock across branches for a DRAP recall notice.

### 9.3 Pakistani Labour & Payroll Readiness
- **Data-Driven Income Tax Slabs & Statutory Deductions (EOBI / SESSI):** **PASS** — `payroll_tax_slabs` (`apps/server/src/db/schema.ts:1544-1565`) stores fiscal-year income tax brackets (`minMonthlyIncomePaisa`, `maxMonthlyIncomePaisa`, `baseTaxPaisa`, `excessRatePercentage`), and `statutory_components` (`schema.ts:1572-1596`) stores configurable EOBI/SESSI/provident definitions (`fixed` or `percentage` of basic/gross salary) per pharmacy without hardcoded rates in code (`apps/server/src/routes/payroll.ts:352-490`).
- **Payslip Breakdown:** **PASS** — `payroll_items` (`schema.ts:1633-1665`) persists `basicSalaryPaisa`, `allowancesJson`, `grossSalaryPaisa`, `incomeTaxPaisa`, `statutoryDeductionsJson`, `advanceRecoveryPaisa`, `absentDeductionPaisa`, `otherDeductionsPaisa`, and `netPayablePaisa` per employee per run, rendered in `apps/web/src/pages/PayrollPage.tsx`.

---

## All 9 Audit Stages Complete — Ready for Final Report (`docs/AUDIT_FINAL.md`)
