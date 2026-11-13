# HexaPharm POS Security Rules & Guidelines

## 1. Secrets & Credentials Management
- Never commit `.env`, private keys (`.pem`, `.key`), certificates, or local SQLite/PostgreSQL dump files to git.
- Any server credentials (e.g. `DATABASE_URL`, `JWT_SECRET`, API keys) must be supplied via environment variables only.
- In client bundles (Electron desktop app and web frontend), never bundle or expose `service_role` keys, database connection strings, or master administrative tokens.
- All tokens stored on the desktop terminal must be encrypted at rest using OS-level secure storage (Electron `safeStorage` via Windows DPAPI).

## 2. Multi-Tenant Row Level Security (RLS) & Access Control
- Every table containing tenant data in PostgreSQL must have Row Level Security (RLS) enabled.
- Branch and role scoping must be enforced:
  - Pharmacy isolation: all queries must be scoped to `pharmacy_id`.
  - Cashier/terminal operations must be scoped to authenticated `deviceContext` (`pharmacy_id`, `branch_id`, `counter_id`).
  - Strict role-based permissions (`owner`, `manager`, `accountant`, `pharmacist`, `cashier`) must be validated for every sensitive API route.

## 3. Offline-First Sync & Data Integrity
- Invoices and financial events are generated locally with UUIDv7 and preserved across network drops.
- Push operations must be idempotent (`processed_events` tracking) to prevent duplicate transactions.
- Zero data loss: client outbox events must remain intact and pending until the server returns an acknowledgment (`acked`).
- Network failures, timeouts, and 5xx responses must trigger backoff retries without purging or altering local records.

## 4. API Resilience & Resource Protection
- All network requests must specify explicit timeouts (e.g., 5-10 seconds with `AbortController`).
- All list endpoints must enforce pagination with hard limits (e.g., maximum 100-500 items per page).
- Rate limiting must be applied to authentication and sensitive routes to mitigate brute-force and credential spraying.
