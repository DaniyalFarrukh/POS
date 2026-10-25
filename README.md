# POS Monorepo

Point of Sale system built as a TypeScript monorepo with `pnpm` workspaces.

## Structure

- `apps/desktop`: Electron + React + Vite Windows counter application (`@pos/desktop`)
- `apps/server`: Fastify API backend for cloud synchronization (`@pos/server`)
- `packages/shared`: Shared TypeScript definitions and logic (`@pos/shared`)
- `docs/`: System documentation (`RULES.md`, `ARCHITECTURE.md`, `SPEC.md`)

## Prerequisites

- Node.js >= 22.0.0 (tested on Node v24.19.0)
- pnpm >= 9.0.0 (tested on pnpm v12.15.0)
- Windows PowerShell

## Getting Started (PowerShell)

### 1. Install dependencies

```powershell
pnpm install
```

### 2. Run quality checks

```powershell
# Typecheck all packages
pnpm typecheck

# Run linter
pnpm lint

# Run all unit tests
pnpm test

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
