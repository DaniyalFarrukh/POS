import type { UserRole } from '@pos/shared';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface AccountItem {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  isActive: boolean;
  isSystem: boolean;
}

export interface AccountTreeNode {
  account: AccountItem;
  children: AccountTreeNode[];
}

export interface ManualJournalLineDraft {
  accountId: string;
  debitPaisa: number;
  creditPaisa: number;
  memo?: string;
  branchId?: string;
  partyType?: string;
  partyId?: string;
}

export interface ManualJournalDraft {
  entryDate: string;
  memo?: string;
  lines: ManualJournalLineDraft[];
}

export interface JournalValidationResult {
  isValid: boolean;
  totalDebitPaisa: number;
  totalCreditPaisa: number;
  differencePaisa: number;
  entryError: string | null;
  lineErrors: string[];
}

export function validateManualJournalDraft(draft: ManualJournalDraft): JournalValidationResult {
  let entryError: string | null = null;
  const lineErrors: string[] = [];

  if (!draft.entryDate || isNaN(Date.parse(draft.entryDate))) {
    entryError = 'Please enter a valid date';
  } else if (!draft.lines || draft.lines.length < 2) {
    entryError = 'Manual journal must have at least 2 lines';
  }

  let totalDebitPaisa = 0;
  let totalCreditPaisa = 0;

  for (let i = 0; i < (draft.lines || []).length; i++) {
    const line = draft.lines[i];
    if (!line) continue;
    if (!line.accountId || !line.accountId.trim()) {
      lineErrors.push(`Line ${i + 1}: Account is required`);
      continue;
    }

    if (line.debitPaisa < 0 || line.creditPaisa < 0) {
      lineErrors.push(`Line ${i + 1}: Amounts cannot be negative`);
      continue;
    }

    if (!Number.isInteger(line.debitPaisa) || !Number.isInteger(line.creditPaisa)) {
      lineErrors.push(`Line ${i + 1}: Amounts must be integer paisa`);
      continue;
    }

    const hasDebit = line.debitPaisa > 0;
    const hasCredit = line.creditPaisa > 0;

    if ((hasDebit && hasCredit) || (!hasDebit && !hasCredit)) {
      lineErrors.push(`Line ${i + 1}: Each line must have strictly one of debit or credit greater than zero`);
      continue;
    }

    totalDebitPaisa += line.debitPaisa;
    totalCreditPaisa += line.creditPaisa;
  }

  const differencePaisa = Math.abs(totalDebitPaisa - totalCreditPaisa);

  if (!entryError && totalDebitPaisa !== totalCreditPaisa) {
    entryError = 'Journal entry is unbalanced: total debits must equal total credits';
  } else if (!entryError && totalDebitPaisa === 0 && lineErrors.length === 0) {
    entryError = 'Journal entry cannot have zero total debit/credit';
  }

  const isValid = !entryError && lineErrors.length === 0 && totalDebitPaisa === totalCreditPaisa && totalDebitPaisa > 0;

  return {
    isValid,
    totalDebitPaisa,
    totalCreditPaisa,
    differencePaisa,
    entryError,
    lineErrors,
  };
}

export function canPostManualJournal(role: UserRole): boolean {
  return role === 'owner' || role === 'accountant';
}

export function canManageChartOfAccounts(role: UserRole): boolean {
  return role === 'owner' || role === 'accountant';
}

export interface ReversibleEntryInput {
  id: string;
  entryNo: number;
  status: 'posted' | 'reversed';
  reversesEntryId: string | null;
}

export function canReverseJournalEntry(
  entry: ReversibleEntryInput,
  role: UserRole,
): { canReverse: boolean; reason: string | null } {
  if (!canPostManualJournal(role)) {
    return {
      canReverse: false,
      reason: 'You do not have permission to reverse journal entries',
    };
  }

  if (entry.reversesEntryId !== null) {
    return {
      canReverse: false,
      reason: 'Cannot reverse a reversal entry',
    };
  }

  if (entry.status === 'reversed') {
    return {
      canReverse: false,
      reason: 'Entry is already reversed',
    };
  }

  return {
    canReverse: true,
    reason: null,
  };
}

export function canDeactivateAccount(account: AccountItem, role: UserRole): boolean {
  if (account.isSystem) {
    return false;
  }
  return canManageChartOfAccounts(role);
}

export function buildAccountTree(
  accounts: AccountItem[],
): Record<AccountType, AccountTreeNode[]> {
  const result: Record<AccountType, AccountTreeNode[]> = {
    asset: [],
    liability: [],
    equity: [],
    revenue: [],
    expense: [],
  };

  const accountMap = new Map<string, AccountTreeNode>();
  for (const acc of accounts) {
    accountMap.set(acc.id, { account: acc, children: [] });
  }

  // Sort all accounts by code ascending
  const sortedAccounts = [...accounts].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  for (const acc of sortedAccounts) {
    const node = accountMap.get(acc.id)!;
    if (acc.parentId && accountMap.has(acc.parentId)) {
      const parentNode = accountMap.get(acc.parentId)!;
      parentNode.children.push(node);
    } else {
      if (result[acc.type]) {
        result[acc.type].push(node);
      }
    }
  }

  return result;
}

export interface SourceDocumentLink {
  hasLink: boolean;
  label: string;
  type?: string;
  id?: string;
}

export function getSourceDocumentLink(entry: {
  sourceType: string | null;
  sourceId: string | null;
  memo?: string | null;
}): SourceDocumentLink {
  if (!entry.sourceType || !entry.sourceId) {
    return {
      hasLink: false,
      label: 'Manual Entry',
    };
  }

  const memo = entry.memo || '';

  if (entry.sourceType === 'invoice') {
    if (memo.includes('#')) {
      const label = 'Invoice ' + memo.slice(memo.indexOf('#')).trim();
      return { hasLink: true, label, type: 'invoice', id: entry.sourceId };
    }
    return {
      hasLink: true,
      label: `Invoice #${entry.sourceId.slice(0, 8)}`,
      type: 'invoice',
      id: entry.sourceId,
    };
  }

  if (entry.sourceType === 'purchase') {
    if (memo.includes('GRN')) {
      const label = 'Purchase ' + memo.slice(memo.indexOf('GRN')).trim();
      return { hasLink: true, label, type: 'purchase', id: entry.sourceId };
    }
    return {
      hasLink: true,
      label: `Purchase GRN #${entry.sourceId.slice(0, 8)}`,
      type: 'purchase',
      id: entry.sourceId,
    };
  }

  if (entry.sourceType === 'credit_note') {
    if (memo.includes('#')) {
      const label = 'Credit Note ' + memo.slice(memo.indexOf('#')).trim();
      return { hasLink: true, label, type: 'credit_note', id: entry.sourceId };
    }
    return {
      hasLink: true,
      label: `Credit Note #${entry.sourceId.slice(0, 8)}`,
      type: 'credit_note',
      id: entry.sourceId,
    };
  }

  if (entry.sourceType === 'stock_adjustment') {
    return {
      hasLink: true,
      label: memo ? `Stock Adjustment: ${memo}` : `Stock Adjustment #${entry.sourceId.slice(0, 8)}`,
      type: 'stock_adjustment',
      id: entry.sourceId,
    };
  }

  return {
    hasLink: true,
    label: `${entry.sourceType} #${entry.sourceId.slice(0, 8)}`,
    type: entry.sourceType,
    id: entry.sourceId,
  };
}
