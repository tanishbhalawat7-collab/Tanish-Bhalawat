import {
  AlertTriangle,
  ArrowRight,
  Barcode,
  Camera,
  CheckCircle2,
  Package,
  ScanLine,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type {
  ExpirySummary,
  NavSection,
  NotificationItem,
  ProductRecord,
} from '../types';
import { ExpiryStatusIndicator, ProductImageFrame } from '../components/StatusLabel';

export function DashboardPage({
  onNavigate,
  onSelectProduct,
}: {
  onNavigate: (section: NavSection) => void;
  onSelectProduct: (product: ProductRecord) => void;
}) {
  const [summary, setSummary] = useState<ExpirySummary | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sumRes, notifRes] = await Promise.all([api.getSummary(), api.getNotifications()]);
      setSummary(sumRes);
      setNotifications(notifRes.notifications.filter((n) => !n.dismissed));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard metrics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDismissNotification = async (key: string) => {
    try {
      await api.dismissNotification(key);
      setNotifications((prev) => prev.filter((n) => n.key !== key));
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-xl border border-[#E5EAE7] bg-white animate-pulse" />
          ))}
        </div>
        <div className="h-72 rounded-xl border border-[#E5EAE7] bg-white animate-pulse" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-6 text-sm text-[#991B1B] flex items-center justify-between">
        <span>{error || 'Dashboard unavailable'}</span>
        <button
          type="button"
          onClick={loadData}
          className="rounded-lg bg-white border border-[#FECACA] px-3 py-1.5 text-xs font-medium text-[#991B1B] hover:bg-[#FEE2E2]"
        >
          Retry
        </button>
      </div>
    );
  }

  const statCards = [
    {
      label: 'Total Tracked',
      value: summary.total,
      subtext: `${summary.categories.length} active categories`,
      icon: Package,
      accent: 'text-[#0D2E22]',
      onClick: () => onNavigate('inventory'),
    },
    {
      label: 'Fresh Inventory',
      value: summary.fresh,
      subtext: `More than ${summary.thresholds.expiringSoonDays} days left`,
      icon: CheckCircle2,
      accent: 'text-[#059669]',
      onClick: () => onNavigate('tracker'),
    },
    {
      label: 'Expiring Soon',
      value: summary.expiringSoon,
      subtext: `Within 1 to ${summary.thresholds.expiringSoonDays} days`,
      icon: AlertTriangle,
      accent: 'text-[#D97706]',
      onClick: () => onNavigate('tracker'),
    },
    {
      label: 'Expired / Unverified',
      value: summary.expired + summary.unknown,
      subtext: `${summary.expired} expired · ${summary.unknown} unknown`,
      icon: XCircle,
      accent: 'text-[#DC2626]',
      onClick: () => onNavigate('tracker'),
    },
  ];

  return (
    <div className="space-y-8">
      {/* KPI Summary Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={card.onClick}
              className="text-left rounded-xl border border-[#E5EAE7] bg-white p-5 hover:border-[#059669]/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669]"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-[#6B7280]">{card.label}</span>
                <Icon className={`h-4 w-4 ${card.accent}`} />
              </div>
              <div className={`text-3xl font-display font-bold tabular-nums ${card.accent}`}>
                {card.value}
              </div>
              <p className="mt-1.5 text-xs text-[#6B7280] tabular-nums">{card.subtext}</p>
            </button>
          );
        })}
      </section>

      {/* Active Expiry Notifications */}
      {notifications.length > 0 && (
        <section className="rounded-xl border border-[#E5EAE7] bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-[#111827]">
                Active Expiry Alerts ({notifications.length})
              </h2>
              <p className="text-xs text-[#6B7280]">
                Products expiring within 30 days, 7 days, tomorrow, or already expired
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('tracker')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#059669] hover:text-[#047857] whitespace-nowrap"
            >
              <span>View Expiry Tracker</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="divide-y divide-[#E5EAE7]">
            {notifications.slice(0, 5).map((item) => (
              <div
                key={item.key}
                className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0">
                  {item.severity === 'critical' ? (
                    <XCircle className="h-4 w-4 text-[#DC2626] mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-[#D97706] mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#111827] truncate">{item.title}</p>
                    <p className="text-xs text-[#6B7280] tabular-nums">
                      {item.category}
                      {item.brand ? ` · ${item.brand}` : ''} · {item.message}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDismissNotification(item.key)}
                  className="self-start sm:self-center text-xs font-medium text-[#6B7280] hover:text-[#111827] px-2.5 py-1 rounded-md border border-[#E5EAE7] hover:bg-[#F6F9F7] whitespace-nowrap"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty State or Main Operational Workspace */}
      {summary.total === 0 ? (
        <section className="rounded-xl border border-[#E5EAE7] bg-white overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-7 p-8 flex flex-col justify-between gap-6">
            <div className="space-y-3">
              <p className="text-xs font-medium text-[#059669]">Smart Pantry & Medicine Readiness</p>
              <h2 className="text-2xl font-display font-bold text-[#111827] text-balance">
                Start scanning products with ESP32-CAM, webcam, or packaging photos
              </h2>
              <p className="text-sm text-[#4B5563] max-w-xl leading-relaxed">
                Fresh Vibe automatically decodes barcodes, extracts expiry and manufacturing dates via
                OCR and AI, validates calendar dates, and alerts you before items spoil.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('scan')}
                className="inline-flex items-center gap-2 rounded-lg bg-[#059669] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#047857] transition-colors whitespace-nowrap"
              >
                <ScanLine className="h-4 w-4" />
                <span>Scan First Product</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('camera')}
                className="inline-flex items-center gap-2 rounded-lg border border-[#D1D5DB] bg-white px-4 py-2.5 text-sm font-medium text-[#111827] hover:bg-[#F6F9F7] transition-colors whitespace-nowrap"
              >
                <Camera className="h-4 w-4 text-[#059669]" />
                <span>Connect ESP32-CAM</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('barcode')}
                className="inline-flex items-center gap-2 rounded-lg border border-[#D1D5DB] bg-white px-4 py-2.5 text-sm font-medium text-[#111827] hover:bg-[#F6F9F7] transition-colors whitespace-nowrap"
              >
                <Barcode className="h-4 w-4 text-[#059669]" />
                <span>Barcode Scanner</span>
              </button>
            </div>
          </div>
          <div className="lg:col-span-5 relative min-h-[240px] bg-[#ECFDF5]">
            <img
              src="/src/assets/images/pantry_empty_state_1795624524292.jpg"
              alt="Organized pantry shelf with labeled glass jars"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Recently Scanned Products */}
          <section className="lg:col-span-8 rounded-xl border border-[#E5EAE7] bg-white p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-[#111827]">Recently Scanned Products</h2>
                <p className="text-xs text-[#6B7280]">
                  Latest items identified via ESP32-CAM, webcam, barcode, or manual entry
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#059669] hover:text-[#047857] whitespace-nowrap"
              >
                <span>All Products</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="divide-y divide-[#E5EAE7]">
              {summary.recentProducts.map((product) => (
                <div
                  key={product.id}
                  onClick={() => onSelectProduct(product)}
                  className="py-3.5 flex items-center justify-between gap-4 cursor-pointer hover:bg-[#F6F9F7] -mx-3 px-3 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <ProductImageFrame src={product.imageData} alt={product.name} className="h-11 w-11" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#111827] truncate">{product.name}</p>
                      <p className="text-xs text-[#6B7280] truncate tabular-nums">
                        {product.brand || 'Unbranded'} · {product.category}
                        {product.expiryDate ? ` · EXP ${product.expiryDate}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <ExpiryStatusIndicator
                      status={product.expiryStatus}
                      daysRemaining={product.daysRemaining}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Category Breakdown */}
          <section className="lg:col-span-4 rounded-xl border border-[#E5EAE7] bg-white p-6">
            <h2 className="text-base font-semibold text-[#111827]">Category Breakdown</h2>
            <p className="text-xs text-[#6B7280] mb-4">Freshness distribution across tracked categories</p>

            <div className="space-y-4">
              {summary.categories.map((cat) => {
                const freshPct = cat.total ? Math.round((cat.fresh / cat.total) * 100) : 0;
                const soonPct = cat.total ? Math.round((cat.expiringSoon / cat.total) * 100) : 0;
                const expPct = cat.total ? Math.round((cat.expired / cat.total) * 100) : 0;
                return (
                  <div key={cat.category} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-[#111827]">{cat.category}</span>
                      <span className="text-[#6B7280] font-mono tabular-nums">
                        {cat.total} item{cat.total === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[#F3F6F4] overflow-hidden flex">
                      {freshPct > 0 && (
                        <div className="bg-[#059669] h-full" style={{ width: `${freshPct}%` }} />
                      )}
                      {soonPct > 0 && (
                        <div className="bg-[#D97706] h-full" style={{ width: `${soonPct}%` }} />
                      )}
                      {expPct > 0 && (
                        <div className="bg-[#DC2626] h-full" style={{ width: `${expPct}%` }} />
                      )}
                    </div>
                    <div className="text-[11px] text-[#6B7280] tabular-nums">
                      {cat.fresh} fresh · {cat.expiringSoon} soon · {cat.expired} expired
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
