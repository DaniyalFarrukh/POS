# HexaPharm POS & ERP — Final Independent Audit Report (Phases 0–12)

- **Audit Date:** `2026-11-11`
- **Audited Branch / Commit:** `audit-fixes` (`120fcf7258c0c19d70c72b870a1b1f82caaa5ee6`)
- **Compared Against:** `main` (`83cc398`) and First Audit Baseline (`737dd14`)
- **Audit Scope:** Full-system read-only code, database, test, security, accounting, sync, desktop packaging, web UX, and regulatory audit covering Phases 0 through 12 (`apps/desktop`, `apps/server`, `apps/web`, `packages/shared`, `packages/ui`, `tests`, `.github/workflows/ci.yml`).
- **Audit Harness Files Created:**
  - `docs/AUDIT_FINAL.md` (this report)
  - `docs/AUDIT_FINAL_CHECKPOINT.md` (stage-by-stage checkpoint log)
  - `tests/audit-final/stage3-ledger-simulation.test.ts` (`4 passed`, 5,050-document 2-counter accounting simulation + 100,001-line benchmark + bug reproductions)
  - `tests/audit-final/stage4-sync-resilience.test.ts` (`3 passed`, 100 offline sales + mid-sale crash injection + 20x 2-counter oversell contention with network failures)
  - `tests/audit-final/stage6-backup-restore.test.ts` (`2 passed`, online WAL backup under concurrent writes + restore into clean dir + sequence collision reproduction)

---

## 1. Executive Verdict

### Verdict: **NO-GO FOR IMMEDIATE PRODUCTION LAUNCH**

While the core double-entry ledger engine (`postJournalEntry`), FEFO batch allocator (`allocateFefo`), integer-paisa money library (`packages/shared/src/money.ts`), multi-counter offline sale/return sync loop, and tenant isolation across 181 routes have strong foundations and pass 1,003 automated tests, **3 Critical** and **9 High** severity defects must be remediated before production deployment.

### Top 5 Reasons for NO-GO

1. **`F-C-01` (Critical — Production Data Pollution on Every Desktop Counter):** `apps/desktop/src/main/index.ts:597` unconditionally invokes `seedDatabase()` inside `app.whenReady()` even in packaged production builds (`app.isPackaged === true`). Whenever a counter starts with fewer than 200 products, it silently injects 200 demo medicines, 400 fake batches, and 5 fake suppliers with random local UUIDv7s into the production SQLite database.
2. **`F-C-02` (Critical — Journal Entry Reversals Corrupt AR, AP, Supplier Balances & Year-End Retained Earnings):** `reverseJournalEntry` (`apps/server/src/ledger/service.ts:426-441`) inserts the **reversing entry** with `status = 'reversed'` while leaving the **original entry** `status = 'posted'`. However, AR (`ar.ts:129,203,268,563,591`), AP (`ap.ts:127,200,265,562,590`), Suppliers (`suppliers.ts:132,498,673,705`), Month-End Checklist (`period-close.ts:202,248`), and Year-End Closing (`period-close.ts:357`) filter `journal_entries.status != 'reversed'` or `status = 'posted'` — **including the original entry and excluding its reversal**. Reversing any invoice, bill, payment, or manual journal leaves the original balance stuck forever in AR/AP aging and corrupts Retained Earnings at year-end.
3. **`F-C-03` (Critical — Control Account `1100 AR` / `2000 AP` vs Subledger Reconciliation Broken):**
   - `postCreditNoteCreated` (`apps/server/src/ledger/posting-engine.ts:474-482`) credits `1100 Accounts Receivable` on credit returns without setting `partyType: 'customer'` or `partyId`.
   - `postExpenseCompleted` (`posting-engine.ts:1050-1057`) credits `2000 Accounts Payable` on credit expenses with `partyId: undefined` (`NULL`).
   - `applyCustomerCreated` (`apps/server/src/sync/appliers/customer.ts:78`) and `POST /api/finance/customers` (`payments.ts:1017-1033`) insert `openingBalancePaisa` without posting a journal entry to `1100 AR`, and `GET /api/customers` (`customers.ts:107`) drops `openingBalancePaisa` as soon as the customer has any AR journal line (`balanceMap.get(c.id) ?? c.openingBalancePaisa`).
4. **`F-H-01` & `F-H-08` (High — Broken Clean-DB Migration & Broken Sales/Supplier Queries):**
   - Migration `0021_notifications_and_audit_logs.sql` is missing from `apps/server/drizzle/meta/_journal.json:145-152`, so `pnpm --filter @pos/server migrate` never creates `user_notifications` or `audit_logs` on a fresh database (`42P01: relation does not exist`).
   - `GET /api/finance/sales-ledger` (`apps/server/src/routes/sales-ledger.ts:121`) filters `invoices.status = 'completed'`, whereas all POS and synced invoices have `status = 'finalized'` — returning **0 sales** in production.
5. **`F-H-03`, `F-H-06` & `F-H-07` (High — Payroll Ledger Bypass, Server-to-Counter Sync Blind Spots & Missing Desktop Phase 8–10 Support):**
   - `postPayrollRunToLedger` and `postPayrollPaymentBatch` (`apps/server/src/ledger/payroll-posting.ts:14-351`) bypass `postJournalEntry`, omit the `FOR UPDATE` tenant lock on `entry_no`, and `POST /api/hr/advances` (`payroll.ts:242-310`) disburses cash/bank advances without posting any journal entry.
   - Server PO receipts (`purchase-orders.ts:768-794`) and batch write-offs/discounts (`stock.ts:649-656, 765-779`) never write to `change_log`, so desktop counters never receive PO stock or write-offs.
   - Desktop POS (`apps/desktop`) has no local SQLite tables, UI, or emitters for Phase 8/9/10 features (`customers`, credit sales, `customer_receipt`, `stock_transfers`, `prescriptions`, `attendance`) and `pullAndApply.ts:421` skips `entity: 'customer'` as unknown.

---

## 2. Summary Counts

| Severity / Category | Count | Finding IDs |
|---|---|---|
| **Critical (`F-C-*`)** | **3** | `F-C-01`, `F-C-02`, `F-C-03` |
| **High (`F-H-*`)** | **9** | `F-H-01`, `F-H-02`, `F-H-03`, `F-H-04`, `F-H-05`, `F-H-06`, `F-H-07`, `F-H-08`, `F-H-09` |
| **Medium (`F-M-*`)** | **11** | `F-M-01`, `F-M-02`, `F-M-03`, `F-M-04`, `F-M-05`, `F-M-06`, `F-M-07`, `F-M-08`, `F-M-09`, `F-M-10`, `F-M-11` |
| **Low (`F-L-*`)** | **2** | `F-L-01`, `F-L-02` |
| **Total Findings** | **25** | `3 Critical, 9 High, 11 Medium, 2 Low` |
| **Not Verified (`NOT VERIFIED`)** | **3** | Clean Windows 10/11 VM `.exe` installer run; physical USB/serial 80mm/58mm thermal printer hardware print; physical USB HID barcode scanner hardware scan |

---

## 3. Stage-by-Stage Results

### Stage 1: Clean-Clone Verification
Executed in isolated clone `$env:TEMP\pos-final-audit-clone` at `HEAD` (`120fcf7`):

| Step / Command | Exit Code | Result Summary |
|---|---|---|
| `pnpm install --frozen-lockfile` | `0` | Installed cleanly in `15.5s`. Lockfile consistent with all `package.json` manifests. |
| `pnpm lint` | `0` | `0` errors, `0` warnings across `@pos/shared`, `@pos/ui`, `@pos/server`, `@pos/web`, `@pos/desktop`. |
| `pnpm typecheck` | `0` | `0` TypeScript errors across all workspaces. |
| `pnpm format:check` | **`1`** | **FAIL (`F-L-01`):** 371 files failed Prettier check in a fresh Windows clone due to missing `.gitattributes` (`core.autocrlf=true` converts `LF` to `CRLF`). |
| `pnpm audit` | **`1`** | **FAIL (`F-M-03`):** 1 High vulnerability (`GHSA-g3hv-75wg-m249` in `minimatch < 11.0.1` via `@typescript-eslint/* -> minimatch@9.0.9`). |
| `pnpm --filter @pos/server build` | `0` | Built `dist/`, **but (`F-M-02`)** `apps/server/tsconfig.json:7` compiles `src/**/*.test.ts` into `dist/**/*.test.js`, doubling Vitest server test execution until `dist/` is cleaned. |
| `pnpm --filter @pos/web build` | `0` | Built `dist/assets/index-*.js` (`500.62 kB`, gzip `131.69 kB`). |
| `pnpm --filter @pos/desktop package:dir` | `0` | Packaged `dist-release/win-unpacked/HexaPharm.exe` with unpacked `better-sqlite3` native `.node` binary. |
| `pnpm --filter @pos/server migrate` | `0` (Incomplete) | **FAIL (`F-H-01`):** Applied `0000`..`0020` but skipped `0021_notifications_and_audit_logs.sql` (missing from `_journal.json`). |
| `pnpm test` (3 consecutive runs) | **`1`, `0`, `0`** | **65 test files, 1,003 tests, 0 skipped.** Run 1 had 1 failure in `prescriptions.test.ts:439` (`F-M-01` hardcoded date `'2026-11-30'`) + 1 desktop Electron zip extraction race (`F-L-02`). Runs 2 & 3 failed solely on `prescriptions.test.ts:439`. |

- **Zero Skipped / Disabled Tests Verified:** Grepped all `*.test.ts` files for `.skip`, `.only`, `.todo`, `xit`, `xdescribe` -> **0 occurrences**.
- **Git Diff on `docs/RULES.md` (`git log -p 737dd14..HEAD -- docs/RULES.md`):** **0 commits** — `docs/RULES.md` was never weakened or edited since the initial audit baseline.
- **Test Count Progression:** First audit baseline (`737dd14`) had **30 test files (`249` `it()` blocks, `966` `expect()` calls)**; current `HEAD` (`120fcf7`) has **65 test files (`910` `it()` blocks, `3,789` `expect()` calls)**. Zero tests were deleted or weakened.

---

### Stage 2: Rules Compliance (`docs/RULES.md` & `docs/ERP_SPEC.md`)

