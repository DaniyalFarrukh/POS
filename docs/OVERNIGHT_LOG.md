# HexaPharm POS — Overnight Autonomous Remediation Log

- **Branch:** `overnight-fixes`
- **Baseline Commit:** `7cbfd6c` (`120fcf7` + final audit baseline)
- **Baseline Test Suite Count:** `68` test files (`65` existing + `3` in `tests/audit-final/`), `1,012` tests (`1,003` + `9`), `0` skipped.

---

## Task Checklist & Progress
- **BATCH 0: Green CI and Quick Wins**
  - [x] `F-C-01`: Guard `seedDatabase()` (`!app.isPackaged` AND explicit dev flag `POS_AUTO_SEED === 'true'`) + safe owner-only demo-data cleanup tool (backup first, dry-run default) + tests
  - [x] `F-H-01`: Register `0021_notifications_and_audit_logs` properly in Drizzle journal and test migrations on empty + previous-version DB
  - [x] `F-M-01`: Replace hardcoded dates in `prescriptions.test.ts` with dynamic dates relative to test clock
  - [x] `F-M-02`: Exclude `*.test.ts` from `@pos/server` build output (`tsconfig.json` & `vitest.config.ts`)
  - [x] `F-M-03`: Fix `minimatch` vulnerability so `pnpm audit` exits `0`
  - [ ] `F-M-04`: Update `.github/workflows/ci.yml` (`format:check`, `lint`, `typecheck`, tests with Postgres & `DEVICE_JWT_SECRET`, `pnpm audit`, production builds, all branches/PRs)
  - [ ] `F-L-01` & `F-L-02`: Add `.gitattributes` (`eol=lf`), move `pnpm` build settings to `pnpm-workspace.yaml`, fix Electron extraction race
- **BATCH 1: Ledger Correctness (HIGH RISK — `NEEDS-REVIEW`)**
  - [ ] `F-C-02`, `F-C-03`, `F-H-03`, `F-H-08` per `D1` & `D2` + convert `stage3-ledger-simulation.test.ts` reproductions to regression assertions + repair script (dry-run default)
- **BATCH 2: Dates and Transactions**
  - [ ] `F-H-04`: Shared Karachi business-date helpers, replace all 75 UTC `.toISOString().slice(0, 10)` uses, ESLint rule forbidding pattern, boundary tests (`23:30`, `00:30`, `04:30`, `05:30` PKT)
  - [ ] `F-H-02` & `F-M-08`: Wrap 14 multi-table write handlers in `db.transaction()` with failure-injection tests; `cash-bank.ts` 400s on Zod errors, `:id` UUID validation, prescription repeat caps, receipt HTML escaping, remove dead test code in `finance.ts`
- **BATCH 3: Sync Completeness**
  - [ ] `F-H-05` & `F-H-06`: Server stock transfer validation/movements/`change_log`, PO receive & batch write-off/discount `change_log`, `applyPurchaseReceived` preserves `createdAt`, intra-branch shortages
  - [ ] `F-M-09`: `restoreDatabaseBackup` schema version check + `restore_epoch` (`{counterCode}-R{epoch}-{seq}`) + `device_seq` +1,000,000 (`NEEDS-REVIEW`)
  - [ ] `F-H-07` & `F-M-07`: Desktop customers, credit sales, customer receipts, product/supplier counter creation sync, topological FK ordering in `pullAndApply` (`NEEDS-REVIEW`)
- **BATCH 4: Security**
  - [ ] `F-H-09`: Opt-in `trustProxy`, DB-persisted JWT revocation, fail-fast `DEVICE_JWT_SECRET` in production, `httpOnly` `SameSite=Strict` cookie + CSRF + CSP for web auth
  - [ ] `F-M-06`: Zod schemas on all desktop IPC handlers, lockout in `verifyOwnerPinForDestructive`, 5 roles (`owner`, `manager`, `accountant`, `pharmacist`, `cashier`) in desktop
- **BATCH 5: Remaining Mediums**
  - [ ] `F-M-05`: Shared money parser/formatter replacing `parseFloat`, `toFixed`, and `Math.round` on money + ESLint rule
  - [ ] `F-M-10`: Fix `/finance-sales-ledger` search link & query params, scope notifications & stop 0-stock alerts, paginate 11 queries, remove N+1 loops
  - [ ] `F-M-11`: Enforce `is_controlled` at checkout in `finalizeSale`, remove legacy `invoices:create`, add pharmacy `ntn`/`strn`, add batch recall report

---

## Execution Log

### Task 0.1 — `F-C-01`: Guard `seedDatabase()` & Safe Demo-Data Cleanup Tool
- **Finding IDs:** `F-C-01`
- **Status:** `FIXED`
- **Files Changed:**
  - `apps/desktop/src/main/db/seed.ts`
  - `apps/desktop/src/main/index.ts`
  - `apps/desktop/src/main/backup.ts`
  - `apps/desktop/src/main/db/seed.test.ts` (added)
