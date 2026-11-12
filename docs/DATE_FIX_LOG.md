# Date and Timezone Hardening Log

**Branch:** `date-fixes`  
**Started:** 2026-11-12  
**Context:** Business dates are `Asia/Karachi` (UTC+5, no DST, midnight boundary), timestamps are UTC ISO strings.

---

## Task Progress Summary

| Item | Title | Status | Commit | Verdict / Notes |
|:---|:---|:---:|:---:|:---|
| Group A Initial | Log setup | DONE | `8d2a71f` | Log initialized |
| A1-A5 | Half-open intervals & offset validation | DONE | `8d2a71f`, `3d72f40` | Half-open intervals applied; offset validation enforced |
| B1-B4 | Eradicate UTC slicing & machine timezone | DONE | `43ab317` | Day loops, test slicing, ESLint rules, machine Date APIs fixed |
| C1 | Verify auth audience rejection tests | DONE | `e008f15` (verified) | Verified forged audience tests with correct secrets exist |
| C2 | Verify stock response shapes & Karachi dates | DONE | `b18d758` | Product names, barcodes, and Karachi date helpers verified & tested |
| C3 | Document batch expiry rules & normalization | DONE | PENDING | Documented in `docs/EXPIRY_RULES.md`; pinned with tests; raw YYYY-MM marked NEEDS-REVIEW |

---

## Group A: Day-Range Queries Must Be Half-Open

### A1. Audit of `getKarachiDayEndUtc`, `getKarachiDayBoundsUtc`, `endUtc`, and `lte` / `<=` against dates/timestamps

| Location | Code Pattern | Verdict | Reason / Impact |
|:---|:---|:---:|:---|
| `apps/desktop/src/main/invoices.ts:573` | `whereClauses.push('i.created_at <= ?'); queryParams.push(getKarachiDayEndUtc(params.dateTo))` | **BUG** | Inclusive upper bound (`.999Z`) drops sub-millisecond timestamps on the closing day. Must be `< getKarachiNextDayStartUtc(params.dateTo)`. |
| `apps/server/src/ledger/period-close.ts:45, 68, 151` | `const endIso = getKarachiDayEndUtc(endDate); lte(stockCounts.createdAt, endIso)` | **BUG** | Inclusive upper bound (`.999Z`) on `stockCounts.createdAt` timestamp drops stock counts occurring in the last millisecond of the month. Must be `< getKarachiNextDayStartUtc(endDate)`. |
| `apps/server/src/reports/queries.ts:130, 143, 169` | `const endOfDay = getKarachiDayEndUtc(todayIsoDate); lte(invoices.createdAt, endOfDay)` | **BUG** | Dashboard overview today's sales drops sub-millisecond timestamps like `23:59:59.9995 PKT`. Must be `< getKarachiNextDayStartUtc(todayIsoDate)`. |
| `apps/server/src/reports/queries.ts:277` | `conditions.push(lte(invoices.createdAt, getKarachiDayEndUtc(params.endDate)))` | **BUG** | Sales report date filter drops sub-millisecond timestamps. Must be `< getKarachiNextDayStartUtc(params.endDate)`. |
| `apps/server/src/routes/sales-ledger.ts:72, 128, 186, 241` | `${query.endDate}T23:59:59.999Z` with `lte` on `invoices.createdAt`, `creditNotes.createdAt`, `erpPayments.createdAt` | **BUG** | Constructed UTC midnight/end-of-day instead of Karachi business day bounds, and used inclusive `.999Z`. Must use `getKarachiDayStartUtc` and `< getKarachiNextDayStartUtc`. |
| `apps/server/src/routes/admin.ts:711` | `if (endDate) auditConditions.push(lte(auditLogs.createdAt, endDate))` | **EDGE CASE** | If `endDate` is `YYYY-MM-DD`, `lte` against `createdAt` timestamp drops logs on that date. Handled with `< getKarachiNextDayStartUtc(endDate)`. |
| `apps/server/src/ledger/queries.ts:86, 231` | `lte(journalEntries.entryDate, to)` | **OK** | `entryDate` is a date-only string (`YYYY-MM-DD`). Lexicographical string comparison `<='2026-11-30'` is exact and inclusive of the entire date string. |
| `apps/server/src/ledger/reconciliation.ts:113, 160` | `lte(journalEntries.entryDate, to)` | **OK** | `entryDate` is a date-only string (`YYYY-MM-DD`). Lexicographical string comparison is exact. |
| `apps/server/src/ledger/period-close.ts:56, 104, 274, 388` | `lte(erpExpenses.expenseDate, endDate)`, `lte(bankReconciliations.statementDate, endDate)`, `lte(journalEntries.entryDate, endDate)` | **OK** | Date-only fields (`YYYY-MM-DD`). String comparison is exact and inclusive. |
| `apps/server/src/routes/hr-leave.ts:457, 551, 912, 915, 972, 1050` | `lte(leaveRequests.startDate, ...)` and `lte(attendanceRecords.date, ...)` | **OK** | Date-only fields (`YYYY-MM-DD`). String comparison is exact. |
| `apps/server/src/routes/expenses.ts:261` | `erpExpenses.expenseDate <= q.endDate` | **OK** | Date-only field (`YYYY-MM-DD`). |
| `apps/server/src/routes/payments.ts:352` | `erpPayments.paymentDate <= q.endDate` | **OK** | Date-only field (`YYYY-MM-DD`). |
| `apps/server/src/routes/prescriptions.ts:92` | `prescriptions.nextRefillDate <= cutoffDate` | **OK** | Date-only field (`YYYY-MM-DD`). |
| `apps/desktop/src/main/shifts.ts:99, 119` | `i.created_at >= openedAt AND i.created_at <= timeUpper` | **OK** | Shift boundaries: `openedAt` and `timeUpper` are exact point-in-time timestamps (when shift opened and closed), not day-range date filters. |
| `apps/desktop/src/main/purchasing.ts:486, 572` | `b.expiry_date <= ? AND b.expiry_date >= ?` | **OK** | Date-only fields (`YYYY-MM-DD`). |