| Rule | Status | Evidence Summary |
|---|---|---|
| **1. Money & Rounding (Integer Paisa, `roundHalfUp` only, single formatter)** | **FAIL (`F-M-05`)** | Core POS/sync/ledger use integer paisa and `roundHalfUp`, **but**: `budget-service.ts:514`, `expenses.ts:335`, `payroll.ts:557`, `hr.ts:153`, and `payroll.ts:119,150` use `Math.round(...)` on float division; 35+ web input forms use `Math.round(parseFloat(val) * 100)`; 14 duplicate `formatPKR`/`formatPaisa` functions exist across web/desktop; `search.ts:65,128` uses `(paisa / 100).toFixed(2)`. |
| **2. IDs, Sequences & Immutability (UUIDv7, gapless `entry_no`, no edits/deletes)** | **FAIL (`F-C-02`, `F-H-03`)** | UUIDv7 used everywhere (`generateUuidV7`), DB triggers block UPDATE/DELETE on `journal_entries`, `journal_lines`, `stock_movements`, and `erp_payments`. **However**, `postPayrollRunToLedger` (`payroll-posting.ts:144`) computes `MAX(entry_no) + 1` without locking `pharmacies FOR UPDATE`, and `reverseJournalEntry` (`service.ts:435`) marks the reversal row `'reversed'` instead of the original row. |
| **3. Timestamps & Timezone (UTC ISO storage, `Asia/Karachi` business dates)** | **FAIL (`F-H-04`)** | **75 occurrences** of `new Date().toISOString().slice(0, 10)` (or `.split('T')[0]`) compute business dates in UTC instead of `Asia/Karachi` (wrong between 00:00 and 04:59 PKT) across server routes, payroll posting, desktop returns/purchasing/invoices, and all web forms. |
| **4. Stock & Batches (Movement ledger, FEFO, no expired sales)** | **FAIL (`F-H-05`, `F-H-06`, `F-M-11`)** | `allocateFefo` (`fefo.ts:69`) enforces `expiryDate >= today` and ties by `batchId`. **However**, `stock-transfers.ts:419-614` skips stock/quantity validation and omits shortage `stock_movements`; `applyPurchaseReceived` (`purchase.ts:202`) stamps `stock_movements.createdAt = now`; and legacy `invoices:create` (`apps/desktop/src/main/invoices.ts:97-115`) bypasses `allocateFefo` and can sell expired batches. |
| **5. Transactions (Multi-table writes in one DB transaction)** | **FAIL (`F-H-02`)** | **14 server endpoints** perform multi-table writes or read-then-write balance checks outside `db.transaction()` (`customers.ts`, `prescriptions.ts`, `suppliers.ts`, `stock-locations.ts`, `hr-leave.ts`, `payroll.ts`). |
| **6. Tenancy & Auth (JWT `pharmacy_id`, permission guard, tenant isolation test)** | **PASS (with `M-01` test note)** | All 182 routes enforce auth + permission guards (`ROLE_PERMISSIONS`), scope queries by `pharmacyId`, and all 181 route paths are in `tests/audit-regression/tenant-isolation.test.ts` (`286/286` assertions). |
| **7. Sync & Offline (Outbox in same tx, `processed_events`, `change_log`)** | **FAIL (`F-H-06`, `F-H-07`, `F-M-07`)** | Server PO receive (`purchase-orders.ts:768-794`) and batch write-off/discount (`stock.ts:649-656, 765-779`) omit `change_log`; desktop lacks Phase 8/9/10 tables/emitters and skips `customer` in `pullAndApply.ts:421`; desktop product/supplier/user edits omit `outbox`. |
| **8. Electron Security (`contextIsolation`, `sandbox`, IPC wrapper)** | **FAIL (`F-M-06`)** | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `ipcGuard.ts` verified. **However**, `0` of 66 `registerSecureIpcHandler` calls pass `schema:`; `verifyOwnerPinForDestructive` (`wrapper.ts:86`) ignores `locked_until` and does not increment `failed_login_attempts`; and IPC handlers hardcode `roles: ['cashier', 'pharmacist', 'owner']`, blocking `manager` and `accountant`. |
| **9. Code Quality & Prohibited Shortcuts** | **FAIL (`F-M-08`, `F-C-01`)** | `apps/server/src/routes/finance.ts:256-262` contains test-only dead code (`Force-Simulated-Failure`), and `apps/desktop/src/main/index.ts:597` runs `seedDatabase()` unconditionally in production builds. |

---

### Stage 3: Ledger and Accounting Integrity
- **Executable Simulation & Benchmark (`tests/audit-final/stage3-ledger-simulation.test.ts` — `4 passed` in `62.3s`):**
  1. Simulated **5,050 business documents** across 1 pharmacy, 2 branches, and 2 counters over 2 fiscal months (`2,000` cash/card/wallet sales, `500` credit sales, `300` customer returns, `400` GRN purchases, `200` PO receipts, `100` supplier returns, `150` inter-branch stock transfers with shortages, `150` stock adjustments/write-offs, `400` customer receipts, `300` supplier payments, `200` expenses, `50` bounced cheques, `150` payroll runs/payments, `150` manual journals & reversals).
  2. Verified core ledger invariants across all **5,032 posted journal entries**:
     - `SUM(debit_paisa) === SUM(credit_paisa) === 2,520,257,960` paisa (`0` unbalanced entries).
     - `0` lines with both debit and credit or `<= 0`.
     - Gapless `entry_no` sequence `1..5032`.
     - Trial Balance `totalDebitPaisa === totalCreditPaisa === 2,213,562,960` paisa.
     - Balance Sheet `Assets (2,078,325,530) === Liabilities (42,418,320) + Equity (1,500,000,000) + Current Period Net Income (535,907,210)`.
     - Cash Flow Statement net cash change (`1,722,555,000`) equals exact change in `1000 Cash + 1010 Bank + 1020 Wallet`.
     - Closed period `2026-01` rejects backdated sales, manual journals, and sync events; DB triggers block `UPDATE` and `DELETE` on `journal_entries` and `journal_lines`.
  3. **Reproduced Critical/High Accounting Bugs in Test `3.2` & `3.3`:**
     - Reproduced `F-C-02` (reversed entries excluded from AR/AP/Supplier balances & year-end closing; duplicate year-end closing doubles Retained Earnings).
     - Reproduced `F-C-03` (credit note `1100 AR` and credit expense `2000 AP` posted with `party_id = NULL`; customer `openingBalancePaisa` unposted to `1100 AR`).
     - Reproduced `F-H-06` (`applyPurchaseReceived` stamping `stock_movements.createdAt = now` instead of `purchase.createdAt`, breaking historical `reconcileLedger`).

---

### Stage 4: Sync and Offline Guarantees
- **Executable Sync & Contention Suite (`tests/audit-final/stage4-sync-resilience.test.ts` — `3 passed` in `4.48s`):**
  - **Test `4.1`:** 100 offline sales on on-disk WAL SQLite with mid-sale crash injected during sale #51; verified atomic rollback, `PRAGMA integrity_check === 'ok'`, idempotent retry with `clientRequestId`, gapless `C1-000001`..`C1-000100`, and exact stock/cash totals.
  - **Test `4.2`:** 20 iterations of two counters offline selling 8 units each from a 10-unit batch (`10 - 8 - 8 = -6`) with `ECONNRESET` network failures injected every 3rd request; verified all 40 sales accepted, 20 `negative_stock` alerts created, all 3 databases converged to `-6`, zero echo outbox events, and `reconcileLedger` difference `= 0`.
  - **Test `4.3`:** Verified `UNKNOWN_PRODUCT` -> `retry_later`, `CROSS_TENANT_REFERENCE` & closed-period -> `rejected` (`sync_exceptions`), revoked device `401` -> `auth_error` (preserving outbox), `> 72h` offline banner (`exceeded`) without blocking sales, and reproduced `F-H-07` (`pullAndApply.ts:421` skipping `customer` entity).

---

### Stage 5: Security, Tenancy, Permissions, Sensitive Data & Secrets
- Walked all **182 routes across 27 route modules** in `apps/server/src/routes/`.
- Verified `tests/audit-regression/tenant-isolation.test.ts` covers **181 route entries (`286/286` assertions)**.
- Verified receipt HTML escaping (`escapeHtml` in `apps/desktop/src/main/receipts.ts:20-27`), with unescaped internal fields noted in `F-M-08`.
- Scanned git history (`git log --all -S ...`) -> **0 leaked production keys or credentials**.
- Identified `F-H-08` (broken status/sourceType filters in `sales-ledger.ts` and `suppliers.ts`), `F-H-09` (unconditional `trustProxy: true`, in-memory JWT revocation map, `DEVICE_JWT_SECRET` fallback, web token in `localStorage`), and `F-M-08` (unhandled `Schema.parse()` 500s in `cash-bank.ts`, missing `:id` UUID schemas, unlimited repeats on fulfilled/cancelled prescriptions).

---

### Stage 6: Desktop, Packaging, Backup/Restore & Operations
- **Executable Backup & Restore Suite (`tests/audit-final/stage6-backup-restore.test.ts` — `2 passed` in `2.35s`):**
  - Verified online SQLite `.backup()` while background sales write concurrently in WAL mode, restore into a clean user-data directory with pre-restore safety snapshot, owner-only enforcement, corrupted file rejection, and 14-backup rolling retention.
  - Reproduced `F-M-09` (no `schema_migrations` version check before restore + post-restore `uq_invoices_pharmacy_number` collision causing permanent `INTERNAL_ERROR` sync rejection).
- Verified packaged unpacked build (`apps/desktop/dist-release/win-unpacked/HexaPharm.exe`) and identified `F-C-01` (`seedDatabase()` running unconditionally on startup in production builds).

---

### Stage 7: Web App & UX Quality
- Verified sidebar permission filtering (`NAV_PERMISSIONS` in `DashboardLayout.tsx:75-108`) and `<ForbiddenPage />` view guard in `App.tsx:60-68`.
- Verified **0 external CDN dependencies** (`googleapis`, `gstatic`, `unpkg`, `cdnjs`) across `apps/web` and `apps/desktop`; `@fontsource/noto-nastaliq-urdu` and `lucide-react` are bundled locally.
- Identified `F-M-10` (`GET /api/search` returning broken `/sales-ledger` link instead of `/finance-sales-ledger`; `handleNavigate` stripping entity query parameters; `refreshSystemNotifications` alerting on 0-stock batches and sending admin/finance notifications to cashiers/pharmacists; 11 unbounded list/report queries; N+1 query loops in `payments.ts` and `hr-leave.ts`).

---

### Stage 8: Test Quality (Mutation Sanity in Temporary Clone)
- Executed 12 targeted mutations (`M-01`..`M-12`) in `$env:TEMP\pos-final-audit-clone` (see Section 6 below for full table). **9 were killed** (`8` by test assertions, `1` by PostgreSQL trigger) and **3 survived** (`M-01`, `M-09`, `M-12`), exposing concrete test coverage gaps in aggregate report tenant isolation, payment negative boundary validation, and owner self-demotion tests.

---

