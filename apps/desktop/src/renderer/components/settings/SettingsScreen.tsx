import React, { useState, useEffect, useRef } from 'react';
import type { AuthSession } from '@pos/shared';
import { useI18n } from '../../utils/i18n/I18nContext';
import { generateThermalReceiptHtml } from '../../utils/receiptGenerator';
import type { BackupRecord } from '../../../preload/index.d';

interface SettingsScreenProps {
  session: AuthSession;
  onClose?: () => void;
}

export function SettingsScreen({ session }: SettingsScreenProps) {
  const { locale, setLocale, t, isRtl } = useI18n();

  const [activeTab, setActiveTab] = useState<
    'general' | 'hardware' | 'scanner' | 'shortcuts' | 'backup' | 'diagnostics'
  >('general');

  // Printer & Hardware state
  const [printers, setPrinters] = useState<Array<{ name: string; displayName: string; isDefault: boolean }>>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>(() => {
    return localStorage.getItem('pos_printer_name') || '';
  });
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>(() => {
    return (localStorage.getItem('pos_paper_width') as '80mm' | '58mm') || '80mm';
  });
  const [customHeader, setCustomHeader] = useState<string>(() => {
    return localStorage.getItem('pos_receipt_header') || '';
  });
  const [customFooter, setCustomFooter] = useState<string>(() => {
    return (
      localStorage.getItem('pos_receipt_footer') ||
      'Items can be returned within 3 days with original receipt in intact condition.'
    );
  });
  const [testPrintStatus, setTestPrintStatus] = useState<string | null>(null);

  // Scanner test state
  const [scannerInput, setScannerInput] = useState<string>('');
  const [lastScanned, setLastScanned] = useState<string>('');
  const [scannerTimingMs, setScannerTimingMs] = useState<number | null>(null);
  const [isHardwareScanner, setIsHardwareScanner] = useState<boolean | null>(null);
  const keyTimestampsRef = useRef<number[]>([]);

  // Backups state
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [backupLoading, setBackupLoading] = useState<boolean>(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [restoreModalFile, setRestoreModalFile] = useState<string | null>(null);
  const [ownerPinInput, setOwnerPinInput] = useState<string>('');
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Diagnostics & Updater state
  const [integrityStatus, setIntegrityStatus] = useState<{ ok: boolean; message: string; dbPath: string } | null>(null);
  const [diagnosticsResult, setDiagnosticsResult] = useState<string | null>(null);
  const [updaterStatus, setUpdaterStatus] = useState<string | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState<boolean>(false);

  // Load initial settings and printers
  useEffect(() => {
    if (window.api?.system?.getPrinters) {
      window.api.system.getPrinters().then((list) => {
        setPrinters(list);
        if (!selectedPrinter && list.length > 0) {
          const defaultP = list.find((p) => p.isDefault) || list[0];
          if (defaultP) {
            setSelectedPrinter(defaultP.name);
          }
        }
      });
    }

    if (window.api?.system?.getIntegrityStatus) {
      window.api.system.getIntegrityStatus().then((status) => {
        setIntegrityStatus(status);
      });
    }

    loadBackups();
  }, []);

  const loadBackups = async () => {
    if (window.api?.backup?.list) {
      try {
        const list = await window.api.backup.list();
        setBackups(list);
      } catch (err) {
        console.error('Failed to list backups:', err);
      }
    }
  };

  const handleCreateBackup = async () => {
    if (!window.api?.backup?.create) return;
    setBackupLoading(true);
    setBackupMessage(null);
    try {
      const res = await window.api.backup.create();
      if (res.success) {
        setBackupMessage(`${t.backupCreatedSuccess} (${res.filename})`);
        loadBackups();
      } else {
        setBackupMessage(t.backupCreatedError);
      }
    } catch (err: unknown) {
      setBackupMessage(`${t.backupCreatedError}: ${String(err)}`);
    } finally {
      setBackupLoading(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!restoreModalFile || !window.api?.backup?.restore) return;
    setRestoreError(null);

    // Verify Owner Role
    if (session.user.role !== 'owner') {
      setRestoreError('Access denied: Only an Owner can restore database backups.');
      return;
    }

    // Authenticate Owner PIN
    try {
      const unlockRes = await window.api.auth.unlockSession({ pin: ownerPinInput });
      if (!unlockRes) {
        setRestoreError('Invalid Owner PIN.');
        return;
      }
    } catch (err: unknown) {
      setRestoreError(`Authorization failed: ${String(err)}`);
      return;
    }

    try {
      const result = await window.api.backup.restore(restoreModalFile);
      if (result.success) {
        alert(`${t.restoreSuccessMessage}\nSafety snapshot created: ${result.safetyBackupFile}`);
        setRestoreModalFile(null);
        setOwnerPinInput('');
        window.location.reload();
      }
    } catch (err: unknown) {
      setRestoreError(`${t.restoreErrorMessage}: ${String(err)}`);
    }
  };

  // Hardware scanner wedge detector
  const handleScannerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const now = performance.now();
    keyTimestampsRef.current.push(now);

    if (e.key === 'Enter') {
      e.preventDefault();
      const timestamps = keyTimestampsRef.current;
      if (timestamps.length >= 2) {
        const first = timestamps[0];
        const last = timestamps[timestamps.length - 1];
        if (first !== undefined && last !== undefined) {
          const totalDuration = last - first;
          const avgInterval = totalDuration / (timestamps.length - 1);
          setScannerTimingMs(Math.round(totalDuration));

          // Hardware wedge scanners type with <50ms between characters
          const isHardware = avgInterval < 50;
          setIsHardwareScanner(isHardware);

          // Optional scanner beep
          if (isHardware) {
            try {
              const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.frequency.setValueAtTime(1200, ctx.currentTime);
              gain.gain.setValueAtTime(0.1, ctx.currentTime);
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.start();
              osc.stop(ctx.currentTime + 0.08);
            } catch {
              // Audio context ignored if blocked
            }
          }
        }
      }

      setLastScanned(scannerInput);
      setScannerInput('');
      keyTimestampsRef.current = [];
    }
  };

  const handleTestPrint = async () => {
    setTestPrintStatus('Printing test receipt...');
    try {
      const testHtml = generateThermalReceiptHtml(
        {
          id: 'test-receipt',
          invoiceNumber: 'INV-TEST-0001',
          createdAt: new Date().toISOString(),
          subtotalPaisa: 55000,
          discountPaisa: 5000,
          taxPaisa: 0,
          totalPaisa: 50000,
          cashierName: session.user.name,
          counterName: 'Counter 1',
          branchName: 'Medicine Corner Pharmacy',
          branchAddress: 'Commercial Area, Main Boulevard, Karachi',
          lines: [
            {
              id: '1',
              brandName: 'Panadol Extra 500mg/65mg',
              quantity: 2,
              unitPricePaisa: 25000,
              discountPaisa: 0,
              lineTotalPaisa: 50000,
              batchNo: 'B2026-X',
              expiryDate: '2028-12-31',
            },
          ],
          payments: [
            {
              method: 'cash',
              amountPaisa: 50000,
              tenderedPaisa: 100000,
              changePaisa: 50000,
            },
          ],
        },
        {
          locale,
          paperWidth,
          customHeader,
          customFooter,
        }
      );

      const res = await window.api.invoices.printReceipt(testHtml, {
        deviceName: selectedPrinter || undefined,
        silent: true,
      });

      if (res.success) {
        setTestPrintStatus(`✓ ${t.testPrintSuccess}`);
      } else {
        setTestPrintStatus(`✗ ${t.testPrintFailed}: ${res.error || 'Unknown printer error'}`);
      }
    } catch (err: unknown) {
      setTestPrintStatus(`✗ ${t.testPrintFailed}: ${String(err)}`);
    }
  };

  const handleExportDiagnostics = async () => {
    if (!window.api?.system?.exportDiagnostics) return;
    setDiagnosticsResult('Generating diagnostics package...');
    try {
      const res = await window.api.system.exportDiagnostics();
      if (res.success && res.zipPath) {
        setDiagnosticsResult(`✓ ${t.exportDiagnosticsSuccess} ${res.zipPath}`);
      } else {
        setDiagnosticsResult(`✗ Error: ${res.error || 'Failed to export'}`);
      }
    } catch (err: unknown) {
      setDiagnosticsResult(`✗ Error: ${String(err)}`);
    }
  };

  const handleCheckUpdates = async () => {
    if (!window.api?.updater?.check) return;
    setCheckingUpdates(true);
    setUpdaterStatus(t.checkingUpdates);
    try {
      const res = await window.api.updater.check();
      if (res.updateAvailable) {
        setUpdaterStatus(t.updateAvailableMsg);
      } else {
        setUpdaterStatus(t.updateUpToDate);
      }
    } catch (err: unknown) {
      setUpdaterStatus(`Update check failed: ${String(err)}`);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const saveHardwareSettings = () => {
    localStorage.setItem('pos_printer_name', selectedPrinter);
    localStorage.setItem('pos_paper_width', paperWidth);
    localStorage.setItem('pos_receipt_header', customHeader);
    localStorage.setItem('pos_receipt_footer', customFooter);
    alert(t.save);
  };

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#f1f5f9',
        overflowY: 'auto',
      }}
    >
      {/* Top Header */}
      <div
        style={{
          padding: '16px 24px',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
            {t.settingsTitle}
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
            {t.settingsDesc}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setLocale(locale === 'en' ? 'ur' : 'en')}
            style={{
              padding: '6px 12px',
              backgroundColor: '#e2e8f0',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🌐 {locale === 'en' ? 'اردو' : 'English'}
          </button>
        </div>
      </div>

      {/* Tabs Bar */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          padding: '8px 24px 0 24px',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #cbd5e1',
        }}
      >
        {[
          { id: 'general', label: t.tabGeneral },
          { id: 'hardware', label: t.tabHardware },
          { id: 'scanner', label: t.tabScanner },
          { id: 'shortcuts', label: t.tabShortcuts },
          { id: 'backup', label: t.tabBackup },
          { id: 'diagnostics', label: t.tabDiagnostics },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === tab.id ? '3px solid #2563eb' : '3px solid transparent',
              color: activeTab === tab.id ? '#2563eb' : '#64748b',
              fontWeight: activeTab === tab.id ? 700 : 500,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Contents */}
      <div style={{ padding: '24px', maxWidth: '1000px', width: '100%' }}>
        {/* 1. GENERAL / LANGUAGE TAB */}
        {activeTab === 'general' && (
          <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', padding: '24px', border: '1px solid #e2e8f0' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginTop: 0, marginBottom: '16px' }}>
              {t.languageSelection}
            </h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
              {t.languageDesc}
            </p>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 20px',
                  border: locale === 'en' ? '2px solid #2563eb' : '1px solid #cbd5e1',
                  borderRadius: '6px',
                  backgroundColor: locale === 'en' ? '#eff6ff' : '#ffffff',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                <input
                  type="radio"
                  name="locale"
                  value="en"
                  checked={locale === 'en'}
                  onChange={() => setLocale('en')}
                />
                🇬🇧 {t.english}
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 20px',
                  border: locale === 'ur' ? '2px solid #2563eb' : '1px solid #cbd5e1',
                  borderRadius: '6px',
                  backgroundColor: locale === 'ur' ? '#eff6ff' : '#ffffff',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                <input
                  type="radio"
                  name="locale"
                  value="ur"
                  checked={locale === 'ur'}
                  onChange={() => setLocale('ur')}
                />
                🇵🇰 {t.urdu}
              </label>
            </div>

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
                {t.layoutDirection}: <span style={{ color: '#2563eb' }}>{isRtl ? t.rtlText : t.ltrText}</span>
              </div>
              <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                {t.layoutDirectionDesc}
              </p>
            </div>
          </div>
        )}

        {/* 2. PRINTER & HARDWARE TAB */}
        {activeTab === 'hardware' && (
          <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', padding: '24px', border: '1px solid #e2e8f0' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginTop: 0, marginBottom: '4px' }}>
              {t.printerSetup}
            </h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>
              {t.printerSetupDesc}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  {t.selectPrinter}
                </label>
                <select
                  value={selectedPrinter}
                  onChange={(e) => setSelectedPrinter(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    backgroundColor: '#ffffff',
                  }}
                >
                  <option value="">-- {t.defaultSystemPrinter} --</option>
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.displayName || p.name} {p.isDefault ? `(${t.defaultSystemPrinter})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  {t.paperWidth}
                </label>
                <select
                  value={paperWidth}
                  onChange={(e) => setPaperWidth(e.target.value as '80mm' | '58mm')}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    backgroundColor: '#ffffff',
                  }}
                >
                  <option value="80mm">{t.width80mm}</option>
                  <option value="58mm">{t.width58mm}</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                {t.receiptHeader}
              </label>
              <input
                type="text"
                value={customHeader}
                onChange={(e) => setCustomHeader(e.target.value)}
                placeholder="e.g. 24/7 Delivery: 0300-1234567 | Branch 01"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                {t.receiptFooter}
              </label>
              <textarea
                value={customFooter}
                onChange={(e) => setCustomFooter(e.target.value)}
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={saveHardwareSettings}
                style={{
                  padding: '9px 18px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                💾 {t.save}
              </button>

              <button
                type="button"
                onClick={handleTestPrint}
                style={{
                  padding: '9px 18px',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🖨 {t.testPrint}
              </button>

              {testPrintStatus && (
                <span style={{ fontSize: '13px', fontWeight: 500, color: testPrintStatus.startsWith('✓') ? '#16a34a' : '#dc2626' }}>
                  {testPrintStatus}
                </span>
              )}
            </div>
          </div>
        )}

        {/* 3. BARCODE SCANNER TEST TAB */}
        {activeTab === 'scanner' && (
          <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', padding: '24px', border: '1px solid #e2e8f0' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginTop: 0, marginBottom: '4px' }}>
              {t.scannerTestTitle}
            </h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>
              {t.scannerTestDesc}
            </p>

            <div style={{ marginBottom: '20px' }}>
              <input
                type="text"
                className="barcode-input"
                autoFocus
                value={scannerInput}
                onChange={(e) => setScannerInput(e.target.value)}
                onKeyDown={handleScannerKeyDown}
                placeholder={t.scannerInputPlaceholder}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  fontSize: '16px',
                  borderRadius: '6px',
                  border: '2px solid #2563eb',
                  backgroundColor: '#f8fafc',
                  outline: 'none',
                }}
              />
            </div>

            {/* Test Results Display */}
            <div
              style={{
                padding: '16px',
                borderRadius: '8px',
                backgroundColor: isHardwareScanner === null ? '#f8fafc' : isHardwareScanner ? '#ecfdf5' : '#fffbeb',
                border: isHardwareScanner === null ? '1px solid #e2e8f0' : isHardwareScanner ? '1px solid #a7f3d0' : '1px solid #fde68a',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px', color: isHardwareScanner === null ? '#64748b' : isHardwareScanner ? '#065f46' : '#92400e' }}>
                {isHardwareScanner === null
                  ? `ℹ ${t.scannerStatusIdle}`
                  : isHardwareScanner
                  ? `✓ ${t.scannerStatusDetected}`
                  : `⚠ ${t.scannerStatusManual}`}
              </div>

              {lastScanned && (
                <div style={{ fontSize: '13px', color: '#334155', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '12px' }}>
                  <div>
                    <div style={{ color: '#64748b', fontSize: '12px' }}>{t.lastScannedBarcode}</div>
                    <div style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '15px' }}>{lastScanned}</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748b', fontSize: '12px' }}>{t.scanDuration}</div>
                    <div style={{ fontWeight: 700 }}>{scannerTimingMs} ms</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748b', fontSize: '12px' }}>{t.characterCount}</div>
                    <div style={{ fontWeight: 700 }}>{lastScanned.length} chars</div>
                  </div>
                </div>
              )}
            </div>

            {lastScanned && (
              <button
                type="button"
                onClick={() => {
                  setLastScanned('');
                  setIsHardwareScanner(null);
                  setScannerTimingMs(null);
                }}
                style={{
                  marginTop: '16px',
                  padding: '6px 14px',
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                {t.clearScannerTest}
              </button>
            )}
          </div>
        )}

        {/* 4. KEYBOARD SHORTCUTS REFERENCE TAB */}
        {activeTab === 'shortcuts' && (
          <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', padding: '24px', border: '1px solid #e2e8f0' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginTop: 0, marginBottom: '4px' }}>
              {t.shortcutsTitle}
            </h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>
              {t.shortcutsDesc}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {[
                { key: t.keyF1, desc: t.keyF1Desc },
                { key: t.keyF2, desc: t.keyF2Desc },
                { key: t.keyF3, desc: t.keyF3Desc },
                { key: t.keyF4, desc: t.keyF4Desc },
                { key: t.keyF5, desc: t.keyF5Desc },
                { key: t.keyF6, desc: t.keyF6Desc },
                { key: t.keyF7, desc: t.keyF7Desc },
                { key: t.keyF8, desc: t.keyF8Desc },
                { key: t.keyF9, desc: t.keyF9Desc },
                { key: t.keyF10, desc: t.keyF10Desc },
                { key: t.keyCtrlEnter, desc: t.keyCtrlEnterDesc },
                { key: t.keyEsc, desc: t.keyEscDesc },
              ].map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 14px',
                    backgroundColor: '#f8fafc',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <kbd
                    className="code-font"
                    style={{
                      padding: '4px 8px',
                      backgroundColor: '#e2e8f0',
                      border: '1px solid #94a3b8',
                      borderRadius: '4px',
                      fontWeight: 700,
                      fontSize: '12px',
                      color: '#0f172a',
                      minWidth: '60px',
                      textAlign: 'center',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                    }}
                  >
                    {item.key}
                  </kbd>
                  <span style={{ fontSize: '13px', color: '#334155', fontWeight: 500 }}>
                    {item.desc}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 5. DATABASE BACKUPS & RESTORE TAB */}
        {activeTab === 'backup' && (
          <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', padding: '24px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
                  {t.backupTitle}
                </h2>
                <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0 0' }}>
                  {t.backupDesc}
                </p>
              </div>

              <button
                type="button"
                onClick={handleCreateBackup}
                disabled={backupLoading}
                style={{
                  padding: '9px 18px',
                  backgroundColor: '#16a34a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: backupLoading ? 'wait' : 'pointer',
                }}
              >
                {backupLoading ? t.backupCreating : `💾 ${t.backupNow}`}
              </button>
            </div>

            {backupMessage && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '6px',
                  backgroundColor: backupMessage.includes('error') ? '#fef2f2' : '#f0fdf4',
                  color: backupMessage.includes('error') ? '#991b1b' : '#166534',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}
              >
                {backupMessage}
              </div>
            )}

            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#334155', marginBottom: '10px' }}>
              {t.recentBackups}
            </h3>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #cbd5e1' }}>
                  <th style={{ padding: '8px 12px', textAlign: isRtl ? 'right' : 'left' }}>{t.backupFileName}</th>
                  <th style={{ padding: '8px 12px', textAlign: isRtl ? 'right' : 'left' }}>{t.backupDate}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>{t.backupSize}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {backups.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                      No local backups created yet.
                    </td>
                  </tr>
                ) : (
                  backups.map((b) => (
                    <tr key={b.filename} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 600 }}>{b.filename}</td>
                      <td style={{ padding: '8px 12px', color: '#64748b' }}>
                        {new Date(b.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b' }}>
                        {(b.sizeBytes / 1024 / 1024).toFixed(2)} MB
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => setRestoreModalFile(b.filename)}
                          style={{
                            padding: '4px 10px',
                            backgroundColor: '#fee2e2',
                            color: '#b91c1c',
                            border: '1px solid #fecaca',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {t.restoreAction}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 6. DIAGNOSTICS & UPDATES TAB */}
        {activeTab === 'diagnostics' && (
          <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', padding: '24px', border: '1px solid #e2e8f0' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginTop: 0, marginBottom: '4px' }}>
              {t.diagnosticsTitle}
            </h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>
              {t.diagnosticsDesc}
            </p>

            {/* Integrity Status */}
            <div
              style={{
                padding: '16px',
                borderRadius: '8px',
                backgroundColor: integrityStatus?.ok ? '#ecfdf5' : '#fef2f2',
                border: integrityStatus?.ok ? '1px solid #a7f3d0' : '1px solid #fecaca',
                marginBottom: '20px',
              }}
            >
              <div style={{ fontSize: '13px', color: '#64748b' }}>{t.integrityStatus}</div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: integrityStatus?.ok ? '#065f46' : '#991b1b', marginTop: '4px' }}>
                {integrityStatus?.ok ? `✓ ${t.integrityOk}` : `✗ ${t.integrityFailed}`}
              </div>
              {integrityStatus?.dbPath && (
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', fontFamily: 'monospace' }}>
                  Path: {integrityStatus.dbPath}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '24px' }}>
              <button
                type="button"
                onClick={handleExportDiagnostics}
                style={{
                  padding: '9px 18px',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                📦 {t.exportDiagnosticsBtn}
              </button>

              {diagnosticsResult && (
                <span style={{ fontSize: '13px', color: '#0f172a' }}>{diagnosticsResult}</span>
              )}
            </div>

            {/* Auto Update Section */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 4px 0' }}>
                {t.autoUpdateTitle}
              </h3>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 16px 0' }}>
                {t.autoUpdateDesc} (Placeholder URL: https://updates.pos-pharmacy.local/releases/win/)
              </p>

              <button
                type="button"
                onClick={handleCheckUpdates}
                disabled={checkingUpdates}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: checkingUpdates ? 'wait' : 'pointer',
                }}
              >
                {checkingUpdates ? t.checkingUpdates : `🔄 ${t.checkUpdatesBtn}`}
              </button>

              {updaterStatus && (
                <div style={{ marginTop: '10px', fontSize: '13px', color: '#334155' }}>
                  {updaterStatus}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* RESTORE CONFIRMATION MODAL */}
      {restoreModalFile && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            dir={isRtl ? 'rtl' : 'ltr'}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              maxWidth: '500px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: 700, color: '#dc2626' }}>
              ⚠ {t.restoreModalTitle}
            </h3>

            <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5, marginBottom: '16px' }}>
              {t.restoreModalWarning}
            </p>

            <div style={{ backgroundColor: '#f8fafc', padding: '10px', borderRadius: '6px', marginBottom: '16px', fontSize: '12px', fontFamily: 'monospace' }}>
              File: {restoreModalFile}
            </div>

            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
              {t.restoreOwnerPinPrompt}
            </label>
            <input
              type="password"
              maxLength={8}
              autoFocus
              value={ownerPinInput}
              onChange={(e) => setOwnerPinInput(e.target.value)}
              placeholder="••••"
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '18px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                marginBottom: '16px',
                textAlign: 'center',
                letterSpacing: '4px',
              }}
            />

            {restoreError && (
              <div style={{ fontSize: '13px', color: '#dc2626', marginBottom: '16px' }}>
                {restoreError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setRestoreModalFile(null);
                  setOwnerPinInput('');
                  setRestoreError(null);
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={!ownerPinInput}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: !ownerPinInput ? 'not-allowed' : 'pointer',
                }}
              >
                {t.restoreConfirmButton}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
