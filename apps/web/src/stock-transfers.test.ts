import { describe, it, expect } from 'vitest';
import {
  calculateTransferKPIs,
  getTransferStatusDetails,
  validateCreateTransferForm,
  validateReceiveTransferForm,
  type ReceiveLineInput,
} from './lib/transfer-utils';
import type { StockTransferRecord } from './types';

describe('Stock Transfers & Locations Web Utilities & Logic', () => {
  it('correctly maps transfer status details and badges', () => {
    const draft = getTransferStatusDetails('draft');
    expect(draft.label).toBe('Draft');
    expect(draft.badgeClass).toContain('slate');

    const inTransit = getTransferStatusDetails('in_transit');
    expect(inTransit.label).toBe('In Transit');
    expect(inTransit.badgeClass).toContain('blue');

    const received = getTransferStatusDetails('received');
    expect(received.label).toBe('Received');
    expect(received.badgeClass).toContain('emerald');

    const cancelled = getTransferStatusDetails('cancelled');
    expect(cancelled.label).toBe('Cancelled');
    expect(cancelled.badgeClass).toContain('rose');
  });

  it('calculates KPI counts accurately across transfer records', () => {
    const mockTransfers: Partial<StockTransferRecord>[] = [
      { id: '1', status: 'draft', hasShortage: false },
      { id: '2', status: 'in_transit', hasShortage: false },
      { id: '3', status: 'in_transit', hasShortage: false },
      { id: '4', status: 'received', hasShortage: true },
      { id: '5', status: 'received', hasShortage: false },
      { id: '6', status: 'cancelled', hasShortage: false },
    ];

    const kpis = calculateTransferKPIs(mockTransfers as StockTransferRecord[]);
    expect(kpis.totalCount).toBe(6);
    expect(kpis.inTransitCount).toBe(2);
    expect(kpis.receivedCount).toBe(2);
    expect(kpis.shortageCount).toBe(1);
  });

  describe('Create Transfer Form Validation', () => {
    it('rejects missing branches', () => {
      const result = validateCreateTransferForm({
        sourceBranchId: '',
        destinationBranchId: '',
        lines: [{ productId: 'p1', batchId: 'b1', quantityRequested: 5 }],
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.sourceBranchId).toBeDefined();
      expect(result.errors.destinationBranchId).toBeDefined();
    });

    it('rejects transfer to the same branch and same location', () => {
      const result = validateCreateTransferForm({
        sourceBranchId: 'branch-1',
        sourceLocationId: 'loc-1',
        destinationBranchId: 'branch-1',
        destinationLocationId: 'loc-1',
        lines: [{ productId: 'p1', batchId: 'b1', quantityRequested: 5 }],
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.destinationLocationId).toMatch(/cannot be identical/i);
    });

    it('rejects empty lines list or invalid quantities', () => {
      const emptyLines = validateCreateTransferForm({
        sourceBranchId: 'branch-1',
        destinationBranchId: 'branch-2',
        lines: [],
      });
      expect(emptyLines.isValid).toBe(false);
      expect(emptyLines.errors.lines).toBeDefined();

      const invalidQty = validateCreateTransferForm({
        sourceBranchId: 'branch-1',
        destinationBranchId: 'branch-2',
        lines: [{ productId: 'p1', batchId: 'b1', quantityRequested: 0 }],
      });
      expect(invalidQty.isValid).toBe(false);
      expect(invalidQty.errors.line_0_qty).toBeDefined();
    });

    it('accepts valid transfer input across differing branches', () => {
      const result = validateCreateTransferForm({
        sourceBranchId: 'branch-1',
        sourceLocationId: 'loc-1',
        destinationBranchId: 'branch-2',
        destinationLocationId: 'loc-2',
        lines: [
          { productId: 'p1', batchId: 'b1', quantityRequested: 10 },
          { productId: 'p2', batchId: 'b2', quantityRequested: 25 },
        ],
      });
      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });

    it('accepts intra-branch transfer between differing locations', () => {
      const result = validateCreateTransferForm({
        sourceBranchId: 'branch-1',
        sourceLocationId: 'loc-shelf-1',
        destinationBranchId: 'branch-1',
        destinationLocationId: 'loc-backroom',
        lines: [{ productId: 'p1', batchId: 'b1', quantityRequested: 15 }],
      });
      expect(result.isValid).toBe(true);
    });
  });

  describe('Receive Transfer Form Validation', () => {
    it('validates that received + shortage equals dispatched quantity', () => {
      const lines: ReceiveLineInput[] = [
        {
          lineId: 'line-1',
          quantityDispatched: 20,
          quantityReceived: 15,
          shortageQuantity: 3, // 15 + 3 = 18 != 20!
          shortageReason: 'Damaged',
        },
      ];

      const result = validateReceiveTransferForm(lines);
      expect(result.isValid).toBe(false);
      expect(result.errors.line_0_balance).toMatch(/must equal dispatched/i);
    });

    it('requires shortage reason when shortage > 0', () => {
      const lines: ReceiveLineInput[] = [
        {
          lineId: 'line-1',
          quantityDispatched: 20,
          quantityReceived: 18,
          shortageQuantity: 2,
          shortageReason: '', // missing reason!
        },
      ];

      const result = validateReceiveTransferForm(lines);
      expect(result.isValid).toBe(false);
      expect(result.errors.line_0_reason).toMatch(/reason is required/i);
    });

    it('accepts fully balanced receipt with zero shortages', () => {
      const lines: ReceiveLineInput[] = [
        {
          lineId: 'line-1',
          quantityDispatched: 50,
          quantityReceived: 50,
          shortageQuantity: 0,
        },
      ];

      const result = validateReceiveTransferForm(lines);
      expect(result.isValid).toBe(true);
    });

    it('accepts balanced receipt with recorded shortages and valid reason', () => {
      const lines: ReceiveLineInput[] = [
        {
          lineId: 'line-1',
          quantityDispatched: 50,
          quantityReceived: 45,
          shortageQuantity: 5,
          shortageReason: 'Five bottles broken in courier transit',
        },
      ];

      const result = validateReceiveTransferForm(lines);
      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });
  });
});