### Stage 9: Regulatory Readiness (Pakistan FBR, DRAP & Labour/Payroll)
- **FBR:** Configurable `tax_categories` (`rate_bp`, `is_exempt`), separate `1300 Input Sales Tax` and `2100 Output Sales Tax` ledger accounts, and `fiscal_status` / `fiscal_invoice_number` / `qr_payload` fields on invoices and thermal receipts. Missing pharmacy-level `ntn`/`strn` columns on server `pharmacies`/`branches` tables (`F-M-11`).
- **DRAP:** Mandatory `batch_no` + `expiry_date` on batches and receipts, FEFO expiry enforcement in `allocateFefo`. Gaps (`F-M-11`): `finalizeSale.ts` does not enforce prescription/patient/doctor capture when selling `is_controlled = 1` products; legacy `invoices:create` (`invoices.ts:97-115`) bypasses `allocateFefo` and can sell expired batches; no single-click batch-recall customer contact report.
- **Pakistani Labour & Payroll:** Fully data-driven progressive income tax slabs (`payroll_tax_slabs`) and statutory components (`statutory_components` for EOBI/SESSI) per fiscal year, with full payslip breakdown persisted in `payroll_items`.

---

## 4. Complete Findings List

### Critical Findings (`F-C-01` to `F-C-03`)

#### `F-C-01` — Unconditional `seedDatabase()` Call on Startup in Packaged Production Desktop App
- **Severity:** Critical
- **Evidence:**
  - `apps/desktop/src/main/index.ts:593-601`:
    ```ts
    app.whenReady().then(() => {
      initLogger();
      logInfo('Application starting up...');
      initDatabase();
      seedDatabase();
    ```
  - `apps/desktop/src/main/seed.ts:456-463`: Checks `SELECT COUNT(*) FROM products`, and whenever `count < 200` (such as a newly provisioned counter before its first `/sync/pull`, or a pharmacy with `< 200` real SKUs), inserts 200 demo products, 400 demo batches, 400 `opening_balance` stock movements, and 5 fake suppliers with freshly generated local UUIDv7s (`generateUuidV7()`).
- **Impact in Plain Words:** Every new production counter installation (or any pharmacy carrying fewer than 200 products) is immediately polluted with 200 fake medicines and 400 fake batches with random local UUIDs that do not match the server's catalog, corrupting counter inventory and causing synced sales of those items to create duplicate products/batches across the tenant.
- **Suggested Fix:** Remove `seedDatabase()` from `app.whenReady()` in `apps/desktop/src/main/index.ts:597` (or gate it strictly behind `!app.isPackaged && process.env.POS_AUTO_SEED === 'true'`). Keep manual seeding strictly behind the dev-only IPC channel `products:seed`.
- **Regression Test:** Launch database initialization via the startup path with `NODE_ENV = 'production'` (or `app.isPackaged = true`) on an empty SQLite DB and assert `SELECT COUNT(*) FROM products === 0`.

---

#### `F-C-02` — Journal Reversal Status Semantics Break AR, AP, Supplier Subledgers & Year-End Closing; Year-End Closing Not Idempotent
- **Severity:** Critical
- **Evidence:**
  - `apps/server/src/ledger/service.ts:426-441` (`reverseJournalEntry`): Inserts the **reversing entry** with `status: 'reversed'` (`line 435`) and never updates the **original entry** (which remains `status = 'posted'`), because `trg_journal_entries_immutable` blocks `UPDATE` on `journal_entries`.
  - While `reports.ts:56-59` includes both `'posted'` and `'reversed'` entries so they net to zero in Trial Balance/P&L/Balance Sheet, **five other modules filter out `'reversed'` or require `'posted'`**:
    1. `apps/server/src/routes/ar.ts:129, 203, 268, 563, 591` (`sql\`${journalEntries.status} != 'reversed'\``)
    2. `apps/server/src/routes/ap.ts:127, 200, 265, 562, 590` (`sql\`${journalEntries.status} != 'reversed'\``)
    3. `apps/server/src/routes/suppliers.ts:132, 498, 673, 705` (`eq(journalEntries.status, 'posted')`)
    4. `apps/server/src/routes/period-close.ts:202, 248` (`eq(journalEntries.status, 'posted')`)
    5. `apps/server/src/routes/period-close.ts:357` (`executeYearEndClosing`: `eq(journalEntries.status, 'posted')`)
  - Furthermore, `executeYearEndClosing` (`apps/server/src/routes/period-close.ts:358, 440`) excludes previous `'year_end_close'` entries when summing revenue/expenses and posts with `sourceId: generateUuidV7()`, so calling `POST /api/finance/year-end-close` twice for the same `fiscalYear` posts a duplicate Retained Earnings entry.
  - **Reproduced in:** `tests/audit-final/stage3-ledger-simulation.test.ts:1049-1122`.
- **Impact in Plain Words:** Whenever an invoice, purchase bill, payment, or journal entry is reversed, the reversal is ignored by AR aging, AP aging, supplier statements, month-end AR/AP reconciliation, and year-end closing — leaving the reversed debt permanently on the customer's or supplier's balance and closing reversed revenue/expenses into Retained Earnings at year-end.
- **Suggested Fix:**
  1. Either insert reversing entries with `status: 'posted'` (since both the original and reversal are valid posted entries in an append-only ledger) and remove `!= 'reversed'` filters, **or** remove `status != 'reversed'` / `status = 'posted'` filters in `ar.ts`, `ap.ts`, `suppliers.ts`, and `period-close.ts` so both original and reversing lines are summed together.
  2. In `executeYearEndClosing`, use a deterministic `sourceId` (or check for an existing `'year_end_close'` entry for `(pharmacyId, fiscalYear)`) and include prior `'year_end_close'` entries in the balance query so year-end close is idempotent.
- **Regression Test:** See `tests/audit-final/stage3-ledger-simulation.test.ts` (`3.2 REPRODUCE F-C-02`); invert the bug assertion to assert that after `reverseJournalEntry`, `GET /api/finance/ar/summary`, `GET /api/finance/ap/summary`, and `executeYearEndClosing` net the reversed entry to `0` paisa, and a second `executeYearEndClosing` call is rejected or idempotent.

---

#### `F-C-03` — Missing `partyId` on Credit Returns & Credit Expenses and Unposted Customer `openingBalancePaisa` Break AR/AP Control Reconciliation
- **Severity:** Critical
- **Evidence:**
  1. `apps/server/src/ledger/posting-engine.ts:474-482` (`postCreditNoteCreated`): When `creditNote.refundMethod === 'credit'`, credits `1100 Accounts Receivable` **without** `partyType: 'customer'` or `partyId: customerId`.
  2. `apps/server/src/ledger/posting-engine.ts:1050-1057` (`postExpenseCompleted`): When `expense.paymentType === 'credit'`, credits `2000 Accounts Payable` with `partyType: 'supplier'` and `partyId: undefined` (`NULL` in DB).
  3. `apps/server/src/sync/appliers/customer.ts:78` (`applyCustomerCreated`) and `apps/server/src/routes/payments.ts:1017-1033` (`POST /api/finance/customers`): Insert `openingBalancePaisa` onto `customers` without posting a journal entry (`Dr 1100 AR / Cr 3000 Owner Equity`), unlike `POST /api/customers` (`customers.ts:246-274`).
  4. `apps/server/src/routes/customers.ts:107` (`GET /api/customers`): Computes `currentBalancePaisa: balanceMap.get(c.id) ?? c.openingBalancePaisa`. If `openingBalancePaisa` was not posted to `journal_lines`, as soon as the customer has 1 credit sale, `balanceMap.get(c.id)` is non-null and `openingBalancePaisa` disappears from their balance!
  - **Reproduced in:** `tests/audit-final/stage3-ledger-simulation.test.ts:1010-1047, 1124-1136`.
- **Impact in Plain Words:** Credit returns never reduce a customer's AR subledger balance, credit expenses create orphan AP balances not tied to any supplier, and customers synced from counters or created via Finance have unposted opening balances — causing `GET /api/finance/ar/reconciliation` and `GET /api/finance/ap/reconciliation` to permanently fail (`isReconciled: false`).
- **Suggested Fix:**
  1. Include `customerId` on `credit_notes` (and `CreditNoteCreatedPayload`) and pass `partyType: 'customer', partyId: creditNote.customerId` in `postCreditNoteCreated` when `refundMethod === 'credit'`.
  2. Require `supplierId` (or post to `2200 Accrued Expenses Payable` instead of `2000 AP Trade` when no supplier exists) for credit expenses in `postExpenseCompleted`.
  3. Call `postJournalEntry` (`Dr 1100 AR / Cr 3000 Equity` with `partyType: 'customer', partyId`) inside `applyCustomerCreated` and `POST /api/finance/customers` whenever `openingBalancePaisa > 0`.
- **Regression Test:** See `tests/audit-final/stage3-ledger-simulation.test.ts` (`3.3 REPRODUCE F-C-03`); assert `GET /api/finance/ar/reconciliation` and `GET /api/finance/ap/reconciliation` return `differencePaisa === 0` after credit returns, credit expenses, and synced customer opening balances.

---

### High Findings (`F-H-01` to `F-H-09`)

#### `F-H-01` — Migration `0021_notifications_and_audit_logs.sql` Missing from Drizzle `_journal.json`
- **Severity:** High
- **Evidence:**
  - File `apps/server/drizzle/0021_notifications_and_audit_logs.sql` exists on disk, but `apps/server/drizzle/meta/_journal.json:145-152` ends at `idx: 20` (`0020_phase10_hr_attendance_leave`).
  - Running `pnpm --filter @pos/server migrate` on a fresh PostgreSQL database applies `0000`..`0020` and silently skips `0021`, leaving `user_notifications` and `audit_logs` uncreated (`ERROR: relation "user_notifications" does not exist`).
- **Impact in Plain Words:** Deploying the server to any new database via standard Drizzle migrations leaves `user_notifications` and `audit_logs` missing, causing `GET /api/notifications` and `GET /api/audit-logs` to fail with HTTP 500.
- **Suggested Fix:** Add entry `idx: 21, tag: "0021_notifications_and_audit_logs"` to `apps/server/drizzle/meta/_journal.json`.
- **Regression Test:** Run `migrate(db, { migrationsFolder: './drizzle' })` against an empty test schema and assert `SELECT to_regclass('user_notifications')` and `SELECT to_regclass('audit_logs')` are both non-null.

---

