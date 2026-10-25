import React, { useState } from 'react';
import type { AuthSession, UserRole } from '@pos/shared';
import type { DbMetadata } from '../../preload/index.d';
import { ProductList } from './products/ProductList';
import { PurchasingDashboard } from './purchasing/PurchasingDashboard';
import { StockOverview } from './stock/StockOverview';

interface LayoutShellProps {
  session: AuthSession;
  dbInfo: DbMetadata | null;
  onLock: () => void;
  onLogout: () => void;
}

type NavSection = 'pos' | 'products' | 'purchasing' | 'stock' | 'users' | 'diagnostics';

export const LayoutShell: React.FC<LayoutShellProps> = ({
  session,
  dbInfo,
  onLock,
  onLogout,
}) => {
  const [activeSection, setActiveSection] = useState<NavSection>('pos');
  const [roleTestResult, setRoleTestResult] = useState<{
    roleTested: string;
    success: boolean;
    message: string;
  } | null>(null);
  const [testingRole, setTestingRole] = useState(false);

  const userRole = session.user.role;

  // Navigation items filtered by role
  const navItems: { id: NavSection; label: string; icon: string; minRole: UserRole }[] = [
    { id: 'pos', label: 'POS / Checkout', icon: '🛒', minRole: 'cashier' },
    { id: 'products', label: 'Product Catalog', icon: '💊', minRole: 'pharmacist' },
    { id: 'purchasing', label: 'Purchasing & GRN', icon: '📥', minRole: 'pharmacist' },
    { id: 'stock', label: 'Stock & Inventory', icon: '📦', minRole: 'pharmacist' },
    { id: 'users', label: 'Staff & Roles', icon: '👥', minRole: 'owner' },
    { id: 'diagnostics', label: 'Local DB & System', icon: '⚙️', minRole: 'cashier' },
  ];

  const canAccessSection = (minRole: UserRole): boolean => {
    if (userRole === 'owner') return true;
    if (userRole === 'pharmacist') return minRole === 'pharmacist' || minRole === 'cashier';
    return minRole === 'cashier';
  };

  const visibleNav = navItems.filter((item) => canAccessSection(item.minRole));

  const handleTestRole = async (targetRole: 'cashier' | 'pharmacist' | 'owner') => {
    setTestingRole(true);
    setRoleTestResult(null);
    try {
      const res = await window.api.auth.testRoleAction(targetRole);
      setRoleTestResult({
        roleTested: targetRole,
        success: res.success,
        message: res.message,
      });
    } catch (err: unknown) {
      setRoleTestResult({
        roleTested: targetRole,
        success: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestingRole(false);
    }
  };

  const getRoleBadgeStyle = (role: string) => {
    switch (role) {
      case 'owner':
        return { bg: '#fef3c7', text: '#92400e', border: '#fde68a' };
      case 'pharmacist':
        return { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe' };
      default:
        return { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' };
    }
  };

  const badge = getRoleBadgeStyle(userRole);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Top Bar */}
      <header
        style={{
          height: '60px',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          flexShrink: 0,
        }}
      >
        {/* Left: Store & Terminal */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>🏥</span>
            <span style={{ fontWeight: 700, fontSize: '16px', color: '#0f172a' }}>
              {session.branch.name}
            </span>
          </div>
          <span style={{ color: '#cbd5e1' }}>•</span>
          <div
            style={{
              padding: '2px 8px',
              backgroundColor: '#f1f5f9',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#475569',
            }}
          >
            {session.counter.name}
          </div>
        </div>

        {/* Center: Offline Status Pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 12px',
            borderRadius: '9999px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#22c55e' }} />
          Offline Ready • Local SQLite WAL
        </div>

        {/* Right: User Profile & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* User Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '13px',
              }}
            >
              {session.user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                {session.user.name}
              </div>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: badge.text,
                  backgroundColor: badge.bg,
                  padding: '1px 6px',
                  borderRadius: '3px',
                }}
              >
                {userRole}
              </span>
            </div>
          </div>

          <div style={{ height: '24px', width: '1px', backgroundColor: '#e2e8f0' }} />

          {/* Lock Button */}
          <button
            type="button"
            onClick={onLock}
            title="Lock Terminal"
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
              backgroundColor: '#ffffff',
              color: '#475569',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            🔒 Lock
          </button>

          {/* Logout Button */}
          <button
            type="button"
            onClick={onLogout}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #fee2e2',
              backgroundColor: '#fff1f2',
              color: '#be123c',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Log Out
          </button>
        </div>
      </header>

      {/* Main Body with Left Nav */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Navigation */}
        <aside
          style={{
            width: '230px',
            backgroundColor: '#ffffff',
            borderRight: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '16px 12px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ padding: '0 8px 8px 8px', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Navigation ({userRole})
            </div>
            {visibleNav.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: isActive ? '#eff6ff' : 'transparent',
                    color: isActive ? '#1d4ed8' : '#334155',
                    fontSize: '13px',
                    fontWeight: isActive ? 600 : 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.1s',
                  }}
                >
                  <span style={{ fontSize: '16px' }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Bottom Nav Helper */}
          <div
            style={{
              padding: '12px',
              backgroundColor: '#f8fafc',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              fontSize: '11px',
              color: '#64748b',
              lineHeight: 1.4,
            }}
          >
            Auto-lock active after <strong>{session.idleTimeoutMinutes} min</strong> idle.
          </div>
        </aside>

        {/* Content Area */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 32px',
            backgroundColor: '#f8fafc',
          }}
        >
          {activeSection === 'pos' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
                    Point of Sale Terminal
                  </h2>
                  <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                    Active checkout session on {session.counter.name}
                  </p>
                </div>
                <div style={{ padding: '6px 12px', backgroundColor: '#e2e8f0', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
                  Keyboard Mode: F1-F12 ready
                </div>
              </div>

              {/* POS Shell Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: '24px' }}>
                <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', padding: '24px' }}>
                  <div style={{ fontWeight: 600, fontSize: '15px', color: '#1e293b', marginBottom: '12px' }}>
                    Item Search / Barcode Scanner
                  </div>
                  <input
                    type="text"
                    placeholder="Scan barcode or type generic name (e.g. Paracetamol, Augmentin)..."
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      fontSize: '14px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ marginTop: '20px', padding: '32px', textAlign: 'center', color: '#94a3b8', border: '2px dashed #e2e8f0', borderRadius: '8px' }}>
                    Cart is empty. Scan an item or enter barcode to begin sale.
                  </div>
                </div>

                <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', padding: '24px' }}>
                  <div style={{ fontWeight: 600, fontSize: '15px', color: '#1e293b', marginBottom: '16px' }}>
                    Sale Summary
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: '13px' }}>
                    <span style={{ color: '#64748b' }}>Subtotal:</span>
                    <span style={{ fontWeight: 600 }}>Rs. 0.00</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: '13px' }}>
                    <span style={{ color: '#64748b' }}>GST / Tax:</span>
                    <span style={{ fontWeight: 600 }}>Rs. 0.00</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 0 20px 0', fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
                    <span>Total:</span>
                    <span>Rs. 0.00</span>
                  </div>
                  <button
                    type="button"
                    disabled
                    style={{
                      width: '100%',
                      padding: '14px',
                      backgroundColor: '#94a3b8',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 700,
                      fontSize: '15px',
                      cursor: 'not-allowed',
                    }}
                  >
                    Complete Sale (Cash / Card)
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'products' && (
            <ProductList />
          )}

          {activeSection === 'purchasing' && (
            <PurchasingDashboard />
          )}

          {activeSection === 'stock' && (
            <StockOverview />
          )}

          {activeSection === 'users' && (
            <div>
              <h2 style={{ margin: '0 0 6px 0', fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
                Staff & Role Permissions (Owner Only)
              </h2>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
                Manage terminal PINs, roles (Owner, Pharmacist, Cashier), and staff access.
              </p>
              <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', padding: '24px' }}>
                <p style={{ margin: 0, color: '#475569' }}>
                  Owner permissions verified. Only the owner role can view or manage staff accounts.
                </p>
              </div>
            </div>
          )}

          {activeSection === 'diagnostics' && (
            <div>
              <h2 style={{ margin: '0 0 6px 0', fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
                Local Database & Terminal Diagnostics
              </h2>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
                Current SQLite WAL engine and migration status
              </p>

              {dbInfo && (
                <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Database File:</span>
                    <div style={{ fontFamily: 'Consolas, monospace', fontSize: '12px', marginTop: '4px', padding: '8px', backgroundColor: '#f8fafc', borderRadius: '4px' }}>
                      {dbInfo.dbPath}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '20px', marginTop: '6px' }}>
                    <div>
                      <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Schema Version:</span>
                      <div style={{ fontWeight: 700, color: '#2563eb' }}>v{dbInfo.schemaVersion}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Journal Mode:</span>
                      <div style={{ fontWeight: 700, color: '#166534' }}>{dbInfo.journalMode.toUpperCase()}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Foreign Keys:</span>
                      <div style={{ fontWeight: 700, color: dbInfo.foreignKeys ? '#166534' : '#dc2626' }}>
                        {dbInfo.foreignKeys ? 'ENABLED' : 'DISABLED'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Live IPC Role Guard Testing Panel */}
          <div
            style={{
              marginTop: '32px',
              padding: '20px',
              backgroundColor: '#ffffff',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                  IPC Layer Role Guard Live Verification
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                  Test real-time IPC protection in the Electron main process for your current role (<strong>{userRole}</strong>).
                </p>
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '3px 8px',
                  backgroundColor: '#f1f5f9',
                  borderRadius: '4px',
                }}
              >
                requireRole() Guard
              </span>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={testingRole}
                onClick={() => handleTestRole('cashier')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Test Cashier Action (Sell)
              </button>

              <button
                type="button"
                disabled={testingRole}
                onClick={() => handleTestRole('pharmacist')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Test Pharmacist Action (Manage Stock)
              </button>

              <button
                type="button"
                disabled={testingRole}
                onClick={() => handleTestRole('owner')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Test Owner Action (Manage Users)
              </button>
            </div>

            {roleTestResult && (
              <div
                style={{
                  marginTop: '14px',
                  padding: '12px 16px',
                  borderRadius: '6px',
                  backgroundColor: roleTestResult.success ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${roleTestResult.success ? '#bbf7d0' : '#fecaca'}`,
                  color: roleTestResult.success ? '#166534' : '#b91c1c',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
              >
                <strong>IPC Result:</strong> {roleTestResult.message}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
