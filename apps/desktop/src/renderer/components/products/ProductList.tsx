import React, { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ProductWithTax,
  ProductSortBy,
  SortOrder,
  TaxCategory,
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
      });
      setProducts(res.products);
      setTotalCount(res.totalCount);
      setTotalPages(res.totalPages);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, sortBy, sortOrder, page, pageSize]);

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
    if (sortBy !== col) return ' ↕';
    return sortOrder === 'asc' ? ' ↑' : ' ↓';
  };

  const startRecord = (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, totalCount);

  return (
    <div>
      {/* Top Action Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
            Pharmacy Product Catalog
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
            Fast indexed search across {totalCount.toLocaleString()} products (press &apos;/&apos; to search)
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            disabled={isSeeding}
            onClick={handleSeed}
            style={{
              padding: '8px 14px',
              backgroundColor: '#f1f5f9',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isSeeding ? 'not-allowed' : 'pointer',
            }}
          >
            {isSeeding ? 'Seeding...' : '🌱 Seed 200 Products'}
          </button>

          <button
            type="button"
            onClick={() => setIsWizardOpen(true)}
            style={{
              padding: '8px 16px',
              backgroundColor: '#f8fafc',
              color: '#1e293b',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            📥 Import CSV
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingProduct(null);
              setIsFormOpen(true);
            }}
            style={{
              padding: '8px 18px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(37, 99, 235, 0.2)',
            }}
          >
            + New Product
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

      {/* Search & Filter Bar */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          backgroundColor: '#ffffff',
          padding: '12px 16px',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          marginBottom: '16px',
        }}
      >
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{ position: 'absolute', left: '12px', top: '9px', color: '#94a3b8' }}>
            🔍
          </span>
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by brand name, generic formula, or barcode... (Press '/' to focus)"
            style={{
              width: '100%',
              padding: '8px 12px 8px 36px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#64748b' }}>
          <span>Page Size:</span>
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
              fontSize: '13px',
              backgroundColor: '#ffffff',
            }}
          >
            <option value={25}>25 rows</option>
            <option value={50}>50 rows</option>
            <option value={100}>100 rows</option>
          </select>
        </div>
      </div>

      {/* Main Table */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th
                  onClick={() => handleSort('brand_name')}
                  style={{ padding: '12px 16px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}
                >
                  Brand Name{getSortIcon('brand_name')}
                </th>
                <th
                  onClick={() => handleSort('generic_name')}
                  style={{ padding: '12px 16px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}
                >
                  Generic Formula{getSortIcon('generic_name')}
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Strength & Form</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Manufacturer</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Barcode</th>
                <th
                  onClick={() => handleSort('mrp_paisa')}
                  style={{ padding: '12px 16px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}
                >
                  Retail Price (MRP){getSortIcon('mrp_paisa')}
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                    Loading catalog records...
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                    No products matched your search query.
                  </td>
                </tr>
              ) : (
                products.map((p) => {
                  const rupees = (p.mrpPaisa / 100).toFixed(2);
                  return (
                    <tr
                      key={p.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        transition: 'background-color 0.1s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0f172a' }}>
                        {p.brandName}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#334155' }}>
                        {p.genericName}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#64748b' }}>
                        <span style={{ fontWeight: 500, color: '#1e293b' }}>{p.strength}</span> • {p.form}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#475569' }}>
                        {p.manufacturer}
                      </td>
                      <td style={{ padding: '12px 16px', fontFamily: 'Consolas, monospace', fontSize: '12px', color: '#64748b' }}>
                        {p.barcode || <span style={{ color: '#cbd5e1' }}>None</span>}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0f172a' }}>
                        Rs. {rupees}
                        <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 400 }}>
                          {p.mrpPaisa} paisa
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {p.isControlled && (
                          <span
                            style={{
                              padding: '2px 6px',
                              backgroundColor: '#fee2e2',
                              color: '#991b1b',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 700,
                              marginRight: '6px',
                            }}
                          >
                            NARCOTIC
                          </span>
                        )}
                        <span
                          style={{
                            padding: '2px 6px',
                            backgroundColor: p.isActive ? '#dcfce7' : '#f1f5f9',
                            color: p.isActive ? '#166534' : '#64748b',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          {p.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProduct(p);
                            setIsFormOpen(true);
                          }}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '4px',
                            border: '1px solid #cbd5e1',
                            backgroundColor: '#ffffff',
                            color: '#1e293b',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: '13px', color: '#64748b' }}>
            Showing <strong>{totalCount > 0 ? startRecord : 0}</strong> to <strong>{endRecord}</strong> of{' '}
            <strong>{totalCount.toLocaleString()}</strong> products
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: page <= 1 ? '#f8fafc' : '#ffffff',
                color: page <= 1 ? '#94a3b8' : '#1e293b',
                fontSize: '12px',
                fontWeight: 600,
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              Previous
            </button>

            <span style={{ fontSize: '13px', color: '#475569', padding: '0 6px' }}>
              Page <strong>{page}</strong> of <strong>{totalPages}</strong>
            </span>

            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: page >= totalPages ? '#f8fafc' : '#ffffff',
                color: page >= totalPages ? '#94a3b8' : '#1e293b',
                fontSize: '12px',
                fontWeight: 600,
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              Next
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
