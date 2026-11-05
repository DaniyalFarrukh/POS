import { eq, and, asc } from 'drizzle-orm';
import { generateUuidV7 } from '@pos/shared';
import type { DbClient } from '../sync/types';
import { accounts, pharmacyAccountMappings } from '../db/schema';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export type AccountRole =
  | 'sales'
  | 'sales_returns'
  | 'output_tax'
  | 'input_tax'
  | 'cogs'
  | 'inventory'
  | 'stock_adjustment'
  | 'cash'
  | 'bank'
  | 'wallet'
  | 'ar'
  | 'ap'
  | 'advance_suppliers'
  | 'customer_advances';

export const ALL_ACCOUNT_ROLES: readonly AccountRole[] = [
  'sales',
  'sales_returns',
  'output_tax',
  'input_tax',
  'cogs',
  'inventory',
  'stock_adjustment',
  'cash',
  'bank',
  'wallet',
  'ar',
  'ap',
  'advance_suppliers',
  'customer_advances',
] as const;

export const DEFAULT_ACCOUNT_ROLE_CODES: Readonly<Record<AccountRole, string>> = {
  cash: '1000',
  bank: '1010',
  wallet: '1020',
  ar: '1100',
  inventory: '1200',
  input_tax: '1300',
  advance_suppliers: '1400',
  ap: '2000',
  output_tax: '2100',
  customer_advances: '2400',
  sales: '4000',
  sales_returns: '4090',
  cogs: '5000',
  stock_adjustment: '5010',
} as const;

export interface DefaultAccountDef {
  code: string;
  name: string;
  type: AccountType;
}

/**
 * Default Chart of Accounts exactly as specified in docs/ERP_SPEC.md:
 * - Assets: 1000 Cash in Hand, 1010 Bank, 1020 Mobile Wallets, 1100 Accounts Receivable,
 *   1200 Inventory, 1300 Input Sales Tax, 1400 Advances to Suppliers, 1500 Fixed Assets,
 *   1590 Accumulated Depreciation
 * - Liabilities: 2000 Accounts Payable, 2100 Output Sales Tax Payable, 2110 Withholding Tax Payable,
 *   2200 Salaries Payable, 2210 EOBI and Other Statutory Payable, 2300 Other Payables,
 *   2400 Customer Advances
 * - Equity: 3000 Owner Capital, 3100 Retained Earnings, 3200 Owner Drawings
 * - Revenue: 4000 Sales, 4090 Sales Returns and Discounts (contra), 4100 Other Income
 * - Cost of sales (expense): 5000 Cost of Goods Sold, 5010 Stock Adjustments and Write-offs
 * - Expenses (expense): 6000 Salaries, 6010 Rent, 6020 Utilities, 6030 Marketing,
 *   6040 Office, 6050 Repairs, 6060 Bank Charges, 6070 Depreciation, 6900 Miscellaneous
 */
