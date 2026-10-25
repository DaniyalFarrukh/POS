# Pharmacy POS: Antigravity Prompt Playbook

Environment: Windows, Antigravity App, Gemini 3.8 Flash (default) and Gemini 4 Argon (marked **[ARGON]** for the risky parts).

## How to use this file

1. Do Step 0 once.
2. Run the prompts in order. **One prompt = one new conversation.** Do not chain phases in one chat.
3. Before every prompt: `git status` must be clean. After every prompt: run the checks yourself, then `git commit`.
4. Every prompt ends the same way on purpose: plan first, then implement, then run checks and report honestly. Keep that ending.
5. If a prompt fails twice, use the **Fix loop** prompt at the bottom, or paste the code into Claude chat for review.

---

## Step 0: One-time setup (PowerShell)

```powershell
# Install: Node.js LTS, Git, then:
npm install -g pnpm
mkdir C:\dev\pharmacy-pos
cd C:\dev\pharmacy-pos
git init
mkdir docs
```

Open Antigravity, add `C:\dev\pharmacy-pos` as a Project, and select it in the "No Project" dropdown.

Create the three files below in `docs/` (copy-paste the content). Then in **Customizations**, add a workspace rule: *"Before any change, read docs/RULES.md and the current phase in docs/SPEC.md. Never work outside the current task."*

### docs/RULES.md

```md
# Project Rules (must follow in every task)

1. Money is stored as INTEGER paisa. Never use floats for money. All rounding goes through one function in packages/shared with unit tests.
2. All IDs are UUIDv7, generated on the client.
3. Invoices are immutable once finalized. Corrections happen only through credit notes/returns. No UPDATE or DELETE on finalized invoices or their lines.
4. Stock quantity is never stored as an editable number. Stock balance = sum of stock_movements. Every change is a movement row.
5. Any write that touches more than one table happens in ONE database transaction. The outbox row is written in the same transaction.
6. Electron security: contextIsolation ON, nodeIntegration OFF. The renderer never touches the DB or Node APIs. All access goes through a typed preload/IPC bridge with zod-validated inputs.
7. Sync events are idempotent by event id. Replaying an event must never create duplicates.
8. Timestamps are stored as UTC ISO strings. Display in local time (Asia/Karachi).
9. TypeScript strict mode. No `any`. Tests are required for: money, tax, stock, invoice creation, sync.
10. UI: design for 1366x768 first, keyboard-first, light theme, large readable totals, RTL-safe layout (Urdu later). No external CDNs or web fonts (the app must work offline).
11. Do not add dependencies without listing them and the reason in your plan.
12. Do not refactor or change files outside the current task. If you think something outside the task is wrong, tell me instead of fixing it.
13. At the end of every task: run lint, typecheck, and tests, and report exactly what passed or failed. Never claim something works if you did not run it.
```

### docs/ARCHITECTURE.md

```md
# Architecture

## Monorepo (pnpm workspaces, TypeScript)
- apps/desktop   : Electron + React + Vite (counter app, Windows)
- apps/server    : Fastify API + PostgreSQL (cloud, sync endpoints)
- apps/web       : React owner dashboard (later phase)
- packages/shared: types, zod schemas, money/tax utils, sync protocol types
- packages/ui    : shared UI components (Tailwind + shadcn/ui)

## Desktop
- Local DB: SQLite via better-sqlite3 (main process only), WAL mode, Drizzle ORM + migrations run on startup.
- UI -> preload bridge -> IPC handlers -> service layer -> SQLite.
- Outbox table records every change to be synced.
- Sync worker (main process) pushes outbox events and pulls master data when online.

## Data classes and sync rules
1. Master data (products, prices, users, tax categories): cloud is source of truth, pull-only to counters, versioned deltas.
2. Transactions (invoices, returns, payments): created on counter, append-only, push-only, idempotent by event id.
3. Stock: sync movements, never quantities. Cloud computes balances.
4. Config/licence: pull-only with an offline grace period.

## Fiscal (FBR) readiness
- A FiscalService interface sits behind invoice finalization. Current implementation is a no-op.
- invoices have: fiscal_status (not_required|pending|submitted|failed), fiscal_invoice_number (nullable), qr_payload (nullable).
- Receipt template has reserved space for QR and fiscal number.
```

