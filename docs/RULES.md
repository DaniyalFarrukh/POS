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