#### `F-H-02` — 14 Multi-Table Writes and Balance Checks Outside Database Transactions (Rule 5 Violations)
- **Severity:** High
- **Evidence:**
  1. `POST /api/customers` (`apps/server/src/routes/customers.ts:232-275`): Inserts `customers`, then calls `postJournalEntry` and `insertChangeLog` outside `db.transaction()`.
  2. `PUT /api/customers/:id` (`customers.ts:360-384`): Updates `customers`, then calls `insertChangeLog` outside a transaction.
  3. `POST /api/prescriptions` (`apps/server/src/routes/prescriptions.ts:388-437`): Inserts `prescriptions` and `prescription_items` in two separate `await db.insert()` calls without `db.transaction()`.
  4. `PUT /api/prescriptions/:id` (`prescriptions.ts:518-587`): Updates `prescriptions`, deletes `prescription_items`, and re-inserts `prescription_items` without `db.transaction()`.
  5. `POST /api/prescriptions/:id/dispense` (`prescriptions.ts:747-798`): Loops `await db.update(prescriptionItems)` per item, inserts `prescriptionDispenses`, and updates `prescriptions` without `db.transaction()`.
  6. `POST /api/suppliers` (`apps/server/src/routes/suppliers.ts:238-259`): Inserts `suppliers` and `change_log` outside `db.transaction()`.
  7. `PATCH /api/suppliers/:id` (`suppliers.ts:352-377`): Updates `suppliers` and `change_log` outside `db.transaction()`.
  8. `POST /api/stock-locations` (`apps/server/src/routes/stock-locations.ts:132-194`): Clears `isDefault`, inserts `stock_locations`, and inserts `change_log` outside `db.transaction()`.
  9. `PATCH /api/stock-locations/:id` (`stock-locations.ts:241-304`): Clears `isDefault`, updates `stock_locations`, and inserts `change_log` outside `db.transaction()`.
  10. `POST /api/hr/leave/requests` (`apps/server/src/routes/hr-leave.ts:331-394`): Reads balance and inserts `leaveRequests` outside a transaction.
  11. `POST /api/hr/leave/requests/:id/approve` (`hr-leave.ts:440-476`): Updates `leaveRequests` and increments `leaveAllocations.usedDays` in two separate queries without `db.transaction()`.
  12. `POST /api/hr/advances` (`apps/server/src/routes/payroll.ts:261-305`): Checks `pendingTotal + amountPaisa > maxAdvanceLimitPaisa` and inserts `employeeAdvances` without a transaction or `FOR UPDATE` lock.
  13. `POST /api/hr/payroll/runs/:id/approve` (`payroll.ts:624-649`): Calls `postPayrollRunToLedger(db, ...)` and then `db.update(payrollRuns)` in separate transactions.
  14. `POST /api/hr/payroll/runs/:id/pay` (`payroll.ts:703-774`): Calls `postPayrollPaymentBatch(db, ...)`, updates `payrollItems`, loops `employeeAdvances` updates, and updates `payrollRuns` in separate transactions.
- **Impact in Plain Words:** Partial failures mid-request leave orphan customer/prescription/supplier rows without ledger entries or `change_log` sync rows, corrupt leave balances, allow concurrent requests to bypass employee advance limits, or post payroll to the general ledger while leaving the payroll run in `draft`/`approved` status (so re-clicking Pay/Approve fails or double-recovers advances).
- **Suggested Fix:** Wrap each of the 14 handlers in a single `await db.transaction(async (tx) => { ... })`.
- **Regression Test:** Inject a failure on the second statement in `POST /api/customers`, `PUT /api/prescriptions/:id`, and `POST /api/hr/payroll/runs/:id/pay`, and assert the first table's write is completely rolled back.

---

#### `F-H-03` — Payroll Posting Bypasses `postJournalEntry`, Lacks `entry_no` Locking, Fails Without Explicit Fiscal Period Row, and Employee Advance Disbursement Posts No Journal Entry
- **Severity:** High
- **Evidence:**
  1. `apps/server/src/ledger/payroll-posting.ts:14-351` (`postPayrollRunToLedger` and `postPayrollPaymentBatch`) manually inserts into `journalEntries` and `journalLines` instead of calling `postJournalEntry` (`apps/server/src/ledger/service.ts:127`):
     - Does NOT acquire `SELECT id FROM pharmacies WHERE id = ... FOR UPDATE` before computing `MAX(entry_no) + 1` (`lines 144, 294`), so concurrent postings fail on `uq_journal_entries_pharmacy_entry_no`.
     - Computes `karachiDate = now.slice(0, 10)` (`lines 39, 224`, UTC date instead of `Asia/Karachi`).
     - Requires an explicit row in `fiscal_periods` with `status = 'open'` (`lines 42-55, 226-239`), throwing `No open fiscal period found` if the pharmacy has not manually pre-created a fiscal period row for the current month (whereas `postJournalEntry` only blocks when a matching `'closed'` period exists).
     - Credits advance recoveries to `2300 Employee Advances Receivable` (`line 113`) without `partyType` or `partyId`.
  2. `POST /api/hr/advances` (`apps/server/src/routes/payroll.ts:242-310`) inserts a disbursed employee advance into `employee_advances` (`status: 'pending'`) without posting any journal entry (`Dr 2300 Employee Advances Receivable / Cr 1000 Cash or 1010 Bank`). When payroll later recovers the advance (`payroll-posting.ts:113`), it credits `2300` — driving account `2300` permanently negative!
- **Impact in Plain Words:** Disbursing an employee salary advance never reduces Cash/Bank in the general ledger, and recovering it during payroll drives `2300 Employee Advances Receivable` negative. Additionally, payroll posting fails with `No open fiscal period found` unless a fiscal period row was manually created first.
- **Suggested Fix:**
  1. Refactor `postPayrollRunToLedger` and `postPayrollPaymentBatch` to call `postJournalEntry(tx, ...)` inside the caller's transaction.
  2. In `POST /api/hr/advances`, require a disbursement payment method/account (`1000 Cash` or `1010 Bank`) and call `postJournalEntry` (`Dr 2300 / Cr 1000|1010`) inside the same transaction.
- **Regression Test:** Create an employee advance of `10,000` PKR, run and approve payroll with `10,000` PKR advance recovery, and assert that account `2300 Employee Advances Receivable` has debit `1,000,000` paisa, credit `1,000,000` paisa, and ending balance `0` paisa.

---

#### `F-H-04` — 75 Occurrences of UTC Date Slicing (`toISOString().slice(0, 10)`) Used for Business Dates Instead of `Asia/Karachi`
- **Severity:** High
- **Evidence:**
  - Between `00:00:00` and `04:59:59` PKT (`19:00:00` to `23:59:59` UTC of the previous day), `new Date().toISOString().slice(0, 10)` returns **yesterday's date**.
  - Found in **75 places** across:
    - **Server (`30` places):** `payroll-posting.ts:39,224`, `stock.ts:448,595,627`, `stock-transfers.ts:593,721`, `stock-counts.ts:388`, `supplier-returns.ts:466`, `purchase-orders.ts:750`, `payments.ts:363,809`, `expenses.ts:533`, `ar.ts:105,368`, `ap.ts:103,365`, `period-close.ts:144`, `notification-service.ts:115,216`, `hr-leave.ts:313`, `payroll.ts:367,439,472`.
    - **Desktop (`7` places):** `db.ts:730`, `invoices.ts:304`, `returns.ts:114`, `purchasing.ts:163`, `PosScreen.tsx:215`, `PurchasingScreen.tsx:99,679`.
    - **Web (`38` places):** All date defaults in `JournalEntriesPage.tsx`, `PaymentsPage.tsx`, `ExpensesPage.tsx`, `CashBankPage.tsx`, `ArApPages.tsx`, `BudgetsPage.tsx`, `PeriodClosePage.tsx`, `SalesLedgerPage.tsx`, `FinancialStatementsPage.tsx`, `HrAttendancePage.tsx`, `HrLeavePage.tsx`, `PrescriptionsPage.tsx`, `PurchaseOrdersPage.tsx`, `StockTransfersPage.tsx`, `StockCountsPage.tsx`, `SupplierReturnsPage.tsx`, `SuppliersPage.tsx`, `InventoryBrowserPage.tsx`, `ControlledSubstancesLogPage.tsx`, `DashboardPages.tsx`.
- **Impact in Plain Words:** Any night-shift transaction, stock adjustment, PO receipt, reversal, or expiry check executed between midnight and 5:00 AM Pakistan time is recorded on the wrong business date (and can even fall into a closed prior month on the 1st of the month at 01:00 AM PKT).
- **Suggested Fix:** Replace all `new Date().toISOString().slice(0, 10)` and `.split('T')[0]` business-date calls with `getKarachiBusinessDate()` / `toKarachiBusinessDate()` from `@pos/shared`.
- **Regression Test:** Pass `new Date('2026-02-28T21:30:00.000Z')` (`2026-03-01 02:30:00 PKT`) to stock write-off, PO receive, and payroll posting, and assert the resulting `entryDate` is `'2026-03-01'`.

---

#### `F-H-05` — Stock Transfer Dispatch/Receive/Cancel Validation, Dangling `shortageMovementId`, and Missing `change_log` Bugs
- **Severity:** High
- **Evidence:**
  1. `POST /api/stock-transfers/:id/dispatch` (`apps/server/src/routes/stock-transfers.ts:419-465`):
     - Does not check current branch stock balance before inserting negative `transfer_out` movements.
     - Does not check that `quantityDispatched <= item.quantityRequested`.
     - Does not validate that every transfer item is included in `body.items`; omitted items remain `quantityDispatched = 0` while the transfer transitions to `'in_transit'`.
  2. `POST /api/stock-transfers/:id/receive` (`apps/server/src/routes/stock-transfers.ts:554-614`):
     - Does not validate `quantityReceived + shortageQuantity === item.quantityDispatched`. If `quantityReceived < quantityDispatched` with `shortageQuantity = 0`, units vanish into thin air (deducted from source branch by `transfer_out`, never added to destination branch by `transfer_in`, and never expensed as shortage).
     - Generates `shortageMovementId = generateUuidV7()` (`line 567`) and stores it on `stock_transfer_items.shortageMovementId` (`line 611`), **without ever inserting a row into `stock_movements`**!
  3. `POST /api/stock-transfers/:id/cancel` (`apps/server/src/routes/stock-transfers.ts:714-734`):
     - When cancelling an `'in_transit'` transfer, inserts a positive reversal `stock_movements` row (`line 715`) **without calling `insertChangeLog`**, so source branch counters never receive the restored stock via `/sync/pull`.
- **Impact in Plain Words:** Users can dispatch more stock than requested, lose inventory silently in transit when `quantityReceived + shortageQuantity != quantityDispatched`, store dangling `shortageMovementId` pointers, and leave source branch POS counters permanently short of stock when an in-transit transfer is cancelled.
- **Suggested Fix:**
  1. In `dispatch`, require all transfer items, enforce `quantityDispatched <= quantityRequested`, and validate available branch-batch stock.
  2. In `receive`, require all transfer items and enforce `quantityReceived + shortageQuantity === quantityDispatched`; set `shortageMovementId = null` (since `transfer_out` already deducted the full dispatched quantity from source branch).
  3. In `cancel`, call `insertChangeLog` for every reversal `stock_movements` row.
- **Regression Test:** Dispatch 10 units on a stock transfer, attempt to receive `quantityReceived: 6, shortageQuantity: 0` and assert HTTP 400; cancel an in-transit transfer and assert a `stock_movement` row is written to `change_log`.

---

