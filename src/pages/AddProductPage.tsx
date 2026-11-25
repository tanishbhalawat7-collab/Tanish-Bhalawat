import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client';
import {
  PRODUCT_CATEGORIES,
  type DatePrecision,
  type NavSection,
  type ProductRecord,
} from '../types';

export function AddProductPage({
  onNavigate,
  onProductSaved,
}: {
  onNavigate: (section: NavSection) => void;
  onProductSaved: (product: ProductRecord) => void;
}) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('Grocery');
  const [barcode, setBarcode] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [manufacturingDate, setManufacturingDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [datePrecision, setDatePrecision] = useState<DatePrecision>('day');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<ProductRecord | null>(null);
  const [savedProduct, setSavedProduct] = useState<ProductRecord | null>(null);

  const submitProduct = async (allowDuplicate = false) => {
    setError(null);
    setDuplicateWarning(null);
    setSavedProduct(null);
    if (!name.trim()) {
      setError('Product name is required.');
      return;
    }

    setSaving(true);
    try {
      const created = await api.createProduct({
        name: name.trim(),
        brand: brand.trim() || null,
        category,
        barcode: barcode.trim() || null,
        batchNumber: batchNumber.trim() || null,
        manufacturingDate: manufacturingDate.trim() || null,
        expiryDate: expiryDate.trim() || null,
        datePrecision: expiryDate.trim() ? datePrecision : 'unknown',
        notes: notes.trim() || null,
        verificationStatus: 'manual',
        scanSource: 'manual',
        allowDuplicate,
      });
      setSavedProduct(created);
      onProductSaved(created);
      setName('');
      setBrand('');
      setBarcode('');
      setBatchNumber('');
      setManufacturingDate('');
      setExpiryDate('');
      setNotes('');
    } catch (err) {
      const typed = err as Error & { status?: number; payload?: { duplicateProduct?: ProductRecord } };
      if (typed.status === 409 && typed.payload?.duplicateProduct) {
        setDuplicateWarning(typed.payload.duplicateProduct);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save product.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-xl border border-[#E5EAE7] bg-white p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#E5EAE7]">
          <div>
            <h2 className="text-base font-semibold text-[#111827]">Manual Product Registration</h2>
            <p className="text-xs text-[#6B7280]">
              Add products manually when packaging cannot be scanned by camera
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('scan')}
            className="text-xs font-medium text-[#059669] hover:text-[#047857] self-start sm:self-center"
          >
            Prefer Automatic Camera Scan →
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3.5 text-xs text-[#991B1B] flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {duplicateWarning && (
          <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4 space-y-2 text-xs text-[#92400E]">
            <p className="font-semibold">
              Duplicate detected: "{duplicateWarning.name}" (EXP{' '}
              {duplicateWarning.expiryDate || 'Unknown'}) already exists.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => submitProduct(true)}
                className="rounded-md bg-[#D97706] px-3 py-1.5 text-white font-medium hover:bg-[#B45309]"
              >
                Save Anyway
              </button>
              <button
                type="button"
                onClick={() => setDuplicateWarning(null)}
                className="rounded-md border border-[#D97706]/40 bg-white px-3 py-1.5 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {savedProduct && (
          <div className="rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] p-3.5 flex items-center justify-between text-xs text-[#065F46]">
            <span className="inline-flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 text-[#059669]" />
              Saved "{savedProduct.name}" to inventory.
            </span>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="font-semibold text-[#059669] hover:underline"
            >
              View Inventory →
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitProduct(false);
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#374151] mb-1.5">
                Product Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Organic Whole Milk 1L"
                required
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm focus:border-[#059669] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">Brand</label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Horizon Organic"
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm focus:border-[#059669] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none"
              >
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">Barcode</label>
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="EAN-13 / UPC-A"
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none"
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
                placeholder="e.g. LOT-492A"
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">
                Manufacturing Date (YYYY-MM-DD or YYYY-MM)
              </label>
              <input
                type="text"
                value={manufacturingDate}
                onChange={(e) => setManufacturingDate(e.target.value)}
                placeholder="2026-05-12 or 2026-05"
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">
                Expiry Date (YYYY-MM-DD or MM/YYYY)
              </label>
              <input
                type="text"
                value={expiryDate}
                onChange={(e) => {
                  const val = e.target.value;
                  setExpiryDate(val);
                  if (/^\d{4}-\d{2}$/.test(val.trim()) || /^\d{1,2}[-/]\d{4}$/.test(val.trim())) {
                    setDatePrecision('month');
                  } else if (val.trim()) {
                    setDatePrecision('day');
                  }
                }}
                placeholder="2026-12-30 or 12/2026"
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">
                Date Precision
              </label>
              <select
                value={datePrecision}
                onChange={(e) => setDatePrecision(e.target.value as DatePrecision)}
                className="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none"
              >
                <option value="day">Exact Day</option>
                <option value="month">Month Only (No Day Printed)</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1.5">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Storage location or notes"
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm focus:border-[#059669] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#059669] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#047857] disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Add Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
