import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  PrescriptionRecord,
  RefillReminderItem,
  PrescriptionAccessLogRecord,
  CustomerRecord,
  ProductRecord,
} from '../../types';
import { apiFetch } from '../../lib/api';
import {
  getRefillDaysStatus,
  formatRefillContactText,
  filterPrescriptions,
} from '../../lib/prescription-utils';
import { getKarachiBusinessDate } from '@pos/shared';
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
  FileText,
  Plus,
  RefreshCw,
  Search,
  AlertOctagon,
  Clock,
  CheckCircle,
  Copy,
  Check,
  X,
  Eye,
  History,
  PhoneCall,
} from 'lucide-react';

export const PrescriptionsPage: React.FC = () => {
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([]);
  const [reminders, setReminders] = useState<RefillReminderItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & tab states
  const [mainTab, setMainTab] = useState<'prescriptions' | 'reminders'>('prescriptions');
  const [rxSubTab, setRxSubTab] = useState<'all' | 'active' | 'controlled' | 'fulfilled'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [remindersWindow, setRemindersWindow] = useState<number>(7);

  // Selected Rx for detail modal
  const [selectedRxId, setSelectedRxId] = useState<string | null>(null);
  const [selectedRxDetail, setSelectedRxDetail] = useState<PrescriptionRecord | null>(null);
  const [auditLogs, setAuditLogs] = useState<PrescriptionAccessLogRecord[]>([]);
  const [detailTab, setDetailTab] = useState<'items' | 'audit'>('items');
  const [isDetailLoading, setIsDetailLoading] = useState<boolean>(false);

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [customersList, setCustomersList] = useState<CustomerRecord[]>([]);
  const [productsList, setProductsList] = useState<ProductRecord[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form State
  const [formPatientType, setFormPatientType] = useState<'customer' | 'custom'>('customer');
  const [formCustomerId, setFormCustomerId] = useState<string>('');
  const [formPatientName, setFormPatientName] = useState<string>('');
  const [formPatientPhone, setFormPatientPhone] = useState<string>('');
  const [formPatientAge, setFormPatientAge] = useState<number | ''>('');
  const [formPatientGender, setFormPatientGender] = useState<'male' | 'female' | 'other'>('male');
  const [formDoctorName, setFormDoctorName] = useState<string>('');
  const [formDoctorPmdc, setFormDoctorPmdc] = useState<string>('');
  const [formDoctorClinic, setFormDoctorClinic] = useState<string>('');
  const [formRxDate, setFormRxDate] = useState<string>(() => getKarachiBusinessDate());
  const [formDiagnosis, setFormDiagnosis] = useState<string>('');
  const [formRepeatCount, setFormRepeatCount] = useState<number>(0);
  const [formRefillInterval, setFormRefillInterval] = useState<number>(30);
  const [formIsControlled, setFormIsControlled] = useState<boolean>(false);
  const [formItems, setFormItems] = useState<
    Array<{
      productId: string;
      dosageInstructions: string;
      quantityPrescribed: number;
      daysSupply: number;
      isControlled: boolean;
    }>
  >([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Dispense Modal
  const [dispenseRxId, setDispenseRxId] = useState<string | null>(null);
  const [dispenseInvoiceId, setDispenseInvoiceId] = useState<string>('');
  const [dispenseNotes, setDispenseNotes] = useState<string>('');
  const [isDispensing, setIsDispensing] = useState<boolean>(false);
  const [dispenseError, setDispenseError] = useState<string | null>(null);

  const fetchPrescriptions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ success: boolean; data: PrescriptionRecord[] }>(
        '/api/prescriptions'
      );
      if (res.success && Array.isArray(res.data)) {
        setPrescriptions(res.data);
      } else {
        setPrescriptions([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch prescriptions');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchReminders = useCallback(async () => {
    try {
      const res = await apiFetch<{
        success: boolean;
        data: { items: RefillReminderItem[] };
      }>(`/api/prescriptions/refill-reminders?daysAhead=${remindersWindow}`);
      if (res.success && Array.isArray(res.data?.items)) {
        setReminders(res.data.items);
      } else {
        setReminders([]);
      }
    } catch (err) {
      console.error('Failed to fetch refill reminders', err);
    }
  }, [remindersWindow]);

  const fetchMasterData = useCallback(async () => {
    try {
      const [custRes, prodRes] = await Promise.all([
        apiFetch<{ success: boolean; data: CustomerRecord[] }>('/api/customers'),
        apiFetch<{ success: boolean; data: ProductRecord[] }>('/api/inventory/products'),
      ]);
      if (custRes.success && Array.isArray(custRes.data)) setCustomersList(custRes.data);
      if (prodRes.success && Array.isArray(prodRes.data)) setProductsList(prodRes.data);
    } catch (err) {
      console.error('Error fetching customers/products', err);
    }
  }, []);

  useEffect(() => {
    fetchPrescriptions();
    fetchReminders();
    fetchMasterData();
  }, [fetchPrescriptions, fetchReminders, fetchMasterData]);

  // Load prescription detail and audit logs when selected
  useEffect(() => {
    if (!selectedRxId) {
      setSelectedRxDetail(null);
      setAuditLogs([]);
      return;
    }

    const loadDetail = async () => {
      setIsDetailLoading(true);
      try {
        const [detailRes, auditRes] = await Promise.all([
          apiFetch<{ success: boolean; data: PrescriptionRecord }>(
            `/api/prescriptions/${selectedRxId}`
          ),
          apiFetch<{ success: boolean; data: { logs: PrescriptionAccessLogRecord[] } }>(
            `/api/prescriptions/${selectedRxId}/audit-trail`
          ),
        ]);
        if (detailRes.success) setSelectedRxDetail(detailRes.data);
        if (auditRes.success) setAuditLogs(auditRes.data.logs);
      } catch (err) {
        console.error('Failed to load prescription detail', err);
      } finally {
        setIsDetailLoading(false);
      }
    };

    loadDetail();
  }, [selectedRxId]);

  const filteredRx = useMemo(() => {
    return filterPrescriptions(prescriptions, searchTerm, rxSubTab);
  }, [prescriptions, searchTerm, rxSubTab]);

  // KPI Metrics
  const controlledCount = useMemo(() => {
    return prescriptions.filter((r) => r.isControlledDrug).length;
  }, [prescriptions]);

  const activeRepeatsCount = useMemo(() => {
    return prescriptions.filter((r) => r.status === 'active' && r.repeatsUsed < r.repeatCount)
      .length;
  }, [prescriptions]);

  const todayIso = getKarachiBusinessDate();

  const handleCreatePrescription = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    let patientName = formPatientName.trim();
    let patientPhone = formPatientPhone.trim();

    if (formPatientType === 'customer') {
      const selectedCust = customersList.find((c) => c.id === formCustomerId);
      if (!selectedCust) {
        setSubmitError('Please select a customer or switch to custom patient');
        return;
      }
      patientName = selectedCust.name;
      patientPhone = selectedCust.phone || '';
    }

    if (!patientName) {
      setSubmitError('Patient name is required');
      return;
    }

    if (formItems.length === 0) {
      setSubmitError('Please prescribe at least one medicine item');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch<{ success: boolean; data: PrescriptionRecord }>(
        '/api/prescriptions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: formPatientType === 'customer' ? formCustomerId : undefined,
            patientName,
            patientPhone: patientPhone || undefined,
            patientAge: formPatientAge !== '' ? Number(formPatientAge) : undefined,
            patientGender: formPatientGender,
            doctorName: formDoctorName.trim() || undefined,
            doctorRegistrationNumber: formDoctorPmdc.trim() || undefined,
            doctorClinic: formDoctorClinic.trim() || undefined,
            prescriptionDate: formRxDate,
            diagnosis: formDiagnosis.trim() || undefined,
            repeatCount: Number(formRepeatCount),
            refillIntervalDays: Number(formRefillInterval),
            isControlledDrug: formIsControlled,
            items: formItems,
          }),
        }
      );

      if (res.success) {
        setShowCreateModal(false);
        resetCreateForm();
        fetchPrescriptions();
        fetchReminders();
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to register prescription');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetCreateForm = () => {
    setFormPatientType('customer');
    setFormCustomerId('');
    setFormPatientName('');
    setFormPatientPhone('');
    setFormPatientAge('');
    setFormPatientGender('male');
    setFormDoctorName('');
    setFormDoctorPmdc('');
    setFormDoctorClinic('');
    setFormDiagnosis('');
    setFormRepeatCount(0);
    setFormRefillInterval(30);
    setFormIsControlled(false);
    setFormItems([]);
    setSubmitError(null);
  };

  const handleDispense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispenseRxId || !dispenseInvoiceId.trim()) {
      setDispenseError('Invoice ID is required');
      return;
    }

    setIsDispensing(true);
    setDispenseError(null);
    try {
      const res = await apiFetch<{ success: boolean }>(
        `/api/prescriptions/${dispenseRxId}/dispense`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId: dispenseInvoiceId.trim(),
            notes: dispenseNotes.trim() || undefined,
          }),
        }
      );

      if (res.success) {
        setDispenseRxId(null);
        setDispenseInvoiceId('');
        setDispenseNotes('');
        fetchPrescriptions();
        fetchReminders();
      }
    } catch (err) {
      setDispenseError(err instanceof Error ? err.message : 'Dispense recording failed');
    } finally {
      setIsDispensing(false);
    }
  };

  const copyContactSummary = (item: RefillReminderItem) => {
    const text = formatRefillContactText(item);
    navigator.clipboard.writeText(text);
    setCopiedId(item.prescriptionId);
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Prescriptions</h1>
            <Badge className="bg-purple-100 text-purple-800 text-xs font-medium px-2 py-0.5">
              Confidential Health Data
            </Badge>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Doctor prescriptions, PMDC registration, repeat refill tracking, controlled drug audit
            trail
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchPrescriptions();
              fetchReminders();
            }}
            disabled={isLoading}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="h-4 w-4" />
            New Prescription
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white shadow-sm border border-gray-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total Prescriptions
              </p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{prescriptions.length}</h3>
              <p className="text-xs text-gray-400 mt-0.5">Audited patient records</p>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
              <FileText className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-sm border border-gray-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Controlled Drugs (DRAP)
              </p>
              <h3 className="text-2xl font-bold text-red-600 mt-1">{controlledCount}</h3>
              <p className="text-xs text-red-600 font-medium mt-0.5">Mandatory 5-Year Archival</p>
            </div>
            <div className="p-3 bg-red-50 text-red-600 rounded-lg">
              <AlertOctagon className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-sm border border-gray-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Active Repeat Cycles
              </p>
              <h3 className="text-2xl font-bold text-emerald-600 mt-1">{activeRepeatsCount}</h3>
              <p className="text-xs text-gray-400 mt-0.5">Pending refill dispensations</p>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
              <CheckCircle className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-sm border border-gray-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Refills Due This Week
              </p>
              <h3 className="text-2xl font-bold text-amber-600 mt-1">{reminders.length}</h3>
              <p className="text-xs text-gray-400 mt-0.5">Ready for patient contact</p>
            </div>
            <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
              <Clock className="h-6 w-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <div className="flex border-b border-gray-200 gap-4">
        <button
          onClick={() => setMainTab('prescriptions')}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            mainTab === 'prescriptions'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText className="h-4 w-4" />
          Prescription Records ({prescriptions.length})
        </button>
        <button
          onClick={() => setMainTab('reminders')}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            mainTab === 'reminders'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Clock className="h-4 w-4" />
          Refill Reminders Queue ({reminders.length})
        </button>
      </div>

      {/* TAB 1: Prescriptions Directory */}
      {mainTab === 'prescriptions' && (
        <Card className="bg-white shadow-sm border border-gray-200">
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
                <button
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    rxSubTab === 'all'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  onClick={() => setRxSubTab('all')}
                >
                  All ({prescriptions.length})
                </button>
                <button
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    rxSubTab === 'active'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  onClick={() => setRxSubTab('active')}
                >
                  Active
                </button>
                <button
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    rxSubTab === 'controlled'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  onClick={() => setRxSubTab('controlled')}
                >
                  Controlled ({controlledCount})
                </button>
                <button
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    rxSubTab === 'fulfilled'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  onClick={() => setRxSubTab('fulfilled')}
                >
                  Fulfilled
                </button>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search patient, PMDC, Rx#..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 text-xs"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
                {error}
              </div>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 text-gray-600 text-xs">
                    <TableHead>Prescription #</TableHead>
                    <TableHead>Patient Name</TableHead>
                    <TableHead>Doctor (PMDC #)</TableHead>
                    <TableHead>Prescribed Date</TableHead>
                    <TableHead className="text-center">Repeats Cycle</TableHead>
                    <TableHead className="text-center">Classification</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-gray-400 text-sm">
                        Loading prescription records...
                      </TableCell>
                    </TableRow>
                  ) : filteredRx.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-gray-400 text-sm">
                        No prescriptions found matching criteria
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRx.map((rx) => (
                      <TableRow
                        key={rx.id}
                        className="text-sm hover:bg-gray-50/75 transition-colors"
                      >
                        <TableCell className="font-mono font-medium text-gray-900">
                          {rx.prescriptionNumber}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-gray-900">{rx.patientName}</div>
                          {rx.patientPhone && (
                            <div className="text-xs text-gray-400 font-mono">{rx.patientPhone}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-xs text-gray-800">
                            {rx.doctorName ? `Dr. ${rx.doctorName}` : '—'}
                          </div>
                          {rx.doctorRegistrationNumber && (
                            <div className="text-[10px] text-gray-400 font-mono">
                              {rx.doctorRegistrationNumber}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-gray-600">
                          {rx.prescriptionDate}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-mono font-medium bg-gray-100 text-gray-800">
                            {rx.repeatsUsed} / {rx.repeatCount} used
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {rx.isControlledDrug ? (
                            <Badge className="bg-red-100 text-red-800 text-[10px] font-semibold border border-red-200">
                              Controlled Drug
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-gray-500">
                              Standard Rx
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            className={`text-[10px] font-normal ${
                              rx.status === 'active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : rx.status === 'fulfilled'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {rx.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {rx.status === 'active' && rx.repeatsUsed < rx.repeatCount && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDispenseRxId(rx.id)}
                                className="text-xs text-emerald-700 hover:text-emerald-900 border-emerald-200 hover:bg-emerald-50 h-7 px-2"
                              >
                                Dispense
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedRxId(rx.id);
                                setDetailTab('items');
                              }}
                              className="text-blue-600 hover:text-blue-800 text-xs h-7 px-2 flex items-center gap-1"
                            >
                              <Eye className="h-3 w-3" />
                              View
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
      )}

      {/* TAB 2: Refill Reminders Queue */}
      {mainTab === 'reminders' && (
        <Card className="bg-white shadow-sm border border-gray-200">
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Upcoming Patient Refill Queue</h3>
                <p className="text-xs text-gray-500">
                  Patients with active repeat prescriptions due for refills within the selected
                  window
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Window:</span>
                <select
                  value={remindersWindow}
                  onChange={(e) => setRemindersWindow(Number(e.target.value))}
                  className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                >
                  <option value={3}>Next 3 Days</option>
                  <option value={7}>Next 7 Days</option>
                  <option value={14}>Next 14 Days</option>
                  <option value={30}>Next 30 Days</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 text-gray-600 text-xs">
                    <TableHead>Patient & Phone</TableHead>
                    <TableHead>Prescription #</TableHead>
                    <TableHead>Doctor</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-center">Days Status</TableHead>
                    <TableHead className="text-center">Repeats Left</TableHead>
                    <TableHead className="text-right">Outreach Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reminders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-gray-400 text-sm">
                        No refills due in the next {remindersWindow} days
                      </TableCell>
                    </TableRow>
                  ) : (
                    reminders.map((item) => {
                      const daysStatus = getRefillDaysStatus(item.nextRefillDate, todayIso);
                      const isCopied = copiedId === item.prescriptionId;

                      return (
                        <TableRow
                          key={item.prescriptionId}
                          className="text-sm hover:bg-gray-50/75 transition-colors"
                        >
                          <TableCell>
                            <div className="font-semibold text-gray-900">{item.patientName}</div>
                            <div className="text-xs text-blue-600 font-mono flex items-center gap-1 mt-0.5">
                              <PhoneCall className="h-3 w-3" />
                              {item.patientPhone}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {item.prescriptionNumber}
                          </TableCell>
                          <TableCell className="text-xs text-gray-700">
                            Dr. {item.doctorName}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-semibold text-gray-900">
                            {item.nextRefillDate}
                          </TableCell>
                          <TableCell className="text-center">
                            <span
                              className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium border ${daysStatus.badgeClass}`}
                            >
                              {daysStatus.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-center font-bold text-gray-800">
                            {item.remainingRepeats} repeat(s)
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => copyContactSummary(item)}
                              className="text-xs flex items-center gap-1 ml-auto h-7 px-2.5"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                                  <span className="text-emerald-700 font-medium">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5 text-gray-500" />
                                  <span>Copy SMS / Contact</span>
                                </>
                              )}
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
      )}

      {/* Detail & Audit Trail Modal */}
      {selectedRxDetail && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end transition-opacity">
          <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex justify-between items-start bg-gray-50">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-gray-900">
                    {selectedRxDetail.prescriptionNumber}
                  </h2>
                  {selectedRxDetail.isControlledDrug && (
                    <Badge className="bg-red-100 text-red-800 text-xs border border-red-200">
                      Controlled Drug (Schedule Narcotics)
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1 flex items-center gap-3">
                  <span>Prescribed Date: {selectedRxDetail.prescriptionDate}</span>
                  <span>•</span>
                  <span>Statutory Retention: {selectedRxDetail.statutoryRetentionUntil}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedRxId(null)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Patient & Doctor Card */}
            <div className="p-4 bg-blue-50/50 border-b border-blue-100 grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-[10px] text-gray-500 uppercase font-semibold">
                  Patient Information
                </span>
                <p className="font-bold text-gray-900 mt-0.5">{selectedRxDetail.patientName}</p>
                <p className="text-gray-600 font-mono">
                  {selectedRxDetail.patientPhone || 'No Phone'}
                </p>
                {selectedRxDetail.diagnosis && (
                  <p className="text-gray-700 italic mt-1">
                    Diagnosis: {selectedRxDetail.diagnosis}
                  </p>
                )}
              </div>
              <div className="text-right">
                <span className="text-[10px] text-gray-500 uppercase font-semibold">
                  Doctor & Clinic
                </span>
                <p className="font-bold text-gray-900 mt-0.5">
                  {selectedRxDetail.doctorName ? `Dr. ${selectedRxDetail.doctorName}` : 'Unknown'}
                </p>
                <p className="text-gray-600 font-mono">
                  {selectedRxDetail.doctorRegistrationNumber
                    ? `PMDC: ${selectedRxDetail.doctorRegistrationNumber}`
                    : ''}
                </p>
                <p className="text-gray-500">{selectedRxDetail.doctorClinic || ''}</p>
              </div>
            </div>

            {/* Navigation inside Drawer */}
            <div className="flex border-b border-gray-200 bg-gray-50 px-4 pt-2">
              <button
                onClick={() => setDetailTab('items')}
                className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  detailTab === 'items'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                Prescribed Medicines
              </button>
              <button
                onClick={() => setDetailTab('audit')}
                className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                  detailTab === 'audit'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <History className="h-3.5 w-3.5" />
                Access Audit Trail ({auditLogs.length})
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {isDetailLoading ? (
                <div className="text-center py-12 text-gray-400 text-sm">Loading details...</div>
              ) : detailTab === 'items' ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center text-xs bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <div>
                      <span className="text-gray-500">Repeats: </span>
                      <span className="font-bold text-gray-900">
                        {selectedRxDetail.repeatsUsed} used of {selectedRxDetail.repeatCount}{' '}
                        allowed
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Next Refill Date: </span>
                      <span className="font-bold text-blue-800">
                        {selectedRxDetail.nextRefillDate || 'None / Fulfilled'}
                      </span>
                    </div>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs bg-gray-50">
                        <TableHead>Medicine Name</TableHead>
                        <TableHead>Dosage Instructions</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-center">Schedule</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedRxDetail.items?.map((item) => (
                        <TableRow key={item.id} className="text-xs">
                          <TableCell>
                            <div className="font-medium text-gray-900">{item.productName}</div>
                            {item.genericName && (
                              <div className="text-[10px] text-gray-400 italic">
                                {item.genericName}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-gray-700 font-medium">
                            {item.dosageInstructions}
                          </TableCell>
                          <TableCell className="text-right font-bold text-gray-900">
                            {item.quantityPrescribed}
                          </TableCell>
                          <TableCell className="text-center">
                            {item.isControlled ? (
                              <Badge className="bg-red-100 text-red-800 text-[10px] font-normal">
                                Controlled
                              </Badge>
                            ) : (
                              <span className="text-gray-400 text-[10px]">Standard</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-2.5 bg-gray-50 text-[11px] text-gray-600 rounded border border-gray-200">
                    Regulatory Audit Log: Under statutory health privacy guidelines, every access
                    and view of this prescription record is immutably logged with timestamp, user
                    identity and role.
                  </div>

                  <div className="space-y-2">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-3 bg-white border border-gray-200 rounded-lg text-xs space-y-1"
                      >
                        <div className="flex justify-between items-center text-gray-500 text-[11px]">
                          <span className="font-mono">
                            {log.accessedAt.replace('T', ' ').slice(0, 19)}
                          </span>
                          <Badge variant="outline" className="text-[10px] uppercase font-mono">
                            {log.userRole}
                          </Badge>
                        </div>
                        <div className="font-medium text-gray-900 capitalize">
                          Action: {log.action.replace('_', ' ')}
                        </div>
                        {log.details && (
                          <div className="text-gray-600 text-[11px]">{log.details}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dispense Modal */}
      {dispenseRxId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Dispense Prescription Refill</h3>
            <p className="text-xs text-gray-500">
              Link this dispensation cycle to a finalized sale invoice to record inventory deduction
              and repeats count.
            </p>

            {dispenseError && (
              <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded border border-red-200">
                {dispenseError}
              </div>
            )}

            <form onSubmit={handleDispense} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Sale Invoice ID <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  required
                  placeholder="Enter invoice UUID or select"
                  value={dispenseInvoiceId}
                  onChange={(e) => setDispenseInvoiceId(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Pharmacist Notes
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Dispensed 1 pack, advised on dosage"
                  value={dispenseNotes}
                  onChange={(e) => setDispenseNotes(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDispenseRxId(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isDispensing}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {isDispensing ? 'Dispensing...' : 'Confirm Dispensation'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Prescription Drawer / Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <div>
                <h3 className="text-base font-bold text-gray-900">Register New Prescription</h3>
                <p className="text-xs text-gray-500">
                  Doctor prescription with PMDC registration and repeat refill tracking
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={handleCreatePrescription}
              className="flex-1 overflow-y-auto p-4 space-y-4"
            >
              {submitError && (
                <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded border border-red-200">
                  {submitError}
                </div>
              )}

              {/* Patient Type Select */}
              <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-3">
                <div className="flex items-center gap-4 text-xs">
                  <span className="font-semibold text-gray-700">Patient:</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      checked={formPatientType === 'customer'}
                      onChange={() => setFormPatientType('customer')}
                    />
                    Linked Customer
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      checked={formPatientType === 'custom'}
                      onChange={() => setFormPatientType('custom')}
                    />
                    Free Text Patient
                  </label>
                </div>

                {formPatientType === 'customer' ? (
                  <div>
                    <select
                      value={formCustomerId}
                      onChange={(e) => setFormCustomerId(e.target.value)}
                      className="w-full text-xs border border-gray-300 rounded p-2 bg-white"
                    >
                      <option value="">-- Select Customer --</option>
                      {customersList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.phone || 'No Phone'})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">Patient Name *</label>
                      <Input
                        type="text"
                        placeholder="e.g. Asma Tariq"
                        value={formPatientName}
                        onChange={(e) => setFormPatientName(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">Phone Number</label>
                      <Input
                        type="text"
                        placeholder="03XXXXXXXXX"
                        value={formPatientPhone}
                        onChange={(e) => setFormPatientPhone(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Doctor Details */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Doctor Name
                  </label>
                  <Input
                    type="text"
                    placeholder="Dr. Asad Mehmood"
                    value={formDoctorName}
                    onChange={(e) => setFormDoctorName(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    PMDC Registration #
                  </label>
                  <Input
                    type="text"
                    placeholder="e.g. PMDC-12345-P"
                    value={formDoctorPmdc}
                    onChange={(e) => setFormDoctorPmdc(e.target.value)}
                    className="text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Prescription Date
                  </label>
                  <Input
                    type="date"
                    required
                    value={formRxDate}
                    onChange={(e) => setFormRxDate(e.target.value)}
                    className="text-xs font-mono"
                  />
                </div>
              </div>

              {/* Refills & Controlled Flags */}
              <div className="grid grid-cols-3 gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Repeats Allowed
                  </label>
                  <Input
                    type="number"
                    min="0"
                    max="12"
                    value={formRepeatCount}
                    onChange={(e) => setFormRepeatCount(Number(e.target.value))}
                    className="text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Refill Interval (Days)
                  </label>
                  <Input
                    type="number"
                    min="1"
                    max="180"
                    value={formRefillInterval}
                    onChange={(e) => setFormRefillInterval(Number(e.target.value))}
                    className="text-xs"
                  />
                </div>
                <div className="flex flex-col justify-center">
                  <label className="flex items-center gap-2 cursor-pointer mt-3">
                    <input
                      type="checkbox"
                      checked={formIsControlled}
                      onChange={(e) => setFormIsControlled(e.target.checked)}
                      className="rounded text-red-600 focus:ring-red-500 h-4 w-4"
                    />
                    <span className="text-xs font-semibold text-red-700">
                      Controlled Drug (5y Retain)
                    </span>
                  </label>
                </div>
              </div>

              {/* Prescribed Items Table */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-800 uppercase">
                    Prescribed Medicines ({formItems.length})
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (productsList.length > 0) {
                        setFormItems([
                          ...formItems,
                          {
                            productId: productsList[0]!.id,
                            dosageInstructions: '1 tablet daily after food',
                            quantityPrescribed: 30,
                            daysSupply: 30,
                            isControlled: false,
                          },
                        ]);
                      }
                    }}
                    className="text-xs h-7"
                  >
                    + Add Medicine
                  </Button>
                </div>

                {formItems.length === 0 ? (
                  <div className="text-center py-6 border-2 border-dashed border-gray-200 rounded-lg text-xs text-gray-400">
                    Click &quot;+ Add Medicine&quot; to prescribe drugs from inventory catalog
                  </div>
                ) : (
                  formItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2 text-xs"
                    >
                      <div className="flex justify-between items-center">
                        <select
                          value={item.productId}
                          onChange={(e) => {
                            const newItems = [...formItems];
                            newItems[idx]!.productId = e.target.value;
                            setFormItems(newItems);
                          }}
                          className="w-2/3 border border-gray-300 rounded p-1.5 text-xs bg-white font-medium"
                        >
                          {productsList.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.brandName} ({p.genericName})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setFormItems(formItems.filter((_, i) => i !== idx));
                          }}
                          className="text-red-500 hover:text-red-700 p-1"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <Input
                            type="text"
                            placeholder="Dosage instructions (e.g. 1 tab BD)"
                            value={item.dosageInstructions}
                            onChange={(e) => {
                              const newItems = [...formItems];
                              newItems[idx]!.dosageInstructions = e.target.value;
                              setFormItems(newItems);
                            }}
                            className="text-xs"
                          />
                        </div>
                        <div>
                          <Input
                            type="number"
                            min="1"
                            placeholder="Qty"
                            value={item.quantityPrescribed}
                            onChange={(e) => {
                              const newItems = [...formItems];
                              newItems[idx]!.quantityPrescribed = Number(e.target.value);
                              setFormItems(newItems);
                            }}
                            className="text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Submit Buttons */}
              <div className="pt-2 flex justify-end gap-2 border-t border-gray-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {isSubmitting ? 'Registering...' : 'Register Prescription'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
