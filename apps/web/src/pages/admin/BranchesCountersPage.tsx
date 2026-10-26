import React, { useState, useEffect } from 'react';
import type { BranchRecord, CounterRecord } from '../../types';
import { apiFetch } from '../../lib/api';
import { formatKarachiDateTime } from '../../lib/formatters';
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
  Modal,
  Input,
  Badge,
} from '@pos/ui';
import { Store, Plus, RefreshCw, Hash } from 'lucide-react';

export const BranchesCountersPage: React.FC = () => {
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [counters, setCounters] = useState<CounterRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [branchSubmitting, setBranchSubmitting] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  const [isCounterModalOpen, setIsCounterModalOpen] = useState(false);
  const [counterBranchId, setCounterBranchId] = useState('');
  const [counterName, setCounterName] = useState('');
  const [counterCode, setCounterCode] = useState('');
  const [counterSubmitting, setCounterSubmitting] = useState(false);
  const [counterError, setCounterError] = useState<string | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [branchRes, counterRes] = await Promise.all([
        apiFetch<{ items: BranchRecord[] }>('/api/admin/branches'),
        apiFetch<{ items: CounterRecord[] }>('/api/admin/counters'),
      ]);
      setBranches(branchRes.items);
      setCounters(counterRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch branch and counter data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchName.trim()) {
      setBranchError('Branch name is required.');
      return;
    }

    setBranchSubmitting(true);
    setBranchError(null);

    try {
      await apiFetch('/api/admin/branches', {
        method: 'POST',
        body: JSON.stringify({
          name: branchName.trim(),
          address: branchAddress.trim() || undefined,
          phone: branchPhone.trim() || undefined,
        }),
      });

      setIsBranchModalOpen(false);
      setBranchName('');
      setBranchAddress('');
      setBranchPhone('');
      fetchData();
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : 'Failed to create branch');
    } finally {
      setBranchSubmitting(false);
    }
  };

  const handleCreateCounter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!counterBranchId || !counterName.trim()) {
      setCounterError('Branch selection and counter name are required.');
      return;
    }

    setCounterSubmitting(true);
    setCounterError(null);

    try {
      await apiFetch('/api/admin/counters', {
        method: 'POST',
        body: JSON.stringify({
          branchId: counterBranchId,
          name: counterName.trim(),
          code: counterCode.trim() || undefined,
        }),
      });

      setIsCounterModalOpen(false);
      setCounterBranchId('');
      setCounterName('');
      setCounterCode('');
      fetchData();
    } catch (err) {
      setCounterError(err instanceof Error ? err.message : 'Failed to create counter');
    } finally {
      setCounterSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Branches &amp; Counter Registers
          </h2>
          <p className="text-xs text-slate-500">
            Configure multi-branch physical stores and discrete till counters
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setIsBranchModalOpen(true)}
            size="sm"
            className="gap-2 text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Branch
          </Button>
          <Button
            onClick={() => {
              if (branches.length > 0 && branches[0]) {
                setCounterBranchId(branches[0].id);
              }
              setIsCounterModalOpen(true);
            }}
            size="sm"
            variant="outline"
            className="gap-2 text-xs font-semibold"
            disabled={branches.length === 0}
          >
            <Plus className="w-3.5 h-3.5" />
            Add Counter
          </Button>
          <Button
            onClick={fetchData}
            variant="outline"
            size="sm"
            className="gap-2 text-xs"
            disabled={isLoading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Branches List */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Store className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-900">Configured Branches</h3>
        </div>
        <Card className="shadow-sm border-slate-200">
          <CardContent className="p-0">
            {branches.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Branch Name</TableHead>
                    <TableHead className="text-xs">Address</TableHead>
                    <TableHead className="text-xs">Phone</TableHead>
                    <TableHead className="text-xs">Created At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="text-xs font-bold text-slate-900">
                        {b.name}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {b.address || '—'}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-slate-600">
                        {b.phone || '—'}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-slate-500">
                        {formatKarachiDateTime(b.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-8 text-center text-xs text-slate-400">
                No branches configured yet. Click "Add Branch" above.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Counters List */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-900">Active Counters</h3>
        </div>
        <Card className="shadow-sm border-slate-200">
          <CardContent className="p-0">
            {counters.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Counter Name</TableHead>
                    <TableHead className="text-xs">Branch</TableHead>
                    <TableHead className="text-xs">Code Prefix</TableHead>
                    <TableHead className="text-xs text-right">Invoices Issued</TableHead>
                    <TableHead className="text-xs">Created At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {counters.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs font-bold text-slate-900">
                        {c.name}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {c.branchName}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="font-mono text-[10px] font-bold">
                          {c.code || 'C1'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs font-mono font-bold text-slate-800">
                        {c.lastInvoiceSeq}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-slate-500">
                        {formatKarachiDateTime(c.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-8 text-center text-xs text-slate-400">
                No counters configured yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Branch Modal */}
      <Modal
        open={isBranchModalOpen}
        onClose={() => setIsBranchModalOpen(false)}
        title="Add New Branch"
        description="Add a physical pharmacy location."
      >
        <form onSubmit={handleCreateBranch} className="space-y-4 pt-2">
          {branchError && (
            <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
              {branchError}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Branch Name</label>
            <Input
              type="text"
              placeholder="e.g. Branch South"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              disabled={branchSubmitting}
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Address (Optional)</label>
            <Input
              type="text"
              placeholder="e.g. Clifton Block 2, Karachi"
              value={branchAddress}
              onChange={(e) => setBranchAddress(e.target.value)}
              disabled={branchSubmitting}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Phone (Optional)</label>
            <Input
              type="text"
              placeholder="e.g. +92-21-35800000"
              value={branchPhone}
              onChange={(e) => setBranchPhone(e.target.value)}
              disabled={branchSubmitting}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsBranchModalOpen(false)}
              disabled={branchSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={branchSubmitting}>
              {branchSubmitting ? 'Creating Branch...' : 'Create Branch'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add Counter Modal */}
      <Modal
        open={isCounterModalOpen}
        onClose={() => setIsCounterModalOpen(false)}
        title="Add New Counter"
        description="Add a till checkout counter register to a branch."
      >
        <form onSubmit={handleCreateCounter} className="space-y-4 pt-2">
          {counterError && (
            <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
              {counterError}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Target Branch</label>
            <select
              value={counterBranchId}
              onChange={(e) => setCounterBranchId(e.target.value)}
              className="w-full h-9 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={counterSubmitting}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Counter Name</label>
            <Input
              type="text"
              placeholder="e.g. Counter 1 (Main Cash)"
              value={counterName}
              onChange={(e) => setCounterName(e.target.value)}
              disabled={counterSubmitting}
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Code Prefix</label>
            <Input
              type="text"
              placeholder="e.g. C1 or EAST-1"
              value={counterCode}
              onChange={(e) => setCounterCode(e.target.value)}
              disabled={counterSubmitting}
              maxLength={6}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsCounterModalOpen(false)}
              disabled={counterSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={counterSubmitting}>
              {counterSubmitting ? 'Creating Counter...' : 'Create Counter'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