### docs/SPEC.md

```md
# Spec (phases and acceptance tests)

Phase 0: Scaffold. Installable Windows app that creates its DB file on launch.
Phase 1: Core data and inventory. Import CSV, receive purchase, see per-batch stock. Balance equals sum of movements (tested).
Phase 2: Offline checkout. 100 offline sales, crash mid-sale recovers with no duplicates or lost data, stock and cash reconcile to the paisa.
Phase 3: Cloud sync. Two counters selling the same batch offline sync with correct final stock. Duplicate pushes create no duplicates. Server outage mid-push recovers.
Phase 4: Owner dashboard. Cross-branch sales, stock, expiry, supplier ledger.
Phase 5: Hardening. Backups, logging, auto-update, Urdu/English, low-end hardware, pilot.
Phase 6: FBR integration (only after integrator API spec is obtained).

Out of scope until after pilot: insurance billing, loyalty, accounting export, mobile apps.
```

Commit these: `git add . && git commit -m "docs: rules, architecture, spec"`

---

# PHASE 0: Scaffold

### Prompt 0.1 (Flash): Monorepo and Electron shell

```text
Read docs/RULES.md, docs/ARCHITECTURE.md and docs/SPEC.md. Work on Phase 0 only.

Task: create the pnpm monorepo skeleton.
- Root: pnpm-workspace.yaml, tsconfig.base.json (strict), ESLint + Prettier, Vitest config, .gitignore, README with run instructions for Windows PowerShell.
- packages/shared (TypeScript library, exports a placeholder function and a test).
- apps/server: minimal Fastify app with GET /health returning {ok:true}, plus a test.
- apps/desktop: Electron + React + Vite + TypeScript. Main process opens a BrowserWindow with contextIsolation true and nodeIntegration false. Add a preload script exposing a typed bridge object `window.api` with one method `ping()` that round-trips through IPC and returns "pong". The React page shows the result.

Do not add anything else. Show me your plan and the dependency list first, wait for my approval, then implement. When done, run: pnpm install, pnpm lint, pnpm typecheck, pnpm test, and pnpm --filter desktop dev (confirm the window launches if you can). Report exactly what passed and failed.
```

### Prompt 0.2 (Flash): SQLite, migrations, packaging

```text
Read docs/RULES.md and docs/ARCHITECTURE.md. Phase 0 only.

Task: in apps/desktop add the local database and a Windows installer.
- Add better-sqlite3 and Drizzle ORM (sqlite). The DB lives in the main process only. File location: app.getPath('userData')/pharmacy.db. Enable WAL mode and foreign keys.
- Create a migrations folder and a migration runner executed on app startup. Add a first migration with a single `app_meta` table (key, value) and store schema version.
- Expose through the IPC bridge: `getDbInfo()` returning the DB path and schema version. Show it on the page.
- better-sqlite3 is a native module: configure electron-builder (or electron-rebuild) so it is rebuilt for Electron. Explain what you did.
- Configure electron-builder to produce a Windows NSIS installer (unsigned is fine for now).
- Add a GitHub Actions workflow running lint, typecheck, test on push.

Plan first and wait for approval. Then implement and run pnpm build plus the installer build. Report exactly what passed or failed, and the path of the generated installer.
```

**Your check:** install the .exe on a clean PC (or VM), launch it, and confirm the DB path and schema version appear.

---

# PHASE 1: Core data and inventory

### Prompt 1.1 (Flash): Schema and migrations

