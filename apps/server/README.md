# @pos/server — Server & Sync Engine (Phase 3)

The central PostgreSQL backend for cloud synchronization, multi-tenant master data management, and transaction outbox ingestion for the pharmacy counter network.

---

## Prerequisites (Local Development)

- **Docker Desktop for Windows** (with Linux containers enabled)
- **Node.js 22+** and **pnpm 9+**

---

## 1. Local PostgreSQL 16 Setup via Docker

Run the following commands in **Windows PowerShell** from the project root (`d:\POS`):

### Start the PostgreSQL Container
```powershell
docker compose up -d
```

### Verify Container Status & Logs
```powershell
docker compose ps
docker compose logs -f postgres
```

### Stop the Container
```powershell
# Stop container and keep persisted data
docker compose down

# Stop and wipe database volume (clean reset)
docker compose down -v
```

---

## 2. Environment Configuration

Copy the example environment file:
```powershell
# In project root:
Copy-Item .env.example .env

# Or specifically for apps/server:
Copy-Item apps/server/.env.example apps/server/.env
```

To set the environment variable directly in your **PowerShell session**:
```powershell
$env:DATABASE_URL = "postgresql://pos:pos_dev_secret@localhost:5432/pos_server"
```

---

## 3. Database Migrations

Run database migrations against the configured PostgreSQL instance:
```powershell
# Run the migration runner:
pnpm --filter @pos/server migrate

# Generate new Drizzle migration files after editing schema.ts:
pnpm --filter @pos/server db:generate
```

---

## 4. Running the Server & Tests

### Start the API Development Server:
```powershell
pnpm --filter @pos/server dev
```

### Run Automated Tests:
```powershell
pnpm --filter @pos/server test
```
*Note: Test files use an isolated PostgreSQL schema per test suite and automatically clean up after completion.*

---

## Database Architecture Summary (Postgres)

- **Tenant Isolation**: Every tenant table includes a `pharmacy_id` foreign key with an index.
- **Integer Paisa (Rule 1)**: All currency amounts are stored as integer paisa (1 PKR = 100 paisa).
- **UUIDv7 Identifiers (Rule 2)**: All entities use time-sortable UUIDv7 primary keys.
- **Monotonic Sync Sequence**: `change_log.seq` is an auto-incrementing `bigserial` for delta pull streaming.
- **Idempotency (Rule 7)**: `processed_events` enforces `PRIMARY KEY (pharmacy_id, event_id)`.
- **Immutable Invoices (Rule 3)**: `invoices` enforces `UNIQUE (pharmacy_id, invoice_number)`.
