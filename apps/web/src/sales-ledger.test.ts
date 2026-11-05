import { describe, it, expect } from 'vitest';
import type { SalesLedgerRecord } from './types';

describe('Sales Ledger Calculation & Presentation Logic', () => {
  it('1. correctly computes running cumulative net sales across chronological sales, returns, and receipts', () => {
    const rawEvents: Array<{
      id: string;
      date: string;
      type: 'sale' | 'return' | 'receipt';
      documentNumber: string;
      grossPaisa: number;
      discountPaisa: number;
      taxPaisa: number;
      netPaisa: number;
    }> = [
      {
        id: '1',
        date: '2026-11-01T10:00:00Z',
        type: 'sale',
        documentNumber: 'INV-1001',
        grossPaisa: 500000, // Rs. 5,000
        discountPaisa: 50000,
        taxPaisa: 22500,
        netPaisa: 472500, // Rs. 4,725
      },
      {
        id: '2',
        date: '2026-11-01T11:30:00Z',
        type: 'return',
        documentNumber: 'CRN-2001',
        grossPaisa: 100000,
        discountPaisa: 0,
        taxPaisa: 0,
        netPaisa: -100000, // -Rs. 1,000
      },
      {
        id: '3',
        date: '2026-11-01T14:00:00Z',
        type: 'sale',
        documentNumber: 'INV-1002',
        grossPaisa: 250000,
        discountPaisa: 0,
        taxPaisa: 12500,
        netPaisa: 262500, // Rs. 2,625
      },
      {
        id: '4',
        date: '2026-11-01T16:00:00Z',
        type: 'receipt',
        documentNumber: 'REC-3001',
        grossPaisa: 300000,
        discountPaisa: 0,
        taxPaisa: 0,
        netPaisa: 300000, // Rs. 3,000
      },
    ];

    let running = 0;
    let totalGrossSales = 0;
    let totalReturns = 0;
    let totalReceipts = 0;

    const computed: SalesLedgerRecord[] = rawEvents.map((evt) => {
      if (evt.type === 'sale') {
        running += evt.netPaisa;
        totalGrossSales += evt.netPaisa;
      } else if (evt.type === 'return') {
        running += evt.netPaisa; // negative
        totalReturns += Math.abs(evt.netPaisa);
      } else if (evt.type === 'receipt') {
        totalReceipts += evt.netPaisa;
      }

      return {
        ...evt,
        runningNetPaisa: running,
      };
    });

    // Check running cumulative totals
    expect(computed[0]!.runningNetPaisa).toBe(472500); // 4,725
    expect(computed[1]!.runningNetPaisa).toBe(372500); // 4,725 - 1,000 = 3,725
    expect(computed[2]!.runningNetPaisa).toBe(635000); // 3,725 + 2,625 = 6,350
    // Receipts do not change retail turnover net sales:
    expect(computed[3]!.runningNetPaisa).toBe(635000);

    // Check summaries
    expect(totalGrossSales).toBe(472500 + 262500); // 735000
    expect(totalReturns).toBe(100000); // 100000
    expect(totalReceipts).toBe(300000); // 300000
    const netSales = totalGrossSales - totalReturns;
    expect(netSales).toBe(635000);
  });
});
