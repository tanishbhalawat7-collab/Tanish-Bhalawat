import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { computeDaysRemaining } from './dateParser.ts';
import type {
  AppSettings,
  CameraLogRecord,
  DatePrecision,
  DetectedDateEntry,
  ExpiryStatus,
  NotificationItem,
  ProductRecord,
  ScanSource,
  VerificationStatus,
} from './types.ts';

const DB_PATH = process.env.DATABASE_PATH || './fresh_vibe.db';

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      barcode TEXT,
      barcode_format TEXT,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT NOT NULL,
      manufacturing_date TEXT,
      mfg_date_precision TEXT NOT NULL DEFAULT 'unknown',
      expiry_date TEXT,
      date_precision TEXT NOT NULL DEFAULT 'unknown',
      batch_number TEXT,
      image_data TEXT,
      ocr_raw_text TEXT,
      detected_dates_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0,
      verification_status TEXT NOT NULL DEFAULT 'needs_review',
      scan_source TEXT NOT NULL DEFAULT 'manual',
      notes TEXT,
      scanned_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_expiry ON products(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

    CREATE TABLE IF NOT EXISTS camera_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      event TEXT NOT NULL,
      target_url TEXT,
      status_code INTEGER,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dismissed_notifications (
      notification_key TEXT PRIMARY KEY,
      dismissed_at TEXT NOT NULL
    );
  `);

  const generatedDeviceKey =
    (process.env.ESP32_DEVICE_KEY || '').trim() ||
    `fv_${crypto.randomBytes(18).toString('base64url')}`;

  const defaultSettings: Record<string, string> = {
    cloud_device_key: generatedDeviceKey,
    fresh_min_days: '31',
    expiring_soon_days: '30',
    notify_30d: 'true',
    notify_7d: 'true',
    notify_1d: 'true',
    notify_expired: 'true',
    browser_notifications: 'false',
    auto_save_confidence: '0.75',
    auto_reconnect: 'true',
    max_reconnect_retries: '3',
  };

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)'
  );
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(defaultSettings)) {
    insertSetting.run(key, value, now);
  }

  dbInstance = db;
  return db;
}

export function checkDatabaseHealth(): { ok: boolean; path: string; productCount: number; error?: string } {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
    return { ok: true, path: DB_PATH, productCount: row.count };
  } catch (err) {
    return {
      ok: false,
      path: DB_PATH,
      productCount: 0,
      error: err instanceof Error ? err.message : 'Database check failed',
    };
  }
}

export function getSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }

  let cloudDeviceKey = (process.env.ESP32_DEVICE_KEY || '').trim() || map.cloud_device_key || '';
  if (!cloudDeviceKey) {
    cloudDeviceKey = `fv_${crypto.randomBytes(18).toString('base64url')}`;
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('cloud_device_key', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(cloudDeviceKey, new Date().toISOString());
  }

  return {
    cloudDeviceKey,
    freshMinDays: Number.parseInt(map.fresh_min_days || '31', 10) || 31,
    expiringSoonDays: Number.parseInt(map.expiring_soon_days || '30', 10) || 30,
    notify30d: map.notify_30d !== 'false',
    notify7d: map.notify_7d !== 'false',
    notify1d: map.notify_1d !== 'false',
    notifyExpired: map.notify_expired !== 'false',
    browserNotifications: map.browser_notifications === 'true',
    autoSaveConfidence: Number.parseFloat(map.auto_save_confidence || '0.75') || 0.75,
    autoReconnect: map.auto_reconnect !== 'false',
    maxReconnectRetries: Number.parseInt(map.max_reconnect_retries || '3', 10) || 3,
  };
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  const now = new Date().toISOString();

  const mapping: Array<[keyof AppSettings, string]> = [
    ['cloudDeviceKey', 'cloud_device_key'],
    ['freshMinDays', 'fresh_min_days'],
    ['expiringSoonDays', 'expiring_soon_days'],
    ['notify30d', 'notify_30d'],
    ['notify7d', 'notify_7d'],
    ['notify1d', 'notify_1d'],
    ['notifyExpired', 'notify_expired'],
    ['browserNotifications', 'browser_notifications'],
    ['autoSaveConfidence', 'auto_save_confidence'],
    ['autoReconnect', 'auto_reconnect'],
    ['maxReconnectRetries', 'max_reconnect_retries'],
  ];

  for (const [prop, dbKey] of mapping) {
    if (partial[prop] !== undefined) {
      upsert.run(dbKey, String(partial[prop]), now);
    }
  }
  return getSettings();
}

export function classifyExpiryStatus(
  daysRemaining: number | null,
  settings: AppSettings
): ExpiryStatus {
  if (daysRemaining === null) return 'unknown';
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= settings.expiringSoonDays) return 'expiring_soon';
  return 'fresh';
}

interface RawProductRow {
  id: string;
  barcode: string | null;
  barcode_format: string | null;
  name: string;
  brand: string | null;
  category: string;
  manufacturing_date: string | null;
  mfg_date_precision: string;
  expiry_date: string | null;
  date_precision: string;
  batch_number: string | null;
  image_data: string | null;
  ocr_raw_text: string | null;
  detected_dates_json: string;
  confidence: number;
  verification_status: string;
  scan_source: string;
  notes: string | null;
  scanned_at: string;
  updated_at: string;
}

function mapProductRow(row: RawProductRow, settings: AppSettings): ProductRecord {
  let detectedDates: DetectedDateEntry[] = [];
  try {
    detectedDates = JSON.parse(row.detected_dates_json || '[]');
  } catch {
    detectedDates = [];
  }
  const datePrecision = (row.date_precision || 'unknown') as DatePrecision;
  const daysRemaining = computeDaysRemaining(row.expiry_date, datePrecision);
  const expiryStatus = classifyExpiryStatus(daysRemaining, settings);

  return {
    id: row.id,
    barcode: row.barcode,
    barcodeFormat: row.barcode_format,
    name: row.name,
    brand: row.brand,
    category: row.category,
    manufacturingDate: row.manufacturing_date,
    mfgDatePrecision: (row.mfg_date_precision || 'unknown') as DatePrecision,
    expiryDate: row.expiry_date,
    datePrecision,
    batchNumber: row.batch_number,
    imageData: row.image_data,
    ocrRawText: row.ocr_raw_text,
    detectedDates,
    confidence: row.confidence,
    verificationStatus: (row.verification_status || 'needs_review') as VerificationStatus,
    scanSource: (row.scan_source || 'manual') as ScanSource,
    notes: row.notes,
    scannedAt: row.scanned_at,
    updatedAt: row.updated_at,
    daysRemaining,
    expiryStatus,
  };
}

export function listProducts(): ProductRecord[] {
  const db = getDb();
  const settings = getSettings();
  const rows = db
    .prepare('SELECT * FROM products ORDER BY scanned_at DESC')
    .all() as unknown as RawProductRow[];
  return rows.map((r) => mapProductRow(r, settings));
}

export function getProductById(id: string): ProductRecord | null {
  const db = getDb();
  const settings = getSettings();
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as
    | RawProductRow
    | undefined;
  return row ? mapProductRow(row, settings) : null;
}

export function findProductByBarcode(barcode: string): ProductRecord | null {
  if (!barcode.trim()) return null;
  const db = getDb();
  const settings = getSettings();
  const row = db
    .prepare('SELECT * FROM products WHERE barcode = ? ORDER BY scanned_at DESC LIMIT 1')
    .get(barcode.trim()) as RawProductRow | undefined;
  return row ? mapProductRow(row, settings) : null;
}

export interface ProductCreateInput {
  barcode?: string | null;
  barcodeFormat?: string | null;
  name: string;
  brand?: string | null;
  category: string;
  manufacturingDate?: string | null;
  mfgDatePrecision?: DatePrecision;
  expiryDate?: string | null;
  datePrecision?: DatePrecision;
  batchNumber?: string | null;
  imageData?: string | null;
  ocrRawText?: string | null;
  detectedDates?: DetectedDateEntry[];
  confidence?: number;
  verificationStatus?: VerificationStatus;
  scanSource?: ScanSource;
  notes?: string | null;
}

export function findDuplicateProduct(input: {
  barcode?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  name?: string;
  brand?: string | null;
}): ProductRecord | null {
  const db = getDb();
  const settings = getSettings();
  const barcode = input.barcode?.trim() || null;
  const batch = input.batchNumber?.trim() || null;
  const expiry = input.expiryDate?.trim() || null;

  if (barcode && expiry) {
    if (batch) {
      const row = db
        .prepare(
          'SELECT * FROM products WHERE barcode = ? AND batch_number = ? AND expiry_date = ? LIMIT 1'
        )
        .get(barcode, batch, expiry) as RawProductRow | undefined;
      if (row) return mapProductRow(row, settings);
    } else {
      const row = db
        .prepare(
          'SELECT * FROM products WHERE barcode = ? AND expiry_date = ? AND (batch_number IS NULL OR batch_number = "") LIMIT 1'
        )
        .get(barcode, expiry) as RawProductRow | undefined;
      if (row) return mapProductRow(row, settings);
    }
  } else if (input.name && expiry) {
    const row = db
      .prepare(
        `SELECT * FROM products
         WHERE LOWER(name) = LOWER(?)
           AND COALESCE(LOWER(brand), '') = COALESCE(LOWER(?), '')
           AND COALESCE(batch_number, '') = COALESCE(?, '')
           AND expiry_date = ?
         LIMIT 1`
      )
      .get(input.name.trim(), input.brand?.trim() || '', batch || '', expiry) as
      | RawProductRow
      | undefined;
    if (row) return mapProductRow(row, settings);
  }

  return null;
}

export function createProduct(input: ProductCreateInput): ProductRecord {
  const db = getDb();
  const settings = getSettings();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO products (
      id, barcode, barcode_format, name, brand, category,
      manufacturing_date, mfg_date_precision, expiry_date, date_precision,
      batch_number, image_data, ocr_raw_text, detected_dates_json,
      confidence, verification_status, scan_source, notes, scanned_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.barcode?.trim() || null,
    input.barcodeFormat?.trim() || null,
    input.name.trim(),
    input.brand?.trim() || null,
    input.category.trim() || 'Grocery',
    input.manufacturingDate || null,
    input.mfgDatePrecision || (input.manufacturingDate ? 'day' : 'unknown'),
    input.expiryDate || null,
    input.datePrecision || (input.expiryDate ? 'day' : 'unknown'),
    input.batchNumber?.trim() || null,
    input.imageData || null,
    input.ocrRawText || null,
    JSON.stringify(input.detectedDates || []),
    typeof input.confidence === 'number' ? input.confidence : 1.0,
    input.verificationStatus || 'verified',
    input.scanSource || 'manual',
    input.notes?.trim() || null,
    now,
    now
  );

  return getProductById(id)!;
}

export function updateProduct(
  id: string,
  input: Partial<ProductCreateInput>
): ProductRecord | null {
  const existing = getProductById(id);
  if (!existing) return null;

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE products SET
      barcode = ?,
      barcode_format = ?,
      name = ?,
      brand = ?,
      category = ?,
      manufacturing_date = ?,
      mfg_date_precision = ?,
      expiry_date = ?,
      date_precision = ?,
      batch_number = ?,
      image_data = ?,
      ocr_raw_text = ?,
      detected_dates_json = ?,
      confidence = ?,
      verification_status = ?,
      scan_source = ?,
      notes = ?,
      updated_at = ?
     WHERE id = ?`
  ).run(
    input.barcode !== undefined ? input.barcode?.trim() || null : existing.barcode,
    input.barcodeFormat !== undefined
      ? input.barcodeFormat?.trim() || null
      : existing.barcodeFormat,
    input.name !== undefined ? input.name.trim() : existing.name,
    input.brand !== undefined ? input.brand?.trim() || null : existing.brand,
    input.category !== undefined ? input.category.trim() : existing.category,
    input.manufacturingDate !== undefined
      ? input.manufacturingDate || null
      : existing.manufacturingDate,
    input.mfgDatePrecision !== undefined
      ? input.mfgDatePrecision
      : existing.mfgDatePrecision,
    input.expiryDate !== undefined ? input.expiryDate || null : existing.expiryDate,
    input.datePrecision !== undefined ? input.datePrecision : existing.datePrecision,
    input.batchNumber !== undefined ? input.batchNumber?.trim() || null : existing.batchNumber,
    input.imageData !== undefined ? input.imageData : existing.imageData,
    input.ocrRawText !== undefined ? input.ocrRawText : existing.ocrRawText,
    input.detectedDates !== undefined
      ? JSON.stringify(input.detectedDates)
      : JSON.stringify(existing.detectedDates),
    input.confidence !== undefined ? input.confidence : existing.confidence,
    input.verificationStatus !== undefined
      ? input.verificationStatus
      : existing.verificationStatus,
    input.scanSource !== undefined ? input.scanSource : existing.scanSource,
    input.notes !== undefined ? input.notes?.trim() || null : existing.notes,
    now,
    id
  );

  return getProductById(id);
}

