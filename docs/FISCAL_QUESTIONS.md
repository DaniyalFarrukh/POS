# Fiscal Integration Analysis & Questions (FBR Phase 6)

> **Document Status**: Pre-Integration Specification Review  
> **Referenced Documents**: [RULES.md](file:///d:/POS/docs/RULES.md), [ARCHITECTURE.md](file:///d:/POS/docs/ARCHITECTURE.md), [FISCAL_CLIENT.md](file:///d:/POS/docs/FISCAL_CLIENT.md), [FBR_SPEC.md](file:///d:/POS/docs/FBR_SPEC.md) (Pending Integrator Provision)  
> **Directive**: Strict adherence to "Do not invent anything not in the spec" and "Anything not stated in docs/FBR_SPEC.md must be written down as a question, never guessed" ([docs/FISCAL_CLIENT.md](file:///d:/POS/docs/FISCAL_CLIENT.md#L6)). No code modifications.

---

## Executive Notice: Specification File Status

As documented in [Pharmacy_Prompt.md:L400-L403](file:///d:/POS/Pharmacy_Prompt.md#L400-L403):
> *"PHASE 6: FBR integration (only after you have the integrator API spec)  
> Do not run this until you have the official API specification and sandbox credentials from your integrator. Paste the spec into `docs/FBR_SPEC.md` first."*

At the present stage, **`docs/FBR_SPEC.md` does not exist in the repository / workspace**. In strict accordance with the project rule prohibiting assumptions or inventions not provided in the specification, **no official FBR spec section can be cited as existing text**.

Below is:
1. A rigorous schema audit of our SQLite data model comparing fields needed for fiscal invoice submission vs. our existing schema (`table.column` vs. `MISSING in our data`).
2. An exhaustive breakdown of what is stated across project specifications ([docs/FISCAL_CLIENT.md](file:///d:/POS/docs/FISCAL_CLIENT.md), [docs/ARCHITECTURE.md](file:///d:/POS/docs/ARCHITECTURE.md), [docs/RULES.md](file:///d:/POS/docs/RULES.md)) and what remains unstated due to the absence of `docs/FBR_SPEC.md`.
3. An uncompromised, comprehensive list of technical and regulatory **QUESTIONS** for the integrator and FBR technical team. As instructed, these are left strictly unanswered.

---

## 1. Field Mapping Table: FBR Fiscal Payload vs. SQLite Schema

Because `docs/FBR_SPEC.md` has not yet been pasted into the repository, official spec field names and section numbers cannot be quoted from `docs/FBR_SPEC.md`. Instead, this table lists the standard data elements referenced by [docs/FISCAL_CLIENT.md](file:///d:/POS/docs/FISCAL_CLIENT.md) and required by fiscal invoicing integrations, mapped against our SQLite schema in [apps/desktop/src/main/db/schema.ts](file:///d:/POS/apps/desktop/src/main/db/schema.ts).

| Fiscal Data Element | Spec Section Quote (`docs/FBR_SPEC.md`) | SQLite Source (`table.column`) | Status / Notes |
| :--- | :--- | :--- | :--- |
| **Document Unique ID / UUID** | *SPEC NOT PROVIDED (File missing)* | `invoices.id` | Mapped (`UUIDv7` string) |
| **Local Invoice Number** | *SPEC NOT PROVIDED (File missing)* | `invoices.invoice_number` | Mapped (`INV-YYYYMMDD-XXXX`) |
| **Client Request ID / Idempotency Key** | *SPEC NOT PROVIDED (File missing)* | `invoices.client_request_id` | Mapped (`UUIDv7` string) |
| **Invoice Finalization Timestamp** | *SPEC NOT PROVIDED (File missing)* | `invoices.created_at` | Mapped (`UTC ISO-8601` string; per [docs/FISCAL_CLIENT.md:L9](file:///d:/POS/docs/FISCAL_CLIENT.md#L9), must use stored invoice timestamp, not current submission time) |
| **Invoice Subtotal Amount** | *SPEC NOT PROVIDED (File missing)* | `invoices.subtotal_paisa` | Mapped (INTEGER paisa; unit conversion to PKR or paisa depends on spec) |
| **Invoice Discount Amount** | *SPEC NOT PROVIDED (File missing)* | `invoices.discount_paisa` | Mapped (INTEGER paisa) |
| **Invoice Total Tax Amount** | *SPEC NOT PROVIDED (File missing)* | `invoices.tax_paisa` | Mapped (INTEGER paisa) |
| **Invoice Grand Total Amount** | *SPEC NOT PROVIDED (File missing)* | `invoices.total_paisa` | Mapped (INTEGER paisa) |
| **Cashier / Operator Identifier** | *SPEC NOT PROVIDED (File missing)* | `users.name` (via `invoices.cashier_user_id`) | Mapped |
| **POS Terminal / Counter Code** | *SPEC NOT PROVIDED (File missing)* | `counters.code` (via `invoices.counter_id`) | Mapped (Internal code e.g. `'C1'`) |
| **FBR POS Registration ID (POSID)** | *SPEC NOT PROVIDED (File missing)* | **MISSING in our data** | No column for FBR-assigned POS Terminal ID in `counters` or `branches` |
| **Pharmacy / Business NTN (National Tax No.)** | *SPEC NOT PROVIDED (File missing)* | **MISSING in our data** | No column for business NTN in `branches` or `app_meta` |
| **Pharmacy / Business STRN (Sales Tax Reg No.)** | *SPEC NOT PROVIDED (File missing)* | **MISSING in our data** | No column for business STRN in `branches` or `app_meta` |
| **Pharmacy Business Legal Name & Address** | *SPEC NOT PROVIDED (File missing)* | `branches.name` partial only | **MISSING in our data** (Legal name, physical address, city, phone missing) |
| **Buyer / Customer Name** | *SPEC NOT PROVIDED (File missing)* | `invoices.notes` (unstructured) | **MISSING in our data** (No structured customer table or column) |
| **Buyer / Customer NTN or CNIC** | *SPEC NOT PROVIDED (File missing)* | **MISSING in our data** | No column for buyer tax identifier or CNIC |
| **Buyer / Customer Phone or Address** | *SPEC NOT PROVIDED (File missing)* | **MISSING in our data** | No structured customer contact columns |
| **Invoice Line Item ID** | *SPEC NOT PROVIDED (File missing)* | `invoice_lines.id` | Mapped (`UUIDv7` string) |
| **Item Product Brand Name** | *SPEC NOT PROVIDED (File missing)* | `products.brand_name` (via `invoice_lines.product_id`) | Mapped |
| **Item Product Generic Name** | *SPEC NOT PROVIDED (File missing)* | `products.generic_name` (via `invoice_lines.product_id`) | Mapped |
| **Item Barcode / GTIN** | *SPEC NOT PROVIDED (File missing)* | `products.barcode` (via `invoice_lines.product_id`) | Mapped (Nullable string) |
| **Item PCT Code / HS Tariff Code** | *SPEC NOT PROVIDED (File missing)* | **MISSING in our data** | No column for Pakistan Customs Tariff / HS code in `products` |
| **Item Sold Quantity** | *SPEC NOT PROVIDED (File missing)* | `invoice_lines.quantity` | Mapped (INTEGER unit count) |
| **Item Unit Price** | *SPEC NOT PROVIDED (File missing)* | `invoice_lines.unit_price_paisa` | Mapped (INTEGER paisa) |
| **Item Line Discount** | *SPEC NOT PROVIDED (File missing)* | `invoice_lines.discount_paisa` | Mapped (INTEGER paisa) |
| **Item Tax Rate (Basis Points / %)** | *SPEC NOT PROVIDED (File missing)* | `invoice_lines.tax_rate_bp` | Mapped (INTEGER basis points, e.g. 1700 = 17.00%) |
| **Item Tax Amount** | *SPEC NOT PROVIDED (File missing)* | `invoice_lines.tax_paisa` | Mapped (INTEGER paisa) |
| **Item Total Amount** | *SPEC NOT PROVIDED (File missing)* | `invoice_lines.line_total_paisa` | Mapped (INTEGER paisa) |
| **Batch Number & Expiry Date** | *SPEC NOT PROVIDED (File missing)* | `batches.batch_no`, `batches.expiry_date` | Mapped (via `invoice_lines.batch_id`) |
| **Tax Exemption / SRO Schedule Reference** | *SPEC NOT PROVIDED (File missing)* | `tax_categories.is_exempt` partial only | **MISSING in our data** (No SRO number, schedule clause, or tax code reference) |
| **Payment Method Name** | *SPEC NOT PROVIDED (File missing)* | `payments.method` | Mapped (Enum: `'cash' \| 'card' \| 'wallet'`) |
| **Payment Method Numeric / FBR Code** | *SPEC NOT PROVIDED (File missing)* | **MISSING in our data** | No FBR standard numeric payment code mapping |
| **Payment Amount** | *SPEC NOT PROVIDED (File missing)* | `payments.amount_paisa` | Mapped (INTEGER paisa) |
| **Fiscal Invoice Number (FBR assigned)** | *SPEC NOT PROVIDED (File missing)* | `fiscal_submissions.fiscal_invoice_number` | Mapped (Nullable string, populated upon response) |
| **Fiscal QR Payload / Code** | *SPEC NOT PROVIDED (File missing)* | `fiscal_submissions.qr_payload` | Mapped (Nullable string, populated upon response) |
| **Fiscal Submission Status** | *SPEC NOT PROVIDED (File missing)* | `fiscal_submissions.status` | Mapped (Enum: `'not_required' \| 'pending' \| 'submitted' \| 'failed'`) |
| **Fiscal Outbox Document Type** | *SPEC NOT PROVIDED (File missing)* | `fiscal_outbox.document_type` | Planned migration in [docs/FISCAL_CLIENT.md:L16](file:///d:/POS/docs/FISCAL_CLIENT.md#L16) (`'invoice' \| 'credit_note'`) |
| **Fiscal Outbox Document ID** | *SPEC NOT PROVIDED (File missing)* | `fiscal_outbox.document_id` | Planned migration in [docs/FISCAL_CLIENT.md:L16](file:///d:/POS/docs/FISCAL_CLIENT.md#L16) |
| **Credit Note / Return Number** | *SPEC NOT PROVIDED (File missing)* | `credit_notes.credit_note_number` | Mapped (`CN-YYYYMMDD-XXXX`) |
| **Original Fiscal Invoice Number for Return** | *SPEC NOT PROVIDED (File missing)* | `fiscal_submissions.fiscal_invoice_number` (via `credit_notes.original_invoice_id`) | Mapped if original invoice was fiscally submitted; otherwise **MISSING** |
| **Return Reason** | *SPEC NOT PROVIDED (File missing)* | `credit_notes.reason` | Mapped (Internal enum: `'defective_damaged' \| 'expired' \| 'customer_return' \| 'dispensing_error' \| 'other'`) |

---

## 2. Specification Audit Across Required Integration Areas

Below is the compilation of what `docs/FBR_SPEC.md` states (marked *Not Stated / Missing* because `docs/FBR_SPEC.md` is not provided) alongside explicit architectural rules from [docs/FISCAL_CLIENT.md](file:///d:/POS/docs/FISCAL_CLIENT.md), [docs/ARCHITECTURE.md](file:///d:/POS/docs/ARCHITECTURE.md), and [docs/RULES.md](file:///d:/POS/docs/RULES.md).

### 2.1 Endpoints
- **What `docs/FBR_SPEC.md` states**: *Not Stated (Spec file missing).*
- **What project docs state**: [docs/FISCAL_CLIENT.md:L8](file:///d:/POS/docs/FISCAL_CLIENT.md#L8) specifies sandbox URL and token come from environment variables in development; production credentials are per pharmacy, entered in a settings screen and stored with Electron `safeStorage`.
- **Architectural requirement**: Fiscal HTTP requests must be decoupled in `apps/desktop/src/main/fiscal/core/` with injected fetch handler.

### 2.2 Authentication
- **What `docs/FBR_SPEC.md` states**: *Not Stated (Spec file missing).*
- **What project docs state**: [docs/FISCAL_CLIENT.md:L8](file:///d:/POS/docs/FISCAL_CLIENT.md#L8) & [L23](file:///d:/POS/docs/FISCAL_CLIENT.md#L23): "Never log secrets, never commit them, never send them to the renderer." "Auth error: stop sending, keep everything queued, show in status."
- **Architectural requirement**: Token / credential header formats (e.g., `Bearer <token>`, custom header, basic auth, or mTLS) are completely unstated.

### 2.3 Request and Response Format
- **What `docs/FBR_SPEC.md` states**: *Not Stated (Spec file missing).*
- **What project docs state**: [docs/FISCAL_CLIENT.md:L17](file:///d:/POS/docs/FISCAL_CLIENT.md#L17) requires storing `request_snapshot` and `response_snapshot` (JSON, with secrets removed) in `fiscal_submissions` for audit purposes.
- **Architectural requirement**: JSON schema, field casing (camelCase vs. PascalCase vs. snake_case), numeric representation (integer paisa vs. float PKR), and root object keys are unstated.

### 2.4 Idempotency and Duplicate Handling
- **What `docs/FBR_SPEC.md` states**: *Not Stated (Spec file missing).*
- **What project docs state**: [docs/FISCAL_CLIENT.md:L7](file:///d:/POS/docs/FISCAL_CLIENT.md#L7) & [L24](file:///d:/POS/docs/FISCAL_CLIENT.md#L24): "Never resend blindly after a timeout: the first request may have succeeded. Use the spec's idempotency key or status-query endpoint if it has one; if it has neither, stop and ask." "In-flight at app crash: on restart, treat as unknown outcome and follow the spec's rule for that case (status query or idempotent resend)."
- **Architectural requirement**: Does the FBR endpoint accept an `Idempotency-Key` header, a client invoice GUID, or does re-submitting return HTTP 409 / a duplicate error code with the existing fiscal number?

### 2.5 Error Codes (Retryable vs. Permanent)
- **What `docs/FBR_SPEC.md` states**: *Not Stated (Spec file missing).*
- **What project docs state**: [docs/FISCAL_CLIENT.md:L20-L23](file:///d:/POS/docs/FISCAL_CLIENT.md#L20-L23):
  - *Network error, timeout, HTTP 5xx*: stays `pending`, `attempts + 1`, `next_attempt_at` via exponential backoff with jitter. Single-flight.
  - *Validation error (the spec's 4xx / error codes)*: status `failed`, `last_error` stored, owner sees it in a list with Retry after fixing data.
  - *Auth error*: stop sending, keep everything queued, show in status.
- **Architectural requirement**: Exact FBR status codes, error payload schemas (e.g. `{ "code": 101, "message": "..." }`), and validation error identifiers are unstated.

### 2.6 Timeouts
- **What `docs/FBR_SPEC.md` states**: *Not Stated (Spec file missing).*
- **What project docs state**: Must not block the counter POS application ([docs/FISCAL_CLIENT.md:L4](file:///d:/POS/docs/FISCAL_CLIENT.md#L4): "Never block or slow a sale because of FBR. The sale is saved first; fiscal submission happens afterwards in the background.").
- **Architectural requirement**: Standard client HTTP timeout (e.g., 5000ms vs 10000ms) before flagging request as timed out and triggering backoff.

### 2.7 Rate Limits
- **What `docs/FBR_SPEC.md` states**: *Not Stated (Spec file missing).*
- **What project docs state**: Single-flight queue processing ([docs/FISCAL_CLIENT.md:L21](file:///d:/POS/docs/FISCAL_CLIENT.md#L21)).
- **Architectural requirement**: Whether FBR rate limits per POSID or IP, whether HTTP 429 is returned with a `Retry-After` header, and maximum bursts allowed.

### 2.8 Offline Behavior and Deadlines
- **What `docs/FBR_SPEC.md` states**: *Not Stated (Spec file missing).*
- **What project docs state**: [docs/RULES.md:L12](file:///d:/POS/docs/RULES.md#L12) & [docs/FISCAL_CLIENT.md:L4](file:///d:/POS/docs/FISCAL_CLIENT.md#L4): Sales must proceed offline without blocking. Sales are saved locally in SQLite first; submissions queue into `fiscal_outbox`.
- **Architectural requirement**: Maximum permissible offline duration (e.g., 24 hours, 7 days, or unlimited queueing), batch size when flushing offline queues upon reconnection, and deadline penalties.

### 2.9 Returns and Credit Notes
- **What `docs/FBR_SPEC.md` states**: *Not Stated (Spec file missing).*
- **What project docs state**: [docs/RULES.md:L3](file:///d:/POS/docs/RULES.md#L3) ("Invoices are immutable once finalized. Corrections happen only through credit notes/returns. No UPDATE or DELETE on finalized invoices or their lines.") and [docs/FISCAL_CLIENT.md:L16](file:///d:/POS/docs/FISCAL_CLIENT.md#L16) (`fiscal_outbox.document_type ('invoice'|'credit_note')`).
- **Architectural requirement**: Is there a dedicated credit note / return API endpoint, or is it submitted to the invoice endpoint with a negative quantity / total or an invoice type flag (e.g., `InvoiceType: 2` or `DebitCredit: "Credit"`)? How must the original `fiscal_invoice_number` be referenced?

### 2.10 QR Code Content and Format
- **What `docs/FBR_SPEC.md` states**: *Not Stated (Spec file missing).*
- **What project docs state**: [docs/ARCHITECTURE.md:L24-L25](file:///d:/POS/docs/ARCHITECTURE.md#L24-L25) & [docs/FISCAL_CLIENT.md:L17](file:///d:/POS/docs/FISCAL_CLIENT.md#L17): `fiscal_submissions.qr_payload` column exists. Receipt template reserves space for QR and fiscal number ([apps/desktop/src/renderer/utils/receiptGenerator.ts:L381-L390](file:///d:/POS/apps/desktop/src/renderer/utils/receiptGenerator.ts#L381-L390)).
- **Architectural requirement**: What is the payload string format (e.g., verification URL `https://.../verify?inv=...`, delimited text string, or Base64 encoded JSON)? What is the required error correction level (L/M/Q/H)?

### 2.11 What Must Be Printed on the Receipt
- **What `docs/FBR_SPEC.md` states**: *Not Stated (Spec file missing).*
- **What project docs state**: [Pharmacy_Prompt.md:L412](file:///d:/POS/Pharmacy_Prompt.md#L412): "Receipt shows the QR and fiscal number once available (and the offline-pending behavior the spec requires)." Existing implementation in [apps/desktop/src/renderer/utils/receiptGenerator.ts:L381-L390](file:///d:/POS/apps/desktop/src/renderer/utils/receiptGenerator.ts#L381-L390) renders:
  - Header: `"FBR FISCAL INVOICE (POS)"`
  - Offline status text: `"Offline / FBR Pending"` (when pending)
  - QR Code or placeholder: `"QR Code Space Reserved for FBR Verification"`
  - Invoice Number / FBR Invoice Number
  - Footer: `"POWERED BY HEXALOGIC TECH"`
- **Architectural requirement**: Does FBR mandate specific font sizes, legal disclaimers, FBR logos, customer verification instructions (e.g., "Verify via FBR TaxAsaan App"), or specific layout dimensions (e.g., 80mm vs 58mm thermal)?

### 2.12 Sandbox vs. Production Differences
- **What `docs/FBR_SPEC.md` states**: *Not Stated (Spec file missing).*
- **What project docs state**: [docs/FISCAL_CLIENT.md:L8](file:///d:/POS/docs/FISCAL_CLIENT.md#L8): Development/sandbox uses environment variables (`FBR_SANDBOX_URL`, `FBR_SANDBOX_TOKEN`). Production credentials are per pharmacy, configured via owner UI and encrypted using Electron `safeStorage`.
- **Architectural requirement**: Different base URLs, dummy NTN/POSID values for testing, mock validation responses, and whether sandbox QR codes point to a staging verification portal.

---

## 3. Comprehensive Questions for Integrator / FBR

The following questions must be submitted to the official FBR integrator and technical contact. In strict compliance with instructions, these are cataloged directly without making assumptions or inventing answers.

### Category A: Endpoints & Protocol
1. What is the exact Base URL for the Sandbox / Staging environment, and what is the Base URL for the Production environment?
2. What are the exact URL paths and HTTP methods for:
   - Invoice submission?
   - Return / Credit note submission?
   - Invoice verification / status query (inquiring whether an invoice was recorded)?
   - Daily / Shift reconciliation (Z-report / cumulative totals)?
3. Does the API require standard HTTPS on port 443, or are custom ports utilized?
4. Are client-side TLS certificates (mutual TLS / mTLS) required, or does authentication rely strictly on HTTP headers?

### Category B: Authentication & Security
5. What authentication scheme is required in HTTP request headers (e.g. `Authorization: Bearer <token>`, `Authorization: Token <token>`, custom header such as `POS-Token: ...`, or Basic Auth)?
6. How are credentials provisioned per POS machine: is there a single Bearer token per pharmacy branch, or a distinct machine token / secret per POS Terminal ID (POSID)?
7. Do authentication tokens expire (e.g., OAuth2 token exchange with refresh tokens), or are they long-lived static API keys?
8. Is HMAC request payload signing or digital signature required on each outgoing request body?

### Category C: Payload Schema & Data Formatting
9. What is the exact casing convention and root structure of the JSON payload (e.g. `InvoiceNumber` PascalCase vs `invoice_number` snakeCase vs `invoiceNumber` camelCase)?
10. What are the exact field names for invoice-level totals:
    - Subtotal / Total Sale Value?
    - Discount?
    - Sales Tax / Federal Excise Duty?
    - Extra Tax / Further Tax?
    - Total Payable / Net Amount?
11. In what unit of currency must money amounts be submitted:
    - Integer Paisa (e.g., `10000` for PKR 100.00)?
    - Float/Decimal Pakistani Rupees formatted to two decimal places (e.g., `100.00`)?
    - String representation of decimal Rupees (e.g., `"100.00"`)?
12. What is the expected timestamp format (e.g., UTC ISO-8601 `YYYY-MM-DDTHH:mm:ss.sssZ`, Local ISO-8601 `YYYY-MM-DDTHH:mm:ss+05:00`, or separate date `YYYY-MM-DD` and time `HH:mm:ss` strings)?
13. What is the format and length of the POS Terminal ID (`POSID`), and how is it assigned by FBR during retail registration?
14. What are the required fields for item line items:
    - Item code / SKU?
    - Item description (generic vs. brand)?
    - Quantity (integer or decimal)?
    - Unit price?
    - Tax rate (percentage e.g. `17.0`, or basis points `1700`, or tax category code)?
    - Line tax amount?
    - Line total amount?
15. Is Pakistan Customs Tariff (PCT) / Harmonized System (HS) code mandatory for pharmaceutical retail items? If mandatory, what default PCT code applies to general pharmaceutical drugs, surgical disposables, and nutritional supplements?
16. How should tax-exempt pharmaceutical items (e.g., items exempt under 6th Schedule of the Sales Tax Act) be identified in the payload: via a specific tax rate (`0.0`), a specific exemption code, or an SRO number?

### Category D: Customer Identification & Thresholds
17. At what sale value threshold is a buyer's National Tax Number (NTN) or Computerized National Identity Card (CNIC) legally mandatory on a retail POS invoice?
18. For retail walk-in patients where NTN/CNIC is not mandatory, what default value must be sent (empty string `""`, `null`, `"9999999999999"`, or omitted)?
19. Does FBR require capturing customer name and phone number for retail pharmacy sales?

### Category E: Payment Modes
20. What is the FBR enum or code mapping for payment methods:
    - Cash?
    - Debit / Credit Card?
    - Mobile Wallet (EasyPaisa, JazzCash, Nayapay, Sadapay)?
    - Cheque / Bank Transfer?
    - Customer Credit / Account?
21. For split-tender payments (e.g. part cash and part card on the same sale), does the payload accept an array of payment objects or only a primary payment method?

### Category F: Idempotency, Network Failures & Timeouts
22. How does the FBR endpoint enforce idempotency? Does it support an `Idempotency-Key` or `Client-Request-Id` HTTP header?
23. If a network timeout occurs and our client re-submits an invoice payload with the same local invoice number:
    - Will the server return HTTP 200/201 with the original `fiscal_invoice_number`?
    - Will it return HTTP 400/409 with an error code indicating "Duplicate Invoice", and does that error response include the previously generated `fiscal_invoice_number` and QR payload?
24. Is there a dedicated Status Query / Inquiry endpoint (e.g. `GET /api/invoice/status?posId=...&invoiceNo=...`) to safely inspect the status of an in-flight invoice before attempting a resend?
25. What is the maximum recommended HTTP timeout for fiscal requests before considering the connection timed out?

### Category G: Error Codes & Handling
26. What is the complete catalog of FBR error response status codes and error JSON structures?
27. Which specific error codes represent permanent validation errors (e.g., invalid NTN, malformed schema, unmapped tax rate) where the request should not be retried automatically?
28. Which specific error codes represent transient conditions (e.g., database lock, server overload, temporary gateway timeout) that should be retried using exponential backoff?
29. Are API rate limits enforced? What is the maximum allowed requests-per-second (RPS) per POSID or IP address, and does the server return HTTP 429 with a `Retry-After` header when throttled?

### Category H: Offline Operation & Grace Periods
30. What is the maximum allowable offline grace period (in hours or days) for a retail pharmacy to operate without internet connectivity before fiscal reporting deadlines expire?
31. When internet connectivity is restored after an offline period, should invoices be transmitted sequentially one-by-one, or is there a bulk/batch submission endpoint (e.g. `POST /api/invoices/batch`)?
32. What is the maximum batch size accepted if a bulk submission endpoint exists?
33. Will the FBR system accept invoices whose timestamps reflect an earlier offline date/time without rejecting them as "stale" or "backdated"?

### Category I: Returns, Credit Notes & Adjustments
34. How are sales returns / credit notes reported to FBR:
    - Via a dedicated endpoint (e.g., `POST /api/credit-note`)?
    - Via the standard invoice endpoint with a negative total and negative quantities?
    - Via the standard invoice endpoint with a specific `InvoiceType` enum (e.g. `1 = Sale`, `2 = Return`, `3 = Credit Note`)?
35. Is the FBR Fiscal Invoice Number of the original sale mandatory when submitting a return?
36. If a customer returns goods from an old invoice that was issued offline or before FBR integration was activated (and thus has no FBR fiscal invoice number), how should that return be submitted?
37. Are partial returns (returning 1 out of 5 items from an earlier invoice) supported, and how are they referenced?

### Category J: QR Code Specification & Verification
38. What is the exact string content of the QR code returned or required to be generated:
    - A direct web URL pointing to the FBR verification portal (e.g., `https://verify.fbr.gov.pk/verify?inv=...&pos=...`)?
    - A pipe-delimited or comma-delimited string (e.g., `FBR_INV_NO|POS_ID|DATE|TOTAL_PAID|TAX`)?
    - A Base64-encoded encrypted payload?
39. Does the FBR API response provide the pre-computed raw QR string, or does our client construct the string according to a specific mathematical/cryptographic formula?
40. What is the required QR code dimension (minimum modules/pixels) and Reed-Solomon Error Correction Level (Level L, M, Q, or H) for thermal receipts?

### Category K: Thermal Receipt Printing Requirements
41. What specific text, headers, and disclaimers must be printed on the paper receipt issued to the customer:
    - Official FBR Invoicing heading?
    - FBR Fiscal Invoice Number?
    - FBR POS Registration ID?
    - Pharmacy NTN and STRN?
    - Customer verification instructions (e.g. "Verify invoice using FBR TaxAsaan Mobile App")?
42. If an invoice is finalized while the pharmacy is offline, what exact offline disclaimer must appear on the customer receipt (e.g. "FBR Offline / Verification Pending")?
43. Is reprint of receipts legally regulated? If a receipt is re-printed, must it explicitly state `"DUPLICATE RECEIPT"`?

### Category L: Sandbox vs. Production Certification
44. Does the integrator require a formal certification or test validation phase (e.g., generating 50 test sales, 5 returns, edge-case tests) before issuing production credentials?
45. How is production activation coordinated: does FBR issue a physical certificate / inspection sticker for the pharmacy counter, or is it entirely software-driven?