#### `F-H-06` — Inventory-to-Ledger Historical Reconciliation Bug, Missing `change_log` on Server PO Receive & Batch Write-Off/Discount, and Intra-Branch Transfer Shortage Omission
- **Severity:** High
- **Evidence:**
  1. `applyPurchaseReceived` (`apps/server/src/sync/appliers/purchase.ts:202`): Inserts `stock_movements` with `createdAt: now` (server sync receipt timestamp) instead of `payload.purchase.createdAt`, whereas `postPurchaseReceived` (`posting-engine.ts:184`) posts the ledger entry on `toKarachiBusinessDate(purchase.invoiceDate || purchase.createdAt)`. Calling `reconcileLedger` (`reconciliation.ts:184-185`) for any historical date range where an offline GRN was synced on a later day reports `inventory.isReconciled === false` (reproduced in `tests/audit-final/stage3-ledger-simulation.test.ts:1138-1144`).
  2. `POST /api/purchase-orders/:id/receive` (`apps/server/src/routes/purchase-orders.ts:768-794`): Inserts/updates `batches` and `stock_movements` on the server **without calling `insertChangeLog`**, so desktop POS counters never pull stock received via web Purchase Orders!
  3. `POST /api/inventory/batches/:id/write-off` (`apps/server/src/routes/stock.ts:649-656`) and `POST /api/inventory/batches/:id/discount` (`stock.ts:765-779`): Insert write-off `stock_movements` and update `batches.mrpPaisa` **without calling `insertChangeLog`**, and desktop `pullAndApply.ts:171` uses `INSERT OR IGNORE INTO batches` (never updating `mrp_paisa`).
  4. `postStockTransferReceived` (`apps/server/src/ledger/posting-engine.ts:648-650`): Returns `null` when `sourceBranchId === destinationBranchId` even when `shortageQuantity > 0`, failing to post the shortage expense (`Dr 5010 / Cr 1200`).
- **Impact in Plain Words:** Stock received via web Purchase Orders or written off/discounted in web Inventory never syncs down to the desktop POS counters, causing counters to refuse sales of received PO stock or continue selling written-off batches at old MRPs.
- **Suggested Fix:**
  1. In `applyPurchaseReceived` (`purchase.ts:202`), set `createdAt: purchase.createdAt`.
  2. In `purchase-orders.ts:768-794` and `stock.ts:649-656, 765-779`, call `insertChangeLog` for `batch` and `stock_movement`, and change `pullAndApply.ts:171` to `ON CONFLICT(id) DO UPDATE SET mrp_paisa = excluded.mrp_paisa`.
  3. In `postStockTransferReceived` (`posting-engine.ts:648`), post the shortage loss (`Dr 5010 / Cr 1200`) even when `sourceBranchId === destinationBranchId`.
- **Regression Test:** Receive a PO via `POST /api/purchase-orders/:id/receive`, run desktop `pullAndApply`, and assert the new batch and positive stock balance appear in the counter's SQLite database.

---

#### `F-H-07` — Desktop POS Missing Local Tables, IPC Handlers, Outbox Emitters & Pull Handlers for Phase 8/9/10 Features
- **Severity:** High
- **Evidence:**
  1. `apps/desktop/src/main/sync/core/pullAndApply.ts:192-427`: `switch (row.entity)` has no `case 'customer':` or `case 'customers':`, hitting `default: Unknown entity type "customer" encountered; skipping row` (reproduced in `tests/audit-final/stage4-sync-resilience.test.ts:1022-1084`).
  2. `apps/desktop/src/main/db.ts`: Has no `customers`, `stock_transfers`, `prescriptions`, or `attendance` tables; `invoices` (`db.ts:424-441`) has no `customer_id` column; and `payments.method` (`db.ts:455`) and `finalizeSale.ts:554` only allow `'cash' | 'card' | 'wallet'` (disallowing `'credit'`).
  3. While server sync appliers exist for `customer.created`, `customer_receipt.created`, `stock_transfer.dispatched`, and `stock_transfer.received` (`apps/server/src/sync/service.ts:109-121`), zero desktop code ever emits those outbox events.
- **Impact in Plain Words:** Credit sales to customers, customer account receipts, stock transfers, prescriptions, and staff attendance cannot be performed offline at the desktop counter POS; they only exist in the web back-office (`apps/web`).
- **Suggested Fix:** Add SQLite tables (`customers`, `invoices.customer_id`, `payments.method` allowing `'credit'`) and `case 'customer':` in `pullAndApply.ts` so desktop counters can pull customer credit limits/balances and emit credit sales and customer receipts offline.
- **Regression Test:** See `tests/audit-final/stage4-sync-resilience.test.ts` (`4.3` step 5); assert `pullAndApply` applies `entity: 'customer'` into local SQLite without warning or skipping.

---

#### `F-H-08` — `GET /api/finance/sales-ledger` Filters `status = 'completed'` Instead of `'finalized'`, and `GET /api/suppliers` Filters `sourceType = 'purchase'` Instead of `'purchase.received'`
- **Severity:** High
- **Evidence:**
  1. `apps/server/src/routes/sales-ledger.ts:121`:
     ```ts
     const invConditions = [
       eq(invoices.pharmacyId, pharmacyId),
       eq(invoices.status, 'completed'),
     ];
     ```
     Every invoice created by desktop POS (`finalizeSale.ts:321`) and synced to the server (`apps/server/src/sync/appliers/invoice.ts:289`) has `status = 'finalized'`. Filtering for `'completed'` causes `GET /api/finance/sales-ledger` to return **0 invoices** in production! (`sales-ledger.test.ts` passed only because the test manually inserted fake invoices with `status: 'completed'`.)
  2. `apps/server/src/routes/suppliers.ts:162, 701`:
     ```ts
     if (row.sourceType === 'purchase' && row.sourceId) purchaseIds.add(row.sourceId);
     ```
     `postPurchaseReceived` (`posting-engine.ts:219`) posts GRN purchases with `sourceType: 'purchase.received'`, so all synced GRNs are excluded from supplier `totalPurchasesCount` and supplier statement transaction type labels.
- **Impact in Plain Words:** The Finance Sales Ledger page (`SalesLedgerPage.tsx`) shows zero POS sales in production, and the Suppliers page undercounts supplier purchases by ignoring all synced GRNs.
- **Suggested Fix:**
  1. In `apps/server/src/routes/sales-ledger.ts:121`, accept `inArray(invoices.status, ['finalized', 'completed'])`.
  2. In `apps/server/src/routes/suppliers.ts:162, 701`, check `(row.sourceType === 'purchase' || row.sourceType === 'purchase.received' || row.sourceType === 'po_receipt')`.
- **Regression Test:** Sync a real POS invoice (`status = 'finalized'`) and GRN (`sourceType = 'purchase.received'`) via `POST /api/sync/push`, then assert `GET /api/finance/sales-ledger` returns the invoice and `GET /api/suppliers` increments `totalPurchasesCount`.

---

#### `F-H-09` — Server Proxy Spoofing (`trustProxy: true`), In-Memory Token Revocation Map, Shared JWT Secret Fallback, and Web Bearer Token in `localStorage`
- **Severity:** High
- **Evidence:**
  1. `apps/server/src/app.ts:78`: `trustProxy: true` is unconditionally enabled without `TRUSTED_PROXY_IPS`, allowing direct clients to spoof `X-Forwarded-For: <random-ip>` (bypassing IP rate limiting in `auth.ts:116`) and `X-Forwarded-Proto: https` (bypassing the HTTPS check in `app.ts:95`).
  2. `apps/server/src/auth/jwt.ts:5`: `revokedUserTokenJtis` is an in-process `Map<string, number>()` wiped on server restart, and `POST /api/auth/logout` (`apps/server/src/routes/auth.ts:322-332`) only revokes the current access token JTI without revoking any issued refresh tokens.
  3. `apps/server/src/auth/jwt.ts:81`: `getDeviceJwtSecret()` falls back to `process.env.JWT_SECRET` even when `NODE_ENV === 'production'`.
  4. `apps/web/src/auth/AuthContext.tsx:25, 68`: Stores the bearer JWT in `window.localStorage` (`pos_web_token`) instead of an `HttpOnly; Secure; SameSite=Strict` cookie.
- **Impact in Plain Words:** An attacker can bypass login IP rate-limiting and HTTPS enforcement via `X-Forwarded-*` headers; revoked access tokens become valid again if the server process restarts within 8 hours; and any XSS in the web app can read `localStorage.getItem('pos_web_token')`.
- **Suggested Fix:**
  1. Configure `trustProxy` from `process.env.TRUST_PROXY` (default `false` unless explicitly configured with trusted proxy CIDRs).
  2. Persist revoked token JTIs (or a `users.token_version` / `revoked_tokens` table) in PostgreSQL.
  3. Require a distinct `DEVICE_JWT_SECRET` in `getDeviceJwtSecret()` when `NODE_ENV === 'production'`.
- **Regression Test:** Send 20 failed login requests with rotating `X-Forwarded-For` headers when `TRUST_PROXY` is unset and assert HTTP 429 is triggered on the 11th request.

---

### Medium Findings (`F-M-01` to `F-M-11`)

#### `F-M-01` — Time-Bomb Hardcoded Date `'2026-11-30'` in `prescriptions.test.ts:417, 437`
- **Severity:** Medium
- **Evidence:** `apps/server/src/routes/prescriptions.test.ts:417, 437` hardcodes `expiryDate: '2026-11-30'` and asserts `res30.json().count >= 1` for `/api/prescriptions/expiring-soon?days=25`. Because `GET /api/prescriptions/expiring-soon` compares against `new Date()`, this test fails on any date after `2026-11-05` (`expected 0 to be greater than or equal to 1`).
- **Impact in Plain Words:** `pnpm test` fails deterministically whenever the system clock is after `2026-11-05`.
- **Suggested Fix:** Compute the test prescription's `expiryDate` dynamically relative to `new Date()` (e.g., `today + 20 days`).
- **Regression Test:** Run `pnpm --filter @pos/server test src/routes/prescriptions.test.ts` with system date in 2026-11, 2027-01, and 2028-06.

#### `F-M-02` — `@pos/server` Build Outputs `dist/**/*.test.js`, Doubling Vitest Execution
- **Severity:** Medium
- **Evidence:** `apps/server/tsconfig.json:7` has `"include": ["src/**/*"]` without excluding `src/**/*.test.ts`, and `vitest.config.ts` does not exclude `**/dist/**`. After `pnpm --filter @pos/server build`, `pnpm test` runs 95 test files instead of 65 (every server integration suite runs twice against Postgres).
- **Impact in Plain Words:** Running `pnpm test` after building the server doubles test runtime and causes concurrent Postgres connection contention.
- **Suggested Fix:** Add `"exclude": ["node_modules", "dist", "src/**/*.test.ts"]` to `apps/server/tsconfig.json` and `'**/dist/**'` to `vitest.config.ts` `test.exclude`.
- **Regression Test:** Run `pnpm --filter @pos/server build && pnpm test` and assert exactly 65 test files execute.