```text
Read docs/RULES.md and docs/ARCHITECTURE.md. Phase 1 only.

Task: define the local SQLite schema with Drizzle and migrations in apps/desktop (and shared types/zod schemas in packages/shared).
Tables: branches, counters, users (role: owner|pharmacist|cashier, pin_hash), tax_categories (name, rate_bp as integer basis points, is_exempt), products (id, brand_name, generic_name, strength, form, manufacturer, barcode unique nullable, tax_category_id, mrp_paisa, is_controlled, is_active), suppliers, batches (product_id, batch_no, expiry_date, cost_paisa, mrp_paisa), stock_movements (id, product_id, batch_id, branch_id, type: purchase|sale|return|adjustment|transfer_in|transfer_out, quantity_signed, reference_type, reference_id, reason, created_at).
Every table has id (UUIDv7), created_at, updated_at. Add useful indexes (barcode, generic_name, brand_name, batch expiry).
Also create a view or query function `getStockByBatch(branchId)` that sums stock_movements.

Write unit tests proving: balance equals the sum of movements; negative quantities for sales; no direct quantity column exists. Plan first, wait for approval, implement, run lint/typecheck/tests, report results.
```

### Prompt 1.2 (Flash): Users, PIN login, roles

```text
Read docs/RULES.md. Phase 1 only.

Task: local authentication in apps/desktop.
- First-run setup screen: create branch, counter, and the owner user with a PIN.
- Login screen with user selection and PIN entry (numeric keypad + keyboard). Hash PINs with a pure-JS library (bcryptjs) in the main process. Never expose hashes to the renderer.
- Role guard in the IPC layer (not only in the UI): owner can manage users; pharmacist can manage products/stock; cashier can only sell. Provide a typed `requireRole()` helper with tests.
- Auto-lock after configurable idle time.
- Layout shell: top bar (branch, counter, user, online/offline placeholder), left navigation by role.

Plan first, wait for approval. Then implement and test. Report what passed and failed.
```

### Prompt 1.3 (Flash): Products and CSV import

```text
Read docs/RULES.md. Phase 1 only.

Task: product management screens.
- Product list: fast search by brand or generic name or barcode (debounced), sortable table, paging/virtualization for 20,000+ rows.
- Product form (create/edit) with validation (zod), tax category select, controlled-drug flag.
- CSV import wizard: choose file, map columns, preview first 20 rows with validation errors highlighted, import valid rows in one transaction, show a summary with skipped rows and reasons. Handle duplicates by barcode.
- Add a seed script producing 200 realistic dummy pharmacy products for development.

Include tests for the CSV parser/validator (bad rows, duplicates, empty fields, quoted commas). Plan first, wait for approval, implement, run checks, report.
```

### Prompt 1.4 (Flash): Suppliers, purchase receiving, stock views

```text
Read docs/RULES.md. Phase 1 only.

Task: purchasing and stock screens.
- Suppliers CRUD.
- Purchase receiving (GRN) screen: choose supplier, supplier invoice number, add lines (product, batch no, expiry date, quantity, cost, MRP). On save, in ONE transaction: create purchase document + lines, create/merge batches, create purchase stock_movements.
- Stock overview by product and by batch (quantity, expiry, cost). Filters: low stock, expiring within 60/90 days, expired.
- Stock adjustment screen with required reason (damage, loss, correction), creating adjustment movements.

Tests: receiving the same batch twice merges correctly; adjustment creates a signed movement; totals match. Plan first, wait for approval, implement, run checks, report.
```

**Phase 1 acceptance (you):** import CSV, receive a purchase, view per-batch stock. All tests green.

---

# PHASE 2: Offline checkout

### Prompt 2.1 (Flash): Money and tax utilities

```text
Read docs/RULES.md. Phase 2 only.

Task: in packages/shared create money and tax utilities with thorough tests.
- Money type as integer paisa. Functions: add, subtract, multiplyByQuantity, applyPercentDiscount (basis points), applyFlatDiscount, formatPKR.
- Tax: compute line tax from net amount and rate in basis points, with ONE documented rounding rule (round half up per line). Support tax-exempt items. Provide a function that computes invoice totals from lines and verifies sum of line totals equals invoice total.
- Property-style tests: totals never differ by even 1 paisa between computing per line and summing; no floats anywhere.

Plan first, wait for approval, implement, run tests, report.
```

### Prompt 2.2 (Flash): Checkout screen UI (no saving yet)