export const DEFAULT_CHART_OF_ACCOUNTS: readonly DefaultAccountDef[] = [
  // Assets
  { code: '1000', name: 'Cash in Hand', type: 'asset' },
  { code: '1010', name: 'Bank', type: 'asset' },
  { code: '1020', name: 'Mobile Wallets', type: 'asset' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset' },
  { code: '1200', name: 'Inventory', type: 'asset' },
  { code: '1300', name: 'Input Sales Tax', type: 'asset' },
  { code: '1400', name: 'Advances to Suppliers', type: 'asset' },
  { code: '1500', name: 'Fixed Assets', type: 'asset' },
  { code: '1590', name: 'Accumulated Depreciation', type: 'asset' },

  // Liabilities
  { code: '2000', name: 'Accounts Payable', type: 'liability' },
  { code: '2100', name: 'Output Sales Tax Payable', type: 'liability' },
  { code: '2110', name: 'Withholding Tax Payable', type: 'liability' },
  { code: '2200', name: 'Salaries Payable', type: 'liability' },
  { code: '2210', name: 'EOBI and Other Statutory Payable', type: 'liability' },
  { code: '2300', name: 'Other Payables', type: 'liability' },
  { code: '2400', name: 'Customer Advances', type: 'liability' },

  // Equity
  { code: '3000', name: 'Owner Capital', type: 'equity' },
  { code: '3100', name: 'Retained Earnings', type: 'equity' },
  { code: '3200', name: 'Owner Drawings', type: 'equity' },

  // Revenue
  { code: '4000', name: 'Sales', type: 'revenue' },
  { code: '4090', name: 'Sales Returns and Discounts', type: 'revenue' },
  { code: '4100', name: 'Other Income', type: 'revenue' },

  // Cost of sales (mapped to 'expense' per ledger model type asset|liability|equity|revenue|expense)
  { code: '5000', name: 'Cost of Goods Sold', type: 'expense' },
  { code: '5010', name: 'Stock Adjustments and Write-offs', type: 'expense' },

  // Expenses
  { code: '6000', name: 'Salaries', type: 'expense' },
  { code: '6010', name: 'Rent', type: 'expense' },
  { code: '6020', name: 'Utilities', type: 'expense' },
  { code: '6030', name: 'Marketing', type: 'expense' },
  { code: '6040', name: 'Office', type: 'expense' },
  { code: '6050', name: 'Repairs', type: 'expense' },
  { code: '6060', name: 'Bank Charges', type: 'expense' },
  { code: '6070', name: 'Depreciation', type: 'expense' },
  { code: '6900', name: 'Miscellaneous', type: 'expense' },
] as const;

/**
 * Idempotently seeds the default Chart of Accounts for a pharmacy.
 * Safe to run multiple times; existing accounts with the same (pharmacy_id, code) are untouched.
 */
export async function seedDefaultChartOfAccounts(
  tx: DbClient,
  pharmacyId: string
): Promise<Array<typeof accounts.$inferSelect>> {
  const rowsToInsert = DEFAULT_CHART_OF_ACCOUNTS.map((def) => ({
    id: generateUuidV7(),
    pharmacyId,
    code: def.code,
    name: def.name,
    type: def.type,
    parentId: null,
    isActive: true,
    isSystem: true,
  }));

  await tx
    .insert(accounts)
    .values(rowsToInsert)
    .onConflictDoNothing({
      target: [accounts.pharmacyId, accounts.code],
    });

  return tx
    .select()
    .from(accounts)
    .where(eq(accounts.pharmacyId, pharmacyId))
    .orderBy(asc(accounts.code));
}

/**
 * Idempotently seeds the default per-pharmacy account role mappings (`pharmacy_account_mappings`).
 * Ensures the default Chart of Accounts exists first, then maps each role to its default account.
 */
export async function seedDefaultAccountMappings(
  tx: DbClient,
  pharmacyId: string
): Promise<Array<typeof pharmacyAccountMappings.$inferSelect>> {
  const coaRows = await seedDefaultChartOfAccounts(tx, pharmacyId);
  const byCode = new Map(coaRows.map((a) => [a.code, a.id]));
  const now = new Date().toISOString();

  const mappingRows = ALL_ACCOUNT_ROLES.map((role) => {
    const code = DEFAULT_ACCOUNT_ROLE_CODES[role];
    const accountId = byCode.get(code);
    if (!accountId) {
      throw new Error(`Missing default account for role '${role}' (code ${code})`);
    }
    return {
      id: generateUuidV7(),
      pharmacyId,
      role,
      accountId,
      updatedAt: now,
    };
  });

  await tx
    .insert(pharmacyAccountMappings)
    .values(mappingRows)
    .onConflictDoNothing({
      target: [pharmacyAccountMappings.pharmacyId, pharmacyAccountMappings.role],
    });

  return tx
    .select()
    .from(pharmacyAccountMappings)
    .where(eq(pharmacyAccountMappings.pharmacyId, pharmacyId))
    .orderBy(asc(pharmacyAccountMappings.role));
}

/**
 * Resolves the role -> accountId mapping for a pharmacy.
 * Uses rows configured in `pharmacy_account_mappings`, falling back to the seeded Chart of Accounts.
 * If the pharmacy's COA has not yet been seeded, seeds it idempotently first.
 */
export async function getPharmacyAccountMap(
  tx: DbClient,
  pharmacyId: string
): Promise<Record<AccountRole, string>> {
  let coaRows = await tx.select().from(accounts).where(eq(accounts.pharmacyId, pharmacyId));

  const byCode = new Map(coaRows.map((a) => [a.code, a.id]));
  const hasAllDefaultCodes = ALL_ACCOUNT_ROLES.every((role) =>
    byCode.has(DEFAULT_ACCOUNT_ROLE_CODES[role])
  );

  if (!hasAllDefaultCodes) {
    coaRows = await seedDefaultChartOfAccounts(tx, pharmacyId);
    for (const a of coaRows) {
      byCode.set(a.code, a.id);
    }
  }

  const configuredRows = await tx
    .select()
    .from(pharmacyAccountMappings)
    .where(eq(pharmacyAccountMappings.pharmacyId, pharmacyId));

  const configuredByRole = new Map<AccountRole, string>(
    configuredRows.map((r) => [r.role, r.accountId])
  );

  const result = {} as Record<AccountRole, string>;
  for (const role of ALL_ACCOUNT_ROLES) {
    const configuredId = configuredByRole.get(role);
    if (configuredId) {
      result[role] = configuredId;
    } else {
      const defaultCode = DEFAULT_ACCOUNT_ROLE_CODES[role];
      const fallbackId = byCode.get(defaultCode);
      if (!fallbackId) {
        throw new Error(`Account mapping missing for role '${role}' in pharmacy ${pharmacyId}`);
      }
      result[role] = fallbackId;
    }
  }

  return result;
}

/**
 * Sets or updates a specific account role mapping for a pharmacy.
 * Verifies the target account belongs to the pharmacy and is active.
 */
export async function setPharmacyAccountMapping(
  tx: DbClient,
  pharmacyId: string,
  role: AccountRole,
  accountId: string
): Promise<typeof pharmacyAccountMappings.$inferSelect> {
  const [targetAccount] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.pharmacyId, pharmacyId)))
    .limit(1);

  if (!targetAccount) {
    throw new Error('Target account not found or belongs to another pharmacy');
  }
  if (!targetAccount.isActive) {
    throw new Error(`Target account ${targetAccount.code} (${targetAccount.name}) is inactive`);
  }

  const now = new Date().toISOString();
  const [existing] = await tx
    .select()
    .from(pharmacyAccountMappings)
    .where(
      and(
        eq(pharmacyAccountMappings.pharmacyId, pharmacyId),
        eq(pharmacyAccountMappings.role, role)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await tx
      .update(pharmacyAccountMappings)
      .set({ accountId, updatedAt: now })
      .where(
        and(
          eq(pharmacyAccountMappings.id, existing.id),
          eq(pharmacyAccountMappings.pharmacyId, pharmacyId)
        )
      )
      .returning();
    return updated!;
  }

  const [inserted] = await tx
    .insert(pharmacyAccountMappings)
    .values({
      id: generateUuidV7(),
      pharmacyId,
      role,
      accountId,
      updatedAt: now,
    })
    .returning();

  return inserted!;
}
