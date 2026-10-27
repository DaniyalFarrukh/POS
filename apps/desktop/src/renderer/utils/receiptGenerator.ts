import { formatPKR } from '@pos/shared';
import { getReceiptStrings, type ReceiptStrings } from './receiptTranslations';

export interface ReceiptLineItem {
  id: string;
  brandName?: string;
  genericName?: string;
  batchNo?: string | null;
  expiryDate?: string | null;
  quantity: number;
  unitPricePaisa: number;
  discountPaisa?: number;
  taxPaisa?: number;
  lineTotalPaisa: number;
}

export interface ReceiptPaymentItem {
  method: 'cash' | 'card' | 'wallet' | 'bank' | 'other';
  amountPaisa: number;
  tenderedPaisa?: number | null;
  changePaisa?: number | null;
}

export interface ReceiptInvoiceData {
  id: string;
  invoiceNumber: string;
  createdAt: string; // ISO UTC
  subtotalPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
  notes?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  doctorName?: string | null;
  cashierName?: string;
  counterName?: string;
  branchName?: string;
  branchAddress?: string;
  fiscalStatus?: string;
  fiscalInvoiceNumber?: string | null;
  qrPayload?: string | null;
  lines: ReceiptLineItem[];
  payments: ReceiptPaymentItem[];
}

export interface ReceiptGeneratorOptions {
  showBatchExpiry?: boolean;
  locale?: 'en' | 'ur';
  paperWidth?: '80mm' | '58mm';
  pharmacyName?: string;
  pharmacyAddress?: string;
  phone?: string;
  taxId?: string;
  customHeader?: string;
  customFooter?: string;
}

/**
 * Generates an 80mm or 58mm thermal receipt HTML document string.
 * Optimized for Windows thermal POS printer paper rolls.
 */
