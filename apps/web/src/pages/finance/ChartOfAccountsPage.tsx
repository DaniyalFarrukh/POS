import React, { useState, useEffect, useMemo } from 'react';
import type { AccountRecord, AccountType } from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import {
  Card,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Button,
  Badge,
  Modal,
  Input,
} from '@pos/ui';
import {
  BookOpen,
  Plus,
  RefreshCw,
  Lock,
  ChevronDown,
  ChevronRight,
  Search,
  CheckCircle2,
  AlertTriangle,
  FolderTree,
  Sliders,
} from 'lucide-react';
import {
  buildAccountTree,
  canManageChartOfAccounts,
  type AccountTreeNode,
} from '../../lib/finance-utils';

const TYPE_CONFIG: Record<
  AccountType,
  {
    label: string;
    badgeVariant: 'default' | 'success' | 'warning' | 'info' | 'destructive';
    headerBg: string;
  }
> = {
  asset: { label: 'Assets', badgeVariant: 'info', headerBg: 'bg-blue-50/70' },
  liability: {
    label: 'Liabilities',
    badgeVariant: 'warning',
    headerBg: 'bg-amber-50/70',
  },
  equity: {
    label: 'Equity',
    badgeVariant: 'default',
    headerBg: 'bg-purple-50/70',
  },
  revenue: {
    label: 'Revenue',
    badgeVariant: 'success',
    headerBg: 'bg-emerald-50/70',
  },
  expense: {
    label: 'Expenses',
    badgeVariant: 'destructive',
    headerBg: 'bg-rose-50/70',
  },
};

const MAPPING_ROLE_LABELS: Record<
  string,
  { label: string; desc: string; expectedType: AccountType }
> = {
  cash: {
    label: 'Cash in Hand',
    desc: 'Primary till / register cash account',
    expectedType: 'asset',
  },
  bank: {
    label: 'Bank Account',
    desc: 'Bank settlement / transfer account',
    expectedType: 'asset',
  },
  wallet: {
    label: 'Digital Wallet',
    desc: 'Mobile wallet (Easypaisa / JazzCash)',
    expectedType: 'asset',
  },
  ar: { label: 'Accounts Receivable', desc: 'Customer credit balance', expectedType: 'asset' },
  inventory: {
    label: 'Merchandise Inventory',
    desc: 'Stock on hand valuation asset',
    expectedType: 'asset',
  },
  ap: { label: 'Accounts Payable', desc: 'Supplier trade liabilities', expectedType: 'liability' },
  sales: {
    label: 'Sales Revenue',
    desc: 'Income earned from product sales',
    expectedType: 'revenue',
  },
  output_tax: {
    label: 'Sales Tax Payable',
    desc: 'Output GST collected on invoices',
    expectedType: 'liability',
  },
  input_tax: {
    label: 'Input Tax Receivable',
    desc: 'Input GST paid on supplier purchases',
    expectedType: 'asset',
  },
  cogs: {
    label: 'Cost of Goods Sold (COGS)',
    desc: 'Direct inventory cost recognized at sale',
    expectedType: 'expense',
  },
  stock_variance: {
    label: 'Inventory Adjustment Variance',
    desc: 'Gains/losses from physical stock count adjustments',
    expectedType: 'expense',
  },
  retained_earnings: {
    label: 'Retained Earnings',
    desc: 'Cumulative net income carried forward',
    expectedType: 'equity',
  },
};