```text
Read docs/RULES.md. Phase 2 only.

Task: build the main checkout screen in apps/desktop. UI only, using in-memory state; do NOT write invoices to the DB yet.
- Layout for 1366x768: search/scan field fixed at top, cart table in the middle, totals and Pay button fixed at the bottom/right.
- Search by brand or generic name or barcode; Enter adds the top result; a barcode scanner (acts as keyboard) adds instantly. Show substitutes (same generic) when an item has no stock.
- Cart: change quantity, line discount, remove line, clear cart (with confirm).
- Keyboard shortcuts with an on-screen overlay when ALT is held: F2 pay, F3 search focus, F4 hold cart, F6 customer/notes, Del remove line, Esc cancel dialogs. Use a central shortcut manager.
- Show near-expiry and out-of-stock warnings inline per line using color + icon + text.
- Use totals from packages/shared utilities.

Plan first and wait for approval. Implement. Run lint/typecheck/tests and describe how to try it manually. Report honestly.
```

### Prompt 2.3 **[ARGON, High]**: Invoice transaction service

```text
Read docs/RULES.md and docs/ARCHITECTURE.md carefully. Phase 2 only. This is the most critical code in the project.

Task: implement the main-process service `finalizeSale(input)`.
Input: counter, cashier, cart lines (product, quantity, discount), payments (method, amount), optional notes.
Behavior inside ONE SQLite transaction:
1. Re-validate everything on the server side of IPC (prices, stock, discounts, user role). Never trust renderer totals.
2. FEFO allocation: allocate each line across batches by earliest expiry; never allocate expired batches; if a line spans multiple batches create one invoice line per batch. Fail with a clear error if stock is insufficient.
3. Generate the next sequential invoice number per counter without gaps (prefix by counter) safely.
4. Insert invoice, invoice_lines (with per-line tax), payments, sale stock_movements (negative quantities).
5. Insert an outbox row (event id UUIDv7, type invoice.created, payload).
6. Set fiscal_status to not_required and call FiscalService.onInvoiceFinalized() (no-op implementation behind an interface).
Also implement `createCreditNote()` basics later; for now leave a TODO interface.
Finalized invoices must be impossible to UPDATE or DELETE: add SQLite triggers that raise an error on such attempts.

Tests (must be real and must fail if logic is broken): FEFO ordering, multi-batch split, expired batch blocked, insufficient stock rolls back everything, invoice numbers sequential under rapid calls, totals reconcile to the paisa, trigger blocks edits, idempotent behavior if the same client request id is submitted twice.

Plan first, list risks you see, wait for my approval, then implement. Run all tests and report exactly what passed/failed.
```

### Prompt 2.4 (Flash): Payments, receipts, held carts

```text
Read docs/RULES.md. Phase 2 only.

Task: wire the checkout UI to finalizeSale and add payment and receipt features.
- Payment dialog: cash (with change due), card, wallet (recorded types only, no gateway), split payments, must cover total exactly before finalizing.
- After success: print a receipt and clear the cart. If printing fails, the sale stays saved and a Reprint button is available in invoice history.
- Receipt: 80mm thermal layout via the Windows print path first (HTML to print). Include pharmacy name, address, invoice number, date, lines with batch and expiry optional toggle, totals, tax summary, payment, and a reserved empty area for a future QR code and fiscal invoice number. English now; keep text in a translations file for Urdu later.
- Held carts: hold with F4, list held carts, resume.
- Invoice history screen: search by number/date, view, reprint.

Do not change the finalizeSale logic. Plan first, wait for approval, implement, run checks, report.
```

### Prompt 2.5 (Flash): Returns and day-end

```text
Read docs/RULES.md. Phase 2 only.

Task: returns and shift closing.
- Open shift with opening cash; close shift with counted cash, expected vs actual difference, sales summary by payment method.
- Returns: find original invoice, select lines and quantities (cannot exceed sold minus already returned), choose reason, create a credit note (new immutable document) and positive return stock_movements back into the original batch, plus an outbox event. All in one transaction.
- Day-end report screen and printable summary.

Tests: cannot over-return; stock restored to the correct batch; credit note totals correct; cash expected equals sales minus refunds in cash.
Plan first, wait for approval, implement, run checks, report.
```

**Phase 2 acceptance (you):** run a script or manual session of 100 sales with the internet off, kill the app mid-sale, restart, confirm no lost or duplicate invoices, and reconcile stock and cash totals.

