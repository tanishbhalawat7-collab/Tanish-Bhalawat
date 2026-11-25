import { Bell, CheckCircle2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AppSettings } from '../types';

export function SettingsPage({
  onSettingsUpdated,
}: {
  onSettingsUpdated: (settings: AppSettings) => void;
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notifPerm, setNotifPerm] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load settings.'));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setError(null);
    setSavedNotice(null);
    setSaving(true);
    try {
      const updated = await api.updateSettings(settings);
      setSettings(updated);
      onSettingsUpdated(updated);
      setSavedNotice('Settings saved and applied across Fresh Vibe.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const requestBrowserNotifications = async () => {
    if (typeof Notification === 'undefined') {
      setNotifPerm('unsupported');
      return;
    }
    const result = await Notification.requestPermission();
    setNotifPerm(result);
    if (result === 'granted' && settings) {
      setSettings({ ...settings, browserNotifications: true });
      new Notification('Fresh Vibe Alerts Enabled', {
        body: 'You will receive browser alerts for expiring and expired products.',
      });
    }
  };

  if (!settings) {
    return (
      <div className="h-64 rounded-xl border border-[#E5EAE7] bg-white animate-pulse" />
    );
  }

  return (
    <form onSubmit={handleSave} className="max-w-3xl space-y-6">
      {error && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-xs text-[#991B1B]">
          {error}
        </div>
      )}
      {savedNotice && (
        <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] p-4 text-xs text-[#065F46] flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-[#059669]" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* Expiry Thresholds */}
      <section className="rounded-xl border border-[#E5EAE7] bg-white p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[#111827]">Expiry Classification Thresholds</h2>
          <p className="text-xs text-[#6B7280]">
            Configure how Fresh Vibe classifies Fresh vs Expiring Soon products
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1.5">
              Expiring Soon Window (Days Remaining)
            </label>
            <input
              type="number"
              min={1}
              max={180}
              value={settings.expiringSoonDays}
              onChange={(e) => {
                const val = Number(e.target.value) || 30;
                setSettings({
                  ...settings,
                  expiringSoonDays: val,
                  freshMinDays: val + 1,
                });
              }}
              className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono tabular-nums focus:border-[#059669] focus:outline-none"
            />
            <p className="text-[11px] text-[#6B7280] mt-1">
              Default: 30 days (Fresh = more than {settings.expiringSoonDays} days remaining)
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1.5">
              Auto-Save Confidence Threshold ({Math.round(settings.autoSaveConfidence * 100)}%)
            </label>
            <input
              type="range"
              min={0.4}
              max={0.95}
              step={0.05}
              value={settings.autoSaveConfidence}
              onChange={(e) =>
                setSettings({ ...settings, autoSaveConfidence: Number(e.target.value) })
              }
              className="w-full accent-[#059669]"
            />
            <p className="text-[11px] text-[#6B7280] mt-1">
              Scans below this threshold request user confirmation before saving.
            </p>
          </div>
        </div>
      </section>

      {/* Notification Preferences */}
      <section className="rounded-xl border border-[#E5EAE7] bg-white p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[#111827]">Expiry Notifications</h2>
            <p className="text-xs text-[#6B7280]">
              Choose which urgency tiers generate dashboard alerts and optional browser notifications
            </p>
          </div>
          <button
            type="button"
            onClick={requestBrowserNotifications}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#F6F9F7] self-start"
          >
            <Bell className="h-3.5 w-3.5 text-[#059669]" />
            <span>
              {notifPerm === 'granted'
                ? 'Browser Alerts Allowed'
                : notifPerm === 'denied'
                  ? 'Browser Alerts Blocked'
                  : 'Enable Browser Alerts'}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <label className="flex items-center gap-2.5 p-3 rounded-lg border border-[#E5EAE7] cursor-pointer">
            <input
              type="checkbox"
              checked={settings.notify30d}
              onChange={(e) => setSettings({ ...settings, notify30d: e.target.checked })}
              className="rounded border-[#D1D5DB] text-[#059669]"
            />
            <span className="text-xs font-medium text-[#111827]">Expiring within 30 days</span>
          </label>
          <label className="flex items-center gap-2.5 p-3 rounded-lg border border-[#E5EAE7] cursor-pointer">
            <input
              type="checkbox"
              checked={settings.notify7d}
              onChange={(e) => setSettings({ ...settings, notify7d: e.target.checked })}
              className="rounded border-[#D1D5DB] text-[#059669]"
            />
            <span className="text-xs font-medium text-[#111827]">Expiring within 7 days</span>
          </label>
          <label className="flex items-center gap-2.5 p-3 rounded-lg border border-[#E5EAE7] cursor-pointer">
            <input
              type="checkbox"
              checked={settings.notify1d}
              onChange={(e) => setSettings({ ...settings, notify1d: e.target.checked })}
              className="rounded border-[#D1D5DB] text-[#059669]"
            />
            <span className="text-xs font-medium text-[#111827]">Expiring tomorrow / today</span>
          </label>
          <label className="flex items-center gap-2.5 p-3 rounded-lg border border-[#E5EAE7] cursor-pointer">
            <input
              type="checkbox"
              checked={settings.notifyExpired}
              onChange={(e) => setSettings({ ...settings, notifyExpired: e.target.checked })}
              className="rounded border-[#D1D5DB] text-[#059669]"
            />
            <span className="text-xs font-medium text-[#111827]">Expired products</span>
          </label>
        </div>
      </section>

      {/* Cloud Camera Config */}
      <section className="rounded-xl border border-[#E5EAE7] bg-white p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[#111827]">ESP32-CAM Cloud API Configuration</h2>
          <p className="text-xs text-[#6B7280]">
            Direct Power Bank mode: ESP32-CAM authenticates directly to the Cloud API using this Device Key (no Python or local bridge required).
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1">
              Cloud Device Key (X-Device-Key)
            </label>
            <input
              type="text"
              value={settings.cloudDeviceKey}
              onChange={(e) => setSettings({ ...settings, cloudDeviceKey: e.target.value })}
              className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-xs font-mono focus:border-[#059669] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1">
              Max Capture Retries
            </label>
            <input
              type="number"
              min={1}
              max={5}
              value={settings.maxReconnectRetries}
              onChange={(e) =>
                setSettings({ ...settings, maxReconnectRetries: Number(e.target.value) || 3 })
              }
              className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none"
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-[#059669] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#047857] disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          <span>{saving ? 'Saving...' : 'Save Settings'}</span>
        </button>
      </div>
    </form>
  );
}
