export type SupportedLocale = 'en' | 'ur';

export interface AppTranslations {
  // Common / Navigation
  appName: string;
  posTerminal: string;
  catalog: string;
  purchasing: string;
  stockOverview: string;
  invoices: string;
  shiftDayEnd: string;
  syncStatus: string;
  settings: string;
  lockTerminal: string;
  logout: string;
  loading: string;
  save: string;
  cancel: string;
  confirm: string;
  delete: string;
  search: string;
  refresh: string;
  status: string;
  actions: string;
  back: string;
  close: string;
  retry: string;
  error: string;
  success: string;

  // Settings Screen
  settingsTitle: string;
  settingsDesc: string;
  tabGeneral: string;
  tabHardware: string;
  tabScanner: string;
  tabShortcuts: string;
  tabBackup: string;
  tabDiagnostics: string;

  // Settings: General / Language
  languageSelection: string;
  languageDesc: string;
  english: string;
  urdu: string;
  layoutDirection: string;
  layoutDirectionDesc: string;
  ltrText: string;
  rtlText: string;

  // Settings: Printer & Hardware
  printerSetup: string;
  printerSetupDesc: string;
  selectPrinter: string;
  defaultSystemPrinter: string;
  paperWidth: string;
  paperWidthDesc: string;
  width80mm: string;
  width58mm: string;
  receiptHeader: string;
  receiptHeaderDesc: string;
  receiptFooter: string;
  receiptFooterDesc: string;
  testPrint: string;
  testPrintSuccess: string;
  testPrintFailed: string;

  // Settings: Scanner Test
  scannerTestTitle: string;
  scannerTestDesc: string;
  scannerInputPlaceholder: string;
  scannerStatusIdle: string;
  scannerStatusDetected: string;
  scannerStatusManual: string;
  lastScannedBarcode: string;
  scanDuration: string;
  characterCount: string;
  clearScannerTest: string;

  // Settings: Keyboard Shortcuts
  shortcutsTitle: string;
  shortcutsDesc: string;
  keyF1: string;
  keyF1Desc: string;
  keyF2: string;
  keyF2Desc: string;
  keyF3: string;
  keyF3Desc: string;
  keyF4: string;
  keyF4Desc: string;
  keyF5: string;
  keyF5Desc: string;
  keyF6: string;
  keyF6Desc: string;
  keyF7: string;
  keyF7Desc: string;
  keyF8: string;
  keyF8Desc: string;
  keyF9: string;
  keyF9Desc: string;
  keyF10: string;
  keyF10Desc: string;
  keyCtrlEnter: string;
  keyCtrlEnterDesc: string;
  keyEsc: string;
  keyEscDesc: string;

  // Settings: Backups & Restore
  backupTitle: string;
  backupDesc: string;
  backupNow: string;
  backupCreating: string;
  backupCreatedSuccess: string;
  backupCreatedError: string;
  recentBackups: string;
  backupFileName: string;
  backupDate: string;
  backupSize: string;
  restoreAction: string;
  restoreModalTitle: string;
  restoreModalWarning: string;
  restoreOwnerPinPrompt: string;
  restoreConfirmButton: string;
  restoreSuccessMessage: string;
  restoreErrorMessage: string;

  // Settings: Diagnostics & Updates
  diagnosticsTitle: string;
  diagnosticsDesc: string;
  exportDiagnosticsBtn: string;
  exportDiagnosticsSuccess: string;
  integrityStatus: string;
  integrityOk: string;
  integrityFailed: string;
  autoUpdateTitle: string;
  autoUpdateDesc: string;
  checkUpdatesBtn: string;
  checkingUpdates: string;
  updateUpToDate: string;
  updateAvailableMsg: string;

  // Crash Handler / Error Boundary
  crashTitle: string;
  crashSubtitle: string;
  crashAdvice: string;
  reloadApp: string;
  exportCrashLog: string;
  technicalDetails: string;
}

