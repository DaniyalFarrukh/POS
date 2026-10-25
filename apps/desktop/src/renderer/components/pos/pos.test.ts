import { describe, it, expect } from 'vitest';
import { computeLineWarning, type CartItem, type PosCatalogItem } from './types';
import { computeInvoiceTotals, formatPKR, type Paisa } from '@pos/shared';

describe('POS Cart & Warning Logic', () => {
  const dummyProduct: PosCatalogItem = {
    id: 'prod-1',
    brandName: 'Panadol 500mg',
    genericName: 'Paracetamol',
    strength: '500mg',
    form: 'tablet',
    manufacturer: 'GSK',
    barcode: '8964000123456',
    mrpPaisa: 5000, // Rs. 50.00
    taxCategoryId: 'tax-1',
    taxCategoryName: 'Standard GST (18%)',
    taxRateBp: 1800,
    isControlled: false,
    totalStock: 50,
    earliestBatch: {
      id: 'batch-1',
      batchNo: 'B2026-01',
      expiryDate: '2027-12-31',
      balance: 50,
    },
  };

  it('marks line as "out-of-stock" with icon and message when product has 0 stock', () => {
    const line: CartItem = {
      id: 'line-1',
      product: { ...dummyProduct, totalStock: 0 },
      quantity: 1,
      unitPricePaisa: 5000 as Paisa,
      discountType: 'none',
      discountBp: 0,
      flatDiscountPaisa: 0 as Paisa,
      taxRateBp: 1800,
      isTaxExempt: false,
    };

    const warning = computeLineWarning(line);
    expect(warning.type).toBe('out-of-stock');
    expect(warning.message).toContain('Out of Stock');
    expect(warning.icon).toBe('⚠️');
    expect(warning.color).toBe('#b91c1c');
  });

  it('marks line as "low-stock" when quantity requested exceeds available inventory', () => {
    const line: CartItem = {
      id: 'line-1',
      product: { ...dummyProduct, totalStock: 5 },
      quantity: 10,
      unitPricePaisa: 5000 as Paisa,
      discountType: 'none',
      discountBp: 0,
      flatDiscountPaisa: 0 as Paisa,
      taxRateBp: 1800,
      isTaxExempt: false,
    };

    const warning = computeLineWarning(line);
    expect(warning.type).toBe('low-stock');
    expect(warning.message).toContain('Exceeds Stock (5 available)');
    expect(warning.icon).toBe('⚠️');
  });

  it('marks line as "expired" when batch expiry is in the past', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);
    const pastDateStr = pastDate.toISOString().slice(0, 10);

    const line: CartItem = {
      id: 'line-1',
      product: dummyProduct,
      batchNo: 'EXP-1',
      expiryDate: pastDateStr,
      quantity: 1,
      unitPricePaisa: 5000 as Paisa,
      discountType: 'none',
      discountBp: 0,
      flatDiscountPaisa: 0 as Paisa,
      taxRateBp: 1800,
      isTaxExempt: false,
    };

    const warning = computeLineWarning(line);
    expect(warning.type).toBe('expired');
    expect(warning.message).toContain('Expired');
    expect(warning.icon).toBe('❌');
    expect(warning.color).toBe('#dc2626');
  });

  it('marks line as "near-expiry" when expiry date is within 90 days', () => {
    const nearDate = new Date();
    nearDate.setDate(nearDate.getDate() + 30);
    const nearDateStr = nearDate.toISOString().slice(0, 10);

    const line: CartItem = {
      id: 'line-1',
      product: dummyProduct,
      batchNo: 'NEAR-1',
      expiryDate: nearDateStr,
      quantity: 1,
      unitPricePaisa: 5000 as Paisa,
      discountType: 'none',
      discountBp: 0,
      flatDiscountPaisa: 0 as Paisa,
      taxRateBp: 1800,
      isTaxExempt: false,
    };

    const warning = computeLineWarning(line);
    expect(warning.type).toBe('near-expiry');
    expect(warning.message).toContain('Near Expiry');
    expect(warning.daysToExpiry).toBeLessThanOrEqual(90);
    expect(warning.icon).toBe('⏳');
    expect(warning.color).toBe('#b45309');
  });

  it('marks normal line as "none" warning when stock is ample and expiry > 90 days', () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 2);
    const futureDateStr = futureDate.toISOString().slice(0, 10);

    const line: CartItem = {
      id: 'line-1',
      product: { ...dummyProduct, totalStock: 100 },
      batchNo: 'VALID-1',
      expiryDate: futureDateStr,
      quantity: 2,
      unitPricePaisa: 5000 as Paisa,
      discountType: 'none',
      discountBp: 0,
      flatDiscountPaisa: 0 as Paisa,
      taxRateBp: 1800,
      isTaxExempt: false,
    };

    const warning = computeLineWarning(line);
    expect(warning.type).toBe('none');
    expect(warning.message).toBe('');
  });

  it('accurately computes invoice totals from cart lines using @pos/shared utilities', () => {
    const lines: CartItem[] = [
      {
        id: 'line-1',
        product: dummyProduct,
        quantity: 2,
        unitPricePaisa: 5000 as Paisa, // 2 x 50.00 = 100.00 (10000 paisa)
        discountType: 'percent',
        discountBp: 1000, // 10% discount = 1000 paisa off -> 9000 paisa
        flatDiscountPaisa: 0 as Paisa,
        taxRateBp: 1800, // 18% tax on 9000 = 1620 paisa
        isTaxExempt: false,
      },
      {
        id: 'line-2',
        product: { ...dummyProduct, mrpPaisa: 20000 },
        quantity: 1,
        unitPricePaisa: 20000 as Paisa, // 200.00 (20000 paisa)
        discountType: 'flat',
        discountBp: 0,
        flatDiscountPaisa: 2000 as Paisa, // Rs. 20 flat off -> 18000 paisa
        taxRateBp: 0, // Tax exempt or 0%
        isTaxExempt: true,
      },
    ];

    const totals = computeInvoiceTotals(
      lines.map((l) => ({
        unitPricePaisa: l.unitPricePaisa,
        quantity: l.quantity,
        discountBp: l.discountType === 'percent' ? l.discountBp : undefined,
        flatDiscountPaisa: l.discountType === 'flat' ? l.flatDiscountPaisa : undefined,
        taxRateBp: l.taxRateBp,
        isTaxExempt: l.isTaxExempt,
      }))
    );

    // Line 1:
    // net = 9000, tax = 1620 -> total = 10620
    // Line 2:
    // net = 18000, tax = 0 -> total = 18000
    // Invoice Total: 10620 + 18000 = 28620 paisa (Rs. 286.20)
    expect(totals.lines[0]?.netAmountPaisa).toBe(9000);
    expect(totals.lines[0]?.taxAmountPaisa).toBe(1620);
    expect(totals.lines[0]?.lineTotalPaisa).toBe(10620);

    expect(totals.lines[1]?.netAmountPaisa).toBe(18000);
    expect(totals.lines[1]?.taxAmountPaisa).toBe(0);
    expect(totals.lines[1]?.lineTotalPaisa).toBe(18000);

    expect(totals.grandTotalPaisa).toBe(28620);
    expect(formatPKR(totals.grandTotalPaisa)).toBe('Rs. 286.20');

    // Rule 1 Invariant
    const sumLineTotals = totals.lines.reduce((acc, l) => acc + l.lineTotalPaisa, 0);
    expect(totals.grandTotalPaisa).toBe(sumLineTotals);
  });
});
