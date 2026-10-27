import React, { useState, useEffect, Suspense, lazy } from 'react';
import type { AuthSession, UserRole } from '@pos/shared';
import type { DbMetadata } from '../../preload/index.d';
import type { SyncStatus } from './sync/types';
import { PosCheckoutScreen } from './pos/PosCheckoutScreen';
import { SyncTopBarIndicator } from './sync/SyncTopBarIndicator';
import { SyncOfflineBanner } from './sync/SyncOfflineBanner';
import { SyncStatusModal } from './sync/SyncStatusModal';
import { useI18n } from '../utils/i18n/I18nContext';
import {
  BrandLogo,
  CartIcon,
  InvoiceIcon,
  AnalyticsIcon,
  MedicineIcon,
  StaffIcon,
  PurchasingIcon,
  StockIcon,
  SyncIcon,
  SettingsIcon,
  DatabaseIcon,
  HospitalIcon,
  GlobeIcon,
  LockIcon,
} from './common/Icons';

// Low-end PC optimization: Lazy-load heavy non-primary screens
const ProductList = lazy(() =>
  import('./products/ProductList').then((m) => ({ default: m.ProductList }))
);
const PurchasingDashboard = lazy(() =>
  import('./purchasing/PurchasingDashboard').then((m) => ({ default: m.PurchasingDashboard }))
);
const StockOverview = lazy(() =>
  import('./stock/StockOverview').then((m) => ({ default: m.StockOverview }))
);
const InvoiceHistoryScreen = lazy(() =>
  import('./invoices/InvoiceHistoryScreen').then((m) => ({ default: m.InvoiceHistoryScreen }))
);
const DayEndReportScreen = lazy(() =>
  import('./shifts/DayEndReportScreen').then((m) => ({ default: m.DayEndReportScreen }))
);
const SyncDashboardScreen = lazy(() =>
  import('./sync/SyncDashboardScreen').then((m) => ({ default: m.SyncDashboardScreen }))
);
const SettingsScreen = lazy(() =>
  import('./settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen }))
);

interface LayoutShellProps {
  session: AuthSession;
  dbInfo: DbMetadata | null;
  onLock: () => void;
  onLogout: () => void;
}

type NavSection =
  | 'pos'
  | 'invoices'
  | 'shifts'
  | 'products'
  | 'purchasing'
  | 'stock'
  | 'sync'
  | 'users'
  | 'settings'
  | 'diagnostics';

export const LayoutShell: React.FC<LayoutShellProps> = ({ session, dbInfo, onLock, onLogout }) => {
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

  interface NavItemDef {
    id: NavSection;
    label: string;
    icon: React.ReactNode;
    minRole: UserRole;
    shortcut?: string;
    section: 'MAIN' | 'PHARMACY' | 'FINANCE' | 'SYSTEM';
  }

  // Categorized Navigation items filtered by role with i18n & keyboard shortcuts
  const navItems: NavItemDef[] = [
    {
      id: 'pos',
      label: t.posTerminal,
      icon: <CartIcon size={17} />,
      minRole: 'cashier',
      shortcut: 'F1',
      section: 'MAIN',
    },
    {
      id: 'invoices',
      label: t.invoices,
      icon: <InvoiceIcon size={17} />,
      minRole: 'cashier',
      shortcut: 'F5',
      section: 'PHARMACY',
    },
    {
      id: 'shifts',
      label: t.shiftDayEnd,
      icon: <AnalyticsIcon size={17} />,
      minRole: 'cashier',
      shortcut: 'F6',
      section: 'PHARMACY',
    },
    {
      id: 'products',
      label: t.catalog,
      icon: <MedicineIcon size={17} />,
      minRole: 'pharmacist',
      shortcut: 'F2',
      section: 'PHARMACY',
    },
    {
      id: 'users',
      label: 'Staff List',
      icon: <StaffIcon size={17} />,
      minRole: 'owner',
      section: 'PHARMACY',
    },
    {
      id: 'purchasing',
      label: t.purchasing,
      icon: <PurchasingIcon size={17} />,
      minRole: 'pharmacist',
      shortcut: 'F3',
      section: 'FINANCE',
    },
    {
      id: 'stock',
      label: t.stockOverview,
      icon: <StockIcon size={17} />,
      minRole: 'pharmacist',
      shortcut: 'F4',
      section: 'FINANCE',
    },
    {
      id: 'sync',
      label: t.syncStatus,
      icon: <SyncIcon size={17} />,
      minRole: 'cashier',
      section: 'SYSTEM',
    },
    {
      id: 'settings',
      label: t.settings,
      icon: <SettingsIcon size={17} />,
      minRole: 'cashier',
      shortcut: 'F10',
      section: 'SYSTEM',
    },
    {
      id: 'diagnostics',
      label: 'Local DB & Engine',
      icon: <DatabaseIcon size={17} />,
      minRole: 'cashier',
      section: 'SYSTEM',
    },
  ];

  const visibleNav = navItems.filter((item) => canAccessSection(item.minRole));

  const getSectionTitle = (id: NavSection): string => {
    switch (id) {
      case 'pos':
        return 'POS Checkout & Terminal';
      case 'invoices':
        return 'Invoices & Sales History';
      case 'shifts':
        return 'Shift & Day-End Report';
      case 'products':
        return 'Medicine & Product Catalog';
      case 'purchasing':
        return 'Purchases & Receiving';
      case 'stock':
        return 'Stock Overview & Inventory';
      case 'sync':
        return 'Cloud Sync & Replication';
      case 'settings':
        return 'System Settings';
      case 'users':
        return 'Staff List & Roles';
      case 'diagnostics':
        return 'Engine Diagnostics & WAL';
      default:
        return 'HexaPharm';
    }
  };

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
        return { bg: '#fef3c7', text: '#92400e', border: '#fde68a', label: 'Super admin' };
      case 'pharmacist':
        return { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe', label: 'Pharmacist' };
      default:
        return { bg: '#dcfce7', text: '#166534', border: '#bbf7d0', label: 'Cashier' };
    }
  };

  const badge = getRoleBadgeStyle(userRole);

  const sectionsOrder: Array<{ key: 'MAIN' | 'PHARMACY' | 'FINANCE' | 'SYSTEM'; title?: string }> =
    [
      { key: 'MAIN' },
      { key: 'PHARMACY', title: 'PHARMACY' },
      { key: 'FINANCE', title: 'FINANCE & ASSETS' },
      { key: 'SYSTEM', title: 'SYSTEM & SETTINGS' },
    ];

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        backgroundColor: '#f8fafc',
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
        direction: isRtl ? 'rtl' : 'ltr',
      }}
    >
      {/* HexaPharm Clean White Sidebar */}
      <aside
        style={{
          width: '248px',
          backgroundColor: '#ffffff',
          borderRight: isRtl ? 'none' : '1px solid #f1f5f9',
          borderLeft: isRtl ? '1px solid #f1f5f9' : 'none',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          zIndex: 30,
          boxShadow: '1px 0 4px rgba(15, 23, 42, 0.02)',
        }}
      >
        {/* Brand Header with Authentic Human-Made Vector Logo */}
        <div
          style={{
            padding: '18px 16px 14px 16px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <BrandLogo size={36} showText={true} textSubtitle="Pharmacy POS" />
        </div>

        {/* Pharmacy / Branch Selector Card */}
        <div
          style={{
            margin: '0 12px 14px 12px',
            padding: '9px 12px',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#2563eb',
                flexShrink: 0,
              }}
            >
              <HospitalIcon size={16} color="#2563eb" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '12px',
                  color: '#0f172a',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.2,
                }}
              >
                {session.branch.name || 'HexaPharm Main Branch'}
              </div>
              <div
                style={{
                  fontSize: '10px',
                  color: '#64748b',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {session.counter.name || 'Terminal 1'} • WAL Active
              </div>
            </div>
          </div>
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>⌄</span>
        </div>

        {/* Categorized Navigation Menu */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 10px 14px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '1px',
          }}
        >
          {sectionsOrder.map((sec) => {
            const items = visibleNav.filter((item) => item.section === sec.key);
            if (items.length === 0) return null;

            return (
              <div key={sec.key} style={{ marginBottom: '6px' }}>
                {sec.title && <div className="sidebar-section-header">{sec.title}</div>}
                {items.map((item) => {
                  const isActive = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="interactive-btn"
                      onClick={() => setActiveSection(item.id)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        marginBottom: '2px',
                        borderRadius: '9px',
                        border: isActive ? '1px solid #bfdbfe' : '1px solid transparent',
                        backgroundColor: isActive ? '#eff6ff' : 'transparent',
                        color: isActive ? '#2563eb' : '#475569',
                        fontSize: '13px',
                        fontWeight: isActive ? 700 : 500,
                        textAlign: isRtl ? 'right' : 'left',
                        boxShadow: isActive ? '0 1px 2px rgba(37, 99, 235, 0.08)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span
                          style={{
                            fontSize: '15px',
                            filter: isActive
                              ? 'drop-shadow(0 1px 2px rgba(37,99,235,0.3))'
                              : 'none',
                          }}
                        >
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </div>
                      {item.shortcut && (
                        <kbd
                          className="kbd-cap"
                          style={{
                            backgroundColor: isActive ? '#ffffff' : '#f1f5f9',
                            borderColor: isActive ? '#bfdbfe' : '#e2e8f0',
                            color: isActive ? '#2563eb' : '#64748b',
                            fontSize: '10px',
                            padding: '1px 5px',
                          }}
                        >
                          {item.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Sidebar Bottom Footer: Auto-lock & Local WAL info */}
        <div
          style={{
            padding: '12px 14px',
            borderTop: '1px solid #f1f5f9',
            backgroundColor: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#64748b',
            flexShrink: 0,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="pulse-green-dot" title="Local SQLite WAL Engine Online" />
            <span style={{ fontWeight: 600 }}>WAL Online</span>
          </div>
          <span style={{ fontSize: '10px', color: '#94a3b8' }}>
            Lock in {session.idleTimeoutMinutes}m
          </span>
        </div>
      </aside>

      {/* Main Area: Top Header + View Content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {/* Top Header Bar */}
        <header
          style={{
            height: '64px',
            backgroundColor: '#ffffff',
            borderBottom: '1px solid #f1f5f9',
            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            flexShrink: 0,
            zIndex: 20,
          }}
        >
          {/* Left: Back button `<` + Active Screen Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              className="interactive-btn"
              onClick={() => setActiveSection('pos')}
              title="Return to Dashboard / POS (F1)"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                border: '1px solid #e2e8f0',
                backgroundColor: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b',
                cursor: 'pointer',
                fontSize: '15px',
                fontWeight: 700,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              ‹
            </button>
            <h1
              style={{
                margin: 0,
                fontSize: '19px',
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.02em',
              }}
            >
              {getSectionTitle(activeSection)}
            </h1>
          </div>

          {/* Center: Search Pill Bar + Circular Blue Plus Action */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ position: 'relative', width: '280px' }}>
              <span
                style={{
                  position: 'absolute',
                  left: isRtl ? 'auto' : '14px',
                  right: isRtl ? '14px' : 'auto',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94a3b8',
                  fontSize: '12px',
                }}
              >
                🔍
              </span>
              <input
                type="text"
                className="search-pill"
                placeholder="Search for anything here..."
                style={{
                  width: '100%',
                  height: '36px',
                  paddingLeft: isRtl ? '14px' : '36px',
                  paddingRight: isRtl ? '36px' : '14px',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setActiveSection('products');
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="interactive-btn"
              onClick={() => {
                if (activeSection !== 'products') setActiveSection('products');
              }}
              title="Quick Add Action (+)"
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '50%',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                fontSize: '17px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(37, 99, 235, 0.35)',
              }}
            >
              +
            </button>
          </div>

          {/* Right: Sync pill, Language toggle, Lock button & User Profile Chip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Sync Status Pill Indicator */}
            <SyncTopBarIndicator onClick={() => setIsSyncModalOpen(true)} />

            {/* Language Toggle Button */}
            <button
              type="button"
              className="interactive-btn"
              onClick={() => setLocale(locale === 'en' ? 'ur' : 'en')}
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                backgroundColor: '#ffffff',
                color: '#334155',
                fontSize: '12px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <GlobeIcon size={14} color="#64748b" />
              <span>{locale === 'en' ? 'اردو' : 'EN'}</span>
            </button>

            {/* Lock Button with F9 shortcut */}
            <button
              type="button"
              className="interactive-btn"
              onClick={onLock}
              title={`${t.lockTerminal} (F9)`}
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                backgroundColor: '#ffffff',
                color: '#475569',
                fontSize: '12px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <LockIcon size={13} color="#64748b" />
              <kbd className="kbd-cap" style={{ fontSize: '10px', padding: '1px 4px' }}>
                F9
              </kbd>
            </button>

            {/* User Profile Chip (HexaPharm style) */}
            <div
              className="interactive-btn"
              onClick={onLogout}
              title={`Logged in as ${session.user.name} (${userRole}). Click to Logout.`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 10px 4px 5px',
                backgroundColor: '#ffffff',
                borderRadius: '9999px',
                border: '1px solid #e2e8f0',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '12px',
                  boxShadow: '0 2px 4px rgba(37, 99, 235, 0.25)',
                }}
              >
                {session.user.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  style={{ fontWeight: 700, fontSize: '12px', color: '#0f172a', lineHeight: 1.2 }}
                >
                  {session.user.name}
                </div>
                <span
                  style={{
                    fontSize: '9.5px',
                    fontWeight: 600,
                    color: '#64748b',
                  }}
                >
                  {badge.label}
                </span>
              </div>
              <span style={{ color: '#94a3b8', fontSize: '11px', marginLeft: '2px' }}>⌄</span>
            </div>
          </div>
        </header>

        {/* Offline Limit Warning Banner */}
        <SyncOfflineBanner status={syncStatus} onOpenSyncStatus={() => setIsSyncModalOpen(true)} />

        {/* Content Area */}
        <main
          style={{
            flex: 1,
            overflowY: activeSection === 'pos' ? 'hidden' : 'auto',
            padding:
              activeSection === 'pos'
                ? '0'
                : activeSection === 'settings'
                  ? '0'
                  : '24px 32px',
            backgroundColor: '#f8fafc',
            display: activeSection === 'pos' ? 'flex' : 'block',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <Suspense fallback={<div style={{ padding: '24px', color: '#64748b' }}>{t.loading}</div>}>
            {activeSection === 'pos' && <PosCheckoutScreen session={session} />}

            {activeSection === 'invoices' && <InvoiceHistoryScreen session={session} />}

            {activeSection === 'shifts' && <DayEndReportScreen session={session} />}

            {activeSection === 'products' && <ProductList />}

            {activeSection === 'purchasing' && <PurchasingDashboard />}

            {activeSection === 'stock' && <StockOverview />}

            {activeSection === 'sync' && <SyncDashboardScreen session={session} />}

            {activeSection === 'settings' && <SettingsScreen session={session} />}

            {activeSection === 'users' && (
              <div>
                <h2
                  style={{
                    margin: '0 0 6px 0',
                    fontSize: '22px',
                    fontWeight: 700,
                    color: '#0f172a',
                  }}
                >
                  Staff & Role Permissions (Owner Only)
                </h2>
                <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
                  Manage terminal PINs, roles (Owner, Pharmacist, Cashier), and staff access.
                </p>
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    padding: '24px',
                  }}
                >
                  <p style={{ margin: 0, color: '#475569' }}>
                    Owner permissions verified. Only the owner role can view or manage staff
                    accounts.
                  </p>
                </div>
              </div>
            )}

            {activeSection === 'diagnostics' && (
              <div>
                <h2
                  style={{
                    margin: '0 0 6px 0',
                    fontSize: '22px',
                    fontWeight: 700,
                    color: '#0f172a',
                  }}
                >
                  Local Database & Terminal Diagnostics
                </h2>
                <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
                  Current SQLite WAL engine and migration status
                </p>

                {dbInfo && (
                  <div
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0',
                      padding: '20px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                        Database File:
                      </span>
                      <div
                        style={{
                          fontFamily: 'Consolas, monospace',
                          fontSize: '12px',
                          marginTop: '4px',
                          padding: '8px',
                          backgroundColor: '#f8fafc',
                          borderRadius: '4px',
                        }}
                      >
                        {dbInfo.dbPath}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '20px', marginTop: '6px' }}>
                      <div>
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                          Schema Version:
                        </span>
                        <div style={{ fontWeight: 700, color: '#2563eb' }}>
                          v{dbInfo.schemaVersion}
                        </div>
                      </div>
                      <div>
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                          Journal Mode:
                        </span>
                        <div style={{ fontWeight: 700, color: '#166534' }}>
                          {dbInfo.journalMode.toUpperCase()}
                        </div>
                      </div>
                      <div>
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                          Foreign Keys:
                        </span>
                        <div
                          style={{
                            fontWeight: 700,
                            color: dbInfo.foreignKeys ? '#166534' : '#dc2626',
                          }}
                        >
                          {dbInfo.foreignKeys ? 'ENABLED' : 'DISABLED'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Live IPC Role Guard Testing Panel */}
                <div
                  style={{
                    marginTop: '24px',
                    padding: '20px',
                    backgroundColor: '#ffffff',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '12px',
                    }}
                  >
                    <div>
                      <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                        IPC Layer Role Guard Live Verification
                      </h3>
                      <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                        Test real-time IPC protection in the Electron main process for your current role (
                        <strong>{userRole}</strong>).
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
              </div>
            )}
          </Suspense>
        </main>
      </div>

      {/* Sync Status & Exceptions Modal */}
      {isSyncModalOpen && (
        <SyncStatusModal session={session} onClose={() => setIsSyncModalOpen(false)} />
      )}
    </div>
  );
};
