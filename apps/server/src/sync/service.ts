import { generateUuidV7, type SyncEventEnvelope, type SyncResultItem } from '@pos/shared';
import { processedEvents, rejectedEvents } from '../db/schema';
import { SyncRejectedError, SyncRetryLaterError } from './errors';
import { applyPurchaseReceived } from './appliers/purchase';
import { applyInvoiceCreated } from './appliers/invoice';
import { applyCreditNoteCreated } from './appliers/credit-note';
import { applyStockAdjustmentCreated } from './appliers/stock-adjustment';
import type { ApplierContext, DbClient } from './types';

export async function processSyncPushEvents(
  db: DbClient,
  ctx: ApplierContext,
  events: SyncEventEnvelope[]
): Promise<SyncResultItem[]> {
  if (events.length === 0) {
    return [];
  }

  // 1. Tag each event with its original position to guarantee exact response ordering
  const indexed = events.map((event, originalIndex) => ({
    originalIndex,
    event,
  }));

  // 2. Sort events by deviceSeq ascending (docs/SYNC.md)
  indexed.sort((a, b) => a.event.deviceSeq - b.event.deviceSeq);

  const results: SyncResultItem[] = new Array(events.length);

  // 3. Process each event in its own isolated database transaction
  for (const { originalIndex, event } of indexed) {
    try {
      const status = await db.transaction(async (tx) => {
        // Step A: Idempotency insert into processed_events (pharmacy_id, event_id)
        const inserted = await tx
          .insert(processedEvents)
          .values({
            pharmacyId: ctx.pharmacyId,
            eventId: event.eventId,
            processedAt: new Date().toISOString(),
          })
          .onConflictDoNothing()
          .returning({ eventId: processedEvents.eventId });

        if (inserted.length === 0) {
          // Event already processed -> return duplicate status without touching rows
          return 'duplicate' as const;
        }

        // Step B: Schema Version Check
        if (event.schemaVersion !== 1) {
          throw new SyncRejectedError(
            'SCHEMA_VERSION_UNSUPPORTED',
            `Unsupported schema version ${event.schemaVersion}. Only version 1 is supported.`
          );
        }

        // Step C: Dispatch to event type applier
        switch (event.type) {
          case 'purchase.received':
            await applyPurchaseReceived(tx, ctx, event.payload);
            break;
          case 'invoice.created':
            await applyInvoiceCreated(tx, ctx, event.payload);
            break;
          case 'credit_note.created':
            await applyCreditNoteCreated(tx, ctx, event.payload);
            break;
          case 'stock_adjustment.created':
            await applyStockAdjustmentCreated(tx, ctx, event.payload);
            break;
          default:
            throw new SyncRejectedError(
              'UNKNOWN_TYPE',
              `Unknown sync event type: ${event.type}`
            );
        }

        return 'accepted' as const;
      });

      results[originalIndex] = {
        eventId: event.eventId,
        status,
      };
    } catch (err) {
      if (err instanceof SyncRetryLaterError) {
        // Transaction rolled back; processed_events row not saved
        results[originalIndex] = {
          eventId: event.eventId,
          status: 'retry_later',
          code: err.code,
          message: err.message,
        };
      } else if (err instanceof SyncRejectedError) {
        // Transaction rolled back; log to rejected_events for owner visibility
        try {
          await db.insert(rejectedEvents).values({
            id: generateUuidV7(),
            pharmacyId: ctx.pharmacyId,
            deviceId: ctx.deviceId,
            event: event as unknown as Record<string, unknown>,
            code: err.code,
            message: err.message,
            createdAt: new Date().toISOString(),
          });
        } catch (logErr) {
          console.error('Failed to record rejected event in database:', logErr);
        }

        results[originalIndex] = {
          eventId: event.eventId,
          status: 'rejected',
          code: err.code,
          message: err.message,
        };
      } else {
        // Unexpected exception (e.g. database constraint violation)
        // Log full detailed error server-side only
        console.error(`[Sync] Unexpected error processing event ${event.eventId}:`, err);

        const sanitizedMessage = 'An unexpected internal error occurred';

        // Transaction for event rolled back; log to rejected_events in its own isolated transaction
        try {
          await db.transaction(async (tx) => {
            await tx.insert(rejectedEvents).values({
              id: generateUuidV7(),
              pharmacyId: ctx.pharmacyId,
              deviceId: ctx.deviceId,
              event: event as unknown as Record<string, unknown>,
              code: 'INTERNAL_ERROR',
              message: sanitizedMessage,
              createdAt: new Date().toISOString(),
            });
          });
        } catch (logErr) {
          // Never let a logging failure crash or halt processing of the remaining batch
          console.error('[Sync] Failed to record unexpected rejected event in database:', logErr);
        }

        results[originalIndex] = {
          eventId: event.eventId,
          status: 'rejected',
          code: 'INTERNAL_ERROR',
          message: sanitizedMessage,
        };
      }
    }
  }

  return results;
}
