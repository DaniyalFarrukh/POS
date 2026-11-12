import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { parsePkrToPaisa, getKarachiBusinessDate } from '@pos/shared';
import type {
  PayrollRunRecord,
  PayrollItemRecord,
  PayrollStatutoryComponentRecord,
  PayrollTaxSlabRecord,
  EmployeeAdvanceRecord,
  PayslipRecord,
  BranchRecord,
  EmployeeRecord,
  AccountRecord,
} from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import {
  formatPKR,
  getPayrollStatusBadge,
  formatAllowancesSummary,
  formatStatutorySummary,
  filterPayrollRuns,
} from '../../lib/payroll-utils';
import {
  Card,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Button,
  Badge,
  Input,
} from '@pos/ui';
import {
  Banknote,
  Coins,
  CheckCircle,
  AlertTriangle,
  Search,
  Plus,
  RefreshCw,
  FileText,
  Printer,
  X,
  CreditCard,
  Building2,
  Lock,
  ArrowRight,
  ShieldAlert,
  ArrowLeft,
  DollarSign,
  TrendingUp,
  Receipt,
} from 'lucide-react';

export const PayrollPage: React.FC = () => {
  const { can, user } = useAuth();
  const isManagerOrOwner = can('hr.payroll.manage');
  const isOwner = user?.role === 'owner';

  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'runs' | 'advances' | 'config'>('runs');

  // Loading & notification states
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Data states
  const [runsList, setRunsList] = useState<PayrollRunRecord[]>([]);
  const [branchesList, setBranchesList] = useState<BranchRecord[]>([]);
  const [employeesList, setEmployeesList] = useState<EmployeeRecord[]>([]);
  const [accountsList, setAccountsList] = useState<AccountRecord[]>([]);
  const [statutoryRates, setStatutoryRates] = useState<PayrollStatutoryComponentRecord[]>([]);
  const [taxSlabs, setTaxSlabs] = useState<PayrollTaxSlabRecord[]>([]);
  const [advancesList, setAdvancesList] = useState<EmployeeAdvanceRecord[]>([]);

  // Selected run state
  const [selectedRun, setSelectedRun] = useState<PayrollRunRecord | null>(null);
  const [selectedRunItems, setSelectedRunItems] = useState<PayrollItemRecord[]>([]);

  // Filter states
  const currentMonthStr = useMemo(() => getKarachiBusinessDate().slice(0, 7), []);
  const [filterMonth, setFilterMonth] = useState<string>(currentMonthStr);
  const [filterBranchId, setFilterBranchId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [itemSearchTerm, setItemSearchTerm] = useState('');

  // Modals
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showDisburseModal, setShowDisburseModal] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [showEditItemModal, setShowEditItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<PayrollItemRecord | null>(null);
  const [showNewAdvanceModal, setShowNewAdvanceModal] = useState(false);
  const [showNewComponentModal, setShowNewComponentModal] = useState(false);
  const [showNewTaxSlabModal, setShowNewTaxSlabModal] = useState(false);
  const [viewingPayslip, setViewingPayslip] = useState<PayslipRecord | null>(null);

  // Form states - Generate Run
  const [genBranchId, setGenBranchId] = useState('');
  const [genMonth, setGenMonth] = useState(currentMonthStr);
  const [genWorkingDays, setGenWorkingDays] = useState(26);

  // Form states - Disburse Batch
  const [disburseAccountId, setDisburseAccountId] = useState('');
  const [disburseReference, setDisburseReference] = useState('');
  const [disburseDate, setDisburseDate] = useState(() => getKarachiBusinessDate());

  // Form states - Adjustment Run
  const [adjustmentReason, setAdjustmentReason] = useState('');

  // Form states - Edit Item
  const [editOvertimeHours, setEditOvertimeHours] = useState('0');
  const [editAdvanceRecoveryRs, setEditAdvanceRecoveryRs] = useState('0');
  const [editTaxRs, setEditTaxRs] = useState('0');
  const [editNotes, setEditNotes] = useState('');

  // Form states - New Advance
  const [advEmployeeId, setAdvEmployeeId] = useState('');
  const [advPrincipalRs, setAdvPrincipalRs] = useState('10000');
  const [advInstallmentRs, setAdvInstallmentRs] = useState('2000');
  const [advDisbursementDate, setAdvDisbursementDate] = useState(() => getKarachiBusinessDate());
  const [advReason, setAdvReason] = useState('');

  // Form states - Statutory Component
  const [compCode, setCompCode] = useState('');
  const [compName, setCompName] = useState('');
  const [compType, setCompType] = useState<'statutory_deduction' | 'tax'>('statutory_deduction');
  const [compCalcType, setCompCalcType] = useState<'fixed' | 'percentage'>('fixed');
  const [compAmountRs, setCompAmountRs] = useState('1500');
  const [compPercentageRate, setCompPercentageRate] = useState('1.00');
  const [compAccountCode, setCompAccountCode] = useState('2210');
  const [compNotes, setCompNotes] = useState('');

  // Form states - Tax Slab
  const [slabMinRs, setSlabMinRs] = useState('50000');
  const [slabMaxRs, setSlabMaxRs] = useState('100000');
  const [slabBaseTaxRs, setSlabBaseTaxRs] = useState('0');
  const [slabExcessRate, setSlabExcessRate] = useState('2.50');
  const [slabNotes, setSlabNotes] = useState('');

  // Fetch Core Reference Data
  const loadReferenceData = useCallback(async () => {
    try {
      const [branchRes, empRes, accRes] = await Promise.all([
        apiFetch<{ items?: BranchRecord[]; data?: BranchRecord[] }>('/api/admin/branches').catch(
          () => ({ items: [] as BranchRecord[], data: [] as BranchRecord[] })
        ),
        apiFetch<{ success: boolean; data: EmployeeRecord[] }>('/api/hr/employees').catch(() => ({
          success: false,
          data: [] as EmployeeRecord[],
        })),
        apiFetch<{ accounts?: AccountRecord[]; data?: AccountRecord[] }>(
          '/api/finance/accounts'
        ).catch(() => ({ accounts: [] as AccountRecord[], data: [] as AccountRecord[] })),
      ]);

      const branches: BranchRecord[] = branchRes.items || branchRes.data || [];
      setBranchesList(branches);
      if (branches.length > 0 && !genBranchId) {
        setGenBranchId(branches[0]!.id);
      }

      const emps: EmployeeRecord[] = empRes.data || [];
      setEmployeesList(emps);
      if (emps.length > 0 && !advEmployeeId) {
        setAdvEmployeeId(emps[0]!.id);
      }

      const accounts: AccountRecord[] = accRes.accounts || accRes.data || [];
      // Filter cash & bank accounts (code starts with 1000 or 1010 or type Asset)
      const cashBankAccounts = accounts.filter(
        (a: AccountRecord) => a.code.startsWith('10') || a.type === 'asset'
      );
      setAccountsList(cashBankAccounts);
      if (cashBankAccounts.length > 0 && !disburseAccountId) {
        setDisburseAccountId(cashBankAccounts[0]!.id);
      }
    } catch {
      // Non-fatal reference data fetch
    }
  }, [genBranchId, advEmployeeId, disburseAccountId]);

  // Fetch Payroll Runs
  const loadRuns = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: PayrollRunRecord[] }>(
        '/api/hr/payroll/runs'
      );
      if (res.success) {
        setRunsList(res.data || []);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load payroll runs';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch Run Items when selected
  const loadRunDetails = useCallback(async (runId: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [runRes, itemsRes] = await Promise.all([
        apiFetch<{ success: boolean; data: PayrollRunRecord }>(`/api/hr/payroll/runs/${runId}`),
        apiFetch<{ success: boolean; data: PayrollItemRecord[] }>(
          `/api/hr/payroll/runs/${runId}/items`
        ),
      ]);
      if (runRes.success) setSelectedRun(runRes.data);
      if (itemsRes.success) setSelectedRunItems(itemsRes.data || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load run items';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch Configuration & Advances
  const loadConfigData = useCallback(async () => {
    try {
      const [statRes, taxRes, advRes] = await Promise.all([
        apiFetch<{ success: boolean; data: PayrollStatutoryComponentRecord[] }>(
          '/api/hr/payroll/statutory-rates'
        ),
        apiFetch<{ success: boolean; data: PayrollTaxSlabRecord[] }>('/api/hr/payroll/tax-slabs'),
        apiFetch<{ success: boolean; data: EmployeeAdvanceRecord[] }>('/api/hr/payroll/advances'),
      ]);
      if (statRes.success) setStatutoryRates(statRes.data || []);
      if (taxRes.success) setTaxSlabs(taxRes.data || []);
      if (advRes.success) setAdvancesList(advRes.data || []);
    } catch {
      // Silent error handled via tab refresh
    }
  }, []);

  useEffect(() => {
    loadReferenceData();
    loadRuns();
    loadConfigData();
  }, [loadReferenceData, loadRuns, loadConfigData]);

  // Handler: Generate Run
  const handleGenerateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genBranchId || !genMonth) {
      setErrorMsg('Branch and month are required');
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: PayrollRunRecord }>(
        '/api/hr/payroll/runs/generate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            branchId: genBranchId,
            month: genMonth,
            workingDays: Number(genWorkingDays),
          }),
        }
      );
      if (res.success) {
        setSuccessMsg(`Generated payroll run ${res.data.runNumber} successfully.`);
        setShowGenerateModal(false);
        await loadRuns();
        await loadRunDetails(res.data.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate payroll run';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Review Run
  const handleReviewRun = async () => {
    if (!selectedRun) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: PayrollRunRecord }>(
        `/api/hr/payroll/runs/${selectedRun.id}/review`,
        { method: 'POST' }
      );
      if (res.success) {
        setSuccessMsg(`Payroll run ${selectedRun.runNumber} marked as Reviewed.`);
        setSelectedRun(res.data);
        await loadRuns();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to review run';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Approve Run
  const handleApproveRun = async () => {
    if (!selectedRun) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: PayrollRunRecord }>(
        `/api/hr/payroll/runs/${selectedRun.id}/approve`,
        { method: 'POST' }
      );
      if (res.success) {
        setSuccessMsg(`Payroll run ${selectedRun.runNumber} Approved and calculations locked.`);
        setSelectedRun(res.data);
        await loadRuns();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to approve run';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Post to Ledger
  const handlePostToLedger = async () => {
    if (!selectedRun) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{
        success: boolean;
        data: PayrollRunRecord;
        journalEntryId: string;
      }>(`/api/hr/payroll/runs/${selectedRun.id}/post-ledger`, { method: 'POST' });
      if (res.success) {
        setSuccessMsg(
          `Payroll run ${selectedRun.runNumber} posted to General Ledger (JE #${res.journalEntryId.substring(0, 8)}).`
        );
        setSelectedRun(res.data);
        await loadRuns();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to post payroll run to ledger';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Disburse Payment Batch
  const handleDisburseBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRun || !disburseAccountId) {
      setErrorMsg('Payment account is required');
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: PayrollRunRecord }>(
        `/api/hr/payroll/runs/${selectedRun.id}/pay`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentAccountId: disburseAccountId,
            paymentReference: disburseReference || undefined,
            paymentDate: disburseDate,
          }),
        }
      );
      if (res.success) {
        setSuccessMsg(`Payment batch disbursed successfully for ${selectedRun.runNumber}.`);
        setShowDisburseModal(false);
        setSelectedRun(res.data);
        await loadRunDetails(selectedRun.id);
        await loadRuns();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to disburse payment batch';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Create Adjustment Run
  const handleCreateAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRun || !adjustmentReason.trim()) {
      setErrorMsg('Adjustment reason is required');
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: PayrollRunRecord }>(
        `/api/hr/payroll/runs/${selectedRun.id}/adjustment`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: adjustmentReason.trim() }),
        }
      );
      if (res.success) {
        setSuccessMsg(`Adjustment run ${res.data.runNumber} created as Draft.`);
        setShowAdjustmentModal(false);
        setAdjustmentReason('');
        await loadRuns();
        await loadRunDetails(res.data.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create adjustment run';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Open Edit Item Modal
  const openEditItemModal = (item: PayrollItemRecord) => {
    setEditingItem(item);
    setEditOvertimeHours(String(item.overtimeHours));
    setEditAdvanceRecoveryRs(String(item.advanceRecoveryPaisa / 100));
    setEditTaxRs(String(item.taxPaisa / 100));
    setEditNotes('');
    setShowEditItemModal(true);
  };

  // Handler: Save Edit Item
  const handleSaveEditItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRun || !editingItem) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: PayrollItemRecord }>(
        `/api/hr/payroll/runs/${selectedRun.id}/items/${editingItem.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            overtimeHours: parseFloat(editOvertimeHours) || 0,
            advanceRecoveryPaisa: parsePkrToPaisa(editAdvanceRecoveryRs),
            taxPaisa: parsePkrToPaisa(editTaxRs),
            notes: editNotes.trim() || undefined,
          }),
        }
      );
      if (res.success) {
        setSuccessMsg(`Item for ${editingItem.employeeName} updated successfully.`);
        setShowEditItemModal(false);
        setEditingItem(null);
        await loadRunDetails(selectedRun.id);
        await loadRuns();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update item';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: View Payslip
  const handleViewPayslip = async (item: PayrollItemRecord) => {
    if (!selectedRun) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: PayslipRecord }>(
        `/api/hr/payroll/runs/${selectedRun.id}/payslips/${item.id}`
      );
      if (res.success) {
        setViewingPayslip(res.data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load payslip';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Issue Advance
  const handleIssueAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advEmployeeId) {
      setErrorMsg('Employee is required');
      return;
    }
    const principalPaisa = parsePkrToPaisa(advPrincipalRs);
    const installmentPaisa = parsePkrToPaisa(advInstallmentRs);
    if (principalPaisa <= 0 || installmentPaisa <= 0) {
      setErrorMsg('Principal and installment must be greater than zero');
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: EmployeeAdvanceRecord }>(
        '/api/hr/payroll/advances',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId: advEmployeeId,
            principalPaisa,
            monthlyInstallmentPaisa: installmentPaisa,
            disbursementDate: advDisbursementDate,
            reason: advReason.trim() || undefined,
          }),
        }
      );
      if (res.success) {
        setSuccessMsg('Salary advance issued successfully.');
        setShowNewAdvanceModal(false);
        setAdvReason('');
        await loadConfigData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to issue advance';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Add Statutory Component
  const handleCreateComponent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!compCode.trim() || !compName.trim()) {
      setErrorMsg('Code and Name are required');
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: PayrollStatutoryComponentRecord }>(
        '/api/hr/payroll/statutory-rates',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: compCode.trim().toUpperCase(),
            name: compName.trim(),
            componentType: compType,
            calculationType: compCalcType,
            fixedAmountPaisa: compCalcType === 'fixed' ? parsePkrToPaisa(compAmountRs) : 0,
            percentageRate: compCalcType === 'percentage' ? compPercentageRate : '0.00',
            accountCode: compAccountCode.trim() || '2210',
            notes: compNotes.trim() || undefined,
            isExample: false,
          }),
        }
      );
      if (res.success) {
        setSuccessMsg(`Statutory component ${res.data.code} created.`);
        setShowNewComponentModal(false);
        setCompCode('');
        setCompName('');
        setCompNotes('');
        await loadConfigData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create component';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Delete Statutory Component
  const handleDeleteComponent = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this statutory component?')) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/hr/payroll/statutory-rates/${id}`, { method: 'DELETE' });
      setSuccessMsg('Statutory component deleted.');
      await loadConfigData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete component';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Add Tax Slab
  const handleCreateTaxSlab = async (e: React.FormEvent) => {
    e.preventDefault();
    const minPaisa = parsePkrToPaisa(slabMinRs);
    const maxPaisa = slabMaxRs ? parsePkrToPaisa(slabMaxRs) : null;
    const basePaisa = parsePkrToPaisa(slabBaseTaxRs);
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: PayrollTaxSlabRecord }>(
        '/api/hr/payroll/tax-slabs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            minMonthlyIncomePaisa: minPaisa,
            maxMonthlyIncomePaisa: maxPaisa,
            baseTaxPaisa: basePaisa,
            excessRatePercentage: slabExcessRate,
            notes: slabNotes.trim() || undefined,
            isExample: false,
          }),
        }
      );
      if (res.success) {
        setSuccessMsg('Tax slab bracket added successfully.');
        setShowNewTaxSlabModal(false);
        setSlabNotes('');
        await loadConfigData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create tax slab';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Handler: Delete Tax Slab
  const handleDeleteTaxSlab = async (id: string) => {
    if (!window.confirm('Delete this tax slab bracket?')) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/hr/payroll/tax-slabs/${id}`, { method: 'DELETE' });
      setSuccessMsg('Tax slab removed.');
      await loadConfigData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete tax slab';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Filtered runs list
  const filteredRuns = useMemo(() => {
    return filterPayrollRuns(runsList, {
      month: filterMonth,
      branchId: filterBranchId,
      status: filterStatus,
    });
  }, [runsList, filterMonth, filterBranchId, filterStatus]);

  // Filtered items in selected run
  const filteredRunItems = useMemo(() => {
    if (!itemSearchTerm.trim()) return selectedRunItems;
    const query = itemSearchTerm.toLowerCase();
    return selectedRunItems.filter(
      (item) =>
        item.employeeName.toLowerCase().includes(query) ||
        item.employeeCode.toLowerCase().includes(query) ||
        item.designation.toLowerCase().includes(query)
    );
  }, [selectedRunItems, itemSearchTerm]);

  return (
    <div className="space-y-6 p-6">
      {/* Top Banner / Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <Banknote className="h-7 w-7 text-emerald-400" />
              Monthly Payroll Management
            </h1>
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
              HR & GL Integrated
            </Badge>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            End-to-end branch payroll runs, attendance-adjusted earnings, statutory & tax slabs,
            double-entry GL postings, and payslips.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadRuns();
              loadConfigData();
              if (selectedRun) loadRunDetails(selectedRun.id);
            }}
            disabled={isLoading}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {isManagerOrOwner && (
            <Button
              size="sm"
              onClick={() => setShowGenerateModal(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-sm"
            >
              <Plus className="h-4 w-4" />
              Generate Monthly Run
            </Button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="p-4 rounded-lg bg-red-950/60 border border-red-800 text-red-200 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-200 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Primary Tab Navigation */}
      <div className="flex border-b border-slate-800 space-x-6">
        <button
          onClick={() => {
            setActiveTab('runs');
            setSelectedRun(null);
          }}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'runs'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Receipt className="h-4 w-4" />
          Payroll Runs
        </button>

        <button
          onClick={() => setActiveTab('advances')}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'advances'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Coins className="h-4 w-4" />
          Advances & Loans
        </button>

        <button
          onClick={() => setActiveTab('config')}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'config'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldAlert className="h-4 w-4" />
          Statutory & Tax Rates
          <Badge
            variant="outline"
            className="text-amber-400 border-amber-500/40 text-xs px-1.5 py-0"
          >
            Accountant Verified
          </Badge>
        </button>
      </div>

      {/* ======================================================== */}
      {/* TAB 1: PAYROLL RUNS */}
      {/* ======================================================== */}
      {activeTab === 'runs' && (
        <div className="space-y-6">
          {selectedRun ? (
            /* Run Details Sub-view */
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedRun(null)}
                  className="text-slate-300 hover:text-white flex items-center gap-1.5"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to All Runs
                </Button>

                <div className="flex items-center gap-2">
                  {selectedRun.isAdjustmentRun && (
                    <Badge variant="destructive" className="flex items-center gap-1">
                      Adjustment Run
                    </Badge>
                  )}
                  {(() => {
                    const badge = getPayrollStatusBadge(selectedRun.status);
                    return <Badge variant={badge.variant}>{badge.label}</Badge>;
                  })()}
                </div>
              </div>

              {/* Run Overview Header Card */}
              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-6">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-white tracking-wide">
                          {selectedRun.runNumber}
                        </h2>
                        <span className="text-sm px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300">
                          {selectedRun.month}
                        </span>
                        {selectedRun.branchName && (
                          <span className="text-sm px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 flex items-center gap-1">
                            <Building2 className="h-3 w-3 text-slate-400" />
                            {selectedRun.branchName}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">
                        Created on {selectedRun.createdAt.substring(0, 10)}
                        {selectedRun.approvedAt &&
                          ` • Approved on ${selectedRun.approvedAt.substring(0, 10)}`}
                        {selectedRun.paidAt && ` • Paid on ${selectedRun.paidAt.substring(0, 10)}`}
                      </p>
                    </div>

                    {/* Run Lifecycle Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedRun.status === 'draft' && isManagerOrOwner && (
                        <Button
                          size="sm"
                          onClick={handleReviewRun}
                          className="bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5"
                          disabled={isLoading}
                        >
                          <CheckCircle className="h-4 w-4" />
                          Mark Reviewed
                        </Button>
                      )}

                      {selectedRun.status === 'reviewed' && isManagerOrOwner && (
                        <Button
                          size="sm"
                          onClick={handleApproveRun}
                          className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5"
                          disabled={isLoading}
                        >
                          <Lock className="h-4 w-4" />
                          Approve & Lock Run
                        </Button>
                      )}

                      {selectedRun.status === 'approved' && isManagerOrOwner && (
                        <Button
                          size="sm"
                          onClick={handlePostToLedger}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
                          disabled={isLoading}
                        >
                          <DollarSign className="h-4 w-4" />
                          Post to General Ledger
                        </Button>
                      )}

                      {selectedRun.status === 'posted' && isManagerOrOwner && (
                        <Button
                          size="sm"
                          onClick={() => setShowDisburseModal(true)}
                          className="bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-1.5"
                          disabled={isLoading}
                        >
                          <CreditCard className="h-4 w-4" />
                          Disburse Payment Batch
                        </Button>
                      )}

                      {['approved', 'posted', 'paid'].includes(selectedRun.status) &&
                        isManagerOrOwner && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setShowAdjustmentModal(true)}
                            className="border-slate-700 text-slate-300 hover:text-white flex items-center gap-1.5"
                            disabled={isLoading}
                          >
                            <TrendingUp className="h-4 w-4" />
                            New Adjustment Run
                          </Button>
                        )}
                    </div>
                  </div>

                  {/* Financial Metrics Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800">
                    <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                      <div className="text-xs text-slate-400">Total Gross Salary</div>
                      <div className="text-lg font-bold text-white mt-1">
                        {formatPKR(selectedRun.totalGrossPaisa)}
                      </div>
                    </div>

                    <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                      <div className="text-xs text-slate-400">Total Deductions</div>
                      <div className="text-lg font-bold text-red-400 mt-1">
                        {formatPKR(selectedRun.totalDeductionsPaisa)}
                      </div>
                    </div>

                    <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                      <div className="text-xs text-slate-400">Total Net Payable</div>
                      <div className="text-lg font-bold text-emerald-400 mt-1">
                        {formatPKR(selectedRun.totalNetPaisa)}
                      </div>
                    </div>

                    <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                      <div className="text-xs text-slate-400">Advances Recovered</div>
                      <div className="text-lg font-bold text-amber-400 mt-1">
                        {formatPKR(selectedRun.totalAdvancesRecoveredPaisa)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Items Search and Table */}
              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="relative w-full sm:w-72">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        placeholder="Search employee by name or code..."
                        value={itemSearchTerm}
                        onChange={(e) => setItemSearchTerm(e.target.value)}
                        className="pl-9 bg-slate-950 border-slate-700 text-white placeholder-slate-500"
                      />
                    </div>
                    <div className="text-xs text-slate-400">
                      Showing {filteredRunItems.length} of {selectedRunItems.length} employee
                      payslips
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <Table>
                      <TableHeader className="bg-slate-950/80">
                        <TableRow className="border-slate-800">
                          <TableHead className="text-slate-300">Employee</TableHead>
                          <TableHead className="text-slate-300">Base Salary</TableHead>
                          <TableHead className="text-slate-300">Attendance</TableHead>
                          <TableHead className="text-slate-300">Overtime</TableHead>
                          <TableHead className="text-slate-300">Allowances</TableHead>
                          <TableHead className="text-slate-300">Gross Salary</TableHead>
                          <TableHead className="text-slate-300">Tax & Statutory</TableHead>
                          <TableHead className="text-slate-300">Advance Rec.</TableHead>
                          <TableHead className="text-slate-300">Net Payable</TableHead>
                          <TableHead className="text-slate-300">Status</TableHead>
                          <TableHead className="text-slate-300 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRunItems.length === 0 ? (
                          <TableRow className="border-slate-800">
                            <TableCell colSpan={11} className="text-center py-8 text-slate-400">
                              No employee payroll items found.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredRunItems.map((item) => (
                            <TableRow
                              key={item.id}
                              className="border-slate-800 hover:bg-slate-800/40"
                            >
                              <TableCell>
                                <div className="font-semibold text-white">{item.employeeName}</div>
                                <div className="text-xs text-slate-400">
                                  {item.employeeCode} • {item.designation}
                                </div>
                              </TableCell>
                              <TableCell className="text-slate-300 font-mono text-sm">
                                {formatPKR(item.baseSalaryPaisa)}
                              </TableCell>
                              <TableCell>
                                <div className="text-xs text-slate-300">
                                  {item.attendedDays} / {item.workingDays} days
                                </div>
                                {item.unpaidLeaveDays > 0 && (
                                  <div className="text-xs text-red-400 font-mono">
                                    -{formatPKR(item.unpaidLeaveDeductionPaisa)} (
                                    {item.unpaidLeaveDays} unpaid)
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-slate-300 font-mono text-xs">
                                {item.overtimeHours > 0 ? (
                                  <span>
                                    {item.overtimeHours} hrs (+{formatPKR(item.overtimeAmountPaisa)}
                                    )
                                  </span>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-slate-300 font-mono text-xs">
                                {item.allowancesPaisa > 0 ? (
                                  <span title={formatAllowancesSummary(item.allowancesBreakdown)}>
                                    +{formatPKR(item.allowancesPaisa)}
                                  </span>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-slate-200 font-mono font-semibold text-sm">
                                {formatPKR(item.grossSalaryPaisa)}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-red-400">
                                <div>Tax: {formatPKR(item.taxPaisa)}</div>
                                <div title={formatStatutorySummary(item.statutoryBreakdown)}>
                                  Stat: {formatPKR(item.statutoryDeductionsPaisa)}
                                </div>
                              </TableCell>
                              <TableCell className="font-mono text-xs text-amber-400">
                                {item.advanceRecoveryPaisa > 0
                                  ? `-${formatPKR(item.advanceRecoveryPaisa)}`
                                  : '—'}
                              </TableCell>
                              <TableCell className="font-mono font-bold text-sm text-emerald-400">
                                {formatPKR(item.netSalaryPaisa)}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={item.paymentStatus === 'paid' ? 'success' : 'secondary'}
                                  className="text-xs"
                                >
                                  {item.paymentStatus === 'paid' ? 'Paid' : 'Pending'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {selectedRun.status === 'draft' && isManagerOrOwner && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => openEditItemModal(item)}
                                      className="text-slate-300 hover:text-white h-7 px-2 text-xs"
                                    >
                                      Edit
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleViewPayslip(item)}
                                    className="border-slate-700 text-slate-300 hover:text-white h-7 px-2 text-xs flex items-center gap-1"
                                  >
                                    <FileText className="h-3 w-3" />
                                    Payslip
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            /* Runs List Sub-view */
            <div className="space-y-6">
              {/* Filter Strip */}
              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Month (YYYY-MM)</label>
                      <Input
                        type="month"
                        value={filterMonth}
                        onChange={(e) => setFilterMonth(e.target.value)}
                        className="bg-slate-950 border-slate-700 text-white"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Branch</label>
                      <select
                        value={filterBranchId}
                        onChange={(e) => setFilterBranchId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="all">All Branches</option>
                        {branchesList.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Status</label>
                      <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="all">All Statuses</option>
                        <option value="draft">Draft</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="approved">Approved</option>
                        <option value="posted">Posted to GL</option>
                        <option value="paid">Paid & Disbursed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>

                    <div className="flex items-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setFilterMonth('');
                          setFilterBranchId('all');
                          setFilterStatus('all');
                        }}
                        className="w-full text-xs"
                      >
                        Reset Filters
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Runs Table */}
              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-white">Monthly Payroll Runs</h3>
                    <span className="text-xs text-slate-400">
                      Showing {filteredRuns.length} of {runsList.length} runs
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <Table>
                      <TableHeader className="bg-slate-950/80">
                        <TableRow className="border-slate-800">
                          <TableHead className="text-slate-300">Run Number</TableHead>
                          <TableHead className="text-slate-300">Branch</TableHead>
                          <TableHead className="text-slate-300">Month</TableHead>
                          <TableHead className="text-slate-300">Gross Salary</TableHead>
                          <TableHead className="text-slate-300">Deductions</TableHead>
                          <TableHead className="text-slate-300">Net Payable</TableHead>
                          <TableHead className="text-slate-300">Status</TableHead>
                          <TableHead className="text-slate-300 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRuns.length === 0 ? (
                          <TableRow className="border-slate-800">
                            <TableCell colSpan={8} className="text-center py-8 text-slate-400">
                              No payroll runs found for the selected filters.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredRuns.map((run) => {
                            const badge = getPayrollStatusBadge(run.status);
                            return (
                              <TableRow
                                key={run.id}
                                className="border-slate-800 hover:bg-slate-800/40 cursor-pointer"
                                onClick={() => loadRunDetails(run.id)}
                              >
                                <TableCell className="font-semibold text-white">
                                  <div className="flex items-center gap-1.5">
                                    <span>{run.runNumber}</span>
                                    {run.isAdjustmentRun && (
                                      <Badge
                                        variant="destructive"
                                        className="text-[10px] py-0 px-1"
                                      >
                                        Adj
                                      </Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-slate-300">
                                  {run.branchName || 'All Branches'}
                                </TableCell>
                                <TableCell className="text-slate-300 font-mono text-sm">
                                  {run.month}
                                </TableCell>
                                <TableCell className="font-mono text-slate-200">
                                  {formatPKR(run.totalGrossPaisa)}
                                </TableCell>
                                <TableCell className="font-mono text-red-400">
                                  {formatPKR(run.totalDeductionsPaisa)}
                                </TableCell>
                                <TableCell className="font-mono font-bold text-emerald-400">
                                  {formatPKR(run.totalNetPaisa)}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={badge.variant}>{badge.label}</Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      loadRunDetails(run.id);
                                    }}
                                    className="text-slate-300 hover:text-white flex items-center gap-1 ml-auto"
                                  >
                                    View Details
                                    <ArrowRight className="h-3.5 w-3.5" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 2: ADVANCES & LOANS */}
      {/* ======================================================== */}
      {activeTab === 'advances' && (
        <div className="space-y-6">
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-6 space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-white">Employee Salary Advances & Loans</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Advances are automatically recovered in monthly payroll installments until fully
                    amortized.
                  </p>
                </div>

                {isManagerOrOwner && (
                  <Button
                    size="sm"
                    onClick={() => setShowNewAdvanceModal(true)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    Issue New Advance
                  </Button>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <Table>
                  <TableHeader className="bg-slate-950/80">
                    <TableRow className="border-slate-800">
                      <TableHead className="text-slate-300">Employee</TableHead>
                      <TableHead className="text-slate-300">Date</TableHead>
                      <TableHead className="text-slate-300">Principal</TableHead>
                      <TableHead className="text-slate-300">Recovered</TableHead>
                      <TableHead className="text-slate-300">Remaining Balance</TableHead>
                      <TableHead className="text-slate-300">Monthly Installment</TableHead>
                      <TableHead className="text-slate-300">Reason</TableHead>
                      <TableHead className="text-slate-300">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {advancesList.length === 0 ? (
                      <TableRow className="border-slate-800">
                        <TableCell colSpan={8} className="text-center py-8 text-slate-400">
                          No salary advances recorded.
                        </TableCell>
                      </TableRow>
                    ) : (
                      advancesList.map((adv) => (
                        <TableRow key={adv.id} className="border-slate-800 hover:bg-slate-800/40">
                          <TableCell className="font-medium text-white">
                            {adv.employeeName || adv.employeeId}
                          </TableCell>
                          <TableCell className="text-slate-300 font-mono text-xs">
                            {adv.disbursementDate}
                          </TableCell>
                          <TableCell className="font-mono text-slate-200">
                            {formatPKR(adv.principalPaisa)}
                          </TableCell>
                          <TableCell className="font-mono text-emerald-400">
                            {formatPKR(adv.recoveredPaisa)}
                          </TableCell>
                          <TableCell className="font-mono font-bold text-amber-400">
                            {formatPKR(adv.remainingPaisa)}
                          </TableCell>
                          <TableCell className="font-mono text-slate-300">
                            {formatPKR(adv.monthlyInstallmentPaisa)}
                          </TableCell>
                          <TableCell className="text-slate-400 text-xs max-w-xs truncate">
                            {adv.reason || 'None'}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                adv.status === 'active'
                                  ? 'default'
                                  : adv.status === 'recovered'
                                    ? 'success'
                                    : 'destructive'
                              }
                            >
                              {adv.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 3: STATUTORY & TAX CONFIGURATION */}
      {/* ======================================================== */}
      {activeTab === 'config' && (
        <div className="space-y-6">
          {/* Statutory & Legal Warning Banner */}
          <div className="p-4 rounded-lg bg-amber-950/40 border border-amber-600/60 text-amber-200 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-amber-400">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
              <span>Configurable Statutory Rates & Income Tax Warning</span>
            </div>
            <p className="text-xs text-amber-300/90 leading-relaxed">
              Statutory rates (EOBI, PESSI, Provincial Social Security) and progressive income tax
              slabs are configurable business parameters and must be verified by a qualified
              Pakistani chartered accountant or licensed tax advisor. Rates and legal brackets vary
              across provinces and change with annual federal finance acts. Any entries labeled with
              an <strong>Example Rate</strong> tag are illustrative only and should be verified
              prior to posting live payrolls.
            </p>
          </div>

          {/* Statutory Deductions Table */}
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-6 space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-white">
                    Statutory Components (EOBI, Social Security, etc.)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Configured deductions credit corresponding general ledger accounts on payroll
                    run posting.
                  </p>
                </div>

                {isOwner && (
                  <Button
                    size="sm"
                    onClick={() => setShowNewComponentModal(true)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    Add Component
                  </Button>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <Table>
                  <TableHeader className="bg-slate-950/80">
                    <TableRow className="border-slate-800">
                      <TableHead className="text-slate-300">Code</TableHead>
                      <TableHead className="text-slate-300">Name</TableHead>
                      <TableHead className="text-slate-300">Type</TableHead>
                      <TableHead className="text-slate-300">Amount / Rate</TableHead>
                      <TableHead className="text-slate-300">GL Account Code</TableHead>
                      <TableHead className="text-slate-300">Status</TableHead>
                      <TableHead className="text-slate-300">Notes</TableHead>
                      {isOwner && (
                        <TableHead className="text-slate-300 text-right">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statutoryRates.length === 0 ? (
                      <TableRow className="border-slate-800">
                        <TableCell colSpan={8} className="text-center py-8 text-slate-400">
                          No statutory components configured.
                        </TableCell>
                      </TableRow>
                    ) : (
                      statutoryRates.map((c) => (
                        <TableRow key={c.id} className="border-slate-800 hover:bg-slate-800/40">
                          <TableCell className="font-semibold text-white flex items-center gap-1.5">
                            {c.code}
                            {c.isExample && (
                              <Badge
                                variant="outline"
                                className="text-[10px] text-amber-400 border-amber-500/40"
                              >
                                Example
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-slate-300">{c.name}</TableCell>
                          <TableCell className="text-xs text-slate-400 uppercase">
                            {c.calculationType}
                          </TableCell>
                          <TableCell className="font-mono text-slate-200">
                            {c.calculationType === 'fixed'
                              ? formatPKR(c.fixedAmountPaisa)
                              : `${c.percentageRate}%`}
                          </TableCell>
                          <TableCell className="font-mono text-emerald-400 text-xs">
                            {c.accountCode}
                          </TableCell>
                          <TableCell>
                            <Badge variant={c.isActive ? 'success' : 'secondary'}>
                              {c.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-slate-400 max-w-xs truncate">
                            {c.notes || '—'}
                          </TableCell>
                          {isOwner && (
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteComponent(c.id)}
                                className="text-red-400 hover:text-red-300 h-7 px-2 text-xs"
                              >
                                Delete
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Progressive Income Tax Slabs */}
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-6 space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-white">Monthly Progressive Income Tax Slabs</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Monthly income tax computed bracket-by-bracket from employee gross taxable
                    earnings.
                  </p>
                </div>

                {isOwner && (
                  <Button
                    size="sm"
                    onClick={() => setShowNewTaxSlabModal(true)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    Add Tax Slab
                  </Button>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <Table>
                  <TableHeader className="bg-slate-950/80">
                    <TableRow className="border-slate-800">
                      <TableHead className="text-slate-300">Min Monthly Income</TableHead>
                      <TableHead className="text-slate-300">Max Monthly Income</TableHead>
                      <TableHead className="text-slate-300">Base Tax</TableHead>
                      <TableHead className="text-slate-300">Excess Tax Rate (%)</TableHead>
                      <TableHead className="text-slate-300">Notes</TableHead>
                      {isOwner && (
                        <TableHead className="text-slate-300 text-right">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {taxSlabs.length === 0 ? (
                      <TableRow className="border-slate-800">
                        <TableCell colSpan={6} className="text-center py-8 text-slate-400">
                          No tax slabs configured. All monthly gross earnings will compute with Rs.
                          0 tax.
                        </TableCell>
                      </TableRow>
                    ) : (
                      taxSlabs.map((s) => (
                        <TableRow key={s.id} className="border-slate-800 hover:bg-slate-800/40">
                          <TableCell className="font-mono text-slate-200">
                            {formatPKR(s.minMonthlyIncomePaisa)}
                          </TableCell>
                          <TableCell className="font-mono text-slate-200">
                            {s.maxMonthlyIncomePaisa
                              ? formatPKR(s.maxMonthlyIncomePaisa)
                              : 'Unlimited'}
                          </TableCell>
                          <TableCell className="font-mono text-slate-300">
                            {formatPKR(s.baseTaxPaisa)}
                          </TableCell>
                          <TableCell className="font-mono text-amber-400 font-semibold">
                            {s.excessRatePercentage}%
                          </TableCell>
                          <TableCell className="text-xs text-slate-400 max-w-xs truncate">
                            {s.notes || '—'}
                          </TableCell>
                          {isOwner && (
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteTaxSlab(s.id)}
                                className="text-red-400 hover:text-red-300 h-7 px-2 text-xs"
                              >
                                Delete
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: GENERATE PAYROLL RUN */}
      {/* ======================================================== */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Banknote className="h-5 w-5 text-emerald-400" />
                Generate Monthly Payroll Run
              </h3>
              <button
                onClick={() => setShowGenerateModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleGenerateRun} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Branch</label>
                <select
                  value={genBranchId}
                  onChange={(e) => setGenBranchId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  required
                >
                  {branchesList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Month</label>
                <Input
                  type="month"
                  value={genMonth}
                  onChange={(e) => setGenMonth(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Monthly Working Days</label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  value={genWorkingDays}
                  onChange={(e) => setGenWorkingDays(parseInt(e.target.value) || 26)}
                  className="bg-slate-950 border-slate-700 text-white"
                  required
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Standard working days in Pakistan (typically 26 days for 6-day work weeks).
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowGenerateModal(false)}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={isLoading}
                >
                  {isLoading ? 'Generating...' : 'Generate Run'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: DISBURSE PAYMENT BATCH */}
      {/* ======================================================== */}
      {showDisburseModal && selectedRun && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-purple-400" />
                Disburse Payment Batch
              </h3>
              <button
                onClick={() => setShowDisburseModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-1">
              <div className="flex justify-between">
                <span>Run Number:</span>
                <span className="font-semibold text-white">{selectedRun.runNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Net Disbursement Total:</span>
                <span className="font-bold text-emerald-400 font-mono">
                  {formatPKR(selectedRun.totalNetPaisa)}
                </span>
              </div>
            </div>

            <form onSubmit={handleDisburseBatch} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Disbursement Account (Cash or Bank)
                </label>
                <select
                  value={disburseAccountId}
                  onChange={(e) => setDisburseAccountId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  required
                >
                  {accountsList.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.code} - {acc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Payment Reference / Cheque No.
                </label>
                <Input
                  placeholder="e.g. CHEQ-9012 or Online Transfer"
                  value={disburseReference}
                  onChange={(e) => setDisburseReference(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Payment Date</label>
                <Input
                  type="date"
                  value={disburseDate}
                  onChange={(e) => setDisburseDate(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowDisburseModal(false)}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  disabled={isLoading}
                >
                  {isLoading ? 'Disbursing...' : 'Confirm Disbursement'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: CREATE ADJUSTMENT RUN */}
      {/* ======================================================== */}
      {showAdjustmentModal && selectedRun && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-amber-400" />
                Create Adjustment Run
              </h3>
              <button
                onClick={() => setShowAdjustmentModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Approved payroll runs are strictly immutable. Any retroactive corrections must be
              processed via an adjustment run linked to <strong>{selectedRun.runNumber}</strong>.
            </p>

            <form onSubmit={handleCreateAdjustment} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Adjustment Reason</label>
                <textarea
                  rows={3}
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  placeholder="e.g. Retroactive overtime correction for employee EMP-002"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-md p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAdjustmentModal(false)}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                  disabled={isLoading}
                >
                  {isLoading ? 'Creating...' : 'Create Adjustment'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: EDIT DRAFT PAYROLL ITEM */}
      {/* ======================================================== */}
      {showEditItemModal && editingItem && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Edit Payslip ({editingItem.employeeName})
              </h3>
              <button
                onClick={() => setShowEditItemModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditItem} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Overtime Hours</label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  value={editOvertimeHours}
                  onChange={(e) => setEditOvertimeHours(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Advance Recovery (PKR)</label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={editAdvanceRecoveryRs}
                  onChange={(e) => setEditAdvanceRecoveryRs(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Income Tax Override (PKR)
                </label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={editTaxRs}
                  onChange={(e) => setEditTaxRs(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Notes</label>
                <Input
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Optional modification reason"
                  className="bg-slate-950 border-slate-700 text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowEditItemModal(false)}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={isLoading}
                >
                  {isLoading ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: PRINTABLE PAYSLIP VIEW */}
      {/* ======================================================== */}
      {viewingPayslip && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white text-slate-900 rounded-xl max-w-2xl w-full p-8 space-y-6 shadow-2xl relative my-8">
            <div className="flex items-center justify-between border-b pb-4 border-slate-200">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900">
                  {viewingPayslip.pharmacyName || 'Pharmacy ERP'}
                </h2>
                <p className="text-xs text-slate-500 font-medium">
                  SALARY PAYSLIP • {viewingPayslip.month}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="p-2 text-slate-600 hover:text-slate-900 rounded-md border border-slate-300 hover:bg-slate-50 flex items-center gap-1 text-xs font-semibold"
                >
                  <Printer className="h-4 w-4" />
                  Print
                </button>
                <button
                  onClick={() => setViewingPayslip(null)}
                  className="p-2 text-slate-400 hover:text-slate-900 rounded-md"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Employee & Run Info Grid */}
            <div className="grid grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-lg border border-slate-200">
              <div>
                <span className="text-slate-500 block">Employee:</span>
                <span className="font-bold text-slate-800 text-sm">
                  {viewingPayslip.employeeName}
                </span>
                <span className="text-slate-500 block">Code: {viewingPayslip.employeeCode}</span>
                <span className="text-slate-500 block">
                  Designation: {viewingPayslip.designation}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Payroll Run:</span>
                <span className="font-bold text-slate-800">{viewingPayslip.runNumber}</span>
                <span className="text-slate-500 block">
                  Working Days: {viewingPayslip.workingDays}
                </span>
                <span className="text-slate-500 block">
                  Attended Days: {viewingPayslip.attendedDays}
                </span>
                {viewingPayslip.unpaidLeaveDays > 0 && (
                  <span className="text-red-600 font-semibold block">
                    Unpaid Leaves: {viewingPayslip.unpaidLeaveDays} days
                  </span>
                )}
              </div>
            </div>

            {/* Earnings & Deductions Tables */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs">
              {/* Earnings */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-100 font-bold px-3 py-2 text-slate-800 border-b border-slate-200">
                  Earnings
                </div>
                <div className="p-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Base Salary:</span>
                    <span className="font-mono font-medium">
                      {formatPKR(viewingPayslip.earnings.baseSalaryPaisa)}
                    </span>
                  </div>
                  {viewingPayslip.earnings.overtimeHours > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Overtime ({viewingPayslip.earnings.overtimeHours} hrs):</span>
                      <span className="font-mono">
                        +{formatPKR(viewingPayslip.earnings.overtimeAmountPaisa)}
                      </span>
                    </div>
                  )}
                  {viewingPayslip.earnings.allowancesBreakdown.map((a, i) => (
                    <div key={i} className="flex justify-between text-emerald-700">
                      <span>{a.name}:</span>
                      <span className="font-mono">+{formatPKR(a.amountPaisa)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-2 border-t border-slate-200 font-bold text-slate-900">
                    <span>Gross Earnings:</span>
                    <span className="font-mono">
                      {formatPKR(viewingPayslip.earnings.grossSalaryPaisa)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Deductions */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-100 font-bold px-3 py-2 text-slate-800 border-b border-slate-200">
                  Deductions
                </div>
                <div className="p-3 space-y-2">
                  {viewingPayslip.deductions.unpaidLeaveDeductionPaisa > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>Unpaid Leave ({viewingPayslip.unpaidLeaveDays}d):</span>
                      <span className="font-mono">
                        -{formatPKR(viewingPayslip.deductions.unpaidLeaveDeductionPaisa)}
                      </span>
                    </div>
                  )}
                  {viewingPayslip.deductions.taxPaisa > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>Income Tax:</span>
                      <span className="font-mono">
                        -{formatPKR(viewingPayslip.deductions.taxPaisa)}
                      </span>
                    </div>
                  )}
                  {viewingPayslip.deductions.statutoryBreakdown.map((s, i) => (
                    <div key={i} className="flex justify-between text-red-600">
                      <span>
                        {s.name} ({s.code}):
                      </span>
                      <span className="font-mono">-{formatPKR(s.amountPaisa)}</span>
                    </div>
                  ))}
                  {viewingPayslip.deductions.advanceRecoveryPaisa > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <span>Advance Recovery:</span>
                      <span className="font-mono">
                        -{formatPKR(viewingPayslip.deductions.advanceRecoveryPaisa)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-slate-200 font-bold text-red-700">
                    <span>Total Deductions:</span>
                    <span className="font-mono">
                      -{formatPKR(viewingPayslip.deductions.totalDeductionsPaisa)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Net Salary Payable Callout */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center justify-between">
              <div>
                <span className="text-xs uppercase font-bold text-emerald-800 tracking-wider">
                  Net Salary Payable
                </span>
                <p className="text-xs text-slate-500">Credited to employee bank / cash</p>
              </div>
              <div className="text-2xl font-black text-emerald-800 font-mono">
                {formatPKR(viewingPayslip.netSalaryPaisa)}
              </div>
            </div>

            {/* Signatures */}
            <div className="grid grid-cols-2 gap-8 pt-8 border-t border-slate-200 text-center text-xs text-slate-500">
              <div className="border-t border-dashed border-slate-400 pt-2">
                Authorized Signature & Stamp
              </div>
              <div className="border-t border-dashed border-slate-400 pt-2">
                Employee Acknowledgment
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: ISSUE NEW ADVANCE */}
      {/* ======================================================== */}
      {showNewAdvanceModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Coins className="h-5 w-5 text-emerald-400" />
                Issue Employee Advance / Loan
              </h3>
              <button
                onClick={() => setShowNewAdvanceModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleIssueAdvance} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Employee</label>
                <select
                  value={advEmployeeId}
                  onChange={(e) => setAdvEmployeeId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  required
                >
                  {employeesList.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.firstName} {e.lastName} ({e.employeeCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Principal Amount (PKR)</label>
                <Input
                  type="number"
                  min="100"
                  value={advPrincipalRs}
                  onChange={(e) => setAdvPrincipalRs(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Monthly Installment (PKR)
                </label>
                <Input
                  type="number"
                  min="100"
                  value={advInstallmentRs}
                  onChange={(e) => setAdvInstallmentRs(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Disbursement Date</label>
                <Input
                  type="date"
                  value={advDisbursementDate}
                  onChange={(e) => setAdvDisbursementDate(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Reason / Notes</label>
                <Input
                  value={advReason}
                  onChange={(e) => setAdvReason(e.target.value)}
                  placeholder="e.g. Medical emergency advance"
                  className="bg-slate-950 border-slate-700 text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowNewAdvanceModal(false)}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={isLoading}
                >
                  {isLoading ? 'Issuing...' : 'Issue Advance'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: ADD STATUTORY COMPONENT */}
      {/* ======================================================== */}
      {showNewComponentModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Add Statutory Component
              </h3>
              <button
                onClick={() => setShowNewComponentModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateComponent} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Code</label>
                  <Input
                    placeholder="e.g. EOBI"
                    value={compCode}
                    onChange={(e) => setCompCode(e.target.value)}
                    className="bg-slate-950 border-slate-700 text-white"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">GL Account Code</label>
                  <Input
                    placeholder="2210"
                    value={compAccountCode}
                    onChange={(e) => setCompAccountCode(e.target.value)}
                    className="bg-slate-950 border-slate-700 text-white"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Name</label>
                <Input
                  placeholder="e.g. Employees Old-Age Benefits"
                  value={compName}
                  onChange={(e) => setCompName(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Component Type</label>
                  <select
                    value={compType}
                    onChange={(e) => setCompType(e.target.value as 'statutory_deduction' | 'tax')}
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="statutory_deduction">Statutory Deduction</option>
                    <option value="tax">Tax Withholding</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Calculation Type</label>
                  <select
                    value={compCalcType}
                    onChange={(e) => setCompCalcType(e.target.value as 'fixed' | 'percentage')}
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="fixed">Fixed Amount (PKR)</option>
                    <option value="percentage">Percentage of Base (%)</option>
                  </select>
                </div>
              </div>

              <div>
                {compCalcType === 'fixed' ? (
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Fixed Amount (PKR)</label>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={compAmountRs}
                      onChange={(e) => setCompAmountRs(e.target.value)}
                      className="bg-slate-950 border-slate-700 text-white"
                      required
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Rate (%)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={compPercentageRate}
                      onChange={(e) => setCompPercentageRate(e.target.value)}
                      className="bg-slate-950 border-slate-700 text-white"
                      required
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Notes</label>
                <Input
                  placeholder="Legal ordinance or reference"
                  value={compNotes}
                  onChange={(e) => setCompNotes(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowNewComponentModal(false)}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={isLoading}
                >
                  {isLoading ? 'Creating...' : 'Create Component'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: ADD TAX SLAB */}
      {/* ======================================================== */}
      {showNewTaxSlabModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Add Monthly Income Tax Slab
              </h3>
              <button
                onClick={() => setShowNewTaxSlabModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTaxSlab} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    Min Monthly Income (PKR)
                  </label>
                  <Input
                    type="number"
                    min="0"
                    value={slabMinRs}
                    onChange={(e) => setSlabMinRs(e.target.value)}
                    className="bg-slate-950 border-slate-700 text-white"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    Max Monthly Income (PKR)
                  </label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Leave empty for unlimited"
                    value={slabMaxRs}
                    onChange={(e) => setSlabMaxRs(e.target.value)}
                    className="bg-slate-950 border-slate-700 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Base Tax (PKR)</label>
                  <Input
                    type="number"
                    min="0"
                    value={slabBaseTaxRs}
                    onChange={(e) => setSlabBaseTaxRs(e.target.value)}
                    className="bg-slate-950 border-slate-700 text-white"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Excess Rate (%)</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={slabExcessRate}
                    onChange={(e) => setSlabExcessRate(e.target.value)}
                    className="bg-slate-950 border-slate-700 text-white"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Notes / Finance Act Reference
                </label>
                <Input
                  placeholder="e.g. Finance Act 2024 Slab 2"
                  value={slabNotes}
                  onChange={(e) => setSlabNotes(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowNewTaxSlabModal(false)}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={isLoading}
                >
                  {isLoading ? 'Adding...' : 'Add Slab'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
