import React, { useState, useEffect, Suspense, lazy } from 'react';
import type { AuthSession, UserRole } from '@pos/shared';
import type { DbMetadata } from '../../preload/index.d';
import type { SyncStatus } from './sync/types';
import { PosCheckoutScreen } from './pos/PosCheckoutScreen';
import { SyncTopBarIndicator } from './sync/SyncTopBarIndicator';
import { SyncOfflineBanner } from './sync/SyncOfflineBanner';
import { SyncStatusModal } from './sync/SyncStatusModal';
import { useI18n } from '../utils/i18n/I18nContext';

// Low-end PC optimization: Lazy-load heavy non-primary screens
const ProductList = lazy(() => import('./products/ProductList').then((m) => ({ default: m.ProductList })));
const PurchasingDashboard = lazy(() => import('./purchasing/PurchasingDashboard').then((m) => ({ default: m.PurchasingDashboard })));
const StockOverview = lazy(() => import('./stock/StockOverview').then((m) => ({ default: m.StockOverview })));
const InvoiceHistoryScreen = lazy(() => import('./invoices/InvoiceHistoryScreen').then((m) => ({ default: m.InvoiceHistoryScreen })));
const DayEndReportScreen = lazy(() => import('./shifts/DayEndReportScreen').then((m) => ({ default: m.DayEndReportScreen })));
const SyncDashboardScreen = lazy(() => import('./sync/SyncDashboardScreen').then((m) => ({ default: m.SyncDashboardScreen })));
const SettingsScreen = lazy(() => import('./settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })));

interface LayoutShellProps {
  session: AuthSession;
  dbInfo: DbMetadata | null;
  onLock: () => void;
  onLogout: () => void;
}

type NavSection = 'pos' | 'invoices' | 'shifts' | 'products' | 'purchasing' | 'stock' | 'sync' | 'users' | 'settings' | 'diagnostics';

export const LayoutShell: React.FC<LayoutShellProps> = ({
  session,
  dbInfo,
  onLock,
  onLogout,
}) => {
  const { locale, setLocale, t, isRtl } = useI18n();
  const [activeSection, setActiveSection] = useState<NavSection>('pos');
  const [roleTestResult, setRoleTestResult] = useState<{
    roleTested: string;
    success: boolean;
    message: string;
  } | null>(null);
  const [testingRole, setTestingRole] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  useEffect(() => {
    if (!window.api?.sync) return;
    window.api.sync.getStatus().then(setSyncStatus).catch(console.error);
    const unsubscribe = window.api.sync.onStatusChanged((s) => {
      setSyncStatus(s);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const userRole = session.user.role;

  const canAccessSection = (minRole: UserRole): boolean => {
    if (userRole === 'owner') return true;
    if (userRole === 'pharmacist') return minRole === 'pharmacist' || minRole === 'cashier';
    return minRole === 'cashier';
  };

  // Keyboard navigation shortcuts: F1 - F10
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setActiveSection('pos');
      } else if (e.key === 'F2' && activeSection !== 'pos') {
        if (canAccessSection('pharmacist')) {
          e.preventDefault();
          setActiveSection('products');
        }
      } else if (e.key === 'F3' && activeSection !== 'pos') {
        if (canAccessSection('pharmacist')) {
          e.preventDefault();
          setActiveSection('purchasing');
        }
      } else if (e.key === 'F4' && activeSection !== 'pos') {
        if (canAccessSection('pharmacist')) {
          e.preventDefault();
          setActiveSection('stock');
        }
      } else if (e.key === 'F5') {
        e.preventDefault();
        setActiveSection('invoices');
      } else if (e.key === 'F6') {
        e.preventDefault();
        setActiveSection('shifts');
      } else if (e.key === 'F9') {
        e.preventDefault();
        onLock();
      } else if (e.key === 'F10') {
        e.preventDefault();
        setActiveSection('settings');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [userRole, onLock]);

  // Navigation items filtered by role with i18n
  const navItems: { id: NavSection; label: string; icon: string; minRole: UserRole }[] = [
    { id: 'pos', label: t.posTerminal, icon: '🛒', minRole: 'cashier' },
    { id: 'invoices', label: t.invoices, icon: '🧾', minRole: 'cashier' },
    { id: 'shifts', label: t.shiftDayEnd, icon: '📊', minRole: 'cashier' },
    { id: 'products', label: t.catalog, icon: '💊', minRole: 'pharmacist' },
    { id: 'purchasing', label: t.purchasing, icon: '📥', minRole: 'pharmacist' },
    { id: 'stock', label: t.stockOverview, icon: '📦', minRole: 'pharmacist' },
    { id: 'sync', label: t.syncStatus, icon: '🔄', minRole: 'cashier' },
    { id: 'settings', label: t.settings, icon: '⚙️', minRole: 'cashier' },
    { id: 'users', label: 'Staff & Roles', icon: '👥', minRole: 'owner' },
    { id: 'diagnostics', label: 'Local DB & System', icon: '💾', minRole: 'cashier' },
  ];

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

        {/* Center: Sync Status Indicator (Click opens modal) */}
        <SyncTopBarIndicator onClick={() => setIsSyncModalOpen(true)} />

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

          {/* Language Toggle Button */}
          <button
            type="button"
            onClick={() => setLocale(locale === 'en' ? 'ur' : 'en')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#f1f5f9',
              color: '#1e293b',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            🌐 {locale === 'en' ? 'اردو' : 'English'}
          </button>

          {/* Lock Button */}
          <button
            type="button"
            onClick={onLock}
            title={t.lockTerminal}
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
            🔒 {isRtl ? 'لاک' : 'Lock'}
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
            {t.logout}
          </button>
        </div>
      </header>

      {/* Offline Limit Warning Banner (Approaching / Critical / Exceeded) */}
      <SyncOfflineBanner
        status={syncStatus}
        onOpenSyncStatus={() => setIsSyncModalOpen(true)}
      />

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
            padding: activeSection === 'pos' ? '16px 20px' : activeSection === 'settings' ? '0' : '24px 32px',
            backgroundColor: '#f8fafc',
          }}
        >
          <Suspense fallback={<div style={{ padding: '24px', color: '#64748b' }}>{t.loading}</div>}>
            {activeSection === 'pos' && (
              <PosCheckoutScreen session={session} />
            )}

            {activeSection === 'invoices' && (
              <InvoiceHistoryScreen session={session} />
            )}

            {activeSection === 'shifts' && (
              <DayEndReportScreen session={session} />
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

            {activeSection === 'sync' && (
              <SyncDashboardScreen session={session} />
            )}

            {activeSection === 'settings' && (
              <SettingsScreen session={session} />
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
          </Suspense>

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

      {/* Sync Status & Exceptions Modal */}
      {isSyncModalOpen && (
        <SyncStatusModal
          session={session}
          onClose={() => setIsSyncModalOpen(false)}
        />
      )}
    </div>
  );
};
