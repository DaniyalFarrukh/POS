import React, { useState, useEffect } from 'react';
import type { UserRecord } from '../../types';
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
import { UserPlus, RefreshCw, CheckCircle, Ban } from 'lucide-react';

export const UsersPage: React.FC = () => {
  const [usersList, setUsersList] = useState<UserRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'owner' | 'pharmacist' | 'cashier'>('cashier');
  const [newUserPin, setNewUserPin] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchUsers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ items: UserRecord[] }>('/api/admin/users');
      setUsersList(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user roster');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserPin.trim()) {
      setModalError('Name and PIN are required.');
      return;
    }
    if (newUserPin.trim().length < 4) {
      setModalError('PIN must be at least 4 digits.');
      return;
    }

    setIsSubmitting(true);
    setModalError(null);

    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          name: newUserName.trim(),
          role: newUserRole,
          pin: newUserPin.trim(),
        }),
      });

      setIsModalOpen(false);
      setNewUserName('');
      setNewUserPin('');
      setNewUserRole('cashier');
      fetchUsers();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (user: UserRecord) => {
    try {
      await apiFetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          isActive: !user.isActive,
        }),
      });
      fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update user status');
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Staff &amp; Role-Based User Management
          </h2>
          <p className="text-xs text-slate-500">
            Control terminal access, cryptographic PIN hashes, and operational permissions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setIsModalOpen(true)}
            size="sm"
            className="gap-2 text-xs font-semibold shadow-md shadow-blue-600/20"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add Staff Member
          </Button>
          <Button
            onClick={fetchUsers}
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

      {/* Users Table */}
      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-0">
          {usersList.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Staff Name</TableHead>
                  <TableHead className="text-xs">Security Role</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Created At</TableHead>
                  <TableHead className="text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersList.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="text-xs font-bold text-slate-900">
                      {user.name}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge
                        variant={
                          user.role === 'owner'
                            ? 'default'
                            : user.role === 'pharmacist'
                            ? 'secondary'
                            : 'outline'
                        }
                        className="text-[10px] uppercase font-bold"
                      >
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {user.isActive ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold text-[11px]">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-500 font-semibold text-[11px]">
                          <Ban className="w-3.5 h-3.5" />
                          Deactivated
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-slate-500">
                      {formatKarachiDateTime(user.createdAt)}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <Button
                        onClick={() => handleToggleActive(user)}
                        variant="outline"
                        size="sm"
                        className="text-[11px] h-7 px-2"
                      >
                        {user.isActive ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-xs text-slate-400">
              {isLoading ? 'Loading staff roster...' : 'No users found.'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add User Modal */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add New Staff Member"
        description="Create a user with dedicated PIN for POS register and dashboard login."
      >
        <form onSubmit={handleCreateUser} className="space-y-4 pt-2">
          {modalError && (
            <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
              {modalError}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Full Name</label>
            <Input
              type="text"
              placeholder="e.g. Asad (Pharmacist)"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Role</label>
            <select
              value={newUserRole}
              onChange={(e) =>
                setNewUserRole(e.target.value as 'owner' | 'pharmacist' | 'cashier')
              }
              className="w-full h-9 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isSubmitting}
            >
              <option value="cashier">Cashier (Counter POS Only)</option>
              <option value="pharmacist">Pharmacist (Counter POS + Inventory/Sales)</option>
              <option value="owner">Owner (Full Enterprise &amp; Ledger Access)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Numeric Login PIN</label>
            <Input
              type="password"
              placeholder="4-8 digits"
              value={newUserPin}
              onChange={(e) => setNewUserPin(e.target.value)}
              disabled={isSubmitting}
              maxLength={8}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting ? 'Creating User...' : 'Create Staff Member'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
