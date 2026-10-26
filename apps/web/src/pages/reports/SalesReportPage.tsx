import React, { useState, useEffect, useCallback } from 'react';
import type { SalesReport, BranchRecord } from '../../types';
import { apiFetch } from '../../lib/api';
import { formatPaisa, formatKarachiDateOnly } from '../../lib/formatters';
import {
  StatCard,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Input,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@pos/ui';
import {
  DollarSign,
  Receipt,
  Filter,
  RefreshCw,
  Calendar,
  Building,
  UserCheck,
} from 'lucide-react';

export const SalesReportPage: React.FC = () => {
  const [data, setData] = useState<SalesReport | null>(null);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');

  const fetchBranches = async () => {
    try {
      const res = await apiFetch<{ items: BranchRecord[] }>('/api/admin/branches');
      setBranches(res.items);
    } catch {
      // Ignored if user is not owner
    }
  };

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams();
      if (startDate) queryParams.set('startDate', startDate);
      if (endDate) queryParams.set('endDate', endDate);
      if (selectedBranchId) queryParams.set('branchId', selectedBranchId);

      const qs = queryParams.toString() ? `?${queryParams.toString()}` : '';
      const res = await apiFetch<SalesReport>(`/api/reports/sales${qs}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sales report');
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, selectedBranchId]);

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const resetFilters = () => {
    setStartDate('');
    setEndDate('');
    setSelectedBranchId('');
  };

  return (
    <div className="space-y-6">
      {/* Title & Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Sales &amp; Revenue Reports
          </h2>
          <p className="text-xs text-slate-500">
            Multi-dimensional turnover analysis aggregated across days, branches, and cashiers
          </p>
        </div>
        <div className="flex items-center gap-2">
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
      </div>

      {/* Filter Controls Card */}
      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Filter className="w-4 h-4 text-slate-400" />
            <span>Filters:</span>
          </div>

          {/* Start Date */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">From:</span>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-36 text-xs h-8"
            />
          </div>

          {/* End Date */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">To:</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-36 text-xs h-8"
            />
          </div>

          {/* Branch Dropdown */}
          {branches.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Branch:</span>
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
            </div>
          )}

          {(startDate || endDate || selectedBranchId) && (
            <Button
              onClick={resetFilters}
              variant="ghost"
              size="sm"
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              Clear Filters
            </Button>
          )}
        </CardContent>
      </Card>

      {/* High-Level Financial Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Invoices"
          value={String(data?.totals.invoiceCount || 0)}
          subtitle="Invoices matching filter"
          icon={<Receipt className="w-4 h-4 text-blue-600" />}
        />
        <StatCard
          title="Subtotal"
          value={formatPaisa(data?.totals.subtotalPaisa || 0)}
          subtitle="Gross product sales"
          icon={<DollarSign className="w-4 h-4 text-slate-600" />}
        />
        <StatCard
          title="Tax Collected"
          value={formatPaisa(data?.totals.taxPaisa || 0)}
          subtitle="Calculated tax liability"
          icon={<DollarSign className="w-4 h-4 text-amber-600" />}
        />
        <StatCard
          title="Net Total Revenue"
          value={formatPaisa(data?.totals.totalPaisa || 0)}
          subtitle="Final total (Subtotal + Tax - Discount)"
          icon={<DollarSign className="w-4 h-4 text-emerald-600" />}
        />
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Detailed Breakdown Tabs */}
      <Tabs defaultValue="day" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="day" className="gap-2">
            <Calendar className="w-3.5 h-3.5" />
            By Day
          </TabsTrigger>
          <TabsTrigger value="branch" className="gap-2">
            <Building className="w-3.5 h-3.5" />
            By Branch
          </TabsTrigger>
          <TabsTrigger value="cashier" className="gap-2">
            <UserCheck className="w-3.5 h-3.5" />
            By Cashier
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: By Day */}
        <TabsContent value="day">
          <Card className="shadow-sm border-slate-200">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold text-slate-900">
                Daily Sales Aggregations
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data?.byDay && data.byDay.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs text-right">Invoices</TableHead>
                      <TableHead className="text-xs text-right">Total Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byDay.map((d) => (
                      <TableRow key={d.date}>
                        <TableCell className="text-xs font-semibold text-slate-800">
                          {formatKarachiDateOnly(d.date)}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono">
                          {d.invoiceCount}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono font-bold text-slate-900">
                          {formatPaisa(d.totalPaisa)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-8 text-center text-xs text-slate-400">
                  No sales found matching the current parameters.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: By Branch */}
        <TabsContent value="branch">
          <Card className="shadow-sm border-slate-200">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold text-slate-900">
                Branch-wise Sales Distribution
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data?.byBranch && data.byBranch.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Branch Name</TableHead>
                      <TableHead className="text-xs text-right">Invoices</TableHead>
                      <TableHead className="text-xs text-right">Total Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byBranch.map((b) => (
                      <TableRow key={b.branchId}>
                        <TableCell className="text-xs font-semibold text-slate-800">
                          {b.branchName}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono">
                          {b.invoiceCount}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono font-bold text-slate-900">
                          {formatPaisa(b.totalPaisa)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-8 text-center text-xs text-slate-400">
                  No branch sales recorded yet.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: By Cashier */}
        <TabsContent value="cashier">
          <Card className="shadow-sm border-slate-200">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold text-slate-900">
                Cashier Performance &amp; Register Reconciliation
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data?.byCashier && data.byCashier.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Cashier Name</TableHead>
                      <TableHead className="text-xs text-right">Invoices Finalized</TableHead>
                      <TableHead className="text-xs text-right">Collected Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byCashier.map((c) => (
                      <TableRow key={c.cashierUserId}>
                        <TableCell className="text-xs font-semibold text-slate-800">
                          {c.cashierName}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono">
                          {c.invoiceCount}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono font-bold text-slate-900">
                          {formatPaisa(c.totalPaisa)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-8 text-center text-xs text-slate-400">
                  No cashier transaction activity recorded.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