export const ChartOfAccountsPage: React.FC = () => {
  const { user } = useAuth();
  const canManage = user ? canManageChartOfAccounts(user.role) : false;

  const [activeTab, setActiveTab] = useState<'coa' | 'mappings'>('coa');
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedTypes, setCollapsedTypes] = useState<Record<string, boolean>>({});

  // Add Account Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<AccountType>('asset');
  const [newParentId, setNewParentId] = useState<string>('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Mappings State
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [mappingsSavedSuccess, setMappingsSavedSuccess] = useState(false);

  const fetchAccounts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ items: AccountRecord[] }>('/api/finance/coa');
      setAccounts(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Chart of Accounts');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMappings = async () => {
    setMappingsLoading(true);
    try {
      const res = await apiFetch<{ mappings: Record<string, string>; accounts: AccountRecord[] }>(
        '/api/finance/account-mappings'
      );
      setMappings(res.mappings || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load account mappings');
    } finally {
      setMappingsLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
    if (activeTab === 'mappings') {
      fetchMappings();
    }
  }, [activeTab]);

  const handleToggleActive = async (
    account: AccountRecord | { id: string; isActive: boolean; isSystem: boolean }
  ) => {
    if (account.isSystem) return;
    try {
      await apiFetch(`/api/finance/coa/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !account.isActive }),
      });
      await fetchAccounts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update account status');
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) {
      setModalError('Account code and name are required.');
      return;
    }
    setModalError(null);
    setIsSubmitting(true);
    try {
      await apiFetch('/api/finance/coa', {
        method: 'POST',
        body: JSON.stringify({
          code: newCode.trim(),
          name: newName.trim(),
          type: newType,
          parentId: newParentId ? newParentId : null,
        }),
      });
      setIsAddModalOpen(false);
      setNewCode('');
      setNewName('');
      setNewParentId('');
      await fetchAccounts();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveMappings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMappingsSavedSuccess(false);
    setError(null);
    try {
      await apiFetch('/api/finance/account-mappings', {
        method: 'PUT',
        body: JSON.stringify({ mappings }),
      });
      setMappingsSavedSuccess(true);
      setTimeout(() => setMappingsSavedSuccess(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save account mappings');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return accounts;
    const q = searchQuery.toLowerCase();
    return accounts.filter(
      (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    );
  }, [accounts, searchQuery]);

  const tree = useMemo(() => {
    return buildAccountTree(filteredAccounts);
  }, [filteredAccounts]);

  const toggleSection = (type: string) => {
    setCollapsedTypes((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const renderTreeNodes = (nodes: AccountTreeNode[], depth: number = 0) => {
    return nodes.map((node) => {
      const { account, children } = node;

      return (
        <React.Fragment key={account.id}>
          <TableRow className={!account.isActive ? 'opacity-60 bg-slate-50/50' : undefined}>
            <TableCell className="py-2 sm:py-2.5">
              <div className="flex items-center gap-1 sm:gap-2" style={{ paddingLeft: `${Math.min(depth * 10, 24)}px` }}>
                {depth > 0 && <span className="text-slate-400 font-mono text-[10px] sm:text-xs">└─</span>}
                <span className="font-mono font-bold text-xs sm:text-sm text-slate-900">{account.code}</span>
              </div>
            </TableCell>
            <TableCell className="py-2 sm:py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-xs sm:text-sm text-slate-900">{account.name}</span>
                {account.isSystem && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#EEF4FF] text-[#2F64D8] border border-[#2F64D8]/20 shrink-0"
                    title="Protected system account"
                  >
                    <Lock className="w-2.5 h-2.5" />
                    System
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="py-2 sm:py-2.5 text-center hidden md:table-cell">
              <Badge variant={TYPE_CONFIG[account.type].badgeVariant}>
                {TYPE_CONFIG[account.type].label}
              </Badge>
            </TableCell>
            <TableCell className="py-2 sm:py-2.5 text-center">
              <Badge variant={account.isActive ? 'success' : 'default'} className="text-[10px] px-1.5 py-0.5">
                {account.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </TableCell>
            <TableCell className="py-2 sm:py-2.5 text-right">
              {canManage && (
                <div>
                  {account.isSystem ? (
                    <span
                      className="inline-flex items-center text-[11px] text-slate-400 gap-1 cursor-not-allowed select-none"
                      title="System accounts cannot be deactivated"
                    >
                      <Lock className="w-3 h-3" /> Protected
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleActive(account)}
                      className={`text-xs px-2 py-1 h-auto ${
                        account.isActive
                          ? 'text-amber-600 hover:text-amber-700'
                          : 'text-emerald-600 hover:text-emerald-700'
                      }`}
                    >
                      {account.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  )}
                </div>
              )}
            </TableCell>
          </TableRow>
          {children.length > 0 && renderTreeNodes(children, depth + 1)}
        </React.Fragment>
      );
    });
  };

  const accountTypes: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <BookOpen className="w-5 h-5 sm:w-6 sm:h-6 text-[#2F64D8]" />
            Chart of Accounts
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            General ledger accounts structure, classification, and operational document posting mappings
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {canManage && activeTab === 'coa' && (
            <Button onClick={() => setIsAddModalOpen(true)} className="flex items-center gap-2 text-xs sm:text-sm">
              <Plus className="w-4 h-4" />
              Add Custom Account
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto">
        <button
          onClick={() => setActiveTab('coa')}
          className={`flex items-center gap-2 py-2.5 sm:py-3 px-3 sm:px-4 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'coa'
              ? 'border-[#2F64D8] text-[#2F64D8] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <FolderTree className="w-4 h-4" />
          Accounts Tree View ({accounts.length})
        </button>
        <button
          onClick={() => setActiveTab('mappings')}
          className={`flex items-center gap-2 py-2.5 sm:py-3 px-3 sm:px-4 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'mappings'
              ? 'border-[#2F64D8] text-[#2F64D8] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Sliders className="w-4 h-4" />
          Posting Account Mappings
        </button>
      </div>

      {error && (
        <div className="p-3 sm:p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg flex items-center gap-3 text-xs sm:text-sm">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {/* Tab 1: Chart of Accounts Tree */}
      {activeTab === 'coa' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="Search accounts by code or title..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 text-xs sm:text-sm"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchAccounts}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-1.5 text-xs self-end sm:self-auto"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </CardContent>
          </Card>

          {isLoading ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
              <p className="text-sm">Loading Chart of Accounts...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {accountTypes.map((type) => {
                const typeNodes = tree[type] || [];
                const isCollapsed = collapsedTypes[type];
                const config = TYPE_CONFIG[type];

                return (
                  <Card key={type} className="overflow-hidden">
                    <div
                      onClick={() => toggleSection(type)}
                      className="px-3 sm:px-4 py-2.5 sm:py-3 cursor-pointer flex items-center justify-between border-b border-slate-200 select-none bg-slate-50 hover:bg-slate-100/90 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4 text-slate-500" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-500" />
                        )}
                        <span className="font-bold text-xs sm:text-sm text-slate-900">{config.label}</span>
                        <span className="text-[11px] sm:text-xs text-slate-500 font-normal">
                          ({typeNodes.reduce((acc, n) => acc + 1 + n.children.length, 0)} accounts)
                        </span>
                      </div>
                      <Badge variant={config.badgeVariant} className="text-[10px] sm:text-xs">
                        {config.label}
                      </Badge>
                    </div>

                    {!isCollapsed && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-20 sm:w-28 text-slate-700 font-bold text-xs uppercase">
                              Code
                            </TableHead>
                            <TableHead className="text-slate-700 font-bold text-xs uppercase min-w-[130px]">
                              Account Name
                            </TableHead>
                            <TableHead className="hidden md:table-cell w-32 text-center text-slate-700 font-bold text-xs uppercase">
                              Classification
                            </TableHead>
                            <TableHead className="w-20 sm:w-28 text-center text-slate-700 font-bold text-xs uppercase">
                              Status
                            </TableHead>
                            <TableHead className="w-20 sm:w-28 text-right text-slate-700 font-bold text-xs uppercase">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {typeNodes.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={5}
                                className="text-center py-6 text-slate-400 text-sm"
                              >
                                No accounts found under {config.label}
                              </TableCell>
                            </TableRow>
                          ) : (
                            renderTreeNodes(typeNodes)
                          )}
                        </TableBody>
                      </Table>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Account Mappings */}
      {activeTab === 'mappings' && (
        <Card>
          <CardContent className="p-6">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-900">
                Operational Document Account Mappings
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Configure which general ledger accounts are debited and credited automatically when
                invoices, returns, purchases, and stock adjustments are posted.
              </p>
            </div>

            {mappingsSavedSuccess && (
              <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm font-medium">Account mappings updated successfully.</span>
              </div>
            )}

            {mappingsLoading ? (
              <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                <span className="text-sm">Loading current account mappings...</span>
              </div>
            ) : (
              <form onSubmit={handleSaveMappings} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(MAPPING_ROLE_LABELS).map(([roleKey, meta]) => {
                    const activeOptions = accounts.filter((a) => a.isActive);
                    return (
                      <div
                        key={roleKey}
                        className="p-4 border rounded-lg border-slate-200 bg-slate-50/50 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-sm text-slate-900">
                              {meta.label}
                            </span>
                            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                              role: {roleKey}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mb-3">{meta.desc}</p>
                        </div>

                        <div>
                          <select
                            disabled={!canManage || isSubmitting}
                            value={mappings[roleKey] || ''}
                            onChange={(e) =>
                              setMappings((prev) => ({ ...prev, [roleKey]: e.target.value }))
                            }
                            className="w-full px-3 py-2 text-sm border rounded-lg bg-white border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2F64D8]/20 focus:border-[#2F64D8]"
                          >
                            <option value="">-- Select Ledger Account --</option>
                            {activeOptions.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                [{acc.code}] {acc.name} ({acc.type})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {canManage && (
                  <div className="flex justify-end pt-4 border-t border-slate-200">
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex items-center gap-2"
                    >
                      {isSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
                      Save Account Mappings
                    </Button>
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Custom Account Modal */}
      {isAddModalOpen && (
        <Modal
          open={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          title="Add Custom Ledger Account"
        >
          <form onSubmit={handleCreateAccount} className="space-y-4">
            {modalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-md">
                {modalError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Account Code <span className="text-rose-500">*</span>
              </label>
              <Input
                placeholder="e.g. 1005"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                required
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Unique numeric identifier (e.g. 1xxx for Assets, 2xxx for Liabilities)
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Account Name <span className="text-rose-500">*</span>
              </label>
              <Input
                placeholder="e.g. Counter Till 3 (Cash)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Classification Type <span className="text-rose-500">*</span>
              </label>
              <select
                value={newType}
                onChange={(e) => {
                  setNewType(e.target.value as AccountType);
                  setNewParentId('');
                }}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-white border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2F64D8]/20 focus:border-[#2F64D8]"
              >
                <option value="asset">Asset</option>
                <option value="liability">Liability</option>
                <option value="equity">Equity</option>
                <option value="revenue">Revenue</option>
                <option value="expense">Expense</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Parent Account (Optional)
              </label>
              <select
                value={newParentId}
                onChange={(e) => setNewParentId(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg bg-white border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#2F64D8]/20 focus:border-[#2F64D8]"
              >
                <option value="">-- No Parent (Top Level) --</option>
                {accounts
                  .filter((a) => a.type === newType && a.isActive)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      [{a.code}] {a.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Account'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