export function deleteProduct(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

export function addCameraLog(entry: {
  level: 'info' | 'warn' | 'error';
  event: string;
  targetUrl?: string | null;
  statusCode?: number | null;
  message: string;
}): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO camera_logs (level, event, target_url, status_code, message, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    entry.level,
    entry.event,
    entry.targetUrl || null,
    entry.statusCode ?? null,
    entry.message,
    new Date().toISOString()
  );
  // Keep latest 100 logs to stay compact
  db.exec(
    'DELETE FROM camera_logs WHERE id NOT IN (SELECT id FROM camera_logs ORDER BY id DESC LIMIT 100)'
  );
}

export function getCameraLogs(limit = 30): CameraLogRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM camera_logs ORDER BY id DESC LIMIT ?')
    .all(limit) as Array<{
    id: number;
    level: 'info' | 'warn' | 'error';
    event: string;
    target_url: string | null;
    status_code: number | null;
    message: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    level: r.level,
    event: r.event,
    targetUrl: r.target_url,
    statusCode: r.status_code,
    message: r.message,
    createdAt: r.created_at,
  }));
}

export function getExpirySummary() {
  const products = listProducts();
  const settings = getSettings();

  let fresh = 0;
  let expiringSoon = 0;
  let expired = 0;
  let unknown = 0;
  const byCategory: Record<string, { total: number; fresh: number; expiringSoon: number; expired: number; unknown: number }> = {};

  for (const p of products) {
    if (p.expiryStatus === 'fresh') fresh += 1;
    else if (p.expiryStatus === 'expiring_soon') expiringSoon += 1;
    else if (p.expiryStatus === 'expired') expired += 1;
    else unknown += 1;

    if (!byCategory[p.category]) {
      byCategory[p.category] = { total: 0, fresh: 0, expiringSoon: 0, expired: 0, unknown: 0 };
    }
    byCategory[p.category].total += 1;
    if (p.expiryStatus === 'fresh') byCategory[p.category].fresh += 1;
    else if (p.expiryStatus === 'expiring_soon') byCategory[p.category].expiringSoon += 1;
    else if (p.expiryStatus === 'expired') byCategory[p.category].expired += 1;
    else byCategory[p.category].unknown += 1;
  }

  return {
    total: products.length,
    fresh,
    expiringSoon,
    expired,
    unknown,
    thresholds: {
      freshMinDays: settings.freshMinDays,
      expiringSoonDays: settings.expiringSoonDays,
    },
    categories: Object.entries(byCategory).map(([category, counts]) => ({
      category,
      ...counts,
    })),
    recentProducts: products.slice(0, 6),
  };
}

