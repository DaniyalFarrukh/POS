import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DashboardLayout, NAV_PERMISSIONS, type NavItem } from './layout/DashboardLayout';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { PrescriptionsPage } from './pages/prescriptions/PrescriptionsPage';
import { LeaveManagementPage } from './pages/hr/LeaveManagementPage';
import { PayrollPage } from './pages/hr/PayrollPage';
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
import { PaymentsPage } from './pages/finance/PaymentsPage';
import { ExpensesPage } from './pages/finance/ExpensesPage';
import { AccountsReceivablePage } from './pages/finance/AccountsReceivablePage';
import { AccountsPayablePage } from './pages/finance/AccountsPayablePage';
import { CashBankPage } from './pages/finance/CashBankPage';
import { SalesLedgerPage } from './pages/finance/SalesLedgerPage';
import { FinancialReportsPage } from './pages/finance/FinancialReportsPage';
import { BudgetPlanningPage } from './pages/finance/BudgetPlanningPage';
import { PeriodClosePage } from './pages/finance/PeriodClosePage';
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
      <div className="min-h-screen w-full flex items-center justify-center bg-[#F7F8FC] text-slate-800 gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-[#2F64D8]" />
        <span className="text-sm font-semibold tracking-wide text-slate-700">
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
      case 'customers':
        return <CustomersPage />;
      case 'prescriptions':
        return <PrescriptionsPage />;
      case 'hr-leave':
        return <LeaveManagementPage />;
      case 'hr-payroll':
        return <PayrollPage />;
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
      case 'finance-payments':
        return <PaymentsPage />;
      case 'finance-expenses':
        return <ExpensesPage />;
      case 'finance-ar':
        return <AccountsReceivablePage onRecordPayment={() => setCurrentTab('finance-payments')} />;
      case 'finance-ap':
        return <AccountsPayablePage onRecordPayment={() => setCurrentTab('finance-payments')} />;
      case 'finance-cash-bank':
        return <CashBankPage />;
      case 'finance-sales-ledger':
        return <SalesLedgerPage />;
      case 'finance-reports':
        return <FinancialReportsPage />;
      case 'finance-budgets':
        return <BudgetPlanningPage />;
      case 'finance-period-close':
        return <PeriodClosePage />;
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
