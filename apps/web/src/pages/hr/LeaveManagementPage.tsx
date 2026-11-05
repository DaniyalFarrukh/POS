import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  EmployeeRecord,
  LeaveTypeRecord,
  LeaveAllocationRecord,
  LeaveRequestRecord,
  LeaveCalendarItem,
  PayrollPreviewItem,
} from '../../types';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import {
  formatLeaveDateRange,
  filterLeaveRequests,
  getLeaveStatusBadge,
  groupCalendarLeavesByDate,
  formatPKR,
} from '../../lib/leave-utils';
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
  CalendarDays,
  Clock,
  CheckCircle,
  XCircle,
  Search,
  Plus,
  RefreshCw,
  Calendar,
  AlertTriangle,
  ArrowRightLeft,
  Users,
  Coins,
  X,
} from 'lucide-react';

export const LeaveManagementPage: React.FC = () => {
  const { can } = useAuth();
  const isManagerOrOwner = can('hr.leave.manage');

  const [activeTab, setActiveTab] = useState<'requests' | 'balances' | 'calendar' | 'payroll'>(
    'requests'
  );

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Data states
  const [employeesList, setEmployeesList] = useState<EmployeeRecord[]>([]);
  const [leaveTypesList, setLeaveTypesList] = useState<LeaveTypeRecord[]>([]);
  const [requestsList, setRequestsList] = useState<LeaveRequestRecord[]>([]);
  const [balancesList, setBalancesList] = useState<LeaveAllocationRecord[]>([]);
  const [calendarItems, setCalendarItems] = useState<LeaveCalendarItem[]>([]);
  const [payrollItems, setPayrollItems] = useState<PayrollPreviewItem[]>([]);

  // Filter states
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<string>(
    new Date().toISOString().substring(0, 7)
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('all');

  // Modals
  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showCarryOverModal, setShowCarryOverModal] = useState(false);
  const [carryOverFromYear, setCarryOverFromYear] = useState(selectedYear - 1);

  // Form states
  const [formEmployeeId, setFormEmployeeId] = useState('');
  const [formLeaveTypeId, setFormLeaveTypeId] = useState('');
  const [formStartDate, setFormStartDate] = useState(new Date().toISOString().substring(0, 10));
  const [formEndDate, setFormEndDate] = useState(new Date().toISOString().substring(0, 10));
  const [formReason, setFormReason] = useState('');

  // Fetch all core datasets
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [empRes, typesRes, reqRes, balRes, calRes, payRes] = await Promise.all([
        apiFetch<{ success: boolean; data: EmployeeRecord[] }>('/api/hr/employees'),
        apiFetch<{ success: boolean; data: LeaveTypeRecord[] }>('/api/hr/leave/types'),
        apiFetch<{ success: boolean; data: LeaveRequestRecord[] }>('/api/hr/leave/requests'),
        apiFetch<{ success: boolean; data: LeaveAllocationRecord[] }>(
          `/api/hr/leave/balances?year=${selectedYear}`
        ),
        apiFetch<{ success: boolean; data: LeaveCalendarItem[] }>(
          `/api/hr/leave/calendar?month=${selectedMonth}`
        ),
        apiFetch<{ success: boolean; data: PayrollPreviewItem[] }>(
          `/api/hr/payroll/preview?month=${selectedMonth}`
        ),
      ]);

      if (empRes.success) setEmployeesList(empRes.data || []);
      if (typesRes.success) setLeaveTypesList(typesRes.data || []);
      if (reqRes.success) setRequestsList(reqRes.data || []);
      if (balRes.success) setBalancesList(balRes.data || []);
      if (calRes.success) setCalendarItems(calRes.data || []);
      if (payRes.success) setPayrollItems(payRes.data || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load leave data';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Set default form selections once data is available
  useEffect(() => {
    if (employeesList.length > 0 && !formEmployeeId) {
      setFormEmployeeId(employeesList[0]!.id);
    }
    if (leaveTypesList.length > 0 && !formLeaveTypeId) {
      setFormLeaveTypeId(leaveTypesList[0]!.id);
    }
  }, [employeesList, leaveTypesList, formEmployeeId, formLeaveTypeId]);

  // KPI Calculations
  const kpis = useMemo(() => {
    const pendingCount = requestsList.filter((r) => r.status === 'pending').length;
    const approvedThisMonth = requestsList.filter((r) => {
      return (
        r.status === 'approved' &&
        (r.startDate.startsWith(selectedMonth) || r.endDate.startsWith(selectedMonth))
      );
    }).length;

    const unpaidDaysTotal = payrollItems.reduce((sum, p) => sum + p.approvedUnpaidLeaveDays, 0);

    const totalDeductionPaisa = payrollItems.reduce(
      (sum, p) => sum + p.unpaidLeaveDeductionPaisa,
      0
    );

    return {
      pendingCount,
      approvedThisMonth,
      unpaidDaysTotal,
      totalDeductionPaisa,
      activeStaff: employeesList.filter((e) => e.isActive).length,
    };
  }, [requestsList, payrollItems, employeesList, selectedMonth]);

  // Handle New Leave Request Submission
  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (
      !formEmployeeId ||
      !formLeaveTypeId ||
      !formStartDate ||
      !formEndDate ||
      !formReason.trim()
    ) {
      setErrorMsg('Please complete all required fields.');
      return;
    }

    try {
      const res = await apiFetch<{ success: boolean; data: LeaveRequestRecord }>(
        '/api/hr/leave/requests',
        {
          method: 'POST',
          body: JSON.stringify({
            employeeId: formEmployeeId,
            leaveTypeId: formLeaveTypeId,
            startDate: formStartDate,
            endDate: formEndDate,
            reason: formReason.trim(),
          }),
        }
      );

      if (res.success) {
        setSuccessMsg('Leave request submitted successfully.');
        setShowNewRequestModal(false);
        setFormReason('');
        loadData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit leave request';
      setErrorMsg(msg);
    }
  };

  // Handle Approval
  const handleApprove = async (requestId: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch<{ success: boolean }>(
        `/api/hr/leave/requests/${requestId}/approve`,
        { method: 'POST' }
      );
      if (res.success) {
        setSuccessMsg('Leave request approved and attendance recorded.');
        loadData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Approval failed';
      setErrorMsg(msg);
    }
  };

  // Handle Rejection
  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingRequestId || !rejectionReason.trim()) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch<{ success: boolean }>(
        `/api/hr/leave/requests/${rejectingRequestId}/reject`,
        {
          method: 'POST',
          body: JSON.stringify({ rejectionReason: rejectionReason.trim() }),
        }
      );
      if (res.success) {
        setSuccessMsg('Leave request rejected and balance restored.');
        setShowRejectModal(false);
        setRejectingRequestId(null);
        setRejectionReason('');
        loadData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Rejection failed';
      setErrorMsg(msg);
    }
  };

  // Handle Carry-over
  const handleCarryOver = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch<{ success: boolean; data: { carriedOverDays: number } }>(
        '/api/hr/leave/carry-over',
        {
          method: 'POST',
          body: JSON.stringify({
            fromYear: carryOverFromYear,
            toYear: selectedYear,
          }),
        }
      );
      if (res.success) {
        setSuccessMsg(
          `Successfully carried over ${res.data.carriedOverDays} total days to ${selectedYear}.`
        );
        setShowCarryOverModal(false);
        loadData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Carry-over failed';
      setErrorMsg(msg);
    }
  };

  const filteredRequests = useMemo(() => {
    return filterLeaveRequests(requestsList, {
      status: statusFilter,
      leaveTypeId: leaveTypeFilter,
      search: searchTerm,
    });
  }, [requestsList, statusFilter, leaveTypeFilter, searchTerm]);

  // Calendar matrix calculation
  const calendarDaysGroup = useMemo(() => {
    return groupCalendarLeavesByDate(calendarItems);
  }, [calendarItems]);

  const calendarGrid = useMemo(() => {
    const [yStr, mStr] = selectedMonth.split('-');
    const year = parseInt(yStr!, 10);
    const month = parseInt(mStr!, 10) - 1; // 0-indexed

    const firstDayIndex = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    const days = [];
    // Blank days before 1st of month
    for (let i = 0; i < firstDayIndex; i++) {
      days.push(null);
    }
    // Month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = `${selectedMonth}-${d.toString().padStart(2, '0')}`;
      days.push({
        dayNumber: d,
        dateStr: dayStr,
        leaves: calendarDaysGroup[dayStr] || [],
      });
    }
    return days;
  }, [selectedMonth, calendarDaysGroup]);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
            <CalendarDays className="h-7 w-7 text-blue-600" />
            Leave Management & Entitlements
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Yearly entitlements, carry-over rules, approval workflows, team calendar, and payroll
            deductions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={isLoading}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {isManagerOrOwner && (
            <Button
              size="sm"
              onClick={() => setShowNewRequestModal(true)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Plus className="h-4 w-4" />
              New Leave Request
            </Button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md text-sm flex items-center gap-2">
          <CheckCircle className="h-5 w-5 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-amber-500 shadow-sm">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Pending Approvals
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{kpis.pendingCount}</p>
              </div>
              <Clock className="h-8 w-8 text-amber-500 opacity-80" />
            </div>
            <p className="text-xs text-amber-600 mt-2 font-medium">Requires manager review</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500 shadow-sm">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Approved This Month
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{kpis.approvedThisMonth}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-emerald-500 opacity-80" />
            </div>
            <p className="text-xs text-gray-500 mt-2">For {selectedMonth}</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500 shadow-sm">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Unpaid Leave Deductions
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {formatPKR(kpis.totalDeductionPaisa)}
                </p>
              </div>
              <Coins className="h-8 w-8 text-purple-500 opacity-80" />
            </div>
            <p className="text-xs text-purple-700 mt-2 font-medium">
              {kpis.unpaidDaysTotal} unpaid leave days
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500 shadow-sm">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Active Staff
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{kpis.activeStaff}</p>
              </div>
              <Users className="h-8 w-8 text-blue-500 opacity-80" />
            </div>
            <p className="text-xs text-gray-500 mt-2">Assigned across branches</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-6">
          <button
            onClick={() => setActiveTab('requests')}
            className={`py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'requests'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Clock className="h-4 w-4" />
            Leave Requests & Approvals
            {kpis.pendingCount > 0 && (
              <span className="ml-1 bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full font-semibold">
                {kpis.pendingCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('balances')}
            className={`py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'balances'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <ArrowRightLeft className="h-4 w-4" />
            Entitlements & Balances
          </button>

          <button
            onClick={() => setActiveTab('calendar')}
            className={`py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'calendar'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Calendar className="h-4 w-4" />
            Team Calendar View
          </button>

          <button
            onClick={() => setActiveTab('payroll')}
            className={`py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'payroll'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Coins className="h-4 w-4" />
            Attendance & Payroll Impact
          </button>
        </nav>
      </div>

      {/* TAB 1: Leave Requests & Approvals */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search employee, type or reason..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 text-sm"
                  />
                </div>

                <div>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm bg-white"
                  >
                    <option value="all">All Statuses</option>
                    <option value="pending">Pending Approval</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                <div>
                  <select
                    value={leaveTypeFilter}
                    onChange={(e) => setLeaveTypeFilter(e.target.value)}
                    className="w-full border border-gray-300 rounded-md py-2 px-3 text-sm bg-white"
                  >
                    <option value="all">All Leave Types</option>
                    {leaveTypesList.map((lt) => (
                      <option key={lt.id} value={lt.id}>
                        {lt.name} ({lt.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end items-center">
                  <span className="text-xs text-gray-500">
                    Showing {filteredRequests.length} of {requestsList.length} requests
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Requests Table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Leave Type</TableHead>
                    <TableHead>Dates & Duration</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Approved / Decision</TableHead>
                    {isManagerOrOwner && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRequests.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={isManagerOrOwner ? 7 : 6}
                        className="text-center py-8 text-gray-400 text-sm"
                      >
                        No leave requests found matching the current filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRequests.map((req) => {
                      const badgeInfo = getLeaveStatusBadge(req.status);
                      return (
                        <TableRow key={req.id} className="hover:bg-gray-50/50">
                          <TableCell className="font-medium text-gray-900">
                            <div>{req.employeeName}</div>
                            <span className="text-xs text-gray-500 font-mono">
                              {req.employeeCode}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-gray-800">{req.leaveTypeName}</div>
                            <span className="text-xs text-gray-500">
                              {req.isPaid ? 'Paid' : 'Unpaid (Salary Deductible)'}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">
                            <span className="font-medium text-gray-900">
                              {formatLeaveDateRange(req.startDate, req.endDate, req.daysCount)}
                            </span>
                          </TableCell>
                          <TableCell
                            className="text-sm text-gray-600 max-w-xs truncate"
                            title={req.reason}
                          >
                            {req.reason}
                          </TableCell>
                          <TableCell>
                            <Badge variant={badgeInfo.variant}>{badgeInfo.label}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">
                            {req.status === 'approved' && req.approvedAt ? (
                              <div>
                                <span className="text-emerald-700 font-medium">Approved</span>
                                <div>{new Date(req.approvedAt).toLocaleDateString('en-PK')}</div>
                              </div>
                            ) : req.status === 'rejected' ? (
                              <div className="text-red-600">
                                <span className="font-medium">Rejected:</span> {req.rejectionReason}
                              </div>
                            ) : (
                              <span className="text-gray-400">Awaiting Manager</span>
                            )}
                          </TableCell>
                          {isManagerOrOwner && (
                            <TableCell className="text-right">
                              {req.status === 'pending' ? (
                                <div className="flex justify-end gap-1.5">
                                  <Button
                                    size="sm"
                                    onClick={() => handleApprove(req.id)}
                                    className="h-8 px-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                                  >
                                    <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                    Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setRejectingRequestId(req.id);
                                      setShowRejectModal(true);
                                    }}
                                    className="h-8 px-2 text-red-600 border-red-200 hover:bg-red-50 text-xs"
                                  >
                                    <XCircle className="h-3.5 w-3.5 mr-1" />
                                    Reject
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400">Completed</span>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: Entitlements & Balances */}
      {activeTab === 'balances' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-700">Entitlement Year:</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white font-medium"
              >
                <option value={2025}>2025</option>
                <option value={2026}>2026</option>
                <option value={2027}>2027</option>
              </select>
            </div>

            {isManagerOrOwner && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCarryOverModal(true)}
                className="flex items-center gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                <ArrowRightLeft className="h-4 w-4" />
                Carry Over Unused Balances
              </Button>
            )}
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Leave Type</TableHead>
                    <TableHead className="text-center">Yearly Entitled</TableHead>
                    <TableHead className="text-center">Carried Over</TableHead>
                    <TableHead className="text-center">Total Allocated</TableHead>
                    <TableHead className="text-center text-emerald-700">Used (Approved)</TableHead>
                    <TableHead className="text-center text-amber-700">Pending</TableHead>
                    <TableHead className="text-right text-blue-700 font-bold">
                      Remaining Available
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balancesList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-gray-400 text-sm">
                        No leave balances recorded for year {selectedYear}.
                      </TableCell>
                    </TableRow>
                  ) : (
                    balancesList.map((bal) => (
                      <TableRow key={bal.id} className="hover:bg-gray-50/50">
                        <TableCell className="font-medium text-gray-900">
                          <div>{bal.employeeName}</div>
                          <span className="text-xs text-gray-500 font-mono">
                            {bal.employeeCode}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold text-gray-800">{bal.leaveTypeName}</span>
                          <span className="ml-2 text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
                            {bal.leaveTypeCode}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">{bal.entitledDays} days</TableCell>
                        <TableCell className="text-center font-medium text-purple-700">
                          {bal.carriedOverDays > 0 ? `+${bal.carriedOverDays} days` : '0'}
                        </TableCell>
                        <TableCell className="text-center font-semibold text-gray-900">
                          {bal.totalAllocatedDays} days
                        </TableCell>
                        <TableCell className="text-center font-semibold text-emerald-700">
                          {bal.usedDays} days
                        </TableCell>
                        <TableCell className="text-center font-semibold text-amber-600">
                          {bal.pendingDays > 0 ? `${bal.pendingDays} days` : '0'}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`font-bold text-sm px-2.5 py-1 rounded-full ${
                              bal.remainingDays <= 2
                                ? 'bg-red-100 text-red-800'
                                : bal.remainingDays <= 5
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {bal.remainingDays} days
                          </span>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 3: Team Calendar View */}
      {activeTab === 'calendar' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-700">Month:</span>
              <Input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-44 text-sm"
              />
            </div>

            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-500 inline-block"></span>
                <span>Approved Leave</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-400 inline-block"></span>
                <span>Pending Approval</span>
              </div>
            </div>
          </div>

          {/* Calendar Grid */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div
                    key={d}
                    className="bg-gray-50 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider"
                  >
                    {d}
                  </div>
                ))}

                {calendarGrid.map((day, idx) => {
                  if (!day) {
                    return (
                      <div
                        key={`empty-${idx}`}
                        className="bg-white min-h-[100px] p-1.5 opacity-50"
                      ></div>
                    );
                  }

                  return (
                    <div
                      key={day.dateStr}
                      className="bg-white min-h-[110px] p-1.5 flex flex-col justify-between border-t border-gray-100 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-700">{day.dayNumber}</span>
                        {day.leaves.length > 0 && (
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-1 rounded font-medium">
                            {day.leaves.length} staff
                          </span>
                        )}
                      </div>

                      <div className="space-y-1 mt-1 overflow-y-auto max-h-[80px]">
                        {day.leaves.map((l) => (
                          <div
                            key={`${l.id}-${day.dateStr}`}
                            className={`text-[11px] px-1.5 py-0.5 rounded font-medium truncate ${
                              l.status === 'approved'
                                ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                : 'bg-amber-100 text-amber-900 border border-amber-300'
                            }`}
                            title={`${l.employeeName} (${l.leaveTypeName}) - ${l.reason}`}
                          >
                            {l.employeeName.split(' ')[0]} ({l.leaveTypeCode})
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 4: Attendance & Payroll Impact */}
      {activeTab === 'payroll' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-700">Payroll Month:</span>
              <Input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-44 text-sm"
              />
            </div>
            <div className="text-xs text-gray-500">
              Unpaid leaves deduct proportionally based on standard monthly working days.
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Designation</TableHead>
                    <TableHead className="text-right">Monthly Base Salary</TableHead>
                    <TableHead className="text-center text-emerald-700">
                      Approved Paid Days
                    </TableHead>
                    <TableHead className="text-center text-purple-700">
                      Approved Unpaid Days
                    </TableHead>
                    <TableHead className="text-right">Daily Rate</TableHead>
                    <TableHead className="text-right text-red-600 font-semibold">
                      Unpaid Deduction
                    </TableHead>
                    <TableHead className="text-right text-emerald-800 font-bold">
                      Net Salary Payable
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payrollItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-gray-400 text-sm">
                        No employees found for payroll preview in {selectedMonth}.
                      </TableCell>
                    </TableRow>
                  ) : (
                    payrollItems.map((p) => (
                      <TableRow key={p.employeeId} className="hover:bg-gray-50/50">
                        <TableCell className="font-medium text-gray-900">
                          <div>{p.employeeName}</div>
                          <span className="text-xs text-gray-500 font-mono">{p.employeeCode}</span>
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">{p.designation}</TableCell>
                        <TableCell className="text-right font-medium text-gray-900">
                          {formatPKR(p.baseSalaryPaisa)}
                        </TableCell>
                        <TableCell className="text-center font-medium text-emerald-700">
                          {p.approvedPaidLeaveDays} days
                        </TableCell>
                        <TableCell className="text-center font-semibold text-purple-700">
                          {p.approvedUnpaidLeaveDays > 0 ? (
                            <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full text-xs">
                              {p.approvedUnpaidLeaveDays} days
                            </span>
                          ) : (
                            '0'
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs text-gray-500">
                          {formatPKR(p.dailyRatePaisa)}/day
                        </TableCell>
                        <TableCell className="text-right font-semibold text-red-600">
                          {p.unpaidLeaveDeductionPaisa > 0
                            ? `- ${formatPKR(p.unpaidLeaveDeductionPaisa)}`
                            : 'Rs. 0.00'}
                        </TableCell>
                        <TableCell className="text-right font-bold text-emerald-700 text-base">
                          {formatPKR(p.netSalaryPaisa)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* MODAL: New Leave Request */}
      {showNewRequestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 relative">
            <button
              onClick={() => setShowNewRequestModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Plus className="h-5 w-5 text-blue-600" />
              Submit Leave Request
            </h3>

            <form onSubmit={handleCreateRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Employee *</label>
                <select
                  value={formEmployeeId}
                  onChange={(e) => setFormEmployeeId(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-sm bg-white"
                  required
                >
                  {employeesList.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName} ({emp.employeeCode} - {emp.designation})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Leave Type *
                </label>
                <select
                  value={formLeaveTypeId}
                  onChange={(e) => setFormLeaveTypeId(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-sm bg-white"
                  required
                >
                  {leaveTypesList.map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.name} ({lt.isPaid ? 'Paid' : 'Unpaid - Salary Deductible'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Start Date *
                  </label>
                  <Input
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    End Date *
                  </label>
                  <Input
                    type="date"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Reason / Memo *
                </label>
                <textarea
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                  rows={3}
                  placeholder="State the reason for this leave request..."
                  className="w-full border border-gray-300 rounded p-2 text-sm"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowNewRequestModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white">
                  Submit Request
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Reject Leave Request */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 relative">
            <button
              onClick={() => {
                setShowRejectModal(false);
                setRejectingRequestId(null);
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-600" />
              Reject Leave Request
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Please enter the official reason for rejecting this leave request. This will release
              reserved pending days.
            </p>

            <form onSubmit={handleReject} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Rejection Reason *
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Staff shortage, emergency shift requirements..."
                  className="w-full border border-gray-300 rounded p-2 text-sm"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowRejectModal(false);
                    setRejectingRequestId(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" className="bg-red-600 hover:bg-red-700 text-white">
                  Confirm Rejection
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Carry Over */}
      {showCarryOverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 relative">
            <button
              onClick={() => setShowCarryOverModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-blue-600" />
              Carry-Over Unused Balances
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Unused leave days from the prior year will be transferred to {selectedYear}, strictly
              adhering to each leave type's maximum carry-over cap.
            </p>

            <form onSubmit={handleCarryOver} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Source Year
                </label>
                <Input
                  type="number"
                  value={carryOverFromYear}
                  onChange={(e) => setCarryOverFromYear(parseInt(e.target.value, 10))}
                  min={2020}
                  max={2030}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Target Year
                </label>
                <Input type="number" value={selectedYear} disabled className="bg-gray-100" />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCarryOverModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white">
                  Execute Carry-Over
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