- **Tests Added:** `apps/desktop/src/main/db/seed.test.ts` (`3` tests: packaged build refusal, startup auto-seed requiring `!isPackaged && POS_DEV_AUTO_SEED=true`, and `cleanupDemoData` owner-only / dry-run default / backup-first / reference preservation).
- **Test Results:** `seed.test.ts`: `3 passed (3)`; `eslint`: `0 errors`; `tsc --noEmit`: `0 errors`.
- **Decisions Made:**
  - `seedDatabase()` throws immediately if `isPackaged` is true.
  - `runStartupAutoSeed()` only seeds when `!isPackaged` AND (`POS_DEV_AUTO_SEED === 'true'` or `POS_AUTO_SEED === 'true'`).
  - `cleanupDemoData()` is written and tested on test databases only (never executed on user data), requires `userRole === 'owner'`, defaults to `dryRun: true`, takes a pre-cleanup safety backup before deleting when `dryRun: false`, and skips any demo product/supplier referenced by batches, stock movements, invoice lines, or purchases.
- **NEEDS-REVIEW:** None.

### Task 0.2 — `F-H-01`: Register `0021_notifications_and_audit_logs` in Drizzle Journal
- **Finding IDs:** `F-H-01`
- **Status:** `FIXED`
- **Files Changed:**
  - `apps/server/drizzle/meta/_journal.json`
  - `apps/server/src/db/db.test.ts`
- **Tests Added:** `F-H-01` test in `apps/server/src/db/db.test.ts` verifying `_journal.json` completeness against `drizzle/*.sql` and running `migrate()` on both an empty schema and a schema at migration `idx: 20`.
- **Test Results:** `db.test.ts`: `6 passed (6)`; `eslint`: `0 errors`; `tsc --noEmit`: `0 errors`.
- **Decisions Made:** Regenerated `0021_notifications_and_audit_logs` entry via `drizzle-kit generate --custom --name=notifications_and_audit_logs` rather than hand-editing `_journal.json`.
- **NEEDS-REVIEW:** None.

### Task 0.3 — `F-M-01`: Dynamic Dates Relative to Test Clock in `prescriptions.test.ts`
- **Finding IDs:** `F-M-01`
- **Status:** `FIXED`
- **Files Changed:**
  - `apps/server/src/routes/prescriptions.test.ts`
- **Tests Added:** Updated `dispenses prescription against sale invoice` and `refill reminders endpoint` tests in `apps/server/src/routes/prescriptions.test.ts` to compute `nextRefillDate` relative to `getKarachiBusinessDate()`.
- **Test Results:** `prescriptions.test.ts`: `7 passed (7)`; `eslint`: `0 errors`; `tsc --noEmit`: `0 errors`.
- **Decisions Made:** None.
- **NEEDS-REVIEW:** None.

### Task 0.4 — `F-M-02`: Exclude `*.test.ts` from Build Output & `**/dist/**` from Vitest
- **Finding IDs:** `F-M-02`
- **Status:** `FIXED`
- **Files Changed:**
  - `apps/server/tsconfig.json`
  - `packages/shared/tsconfig.json`
  - `vitest.config.ts`
  - `apps/server/src/app.test.ts`
- **Tests Added:** `F-M-02` test in `apps/server/src/app.test.ts` verifying `exclude` in `apps/server/tsconfig.json` and `vitest.config.ts`.
- **Test Results:** `app.test.ts`: `2 passed (2)`; `dist test files count`: `0`; `eslint`: `0 errors`; `tsc`: `0 errors`.
- **Decisions Made:** Excluded `src/**/*.test.ts` in both `apps/server/tsconfig.json` and `packages/shared/tsconfig.json`, and excluded `**/dist/**`, `**/dist-electron/**`, `**/dist-release/**` in root `vitest.config.ts`.
- **NEEDS-REVIEW:** None.

### Task 0.5 — `F-M-03`: Fix `minimatch` Vulnerability (`GHSA-g3hv-75wg-m249`)
- **Finding IDs:** `F-M-03`
- **Status:** `FIXED`
- **Files Changed:**
  - `pnpm-workspace.yaml`
  - `pnpm-lock.yaml`
  - `apps/server/src/app.test.ts`
- **Tests Added:** `F-M-03` test in `apps/server/src/app.test.ts` asserting `minimatch: '>=11.0.1'` override in `pnpm-workspace.yaml`.
- **Test Results:** `pnpm audit`: `No known vulnerabilities found (exit code 0)`; `app.test.ts`: `3 passed (3)`; `typecheck`: `0 errors`.
- **Decisions Made:** Added `minimatch: '>=11.0.1'` to `pnpm-workspace.yaml` `overrides` and updated `pnpm-lock.yaml`.
- **NEEDS-REVIEW:** None.
