import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DashboardLayout, NAV_PERMISSIONS, type NavItem } from './layout/DashboardLayout';
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
import { ChartOfAccountsPage } from './pages/finance/ChartOfAccountsPage';
import { JournalEntriesPage } from './pages/finance/JournalEntriesPage';
import { SuppliersPage } from './pages/suppliers/SuppliersPage';
import { PurchaseOrdersPage } from './pages/inventory/PurchaseOrdersPage';
import { StockTransfersPage } from './pages/inventory/StockTransfersPage';
import { StockLocationsPage } from './pages/inventory/StockLocationsPage';
import { StockCountsPage } from './pages/inventory/StockCountsPage';
import { SupplierReturnsPage } from './pages/inventory/SupplierReturnsPage';
import { StockManagementPage } from './pages/inventory/StockManagementPage';
import { BatchesExpiryPage } from './pages/inventory/BatchesExpiryPage';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { RefreshCw } from 'lucide-react';

const MainAppContent: React.FC = () => {
  const { isAuthenticated, isLoading, can } = useAuth();
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
    const requiredPermission = NAV_PERMISSIONS[currentTab];
    if (requiredPermission && !can(requiredPermission)) {
      return (
        <ForbiddenPage
          requiredPermission={requiredPermission}
          onGoBack={() => setCurrentTab('overview')}
        />
      );
    }

    switch (currentTab) {
      case 'overview':
        return <OverviewPage />;
      case 'stock-management':
        return <StockManagementPage />;
      case 'batches-expiry':
        return <BatchesExpiryPage />;
      case 'stock-transfers':
        return <StockTransfersPage />;
      case 'stock-locations':
        return <StockLocationsPage />;
      case 'stock-counts':
        return <StockCountsPage />;
      case 'supplier-returns':
        return <SupplierReturnsPage />;
      case 'purchase-orders':
        return <PurchaseOrdersPage />;
      case 'suppliers':
        return <SuppliersPage />;
      case 'finance-coa':
        return <ChartOfAccountsPage />;
      case 'finance-journals':
        return <JournalEntriesPage />;
      case 'reports-sales':
        return <SalesReportPage />;
      case 'reports-stock':
        return <StockExpiryReportPage />;
      case 'reports-profit':
        return <ProfitPerBatchReportPage />;
      case 'reports-supplier':
        return <SupplierLedgerPage />;
      case 'admin-users':
        return <UsersPage />;
      case 'admin-branches':
        return <BranchesCountersPage />;
      case 'admin-devices':
        return <DevicesPage />;
      case 'audit-log':
        return <AuditLogPage />;
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