export const TRANSLATIONS: Record<SupportedLocale, AppTranslations> = {
  en: {
    appName: 'POS Pharmacy Terminal',
    posTerminal: 'POS Terminal (F1)',
    catalog: 'Product Catalog (F2)',
    purchasing: 'Purchasing (F3)',
    stockOverview: 'Stock & Batches (F4)',
    invoices: 'Invoice History (F5)',
    shiftDayEnd: 'Shift & Day-End (F6)',
    syncStatus: 'Cloud Sync',
    settings: 'Settings & Hardware (F10)',
    lockTerminal: 'Lock Terminal (F9)',
    logout: 'Logout',
    loading: 'Loading...',
    save: 'Save Changes',
    cancel: 'Cancel',
    confirm: 'Confirm',
    delete: 'Delete',
    search: 'Search...',
    refresh: 'Refresh',
    status: 'Status',
    actions: 'Actions',
    back: 'Back',
    close: 'Close',
    retry: 'Retry',
    error: 'Error',
    success: 'Success',

    settingsTitle: 'Terminal Settings & Hardware Configuration',
    settingsDesc: 'Configure language, thermal receipt printers, barcode scanner wedge timing, and system backups.',
    tabGeneral: 'General & Language',
    tabHardware: 'Printer & Paper',
    tabScanner: 'Scanner Test',
    tabShortcuts: 'Shortcuts',
    tabBackup: 'Database Backups',
    tabDiagnostics: 'Diagnostics & Updates',

    languageSelection: 'Display Language',
    languageDesc: 'Select interface language for counter operations and navigation.',
    english: 'English (Default)',
    urdu: 'اردو (Urdu)',
    layoutDirection: 'Layout Direction',
    layoutDirectionDesc: 'Controls screen flow and Arabic/Urdu typography layout.',
    ltrText: 'Left to Right (LTR)',
    rtlText: 'Right to Left (RTL)',

    printerSetup: 'Thermal Receipt Printer',
    printerSetupDesc: 'Select connected ESC/POS or Windows thermal receipt printer.',
    selectPrinter: 'Select Printer',
    defaultSystemPrinter: 'System Default Printer',
    paperWidth: 'Receipt Paper Roll Width',
    paperWidthDesc: 'Adjust layout columns and margins to match your thermal paper roll.',
    width80mm: '80mm Standard Thermal Roll (Default)',
    width58mm: '58mm Narrow Thermal Roll',
    receiptHeader: 'Custom Receipt Header',
    receiptHeaderDesc: 'Optional pharmacy subtitle or branch address printed on receipts.',
    receiptFooter: 'Custom Return Policy Footer',
    receiptFooterDesc: 'Terms, return policy, or customer service message printed at the bottom.',
    testPrint: 'Print Test Receipt',
    testPrintSuccess: 'Test receipt sent to printer successfully.',
    testPrintFailed: 'Failed to send print job to printer.',

    scannerTestTitle: 'Barcode Scanner Hardware Test',
    scannerTestDesc: 'Scan any drug package barcode to verify hardware wedge keystroke speed (<50ms).',
    scannerInputPlaceholder: 'Focus here and scan a product barcode...',
    scannerStatusIdle: 'Ready for scan input',
    scannerStatusDetected: 'Hardware Wedge Scanner Detected (<50ms between keystrokes)',
    scannerStatusManual: 'Manual Keyboard Typing Detected (>50ms between keystrokes)',
    lastScannedBarcode: 'Last Scanned Barcode',
    scanDuration: 'Total Scan Duration',
    characterCount: 'Character Count',
    clearScannerTest: 'Clear Test Log',

    shortcutsTitle: 'POS Keyboard Shortcuts Reference',
    shortcutsDesc: 'Fast navigation reference designed for keyboard-first counter operation.',
    keyF1: 'F1',
    keyF1Desc: 'Open POS Checkout Terminal',
    keyF2: 'F2',
    keyF2Desc: 'Open Product Catalog & Inventory List',
    keyF3: 'F3',
    keyF3Desc: 'Open Purchasing & GRN Inward',
    keyF4: 'F4',
    keyF4Desc: 'Open Stock Adjustments & Batch Expiry',
    keyF5: 'F5',
    keyF5Desc: 'Open Invoice History & Customer Returns',
    keyF6: 'F6',
    keyF6Desc: 'Open Shift Cash & Day-End Closing',
    keyF7: 'F7',
    keyF7Desc: 'Focus POS Product Search Bar',
    keyF8: 'F8',
    keyF8Desc: 'Switch to Payment Tender Mode',
    keyF9: 'F9',
    keyF9Desc: 'Quick-Lock POS Terminal Screen',
    keyF10: 'F10',
    keyF10Desc: 'Open Settings & Hardware Configuration',
    keyCtrlEnter: 'Ctrl + Enter',
    keyCtrlEnterDesc: 'Finalize Sale and Print Thermal Receipt',
    keyEsc: 'Esc',
    keyEscDesc: 'Cancel modal / Clear active search selection',

    backupTitle: 'SQLite Safe Database Backups',
    backupDesc: 'Automated daily snapshots retain the last 14 backups. Manual backups use safe online SQLite backup API.',
    backupNow: 'Create Backup Now',
    backupCreating: 'Creating safe SQLite backup...',
    backupCreatedSuccess: 'Backup created successfully.',
    backupCreatedError: 'Failed to create database backup.',
    recentBackups: 'Available Local Backups (Max 14 Retained)',
    backupFileName: 'Backup Filename',
    backupDate: 'Created Date & Time',
    backupSize: 'File Size',
    restoreAction: 'Restore Backup',
    restoreModalTitle: 'Confirm Database Restore',
    restoreModalWarning: 'WARNING: Restoring will replace active local data. A safety snapshot of current data will be created first. Only Owners can perform this action.',
    restoreOwnerPinPrompt: 'Enter Owner PIN to authorize restore:',
    restoreConfirmButton: 'Authorize & Restore Database',
    restoreSuccessMessage: 'Database restored successfully! A safety snapshot was archived.',
    restoreErrorMessage: 'Failed to restore database.',

    diagnosticsTitle: 'Diagnostics & System Integrity',
    diagnosticsDesc: 'Export sanitized diagnostics zip (scrubbed of all customer and sales data) and verify SQLite integrity.',
    exportDiagnosticsBtn: 'Export Diagnostics ZIP',
    exportDiagnosticsSuccess: 'Diagnostics bundle exported to:',
    integrityStatus: 'SQLite Database Integrity',
    integrityOk: 'PRAGMA integrity_check: OK (Healthy)',
    integrityFailed: 'PRAGMA integrity_check: Corrupted / Repair Required',
    autoUpdateTitle: 'Software Auto-Update',
    autoUpdateDesc: 'Check for new versions from the local deployment server.',
    checkUpdatesBtn: 'Check for Updates',
    checkingUpdates: 'Checking update server...',
    updateUpToDate: 'POS Counter is up to date (Version matches latest release).',
    updateAvailableMsg: 'A new update is available on the update server.',

    crashTitle: 'Something Went Wrong',
    crashSubtitle: 'The POS application encountered an unexpected runtime error.',
    crashAdvice: 'Your database and shift records remain safe. You can reload the application or export diagnostics for technical support.',
    reloadApp: 'Reload POS Application',
    exportCrashLog: 'Export Diagnostics Bundle',
    technicalDetails: 'Technical Error Details (Sanitized)',
  },
  ur: {
    appName: 'فارمیسی پوائنٹ آف سیل ٹرمینل',
    posTerminal: 'سیلز کاؤنٹر (F1)',
    catalog: 'ادویات کا کیٹلاگ (F2)',
    purchasing: 'خریداری و سپلائر (F3)',
    stockOverview: 'اسٹاک و بیجز (F4)',
    invoices: 'انوائس ہسٹری (F5)',
    shiftDayEnd: 'شفٹ و اختتامِ دن (F6)',
    syncStatus: 'کلاؤڈ سنک',
    settings: 'ترتیبات و ہارڈویئر (F10)',
    lockTerminal: 'ٹرمینل لاک کریں (F9)',
    logout: 'لاگ آؤٹ',
    loading: 'لوڈ ہو رہا ہے...',
    save: 'تبدیلیاں محفوظ کریں',
    cancel: 'منسوخ',
    confirm: 'تصدیق کریں',
    delete: 'حذف کریں',
    search: 'تلاش کریں...',
    refresh: 'تازہ کریں',
    status: 'حالت',
    actions: 'اقدامات',
    back: 'واپس',
    close: 'بند کریں',
    retry: 'دوبارہ کوشش کریں',
    error: 'خرابی',
    success: 'کامیابی',

    settingsTitle: 'ٹرمینل ترتیبات اور ہارڈویئر کنفیگریشن',
    settingsDesc: 'زبان کا انتخاب، تھرمل پرنٹر، بارکوڈ اسکینر کی رفتار، اور ڈیٹا بیس بیک اپ کا انتظام کریں۔',
    tabGeneral: 'عام و زبان',
    tabHardware: 'پرنٹر و کاغذ',
    tabScanner: 'اسکینر ٹیسٹ',
    tabShortcuts: 'شارٹ کٹس',
    tabBackup: 'ڈیٹا بیس بیک اپ',
    tabDiagnostics: 'تشخیص و اپڈیٹ',

    languageSelection: 'ڈسپلے زبان',
    languageDesc: 'کاؤنٹر آپریشنز کے لیے انٹرفیس زبان کا انتخاب کریں۔',
    english: 'انگریزی (English)',
    urdu: 'اردو (Urdu)',
    layoutDirection: 'لے آؤٹ سمت',
    layoutDirectionDesc: 'اسکرین کے بہاؤ اور اردو ٹائپوگرافی کا کنٹرول۔',
    ltrText: 'بائیں سے دائیں (LTR)',
    rtlText: 'دائیں سے بائیں (RTL)',

    printerSetup: 'تھرمل رسید پرنٹر',
    printerSetupDesc: 'منسلک تھرمل رسید پرنٹر کا انتخاب کریں۔',
    selectPrinter: 'پرنٹر منتخب کریں',
    defaultSystemPrinter: 'سسٹم کا بنیادی پرنٹر',
    paperWidth: 'رسید کے رول کی چوڑائی',
    paperWidthDesc: 'تھرمل کاغذ کے مطابق رسید کا سائز منتخب کریں۔',
    width80mm: '80mm معیاری تھرمل رول (پہلے سے طے شدہ)',
    width58mm: '58mm چھوٹا تھرمل رول',
    receiptHeader: 'رسید کا عنوان (ہیڈر)',
    receiptHeaderDesc: 'فارمیسی کا ذیلی نام یا پتہ جو رسید پر درج ہو۔',
    receiptFooter: 'واپسی پالیسی (فوٹر)',
    receiptFooterDesc: 'شرائط، واپسی کی مدت یا تشکر کا پیغام۔',
    testPrint: 'آزمائشی رسید پرنٹ کریں',
    testPrintSuccess: 'آزمائشی رسید کامیابی سے پرنٹر پر بھیج دی گئی۔',
    testPrintFailed: 'پرنٹ بھیجنے میں ناکامی۔',

    scannerTestTitle: 'بارکوڈ اسکینر ہارڈویئر ٹیسٹ',
    scannerTestDesc: 'بارکوڈ اسکین کر کے ہارڈویئر کی اسپیڈ چیک کریں (50 ملی سیکنڈ سے کم)۔',
    scannerInputPlaceholder: 'یہاں کلک کر کے دوا کا بارکوڈ اسکین کریں...',
    scannerStatusIdle: 'اسکین کے لیے تیار ہے',
    scannerStatusDetected: 'ہارڈویئر اسکینر تصدیق شدہ (<50ms رفتار)',
    scannerStatusManual: 'دستی کی بورڈ ٹائپنگ (>50ms رفتار)',
    lastScannedBarcode: 'آخری اسکین شدہ بارکوڈ',
    scanDuration: 'کل اسکین وقت',
    characterCount: 'حروف کی تعداد',
    clearScannerTest: 'ٹیسٹ صاف کریں',

    shortcutsTitle: 'کی بورڈ شارٹ کٹس گائیڈ',
    shortcutsDesc: 'کاؤنٹر پر تیز رفتار کام کے لیے کی بورڈ شارٹ کٹس۔',
    keyF1: 'F1',
    keyF1Desc: 'سیلز کاؤنٹر کھولیں',
    keyF2: 'F2',
    keyF2Desc: 'پروڈکٹ کیٹلاگ و اسٹاک لسٹ',
    keyF3: 'F3',
    keyF3Desc: 'خریداری و سامان کی وصولی',
    keyF4: 'F4',
    keyF4Desc: 'اسٹاک ایڈجسٹمنٹ اور ایکسپائری',
    keyF5: 'F5',
    keyF5Desc: 'انوائس ہسٹری اور کسٹمر واپسی',
    keyF6: 'F6',
    keyF6Desc: 'شفٹ کیش و یومیہ اختتام',
    keyF7: 'F7',
    keyF7Desc: 'ادویات تلاش کرنے والے خانے پر جائیں',
    keyF8: 'F8',
    keyF8Desc: 'رقم وصولی موڈ پر جائیں',
    keyF9: 'F9',
    keyF9Desc: 'ٹرمینل اسکرین فوری لاک کریں',
    keyF10: 'F10',
    keyF10Desc: 'ترتیبات و ہارڈویئر کھولیں',
    keyCtrlEnter: 'Ctrl + Enter',
    keyCtrlEnterDesc: 'بل مکمل کریں اور تھرمل رسید پرنٹ کریں',
    keyEsc: 'Esc',
    keyEscDesc: 'ونڈو بند کریں / تلاش منسوخ کریں',

    backupTitle: 'محفوظ SQLite ڈیٹا بیس بیک اپ',
    backupDesc: 'روزانہ خودکار بیک اپ آخری 14 ریکارڈ محفوظ رکھتا ہے۔ یہ بیک اپ محفوظ آن لائن موڈ میں لیا جاتا ہے۔',
    backupNow: 'ابھی بیک اپ بنائیں',
    backupCreating: 'ڈیٹا بیس بیک اپ تیار ہو رہا ہے...',
    backupCreatedSuccess: 'بیک اپ کامیابی کے ساتھ محفوظ ہو گیا۔',
    backupCreatedError: 'بیک اپ بنانے میں ناکامی۔',
    recentBackups: 'دستیاب مقامی بیک اپس (زیادہ سے زیادہ 14)',
    backupFileName: 'فائل کا نام',
    backupDate: 'تاریخ و وقت',
    backupSize: 'سائز',
    restoreAction: 'بیک اپ بحال کریں',
    restoreModalTitle: 'ڈیٹا بیس بحالی کی تصدیق',
    restoreModalWarning: 'انتباہ: بیک اپ بحال کرنے سے موجودہ ڈیٹا تبدیل ہو جائے گا۔ حفاظتی طور پر موجودہ ڈیٹا کا الگ بیک اپ پہلے لیا جائے گا۔ صرف مالک ہی یہ عمل کر سکتا ہے۔',
    restoreOwnerPinPrompt: 'بحالی کی تصدیق کے لیے مالک کا پن کوڈ درج کریں:',
    restoreConfirmButton: 'تصدیق اور بحال کریں',
    restoreSuccessMessage: 'ڈیٹا بیس بحال ہو گیا! حفاظتی کاپی بھی محفوظ کر لی گئی۔',
    restoreErrorMessage: 'ڈیٹا بیس بحال کرنے میں ناکامی۔',

    diagnosticsTitle: 'سسٹم تشخیص اور ڈیٹا بیس صحت',
    diagnosticsDesc: 'تشخیصی لاگز برآمد کریں (مریض یا سیلز ڈیٹا کے بغیر) اور ڈیٹا بیس چیک کریں۔',
    exportDiagnosticsBtn: 'تشخیصی فائل (ZIP) برآمد کریں',
    exportDiagnosticsSuccess: 'فائل محفوظ کر لی گئی بمقام:',
    integrityStatus: 'ڈیٹا بیس سالمیت (Integrity Check)',
    integrityOk: 'ڈیٹا بیس مکمل طور پر درست اور صحت مند ہے (OK)',
    integrityFailed: 'ڈیٹا بیس میں خرابی پائی گئی ہے، مرمت درکار ہے',
    autoUpdateTitle: 'سافٹ ویئر خودکار اپڈیٹ',
    autoUpdateDesc: 'لوکل سرور سے نئے ورژن کی موجودگی چیک کریں۔',
    checkUpdatesBtn: 'نئی اپڈیٹ چیک کریں',
    checkingUpdates: 'سرور سے جانچ جاری ہے...',
    updateUpToDate: 'آپ کا سسٹم جدید ترین ورژن پر ہے۔',
    updateAvailableMsg: 'نیا ورژن سرور پر دستیاب ہے۔',

    crashTitle: 'ایک غیر متوقع مسئلہ پیش آیا',
    crashSubtitle: 'ایپلی کیشن میں ایک غیر متوقع خرابی رونما ہوئی ہے۔',
    crashAdvice: 'آپ کا ڈیٹا بیس اور شفٹ کا ریکارڈ مکمل طور پر محفوظ ہے۔ آپ ایپلی کیشن دوبارہ چلا سکتے ہیں۔',
    reloadApp: 'ایپلیکیشن دوبارہ چلائیں',
    exportCrashLog: 'تشخیصی لاگ برآمد کریں',
    technicalDetails: 'تکنیکی خرابی کی تفصیلات',
  },
};
