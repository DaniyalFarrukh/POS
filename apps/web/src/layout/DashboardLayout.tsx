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
} from 'lucide-react';
import { Badge } from '@pos/ui';

export type NavItem =
  | 'overview'
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
            <p className="text-xs text-slate-400 font-medium tracking-wide">
              Management Portal
            </p>
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
                        <Icon
                          className={`w-4 h-4 ${
                            isActive ? 'text-white' : 'text-slate-400'
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {isActive && (
                        <ChevronRight className="w-3.5 h-3.5 opacity-80" />
                      )}
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
              <p className="text-xs font-semibold text-white truncate">
                {user?.name}
              </p>
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
          <div>
            <h2 className="text-lg font-bold text-slate-800 tracking-tight capitalize">
              {currentTab.replace('-', ' ')}
            </h2>
            <p className="text-xs text-slate-500">
              Live enterprise sync &amp; multi-branch ledger
            </p>
          </div>

          <div className="flex items-center gap-4">
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

        {/* Scrollable Viewport */}
        <main className="flex-1 overflow-y-auto p-8 bg-slate-50/60">
          <div className="max-w-7xl mx-auto space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
};