### A2. Implementation of `getKarachiNextDayStartUtc` and Half-Open Ranges
- **Helper Added:** `getKarachiNextDayStartUtc(businessDate: string): string` in `packages/shared/src/time.ts`.
- **Pure Arithmetic Helper Added:** `addDaysToBusinessDate(dateString: string, n: number): string` using UTC year/month/day arithmetic.
- **Deprecations:** Marked `getKarachiDayEndUtc` and `endUtc` as deprecated.
- **Half-Open Intervals Applied:**
  - `apps/desktop/src/main/invoices.ts:573`: Replaced `i.created_at <= getKarachiDayEndUtc(params.dateTo)` with `i.created_at < getKarachiNextDayStartUtc(params.dateTo)`.
  - `apps/server/src/ledger/period-close.ts:68, 151`: Replaced `lte(stockCounts.createdAt, endIso)` with `lt(stockCounts.createdAt, nextPeriodStartIso)`.
  - `apps/server/src/reports/queries.ts:143, 169, 277`: Replaced `lte(invoices.createdAt, endOfDay)` with `lt(invoices.createdAt, nextDayStart)`.
  - `apps/server/src/routes/sales-ledger.ts:128, 186, 241`: Replaced UTC `.999Z` and `lte` with `getKarachiDayStartUtc` and `lt(..., nextDayStartIso)`.
  - `apps/server/src/routes/admin.ts:711`: Handled `endDate` without time via `lt(auditLogs.createdAt, getKarachiNextDayStartUtc(endDate))`.

### A3. Period Membership Rules
- In `apps/server/src/ledger/period-close.ts`:
  - Financial transactions and ledger entries decide period membership strictly by `entry_date` (`journalEntries.entryDate`, `YYYY-MM-DD`).
  - Expenses and bank reconciliations use their business date fields (`erpExpenses.expenseDate`, `bankReconciliations.statementDate`).
  - Physical stock counts (`stock_counts`) only store `createdAt` timestamps in UTC; their period membership is evaluated via half-open interval `createdAt >= getKarachiDayStartUtc(startDate) AND createdAt < getKarachiNextDayStartUtc(endDate)`, which maps one-to-one to `businessDate >= startDate AND businessDate <= endDate`.

