import React, { useState, useEffect } from 'react';
import type { AppPermission } from '@pos/shared';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  ReceiptText,
  Boxes,
  TrendingUp,
  Truck,
  Users,
  Store,
  MonitorSmartphone,
  ShieldAlert,
  LogOut,
  Clock,
  Building2,
  ChevronRight,
  ChevronDown,
  Menu,
  X,
  BookOpen,
  Scale,
  Warehouse,
  ClipboardCheck,
  RotateCcw,
  CalendarClock,
  CreditCard,
  Receipt,
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  FileText,
  PiggyBank,
  CalendarCheck,
  HeartPulse,
  CalendarDays,
  Banknote,
  Search,
} from 'lucide-react';
import { Badge } from '@pos/ui';
import { CommandPalette } from '../components/CommandPalette';
import { NotificationBell } from '../components/NotificationBell';

export type NavItem =
  | 'overview'
  | 'customers'
  | 'prescriptions'
  | 'hr-leave'
  | 'hr-payroll'
  | 'stock-management'
  | 'batches-expiry'
  | 'stock-transfers'
  | 'stock-locations'
  | 'stock-counts'
  | 'supplier-returns'
  | 'purchase-orders'
  | 'suppliers'
  | 'finance-coa'
  | 'finance-journals'
  | 'finance-payments'
  | 'finance-expenses'
  | 'finance-ar'
  | 'finance-ap'
  | 'finance-cash-bank'
  | 'finance-sales-ledger'
  | 'finance-reports'
  | 'finance-budgets'
  | 'finance-period-close'
  | 'reports-sales'
  | 'reports-stock'
  | 'reports-profit'
  | 'reports-supplier'
  | 'admin-users'
  | 'admin-branches'
  | 'admin-devices'
  | 'audit-log';

export const NAV_PERMISSIONS: Record<NavItem, AppPermission> = {
  overview: 'reports.view',
  customers: 'sales.customer.view',
  prescriptions: 'sales.prescription.view',
  'hr-leave': 'hr.leave.view',
  'hr-payroll': 'hr.payroll.view',
  'stock-management': 'inventory.stock.view',
  'batches-expiry': 'inventory.batch.view',
  'stock-transfers': 'inventory.transfer.view',
  'stock-locations': 'inventory.warehouse.view',
  'stock-counts': 'inventory.count.view',
  'supplier-returns': 'inventory.supplier_return.view',
  'purchase-orders': 'inventory.purchase_order.view',
  suppliers: 'inventory.supplier.view',
  'finance-coa': 'finance.coa.view',
  'finance-journals': 'finance.journal.view',
  'finance-payments': 'finance.payment.view',
  'finance-expenses': 'finance.expense.view',
  'finance-ar': 'finance.ar.view',
  'finance-ap': 'finance.ap.view',
  'finance-cash-bank': 'finance.cash_bank.view',
  'finance-sales-ledger': 'finance.sales_ledger.view',
  'finance-reports': 'finance.reports.view',
  'finance-budgets': 'finance.budget.view',
  'finance-period-close': 'finance.period_close.propose',
  'reports-sales': 'reports.sales.view',
  'reports-stock': 'reports.stock.view',
  'reports-profit': 'reports.profit.view',
  'reports-supplier': 'reports.supplier_ledger.view',
  'admin-users': 'admin.users.manage',
  'admin-branches': 'settings.branches.view',
  'admin-devices': 'settings.devices.view',
  'audit-log': 'admin.audit_log.view',
};

interface NavEntry {
  id: NavItem;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: AppPermission;
}

interface NavSection {
  title: string;
  items: NavEntry[];
}

