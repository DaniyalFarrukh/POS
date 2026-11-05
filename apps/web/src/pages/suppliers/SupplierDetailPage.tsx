import React, { useState, useEffect } from 'react';
import type { SupplierRecord, SupplierLedgerEntry, SupplierPurchaseEntry } from '../../types';
import { apiFetch } from '../../lib/api';
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
} from '@pos/ui';
import {
  ArrowLeft,
  RefreshCw,
  Building2,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  FileText,
  Clock,
  AlertTriangle,
  Scale,
  Receipt,
} from 'lucide-react';

interface SupplierDetailPageProps {
  supplierId: string;
  onBack: () => void;
}

export const SupplierDetailPage: React.FC<SupplierDetailPageProps> = ({ supplierId, onBack }) => {
  const [supplier, setSupplier] = useState<SupplierRecord | null>(null);
  const [ledger, setLedger] = useState<SupplierLedgerEntry[]>([]);
  const [purchases, setPurchases] = useState<SupplierPurchaseEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'ledger' | 'purchases'>('ledger');

  const fetchSupplierDetail = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{
        supplier: SupplierRecord;
        ledger: SupplierLedgerEntry[];
        purchases: SupplierPurchaseEntry[];
      }>(`/api/suppliers/${supplierId}`);
      setSupplier(res.supplier);
      setLedger(res.ledger || []);
      setPurchases(res.purchases || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load supplier details');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSupplierDetail();
  }, [supplierId]);

  if (isLoading) {
    return (
      <div className="p-16 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
        <p className="text-sm font-medium">Loading supplier details and ledger...</p>
      </div>
    );
  }

  if (error || !supplier) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={onBack} className="flex items-center gap-1.5">
          <ArrowLeft className="w-4 h-4" />
          Back to Suppliers
        </Button>
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>{error || 'Supplier not found'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Bar with Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                {supplier.name}
              </h1>
              <Badge variant={supplier.isActive ? 'success' : 'secondary'}>
                {supplier.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Contact: {supplier.contactPerson || 'Not specified'} • Terms:{' '}
              {supplier.paymentTermsDays} days
              {supplier.taxNumber ? ` • NTN/STRN: ${supplier.taxNumber}` : ''}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchSupplierDetail}
          className="flex items-center gap-1.5 self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Supplier Profile Info Header Card */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="flex items-start gap-2.5">
              <Phone className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-slate-400 block font-medium">Phone Number</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {supplier.phone || '—'}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Mail className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-slate-400 block font-medium">Email Address</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {supplier.email || '—'}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <CreditCard className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-slate-400 block font-medium">Credit Limit</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono">
                  {supplier.creditLimitPaisa > 0
                    ? formatPaisa(supplier.creditLimitPaisa)
                    : 'No limit'}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <MapPin className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-slate-400 block font-medium">Business Address</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block max-w-xs">
                  {supplier.address || '—'}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-blue-600">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Outstanding Balance
              </span>
              <Scale className="w-4 h-4 text-blue-600" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold font-mono tracking-tight text-slate-900 dark:text-white">
                {formatPaisa(supplier.payableBalancePaisa)}
              </span>
              <p className="text-[11px] text-slate-400 mt-0.5">Current Accounts Payable balance</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Overdue Payable
              </span>
              <Clock className="w-4 h-4 text-amber-500" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold font-mono tracking-tight text-slate-900 dark:text-white">
                {formatPaisa(supplier.overduePayablePaisa || 0)}
              </span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Past {supplier.paymentTermsDays} days payment terms
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-600">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Total Purchases
              </span>
              <Receipt className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold font-mono tracking-tight text-slate-900 dark:text-white">
                {purchases.length}
              </span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {supplier.lastPurchaseDate
                  ? `Last received ${formatKarachiDateOnly(supplier.lastPurchaseDate)}`
                  : 'No purchases recorded'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('ledger')}
          className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'ledger'
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <FileText className="w-4 h-4" />
          Accounts Payable Ledger ({ledger.length})
        </button>
        <button
          onClick={() => setActiveTab('purchases')}
          className={`flex items-center gap-2 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'purchases'
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
          }`}
        >
          <Receipt className="w-4 h-4" />
          Purchase Invoices & GRNs ({purchases.length})
        </button>
      </div>

      {/* Tab 1: Accounts Payable Ledger */}
      {activeTab === 'ledger' && (
        <Card>
          <CardContent className="p-0">
            {ledger.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-sm">
                No accounts payable transactions found for this distributor.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead className="w-24">Entry #</TableHead>
                    <TableHead>Memo / Narration</TableHead>
                    <TableHead className="w-32 text-right">Debit (Payment)</TableHead>
                    <TableHead className="w-32 text-right">Credit (Bill / GRN)</TableHead>
                    <TableHead className="w-36 text-right">Running Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                        {formatKarachiDateOnly(line.entryDate)}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold">
                        #{line.entryNo}
                      </TableCell>
                      <TableCell className="text-xs text-slate-800 dark:text-slate-200">
                        {line.memo || line.lineMemo || 'Journal Line'}
                        {line.sourceType && (
                          <span className="block text-[10px] text-slate-400 uppercase">
                            source: {line.sourceType}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono tabular-nums text-emerald-600">
                        {line.debitPaisa > 0 ? formatPaisa(line.debitPaisa) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono tabular-nums text-amber-600">
                        {line.creditPaisa > 0 ? formatPaisa(line.creditPaisa) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                        {formatPaisa(line.runningBalancePaisa)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab 2: Purchase Invoices */}
      {activeTab === 'purchases' && (
        <Card>
          <CardContent className="p-0">
            {purchases.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-sm">
                No purchase receipts found for this distributor.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Date</TableHead>
                    <TableHead className="w-28">Journal #</TableHead>
                    <TableHead>GRN / Document Memo</TableHead>
                    <TableHead className="w-48">Posted At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                        {formatKarachiDateOnly(p.entryDate)}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold">
                        #{p.entryNo}
                      </TableCell>
                      <TableCell className="text-xs font-medium text-slate-800 dark:text-slate-200">
                        {p.memo || 'Purchase Receipt'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 font-mono">
                        {formatKarachiDateTime(p.postedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
