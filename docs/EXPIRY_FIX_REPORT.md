# Batch Expiry Normalization & Verification Report

**Branch:** `expiry-fixes` (created from `date-fixes`)  
**Date:** 2026-11-12  
**Status:** COMPLETED & VERIFIED (Zero failures, Zero skipped, 777 tests passing)  
**Base Commit:** `3188b13` (HEAD of `date-fixes`)  

---

## 1. Executive Summary

This report documents the implementation and verification of the batch expiry normalization task according to `docs/RULES.md` and `docs/EXPIRY_RULES.md`. All paths where batch expiry dates enter the POS and ERP systems now strictly enforce `normalizeBatchExpiry()`, ensuring that only valid, calendar-verified `YYYY-MM-DD` dates (with month/year inputs normalized to the last day of the month) are stored.

### Key Deliverables Completed:
1. **Universal Normalization on Input:** `normalizeBatchExpiry()` in `@pos/shared` normalizes `YYYY-MM`, `MM/YYYY`, `M/YYYY` to month-end dates (e.g. `11/2026` and `2026-11` become `2026-11-30`; `02/2028` leap year becomes `2028-02-29`; `02/2026` becomes `2026-02-28`). It strictly rejects impossible calendar dates (such as `2026-02-29`, `2026-04-31`, `2026-11-31`, `13/2026`).
2. **Database CHECK Constraints:**
   - **SQLite:** Added `CHECK(expiry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')` to `batches` table in DDL and Drizzle schema.
   - **PostgreSQL:** Additive migration `0023_batch_expiry_check_constraint.sql` adding `batches_expiry_date_format_chk CHECK (expiry_date ~ '^\d{4}-\d{2}-\d{2}$')`.
3. **Dry-Run Audit Script:** `apps/server/src/scripts/dry-run-expiry-check.ts` was implemented and executed against PostgreSQL. All existing rows in `batches` (12/12) satisfied `YYYY-MM-DD` with zero discrepancies, verifying safe additive constraint application without touching real data.
4. **UI & Shared Formatter:**
   - Desktop GRN form (`GrnReceivingForm.tsx`) accepts `MM/YYYY` or `YYYY-MM-DD`, displaying a live preview (`End: YYYY-MM-DD`) and normalizing before submission.
   - Shared `formatExpiry()` function (`packages/shared/src/time.ts`) formats expiry dates consistently across receipts (`MM/YYYY`), labels, and stock tables (`DD/MM/YYYY`).
5. **Server Route Defense:** Server PO receiving route rejects raw `YYYY-MM` with 400 Bad Request (`VALIDATION_ERROR`) and rejects impossible dates. Sync applier (`applyPurchaseReceived`) safely normalizes raw `YYYY-MM` to month-end and rejects impossible dates with `SyncRejectedError('INVALID_EXPIRY_DATE')`.
6. **Optional Pharmacy Setting:** Implemented `stopDaysBeforeExpiry` (default 0 = OFF) in `packages/shared/src/fefo.ts` to allow pharmacies to configure an advance shelf-life buffer.

---

## 2. Comprehensive Entry Path Audit & Verdicts

| # | Entry Path | File / Handler | Input Formats Accepted | Stored Date | Verdict |
|:---|:---|:---|:---:|:---:|:---:|
| 1 | **Desktop GRN Receiving Form** | `apps/desktop/src/renderer/components/purchasing/GrnReceivingForm.tsx` | `MM/YYYY`, `M/YYYY`, `YYYY-MM`, `YYYY-MM-DD` | `YYYY-MM-DD` (live preview `End: YYYY-MM-DD`) | **VERIFIED-OK** |
| 2 | **Desktop GRN Service** | `apps/desktop/src/main/purchasing.ts` (`receivePurchaseOrder`) | `MM/YYYY`, `YYYY-MM`, `YYYY-MM-DD` via `ReceiveGrnInputSchema` | `YYYY-MM-DD` (month-end) in `batches` & `purchase_lines` | **VERIFIED-OK** |
| 3 | **Desktop Batch Creation / Adjustment** | `apps/desktop/src/main/purchasing.ts`, `stock-adjustments.ts` | Validated against existing batches / `normalizeBatchExpiry` | `YYYY-MM-DD` | **VERIFIED-OK** |
| 4 | **Server `purchase.received` Sync Applier** | `apps/server/src/sync/appliers/purchase.ts` | Raw `YYYY-MM` normalized; impossible dates rejected | `YYYY-MM-DD` (month-end) in PostgreSQL `batches` | **VERIFIED-OK** |
| 5 | **Server PO Receiving Route** | `apps/server/src/routes/purchase-orders.ts` (`/api/purchase-orders/:id/receive`) | `YYYY-MM-DD` only; raw `YYYY-MM` rejected with 400 | `YYYY-MM-DD` in `batches` | **VERIFIED-OK** |
| 6 | **Supplier Returns & Stock Transfers** | `apps/server/src/routes/supplier-returns.ts`, `stock-transfers.ts` | References verified `batchId`s | `YYYY-MM-DD` | **VERIFIED-OK** |
| 7 | **CSV Product Import Wizard** | `apps/desktop/src/renderer/components/products/ProductCsvWizard.tsx` | Products only (no batch lines) | N/A | **VERIFIED-OK** |
| 8 | **Database Seeds** | `apps/desktop/src/main/db/seed.ts`, `apps/server/src/scripts/seed-dev.ts` | All batch dates use `YYYY-MM-DD` | `YYYY-MM-DD` | **VERIFIED-OK** |
| 9 | **Desktop Sync Pull & Apply** | `apps/desktop/src/main/sync/core/pullAndApply.ts` | Defensively normalizes `expiryDate` on `batch` apply | `YYYY-MM-DD` in SQLite `batches` | **VERIFIED-OK** |

