import React, { useState, useEffect, useMemo } from 'react';
import type { StockExpiryReportItem, BranchRecord } from '../../types';
import { apiFetch } from '../../lib/api';
import { formatPaisa, formatKarachiDateOnly } from '../../lib/formatters';
import {
  Card,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Input,
  Button,
  Badge,
} from '@pos/ui';
import { RefreshCw, Search, ShieldCheck, AlertTriangle, XCircle } from 'lucide-react';

export const StockExpiryReportPage: React.FC = () => {
  const [items, setItems] = useState<StockExpiryReportItem[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBranches = async () => {
    try {
      const res = await apiFetch<{ items: BranchRecord[] }>('/api/admin/branches');
      setBranches(res.items);
    } catch {
      // Ignored
    }
  };

  const fetchReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const qs = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const res = await apiFetch<{ items: StockExpiryReportItem[] }>(
        `/api/reports/stock-and-expiry${qs}`
      );
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stock & expiry report');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchReport();
  }, [selectedBranchId]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        searchQuery === '' ||
        item.brandName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.batchNo.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === 'all' || item.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [items, searchQuery, statusFilter]);

  const getStatusBadge = (status: 'good' | 'expiring_soon' | 'expired') => {
    switch (status) {
      case 'good':
        return (
          <Badge variant="success" className="text-[10px] gap-1 font-bold">
            <ShieldCheck className="w-3 h-3" />
            Good
          </Badge>
        );
      case 'expiring_soon':
        return (
          <Badge variant="warning" className="text-[10px] gap-1 font-bold">
            <AlertTriangle className="w-3 h-3" />
            Expiring Soon
          </Badge>
        );
      case 'expired':
        return (
          <Badge variant="destructive" className="text-[10px] gap-1 font-bold">
            <XCircle className="w-3 h-3" />
            Expired
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Cross-Branch Stock &amp; Expiry Ledger
          </h2>
          <p className="text-xs text-slate-500">
            Real-time batch tracking and inventory balances summed from immutable ledger events (Rule 4)
          </p>
        </div>
        <Button
          onClick={fetchReport}
          variant="outline"
          size="sm"
          className="gap-2 text-xs"
          disabled={isLoading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Filter / Search Bar */}
      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-[260px]">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                type="text"
                placeholder="Search product or batch number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-8 text-xs"
              />
            </div>

            {branches.length > 0 && (
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Statuses</option>
              <option value="good">Good Condition</option>
              <option value="expiring_soon">Expiring Soon (&lt; 60d)</option>
              <option value="expired">Expired</option>
            </select>
          </div>

          <div className="text-xs text-slate-500 font-medium">
            Showing <span className="font-bold text-slate-800">{filteredItems.length}</span> batch records
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Main Stock Table */}
      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-0">
          {filteredItems.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Product &amp; Branch</TableHead>
                  <TableHead className="text-xs">Batch No</TableHead>
                  <TableHead className="text-xs">Expiry Date</TableHead>
                  <TableHead className="text-xs text-right">Unit Cost</TableHead>
                  <TableHead className="text-xs text-right">MRP</TableHead>
                  <TableHead className="text-xs text-right">Current Stock</TableHead>
                  <TableHead className="text-xs text-right">Condition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <TableRow key={`${item.batchId}-${item.branchId}`}>
                    <TableCell className="text-xs">
                      <div className="font-bold text-slate-900">{item.brandName}</div>
                      <div className="text-[11px] text-slate-500 font-medium">{item.branchName}</div>
                    </TableCell>
                    <TableCell className="text-xs font-mono font-medium text-slate-700">
                      {item.batchNo}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {formatKarachiDateOnly(item.expiryDate)}
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono text-slate-600">
                      {formatPaisa(item.costPaisa)}
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono font-semibold text-slate-800">
                      {formatPaisa(item.mrpPaisa)}
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono font-bold text-slate-900">
                      {item.quantity} units
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {getStatusBadge(item.status)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-xs text-slate-400">
              {isLoading ? 'Loading stock movements...' : 'No inventory records found.'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
