import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../lib/api';
import { formatKarachiDateTime } from '../../lib/formatters';
import { getKarachiBusinessDate } from '@pos/shared';
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
  Input,
} from '@pos/ui';
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Filter,
  Eye,
  X,
  Search,
  ShieldCheck,
  FileSpreadsheet,
} from 'lucide-react';

interface AuditLogItem {
  id?: string;
  seq: number;
  entity: string;
  op: string;
  action?: string;
  userId?: string | null;
  userName?: string;
  userRole?: string;
  summary?: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  data?: Record<string, unknown>;
  ipAddress?: string | null;
  createdAt: string;
}

export const AuditLogPage: React.FC = () => {
  const [data, setData] = useState<{
    items: AuditLogItem[];
    total: number;
    page: number;
    totalPages: number;
  } | null>(null);
  const [page, setPage] = useState<number>(1);
  const [entityFilter, setEntityFilter] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Selected item for Before/After Diff Inspector
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: '50',
      });
      if (entityFilter) queryParams.set('entity', entityFilter);
      if (actionFilter) queryParams.set('action', actionFilter);
      if (searchQuery.trim()) queryParams.set('search', searchQuery.trim());
      if (startDate) queryParams.set('startDate', startDate);
      if (endDate) queryParams.set('endDate', endDate);

      const res = await apiFetch<{
        items: AuditLogItem[];
        total: number;
        page: number;
        totalPages: number;
      }>(`/api/admin/audit-logs?${queryParams.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch audit logs');
    } finally {
      setIsLoading(false);
    }
  }, [page, entityFilter, actionFilter, searchQuery, startDate, endDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Export Audit Logs to CSV
  const handleExportCsv = () => {
    if (!data?.items || data.items.length === 0) return;

    const headers = [
      'Seq',
      'Timestamp (Asia/Karachi)',
      'User',
      'Role',
      'Action',
      'Entity',
      'Summary',
      'IP Address',
    ];

    const escapeCsv = (val: unknown) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = data.items.map((log) => [
      escapeCsv(log.seq),
      escapeCsv(formatKarachiDateTime(log.createdAt)),
      escapeCsv(log.userName || 'System'),
      escapeCsv(log.userRole || 'system'),
      escapeCsv(log.action || log.op),
      escapeCsv(log.entity),
      escapeCsv(log.summary || `${log.op} ${log.entity}`),
      escapeCsv(log.ipAddress || '—'),
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Audit_Log_${getKarachiBusinessDate()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              Enterprise Audit &amp; Compliance Log
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Cryptographic chronological record of all user actions, sensitive configuration changes,
            and state transitions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleExportCsv}
            variant="outline"
            size="sm"
            className="gap-2 text-xs"
            disabled={!data?.items || data.items.length === 0}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            Export CSV
          </Button>
          <Button
            onClick={fetchLogs}
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

      {/* Filter Bar */}
      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Filter className="w-4 h-4 text-slate-400" />
              <span>Filters:</span>
            </div>

            {/* Keyword Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search action or summary..."
                className="h-8 rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
              />
            </div>

            {/* Entity Filter */}
            <select
              value={entityFilter}
              onChange={(e) => {
                setEntityFilter(e.target.value);
                setPage(1);
              }}
              className="h-8 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Entities</option>
              <option value="user">Users</option>
              <option value="branch">Branches</option>
              <option value="counter">Counters</option>
              <option value="product">Products</option>
              <option value="batch">Batches</option>
              <option value="stock_movement">Stock Movements</option>
              <option value="invoice">Invoices</option>
              <option value="fiscal_period">Fiscal Periods</option>
              <option value="journal_entry">Journal Entries</option>
              <option value="payroll">Payroll Runs</option>
              <option value="prescription">Prescriptions</option>
              <option value="supplier">Suppliers</option>
            </select>

            {/* Action Filter */}
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="h-8 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Operations</option>
              <option value="upsert">Upsert</option>
              <option value="delete">Delete</option>
              <option value="fiscal_period.close">Period Close</option>
              <option value="fiscal_period.reopen">Period Reopen</option>
              <option value="payroll.approve">Payroll Approval</option>
              <option value="journal.reverse">Journal Reversal</option>
            </select>

            {/* Date Range: From */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <span>From:</span>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
                className="w-32 h-8 text-xs"
              />
            </div>

            {/* Date Range: To */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <span>To:</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
                className="w-32 h-8 text-xs"
              />
            </div>

            {(entityFilter || actionFilter || searchQuery || startDate || endDate) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEntityFilter('');
                  setActionFilter('');
                  setSearchQuery('');
                  setStartDate('');
                  setEndDate('');
                  setPage(1);
                }}
                className="text-xs text-slate-500 hover:text-slate-900 h-8 px-2"
              >
                Reset
              </Button>
            )}
          </div>

          <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-100 flex items-center justify-between">
            <span>
              Showing <span className="font-bold text-slate-800">{data?.items?.length || 0}</span>{' '}
              logs on page {data?.page || 1}
            </span>
            <span>
              Total records: <span className="font-bold text-slate-800">{data?.total || 0}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Audit Log Table */}
      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-0">
          {data?.items && data.items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-16">Seq</TableHead>
                  <TableHead className="text-xs">Timestamp (Karachi)</TableHead>
                  <TableHead className="text-xs">User / Actor</TableHead>
                  <TableHead className="text-xs">Action &amp; Entity</TableHead>
                  <TableHead className="text-xs">Summary</TableHead>
                  <TableHead className="text-xs text-center w-24">Diff / State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((log) => (
                  <TableRow
                    key={log.id || log.seq}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <TableCell className="text-xs font-mono font-bold text-blue-600">
                      #{log.seq}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-slate-600 whitespace-nowrap">
                      {formatKarachiDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-semibold text-slate-800">
                        {log.userName || 'System Engine'}
                      </div>
                      <Badge
                        variant={
                          log.userRole === 'owner'
                            ? 'default'
                            : log.userRole === 'manager'
                              ? 'secondary'
                              : 'outline'
                        }
                        className="text-[9px] py-0 px-1 uppercase font-bold mt-0.5"
                      >
                        {log.userRole || 'system'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge
                          variant={
                            log.action?.includes('delete') || log.op === 'delete'
                              ? 'destructive'
                              : 'secondary'
                          }
                          className="text-[10px] uppercase font-semibold py-0 px-1.5"
                        >
                          {log.action || log.op}
                        </Badge>
                        <span className="text-[11px] font-mono text-slate-500">{log.entity}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700 max-w-xs truncate">
                      {log.summary || (log.data ? JSON.stringify(log.data) : '—')}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedLog(log)}
                        className="h-7 px-2 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 gap-1"
                        title="View Before/After details"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-xs text-slate-400">
              {isLoading ? 'Loading audit records...' : 'No audit records matching parameters.'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination Controls */}
      <div className="flex items-center justify-between pt-2">
        <Button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          variant="outline"
          size="sm"
          disabled={page <= 1 || isLoading}
          className="gap-1 text-xs"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Previous Page
        </Button>

        <span className="text-xs text-slate-500 font-medium">
          Page {data?.page || 1} of {data?.totalPages || 1}
        </span>

        <Button
          onClick={() => setPage((p) => Math.min(data?.totalPages || 1, p + 1))}
          variant="outline"
          size="sm"
          disabled={page >= (data?.totalPages || 1) || isLoading}
          className="gap-1 text-xs"
        >
          Next Page
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Before / After Diff Inspector Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Audit Snapshot #{selectedLog.seq} • {selectedLog.action || selectedLog.op}
                </h3>
                <p className="text-[11px] text-slate-500 font-mono">
                  {formatKarachiDateTime(selectedLog.createdAt)} by{' '}
                  {selectedLog.userName || 'System'}
                </p>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-xs">
              <div>
                <span className="text-slate-500 font-medium">Summary:</span>
                <p className="font-semibold text-slate-800 mt-0.5">
                  {selectedLog.summary || 'Operation recorded in change log'}
                </p>
              </div>

              {selectedLog.ipAddress && (
                <div>
                  <span className="text-slate-500 font-medium">IP Address:</span>{' '}
                  <span className="font-mono text-slate-700">{selectedLog.ipAddress}</span>
                </div>
              )}

              {/* Side-by-Side Before vs After States */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div className="border border-slate-200 rounded-lg p-3 bg-red-50/20">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold text-slate-700 uppercase">
                      Before State
                    </span>
                    <Badge variant="outline" className="text-[9px] py-0">
                      Prior
                    </Badge>
                  </div>
                  <pre className="text-[11px] font-mono bg-white p-2.5 rounded border border-slate-200 text-slate-700 overflow-x-auto max-h-60">
                    {selectedLog.beforeState
                      ? JSON.stringify(selectedLog.beforeState, null, 2)
                      : 'null (Created or Initial State)'}
                  </pre>
                </div>

                <div className="border border-slate-200 rounded-lg p-3 bg-emerald-50/20">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold text-slate-700 uppercase">
                      After State
                    </span>
                    <Badge variant="secondary" className="text-[9px] py-0 text-emerald-700">
                      Current
                    </Badge>
                  </div>
                  <pre className="text-[11px] font-mono bg-white p-2.5 rounded border border-slate-200 text-slate-700 overflow-x-auto max-h-60">
                    {selectedLog.afterState || selectedLog.data
                      ? JSON.stringify(selectedLog.afterState || selectedLog.data, null, 2)
                      : 'null'}
                  </pre>
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedLog(null)}
                className="text-xs"
              >
                Close Inspector
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
