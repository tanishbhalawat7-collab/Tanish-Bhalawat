import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import {
  checkOcrAndAiDiagnostics,
  runHybridOcrAndAi,
} from './server/aiService.ts';
import {
  checkBarcodeEngineHealth,
  decodeBarcodeFromBuffer,
  lookupBarcodeDatabase,
} from './server/barcodeService.ts';
import {
  captureCameraJpeg,
  isValidJpegBuffer,
  setCameraFlash,
  verifyCameraHealth,
} from './server/cameraService.ts';
import {
  checkCloudUrlReachability,
  esp32Relay,
  generateEsp32CloudSketch,
  sanitizeSketchBaseUrl,
} from './server/esp32CloudRelay.ts';
import {
  addCameraLog,
  checkDatabaseHealth,
  createProduct,
  deleteProduct,
  dismissNotification,
  findDuplicateProduct,
  getCameraLogs,
  getDb,
  getExpirySummary,
  getNotifications,
  getProductById,
  getSettings,
  listProducts,
  updateProduct,
  updateSettings,
} from './server/db.ts';
import { parseDateString } from './server/dateParser.ts';
import { attachLiveVoiceWebSocket } from './server/liveVoiceService.ts';
import type { DatePrecision, ScanSource } from './server/types.ts';

const PORT = Number.parseInt(process.env.PORT || '3000', 10) || 3000;
const app = express();

// Initialize SQLite database at startup
getDb();

