/**
 * Receipt translation dictionary for 80mm thermal printing.
 * Structured for English now and ready for future Urdu RTL support (Rule 10).
 */
export interface ReceiptStrings {
  pharmacyDefaultName: string;
  pharmacyDefaultAddress: string;
  phone: string;
  taxId: string;
  invoiceHeading: string;
  invoiceNo: string;
  date: string;
  time: string;
  cashier: string;
  counter: string;
  customer: string;
  doctor: string;
  notes: string;
  item: string;
  qty: string;
  price: string;
  total: string;
  batch: string;
  exp: string;
  subtotal: string;
  discount: string;
  tax: string;
  grandTotal: string;
  paid: string;
  tendered: string;
  change: string;
  paymentMethod: string;
  paymentCash: string;
  paymentCard: string;
  paymentWallet: string;
  fiscalHeading: string;
  fiscalStatusOffline: string;
  fiscalQrNotice: string;
  footerThankYou: string;
  footerReturnPolicy: string;
  zReportHeading: string;
  shiftSummary: string;
  openedAt: string;
  closedAt: string;
  openingCash: string;
  countedCash: string;
  expectedCash: string;
  difference: string;
  exactMatch: string;
  shortage: string;
  overage: string;
  salesSummary: string;
  returnsSummary: string;
  cashierSignature: string;
  managerSignature: string;
}

export const RECEIPT_TRANSLATIONS: Record<'en' | 'ur', ReceiptStrings> = {
  en: {
    pharmacyDefaultName: 'HEXAPHARM PHARMACY',
    pharmacyDefaultAddress: 'Commercial Area, Main Boulevard, Karachi',
    phone: 'Tel: +92 21 34567890',
    taxId: 'STRN / NTN: 1234567-8',
    invoiceHeading: 'CASH / CREDIT MEMO',
    invoiceNo: 'Invoice #',
    date: 'Date',
    time: 'Time',
    cashier: 'Cashier',
    counter: 'Counter',
    customer: 'Customer',
    doctor: 'Doctor',
    notes: 'Notes',
    item: 'Item',
    qty: 'Qty',
    price: 'Price',
    total: 'Total',
    batch: 'Batch',
    exp: 'Exp',
    subtotal: 'Subtotal',
    discount: 'Discount',
    tax: 'Tax',
    grandTotal: 'GRAND TOTAL',
    paid: 'Paid Amount',
    tendered: 'Tendered',
    change: 'Change Due',
    paymentMethod: 'Payment Method',
    paymentCash: 'Cash',
    paymentCard: 'Card',
    paymentWallet: 'Wallet',
    fiscalHeading: 'FBR FISCAL INVOICE (POS)',
    fiscalStatusOffline: '[ Offline Mode - Local Counter Finalized ]',
    fiscalQrNotice: 'QR Code Space Reserved for FBR Verification',
    footerThankYou: 'Thank you for your visit!',
    footerReturnPolicy:
      'Items can be returned within 3 days with original receipt in intact condition. Controlled / refrigerated drugs non-returnable.',
    zReportHeading: 'DAY-END CLOSING REPORT (Z-REPORT)',
    shiftSummary: 'Shift Summary',
    openedAt: 'Shift Opened',
    closedAt: 'Shift Closed',
    openingCash: 'Opening Cash',
    countedCash: 'Counted Cash (Physical)',
    expectedCash: 'Expected Cash (System)',
    difference: 'Cash Variance / Difference',
    exactMatch: 'EXACT (Balanced)',
    shortage: 'SHORTAGE',
    overage: 'OVERAGE',
    salesSummary: 'Gross Sales Summary',
    returnsSummary: 'Returns & Refunds Summary',
    cashierSignature: 'Cashier Signature: __________________',
    managerSignature: 'Manager Signature: __________________',
  },
  ur: {
    pharmacyDefaultName: 'ہیکسا فارم فارمیسی',
    pharmacyDefaultAddress: 'کمرشل ایریا، مین بلیوارڈ، کراچی',
    phone: 'فون: 34567890 21 92+',
    taxId: 'این ٹی این: 8-1234567',
    invoiceHeading: 'کیش / سیلز میمو',
    invoiceNo: 'انوائس نمبر',
    date: 'تاریخ',
    time: 'وقت',
    cashier: 'کیشیئر',
    counter: 'کاؤنٹر',
    customer: 'گاہک',
    doctor: 'ڈاکٹر',
    notes: 'نوٹس',
    item: 'آئٹم',
    qty: 'تعداد',
    price: 'قیمت',
    total: 'کل',
    batch: 'بیچ',
    exp: 'میعاد',
    subtotal: 'ذیلی کل',
    discount: 'رعایت',
    tax: 'ٹیکس',
    grandTotal: 'میزانِ کل',
    paid: 'ادا شدہ رقم',
    tendered: 'وصول شدہ',
    change: 'بقایا',
    paymentMethod: 'طریقہ ادائیگی',
    paymentCash: 'نقد (کیش)',
    paymentCard: 'کارڈ',
    paymentWallet: 'والیٹ',
    fiscalHeading: 'ایف بی آر انوائس',
    fiscalStatusOffline: '[ آف لائن موڈ - کاؤنٹر تصدیق شدہ ]',
    fiscalQrNotice: 'کیو آر کوڈ کی جگہ برائے ایف بی آر تصدیق',
    footerThankYou: 'آپ کی تشریف آوری کا شکریہ!',
    footerReturnPolicy: 'خریدی گئی ادویات اصل رسید کے ہمراہ ۳ دن کے اندر واپس ہو سکتی ہیں۔',
    zReportHeading: 'یومیہ اختتامی رپورٹ (Z-رپورٹ)',
    shiftSummary: 'شفٹ خلاصہ',
    openedAt: 'شفٹ آغاز',
    closedAt: 'شفٹ اختتام',
    openingCash: 'ابتدائی نقد',
    countedCash: 'گنتی شدہ نقد رقم',
    expectedCash: 'توقعی نقد رقم',
    difference: 'فرق (کمی / بیشی)',
    exactMatch: 'برابر (درست)',
    shortage: 'کمی',
    overage: 'بیشی',
    salesSummary: 'کل فروخت کا خلاصہ',
    returnsSummary: 'واپسی و ریفنڈ خلاصہ',
    cashierSignature: 'دستخط کیشیئر: __________________',
    managerSignature: 'دستخط منیجر: __________________',
  },
};

export function getReceiptStrings(locale: 'en' | 'ur' = 'en'): ReceiptStrings {
  return RECEIPT_TRANSLATIONS[locale] || RECEIPT_TRANSLATIONS.en;
}
