import { describe, it, expect } from 'vitest';
import type { UserRole } from '@pos/shared';
import {
  validateManualJournalDraft,
  canPostManualJournal,
  canReverseJournalEntry,
  canManageChartOfAccounts,
  canDeactivateAccount,
  buildAccountTree,
  getSourceDocumentLink,
  type ManualJournalLineDraft,
  type AccountItem,
} from './lib/finance-utils';

describe('Finance Screens Domain Logic & UI Validation (ERP Phase 7)', () => {
  describe('1. Manual Journal Line Validation', () => {
    it('rejects journal with fewer than 2 lines', () => {
      const result = validateManualJournalDraft({
        entryDate: '2026-11-03',
        lines: [{ accountId: 'acc-1', debitPaisa: 1000, creditPaisa: 0 }],
      });
      expect(result.isValid).toBe(false);
      expect(result.entryError).toMatch(/at least 2 lines/i);
    });

    it('rejects unbalanced journal entries and calculates difference accurately', () => {
      const result = validateManualJournalDraft({
        entryDate: '2026-11-03',
        lines: [
          { accountId: 'acc-1', debitPaisa: 5000, creditPaisa: 0 },
          { accountId: 'acc-2', debitPaisa: 0, creditPaisa: 4500 },
        ],
      });
      expect(result.isValid).toBe(false);
      expect(result.totalDebitPaisa).toBe(5000);
      expect(result.totalCreditPaisa).toBe(4500);
      expect(result.differencePaisa).toBe(500);
      expect(result.entryError).toMatch(/unbalanced/i);
    });

    it('rejects lines having both debit and credit or neither', () => {
      const dualLineResult = validateManualJournalDraft({
        entryDate: '2026-11-03',
        lines: [
          { accountId: 'acc-1', debitPaisa: 1000, creditPaisa: 1000 },
          { accountId: 'acc-2', debitPaisa: 0, creditPaisa: 1000 },
        ],
      });
      expect(dualLineResult.isValid).toBe(false);
      expect(dualLineResult.lineErrors[0]).toMatch(/strictly one of debit or credit/i);

      const zeroLineResult = validateManualJournalDraft({
        entryDate: '2026-11-03',
        lines: [
          { accountId: 'acc-1', debitPaisa: 0, creditPaisa: 0 },
          { accountId: 'acc-2', debitPaisa: 0, creditPaisa: 0 },
        ],
      });
      expect(zeroLineResult.isValid).toBe(false);
      expect(zeroLineResult.lineErrors[0]).toMatch(/strictly one of debit or credit/i);
    });

    it('rejects non-integer paisa or negative amounts', () => {
      const invalidAmounts = validateManualJournalDraft({
        entryDate: '2026-11-03',
        lines: [
          { accountId: 'acc-1', debitPaisa: 10.5, creditPaisa: 0 },
          { accountId: 'acc-2', debitPaisa: 0, creditPaisa: -500 },
        ],
      });
      expect(invalidAmounts.isValid).toBe(false);
      expect(invalidAmounts.lineErrors[0]).toMatch(/integer paisa/i);
      expect(invalidAmounts.lineErrors[1]).toMatch(/cannot be negative/i);
    });

    it('rejects missing account selection or invalid date', () => {
      const invalidDateOrAccount = validateManualJournalDraft({
        entryDate: 'invalid-date',
        lines: [
          { accountId: '', debitPaisa: 1000, creditPaisa: 0 },
          { accountId: 'acc-2', debitPaisa: 0, creditPaisa: 1000 },
        ],
      });
      expect(invalidDateOrAccount.isValid).toBe(false);
      expect(invalidDateOrAccount.entryError).toMatch(/valid date/i);
      expect(invalidDateOrAccount.lineErrors[0]).toMatch(/account is required/i);
    });

    it('accepts perfectly balanced multi-line journal drafts', () => {
      const validDraft: { entryDate: string; lines: ManualJournalLineDraft[] } = {
        entryDate: '2026-11-03',
        lines: [
          { accountId: 'acc-1', debitPaisa: 2500, creditPaisa: 0, memo: 'Split 1' },
          { accountId: 'acc-2', debitPaisa: 2500, creditPaisa: 0, memo: 'Split 2' },
          { accountId: 'acc-3', debitPaisa: 0, creditPaisa: 5000, memo: 'Credit total' },
        ],
      };
      const result = validateManualJournalDraft(validDraft);
      expect(result.isValid).toBe(true);
      expect(result.totalDebitPaisa).toBe(5000);
      expect(result.totalCreditPaisa).toBe(5000);
      expect(result.differencePaisa).toBe(0);
      expect(result.entryError).toBeNull();
      expect(result.lineErrors).toHaveLength(0);
    });
  });

  describe('2. Permission Checks', () => {
    const roles: UserRole[] = ['owner', 'manager', 'accountant', 'pharmacist', 'cashier'];

    it('only allows owner and accountant to post manual journals', () => {
      const allowedRoles = roles.filter((role) => canPostManualJournal(role));
      expect(allowedRoles).toEqual(['owner', 'accountant']);
    });

    it('only allows owner and accountant to manage Chart of Accounts', () => {
      const allowedRoles = roles.filter((role) => canManageChartOfAccounts(role));
      expect(allowedRoles).toEqual(['owner', 'accountant']);
    });

    it('only allows owner and accountant to reverse posted journals', () => {
      const postedEntry = {
        id: 'entry-1',
        entryNo: 101,
        status: 'posted' as const,
        reversesEntryId: null,
      };
      const allowedRoles = roles.filter(
        (role) => canReverseJournalEntry(postedEntry, role).canReverse
      );
      expect(allowedRoles).toEqual(['owner', 'accountant']);
    });
  });

  describe('3. Reversal Flow Validation', () => {
    it('disallows reversing an entry that is already a reversal', () => {
      const reversalEntry = {
        id: 'entry-2',
        entryNo: 102,
        status: 'reversed' as const,
        reversesEntryId: 'entry-1',
      };
      const result = canReverseJournalEntry(reversalEntry, 'accountant');
      expect(result.canReverse).toBe(false);
      expect(result.reason).toMatch(/cannot reverse a reversal entry/i);
    });

    it('disallows reversing an entry if user lacks permission', () => {
      const validEntry = {
        id: 'entry-3',
        entryNo: 103,
        status: 'posted' as const,
        reversesEntryId: null,
      };
      const result = canReverseJournalEntry(validEntry, 'cashier');
      expect(result.canReverse).toBe(false);
      expect(result.reason).toMatch(/permission/i);
    });

    it('permits reversing an active posted entry with owner or accountant role', () => {
      const validEntry = {
        id: 'entry-4',
        entryNo: 104,
        status: 'posted' as const,
        reversesEntryId: null,
      };
      const ownerCheck = canReverseJournalEntry(validEntry, 'owner');
      expect(ownerCheck.canReverse).toBe(true);
      expect(ownerCheck.reason).toBeNull();

      const accountantCheck = canReverseJournalEntry(validEntry, 'accountant');
      expect(accountantCheck.canReverse).toBe(true);
      expect(accountantCheck.reason).toBeNull();
    });
  });

  describe('4. Chart of Accounts System Protection & Tree Building', () => {
    it('strictly protects system accounts from deactivation', () => {
      const systemAccount: AccountItem = {
        id: 'sys-1',
        code: '1000',
        name: 'Cash in Hand',
        type: 'asset',
        parentId: null,
        isActive: true,
        isSystem: true,
      };
      expect(canDeactivateAccount(systemAccount, 'owner')).toBe(false);
      expect(canDeactivateAccount(systemAccount, 'accountant')).toBe(false);

      const customAccount: AccountItem = {
        id: 'custom-1',
        code: '1001',
        name: 'Cash Drawer 2',
        type: 'asset',
        parentId: 'sys-1',
        isActive: true,
        isSystem: false,
      };
      expect(canDeactivateAccount(customAccount, 'owner')).toBe(true);
      expect(canDeactivateAccount(customAccount, 'accountant')).toBe(true);
      expect(canDeactivateAccount(customAccount, 'pharmacist')).toBe(false);
    });

    it('builds a hierarchical tree grouped by type and sorted by code', () => {
      const accountList: AccountItem[] = [
        {
          id: '1',
          code: '1000',
          name: 'Cash in Hand',
          type: 'asset',
          parentId: null,
          isActive: true,
          isSystem: true,
        },
        {
          id: '2',
          code: '1001',
          name: 'Petty Cash',
          type: 'asset',
          parentId: '1',
          isActive: true,
          isSystem: false,
        },
        {
          id: '3',
          code: '2000',
          name: 'Accounts Payable',
          type: 'liability',
          parentId: null,
          isActive: true,
          isSystem: true,
        },
        {
          id: '4',
          code: '1200',
          name: 'Inventory',
          type: 'asset',
          parentId: null,
          isActive: true,
          isSystem: true,
        },
      ];

      const tree = buildAccountTree(accountList);
      expect(tree.asset).toHaveLength(2); // 1000 and 1200
      expect(tree.liability).toHaveLength(1); // 2000
      expect(tree.equity).toHaveLength(0);

      // Verify hierarchy: 1001 is child of 1000
      const cashInHandNode = tree.asset.find((n) => n.account.code === '1000');
      expect(cashInHandNode).toBeDefined();
      expect(cashInHandNode?.children).toHaveLength(1);
      expect(cashInHandNode?.children[0]?.account.code).toBe('1001');
    });
  });

  describe('5. Source Document Link for Auto-Posted Entries', () => {
    it('generates readable badge label and document information for auto-posted documents', () => {
      const invoiceEntry = {
        sourceType: 'invoice',
        sourceId: 'inv-uuid-1',
        memo: 'POS Sale #INV-20261103-0001',
      };
      const invLink = getSourceDocumentLink(invoiceEntry);
      expect(invLink.hasLink).toBe(true);
      expect(invLink.label).toBe('Invoice #INV-20261103-0001');
      expect(invLink.type).toBe('invoice');

      const purchaseEntry = {
        sourceType: 'purchase',
        sourceId: 'pur-uuid-1',
        memo: 'Purchase received: GRN SUP-9988',
      };
      const purLink = getSourceDocumentLink(purchaseEntry);
      expect(purLink.hasLink).toBe(true);
      expect(purLink.label).toBe('Purchase GRN SUP-9988');
      expect(purLink.type).toBe('purchase');

      const manualEntry = {
        sourceType: null,
        sourceId: null,
        memo: 'Manual adjustment',
      };
      const manualLink = getSourceDocumentLink(manualEntry);
      expect(manualLink.hasLink).toBe(false);
      expect(manualLink.label).toBe('Manual Entry');
    });
  });
});
