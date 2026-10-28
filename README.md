# HexaPharm POS Monorepo

HexaPharm Clinical Pharmacy Point of Sale system built as a TypeScript monorepo with `pnpm` workspaces.

## Structure

- `apps/desktop`: HexaPharm Electron + React + Vite Windows counter application (`@pos/desktop`)
- `apps/server`: Fastify API backend for cloud synchronization (`@pos/server`)
- `packages/shared`: Shared TypeScript definitions and logic (`@pos/shared`)
- `docs/`: System documentation (`RULES.md`, `ARCHITECTURE.md`, `SPEC.md`)

## Prerequisites

- Node.js >= 22.0.0 (tested on Node v24.19.0)
- pnpm >= 9.0.0 (tested on pnpm v12.15.0)
- Docker Desktop (PostgreSQL 16 is required for running server and integration tests)
- Windows PowerShell

## Getting Started (PowerShell)

### 1. Install dependencies

```powershell
pnpm install
```

### 2. Run quality checks

> **Note:** `pnpm test` requires PostgreSQL to be running. Start the container before running tests:
> ```powershell
> docker compose up -d
> ```

```powershell
# Start PostgreSQL container (required for tests)
docker compose up -d

# Typecheck all packages
pnpm typecheck

# Run linter
pnpm lint

# Run all unit and integration tests (requires Postgres)
pnpm test

# Check dependency vulnerabilities
pnpm audit

# Check code formatting
pnpm format:check
```

### 3. Run development servers

```powershell
# Start Electron desktop counter app in development mode
pnpm --filter @pos/desktop dev
# (or shorthand: pnpm dev:desktop)

# Start Fastify cloud sync API server in watch mode
pnpm --filter @pos/server dev
# (or shorthand: pnpm dev:server)
```
