import {
  Activity,
  AudioLines,
  Barcode,
  Bell,
  Camera,
  Clock,
  LayoutDashboard,
  Menu,
  Package,
  PlusSquare,
  ScanLine,
  Settings,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from './api/client';
import { ProductEditModal } from './components/ProductEditModal';
import { AddProductPage } from './pages/AddProductPage';
import { BarcodeScannerPage } from './pages/BarcodeScannerPage';
import { ConnectCameraPage } from './pages/ConnectCameraPage';
import { DashboardPage } from './pages/DashboardPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { ExpiryTrackerPage } from './pages/ExpiryTrackerPage';
import { ProductInventoryPage } from './pages/ProductInventoryPage';
import { ScanProductPage } from './pages/ScanProductPage';
import { SettingsPage } from './pages/SettingsPage';
import { VoiceAssistantPage } from './pages/VoiceAssistantPage';
import type { NavSection, NotificationItem, ProductRecord } from './types';

interface NavItem {
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PRIMARY_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'scan', label: 'Scan Product', icon: ScanLine },
  { id: 'tracker', label: 'Expiry Tracker', icon: Clock },
  { id: 'barcode', label: 'Barcode Scanner', icon: Barcode },
  { id: 'voice', label: 'Voice Assistant', icon: AudioLines },
  { id: 'inventory', label: 'Product Inventory', icon: Package },
  { id: 'add', label: 'Add Product', icon: PlusSquare },
  { id: 'camera', label: 'Connect Camera', icon: Camera },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const SYSTEM_NAV: NavItem[] = [
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
];

export default function App() {
  const [section, setSection] = useState<NavSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  const loadNotifications = async () => {
    try {
      const res = await api.getNotifications();
      setNotifications(res.notifications.filter((n) => !n.dismissed));
    } catch {
      // ignore initial transient error
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [refreshCounter]);

  const activeNavLabel =
    [...PRIMARY_NAV, ...SYSTEM_NAV].find((n) => n.id === section)?.label || 'Dashboard';

  const handleNavigate = (next: NavSection) => {
    setSection(next);
    setMobileMenuOpen(false);
    setNotifOpen(false);
  };

  const handleProductUpdated = () => {
    setRefreshCounter((c) => c + 1);
  };

  const renderPage = () => {
    switch (section) {
      case 'dashboard':
        return (
          <DashboardPage
            key={refreshCounter}
            onNavigate={handleNavigate}
            onSelectProduct={setEditingProduct}
          />
        );
      case 'scan':
        return (
          <ScanProductPage
            onNavigate={handleNavigate}
            onProductSaved={handleProductUpdated}
          />
        );
      case 'tracker':
        return (
          <ExpiryTrackerPage
            onSelectProduct={setEditingProduct}
            onNavigate={handleNavigate}
            refreshTrigger={refreshCounter}
          />
        );
      case 'barcode':
        return (
          <BarcodeScannerPage
            onNavigate={handleNavigate}
            onProductSaved={handleProductUpdated}
          />
        );
      case 'voice':
        return <VoiceAssistantPage onNavigate={handleNavigate} />;
      case 'inventory':
        return (
          <ProductInventoryPage
            onSelectProduct={setEditingProduct}
            onNavigate={handleNavigate}
            refreshTrigger={refreshCounter}
          />
        );
      case 'add':
        return (
          <AddProductPage
            onNavigate={handleNavigate}
            onProductSaved={handleProductUpdated}
          />
        );
      case 'camera':
        return <ConnectCameraPage />;
      case 'settings':
        return <SettingsPage onSettingsUpdated={handleProductUpdated} />;
      case 'diagnostics':
        return <DiagnosticsPage onNavigate={handleNavigate} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex bg-[#F6F9F7] text-[#111827]">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Deep Forest Green Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#0D2E22] text-white flex flex-col justify-between transition-transform duration-200 lg:static lg:translate-x-0 shrink-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          {/* Brand Wordmark */}
          <div className="h-16 px-5 flex items-center justify-between border-b border-white/10">
            <button
              type="button"
              onClick={() => handleNavigate('dashboard')}
              className="text-left focus:outline-none"
            >
              <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
                Fresh Vibe
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1.5 rounded-md text-white/70 hover:text-white"
              aria-label="Close navigation menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Primary Navigation */}
          <nav className="px-3 py-5 space-y-1" aria-label="Primary Navigation">
            {PRIMARY_NAV.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#10B981]/20 text-[#ECFDF5]'
                      : 'text-white/75 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${active ? 'text-[#34D399]' : 'text-white/60'}`}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}

            <div className="pt-4 mt-4 border-t border-white/10">
              {SYSTEM_NAV.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#10B981]/20 text-[#ECFDF5]'
                        : 'text-white/75 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${active ? 'text-[#34D399]' : 'text-white/60'}`}
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>

        {/* Workspace Profile Footer */}
        <div className="p-4 border-t border-white/10 flex items-center gap-3">
          <img
            src="/src/assets/images/avatar_operator_1795624524969.jpg"
            alt="Workspace operator"
            referrerPolicy="no-referrer"
            className="h-9 w-9 rounded-full object-cover border border-white/20 shrink-0"
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-white truncate">Smart Expiry Workspace</p>
            <p className="text-[11px] text-white/60 truncate">ESP32-CAM + OCR</p>
          </div>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract */}
        <header className="h-16 bg-white border-b border-[#E5EAE7] px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg text-[#374151] hover:bg-[#F3F6F4]"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-[#6B7280] hidden sm:inline">Fresh Vibe</span>
              <span className="text-[#D1D5DB] hidden sm:inline">/</span>
              <h1 className="font-display font-semibold text-[#111827] truncate">
                {activeNavLabel}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 relative">
            <button
              type="button"
              onClick={() => setNotifOpen((o) => !o)}
              className="relative p-2 rounded-lg border border-[#E5EAE7] text-[#374151] hover:bg-[#F6F9F7] transition-colors"
              aria-label="Expiry notifications"
            >
              <Bell className="h-4 w-4" />
              {notifications.length > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-[#DC2626] text-[10px] font-mono font-semibold text-white flex items-center justify-center tabular-nums">
                  {notifications.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleNavigate('voice')}
              className="hidden sm:inline-flex items-center gap-2 rounded-lg border border-[#E5EAE7] bg-white px-3 py-2 text-xs font-medium text-[#111827] hover:bg-[#F6F9F7] transition-colors whitespace-nowrap shrink-0"
            >
              <AudioLines className="h-3.5 w-3.5 text-[#059669]" />
              <span>Voice</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate('scan')}
              className="inline-flex items-center gap-2 rounded-lg bg-[#059669] px-4 py-2 text-xs font-medium text-white hover:bg-[#047857] transition-colors whitespace-nowrap shrink-0"
            >
              <ScanLine className="h-3.5 w-3.5" />
              <span>Scan Product</span>
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-12 w-80 rounded-xl border border-[#E5EAE7] bg-white shadow-lg p-4 z-50 space-y-3">
                <div className="flex items-center justify-between border-b border-[#E5EAE7] pb-2">
                  <span className="text-xs font-semibold text-[#111827]">
                    Expiry Alerts ({notifications.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => handleNavigate('tracker')}
                    className="text-xs font-medium text-[#059669] hover:underline"
                  >
                    View all
                  </button>
                </div>
                {notifications.length === 0 ? (
                  <p className="text-xs text-[#6B7280] py-2">No active expiry alerts.</p>
                ) : (
                  <div className="max-h-64 overflow-y-auto divide-y divide-[#E5EAE7]">
                    {notifications.slice(0, 6).map((n) => (
                      <div key={n.key} className="py-2 text-xs">
                        <p className="font-medium text-[#111827]">{n.title}</p>
                        <p className="text-[#6B7280] mt-0.5">{n.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 p-4 sm:p-8 max-w-[1440px] w-full mx-auto">{renderPage()}</main>
      </div>

      {/* Global Edit Product Modal */}
      {editingProduct && (
        <ProductEditModal
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={() => {
            setEditingProduct(null);
            handleProductUpdated();
          }}
        />
      )}
    </div>
  );
}
