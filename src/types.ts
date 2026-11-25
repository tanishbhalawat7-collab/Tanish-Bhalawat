export type DatePrecision = 'day' | 'month' | 'unknown';
export type ExpiryStatus = 'fresh' | 'expiring_soon' | 'expired' | 'unknown';
export type VerificationStatus = 'verified' | 'needs_review' | 'manual';
export type ScanSource = 'esp32_cam' | 'webcam' | 'upload' | 'barcode' | 'manual';

export interface DetectedDateEntry {
  raw: string;
  label: string;
  normalized: string | null;
  precision: DatePrecision;
  role: 'expiry' | 'manufacturing' | 'unknown';
  validCalendar: boolean;
  confidence: number;
}

export interface ProductRecord {
  id: string;
  barcode: string | null;
  barcodeFormat: string | null;
  name: string;
  brand: string | null;
  category: string;
  manufacturingDate: string | null;
  mfgDatePrecision: DatePrecision;
  expiryDate: string | null;
  datePrecision: DatePrecision;
  batchNumber: string | null;
  imageData: string | null;
  ocrRawText: string | null;
  detectedDates: DetectedDateEntry[];
  confidence: number;
  verificationStatus: VerificationStatus;
  scanSource: ScanSource;
  notes: string | null;
  scannedAt: string;
  updatedAt: string;
  daysRemaining: number | null;
  expiryStatus: ExpiryStatus;
}

export interface AppSettings {
  cloudDeviceKey: string;
  freshMinDays: number;
  expiringSoonDays: number;
  notify30d: boolean;
  notify7d: boolean;
  notify1d: boolean;
  notifyExpired: boolean;
  browserNotifications: boolean;
  autoSaveConfidence: number;
  autoReconnect: boolean;
  maxReconnectRetries: number;
}

export interface CameraHealthStatus {
  connected: boolean;
  mode: 'cloud_relay';
  deviceOnline: boolean;
  deviceIp: string | null;
  rssi: number | null;
  lastSeenAt: string | null;
  streamActive: boolean;
  streamFps: number;
  flashEnabled: boolean;
  flashIntensity: number;
  latencyMs: number | null;
  bytesReceived: number | null;
  attempts: number;
  checkedAt: string;
  message: string;
  error?: string;
}

export interface CameraFlashStatus {
  ok: boolean;
  enabled: boolean;
  intensity: number;
  deviceOnline: boolean;
  message?: string;
  error?: string;
}

export interface CameraLogRecord {
  id: number;
  level: 'info' | 'warn' | 'error';
  event: string;
  targetUrl: string | null;
  statusCode: number | null;
  message: string;
  createdAt: string;
}

export interface CloudReachabilityResult {
  ok: boolean;
  reachable: boolean;
  blockedByAuthProxy: boolean;
  notDeployed: boolean;
  testedUrl: string;
  statusCode: number | null;
  redirectLocation: string | null;
  detail: string;
  checkedAt: string;
}

export interface NotificationItem {
  key: string;
  productId: string;
  productName: string;
  brand: string | null;
  category: string;
  expiryDate: string;
  datePrecision: DatePrecision;
  daysRemaining: number;
  tier: 'expired' | 'tomorrow' | 'within_7d' | 'within_30d';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  dismissed: boolean;
}

export interface ExpirySummary {
  total: number;
  fresh: number;
  expiringSoon: number;
  expired: number;
  unknown: number;
  thresholds: {
    freshMinDays: number;
    expiringSoonDays: number;
  };
  categories: Array<{
    category: string;
    total: number;
    fresh: number;
    expiringSoon: number;
    expired: number;
    unknown: number;
  }>;
  recentProducts: ProductRecord[];
}

export interface BarcodeLookupResult {
  barcode: string;
  foundInDatabase: boolean;
  source: 'local_db' | 'open_food_facts' | 'open_beauty_facts' | 'none';
  name: string | null;
  brand: string | null;
  category: string | null;
  quantity: string | null;
  imageUrl: string | null;
  note: string;
}

export interface ScanProcessResponse {
  ok: boolean;
  status: 'auto_saved' | 'needs_confirmation' | 'duplicate_detected';
  scanMode?: 'fast' | 'thorough';
  scanDurationMs?: number;
  savedProduct: ProductRecord | null;
  duplicateProduct: ProductRecord | null;
  candidate: {
    barcode: string | null;
    barcodeFormat: string | null;
    name: string;
    brand: string | null;
    category: string;
    manufacturingDate: string | null;
    mfgDatePrecision: DatePrecision;
    expiryDate: string | null;
    datePrecision: DatePrecision;
    batchNumber: string | null;
    imageData: string | null;
    ocrRawText: string;
    detectedDates: DetectedDateEntry[];
    confidence: number;
    scanSource: ScanSource;
  };
  barcodeLookup: BarcodeLookupResult | null;
  uncertainReasons: string[];
  aiAvailable: boolean;
  aiError?: string;
  aiReasoningNote?: string;
  tesseractStatus: { ok: boolean; confidence: number; error?: string };
}

export interface DiagnosticsReport {
  timestamp: string;
  frontend: { ok: boolean; detail: string };
  backend: { ok: boolean; detail: string };
  database: { ok: boolean; path: string; productCount: number; error?: string };
  camera: CameraHealthStatus;
  barcode: { ok: boolean; detail: string; formats: string[] };
  ocr: { ok: boolean; detail: string };
  ai: { ok: boolean; model: string; detail: string };
}

export type NavSection =
  | 'dashboard'
  | 'scan'
  | 'tracker'
  | 'barcode'
  | 'voice'
  | 'inventory'
  | 'add'
  | 'camera'
  | 'settings'
  | 'diagnostics';

export const PRODUCT_CATEGORIES = [
  'Grocery',
  'Food',
  'Medicine',
  'Household',
  'Beverages',
  'Dairy',
  'Personal Care',
  'Other',
] as const;
