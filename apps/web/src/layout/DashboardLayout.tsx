import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Badge } from '@pos/ui';

export type NavItem =
  | 'overview'
  | 'reports-sales'
  | 'reports-stock'
  | 'reports-profit'
  | 'reports-supplier'
  | 'admin-users'
  | 'admin-branches'
  | 'admin-devices'
  | 'audit-log';

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
  const { user, logout, isOwner } = useAuth();
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

  const navSections = [
    {
      title: 'Main',
      items: [
        {
          id: 'overview' as NavItem,
          label: 'Overview',
          icon: LayoutDashboard,
          requiresOwner: false,
        },
      ],
    },
    {
      title: 'Reports & Intelligence',
      items: [
        {
          id: 'reports-sales' as NavItem,
          label: 'Sales Report',
          icon: ReceiptText,
          requiresOwner: false,
        },
        {
          id: 'reports-stock' as NavItem,
          label: 'Stock & Expiry',
          icon: Boxes,
          requiresOwner: false,
        },
        {
          id: 'reports-profit' as NavItem,
          label: 'Profit per Batch',
          icon: TrendingUp,
          requiresOwner: true,
        },
        {
          id: 'reports-supplier' as NavItem,
          label: 'Supplier Ledger',
          icon: Truck,
          requiresOwner: true,
        },
      ],
    },
    {
      title: 'Administration',
      items: [
        {
          id: 'admin-users' as NavItem,
          label: 'Users & Roles',
          icon: Users,
          requiresOwner: true,
        },
        {
          id: 'admin-branches' as NavItem,
          label: 'Branches & Counters',
          icon: Store,
          requiresOwner: true,
        },
        {
          id: 'admin-devices' as NavItem,
          label: 'Registered Devices',
          icon: MonitorSmartphone,
          requiresOwner: true,
        },
        {
          id: 'audit-log' as NavItem,
          label: 'Audit Log Viewer',
          icon: ShieldAlert,
          requiresOwner: true,
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
            const visibleItems = sec.items.filter(
              (item) => !item.requiresOwner || isOwner
            );
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
