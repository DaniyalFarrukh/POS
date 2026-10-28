# Fiscal Client Design (Phase 6)

## Principles
- Never block or slow a sale because of FBR. The sale is saved first; fiscal submission happens afterwards in the background.
- Finalized invoices are never edited. Fiscal results live in fiscal_submissions.
- Anything not stated in docs/FBR_SPEC.md must be written down as a question, never guessed. This includes field names, formats, rounding, endpoints, auth, error codes, and how returns are reported.
- Never resend blindly after a timeout: the first request may have succeeded. Use the spec's idempotency key or status-query endpoint if it has one; if it has neither, stop and ask.
- Credentials: sandbox URL and token come from environment variables in development. Production credentials are per pharmacy, entered in a settings screen and stored with Electron safeStorage. Never log secrets, never commit them, never send them to the renderer.
- Use the invoice's stored timestamps, not the current time, when building payloads.

## Structure
- apps/desktop/src/main/fiscal/core/: pure logic, NO electron imports, dependencies injected (db, fetch, clock, logger, config).
- apps/desktop/src/main/fiscal/adapters/: Electron-specific code (safeStorage, IPC, hooks).

## Tables (new migration, never edit old ones)
- fiscal_outbox: id, document_type ('invoice'|'credit_note'), document_id, status ('pending'|'in_flight'|'submitted'|'rejected'), attempts, next_attempt_at, last_error, created_at, updated_at. UNIQUE (document_type, document_id).
- fiscal_submissions (already exists): status, fiscal_invoice_number, qr_payload. Add request_snapshot and response_snapshot (JSON, with secrets removed) for audit.
- fiscal_submissions.status values: not_required | pending | submitted | failed (failed means permanently rejected).

## Retry rules
- Network error, timeout, HTTP 5xx: stays pending, attempts+1, next_attempt_at via exponential backoff with jitter. Single-flight.
- Validation error (the spec's 4xx/error codes): status failed, last_error stored, owner sees it in a list with Retry after fixing data.
- Auth error: stop sending, keep everything queued, show in status.
- In-flight at app crash: on restart, treat as unknown outcome and follow the spec's rule for that case (status query or idempotent resend).