---

# PHASE 3: Cloud sync

### Prompt 3.1 **[ARGON, High]**: Sync protocol and server

```text
Read docs/RULES.md and docs/ARCHITECTURE.md. Phase 3 only.

Task: design and implement the sync protocol and the cloud side.
1. In packages/shared define zod schemas for sync events and responses.
2. In apps/server: PostgreSQL schema (Drizzle) with multi-tenant pharmacy_id mirroring master data, invoices, invoice_lines, payments, stock_movements, and a processed_events table (event_id primary key).
3. POST /sync/push: accepts a batch of events in creation order; for each event returns accepted | duplicate | rejected(reason). Idempotent by event id. Apply each event in its own transaction. Rejected events must never block later events.
4. GET /sync/pull?cursor=...: returns master-data changes (products, prices, tax categories, users) since the cursor with a new cursor, paged.
5. Device registration and JWT auth per counter. Reject cross-tenant access.
6. Stock balances on the server are computed from movements.

Tests: duplicate push, out-of-order batches, partial failure, unknown product reference (rejected with reason), tenant isolation, cursor paging.
Write a short docs/SYNC.md describing the protocol. Plan first, list edge cases you will handle, wait for approval, then implement. Run tests and report.
```

### Prompt 3.2 **[ARGON, High]**: Desktop sync worker

```text
Read docs/RULES.md and docs/SYNC.md. Phase 3 only.

Task: implement the desktop sync worker in the Electron main process.
- Connectivity check with heartbeat; states: online, offline, syncing, error.
- Push: read unsent outbox rows ordered by creation, send in batches, mark acknowledged on accepted/duplicate, move rejected ones to a sync_exceptions table with the reason. Exponential backoff with jitter. Survives app restart.
- Pull: apply master data deltas in a single transaction per page, store the cursor.
- Configurable maximum offline duration with warning thresholds, exposed via IPC.
- Never block sales on sync status.

Tests with a fake server: network drop mid-push, duplicate acks, restart during sync, rejected event handling, pull with partial page failure. Plan first, wait for approval, implement, run tests, report.
```

### Prompt 3.3 (Flash): Sync UI

```text
Read docs/RULES.md. Phase 3 only.

Task: sync UI in apps/desktop.
- Top-bar indicator: Online / Offline / Syncing with a pending-events count; click opens Sync Status.
- Sync Status page: last successful push/pull, pending count, offline duration vs limit, Retry now button.
- Exceptions screen (owner/pharmacist): list rejected events with reason and payload summary, with Retry and Dismiss-with-note actions.
- Warning banner when approaching the offline limit.

UI only on top of existing IPC; do not change sync logic. Plan first, wait for approval, implement, run checks, report.
```

### Prompt 3.4 **[ARGON]**: Integration test scenarios

```text
Read docs/RULES.md and docs/SYNC.md. Phase 3 only.

Task: write automated integration tests (start the server against a test Postgres, use two simulated counters with separate SQLite DBs) covering:
1. Two counters sell the same batch offline, then sync: final server stock equals the sum of movements and is correct.
2. The same event is pushed twice: no duplicates.
3. Server goes down mid-push, comes back: all events eventually arrive once, in order.
4. A price changes on the server: both counters receive it on pull.
5. Counter app is killed after writing the outbox: events still sync after restart.
Fix real bugs you find in the sync code, listing each bug and fix. Report the final test results honestly.
```

---

# PHASE 4: Owner dashboard

### Prompt 4.1 (Flash): Web app and reports

```text
Read docs/RULES.md. Phase 4 only.

Task: create apps/web (React + Vite + Tailwind + shadcn/ui, with a shared packages/ui) and add server endpoints it needs.
- Login (owner), overview page: today's sales, number of invoices, top products, expiring soon, low stock.
- Reports: sales by day/branch/cashier, stock and expiry across branches, profit per batch (sale price minus batch cost), supplier ledger.
- Admin: users, branches, counters, registered devices with last-seen and pending sync info.
- Audit log viewer (read-only).
Role-based access enforced on the server. Add tests for report queries with known fixtures. Plan first, wait for approval, implement, run checks, report.
```

