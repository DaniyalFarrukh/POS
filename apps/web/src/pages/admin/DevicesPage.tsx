import React, { useState, useEffect } from 'react';
import type { DeviceRecord, BranchRecord, CounterRecord } from '../../types';
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
  Badge,
  Modal,
  Input,
} from '@pos/ui';
import {
  MonitorSmartphone,
  Key,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';

export const DevicesPage: React.FC = () => {
  const [devicesList, setDevicesList] = useState<DeviceRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [counters, setCounters] = useState<CounterRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Generate Code Modal
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [codeBranchId, setCodeBranchId] = useState('');
  const [codeCounterId, setCodeCounterId] = useState('');
  const [expiresInHours, setExpiresInHours] = useState('24');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [devRes, branchRes, counterRes] = await Promise.all([
        apiFetch<{ items: DeviceRecord[] }>('/api/admin/devices'),
        apiFetch<{ items: BranchRecord[] }>('/api/admin/branches'),
        apiFetch<{ items: CounterRecord[] }>('/api/admin/counters'),
      ]);
      setDevicesList(devRes.items);
      setBranches(branchRes.items);
      setCounters(counterRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch registered devices');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleGenerateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeBranchId || !codeCounterId) {
      setCodeError('Branch and Counter must be selected.');
      return;
    }

    setIsGenerating(true);
    setCodeError(null);

    try {
      const res = await apiFetch<{ id: string; code: string; expiresAt: string }>(
        '/api/admin/registration-codes',
        {
          method: 'POST',
          body: JSON.stringify({
            branchId: codeBranchId,
            counterId: codeCounterId,
            expiresInHours: parseInt(expiresInHours, 10) || 24,
          }),
        }
      );

      setGeneratedCode(res.code);
      setCodeExpiresAt(res.expiresAt);
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : 'Failed to generate code');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRevokeToggle = async (device: DeviceRecord) => {
    try {
      await apiFetch(`/api/admin/devices/${device.id}/revoke`, {
        method: 'PATCH',
        body: JSON.stringify({
          isRevoked: !device.isRevoked,
        }),
      });
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to toggle revocation');
    }
  };

  const copyCodeToClipboard = () => {
    if (generatedCode) {
      navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Filter counters based on selected branch in modal
  const modalCounters = counters.filter((c) => c.branchId === codeBranchId);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Registered POS Terminals &amp; Hardware
          </h2>
          <p className="text-xs text-slate-500">
            Hardware terminal authorization, revocation switch, and one-time enrollment codes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              if (branches.length > 0 && branches[0]) {
                setCodeBranchId(branches[0].id);
                const matchingCounters = counters.filter((c) => c.branchId === branches[0]!.id);
                if (matchingCounters.length > 0 && matchingCounters[0]) {
                  setCodeCounterId(matchingCounters[0].id);
                }
              }
              setGeneratedCode(null);
              setIsCodeModalOpen(true);
            }}
            size="sm"
            className="gap-2 text-xs font-semibold shadow-md shadow-blue-600/20"
            disabled={counters.length === 0}
          >
            <Key className="w-3.5 h-3.5" />
            Generate Registration Code
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

      {/* Devices Table */}
      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-0">
          {devicesList.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Terminal Name</TableHead>
                  <TableHead className="text-xs">Branch &amp; Counter</TableHead>
                  <TableHead className="text-xs">Access State</TableHead>
                  <TableHead className="text-xs">Last Sync Contact</TableHead>
                  <TableHead className="text-xs">Registered On</TableHead>
                  <TableHead className="text-xs text-right">Revocation Switch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devicesList.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <MonitorSmartphone className="w-4 h-4 text-slate-400" />
                        <span>{d.deviceName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-semibold text-slate-800">{d.branchName || 'Unassigned'}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {d.counterName ? `${d.counterName} (${d.counterCode || 'C1'})` : '—'}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {d.isRevoked ? (
                        <Badge variant="destructive" className="gap-1 text-[10px] uppercase font-bold">
                          <ShieldAlert className="w-3 h-3" />
                          Revoked
                        </Badge>
                      ) : (
                        <Badge variant="success" className="gap-1 text-[10px] uppercase font-bold">
                          <ShieldCheck className="w-3 h-3" />
                          Authorized
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-slate-600">
                      {d.lastSeenAt ? formatKarachiDateTime(d.lastSeenAt) : 'Never synced'}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-slate-500">
                      {formatKarachiDateTime(d.createdAt)}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <Button
                        onClick={() => handleRevokeToggle(d)}
                        variant={d.isRevoked ? 'default' : 'outline'}
                        size="sm"
                        className="text-[11px] h-7 px-2.5 font-semibold"
                      >
                        {d.isRevoked ? 'Restore Access' : 'Revoke Device'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-xs text-slate-400">
              {isLoading ? 'Loading devices...' : 'No hardware terminals registered yet. Use the registration code generator to enroll a desktop device.'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generate Code Modal */}
      <Modal
        open={isCodeModalOpen}
        onClose={() => setIsCodeModalOpen(false)}
        title="Generate Terminal Registration Code"
        description="Generates a cryptographically hashed, one-time enrollment code for the desktop POS application."
      >
        {!generatedCode ? (
          <form onSubmit={handleGenerateCode} className="space-y-4 pt-2">
            {codeError && (
              <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
                {codeError}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Target Branch</label>
              <select
                value={codeBranchId}
                onChange={(e) => {
                  setCodeBranchId(e.target.value);
                  const related = counters.filter((c) => c.branchId === e.target.value);
                  if (related.length > 0 && related[0]) setCodeCounterId(related[0].id);
                }}
                className="w-full h-9 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isGenerating}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Counter Register</label>
              <select
                value={codeCounterId}
                onChange={(e) => setCodeCounterId(e.target.value)}
                className="w-full h-9 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isGenerating}
              >
                {modalCounters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code || 'C1'})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Expires In (Hours)</label>
              <Input
                type="number"
                min="1"
                max="168"
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(e.target.value)}
                disabled={isGenerating}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCodeModalOpen(false)}
                disabled={isGenerating}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isGenerating}>
                {isGenerating ? 'Generating...' : 'Generate Plain Code'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-5 pt-2 text-center">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
              <p className="text-xs font-semibold text-blue-900">
                Single-Use Enrollment Code
              </p>
              <div className="flex items-center justify-center gap-3">
                <span className="font-mono text-2xl font-black tracking-widest text-blue-700">
                  {generatedCode}
                </span>
                <button
                  onClick={copyCodeToClipboard}
                  className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                  title="Copy Code"
                >
                  {copied ? (
                    <Check className="w-5 h-5 text-emerald-600" />
                  ) : (
                    <Copy className="w-5 h-5" />
                  )}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Expires: {formatKarachiDateTime(codeExpiresAt)}
              </p>
            </div>

            <p className="text-xs text-slate-500">
              Enter this code in the desktop app during first-time terminal setup.
              The server strictly stores only a SHA-256 hash.
            </p>

            <Button
              onClick={() => {
                setGeneratedCode(null);
                setIsCodeModalOpen(false);
              }}
              size="sm"
              className="w-full"
            >
              Done &amp; Close
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
};