// Configure trusted CORS origins
const allowedOrigins = new Set<string>([
  'http://localhost:3000',
  'https://localhost:3000',
  'http://127.0.0.1:3000',
]);
if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
  try {
    allowedOrigins.add(new URL(process.env.APP_URL).origin);
  } catch {
    // ignore malformed APP_URL
  }
}
if (process.env.ALLOWED_ORIGINS) {
  for (const origin of process.env.ALLOWED_ORIGINS.split(',')) {
    const trimmed = origin.trim();
    if (trimmed) allowedOrigins.add(trimmed);
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      // Also allow same-host cloud run preview origins dynamically if they match APP_URL pattern
      if (origin.endsWith('.run.app') && process.env.APP_URL?.includes('.run.app')) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS policy`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Device-Key'],
  })
);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function parseImagePayload(req: express.Request): {
  buffer: Buffer | null;
  mimeType: string;
  dataUrl: string | null;
} {
  if (req.file && req.file.buffer) {
    const mime = req.file.mimetype || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
    return { buffer: req.file.buffer, mimeType: mime, dataUrl };
  }
  const rawImage = typeof req.body?.image === 'string' ? req.body.image : null;
  if (rawImage) {
    const dataUrlMatch = rawImage.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (dataUrlMatch) {
      const mime = dataUrlMatch[1];
      const buf = Buffer.from(dataUrlMatch[2], 'base64');
      return { buffer: buf, mimeType: mime, dataUrl: rawImage };
    }
    const buf = Buffer.from(rawImage, 'base64');
    return {
      buffer: buf,
      mimeType: 'image/jpeg',
      dataUrl: `data:image/jpeg;base64,${rawImage}`,
    };
  }
  return { buffer: null, mimeType: 'image/jpeg', dataUrl: null };
}

// ---------------------------------------------------------------------------
// Health & Diagnostics
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  const dbHealth = checkDatabaseHealth();
  res.status(dbHealth.ok ? 200 : 503).json({
    ok: dbHealth.ok,
    service: 'Fresh Vibe API',
    timestamp: new Date().toISOString(),
    database: dbHealth,
    geminiConfigured: Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    ),
  });
});

app.get('/api/diagnostics', async (_req, res) => {
  const dbHealth = checkDatabaseHealth();
  const barcodeHealth = checkBarcodeEngineHealth();
  const [aiOcrHealth, cameraHealth] = await Promise.all([
    checkOcrAndAiDiagnostics(),
    verifyCameraHealth(),
  ]);

  res.json({
    timestamp: new Date().toISOString(),
    frontend: {
      ok: true,
      detail: 'HTTPS SPA served and communicating with backend API',
    },
    backend: {
      ok: true,
      detail: `Express API online on port ${PORT}`,
    },
    database: dbHealth,
    camera: cameraHealth,
    barcode: {
      ok: barcodeHealth.ok,
      detail: barcodeHealth.ok
        ? `ZXing decoder active (${barcodeHealth.formats.join(', ')})`
        : 'ZXing barcode decoder initialization failed',
      formats: barcodeHealth.formats,
    },
    ocr: aiOcrHealth.tesseract,
    ai: aiOcrHealth.gemini,
  });
});

// ---------------------------------------------------------------------------
// Settings Endpoints
// ---------------------------------------------------------------------------

app.get('/api/settings', (_req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', (req, res) => {
  const body = req.body || {};

  if (body.cloudDeviceKey !== undefined) {
    const cleanKey = String(body.cloudDeviceKey).trim();
    if (cleanKey.length < 8 || cleanKey.length > 128) {
      res.status(400).json({ error: 'Cloud Device Key must be between 8 and 128 characters.' });
      return;
    }
    body.cloudDeviceKey = cleanKey;
  }

  const updated = updateSettings({
    cloudDeviceKey: body.cloudDeviceKey,
    freshMinDays:
      body.freshMinDays !== undefined ? Math.max(1, Number(body.freshMinDays)) : undefined,
    expiringSoonDays:
      body.expiringSoonDays !== undefined
        ? Math.max(1, Number(body.expiringSoonDays))
        : undefined,
    notify30d: body.notify30d !== undefined ? Boolean(body.notify30d) : undefined,
    notify7d: body.notify7d !== undefined ? Boolean(body.notify7d) : undefined,
    notify1d: body.notify1d !== undefined ? Boolean(body.notify1d) : undefined,
    notifyExpired: body.notifyExpired !== undefined ? Boolean(body.notifyExpired) : undefined,
    browserNotifications:
      body.browserNotifications !== undefined ? Boolean(body.browserNotifications) : undefined,
    autoSaveConfidence:
      body.autoSaveConfidence !== undefined
        ? Math.max(0.3, Math.min(0.99, Number(body.autoSaveConfidence)))
        : undefined,
    autoReconnect: body.autoReconnect !== undefined ? Boolean(body.autoReconnect) : undefined,
    maxReconnectRetries:
      body.maxReconnectRetries !== undefined
        ? Math.max(1, Math.min(5, Number(body.maxReconnectRetries)))
        : undefined,
  });

  res.json(updated);
});

// ---------------------------------------------------------------------------
// Direct ESP32-CAM Cloud API Endpoints (Power Bank / No-Python Relay)
// ---------------------------------------------------------------------------

function extractEsp32DeviceKey(req: express.Request): string {
  const headerKey = req.header('x-device-key');
  if (headerKey && headerKey.trim()) return headerKey.trim();
  const auth = req.header('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  if (typeof req.query.key === 'string' && req.query.key.trim()) {
    return req.query.key.trim();
  }
  return '';
}

function extractEsp32Meta(req: express.Request) {
  const ip =
    (typeof req.query.ip === 'string' ? req.query.ip : null) ||
    req.header('x-esp32-ip') ||
    req.ip ||
    null;
  const rawRssi =
    typeof req.query.rssi === 'string'
      ? Number(req.query.rssi)
      : req.header('x-esp32-rssi')
        ? Number(req.header('x-esp32-rssi'))
        : NaN;
  const rawUptime =
    typeof req.query.uptime === 'string'
      ? Number(req.query.uptime)
      : req.header('x-esp32-uptime')
        ? Number(req.header('x-esp32-uptime'))
        : NaN;

  return {
    ip,
    rssi: Number.isFinite(rawRssi) ? rawRssi : null,
    uptimeMs: Number.isFinite(rawUptime) ? rawUptime : null,
  };
}

app.get('/api/esp32/poll', async (req, res) => {
  if (!esp32Relay.verifyDeviceKey(extractEsp32DeviceKey(req))) {
    res.status(401).json({ ok: false, error: 'Invalid or missing X-Device-Key.' });
    return;
  }

  esp32Relay.recordHeartbeat(extractEsp32Meta(req));

  const rawWait = req.query.waitMs !== undefined ? Number(req.query.waitMs) : 10000;
  const waitMs = Number.isFinite(rawWait) ? Math.max(0, Math.min(15000, rawWait)) : 10000;

  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
  });

  const command = await esp32Relay.waitForCommand(waitMs);
  if (clientClosed || res.writableEnded) return;
  res.json(command);
});

app.post(
  '/api/esp32/frame',
  express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '4mb' }),
  (req, res) => {
    if (!esp32Relay.verifyDeviceKey(extractEsp32DeviceKey(req))) {
      res.status(401).json({ ok: false, error: 'Invalid or missing X-Device-Key.' });
      return;
    }

    let frameBuffer: Buffer | null = null;
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      frameBuffer = req.body;
    } else {
      const parsed = parseImagePayload(req);
      frameBuffer = parsed.buffer;
    }

    if (!frameBuffer || !isValidJpegBuffer(frameBuffer)) {
      res.status(400).json({
        ok: false,
        error: 'Request body must be a valid JPEG image (SOI 0xFF 0xD8 0xFF).',
      });
      return;
    }

    const ack = esp32Relay.pushIncomingFrame(frameBuffer, extractEsp32Meta(req));
    res.json(ack);
  }
);

// ---------------------------------------------------------------------------
// Camera Control & Live Stream Endpoints (Cloud API backed)
// ---------------------------------------------------------------------------

app.get('/api/camera/health', async (_req, res) => {
  const health = await verifyCameraHealth();
  res.status(200).json(health);
});

app.get('/api/camera/capture', async (req, res) => {
  const format = req.query.format === 'json' ? 'json' : 'jpeg';
  const result = await captureCameraJpeg();

  if (!result.ok || !result.buffer) {
    res.status(format === 'json' ? 422 : 504).json({
      ok: false,
      error: result.error || 'Failed to capture JPEG from ESP32-CAM via Cloud API.',
      targetUrl: result.targetUrl,
      attempts: result.attempts,
    });
    return;
  }

  if (format === 'json') {
    res.json({
      ok: true,
      mimeType: 'image/jpeg',
      bytes: result.buffer.length,
      latencyMs: result.latencyMs,
      capturedAt: new Date().toISOString(),
      imageDataUrl: `data:image/jpeg;base64,${result.buffer.toString('base64')}`,
    });
    return;
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(result.buffer);
});

app.get('/api/camera/stream', (req, res) => {
  const telemetry = esp32Relay.getTelemetry();
  if (!telemetry.deviceOnline) {
    res.status(422).json({
      error:
        'ESP32-CAM is currently offline on the Cloud API. Power it via USB Power Bank with Wi-Fi connected before starting the live stream.',
    });
    return;
  }

  const boundary = 'frame';
  res.status(200);
  res.setHeader('Content-Type', `multipart/x-mixed-replace; boundary=${boundary}`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  addCameraLog({
    level: 'info',
    event: 'stream_started',
    targetUrl: '/api/camera/stream',
    statusCode: 200,
    message: `Cloud API MJPEG live stream started${telemetry.deviceIp ? ` (ESP32 IP ${telemetry.deviceIp})` : ''}.`,
  });

  const unsubscribe = esp32Relay.subscribeStream((frame) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(
        `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`
      );
      res.write(frame);
      res.write('\r\n');
    } catch {
      // ignore socket write error on disconnect
    }
  });

  req.on('close', () => {
    unsubscribe();
    addCameraLog({
      level: 'info',
      event: 'stream_stopped',
      targetUrl: '/api/camera/stream',
      message: 'Live MJPEG stream viewer closed.',
    });
  });
});

app.get('/api/camera/logs', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  res.json({ logs: getCameraLogs(limit) });
});

app.post('/api/camera/flash', async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const rawIntensity = req.body?.intensity !== undefined ? Number(req.body.intensity) : 255;
  const intensity = Number.isFinite(rawIntensity)
    ? Math.max(0, Math.min(255, Math.round(rawIntensity)))
    : 255;

  const result = await setCameraFlash({ enabled, intensity });
  if (!result.ok) {
    res.status(422).json(result);
    return;
  }
  res.json(result);
});

app.post('/api/camera/device-key/rotate', (_req, res) => {
  const cloudDeviceKey = esp32Relay.regenerateDeviceKey();
  res.json({ ok: true, cloudDeviceKey });
});

app.get('/api/camera/arduino-sketch', (req, res) => {
  const settings = getSettings();
  const requestedBase = typeof req.query.baseUrl === 'string' ? req.query.baseUrl : '';
  const forwardedProto = req.header('x-forwarded-proto')?.split(',')[0]?.trim() || req.protocol;
  const host = req.get('host') || `localhost:${PORT}`;
  const inferredBase = `${forwardedProto}://${host}`;
  const appUrl =
    process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL' ? process.env.APP_URL : '';

  const cloudBaseUrl =
    sanitizeSketchBaseUrl(requestedBase) ||
    sanitizeSketchBaseUrl(inferredBase) ||
    sanitizeSketchBaseUrl(appUrl) ||
    `https://${host}`;

  const sketch = generateEsp32CloudSketch({
    cloudBaseUrl,
    deviceKey: settings.cloudDeviceKey,
  });

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (req.query.download === '1') {
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="fresh_vibe_esp32_cloud.ino"'
    );
  }
  res.send(sketch);
});

