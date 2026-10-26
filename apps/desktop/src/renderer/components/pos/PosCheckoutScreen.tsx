import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { AuthSession } from '@pos/shared';
import type { CartItem, CustomerInfo, HeldCart, PosCatalogItem } from './types';
import { computeLineWarning } from './types';
import {
  computeInvoiceTotals,
  formatPKR,
  generateUuidV7,
  roundHalfUp,
  type InvoiceLineInput,
  type FinalizeSaleInput,
  type Paisa,
} from '@pos/shared';
import { generateThermalReceiptHtml } from '../../utils/receiptGenerator';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { KeyboardShortcutOverlay } from './KeyboardShortcutOverlay';
import { SubstitutesModal } from './SubstitutesModal';
import { CustomerNotesModal } from './CustomerNotesModal';
import { HeldCartsModal } from './HeldCartsModal';
import { PaymentModal, type PaymentDetails } from './PaymentModal';

interface PosCheckoutScreenProps {
  session: AuthSession;
}

export const PosCheckoutScreen: React.FC<PosCheckoutScreenProps> = ({ session }) => {
  // Cart & State
  const [cartLines, setCartLines] = useState<CartItem[]>([]);
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | null>(null);
  const [customer, setCustomer] = useState<CustomerInfo>({
    name: '',
    phone: '',
    doctorName: '',
    notes: '',
  });
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PosCatalogItem[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchSelectedIndex, setSearchSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Modals state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showHeldCartsModal, setShowHeldCartsModal] = useState(false);
  const [substituteTargetProduct, setSubstituteTargetProduct] = useState<PosCatalogItem | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Toast auto-clear
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Search Debounce & Query
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const handler = setTimeout(() => {
      window.api.products
        .searchPosCatalog(trimmed, session.branch.id)
        .then((items) => {
          setSearchResults(items);
          setSearchSelectedIndex(0);
          setIsSearching(false);
        })
        .catch((err) => {
          console.error('POS Catalog Search failed:', err);
          setIsSearching(false);
        });
    }, 150);

    return () => clearTimeout(handler);
  }, [searchQuery, session.branch.id]);

  // Add product to cart helper
  const addProductToCart = useCallback((product: PosCatalogItem) => {
    setCartLines((prev) => {
      // Look for identical product and batch
      const existingIdx = prev.findIndex(
        (line) => line.product.id === product.id && line.batchId === product.earliestBatch?.id
      );

      if (existingIdx >= 0) {
        const updated = [...prev];
        const existing = updated[existingIdx];
        if (!existing) return prev;
        updated[existingIdx] = {
          ...existing,
          quantity: existing.quantity + 1,
        };
        setSelectedLineIndex(existingIdx);
        return updated;
      }

      const newLine: CartItem = {
        id: `${product.id}-${product.earliestBatch?.id ?? 'nobatch'}-${Date.now()}`,
        product,
        batchId: product.earliestBatch?.id,
        batchNo: product.earliestBatch?.batchNo,
        expiryDate: product.earliestBatch?.expiryDate,
        unitPricePaisa: product.mrpPaisa,
        quantity: 1,
        discountType: 'none',
        discountBp: 0,
        flatDiscountPaisa: 0,
        taxRateBp: product.taxRateBp,
        isTaxExempt: false,
      };

      const next = [...prev, newLine];
      setSelectedLineIndex(next.length - 1);
      return next;
    });

    // Clear search and refocus
    setSearchQuery('');
    setSearchResults([]);
    searchInputRef.current?.focus();
  }, []);

  // Compute Invoice Totals via @pos/shared
  const invoiceTotals = useMemo(() => {
    if (cartLines.length === 0) {
      return {
        lines: [],
        netTotalPaisa: 0 as Paisa,
        totalDiscountPaisa: 0 as Paisa,
        totalTaxPaisa: 0 as Paisa,
        grandTotalPaisa: 0 as Paisa,
      };
    }

    const lineInputs: InvoiceLineInput[] = cartLines.map((line) => ({
      unitPricePaisa: line.unitPricePaisa,
      quantity: line.quantity,
      discountBp: line.discountType === 'percent' ? line.discountBp : undefined,
      flatDiscountPaisa: line.discountType === 'flat' ? line.flatDiscountPaisa : undefined,
      taxRateBp: line.taxRateBp,
      isTaxExempt: line.isTaxExempt,
    }));

    return computeInvoiceTotals(lineInputs);
  }, [cartLines]);

  // Central Shortcut Handlers
  const handleOpenPay = useCallback(() => {
    if (cartLines.length === 0) {
      setToastMessage('⚠️ Cannot checkout an empty cart. Please add items first.');
      return;
    }
    setShowPaymentModal(true);
  }, [cartLines.length]);

  const handleFocusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const handleOpenHold = useCallback(() => {
    setShowHeldCartsModal(true);
  }, []);

  const handleOpenCustomer = useCallback(() => {
    setShowCustomerModal(true);
  }, []);

  const handleDeleteSelectedLine = useCallback(() => {
    if (selectedLineIndex !== null && selectedLineIndex >= 0 && selectedLineIndex < cartLines.length) {
      setCartLines((prev) => prev.filter((_, idx) => idx !== selectedLineIndex));
      setSelectedLineIndex((prev) => {
        if (prev === null) return null;
        if (prev >= cartLines.length - 1) return Math.max(0, cartLines.length - 2);
        return prev;
      });
    }
  }, [selectedLineIndex, cartLines.length]);

  const handleEscape = useCallback(() => {
    if (showPaymentModal) setShowPaymentModal(false);
    else if (showCustomerModal) setShowCustomerModal(false);
    else if (showHeldCartsModal) setShowHeldCartsModal(false);
    else if (substituteTargetProduct) setSubstituteTargetProduct(null);
    else if (showClearConfirm) setShowClearConfirm(false);
    else if (searchResults.length > 0) setSearchResults([]);
    else searchInputRef.current?.focus();
  }, [
    showPaymentModal,
    showCustomerModal,
    showHeldCartsModal,
    substituteTargetProduct,
    showClearConfirm,
    searchResults.length,
  ]);

  // Hook up shortcuts
  const { isAltHeld } = useKeyboardShortcuts({
    onPay: handleOpenPay,
    onSearchFocus: handleFocusSearch,
    onHoldCart: handleOpenHold,
    onCustomerNotes: handleOpenCustomer,
    onDeleteLine: handleDeleteSelectedLine,
    onEscape: handleEscape,
  });

  // Handle Search Input Keydown (Scanner Enter & arrow navigation)
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (searchResults.length > 0) {
        setSearchSelectedIndex((prev) => (prev + 1) % searchResults.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (searchResults.length > 0) {
        setSearchSelectedIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // If there are search results, add selected or top item
      if (searchResults.length > 0) {
        const chosen = searchResults[searchSelectedIndex] || searchResults[0];
        if (chosen) {
          addProductToCart(chosen);
        }
      } else if (searchQuery.trim()) {
        // Direct barcode lookup on Enter
        window.api.products
          .searchPosCatalog(searchQuery.trim(), session.branch.id)
          .then((items) => {
            if (items.length > 0 && items[0]) {
              addProductToCart(items[0]);
            } else {
              setToastMessage(`⚠️ No product found matching '${searchQuery.trim()}'`);
            }
          });
      }
    }
  };

  // Cart operations
  const updateLineQuantity = (idx: number, newQty: number) => {
    if (newQty <= 0) {
      // Remove line if quantity reduced to 0
      setCartLines((prev) => prev.filter((_, i) => i !== idx));
      if (selectedLineIndex === idx) setSelectedLineIndex(null);
      return;
    }
    setCartLines((prev) => {
      const updated = [...prev];
      const target = updated[idx];
      if (target) {
        updated[idx] = { ...target, quantity: Math.floor(newQty) };
      }
      return updated;
    });
  };

  const updateLineDiscount = (
    idx: number,
    type: 'none' | 'percent' | 'flat',
    value: number
  ) => {
    setCartLines((prev) => {
      const updated = [...prev];
      const target = updated[idx];
      if (!target) return prev;

      if (type === 'none') {
        updated[idx] = { ...target, discountType: 'none', discountBp: 0, flatDiscountPaisa: 0 };
      } else if (type === 'percent') {
        const bp = Math.max(0, Math.min(10000, Math.round(value * 100))); // e.g. 10% -> 1000 bp
        updated[idx] = { ...target, discountType: 'percent', discountBp: bp, flatDiscountPaisa: 0 };
      } else if (type === 'flat') {
        const paisa = Math.max(0, Math.round(value * 100)); // Rupees -> paisa
        updated[idx] = { ...target, discountType: 'flat', discountBp: 0, flatDiscountPaisa: paisa };
      }
      return updated;
    });
  };

  const clearCart = () => {
    setCartLines([]);
    setSelectedLineIndex(null);
    setCustomer({ name: '', phone: '', doctorName: '', notes: '' });
    setShowClearConfirm(false);
    setToastMessage('Cart has been cleared.');
    searchInputRef.current?.focus();
  };

  // Parking Cart in Memory
  const handleHoldCart = (note: string) => {
    if (cartLines.length === 0) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const held: HeldCart = {
      id: `held-${Date.now()}`,
      heldAt: timeStr,
      cartLines,
      customer,
      totalPaisa: invoiceTotals.grandTotalPaisa,
      note,
    };
    setHeldCarts((prev) => [held, ...prev]);
    setCartLines([]);
    setSelectedLineIndex(null);
    setCustomer({ name: '', phone: '', doctorName: '', notes: '' });
    setToastMessage(`✓ Cart parked (${held.cartLines.length} items). Ready for next customer.`);
    searchInputRef.current?.focus();
  };

  const handleRecallCart = (held: HeldCart) => {
    // If active cart already has lines, park active cart first
    if (cartLines.length > 0) {
      handleHoldCart('Auto-parked on cart recall');
    }
    setCartLines(held.cartLines);
    setCustomer(held.customer);
    setHeldCarts((prev) => prev.filter((h) => h.id !== held.id));
    setToastMessage(`✓ Recalled transaction for ${held.customer.name || 'Walk-in Customer'}`);
    searchInputRef.current?.focus();
  };

  const handleDeleteHeldCart = (id: string) => {
    setHeldCarts((prev) => prev.filter((h) => h.id !== id));
    setToastMessage('Parked cart removed.');
  };

  // Finalize Sale via Transaction Service (FEFO, payments, outbox, fiscal, stock movements)
  const handleCompleteSale = async (details: PaymentDetails) => {
    // 1. Prepare lines for finalizeSale: { productId, quantity, discountPaisa }
    const lines = cartLines.map((line) => {
      let discountPaisa = 0;
      const grossPaisa = line.unitPricePaisa * line.quantity;
      if (line.discountType === 'percent') {
        discountPaisa = roundHalfUp(grossPaisa * (line.discountBp || 0), 10000);
      } else if (line.discountType === 'flat') {
        discountPaisa = line.flatDiscountPaisa || 0;
      }
      return {
        productId: line.product.id,
        quantity: line.quantity,
        discountPaisa,
      };
    });

    const clientRequestId = generateUuidV7();
    const customerNotes = [
      customer.name ? `Customer: ${customer.name}` : '',
      customer.phone ? `Phone: ${customer.phone}` : '',
      customer.doctorName ? `Doctor: ${customer.doctorName}` : '',
      customer.notes ? `Note: ${customer.notes}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    const finalizeInput: FinalizeSaleInput = {
      clientRequestId,
      counterId: session.counter.id,
      cashierUserId: session.user.id,
      lines,
      payments: details.payments,
      notes: customerNotes || null,
    };

    // 2. Finalize sale in SQLite via transaction service
    const saved = await window.api.sales.finalizeSale(finalizeInput);

    // 3. Clear cart and close modal immediately
    setShowPaymentModal(false);
    setCartLines([]);
    setSelectedLineIndex(null);
    setCustomer({ name: '', phone: '', doctorName: '', notes: '' });

    // 4. Print thermal receipt via Windows print path
    const receiptHtml = generateThermalReceiptHtml(
      {
        id: saved.id,
        invoiceNumber: saved.invoiceNumber,
        createdAt: saved.createdAt,
        subtotalPaisa: saved.subtotalPaisa,
        discountPaisa: saved.discountPaisa,
        taxPaisa: saved.taxPaisa,
        totalPaisa: saved.totalPaisa,
        notes: saved.notes,
        customerName: customer.name || null,
        customerPhone: customer.phone || null,
        doctorName: customer.doctorName || null,
        cashierName: session.user.name,
        counterName: session.counter.name,
        branchName: session.branch.name,
        lines: saved.lines.map((l) => ({
          id: l.id,
          brandName: l.brandName,
          genericName: l.genericName,
          batchNo: l.batchNo,
          expiryDate: l.expiryDate,
          quantity: l.quantity,
          unitPricePaisa: l.unitPricePaisa,
          discountPaisa: l.discountPaisa,
          taxPaisa: l.taxPaisa,
          lineTotalPaisa: l.lineTotalPaisa,
        })),
        payments: saved.payments.map((p) => ({
          method: p.method,
          amountPaisa: p.amountPaisa,
          tenderedPaisa: p.method === 'cash' ? details.tenderedPaisa : undefined,
          changePaisa: p.method === 'cash' ? details.changePaisa : undefined,
        })),
      },
      { showBatchExpiry: true }
    );

    let printResult: { success: boolean; error?: string } = { success: true };
    try {
      printResult = await window.api.invoices.printReceipt(receiptHtml);
    } catch (printErr: unknown) {
      printResult = {
        success: false,
        error: printErr instanceof Error ? printErr.message : String(printErr),
      };
    }

    if (printResult.success) {
      setToastMessage(
        `✅ Invoice #${saved.invoiceNumber} finalized & printed (${formatPKR(saved.totalPaisa)})!`
      );
    } else {
      setToastMessage(
        `⚠️ Invoice #${saved.invoiceNumber} saved! Printer offline (${printResult.error || 'Failed'}). Reprint anytime from Invoices tab.`
      );
    }

    searchInputRef.current?.focus();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 120px)', // Fit 1366x768 comfortably without vertical clipping
        minHeight: '620px',
        backgroundColor: '#f8fafc',
        position: 'relative',
      }}
    >
      {/* ALT Key HUD Overlay */}
      <KeyboardShortcutOverlay visible={isAltHeld} />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="toast-slide-in"
          style={{
            position: 'fixed',
            top: '84px',
            right: '28px',
            zIndex: 9999,
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'blur(10px)',
            color: '#f8fafc',
            padding: '12px 20px',
            borderRadius: '10px',
            boxShadow: 'var(--shadow-xl)',
            fontSize: '13px',
            fontWeight: 600,
            border: '1px solid #334155',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>{toastMessage}</span>
        </div>
      )}

      {/* TOP BAR: Fixed Search & Barcode Scan Input */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          borderRadius: '14px',
          padding: '12px 18px',
          marginBottom: '12px',
          boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span
              style={{
                position: 'absolute',
                left: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '17px',
                color: searchFocused ? '#4f46e5' : '#64748b',
                pointerEvents: 'none',
                transition: 'color 0.15s ease',
              }}
            >
              🔍
            </span>
            <input
              ref={searchInputRef}
              type="text"
              autoFocus
              placeholder="Scan barcode or type medicine brand / generic name (Press Enter to add, F3 to focus)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => {
                setTimeout(() => setSearchFocused(false), 200);
              }}
              onKeyDown={handleSearchKeyDown}
              style={{
                width: '100%',
                padding: '12px 100px 12px 42px',
                fontSize: '14px',
                fontWeight: 500,
                borderRadius: '10px',
                border: searchFocused ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                outline: 'none',
                boxSizing: 'border-box',
                backgroundColor: searchFocused ? '#ffffff' : '#f8fafc',
                boxShadow: searchFocused ? 'var(--shadow-primary-glow)' : 'none',
                transition: 'all 0.15s ease',
                fontFamily: 'var(--font-sans)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                right: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {isSearching ? (
                <span
                  style={{
                    fontSize: '11px',
                    color: '#6366f1',
                    fontWeight: 700,
                  }}
                >
                  Searching...
                </span>
              ) : (
                <kbd className="kbd-cap" style={{ fontSize: '10px', padding: '2px 5px' }}>
                  F3 Focus
                </kbd>
              )}
            </div>
          </div>

          {/* Quick Header Indicators & Modals */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {customer.name && (
              <div
                style={{
                  padding: '7px 12px',
                  backgroundColor: '#eef2ff',
                  border: '1px solid #c7d2fe',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#4338ca',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>👤</span>
                <span>{customer.name}</span>
              </div>
            )}

            <button
              type="button"
              className="interactive-btn"
              onClick={handleOpenCustomer}
              style={{
                padding: '8px 14px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 700,
                color: '#334155',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <span>👤</span>
              <span>Customer / Rx</span>
              <kbd className="kbd-cap" style={{ fontSize: '10px', padding: '1px 4px' }}>F6</kbd>
            </button>

            <button
              type="button"
              className="interactive-btn"
              onClick={handleOpenHold}
              style={{
                padding: '8px 14px',
                backgroundColor: heldCarts.length > 0 ? '#fffbeb' : '#ffffff',
                border: `1px solid ${heldCarts.length > 0 ? '#fde68a' : '#cbd5e1'}`,
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 700,
                color: heldCarts.length > 0 ? '#b45309' : '#334155',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <span>🛒</span>
              <span>Parked ({heldCarts.length})</span>
              <kbd className="kbd-cap" style={{ fontSize: '10px', padding: '1px 4px' }}>F4</kbd>
            </button>
          </div>
        </div>

        {/* Live Search Results Dropdown */}
        {searchFocused && searchResults.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: '18px',
              right: '18px',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #c7d2fe',
              boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.15), 0 8px 10px -6px rgba(15, 23, 42, 0.08)',
              zIndex: 50,
              maxHeight: '360px',
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                padding: '8px 16px',
                backgroundColor: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
                fontSize: '11px',
                fontWeight: 800,
                color: '#64748b',
                display: 'flex',
                justifyContent: 'space-between',
                letterSpacing: '0.04em',
              }}
            >
              <span>SELECT ITEM TO ADD TO CART:</span>
              <span>Use [↑][↓] to navigate, [Enter] to add instantly</span>
            </div>
            {searchResults.map((item, idx) => {
              const isSelected = idx === searchSelectedIndex;
              const hasStock = item.totalStock > 0;
              const isLowStock = hasStock && item.totalStock <= 10;
              return (
                <div
                  key={item.id}
                  onClick={() => addProductToCart(item)}
                  onMouseEnter={() => setSearchSelectedIndex(idx)}
                  style={{
                    padding: '11px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid #f1f5f9',
                    backgroundColor: isSelected ? '#eef2ff' : '#ffffff',
                    borderLeft: isSelected ? '4px solid #4f46e5' : '4px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 0.1s ease',
                  }}
                >
                  <div style={{ flex: 1, marginRight: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong style={{ fontSize: '14px', color: '#0f172a', fontWeight: 700 }}>
                        {item.brandName}
                      </strong>
                      <span
                        style={{
                          fontSize: '11px',
                          color: '#475569',
                          backgroundColor: '#f1f5f9',
                          padding: '2px 7px',
                          borderRadius: '6px',
                          fontWeight: 500,
                        }}
                      >
                        {item.genericName} • {item.strength} ({item.form})
                      </span>
                      {item.isControlled && (
                        <span
                          style={{
                            fontSize: '10px',
                            color: '#be123c',
                            backgroundColor: '#ffe4e6',
                            border: '1px solid #fecdd3',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 800,
                            letterSpacing: '0.05em',
                          }}
                        >
                          Rx CONTROLLED
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px', display: 'flex', gap: '12px' }}>
                      <span>Mfr: <strong>{item.manufacturer}</strong></span>
                      {item.barcode && <span className="tabular-nums">Barcode: {item.barcode}</span>}
                      {item.earliestBatch && (
                        <span className="tabular-nums" style={{ color: '#0284c7', fontWeight: 600 }}>
                          Batch: {item.earliestBatch.batchNo} (Exp: {item.earliestBatch.expiryDate})
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div className="tabular-nums" style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>
                        {formatPKR(item.mrpPaisa)}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: !hasStock ? '#e11d48' : isLowStock ? '#d97706' : '#059669',
                          backgroundColor: !hasStock ? '#fff1f2' : isLowStock ? '#fffbeb' : '#ecfdf5',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          display: 'inline-block',
                          marginTop: '2px',
                        }}
                      >
                        {hasStock ? `${item.totalStock} in stock` : '0 in stock'}
                      </div>
                    </div>

                    {!hasStock && (
                      <button
                        type="button"
                        className="interactive-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSubstituteTargetProduct(item);
                        }}
                        style={{
                          padding: '5px 12px',
                          backgroundColor: '#fffbeb',
                          border: '1px solid #fde68a',
                          color: '#b45309',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        🔄 Substitutes
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MIDDLE SECTION: Cart Table */}
      <div
        style={{
          flex: 1,
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
        }}
      >
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontSize: '13px',
              fontFamily: 'var(--font-sans)',
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: '#f8fafc',
                  borderBottom: '2px solid #e2e8f0',
                  color: '#475569',
                  position: 'sticky',
                  top: 0,
                  zIndex: 10,
                  fontSize: '11px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                <th style={{ padding: '12px 14px', width: '36px' }}>#</th>
                <th style={{ padding: '12px 14px' }}>Product & Active Formula</th>
                <th style={{ padding: '12px 14px', width: '180px' }}>Batch & Expiry</th>
                <th style={{ padding: '12px 14px', width: '220px' }}>Warnings & Stock</th>
                <th style={{ padding: '12px 14px', width: '110px', textAlign: 'right' }}>MRP</th>
                <th style={{ padding: '12px 14px', width: '120px', textAlign: 'center' }}>Qty</th>
                <th style={{ padding: '12px 14px', width: '140px' }}>Discount</th>
                <th style={{ padding: '12px 14px', width: '120px', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '12px 14px', width: '48px', textAlign: 'center' }}>Act</th>
              </tr>
            </thead>
            <tbody>
              {cartLines.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      padding: '70px 20px',
                      textAlign: 'center',
                      color: '#94a3b8',
                    }}
                  >
                    <div style={{ fontSize: '36px', marginBottom: '12px' }}>🛒</div>
                    <div style={{ fontWeight: 800, fontSize: '17px', color: '#334155', letterSpacing: '-0.01em' }}>
                      Cart is currently empty
                    </div>
                    <p style={{ margin: '6px 0 16px 0', fontSize: '13px', color: '#64748b' }}>
                      Scan a product barcode or press <kbd className="kbd-cap" style={{ fontSize: '11px' }}>F3</kbd> to search and add items.
                    </p>
                  </td>
                </tr>
              ) : (
                cartLines.map((line, idx) => {
                  const isSelected = idx === selectedLineIndex;
                  const computedLine = invoiceTotals.lines[idx];
                  const warning = computeLineWarning(line);

                  return (
                    <tr
                      key={line.id}
                      className={`cart-row ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedLineIndex(idx)}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        cursor: 'pointer',
                      }}
                    >
                      {/* # Number */}
                      <td style={{ padding: '12px 14px', color: '#94a3b8', fontWeight: 700, fontSize: '12px' }}>
                        {idx + 1}
                      </td>

                      {/* Product Name & Formula */}
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '14px' }}>
                            {line.product.brandName}
                          </span>
                          <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
                            ({line.product.strength} {line.product.form})
                          </span>
                          {line.product.isControlled && (
                            <span
                              style={{
                                padding: '1px 5px',
                                backgroundColor: '#ffe4e6',
                                color: '#be123c',
                                border: '1px solid #fecdd3',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 800,
                              }}
                            >
                              Rx
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                          {line.product.genericName} • Mfr: {line.product.manufacturer}
                        </div>
                      </td>

                      {/* Batch & Expiry */}
                      <td style={{ padding: '12px 14px' }}>
                        {line.batchNo ? (
                          <div>
                            <div className="tabular-nums" style={{ fontWeight: 700, color: '#1e293b', fontSize: '12px' }}>
                              Batch: {line.batchNo}
                            </div>
                            <div className="tabular-nums" style={{ fontSize: '11px', color: '#64748b' }}>
                              Exp: {line.expiryDate || 'N/A'}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '12px' }}>
                            No batch assigned
                          </span>
                        )}
                      </td>

                      {/* Warnings & Substitutes */}
                      <td style={{ padding: '12px 14px' }}>
                        {warning.type !== 'none' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                backgroundColor: warning.bgColor,
                                border: `1px solid ${warning.borderColor}`,
                                color: warning.color,
                                fontSize: '11px',
                                fontWeight: 700,
                              }}
                            >
                              <span>{warning.icon}</span>
                              <span>{warning.message}</span>
                            </div>

                            {(warning.type === 'out-of-stock' || warning.type === 'low-stock') && (
                              <button
                                type="button"
                                className="interactive-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSubstituteTargetProduct(line.product);
                                }}
                                style={{
                                  padding: '2px 8px',
                                  backgroundColor: '#ffffff',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  color: '#0284c7',
                                  alignSelf: 'flex-start',
                                }}
                              >
                                🔄 Find Substitutes
                              </button>
                            )}
                          </div>
                        ) : (
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              color: '#059669',
                              backgroundColor: '#ecfdf5',
                              border: '1px solid #a7f3d0',
                              padding: '2px 8px',
                              borderRadius: '6px',
                            }}
                          >
                            ✓ In Stock ({line.product.totalStock})
                          </span>
                        )}
                      </td>

                      {/* MRP */}
                      <td className="tabular-nums" style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#334155', fontSize: '14px' }}>
                        {formatPKR(line.unitPricePaisa)}
                      </td>

                      {/* Quantity Input */}
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            border: '1px solid #cbd5e1',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            backgroundColor: '#ffffff',
                            boxShadow: 'var(--shadow-sm)',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="interactive-btn"
                            onClick={() => updateLineQuantity(idx, line.quantity - 1)}
                            style={{
                              padding: '5px 10px',
                              background: '#f8fafc',
                              border: 'none',
                              cursor: 'pointer',
                              fontWeight: 800,
                              fontSize: '14px',
                              color: '#475569',
                            }}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={line.quantity}
                            onChange={(e) => updateLineQuantity(idx, Number(e.target.value))}
                            className="tabular-nums"
                            style={{
                              width: '42px',
                              textAlign: 'center',
                              border: 'none',
                              fontSize: '13px',
                              fontWeight: 800,
                              padding: '4px 0',
                              outline: 'none',
                            }}
                          />
                          <button
                            type="button"
                            className="interactive-btn"
                            onClick={() => updateLineQuantity(idx, line.quantity + 1)}
                            style={{
                              padding: '5px 10px',
                              background: '#f8fafc',
                              border: 'none',
                              cursor: 'pointer',
                              fontWeight: 800,
                              fontSize: '14px',
                              color: '#475569',
                            }}
                          >
                            +
                          </button>
                        </div>
                      </td>

                      {/* Line Discount */}
                      <td style={{ padding: '12px 14px' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <select
                            value={line.discountType}
                            onChange={(e) =>
                              updateLineDiscount(
                                idx,
                                e.target.value as 'none' | 'percent' | 'flat',
                                line.discountType === 'percent'
                                    ? line.discountBp / 100
                                  : line.flatDiscountPaisa / 100
                              )
                            }
                            style={{
                              padding: '4px 6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                            }}
                          >
                            <option value="none">0%</option>
                            <option value="percent">% Disc</option>
                            <option value="flat">Rs. Off</option>
                          </select>

                          {line.discountType !== 'none' && (
                            <input
                              type="number"
                              min="0"
                              placeholder={line.discountType === 'percent' ? '%' : 'Rs'}
                              value={
                                line.discountType === 'percent'
                                  ? line.discountBp / 100
                                  : line.flatDiscountPaisa / 100
                              }
                              onChange={(e) =>
                                updateLineDiscount(idx, line.discountType, Number(e.target.value))
                              }
                              className="tabular-nums"
                              style={{
                                width: '54px',
                                padding: '4px 6px',
                                fontSize: '11px',
                                fontWeight: 700,
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                outline: 'none',
                              }}
                            />
                          )}
                        </div>
                      </td>

                      {/* Line Total */}
                      <td
                        className="tabular-nums"
                        style={{
                          padding: '12px 14px',
                          textAlign: 'right',
                          fontWeight: 800,
                          fontSize: '14px',
                          color: '#0f172a',
                        }}
                      >
                        {formatPKR(computedLine?.lineTotalPaisa ?? line.unitPricePaisa * line.quantity)}
                      </td>

                      {/* Remove Line */}
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <button
                          type="button"
                          className="interactive-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCartLines((prev) => prev.filter((_, i) => i !== idx));
                          }}
                          aria-label={`Remove ${line.product.brandName}`}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#94a3b8',
                            fontSize: '15px',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = '#e11d48';
                            e.currentTarget.style.backgroundColor = '#fff1f2';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = '#94a3b8';
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* BOTTOM SECTION: Fixed Totals & Pay Command Bar */}
      <div
        style={{
          marginTop: '12px',
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          padding: '14px 22px',
          boxShadow: '0 4px 16px rgba(15, 23, 42, 0.05)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        {/* Left Side: Cart Utilities & Keyboard Reminders */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            type="button"
            className="interactive-btn"
            disabled={cartLines.length === 0}
            onClick={() => setShowClearConfirm(true)}
            style={{
              padding: '8px 16px',
              backgroundColor: cartLines.length > 0 ? '#fff1f2' : '#f8fafc',
              border: `1px solid ${cartLines.length > 0 ? '#fecdd3' : '#e2e8f0'}`,
              color: cartLines.length > 0 ? '#be123c' : '#94a3b8',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: cartLines.length > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            Clear Cart
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#64748b' }}>
            <span style={{ fontWeight: 700, marginRight: '4px' }}>Shortcuts:</span>
            <kbd className="kbd-cap">F2 Pay</kbd>
            <kbd className="kbd-cap">F3 Scan</kbd>
            <kbd className="kbd-cap">F4 Hold</kbd>
            <kbd className="kbd-cap">F6 Notes</kbd>
            <kbd className="kbd-cap">Del Line</kbd>
            <span style={{ color: '#4f46e5', fontWeight: 700, marginLeft: '6px' }}>• Hold [Alt] HUD</span>
          </div>
        </div>

        {/* Right Side: Totals & Large Pay Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
          {/* Subtotals Breakdown */}
          <div style={{ display: 'flex', gap: '22px', alignItems: 'center', fontSize: '13px' }}>
            <div>
              <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.04em' }}>Subtotal</div>
              <div className="tabular-nums" style={{ fontWeight: 700, color: '#334155', fontSize: '14px' }}>
                {formatPKR(invoiceTotals.netTotalPaisa)}
              </div>
            </div>

            {invoiceTotals.totalDiscountPaisa > 0 && (
              <div>
                <div style={{ fontSize: '10px', color: '#059669', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.04em' }}>Discount</div>
                <div className="tabular-nums" style={{ fontWeight: 700, color: '#059669', fontSize: '14px' }}>
                  -{formatPKR(invoiceTotals.totalDiscountPaisa)}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.04em' }}>Tax (GST)</div>
              <div className="tabular-nums" style={{ fontWeight: 700, color: '#334155', fontSize: '14px' }}>
                {formatPKR(invoiceTotals.totalTaxPaisa)}
              </div>
            </div>

            <div style={{ borderLeft: '2px solid #e2e8f0', paddingLeft: '22px' }}>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.06em' }}>
                Grand Total
              </div>
              <div
                className="tabular-nums"
                style={{
                  fontSize: '26px',
                  fontWeight: 900,
                  color: '#0f172a',
                  letterSpacing: '-0.02em',
                }}
              >
                {formatPKR(invoiceTotals.grandTotalPaisa)}
              </div>
            </div>
          </div>

          {/* Large Hero Pay Button */}
          <button
            type="button"
            className="pay-btn-hero interactive-btn"
            disabled={cartLines.length === 0}
            onClick={handleOpenPay}
            style={{
              padding: '12px 28px',
              fontWeight: 800,
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span>Pay & Print</span>
            <kbd
              className="kbd-cap-dark"
              style={{
                fontSize: '12px',
                padding: '2px 7px',
              }}
            >
              F2
            </kbd>
          </button>
        </div>
      </div>

      {/* MODALS */}
      {showPaymentModal && (
        <PaymentModal
          grandTotalPaisa={invoiceTotals.grandTotalPaisa}
          netTotalPaisa={invoiceTotals.netTotalPaisa}
          totalDiscountPaisa={invoiceTotals.totalDiscountPaisa}
          totalTaxPaisa={invoiceTotals.totalTaxPaisa}
          itemCount={cartLines.length}
          customer={customer}
          onCompleteSale={handleCompleteSale}
          onClose={() => setShowPaymentModal(false)}
        />
      )}

      {showCustomerModal && (
        <CustomerNotesModal
          initialData={customer}
          onSave={(data) => {
            setCustomer(data);
            setShowCustomerModal(false);
            setToastMessage(`✓ Customer details attached (${data.name || 'Walk-in'})`);
            searchInputRef.current?.focus();
          }}
          onClose={() => setShowCustomerModal(false)}
        />
      )}

      {showHeldCartsModal && (
        <HeldCartsModal
          activeLines={cartLines}
          customer={customer}
          grandTotalPaisa={invoiceTotals.grandTotalPaisa}
          heldCarts={heldCarts}
          onHoldActiveCart={handleHoldCart}
          onRecallCart={handleRecallCart}
          onDeleteHeldCart={handleDeleteHeldCart}
          onClose={() => setShowHeldCartsModal(false)}
        />
      )}

      {substituteTargetProduct && (
        <SubstitutesModal
          product={substituteTargetProduct}
          onSelectSubstitute={(sub) => {
            setSubstituteTargetProduct(null);
            addProductToCart(sub);
            setToastMessage(`✓ Added substitute ${sub.brandName} to cart.`);
          }}
          onClose={() => setSubstituteTargetProduct(null)}
        />
      )}

      {/* Clear Cart Confirmation Dialog */}
      {showClearConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '10px',
              padding: '24px',
              width: '400px',
              border: '1px solid #cbd5e1',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
          >
            <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              Clear Active Cart?
            </h4>
            <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
              Are you sure you want to remove all {cartLines.length} item(s) from this transaction? This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Keep Cart
              </button>
              <button
                type="button"
                onClick={clearCart}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Yes, Clear Cart
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