---

# PHASE 5: Hardening and pilot

### Prompt 5.1 (Flash): Backups, logging, updates

```text
Read docs/RULES.md. Phase 5 only.

Task: reliability features in apps/desktop.
- Automatic daily local backup of the SQLite DB using the safe SQLite backup API (not a raw file copy while writing), keeping the last 14, with a restore screen (owner only, with confirmation).
- Structured logging to a rotating file, plus a "Export diagnostics" button that zips logs and app/DB version info (no patient or sales data).
- Crash handling: global error handler with a friendly screen.
- Auto-update setup with electron-updater (pointing to a placeholder URL, documented).
- Startup integrity check (PRAGMA integrity_check) with a clear message if it fails.

Plan first, wait for approval, implement, run checks, report.
```

### Prompt 5.2 (Flash): Language and hardware

```text
Read docs/RULES.md. Phase 5 only.

Task: Urdu/English support and hardware polish.
- Add i18n with English and Urdu, language switch in Settings, RTL layout support. Bundle an Urdu font locally (no CDN).
- Ensure receipts can print Urdu text correctly.
- Settings: printer selection, paper width, receipt header/footer, scanner test field, shortcut reference page.
- Performance pass for low-end PCs (4GB RAM): lazy-load heavy screens, virtualize tables, measure startup and checkout search latency with 20,000 products and report the numbers.

Plan first, wait for approval, implement, run checks, report measured numbers honestly.
```

**Pilot checklist (you):** test on two real low-end PCs, real thermal printer and barcode scanner, run one full week in 1-2 friendly pharmacies, log all bugs.

---

# PHASE 6: FBR integration (only after you have the integrator API spec)

Do not run this until you have the official API specification and sandbox credentials from your integrator. Paste the spec into `docs/FBR_SPEC.md` first.

### Prompt 6.1 **[ARGON]**: Fiscal adapter

```text
Read docs/RULES.md, docs/ARCHITECTURE.md and docs/FBR_SPEC.md. Phase 6 only.

Task: implement the real FiscalService adapter using ONLY what docs/FBR_SPEC.md states. If something is missing or unclear in the spec, list your questions instead of guessing.
- Map invoices to the required payload fields; add a fiscal_outbox processed by the existing sync worker pattern with retries and offline queueing.
- Store fiscal_invoice_number and qr_payload on the invoice record via a separate fiscal_submissions table (never edit the finalized invoice itself).
- Receipt shows the QR and fiscal number once available (and the offline-pending behavior the spec requires).
- Sandbox configuration via environment settings, never hardcoded credentials.
Tests with a mocked fiscal API: success, validation error, timeout, retry, duplicate submission. Plan first, list questions, wait for approval, implement, report.
```

---

# Utility prompts

### Fix loop (when something fails)

```text
Read docs/RULES.md. Here is the exact error output and what I did:

[paste full error, command run, and steps]

First explain the root cause in plain language and show which file and line it comes from. Do not change anything yet. Then propose the smallest fix, wait for approval, apply it, and re-run the same command. Report the real result.
```

### Review (use Argon, or paste into Claude chat)

```text
Review the changes from the last commit (git diff HEAD~1) against docs/RULES.md. Act as a skeptical senior reviewer. List violations of the rules, possible bugs (especially money rounding, stock movements, transactions, race conditions, and offline/crash safety), and missing tests. Do not change code; give a prioritized list with file and line references.
```

### Context reset (start of a long task)

```text
Read docs/RULES.md, docs/ARCHITECTURE.md, docs/SPEC.md and docs/SYNC.md (if present). Summarize in 10 lines the current phase, what exists in the repo (list top-level folders and key modules), and what is NOT built yet. Do not change anything.
```

---

## Rules of thumb

- Flash for UI, CRUD, scaffolding. Argon (or a manual review) for invoices, stock, sync, tax.
- Never accept "done" without running the checks yourself.
- Commit after every working prompt. If a task goes badly, `git reset --hard` and re-run it with a tighter prompt.
- Keep prompts small. If the plan Flash shows looks too big, tell it to split the task.