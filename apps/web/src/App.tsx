import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DashboardLayout, type NavItem } from './layout/DashboardLayout';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { SalesReportPage } from './pages/reports/SalesReportPage';
import { StockExpiryReportPage } from './pages/reports/StockExpiryReportPage';
import { ProfitPerBatchReportPage } from './pages/reports/ProfitPerBatchReportPage';
import { SupplierLedgerPage } from './pages/reports/SupplierLedgerPage';
import { UsersPage } from './pages/admin/UsersPage';
import { BranchesCountersPage } from './pages/admin/BranchesCountersPage';
import { DevicesPage } from './pages/admin/DevicesPage';
import { AuditLogPage } from './pages/admin/AuditLogPage';
import { RefreshCw } from 'lucide-react';

const MainAppContent: React.FC = () => {
  const { isAuthenticated, isLoading, isOwner } = useAuth();
  const [currentTab, setCurrentTab] = useState<NavItem>('overview');

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-900 text-white gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
        <span className="text-sm font-semibold tracking-wide">
          Verifying security credentials...
        </span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const renderActiveView = () => {
    switch (currentTab) {
      case 'overview':
        return <OverviewPage />;
      case 'reports-sales':
        return <SalesReportPage />;
      case 'reports-stock':
        return <StockExpiryReportPage />;
      case 'reports-profit':
        return isOwner ? <ProfitPerBatchReportPage /> : <OverviewPage />;
      case 'reports-supplier':
        return isOwner ? <SupplierLedgerPage /> : <OverviewPage />;
      case 'admin-users':
        return isOwner ? <UsersPage /> : <OverviewPage />;
      case 'admin-branches':
        return isOwner ? <BranchesCountersPage /> : <OverviewPage />;
      case 'admin-devices':
        return isOwner ? <DevicesPage /> : <OverviewPage />;
      case 'audit-log':
        return isOwner ? <AuditLogPage /> : <OverviewPage />;
      default:
        return <OverviewPage />;
    }
  };

  return (
    <DashboardLayout currentTab={currentTab} onTabChange={setCurrentTab}>
      {renderActiveView()}
    </DashboardLayout>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <MainAppContent />
    </AuthProvider>
  );
};

export default App;