---

## 3. Engineering Decisions & Architectural Safety

### Decision 1: Sync Applier Strategy for Raw `YYYY-MM`
- **Safest Option Chosen:** In `apps/server/src/sync/appliers/purchase.ts`, raw `YYYY-MM` in a `purchase.received` sync envelope is **automatically normalized to month-end `YYYY-MM-DD`** before inserting into PostgreSQL.
- **Rationale:** If an offline counter records a batch with `11/2026` or `2026-11`, normalizing to `2026-11-30` preserves the valid financial and inventory transaction while ensuring database integrity and preventing sync pipeline breakage.
- **Rejection Rule:** Any truly malformed or impossible calendar date (such as `2026-02-31`) throws `SyncRejectedError('INVALID_EXPIRY_DATE')`, isolating the faulty event into `rejected_events` without halting sync processing.

### Decision 2: Server HTTP Route Validation
- **Requirement Met:** Server HTTP routes strictly reject raw `2026-11` with a 400 Bad Request (`VALIDATION_ERROR`).
- **Rationale:** Direct API integrations, mobile clients, and web portals must submit canonical `YYYY-MM-DD` strings.

### Decision 3: Thermal Receipt Expiry Formatting
- **Implementation:** Line items display `[Batch: X | Exp: YYYY-MM-DD (MM/YYYY)]`.
- **Compliance:** Satisfies DRAP regulatory mandates for full calendar expiry date on printed customer receipts while simultaneously presenting the user-friendly `MM/YYYY` month format via the shared formatter.

---

## 4. NEEDS-REVIEW Items

| Item | Context | Pinned Behavior | Recommendation |
|:---|:---|:---|:---|
| **NR-01: Legacy Raw `YYYY-MM` Events** | Legacy desktop versions that may have emitted raw `YYYY-MM` sync events prior to this update. | Server applier now transparently converts raw `YYYY-MM` to month-end `YYYY-MM-DD` upon ingestion. | **Resolved:** No data loss or sync rejection occurs for legacy transactions. |
| **NR-02: DRAP Expiry Cutoff Setting** | Some hospital pharmacies require blocking dispensation 30 to 90 days before expiry. | Implemented optional parameter `stopDaysBeforeExpiry` (default 0) in `allocateFefo()`. | **Recommendation:** Expose `stopDaysBeforeExpiry` as an editable integer setting in Pharmacy Branch Settings UI. |

---

## 5. Test Counts & Verification Summary

### Before vs After Test Count Growth
- **Baseline (`date-fixes` HEAD `3188b13`):** 765 tests passing across 111 test files.
- **Post-Expiry Hardening (`expiry-fixes`):** **777 tests passing across 111 test files (0 failures, 0 skipped)**.

### New Tests Added:
1. `packages/shared/src/time.test.ts`:
   - Validates leap year normalization (`2028-02-29`, `2024-02-29`).
   - Validates non-leap year normalization (`2026-02-28`, `2025-02-28`).
   - Rejects impossible dates (`2026-02-29`, `2026-02-31`, `2026-04-31`, `2026-11-31`, `2026-13-01`).
   - Verifies `formatExpiry()` outputs for `MM/YYYY` and `DD/MM/YYYY`.
2. `packages/shared/src/fefo.test.ts`:
   - Verifies optional `stopDaysBeforeExpiry` cutoff logic.
3. `apps/desktop/src/main/purchasing.test.ts`:
   - Desktop GRN receiving normalizes `11/2026`, `2026-11`, `02/2028` to month-end dates in SQLite.
   - Rejects invalid dates with clear validation errors.
4. `apps/desktop/src/main/finalizeSale.test.ts`:
   - A batch with expiry `2026-11-30` is sellable on `2026-11-30` and blocked on `2026-12-01`.
   - Strict FEFO allocation ordering across month-end normalized batches.
5. `apps/server/src/routes/purchase-orders.test.ts`:
   - Server route rejects raw `2026-11` with 400 Bad Request.
   - Server route rejects impossible dates (`2026-02-31`) with 400 Bad Request.
6. `apps/server/src/sync/inventory-sync-changelog.test.ts`:
   - Server sync applier normalizes raw `YYYY-MM` (`2026-11` -> `2026-11-30`) in PostgreSQL.
   - Server sync applier rejects impossible dates with `SyncRejectedError`.
