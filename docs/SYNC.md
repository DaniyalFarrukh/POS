# Sync Protocol (Phase 3)

## Principles
- Server is authoritative for master data. Counters are authoritative for transactions they create.
- Every counter change becomes an event in the local outbox. Events are idempotent by eventId.
- Tenant (pharmacyId) and device identity ALWAYS come from the JWT, never from the request body.
- A sale that already happened at a counter is NEVER rejected for insufficient stock (the goods already left). The server accepts it, allows negative balance, and flags it for review.

## Event envelope (shared zod schema)
{ eventId: UUIDv7, deviceSeq: integer (monotonic per device), type: string, entityId: UUIDv7, occurredAt: UTC ISO, schemaVersion: 1, payload: object }

## Event types (Phase 3)
- purchase.received   (creates batches + purchase stock movements)
- invoice.created     (invoice + lines + payments + sale stock movements)
- credit_note.created (credit note + lines + return stock movements)
- stock_adjustment.created (adjustment movements)
Payloads mirror the local SQLite records.

## POST /sync/push
Request: { events: Event[] } (max 100, sorted by deviceSeq ascending). Response: { results: [{ eventId, status, code?, message? }] }
status:
- accepted: applied.
- duplicate: eventId already processed (counts as success for the client).
- retry_later: referenced entity not on server yet (UNKNOWN_BATCH, UNKNOWN_PRODUCT). Client keeps it in the outbox and retries after the next pull.
- rejected: permanently invalid (INVALID_PAYLOAD, TOTALS_MISMATCH, UNKNOWN_TYPE, SCHEMA_VERSION_UNSUPPORTED). Client moves it to its exceptions list.
Rules:
- Each event is processed in its own transaction. A failure in one event never affects others.
- In the same transaction: insert into processed_events (pharmacy_id, event_id) PRIMARY KEY, apply the event, append rows to change_log.
- Server validation: payload matches schema; invoice total equals sum of lines; payments sum to total; referenced products/batches exist for the pharmacy.
- Rejected events are stored in rejected_events (pharmacy_id, device_id, event, code, message, created_at) for owner visibility.
- Negative stock after applying: accept, and record in stock_alerts.

## GET /sync/pull?cursor=<int>&limit=<int, max 500>
Response: { changes: [{ seq, entity, entityId, op: 'upsert'|'delete', data }], nextCursor, hasMore }
- Backed by change_log (seq bigserial, pharmacy_id, entity, entity_id, op, data jsonb, created_at). cursor = last seen seq (start 0).
- Entities: products, tax_categories, branches, counters, users, suppliers, batches, stock_movements.
- Clients upsert by id, so receiving their own changes back is harmless.
- Changes are filtered by pharmacy_id (and branch_id where the entity has one).

## Auth
- Owner creates a one-time device registration code (hashed in DB, expires).
- POST /devices/register { code, deviceName } -> { deviceId, token (JWT with pharmacyId, branchId, deviceId) }.
- Every request checks the device is not revoked.

## Database (server, Postgres)
pharmacies, branches, counters, devices, device_registration_codes, users, tax_categories, products, suppliers, batches, stock_movements, invoices, invoice_lines, payments, credit_notes (+lines), processed_events, rejected_events, stock_alerts, change_log.
All tenant tables have pharmacy_id NOT NULL with an index. Money is integer paisa. IDs are UUIDv7 (uuid type).