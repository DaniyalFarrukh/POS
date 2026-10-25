import { describe, it, expect } from 'vitest';
import { parseCsv } from './parser';
import {
  validateCsvProducts,
  convertRupeesToPaisa,
  detectColumnMapping,
} from './validator';
import { generateUuidV7 } from '../uuid';

describe('RFC 4180 CSV Parser', () => {
  it('parses standard unquoted CSV text', () => {
    const csv = 'brand,generic,strength\nPanadol,Paracetamol,500mg\nBrufen,Ibuprofen,400mg';
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      ['brand', 'generic', 'strength'],
      ['Panadol', 'Paracetamol', '500mg'],
      ['Brufen', 'Ibuprofen', '400mg'],
    ]);
  });

  it('correctly handles quoted fields with commas (quoted commas requirement)', () => {
    const csv =
      'brand,generic,strength,form\n' +
      '"Augmentin","Amoxicillin, Clavulanic Acid","625mg","tablet"\n' +
      '"Co-Amoxiclav","Amoxicillin, Sulbactam, Clavulanate","1000mg","injection"';

    const rows = parseCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual([
      'Augmentin',
      'Amoxicillin, Clavulanic Acid',
      '625mg',
      'tablet',
    ]);
    expect(rows[2]?.[1]).toBe('Amoxicillin, Sulbactam, Clavulanate');
  });

  it('correctly handles escaped double-quotes ("" -> ")', () => {
    const csv = 'brand,form\n"Brufen","tablet ""Film-coated"""\n"Disprin","effervescent ""fast"""';
    const rows = parseCsv(csv);
    expect(rows[1]).toEqual(['Brufen', 'tablet "Film-coated"']);
    expect(rows[2]).toEqual(['Disprin', 'effervescent "fast"']);
  });

  it('handles CRLF and trailing empty lines', () => {
    const csv = 'col1,col2\r\nval1,val2\r\nval3,val4\r\n\r\n';
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      ['col1', 'col2'],
      ['val1', 'val2'],
      ['val3', 'val4'],
    ]);
  });

  it('throws an error for malformed CSV with unclosed quotes', () => {
    const csv = 'brand,generic\n"Unclosed quote,Paracetamol';
    expect(() => parseCsv(csv)).toThrow(/Unclosed quote/);
  });
});

describe('CSV Product Validator', () => {
  const dummyTaxId = generateUuidV7();

  it('detects standard header column mapping', () => {
    const headers = ['Product Name', 'Formula', 'Dose', 'Type', 'Company', 'EAN Code', 'Retail Price'];
    const mapping = detectColumnMapping(headers);

    expect(mapping.brandName).toBe(0);
    expect(mapping.genericName).toBe(1);
    expect(mapping.strength).toBe(2);
    expect(mapping.form).toBe(3);
    expect(mapping.manufacturer).toBe(4);
    expect(mapping.barcode).toBe(5);
    expect(mapping.mrp).toBe(6);
  });

  it('accurately converts Rupees to integer paisa (Rule 1)', () => {
    expect(convertRupeesToPaisa('35.50')).toBe(3550);
    expect(convertRupeesToPaisa('100')).toBe(10000);
    expect(convertRupeesToPaisa('Rs. 450.25')).toBe(45025);
    expect(convertRupeesToPaisa(' 12.00 ')).toBe(1200);
    expect(() => convertRupeesToPaisa('invalid-price')).toThrow(/Invalid monetary amount/);
  });

  it('validates good rows and produces first 20 preview entries', () => {
    const csvData = [
      ['brand', 'generic', 'strength', 'form', 'manufacturer', 'barcode', 'mrp'],
      ['Panadol', 'Paracetamol', '500mg', 'tablet', 'GSK', '89640001', '35.00'],
      ['Brufen', 'Ibuprofen', '400mg', 'tablet', 'Abbott', '89640002', '55.50'],
    ];

    const mapping = detectColumnMapping(csvData[0]!);
    const res = validateCsvProducts(csvData, mapping, dummyTaxId);

    expect(res.validCount).toBe(2);
    expect(res.errorCount).toBe(0);
    expect(res.validRows).toHaveLength(2);
    expect(res.validRows[0]?.mrpPaisa).toBe(3500); // Rs 35.00 = 3500 paisa
    expect(res.validRows[1]?.mrpPaisa).toBe(5550); // Rs 55.50 = 5550 paisa
    expect(res.previewRows).toHaveLength(2);
    expect(res.previewRows[0]?.isValid).toBe(true);
  });

  it('flags bad rows with empty required fields', () => {
    const csvData = [
      ['brand', 'generic', 'strength', 'form', 'manufacturer', 'barcode', 'mrp'],
      ['', 'Paracetamol', '500mg', 'tablet', 'GSK', '89640001', '35.00'], // Missing brand
      ['Brufen', '', '400mg', 'tablet', 'Abbott', '89640002', '55.50'], // Missing generic
      ['Augmentin', 'Amoxicillin', '625mg', 'tablet', 'GSK', '89640003', ''], // Missing price
    ];

    const mapping = detectColumnMapping(csvData[0]!);
    const res = validateCsvProducts(csvData, mapping, dummyTaxId);

    expect(res.validCount).toBe(0);
    expect(res.errorCount).toBe(3);
    expect(res.errors[0]?.reason).toContain('Missing brand name');
    expect(res.errors[1]?.reason).toContain('Missing generic name');
    expect(res.errors[2]?.reason).toContain('Missing MRP price');
  });

  it('flags in-file duplicate barcodes', () => {
    const csvData = [
      ['brand', 'generic', 'strength', 'form', 'manufacturer', 'barcode', 'mrp'],
      ['Panadol', 'Paracetamol', '500mg', 'tablet', 'GSK', '896400099', '35.00'],
      ['Disprin', 'Aspirin', '300mg', 'tablet', 'Reckitt', '896400099', '20.00'], // Duplicate barcode!
    ];

    const mapping = detectColumnMapping(csvData[0]!);
    const res = validateCsvProducts(csvData, mapping, dummyTaxId);

    expect(res.validCount).toBe(1); // First is valid
    expect(res.errorCount).toBe(1); // Second is flagged
    expect(res.errors[0]?.reason).toContain("Duplicate barcode '896400099' in file");
  });
});
