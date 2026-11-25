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

export interface CameraLogRecord {
  id: number;
  level: 'info' | 'warn' | 'error';
  event: string;
  targetUrl: string | null;
  statusCode: number | null;
  message: string;
  createdAt: string;
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
