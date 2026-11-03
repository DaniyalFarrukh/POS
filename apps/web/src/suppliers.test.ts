import { describe, it, expect } from 'vitest';
import type { UserRole } from '@pos/shared';
import {
  validateSupplierForm,
  calculateSupplierKPIs,
  findDuplicateSuppliers,
  canManageSuppliers,
  canViewSuppliers,
  type SupplierItem,
  type SupplierFormData,
} from './lib/supplier-utils';

describe('Suppliers Module Web Logic & UI Validation (Phase 8)', () => {
  describe('1. Form Validation', () => {
    it('rejects empty or whitespace-only name', () => {
      const result = validateSupplierForm({
        name: '   ',
        contactPerson: 'Ali',
        phone: '03001234567',
        email: 'ali@example.com',
        address: 'Lahore',
        paymentTermsDays: 30,
        creditLimitPKR: '50000',
        openingBalancePKR: '0',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.name).toMatch(/name is required/i);
    });

    it('rejects invalid email addresses', () => {
      const result = validateSupplierForm({
        name: 'Searle Pharma',
        contactPerson: '',
        phone: '',
        email: 'invalid-email-format',
        address: '',
        paymentTermsDays: 30,
        creditLimitPKR: '0',
        openingBalancePKR: '0',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.email).toMatch(/valid email/i);
    });

    it('rejects negative payment terms or non-numeric monetary inputs', () => {
      const result = validateSupplierForm({
        name: 'Getz Pharma',
        contactPerson: '',
        phone: '',
        email: '',
        address: '',
        paymentTermsDays: -5,
        creditLimitPKR: '-500',
        openingBalancePKR: 'abc',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.paymentTermsDays).toMatch(/non-negative/i);
      expect(result.errors.creditLimitPKR).toMatch(/valid positive amount/i);
      expect(result.errors.openingBalancePKR).toMatch(/valid numeric amount/i);
    });

    it('accepts valid supplier form data', () => {
      const validForm: SupplierFormData = {
        name: 'Muller & Phipps Pakistan',
        contactPerson: 'Khurram Shah',
        phone: '+92-300-1234567',
        email: 'orders@mnp.com.pk',
        address: 'Plot 12, Korangi Industrial Area, Karachi',
        taxNumber: '1234567-8',
        paymentTermsDays: 45,
        creditLimitPKR: '150000.00',
        openingBalancePKR: '25000.00',
      };
      const result = validateSupplierForm(validForm);
      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
      expect(result.creditLimitPaisa).toBe(15000000);
      expect(result.openingBalancePaisa).toBe(2500000);
    });
  });

  describe('2. Role Permission Checks', () => {
    const roles: UserRole[] = ['owner', 'manager', 'accountant', 'pharmacist', 'cashier'];

    it('allows owner, manager, and accountant to manage suppliers', () => {
      const allowed = roles.filter((role) => canManageSuppliers(role));
      expect(allowed).toEqual(['owner', 'manager', 'accountant']);
    });

    it('allows owner, manager, accountant, and pharmacist to view suppliers, but denies cashier', () => {
      const allowed = roles.filter((role) => canViewSuppliers(role));
      expect(allowed).toEqual(['owner', 'manager', 'accountant', 'pharmacist']);
      expect(canViewSuppliers('cashier')).toBe(false);
    });
  });

  describe('3. KPI Calculations', () => {
    it('calculates total payable, overdue payable, and active suppliers count', () => {
      const mockSuppliers: SupplierItem[] = [
        {
          id: 's1',
          name: 'Supplier A',
          contactPerson: null,
          phone: null,
          email: null,
          address: null,
          taxNumber: null,
          paymentTermsDays: 30,
          creditLimitPaisa: 0,
          openingBalancePaisa: 0,
          payableBalancePaisa: 100000, // 1,000 PKR
          overduePayablePaisa: 20000,
          isActive: true,
          purchaseCount: 5,
          lastPurchaseDate: '2026-10-15',
        },
        {
          id: 's2',
          name: 'Supplier B',
          contactPerson: null,
          phone: null,
          email: null,
          address: null,
          taxNumber: null,
          paymentTermsDays: 15,
          creditLimitPaisa: 0,
          openingBalancePaisa: 0,
          payableBalancePaisa: 50000, // 500 PKR
          overduePayablePaisa: 50000,
          isActive: true,
          purchaseCount: 2,
          lastPurchaseDate: '2026-09-01',
        },
        {
          id: 's3',
          name: 'Deactivated Supplier',
          contactPerson: null,
          phone: null,
          email: null,
          address: null,
          taxNumber: null,
          paymentTermsDays: 0,
          creditLimitPaisa: 0,
          openingBalancePaisa: 0,
          payableBalancePaisa: 0,
          overduePayablePaisa: 0,
          isActive: false,
          purchaseCount: 0,
          lastPurchaseDate: null,
        },
      ];

      const kpis = calculateSupplierKPIs(mockSuppliers);
      expect(kpis.totalPayablePaisa).toBe(150000);
      expect(kpis.overduePayablePaisa).toBe(70000);
      expect(kpis.activeSuppliersCount).toBe(2);
    });
  });

  describe('4. Duplicate Detection', () => {
    it('detects duplicate suppliers matching on normalized name or phone', () => {
      const suppliersList: SupplierItem[] = [
        {
          id: '1',
          name: 'Hilton Pharma Distributors',
          contactPerson: 'Ali',
          phone: '+92 300 1234567',
          email: null,
          address: null,
          taxNumber: null,
          paymentTermsDays: 30,
          creditLimitPaisa: 0,
          openingBalancePaisa: 0,
          payableBalancePaisa: 5000,
          overduePayablePaisa: 0,
          isActive: true,
          purchaseCount: 1,
          lastPurchaseDate: null,
        },
        {
          id: '2',
          name: 'hilton pharma distributors', // identical lowercase name
          contactPerson: 'A. Raza',
          phone: '0321-9988776',
          email: null,
          address: null,
          taxNumber: null,
          paymentTermsDays: 30,
          creditLimitPaisa: 0,
          openingBalancePaisa: 0,
          payableBalancePaisa: 3000,
          overduePayablePaisa: 0,
          isActive: true,
          purchaseCount: 1,
          lastPurchaseDate: null,
        },
        {
          id: '3',
          name: 'GlaxoSmithKline PK',
          contactPerson: 'Tariq',
          phone: '+92 300 1234567', // same phone as supplier #1
          email: null,
          address: null,
          taxNumber: null,
          paymentTermsDays: 30,
          creditLimitPaisa: 0,
          openingBalancePaisa: 0,
          payableBalancePaisa: 1000,
          overduePayablePaisa: 0,
          isActive: true,
          purchaseCount: 1,
          lastPurchaseDate: null,
        },
        {
          id: '4',
          name: 'Unique Pharma',
          contactPerson: 'Zubair',
          phone: '0345-0000000',
          email: null,
          address: null,
          taxNumber: null,
          paymentTermsDays: 30,
          creditLimitPaisa: 0,
          openingBalancePaisa: 0,
          payableBalancePaisa: 0,
          overduePayablePaisa: 0,
          isActive: true,
          purchaseCount: 0,
          lastPurchaseDate: null,
        },
      ];

      const duplicates = findDuplicateSuppliers(suppliersList);
      expect(duplicates.length).toBeGreaterThanOrEqual(1);

      // Verify that 1 & 2 are grouped (name match), and 1 & 3 are grouped (phone match)
      const nameMatchedGroup = duplicates.find(
        (g) => g.candidates.some((c) => c.id === '1') && g.candidates.some((c) => c.id === '2')
      );
      expect(nameMatchedGroup).toBeDefined();

      const phoneMatchedGroup = duplicates.find(
        (g) => g.candidates.some((c) => c.id === '1') && g.candidates.some((c) => c.id === '3')
      );
      expect(phoneMatchedGroup).toBeDefined();
    });
  });
});