export function generateThermalReceiptHtml(
  invoice: ReceiptInvoiceData,
  options: ReceiptGeneratorOptions = {}
): string {
  const showBatchExpiry = options.showBatchExpiry ?? true;
  const locale = options.locale ?? 'en';
  const paperWidth = options.paperWidth ?? '80mm';
  const is58mm = paperWidth === '58mm';
  const bodyWidth = is58mm ? '48mm' : '72mm';
  const pageSize = is58mm ? '58mm auto' : '80mm auto';
  const baseFontSize = is58mm ? '9.5px' : '11px';
  const fontFamily =
    locale === 'ur'
      ? "'Noto Nastaliq Urdu', 'Segoe UI', Tahoma, 'Courier New', monospace"
      : "'Courier New', Courier, monospace, system-ui";
  const t: ReceiptStrings = getReceiptStrings(locale);

  const pharmacyName = options.pharmacyName || invoice.branchName || t.pharmacyDefaultName;
  const pharmacyAddress = options.pharmacyAddress || invoice.branchAddress || t.pharmacyDefaultAddress;
  const phone = options.phone || t.phone;
  const taxId = options.taxId || t.taxId;

  // Format date and time in Asia/Karachi (Rule 8)
  const dateObj = new Date(invoice.createdAt);
  const formattedDate = dateObj.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Karachi',
  });
  const formattedTime = dateObj.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Karachi',
  });

  // Calculate cash tendered and change if available
  const cashPayment = invoice.payments.find((p) => p.method === 'cash');
  const tenderedPaisa = cashPayment?.tenderedPaisa;
  const changePaisa = cashPayment?.changePaisa;

  // Render line items HTML
  const linesHtml = invoice.lines
    .map((line) => {
      const name = line.brandName || line.genericName || 'Medicine Item';
      const batchInfo =
        showBatchExpiry && (line.batchNo || line.expiryDate)
          ? `<div class="sub-item">${t.batch}: ${line.batchNo || 'N/A'} | ${t.exp}: ${line.expiryDate || 'N/A'}</div>`
          : '';

      return `
        <tr>
          <td colspan="4" class="item-name">${escapeHtml(name)}</td>
        </tr>
        <tr>
          <td class="col-qty">${line.quantity}</td>
          <td class="col-price">${formatPKR(line.unitPricePaisa)}</td>
          <td class="col-disc">${line.discountPaisa ? '-' + formatPKR(line.discountPaisa) : ''}</td>
          <td class="col-total">${formatPKR(line.lineTotalPaisa)}</td>
        </tr>
        ${batchInfo ? `<tr><td colspan="4">${batchInfo}</td></tr>` : ''}
      `;
    })
    .join('');

  // Render payments breakdown
  const paymentsHtml = invoice.payments
    .map((p) => {
      let methodLabel = t.paymentCash;
      if (p.method === 'card') methodLabel = t.paymentCard;
      if (p.method === 'wallet') methodLabel = t.paymentWallet;

      return `
        <div class="row">
          <span>${methodLabel}:</span>
          <span>${formatPKR(p.amountPaisa)}</span>
        </div>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${locale === 'ur' ? 'rtl' : 'ltr'}">
<head>
  <meta charset="utf-8">
  <title>Receipt #${invoice.invoiceNumber}</title>
  <style>
    @page {
      size: ${pageSize};
      margin: 0;
    }
    @media print {
      body {
        margin: 0;
        padding: 2mm 3mm;
      }
      .no-print {
        display: none !important;
      }
    }
    * {
      box-sizing: border-box;
    }
    body {
      width: ${bodyWidth};
      margin: 0 auto;
      padding: 3mm 2mm;
      font-family: ${fontFamily};
      font-size: ${baseFontSize};
      line-height: 1.35;
      color: #000000;
      background-color: #ffffff;
      -webkit-print-color-adjust: exact;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: bold; }
    .divider {
      border-top: 1px dashed #000000;
      margin: 6px 0;
    }
    .double-divider {
      border-top: 2px solid #000000;
      margin: 6px 0;
    }
    .header {
      text-align: center;
      margin-bottom: 6px;
    }
    .pharmacy-title {
      font-size: 15px;
      font-weight: bold;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .pharmacy-sub {
      font-size: 10px;
      margin-bottom: 2px;
    }
    .meta-table {
      width: 100%;
      font-size: 11px;
      margin-bottom: 4px;
    }
    .meta-table td {
      padding: 1px 0;
      vertical-align: top;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .items-table th {
      border-top: 1px dashed #000;
      border-bottom: 1px dashed #000;
      padding: 3px 0;
      text-align: left;
    }
    .items-table th.col-qty, .items-table td.col-qty { width: 14%; text-align: center; }
    .items-table th.col-price, .items-table td.col-price { width: 28%; text-align: right; }
    .items-table th.col-disc, .items-table td.col-disc { width: 24%; text-align: right; font-size: 10px; }
    .items-table th.col-total, .items-table td.col-total { width: 34%; text-align: right; }
    .item-name {
      font-weight: bold;
      padding-top: 4px;
      word-break: break-word;
    }
    .sub-item {
      font-size: 9.5px;
      color: #333333;
      padding-bottom: 4px;
    }
    .totals-area {
      margin-top: 4px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      padding: 1px 0;
      font-size: 11px;
    }
    .grand-total {
      font-size: 14px;
      font-weight: bold;
      padding: 4px 0;
    }
    .fiscal-box {
      border: 1px dashed #000000;
      padding: 6px 4px;
      margin: 8px 0;
      text-align: center;
      font-size: 9.5px;
    }
    .fiscal-box .qr-placeholder {
      width: 64px;
      height: 64px;
      border: 1px solid #444444;
      margin: 4px auto;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      text-align: center;
      color: #555555;
    }
    .footer {
      text-align: center;
      font-size: 9.5px;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <!-- Pharmacy Header -->
  <div class="header">
    <div class="pharmacy-title">${escapeHtml(pharmacyName)}</div>
    <div class="pharmacy-sub">${escapeHtml(pharmacyAddress)}</div>
    <div class="pharmacy-sub">${escapeHtml(phone)}</div>
    <div class="pharmacy-sub">${escapeHtml(taxId)}</div>
    ${options.customHeader ? `<div class="pharmacy-sub bold" style="margin-top: 2px;">${escapeHtml(options.customHeader)}</div>` : ''}
    <div class="bold" style="font-size: 12px; margin-top: 4px;">${t.invoiceHeading}</div>
  </div>

  <div class="divider"></div>

  <!-- Metadata Table -->
  <table class="meta-table">
    <tr>
      <td class="bold">${t.invoiceNo}:</td>
      <td class="text-right bold">${escapeHtml(invoice.invoiceNumber)}</td>
    </tr>
    <tr>
      <td>${t.date}:</td>
      <td class="text-right">${formattedDate} ${formattedTime}</td>
    </tr>
    <tr>
      <td>${t.cashier}:</td>
      <td class="text-right">${escapeHtml(invoice.cashierName || 'Cashier')}</td>
    </tr>
    <tr>
      <td>${t.counter}:</td>
      <td class="text-right">${escapeHtml(invoice.counterName || 'Counter')}</td>
    </tr>
    ${
      invoice.customerName
        ? `<tr><td>${t.customer}:</td><td class="text-right bold">${escapeHtml(invoice.customerName)}</td></tr>`
        : ''
    }
    ${
      invoice.doctorName
        ? `<tr><td>${t.doctor}:</td><td class="text-right">${escapeHtml(invoice.doctorName)}</td></tr>`
        : ''
    }
    ${
      invoice.notes
        ? `<tr><td>${t.notes}:</td><td class="text-right">${escapeHtml(invoice.notes)}</td></tr>`
        : ''
    }
  </table>

  <!-- Items Table -->
  <table class="items-table">
    <thead>
      <tr>
        <th class="col-qty">${t.qty}</th>
        <th class="col-price">${t.price}</th>
        <th class="col-disc">${t.discount}</th>
        <th class="col-total">${t.total}</th>
      </tr>
    </thead>
    <tbody>
      ${linesHtml}
    </tbody>
  </table>

  <div class="divider"></div>

  <!-- Financial Totals -->
  <div class="totals-area">
    <div class="row">
      <span>${t.subtotal}:</span>
      <span>${formatPKR(invoice.subtotalPaisa)}</span>
    </div>
    ${
      invoice.discountPaisa > 0
        ? `<div class="row"><span>${t.discount}:</span><span>-${formatPKR(invoice.discountPaisa)}</span></div>`
        : ''
    }
    <div class="row">
      <span>${t.tax}:</span>
      <span>${formatPKR(invoice.taxPaisa)}</span>
    </div>
    <div class="double-divider"></div>
    <div class="row grand-total">
      <span>${t.grandTotal}:</span>
      <span>${formatPKR(invoice.totalPaisa)}</span>
    </div>
    <div class="double-divider"></div>
  </div>

  <!-- Payment Details -->
  <div style="margin-top: 4px;">
    ${paymentsHtml}
    ${
      tenderedPaisa !== undefined && tenderedPaisa !== null && tenderedPaisa > 0
        ? `<div class="row"><span>${t.tendered}:</span><span>${formatPKR(tenderedPaisa)}</span></div>`
        : ''
    }
    ${
      changePaisa !== undefined && changePaisa !== null && changePaisa >= 0
        ? `<div class="row bold"><span>${t.change}:</span><span>${formatPKR(changePaisa)}</span></div>`
        : ''
    }
  </div>

  <!-- Fiscal / FBR Reserved Area -->
  <div class="fiscal-box">
    <div class="bold">${t.fiscalHeading}</div>
    <div style="font-size: 8.5px; color: #444; margin: 2px 0;">${t.fiscalStatusOffline}</div>
    <div class="qr-placeholder">${invoice.qrPayload ? 'QR CODE' : t.fiscalQrNotice}</div>
    <div>${t.invoiceNo}: ${invoice.fiscalInvoiceNumber || invoice.invoiceNumber}</div>
    <div style="margin-top: 5px; padding-top: 4px; border-top: 1px dashed #888; font-size: 8.5px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase;">
      ${t.poweredBy}
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div class="bold">${t.footerThankYou}</div>
    <div style="margin-top: 4px; font-size: 8.5px; color: #333;">${escapeHtml(options.customFooter || t.footerReturnPolicy)}</div>
    <div style="margin-top: 6px; font-size: 8px; font-weight: bold; letter-spacing: 0.5px; color: #555; text-transform: uppercase;">
      ${t.poweredBy}
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface ZReportShiftData {
  id: string;
  counterName?: string;
  cashierName?: string;
  openedAt: string;
  closedAt?: string | null;
  openingCashPaisa: number;
  countedCashPaisa?: number | null;
  expectedCashPaisa: number;
  differencePaisa?: number | null;
  salesCashPaisa: number;
  salesCardPaisa: number;
  salesWalletPaisa: number;
  salesTotalPaisa: number;
  salesCount: number;
  returnsCashPaisa: number;
  returnsCount: number;
  notes?: string | null;
}

/**
 * Generates an 80mm thermal day-end Z-Report HTML document string.
 */
export function generateZReportHtml(
  shift: ZReportShiftData,
  options: ReceiptGeneratorOptions = {}
): string {
  const locale = options.locale ?? 'en';
  const t = getReceiptStrings(locale);

  const pharmacyName = options.pharmacyName || t.pharmacyDefaultName;
  const pharmacyAddress = options.pharmacyAddress || t.pharmacyDefaultAddress;
  const phone = options.phone || t.phone;
  const taxId = options.taxId || t.taxId;

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return `${d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Karachi',
    })} ${d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'Asia/Karachi',
    })}`;
  };

  const openedAtStr = formatDate(shift.openedAt);
  const closedAtStr = shift.closedAt ? formatDate(shift.closedAt) : '[ ACTIVE / OPEN ]';

  let diffLabel = t.exactMatch;
  let diffClass = '';
  if (shift.differencePaisa !== null && shift.differencePaisa !== undefined) {
    if (shift.differencePaisa < 0) {
      diffLabel = t.shortage;
      diffClass = 'color: #b91c1c; font-weight: bold;';
    } else if (shift.differencePaisa > 0) {
      diffLabel = t.overage;
      diffClass = 'color: #15803d; font-weight: bold;';
    }
  }

  const paperWidth = options.paperWidth ?? '80mm';
  const is58mm = paperWidth === '58mm';
  const bodyWidth = is58mm ? '48mm' : '72mm';
  const pageSize = is58mm ? '58mm auto' : '80mm auto';
  const baseFontSize = is58mm ? '8.5px' : '10px';
  const fontFamily =
    locale === 'ur'
      ? "'Noto Nastaliq Urdu', 'Segoe UI', Tahoma, 'Courier New', monospace"
      : "'Courier New', Courier, monospace, system-ui";

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${locale === 'ur' ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8">
  <title>Z-Report - Shift ${shift.id.slice(0, 8)}</title>
  <style>
    @page {
      size: ${pageSize};
      margin: 0;
    }
    @media print {
      body {
        width: ${bodyWidth};
        margin: 0 auto;
        padding: 4mm 2mm;
      }
    }
    body {
      width: ${bodyWidth};
      margin: 0 auto;
      padding: 6mm 3mm;
      font-family: ${fontFamily};
      font-size: ${baseFontSize};
      line-height: 1.25;
      color: #000;
      background: #fff;
    }
    .text-center { text-align: center; }
    .bold { font-weight: bold; }
    .row { display: flex; justify-content: space-between; margin-bottom: 2px; }
    .divider { border-bottom: 1px dashed #000; margin: 5px 0; }
    .double-divider { border-bottom: 2px solid #000; margin: 6px 0; }
    .section-title { font-weight: bold; text-align: center; margin: 4px 0 2px 0; text-transform: uppercase; }
    .signature-area { margin-top: 15px; font-size: 9px; }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="text-center">
    <div class="bold" style="font-size: 12px;">${escapeHtml(pharmacyName)}</div>
    <div>${escapeHtml(pharmacyAddress)}</div>
    <div>${escapeHtml(phone)} | ${escapeHtml(taxId)}</div>
    ${options.customHeader ? `<div class="bold">${escapeHtml(options.customHeader)}</div>` : ''}
    <div class="double-divider"></div>
    <div class="bold" style="font-size: 11px;">*** ${t.zReportHeading} ***</div>
    <div class="divider"></div>
  </div>

  <!-- Shift Metadata -->
  <div>
    <div class="row"><span>Shift ID:</span><span class="bold">${shift.id.slice(0, 13)}</span></div>
    <div class="row"><span>${t.counter}:</span><span>${escapeHtml(shift.counterName || 'Counter 1')}</span></div>
    <div class="row"><span>${t.cashier}:</span><span>${escapeHtml(shift.cashierName || 'Staff Cashier')}</span></div>
    <div class="row"><span>${t.openedAt}:</span><span>${openedAtStr}</span></div>
    <div class="row"><span>${t.closedAt}:</span><span>${closedAtStr}</span></div>
    ${shift.notes ? `<div class="row"><span>${t.notes}:</span><span>${escapeHtml(shift.notes)}</span></div>` : ''}
  </div>

  <div class="double-divider"></div>

  <!-- Gross Sales Summary -->
  <div class="section-title">${t.salesSummary}</div>
  <div class="divider"></div>
  <div class="row"><span>${t.paymentCash}:</span><span>${formatPKR(shift.salesCashPaisa)}</span></div>
  <div class="row"><span>${t.paymentCard}:</span><span>${formatPKR(shift.salesCardPaisa)}</span></div>
  <div class="row"><span>${t.paymentWallet}:</span><span>${formatPKR(shift.salesWalletPaisa)}</span></div>
  <div class="divider"></div>
  <div class="row bold">
    <span>Total Gross Sales (${shift.salesCount} txns):</span>
    <span>${formatPKR(shift.salesTotalPaisa)}</span>
  </div>

  <div class="double-divider"></div>

  <!-- Returns Summary -->
  <div class="section-title">${t.returnsSummary}</div>
  <div class="divider"></div>
  <div class="row"><span>Cash Refunds (${shift.returnsCount} returns):</span><span>${formatPKR(shift.returnsCashPaisa)}</span></div>

  <div class="double-divider"></div>

  <!-- Cash Reconciliation -->
  <div class="section-title">Cash Drawer Reconciliation</div>
  <div class="divider"></div>
  <div class="row"><span>(+) ${t.openingCash}:</span><span>${formatPKR(shift.openingCashPaisa)}</span></div>
  <div class="row"><span>(+) Cash Sales:</span><span>${formatPKR(shift.salesCashPaisa)}</span></div>
  <div class="row"><span>(-) Cash Refunds:</span><span>${formatPKR(shift.returnsCashPaisa)}</span></div>
  <div class="divider"></div>
  <div class="row bold"><span>(=) ${t.expectedCash}:</span><span>${formatPKR(shift.expectedCashPaisa)}</span></div>
  ${
    shift.countedCashPaisa !== null && shift.countedCashPaisa !== undefined
      ? `
  <div class="row bold"><span>${t.countedCash}:</span><span>${formatPKR(shift.countedCashPaisa)}</span></div>
  <div class="divider"></div>
  <div class="row" style="${diffClass}">
    <span>${t.difference}:</span>
    <span>${shift.differencePaisa ? (shift.differencePaisa > 0 ? '+' : '') + formatPKR(shift.differencePaisa) : 'Rs. 0'} (${diffLabel})</span>
  </div>`
      : `<div class="row"><span>${t.countedCash}:</span><span>[ Shift Open / Not Counted ]</span></div>`
  }

  <div class="double-divider"></div>

  <!-- Signatures -->
  <div class="signature-area">
    <div style="margin-bottom: 12px;">${t.cashierSignature}</div>
    <div>${t.managerSignature}</div>
  </div>

  <div class="text-center" style="margin-top: 15px; font-size: 8px; color: #666;">
    * System Generated Audit Document *
    <div style="margin-top: 4px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase;">${t.poweredBy}</div>
  </div>
</body>
</html>`;
}

