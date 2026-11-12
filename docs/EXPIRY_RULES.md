# Batch Expiry Rules & Specifications

**System:** Pharmacy ERP & POS Monorepo  
**Timezone Reference:** `Asia/Karachi` (UTC+5, midnight boundary)  
**Status:** Documented & Pinned by Tests  

---

## 1. Expiry Day Boundary Rule: Is an Item Sellable on its Expiry Date?

### Rule Definition
> **An item with `expiryDate = D` is strictly SELLABLE throughout the entire business day of `D`. It is expired only when `referenceDate > D` (or `D < referenceDate`).**

### Code Implementation & Verification
1. **`isBatchExpired(expiryDate, referenceDate)`** (`packages/shared/src/time.ts:113`):
   ```ts
   export function isBatchExpired(
     expiryDate: string,
     referenceDate: string = getKarachiBusinessDate()
   ): boolean {
     return expiryDate < referenceDate;
   }
   ```
   - When `expiryDate === referenceDate`, `expiryDate < referenceDate` is `false`.
   - The batch is **NOT expired** and remains sellable.

2. **FEFO Allocation (`allocateFefo`)** (`packages/shared/src/fefo.ts:69`):
   ```ts
   if (batch.available > 0 && batch.expiryDate >= today) {
     eligibleBatches.push(...);
   }
   ```
   - A batch where `expiryDate === today` satisfies `batch.expiryDate >= today`.
   - It is eligible for dispensing and prioritized according to FEFO.

3. **POS Terminal UI (`computeLineWarning`)** (`apps/desktop/src/renderer/components/pos/types.ts:96-128`):
   - Stamped with `isBatchExpired(line.expiryDate, todayStr)`.
   - If `line.expiryDate === todayStr`, it is flagged as `near-expiry` (`0d left`), allowing the cashier to complete the sale while warning them that the batch expires at midnight.
   - It is marked with `type: 'expired'` with a red blocker only when `isBatchExpired` returns `true` (`expiryDate < todayStr`).

4. **Desktop Sale Finalization (`invoices.ts`)** (`apps/desktop/src/main/invoices.ts:102`):
   - Queries `WHERE b.product_id = ? AND b.expiry_date >= ?` using today's Karachi business date.
   - Batches expiring today are included; batches expiring before today are excluded.

5. **Test Pinning:**
   - `packages/shared/src/time.test.ts`:
     - `isBatchExpired('2026-11-12', '2026-11-12') === false` (PASS).
     - `isBatchExpired('2026-11-12', '2026-11-13') === true` (PASS).
   - `packages/shared/src/fefo.test.ts:85`:
     - Fulfills requests using batches expiring today (`batch.expiryDate === TODAY`).

---

## 2. Month/Year Entry Formats (`MM/YYYY` and `YYYY-MM`)

### How Expiry is Entered
- **Desktop GRN Receiving (`GrnReceivingForm.tsx:542`)**: Column header specifies `Expiry (YYYY-MM-DD)`.
- **Web Purchase Orders (`PurchaseOrderDetailPage.tsx:144`)**: Defaults to `YYYY-MM-DD` (+2 years).
- **Zod Schemas**:
  - `PurchaseLineInputSchema` (`packages/shared/src/schema/purchasing.ts:30`):
    `regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Expiry date must be in YYYY-MM or YYYY-MM-DD format')`
  - `SyncEventEnvelope` (`packages/shared/src/schema/sync.ts:40`):
    `regex(/^\d{4}-\d{2}(-\d{2})?$/)`
  - `ReceivePOLineSchema` (`apps/server/src/routes/purchase-orders.ts:44`):
    `regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be YYYY-MM-DD')`

### How Raw `YYYY-MM` Becomes Premature Expiry (NEEDS-REVIEW)

> [!WARNING]
> **NEEDS-REVIEW: Raw `YYYY-MM` String Storage**
> If a user enters `2026-11` (or if an integration passes `YYYY-MM`), raw storage in `batches.expiry_date` causes premature expiry on the FIRST day of the month due to string comparison:
> `'2026-11' < '2026-11-01' === true`
>
> In international pharmaceutical standards (DRAP, FDA, WHO), medicine labeled "Exp: 11/2026" remains potent and legally sellable until the **last day of the month** (2026-11-30). Treating `2026-11` as expired on `2026-11-01` destroys 30 days of valid shelf life.

### Normalization Solution: `normalizeBatchExpiry`
To guarantee compliance with pharmaceutical regulations without breaking existing `YYYY-MM-DD` records, `@pos/shared` provides:
```ts
export function normalizeBatchExpiry(expiryInput: string): string
```
- Inputs in `YYYY-MM-DD` format are preserved as-is.
- Inputs in `YYYY-MM` format (e.g. `2026-11`) are normalized to the last day of the month: `2026-11-30`.
- Inputs in `MM/YYYY` format (e.g. `11/2026`) are normalized to the last day of the month: `2026-11-30`.
- Leap years are handled via `Date.UTC(year, month, 0).getUTCDate()` (`2024-02` -> `2024-02-29`, `2025-02` -> `2025-02-28`).

---

## 3. Summary Matrix

| Case | Input | Stored Date | Status on 2026-11-01 | Status on 2026-11-30 | Status on 2026-12-01 | Compliance Note |
|:---|:---:|:---:|:---:|:---:|:---:|:---|
| **Explicit Date** | `2026-11-12` | `2026-11-12` | Sellable | Expired (on 13th) | Expired | Standard behavior |
| **Raw YYYY-MM (Legacy)** | `2026-11` | `2026-11` | **EXPIRED** (`'2026-11' < '2026-11-01'`) | Expired | Expired | **NEEDS-REVIEW**: Prematurely expires on 1st of month |
| **Normalized Month** | `11/2026` or `2026-11` | `2026-11-30` | Sellable | Sellable | Expired | **Recommended**: Matches pharmaceutical standards |