#### `F-M-03` — `pnpm audit` High-Severity `minimatch` ReDoS Advisory (`GHSA-g3hv-75wg-m249`)
- **Severity:** Medium
- **Evidence:** `pnpm audit` exits with code `1` due to `minimatch@9.0.9` (`< 11.0.1`) under `@typescript-eslint/typescript-estree`.
- **Impact in Plain Words:** Security audit gate fails with exit code 1.
- **Suggested Fix:** Upgrade `@typescript-eslint/*` or add `"minimatch": ">=11.0.1"` to root `package.json` `pnpm.overrides`.
- **Regression Test:** Run `pnpm audit --audit-level=high` and assert exit code `0`.

#### `F-M-04` — CI Workflow (`.github/workflows/ci.yml`) Missing Format Check, Production Builds, `DEVICE_JWT_SECRET`, and Branch Triggers
- **Severity:** Medium
- **Evidence:** `.github/workflows/ci.yml:3-7, 45-64` only triggers on `main` (ignoring `audit-fixes`), omits `pnpm format:check`, omits `pnpm --filter @pos/server build` / `@pos/web build` / `@pos/desktop package:dir`, and omits `DEVICE_JWT_SECRET`.
- **Impact in Plain Words:** Broken builds, formatting regressions, or broken non-`main` branches are not caught by GitHub Actions CI.
- **Suggested Fix:** Add `pnpm format:check`, production build steps, `DEVICE_JWT_SECRET`, and `branches: ['**']` to `.github/workflows/ci.yml`.
- **Regression Test:** Validate `.github/workflows/ci.yml` includes `format:check`, `build`, and `package:dir` steps.

#### `F-M-05` — Rule 1 Money Violations (`Math.round` / Float Division, `parseFloat` in Web Forms, 14 Duplicate Formatters, `.toFixed(2)`)
- **Severity:** Medium
- **Evidence:**
  - `apps/server/src/services/budget-service.ts:514`, `apps/server/src/routes/expenses.ts:335`, `apps/server/src/routes/payroll.ts:557`, `packages/shared/src/schema/hr.ts:153`, `packages/shared/src/schema/payroll.ts:119,150`: Use `Math.round(...)` on float division instead of `roundHalfUp`.
  - 35+ web input forms (`ExpensesPage.tsx`, `PayrollPage.tsx`, `PaymentsPage.tsx`, `JournalEntriesPage.tsx`, etc.) use `Math.round(parseFloat(val) * 100)` instead of `parsePkrToPaisa`.
  - 14 separate `formatPKR` / `formatPaisa` implementations exist across `apps/web` and `apps/desktop`.
  - `apps/server/src/routes/search.ts:65, 128`: Uses `(inv.totalPaisa / 100).toFixed(2)` instead of `formatPaisa`.
- **Impact in Plain Words:** Float parsing (`parseFloat('19.99') * 100`) and `Math.round` on float division risk 1-paisa rounding discrepancies and bypass `parsePkrToPaisa`'s input validation.
- **Suggested Fix:** Replace all `Math.round` money divisions with `roundHalfUp`, replace web `Math.round(parseFloat(...) * 100)` with `parsePkrToPaisa`, and import `formatPaisa` from `@pos/shared` everywhere.
- **Regression Test:** Grep `apps/` and `packages/` for `Math\.round` and `toFixed` on `*Paisa` variables and assert 0 occurrences.

#### `F-M-06` — Desktop IPC Wrapper Gaps: Unused `schema` Option, Missing PIN Lockout in `verifyOwnerPinForDestructive`, and Hardcoded 3-Role Array
- **Severity:** Medium
- **Evidence:**
  1. `apps/desktop/src/main/ipc/wrapper.ts:21`: Supports `schema?: ZodSchema<TArgs>`, but `0` of the 66 `registerSecureIpcHandler` calls in `apps/desktop/src/main/index.ts` pass `schema:`.
  2. `apps/desktop/src/main/ipc/wrapper.ts:86-98` (`verifyOwnerPinForDestructive`): Queries `SELECT id, role, pin_hash, is_active FROM users` without checking `locked_until` or incrementing `failed_login_attempts` on wrong PIN, allowing unlimited offline brute-forcing of the Owner PIN via `backup:restore` or `sync:DiscardEvent`.
  3. `apps/desktop/src/main/index.ts:138-550` & `auth.ts:15`: Hardcodes `roles: ['cashier', 'pharmacist', 'owner']`, blocking `manager` and `accountant` users synced from the server.
- **Impact in Plain Words:** An authenticated cashier can brute-force the 4–8 digit Owner PIN on a counter via `backup:restore` without triggering lockout, and `manager`/`accountant` users cannot use desktop POS channels.
- **Suggested Fix:** Enforce `locked_until` and `failed_login_attempts` in `verifyOwnerPinForDestructive`, expand `StaffRole` in desktop to all 5 roles, and attach Zod schemas to IPC registrations.
- **Regression Test:** Call `verifyOwnerPinForDestructive` 5 times with a wrong PIN and assert the 6th call with the correct PIN is rejected with lockout error.

#### `F-M-07` — Desktop Master-Data Edits Do Not Emit `outbox` Events & `pullAndApply` Lacks Topological Ordering
- **Severity:** Medium
- **Evidence:**
  1. `apps/desktop/src/main/products.ts:216,261,336` (`createProduct`, `updateProduct`, `importProductsFromCsv`), `purchasing.ts:82,117` (`createSupplier`, `updateSupplier`), and `auth.ts:471,523` (`createStaffMember`, `updateStaffMember`) mutate local SQLite without inserting `outbox` events.
  2. `apps/desktop/src/main/sync/core/pullAndApply.ts:524` applies `changes` strictly in `seq` order without sorting parent entities (`branch`, `tax_category`, `product`, `supplier`) before child entities (`counter`, `batch`, `stock_movement`).
- **Impact in Plain Words:** Products, suppliers, or staff edited locally on a counter never sync to the server and get overwritten on the next pull.
- **Suggested Fix:** Either make master-data management server-driven (read-only on counter except during initial setup) or emit master-data sync events, and sort `changes` in `pullAndApply.ts` by entity dependency priority within each batch before fallback to `seq`.
- **Regression Test:** Feed `pullAndApply` a batch where a `batch` row has `seq: 1` and its parent `product` row has `seq: 2` under `PRAGMA foreign_keys = ON`, and assert both apply cleanly.

#### `F-M-08` — Unhandled `Schema.parse()` 500s in `cash-bank.ts`, Missing `:id` UUID Validation, Unlimited Repeats on Fulfilled/Cancelled Prescriptions, Dead Test Header in `finance.ts`, and Unescaped Receipt Batch/Invoice Fields
- **Severity:** Medium
- **Evidence:**
  1. `apps/server/src/routes/cash-bank.ts:152,260,375,510,648,805`: Uses `.parse(request.body)` without `safeParse`, returning HTTP 500 instead of 400 on validation failure.
  2. 20+ `:id` routes across `cash-bank.ts`, `customers.ts`, `prescriptions.ts`, `purchase-orders.ts`, `stock-transfers.ts`, `stock-counts.ts`, `supplier-returns.ts`, `hr-leave.ts`, `payroll.ts`, and `notifications.ts` omit UUID validation on `request.params.id`, throwing Postgres `22P02` (HTTP 500) on non-UUID `:id`.
  3. `POST /api/prescriptions/:id/dispense` (`apps/server/src/routes/prescriptions.ts:710-731`): Only blocks `status === 'expired'`; allows dispensing against `'cancelled'` or `'fulfilled'` prescriptions and never checks `prescription.repeatsUsed >= prescription.repeatsAllowed`.
  4. `apps/server/src/routes/finance.ts:256-262`: Production code checks `if (line.memo === 'Force-Simulated-Failure') throw new Error(...)`.
  5. `apps/desktop/src/main/receipts.ts:113, 151, 387`: Interpolates `line.batchNo`, `line.expiryDate`, `data.invoiceNumber`, and `data.fiscalInvoiceNumber` into receipt HTML without `escapeHtml()`.
- **Impact in Plain Words:** Invalid payloads to `/api/finance/cash-bank/*` or non-UUID `:id` params return 500 errors, and fulfilled/cancelled prescriptions can be dispensed repeatedly beyond `repeatsAllowed`.
- **Suggested Fix:** Replace `.parse()` with `.safeParse()` in `cash-bank.ts`, validate `:id` with `z.string().uuid()`, block dispensing when `status === 'cancelled' || status === 'fulfilled' || repeatsUsed >= repeatsAllowed`, remove the `Force-Simulated-Failure` check from `finance.ts`, and wrap `batchNo`/`invoiceNumber` in `escapeHtml()`.
- **Regression Test:** Attempt to dispense a prescription with `status = 'cancelled'` or `repeatsUsed === repeatsAllowed` and assert HTTP 400.

#### `F-M-09` — `restoreDatabaseBackup` Lacks Schema Version Check & Post-Restore Invoices Collide on `uq_invoices_pharmacy_number`
- **Severity:** Medium
- **Evidence:**
  1. `apps/desktop/src/main/backup.ts:231-243`: `restoreDatabaseBackup` checks `PRAGMA integrity_check` on `tempDb` but never validates `app_meta.schema_version` or `schema_migrations` against `MIGRATIONS.length`.
  2. When a counter restores a backup taken at `last_invoice_seq = N` after invoice `N + 1` was already synced to the server, the counter's next sale re-uses `invoiceNumber = C1-0000(N+1)` with a new invoice UUID. When pushed to the server, `invoices` throws Postgres `23505` (`uq_invoices_pharmacy_number`), which `apps/server/src/sync/service.ts:23, 197` classifies as permanent `status: 'rejected', code: 'INTERNAL_ERROR'`.
  - **Reproduced in:** `tests/audit-final/stage6-backup-restore.test.ts:276-409`.
- **Impact in Plain Words:** Restoring an older backup on a counter causes all subsequent sales to collide with already-synced invoice numbers on the server and be permanently rejected into `sync_exceptions` until `last_invoice_seq` exceeds the server's max sequence.
- **Suggested Fix:**
  1. Reject backups in `restoreDatabaseBackup` whose `schema_version > MIGRATIONS.length`.
  2. Have `applyInvoiceCreated` / `applyCreditNoteCreated` write the updated `counter` row (`lastInvoiceSeq`, `lastCreditNoteSeq`) to `change_log` (or advance `counters.last_invoice_seq` on `pullAndApply` using `MAX(existing, incoming)`), and require a pull sync after restore.
- **Regression Test:** See `tests/audit-final/stage6-backup-restore.test.ts` (`6.2 REPRODUCE F-M-09`).

