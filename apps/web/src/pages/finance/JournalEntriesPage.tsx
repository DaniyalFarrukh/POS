import React, { useState, useEffect, useMemo } from 'react';
import type { JournalEntryRecord, AccountRecord } from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatPaisa, formatKarachiDateOnly, formatKarachiDateTime } from '../../lib/formatters';
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
  Scale,
  Plus,
  RefreshCw,
  Search,
  RotateCcw,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  ShieldAlert,
} from 'lucide-react';
import {
  validateManualJournalDraft,
  canPostManualJournal,
  canReverseJournalEntry,
  getSourceDocumentLink,
  type ManualJournalLineDraft,
} from '../../lib/finance-utils';

interface LineFormState {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}

export const JournalEntriesPage: React.FC = () => {
  const { user } = useAuth();
  const canPost = user ? canPostManualJournal(user.role) : false;

  const [entries, setEntries] = useState<JournalEntryRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [sourceType, setSourceType] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  // Modals
  const [selectedEntry, setSelectedEntry] = useState<JournalEntryRecord | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState<boolean>(false);

  const [entryToReverse, setEntryToReverse] = useState<JournalEntryRecord | null>(null);
  const [reversalReason, setReversalReason] = useState<string>('');
  const [isReverseModalOpen, setIsReverseModalOpen] = useState<boolean>(false);
  const [reversalSubmitting, setReversalSubmitting] = useState<boolean>(false);
  const [reversalError, setReversalError] = useState<string | null>(null);

  // Create Manual Journal Modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [entryDate, setEntryDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [entryMemo, setEntryMemo] = useState<string>('');
  const [lines, setLines] = useState<LineFormState[]>([
    { accountId: '', debit: '', credit: '', memo: '' },
    { accountId: '', debit: '', credit: '', memo: '' },
  ]);
  const [createSubmitting, setCreateSubmitting] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchEntries = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (sourceType && sourceType !== 'all') params.set('sourceType', sourceType);
      if (status && status !== 'all') params.set('status', status);
      if (search.trim()) params.set('search', search.trim());

      const res = await apiFetch<{ items: JournalEntryRecord[]; total: number }>(
        `/api/finance/journals?${params.toString()}`
      );
      setEntries(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load journal entries');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAccounts = async () => {
    try {
      const res = await apiFetch<{ items: AccountRecord[] }>('/api/finance/coa');
      setAccounts(res.items);
    } catch {
      // Ignored if non-blocking
    }
  };

  useEffect(() => {
    fetchEntries();
    fetchAccounts();
  }, []);

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEntries();
  };

  const handleResetFilters = () => {
    setFrom('');
    setTo('');
    setSourceType('all');
    setStatus('all');
    setSearch('');
    setTimeout(() => {
      apiFetch<{ items: JournalEntryRecord[]; total: number }>('/api/finance/journals')
        .then((res) => setEntries(res.items))
        .catch((err) => setError(err.message));
    }, 0);
  };

  // Convert line form states to paisa drafts for validation
  const validationResult = useMemo(() => {
    const drafts: ManualJournalLineDraft[] = lines.map((l) => {
      const parsedDebit = parseFloat(l.debit || '0');
      const parsedCredit = parseFloat(l.credit || '0');
      return {
        accountId: l.accountId,
        debitPaisa: isNaN(parsedDebit) ? 0 : Math.round(parsedDebit * 100),
        creditPaisa: isNaN(parsedCredit) ? 0 : Math.round(parsedCredit * 100),
        memo: l.memo || undefined,
      };
    });

    return validateManualJournalDraft({
      entryDate,
      memo: entryMemo,
      lines: drafts,
    });
  }, [entryDate, entryMemo, lines]);

  const handleAddLine = () => {
    setLines((prev) => [...prev, { accountId: '', debit: '', credit: '', memo: '' }]);
  };

  const handleRemoveLine = (idx: number) => {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleLineChange = (idx: number, field: keyof LineFormState, value: string) => {
    setLines((prev) => {
      const copy = [...prev];
      const target = copy[idx];
      if (!target) return prev;
      const current: LineFormState = { ...target, [field]: value };
      // If setting debit, clear credit and vice versa if typing a positive amount
      if (field === 'debit' && value && parseFloat(value) > 0) {
        current.credit = '';
      } else if (field === 'credit' && value && parseFloat(value) > 0) {
        current.debit = '';
      }
      copy[idx] = current;
      return copy;
    });
  };

  const handleCreateJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validationResult.isValid) {
      setCreateError(validationResult.entryError || 'Please fix errors on journal lines.');
      return;
    }

    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const payloadLines = lines.map((l) => ({
        accountId: l.accountId,
        debitPaisa: Math.round(parseFloat(l.debit || '0') * 100),
        creditPaisa: Math.round(parseFloat(l.credit || '0') * 100),
        memo: l.memo.trim() || undefined,
      }));

      await apiFetch('/api/finance/journals', {
        method: 'POST',
        body: JSON.stringify({
          entryDate,
          memo: entryMemo.trim() || 'Manual journal entry',
          lines: payloadLines,
        }),
      });

      setIsCreateModalOpen(false);
      setEntryMemo('');
      setLines([
        { accountId: '', debit: '', credit: '', memo: '' },
        { accountId: '', debit: '', credit: '', memo: '' },
      ]);
      await fetchEntries();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to post journal entry');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleOpenReverse = (entry: JournalEntryRecord) => {
    setEntryToReverse(entry);
    setReversalReason('');
    setReversalError(null);
    setIsReverseModalOpen(true);
  };

  const handleConfirmReverse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryToReverse) return;
    if (!reversalReason.trim() || reversalReason.trim().length < 3) {
      setReversalError('Please provide a substantive reversal reason (minimum 3 characters).');
      return;
    }

    setReversalSubmitting(true);
    setReversalError(null);
    try {
      await apiFetch(`/api/finance/journals/${entryToReverse.id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason: reversalReason.trim() }),
      });
      setIsReverseModalOpen(false);
      setEntryToReverse(null);
      await fetchEntries();
    } catch (err) {
      setReversalError(err instanceof Error ? err.message : 'Failed to reverse entry');
    } finally {
      setReversalSubmitting(false);
    }
  };

  const getEntryTotalPaisa = (entry: JournalEntryRecord): number => {
    return (entry.lines || []).reduce((sum, l) => sum + (l.debitPaisa || 0), 0);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Scale className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            General Journal
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Immutable double-entry transaction ledger with audit trails, document links, and
            reversing entries
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canPost && (
            <Button
              onClick={() => {
                setCreateError(null);
                setIsCreateModalOpen(true);
              }}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Manual Journal
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-300 rounded-lg flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {/* Filter Card */}
      <Card>
        <CardContent className="p-4">
          <form onSubmit={handleFilterSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                From Date
              </label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                To Date
              </label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Document Source
              </label>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-md bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Sources</option>
                <option value="manual">Manual Journals</option>
                <option value="invoice">POS Invoices</option>
                <option value="credit_note">Credit Notes / Returns</option>
                <option value="purchase">Supplier Purchases</option>
                <option value="stock_adjustment">Stock Adjustments</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-md bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Statuses</option>
                <option value="posted">Posted</option>
                <option value="reversed">Reversed</option>
              </select>
            </div>

            <div className="flex items-end gap-2">
              <Button
                type="submit"
                className="flex-1 flex items-center justify-center gap-1.5"
                size="sm"
              >
                <Search className="w-3.5 h-3.5" />
                Filter
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleResetFilters}>
                Reset
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Journal Entries Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
              <p className="text-sm">Loading ledger entries...</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
              <Scale className="w-10 h-10 text-slate-300 dark:text-slate-700" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                No journal entries found
              </p>
              <p className="text-xs text-slate-400">
                Adjust date or source filters, or create a manual journal entry.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Entry #</TableHead>
                  <TableHead className="w-32">Date</TableHead>
                  <TableHead className="w-48">Source Document</TableHead>
                  <TableHead>Memo / Narration</TableHead>
                  <TableHead className="w-28 text-center">Status</TableHead>
                  <TableHead className="w-36 text-right">Debit / Credit</TableHead>
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const docLink = getSourceDocumentLink(entry);
                  const totalPaisa = getEntryTotalPaisa(entry);
                  const canReverse = user
                    ? canReverseJournalEntry(
                        {
                          id: entry.id,
                          entryNo: entry.entryNo,
                          status: entry.status,
                          reversesEntryId: entry.reversesEntryId,
                        },
                        user.role
                      ).canReverse
                    : false;

                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono font-bold text-slate-900 dark:text-slate-100">
                        #{entry.entryNo}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600 dark:text-slate-400">
                        {formatKarachiDateOnly(entry.entryDate)}
                      </TableCell>
                      <TableCell>
                        {docLink.hasLink ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900">
                            {docLink.label}
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            Manual Journal
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-800 dark:text-slate-200 max-w-xs truncate">
                        {entry.memo}
                        {entry.reversesEntryId && (
                          <span className="block text-xs text-amber-600 dark:text-amber-400 font-medium">
                            Opposing reversal entry
                          </span>
                        )}
                        {entry.reversedByEntryNo && (
                          <span className="block text-xs text-rose-500 font-medium">
                            Reversed by #{entry.reversedByEntryNo}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={entry.status === 'posted' ? 'success' : 'warning'}>
                          {entry.status === 'posted' ? 'Posted' : 'Reversed'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                        {formatPaisa(totalPaisa)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="View Entry Details"
                            onClick={() => {
                              setSelectedEntry(entry);
                              setIsDetailModalOpen(true);
                            }}
                          >
                            <Eye className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                          </Button>
                          {canReverse && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Reverse Journal Entry"
                              onClick={() => handleOpenReverse(entry)}
                              className="text-amber-600 hover:text-amber-700"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Entry Detail Modal */}
      {isDetailModalOpen && selectedEntry && (
        <Modal
          open={isDetailModalOpen}
          onClose={() => {
            setIsDetailModalOpen(false);
            setSelectedEntry(null);
          }}
          title={`Journal Entry #${selectedEntry.entryNo}`}
        >
          <div className="space-y-4 max-w-2xl">
            {/* Header info */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg text-xs">
              <div>
                <span className="text-slate-500 block">Date</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {formatKarachiDateOnly(selectedEntry.entryDate)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Status</span>
                <Badge variant={selectedEntry.status === 'posted' ? 'success' : 'warning'}>
                  {selectedEntry.status.toUpperCase()}
                </Badge>
              </div>
              <div>
                <span className="text-slate-500 block">Posted At</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {formatKarachiDateTime(selectedEntry.postedAt)}
                </span>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <span className="text-slate-500 block">Memo / Narration</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {selectedEntry.memo}
                </span>
              </div>
              {selectedEntry.reversalReason && (
                <div className="col-span-2 sm:col-span-3 p-2 bg-amber-50 dark:bg-amber-950/30 rounded border border-amber-200 dark:border-amber-900">
                  <span className="text-amber-800 dark:text-amber-300 font-semibold block">
                    Reversal Reason:
                  </span>
                  <span className="text-amber-700 dark:text-amber-400">
                    {selectedEntry.reversalReason}
                  </span>
                </div>
              )}
            </div>

            {/* Lines Table */}
            <div>
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider">
                Journal Lines ({selectedEntry.lines?.length || 0})
              </h4>
              <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Line Memo</TableHead>
                      <TableHead className="w-28 text-right">Debit</TableHead>
                      <TableHead className="w-28 text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(selectedEntry.lines || []).map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="text-xs font-medium">
                          <span className="font-mono font-semibold text-blue-600 dark:text-blue-400 mr-1.5">
                            [{line.accountCode || '—'}]
                          </span>
                          {line.accountName || line.accountId}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">{line.memo || '—'}</TableCell>
                        <TableCell className="text-xs text-right font-mono tabular-nums">
                          {line.debitPaisa > 0 ? formatPaisa(line.debitPaisa) : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono tabular-nums">
                          {line.creditPaisa > 0 ? formatPaisa(line.creditPaisa) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Totals row */}
                    <TableRow className="bg-slate-50 dark:bg-slate-900/60 font-semibold border-t-2">
                      <TableCell colSpan={2} className="text-xs text-slate-700 dark:text-slate-300">
                        Total Balanced
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono tabular-nums">
                        {formatPaisa(getEntryTotalPaisa(selectedEntry))}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono tabular-nums">
                        {formatPaisa(getEntryTotalPaisa(selectedEntry))}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-end pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsDetailModalOpen(false);
                  setSelectedEntry(null);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create Manual Journal Modal */}
      {isCreateModalOpen && (
        <Modal
          open={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          title="Create Manual Journal Entry"
        >
          <form onSubmit={handleCreateJournal} className="space-y-4 max-w-3xl">
            {createError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-300 text-xs rounded-md flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Entry Date <span className="text-rose-500">*</span>
                </label>
                <Input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  General Memo / Narration <span className="text-rose-500">*</span>
                </label>
                <Input
                  placeholder="e.g. Month-end petty cash replenishment"
                  value={entryMemo}
                  onChange={(e) => setEntryMemo(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Dynamic Lines */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Journal Lines (Minimum 2)
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddLine}
                  className="flex items-center gap-1 text-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Line
                </Button>
              </div>

              <div className="space-y-2 border border-slate-200 dark:border-slate-800 rounded-md p-2 bg-slate-50/50 dark:bg-slate-900/30">
                {lines.map((line, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    {/* Account selection */}
                    <div className="flex-[3]">
                      <select
                        value={line.accountId}
                        onChange={(e) => handleLineChange(idx, 'accountId', e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border rounded bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        required
                      >
                        <option value="">-- Select Account --</option>
                        {accounts
                          .filter((a) => a.isActive)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              [{a.code}] {a.name} ({a.type})
                            </option>
                          ))}
                      </select>
                    </div>

                    {/* Debit */}
                    <div className="flex-[2]">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Debit (PKR)"
                        value={line.debit}
                        onChange={(e) => handleLineChange(idx, 'debit', e.target.value)}
                        className="text-right text-xs"
                      />
                    </div>

                    {/* Credit */}
                    <div className="flex-[2]">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Credit (PKR)"
                        value={line.credit}
                        onChange={(e) => handleLineChange(idx, 'credit', e.target.value)}
                        className="text-right text-xs"
                      />
                    </div>

                    {/* Line Memo */}
                    <div className="flex-[3]">
                      <Input
                        placeholder="Line note..."
                        value={line.memo}
                        onChange={(e) => handleLineChange(idx, 'memo', e.target.value)}
                        className="text-xs"
                      />
                    </div>

                    {/* Remove button */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={lines.length <= 2}
                      onClick={() => handleRemoveLine(idx)}
                      className="text-rose-500 hover:text-rose-700 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Balanced Tally Footer */}
            <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
              <div className="flex items-center gap-4 font-mono">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Total Debit</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {formatPaisa(validationResult.totalDebitPaisa)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Total Credit</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {formatPaisa(validationResult.totalCreditPaisa)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Difference</span>
                  <span
                    className={`font-semibold ${
                      validationResult.differencePaisa === 0
                        ? 'text-emerald-600'
                        : 'text-rose-600 font-bold'
                    }`}
                  >
                    {formatPaisa(validationResult.differencePaisa)}
                  </span>
                </div>
              </div>

              <div>
                {validationResult.isValid ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold text-xs">
                    <CheckCircle2 className="w-4 h-4" /> Balanced & Valid
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-rose-500 font-medium text-xs">
                    <AlertTriangle className="w-4 h-4" />{' '}
                    {validationResult.entryError || 'Unbalanced'}
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-800">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateModalOpen(false)}
                disabled={createSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!validationResult.isValid || createSubmitting}
                className="flex items-center gap-2"
              >
                {createSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
                Post Journal Entry
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Reverse Entry Confirmation Modal */}
      {isReverseModalOpen && entryToReverse && (
        <Modal
          open={isReverseModalOpen}
          onClose={() => {
            setIsReverseModalOpen(false);
            setEntryToReverse(null);
          }}
          title={`Reverse Journal Entry #${entryToReverse.entryNo}`}
        >
          <form onSubmit={handleConfirmReverse} className="space-y-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 text-xs rounded-md space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <ShieldAlert className="w-4 h-4" />
                Immutable Ledger Protection
              </div>
              <p>
                Accounting records cannot be modified or deleted. Reversing this entry will
                immediately post an exact opposing journal entry that flips debits and credits,
                netting the ledger balance to zero.
              </p>
            </div>

            {reversalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-300 text-xs rounded-md">
                {reversalError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Reason for Reversal <span className="text-rose-500">*</span>
              </label>
              <Input
                placeholder="e.g. Incorrect account selected on invoice adjustment"
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsReverseModalOpen(false);
                  setEntryToReverse(null);
                }}
                disabled={reversalSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={reversalSubmitting}
                className="flex items-center gap-1.5"
              >
                {reversalSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Confirm Reversal
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