export function getNotifications(): NotificationItem[] {
  const db = getDb();
  const settings = getSettings();
  const products = listProducts();
  const dismissedRows = db
    .prepare('SELECT notification_key FROM dismissed_notifications')
    .all() as Array<{ notification_key: string }>;
  const dismissedSet = new Set(dismissedRows.map((r) => r.notification_key));

  const items: NotificationItem[] = [];
  const seenKeys = new Set<string>();

  for (const p of products) {
    if (p.daysRemaining === null || !p.expiryDate) continue;

    let tier: NotificationItem['tier'] | null = null;
    let severity: NotificationItem['severity'] = 'info';
    let title = '';
    let message = '';

    if (p.daysRemaining < 0 && settings.notifyExpired) {
      tier = 'expired';
      severity = 'critical';
      title = `${p.name} has expired`;
      message = `Expired ${Math.abs(p.daysRemaining)} day${Math.abs(p.daysRemaining) === 1 ? '' : 's'} ago (${p.expiryDate}).`;
    } else if (p.daysRemaining <= 1 && p.daysRemaining >= 0 && settings.notify1d) {
      tier = 'tomorrow';
      severity = 'critical';
      title = p.daysRemaining === 0 ? `${p.name} expires today` : `${p.name} expires tomorrow`;
      message = `Expiry date ${p.expiryDate} — immediate use recommended.`;
    } else if (p.daysRemaining <= 7 && p.daysRemaining > 1 && settings.notify7d) {
      tier = 'within_7d';
      severity = 'warning';
      title = `${p.name} expiring in ${p.daysRemaining} days`;
      message = `Expires on ${p.expiryDate}.`;
    } else if (p.daysRemaining <= 30 && p.daysRemaining > 7 && settings.notify30d) {
      tier = 'within_30d';
      severity = 'info';
      title = `${p.name} expiring in ${p.daysRemaining} days`;
      message = `Expires on ${p.expiryDate}.`;
    }

    if (!tier) continue;
    const key = `${p.id}:${tier}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    items.push({
      key,
      productId: p.id,
      productName: p.name,
      brand: p.brand,
      category: p.category,
      expiryDate: p.expiryDate,
      datePrecision: p.datePrecision,
      daysRemaining: p.daysRemaining,
      tier,
      severity,
      title,
      message,
      dismissed: dismissedSet.has(key),
    });
  }

  return items.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export function dismissNotification(key: string): void {
  const db = getDb();
  db.prepare(
    'INSERT OR REPLACE INTO dismissed_notifications (notification_key, dismissed_at) VALUES (?, ?)'
  ).run(key, new Date().toISOString());
}
