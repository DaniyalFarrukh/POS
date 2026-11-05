import React, { useState, useEffect, useCallback } from 'react';
import type { StockLocationRecord, BranchRecord } from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
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
  Warehouse,
  Plus,
  RefreshCw,
  Edit2,
  CheckCircle2,
  XCircle,
  Building2,
  AlertCircle,
} from 'lucide-react';

export const StockLocationsPage: React.FC = () => {
  const { can } = useAuth();
  const canManage = can('inventory.warehouse.manage');

  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [locations, setLocations] = useState<StockLocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add / Edit Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<StockLocationRecord | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load branches
  const loadBranches = useCallback(async () => {
    try {
      const res = await apiFetch<{ data?: BranchRecord[]; items?: BranchRecord[] }>(
        '/api/branches'
      );
      const list = res.data || res.items || [];
      setBranches(list);
      if (list.length > 0 && !selectedBranchId && list[0]) {
        setSelectedBranchId(list[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load branches';
      setError(msg);
    }
  }, [selectedBranchId]);

  // Load locations for selected branch
  const loadLocations = useCallback(async (branchId: string) => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ items: StockLocationRecord[] }>(
        `/api/stock-locations?branchId=${branchId}`
      );
      setLocations(res.items || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load stock locations';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    if (selectedBranchId) {
      loadLocations(selectedBranchId);
    }
  }, [selectedBranchId, loadLocations]);

  const openAddModal = () => {
    setEditingLocation(null);
    setName('');
    setCode('');
    setIsDefault(false);
    setModalError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (loc: StockLocationRecord) => {
    setEditingLocation(loc);
    setName(loc.name);
    setCode(loc.code || '');
    setIsDefault(loc.isDefault);
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setModalError('Location name is required');
      return;
    }

    setSubmitting(true);
    setModalError(null);

    try {
      if (editingLocation) {
        await apiFetch(`/api/stock-locations/${editingLocation.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: name.trim(),
            code: code.trim() || undefined,
            isDefault,
          }),
        });
      } else {
        await apiFetch('/api/stock-locations', {
          method: 'POST',
          body: JSON.stringify({
            branchId: selectedBranchId,
            name: name.trim(),
            code: code.trim() || undefined,
            isDefault,
          }),
        });
      }

      setIsModalOpen(false);
      await loadLocations(selectedBranchId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save stock location';
      setModalError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (loc: StockLocationRecord) => {
    if (!canManage) return;
    try {
      await apiFetch(`/api/stock-locations/${loc.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          isActive: !loc.isActive,
        }),
      });
      await loadLocations(selectedBranchId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update location status';
      alert(msg);
    }
  };

  const activeCount = locations.filter((l) => l.isActive).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Warehouse className="w-7 h-7 text-blue-600" />
            <h1 className="text-2xl font-bold text-slate-900">Warehouses & Locations</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Manage physical stock rooms, shelves, and storage zones within each pharmacy branch.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadLocations(selectedBranchId)}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {canManage && (
            <Button size="sm" onClick={openAddModal} disabled={!selectedBranchId}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add Location
            </Button>
          )}
        </div>
      </div>

      {/* Branch Selector Card */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">Select Branch:</span>
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="text-xs text-slate-500 flex items-center gap-3">
            <span>
              Total Locations: <strong className="text-slate-800">{locations.length}</strong>
            </span>
            <span>
              Active: <strong className="text-emerald-700">{activeCount}</strong>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Error Alert */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-rose-700 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Locations Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Default Shelf</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 6 : 5}
                    className="text-center py-8 text-slate-500"
                  >
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                    Loading locations...
                  </TableCell>
                </TableRow>
              ) : locations.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 6 : 5}
                    className="text-center py-8 text-slate-500"
                  >
                    No storage locations defined for this branch. Click &quot;Add Location&quot; to
                    configure.
                  </TableCell>
                </TableRow>
              ) : (
                locations.map((loc) => (
                  <TableRow key={loc.id}>
                    <TableCell className="font-semibold text-slate-900">{loc.name}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {loc.code || '—'}
                    </TableCell>
                    <TableCell>
                      {loc.isDefault ? (
                        <Badge className="bg-blue-100 text-blue-800 border-blue-200">
                          Primary Default
                        </Badge>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {loc.isActive ? (
                        <span className="inline-flex items-center text-xs font-medium text-emerald-700 gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-xs font-medium text-slate-500 gap-1">
                          <XCircle className="w-3.5 h-3.5 text-slate-400" /> Inactive
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {new Date(loc.createdAt).toLocaleDateString()}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditModal(loc)}
                          title="Edit location"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant={loc.isActive ? 'outline' : 'secondary'}
                          size="sm"
                          onClick={() => handleToggleActive(loc)}
                          title={loc.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {loc.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add / Edit Modal */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingLocation ? 'Edit Stock Location' : 'New Stock Location'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {modalError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs">
              {modalError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Location / Shelf Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Shelf, Cold Storage, Backroom Bay 4"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Location Code (Optional)
            </label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. MS-01, CS-A"
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="isDefaultLoc"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
            />
            <label htmlFor="isDefaultLoc" className="text-sm font-medium text-slate-700">
              Set as branch primary default location for incoming receipts
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsModalOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : editingLocation ? 'Update Location' : 'Create Location'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
