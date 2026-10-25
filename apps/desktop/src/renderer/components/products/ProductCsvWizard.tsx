import React, { useState } from 'react';
import {
  parseCsv,
  validateCsvProducts,
  detectColumnMapping,
  type CsvColumnMapping,
  type CsvValidationResult,
  type TaxCategory,
} from '@pos/shared';
import type { CsvImportSummary } from '../../../preload/index.d';

interface ProductCsvWizardProps {
  taxCategories: TaxCategory[];
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

type WizardStep = 'upload' | 'mapping' | 'preview' | 'summary';

export const ProductCsvWizard: React.FC<ProductCsvWizardProps> = ({
  taxCategories,
  isOpen,
  onClose,
  onImportComplete,
}) => {
  const [step, setStep] = useState<WizardStep>('upload');
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [mapping, setMapping] = useState<CsvColumnMapping>({
    brandName: 0,
    genericName: 1,
    strength: 2,
    form: 3,
    manufacturer: 4,
    barcode: 5,
    mrp: 6,
    isControlled: 7,
  });
  const [selectedTaxId, setSelectedTaxId] = useState<string>(taxCategories[0]?.id ?? '');
  const [validationResult, setValidationResult] = useState<CsvValidationResult | null>(null);
  const [importSummary, setImportSummary] = useState<CsvImportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParseError(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const parsed = parseCsv(text);
        if (parsed.length < 2) {
          setParseError('The selected CSV file must contain a header row and at least one data row.');
          return;
        }
        setRawRows(parsed);
        const detected = detectColumnMapping(parsed[0] ?? []);
        setMapping(detected);
        setStep('mapping');
      } catch (err: unknown) {
        setParseError(err instanceof Error ? err.message : 'Failed to parse CSV file.');
      }
    };
    reader.readAsText(file);
  };

  const handleProceedToPreview = () => {
    const taxId = selectedTaxId || (taxCategories[0]?.id ?? '');
    const res = validateCsvProducts(rawRows, mapping, taxId);
    setValidationResult(res);
    setStep('preview');
  };

  const handleExecuteImport = async () => {
    if (!validationResult || validationResult.validRows.length === 0) return;

    setLoading(true);
    try {
      const summary = await window.api.products.importProductsCsv(validationResult.validRows);
      // Combine parser validation errors with database duplicate barcode errors
      const combinedErrors = [
        ...validationResult.errors.map((e) => ({
          rowNumber: e.rowNumber,
          barcode: e.barcode,
          reason: e.reason,
        })),
        ...summary.errors,
      ];

      setImportSummary({
        importedCount: summary.importedCount,
        skippedCount: summary.skippedCount + validationResult.errors.length,
        errors: combinedErrors,
      });
      setStep('summary');
      onImportComplete();
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const headers = rawRows[0] || [];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '920px',
          maxHeight: '90vh',
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Wizard Header */}
        <div
          style={{
            padding: '20px 28px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#ffffff',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
              CSV Product Import Wizard
            </h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: step === 'upload' ? '#2563eb' : '#64748b' }}>
                1. Choose File
              </span>
              <span style={{ color: '#cbd5e1' }}>→</span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: step === 'mapping' ? '#2563eb' : '#64748b' }}>
                2. Map Columns
              </span>
              <span style={{ color: '#cbd5e1' }}>→</span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: step === 'preview' ? '#2563eb' : '#64748b' }}>
                3. Preview & Validate
              </span>
              <span style={{ color: '#cbd5e1' }}>→</span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: step === 'summary' ? '#166534' : '#64748b' }}>
                4. Import Summary
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '22px',
              color: '#94a3b8',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '28px', overflowY: 'auto', flex: 1 }}>
          {parseError && (
            <div
              style={{
                padding: '12px 16px',
                backgroundColor: '#fef2f2',
                color: '#b91c1c',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                fontSize: '13px',
                marginBottom: '16px',
              }}
            >
              {parseError}
            </div>
          )}

          {/* STEP 1: UPLOAD */}
          {step === 'upload' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: '#1e293b' }}>
                Select Pharmacy Product CSV
              </h3>
              <p style={{ margin: '0 0 24px 0', fontSize: '13px', color: '#64748b', maxWidth: '440px', lineHeight: 1.5 }}>
                Supports standard CSV files with quoted commas (e.g. formula compositions), escaped quotes, and barcoded medicines.
              </p>

              <label
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  display: 'inline-block',
                }}
              >
                Choose CSV File
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          )}

          {/* STEP 2: COLUMN MAPPING */}
          {step === 'mapping' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#1e293b' }}>
                    Match CSV Columns to Product Fields
                  </h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                    File: <strong>{fileName}</strong> ({rawRows.length - 1} records detected)
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                    Default Tax Category:
                  </label>
                  <select
                    value={selectedTaxId}
                    onChange={(e) => setSelectedTaxId(e.target.value)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '12px',
                      backgroundColor: '#ffffff',
                    }}
                  >
                    {taxCategories.map((tc) => (
                      <option key={tc.id} value={tc.id}>
                        {tc.name} ({tc.rateBp / 100}%)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', backgroundColor: '#f8fafc', padding: '18px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                {[
                  { key: 'brandName', label: 'Brand Name *' },
                  { key: 'genericName', label: 'Generic Name / Formula *' },
                  { key: 'strength', label: 'Strength *' },
                  { key: 'form', label: 'Dosage Form *' },
                  { key: 'manufacturer', label: 'Manufacturer / Pharma *' },
                  { key: 'barcode', label: 'Barcode (Unique)' },
                  { key: 'mrp', label: 'MRP Price (Rupees) *' },
                  { key: 'isControlled', label: 'Controlled Flag (Optional)' },
                ].map((field) => (
                  <div key={field.key}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                      {field.label}
                    </label>
                    <select
                      value={mapping[field.key as keyof CsvColumnMapping] ?? -1}
                      onChange={(e) =>
                        setMapping({
                          ...mapping,
                          [field.key]: parseInt(e.target.value, 10),
                        })
                      }
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '13px',
                        backgroundColor: '#ffffff',
                        boxSizing: 'border-box',
                      }}
                    >
                      <option value={-1}>-- Not in file / Ignore --</option>
                      {headers.map((h, idx) => (
                        <option key={idx} value={idx}>
                          Column {idx + 1}: &quot;{h}&quot;
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                <button
                  type="button"
                  onClick={() => setStep('upload')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleProceedToPreview}
                  style={{
                    padding: '8px 20px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Validate & Preview First 20 Rows
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & VALIDATION */}
          {step === 'preview' && validationResult && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#1e293b' }}>
                    Previewing First 20 Rows
                  </h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                    Validation status: {validationResult.validCount} valid, {validationResult.errors.length} errors across file
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <span style={{ padding: '4px 10px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}>
                    {validationResult.validCount} Valid
                  </span>
                  {validationResult.errors.length > 0 && (
                    <span style={{ padding: '4px 10px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }}>
                      {validationResult.errors.length} Errors Flagged
                    </span>
                  )}
                </div>
              </div>

              {/* Table Preview */}
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #cbd5e1' }}>
                      <th style={{ padding: '8px 10px', width: '50px' }}>Row</th>
                      <th style={{ padding: '8px 10px' }}>Brand</th>
                      <th style={{ padding: '8px 10px' }}>Generic</th>
                      <th style={{ padding: '8px 10px' }}>Strength</th>
                      <th style={{ padding: '8px 10px' }}>Form</th>
                      <th style={{ padding: '8px 10px' }}>Barcode</th>
                      <th style={{ padding: '8px 10px' }}>Paisa (Rule 1)</th>
                      <th style={{ padding: '8px 10px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validationResult.previewRows.map((row) => {
                      const isRowValid = row.isValid;
                      return (
                        <tr
                          key={row.rowNumber}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            backgroundColor: isRowValid ? '#f0fdf4' : '#fef2f2',
                          }}
                        >
                          <td style={{ padding: '8px 10px', fontWeight: 600, color: '#64748b' }}>
                            #{row.rowNumber}
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                            {row.parsed?.brandName ?? row.raw[mapping.brandName] ?? '-'}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            {row.parsed?.genericName ?? row.raw[mapping.genericName] ?? '-'}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            {row.parsed?.strength ?? row.raw[mapping.strength] ?? '-'}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            {row.parsed?.form ?? row.raw[mapping.form] ?? '-'}
                          </td>
                          <td style={{ padding: '8px 10px', fontFamily: 'Consolas, monospace' }}>
                            {row.parsed?.barcode ?? row.raw[mapping.barcode] ?? '-'}
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 600, color: '#2563eb' }}>
                            {row.parsed?.mrpPaisa ? `${row.parsed.mrpPaisa} paisa` : '-'}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            {isRowValid ? (
                              <span style={{ color: '#166534', fontWeight: 700 }}>✓ Valid</span>
                            ) : (
                              <span style={{ color: '#dc2626', fontWeight: 600 }} title={row.errors.join(', ')}>
                                ✕ {row.errors[0]}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={() => setStep('mapping')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Adjust Mapping
                </button>
                <button
                  type="button"
                  disabled={loading || validationResult.validCount === 0}
                  onClick={handleExecuteImport}
                  style={{
                    padding: '8px 24px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: validationResult.validCount > 0 ? '#166534' : '#94a3b8',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: validationResult.validCount > 0 && !loading ? 'pointer' : 'not-allowed',
                  }}
                >
                  {loading ? 'Importing in 1 Transaction...' : `Import ${validationResult.validCount} Valid Products`}
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: SUMMARY BREAKDOWN */}
          {step === 'summary' && importSummary && (
            <div>
              <div
                style={{
                  padding: '24px',
                  backgroundColor: '#f0fdf4',
                  borderRadius: '10px',
                  border: '1px solid #bbf7d0',
                  marginBottom: '20px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '36px', marginBottom: '8px' }}>🎉</div>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '20px', color: '#166534', fontWeight: 700 }}>
                  CSV Import Complete
                </h3>
                <p style={{ margin: 0, fontSize: '14px', color: '#15803d' }}>
                  Successfully inserted <strong>{importSummary.importedCount}</strong> products into local SQLite in <strong>ONE transaction</strong> (Rule 5).
                </p>
              </div>

              {importSummary.skippedCount > 0 && (
                <div>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 700, color: '#991b1b' }}>
                    Skipped Rows ({importSummary.skippedCount}):
                  </h4>
                  <div
                    style={{
                      maxHeight: '180px',
                      overflowY: 'auto',
                      backgroundColor: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '8px',
                      padding: '12px',
                    }}
                  >
                    {importSummary.errors.map((err, i) => (
                      <div key={i} style={{ fontSize: '12px', color: '#7f1d1d', marginBottom: '6px' }}>
                        Row #{err.rowNumber}: {err.barcode ? `[Barcode: ${err.barcode}] ` : ''}
                        {err.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '10px 24px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  Close & View Catalog
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
