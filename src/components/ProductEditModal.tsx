import { X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client';
import { PRODUCT_CATEGORIES, type DatePrecision, type ProductRecord } from '../types';
import { ProductImageFrame } from './StatusLabel';

export function ProductEditModal({
  product,
  onClose,
  onSaved,
}: {
  product: ProductRecord;
  onClose: () => void;
  onSaved: (updated: ProductRecord) => void;
}) {
  const [name, setName] = useState(product.name);
  const [brand, setBrand] = useState(product.brand || '');
  const [category, setCategory] = useState(product.category);
  const [barcode, setBarcode] = useState(product.barcode || '');
  const [batchNumber, setBatchNumber] = useState(product.batchNumber || '');
  const [manufacturingDate, setManufacturingDate] = useState(product.manufacturingDate || '');
  const [expiryDate, setExpiryDate] = useState(product.expiryDate || '');
  const [datePrecision, setDatePrecision] = useState<DatePrecision>(product.datePrecision);
  const [notes, setNotes] = useState(product.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Product name is required.');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateProduct(product.id, {
        name: name.trim(),
        brand: brand.trim() || null,
        category,
        barcode: barcode.trim() || null,
        batchNumber: batchNumber.trim() || null,
        manufacturingDate: manufacturingDate.trim() || null,
        expiryDate: expiryDate.trim() || null,
        datePrecision: expiryDate.trim() ? datePrecision : 'unknown',
        notes: notes.trim() || null,
        verificationStatus: 'verified',
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update product.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D2E22]/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-product-title"
    >
      <div className="w-full max-w-2xl rounded-xl border border-[#E5EAE7] bg-white shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#E5EAE7] px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <ProductImageFrame src={product.imageData} alt={product.name} className="h-10 w-10" />
            <div className="min-w-0">
              <h2 id="edit-product-title" className="text-base font-semibold text-[#111827] truncate">
                Edit Product Record
              </h2>
              <p className="text-xs text-[#6B7280] font-mono tabular-nums truncate">
                ID {product.id.slice(0, 8)} · Confidence {Math.round(product.confidence * 100)}%
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[#6B7280] hover:bg-[#F3F6F4] hover:text-[#111827] transition-colors"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#374151] mb-1.5">
                Product Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">Brand</label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
              >
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">
                Barcode (EAN / UPC / Code)
              </label>
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">
                Batch / Lot Number
              </label>
              <input
                type="text"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">
                Manufacturing Date (YYYY-MM-DD or YYYY-MM)
              </label>
              <input
                type="text"
                placeholder="YYYY-MM-DD or YYYY-MM"
                value={manufacturingDate}
                onChange={(e) => setManufacturingDate(e.target.value)}
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">
                Expiry Date (YYYY-MM-DD or YYYY-MM)
              </label>
              <input
                type="text"
                placeholder="YYYY-MM-DD or YYYY-MM"
                value={expiryDate}
                onChange={(e) => {
                  const val = e.target.value;
                  setExpiryDate(val);
                  if (/^\d{4}-\d{2}$/.test(val.trim())) setDatePrecision('month');
                  else if (/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) setDatePrecision('day');
                }}
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">
                Expiry Date Precision
              </label>
              <select
                value={datePrecision}
                onChange={(e) => setDatePrecision(e.target.value as DatePrecision)}
                className="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
              >
                <option value="day">Exact Day (YYYY-MM-DD)</option>
                <option value="month">Month Only (YYYY-MM)</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
              />
            </div>
          </div>

          {product.ocrRawText && (
            <div className="pt-2 border-t border-[#E5EAE7]">
              <p className="text-xs font-medium text-[#4B5563] mb-1.5">Preserved OCR Text</p>
              <pre className="rounded-lg bg-[#F6F9F7] border border-[#E5EAE7] p-3 text-xs font-mono text-[#374151] whitespace-pre-wrap max-h-32 overflow-y-auto">
                {product.ocrRawText}
              </pre>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E5EAE7]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-colors whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#059669] px-4 py-2 text-sm font-medium text-white hover:bg-[#047857] disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
