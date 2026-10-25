import { describe, it, expect } from 'vitest';
import {
  ProductSchema,
  BatchSchema,
  StockMovementSchema,
  UserSchema,
  TaxCategorySchema,
} from './index';
import { generateUuidV7 } from '../uuid';

describe('Shared Zod Schemas', () => {
  it('validates a correct product entity', () => {
    const validProduct = {
      id: generateUuidV7(),
      brandName: 'Panadol',
      genericName: 'Paracetamol',
      strength: '500mg',
      form: 'tablet',
      manufacturer: 'GSK',
      barcode: '8964000123456',
      taxCategoryId: generateUuidV7(),
      mrpPaisa: 3500, // Rs. 35.00
      isControlled: false,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const parsed = ProductSchema.parse(validProduct);
    expect(parsed.brandName).toBe('Panadol');
    expect(parsed.mrpPaisa).toBe(3500);
  });

  it('rejects floating point paisa in money fields', () => {
    const invalidBatch = {
      id: generateUuidV7(),
      productId: generateUuidV7(),
      batchNo: 'B-101',
      expiryDate: '2027-12-31',
      costPaisa: 25.5, // Float is illegal per Rule 1
      mrpPaisa: 3500,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => BatchSchema.parse(invalidBatch)).toThrow();
  });

  it('validates stock movements with signed integers', () => {
    const saleMovement = {
      id: generateUuidV7(),
      productId: generateUuidV7(),
      batchId: generateUuidV7(),
      branchId: generateUuidV7(),
      type: 'sale',
      quantitySigned: -10, // negative for sale
      referenceType: 'invoice',
      referenceId: generateUuidV7(),
      reason: 'Counter sale',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const parsed = StockMovementSchema.parse(saleMovement);
    expect(parsed.quantitySigned).toBe(-10);
    expect(parsed.type).toBe('sale');
  });

  it('enforces valid user roles', () => {
    const validUser = {
      id: generateUuidV7(),
      name: 'Ali Khan',
      role: 'pharmacist',
      pinHash: 'hashed_pin_123',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(UserSchema.parse(validUser).role).toBe('pharmacist');

    const invalidUser = {
      ...validUser,
      role: 'superuser', // invalid role
    };
    expect(() => UserSchema.parse(invalidUser)).toThrow();
  });

  it('validates tax category basis points', () => {
    const taxCategory = {
      id: generateUuidV7(),
      name: 'Standard GST',
      rateBp: 1800, // 18.00%
      isExempt: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const parsed = TaxCategorySchema.parse(taxCategory);
    expect(parsed.rateBp).toBe(1800);
  });
});
