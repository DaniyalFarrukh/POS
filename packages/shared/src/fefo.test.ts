import { describe, it, expect } from 'vitest';
import {
  allocateFefo,
  InsufficientStockError,
  type FefoBatchInput,
  type BatchAllocation,
} from './fefo';

describe('FEFO Stock Allocation (allocateFefo)', () => {
  const TODAY = '2026-10-26';

  describe('Single batch allocation', () => {
    it('fulfills request completely from a single batch with surplus stock', () => {
      const batches: FefoBatchInput[] = [
        { batchId: 'batch-001', expiryDate: '2026-12-31', available: 50 },
      ];

      const result = allocateFefo(15, batches, TODAY);

      expect(result).toEqual<BatchAllocation[]>([
        { batchId: 'batch-001', qty: 15 },
      ]);
    });

    it('selects the earliest expiring batch when multiple single batches could fulfill the request', () => {
      const batches: FefoBatchInput[] = [
        { batchId: 'batch-later', expiryDate: '2027-01-01', available: 20 },
        { batchId: 'batch-earlier', expiryDate: '2026-11-15', available: 20 },
      ];

      const result = allocateFefo(10, batches, TODAY);

      expect(result).toEqual<BatchAllocation[]>([
        { batchId: 'batch-earlier', qty: 10 },
      ]);
    });
  });

  describe('Multi-batch split', () => {
    it('splits allocation across multiple batches in order of earliest expiry', () => {
      const batches: FefoBatchInput[] = [
        { batchId: 'batch-3', expiryDate: '2027-03-01', available: 10 },
        { batchId: 'batch-1', expiryDate: '2026-11-01', available: 4 },
        { batchId: 'batch-2', expiryDate: '2026-12-01', available: 5 },
      ];

      // Request 7: takes 4 from batch-1 (leaving 0), takes 3 from batch-2
      const result = allocateFefo(7, batches, TODAY);

      expect(result).toEqual<BatchAllocation[]>([
        { batchId: 'batch-1', qty: 4 },
        { batchId: 'batch-2', qty: 3 },
      ]);
    });

    it('spans across three or more batches if necessary', () => {
      const batches: FefoBatchInput[] = [
        { batchId: 'b-3', expiryDate: '2026-12-01', available: 3 },
        { batchId: 'b-1', expiryDate: '2026-10-28', available: 2 },
        { batchId: 'b-2', expiryDate: '2026-11-10', available: 4 },
      ];

      // Request 8: 2 from b-1, 4 from b-2, 2 from b-3
      const result = allocateFefo(8, batches, TODAY);

      expect(result).toEqual<BatchAllocation[]>([
        { batchId: 'b-1', qty: 2 },
        { batchId: 'b-2', qty: 4 },
        { batchId: 'b-3', qty: 2 },
      ]);
    });
  });

  describe('Expired batches skipped', () => {
    it('ignores batches with expiryDate strictly before today', () => {
      const batches: FefoBatchInput[] = [
        { batchId: 'batch-expired-1', expiryDate: '2026-10-25', available: 100 },
        { batchId: 'batch-expired-2', expiryDate: '2025-01-01', available: 50 },
        { batchId: 'batch-valid', expiryDate: '2026-10-30', available: 10 },
      ];

      const result = allocateFefo(5, batches, TODAY);

      expect(result).toEqual<BatchAllocation[]>([
        { batchId: 'batch-valid', qty: 5 },
      ]);
    });

    it('considers batches expiring on today as valid (not before today)', () => {
      const batches: FefoBatchInput[] = [
        { batchId: 'batch-today', expiryDate: TODAY, available: 10 },
        { batchId: 'batch-future', expiryDate: '2026-11-01', available: 20 },
      ];

      const result = allocateFefo(8, batches, TODAY);

      expect(result).toEqual<BatchAllocation[]>([
        { batchId: 'batch-today', qty: 8 },
      ]);
    });

    it('skips batches with available <= 0 even if not expired', () => {
      const batches: FefoBatchInput[] = [
        { batchId: 'b-zero', expiryDate: '2026-11-01', available: 0 },
        { batchId: 'b-neg', expiryDate: '2026-11-02', available: -5 },
        { batchId: 'b-valid', expiryDate: '2026-11-03', available: 10 },
      ];

      const result = allocateFefo(5, batches, TODAY);

      expect(result).toEqual<BatchAllocation[]>([
        { batchId: 'b-valid', qty: 5 },
      ]);
    });
  });

  describe('Tie-break determinism', () => {
    it('breaks ties on identical expiryDate using batchId in alphabetical order', () => {
      const batches: FefoBatchInput[] = [
        { batchId: 'batch-Z', expiryDate: '2026-12-01', available: 10 },
        { batchId: 'batch-A', expiryDate: '2026-12-01', available: 10 },
        { batchId: 'batch-M', expiryDate: '2026-12-01', available: 10 },
      ];

      // Request 15: should take 10 from batch-A, then 5 from batch-M
      const result = allocateFefo(15, batches, TODAY);

      expect(result).toEqual<BatchAllocation[]>([
        { batchId: 'batch-A', qty: 10 },
        { batchId: 'batch-M', qty: 5 },
      ]);
    });

    it('produces deterministic output regardless of original array order on tie-break', () => {
      const batches1: FefoBatchInput[] = [
        { batchId: 'batch-02', expiryDate: '2026-12-01', available: 5 },
        { batchId: 'batch-01', expiryDate: '2026-12-01', available: 5 },
      ];
      const batches2: FefoBatchInput[] = [
        { batchId: 'batch-01', expiryDate: '2026-12-01', available: 5 },
        { batchId: 'batch-02', expiryDate: '2026-12-01', available: 5 },
      ];

      const res1 = allocateFefo(7, batches1, TODAY);
      const res2 = allocateFefo(7, batches2, TODAY);

      expect(res1).toEqual(res2);
      expect(res1).toEqual<BatchAllocation[]>([
        { batchId: 'batch-01', qty: 5 },
        { batchId: 'batch-02', qty: 2 },
      ]);
    });
  });

  describe('Exact fulfillment', () => {
    it('allocates exact total available stock across single and multiple batches', () => {
      const batches: FefoBatchInput[] = [
        { batchId: 'b-1', expiryDate: '2026-11-01', available: 6 },
        { batchId: 'b-2', expiryDate: '2026-12-01', available: 4 },
      ];

      const result = allocateFefo(10, batches, TODAY);

      expect(result).toEqual<BatchAllocation[]>([
        { batchId: 'b-1', qty: 6 },
        { batchId: 'b-2', qty: 4 },
      ]);
    });
  });

  describe('InsufficientStockError', () => {
    it('throws InsufficientStockError when requestedQty exceeds total non-expired stock', () => {
      const batches: FefoBatchInput[] = [
        { batchId: 'b-1', expiryDate: '2026-11-01', available: 4 },
        { batchId: 'b-2', expiryDate: '2026-12-01', available: 3 },
      ];

      expect(() => allocateFefo(10, batches, TODAY)).toThrow(InsufficientStockError);

      try {
        allocateFefo(10, batches, TODAY);
      } catch (err) {
        expect(err).toBeInstanceOf(InsufficientStockError);
        const stockErr = err as InsufficientStockError;
        expect(stockErr.requested).toBe(10);
        expect(stockErr.available).toBe(7);
        expect(stockErr.name).toBe('InsufficientStockError');
        expect(stockErr.message).toContain('10');
        expect(stockErr.message).toContain('7');
      }
    });

    it('never counts expired batches or non-positive stock in InsufficientStockError.available', () => {
      const batches: FefoBatchInput[] = [
        { batchId: 'b-expired', expiryDate: '2026-01-01', available: 50 },
        { batchId: 'b-zero', expiryDate: '2026-12-01', available: 0 },
        { batchId: 'b-valid', expiryDate: '2026-12-01', available: 3 },
      ];

      try {
        allocateFefo(5, batches, TODAY);
        expect.unreachable('Should have thrown InsufficientStockError');
      } catch (err) {
        expect(err).toBeInstanceOf(InsufficientStockError);
        const stockErr = err as InsufficientStockError;
        expect(stockErr.requested).toBe(5);
        expect(stockErr.available).toBe(3);
      }
    });

    it('throws InsufficientStockError with available=0 when batches array is empty', () => {
      try {
        allocateFefo(1, [], TODAY);
        expect.unreachable('Should have thrown InsufficientStockError');
      } catch (err) {
        expect(err).toBeInstanceOf(InsufficientStockError);
        const stockErr = err as InsufficientStockError;
        expect(stockErr.requested).toBe(1);
        expect(stockErr.available).toBe(0);
      }
    });
  });

  describe('Zero, negative, and fractional quantity rejected', () => {
    const validBatches: FefoBatchInput[] = [
      { batchId: 'b-1', expiryDate: '2026-12-31', available: 20 },
    ];

    it('rejects zero requestedQty', () => {
      expect(() => allocateFefo(0, validBatches, TODAY)).toThrowError(
        /requestedQty must be a positive integer/
      );
    });

    it('rejects negative requestedQty', () => {
      expect(() => allocateFefo(-5, validBatches, TODAY)).toThrowError(
        /requestedQty must be a positive integer/
      );
    });

    it('rejects fractional requestedQty', () => {
      expect(() => allocateFefo(2.5, validBatches, TODAY)).toThrowError(
        /requestedQty must be a positive integer/
      );
    });

    it('rejects non-finite and NaN values', () => {
      expect(() => allocateFefo(NaN, validBatches, TODAY)).toThrowError();
      expect(() => allocateFefo(Infinity, validBatches, TODAY)).toThrowError();
    });
  });

  describe('Input immutability', () => {
    it('never mutates the input batches array or its elements', () => {
      const originalBatches: FefoBatchInput[] = [
        Object.freeze({ batchId: 'b-2', expiryDate: '2026-12-01', available: 10 }),
        Object.freeze({ batchId: 'b-1', expiryDate: '2026-11-01', available: 5 }),
        Object.freeze({ batchId: 'b-exp', expiryDate: '2026-01-01', available: 8 }),
      ];

      const frozenInput = Object.freeze([...originalBatches]);

      // Call function on deeply frozen input
      const result = allocateFefo(8, frozenInput, TODAY);

      expect(result).toEqual<BatchAllocation[]>([
        { batchId: 'b-1', qty: 5 },
        { batchId: 'b-2', qty: 3 },
      ]);

      // Verify the input array was not reordered in-place
      expect(frozenInput[0]?.batchId).toBe('b-2');
      expect(frozenInput[1]?.batchId).toBe('b-1');
      expect(frozenInput[2]?.batchId).toBe('b-exp');

      // Verify available numbers on objects remain unchanged
      expect(frozenInput[0]?.available).toBe(10);
      expect(frozenInput[1]?.available).toBe(5);
      expect(frozenInput[2]?.available).toBe(8);
    });
  });
});
