import type { Database as DatabaseInstance } from 'better-sqlite3';
import {
  SyncPullResponseSchema,
  SyncProductChangeDataSchema,
  type SyncChangeItem,
} from '@pos/shared';
import type { PullSummary } from './types';

export const CURSOR_OVERLAP = 50;

export interface PullAndApplyDependencies {
  db: DatabaseInstance;
  fetch: typeof fetch;
  clock?: { now: () => Date };
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
}

export interface PullAndApplyParams {
  serverUrl: string;
  token: string;
  limit?: number;
}

/**
 * Executes the client pull step per docs/SYNC_CLIENT.md:
 * - Loops GET /sync/pull?cursor=&limit=200 while hasMore
 * - Validates each response with the shared zod schema
 * - For each page, in ONE transaction: applies changes in seq order and updates pull_cursor
 * - Upsert by id for master tables; delete op marks inactive
 * - Batches and stock_movements are insert-only-if-missing
 * - Never writes outbox rows (no echo)
 * - Unknown entities are skipped with a warning; cursor still advances
 * - Updates last_pull_ok_at and last_online_at on success
 */
export async function pullAndApply(
  deps: PullAndApplyDependencies,
  params: PullAndApplyParams
): Promise<PullSummary> {
  const db = deps.db;
  const nowFn = () => (deps.clock ? deps.clock.now() : new Date()).toISOString();

  // 1. Read current pull_cursor from sync_state (default: 0)
  const cursorRow = db
    .prepare<[string], { value: string }>(
      'SELECT value FROM sync_state WHERE key = ?'
    )
    .get('pull_cursor');
  let currentCursor = cursorRow ? parseInt(cursorRow.value, 10) : 0;
  if (Number.isNaN(currentCursor) || currentCursor < 0) {
    currentCursor = 0;
  }

  // Safety overlap on initial pull from stored cursor to handle out-of-order PostgreSQL sequence commits
  let requestCursor = Math.max(0, currentCursor - CURSOR_OVERLAP);

  const pageLimit = Math.max(1, Math.min(params.limit ?? 200, 500));
  let hasMore = true;
  let pagesCount = 0;
  let changesAppliedTotal = 0;

  const defaultTaxCatRow = db
    .prepare<[], { id: string }>('SELECT id FROM tax_categories LIMIT 1')
    .get();
  const defaultTaxCatId = defaultTaxCatRow?.id;

  // Prepare reusable statements for applying pulled entities (all parameter-bound)
  const upsertProductStmt = db.prepare(`
    INSERT INTO products (
      id, brand_name, generic_name, strength, form, manufacturer, barcode, tax_category_id, mrp_paisa, is_controlled, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      brand_name = excluded.brand_name,
      generic_name = excluded.generic_name,
      strength = excluded.strength,
      form = excluded.form,
      manufacturer = excluded.manufacturer,
      barcode = excluded.barcode,
      tax_category_id = excluded.tax_category_id,
      mrp_paisa = excluded.mrp_paisa,
      is_controlled = excluded.is_controlled,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `);
  const deleteProductStmt = db.prepare(`
    UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?
  `);

  const upsertTaxCatStmt = db.prepare(`
    INSERT INTO tax_categories (
      id, name, rate_bp, is_exempt, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      rate_bp = excluded.rate_bp,
      is_exempt = excluded.is_exempt,
      updated_at = excluded.updated_at
  `);
  const deleteTaxCatStmt = db.prepare(`
    UPDATE tax_categories SET is_exempt = 1, updated_at = ? WHERE id = ?
  `);

  const upsertBranchStmt = db.prepare(`
    INSERT INTO branches (
      id, name, created_at, updated_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      updated_at = excluded.updated_at
  `);

  const upsertCounterStmt = db.prepare(`
    INSERT INTO counters (
      id, branch_id, name, code, last_invoice_seq, last_credit_note_seq, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      code = excluded.code,
      updated_at = excluded.updated_at
  `);

  const upsertUserStmt = db.prepare(`
    INSERT INTO users (
      id, name, role, pin_hash, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      pin_hash = CASE WHEN excluded.pin_hash != '' THEN excluded.pin_hash ELSE users.pin_hash END,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `);
  const deleteUserStmt = db.prepare(`
    UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?
  `);

  const upsertSupplierStmt = db.prepare(`
    INSERT INTO suppliers (
      id, name, contact_person, phone, email, address, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      contact_person = excluded.contact_person,
      phone = excluded.phone,
      email = excluded.email,
      address = excluded.address,
      updated_at = excluded.updated_at
  `);
  const deleteSupplierStmt = db.prepare(`
    UPDATE suppliers SET is_active = 0, updated_at = ? WHERE id = ?
  `);

  // Batches and stock_movements are insert-only-if-missing (never overwrite locally-created data)
  const insertBatchIfMissingStmt = db.prepare(`
    INSERT OR IGNORE INTO batches (
      id, product_id, batch_no, expiry_date, cost_paisa, mrp_paisa, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMovementIfMissingStmt = db.prepare(`
    INSERT OR IGNORE INTO stock_movements (
      id, product_id, batch_id, branch_id, type, quantity_signed, reference_type, reference_id, reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateCursorStmt = db.prepare(`
    INSERT OR REPLACE INTO sync_state (key, value) VALUES ('pull_cursor', ?)
  `);

  // Function to apply an individual change row inside the transaction
  function applyChange(change: SyncChangeItem, now: string) {
    const data = change.data;
    const op = change.op;

    switch (change.entity) {
      case 'product':
      case 'products': {
        if (op === 'delete') {
          deleteProductStmt.run(now, change.entityId);
        } else {
          const rawData =
            typeof data === 'object' && data !== null
              ? { id: change.entityId, ...data }
              : data;
          const parsed = SyncProductChangeDataSchema.safeParse(rawData);
          if (!parsed.success) {
            deps.logger?.warn?.(
              `[PullAndApply] Incomplete or invalid product payload for entity ${change.entityId}: ${parsed.error.message}`
            );
            break;
          }
          const valid = parsed.data;
          const taxCatId = valid.taxCategoryId || defaultTaxCatId;
          if (!taxCatId) {
            deps.logger?.warn?.(
              `[PullAndApply] Cannot apply product ${valid.id} without a tax category in local database`
            );
            break;
          }
          upsertProductStmt.run(
            valid.id,
            valid.brandName,
            valid.genericName,
            valid.strength,
            valid.form,
            valid.manufacturer,
            valid.barcode ?? null,
            taxCatId,
            valid.mrpPaisa,
            valid.isControlled ? 1 : 0,
            valid.isActive ? 1 : 0,
            valid.createdAt || now,
            valid.updatedAt || now
          );
        }
        break;
      }

      case 'tax_category':
      case 'tax_categories': {
        if (op === 'delete') {
          deleteTaxCatStmt.run(now, change.entityId);
        } else {
          upsertTaxCatStmt.run(
            change.entityId,
            (data.name || '') as string,
            Number(data.rateBp || data.rate_bp || 0),
            data.isExempt || data.is_exempt ? 1 : 0,
            (data.createdAt || data.created_at || now) as string,
            (data.updatedAt || data.updated_at || now) as string
          );
        }
        break;
      }

      case 'branch':
      case 'branches': {
        if (op !== 'delete') {
          upsertBranchStmt.run(
            change.entityId,
            (data.name || '') as string,
            (data.createdAt || data.created_at || now) as string,
            (data.updatedAt || data.updated_at || now) as string
          );
        }
        break;
      }

      case 'counter':
      case 'counters': {
        if (op !== 'delete') {
          upsertCounterStmt.run(
            change.entityId,
            (data.branchId || data.branch_id || '') as string,
            (data.name || '') as string,
            (data.code ?? null) as string | null,
            Number(data.lastInvoiceSeq || data.last_invoice_seq || 0),
            Number(data.lastCreditNoteSeq || data.last_credit_note_seq || 0),
            (data.createdAt || data.created_at || now) as string,
            (data.updatedAt || data.updated_at || now) as string
          );
        }
        break;
      }

      case 'user':
      case 'users': {
        if (op === 'delete') {
          deleteUserStmt.run(now, change.entityId);
        } else {
          upsertUserStmt.run(
            change.entityId,
            (data.name || '') as string,
            (data.role || 'cashier') as string,
            (data.pinHash || data.pin_hash || '') as string,
            (data.isActive !== undefined ? data.isActive : data.is_active !== undefined ? data.is_active : true) ? 1 : 0,
            (data.createdAt || data.created_at || now) as string,
            (data.updatedAt || data.updated_at || now) as string
          );
        }
        break;
      }

      case 'supplier':
      case 'suppliers': {
        if (op === 'delete') {
          deleteSupplierStmt.run(now, change.entityId);
        } else {
          upsertSupplierStmt.run(
            change.entityId,
            (data.name || '') as string,
            ((data.contactPerson || data.contact_person) ?? null) as string | null,
            (data.phone ?? null) as string | null,
            (data.email ?? null) as string | null,
            (data.address ?? null) as string | null,
            (data.createdAt || data.created_at || now) as string,
            (data.updatedAt || data.updated_at || now) as string
          );
        }
        break;
      }

      case 'batch':
      case 'batches': {
        if (op !== 'delete') {
          insertBatchIfMissingStmt.run(
            change.entityId,
            (data.productId || data.product_id || '') as string,
            (data.batchNo || data.batch_no || '') as string,
            (data.expiryDate || data.expiry_date || '') as string,
            Number(data.costPaisa || data.cost_paisa || 0),
            Number(data.mrpPaisa || data.mrp_paisa || 0),
            (data.createdAt || data.created_at || now) as string,
            (data.updatedAt || data.updated_at || now) as string
          );
        }
        break;
      }

      case 'stock_movement':
      case 'stock_movements': {
        if (op !== 'delete') {
          const productId = (data.productId || data.product_id || '') as string;
          const batchId = ((data.batchId || data.batch_id) ?? null) as string | null;
          const branchId = (data.branchId || data.branch_id || '') as string;
          const type = (data.type || 'adjustment') as string;
          const quantitySigned = Number(
            data.quantitySigned !== undefined ? data.quantitySigned : data.quantity_signed || 0
          );
          const referenceType = ((data.referenceType || data.reference_type) ?? null) as string | null;
          const referenceId = ((data.referenceId || data.reference_id) ?? null) as string | null;
          const reason = (data.reason ?? null) as string | null;
          const createdAt = (data.createdAt || data.created_at || now) as string;
          const updatedAt = (data.updatedAt || data.updated_at || now) as string;

          insertMovementIfMissingStmt.run(
            change.entityId,
            productId,
            batchId,
            branchId,
            type,
            quantitySigned,
            referenceType,
            referenceId,
            reason,
            createdAt,
            updatedAt
          );
        }
        break;
      }

      case 'shift':
      case 'shifts':
      case 'invoice':
      case 'invoices':
      case 'invoice_line':
      case 'invoice_lines':
      case 'payment':
      case 'payments':
      case 'credit_note':
      case 'credit_notes':
      case 'credit_note_line':
      case 'credit_note_lines': {
        break;
      }

      default: {
        deps.logger?.warn(
          `[PullAndApply] Unknown entity type "${change.entity}" encountered; skipping row.`
        );
        break;
      }
    }
  }

  // 2. Main Pull Loop while hasMore
  while (hasMore) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    const pullUrl = `${params.serverUrl.replace(/\/+$/, '')}/sync/pull?cursor=${requestCursor}&limit=${pageLimit}`;

    let response: Response;
    try {
      response = await deps.fetch(pullUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.token}`,
        },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      deps.logger?.warn(
        `[PullAndApply] Network error during pull: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return {
        pages: pagesCount,
        changesApplied: changesAppliedTotal,
        newCursor: currentCursor,
        failedRequest: true,
        authError: false,
      };
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 401 || response.status === 403) {
      deps.logger?.warn(`[PullAndApply] Auth error (${response.status}) on pull.`);
      return {
        pages: pagesCount,
        changesApplied: changesAppliedTotal,
        newCursor: currentCursor,
        failedRequest: false,
        authError: true,
      };
    }

    if (!response.ok) {
      deps.logger?.warn(`[PullAndApply] HTTP ${response.status} returned from server.`);
      return {
        pages: pagesCount,
        changesApplied: changesAppliedTotal,
        newCursor: currentCursor,
        failedRequest: true,
        authError: false,
      };
    }

    let rawJson: unknown;
    try {
      rawJson = await response.json();
    } catch {
      deps.logger?.error('[PullAndApply] Failed to parse pull response JSON.');
      return {
        pages: pagesCount,
        changesApplied: changesAppliedTotal,
        newCursor: currentCursor,
        failedRequest: true,
        authError: false,
      };
    }

    const parseResult = SyncPullResponseSchema.safeParse(rawJson);
    if (!parseResult.success) {
      deps.logger?.error(
        `[PullAndApply] Invalid pull response schema: ${parseResult.error.message}`
      );
      return {
        pages: pagesCount,
        changesApplied: changesAppliedTotal,
        newCursor: currentCursor,
        failedRequest: true,
        authError: false,
      };
    }

    const { changes, nextCursor, hasMore: serverHasMore } = parseResult.data;
    const now = nowFn();

    // Monotonic cursor progression per docs/SYNC.md: cursor = Math.max(oldCursor, nextCursor, lastSeqReceived)
    const lastSeqReceived = changes.reduce((max, c) => Math.max(max, c.seq), 0);
    const candidateCursor = Math.max(currentCursor, nextCursor, lastSeqReceived);

    // 3. Apply this page in ONE atomic database transaction
    try {
      const applyPageTx = db.transaction(() => {
        // Sort in monotonic seq order
        const sortedChanges = [...changes].sort((a, b) => a.seq - b.seq);
        for (const change of sortedChanges) {
          applyChange(change, now);
        }

        // Advance pull_cursor in the exact same transaction
        updateCursorStmt.run(String(candidateCursor));
      });

      applyPageTx();
    } catch (applyErr: unknown) {
      deps.logger?.error(
        `[PullAndApply] Failed to apply page at cursor ${currentCursor}: ${
          applyErr instanceof Error ? applyErr.message : String(applyErr)
        }`
      );
      // Entire page rolled back, cursor does not move
      return {
        pages: pagesCount,
        changesApplied: changesAppliedTotal,
        newCursor: currentCursor,
        failedRequest: true,
        authError: false,
      };
    }

    pagesCount++;
    changesAppliedTotal += changes.length;

    // Guard against infinite loop if overlap rows exceed page limit and no forward progression is made
    if (serverHasMore && candidateCursor <= currentCursor) {
      deps.logger?.warn?.(
        `[PullAndApply] No forward cursor progression (current: ${currentCursor}, candidate: ${candidateCursor}). Ending pagination loop.`
      );
      hasMore = false;
    } else {
      currentCursor = candidateCursor;
      requestCursor = nextCursor;
      hasMore = serverHasMore;
    }
  }

  // 4. Update sync_state timestamps on success
  const successTime = nowFn();
  db.prepare(`
    INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_pull_ok_at', ?);
  `).run(successTime);
  db.prepare(`
    INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_online_at', ?);
  `).run(successTime);

  return {
    pages: pagesCount,
    changesApplied: changesAppliedTotal,
    newCursor: currentCursor,
    failedRequest: false,
    authError: false,
  };
}