app.get('/api/camera/check-cloud-url', async (req, res) => {
  const requestedBase = typeof req.query.baseUrl === 'string' ? req.query.baseUrl.trim() : '';
  const target =
    requestedBase ||
    (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL' ? process.env.APP_URL : '');

  if (!target) {
    res.status(400).json({
      ok: false,
      reachable: false,
      blockedByAuthProxy: false,
      notDeployed: false,
      testedUrl: '',
      statusCode: null,
      redirectLocation: null,
      detail: 'Provide a Cloud API Base URL to check public reachability.',
      checkedAt: new Date().toISOString(),
    });
    return;
  }

  const result = await checkCloudUrlReachability(target);
  res.json(result);
});

// ---------------------------------------------------------------------------
// Scanning & AI/OCR Pipeline Endpoints
// ---------------------------------------------------------------------------

app.post('/api/scan/image', upload.single('image'), async (req, res) => {
  const source = (req.body?.source as ScanSource) || 'upload';
  if (source === 'esp32_cam') {
    const cap = await captureCameraJpeg();
    if (!cap.ok || !cap.buffer) {
      res.status(502).json({
        ok: false,
        error: cap.error || 'Failed to capture frame from ESP32-CAM via Cloud API.',
      });
      return;
    }
    res.json({
      ok: true,
      source: 'esp32_cam',
      mimeType: 'image/jpeg',
      bytes: cap.buffer.length,
      imageDataUrl: `data:image/jpeg;base64,${cap.buffer.toString('base64')}`,
    });
    return;
  }

  const parsed = parseImagePayload(req);
  if (!parsed.buffer || parsed.buffer.length < 100) {
    res.status(400).json({ ok: false, error: 'No valid image payload provided.' });
    return;
  }

  res.json({
    ok: true,
    source,
    mimeType: parsed.mimeType,
    bytes: parsed.buffer.length,
    imageDataUrl: parsed.dataUrl,
  });
});

app.post('/api/scan/barcode', upload.single('image'), async (req, res) => {
  const manualCode = typeof req.body?.barcode === 'string' ? req.body.barcode.trim() : '';
  const manualFormat = typeof req.body?.format === 'string' ? req.body.format.trim() : null;

  let code = manualCode || null;
  let format = manualFormat;
  let decodeError: string | undefined;

  if (!code) {
    const parsed = parseImagePayload(req);
    if (!parsed.buffer) {
      res.status(400).json({
        ok: false,
        error: 'Provide either an image containing a barcode or a barcode string.',
      });
      return;
    }
    const decoded = decodeBarcodeFromBuffer(parsed.buffer);
    code = decoded.code;
    format = decoded.format;
    decodeError = decoded.error;
  }

  if (!code) {
    res.json({
      ok: true,
      barcodeDetected: false,
      code: null,
      format: null,
      lookup: null,
      message:
        decodeError ||
        'No barcode detected in frame. You can proceed with packaging OCR & AI recognition or capture a clearer barcode angle.',
    });
    return;
  }

  const fastMode = req.body?.fastMode !== false && req.body?.fastMode !== 'false';
  const lookup = await lookupBarcodeDatabase(code, {
    timeoutMs: fastMode ? 1800 : 4000,
  });
  res.json({
    ok: true,
    barcodeDetected: true,
    code,
    format: format || 'Barcode',
    lookup,
  });
});

app.post('/api/scan/ocr', upload.single('image'), async (req, res) => {
  const parsed = parseImagePayload(req);
  if (!parsed.buffer) {
    res.status(400).json({ ok: false, error: 'Image is required for OCR extraction.' });
    return;
  }

  const ocr = await runHybridOcrAndAi({
    imageBuffer: parsed.buffer,
    mimeType: parsed.mimeType,
  });

  res.json({
    ok: true,
    ...ocr,
  });
});

app.post('/api/scan/process', upload.single('image'), async (req, res) => {
  const scanStartMs = Date.now();
  const settings = getSettings();
  const scanSource: ScanSource = (req.body?.source as ScanSource) || 'upload';
  const fastMode = req.body?.fastMode !== false && req.body?.fastMode !== 'false';
  const providedBarcode =
    typeof req.body?.barcode === 'string' && req.body.barcode.trim()
      ? req.body.barcode.trim()
      : null;
  const providedBarcodeFormat =
    typeof req.body?.barcodeFormat === 'string' && req.body.barcodeFormat.trim()
      ? req.body.barcodeFormat.trim()
      : null;
  const autoSaveRequested = req.body?.autoSave !== 'false' && req.body?.autoSave !== false;

  let imageBuffer: Buffer | null = null;
  let mimeType = 'image/jpeg';
  let imageDataUrl: string | null = null;

  if (scanSource === 'esp32_cam' && !req.file && !req.body?.image) {
    const cap = await captureCameraJpeg();
    if (!cap.ok || !cap.buffer) {
      res.status(502).json({
        ok: false,
        step: 'capture',
        error: cap.error || 'Failed to capture image from ESP32-CAM.',
      });
      return;
    }
    imageBuffer = cap.buffer;
    mimeType = 'image/jpeg';
    imageDataUrl = `data:image/jpeg;base64,${cap.buffer.toString('base64')}`;
  } else {
    const parsed = parseImagePayload(req);
    imageBuffer = parsed.buffer;
    mimeType = parsed.mimeType;
    imageDataUrl = parsed.dataUrl;
  }

  if (!imageBuffer || imageBuffer.length < 100) {
    res.status(400).json({
      ok: false,
      step: 'capture',
      error: 'No valid product image received for scanning.',
    });
    return;
  }

  // Step 3 & 4: Barcode decode + database lookup
  const decodedBarcode = providedBarcode
    ? { found: true, code: providedBarcode, format: providedBarcodeFormat || 'Barcode' }
    : decodeBarcodeFromBuffer(imageBuffer);

  const barcodeLookup = decodedBarcode.code
    ? await lookupBarcodeDatabase(decodedBarcode.code, {
        timeoutMs: fastMode ? 1800 : 4000,
      })
    : null;

  // Step 5 & 6: AI recognition + Hybrid OCR date extraction
  const ocrOutcome = await runHybridOcrAndAi({
    imageBuffer,
    mimeType,
    fastMode,
    barcodeContext: barcodeLookup
      ? {
          code: barcodeLookup.barcode,
          name: barcodeLookup.name,
          brand: barcodeLookup.brand,
          category: barcodeLookup.category,
        }
      : null,
  });

  // Merge product identity (Barcode DB takes precedence as verified identity evidence; AI fills gaps)
  const resolvedBarcode =
    decodedBarcode.code || ocrOutcome.aiResult.barcodeDigits || null;
  const resolvedName =
    barcodeLookup?.name || ocrOutcome.aiResult.productName || null;
  const resolvedBrand =
    barcodeLookup?.brand || ocrOutcome.aiResult.brand || null;
  const resolvedCategory =
    barcodeLookup?.category || ocrOutcome.aiResult.category || 'Grocery';

  // Compute overall confidence honestly
  const identityScore = barcodeLookup?.foundInDatabase
    ? 0.95
    : ocrOutcome.aiResult.available && resolvedName
      ? ocrOutcome.aiResult.productConfidence
      : 0.25;
  const dateScore = ocrOutcome.expiryDate ? ocrOutcome.ocrConfidence : 0.2;
  const overallConfidence = Number(((identityScore * 0.45) + (dateScore * 0.55)).toFixed(2));

  const uncertainReasons = [...ocrOutcome.uncertainReasons];
  if (!resolvedName) {
    uncertainReasons.push('Product name could not be reliably identified from barcode or packaging.');
  }

  const candidate = {
    barcode: resolvedBarcode,
    barcodeFormat: decodedBarcode.format,
    name: resolvedName || 'Unidentified Product',
    brand: resolvedBrand,
    category: resolvedCategory,
    manufacturingDate: ocrOutcome.manufacturingDate,
    mfgDatePrecision: ocrOutcome.mfgPrecision,
    expiryDate: ocrOutcome.expiryDate,
    datePrecision: ocrOutcome.expiryPrecision,
    batchNumber: ocrOutcome.batchNumber,
    imageData: imageDataUrl,
    ocrRawText: ocrOutcome.rawText,
    detectedDates: ocrOutcome.detectedDates,
    confidence: overallConfidence,
    scanSource,
  };

  const duplicate = findDuplicateProduct({
    barcode: candidate.barcode,
    batchNumber: candidate.batchNumber,
    expiryDate: candidate.expiryDate,
    name: candidate.name,
    brand: candidate.brand,
  });

  const canAutoSave =
    autoSaveRequested &&
    !duplicate &&
    Boolean(resolvedName) &&
    Boolean(ocrOutcome.expiryDate) &&
    !ocrOutcome.needsConfirmation &&
    overallConfidence >= settings.autoSaveConfidence;

  let savedProduct = null;
  let status: 'auto_saved' | 'needs_confirmation' | 'duplicate_detected' = 'needs_confirmation';

  if (duplicate) {
    status = 'duplicate_detected';
  } else if (canAutoSave) {
    savedProduct = createProduct({
      ...candidate,
      verificationStatus: 'verified',
    });
    status = 'auto_saved';
  }

  res.json({
    ok: true,
    status,
    scanMode: fastMode ? 'fast' : 'thorough',
    scanDurationMs: Date.now() - scanStartMs,
    savedProduct,
    duplicateProduct: duplicate,
    candidate,
    barcodeLookup,
    uncertainReasons,
    aiAvailable: ocrOutcome.aiResult.available,
    aiError: ocrOutcome.aiResult.error,
    aiReasoningNote: ocrOutcome.aiResult.reasoningNote,
    tesseractStatus: ocrOutcome.tesseractStatus,
  });
});

// ---------------------------------------------------------------------------
// Products CRUD Endpoints
// ---------------------------------------------------------------------------

app.get('/api/products', (req, res) => {
  let items = listProducts();

  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const sort = typeof req.query.sort === 'string' ? req.query.sort.trim() : 'scanned_desc';

  if (q) {
    items = items.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.batchNumber || '').toLowerCase().includes(q)
    );
  }
  if (category && category !== 'All') {
    items = items.filter((p) => p.category.toLowerCase() === category.toLowerCase());
  }
  if (status && status !== 'all') {
    items = items.filter((p) => p.expiryStatus === status);
  }

  items.sort((a, b) => {
    switch (sort) {
      case 'expiry_asc':
        if (a.daysRemaining === null && b.daysRemaining === null) return 0;
        if (a.daysRemaining === null) return 1;
        if (b.daysRemaining === null) return -1;
        return a.daysRemaining - b.daysRemaining;
      case 'expiry_desc':
        if (a.daysRemaining === null && b.daysRemaining === null) return 0;
        if (a.daysRemaining === null) return 1;
        if (b.daysRemaining === null) return -1;
        return b.daysRemaining - a.daysRemaining;
      case 'name_asc':
        return a.name.localeCompare(b.name);
      case 'scanned_desc':
      default:
        return b.scannedAt.localeCompare(a.scannedAt);
    }
  });

  res.json({ products: items, total: items.length });
});

