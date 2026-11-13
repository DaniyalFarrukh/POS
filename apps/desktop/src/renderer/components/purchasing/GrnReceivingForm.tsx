import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Supplier, ProductWithTax, PurchaseRecord } from '@pos/shared';
import {
  convertRupeesToPaisa,
  formatPaisaToRupees,
  calculateLineTotalPaisa,
  roundHalfUp,
  formatPKR,
  getKarachiBusinessDate,
  normalizeBatchExpiry,
} from '@pos/shared';

interface GrnLineItem {
  id: string; // client temporary line id
  productId: string;
  productName: string;
  genericName: string;
  batchNo: string;
  expiryDate: string; // YYYY-MM-DD
  quantity: number;
  costRupees: string;
  costPaisa: number;
  mrpRupees: string;
  mrpPaisa: number;
  lineTotalPaisa: number;
}

interface GrnReceivingFormProps {
  onSuccess?: (purchase: PurchaseRecord) => void;
}

export const GrnReceivingForm: React.FC<GrnReceivingFormProps> = ({ onSuccess }) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [invoiceNo, setInvoiceNo] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(() => getKarachiBusinessDate());

  const [lines, setLines] = useState<GrnLineItem[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<PurchaseRecord | null>(null);

  // Product Autocomplete Search
  const [activeSearchLineId, setActiveSearchLineId] = useState<string | null>(null);
  const [productSearchQuery, setProductSearchQuery] = useState<string>('');
  const [productSearchResults, setProductSearchResults] = useState<ProductWithTax[]>([]);
  const [isSearchingProducts, setIsSearchingProducts] = useState<boolean>(false);

  // Quick Add Supplier Modal
  const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [newSupplierContact, setNewSupplierContact] = useState('');
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);

  // Quick Add Medicine Modal
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [newProdBrandName, setNewProdBrandName] = useState('');
  const [newProdGenericName, setNewProdGenericName] = useState('');
  const [newProdStrength, setNewProdStrength] = useState('500mg');
  const [newProdForm, setNewProdForm] = useState('tablet');
  const [newProdManufacturer, setNewProdManufacturer] = useState('');
  const [newProdMrp, setNewProdMrp] = useState('');
  const [targetLineIdForNewProd, setTargetLineIdForNewProd] = useState<string | null>(null);
  const [isSavingProduct, setIsSavingProduct] = useState(false);

  const supplierSelectRef = useRef<HTMLSelectElement>(null);

  // Load suppliers on mount
  useEffect(() => {
    window.api.purchasing
      .getSuppliers()
      .then((data) => {
        setSuppliers(data);
        if (data.length > 0 && data[0]) {
          setSelectedSupplierId(data[0].id);
        }
      })
      .catch((err) => console.error('Failed to load suppliers:', err))
      .finally(() => setLoadingSuppliers(false));
  }, []);

  // Search products when query changes
  useEffect(() => {
    if (!productSearchQuery.trim()) {
      setProductSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearchingProducts(true);
      try {
        const res = await window.api.products.getProducts({
          search: productSearchQuery.trim(),
          pageSize: 10,
        });
        setProductSearchResults(res.products);
      } catch (err) {
        console.error('Failed to search products:', err);
      } finally {
        setIsSearchingProducts(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [productSearchQuery]);

  const handleQuickAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierName.trim()) return;
    setIsSavingSupplier(true);
    try {
      const created = await window.api.purchasing.createSupplier({
        name: newSupplierName.trim(),
        phone: newSupplierPhone.trim() || undefined,
        contactPerson: newSupplierContact.trim() || undefined,
      });
      setSuppliers((prev) => [...prev, created]);
      setSelectedSupplierId(created.id);
      setIsAddSupplierModalOpen(false);
      setNewSupplierName('');
      setNewSupplierPhone('');
      setNewSupplierContact('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingSupplier(false);
    }
  };

  const handleQuickAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProdBrandName.trim()) return;
    setIsSavingProduct(true);
    try {
      const taxCategories = await window.api.products.getTaxCategories();
      const defaultTaxId = taxCategories[0]?.id;
      if (!defaultTaxId) throw new Error('No tax category available');

      const mrpNum = parseFloat(newProdMrp) || 0;
      const created = await window.api.products.createProduct({
        brandName: newProdBrandName.trim(),
        genericName: newProdGenericName.trim() || newProdBrandName.trim(),
        strength: newProdStrength.trim() || 'Standard',
        form: newProdForm.trim() || 'tablet',
        manufacturer: newProdManufacturer.trim() || 'Pharma',
        taxCategoryId: defaultTaxId,
        mrpPaisa: Math.round(mrpNum * 100),
        isControlled: false,
        isActive: true,
      });

      if (targetLineIdForNewProd) {
        handleSelectProduct(targetLineIdForNewProd, created);
      }
      setIsAddProductModalOpen(false);
      setNewProdBrandName('');
      setNewProdGenericName('');
      setNewProdStrength('500mg');
      setNewProdForm('tablet');
      setNewProdManufacturer('');
      setNewProdMrp('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingProduct(false);
    }
  };

  // Add initial empty line if none
  const addLine = useCallback(() => {
    const defaultExpiry = getKarachiBusinessDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));

    const newLine: GrnLineItem = {
      id: Math.random().toString(36).substring(2, 9),
      productId: '',
      productName: '',
      genericName: '',
      batchNo: '',
      expiryDate: defaultExpiry,
      quantity: 1,
      costRupees: '0.00',
      costPaisa: 0,
      mrpRupees: '0.00',
      mrpPaisa: 0,
      lineTotalPaisa: 0,
    };
    setLines((prev) => [...prev, newLine]);
  }, []);

  useEffect(() => {
    if (lines.length === 0) {
      addLine();
    }
  }, [lines.length, addLine]);

  const updateLine = (id: string, updates: Partial<GrnLineItem>) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        const updated = { ...line, ...updates };

        // Recalculate cost paisa if rupees string changed
        if (updates.costRupees !== undefined) {
          try {
            updated.costPaisa = convertRupeesToPaisa(updates.costRupees);
          } catch {
            updated.costPaisa = 0;
          }
        }

        // Recalculate MRP paisa if rupees string changed
        if (updates.mrpRupees !== undefined) {
          try {
            updated.mrpPaisa = convertRupeesToPaisa(updates.mrpRupees);
          } catch {
            updated.mrpPaisa = 0;
          }
        }

        // Recalculate line total paisa
        try {
          updated.lineTotalPaisa = calculateLineTotalPaisa(updated.quantity, updated.costPaisa);
        } catch {
          updated.lineTotalPaisa = 0;
        }

        return updated;
      })
    );
  };

  const removeLine = (id: string) => {
    if (lines.length === 1) {
      // Just clear line instead of deleting
      updateLine(id, {
        productId: '',
        productName: '',
        genericName: '',
        batchNo: '',
        quantity: 1,
        costRupees: '0.00',
        costPaisa: 0,
        mrpRupees: '0.00',
        mrpPaisa: 0,
        lineTotalPaisa: 0,
      });
      return;
    }
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleSelectProduct = (lineId: string, p: ProductWithTax) => {
    const costPaisa = roundHalfUp(p.mrpPaisa * 8, 10); // standard 20% trade discount preview
    const costRupees = formatPKR(costPaisa, { showPrefix: false });
    const mrpRupees = formatPKR(p.mrpPaisa, { showPrefix: false });

    updateLine(lineId, {
      productId: p.id,
      productName: `${p.brandName} ${p.strength}`,
      genericName: p.genericName,
      mrpRupees,
      mrpPaisa: p.mrpPaisa,
      costRupees,
      costPaisa,
      lineTotalPaisa: calculateLineTotalPaisa(1, costPaisa),
    });

    setActiveSearchLineId(null);
    setProductSearchQuery('');
  };

  // Grand totals
  const totalUnits = lines.reduce((acc, l) => acc + (Number(l.quantity) || 0), 0);
  const grandTotalCostPaisa = lines.reduce((acc, l) => acc + l.lineTotalPaisa, 0);

  // Submit GRN
  const handleSubmitGrn = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage(null);

    if (!selectedSupplierId) {
      setErrorMessage('Please select a supplier / distributor.');
      return;
    }
    if (!invoiceNo.trim()) {
      setErrorMessage('Supplier invoice / bill number is required.');
      return;
    }

    const validLines = lines.filter((l) => l.productId);
    if (validLines.length === 0) {
      setErrorMessage('Please add at least one line item with a selected medicine.');
      return;
    }

    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i]!;
      if (!l.batchNo.trim()) {
        setErrorMessage(`Line #${i + 1} (${l.productName}): Batch number is required.`);
        return;
      }
      if (!l.expiryDate.trim()) {
        setErrorMessage(`Line #${i + 1} (${l.productName}): Expiry date is required.`);
        return;
      }
      try {
        normalizeBatchExpiry(l.expiryDate);
      } catch {
        setErrorMessage(
          `Line #${i + 1} (${l.productName}): Invalid expiry date "${l.expiryDate}". Use MM/YYYY or YYYY-MM-DD.`
        );
        return;
      }
      if (l.quantity <= 0) {
        setErrorMessage(`Line #${i + 1} (${l.productName}): Quantity must be at least 1.`);
        return;
      }
      if (l.costPaisa <= 0) {
        setErrorMessage(`Line #${i + 1} (${l.productName}): Cost price must be greater than zero.`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload = {
        supplierId: selectedSupplierId,
        supplierInvoiceNo: invoiceNo.trim(),
        invoiceDate,
        lines: validLines.map((l) => ({
          productId: l.productId,
          batchNo: l.batchNo.trim(),
          expiryDate: normalizeBatchExpiry(l.expiryDate),
          quantity: Number(l.quantity),
          costPaisa: l.costPaisa,
          mrpPaisa: l.mrpPaisa,
        })),
      };

      const result = await window.api.purchasing.receiveGrn(payload);
      setSuccessResult(result);
      if (onSuccess) onSuccess(result);

      // Reset form
      setInvoiceNo('');
      setLines([]);
      addLine();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to receive GRN.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Keyboard shortcut listener: Ctrl+Enter to save, Alt+A to add line
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmitGrn();
      } else if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        addLine();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addLine, handleSubmitGrn]);

  return (
    <div>
      {/* Header Info */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '20px',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
            Goods Receiving Note (GRN) / Purchase Entry
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
            Receive stock from distributors. Updates stock movements & batches in{' '}
            <strong>ONE database transaction</strong> (Rule 4 & Rule 5).
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <div
            style={{
              padding: '6px 12px',
              backgroundColor: '#f1f5f9',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 600,
              color: '#475569',
              border: '1px solid #e2e8f0',
            }}
          >
            Keyboard: <strong>Alt+A</strong> (Add Row) | <strong>Ctrl+Enter</strong> (Save GRN)
          </div>
        </div>
      </div>

      {/* Success Notification */}
      {successResult && (
        <div
          style={{
            padding: '14px 18px',
            backgroundColor: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: '8px',
            marginBottom: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: '14px', color: '#065f46' }}>
              ✓ Purchase GRN Successfully Received & Posted!
            </div>
            <div style={{ fontSize: '12px', color: '#047857', marginTop: '2px' }}>
              Invoice: <strong>{successResult.supplierInvoiceNo}</strong> (
              {successResult.supplierName}) — Total:{' '}
              <strong>{formatPaisaToRupees(successResult.totalCostPaisa)}</strong> across{' '}
              {successResult.lines?.length ?? 0} line items.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSuccessResult(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#065f46',
              fontSize: '16px',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Error Notification */}
      {errorMessage && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecdd3',
            color: '#991b1b',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          {errorMessage}
        </div>
      )}

      {/* GRN Meta Details Bar */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          padding: '16px 20px',
          marginBottom: '20px',
          display: 'grid',
          gridTemplateColumns: '1.5fr 1fr 1fr',
          gap: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <label
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#334155',
              }}
            >
              Distributor / Supplier <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <button
              type="button"
              onClick={() => setIsAddSupplierModalOpen(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#2563eb',
                fontSize: '11.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              + Add New Supplier
            </button>
          </div>
          <select
            ref={supplierSelectRef}
            value={selectedSupplierId}
            onChange={(e) => setSelectedSupplierId(e.target.value)}
            disabled={loadingSuppliers}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              backgroundColor: '#ffffff',
              color: '#0f172a',
              outline: 'none',
            }}
          >
            {loadingSuppliers ? (
              <option>Loading suppliers...</option>
            ) : suppliers.length === 0 ? (
              <option value="">No suppliers yet - Click "+ Add New Supplier"</option>
            ) : (
              suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.phone ? `(${s.phone})` : ''}
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: 600,
              color: '#334155',
              marginBottom: '6px',
            }}
          >
            Supplier Invoice / Bill No <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="text"
            placeholder="e.g. INV-98421"
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>

        <div>
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: 600,
              color: '#334155',
              marginBottom: '6px',
            }}
          >
            Invoice Date
          </label>
          <input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* GRN Line Items Table */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          overflow: 'visible',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          marginBottom: '20px',
        }}
      >
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#1e293b' }}>
            Received Line Items ({lines.length})
          </span>
          <button
            type="button"
            onClick={addLine}
            style={{
              padding: '6px 12px',
              backgroundColor: '#eff6ff',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Add Another Row (Alt+A)
          </button>
        </div>

        <table
          style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}
        >
          <thead>
            <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '10px 14px', width: '30px' }}>#</th>
              <th style={{ padding: '10px 14px', width: '280px' }}>Medicine / Product</th>
              <th style={{ padding: '10px 14px', width: '130px' }}>Batch No</th>
              <th style={{ padding: '10px 14px', width: '140px' }}>Expiry (MM/YYYY or Date)</th>
              <th style={{ padding: '10px 14px', width: '80px', textAlign: 'right' }}>Qty</th>
              <th style={{ padding: '10px 14px', width: '110px', textAlign: 'right' }}>
                Cost Price (Rs)
              </th>
              <th style={{ padding: '10px 14px', width: '110px', textAlign: 'right' }}>
                Retail MRP (Rs)
              </th>
              <th style={{ padding: '10px 14px', width: '120px', textAlign: 'right' }}>
                Line Total (Rs)
              </th>
              <th style={{ padding: '10px 14px', width: '40px', textAlign: 'center' }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={line.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 14px', color: '#94a3b8', fontWeight: 600 }}>
                  {idx + 1}
                </td>

                {/* Product Search & Selection Cell */}
                <td style={{ padding: '8px 14px', position: 'relative' }}>
                  {line.productId ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{line.productName}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{line.genericName}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          updateLine(line.id, { productId: '', productName: '', genericName: '' })
                        }
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          fontSize: '11px',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div>
                      <input
                        type="text"
                        placeholder="Search medicine (e.g. Panadol, Augmentin)..."
                        value={activeSearchLineId === line.id ? productSearchQuery : ''}
                        onFocus={() => {
                          setActiveSearchLineId(line.id);
                          setProductSearchQuery('');
                        }}
                        onChange={(e) => setProductSearchQuery(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          borderRadius: '5px',
                          border: '1px solid #cbd5e1',
                          fontSize: '12px',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />

                      {/* Autocomplete Dropdown */}
                      {activeSearchLineId === line.id &&
                        (productSearchQuery || productSearchResults.length > 0) && (
                          <div
                            style={{
                              position: 'absolute',
                              top: '42px',
                              left: '14px',
                              right: '14px',
                              backgroundColor: '#ffffff',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                              zIndex: 100,
                              maxHeight: '220px',
                              overflowY: 'auto',
                            }}
                          >
                            {isSearchingProducts ? (
                              <div style={{ padding: '10px', fontSize: '12px', color: '#64748b' }}>
                                Searching catalog...
                              </div>
                            ) : productSearchResults.length === 0 ? (
                              <div style={{ padding: '12px', fontSize: '12px', color: '#64748b' }}>
                                <div>No medicines found matching "{productSearchQuery}"</div>
                                {productSearchQuery.trim() && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNewProdBrandName(productSearchQuery.trim());
                                      setTargetLineIdForNewProd(line.id);
                                      setIsAddProductModalOpen(true);
                                    }}
                                    style={{
                                      marginTop: '8px',
                                      width: '100%',
                                      padding: '7px 10px',
                                      backgroundColor: '#2563eb',
                                      color: '#ffffff',
                                      borderRadius: '5px',
                                      border: 'none',
                                      cursor: 'pointer',
                                      fontWeight: 600,
                                      fontSize: '12px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '5px',
                                    }}
                                  >
                                    <span>➕</span> Add "{productSearchQuery.trim()}" as New Medicine
                                  </button>
                                )}
                              </div>
                            ) : (
                              <>
                                {productSearchResults.map((prod) => (
                                  <div
                                    key={prod.id}
                                    onClick={() => handleSelectProduct(line.id, prod)}
                                    style={{
                                      padding: '8px 12px',
                                      cursor: 'pointer',
                                      borderBottom: '1px solid #f1f5f9',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                    }}
                                    onMouseEnter={(e) =>
                                      (e.currentTarget.style.backgroundColor = '#eff6ff')
                                    }
                                    onMouseLeave={(e) =>
                                      (e.currentTarget.style.backgroundColor = '#ffffff')
                                    }
                                  >
                                    <div>
                                      <span style={{ fontWeight: 600, color: '#1e293b' }}>
                                        {prod.brandName} {prod.strength}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: '11px',
                                          color: '#64748b',
                                          marginLeft: '6px',
                                        }}
                                      >
                                        ({prod.genericName})
                                      </span>
                                    </div>
                                    <span
                                      style={{ fontWeight: 700, fontSize: '12px', color: '#0f172a' }}
                                    >
                                      {formatPaisaToRupees(prod.mrpPaisa)}
                                    </span>
                                  </div>
                                ))}
                                {productSearchQuery.trim() && (
                                  <div
                                    onClick={() => {
                                      setNewProdBrandName(productSearchQuery.trim());
                                      setTargetLineIdForNewProd(line.id);
                                      setIsAddProductModalOpen(true);
                                    }}
                                    style={{
                                      padding: '8px 12px',
                                      backgroundColor: '#f8fafc',
                                      borderTop: '1px dashed #cbd5e1',
                                      color: '#2563eb',
                                      cursor: 'pointer',
                                      fontWeight: 600,
                                      fontSize: '12px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '5px',
                                    }}
                                    onMouseEnter={(e) =>
                                      (e.currentTarget.style.backgroundColor = '#eff6ff')
                                    }
                                    onMouseLeave={(e) =>
                                      (e.currentTarget.style.backgroundColor = '#f8fafc')
                                    }
                                  >
                                    <span>➕</span> Add "{productSearchQuery.trim()}" as New Medicine
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                    </div>
                  )}
                </td>

                {/* Batch No */}
                <td style={{ padding: '8px 14px' }}>
                  <input
                    type="text"
                    placeholder="e.g. BN-981"
                    value={line.batchNo}
                    onChange={(e) => updateLine(line.id, { batchNo: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '5px',
                      border: '1px solid #cbd5e1',
                      fontSize: '12px',
                      boxSizing: 'border-box',
                    }}
                  />
                </td>

                {/* Expiry Date */}
                <td style={{ padding: '8px 14px' }}>
                  <input
                    type="text"
                    placeholder="MM/YYYY or Date"
                    value={line.expiryDate}
                    onChange={(e) => updateLine(line.id, { expiryDate: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '5px',
                      border: '1px solid #cbd5e1',
                      fontSize: '12px',
                      boxSizing: 'border-box',
                    }}
                  />
                  {(() => {
                    const trimmed = line.expiryDate.trim();
                    if (!trimmed) return null;
                    try {
                      const norm = normalizeBatchExpiry(trimmed);
                      return (
                        <div
                          style={{
                            fontSize: '10px',
                            color: '#15803d',
                            marginTop: '2px',
                            fontWeight: 600,
                          }}
                        >
                          End: {norm}
                        </div>
                      );
                    } catch {
                      return (
                        <div style={{ fontSize: '10px', color: '#dc2626', marginTop: '2px' }}>
                          Invalid date
                        </div>
                      );
                    }
                  })()}
                </td>

                {/* Quantity */}
                <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                  <input
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(e) =>
                      updateLine(line.id, { quantity: parseInt(e.target.value, 10) || 1 })
                    }
                    style={{
                      width: '70px',
                      padding: '6px 8px',
                      borderRadius: '5px',
                      border: '1px solid #cbd5e1',
                      fontSize: '12px',
                      textAlign: 'right',
                      boxSizing: 'border-box',
                    }}
                  />
                </td>

                {/* Cost Price (Rs.) */}
                <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                  <input
                    type="text"
                    value={line.costRupees}
                    onChange={(e) => updateLine(line.id, { costRupees: e.target.value })}
                    style={{
                      width: '95px',
                      padding: '6px 8px',
                      borderRadius: '5px',
                      border: '1px solid #cbd5e1',
                      fontSize: '12px',
                      textAlign: 'right',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
                    {line.costPaisa} paisa
                  </div>
                </td>

                {/* MRP (Rs.) */}
                <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                  <input
                    type="text"
                    value={line.mrpRupees}
                    onChange={(e) => updateLine(line.id, { mrpRupees: e.target.value })}
                    style={{
                      width: '95px',
                      padding: '6px 8px',
                      borderRadius: '5px',
                      border: '1px solid #cbd5e1',
                      fontSize: '12px',
                      textAlign: 'right',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
                    {line.mrpPaisa} paisa
                  </div>
                </td>

                {/* Line Total */}
                <td
                  style={{
                    padding: '8px 14px',
                    textAlign: 'right',
                    fontWeight: 600,
                    color: '#0f172a',
                  }}
                >
                  {formatPaisaToRupees(line.lineTotalPaisa)}
                </td>

                {/* Remove Line */}
                <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    title="Remove line"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      fontSize: '14px',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Large Readable Totals Summary Bar (Rule 10) */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #cbd5e1',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', gap: '32px' }}>
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#64748b',
                textTransform: 'uppercase',
              }}
            >
              Lines Count
            </div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
              {lines.filter((l) => l.productId).length}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#64748b',
                textTransform: 'uppercase',
              }}
            >
              Total Units
            </div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>{totalUnits}</div>
          </div>

          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#64748b',
                textTransform: 'uppercase',
              }}
            >
              Grand Total Cost (Rule 1)
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0284c7' }}>
              {formatPaisaToRupees(grandTotalCostPaisa)}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              ({grandTotalCostPaisa.toLocaleString()} integer paisa)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            onClick={addLine}
            style={{
              padding: '10px 18px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#f8fafc',
              color: '#334155',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            + Add Line (Alt+A)
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleSubmitGrn()}
            style={{
              padding: '10px 24px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: '#16a34a',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '14px',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 2px 4px rgba(22, 163, 74, 0.25)',
            }}
          >
            <span>💾</span>
            {isSubmitting ? 'Posting in 1 Tx...' : 'Save & Post GRN (Ctrl+Enter)'}
          </button>
        </div>
      </div>

      {/* Quick Add Supplier Modal */}
      {isAddSupplierModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(3px)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddSupplierModalOpen(false);
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              width: '420px',
              maxWidth: '90vw',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                Add Distributor / Supplier
              </h3>
              <button
                type="button"
                onClick={() => setIsAddSupplierModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleQuickAddSupplier} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Distributor Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Muller & Phipps, Searle, Local Vendor"
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Phone / Contact #
                </label>
                <input
                  type="text"
                  placeholder="e.g. 0300-1234567"
                  value={newSupplierPhone}
                  onChange={(e) => setNewSupplierPhone(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Contact Person / Sales Agent
                </label>
                <input
                  type="text"
                  placeholder="e.g. Tariq Mehmood"
                  value={newSupplierContact}
                  onChange={(e) => setNewSupplierContact(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setIsAddSupplierModalOpen(false)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
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
                  disabled={isSavingSupplier || !newSupplierName.trim()}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#2563eb',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: isSavingSupplier ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSavingSupplier ? 'Adding...' : 'Add Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Add Medicine Modal */}
      {isAddProductModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(3px)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddProductModalOpen(false);
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              width: '460px',
              maxWidth: '90vw',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                Add New Medicine / Product
              </h3>
              <button
                type="button"
                onClick={() => setIsAddProductModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleQuickAddProduct} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Brand Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Panadol Extra, Augmentin"
                  value={newProdBrandName}
                  onChange={(e) => setNewProdBrandName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    Generic / Salt Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Paracetamol"
                    value={newProdGenericName}
                    onChange={(e) => setNewProdGenericName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    Strength / Dosage
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 500mg, 1gm, 120ml"
                    value={newProdStrength}
                    onChange={(e) => setNewProdStrength(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    Form / Type
                  </label>
                  <select
                    value={newProdForm}
                    onChange={(e) => setNewProdForm(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      boxSizing: 'border-box',
                      backgroundColor: '#ffffff',
                    }}
                  >
                    <option value="tablet">Tablet</option>
                    <option value="capsule">Capsule</option>
                    <option value="syrup">Syrup / Suspension</option>
                    <option value="injection">Injection / Infusion</option>
                    <option value="drops">Eye / Ear Drops</option>
                    <option value="cream">Ointment / Cream</option>
                    <option value="inhaler">Inhaler</option>
                    <option value="sachet">Sachet</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                    Manufacturer
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. GSK, Searle, Getz"
                    value={newProdManufacturer}
                    onChange={(e) => setNewProdManufacturer(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Standard Retail MRP (Rs)
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 500"
                  value={newProdMrp}
                  onChange={(e) => setNewProdMrp(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setIsAddProductModalOpen(false)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
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
                  disabled={isSavingProduct || !newProdBrandName.trim()}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#16a34a',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: isSavingProduct ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSavingProduct ? 'Saving...' : 'Save & Select Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