#### `F-M-10` — Web UX Deep-Link Bugs (`CommandPalette` & `NotificationBell`), 11 Unbounded List/Report Queries, and N+1 Query Loops
- **Severity:** Medium
- **Evidence:**
  1. `apps/server/src/routes/search.ts:67`: Returns `link: '/sales-ledger?invoiceId=...'` instead of `'/finance-sales-ledger'`, causing `CommandPalette` invoice clicks to fall through `App.tsx:135` to `<OverviewPage />`.
  2. `apps/web/src/layout/DashboardLayout.tsx:150`: `handleNavigate` strips `?customerId=...` / `?productId=...` query strings without passing them to the target page.
  3. `apps/server/src/services/notification-service.ts:115-246`: Alerts on expiring batches with `0` stock (`lines 115-125`) and creates `'sync_exceptions'` / `'period_close'` notifications for all users regardless of role permissions.
  4. 11 list/report endpoints lack `LIMIT`/pagination (`customers.ts:75`, `payments.ts:993`, `purchase-orders.ts:276`, `stock-transfers.ts:154`, `stock-counts.ts:127`, `supplier-returns.ts:166`, `prescriptions.ts:183`, `payroll.ts:87`, `sales-ledger.ts:116`, `reports.ts:155,250`).
  5. N+1 query loops in `GET /api/finance/unpaid-documents` (`payments.ts:105-253`) and `GET /api/hr/leave/allocations` (`hr-leave.ts:230-266`).
- **Impact in Plain Words:** Clicking an invoice in `Ctrl+K` search navigates to the wrong page, cashiers receive admin/finance notifications that lead to `403 Forbidden`, and list/unpaid-document endpoints degrade linearly (`O(N)` SQL queries) as data grows.
- **Suggested Fix:** Change `/sales-ledger` to `/finance-sales-ledger` in `search.ts:67`, filter `refreshSystemNotifications` by positive batch stock and user role permissions, replace N+1 loops in `payments.ts` and `hr-leave.ts` with single `GROUP BY` / batch queries, and add `limit`/`offset` pagination to the 11 list endpoints.
- **Regression Test:** Search for an invoice via `GET /api/search?q=INV` and assert `results[0].link` starts with `'/finance-sales-ledger'`.

#### `F-M-11` — DRAP & FBR Regulatory Gaps: Unenforced `is_controlled` POS Checkout, Legacy `invoices:create` Bypassing `allocateFefo`, Missing Pharmacy `ntn`/`strn` Columns, and Missing Batch Recall Report
- **Severity:** Medium
- **Evidence:**
  1. `apps/desktop/src/main/finalizeSale.ts:445-469`: Loads `prod.is_controlled`, but never requires a prescription reference, patient name, or doctor name when `prod.is_controlled === 1`.
  2. `apps/desktop/src/main/invoices.ts:97-115, 178-205` (`createInvoice`, bound to IPC channel `invoices:create`): Bypasses `allocateFefo`, does not filter `b.expiry_date >= today`, falls back to 0-balance batches (`fallbackBatchStmt`), and uses non-counter-scoped `INV-YYYYMMDD-XXXX` invoice numbers.
  3. `apps/server/src/db/schema.ts:18-44`: `pharmacies` and `branches` tables lack `ntn`, `strn`, and `drugSaleLicenseNo` columns.
  4. No dedicated DRAP batch recall endpoint/report exists to list all customers/invoices that purchased a recalled `batch_no`.
- **Impact in Plain Words:** Controlled substances can be sold at the POS without recording patient/doctor/prescription details, calling `invoices:create` can allocate expired batches, and a DRAP batch recall requires manual SQL queries to identify affected invoices.
- **Suggested Fix:** Require `notes` / prescription metadata in `finalizeSale` when any line has `is_controlled === 1`, remove or refactor legacy `invoices:create` to delegate to `finalizeSale`, add `ntn`/`strn`/`drugSaleLicenseNo` to `pharmacies`/`branches`, and add `GET /api/reports/batch-recall?batchNo=...`.
- **Regression Test:** Call `finalizeSale` with a product where `is_controlled = 1` and empty `notes`/prescription info, and assert it throws a controlled-substance validation error.

---

### Low Findings (`F-L-01` to `F-L-02`)

#### `F-L-01` — Missing `.gitattributes` Causes `pnpm format:check` to Fail on 371 Files in Clean Windows Clone
- **Severity:** Low
- **Evidence:** No `.gitattributes` file exists at the repo root; `.prettierrc` specifies `"endOfLine": "lf"`. On Windows with default `core.autocrlf=true`, `git clone` checks out `CRLF` line endings and `pnpm format:check` fails on 371 files.
- **Impact in Plain Words:** Windows developers cloning the repository immediately see 371 Prettier failures until line endings are normalized.
- **Suggested Fix:** Add `.gitattributes` with `* text=auto eol=lf`.
- **Regression Test:** Clone repo on Windows and assert `pnpm format:check` exits with `0`.

#### `F-L-02` — Deprecated `pnpm.onlyBuiltDependencies` in Root `package.json` & Parallel Electron Zip Extraction Race
- **Severity:** Low
- **Evidence:** Root `package.json:20-25` defines `onlyBuiltDependencies` and `ignoredBuiltDependencies` under `pnpm` instead of `pnpm-workspace.yaml` (printing a deprecation warning on every `pnpm` command), and running `pnpm test` before Electron's binary is extracted in `apps/desktop` can race when multiple Vitest workers run `install.js` concurrently.
- **Suggested Fix:** Move `onlyBuiltDependencies` and `ignoredBuiltDependencies` to `pnpm-workspace.yaml`.
- **Regression Test:** Run `pnpm install` and assert no `deprecated field` warning is printed.

---

## 5. Earlier Audit Verification Table (`docs/AUDIT_A1_FINAL.md` Re-Verification)

Every finding from the earlier audit (`docs/AUDIT_A1_FINAL.md` and `docs/AUDIT_A1_STAGE1.md`..`STAGE5.md`) was re-verified directly against current source code and tests:

| Earlier ID | Earlier Title | Current Status | Verification Evidence (`file:line`) |
|---|---|---|---|
| `C-01` | Hardcoded fallback JWT secret & DB URL | **FIXED (Partial caveat `F-H-09`)** | `apps/server/src/auth/jwt.ts:62-75` & `apps/server/src/db/index.ts:13-32` throw `FATAL` in production if `JWT_SECRET` (`< 32` chars) or `DATABASE_URL` is missing/default. Caveat (`F-H-09`): `getDeviceJwtSecret()` (`jwt.ts:81`) still falls back to `JWT_SECRET`. |
| `C-02` | Login no rate limit, optional `pharmacyCode`, no unique `(pharmacy_id, name)`, deactivated-before-PIN leak | **FIXED** | `apps/server/src/routes/auth.ts:105-205` enforces IP & account rate limits, requires `pharmacyCode`, runs `bcrypt.compare` against `DUMMY_PIN_HASH` before checking `isActive`, and `schema.ts:72` enforces `uq_users_pharmacy_name`. |
| `C-03` | Desktop `completeSetup` re-runnable without auth | **FIXED** | `apps/desktop/src/main/auth.ts:288-296` checks `setup_completed === 'true'` inside an `.immediate()` transaction and throws `Initial setup has already been completed`. |
| `H-01` | Unguarded desktop IPC (`products:seed`, `backup:*`, `system:export-diagnostics`, unauthenticated reads) | **FIXED (Partial caveat `F-M-06`)** | `apps/desktop/src/main/index.ts:106-550` wraps all 66 channels in `registerSecureIpcHandler` and gates `products:seed` on `app.isPackaged`. Caveat (`F-M-06`): `verifyOwnerPinForDestructive` lacks lockout tracking. |
| `H-02` | Server default port `3001` vs `3000` everywhere else | **FIXED** | `apps/server/src/index.ts:8` defaults `process.env.PORT || 3000`. |
| `H-03` | Sync service turns transient errors into permanent `rejected` / leaks raw error messages | **FIXED** | `apps/server/src/sync/service.ts:23-39, 179-201` classifies `40001`/`40P01`/`53300`/`08*` as `retry_later` and returns sanitized error messages. |
| `H-04` | CORS allows any origin with credentials | **FIXED** | `apps/server/src/app.ts:110-137` requires explicit `CORS_ORIGIN` whitelist in production and blocks wildcard with credentials. |
| `M-01` | Admin routes don't validate `branchId`/`counterId` ownership or `expiresInHours` | **FIXED** | `apps/server/src/routes/admin.ts:34, 427-460` validates `expiresInHours` (`min(1).max(168)`) and scopes `branchId`/`counterId` to `userContext.pharmacyId`. |
| `M-02` | Owner can demote/deactivate self or last owner; role changes not audited | **FIXED (Test gap `M-12`)** | `apps/server/src/routes/admin.ts:245-272, 315` blocks self-demotion and last-owner deactivation and writes `audit_logs`. (Note: Mutation `M-12` showed no test actually calls `PATCH /api/admin/users/:id` for this path.) |
| `M-03` | `/test/protected-action` exposed in production | **FIXED** | `apps/server/src/routes/auth.ts:413` gates `/test/protected-action` behind `if (process.env.NODE_ENV === 'test')`. |
| `M-04` | Shared secret for device & user tokens, no `aud`/`typ` claims | **FIXED (Partial caveat `F-H-09`)** | `apps/server/src/auth/jwt.ts:103-190` enforces `aud: 'pos-user'` / `typ: 'user'` vs `aud: 'pos-device'` / `typ: 'device'`. |
| `M-05` | Weak 32-bit device registration codes | **FIXED** | `apps/server/src/routes/admin.ts:471` uses `crypto.randomBytes(8)` (64-bit entropy, 16 hex chars). |
| `M-06` | Synchronous `bcrypt.*Sync` calls blocking event loop | **FIXED** | `apps/server/src/routes/auth.ts:144` and `admin.ts:169, 283` use async `await bcrypt.hash` / `await bcrypt.compare`. |
| `M-07` | No desktop PIN lockout | **FIXED on `auth:login`, OPEN on `verifyOwnerPinForDestructive` (`F-M-06`)** | `apps/desktop/src/main/auth.ts:207-260` enforces 5-attempt lockout with exponential backoff on `loginWithPin`, but `wrapper.ts:86` skips it for destructive Owner PIN checks. |
| `M-08` | No TLS enforcement in production | **FIXED (Caveat `F-H-09`)** | `apps/server/src/app.ts:94-106` rejects HTTP requests in production when `ENFORCE_TLS !== 'false'`. |
| `L-01`..`L-05` | Duplicate IPC aliases, plain token fallback, `console.log`, README, Prettier | **FIXED** | Verified across `preload/index.ts`, `tokenStore.ts`, `logger.ts`, and `README.md`. |

---

## 6. Mutation Check Table (Stage 8)

All 12 mutations were executed in `$env:TEMP\pos-final-audit-clone` and reverted:

