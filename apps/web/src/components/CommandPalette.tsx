import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../lib/api';
import type { GlobalSearchResponse, GlobalSearchResultItem } from '@pos/shared';
import { Search, Receipt, Users, Package, Truck, X, Loader2, ArrowRight } from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (link: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, onNavigate }) => {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<GlobalSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setData(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setData(null);
      setLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiFetch<GlobalSearchResponse>(
          `/api/search?q=${encodeURIComponent(query.trim())}`
        );
        setData(res);
      } catch (err) {
        console.error('Search error', err);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  if (!isOpen) return null;

  const totalResults = data?.totalCount || 0;

  const renderSection = (title: string, icon: React.ReactNode, items: GlobalSearchResultItem[]) => {
    if (!items || items.length === 0) return null;

    return (
      <div className="mb-4">
        <div className="flex items-center gap-2 px-3 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          {icon}
          <span>{title}</span>
          <span className="text-[10px] font-medium text-slate-500">({items.length})</span>
        </div>
        <div className="space-y-1 mt-1">
          {items.map((item) => (
            <button
              key={`${item.type}-${item.id}`}
              onClick={() => {
                onNavigate(item.link);
                onClose();
              }}
              className="w-full flex items-center justify-between p-2.5 rounded-lg text-left text-xs hover:bg-blue-50/80 transition-colors group"
            >
              <div>
                <p className="font-semibold text-slate-800 group-hover:text-blue-700">
                  {item.title}
                </p>
                <p className="text-[11px] text-slate-500">{item.subtitle}</p>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-slate-900/40 backdrop-blur-sm">
      <div
        className="w-full max-w-xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="p-3.5 border-b border-slate-200 flex items-center gap-3 bg-slate-50/50">
          <Search className="w-5 h-5 text-slate-400 ml-1 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search invoices, customers, products, suppliers... (Type 2+ chars)"
            className="flex-1 bg-transparent border-none text-xs md:text-sm text-slate-800 focus:outline-none placeholder:text-slate-400"
          />
          {loading && <Loader2 className="w-4 h-4 text-blue-600 animate-spin flex-shrink-0" />}
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results Body */}
        <div className="flex-1 overflow-y-auto p-3">
          {query.trim().length >= 2 && !loading && totalResults === 0 && (
            <div className="py-12 text-center text-xs text-slate-400">
              No matching records found across your authorized modules for &quot;{query}&quot;.
            </div>
          )}

          {query.trim().length < 2 && (
            <div className="py-10 text-center text-xs text-slate-400">
              Type at least 2 characters to search invoices, customers, medicines, and vendors.
            </div>
          )}

          {data && (
            <>
              {renderSection(
                'Medicines & Products',
                <Package className="w-3.5 h-3.5 text-blue-600" />,
                data.results.products
              )}
              {renderSection(
                'Sales Invoices',
                <Receipt className="w-3.5 h-3.5 text-emerald-600" />,
                data.results.invoices
              )}
              {renderSection(
                'Customers',
                <Users className="w-3.5 h-3.5 text-purple-600" />,
                data.results.customers
              )}
              {renderSection(
                'Vendors & Suppliers',
                <Truck className="w-3.5 h-3.5 text-amber-600" />,
                data.results.suppliers
              )}
            </>
          )}
        </div>

        {/* Keyboard Footer */}
        <div className="p-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500 px-4">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded shadow-xs text-[10px] font-mono">
                Esc
              </kbd>{' '}
              to close
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded shadow-xs text-[10px] font-mono">
                Ctrl+K
              </kbd>{' '}
              quick toggle
            </span>
          </div>
          {data && (
            <span className="font-semibold text-slate-700">
              {totalResults} result{totalResults === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
