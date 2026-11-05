import React, { useState, useEffect } from 'react';
import type { SupplierRecord } from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatPaisa } from '../../lib/formatters';
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
  Building2,
  Plus,
  RefreshCw,
  Search,
  Eye,
  Edit2,
  AlertTriangle,
  Scale,
  Clock,
  GitMerge,
  Ban,
  ShieldCheck,
} from 'lucide-react';
import {
  canManageSuppliers,
  validateSupplierForm,
  type SupplierFormData,
} from '../../lib/supplier-utils';
import { SupplierDetailPage } from './SupplierDetailPage';

export const SuppliersPage: React.FC = () => {
  const { user } = useAuth();
  const canManage = user ? canManageSuppliers(user.role) : false;

  const [suppliersList, setSuppliersList] = useState<SupplierRecord[]>([]);
  const [kpis, setKpis] = useState<{
    totalPayablePaisa: number;
    overduePayablePaisa: number;
    activeSuppliersCount: number;
  }>({
    totalPayablePaisa: 0,
    overduePayablePaisa: 0,
    activeSuppliersCount: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'true' | 'false'>('all');

  // Detail view state
  const [activeSupplierId, setActiveSupplierId] = useState<string | null>(null);

  // Drawer / Modal for Create/Edit
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierRecord | null>(null);
  const [formData, setFormData] = useState<SupplierFormData>({
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    taxNumber: '',
    paymentTermsDays: 30,
    creditLimitPKR: '',
    openingBalancePKR: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Duplicate Review Modal
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<
    Array<{
      reason: string;
      candidateIds: string[];
      candidates: SupplierRecord[];
    }>
  >([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [mergeSubmitting, setMergeSubmitting] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const fetchSuppliers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (statusFilter !== 'all') params.set('isActive', statusFilter);

      const res = await apiFetch<{
        kpis: {
          totalPayablePaisa: number;
          overduePayablePaisa: number;
          activeSuppliersCount: number;
        };
        items: SupplierRecord[];
      }>(`/api/suppliers?${params.toString()}`);

      setSuppliersList(res.items);
      setKpis(res.kpis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load suppliers');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDuplicates = async () => {
    try {
      const res = await apiFetch<{
        groups: Array<{
          reason: string;
          candidateIds: string[];
          candidates: SupplierRecord[];
        }>;
      }>('/api/suppliers/duplicates');
      setDuplicateGroups(res.groups || []);
    } catch {
      // Ignored for non-blocking duplicate count
    }
  };

  useEffect(() => {
    fetchSuppliers();
    if (canManage) {
      fetchDuplicates();
    }
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchSuppliers();
  };

  const handleOpenCreate = () => {
    setEditingSupplier(null);
    setFormData({
      name: '',
      contactPerson: '',
      phone: '',
      email: '',
      address: '',
      taxNumber: '',
      paymentTermsDays: 30,
      creditLimitPKR: '',
      openingBalancePKR: '',
    });
    setFormErrors({});
    setIsFormModalOpen(true);
  };

  const handleOpenEdit = (s: SupplierRecord) => {
    setEditingSupplier(s);
    setFormData({
      name: s.name,
      contactPerson: s.contactPerson || '',
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      taxNumber: s.taxNumber || '',
      paymentTermsDays: s.paymentTermsDays,
      creditLimitPKR: s.creditLimitPaisa > 0 ? (s.creditLimitPaisa / 100).toFixed(2) : '',
      openingBalancePKR: (s.openingBalancePaisa / 100).toFixed(2),
    });
    setFormErrors({});
    setIsFormModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateSupplierForm(formData);
    if (!validation.isValid) {
      setFormErrors(validation.errors);
      return;
    }

    setIsSubmitting(true);
    setFormErrors({});
    try {
      if (editingSupplier) {
        await apiFetch(`/api/suppliers/${editingSupplier.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: formData.name.trim(),
            contactPerson: formData.contactPerson?.trim() || null,
            phone: formData.phone?.trim() || null,
            email: formData.email?.trim() || null,
            address: formData.address?.trim() || null,
            taxNumber: formData.taxNumber?.trim() || null,
            paymentTermsDays: formData.paymentTermsDays,
            creditLimitPaisa: validation.creditLimitPaisa,
          }),
        });
      } else {
        await apiFetch('/api/suppliers', {
          method: 'POST',
          body: JSON.stringify({
            name: formData.name.trim(),
            contactPerson: formData.contactPerson?.trim() || null,
            phone: formData.phone?.trim() || null,
            email: formData.email?.trim() || null,
            address: formData.address?.trim() || null,
            taxNumber: formData.taxNumber?.trim() || null,
            paymentTermsDays: formData.paymentTermsDays,
            creditLimitPaisa: validation.creditLimitPaisa,
            openingBalancePaisa: validation.openingBalancePaisa,
          }),
        });
      }

      setIsFormModalOpen(false);
      await fetchSuppliers();
      if (canManage) fetchDuplicates();
    } catch (err) {
      setFormErrors({ form: err instanceof Error ? err.message : 'Failed to save supplier' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (s: SupplierRecord) => {
    try {
      await apiFetch(`/api/suppliers/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !s.isActive }),
      });
      await fetchSuppliers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update supplier status');
    }
  };

  const handleOpenDuplicateReview = () => {
    if (duplicateGroups.length > 0) {
      const firstGroup = duplicateGroups[0]!;
      setSelectedTargetId(firstGroup.candidateIds[0] || '');
      setSelectedSourceId(firstGroup.candidateIds[1] || '');
    }
    setMergeError(null);
    setIsDuplicateModalOpen(true);
  };

  const handleConfirmMerge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTargetId || !selectedSourceId || selectedTargetId === selectedSourceId) {
      setMergeError('Please choose two distinct suppliers (Primary and Duplicate to merge).');
      return;
    }

    setMergeSubmitting(true);
    setMergeError(null);
    try {
      await apiFetch('/api/suppliers/merge', {
        method: 'POST',
        body: JSON.stringify({
          targetSupplierId: selectedTargetId,
          sourceSupplierId: selectedSourceId,
        }),
      });
      setIsDuplicateModalOpen(false);
      await fetchSuppliers();
      await fetchDuplicates();
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setMergeSubmitting(false);
    }
  };

  // If a supplier detail page is active, show the detail view
  if (activeSupplierId) {
    return (
      <SupplierDetailPage
        supplierId={activeSupplierId}
        onBack={() => {
          setActiveSupplierId(null);
          fetchSuppliers();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Building2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            Distributors & Suppliers
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Supplier directory, payment terms, Accounts Payable balances, and purchase ledgers
          </p>
        </div>

        <div className="flex items-center gap-2">
          {duplicateGroups.length > 0 && canManage && (
            <Button
              variant="outline"
              onClick={handleOpenDuplicateReview}
              className="flex items-center gap-1.5 text-amber-600 border-amber-300 dark:border-amber-800 hover:bg-amber-50"
            >
              <GitMerge className="w-4 h-4" />
              Review Duplicates ({duplicateGroups.length})
            </Button>
          )}

          {canManage && (
            <Button onClick={handleOpenCreate} className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              New Supplier
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg flex items-center gap-3 text-sm font-medium">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-blue-600">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Total Payable (AP)
              </span>
              <Scale className="w-4 h-4 text-blue-600" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold font-mono tracking-tight text-slate-900 dark:text-white">
                {formatPaisa(kpis.totalPayablePaisa)}
              </span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Total outstanding balance to distributors
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Overdue Payable
              </span>
              <Clock className="w-4 h-4 text-amber-500" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold font-mono tracking-tight text-slate-900 dark:text-white">
                {formatPaisa(kpis.overduePayablePaisa)}
              </span>
              <p className="text-[11px] text-slate-400 mt-0.5">Past supplier credit terms</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-600">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Active Suppliers
              </span>
              <Building2 className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold font-mono tracking-tight text-slate-900 dark:text-white">
                {kpis.activeSuppliersCount}
              </span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {suppliersList.length} total registered distributors
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-4">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col sm:flex-row items-center gap-3"
          >
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search distributors by name, contact person, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs"
              />
            </div>

            <div className="w-full sm:w-48">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'true' | 'false')}
                className="w-full px-3 py-2 text-xs border rounded-md bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Statuses</option>
                <option value="true">Active Only</option>
                <option value="false">Inactive Only</option>
              </select>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button type="submit" size="sm" className="flex-1 sm:flex-initial text-xs">
                Filter
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                  setTimeout(fetchSuppliers, 0);
                }}
                className="flex-1 sm:flex-initial text-xs"
              >
                Reset
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
              <p className="text-sm">Loading supplier records...</p>
            </div>
          ) : suppliersList.length === 0 ? (
            <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
              <Building2 className="w-10 h-10 text-slate-300 dark:text-slate-700" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                No suppliers found
              </p>
              <p className="text-xs text-slate-400">
                Adjust search criteria or click &quot;New Supplier&quot; to register a distributor.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Distributor Name</TableHead>
                  <TableHead className="w-40">Contact Person</TableHead>
                  <TableHead className="w-36">Phone Number</TableHead>
                  <TableHead className="w-28 text-center">Terms (Days)</TableHead>
                  <TableHead className="w-36 text-right">Payable Balance</TableHead>
                  <TableHead className="w-28 text-center">Status</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliersList.map((s) => (
                  <TableRow
                    key={s.id}
                    className={
                      !s.isActive ? 'opacity-60 bg-slate-50/50 dark:bg-slate-900/30' : undefined
                    }
                  >
                    <TableCell>
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100 block text-xs">
                          {s.name}
                        </span>
                        {s.taxNumber && (
                          <span className="text-[10px] text-slate-400 font-mono block">
                            NTN: {s.taxNumber}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700 dark:text-slate-300">
                      {s.contactPerson || '—'}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-slate-600 dark:text-slate-400">
                      {s.phone || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-center font-mono">
                      {s.paymentTermsDays}d
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatPaisa(s.payableBalancePaisa)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={s.isActive ? 'success' : 'secondary'}>
                        {s.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="View Ledger & Purchases"
                          onClick={() => setActiveSupplierId(s.id)}
                        >
                          <Eye className="w-4 h-4 text-blue-600" />
                        </Button>
                        {canManage && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Edit Supplier"
                              onClick={() => handleOpenEdit(s)}
                            >
                              <Edit2 className="w-4 h-4 text-slate-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title={s.isActive ? 'Deactivate Supplier' : 'Reactivate Supplier'}
                              onClick={() => handleToggleActive(s)}
                              className={s.isActive ? 'text-amber-600' : 'text-emerald-600'}
                            >
                              {s.isActive ? (
                                <Ban className="w-4 h-4" />
                              ) : (
                                <ShieldCheck className="w-4 h-4" />
                              )}
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Supplier Modal */}
      {isFormModalOpen && (
        <Modal
          open={isFormModalOpen}
          onClose={() => setIsFormModalOpen(false)}
          title={
            editingSupplier ? `Edit Supplier: ${editingSupplier.name}` : 'Register New Distributor'
          }
        >
          <form onSubmit={handleFormSubmit} className="space-y-4 max-w-xl">
            {formErrors.form && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-md">
                {formErrors.form}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Distributor / Supplier Name <span className="text-rose-500">*</span>
              </label>
              <Input
                placeholder="e.g. Muller & Phipps Pakistan"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
              {formErrors.name && (
                <p className="text-[11px] text-rose-500 mt-1">{formErrors.name}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Contact Person
                </label>
                <Input
                  placeholder="e.g. Tariq Mehmood"
                  value={formData.contactPerson || ''}
                  onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Phone Number
                </label>
                <Input
                  placeholder="e.g. 0300-1122334"
                  value={formData.phone || ''}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Email Address
                </label>
                <Input
                  type="email"
                  placeholder="e.g. orders@distributor.com"
                  value={formData.email || ''}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
                {formErrors.email && (
                  <p className="text-[11px] text-rose-500 mt-1">{formErrors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  NTN / STRN (Optional)
                </label>
                <Input
                  placeholder="e.g. 1234567-8"
                  value={formData.taxNumber || ''}
                  onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Office / Warehouse Address
              </label>
              <Input
                placeholder="e.g. Plot 12, Korangi Industrial Area, Karachi"
                value={formData.address || ''}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Payment Terms (Days)
                </label>
                <Input
                  type="number"
                  min="0"
                  value={formData.paymentTermsDays}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      paymentTermsDays: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  required
                />
                {formErrors.paymentTermsDays && (
                  <p className="text-[11px] text-rose-500 mt-1">{formErrors.paymentTermsDays}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Credit Limit (PKR)
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.creditLimitPKR}
                  onChange={(e) => setFormData({ ...formData, creditLimitPKR: e.target.value })}
                />
                {formErrors.creditLimitPKR && (
                  <p className="text-[11px] text-rose-500 mt-1">{formErrors.creditLimitPKR}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Opening Balance (PKR)
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={Boolean(editingSupplier)}
                  placeholder="0.00"
                  value={formData.openingBalancePKR}
                  onChange={(e) => setFormData({ ...formData, openingBalancePKR: e.target.value })}
                />
                {formErrors.openingBalancePKR && (
                  <p className="text-[11px] text-rose-500 mt-1">{formErrors.openingBalancePKR}</p>
                )}
                {editingSupplier && (
                  <p className="text-[10px] text-slate-400 mt-0.5">Immutable after creation</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-800">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsFormModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="flex items-center gap-1.5">
                {isSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                {editingSupplier ? 'Save Changes' : 'Create Supplier'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Duplicate Review & Merge Modal */}
      {isDuplicateModalOpen && duplicateGroups.length > 0 && (
        <Modal
          open={isDuplicateModalOpen}
          onClose={() => setIsDuplicateModalOpen(false)}
          title="Review & Merge Duplicate Suppliers"
        >
          <form onSubmit={handleConfirmMerge} className="space-y-4 max-w-2xl">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 text-xs rounded-md">
              <p className="font-semibold mb-1">Safe Single Source of Truth Merge</p>
              <p>
                Identified distributors with identical names or phone numbers created independently.
                Merging will reclassify the secondary supplier&apos;s payable balance to the primary
                supplier via an immutable accounting reclassification entry, and deactivate the
                secondary record.
              </p>
            </div>

            {mergeError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-md">
                {mergeError}
              </div>
            )}

            <div className="space-y-3">
              {duplicateGroups.map((group, gIdx) => (
                <div
                  key={gIdx}
                  className="p-3 border rounded-lg border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <span>Candidate Pair #{gIdx + 1}</span>
                    <Badge variant="warning">{group.reason}</Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {group.candidates.map((c) => (
                      <div
                        key={c.id}
                        className="p-2.5 bg-white dark:bg-slate-900 border rounded-md border-slate-200 dark:border-slate-700"
                      >
                        <span className="font-bold block text-slate-900 dark:text-slate-100">
                          {c.name}
                        </span>
                        <span className="text-[11px] text-slate-500 block">
                          Phone: {c.phone || '—'}
                        </span>
                        <span className="text-[11px] text-slate-500 block">
                          Payable Balance: {formatPaisa(c.payableBalancePaisa || 0)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-3 text-xs">
                    <div className="flex-1">
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Primary Supplier (Keep Active):
                      </label>
                      <select
                        value={selectedTargetId}
                        onChange={(e) => setSelectedTargetId(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs border rounded bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
                      >
                        {group.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({formatPaisa(c.payableBalancePaisa || 0)})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex-1">
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Duplicate Supplier (Merge & Deactivate):
                      </label>
                      <select
                        value={selectedSourceId}
                        onChange={(e) => setSelectedSourceId(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs border rounded bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
                      >
                        {group.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({formatPaisa(c.payableBalancePaisa || 0)})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDuplicateModalOpen(false)}
                disabled={mergeSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mergeSubmitting || selectedTargetId === selectedSourceId}
                className="flex items-center gap-1.5"
              >
                {mergeSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Confirm Unified Merge
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
