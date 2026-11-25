import { Download, Edit2, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ExpiryStatusIndicator, ProductImageFrame } from '../components/StatusLabel';
import { PRODUCT_CATEGORIES, type NavSection, type ProductRecord } from '../types';

export function ProductInventoryPage({
  onSelectProduct,
  onNavigate,
  refreshTrigger,
}: {
  onSelectProduct: (product: ProductRecord) => void;
  onNavigate: (section: NavSection) => void;
  refreshTrigger: number;
}) {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getProducts({
        q: search,
        category: categoryFilter,
        sort: 'scanned_desc',
      });
      setProducts(res.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load product inventory.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [search, categoryFilter, refreshTrigger]);

  const handleDelete = async (id: string) => {
    try {
      await api.deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const handleExportCsv = () => {
    const header = [
      'ID',
      'Name',
      'Brand',
      'Category',
      'Barcode',
      'Batch Number',
      'Manufacturing Date',
      'Expiry Date',
      'Precision',
      'Status',
      'Confidence',
      'Verification',
      'Scanned At',
    ];
    const escape = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const rows = products.map((p) =>
      [
        p.id,
        p.name,
        p.brand,
        p.category,
        p.barcode,
        p.batchNumber,
        p.manufacturingDate,
        p.expiryDate,
        p.datePrecision,
        p.expiryStatus,
        p.confidence,
        p.verificationStatus,
        p.scannedAt,
      ]
        .map(escape)
        .join(',')
    );
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fresh-vibe-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#E5EAE7] bg-white p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex flex-1 flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search inventory by name, brand, barcode, or batch..."
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
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={products.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-3.5 py-2 text-xs font-medium text-[#111827] hover:bg-[#F6F9F7] disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('add')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#059669] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#047857] whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm text-[#991B1B]">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-[#E5EAE7] bg-white overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-[#F3F6F4] animate-pulse" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm font-medium text-[#111827]">Inventory is empty</p>
            <p className="text-xs text-[#6B7280]">
              Use Scan Product or Add Product to populate your database.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#F6F9F7] border-b border-[#E5EAE7] text-xs text-[#4B5563]">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Barcode / Batch</th>
                  <th className="px-4 py-3 font-medium">MFG / Expiry</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Verification</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5EAE7]">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-[#F6F9F7]/70 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ProductImageFrame src={p.imageData} alt={p.name} className="h-10 w-10" />
                        <div className="min-w-0">
                          <p className="font-medium text-[#111827] truncate max-w-[210px]">
                            {p.name}
                          </p>
                          <p className="text-xs text-[#6B7280]">
                            {p.brand || 'Unbranded'} · {p.category}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-[#374151]">
                      <div>{p.barcode || 'No barcode'}</div>
                      <div className="text-[#6B7280]">
                        {p.batchNumber ? `Batch ${p.batchNumber}` : 'No batch'}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      <div className="text-[#111827]">EXP {p.expiryDate || '—'}</div>
                      <div className="text-[#6B7280]">MFG {p.manufacturingDate || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <ExpiryStatusIndicator
                        status={p.expiryStatus}
                        daysRemaining={p.daysRemaining}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-[#4B5563] tabular-nums">
                      <div className="capitalize">{p.verificationStatus.replace('_', ' ')}</div>
                      <div className="text-[#6B7280] font-mono">
                        {Math.round(p.confidence * 100)}% · {p.scanSource.replace('_', ' ')}
                      </div>
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