app.get('/api/products/:id', (req, res) => {
  const product = getProductById(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  res.json(product);
});

app.post('/api/products', (req, res) => {
  const body = req.body || {};
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    res.status(400).json({ error: 'Product name is required.' });
    return;
  }

  let normalizedExpiry: string | null = body.expiryDate ? String(body.expiryDate).trim() : null;
  let datePrecision: DatePrecision = body.datePrecision || 'unknown';
  if (normalizedExpiry) {
    const parsedExp = parseDateString(normalizedExpiry);
    if (!parsedExp.validCalendar || !parsedExp.normalized) {
      res.status(400).json({ error: `Invalid expiry date: ${normalizedExpiry}` });
      return;
    }
    normalizedExpiry = parsedExp.normalized;
    datePrecision = parsedExp.precision;
  } else {
    datePrecision = 'unknown';
  }

  let normalizedMfg: string | null = body.manufacturingDate
    ? String(body.manufacturingDate).trim()
    : null;
  let mfgPrecision: DatePrecision = body.mfgDatePrecision || 'unknown';
  if (normalizedMfg) {
    const parsedMfg = parseDateString(normalizedMfg);
    if (!parsedMfg.validCalendar || !parsedMfg.normalized) {
      res.status(400).json({ error: `Invalid manufacturing date: ${normalizedMfg}` });
      return;
    }
    normalizedMfg = parsedMfg.normalized;
    mfgPrecision = parsedMfg.precision;
  } else {
    mfgPrecision = 'unknown';
  }

  if (normalizedExpiry && normalizedMfg && normalizedExpiry < normalizedMfg) {
    res.status(400).json({
      error: 'Expiry date cannot be earlier than manufacturing date.',
    });
    return;
  }

  if (!body.allowDuplicate) {
    const dup = findDuplicateProduct({
      barcode: body.barcode,
      batchNumber: body.batchNumber,
      expiryDate: normalizedExpiry,
      name: body.name,
      brand: body.brand,
    });
    if (dup) {
      res.status(409).json({
        error: 'Duplicate product entry detected for the same barcode/batch and expiry date.',
        duplicateProduct: dup,
      });
      return;
    }
  }

  const created = createProduct({
    barcode: body.barcode,
    barcodeFormat: body.barcodeFormat,
    name: body.name,
    brand: body.brand,
    category: body.category || 'Grocery',
    manufacturingDate: normalizedMfg,
    mfgDatePrecision: mfgPrecision,
    expiryDate: normalizedExpiry,
    datePrecision,
    batchNumber: body.batchNumber,
    imageData: body.imageData,
    ocrRawText: body.ocrRawText,
    detectedDates: body.detectedDates,
    confidence: typeof body.confidence === 'number' ? body.confidence : 1.0,
    verificationStatus: body.verificationStatus || 'verified',
    scanSource: body.scanSource || 'manual',
    notes: body.notes,
  });

  res.status(201).json(created);
});

