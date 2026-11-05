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
} from 'lucide-react';
import { Badge } from '@pos/ui';
import { Search } from 'lucide-react';
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
    // Extract base tab from link like "/customers?customerId=123" -> "customers"
    const clean = link.replace(/^\//, '').split('?')[0] || 'overview';
    onTabChange(clean as NavItem);
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

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-800 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col flex-shrink-0 shadow-xl border-r border-slate-800">
        {/* Pharmacy Brand */}
        <div className="p-5 border-b border-slate-800/80 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div className="overflow-hidden">
            <h1 className="font-bold text-sm tracking-tight truncate text-white">
              {user?.pharmacyName || 'Pharmacy POS'}
            </h1>
            <p className="text-xs text-slate-400 font-medium tracking-wide">Management Portal</p>
          </div>
        </div>

        {/* Navigation List */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {navSections.map((sec) => {
            const visibleItems = sec.items.filter((item) => can(item.permission));
            if (visibleItems.length === 0) return null;

            return (
              <div key={sec.title} className="space-y-1">
                <p className="px-3 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                  {sec.title}
                </p>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onTabChange(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {isActive && <ChevronRight className="w-3.5 h-3.5 opacity-80" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* User Card & Logout */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40">
          <div className="flex items-center justify-between">
            <div className="overflow-hidden mr-2">
              <p className="text-xs font-semibold text-white truncate">{user?.name}</p>
              <div className="mt-0.5">
                <Badge
                  variant={
                    user?.role === 'owner'
                      ? 'default'
                      : user?.role === 'pharmacist'
                        ? 'secondary'
                        : 'outline'
                  }
                  className="text-[10px] uppercase font-bold py-0 px-1.5"
                >
                  {user?.role}
                </Badge>
              </div>
            </div>
            <button
              onClick={logout}
              title="Sign Out"
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800/60 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200/80 px-8 flex items-center justify-between flex-shrink-0 shadow-sm">
          <div className="flex items-center gap-6">
            <div>
              <h2 className="text-lg font-bold text-slate-800 tracking-tight capitalize">
                {currentTab.replace('-', ' ')}
              </h2>
              <p className="text-xs text-slate-500">
                Live enterprise sync &amp; multi-branch ledger
              </p>
            </div>

            {/* Quick Global Search Trigger */}
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="hidden md:flex items-center gap-3 px-3.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 hover:text-slate-700 hover:border-slate-300 hover:bg-slate-100/80 text-xs transition-all shadow-xs"
            >
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <span>Search invoices, medicines, customers...</span>
              <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono font-semibold text-slate-500 shadow-xs">
                Ctrl+K
              </kbd>
            </button>
          </div>

          <div className="flex items-center gap-4">
            {/* Notification Bell with per-user read state */}
            <NotificationBell onNavigate={handleNavigate} />

            <div className="h-6 w-px bg-slate-200" />

            {/* Asia/Karachi Live Time */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200/60 text-slate-700 text-xs font-medium">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span>PKT:</span>
              <span className="font-mono font-semibold">{karachiTime || 'Loading...'}</span>
            </div>

            <div className="h-6 w-px bg-slate-200" />

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Signed in as:</span>
              <span className="text-xs font-bold text-slate-800">{user?.name}</span>
            </div>
          </div>
        </header>

        {/* Global Ctrl+K Command Palette Modal */}
        <CommandPalette
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          onNavigate={handleNavigate}
        />

        {/* Scrollable Viewport */}
        <main className="flex-1 overflow-y-auto p-8 bg-slate-50/60">
          <div className="max-w-7xl mx-auto space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
};
