import React, { useState, useEffect, useCallback } from 'react';
import type { AuditLogResponse } from '../../types';
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
} from '@pos/ui';
import { RefreshCw, ChevronLeft, ChevronRight, Filter } from 'lucide-react';

export const AuditLogPage: React.FC = () => {
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [page, setPage] = useState<number>(1);
  const [entityFilter, setEntityFilter] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: '50',
      });
      if (entityFilter) queryParams.set('entity', entityFilter);

      const res = await apiFetch<AuditLogResponse>(
        `/api/admin/audit-logs?${queryParams.toString()}`
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch audit logs');
    } finally {
      setIsLoading(false);
    }
  }, [page, entityFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Cryptographic Audit &amp; Change Log
          </h2>
          <p className="text-xs text-slate-500">
            Read-only chronological trail of change_log records synced across the pharmacy enterprise
          </p>
        </div>
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

      {/* Filter Bar */}
      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Filter className="w-4 h-4 text-slate-400" />
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
            </select>
          </div>

          <div className="text-xs text-slate-500">
            Total Records:{' '}
            <span className="font-bold text-slate-800">{data?.total || 0}</span> | Page{' '}
            <span className="font-bold text-slate-800">{data?.page || 1}</span> of{' '}
            <span className="font-bold text-slate-800">{data?.totalPages || 1}</span>
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
                  <TableHead className="text-xs w-20">Seq #</TableHead>
                  <TableHead className="text-xs">Entity Type</TableHead>
                  <TableHead className="text-xs">Operation</TableHead>
                  <TableHead className="text-xs">Entity ID</TableHead>
                  <TableHead className="text-xs">Payload Digest</TableHead>
                  <TableHead className="text-xs text-right">Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((log) => (
                  <TableRow key={log.seq}>
                    <TableCell className="text-xs font-mono font-bold text-blue-600">
                      #{log.seq}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="text-[10px] uppercase font-bold">
                        {log.entity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge
                        variant={log.op === 'upsert' ? 'secondary' : 'destructive'}
                        className="text-[10px] uppercase font-semibold"
                      >
                        {log.op}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-slate-600 truncate max-w-[140px]">
                      {log.entityId}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-slate-500 truncate max-w-[280px]">
                      {log.data ? JSON.stringify(log.data) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono text-slate-600">
                      {formatKarachiDateTime(log.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-xs text-slate-400">
              {isLoading ? 'Loading change history...' : 'No audit records matching parameters.'}
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
    </div>
  );
};