| ID | File & Line | Mutation Applied | Target Test Suite | Result | Evidence / Why |
|---|---|---|---|---|---|
| `M-01` | `apps/server/src/reports/queries.ts:271,298,302` | Removed `params.pharmacyId` filter from `getSalesReport` | `tenant-isolation.test.ts` & `reports.test.ts` | **`SURVIVED`** | `22 passed` & `16 passed`. Neither suite asserts that `GET /api/reports/sales` without query params excludes Tenant B's seeded invoices. |
| `M-02` | `apps/server/src/ledger/posting-engine.ts:189` | Changed `debitPaisa: inventoryCostPaisa` to `0` on `1200 Inventory` | `posting-engine.test.ts` | **`KILLED`** | `3 failed | 6 passed (9)`. Unbalanced entry & inventory balance checks failed. |
| `M-03` | `packages/shared/src/money.ts:91` | Changed `Math.floor(denominator / 2)` to `Math.floor((denominator - 1) / 2)` | `money.test.ts` | **`KILLED`** | `1 failed | 26 passed (27)`. Exact half-up boundary test failed. |
| `M-04` | `packages/shared/src/fefo.ts:86` | Inverted `expiryDate` sort (`return 1` instead of `-1`) | `fefo.test.ts` | **`KILLED`** | `4 failed | 14 passed (18)`. Earliest-expiry allocation tests failed. |
| `M-05` | `apps/server/src/ledger/service.ts:246` | Disabled app-level closed-period check (`if (false && closedPeriods.length > 0)`) | `ledger.test.ts` | **`KILLED` by DB trigger (`SURVIVED` app layer)** | `13 passed (13)` because Postgres trigger `trg_prevent_posting_into_closed_period` still threw `/closed/i`. |
| `M-06` | `apps/server/src/auth/user-auth.ts:93` | Disabled `hasPermission(role, permission)` check | `permission-guard.test.ts` | **`KILLED`** | `4 failed | 3 passed (7)`. RBAC 403 tests failed. |
| `M-07` | `apps/server/src/sync/service.ts:80` | Disabled `if (inserted.length === 0)` idempotency check | `sync-push.test.ts` | **`KILLED`** | `1 failed | 9 passed (10)`. Duplicate event replay test failed. |
| `M-08` | `apps/server/src/routes/auth.ts:176` | Changed `if (newAttempts >= 5)` to `>= 999` | `stage2-server-security.test.ts` | **`KILLED`** | `1 failed | 10 passed (11)`. 5-attempt lockout test failed. |
| `M-09` | `apps/server/src/routes/payments.ts:33` | Removed `.min(1)` on `amountPaisa` | `payments.test.ts` | **`SURVIVED`** | `7 passed (7)`. No negative/zero `amountPaisa` test in `payments.test.ts`. |
| `M-10` | `packages/shared/src/schema/payroll.ts:119` | Changed `taxFromExcess` to `0` | `payroll.test.ts` | **`KILLED`** | `1 failed | 5 passed (6)`. Progressive slab tax test failed. |
| `M-11` | `apps/server/src/ledger/service.ts:148` | Disabled `totalDebitPaisa !== totalCreditPaisa` check | `ledger.test.ts` | **`KILLED`** | `1 failed | 12 passed (13)`. Unbalanced journal test failed. |
| `M-12` | `apps/server/src/routes/admin.ts:245` | Disabled owner self-demotion & last-owner check | `stage2-server-security.test.ts` & `audit-fixes.test.ts` | **`SURVIVED`** | `11 passed` & `10 passed`. No test calls `PATCH /api/admin/users/:id` to demote/deactivate an owner. |

---

## 7. Performance and Scale Numbers

Measured on the local audit machine (Windows, PostgreSQL 16, SQLite 3 WAL):

| Benchmark / Workload | Scale | Measured Time | Result |
|---|---|---|---|
| **2-Counter Full Accounting Simulation (`stage3-ledger-simulation.test.ts`)** | `5,050` documents -> `5,032` journal entries (`~14,500` journal lines) | `54.8s` (`~10.8 ms` / document including full DB tx + ledger posting) | `PASS` |
| **Trial Balance (`getTrialBalance`)** | `100,001` `journal_lines` (`33,333` `journal_entries`) | **`87.75 ms`** | `PASS` (`< 2,000 ms` threshold) |
| **Profit & Loss (`getProfitAndLoss`)** | `100,001` `journal_lines` | **`68.25 ms`** | `PASS` (`< 2,000 ms` threshold) |
| **Balance Sheet (`getBalanceSheet`)** | `100,001` `journal_lines` | **`65.24 ms`** | `PASS` (`< 2,000 ms` threshold) |
| **Cash Flow Statement (`getCashFlowStatement`)** | `100,001` `journal_lines` | **`112.16 ms`** | `PASS` (`< 2,000 ms` threshold) |
| **General Ledger Account Detail (`getGeneralLedger` on `1000 Cash`)** | `33,334` lines on `1000 Cash` (`100,001` total lines) | **`139.96 ms`** | `PASS` (`< 2,000 ms` threshold) |
| **100 Offline Sales + Crash Recovery (`stage4-sync-resilience.test.ts`)** | `100` sales (`300+` rows) on on-disk WAL SQLite | **`0.42s`** (`~4.2 ms` / offline sale) | `PASS` |
| **20-Iteration 2-Counter Contention + Sync Loop (`stage4-sync-resilience.test.ts`)** | `40` sales + `60` push/pull cycles + `>10` network retries | **`3.85s`** | `PASS` |
| **20,000-Product Desktop Seed & Barcode/Prefix Search (`seed20k.ts`, `products.ts:75-140`)** | `20,000` products + `40,000` batches + `40,000` movements | Indexed by `idx_products_barcode` & `idx_products_brand_name` (`LIMIT 50`) | `PASS` |

---

## 8. What Was NOT Verified (and Why)

Per the audit rules ("If you did not read it or run it, write `NOT VERIFIED`"):

1. **`NOT VERIFIED` — Clean Windows 10/11 VM Installation of the Full NSIS `.exe` Installer:**
   - We built and verified the packaged unpacked desktop bundle (`apps/desktop/dist-release/win-unpacked/HexaPharm.exe` and `resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node`) via `pnpm --filter @pos/desktop package:dir`, but did not execute the NSIS installer inside a separate clean Windows VM without developer tools installed.
2. **`NOT VERIFIED` — Physical USB/Serial Thermal Receipt Printer Hardware Output (80mm & 58mm):**
   - We verified the HTML thermal receipt generator (`apps/desktop/src/main/receipts.ts`) and silent `BrowserWindow.webContents.print` harness (`receipt-and-invoices.test.ts`) across 80mm (`72mm` printable) and 58mm (`48mm` printable) layouts in English and Urdu, but no physical thermal printer was attached to this host.
3. **`NOT VERIFIED` — Physical USB HID Barcode Scanner Hardware Scan:**
   - We verified the inter-keystroke timing buffer (`apps/desktop/src/renderer/utils/barcodeScanner.ts`, `<= 40ms` threshold + `Enter` termination), but no physical USB HID barcode scanner was attached to this host.

---

## 9. Prioritized Remediation Plan Before Production Launch

### Phase A: Blockers (Must Fix Before Any Production Deployment — `F-C-01`..`F-C-03`, `F-H-01`..`F-H-09`)
1. **Desktop Startup (`F-C-01`):** Remove `seedDatabase()` from `app.whenReady()` in `apps/desktop/src/main/index.ts:597`.
2. **Migration Journal (`F-H-01`):** Add `0021_notifications_and_audit_logs` to `apps/server/drizzle/meta/_journal.json`.
3. **Reversal Accounting & Year-End Idempotency (`F-C-02`):** Include `'reversed'` journal entries in `ar.ts`, `ap.ts`, `suppliers.ts`, and `period-close.ts` queries (or insert reversal entries as `'posted'`), and make `executeYearEndClosing` idempotent per `(pharmacyId, fiscalYear)`.
4. **AR/AP Subledger Completeness (`F-C-03`):** Attach `partyType: 'customer', partyId` on credit returns (`postCreditNoteCreated`), require `supplierId` (or use `2200 Accrued Expenses`) on credit expenses (`postExpenseCompleted`), and post opening balance journal entries in `applyCustomerCreated` and `POST /api/finance/customers`.
5. **Sales Ledger & Supplier Status/Source Filters (`F-H-08`):** Fix `sales-ledger.ts:121` to include `'finalized'` invoices and `suppliers.ts:162,701` to include `'purchase.received'` and `'po_receipt'`.
6. **Payroll Ledger & Advance Accounting (`F-H-03`):** Route `postPayrollRunToLedger` and `postPayrollPaymentBatch` through `postJournalEntry`, and post a disbursement journal entry (`Dr 2300 / Cr 1000|1010`) in `POST /api/hr/advances`.
7. **Transaction Boundaries (`F-H-02`):** Wrap all 14 multi-table write handlers in `db.transaction()`.
8. **Inventory Sync & Transfer Validation (`F-H-05`, `F-H-06`, `F-H-07`):** Add `insertChangeLog` calls to `purchase-orders.ts` (`receive`), `stock.ts` (`write-off`, `discount`), and `stock-transfers.ts` (`cancel`); preserve `purchase.createdAt` in `applyPurchaseReceived`; enforce quantity/stock checks in `stock-transfers.ts`; and add `customer` pull support + credit sale tables in `apps/desktop`.
9. **Business Date Timezone (`F-H-04`):** Replace all 75 `new Date().toISOString().slice(0, 10)` occurrences with `getKarachiBusinessDate()` / `toKarachiBusinessDate()`.
10. **Auth & Proxy Hardening (`F-H-09`):** Make `trustProxy` opt-in via env, move JWT JTI revocation to Postgres, and require a distinct `DEVICE_JWT_SECRET` in production.

### Phase B: Pre-Launch Quality, Security & Regulatory Hardening (`F-M-01`..`F-M-11`, `F-L-01`..`F-L-02`)
1. Fix hardcoded date in `prescriptions.test.ts` (`F-M-01`), exclude `*.test.ts` from `apps/server/tsconfig.json` (`F-M-02`), override `minimatch >= 11.0.1` (`F-M-03`), add `.gitattributes` (`F-L-01`), and update `.github/workflows/ci.yml` (`F-M-04`).
2. Replace remaining `Math.round` / `parseFloat` money conversions with `roundHalfUp` and `parsePkrToPaisa` (`F-M-05`).
3. Add PIN lockout tracking to `verifyOwnerPinForDestructive`, allow all 5 roles on desktop IPC, and attach Zod schemas to `registerSecureIpcHandler` (`F-M-06`).
4. Sync counter `last_invoice_seq` via `change_log` and check `schema_version` before backup restore (`F-M-09`).
5. Fix `/finance-sales-ledger` search link, notification filtering, N+1 queries, and list pagination (`F-M-10`).
6. Enforce prescription/patient/doctor capture for `is_controlled = 1` products in `finalizeSale`, remove/refactor legacy `invoices:create`, add `ntn`/`strn` to `pharmacies`, and add a batch recall report (`F-M-11`).
7. Add regression tests for the 3 surviving mutations (`M-01` report tenant isolation, `M-09` non-positive payment amount, `M-12` owner self-demotion).

