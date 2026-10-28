import React, { useState, useEffect } from 'react';
import type {
  CreateProductInput,
  ProductWithTax,
  TaxCategory,
} from '@pos/shared';
import { CreateProductInputSchema, formatPKR, convertRupeesToPaisa } from '@pos/shared';

interface ProductFormProps {
  product?: ProductWithTax | null;
  taxCategories: TaxCategory[];
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const ProductForm: React.FC<ProductFormProps> = ({
  product,
  taxCategories,
  isOpen,
  onClose,
  onSaved,
}) => {
  const [brandName, setBrandName] = useState('');
  const [genericName, setGenericName] = useState('');
  const [strength, setStrength] = useState('');
  const [form, setForm] = useState('tablet');
  const [manufacturer, setManufacturer] = useState('');
  const [barcode, setBarcode] = useState('');
  const [taxCategoryId, setTaxCategoryId] = useState('');
  const [mrpRupees, setMrpRupees] = useState('');
  const [isControlled, setIsControlled] = useState(false);
  const [isActive, setIsActive] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (product) {
      setBrandName(product.brandName);
      setGenericName(product.genericName);
      setStrength(product.strength);
      setForm(product.form);
      setManufacturer(product.manufacturer);
      setBarcode(product.barcode ?? '');
      setTaxCategoryId(product.taxCategoryId);
      setMrpRupees(formatPKR(product.mrpPaisa, { showPrefix: false }));
      setIsControlled(product.isControlled);
      setIsActive(product.isActive);
    } else {
      setBrandName('');
      setGenericName('');
      setStrength('');
      setForm('tablet');
      setManufacturer('');
      setBarcode('');
      setTaxCategoryId(taxCategories[0]?.id ?? '');
      setMrpRupees('');
      setIsControlled(false);
      setIsActive(true);
    }
    setError(null);
  }, [product, taxCategories, isOpen]);

  if (!isOpen) return null;

  // Live integer paisa calculation (Rule 1)
  let calculatedPaisa = 0;
  try {
    calculatedPaisa = mrpRupees.trim() ? convertRupeesToPaisa(mrpRupees) : 0;
    if (calculatedPaisa < 0) calculatedPaisa = 0;
  } catch {
    calculatedPaisa = 0;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let mrpPaisa = 0;
    try {
      mrpPaisa = convertRupeesToPaisa(mrpRupees);
      if (mrpPaisa < 0) {
        throw new Error('negative');
      }
    } catch {
      setError('Please enter a valid non-negative MRP price in Rupees (e.g. 50.00).');
      return;
    }

    const rawInput: CreateProductInput = {
      brandName: brandName.trim(),
      genericName: genericName.trim(),
      strength: strength.trim(),
      form: form.trim(),
      manufacturer: manufacturer.trim(),
      barcode: barcode.trim() ? barcode.trim() : null,
      taxCategoryId: taxCategoryId || (taxCategories[0]?.id ?? ''),
      mrpPaisa,
      isControlled,
      isActive,
    };

    const validation = CreateProductInputSchema.safeParse(rawInput);
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? 'Validation failed.');
      return;
    }

    setLoading(true);
    try {
      if (product) {
        await window.api.products.updateProduct(product.id, rawInput);
      } else {
        await window.api.products.createProduct(rawInput);
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const commonForms = [
    'tablet',
    'capsule',
    'syrup',
    'suspension',
    'injection',
    'drops',
    'inhaler',
    'gel',
    'sachet',
    'cream',
    'ointment',
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '20px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
              {product ? 'Edit Pharmacy Product' : 'Add New Pharmacy Product'}
            </h2>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
              All inventory prices are strictly stored as integer paisa (Rule 1).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              color: '#94a3b8',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} style={{ overflowY: 'auto', padding: '24px' }}>
          {error && (
            <div
              style={{
                padding: '12px',
                backgroundColor: '#fef2f2',
                color: '#b91c1c',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                fontSize: '13px',
                marginBottom: '16px',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Brand Name *
              </label>
              <input
                type="text"
                required
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="e.g. Augmentin"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Generic Name / Formula *
              </label>
              <input
                type="text"
                required
                value={genericName}
                onChange={(e) => setGenericName(e.target.value)}
                placeholder="e.g. Amoxicillin + Clavulanic Acid"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Strength *
              </label>
              <input
                type="text"
                required
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                placeholder="e.g. 625mg or 10mg/5ml"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Dosage Form *
              </label>
              <select
                value={form}
                onChange={(e) => setForm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  backgroundColor: '#ffffff',
                  boxSizing: 'border-box',
                }}
              >
                {commonForms.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Manufacturer / Pharma *
              </label>
              <input
                type="text"
                required
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                placeholder="e.g. GSK, Abbott, Getz"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Barcode (EAN-13 / UPC / Custom)
              </label>
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="e.g. 896400010025 (Optional, unique)"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                  fontFamily: 'Consolas, monospace',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Tax Category *
              </label>
              <select
                value={taxCategoryId}
                onChange={(e) => setTaxCategoryId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  backgroundColor: '#ffffff',
                  boxSizing: 'border-box',
                }}
              >
                {taxCategories.map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    {tc.name} ({tc.rateBp / 100}%{tc.isExempt ? ' - Exempt' : ''})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Price & Paisa Box */}
          <div
            style={{
              padding: '16px',
              backgroundColor: '#f8fafc',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              marginBottom: '18px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#1e293b', marginBottom: '4px' }}>
                  Maximum Retail Price (Rs.) *
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '12px', top: '9px', fontSize: '13px', color: '#64748b' }}>
                    Rs.
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={mrpRupees}
                    onChange={(e) => setMrpRupees(e.target.value)}
                    placeholder="0.00"
                    style={{
                      width: '100%',
                      padding: '9px 12px 9px 40px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '14px',
                      fontWeight: 600,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div style={{ flex: 1, padding: '8px 12px', backgroundColor: '#ffffff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Rule 1 Engine Storage:</div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#2563eb' }}>
                  {calculatedPaisa.toLocaleString()} paisa
                </div>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                  Integer paisa representation stored in SQLite
                </div>
              </div>
            </div>
          </div>

          {/* Controlled Drug & Status Toggles */}
          <div style={{ display: 'flex', gap: '24px', marginBottom: '24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: '#334155' }}>
              <input
                type="checkbox"
                checked={isControlled}
                onChange={(e) => setIsControlled(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#dc2626' }}
              />
              <span>
                <strong style={{ color: isControlled ? '#dc2626' : 'inherit' }}>Controlled Drug / Narcotic</strong> (Requires doctor prescription & audit trail)
              </span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: '#334155' }}>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#2563eb' }}
              />
              <span>Active for Billing</span>
            </label>
          </div>

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: '9px 18px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#475569',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '9px 22px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Saving...' : product ? 'Update Product' : 'Create Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
