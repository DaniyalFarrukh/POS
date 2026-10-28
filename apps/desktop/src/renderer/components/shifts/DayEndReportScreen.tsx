import React, { useState, useEffect, useCallback } from 'react';
import type { AuthSession, ShiftRecord } from '@pos/shared';
import { formatPKR, convertRupeesToPaisa } from '@pos/shared';
import { generateZReportHtml } from '../../utils/receiptGenerator';

interface DayEndReportScreenProps {
  session: AuthSession;
}

export const DayEndReportScreen: React.FC<DayEndReportScreenProps> = ({ session }) => {
  const [currentShift, setCurrentShift] = useState<ShiftRecord | null>(null);
  const [shiftHistory, setShiftHistory] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Open Shift Form State
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openingCashInput, setOpeningCashInput] = useState('5000');
  const [openNotes, setOpenNotes] = useState('');
  const [openingSubmitting, setOpeningSubmitting] = useState(false);

  // Close Shift Modal State
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [countedCashInput, setCountedCashInput] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closeSubmitting, setCloseSubmitting] = useState(false);

  // Printing state
  const [isPrinting, setIsPrinting] = useState(false);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Load active shift & history
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [active, history] = await Promise.all([
        window.api.shifts.getCurrentShift(session.counter.id),
        window.api.shifts.getShiftHistory({
          counterId: session.counter.id,
          limit: 30,
        }),
      ]);
      setCurrentShift(active);
      setShiftHistory(history);
      if (active) {
        // Pre-fill counted cash with expected cash for easy verification
        setCountedCashInput(formatPKR(active.expectedCashPaisa, { showPrefix: false }));
      }
    } catch (err: unknown) {
      console.error('[DayEndReport] Failed to load shift data:', err);
      setToastMessage('⚠️ Failed to load shift data.');
    } finally {
      setLoading(false);
    }
  }, [session.counter.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Open Shift Handler
  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    const openingPaisa = convertRupeesToPaisa(openingCashInput);
    if (openingPaisa < 0) {
      setToastMessage('⚠️ Opening cash cannot be negative.');
      return;
    }

    setOpeningSubmitting(true);
    try {
      const shift = await window.api.shifts.openShift({
        openingCashPaisa: openingPaisa,
        notes: openNotes.trim() || undefined,
      });
      setCurrentShift(shift);
      setShowOpenModal(false);
      setToastMessage(`✅ Shift opened successfully with ${formatPKR(shift.openingCashPaisa)}.`);
      loadData();
    } catch (err: unknown) {
      console.error('[DayEndReport] Open shift failed:', err);
      setToastMessage(`⚠️ ${err instanceof Error ? err.message : 'Failed to open shift.'}`);
    } finally {
      setOpeningSubmitting(false);
    }
  };

  // Close Shift Handler
  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentShift) return;

    const countedPaisa = convertRupeesToPaisa(countedCashInput);
    if (countedPaisa < 0) {
      setToastMessage('⚠️ Counted cash cannot be negative.');
      return;
    }

    setCloseSubmitting(true);
    try {
      const closed = await window.api.shifts.closeShift({
        shiftId: currentShift.id,
        countedCashPaisa: countedPaisa,
        notes: closeNotes.trim() || undefined,
      });
      setCurrentShift(null);
      setShowCloseModal(false);
      setToastMessage(`✅ Shift closed successfully. Difference: ${formatPKR(closed.differencePaisa ?? 0)}.`);

      // Prompt printing Z-report
      handlePrintZReport(closed);
      loadData();
    } catch (err: unknown) {
      console.error('[DayEndReport] Close shift failed:', err);
      setToastMessage(`⚠️ ${err instanceof Error ? err.message : 'Failed to close shift.'}`);
    } finally {
      setCloseSubmitting(false);
    }
  };

  // Print Thermal Z-Report
  const handlePrintZReport = async (shift: ShiftRecord) => {
    setIsPrinting(true);
    try {
      const html = generateZReportHtml(
        {
          id: shift.id,
          counterName: shift.counterName || session.counter.name,
          cashierName: shift.cashierName || session.user.name,
          openedAt: shift.openedAt,
          closedAt: shift.closedAt,
          openingCashPaisa: shift.openingCashPaisa,
          countedCashPaisa: shift.countedCashPaisa,
          expectedCashPaisa: shift.expectedCashPaisa,
          differencePaisa: shift.differencePaisa,
          salesCashPaisa: shift.salesCashPaisa,
          salesCardPaisa: shift.salesCardPaisa,
          salesWalletPaisa: shift.salesWalletPaisa,
          salesTotalPaisa: shift.salesTotalPaisa,
          salesCount: shift.salesCount,
          returnsCashPaisa: shift.returnsCashPaisa,
          returnsCount: shift.returnsCount,
          notes: shift.notes,
        },
        {
          pharmacyName: session.branch.name || 'MEDICINE CORNER PHARMACY',
          pharmacyAddress: 'Commercial Area, Main Boulevard, Karachi',
        }
      );

      const res = await window.api.invoices.printReceipt(html, { silent: false });
      if (res.success) {
        setToastMessage('🖨️ Z-Report printed successfully.');
      } else {
        setToastMessage(`⚠️ Thermal print failed: ${res.error || 'Check printer.'}`);
      }
    } catch (err: unknown) {
      console.error('[DayEndReport] Print failed:', err);
      setToastMessage('⚠️ Could not trigger print dialogue.');
    } finally {
      setIsPrinting(false);
    }
  };

  // Live calculation for close shift modal
  const modalCountedPaisa = convertRupeesToPaisa(countedCashInput || '0');
  const modalExpectedPaisa = currentShift ? currentShift.expectedCashPaisa : 0;
  const modalDifferencePaisa = modalCountedPaisa - modalExpectedPaisa;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#f8fafc',
        overflowY: 'auto',
        padding: '24px',
        boxSizing: 'border-box',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className="toast-slide-in"
          style={{
            position: 'fixed',
            top: '20px',
            right: '24px',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            color: '#f8fafc',
            padding: '12px 20px',
            borderRadius: '10px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3), 0 0 0 1px rgba(99, 102, 241, 0.3)',
            zIndex: 9999,
            fontSize: '13px',
            fontWeight: 700,
            backdropFilter: 'blur(8px)',
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>📊</span>
            <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
              Day-End & Shift Reconciliation
            </h1>
            <kbd className="kbd-cap" style={{ fontSize: '11px', padding: '2px 8px' }}>
              F5
            </kbd>
          </div>
          <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0 0' }}>
            Active Counter: <strong style={{ color: '#0f172a' }}>{session.counter.name}</strong> •
            Branch: <strong style={{ color: '#0f172a' }}>{session.branch.name}</strong> • Cashier:{' '}
            <strong style={{ color: '#0f172a' }}>{session.user.name}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            className="interactive-btn"
            onClick={loadData}
            disabled={loading}
            style={{
              padding: '9px 18px',
              backgroundColor: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              color: '#334155',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
          >
            <span>{loading ? 'Refreshing...' : '🔄 Refresh Data'}</span>
          </button>
          {!currentShift && (
            <button
              type="button"
              className="interactive-btn"
              onClick={() => setShowOpenModal(true)}
              style={{
                padding: '9px 20px',
                background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 800,
                color: '#ffffff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 2px 4px rgba(5, 150, 105, 0.3)',
              }}
            >
              <span>🚀 Open New Shift</span>
            </button>
          )}
        </div>
      </div>

      {/* Current Shift Card */}
      {currentShift ? (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '14px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
            padding: '24px',
            marginBottom: '28px',
          }}
        >
          {/* Status Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid #f1f5f9',
              paddingBottom: '16px',
              marginBottom: '20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: '#ecfdf5',
                  color: '#065f46',
                  padding: '5px 14px',
                  borderRadius: '9999px',
                  fontSize: '12px',
                  fontWeight: 800,
                  border: '1px solid #a7f3d0',
                }}
              >
                <span className="pulse-green-dot" />
                SHIFT OPEN (ACTIVE)
              </span>
              <span className="tabular-nums" style={{ fontSize: '12px', color: '#64748b' }}>
                Shift ID: <code style={{ backgroundColor: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>{currentShift.id.slice(0, 8)}</code>
              </span>
              <span className="tabular-nums" style={{ fontSize: '12px', color: '#64748b' }}>
                Opened:{' '}
                {new Date(currentShift.openedAt).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: true,
                  timeZone: 'Asia/Karachi',
                })}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="interactive-btn"
                onClick={() => handlePrintZReport(currentShift)}
                disabled={isPrinting}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#0f172a',
                  cursor: isPrinting ? 'not-allowed' : 'pointer',
                }}
              >
                🖨️ Print Interim Z-Report
              </button>
              <button
                type="button"
                className="interactive-btn"
                onClick={() => setShowCloseModal(true)}
                style={{
                  padding: '8px 20px',
                  background: 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 800,
                  color: '#ffffff',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(225, 29, 72, 0.3)',
                }}
              >
                🔒 End Shift & Reconcile
              </button>
            </div>
          </div>

          {/* KPI Metrics Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '16px',
            }}
          >
            {/* Opening Cash */}
            <div
              style={{
                backgroundColor: '#f8fafc',
                padding: '18px',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Opening Cash
              </div>
              <div className="tabular-nums" style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', marginTop: '6px' }}>
                {formatPKR(currentShift.openingCashPaisa)}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                Initial drawer float
              </div>
            </div>

            {/* Cash Sales */}
            <div
              style={{
                backgroundColor: '#f0fdf4',
                padding: '18px',
                borderRadius: '10px',
                border: '1px solid #bbf7d0',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Cash Sales (+)
              </div>
              <div className="tabular-nums" style={{ fontSize: '22px', fontWeight: 800, color: '#15803d', marginTop: '6px' }}>
                {formatPKR(currentShift.salesCashPaisa)}
              </div>
              <div className="tabular-nums" style={{ fontSize: '11px', color: '#166534', marginTop: '4px' }}>
                From {currentShift.salesCount} sale receipts
              </div>
            </div>

            {/* Digital / Card / Wallet */}
            <div
              style={{
                backgroundColor: '#eff6ff',
                padding: '18px',
                borderRadius: '10px',
                border: '1px solid #bfdbfe',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Card & Wallet
              </div>
              <div className="tabular-nums" style={{ fontSize: '22px', fontWeight: 800, color: '#1d4ed8', marginTop: '6px' }}>
                {formatPKR(currentShift.salesCardPaisa + currentShift.salesWalletPaisa)}
              </div>
              <div className="tabular-nums" style={{ fontSize: '11px', color: '#2563eb', marginTop: '4px' }}>
                Card: {formatPKR(currentShift.salesCardPaisa)} | Wallet: {formatPKR(currentShift.salesWalletPaisa)}
              </div>
            </div>

            {/* Cash Returns */}
            <div
              style={{
                backgroundColor: '#fff1f2',
                padding: '18px',
                borderRadius: '10px',
                border: '1px solid #fecdd3',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#9f1239', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Cash Returns (-)
              </div>
              <div className="tabular-nums" style={{ fontSize: '22px', fontWeight: 800, color: '#be123c', marginTop: '6px' }}>
                {formatPKR(currentShift.returnsCashPaisa)}
              </div>
              <div className="tabular-nums" style={{ fontSize: '11px', color: '#9f1239', marginTop: '4px' }}>
                From {currentShift.returnsCount} credit notes
              </div>
            </div>

            {/* Expected In Drawer */}
            <div
              style={{
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                padding: '18px',
                borderRadius: '10px',
                color: '#ffffff',
                boxShadow: '0 4px 12px rgba(15, 23, 42, 0.25)',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Expected In Drawer
              </div>
              <div className="tabular-nums" style={{ fontSize: '22px', fontWeight: 900, color: '#38bdf8', marginTop: '6px' }}>
                {formatPKR(currentShift.expectedCashPaisa)}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                Float + Cash Sales - Refunds
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '2px dashed #cbd5e1',
            padding: '36px',
            textAlign: 'center',
            marginBottom: '28px',
          }}
        >
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔒</div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>
            No Shift Currently Open for Counter {session.counter.name}
          </h2>
          <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '480px', margin: '0 auto 18px auto' }}>
            Open a shift and record starting cash in the till before running sales.
          </p>
          <button
            type="button"
            onClick={() => setShowOpenModal(true)}
            style={{
              padding: '10px 24px',
              backgroundColor: '#16a34a',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 700,
              color: '#ffffff',
              cursor: 'pointer',
              boxShadow: '0 4px 6px -1px rgba(22, 163, 74, 0.3)',
            }}
          >
            🚀 Open Shift with Opening Cash
          </button>
        </div>
      )}

      {/* Historical Shifts Section */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
          padding: '24px',
          flex: 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.01em' }}>
            📜 Shift & Day-End History
          </h2>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            Showing last {shiftHistory.length} closed shifts
          </span>
        </div>

        {shiftHistory.length === 0 ? (
          <div
            style={{
              padding: '48px',
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: '14px',
            }}
          >
            <div style={{ fontSize: '28px', marginBottom: '6px' }}>📜</div>
            No closed shifts recorded yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr
                  style={{
                    backgroundColor: '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    textAlign: 'left',
                  }}
                >
                  <th style={{ padding: '12px 14px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Opened</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Closed</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cashier</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>Opening</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>Gross Sales</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>Expected</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>Counted</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>Variance</th>
                  <th style={{ padding: '12px 14px', fontWeight: 800, color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shiftHistory.map((s) => {
                  const isClosed = s.status === 'closed';
                  const diff = s.differencePaisa ?? 0;
                  const isBalanced = diff === 0;
                  const isShortage = diff < 0;

                  return (
                    <tr
                      key={s.id}
                      className="cart-row"
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        backgroundColor: s.status === 'open' ? '#f0fdf4' : '#ffffff',
                        transition: 'background-color 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '12px 14px' }}>
                        <div className="tabular-nums" style={{ fontWeight: 700, color: '#1e293b' }}>
                          {new Date(s.openedAt).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            timeZone: 'Asia/Karachi',
                          })}
                        </div>
                        <div className="tabular-nums" style={{ fontSize: '11px', color: '#64748b' }}>
                          {new Date(s.openedAt).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Karachi',
                          })}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {s.closedAt ? (
                          <div>
                            <div className="tabular-nums" style={{ fontWeight: 700, color: '#1e293b' }}>
                              {new Date(s.closedAt).toLocaleDateString('en-GB', {
                                day: '2-digit',
                                month: 'short',
                                timeZone: 'Asia/Karachi',
                              })}
                            </div>
                            <div className="tabular-nums" style={{ fontSize: '11px', color: '#64748b' }}>
                              {new Date(s.closedAt).toLocaleTimeString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'Asia/Karachi',
                              })}
                            </div>
                          </div>
                        ) : (
                          <span
                            style={{
                              backgroundColor: '#dcfce7',
                              color: '#166534',
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '6px',
                              border: '1px solid #bbf7d0',
                            }}
                          >
                            Active
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#334155', fontWeight: 600 }}>
                        {s.cashierName || 'Cashier'}
                      </td>
                      <td className="tabular-nums" style={{ padding: '12px 14px', textAlign: 'right', color: '#475569' }}>
                        {formatPKR(s.openingCashPaisa)}
                      </td>
                      <td
                        className="tabular-nums"
                        style={{
                          padding: '12px 14px',
                          textAlign: 'right',
                          fontWeight: 700,
                          color: '#0f172a',
                        }}
                      >
                        {formatPKR(s.salesTotalPaisa)}
                      </td>
                      <td className="tabular-nums" style={{ padding: '12px 14px', textAlign: 'right', color: '#475569' }}>
                        {formatPKR(s.expectedCashPaisa)}
                      </td>
                      <td
                        className="tabular-nums"
                        style={{
                          padding: '12px 14px',
                          textAlign: 'right',
                          fontWeight: 700,
                          color: s.countedCashPaisa != null ? '#0f172a' : '#94a3b8',
                        }}
                      >
                        {s.countedCashPaisa != null ? formatPKR(s.countedCashPaisa) : '—'}
                      </td>
                      <td className="tabular-nums" style={{ padding: '12px 14px', textAlign: 'right' }}>
                        {isClosed ? (
                          <span
                            style={{
                              fontWeight: 800,
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              backgroundColor: isBalanced ? '#ecfdf5' : isShortage ? '#fee2e2' : '#eff6ff',
                              color: isBalanced ? '#047857' : isShortage ? '#b91c1c' : '#1d4ed8',
                              border: `1px solid ${isBalanced ? '#a7f3d0' : isShortage ? '#fecaca' : '#bfdbfe'}`,
                            }}
                          >
                            {diff > 0 ? '+' : ''}
                            {formatPKR(diff)}
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <button
                          type="button"
                          className="interactive-btn"
                          onClick={() => handlePrintZReport(s)}
                          style={{
                            padding: '5px 12px',
                            backgroundColor: '#ffffff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 700,
                            color: '#0f172a',
                            cursor: 'pointer',
                          }}
                        >
                          🖨️ Z-Slip
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Open Shift */}
      {showOpenModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-shift-title"
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !openingSubmitting) setShowOpenModal(false);
          }}
        >
          <div
            className="modal-content-card"
            style={{
              width: '100%',
              maxWidth: '460px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '18px 24px',
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                color: '#ffffff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>🚀</span>
                <h2 id="open-shift-title" style={{ fontSize: '18px', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
                  Open New Shift
                </h2>
                <kbd className="kbd-cap-dark" style={{ fontSize: '11px', padding: '1px 6px' }}>
                  Esc
                </kbd>
              </div>
              <button
                type="button"
                className="interactive-btn"
                onClick={() => setShowOpenModal(false)}
                disabled={openingSubmitting}
                aria-label="Close dialog"
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  width: '32px',
                  height: '32px',
                  color: '#cbd5e1',
                  fontSize: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleOpenShift} style={{ padding: '24px' }}>
              <div style={{ marginBottom: '18px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#334155',
                    marginBottom: '6px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Opening Cash Float in Till (PKR) *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={openingCashInput}
                  onChange={(e) => setOpeningCashInput(e.target.value)}
                  placeholder="e.g. 5000"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '18px',
                    fontWeight: 800,
                    boxSizing: 'border-box',
                    outline: 'none',
                    fontFamily: 'Consolas, monospace',
                  }}
                />
                <div className="tabular-nums" style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
                  Starting float: <strong style={{ color: '#0f172a' }}>{formatPKR(convertRupeesToPaisa(openingCashInput || '0'))}</strong>
                </div>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#334155',
                    marginBottom: '6px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Notes / Float Breakdown (Optional)
                </label>
                <input
                  type="text"
                  value={openNotes}
                  onChange={(e) => setOpenNotes(e.target.value)}
                  placeholder="e.g. 5x 1000, 10x 500 notes"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  className="interactive-btn"
                  onClick={() => setShowOpenModal(false)}
                  disabled={openingSubmitting}
                  style={{
                    padding: '9px 18px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="interactive-btn"
                  disabled={openingSubmitting}
                  style={{
                    padding: '9px 24px',
                    background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 800,
                    color: '#ffffff',
                    cursor: openingSubmitting ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 4px rgba(5, 150, 105, 0.3)',
                  }}
                >
                  {openingSubmitting ? 'Opening...' : 'Start Shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Close Shift / Day-End */}
      {showCloseModal && currentShift && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-shift-title"
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !closeSubmitting) setShowCloseModal(false);
          }}
        >
          <div
            className="modal-content-card"
            style={{
              width: '100%',
              maxWidth: '540px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '18px 24px',
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                color: '#ffffff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>🔒</span>
                  <h2 id="close-shift-title" style={{ fontSize: '18px', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
                    Close Shift & Reconciliation
                  </h2>
                  <kbd className="kbd-cap-dark" style={{ fontSize: '11px', padding: '1px 6px' }}>
                    Esc
                  </kbd>
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                  Counter: <strong style={{ color: '#ffffff' }}>{currentShift.counterName}</strong> • Cashier: {currentShift.cashierName}
                </div>
              </div>
              <button
                type="button"
                className="interactive-btn"
                onClick={() => setShowCloseModal(false)}
                disabled={closeSubmitting}
                aria-label="Close dialog"
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  width: '32px',
                  height: '32px',
                  color: '#cbd5e1',
                  fontSize: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCloseShift} style={{ padding: '24px' }}>
              {/* Expected Cash Display */}
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '16px 20px',
                  marginBottom: '18px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                  <span style={{ color: '#64748b' }}>(+) Opening Float:</span>
                  <span className="tabular-nums" style={{ fontWeight: 600 }}>{formatPKR(currentShift.openingCashPaisa)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                  <span style={{ color: '#047857' }}>(+) Total Cash Sales:</span>
                  <span className="tabular-nums" style={{ fontWeight: 700, color: '#047857' }}>
                    {formatPKR(currentShift.salesCashPaisa)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '13px' }}>
                  <span style={{ color: '#b91c1c' }}>(-) Total Cash Refunds:</span>
                  <span className="tabular-nums" style={{ fontWeight: 700, color: '#b91c1c' }}>
                    {formatPKR(currentShift.returnsCashPaisa)}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTop: '1px dashed #cbd5e1',
                    paddingTop: '10px',
                  }}
                >
                  <span style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                    System Expected Cash:
                  </span>
                  <span className="tabular-nums" style={{ fontSize: '20px', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em' }}>
                    {formatPKR(currentShift.expectedCashPaisa)}
                  </span>
                </div>
              </div>

              {/* Counted Cash Input */}
              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#1e293b',
                    marginBottom: '6px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Physical Counted Cash in Drawer (PKR) *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  autoFocus
                  value={countedCashInput}
                  onChange={(e) => setCountedCashInput(e.target.value)}
                  placeholder="e.g. 24500"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '2px solid #6366f1',
                    fontSize: '20px',
                    fontWeight: 800,
                    boxSizing: 'border-box',
                    outline: 'none',
                    fontFamily: 'Consolas, monospace',
                  }}
                />
              </div>

              {/* Discrepancy Alert */}
              <div
                style={{
                  padding: '14px 18px',
                  borderRadius: '10px',
                  marginBottom: '18px',
                  border: '1px solid',
                  backgroundColor:
                    modalDifferencePaisa === 0
                      ? '#ecfdf5'
                      : modalDifferencePaisa < 0
                      ? '#fff1f2'
                      : '#eff6ff',
                  borderColor:
                    modalDifferencePaisa === 0
                      ? '#a7f3d0'
                      : modalDifferencePaisa < 0
                      ? '#fecdd3'
                      : '#bfdbfe',
                  color:
                    modalDifferencePaisa === 0
                      ? '#065f46'
                      : modalDifferencePaisa < 0
                      ? '#9f1239'
                      : '#1e40af',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 800 }}>
                    {modalDifferencePaisa === 0
                      ? '✅ Cash Drawer Balanced'
                      : modalDifferencePaisa < 0
                      ? '⚠️ Cash Shortage Detected'
                      : 'ℹ️ Cash Overage Detected'}
                  </span>
                  <span className="tabular-nums" style={{ fontSize: '18px', fontWeight: 900 }}>
                    {modalDifferencePaisa > 0 ? '+' : ''}
                    {formatPKR(modalDifferencePaisa)}
                  </span>
                </div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>
                  {modalDifferencePaisa === 0
                    ? 'Physical cash matches system expected amount exactly.'
                    : modalDifferencePaisa < 0
                    ? `Physical count is ${formatPKR(Math.abs(modalDifferencePaisa))} LESS than expected sales.`
                    : `Physical count is ${formatPKR(modalDifferencePaisa)} MORE than expected sales.`}
                </div>
              </div>

              {/* Close Notes */}
              <div style={{ marginBottom: '24px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#475569',
                    marginBottom: '6px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Closing Notes / Discrepancy Reason
                </label>
                <textarea
                  rows={2}
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Explain any shortage or overage notes..."
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                    resize: 'none',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  className="interactive-btn"
                  onClick={() => setShowCloseModal(false)}
                  disabled={closeSubmitting}
                  style={{
                    padding: '9px 18px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="interactive-btn"
                  disabled={closeSubmitting}
                  style={{
                    padding: '9px 24px',
                    background: 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 800,
                    color: '#ffffff',
                    cursor: closeSubmitting ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 4px rgba(225, 29, 72, 0.3)',
                  }}
                >
                  {closeSubmitting ? 'Sealing Shift...' : 'Confirm & Seal Shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