interface DashboardLayoutProps {
  currentTab: NavItem;
  onTabChange: (tab: NavItem) => void;
  children: React.ReactNode;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  currentTab,
  onTabChange,
  children,
}) => {
  const { user, logout, can } = useAuth();
  const [karachiTime, setKarachiTime] = useState<string>('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navSections: NavSection[] = [
    {
      title: 'Main',
      items: [
        {
          id: 'overview',
          label: 'Overview',
          icon: LayoutDashboard,
          permission: NAV_PERMISSIONS.overview,
        },
        {
          id: 'customers',
          label: 'Customers',
          icon: Users,
          permission: NAV_PERMISSIONS.customers,
        },
        {
          id: 'prescriptions',
          label: 'Prescriptions',
          icon: HeartPulse,
          permission: NAV_PERMISSIONS.prescriptions,
        },
      ],
    },
    {
      title: 'Finance & Accounts',
      items: [
        {
          id: 'finance-coa',
          label: 'Chart of Accounts',
          icon: BookOpen,
          permission: NAV_PERMISSIONS['finance-coa'],
        },
        {
          id: 'finance-journals',
          label: 'General Journal',
          icon: Scale,
          permission: NAV_PERMISSIONS['finance-journals'],
        },
        {
          id: 'finance-payments',
          label: 'Payments & Receipts',
          icon: CreditCard,
          permission: NAV_PERMISSIONS['finance-payments'],
        },
        {
          id: 'finance-expenses',
          label: 'Expenses & Recurring',
          icon: Receipt,
          permission: NAV_PERMISSIONS['finance-expenses'],
        },
        {
          id: 'finance-ar',
          label: 'Accounts Receivable',
          icon: ArrowDownLeft,
          permission: NAV_PERMISSIONS['finance-ar'],
        },
        {
          id: 'finance-ap',
          label: 'Accounts Payable',
          icon: ArrowUpRight,
          permission: NAV_PERMISSIONS['finance-ap'],
        },
        {
          id: 'finance-cash-bank',
          label: 'Cash & Bank',
          icon: Landmark,
          permission: NAV_PERMISSIONS['finance-cash-bank'],
        },
        {
          id: 'finance-sales-ledger',
          label: 'Sales Ledger',
          icon: ReceiptText,
          permission: NAV_PERMISSIONS['finance-sales-ledger'],
        },
        {
          id: 'finance-reports',
          label: 'Financial Statements',
          icon: FileText,
          permission: NAV_PERMISSIONS['finance-reports'],
        },
        {
          id: 'finance-budgets',
          label: 'Budget Planning',
          icon: PiggyBank,
          permission: NAV_PERMISSIONS['finance-budgets'],
        },
        {
          id: 'finance-period-close',
          label: 'Period Close & Year-End',
          icon: CalendarCheck,
          permission: NAV_PERMISSIONS['finance-period-close'],
        },
      ],
    },
    {
      title: 'Human Resources',
      items: [
        {
          id: 'hr-leave',
          label: 'Leave & Attendance',
          icon: CalendarDays,
          permission: NAV_PERMISSIONS['hr-leave'],
        },
        {
          id: 'hr-payroll',
          label: 'Payroll Runs',
          icon: Banknote,
          permission: NAV_PERMISSIONS['hr-payroll'],
        },
      ],
    },
    {
      title: 'Inventory & Warehouses',
      items: [
        {
          id: 'stock-management',
          label: 'Stock Management',
          icon: Boxes,
          permission: NAV_PERMISSIONS['stock-management'],
        },
        {
          id: 'batches-expiry',
          label: 'Batches & Expiry',
          icon: CalendarClock,
          permission: NAV_PERMISSIONS['batches-expiry'],
        },
        {
          id: 'stock-transfers',
          label: 'Stock Transfers',
          icon: Truck,
          permission: NAV_PERMISSIONS['stock-transfers'],
        },
        {
          id: 'stock-locations',
          label: 'Warehouses & Locations',
          icon: Warehouse,
          permission: NAV_PERMISSIONS['stock-locations'],
        },
        {
          id: 'stock-counts',
          label: 'Stock Counts & Audits',
          icon: ClipboardCheck,
          permission: NAV_PERMISSIONS['stock-counts'],
        },
        {
          id: 'supplier-returns',
          label: 'Supplier Returns',
          icon: RotateCcw,
          permission: NAV_PERMISSIONS['supplier-returns'],
        },
      ],
    },
    {
      title: 'Suppliers & Procurement',
      items: [
        {
          id: 'purchase-orders',
          label: 'Purchase Orders',
          icon: ReceiptText,
          permission: NAV_PERMISSIONS['purchase-orders'],
        },
        {
          id: 'suppliers',
          label: 'Distributors & Suppliers',
          icon: Truck,
          permission: NAV_PERMISSIONS.suppliers,
        },
      ],
    },
    {
      title: 'Reports & Intelligence',
      items: [
        {
          id: 'reports-sales',
          label: 'Sales Report',
          icon: ReceiptText,
          permission: NAV_PERMISSIONS['reports-sales'],
        },
        {
          id: 'reports-stock',
          label: 'Stock & Expiry',
          icon: Boxes,
          permission: NAV_PERMISSIONS['reports-stock'],
        },
        {
          id: 'reports-profit',
          label: 'Profit per Batch',
          icon: TrendingUp,
          permission: NAV_PERMISSIONS['reports-profit'],
        },
        {
          id: 'reports-supplier',
          label: 'Supplier Ledger',
          icon: Truck,
          permission: NAV_PERMISSIONS['reports-supplier'],
        },
      ],
    },
    {
      title: 'Administration',
      items: [
        {
          id: 'admin-users',
          label: 'Users & Roles',
          icon: Users,
          permission: NAV_PERMISSIONS['admin-users'],
        },
        {
          id: 'admin-branches',
          label: 'Branches & Counters',
          icon: Store,
          permission: NAV_PERMISSIONS['admin-branches'],
        },
        {
          id: 'admin-devices',
          label: 'Registered Devices',
          icon: MonitorSmartphone,
          permission: NAV_PERMISSIONS['admin-devices'],
        },
        {
          id: 'audit-log',
          label: 'Audit Log Viewer',
          icon: ShieldAlert,
          permission: NAV_PERMISSIONS['audit-log'],
        },
      ],
    },
  ];

  // Collapsible category state: default Main and currentTab's parent section open
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = { Main: true };
    for (const sec of navSections) {
      if (sec.items.some((item) => item.id === currentTab)) {
        initial[sec.title] = true;
      }
    }
    return initial;
  });

  // Automatically expand category if active tab is inside it
  useEffect(() => {
    const parent = navSections.find((sec) => sec.items.some((item) => item.id === currentTab));
    if (parent && !openSections[parent.title]) {
      setOpenSections((prev) => ({ ...prev, [parent.title]: true }));
    }
  }, [currentTab]);

  const toggleSection = (title: string) => {
    setOpenSections((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const handleNavigate = (link: string) => {
    const [path, queryString] = link.replace(/^\//, '').split('?');
    if (queryString && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.search = `?${queryString}`;
      window.history.pushState({}, '', url.toString());
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    const clean = path || 'overview';
    onTabChange(clean as NavItem);
    setIsMobileMenuOpen(false);
  };

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat('en-PK', {
        timeZone: 'Asia/Karachi',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(now);
      setKarachiTime(formatted);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleItemClick = (id: NavItem) => {
    onTabChange(id);
    setIsMobileMenuOpen(false);
  };

  // Render navigation links and collapsible categories
  const renderNavList = () => (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
      {navSections.map((sec) => {
        const visibleItems = sec.items.filter((item) => can(item.permission));
        if (visibleItems.length === 0) return null;

        const isOpen = openSections[sec.title] ?? false;
        const hasActiveChild = visibleItems.some((item) => item.id === currentTab);

        return (
          <div key={sec.title} className="rounded-lg bg-slate-50/50 p-1">
            {/* Category Accordion Header */}
            <button
              type="button"
              onClick={() => toggleSection(sec.title)}
              className="w-full flex items-center justify-between px-2.5 py-2 text-[11px] font-bold tracking-wider uppercase text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors group cursor-pointer"
              aria-expanded={isOpen}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate">{sec.title}</span>
                {hasActiveChild && !isOpen && (
                  <span
                    className="w-2 h-2 rounded-full bg-[#2F64D8] shrink-0 animate-pulse"
                    title="Active page inside"
                  />
                )}
              </div>
              <div className="flex items-center gap-1.5 text-slate-400 group-hover:text-slate-600 shrink-0">
                <span className="text-[10px] font-semibold text-slate-400 bg-white border border-slate-200/80 px-1.5 py-0.5 rounded shadow-2xs">
                  {visibleItems.length}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    isOpen ? 'rotate-0 text-slate-600' : '-rotate-90 text-slate-400'
                  }`}
                />
              </div>
            </button>

            {/* Dropdown Items */}
            {isOpen && (
              <div className="space-y-0.5 mt-1 pt-1 border-t border-slate-200/40">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleItemClick(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-all duration-150 touch-manipulation ${
                        isActive
                          ? 'bg-[#EEF4FF] text-[#2F64D8] font-bold border-l-4 border-[#2F64D8] rounded-r-md rounded-l-none shadow-2xs'
                          : 'text-slate-600 hover:bg-white hover:text-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            isActive ? 'text-[#2F64D8]' : 'text-slate-400'
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {isActive && <ChevronRight className="w-3.5 h-3.5 text-[#2F64D8] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  // Render bottom user profile and sign out
  const renderUserCard = () => (
    <div className="p-3.5 sm:p-4 border-t border-slate-100 bg-[#F7F8FC]/80 flex-shrink-0">
      <div className="flex items-center justify-between">
        <div className="overflow-hidden mr-2">
          <p className="text-xs font-bold text-slate-900 truncate">{user?.name}</p>
          <div className="mt-0.5">
            <Badge
              variant={
                user?.role === 'owner'
                  ? 'default'
                  : user?.role === 'pharmacist'
                    ? 'secondary'
                    : 'outline'
              }
              className={`text-[10px] uppercase font-bold py-0 px-1.5 ${
                user?.role === 'owner' ? 'bg-[#2F64D8] text-white hover:bg-[#2452B6]' : ''
              }`}
            >
              {user?.role}
            </Badge>
          </div>
        </div>
        <button
          onClick={logout}
          title="Sign Out"
          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-full bg-[#F7F8FC] text-slate-800 overflow-hidden font-sans">
      {/* Mobile Drawer Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 md:hidden transition-opacity duration-200"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Drawer (Slide-Over for iOS / Android) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-white text-slate-800 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out md:hidden ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#2F64D8] flex items-center justify-center shadow-md shadow-[#2F64D8]/25 text-white">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div className="overflow-hidden">
              <h1 className="font-bold text-sm tracking-tight truncate text-slate-900">
                {user?.pharmacyName || 'HexaPharm'}
              </h1>
              <p className="text-[11px] text-slate-500 font-medium">Management Portal</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            aria-label="Close navigation menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {renderNavList()}
        {renderUserCard()}
      </aside>

      {/* Desktop Sidebar (Permanent) */}
      <aside className="hidden md:flex md:w-64 bg-white text-slate-800 flex-col flex-shrink-0 border-r border-slate-200/90 shadow-2xs">
        <div className="p-5 border-b border-slate-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#2F64D8] flex items-center justify-center shadow-md shadow-[#2F64D8]/25 text-white">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div className="overflow-hidden">
            <h1 className="font-bold text-sm tracking-tight truncate text-slate-900">
              {user?.pharmacyName || 'HexaPharm'}
            </h1>
            <p className="text-xs text-slate-500 font-medium tracking-wide">Management Portal</p>
          </div>
        </div>

        {renderNavList()}
        {renderUserCard()}
      </aside>

      {/* Main View Area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200/80 px-4 sm:px-6 lg:px-8 flex items-center justify-between flex-shrink-0 shadow-2xs">
          <div className="flex items-center gap-3 sm:gap-6 min-w-0">
            {/* Mobile Hamburger Button */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg md:hidden transition-colors cursor-pointer"
              aria-label="Open Navigation Menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Current View Title */}
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight capitalize truncate">
                {currentTab.replace('-', ' ')}
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-500 font-medium truncate hidden sm:block">
                Live enterprise sync &amp; multi-branch ledger
              </p>
            </div>

            {/* Global Search Button (Desktop) */}
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="hidden lg:flex items-center gap-3 px-3.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50/70 text-slate-500 hover:text-slate-800 hover:border-slate-300 hover:bg-slate-100/80 text-xs transition-all shadow-2xs cursor-pointer"
            >
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <span>Search invoices, medicines...</span>
              <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono font-semibold text-slate-500 shadow-2xs">
                Ctrl+K
              </kbd>
            </button>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            {/* Quick search icon for tablet/mobile */}
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg lg:hidden cursor-pointer"
              title="Search"
              aria-label="Search"
            >
              <Search className="w-4 h-4" />
            </button>

            {/* Notification Bell */}
            <NotificationBell onNavigate={handleNavigate} />

            <div className="h-5 w-px bg-slate-200 hidden sm:block" />

            {/* Asia/Karachi Live Time */}
            <div className="hidden sm:flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 bg-[#F7F8FC] rounded-lg border border-slate-200 text-slate-700 text-xs font-medium">
              <Clock className="w-3.5 h-3.5 text-[#2F64D8]" />
              <span className="text-slate-500 font-medium hidden md:inline">PKT:</span>
              <span className="font-mono font-semibold text-slate-900 text-[11px] sm:text-xs">
                {karachiTime || 'Loading...'}
              </span>
            </div>

            <div className="h-5 w-px bg-slate-200" />

            {/* User Profile Avatar / Name */}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-blue-100 text-[#2F64D8] flex items-center justify-center font-bold text-xs uppercase shadow-2xs">
                {user?.name ? user.name.charAt(0) : 'U'}
              </div>
              <div className="hidden md:block text-left">
                <span className="text-[10px] text-slate-400 block leading-tight">Signed in</span>
                <span className="text-xs font-bold text-slate-800 block leading-tight truncate max-w-[120px]">
                  {user?.name}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Global Ctrl+K Command Palette Modal */}
        <CommandPalette
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          onNavigate={handleNavigate}
        />

        {/* Scrollable Viewport with responsive padding */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-8 bg-slate-50/60">
          <div className="max-w-7xl mx-auto space-y-5 sm:space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
};
