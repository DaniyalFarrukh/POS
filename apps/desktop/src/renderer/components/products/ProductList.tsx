import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  formatPKR,
  type ProductWithTax,
  type ProductSortBy,
  type SortOrder,
  type TaxCategory,
} from '@pos/shared';
import { ProductForm } from './ProductForm';
import { ProductCsvWizard } from './ProductCsvWizard';

export const ProductList: React.FC = () => {
  const [products, setProducts] = useState<ProductWithTax[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [sortBy, setSortBy] = useState<ProductSortBy>('brand_name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const [taxCategories, setTaxCategories] = useState<TaxCategory[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<ProductWithTax | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);
  const [isSeeding, setIsSeeding] = useState<boolean>(false);

  // Tab state: Active Treatment vs Inactive Treatment
  const [activeTab, setActiveTab] = useState<'active' | 'inactive'>('active');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce search input by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset to page 1 on new search
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Load Tax Categories on initial mount
  useEffect(() => {
    window.api.products
      .getTaxCategories()
      .then((cats) => setTaxCategories(cats))
      .catch((err) => console.error('Failed to load tax categories:', err));
  }, []);

  // Fetch paginated products
  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.api.products.getProducts({
        search: debouncedSearch,
        sortBy,
        sortOrder,
        page,
        pageSize,
        isActive: activeTab === 'active',
      });
      setProducts(res.products);
      setTotalCount(res.totalCount);
      setTotalPages(res.totalPages);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, sortBy, sortOrder, page, pageSize, activeTab]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Keyboard shortcut listener (/ to focus search)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSort = (column: ProductSortBy) => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
    setPage(1);
  };

  const handleSeed = async () => {
    setIsSeeding(true);
    try {
      await window.api.products.seedProducts();
      await loadProducts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Seeding failed');
    } finally {
      setIsSeeding(false);
    }
  };

  const getSortIcon = (col: ProductSortBy) => {
    if (sortBy !== col) return ' ⇅';
    return sortOrder === 'asc' ? ' ↑' : ' ↓';
  };

  const displayedProducts = products;

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleAll = () => {
    if (selectedIds.size === displayedProducts.length && displayedProducts.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedProducts.map((p) => p.id)));
    }
  };

  const startRecord = (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, totalCount);

  return (
    <div>
      {/* HexaPharm Underline Sub-Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '24px',
          borderBottom: '1px solid #e2e8f0',
          marginBottom: '16px',
        }}
      >
        <button
          type="button"
          className={`tab-underline ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('active');
            setPage(1);
            setSelectedIds(new Set());
          }}
        >
          Active Medicines
        </button>
        <button
          type="button"
          className={`tab-underline ${activeTab === 'inactive' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('inactive');
            setPage(1);
            setSelectedIds(new Set());
          }}
        >
          Discontinued / Inactive
        </button>
      </div>

      {/* Sub-Action Bar: Product Count Chip + Action Buttons */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        {/* Count indicator chip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              backgroundColor: '#eff6ff',
              borderRadius: '9999px',
              fontSize: '13px',
              fontWeight: 700,
              color: '#1d4ed8',
              border: '1px solid #dbeafe',
            }}
          >
            <span style={{ fontSize: '15px' }}>💊</span>
            <span>
              <strong>{displayedProducts.length}</strong> medicines
            </span>
          </div>
        </div>

        {/* Right Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="interactive-btn"
            disabled={isSeeding}
            onClick={handleSeed}
            style={{
              padding: '7px 14px',
              backgroundColor: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isSeeding ? 'not-allowed' : 'pointer',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            {isSeeding ? 'Seeding...' : '🌱 Seed 200'}
          </button>

          <button
            type="button"
            className="interactive-btn"
            onClick={() => setIsWizardOpen(true)}
            style={{
              padding: '7px 14px',
              backgroundColor: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <span>📥</span>
            <span>Import CSV</span>
          </button>

          <button
            type="button"
            className="interactive-btn"
            onClick={() => {
              setEditingProduct(null);
              setIsFormOpen(true);
            }}
            style={{
              padding: '8px 18px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 4px rgba(37, 99, 235, 0.25)',
            }}
          >
            <span>+</span>
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {error && (
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
          {error}
        </div>
      )}

      {/* Quick Search & Row Count Controls */}
      <div
        style={{
          display: 'flex',
          gap: '14px',
          alignItems: 'center',
          backgroundColor: '#ffffff',
          padding: '10px 14px',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          marginBottom: '14px',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ flex: 1, position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#94a3b8',
              fontSize: '13px',
            }}
          >
            🔍
          </span>
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search medicines by brand name, generic formula, barcode, or manufacturer... (Press '/' to focus)"
            style={{
              width: '100%',
              padding: '7px 12px 7px 34px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              backgroundColor: '#f8fafc',
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12.5px',
            color: '#64748b',
          }}
        >
          <span>Show:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(parseInt(e.target.value, 10));
              setPage(1);
            }}
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '12.5px',
              backgroundColor: '#ffffff',
              color: '#334155',
              cursor: 'pointer',
            }}
          >
            <option value={25}>25 rows</option>
            <option value={50}>50 rows</option>
            <option value={100}>100 rows</option>
          </select>
        </div>
      </div>

      {/* Main Table: HexaPharm Treatments Aesthetic */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontSize: '13px',
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: '#ffffff',
                  borderBottom: '1px solid #e2e8f0',
                  color: '#94a3b8',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                <th style={{ padding: '12px 16px', width: '36px' }}>
                  <input
                    type="checkbox"
                    checked={
                      displayedProducts.length > 0 && selectedIds.size === displayedProducts.length
                    }
                    onChange={handleToggleAll}
                    style={{
                      accentColor: '#2563eb',
                      cursor: 'pointer',
                      width: '15px',
                      height: '15px',
                    }}
                  />
                </th>
                <th
                  onClick={() => handleSort('brand_name')}
                  style={{
                    padding: '12px 16px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  PRODUCT & ACTIVE FORMULA{getSortIcon('brand_name')}
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>DOSAGE & FORM</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>MANUFACTURER</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>CATEGORY / TYPE</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>TAX STATUS</th>
                <th
                  onClick={() => handleSort('mrp_paisa')}
                  style={{
                    padding: '12px 16px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    userSelect: 'none',
                    textAlign: 'right',
                  }}
                >
                  RETAIL PRICE (MRP){getSortIcon('mrp_paisa')}
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    fontWeight: 700,
                    width: '40px',
                    textAlign: 'center',
                  }}
                >
                  ⋮
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}
                  >
                    Loading medicine catalog...
                  </td>
                </tr>
              ) : displayedProducts.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}
                  >
                    No medicines matched your criteria in &quot;
                    {activeTab === 'active' ? 'Active' : 'Inactive'}&quot;.
                  </td>
                </tr>
              ) : (
                displayedProducts.map((p) => {
                  const isSelected = selectedIds.has(p.id);

                  return (
                    <tr
                      key={p.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        backgroundColor: isSelected ? '#eff6ff' : 'transparent',
                        transition: 'background-color 0.1s',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.backgroundColor = '#f8fafc';
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      {/* Checkbox */}
                      <td style={{ padding: '12px 16px' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(p.id)}
                          style={{
                            accentColor: '#2563eb',
                            cursor: 'pointer',
                            width: '15px',
                            height: '15px',
                          }}
                        />
                      </td>

                      {/* Product & Active Formula */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '13.5px' }}>
                            {p.brandName}
                          </span>
                          {p.barcode && (
                            <span
                              className="tabular-nums"
                              style={{
                                fontSize: '10px',
                                color: '#64748b',
                                backgroundColor: '#f1f5f9',
                                border: '1px solid #e2e8f0',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                letterSpacing: '0.02em',
                              }}
                            >
                              #{p.barcode}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                          {p.genericName}
                        </div>
                      </td>

                      {/* Dosage & Form */}
                      <td style={{ padding: '12px 16px' }}>
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            fontSize: '12px',
                            padding: '3px 8px',
                            backgroundColor: '#f8fafc',
                            borderRadius: '6px',
                            border: '1px solid #e2e8f0',
                            color: '#334155',
                            fontWeight: 600,
                          }}
                        >
                          <span>{p.strength || 'Standard'}</span>
                          <span style={{ color: '#cbd5e1' }}>•</span>
                          <span style={{ color: '#64748b', textTransform: 'capitalize' }}>
                            {p.form}
                          </span>
                        </div>
                      </td>

                      {/* Manufacturer */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontSize: '12.5px', color: '#334155', fontWeight: 600 }}>
                          {p.manufacturer || '—'}
                        </div>
                      </td>

                      {/* Category / Regulation Type */}
                      <td style={{ padding: '12px 16px' }}>
                        {p.isControlled ? (
                          <span
                            className="badge-rose"
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '10.5px',
                              fontWeight: 800,
                              letterSpacing: '0.04em',
                            }}
                          >
                            Rx CONTROLLED
                          </span>
                        ) : (
                          <span
                            className="badge-teal"
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '10.5px',
                              fontWeight: 700,
                            }}
                          >
                            OTC GENERAL
                          </span>
                        )}
                      </td>

                      {/* Tax Status */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontSize: '12px', color: '#475569', fontWeight: 500 }}>
                          {p.taxCategoryName || 'Standard GST'} (
                          {((p.taxRateBp || 0) / 100).toFixed(0)}%)
                        </div>
                      </td>

                      {/* Retail Price (MRP) */}
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <strong
                          className="tabular-nums"
                          style={{ color: '#0f172a', fontSize: '13.5px', fontWeight: 800 }}
                        >
                          {formatPKR(p.mrpPaisa)}
                        </strong>
                      </td>

                      {/* Action Kebab */}
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <button
                          type="button"
                          className="kebab-btn"
                          onClick={() => {
                            setEditingProduct(p);
                            setIsFormOpen(true);
                          }}
                          title="Product Details & Edit"
                        >
                          ⋮
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* HexaPharm Pagination Controls */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #f1f5f9',
            backgroundColor: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: '12.5px', color: '#64748b' }}>
            Showing <strong>{totalCount > 0 ? startRecord : 0}</strong> to{' '}
            <strong>{endRecord}</strong> of <strong>{totalCount.toLocaleString()}</strong> records
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
                backgroundColor: page <= 1 ? '#f8fafc' : '#ffffff',
                color: page <= 1 ? '#cbd5e1' : '#334155',
                fontSize: '13px',
                fontWeight: 700,
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ‹
            </button>

            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const pNum = i + 1;
              const isActive = pNum === page;
              return (
                <button
                  key={pNum}
                  type="button"
                  onClick={() => setPage(pNum)}
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '6px',
                    border: isActive ? 'none' : '1px solid #e2e8f0',
                    backgroundColor: isActive ? '#2563eb' : '#ffffff',
                    color: isActive ? '#ffffff' : '#475569',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {pNum}
                </button>
              );
            })}

            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
                backgroundColor: page >= totalPages ? '#f8fafc' : '#ffffff',
                color: page >= totalPages ? '#cbd5e1' : '#334155',
                fontSize: '13px',
                fontWeight: 700,
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* Product Form Modal */}
      <ProductForm
        product={editingProduct}
        taxCategories={taxCategories}
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSaved={loadProducts}
      />

      {/* CSV Import Wizard Modal */}
      <ProductCsvWizard
        taxCategories={taxCategories}
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onImportComplete={loadProducts}
      />
    </div>
  );
};