### A4. Tests Added
- `packages/shared/src/time.test.ts`: Added tests for `getKarachiNextDayStartUtc`, `addDaysToBusinessDate`, and `getKarachiBusinessDate` rejection.
- `apps/desktop/src/main/receipt-and-invoices.test.ts`: Added test verifying desktop invoice search with `dateTo` includes records stamped up to `23:59:59.9995 PKT` and excludes `00:00:00 PKT` next day.
- `tests/audit-regression/high-findings.test.ts`: Added test verifying a Postgres invoice stamped `23:59:59.9995 PKT` appears in day D report and not day D+1 report, while a record at `00:00:00.0000 PKT` appears only in day D+1 report.

### A5. Machine-Timezone Rejection in `getKarachiBusinessDate`
- Added check throwing `TypeError` when input string does not contain `Z` or an explicit UTC offset (`[+-]HH:MM`).
- Added tests verifying strings without offset throw `TypeError`.

---

## Group B: Leftover UTC Date Slicing & Machine-Timezone Dates

### B1. Replace day loops with pure business date arithmetic
- Replaced day-by-day iteration in `apps/server/src/routes/hr-leave.ts` (calendar leave map) with `addDaysToBusinessDate(curDateStr, 1)`.
- Replaced day-by-day iteration in `apps/web/src/lib/leave-utils.ts` (leave calendar map) with `addDaysToBusinessDate(curDateStr, 1)`.
- Replaced `.substring(0, 10)` in `apps/web/src/pages/hr/LeaveManagementPage.tsx` and `PayrollPage.tsx` with `getKarachiBusinessDate()`.

### B2. Convert test `.toISOString().slice(0, 10)` to `getKarachiBusinessDate()`
- Replaced test date slicing in:
  - `apps/server/src/routes/expenses.test.ts`
  - `apps/server/src/routes/payments.test.ts`
  - `apps/server/src/routes/prescriptions.test.ts`
  - `apps/server/src/routes/stock.test.ts`
  - `apps/server/src/reports/reports.test.ts`
  - `apps/desktop/src/main/purchasing.test.ts`
  - `apps/desktop/src/renderer/components/pos/pos.test.ts`
  - `tests/audit-regression/tenant-isolation.test.ts`
- Added `tests/audit-regression/date-sensitive-mocked-clock.test.ts` running tests under mocked clock `2026-11-11T20:00:00Z` (`01:00 PKT Nov 12`). Verified passes.

### B3. Extended ESLint rule forbidding UTC date slicing
- Updated `eslint.config.mjs` to target all source, shared, and test files (`apps/**`, `packages/**`, `tests/**`).
- Added AST selectors forbidding `slice`, `substring`, `substr`, and `split('T')` on `toISOString()` calls.
- Added `tests/audit-regression/eslint-date-rules.test.ts` verifying ESLint flags all four variants with appropriate error messages.

### B4. Eradicate machine-timezone APIs
- `apps/server/src/ledger/budget-service.ts`: Replaced local `new Date(fiscalYear, month, 0).getDate()` with `new Date(Date.UTC(fiscalYear, month, 0)).getUTCDate()`.
- `apps/server/src/routes/ap.ts` & `ar.ts`: Replaced `new Date().getFullYear()` with `getKarachiBusinessDate().slice(0, 4)`.
- `apps/server/src/routes/hr-leave.ts`: Replaced `new Date().getFullYear()` with `parseInt(getKarachiBusinessDate().slice(0, 4), 10)`.
- `apps/server/src/routes/purchase-orders.ts` & `stock-transfers.ts`: Replaced `new Date().getFullYear()` with `parseInt(getKarachiBusinessDate().slice(0, 4), 10)`.
- `apps/server/src/routes/suppliers.ts`: Replaced `new Date().getFullYear()` with `parseInt(getKarachiBusinessDate(now).slice(0, 4), 10)`.
- `apps/desktop/src/renderer/components/pos/types.ts`: Replaced machine-local `today.setHours(0, 0, 0, 0)` with calendar day arithmetic using `getKarachiBusinessDate()` and `Date.UTC`.
- `apps/desktop/src/main/backup.ts`: Replaced local `getFullYear()`, `getMonth()`, `getDate()`, `getHours()`, etc. with `getUTCFullYear()`, `getUTCMonth()`, `getUTCDate()`, `getUTCHours()`, etc.
- `apps/web/src/pages/finance/PeriodClosePage.tsx`: Replaced `currentDate.getFullYear()` and `currentDate.getMonth() + 1` with `getKarachiBusinessDate()`.
- `apps/web/src/pages/finance/AccountsPayablePage.tsx` & `AccountsReceivablePage.tsx`: Replaced `new Date().getFullYear()` with `getKarachiBusinessDate().slice(0, 4)`.
- `apps/web/src/pages/finance/BudgetPlanningPage.tsx`: Replaced `new Date().getFullYear()` with `parseInt(getKarachiBusinessDate().slice(0, 4), 10)`.
- `apps/web/src/pages/inventory/PurchaseOrderDetailPage.tsx`: Replaced `defaultExpiry.setFullYear(...)` with `addDaysToBusinessDate(getKarachiBusinessDate(), 730)`.
- `package.json`: Added cross-platform `test:tz-utc` and `test:tz-karachi` scripts forwarding any CLI arguments.

