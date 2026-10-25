import React, { useState, useEffect, useCallback, useRef } from 'react';
import type {
  StockFilterType,
  StockOverviewProduct,
  StockOverviewBatch,
} from '@pos/shared';
import { formatPaisaToRupees } from '@pos/shared';
import { StockAdjustmentModal } from './StockAdjustmentModal';

export const StockOverview: React.FC = () => {
  const [viewMode, setViewMode] = useState<'by_batch' | 'by_product'>('by_batch');
  const [filter, setFilter] = useState<StockFilterType>('all');
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  // Data
  const [batchItems, setBatchItems] = useState<StockOverviewBatch[]>([]);
  const [productItems, setProductItems] = useState<StockOverviewProduct[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Adjustment Modal state
  const [isAdjModalOpen, setIsAdjModalOpen] = useState<boolean>(false);
  const [selectedBatchForAdj, setSelectedBatchForAdj] = useState<{
    productId: string;
    batchId: string;
    batchNo: string;
    balance: number;
    productName: string;
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce search by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Load stock overview data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (viewMode === 'by_batch') {
        const res = await window.api.stock.getOverviewBatches({
          filter,
          search: debouncedSearch,
          page,
          pageSize,
        });
        setBatchItems(res.items);
        setTotalCount(res.total);
        setTotalPages(res.totalPages);
      } else {
        const res = await window.api.stock.getOverviewProducts({
          filter,
          search: debouncedSearch,
          page,
          pageSize,
        });
        setProductItems(res.items);
        setTotalCount(res.total);
        setTotalPages(res.totalPages);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load stock data');
    } finally {
      setLoading(false);
    }
  }, [viewMode, filter, debouncedSearch, page, pageSize]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Keyboard shortcut '/' to search
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

  const handleOpenAdjustmentForBatch = (b: StockOverviewBatch) => {
    setSelectedBatchForAdj({
      productId: b.productId,
      batchId: b.batchId,
      batchNo: b.batchNo,
      balance: b.balance,
      productName: `${b.brandName} ${b.strength} (${b.genericName})`,
    });
    setIsAdjModalOpen(true);
  };

  const handleOpenGeneralAdjustment = () => {
    setSelectedBatchForAdj(null);
    setIsAdjModalOpen(true);
  };

  const getStatusBadge = (status: StockOverviewBatch['status']) => {
    switch (status) {
      case 'expired':
        return {
          label: 'Expired',
          bg: '#fee2e2',
          text: '#991b1b',
          border: '#fecdd3',
        };
      case 'expiring_60':
        return {
          label: 'Expiring ≤ 60d',
          bg: '#ffedd5',
          text: '#9a3412',
          border: '#fed7aa',
        };
      case 'expiring_90':
        return {
          label: 'Expiring ≤ 90d',
          bg: '#fef9c3',
          text: '#854d0e',
          border: '#fef08a',
        };
      default:
        return {
          label: 'Good',
          bg: '#ecfdf5',
          text: '#065f46',
          border: '#a7f3d0',
        };
    }
  };

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
            Stock & Inventory Overview
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
            Balances computed live from signed stock movements strictly adhering to <strong>Rule 4</strong> (Stock balance = sum of movements).
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenGeneralAdjustment}
          style={{
            backgroundColor: '#0284c7',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '8px 16px',
            fontWeight: 600,
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 1px 3px rgba(2, 132, 199, 0.2)',
          }}
        >
          <span>⚖️</span> New Stock Adjustment
        </button>
      </div>

      {/* Top Filter & View Mode Controls */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          padding: '16px 20px',
          marginBottom: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        {/* Row 1: View Mode Tabs + Search */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '4px', backgroundColor: '#f1f5f9', padding: '4px', borderRadius: '6px' }}>
            <button
              type="button"
              onClick={() => {
                setViewMode('by_batch');
                setPage(1);
              }}
              style={{
                padding: '6px 14px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: viewMode === 'by_batch' ? '#ffffff' : 'transparent',
                color: viewMode === 'by_batch' ? '#0f172a' : '#64748b',
                fontWeight: viewMode === 'by_batch' ? 700 : 500,
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: viewMode === 'by_batch' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              📦 Overview by Batch
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode('by_product');
                setPage(1);
              }}
              style={{
                padding: '6px 14px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: viewMode === 'by_product' ? '#ffffff' : 'transparent',
                color: viewMode === 'by_product' ? '#0f172a' : '#64748b',
                fontWeight: viewMode === 'by_product' ? 700 : 500,
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: viewMode === 'by_product' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              💊 Overview by Product
            </button>
          </div>

          <div style={{ position: 'relative', width: '340px' }}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Filter by brand, generic, or batch... (Press '/')"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '8px',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Quick Filter Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>Filters:</span>
          {(
            [
              { key: 'all', label: 'All Stock' },
              { key: 'low_stock', label: '⚠️ Low Stock (≤ 10)' },
              { key: 'expiring_60', label: '⏳ Expiring in 60 Days' },
              { key: 'expiring_90', label: '🕒 Expiring in 90 Days' },
              { key: 'expired', label: '❌ Expired Batches' },
            ] as const
          ).map((chip) => {
            const isSelected = filter === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => {
                  setFilter(chip.key);
                  setPage(1);
                }}
                style={{
                  padding: '5px 12px',
                  borderRadius: '16px',
                  border: isSelected ? '1px solid #0284c7' : '1px solid #e2e8f0',
                  backgroundColor: isSelected ? '#eff6ff' : '#f8fafc',
                  color: isSelected ? '#0369a1' : '#475569',
                  fontSize: '12px',
                  fontWeight: isSelected ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#fee2e2',
            color: '#991b1b',
            borderRadius: '6px',
            marginBottom: '16px',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {/* Main Table */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        {viewMode === 'by_batch' ? (
          /* Table: By Batch */
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>Medicine</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>Batch No</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>Expiry Date</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>Status</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155', textAlign: 'right' }}>
                  Stock Balance (Rule 4)
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155', textAlign: 'right' }}>
                  Cost (Rule 1)
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155', textAlign: 'right' }}>
                  MRP (Rule 1)
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155', textAlign: 'right' }}>
                  Total Valuation
                </th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155', textAlign: 'right' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                    Loading batch balances...
                  </td>
                </tr>
              ) : batchItems.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                    No batch inventory found matching the criteria. Receive purchases via the GRN screen to stock batches.
                  </td>
                </tr>
              ) : (
                batchItems.map((b) => {
                  const badge = getStatusBadge(b.status);
                  const valuationPaisa = b.balance > 0 ? b.balance * b.costPaisa : 0;
                  return (
                    <tr key={b.batchId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>
                          {b.brandName} <span style={{ fontWeight: 400, color: '#64748b' }}>{b.strength}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          {b.genericName} • {b.form}
                        </div>
                      </td>

                      <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontWeight: 600, color: '#1e293b' }}>
                        {b.batchNo}
                      </td>

                      <td style={{ padding: '12px 16px', color: '#475569' }}>
                        {b.expiryDate}
                      </td>

                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 600,
                            backgroundColor: badge.bg,
                            color: badge.text,
                            border: `1px solid ${badge.border}`,
                          }}
                        >
                          {badge.label}
                        </span>
                      </td>

                      <td
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontWeight: 700,
                          fontSize: '14px',
                          color: b.balance <= 0 ? '#dc2626' : b.balance <= 10 ? '#d97706' : '#0f172a',
                        }}
                      >
                        {b.balance}
                      </td>

                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#475569' }}>
                        {formatPaisaToRupees(b.costPaisa)}
                      </td>

                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#475569' }}>
                        {formatPaisaToRupees(b.mrpPaisa)}
                      </td>

                      <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#0369a1' }}>
                        {formatPaisaToRupees(valuationPaisa)}
                      </td>

                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => handleOpenAdjustmentForBatch(b)}
                          style={{
                            padding: '4px 10px',
                            backgroundColor: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#1d4ed8',
                            cursor: 'pointer',
                          }}
                        >
                          Adjust
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        ) : (
          /* Table: By Product */
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>Medicine Name</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>Generic Formula</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>Form / Strength</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155', textAlign: 'center' }}>Batches</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>Earliest Expiry</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: '#334155', textAlign: 'right' }}>
                  Total Balance (Rule 4)
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                    Loading product balances...
                  </td>
                </tr>
              ) : productItems.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                    No products found.
                  </td>
                </tr>
              ) : (
                productItems.map((p) => (
                  <tr key={p.productId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0f172a' }}>
                      {p.brandName}
                      {p.isControlled && (
                        <span
                          style={{
                            marginLeft: '6px',
                            backgroundColor: '#fee2e2',
                            color: '#991b1b',
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 5px',
                            borderRadius: '3px',
                          }}
                        >
                          Controlled
                        </span>
                      )}
                    </td>

                    <td style={{ padding: '12px 16px', color: '#475569' }}>
                      {p.genericName}
                    </td>

                    <td style={{ padding: '12px 16px', color: '#475569' }}>
                      {p.form} • {p.strength}
                    </td>

                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: '#1e293b' }}>
                      {p.batchCount}
                    </td>

                    <td style={{ padding: '12px 16px', color: '#475569' }}>
                      {p.earliestExpiry || '—'}
                    </td>

                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        fontWeight: 700,
                        fontSize: '14px',
                        color: p.totalBalance <= 0 ? '#dc2626' : p.totalBalance <= 10 ? '#d97706' : '#0f172a',
                      }}
                    >
                      {p.totalBalance} units
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '16px',
          fontSize: '13px',
          color: '#64748b',
        }}
      >
        <div>
          Showing {totalCount > 0 ? (page - 1) * pageSize + 1 : 0} to{' '}
          {Math.min(page * pageSize, totalCount)} of {totalCount} records
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
              backgroundColor: '#ffffff',
              fontSize: '12px',
            }}
          >
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>

          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: page <= 1 ? '#f8fafc' : '#ffffff',
              color: page <= 1 ? '#94a3b8' : '#334155',
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            Previous
          </button>

          <span style={{ fontWeight: 600, color: '#334155' }}>
            Page {page} of {totalPages}
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
              color: page >= totalPages ? '#94a3b8' : '#334155',
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            Next
          </button>
        </div>
      </div>

      {/* Stock Adjustment Modal */}
      {isAdjModalOpen && (
        <StockAdjustmentModal
          isOpen={isAdjModalOpen}
          onClose={() => setIsAdjModalOpen(false)}
          onSuccess={() => {
            loadData();
          }}
          initialProductId={selectedBatchForAdj?.productId}
          initialBatchId={selectedBatchForAdj?.batchId}
          initialBatchNo={selectedBatchForAdj?.batchNo}
          initialBalance={selectedBatchForAdj?.balance}
          productName={selectedBatchForAdj?.productName}
        />
      )}
    </div>
  );
};
