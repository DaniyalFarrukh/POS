import type { CreateProductInput } from '../schema/product';

export interface CsvColumnMapping {
  brandName: number;
  genericName: number;
  strength: number;
  form: number;
  manufacturer: number;
  barcode: number;
  mrp: number;
  isControlled?: number;
}

export interface CsvRowError {
  rowNumber: number;
  field?: string;
  barcode?: string;
  reason: string;
}

export interface CsvPreviewRow {
  rowNumber: number;
  raw: string[];
  parsed?: CreateProductInput;
  isValid: boolean;
  errors: string[];
}

export interface CsvValidationResult {
  headers: string[];
  previewRows: CsvPreviewRow[];
  validRows: CreateProductInput[];
  errors: CsvRowError[];
  totalRows: number;
  validCount: number;
  errorCount: number;
}

import { convertRupeesToPaisa } from '../money';
export { convertRupeesToPaisa };

/**
 * Auto-detects standard CSV header column indices.
 */
export function detectColumnMapping(headers: string[]): CsvColumnMapping {
  const normalize = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

  const findIndex = (patterns: string[]): number => {
    // 1. Exact match pass
    const exact = headers.findIndex((h) => {
      const norm = normalize(h);
      return patterns.some((p) => norm === p);
    });
    if (exact !== -1) return exact;

    // 2. Starts-with or ends-with pass
    const sub = headers.findIndex((h) => {
      const norm = normalize(h);
      return patterns.some((p) => norm.startsWith(p) || norm.endsWith(p));
    });
    if (sub !== -1) return sub;

    // 3. Fallback includes pass
    return headers.findIndex((h) => {
      const norm = normalize(h);
      return patterns.some((p) => norm.includes(p));
    });
  };

  return {
    brandName: findIndex(['brandname', 'productname', 'itemname', 'brand', 'name']),
    genericName: findIndex(['genericname', 'generic', 'formula', 'composition']),
    strength: findIndex(['strength', 'potency', 'dose', 'mg']),
    form: findIndex(['dosageform', 'form', 'type']),
    manufacturer: findIndex(['manufacturer', 'company', 'mfr', 'pharma']),
    barcode: findIndex(['barcode', 'eancode', 'ean', 'upc', 'code']),
    mrp: findIndex(['retailprice', 'mrp', 'price', 'retail', 'rate']),
    isControlled: findIndex(['iscontrolled', 'controlled', 'narcotic']),
  };
}

/**
 * Validates parsed CSV table data against product requirements and detects duplicate barcodes.
 */
export function validateCsvProducts(
  rows: string[][],
  mapping: CsvColumnMapping,
  defaultTaxCategoryId: string
): CsvValidationResult {
  if (rows.length === 0) {
    return {
      headers: [],
      previewRows: [],
      validRows: [],
      errors: [{ rowNumber: 0, reason: 'CSV file is empty.' }],
      totalRows: 0,
      validCount: 0,
      errorCount: 1,
    };
  }

  const headers = rows[0] || [];
  const dataRows = rows.slice(1);

  const validRows: CreateProductInput[] = [];
  const errors: CsvRowError[] = [];
  const previewRows: CsvPreviewRow[] = [];
  const seenBarcodes = new Set<string>();

  dataRows.forEach((row, idx) => {
    const rowNumber = idx + 2; // 1-indexed, accounting for header
    const rowErrors: string[] = [];

    const getField = (colIdx?: number): string => {
      if (colIdx === undefined || colIdx < 0 || colIdx >= row.length) return '';
      return (row[colIdx] ?? '').trim();
    };

    const brandName = getField(mapping.brandName);
    const genericName = getField(mapping.genericName);
    const strength = getField(mapping.strength);
    const form = getField(mapping.form);
    const manufacturer = getField(mapping.manufacturer);
    const barcodeRaw = getField(mapping.barcode);
    const mrpRaw = getField(mapping.mrp);
    const controlledRaw = getField(mapping.isControlled).toLowerCase();

    if (!brandName) rowErrors.push('Missing brand name');
    if (!genericName) rowErrors.push('Missing generic name');
    if (!strength) rowErrors.push('Missing strength');
    if (!form) rowErrors.push('Missing dosage form');
    if (!manufacturer) rowErrors.push('Missing manufacturer');
    if (!mrpRaw) rowErrors.push('Missing MRP price');

    let mrpPaisa = 0;
    if (mrpRaw) {
      try {
        mrpPaisa = convertRupeesToPaisa(mrpRaw);
      } catch (err: unknown) {
        rowErrors.push(err instanceof Error ? err.message : 'Invalid MRP format');
      }
    }

    const barcode = barcodeRaw.length > 0 ? barcodeRaw : null;
    if (barcode) {
      if (seenBarcodes.has(barcode)) {
        rowErrors.push(`Duplicate barcode '${barcode}' in file`);
      } else {
        seenBarcodes.add(barcode);
      }
    }

    const isControlled = ['true', 'yes', '1', 'controlled', 'y'].includes(controlledRaw);

    let parsedItem: CreateProductInput | undefined;
    if (rowErrors.length === 0) {
      parsedItem = {
        brandName,
        genericName,
        strength,
        form,
        manufacturer,
        barcode,
        taxCategoryId: defaultTaxCategoryId,
        mrpPaisa,
        isControlled,
        isActive: true,
      };
      validRows.push(parsedItem);
    } else {
      rowErrors.forEach((err) => {
        errors.push({
          rowNumber,
          barcode: barcode ?? undefined,
          reason: err,
        });
      });
    }

    // Only build preview for the first 20 rows
    if (previewRows.length < 20) {
      previewRows.push({
        rowNumber,
        raw: row,
        parsed: parsedItem,
        isValid: rowErrors.length === 0,
        errors: rowErrors,
      });
    }
  });

  return {
    headers,
    previewRows,
    validRows,
    errors,
    totalRows: dataRows.length,
    validCount: validRows.length,
    errorCount: errors.length,
  };
}
