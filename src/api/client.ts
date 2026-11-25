import type {
  AppSettings,
  BarcodeLookupResult,
  CameraFlashStatus,
  CameraHealthStatus,
  CameraLogRecord,
  CloudReachabilityResult,
  DiagnosticsReport,
  ExpirySummary,
  NotificationItem,
  ProductRecord,
  ScanProcessResponse,
  ScanSource,
} from '../types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers || {}),
    },
  });

  const text = await resp.text();
  let data: unknown = null;
  let isHtml = false;
  const trimmed = text.trim();
  if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
    isHtml = true;
  } else if (trimmed) {
    try {
      data = JSON.parse(trimmed);
    } catch {
      data = null;
    }
  }

  if (isHtml || (trimmed && data === null)) {
    const error = new Error(
      `Server returned an unexpected HTML/text response (HTTP ${resp.status}) for ${url}. If the server just restarted, refresh and try again.`
    ) as Error & { status?: number };
    error.status = resp.status;
    throw error;
  }

  if (!resp.ok) {
    const errPayload = data as { error?: string; message?: string; duplicateProduct?: ProductRecord } | null;
    const error = new Error(
      errPayload?.error || errPayload?.message || `Request failed with HTTP ${resp.status}`
    ) as Error & { status?: number; payload?: unknown };
    error.status = resp.status;
    error.payload = data;
    throw error;
  }

  return data as T;
}

export const api = {
  getSummary: () => requestJson<ExpirySummary>('/api/expiry/summary'),

  getProducts: (params?: {
    q?: string;
    category?: string;
    status?: string;
    sort?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category && params?.category !== 'All') qs.set('category', params.category);
    if (params?.status && params?.status !== 'all') qs.set('status', params.status);
    if (params?.sort) qs.set('sort', params.sort);
    const queryStr = qs.toString();
    return requestJson<{ products: ProductRecord[]; total: number }>(
      `/api/products${queryStr ? `?${queryStr}` : ''}`
    );
  },

  createProduct: (payload: Record<string, unknown>) =>
    requestJson<ProductRecord>('/api/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateProduct: (id: string, payload: Record<string, unknown>) =>
    requestJson<ProductRecord>(`/api/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteProduct: (id: string) =>
    requestJson<{ ok: boolean; id: string }>(`/api/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getNotifications: () =>
    requestJson<{ notifications: NotificationItem[]; unreadCount: number }>('/api/notifications'),

  dismissNotification: (key: string) =>
    requestJson<{ ok: boolean; key: string }>('/api/notifications/dismiss', {
      method: 'POST',
      body: JSON.stringify({ key }),
    }),

  getSettings: () => requestJson<AppSettings>('/api/settings'),

  updateSettings: (payload: Partial<AppSettings>) =>
    requestJson<AppSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  checkCameraHealth: () => requestJson<CameraHealthStatus>('/api/camera/health'),

  captureCameraFrame: () =>
    requestJson<{
      ok: boolean;
      mimeType: string;
      bytes: number;
      latencyMs: number;
      capturedAt: string;
      imageDataUrl: string;
    }>('/api/camera/capture?format=json'),

  getCameraStreamUrl: (cacheBust: number): string => `/api/camera/stream?t=${cacheBust}`,

  setCameraFlash: (enabled: boolean, intensity = 255): Promise<CameraFlashStatus> =>
    requestJson<CameraFlashStatus>('/api/camera/flash', {
      method: 'POST',
      body: JSON.stringify({ enabled, intensity }),
    }),

  rotateDeviceKey: () =>
    requestJson<{ ok: boolean; cloudDeviceKey: string }>('/api/camera/device-key/rotate', {
      method: 'POST',
    }),

  getArduinoSketch: async (baseUrl: string): Promise<string> => {
    const qs = new URLSearchParams({ baseUrl });
    const resp = await fetch(`/api/camera/arduino-sketch?${qs.toString()}`);
    if (!resp.ok) {
      throw new Error(`Failed to load Arduino sketch (HTTP ${resp.status})`);
    }
    return resp.text();
  },

  getCameraLogs: (limit = 30) =>
    requestJson<{ logs: CameraLogRecord[] }>(`/api/camera/logs?limit=${limit}`),

  checkCloudUrl: (baseUrl: string) =>
    requestJson<CloudReachabilityResult>(
      `/api/camera/check-cloud-url?baseUrl=${encodeURIComponent(baseUrl)}`
    ),

  scanBarcode: (payload: {
    image?: string;
    barcode?: string;
    format?: string;
    fastMode?: boolean;
  }) =>
    requestJson<{
      ok: boolean;
      barcodeDetected: boolean;
      code: string | null;
      format: string | null;
      lookup: BarcodeLookupResult | null;
      message?: string;
    }>('/api/scan/barcode', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  processScan: (payload: {
    image?: string;
    source: ScanSource;
    barcode?: string | null;
    barcodeFormat?: string | null;
    autoSave?: boolean;
    fastMode?: boolean;
  }) =>
    requestJson<ScanProcessResponse>('/api/scan/process', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getDiagnostics: () => requestJson<DiagnosticsReport>('/api/diagnostics'),
};
