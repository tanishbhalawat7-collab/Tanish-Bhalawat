-- Fresh Vibe – Production PostgreSQL / SQLite Reference Schema

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'needs_review',
  scan_source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_expiry ON products(expiry_date);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

CREATE TABLE IF NOT EXISTS camera_logs (
  id SERIAL PRIMARY KEY,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  target_url TEXT,
  status_code INTEGER,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dismissed_notifications (
  notification_key TEXT PRIMARY KEY,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
