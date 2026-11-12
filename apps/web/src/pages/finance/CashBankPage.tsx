import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { BankAccountRecord, FundTransferRecord, CounterDepositRecord } from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatPaisa, formatKarachiDateOnly } from '../../lib/formatters';
import {
  parseBankStatementCsv,
  computeReconciliationMath,
  type BankStatementLine,
} from '../../lib/cash-bank-utils';
import { getKarachiBusinessDate, parsePkrToPaisa } from '@pos/shared';
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
  Landmark,
  Wallet,
  ArrowRightLeft,
  ArrowDownToLine,
  RefreshCw,
  Plus,
  RotateCcw,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Building2,
  FileSpreadsheet,
} from 'lucide-react';

interface LedgerLineItem {
  id: string;
  entryId: string;
  entryNo: number;
  date: string;
  description: string;
  sourceType: string | null;
  debitPaisa: number;
  creditPaisa: number;
  runningBalancePaisa: number;
  cleared?: boolean;
}

export const CashBankPage: React.FC = () => {
  const { can } = useAuth();

  // Active Tab
  const [activeTab, setActiveTab] = useState<
    'accounts' | 'transfers' | 'deposits' | 'reconciliation'
  >('accounts');

  // Data States
  const [accounts, setAccounts] = useState<BankAccountRecord[]>([]);
  const [transfers, setTransfers] = useState<FundTransferRecord[]>([]);
  const [deposits, setDeposits] = useState<CounterDepositRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // New Account Modal State
  const [showAccountModal, setShowAccountModal] = useState<boolean>(false);
  const [newAccountName, setNewAccountName] = useState<string>('');
  const [newAccountType, setNewAccountType] = useState<'cash' | 'bank' | 'wallet'>('bank');
  const [newAccountLedgerId, setNewAccountLedgerId] = useState<string>('');
  const [newAccountBankName, setNewAccountBankName] = useState<string>('');
  const [newAccountNumber, setNewAccountNumber] = useState<string>('');
  const [newAccountBranch, setNewAccountBranch] = useState<string>('');
  const [newAccountIban, setNewAccountIban] = useState<string>('');
  const [newAccountOpeningPaisa, setNewAccountOpeningPaisa] = useState<number>(0);
  const [accountSubmitting, setAccountSubmitting] = useState<boolean>(false);

  // Ledger Asset Accounts for dropdown (from /api/finance/accounts)
  const [ledgerAccounts, setLedgerAccounts] = useState<
    Array<{ id: string; code: string; name: string }>
  >([]);

  // Fund Transfer Modal State
  const [showTransferModal, setShowTransferModal] = useState<boolean>(false);
  const [transferFromId, setTransferFromId] = useState<string>('');
  const [transferToId, setTransferToId] = useState<string>('');
  const [transferAmountPaisa, setTransferAmountPaisa] = useState<number>(0);
  const [transferDate, setTransferDate] = useState<string>(() => getKarachiBusinessDate());
  const [transferRef, setTransferRef] = useState<string>('');
  const [transferNotes, setTransferNotes] = useState<string>('');
  const [transferSubmitting, setTransferSubmitting] = useState<boolean>(false);

  // Counter Deposit Modal State
  const [showDepositModal, setShowDepositModal] = useState<boolean>(false);
  const [depositBranchId, setDepositBranchId] = useState<string>('');
  const [depositSourceCashId, setDepositSourceCashId] = useState<string>('');
  const [depositTargetId, setDepositTargetId] = useState<string>('');
  const [depositAmountPaisa, setDepositAmountPaisa] = useState<number>(0);
  const [depositDate, setDepositDate] = useState<string>(() => getKarachiBusinessDate());
  const [depositNotes, setDepositNotes] = useState<string>('');
  const [depositSubmitting, setDepositSubmitting] = useState<boolean>(false);
  const [branchesList, setBranchesList] = useState<Array<{ id: string; name: string }>>([]);

  // Reversal Modal State
  const [reversalTarget, setReversalTarget] = useState<{
    type: 'transfer' | 'deposit';
    id: string;
    docNumber: string;
  } | null>(null);
  const [reversalReason, setReversalReason] = useState<string>('');
  const [reversalSubmitting, setReversalSubmitting] = useState<boolean>(false);

  // Bank Reconciliation State
  const [reconBankAccountId, setReconBankAccountId] = useState<string>('');
  const [reconStatementDate, setReconStatementDate] = useState<string>(() =>
    getKarachiBusinessDate()
  );
  const [reconStatementBalancePaisa, setReconStatementBalancePaisa] = useState<number>(0);
  const [statementLines, setStatementLines] = useState<BankStatementLine[]>([]);
  const [ledgerLines, setLedgerLines] = useState<LedgerLineItem[]>([]);
  const [ledgerBalancePaisa, setLedgerBalancePaisa] = useState<number>(0);
  const [reconLoading, setReconLoading] = useState<boolean>(false);
  const [savingRecon, setSavingRecon] = useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await apiFetch<{ success: boolean; data: { accounts: BankAccountRecord[] } }>(
        '/api/finance/cash-bank/accounts'
      );
      if (res.success && res.data) {
        setAccounts(res.data.accounts || []);
        if (res.data.accounts.length > 0 && !reconBankAccountId) {
          const firstBank =
            res.data.accounts.find((a) => a.type === 'bank') || res.data.accounts[0];
          if (firstBank) setReconBankAccountId(firstBank.id);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cash and bank accounts');
    }
  }, [reconBankAccountId]);

  const fetchTransfers = useCallback(async () => {
    try {
      const res = await apiFetch<{ success: boolean; data: { transfers: FundTransferRecord[] } }>(
        '/api/finance/cash-bank/transfers'
      );
      if (res.success && res.data) {
        setTransfers(res.data.transfers || []);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const fetchDeposits = useCallback(async () => {
    try {
      const res = await apiFetch<{ success: boolean; data: { deposits: CounterDepositRecord[] } }>(
        '/api/finance/cash-bank/deposits'
      );
      if (res.success && res.data) {
        setDeposits(res.data.deposits || []);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const fetchLedgerAccounts = useCallback(async () => {
    try {
      const res = await apiFetch<{
        success: boolean;
        data: { accounts: Array<{ id: string; code: string; name: string; type: string }> };
      }>('/api/finance/accounts');
      if (res.success && res.data) {
        const assets = res.data.accounts.filter((a) => a.type === 'asset');
        setLedgerAccounts(assets);
        if (assets.length > 0 && !newAccountLedgerId) {
          setNewAccountLedgerId(assets[0]!.id);
        }
      }
    } catch {
      // Non-fatal
    }
  }, [newAccountLedgerId]);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await apiFetch<{
        success: boolean;
        data: { branches: Array<{ id: string; name: string }> };
      }>('/api/admin/branches');
      if (res.success && res.data) {
        setBranchesList(res.data.branches || []);
        if (res.data.branches.length > 0 && !depositBranchId) {
          setDepositBranchId(res.data.branches[0]!.id);
        }
      }
    } catch {
      // Non-fatal
    }
  }, [depositBranchId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchAccounts(),
        fetchTransfers(),
        fetchDeposits(),
        fetchLedgerAccounts(),
        fetchBranches(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [fetchAccounts, fetchTransfers, fetchDeposits, fetchLedgerAccounts, fetchBranches]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ---------------------------------------------------------------------------
  // KPI Calculations
  // ---------------------------------------------------------------------------

  const kpis = useMemo(() => {
    let totalCashPaisa = 0;
    let totalBankPaisa = 0;
    for (const a of accounts) {
      if (a.type === 'cash') {
        totalCashPaisa += a.ledgerBalancePaisa;
      } else {
        totalBankPaisa += a.ledgerBalancePaisa;
      }
    }

    let transfersThisMonthPaisa = 0;
    const currentMonth = getKarachiBusinessDate().slice(0, 7);
    for (const t of transfers) {
      if (t.status === 'completed' && t.transferDate.startsWith(currentMonth)) {
        transfersThisMonthPaisa += t.amountPaisa;
      }
    }

    let depositsThisMonthPaisa = 0;
    for (const d of deposits) {
      if (d.status === 'completed' && d.depositDate.startsWith(currentMonth)) {
        depositsThisMonthPaisa += d.amountPaisa;
      }
    }

    return {
      totalCashPaisa,
      totalBankPaisa,
      transfersThisMonthPaisa,
      depositsThisMonthPaisa,
    };
  }, [accounts, transfers, deposits]);

  // ---------------------------------------------------------------------------
  // Actions: Create Account
  // ---------------------------------------------------------------------------

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccountName.trim() || !newAccountLedgerId) return;

    setAccountSubmitting(true);
    try {
      const res = await apiFetch<{ success: boolean }>('/api/finance/cash-bank/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: newAccountName.trim(),
          type: newAccountType,
          accountId: newAccountLedgerId,
          bankName: newAccountBankName.trim() || null,
          accountNumber: newAccountNumber.trim() || null,
          branchName: newAccountBranch.trim() || null,
          iban: newAccountIban.trim() || null,
          openingBalancePaisa: parsePkrToPaisa(newAccountOpeningPaisa),
        }),
      });

      if (res.success) {
        setShowAccountModal(false);
        setNewAccountName('');
        setNewAccountBankName('');
        setNewAccountNumber('');
        setNewAccountBranch('');
        setNewAccountIban('');
        setNewAccountOpeningPaisa(0);
        await fetchAccounts();
        alert('Account created successfully');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setAccountSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Actions: Fund Transfer
  // ---------------------------------------------------------------------------

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferFromId || !transferToId || transferAmountPaisa <= 0) return;
    if (transferFromId === transferToId) {
      alert('Source and destination accounts must be different');
      return;
    }

    setTransferSubmitting(true);
    try {
      const res = await apiFetch<{ success: boolean }>('/api/finance/cash-bank/transfers', {
        method: 'POST',
        body: JSON.stringify({
          fromAccountId: transferFromId,
          toAccountId: transferToId,
          amountPaisa: parsePkrToPaisa(transferAmountPaisa),
          transferDate,
          referenceNo: transferRef.trim() || null,
          notes: transferNotes.trim() || null,
        }),
      });

      if (res.success) {
        setShowTransferModal(false);
        setTransferAmountPaisa(0);
        setTransferRef('');
        setTransferNotes('');
        await Promise.all([fetchAccounts(), fetchTransfers()]);
        alert('Fund transfer posted to ledger successfully');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to execute transfer');
    } finally {
      setTransferSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Actions: Day-End Deposit
  // ---------------------------------------------------------------------------

  const handleCreateDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!depositBranchId || !depositSourceCashId || !depositTargetId || depositAmountPaisa <= 0)
      return;

    setDepositSubmitting(true);
    try {
      const res = await apiFetch<{ success: boolean }>('/api/finance/cash-bank/deposits', {
        method: 'POST',
        body: JSON.stringify({
          branchId: depositBranchId,
          sourceCashAccountId: depositSourceCashId,
          targetAccountId: depositTargetId,
          amountPaisa: parsePkrToPaisa(depositAmountPaisa),
          depositDate,
          notes: depositNotes.trim() || null,
        }),
      });

      if (res.success) {
        setShowDepositModal(false);
        setDepositAmountPaisa(0);
        setDepositNotes('');
        await Promise.all([fetchAccounts(), fetchDeposits()]);
        alert('Day-end cash collection deposited successfully');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to deposit cash');
    } finally {
      setDepositSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Actions: Reversal
  // ---------------------------------------------------------------------------

  const handleConfirmReversal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversalTarget || !reversalReason.trim()) return;

    setReversalSubmitting(true);
    try {
      const endpoint =
        reversalTarget.type === 'transfer'
          ? `/api/finance/cash-bank/transfers/${reversalTarget.id}/reverse`
          : `/api/finance/cash-bank/deposits/${reversalTarget.id}/reverse`;

      const res = await apiFetch<{ success: boolean }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ reason: reversalReason.trim() }),
      });

      if (res.success) {
        setReversalTarget(null);
        setReversalReason('');
        await Promise.all([fetchAccounts(), fetchTransfers(), fetchDeposits()]);
        alert('Document reversed and reversing entry posted to ledger');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reverse document');
    } finally {
      setReversalSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Bank Reconciliation
  // ---------------------------------------------------------------------------

  const handleFetchLedgerLines = useCallback(async () => {
    if (!reconBankAccountId) return;
    setReconLoading(true);
    try {
      const res = await apiFetch<{
        success: boolean;
        data: {
          ledgerBalancePaisa: number;
          lines: LedgerLineItem[];
        };
      }>(
        `/api/finance/cash-bank/reconciliation/${reconBankAccountId}/ledger-lines?asOfDate=${reconStatementDate}`
      );

      if (res.success && res.data) {
        setLedgerBalancePaisa(res.data.ledgerBalancePaisa);
        setLedgerLines(res.data.lines.map((l) => ({ ...l, cleared: false })));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to fetch ledger transactions');
    } finally {
      setReconLoading(false);
    }
  }, [reconBankAccountId, reconStatementDate]);

  useEffect(() => {
    if (activeTab === 'reconciliation' && reconBankAccountId) {
      handleFetchLedgerLines();
    }
  }, [activeTab, reconBankAccountId, handleFetchLedgerLines]);

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        const parsed = parseBankStatementCsv(text);
        setStatementLines(parsed);
      }
    };
    reader.readAsText(file);
  };

  const toggleStatementLineMatch = (lineId: string) => {
    setStatementLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, matched: !l.matched } : l))
    );
  };

  const toggleLedgerLineClear = (lineId: string) => {
    setLedgerLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, cleared: !l.cleared } : l))
    );
  };

  // Reconciliation Math
  const reconMath = useMemo(() => {
    // Unmatched statement deposits & checks
    let outstandingDepositsPaisa = 0;
    let outstandingPaymentsPaisa = 0;

    for (const l of statementLines) {
      if (!l.matched) {
        if (l.creditPaisa > 0) outstandingDepositsPaisa += l.creditPaisa;
        if (l.debitPaisa > 0) outstandingPaymentsPaisa += l.debitPaisa;
      }
    }

    return computeReconciliationMath({
      statementBalancePaisa: parsePkrToPaisa(reconStatementBalancePaisa),
      ledgerBalancePaisa,
      outstandingDepositsPaisa,
      outstandingPaymentsPaisa,
    });
  }, [reconStatementBalancePaisa, ledgerBalancePaisa, statementLines]);

  const handleSaveReconciliation = async () => {
    if (!reconBankAccountId) return;
    setSavingRecon(true);
    try {
      const matchedCount = statementLines.filter((l) => l.matched).length;
      const res = await apiFetch<{ success: boolean }>(
        '/api/finance/cash-bank/reconciliation/save',
        {
          method: 'POST',
          body: JSON.stringify({
            bankAccountId: reconBankAccountId,
            statementDate: reconStatementDate,
            statementBalancePaisa: parsePkrToPaisa(reconStatementBalancePaisa),
            clearedBalancePaisa: reconMath.adjustedStatementBalancePaisa,
            differencePaisa: reconMath.differencePaisa,
            matchedCount,
            status: reconMath.isReconciled ? 'reconciled' : 'draft',
            notes: reconMath.isReconciled
              ? 'Fully reconciled with zero variance'
              : `Unreconciled difference: ${formatPaisa(reconMath.differencePaisa)}`,
          }),
        }
      );

      if (res.success) {
        alert(
          reconMath.isReconciled
            ? 'Bank reconciliation completed and balanced!'
            : 'Reconciliation session saved as draft'
        );
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save reconciliation');
    } finally {
      setSavingRecon(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Cash & Bank Management
            </h1>
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 text-xs">
              Asset Class 1000 - 1099
            </Badge>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Cash tills, bank accounts, fund transfers, day-end counter deposits, and simple bank
            reconciliations
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadAll()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {can('finance.cash_bank.manage') && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (accounts.length >= 2) {
                    setTransferFromId(accounts[0]!.id);
                    setTransferToId(accounts[1]!.id);
                  }
                  setShowTransferModal(true);
                }}
              >
                <ArrowRightLeft className="w-4 h-4 mr-1.5" />
                Transfer Funds
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const cashAcct = accounts.find((a) => a.type === 'cash') || accounts[0];
                  const bankAcct = accounts.find((a) => a.type === 'bank') || accounts[0];
                  if (cashAcct) setDepositSourceCashId(cashAcct.id);
                  if (bankAcct) setDepositTargetId(bankAcct.id);
                  setShowDepositModal(true);
                }}
              >
                <ArrowDownToLine className="w-4 h-4 mr-1.5" />
                Deposit Counter Cash
              </Button>

              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => setShowAccountModal(true)}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                New Account
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-md">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Total Cash in Hand</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">
                  {formatPaisa(kpis.totalCashPaisa)}
                </h3>
              </div>
              <div className="p-3 bg-emerald-500/10 text-emerald-600 rounded-lg">
                <Wallet className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400">Vault & counter tills live balance</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Total Bank Balances</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">
                  {formatPaisa(kpis.totalBankPaisa)}
                </h3>
              </div>
              <div className="p-3 bg-blue-500/10 text-blue-600 rounded-lg">
                <Landmark className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400">Commercial bank accounts balance</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Transfers This Month</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">
                  {formatPaisa(kpis.transfersThisMonthPaisa)}
                </h3>
              </div>
              <div className="p-3 bg-amber-500/10 text-amber-600 rounded-lg">
                <ArrowRightLeft className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400">Inter-account settlements</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Day-End Cash Deposited</p>
                <h3 className="text-2xl font-bold text-emerald-600 mt-1">
                  {formatPaisa(kpis.depositsThisMonthPaisa)}
                </h3>
              </div>
              <div className="p-3 bg-emerald-500/10 text-emerald-600 rounded-lg">
                <ArrowDownToLine className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400">Counter collections banked</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-slate-200 gap-6">
        <button
          onClick={() => setActiveTab('accounts')}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'accounts'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Accounts Overview ({accounts.length})
        </button>
        <button
          onClick={() => setActiveTab('transfers')}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'transfers'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <ArrowRightLeft className="w-4 h-4" />
          Fund Transfers ({transfers.length})
        </button>
        <button
          onClick={() => setActiveTab('deposits')}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'deposits'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <ArrowDownToLine className="w-4 h-4" />
          Day-End Deposits ({deposits.length})
        </button>
        <button
          onClick={() => setActiveTab('reconciliation')}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'reconciliation'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Bank Reconciliation
        </button>
      </div>

      {/* TAB 1: Accounts Overview */}
      {activeTab === 'accounts' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((acct) => (
            <Card key={acct.id} className="bg-white border-slate-200 shadow-sm">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2.5 rounded-lg ${
                        acct.type === 'bank'
                          ? 'bg-blue-500/10 text-blue-600'
                          : acct.type === 'wallet'
                            ? 'bg-purple-500/10 text-purple-600'
                            : 'bg-emerald-500/10 text-emerald-600'
                      }`}
                    >
                      {acct.type === 'bank' ? (
                        <Landmark className="w-5 h-5" />
                      ) : (
                        <Wallet className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm">{acct.name}</h3>
                      <p className="text-xs text-slate-400">
                        {acct.accountCode} - {acct.accountName}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="capitalize text-[10px]">
                    {acct.type}
                  </Badge>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <span className="text-[11px] text-slate-400 block">Ledger Balance</span>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">
                    {formatPaisa(acct.ledgerBalancePaisa)}
                  </div>
                </div>

                {acct.type === 'bank' && (
                  <div className="text-xs text-slate-500 space-y-1 bg-slate-50 p-2 rounded">
                    {acct.bankName && <p>Bank: {acct.bankName}</p>}
                    {acct.accountNumber && <p>A/C: {acct.accountNumber}</p>}
                    {acct.iban && <p className="truncate">IBAN: {acct.iban}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* TAB 2: Fund Transfers */}
      {activeTab === 'transfers' && (
        <Card className="bg-white border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 text-xs font-semibold">
                  <TableHead>Transfer #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>From Account</TableHead>
                  <TableHead>To Account</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Ref / Notes</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-slate-400 text-xs">
                      No fund transfers recorded.
                    </TableCell>
                  </TableRow>
                ) : (
                  transfers.map((t) => (
                    <TableRow key={t.id} className="text-xs">
                      <TableCell className="font-semibold text-slate-900">
                        {t.transferNumber}
                      </TableCell>
                      <TableCell className="text-slate-500">
                        {formatKarachiDateOnly(t.transferDate)}
                      </TableCell>
                      <TableCell className="font-medium text-slate-700">
                        {t.fromAccountName}
                      </TableCell>
                      <TableCell className="font-medium text-slate-700">
                        {t.toAccountName}
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-900">
                        {formatPaisa(t.amountPaisa)}
                      </TableCell>
                      <TableCell className="text-slate-500 max-w-xs truncate">
                        {t.referenceNo ? `[${t.referenceNo}] ` : ''}
                        {t.notes || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            t.status === 'completed'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }
                        >
                          {t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {t.status === 'completed' && can('finance.cash_bank.manage') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-600 hover:text-rose-700 h-7 text-xs"
                            onClick={() =>
                              setReversalTarget({
                                type: 'transfer',
                                id: t.id,
                                docNumber: t.transferNumber,
                              })
                            }
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />
                            Reverse
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* TAB 3: Day-End Deposits */}
      {activeTab === 'deposits' && (
        <Card className="bg-white border-slate-200 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 text-xs font-semibold">
                  <TableHead>Deposit #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Branch / Counter</TableHead>
                  <TableHead>Source Cash Till</TableHead>
                  <TableHead>Target Bank / Safe</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deposits.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-slate-400 text-xs">
                      No day-end cash deposits recorded.
                    </TableCell>
                  </TableRow>
                ) : (
                  deposits.map((d) => (
                    <TableRow key={d.id} className="text-xs">
                      <TableCell className="font-semibold text-slate-900">
                        {d.depositNumber}
                      </TableCell>
                      <TableCell className="text-slate-500">
                        {formatKarachiDateOnly(d.depositDate)}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-slate-800">{d.branchName}</p>
                        <span className="text-[11px] text-slate-400">
                          {d.counterName || 'Till'}
                        </span>
                      </TableCell>
                      <TableCell className="text-slate-600">{d.sourceCashAccountName}</TableCell>
                      <TableCell className="font-medium text-slate-800">
                        {d.targetAccountName}
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-900">
                        {formatPaisa(d.amountPaisa)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            d.status === 'completed'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }
                        >
                          {d.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {d.status === 'completed' && can('finance.cash_bank.manage') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-600 hover:text-rose-700 h-7 text-xs"
                            onClick={() =>
                              setReversalTarget({
                                type: 'deposit',
                                id: d.id,
                                docNumber: d.depositNumber,
                              })
                            }
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />
                            Reverse
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* TAB 4: Bank Reconciliation */}
      {activeTab === 'reconciliation' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <Card className="bg-white border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Bank Account
                  </label>
                  <select
                    value={reconBankAccountId}
                    onChange={(e) => setReconBankAccountId(e.target.value)}
                    className="h-9 px-3 border rounded bg-white text-xs"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.type})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Statement Date
                  </label>
                  <input
                    type="date"
                    value={reconStatementDate}
                    onChange={(e) => setReconStatementDate(e.target.value)}
                    className="h-9 px-3 border rounded bg-white text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Statement Ending Balance (PKR)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={reconStatementBalancePaisa || ''}
                    onChange={(e) => setReconStatementBalancePaisa(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="h-9 w-40 text-xs font-semibold"
                  />
                </div>

                <div className="pt-5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFetchLedgerLines}
                    disabled={reconLoading}
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 mr-1 ${reconLoading ? 'animate-spin' : ''}`}
                    />
                    Refresh Ledger
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-5">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCsvFileUpload}
                    className="hidden"
                  />
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-xs font-medium rounded border">
                    <Upload className="w-3.5 h-3.5" />
                    Import CSV Statement
                  </span>
                </label>

                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={handleSaveReconciliation}
                  disabled={savingRecon}
                >
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  Save Reconciliation
                </Button>
              </div>
            </div>
          </Card>

          {/* Reconciliation Math Summary Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 bg-slate-50 rounded-lg border border-slate-200 text-center">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                Statement Balance
              </span>
              <p className="font-bold text-slate-900 text-sm mt-0.5">
                {formatPaisa(parsePkrToPaisa(reconStatementBalancePaisa))}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                Ledger Balance
              </span>
              <p className="font-bold text-slate-900 text-sm mt-0.5">
                {formatPaisa(ledgerBalancePaisa)}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                Adjusted Balance
              </span>
              <p className="font-bold text-slate-900 text-sm mt-0.5">
                {formatPaisa(reconMath.adjustedStatementBalancePaisa)}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                Unreconciled Difference
              </span>
              <div className="mt-0.5">
                {reconMath.isReconciled ? (
                  <Badge
                    variant="outline"
                    className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-bold"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    Diff: 0 (Balanced)
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-rose-50 text-rose-700 border-rose-200 text-xs font-bold"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                    Diff: {formatPaisa(reconMath.differencePaisa)}
                  </Badge>
                )}
              </div>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                Matched Items
              </span>
              <p className="font-bold text-slate-900 text-sm mt-0.5">
                {statementLines.filter((l) => l.matched).length} / {statementLines.length}
              </p>
            </div>
          </div>

          {/* Split View: Statement Lines vs Ledger Lines */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: Statement Lines */}
            <Card className="bg-white border-slate-200 shadow-sm overflow-hidden">
              <div className="p-3 bg-slate-50 border-b flex justify-between items-center text-xs font-semibold">
                <span>Bank Statement Lines ({statementLines.length})</span>
                <span className="text-slate-400">Tick items matched with ledger</span>
              </div>
              <CardContent className="p-0 max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/50 text-[11px]">
                      <TableHead className="w-10">Match</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statementLines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-slate-400 text-xs">
                          No statement imported. Click "Import CSV Statement" above.
                        </TableCell>
                      </TableRow>
                    ) : (
                      statementLines.map((l) => (
                        <TableRow
                          key={l.id}
                          className={`text-xs cursor-pointer ${
                            l.matched ? 'bg-emerald-50/40' : ''
                          }`}
                          onClick={() => toggleStatementLineMatch(l.id)}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={!!l.matched}
                              onChange={() => toggleStatementLineMatch(l.id)}
                              className="rounded text-emerald-600 focus:ring-0"
                            />
                          </TableCell>
                          <TableCell className="text-slate-500">{l.date}</TableCell>
                          <TableCell className="max-w-[150px] truncate">{l.description}</TableCell>
                          <TableCell className="text-right text-rose-600 font-medium">
                            {l.debitPaisa > 0 ? formatPaisa(l.debitPaisa) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-emerald-600 font-medium">
                            {l.creditPaisa > 0 ? formatPaisa(l.creditPaisa) : '—'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Right: Ledger Lines */}
            <Card className="bg-white border-slate-200 shadow-sm overflow-hidden">
              <div className="p-3 bg-slate-50 border-b flex justify-between items-center text-xs font-semibold">
                <span>General Ledger Transactions ({ledgerLines.length})</span>
                <span className="text-slate-400">Account 1010/1000 Activity</span>
              </div>
              <CardContent className="p-0 max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/50 text-[11px]">
                      <TableHead className="w-10">Clear</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Memo</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledgerLines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-slate-400 text-xs">
                          No ledger transactions in this period.
                        </TableCell>
                      </TableRow>
                    ) : (
                      ledgerLines.map((l) => (
                        <TableRow
                          key={l.id}
                          className={`text-xs cursor-pointer ${
                            l.cleared ? 'bg-emerald-50/40' : ''
                          }`}
                          onClick={() => toggleLedgerLineClear(l.id)}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={!!l.cleared}
                              onChange={() => toggleLedgerLineClear(l.id)}
                              className="rounded text-emerald-600 focus:ring-0"
                            />
                          </TableCell>
                          <TableCell className="text-slate-500">{l.date}</TableCell>
                          <TableCell className="max-w-[150px] truncate">{l.description}</TableCell>
                          <TableCell className="text-right text-emerald-600 font-medium">
                            {l.debitPaisa > 0 ? formatPaisa(l.debitPaisa) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-rose-600 font-medium">
                            {l.creditPaisa > 0 ? formatPaisa(l.creditPaisa) : '—'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* NEW ACCOUNT MODAL */}
      <Modal
        open={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        title="Create Cash or Bank Account"
      >
        <form onSubmit={handleCreateAccount} className="space-y-4 text-xs">
          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Account Name *</label>
            <Input
              value={newAccountName}
              onChange={(e) => setNewAccountName(e.target.value)}
              placeholder="e.g. Meezan Bank Main or Petty Cash Vault"
              required
              className="h-9 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Account Type *</label>
              <select
                value={newAccountType}
                onChange={(e) => setNewAccountType(e.target.value as 'cash' | 'bank' | 'wallet')}
                className="w-full h-9 px-3 border rounded bg-white text-xs"
              >
                <option value="bank">Commercial Bank</option>
                <option value="cash">Cash in Hand / Till</option>
                <option value="wallet">Mobile Wallet</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Mapped Ledger Account *</label>
              <select
                value={newAccountLedgerId}
                onChange={(e) => setNewAccountLedgerId(e.target.value)}
                className="w-full h-9 px-3 border rounded bg-white text-xs"
                required
              >
                {ledgerAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} - {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {newAccountType === 'bank' && (
            <div className="space-y-3 p-3 bg-slate-50 rounded">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Bank Name</label>
                  <Input
                    value={newAccountBankName}
                    onChange={(e) => setNewAccountBankName(e.target.value)}
                    placeholder="e.g. Meezan Bank Ltd"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Account Number</label>
                  <Input
                    value={newAccountNumber}
                    onChange={(e) => setNewAccountNumber(e.target.value)}
                    placeholder="010203040506"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Branch Name</label>
                  <Input
                    value={newAccountBranch}
                    onChange={(e) => setNewAccountBranch(e.target.value)}
                    placeholder="Clifton Branch"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">IBAN</label>
                  <Input
                    value={newAccountIban}
                    onChange={(e) => setNewAccountIban(e.target.value)}
                    placeholder="PK36MEZN..."
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Opening Balance (PKR)</label>
            <Input
              type="number"
              step="0.01"
              value={newAccountOpeningPaisa || ''}
              onChange={(e) => setNewAccountOpeningPaisa(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
              className="h-9 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAccountModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={accountSubmitting}
            >
              {accountSubmitting ? 'Creating...' : 'Create Account'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* FUND TRANSFER MODAL */}
      <Modal
        open={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        title="Inter-Account Fund Transfer"
      >
        <form onSubmit={handleCreateTransfer} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">From Account *</label>
              <select
                value={transferFromId}
                onChange={(e) => setTransferFromId(e.target.value)}
                className="w-full h-9 px-3 border rounded bg-white text-xs"
                required
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({formatPaisa(a.ledgerBalancePaisa)})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">To Account *</label>
              <select
                value={transferToId}
                onChange={(e) => setTransferToId(e.target.value)}
                className="w-full h-9 px-3 border rounded bg-white text-xs"
                required
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({formatPaisa(a.ledgerBalancePaisa)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Amount (PKR) *</label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={transferAmountPaisa || ''}
                onChange={(e) => setTransferAmountPaisa(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                required
                className="h-9 text-xs font-semibold"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Transfer Date *</label>
              <input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                className="w-full h-9 px-3 border rounded bg-white text-xs"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Reference / Cheque #</label>
            <Input
              value={transferRef}
              onChange={(e) => setTransferRef(e.target.value)}
              placeholder="e.g. SLIP-1234 or CHQ-9901"
              className="h-9 text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Notes</label>
            <textarea
              rows={2}
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
              placeholder="Reason or notes..."
              className="w-full p-2 border rounded bg-white text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowTransferModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={transferSubmitting}
            >
              {transferSubmitting ? 'Posting...' : 'Post Transfer'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* COUNTER DEPOSIT MODAL */}
      <Modal
        open={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        title="Day-End Counter Cash Deposit"
      >
        <form onSubmit={handleCreateDeposit} className="space-y-4 text-xs">
          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Branch *</label>
            <select
              value={depositBranchId}
              onChange={(e) => setDepositBranchId(e.target.value)}
              className="w-full h-9 px-3 border rounded bg-white text-xs"
              required
            >
              {branchesList.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Source Cash Till *</label>
              <select
                value={depositSourceCashId}
                onChange={(e) => setDepositSourceCashId(e.target.value)}
                className="w-full h-9 px-3 border rounded bg-white text-xs"
                required
              >
                {accounts
                  .filter((a) => a.type === 'cash')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatPaisa(a.ledgerBalancePaisa)})
                    </option>
                  ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Target Bank / Vault *</label>
              <select
                value={depositTargetId}
                onChange={(e) => setDepositTargetId(e.target.value)}
                className="w-full h-9 px-3 border rounded bg-white text-xs"
                required
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.type})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Deposit Amount (PKR) *</label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={depositAmountPaisa || ''}
                onChange={(e) => setDepositAmountPaisa(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                required
                className="h-9 text-xs font-semibold"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Deposit Date *</label>
              <input
                type="date"
                value={depositDate}
                onChange={(e) => setDepositDate(e.target.value)}
                className="w-full h-9 px-3 border rounded bg-white text-xs"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Notes / Shift Reference</label>
            <textarea
              rows={2}
              value={depositNotes}
              onChange={(e) => setDepositNotes(e.target.value)}
              placeholder="Notes or shift reference..."
              className="w-full p-2 border rounded bg-white text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowDepositModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={depositSubmitting}
            >
              {depositSubmitting ? 'Depositing...' : 'Deposit Cash'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* REVERSAL MODAL */}
      <Modal
        open={!!reversalTarget}
        onClose={() => setReversalTarget(null)}
        title={`Reverse Document: ${reversalTarget?.docNumber}`}
      >
        <form onSubmit={handleConfirmReversal} className="space-y-4 text-xs">
          <p className="text-slate-500">
            Accounting records are immutable. Reversing this document will post an exact offsetting
            reversal entry to the general ledger.
          </p>

          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Reason for Reversal *</label>
            <Input
              value={reversalReason}
              onChange={(e) => setReversalReason(e.target.value)}
              placeholder="e.g. Incorrect account selected or duplicate entry"
              required
              className="h-9 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReversalTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="bg-rose-600 hover:bg-rose-700 text-white"
              disabled={reversalSubmitting}
            >
              {reversalSubmitting ? 'Reversing...' : 'Confirm Reversal'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
