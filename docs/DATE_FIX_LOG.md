# Date and Timezone Hardening Log

**Branch:** `date-fixes`  
**Started:** 2026-11-12  
**Context:** Business dates are `Asia/Karachi` (UTC+5, no DST, midnight boundary), timestamps are UTC ISO strings.

---

## Task Progress Summary

| Item | Title | Status | Commit | Verdict / Notes |
|:---|:---|:---:|:---:|:---|
| Group A Initial | Log setup | IN_PROGRESS | - | Initializing running log |

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