app.put('/api/products/:id', (req, res) => {
  const existing = getProductById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }

  const body = req.body || {};
  let normalizedExpiry = existing.expiryDate;
  let datePrecision: DatePrecision = existing.datePrecision;

  if (body.expiryDate !== undefined) {
    if (!body.expiryDate) {
      normalizedExpiry = null;
      datePrecision = 'unknown';
    } else {
      const parsedExp = parseDateString(String(body.expiryDate));
      if (!parsedExp.validCalendar || !parsedExp.normalized) {
        res.status(400).json({ error: `Invalid expiry date: ${body.expiryDate}` });
        return;
      }
      normalizedExpiry = parsedExp.normalized;
      datePrecision = parsedExp.precision;
    }
  }

  let normalizedMfg = existing.manufacturingDate;
  let mfgPrecision: DatePrecision = existing.mfgDatePrecision;
  if (body.manufacturingDate !== undefined) {
    if (!body.manufacturingDate) {
      normalizedMfg = null;
      mfgPrecision = 'unknown';
    } else {
      const parsedMfg = parseDateString(String(body.manufacturingDate));
      if (!parsedMfg.validCalendar || !parsedMfg.normalized) {
        res.status(400).json({ error: `Invalid manufacturing date: ${body.manufacturingDate}` });
        return;
      }
      normalizedMfg = parsedMfg.normalized;
      mfgPrecision = parsedMfg.precision;
    }
  }

  if (normalizedExpiry && normalizedMfg && normalizedExpiry < normalizedMfg) {
    res.status(400).json({
      error: 'Expiry date cannot be earlier than manufacturing date.',
    });
    return;
  }

  const updated = updateProduct(req.params.id, {
    ...body,
    expiryDate: normalizedExpiry,
    datePrecision,
    manufacturingDate: normalizedMfg,
    mfgDatePrecision: mfgPrecision,
    verificationStatus: body.verificationStatus || 'verified',
  });

  res.json(updated);
});

