import {
  AlertTriangle,
  BatteryCharging,
  Camera,
  Check,
  CheckCircle2,
  Cloud,
  Code2,
  Copy,
  Download,
  Flashlight,
  FlashlightOff,
  Globe,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type {
  AppSettings,
  CameraHealthStatus,
  CameraLogRecord,
  CloudReachabilityResult,
} from '../types';

export function ConnectCameraPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [cloudBaseUrl, setCloudBaseUrl] = useState(() =>
    typeof window !== 'undefined' ? window.location.origin : ''
  );
  const [cloudDeviceKey, setCloudDeviceKey] = useState('');
  const [autoReconnect, setAutoReconnect] = useState(true);

  const [health, setHealth] = useState<CameraHealthStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rotatingKey, setRotatingKey] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [togglingFlash, setTogglingFlash] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamKey, setStreamKey] = useState(0);
  const [streamError, setStreamError] = useState<string | null>(null);

  const [sketchCode, setSketchCode] = useState('');
  const [loadingSketch, setLoadingSketch] = useState(false);
  const [showSketchPreview, setShowSketchPreview] = useState(false);
  const [copiedField, setCopiedField] = useState<'url' | 'key' | 'sketch' | null>(null);

  const [lastImage, setLastImage] = useState<string | null>(null);
  const [lastCaptureMeta, setLastCaptureMeta] = useState<{
    bytes: number;
    latencyMs: number;
    capturedAt: string;
  } | null>(null);

  const [logs, setLogs] = useState<CameraLogRecord[]>([]);
  const [cloudCheck, setCloudCheck] = useState<CloudReachabilityResult | null>(null);
  const [checkingCloudUrl, setCheckingCloudUrl] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const refreshLogs = useCallback(async () => {
    try {
      const logRes = await api.getCameraLogs(20);
      setLogs(logRes.logs);
    } catch {
      // ignore transient log fetch errors
    }
  }, []);

  const refreshSketch = useCallback(async (baseUrl: string) => {
    setLoadingSketch(true);
    try {
      const code = await api.getArduinoSketch(baseUrl);
      setSketchCode(code);
    } catch {
      // ignore sketch preview fetch failure
    } finally {
      setLoadingSketch(false);
    }
  }, []);

  const runCloudUrlCheck = useCallback(async (targetUrl: string) => {
    const trimmed = targetUrl.trim();
    if (!trimmed) return;
    setCheckingCloudUrl(true);
    try {
      const result = await api.checkCloudUrl(trimmed);
      setCloudCheck(result);
    } catch {
      // ignore transient reachability check error
    } finally {
      setCheckingCloudUrl(false);
    }
  }, []);

  const loadInitial = useCallback(async () => {
    try {
      const [s, logRes, camStatus] = await Promise.all([
        api.getSettings(),
        api.getCameraLogs(20),
        api.checkCameraHealth(),
      ]);
      setSettings(s);
      setCloudDeviceKey(s.cloudDeviceKey);
      setAutoReconnect(s.autoReconnect);
      setLogs(logRes.logs);
      setHealth(camStatus);
      setFlashOn(camStatus.flashEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load camera settings.');
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (cloudBaseUrl) {
      void runCloudUrlCheck(cloudBaseUrl);
    }
  }, [runCloudUrlCheck, cloudBaseUrl]);

  useEffect(() => {
    if (cloudBaseUrl && cloudDeviceKey) {
      void refreshSketch(cloudBaseUrl);
    }
  }, [cloudBaseUrl, cloudDeviceKey, refreshSketch]);

  useEffect(() => {
    if (health?.connected) return;
    const timer = window.setInterval(() => {
      void api
        .checkCameraHealth()
        .then((status) => {
          setHealth(status);
          setFlashOn(status.flashEnabled);
          if (status.connected) {
            void refreshLogs();
          }
        })
        .catch(() => {
          // ignore background poll error
        });
    }, 6000);
    return () => window.clearInterval(timer);
  }, [health?.connected, refreshLogs]);

  const handleCopy = async (field: 'url' | 'key' | 'sketch', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1800);
    } catch {
      setError('Clipboard permission blocked. Please select and copy manually.');
    }
  };

  const handleTestConnection = async () => {
    setError(null);
    setTesting(true);
    try {
      const status = await api.checkCameraHealth();
      setHealth(status);
      setFlashOn(status.flashEnabled);
      await refreshLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cloud camera test failed.');
    } finally {
      setTesting(false);
    }
  };

  const handleSaveConfig = async (runTestAfter = false) => {
    setError(null);
    setSaveSuccess(null);
    const trimmedKey = cloudDeviceKey.trim();
    if (trimmedKey.length < 8) {
      setError('Cloud Device Key must be at least 8 characters.');
      return;
    }

    setSaving(true);
    try {
      const updated = await api.updateSettings({
        cloudDeviceKey: trimmedKey,
        autoReconnect,
      });
      setSettings(updated);
      setCloudDeviceKey(updated.cloudDeviceKey);
      setSaveSuccess('Cloud camera settings saved.');
      if (runTestAfter) {
        await handleTestConnection();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save camera settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleRotateKey = async () => {
    setError(null);
    setSaveSuccess(null);
    setRotatingKey(true);
    try {
      const res = await api.rotateDeviceKey();
      setCloudDeviceKey(res.cloudDeviceKey);
      setSaveSuccess('New Cloud Device Key generated. Flash the updated Arduino sketch to your ESP32-CAM.');
      await refreshLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate device key.');
    } finally {
      setRotatingKey(false);
    }
  };

  const handleCaptureImage = async () => {
    setError(null);
    setCapturing(true);
    try {
      const cap = await api.captureCameraFrame();
      setLastImage(cap.imageDataUrl);
      setLastCaptureMeta({
        bytes: cap.bytes,
        latencyMs: cap.latencyMs,
        capturedAt: cap.capturedAt,
      });
      await handleTestConnection();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to capture image from ESP32-CAM.');
      await refreshLogs();
    } finally {
      setCapturing(false);
    }
  };

  const handleToggleFlash = async () => {
    setError(null);
    setTogglingFlash(true);
    const nextState = !flashOn;
    try {
      const res = await api.setCameraFlash(nextState, 255);
      if (res.ok) {
        setFlashOn(res.enabled);
      } else {
        setError(res.error || 'Failed to toggle ESP32-CAM LED flash.');
      }
      await refreshLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle ESP32-CAM LED flash.');
      await refreshLogs();
    } finally {
      setTogglingFlash(false);
    }
  };

  const handleToggleStream = async () => {
    setStreamError(null);
    if (streaming) {
      setStreaming(false);
      return;
    }

    const status = await api.checkCameraHealth();
    setHealth(status);
    if (!status.connected) {
      setStreamError(
        status.error ||
          status.message ||
          'Power on your ESP32-CAM (USB Power Bank + Wi-Fi) before starting the live stream.'
      );
      return;
    }

    setStreamKey((k) => k + 1);
    setStreaming(true);
  };

  const sketchDownloadHref = `/api/camera/arduino-sketch?download=1&baseUrl=${encodeURIComponent(
    cloudBaseUrl.trim()
  )}`;

  return (
    <div className="space-y-6">
      {/* Status & Controls Banner */}
      <div className="rounded-xl border border-[#E5EAE7] bg-white p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div
            className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
              health?.connected
                ? 'bg-[#ECFDF5] text-[#059669]'
                : 'bg-[#FEF2F2] text-[#DC2626]'
            }`}
          >
            {health?.connected ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <WifiOff className="h-5 w-5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-[#111827]">
                {health === null
                  ? 'Checking ESP32-CAM Cloud Status...'
                  : health.connected
                    ? 'ESP32-CAM Connected (Cloud API)'
                    : 'ESP32-CAM Waiting for Connection'}
              </h2>
              {health?.connected && (
                <span className="inline-block h-2 w-2 rounded-full bg-[#059669]" />
              )}
            </div>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {health
                ? health.message
                : 'Direct Power Bank + Wi-Fi connection to Fresh Vibe Cloud API (no Python or laptop needed).'}
            </p>
            {health?.deviceOnline && (
              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] font-mono text-[#374151] tabular-nums">
                {health.deviceIp && (
                  <span className="inline-flex items-center gap-1">
                    <Wifi className="h-3 w-3 text-[#059669]" />
                    {health.deviceIp}
                  </span>
                )}
                {health.rssi !== null && <span>Signal: {health.rssi} dBm</span>}
                {health.streamActive && <span>Stream: {health.streamFps} FPS</span>}
                {health.lastSeenAt && (
                  <span>Last seen: {new Date(health.lastSeenAt).toLocaleTimeString()}</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#059669] px-4 py-2 text-xs font-medium text-white hover:bg-[#047857] disabled:opacity-60 whitespace-nowrap"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span>{testing ? 'Verifying JPEG...' : 'Connect & Test'}</span>
          </button>
          <button
            type="button"
            onClick={handleCaptureImage}
            disabled={capturing}
            className="inline-flex items-center gap-2 rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-xs font-medium text-[#111827] hover:bg-[#F6F9F7] disabled:opacity-60 whitespace-nowrap"
          >
            <Camera className="h-3.5 w-3.5 text-[#059669]" />
            <span>{capturing ? 'Capturing...' : 'Capture Image'}</span>
          </button>
          <button
            type="button"
            onClick={handleToggleFlash}
            disabled={togglingFlash}
            className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
              flashOn
                ? 'border-[#F59E0B] bg-[#FFFBEB] text-[#B45309]'
                : 'border-[#D1D5DB] bg-white text-[#111827] hover:bg-[#F6F9F7]'
            } disabled:opacity-60`}
          >
            {togglingFlash ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : flashOn ? (
              <Flashlight className="h-3.5 w-3.5 text-[#D97706]" />
            ) : (
              <FlashlightOff className="h-3.5 w-3.5 text-[#6B7280]" />
            )}
            <span>{flashOn ? 'Flashlight On' : 'Flashlight Off'}</span>
          </button>
          <button
            type="button"
            onClick={handleToggleStream}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium whitespace-nowrap ${
              streaming
                ? 'bg-[#DC2626] text-white hover:bg-[#B91C1C]'
                : 'bg-[#0D2E22] text-white hover:bg-[#133C2D]'
            }`}
          >
            {streaming ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{streaming ? 'Stop Stream' : 'Live Stream'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-xs text-[#991B1B] flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {saveSuccess && (
        <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] p-3.5 text-xs text-[#065F46]">
          {saveSuccess}
        </div>
      )}

      {/* Critical Cloud Proxy Blocker Warning (explains Wi-Fi connected but Cloud blocked) */}
      {cloudCheck && !cloudCheck.reachable && (
        <div className="rounded-xl border border-[#FCD34D] bg-[#FFFBEB] p-5 space-y-2.5 text-xs text-[#92400E]">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-[#D97706] shrink-0 mt-0.5" />
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-[#78350F]">
                {cloudCheck.blockedByAuthProxy
                  ? 'Why ESP32-CAM Connected to Wi-Fi but Not to Cloud (HTTP 302 Preview Lock)'
                  : 'Cloud API URL Is Not Yet Publicly Reachable by ESP32-CAM'}
              </p>
              <p>{cloudCheck.detail}</p>
              {cloudCheck.blockedByAuthProxy && (
                <ol className="list-decimal list-inside space-y-1 pt-1 text-[#78350F]">
                  <li>
                    Click <strong>Deploy</strong> (top-right in AI Studio &rarr;{' '}
                    <strong>Deploy to Cloud Run</strong>) to publish Fresh Vibe at a public{' '}
                    <code className="font-mono">https://...run.app</code> URL without login cookies.
                  </li>
                  <li>
                    Open that deployed public URL (or paste it into{' '}
                    <strong>Cloud API Base URL</strong> below) and confirm{' '}
                    <strong>Check Public URL</strong> turns green.
                  </li>
                  <li>
                    Download the updated <code className="font-mono">.ino</code> sketch, flash once
                    in Arduino IDE, then unplug from your laptop and run purely on your{' '}
                    <strong>USB Power Bank</strong>.
                  </li>
                </ol>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Direct Power Bank + Cloud API Architecture Guide */}
      {(!health || !health.connected) && (
        <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5]/60 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0D2E22]">
                <BatteryCharging className="h-4 w-4 text-[#059669]" />
                <span>Direct Power Bank Mode — Zero Python, Zero Laptop, Zero Raspberry Pi</span>
              </div>
              <p className="text-xs text-[#065F46]">
                Flash the Cloud API firmware onto your ESP32-CAM once using Arduino IDE. After that, plug the ESP32-CAM directly into any 5V USB Power Bank on Wi-Fi — Capture, Live Stream, and Flashlight work automatically over HTTPS.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <a
                href={sketchDownloadHref}
                download="fresh_vibe_esp32_cloud.ino"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#059669] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#047857] whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download .ino Firmware</span>
              </a>
              <button
                type="button"
                onClick={() => handleCopy('sketch', sketchCode)}
                disabled={!sketchCode || loadingSketch}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#059669] bg-white px-3.5 py-2 text-xs font-medium text-[#065F46] hover:bg-[#ECFDF5] whitespace-nowrap disabled:opacity-50"
              >
                {copiedField === 'sketch' ? (
                  <Check className="h-3.5 w-3.5 text-[#059669]" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedField === 'sketch' ? 'Copied Code' : 'Copy Arduino Code'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-[#065F46]">
            <div className="rounded-lg bg-white border border-[#A7F3D0] p-3.5 space-y-1">
              <p className="font-semibold text-[#0D2E22]">1. Flash Once in Arduino IDE</p>
              <p>
                Download <code className="font-mono">fresh_vibe_esp32_cloud.ino</code>, enter your Wi-Fi SSID &amp; password, select <strong>AI Thinker ESP32-CAM</strong> + <strong>PSRAM: Enabled</strong>, and upload.
              </p>
            </div>
            <div className="rounded-lg bg-white border border-[#A7F3D0] p-3.5 space-y-1">
              <p className="font-semibold text-[#0D2E22]">2. Plug Into USB Power Bank</p>
              <p>
                Disconnect from your laptop completely and power the ESP32-CAM via a 5V USB Power Bank. It connects directly to this Cloud API over HTTPS.
              </p>
            </div>
            <div className="rounded-lg bg-white border border-[#A7F3D0] p-3.5 space-y-1">
              <p className="font-semibold text-[#0D2E22]">3. Capture, Stream &amp; Flash</p>
              <p>
                Click <strong>Connect &amp; Test</strong> above once the ESP32-CAM powers up. Live Stream, Flashlight, and Scan Product work from anywhere.
              </p>
            </div>
          </div>

          {health?.error && (
            <p className="text-xs font-mono text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3 py-2">
              Status: {health.error}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Cloud API Credentials & Arduino Sketch */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-xl border border-[#E5EAE7] bg-white p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4 text-[#059669]" />
              <h3 className="text-sm font-semibold text-[#111827]">
                Cloud API Device Configuration
              </h3>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-[#374151] mb-1">
                  Cloud API Base URL (baked into ESP32-CAM sketch)
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={cloudBaseUrl}
                    onChange={(e) => setCloudBaseUrl(e.target.value)}
                    placeholder="https://your-deployed-app.run.app"
                    className="flex-1 rounded-lg border border-[#D1D5DB] px-3 py-2 text-xs font-mono focus:border-[#059669] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => runCloudUrlCheck(cloudBaseUrl)}
                    disabled={checkingCloudUrl || !cloudBaseUrl.trim()}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#D1D5DB] px-2.5 py-2 text-xs font-medium text-[#374151] hover:bg-[#F6F9F7] disabled:opacity-50 whitespace-nowrap"
                    title="Verify if ESP32-CAM can reach this URL without browser cookies"
                  >
                    {checkingCloudUrl ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#059669]" />
                    ) : (
                      <Globe className="h-3.5 w-3.5 text-[#059669]" />
                    )}
                    <span>Test URL</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy('url', cloudBaseUrl)}
                    className="rounded-lg border border-[#D1D5DB] px-2.5 py-2 text-xs text-[#374151] hover:bg-[#F6F9F7]"
                    title="Copy Cloud API URL"
                  >
                    {copiedField === 'url' ? (
                      <Check className="h-3.5 w-3.5 text-[#059669]" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                {cloudCheck && (
                  <p
                    className={`mt-1.5 text-[11px] font-medium ${
                      cloudCheck.reachable ? 'text-[#059669]' : 'text-[#B45309]'
                    }`}
                  >
                    {cloudCheck.reachable
                      ? `Publicly reachable by ESP32-CAM (HTTP ${cloudCheck.statusCode})`
                      : cloudCheck.blockedByAuthProxy
                        ? `Blocked by Preview Auth Proxy (HTTP ${cloudCheck.statusCode}) — Deploy to Cloud Run for a public URL`
                        : cloudCheck.detail}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-[#374151] mb-1">
                  Cloud Device Key (<code className="font-mono">X-Device-Key</code>)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={cloudDeviceKey}
                    onChange={(e) => setCloudDeviceKey(e.target.value)}
                    className="flex-1 rounded-lg border border-[#D1D5DB] px-3 py-2 text-xs font-mono focus:border-[#059669] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy('key', cloudDeviceKey)}
                    className="rounded-lg border border-[#D1D5DB] px-2.5 py-2 text-xs text-[#374151] hover:bg-[#F6F9F7]"
                    title="Copy Device Key"
                  >
                    {copiedField === 'key' ? (
                      <Check className="h-3.5 w-3.5 text-[#059669]" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleRotateKey}
                    disabled={rotatingKey}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#D1D5DB] px-2.5 py-2 text-xs font-medium text-[#374151] hover:bg-[#F6F9F7] disabled:opacity-50"
                    title="Generate a fresh Device Key"
                  >
                    <KeyRound className="h-3.5 w-3.5 text-[#059669]" />
                    <span>{rotatingKey ? '...' : 'Rotate'}</span>
                  </button>
                </div>
              </div>

              <div className="rounded-lg bg-[#F6F9F7] border border-[#E5EAE7] p-3 text-[11px] font-mono text-[#374151] space-y-1">
                <div>Command Poll: GET {cloudBaseUrl}/api/esp32/poll</div>
                <div>Frame Upload: POST {cloudBaseUrl}/api/esp32/frame</div>
              </div>

              <label className="flex items-center gap-2 text-xs text-[#374151] cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoReconnect}
                  onChange={(e) => setAutoReconnect(e.target.checked)}
                  className="rounded border-[#D1D5DB] text-[#059669] focus:ring-[#059669]"
                />
                <span>
                  Automatic capture retries (up to {settings?.maxReconnectRetries || 3} attempts)
                </span>
              </label>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setShowSketchPreview((s) => !s)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#059669] hover:text-[#047857]"
              >
                <Code2 className="h-3.5 w-3.5" />
                <span>{showSketchPreview ? 'Hide Arduino Sketch' : 'View Arduino Sketch'}</span>
              </button>

              <button
                type="button"
                onClick={() => handleSaveConfig(false)}
                disabled={saving}
                className="rounded-lg bg-[#0D2E22] px-4 py-2 text-xs font-medium text-white hover:bg-[#133C2D] disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>

            {showSketchPreview && sketchCode && (
              <pre className="max-h-72 overflow-auto rounded-lg bg-[#0D2E22] text-[#ECFDF5] p-3 text-[11px] font-mono leading-relaxed">
                {sketchCode}
              </pre>
            )}
          </div>

          {/* Hardware Reference Card */}
          <div className="rounded-xl border border-[#E5EAE7] bg-white overflow-hidden">
            <img
              src="/src/assets/images/esp32_cam_hardware_1795624523973.jpg"
              alt="AI Thinker ESP32-CAM OV2640 hardware reference"
              referrerPolicy="no-referrer"
              className="w-full h-40 object-cover border-b border-[#E5EAE7]"
            />
            <div className="p-5 space-y-1.5">
              <h3 className="text-sm font-semibold text-[#111827]">
                AI-Thinker ESP32-CAM (OV2640) · USB Power Bank Ready
              </h3>
              <p className="text-xs text-[#6B7280]">
                Uses GPIO 4 onboard LED for Flashlight, SVGA JPEG capture for fast expiry OCR, and cloud-triggered MJPEG streaming that pauses automatically when no viewer is open to save battery.
              </p>
            </div>
          </div>
        </div>

        {/* Right: Live Stream / Capture Viewport + Logs */}
        <div className="lg:col-span-7 space-y-6">
          <div className="rounded-xl border border-[#E5EAE7] bg-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#111827]">
                {streaming ? 'Live MJPEG Stream (Cloud API)' : 'Last Captured Frame (Cloud API)'}
              </h3>
              {lastCaptureMeta && !streaming && (
                <span className="text-xs font-mono text-[#6B7280] tabular-nums">
                  {(lastCaptureMeta.bytes / 1024).toFixed(1)} KB · {lastCaptureMeta.latencyMs}ms
                </span>
              )}
            </div>

            <div className="aspect-[4/3] w-full rounded-lg border border-[#E5EAE7] bg-[#0D2E22] overflow-hidden flex items-center justify-center">
              {streaming ? (
                <img
                  key={streamKey}
                  src={api.getCameraStreamUrl(streamKey)}
                  alt="ESP32-CAM live MJPEG stream"
                  referrerPolicy="no-referrer"
                  onError={() => {
                    setStreamError(
                      'Live stream closed or ESP32-CAM went offline. Ensure your Power Bank and Wi-Fi remain connected.'
                    );
                    setStreaming(false);
                  }}
                  className="h-full w-full object-contain"
                />
              ) : lastImage ? (
                <img
                  src={lastImage}
                  alt="Last ESP32-CAM JPEG capture"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="text-center p-6 space-y-2">
                  <Camera className="h-8 w-8 text-[#A7F3D0] mx-auto" />
                  <p className="text-xs text-white/80 max-w-md mx-auto">
                    {streamError ||
                      'Power your ESP32-CAM from a USB Power Bank with the Cloud API firmware flashed, then click "Capture Image" or "Live Stream".'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Camera Logs */}
          <div className="rounded-xl border border-[#E5EAE7] bg-white p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#111827]">Camera Connection &amp; Error Logs</h3>
              <button
                type="button"
                onClick={refreshLogs}
                className="text-xs font-medium text-[#059669] hover:text-[#047857]"
              >
                Refresh Logs
              </button>
            </div>
            {logs.length === 0 ? (
              <p className="text-xs text-[#6B7280]">No camera events logged yet.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto divide-y divide-[#E5EAE7] border border-[#E5EAE7] rounded-lg">
                {logs.map((log) => (
                  <div key={log.id} className="p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between font-mono">
                      <span
                        className={
                          log.level === 'error'
                            ? 'text-[#DC2626] font-semibold'
                            : log.level === 'warn'
                              ? 'text-[#D97706] font-semibold'
                              : 'text-[#059669] font-semibold'
                        }
                      >
                        [{log.level.toUpperCase()}] {log.event}
                      </span>
                      <span className="text-[#6B7280] tabular-nums">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-[#374151]">{log.message}</p>
                    {log.targetUrl && (
                      <p className="text-[11px] font-mono text-[#6B7280] truncate">
                        {log.targetUrl}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
