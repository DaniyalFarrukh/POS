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
- Invoices are fully immutable; all fiscal integration state is tracked in the separate `fiscal_submissions` table (status: not_required|pending|submitted|failed, fiscal_invoice_number nullable, qr_payload nullable, created_at, updated_at).
- Receipt template has reserved space for QR and fiscal number.