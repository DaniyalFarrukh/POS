/**
 * FEFO (First-Expired, First-Out) Stock Allocation Module
 *
 * Pharmacy Requirement:
 * - Batches with earlier expiry dates must be dispensed first.
 * - Expired batches (expiryDate strictly before today) and batches with non-positive available stock are ignored.
 * - Ties on expiryDate are broken deterministically by batchId.
 * - Allocations may span multiple batches.
 * - Insufficient stock throws InsufficientStockError and never returns a partial allocation.
 * - Input structures are strictly immutable.
 */

export interface FefoBatchInput {
  batchId: string;
  expiryDate: string; // YYYY-MM-DD
  available: number;
}

export interface BatchAllocation {
  batchId: string;
  qty: number;
}

export class InsufficientStockError extends Error {
  readonly requested: number;
  readonly available: number;

  constructor(requested: number, available: number, message?: string) {
    super(
      message ??
        `Insufficient stock: requested ${requested}, available ${available}`
    );
    this.name = 'InsufficientStockError';
    this.requested = requested;
    this.available = available;
    Object.setPrototypeOf(this, InsufficientStockError.prototype);
  }
}

/**
 * Pure function allocating stock according to FEFO (First-Expired, First-Out).
 *
 * @param requestedQty Total positive integer quantity required.
 * @param batches Array of available batches. Never mutated.
 * @param today Reference date in YYYY-MM-DD format. Batches with expiryDate < today are expired.
 * @returns Array of batch allocations fulfilling the entire requested quantity.
 * @throws Error if requestedQty is not a positive integer.
 * @throws InsufficientStockError if non-expired available stock is less than requestedQty.
 */
export function allocateFefo(
  requestedQty: number,
  batches: readonly FefoBatchInput[],
  today: string
): BatchAllocation[] {
  // 1. Validate requestedQty
  if (
    typeof requestedQty !== 'number' ||
    isNaN(requestedQty) ||
    !isFinite(requestedQty) ||
    !Number.isInteger(requestedQty) ||
    requestedQty <= 0
  ) {
    throw new Error(
      `requestedQty must be a positive integer, received: ${requestedQty}`
    );
  }

  // 2. Filter eligible batches without mutating input
  // Ignore batches with expiryDate before today (expired) and batches with available <= 0
  const eligibleBatches: FefoBatchInput[] = [];
  let totalAvailable = 0;

  for (const batch of batches) {
    if (batch.available > 0 && batch.expiryDate >= today) {
      eligibleBatches.push({
        batchId: batch.batchId,
        expiryDate: batch.expiryDate,
        available: batch.available,
      });
      totalAvailable += batch.available;
    }
  }

  // 3. Stock sufficiency check: fail-fast with zero partial allocation
  if (totalAvailable < requestedQty) {
    throw new InsufficientStockError(requestedQty, totalAvailable);
  }

  // 4. Deterministic sort: earliest expiryDate first, tie-break by batchId
  eligibleBatches.sort((a, b) => {
    if (a.expiryDate < b.expiryDate) return -1;
    if (a.expiryDate > b.expiryDate) return 1;
    if (a.batchId < b.batchId) return -1;
    if (a.batchId > b.batchId) return 1;
    return 0;
  });

  // 5. Greedily fulfill allocation across sorted batches
  let remaining = requestedQty;
  const allocations: BatchAllocation[] = [];

  for (const batch of eligibleBatches) {
    if (remaining <= 0) {
      break;
    }
    const take = Math.min(remaining, batch.available);
    if (take > 0) {
      allocations.push({
        batchId: batch.batchId,
        qty: take,
      });
      remaining -= take;
    }
  }

  return allocations;
}