app.delete('/api/products/:id', (req, res) => {
  const deleted = deleteProduct(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  res.json({ ok: true, id: req.params.id });
});

// ---------------------------------------------------------------------------
// Expiry Summary & Notifications
// ---------------------------------------------------------------------------

app.get('/api/expiry/summary', (_req, res) => {
  res.json(getExpirySummary());
});

app.get('/api/notifications', (_req, res) => {
  const notifications = getNotifications();
  res.json({
    notifications,
    unreadCount: notifications.filter((n) => !n.dismissed).length,
  });
});

app.post('/api/notifications/dismiss', (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (!key) {
    res.status(400).json({ error: 'Notification key is required.' });
    return;
  }
  dismissNotification(key);
  res.json({ ok: true, key });
});

// ---------------------------------------------------------------------------
// Error handler for API routes
// ---------------------------------------------------------------------------

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.use('/api', (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({
    error: err.message || 'Internal server error',
  });
});

// ---------------------------------------------------------------------------
// Frontend Hosting (Vite dev middleware or dist/ static build)
// ---------------------------------------------------------------------------

async function startServer() {
  const distPath = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distPath);

  if (isProd) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const httpServer = http.createServer(app);
  const liveWss = new WebSocketServer({ noServer: true });
  attachLiveVoiceWebSocket(liveWss);

  httpServer.on('upgrade', (req, socket, head) => {
    try {
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (pathname === '/api/live') {
        liveWss.handleUpgrade(req, socket, head, (ws) => {
          liveWss.emit('connection', ws, req);
        });
      }
    } catch {
      socket.destroy();
    }
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Fresh Vibe full-stack server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Fresh Vibe server:', err);
  process.exit(1);
});
