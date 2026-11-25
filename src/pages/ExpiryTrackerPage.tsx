import { Edit2, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ExpiryStatusIndicator, ProductImageFrame } from '../components/StatusLabel';
import {
  PRODUCT_CATEGORIES,
  type AppSettings,
  type NavSection,
  type ProductRecord,
} from '../types';

export function ExpiryTrackerPage({
  onSelectProduct,
  onNavigate,
  refreshTrigger,
}: {
  onSelectProduct: (product: ProductRecord) => void;
  onNavigate: (section: NavSection) => void;
  refreshTrigger: number;
}) {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState('expiry_asc');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [prodRes, setRes] = await Promise.all([
        api.getProducts({
          q: search,
          category: categoryFilter,
          status: statusFilter,
          sort,
        }),
        api.getSettings(),
      ]);
      setProducts(prodRes.products);
      setSettings(setRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load expiry tracker.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [search, categoryFilter, statusFilter, sort, refreshTrigger]);

  const handleDelete = async (id: string) => {
    try {
      await api.deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const statusTabs = [
    { id: 'all', label: 'All' },
    { id: 'expired', label: 'Expired' },
    { id: 'expiring_soon', label: 'Expiring Soon' },
    { id: 'fresh', label: 'Fresh' },
    { id: 'unknown', label: 'Unknown' },
  ];

  return (
    <div className="space-y-6">
      {/* Filter & Search Toolbar */}
      <div className="rounded-xl border border-[#E5EAE7] bg-white p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#F3F6F4] border border-[#E5EAE7]">
            {statusTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  statusFilter === tab.id
                    ? 'bg-white text-[#0D2E22] shadow-sm'
                    : 'text-[#4B5563] hover:text-[#111827]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {settings && (
            <p className="text-xs text-[#6B7280] tabular-nums">
              Fresh &gt; {settings.expiringSoonDays}d · Expiring Soon 1–{settings.expiringSoonDays}d
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="h-4 w-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, brand, barcode, batch..."
              className="w-full rounded-lg border border-[#D1D5DB] pl-9 pr-3 py-2 text-sm focus:border-[#059669] focus:outline-none"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none"
          >
            <option value="All">All Categories</option>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none"
          >
            <option value="expiry_asc">Sort: Soonest Expiry First</option>
            <option value="expiry_desc">Sort: Latest Expiry First</option>
            <option value="scanned_desc">Sort: Recently Scanned</option>
            <option value="name_asc">Sort: Name (A–Z)</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm text-[#991B1B]">
          {error}
        </div>
      )}

      {/* Results Table */}
      <div className="rounded-xl border border-[#E5EAE7] bg-white overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-[#F3F6F4] animate-pulse" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm font-medium text-[#111827]">
              No products match the current filter
            </p>
            <p className="text-xs text-[#6B7280]">
              Scan a product or adjust your search and category filters.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('scan')}
              className="rounded-lg bg-[#059669] px-4 py-2 text-xs font-medium text-white hover:bg-[#047857]"
            >
              Scan Product
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#F6F9F7] border-b border-[#E5EAE7] text-xs text-[#4B5563]">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Expiry Date</th>
                  <th className="px-4 py-3 font-medium">MFG Date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5EAE7]">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-[#F6F9F7]/70 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ProductImageFrame src={p.imageData} alt={p.name} className="h-9 w-9" />
                        <div className="min-w-0">
                          <p className="font-medium text-[#111827] truncate max-w-[220px]">
                            {p.name}
                          </p>
                          <p className="text-xs text-[#6B7280] truncate">
                            {p.brand || 'Unbranded'}
                            {p.batchNumber ? ` · Batch ${p.batchNumber}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#374151]">{p.category}</td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-[#111827]">
                      {p.expiryDate || '—'}
                      {p.datePrecision === 'month' && p.expiryDate && (
                        <span className="block text-[11px] font-sans text-[#6B7280]">
                          Month precision
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-[#6B7280]">
                      {p.manufacturingDate || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <ExpiryStatusIndicator
                        status={p.expiryStatus}
                        daysRemaining={p.daysRemaining}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onSelectProduct(p)}
                          className="p-1.5 rounded-md text-[#4B5563] hover:text-[#059669] hover:bg-[#ECFDF5]"
                          aria-label={`Edit ${p.name}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(p.id)}
                          className="p-1.5 rounded-md text-[#4B5563] hover:text-[#DC2626] hover:bg-[#FEF2F2]"
                          aria-label={`Delete ${p.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
