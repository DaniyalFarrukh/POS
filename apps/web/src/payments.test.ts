import { describe, it, expect } from 'vitest';
import {
  calculateAutoAllocations,
  validateAllocations,
  getChequeStatusMeta,
  getPaymentStatusMeta,
  getPaymentMethodMeta,
} from './lib/payment-utils';
import type { UnpaidDocumentRecord } from './types';

describe('Payment Utilities & Allocation Calculations', () => {
  it('calculates FIFO auto-allocations across multiple documents with exact payment', () => {
    const docs: UnpaidDocumentRecord[] = [
      {
        id: 'doc-1',
        documentType: 'invoice',
        documentNumber: 'INV-001',
        totalPaisa: 50000,
        allocatedPaisa: 0,
        balanceDuePaisa: 50000,
        date: '2026-11-01',
      },
      {
        id: 'doc-2',
        documentType: 'invoice',
        documentNumber: 'INV-002',
        totalPaisa: 30000,
        allocatedPaisa: 0,
        balanceDuePaisa: 30000,
        date: '2026-11-02',
      },
    ];

    const result = calculateAutoAllocations(80000, docs);
    expect(result.totalAllocatedPaisa).toBe(80000);
    expect(result.advancePaisa).toBe(0);
    expect(result.allocations).toHaveLength(2);
    expect(result.allocations[0]!.allocatedPaisa).toBe(50000);
    expect(result.allocations[1]!.allocatedPaisa).toBe(30000);
  });

  it('allocates partial amount to the first document when payment is less than total due', () => {
    const docs: UnpaidDocumentRecord[] = [
      {
        id: 'doc-1',
        documentType: 'invoice',
        documentNumber: 'INV-001',
        totalPaisa: 50000,
        allocatedPaisa: 0,
        balanceDuePaisa: 50000,
        date: '2026-11-01',
      },
      {
        id: 'doc-2',
        documentType: 'invoice',
        documentNumber: 'INV-002',
        totalPaisa: 30000,
        allocatedPaisa: 0,
        balanceDuePaisa: 30000,
        date: '2026-11-02',
      },
    ];

    const result = calculateAutoAllocations(35000, docs);
    expect(result.totalAllocatedPaisa).toBe(35000);
    expect(result.advancePaisa).toBe(0);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]!.allocatedPaisa).toBe(35000);
  });

  it('converts excess payment into customer/supplier advance when overpaying', () => {
    const docs: UnpaidDocumentRecord[] = [
      {
        id: 'doc-1',
        documentType: 'invoice',
        documentNumber: 'INV-001',
        totalPaisa: 50000,
        allocatedPaisa: 0,
        balanceDuePaisa: 50000,
        date: '2026-11-01',
      },
      {
        id: 'doc-2',
        documentType: 'invoice',
        documentNumber: 'INV-002',
        totalPaisa: 30000,
        allocatedPaisa: 0,
        balanceDuePaisa: 30000,
        date: '2026-11-02',
      },
    ];

    // Customer pays 100,000 paisa, outstanding is 80,000 paisa -> 20,000 paisa advance
    const result = calculateAutoAllocations(100000, docs);
    expect(result.totalAllocatedPaisa).toBe(80000);
    expect(result.advancePaisa).toBe(20000);
    expect(result.allocations).toHaveLength(2);
    expect(result.allocations[0]!.allocatedPaisa).toBe(50000);
    expect(result.allocations[1]!.allocatedPaisa).toBe(30000);
  });

  it('validates manual allocations and detects over-allocation error', () => {
    const invalid = validateAllocations(50000, [
      { documentId: 'doc-1', allocatedPaisa: 40000 },
      { documentId: 'doc-2', allocatedPaisa: 20000 },
    ]);
    expect(invalid.isValid).toBe(false);
    expect(invalid.error).toMatch(/cannot exceed payment amount/i);

    const valid = validateAllocations(50000, [
      { documentId: 'doc-1', allocatedPaisa: 30000 },
      { documentId: 'doc-2', allocatedPaisa: 15000 },
    ]);
    expect(valid.isValid).toBe(true);
    expect(valid.totalAllocatedPaisa).toBe(45000);
    expect(valid.advancePaisa).toBe(5000);
  });

  it('provides correct metadata for cheque status, payment status, and payment methods', () => {
    expect(getChequeStatusMeta('pending').label).toBe('Pending Clearing');
    expect(getChequeStatusMeta('cleared').label).toBe('Cleared');
    expect(getChequeStatusMeta('bounced').label).toBe('Bounced');

    expect(getPaymentStatusMeta('completed').label).toBe('Completed');
    expect(getPaymentStatusMeta('reversed').label).toBe('Reversed');

    expect(getPaymentMethodMeta('cash').label).toBe('Cash');
    expect(getPaymentMethodMeta('bank').label).toBe('Bank Transfer');
    expect(getPaymentMethodMeta('wallet').label).toBe('Mobile Wallet');
    expect(getPaymentMethodMeta('cheque').label).toBe('Cheque');
  });
});
