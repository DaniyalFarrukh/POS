import React, { useState, useEffect, useCallback } from 'react';
import type { AuthSession, UserRole } from '@pos/shared';
import type { StaffMember, CreateStaffInput, UpdateStaffInput } from '../../../preload/index.d';

interface StaffManagementScreenProps {
  session: AuthSession;
}

export const StaffManagementScreen: React.FC<StaffManagementScreenProps> = ({ session }) => {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);

  // Form states for Add Staff
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('cashier');
  const [newPin, setNewPin] = useState('');
  const [showNewPin, setShowNewPin] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form states for Edit Staff
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('cashier');
  const [editPin, setEditPin] = useState('');
  const [showEditPin, setShowEditPin] = useState(false);
  const [editIsActive, setEditIsActive] = useState(true);

  const loadStaff = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      if (window.api?.auth?.getStaffList) {
        const list = await window.api.auth.getStaffList();
        setStaffList(list);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load staff list');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const handleOpenAdd = () => {
    setNewName('');
    setNewRole('cashier');
    setNewPin('');
    setShowNewPin(false);
    setError(null);
    setSuccessMessage(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (staff: StaffMember) => {
    setEditingStaff(staff);
    setEditName(staff.name);
    setEditRole(staff.role);
    setEditPin('');
    setShowEditPin(false);
    setEditIsActive(staff.isActive);
    setError(null);
    setSuccessMessage(null);
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || newName.trim().length < 2) {
      setError('Staff member name must be at least 2 characters');
      return;
    }
    if (!/^\d{4,8}$/.test(newPin)) {
      setError('Terminal PIN must be between 4 and 8 numeric digits');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const input: CreateStaffInput = {
        name: newName.trim(),
        role: newRole,
        pin: newPin,
      };

      const created = await window.api.auth.createStaffMember(input);
      setSuccessMessage(`Staff member "${created.name}" created with role "${created.role.toUpperCase()}".`);
      setIsAddModalOpen(false);
      await loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create staff member');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff) return;

    if (!editName.trim() || editName.trim().length < 2) {
      setError('Staff member name must be at least 2 characters');
      return;
    }

    if (editPin && !/^\d{4,8}$/.test(editPin)) {
      setError('New PIN must be between 4 and 8 numeric digits (or leave blank to keep current PIN)');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const input: UpdateStaffInput = {
        name: editName.trim(),
        role: editRole,
        isActive: editIsActive,
      };

      if (editPin) {
        input.pin = editPin;
      }

      const updated = await window.api.auth.updateStaffMember(editingStaff.id, input);
      setSuccessMessage(`Updated "${updated.name}" role to "${updated.role.toUpperCase()}".`);
      setEditingStaff(null);
      await loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update staff member');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (staff: StaffMember) => {
    if (session.user.id === staff.id) {
      setError('You cannot deactivate your own active account');
      return;
    }

    try {
      setError(null);
      const newStatus = !staff.isActive;
      await window.api.auth.updateStaffMember(staff.id, { isActive: newStatus });
      setSuccessMessage(
        `Staff member "${staff.name}" has been ${newStatus ? 'activated' : 'deactivated'}.`
      );
      await loadStaff();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle staff status');
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'owner':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              borderRadius: '9999px',
              backgroundColor: '#f5f3ff',
              color: '#6d28d9',
              border: '1px solid #ddd6fe',
              fontSize: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            👑 Owner
          </span>
        );
      case 'pharmacist':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              borderRadius: '9999px',
              backgroundColor: '#eff6ff',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              fontSize: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            💊 Pharmacist
          </span>
        );
      case 'cashier':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              borderRadius: '9999px',
              backgroundColor: '#ecfdf5',
              color: '#047857',
              border: '1px solid #a7f3d0',
              fontSize: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            🏷️ Cashier
          </span>
        );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '40px' }}>
      {/* Top Header Card */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2
              style={{
                margin: 0,
                fontSize: '24px',
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.02em',
              }}
            >
              Staff & Role Permissions
            </h2>
            <span
              style={{
                backgroundColor: '#f1f5f9',
                color: '#475569',
                fontSize: '12px',
                fontWeight: 700,
                padding: '3px 9px',
                borderRadius: '6px',
              }}
            >
              {staffList.length} Accounts
            </span>
          </div>
          <p style={{ margin: '6px 0 0 0', fontSize: '13.5px', color: '#64748b' }}>
            Assign roles (Owner, Pharmacist, Cashier), manage login PINs, and grant counter access.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          className="interactive-btn"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 18px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(37, 99, 235, 0.35)',
          }}
        >
          <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span>
          <span>Add Staff Member</span>
        </button>
      </div>

      {/* Notifications */}
      {error && (
        <div
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: '8px',
            padding: '12px 16px',
            fontSize: '13.5px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            borderRadius: '8px',
            padding: '12px 16px',
            fontSize: '13.5px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>✅</span>
          <span>{successMessage}</span>
        </div>
      )}

      {/* Role Explanations Matrix */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '14px',
        }}
      >
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            padding: '16px',
            borderTop: '3px solid #7c3aed',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '18px' }}>👑</span>
            <span style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>Owner Role</span>
          </div>
          <p style={{ margin: 0, fontSize: '12.5px', color: '#64748b', lineHeight: 1.5 }}>
            Full system control. Can add/edit staff accounts, configure tax & hardware, view total
            financial reports, audit stock logs, and close terminal shifts.
          </p>
        </div>

        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            padding: '16px',
            borderTop: '3px solid #2563eb',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '18px' }}>💊</span>
            <span style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>Pharmacist Role</span>
          </div>
          <p style={{ margin: 0, fontSize: '12.5px', color: '#64748b', lineHeight: 1.5 }}>
            Clinical & stock operations. Can create medicines, receive purchase orders (GRNs),
            adjust batches/expiry dates, and dispense at the POS counter.
          </p>
        </div>

        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            padding: '16px',
            borderTop: '3px solid #059669',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '18px' }}>🏷️</span>
            <span style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>Cashier Role</span>
          </div>
          <p style={{ margin: 0, fontSize: '12.5px', color: '#64748b', lineHeight: 1.5 }}>
            Counter POS operations. High-speed barcode scanning, receipt printing, processing cash/card
            payments, and shift float counting. Restricted from altering prices.
          </p>
        </div>
      </div>

      {/* Staff Table Card */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#f8fafc',
          }}
        >
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#334155' }}>
            Active & Registered Staff
          </span>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            Offline PIN Authentication Active
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
            Loading staff members...
          </div>
        ) : staffList.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
            No staff accounts found.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: 700, color: '#64748b' }}>
                  STAFF MEMBER
                </th>
                <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: 700, color: '#64748b' }}>
                  ASSIGNED ROLE
                </th>
                <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: 700, color: '#64748b' }}>
                  STATUS
                </th>
                <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: 700, color: '#64748b' }}>
                  REGISTERED
                </th>
                <th style={{ padding: '12px 20px', fontSize: '12px', fontWeight: 700, color: '#64748b', textAlign: 'right' }}>
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {staffList.map((staff) => {
                const isCurrentUser = session.user.id === staff.id;
                return (
                  <tr
                    key={staff.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      backgroundColor: isCurrentUser ? '#fafafa' : '#ffffff',
                    }}
                  >
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            backgroundColor: staff.role === 'owner' ? '#f5f3ff' : staff.role === 'pharmacist' ? '#eff6ff' : '#ecfdf5',
                            color: staff.role === 'owner' ? '#7c3aed' : staff.role === 'pharmacist' ? '#2563eb' : '#059669',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 800,
                            fontSize: '14px',
                            border: '1px solid #e2e8f0',
                          }}
                        >
                          {staff.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>
                              {staff.name}
                            </span>
                            {isCurrentUser && (
                              <span
                                style={{
                                  fontSize: '11px',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: '#e2e8f0',
                                  color: '#334155',
                                  fontWeight: 600,
                                }}
                              >
                                You
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
                            ID: {staff.id.slice(0, 8)}...
                          </span>
                        </div>
                      </div>
                    </td>

                    <td style={{ padding: '14px 20px' }}>
                      {getRoleBadge(staff.role)}
                    </td>

                    <td style={{ padding: '14px 20px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '12.5px',
                          fontWeight: 600,
                          color: staff.isActive ? '#166534' : '#64748b',
                        }}
                      >
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: staff.isActive ? '#22c55e' : '#94a3b8',
                          }}
                        />
                        {staff.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    <td style={{ padding: '14px 20px', fontSize: '12.5px', color: '#64748b' }}>
                      {staff.createdAt
                        ? new Date(staff.createdAt).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : '—'}
                    </td>

                    <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(staff)}
                          className="interactive-btn"
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#ffffff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            fontSize: '12.5px',
                            fontWeight: 600,
                            color: '#334155',
                            cursor: 'pointer',
                          }}
                        >
                          Edit Role / PIN
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleActive(staff)}
                          disabled={isCurrentUser}
                          className="interactive-btn"
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#ffffff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            fontSize: '12.5px',
                            fontWeight: 600,
                            color: isCurrentUser
                              ? '#94a3b8'
                              : staff.isActive
                              ? '#dc2626'
                              : '#16a34a',
                            cursor: isCurrentUser ? 'not-allowed' : 'pointer',
                            opacity: isCurrentUser ? 0.6 : 1,
                          }}
                          title={isCurrentUser ? 'Cannot deactivate your own active account' : undefined}
                        >
                          {staff.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal: Add Staff Member */}
      {isAddModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              maxWidth: '520px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                Add New Staff Member
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: '#64748b',
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateStaff} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Tariq Mehmood"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Select Operational Role
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {(['cashier', 'pharmacist', 'owner'] as UserRole[]).map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setNewRole(role)}
                      style={{
                        padding: '10px 8px',
                        borderRadius: '8px',
                        border: newRole === role ? '2px solid #2563eb' : '1px solid #cbd5e1',
                        backgroundColor: newRole === role ? '#eff6ff' : '#ffffff',
                        cursor: 'pointer',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: '16px', marginBottom: '2px' }}>
                        {role === 'owner' ? '👑' : role === 'pharmacist' ? '💊' : '🏷️'}
                      </div>
                      <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a', textTransform: 'capitalize' }}>
                        {role}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                    Offline Login PIN (4 to 8 Digits)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowNewPin(!showNewPin)}
                    style={{ background: 'none', border: 'none', fontSize: '12px', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}
                  >
                    {showNewPin ? 'Hide PIN' : 'Show PIN'}
                  </button>
                </div>
                <input
                  type={showNewPin ? 'text' : 'password'}
                  required
                  placeholder="Enter 4-8 numeric digits"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '15px',
                    letterSpacing: showNewPin ? '0.05em' : '0.25em',
                    boxSizing: 'border-box',
                  }}
                />
                <span style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                  PIN will be securely hashed with bcrypt. Never shared over the network.
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSubmitting ? 'Saving...' : 'Create Staff Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Staff Member / Assign Role */}
      {editingStaff && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              maxWidth: '520px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                Edit Staff Member & Role
              </h3>
              <button
                type="button"
                onClick={() => setEditingStaff(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: '#64748b',
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateStaff} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Assign Role
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {(['cashier', 'pharmacist', 'owner'] as UserRole[]).map((role) => {
                    const isSelf = session.user.id === editingStaff.id && role !== 'owner';
                    return (
                      <button
                        key={role}
                        type="button"
                        disabled={isSelf}
                        onClick={() => setEditRole(role)}
                        style={{
                          padding: '10px 8px',
                          borderRadius: '8px',
                          border: editRole === role ? '2px solid #2563eb' : '1px solid #cbd5e1',
                          backgroundColor: editRole === role ? '#eff6ff' : '#ffffff',
                          cursor: isSelf ? 'not-allowed' : 'pointer',
                          opacity: isSelf ? 0.5 : 1,
                          textAlign: 'center',
                        }}
                        title={isSelf ? 'Cannot change your own role away from owner' : undefined}
                      >
                        <div style={{ fontSize: '16px', marginBottom: '2px' }}>
                          {role === 'owner' ? '👑' : role === 'pharmacist' ? '💊' : '🏷️'}
                        </div>
                        <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a', textTransform: 'capitalize' }}>
                          {role}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                    Reset PIN (Optional)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowEditPin(!showEditPin)}
                    style={{ background: 'none', border: 'none', fontSize: '12px', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}
                  >
                    {showEditPin ? 'Hide PIN' : 'Show PIN'}
                  </button>
                </div>
                <input
                  type={showEditPin ? 'text' : 'password'}
                  placeholder="Leave blank to keep existing PIN"
                  value={editPin}
                  onChange={(e) => setEditPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '15px',
                    letterSpacing: showEditPin ? '0.05em' : '0.25em',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="editIsActive"
                  checked={editIsActive}
                  disabled={session.user.id === editingStaff.id}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label
                  htmlFor="editIsActive"
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#334155',
                    cursor: session.user.id === editingStaff.id ? 'not-allowed' : 'pointer',
                  }}
                >
                  Account is Active (can log into counter)
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setEditingStaff(null)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