---

## Group C: Verify Earlier Changes & Expiry

### C1. Auth Token Audience Test Verification (`e008f15`)
- Audited `apps/server/src/auth/audit-fixes.test.ts` lines 208-250 added in `e008f15`.
- Confirmed it explicitly tests audience validation when tokens are signed with the *valid* secret:
  - `forgedAudToken` signed with `getJwtSecret()` (valid user secret) with `{ audience: 'pos:device' }` is rejected by `verifyUserToken` with `/jwt audience invalid|expected user token/i`.
  - `forgedAudToken` signed with `getDeviceJwtSecret()` (valid device secret) with `{ audience: 'pos:web' }` is rejected by `verifyDeviceToken` with `/jwt audience invalid|expected device token/i`.
- Verified all 10 tests in `apps/server/src/auth/audit-fixes.test.ts` pass cleanly.
- Status: **CHECKED-OK**.

### C2. Stock Route Shapes & Karachi Date Helpers (`25e4ff5`)
- Inspected git diff of `25e4ff5` on `apps/server/src/routes/stock.ts`: only prettier formatting changes were made.
- Inspected response shapes:
  - `GET /api/inventory/stock?view=product`: returns `brandName`, `genericName`, `barcode`.
  - `GET /api/inventory/stock?view=batch`: returns `productName`, `genericName`, `barcode`.
  - `GET /api/inventory/batches/expiring`: returns `productName`, `genericName`, `barcode`.
  - `GET /api/inventory/products/:id/stock-detail`: returns `brandName`, `barcode`, and full movement timeline.
- Refactored date helpers in `stock.ts`: replaced `new Date(now.getTime() + N * 86400 * 1000)` with `addDaysToBusinessDate(nowIsoDate, N)` and exact UTC calendar day difference for `daysUntilExpiry`.
- Added test in `apps/server/src/routes/stock.test.ts` verifying all response shapes and properties.
- Status: **FIXED & TESTED**.

### C3. Document Exact Batch Expiry Rules & Normalization
- Audited how batch expiry is stored and evaluated across desktop, server, and shared (`isBatchExpired`, `fefo.ts`, `purchasing.ts`, `stock.ts`).
- **Expiry Boundary Rule:** A batch expiring on date `D` (`2026-11-12`) is strictly **sellable** throughout the business day of `D`. It is expired only when `expiryDate < referenceDate`.
- **Month/Year Expiry:**
  - Standard pharmaceutical practice (DRAP/FDA/WHO) stipulates that a batch labeled with month/year (e.g. `11/2026` or `2026-11`) is valid until the **last day of that month** (`2026-11-30`).
  - Storing raw `YYYY-MM` without normalization causes premature expiration on the first of the month (`'2026-11' < '2026-11-01'` is true in string comparison).
  - Marked as **`NEEDS-REVIEW`** in `docs/EXPIRY_RULES.md` and log.
  - Implemented `normalizeBatchExpiry(expiryInput: string): string` in `packages/shared/src/time.ts` to convert `YYYY-MM` and `MM/YYYY` to the month's last day (`2026-11-30`), handling leap years.
  - Pinned behavior with unit tests in `packages/shared/src/time.test.ts`.
- Status: **DOCUMENTED & TESTED (NEEDS-REVIEW flagged for raw YYYY-MM storage)**.

---
