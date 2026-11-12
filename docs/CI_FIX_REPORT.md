# GitHub Actions CI Verification & Fix Report

**Branch:** `overnight-fixes`  
**Target Workflow:** `.github/workflows/ci.yml`  
**Status:** ALL CHECKS PASSING (100% Green)  
**Date:** 2026-11-12  

---

## 1. Final CI Run Summary

- **Final Verification Run ID:** `43129470888`
- **Final Verification Run URL:** [https://github.com/DaniyalFarrukh/POS/actions/runs/43129470888](https://github.com/DaniyalFarrukh/POS/actions/runs/43129470888)
- **Final Verification Commit SHA:** `6471a98` (`docs: author final CI fix report`)
- **Fix Baseline Run ID:** `43128716666` ([https://github.com/DaniyalFarrukh/POS/actions/runs/43128716666](https://github.com/DaniyalFarrukh/POS/actions/runs/43128716666))
- **Fix Baseline Commit SHA:** `0cbc41b` (`fix(ci): specify postgres healthcheck user and db and pin pnpm version`)
- **Workflow Run Conclusion:** `success` (100% Passing)
- **Total Workflow Duration:** 4m 54s

---

## 2. Workflow Steps and Execution Times

| Step # | Step Name | Status | Duration |
|:---|:---|:---:|:---:|
| 1 | Set up job | Success | 1s |
| 2 | Initialize containers (Postgres 16 Alpine) | Success | 10s |
| 3 | Checkout repository (`actions/checkout@v4`) | Success | 1s |
| 4 | Install pnpm (`pnpm/action-setup@v4`, version `12.15.0`) | Success | 11s |
| 5 | Setup Node.js (`actions/setup-node@v4`, version `22.x`, cache `pnpm`) | Success | 3s |
| 6 | Install dependencies (`pnpm install --frozen-lockfile`) | Success | 2s |
| 7 | Check formatting (`pnpm format:check`) | Success | 11s |
| 8 | Run linter (`pnpm lint`) | Success | 7s |
| 9 | Run typecheck (`pnpm typecheck`) | Success | 26s |
| 10 | Check dependency vulnerabilities (`pnpm audit`) | Success | < 1s |
| 11 | Run database migrations (`pnpm --filter @pos/server migrate`) | Success | 2s |
| 12 | Run test suite (`pnpm test`) | Success | 3m 11s (191s) |
| 13 | Build production bundles (`server`, `web`, `desktop`) | Success | 25s |
| 14-17| Post steps & container teardown | Success | 2s |

---

## 3. History of CI Runs, Root Causes, and Changes

### Run #1: Run ID `43125961342` (Failed at "Run test suite")
- **Commit:** `45c2be9`
- **First Failure:** `apps/server/src/auth/auth.test.ts:85` and `apps/server/src/auth/audit-fixes.test.ts:188, 200` failed in `apps/server` test suite.
- **Root Cause:**
  - Production and CI environments enforce distinct secret strings for `JWT_SECRET` and `DEVICE_JWT_SECRET` (configured in `.github/workflows/ci.yml`).
  - In `apps/server/src/auth/auth.test.ts`, the device registration and token verification tests previously signed test tokens using `process.env.JWT_SECRET!` instead of `getDeviceJwtSecret()`. Under distinct secrets, `verifyDeviceToken` failed signature verification rather than proceeding to claim checks.
  - In `apps/server/src/auth/audit-fixes.test.ts`, tests checking cross-token rejection (signing a user token and passing to device verify, or vice versa) asserted rejection specifically with an audience mismatch regex (`/expected user token|expected device token|jwt audience invalid/i`). When `JWT_SECRET !== DEVICE_JWT_SECRET`, signature verification fails first (`JsonWebTokenError: invalid signature`) before the audience claim is checked.
- **Fix Implemented:**
  - `apps/server/src/auth/auth.test.ts`: Updated device token test generation to sign device tokens using `getDeviceJwtSecret()`.
  - `apps/server/src/auth/audit-fixes.test.ts`: Broadened error assertions to accept both cryptographic signature rejection and audience mismatch rejection (`/jwt audience invalid|expected user token|invalid signature/i`). Added explicit tests where forged tokens are signed with the matching secret to explicitly verify that audience claims reject wrong token types even when keys match.
- **Commit:** `e008f15` (`fix(ci): handle distinct JWT and device secrets in auth tests`)

### Run #2: Run ID `43126847484` (Failed at "Build production bundles")
- **Commit:** `e008f15`
- **First Failure:** `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "build" not found in "@pos/shared"` in step "Build production bundles".
- **Root Cause:**
  - `.github/workflows/ci.yml` executed:
    ```bash
    pnpm --filter @pos/shared build
    pnpm --filter @pos/server build
    pnpm --filter @pos/web build
    pnpm --filter @pos/desktop build
    ```
  - `packages/shared` is a pure TypeScript library package (`"main": "./src/index.ts"`) that is consumed directly via TypeScript project references and workspace paths without a separate pre-build step. It does not define a `"build"` script in `packages/shared/package.json`.
- **Fix Implemented:**
  - `.github/workflows/ci.yml`: Removed `pnpm --filter @pos/shared build`. Retained production builds for `@pos/server`, `@pos/web`, and `@pos/desktop`.
- **Commit:** `c7c63b3` (`fix(ci): remove build step for @pos/shared which is pure ts source`)

### Run #3: Run ID `43127684509` (Success - 100% Green)
- **Commit:** `c7c63b3`
- **Result:** Succeeded across all 13 steps.
- **Observation:** Although the run succeeded, Postgres container logs produced `FATAL: role "root" does not exist` noise during service startup. Furthermore, `pnpm` version in `pnpm/action-setup@v4` was unpinned.

### Run #4: Run ID `43128716666` (Success - Clean & Pinned)
- **Commit:** `0cbc41b`
- **Fix Implemented:**
  - `.github/workflows/ci.yml`: Configured `--health-cmd "pg_isready -U pos -d pos_server"` in Postgres service container options to silence `FATAL: role "root" does not exist` connection attempts.
  - Pinned `version: 12.15.0` in `pnpm/action-setup@v4` to match local repository lockfile and tooling.
- **Result:** Succeeded in 4m 53s across all steps without any container log errors.

---

## 4. Analysis of Variables in `apps/server/src/routes/stock.ts`

### `prodMap` Analysis
- **Origin:** In earlier revisions of `apps/server/src/routes/stock.ts`, an intermediate variable `prodMap` (`new Map(products.map(p => [p.id, p]))`) was created during the stock batching lookup.
- **Why it was there:** Initial stock batch querying planned to lookup product names via `prodMap`. However, the query and aggregation logic was refined to construct `prodInfoMap`, which incorporated not only product names but also primary barcodes (`b.barcode`) and unit measures for pharmacy inventory batch reporting.
- **Unused vs. Unfinished Logic:** `prodMap` was completely superseded by `prodInfoMap`. It did not represent unfinished business logic or omitted response fields, because `prodInfoMap` was already providing all required product information, barcodes, and metadata into the response payloads.
- **Action Taken:** `prodMap` was safely removed as dead intermediate state (in commit `25e4ff5`), leaving the active and complete `prodInfoMap` in place.

### `toKarachiBusinessDate` Analysis
- **Origin:** Imported from `../ledger/journal` into `apps/server/src/routes/stock.ts`.
- **Why it was there:** Previous accounting modules used an unstandardized helper from `journal.ts`.
- **Unused vs. Unfinished Logic:** As part of the Phase 5/Phase 6 audit hardening, Karachi business date calculation (05:00 AM PKT cutover) was standardized into `@pos/shared` as `getKarachiBusinessDate`. The routes in `apps/server/src/routes/stock.ts` (and throughout the application) use `getKarachiBusinessDate(new Date())` from `@pos/shared`. The import of `toKarachiBusinessDate` from `../ledger/journal` was an unused duplicate import left over from refactoring.
- **Action Taken:** The unused import was cleaned up in commit `25e4ff5`, and `getKarachiBusinessDate` from `@pos/shared` continues to govern all business date cutovers across stock and ledger operations.

---

## 5. Differences Between Local and CI Environments

| Attribute | Local Machine | CI Runner (`ubuntu-latest`) | Handling / Mitigation |
|:---|:---|:---|:---|
| **Operating System** | Windows 11 (PowerShell) | Ubuntu Linux (bash) | Cross-platform npm scripts and pathing; forward slashes in tooling. |
| **PostgreSQL Service** | Local Docker Compose container exposed on `127.0.0.1:5432` (`pos` / `pos` / `pos_server`) | GitHub Actions service container with health checks exposed on `localhost:5432` (`pos` / `pos` / `pos_server`) | Added explicit `-U pos -d pos_server` to `--health-cmd` to match container credentials. |
| **JWT Secrets Configuration** | In local unit test execution without `.env`, dev fallback secret strings (`"dev-secret-change-in-production"`) are used for both user and device tokens unless explicitly set. | Explicit dummy secrets set as distinct values in workflow env (`ci-test-jwt-secret-do-not-use-in-production-32b` vs `ci-test-device-secret-do-not-use-in-prod-32b`). | Updated auth tests to retrieve `getDeviceJwtSecret()` and handle distinct secret verification cleanly. |
| **pnpm Version** | `12.15.0` | Previously unpinned (picked latest); now pinned to `12.15.0` in workflow. | Pinned `version: 12.15.0` in `ci.yml` `pnpm/action-setup@v4`. |
| **Node.js Version** | `v22.x` | `22.x` via `actions/setup-node@v4`. | Identical major Node version. |
| **Build Targets** | Monorepo apps (`server`, `web`, `desktop`). | Monorepo apps (`server`, `web`, `desktop`). | Removed non-existent `@pos/shared` build from workflow. |

---

## 6. Test Suite and Linter Integrity Verification

- **Total Test Files:** 109 test files
- **Total Tests:** 755 tests
- **Passed:** 755 (100%)
- **Failed:** 0
- **Skipped / Disabled Tests:** 0
  - Verified via regex search across all test suites: `git grep -nE "(\.skip|\.only|skipIf|\.todo)\(" -- "*.test.ts" "*.test.tsx"`
  - No active skips, no `.only` test isolations, no `skipIf` conditions, and no `.todo` stubs exist in the test suite.
- **Linting Rules:**
  - `pnpm lint` passed with 0 errors and 0 warnings.
  - No ESLint rules were disabled or downgraded.
  - No blanket `eslint-disable` comments were added.
- **CI Flags:**
  - No `continue-on-error: true` flags added to `.github/workflows/ci.yml`.
  - No `|| true` suppressions added to any steps.

---

## 7. Remaining Manual Steps & Governance

1. **GitHub Repository Branch Protection Rules:**
   - Configure branch protection on `main`:
     - Require pull request before merging.
     - Require status check `Format, Lint, Typecheck, Audit, Test & Build` to pass before merging.
     - Require linear history.
2. **Production Secrets Configuration:**
   - Ensure the following production secrets are set in repository secrets / production environment:
     - `PRODUCTION_DATABASE_URL` (PostgreSQL with SSL)
     - `PRODUCTION_JWT_SECRET` (High-entropy 256-bit string)
     - `PRODUCTION_DEVICE_JWT_SECRET` (Distinct high-entropy 256-bit string)
3. **Pull Request & Main Merge:**
   - Branch `overnight-fixes` is fully green, verified locally and in GitHub Actions CI.
   - A pull request from `overnight-fixes` to `main` can be safely opened and merged.

