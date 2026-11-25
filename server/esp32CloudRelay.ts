import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { addCameraLog, getSettings, updateSettings } from './db.ts';

export interface Esp32CommandPayload {
  ok: true;
  capture: boolean;
  stream: boolean;
  flash: boolean;
  intensity: number;
  serverTime: string;
}

export interface Esp32DeviceTelemetry {
  deviceOnline: boolean;
  deviceIp: string | null;
  rssi: number | null;
  uptimeMs: number | null;
  lastSeenAt: string | null;
  latestFrameAt: string | null;
  latestFrameBytes: number | null;
  frameSeq: number;
  streamActive: boolean;
  streamFps: number;
  flashEnabled: boolean;
  flashIntensity: number;
}

type FrameListener = (frame: Buffer, seq: number) => void;

const DEVICE_ONLINE_TIMEOUT_MS = 25_000;
const STREAM_IDLE_STOP_DELAY_MS = 2_000;

class Esp32CloudRelay {
  private lastSeenMs = 0;
  private deviceIp: string | null = null;
  private rssi: number | null = null;
  private uptimeMs: number | null = null;

  private latestFrame: Buffer | null = null;
  private latestFrameMs = 0;
  private frameSeq = 0;
  private frameTimestamps: number[] = [];

  private flashEnabled = false;
  private flashIntensity = 255;

  private captureRequested = false;
  private commandDirty = false;
  private streamViewers = 0;
  private streamStopTimer: NodeJS.Timeout | null = null;

  private pollWaiters = new Set<() => void>();
  private frameWaiters = new Set<FrameListener>();
  private streamSubscribers = new Set<FrameListener>();

  public verifyDeviceKey(providedKey: string | undefined | null): boolean {
    const cleanProvided = (providedKey || '').trim();
    if (!cleanProvided) return false;
    const expected = (process.env.ESP32_DEVICE_KEY || '').trim() || getSettings().cloudDeviceKey;
    if (!expected) return false;

    const a = Buffer.from(cleanProvided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  public regenerateDeviceKey(): string {
    const nextKey = `fv_${crypto.randomBytes(18).toString('base64url')}`;
    updateSettings({ cloudDeviceKey: nextKey });
    addCameraLog({
      level: 'info',
      event: 'device_key_rotated',
      targetUrl: '/api/esp32/*',
      message: 'Cloud Device Key regenerated. Flash or update your ESP32-CAM sketch with the new key.',
    });
    return nextKey;
  }

  public isDeviceOnline(): boolean {
    return this.lastSeenMs > 0 && Date.now() - this.lastSeenMs <= DEVICE_ONLINE_TIMEOUT_MS;
  }

  public isStreamRequested(): boolean {
    return this.streamViewers > 0;
  }

  public recordHeartbeat(meta?: {
    ip?: string | null;
    rssi?: number | null;
    uptimeMs?: number | null;
  }): void {
    const wasOnline = this.isDeviceOnline();
    this.lastSeenMs = Date.now();

    if (meta?.ip && typeof meta.ip === 'string') {
      const cleanIp = meta.ip.trim().slice(0, 64);
      if (cleanIp) this.deviceIp = cleanIp;
    }
    if (meta?.rssi !== undefined && meta.rssi !== null && Number.isFinite(meta.rssi)) {
      this.rssi = Math.round(meta.rssi);
    }
    if (meta?.uptimeMs !== undefined && meta.uptimeMs !== null && Number.isFinite(meta.uptimeMs)) {
      this.uptimeMs = Math.max(0, Math.round(meta.uptimeMs));
    }

    if (!wasOnline) {
      addCameraLog({
        level: 'info',
        event: 'esp32_cloud_online',
        targetUrl: '/api/esp32/poll',
        statusCode: 200,
        message: `ESP32-CAM connected to Cloud API${this.deviceIp ? ` (Wi-Fi IP ${this.deviceIp})` : ''}${this.rssi !== null ? ` · RSSI ${this.rssi} dBm` : ''}.`,
      });
    }
  }

  public getCommandState(): Esp32CommandPayload {
    return {
      ok: true,
      capture: this.captureRequested,
      stream: this.isStreamRequested(),
      flash: this.flashEnabled,
      intensity: this.flashEnabled ? this.flashIntensity : 0,
      serverTime: new Date().toISOString(),
    };
  }

  private wakePollWaiters(): void {
    for (const wake of this.pollWaiters) {
      wake();
    }
    this.pollWaiters.clear();
  }

  public async waitForCommand(waitMs = 12_000): Promise<Esp32CommandPayload> {
    const clampedWait = Math.max(0, Math.min(15_000, Math.round(waitMs)));

    if (this.captureRequested || this.commandDirty || this.isStreamRequested() || clampedWait === 0) {
      this.commandDirty = false;
      return this.getCommandState();
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pollWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, clampedWait);
      this.pollWaiters.add(done);
    });

    this.commandDirty = false;
    return this.getCommandState();
  }

  public pushIncomingFrame(
    buffer: Buffer,
    meta?: { ip?: string | null; rssi?: number | null; uptimeMs?: number | null }
  ): Esp32CommandPayload & { bytes: number; seq: number } {
    this.recordHeartbeat(meta);
    const now = Date.now();
    this.latestFrame = buffer;
    this.latestFrameMs = now;
    this.frameSeq += 1;
    this.captureRequested = false;

    this.frameTimestamps.push(now);
    this.frameTimestamps = this.frameTimestamps.filter((ts) => now - ts <= 3000);

    for (const listener of this.frameWaiters) {
      try {
        listener(buffer, this.frameSeq);
      } catch {
        // ignore listener error
      }
    }
    this.frameWaiters.clear();

    for (const sub of this.streamSubscribers) {
      try {
        sub(buffer, this.frameSeq);
      } catch {
        // ignore subscriber error
      }
    }

    return {
      ...this.getCommandState(),
      bytes: buffer.length,
      seq: this.frameSeq,
    };
  }

  public async requestFreshFrame(timeoutMs = 5500): Promise<{
    ok: boolean;
    buffer?: Buffer;
    latencyMs: number;
    error?: string;
  }> {
    const start = Date.now();

    if (!this.isDeviceOnline()) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error:
          'ESP32-CAM is not connected to the Cloud API yet. Power the ESP32-CAM with your USB Power Bank and ensure it is flashed with the Cloud API firmware.',
      };
    }

    // If a live stream frame arrived within the last 550ms, return it immediately for instant capture
    if (
      this.latestFrame &&
      this.isStreamRequested() &&
      Date.now() - this.latestFrameMs <= 550
    ) {
      return {
        ok: true,
        buffer: this.latestFrame,
        latencyMs: Math.max(1, Date.now() - start),
      };
    }

    this.captureRequested = true;
    this.commandDirty = true;
    this.wakePollWaiters();

    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        this.frameWaiters.delete(onFrame);
      };

      const onFrame: FrameListener = (buf) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          ok: true,
          buffer: buf,
          latencyMs: Math.max(1, Date.now() - start),
        });
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.captureRequested = false;
        cleanup();
        resolve({
          ok: false,
          latencyMs: Date.now() - start,
          error: `Timed out after ${timeoutMs}ms waiting for ESP32-CAM to upload a JPEG frame to /api/esp32/frame.`,
        });
      }, timeoutMs);

      this.frameWaiters.add(onFrame);
    });
  }

  public setFlash(enabled: boolean, intensity = 255): {
    enabled: boolean;
    intensity: number;
    deviceOnline: boolean;
  } {
    const clamped = enabled ? Math.max(1, Math.min(255, Math.round(intensity))) : 0;
    this.flashEnabled = enabled;
    this.flashIntensity = enabled ? clamped : 255;
    this.commandDirty = true;
    this.wakePollWaiters();

    return {
      enabled: this.flashEnabled,
      intensity: clamped,
      deviceOnline: this.isDeviceOnline(),
    };
  }

  public subscribeStream(listener: FrameListener): () => void {
    if (this.streamStopTimer) {
      clearTimeout(this.streamStopTimer);
      this.streamStopTimer = null;
    }

    this.streamViewers += 1;
    this.streamSubscribers.add(listener);
    this.commandDirty = true;
    this.wakePollWaiters();

    // Immediately emit last fresh frame if available (< 3s old)
    if (this.latestFrame && Date.now() - this.latestFrameMs < 3000) {
      listener(this.latestFrame, this.frameSeq);
    }

    return () => {
      this.streamSubscribers.delete(listener);
      this.streamViewers = Math.max(0, this.streamViewers - 1);
      if (this.streamViewers === 0) {
        this.streamStopTimer = setTimeout(() => {
          this.streamStopTimer = null;
          if (this.streamViewers === 0) {
            this.commandDirty = true;
            this.wakePollWaiters();
          }
        }, STREAM_IDLE_STOP_DELAY_MS);
      }
    };
  }

  public getTelemetry(): Esp32DeviceTelemetry {
    const now = Date.now();
    const recentFrames = this.frameTimestamps.filter((ts) => now - ts <= 3000);
    const fps = recentFrames.length > 1 ? Number((recentFrames.length / 3).toFixed(1)) : 0;

    return {
      deviceOnline: this.isDeviceOnline(),
      deviceIp: this.deviceIp,
      rssi: this.rssi,
      uptimeMs: this.uptimeMs,
      lastSeenAt: this.lastSeenMs > 0 ? new Date(this.lastSeenMs).toISOString() : null,
      latestFrameAt: this.latestFrameMs > 0 ? new Date(this.latestFrameMs).toISOString() : null,
      latestFrameBytes: this.latestFrame ? this.latestFrame.length : null,
      frameSeq: this.frameSeq,
      streamActive: this.isStreamRequested() && this.isDeviceOnline(),
      streamFps: fps,
      flashEnabled: this.flashEnabled,
      flashIntensity: this.flashEnabled ? this.flashIntensity : 0,
    };
  }
}

export const esp32Relay = new Esp32CloudRelay();

export function sanitizeSketchBaseUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.origin.replace(/["\\\r\n]/g, '');
  } catch {
    return null;
  }
}

function isDisallowedIpAddress(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/i, '');
  const version = net.isIP(clean);
  if (version === 4) {
    const parts = clean.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    const lower = clean.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true;
    }
    return false;
  }
  return true;
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

export async function checkCloudUrlReachability(rawBaseUrl: string): Promise<CloudReachabilityResult> {
  const checkedAt = new Date().toISOString();
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl.trim());
  } catch {
    return {
      ok: false,
      reachable: false,
      blockedByAuthProxy: false,
      notDeployed: false,
      testedUrl: rawBaseUrl.trim(),
      statusCode: null,
      redirectLocation: null,
      detail: 'Invalid URL. Enter a full https:// public Cloud Run or domain URL.',
      checkedAt,
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      reachable: false,
      blockedByAuthProxy: false,
      notDeployed: false,
      testedUrl: parsed.origin,
      statusCode: null,
      redirectLocation: null,
      detail: 'Only https:// or http:// URLs are supported.',
      checkedAt,
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    return {
      ok: false,
      reachable: false,
      blockedByAuthProxy: false,
      notDeployed: false,
      testedUrl: parsed.origin,
      statusCode: null,
      redirectLocation: null,
      detail: 'Private or local hostnames cannot be probed as a public Cloud API URL.',
      checkedAt,
    };
  }

  if (net.isIP(host) && isDisallowedIpAddress(host)) {
    return {
      ok: false,
      reachable: false,
      blockedByAuthProxy: false,
      notDeployed: false,
      testedUrl: parsed.origin,
      statusCode: null,
      redirectLocation: null,
      detail: 'Private or loopback IP addresses cannot serve as a public Cloud API URL.',
      checkedAt,
    };
  }

  try {
    const resolved = await dns.lookup(host, { all: true });
    if (resolved.length === 0 || resolved.some((entry) => isDisallowedIpAddress(entry.address))) {
      return {
        ok: false,
        reachable: false,
        blockedByAuthProxy: false,
        notDeployed: false,
        testedUrl: parsed.origin,
        statusCode: null,
        redirectLocation: null,
        detail: 'Target hostname resolved to a private or non-public IP address.',
        checkedAt,
      };
    }
  } catch {
    return {
      ok: false,
      reachable: false,
      blockedByAuthProxy: false,
      notDeployed: false,
      testedUrl: parsed.origin,
      statusCode: null,
      redirectLocation: null,
      detail: `DNS lookup failed for ${host}. Verify the deployed URL spelling.`,
      checkedAt,
    };
  }

  const probeUrl = `${parsed.origin}/api/esp32/poll?waitMs=0`;
  try {
    const resp = await fetch(probeUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'ESP32HTTPClient',
      },
    });

    const location = resp.headers.get('location');

    if (
      resp.status === 301 ||
      resp.status === 302 ||
      resp.status === 303 ||
      resp.status === 307 ||
      resp.status === 308
    ) {
      const isAuthGate =
        Boolean(location && (location.includes('__cookie_check') || location.includes('accounts.google.com'))) ||
        host.startsWith('ais-dev-');
      return {
        ok: true,
        reachable: false,
        blockedByAuthProxy: isAuthGate || resp.status === 302,
        notDeployed: false,
        testedUrl: probeUrl,
        statusCode: resp.status,
        redirectLocation: location,
        detail: isAuthGate
          ? `Blocked by AI Studio Preview login proxy (HTTP ${resp.status} redirect to ${location || 'login'}). ESP32-CAM cannot hold browser login cookies. Deploy Fresh Vibe to a public Cloud Run URL and use that https://...run.app URL.`
          : `URL redirected with HTTP ${resp.status} (${location || 'unknown'}). ESP32-CAM expects a direct 200/401 JSON API response.`,
        checkedAt,
      };
    }

    if (resp.status === 404) {
      return {
        ok: true,
        reachable: false,
        blockedByAuthProxy: false,
        notDeployed: true,
        testedUrl: probeUrl,
        statusCode: 404,
        redirectLocation: null,
        detail: 'Returned HTTP 404 — Fresh Vibe is not deployed or published at this URL yet.',
        checkedAt,
      };
    }

    const contentType = resp.headers.get('content-type') || '';
    if ((resp.status === 401 || resp.status === 200) && contentType.includes('application/json')) {
      return {
        ok: true,
        reachable: true,
        blockedByAuthProxy: false,
        notDeployed: false,
        testedUrl: probeUrl,
        statusCode: resp.status,
        redirectLocation: null,
        detail: `Publicly reachable by ESP32-CAM (HTTP ${resp.status} JSON from /api/esp32/poll — ready for Power Bank connection).`,
        checkedAt,
      };
    }

    return {
      ok: true,
      reachable: false,
      blockedByAuthProxy: false,
      notDeployed: false,
      testedUrl: probeUrl,
      statusCode: resp.status,
      redirectLocation: location,
      detail: `Unexpected response HTTP ${resp.status} (${contentType || 'unknown content-type'}). Expected JSON from /api/esp32/poll.`,
      checkedAt,
    };
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      blockedByAuthProxy: false,
      notDeployed: false,
      testedUrl: probeUrl,
      statusCode: null,
      redirectLocation: null,
      detail: `Network error checking ${parsed.origin}: ${err instanceof Error ? err.message : 'Request failed'}`,
      checkedAt,
    };
  }
}

export function generateEsp32CloudSketch(params: {
  cloudBaseUrl: string;
  deviceKey: string;
}): string {
  const safeBaseUrl = sanitizeSketchBaseUrl(params.cloudBaseUrl) || 'https://YOUR_DEPLOYED_CLOUD_RUN_URL';
  const safeKey = params.deviceKey.replace(/["\\\r\n]/g, '').trim();

  return `/*
 * Fresh Vibe – AI Smart Expiry Tracker (Direct Cloud API Firmware)
 * Board: AI Thinker ESP32-CAM (OV2640)
 * Power: Run directly from USB Power Bank (No laptop, no Python, no Raspberry Pi!)
 *
 * IMPORTANT:
 * - CLOUD_BASE_URL must be your PUBLIC deployed URL (e.g. from AI Studio "Deploy to Cloud Run").
 * - Do NOT use an "ais-dev-..." preview URL because Google's preview proxy redirects non-browser devices (HTTP 302).
 *
 * Setup in Arduino IDE:
 * 1. Tools -> Board -> "AI Thinker ESP32-CAM"
 * 2. Tools -> PSRAM -> "Enabled"
 * 3. Fill in WIFI_SSID and WIFI_PASSWORD below, then Upload.
 * 4. Open Serial Monitor (115200 baud) once to confirm "Wi-Fi connected" and "Cloud API connected (HTTP 200)".
 * 5. Unplug programmer and run from a 5V USB Power Bank anywhere on Wi-Fi!
 */

#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "esp_camera.h"

// =================== USER WI-FI SETTINGS ===================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// =================== FRESH VIBE CLOUD API ===================
const char* CLOUD_BASE_URL = "${safeBaseUrl}";
const char* DEVICE_KEY     = "${safeKey}";

// AI-Thinker ESP32-CAM Pin Definitions
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22
#define FLASH_LED_PIN      4

bool streamActive = false;
bool flashActive = false;
int flashIntensity = 0;
bool cloudLinkedOnce = false;

void applyFlashLed(bool enabled, int intensity) {
  flashActive = enabled;
  flashIntensity = constrain(intensity, 0, 255);
  digitalWrite(FLASH_LED_PIN, (flashActive && flashIntensity > 0) ? HIGH : LOW);
}

bool parseJsonBool(const String& body, const char* key, bool fallback) {
  String pattern = String("\\"") + key + "\\":";
  int idx = body.indexOf(pattern);
  if (idx < 0) return fallback;
  int start = idx + pattern.length();
  while (start < (int)body.length() && body[start] == ' ') start++;
  if (body.startsWith("true", start)) return true;
  if (body.startsWith("false", start)) return false;
  return fallback;
}

int parseJsonInt(const String& body, const char* key, int fallback) {
  String pattern = String("\\"") + key + "\\":";
  int idx = body.indexOf(pattern);
  if (idx < 0) return fallback;
  int start = idx + pattern.length();
  while (start < (int)body.length() && body[start] == ' ') start++;
  int end = start;
  while (end < (int)body.length() && (isDigit(body[end]) || body[end] == '-')) end++;
  if (end == start) return fallback;
  return body.substring(start, end).toInt();
}

void handleServerState(const String& jsonBody) {
  bool nextFlash = parseJsonBool(jsonBody, "flash", flashActive);
  int nextIntensity = parseJsonInt(jsonBody, "intensity", nextFlash ? 255 : 0);
  if (nextFlash != flashActive || nextIntensity != flashIntensity) {
    applyFlashLed(nextFlash, nextIntensity);
  }
  streamActive = parseJsonBool(jsonBody, "stream", streamActive);
}

void logHttpError(const char* label, int code, HTTPClient& http) {
  if (code == 301 || code == 302 || code == 307 || code == 308) {
    Serial.printf("%s HTTP %d REDIRECT -> Cloud URL blocked by login proxy! Deploy Fresh Vibe publicly and update CLOUD_BASE_URL.\\n", label, code);
  } else if (code == 401) {
    Serial.printf("%s HTTP 401 UNAUTHORIZED -> DEVICE_KEY mismatch! Copy X-Device-Key from Connect Camera.\\n", label);
  } else if (code < 0) {
    Serial.printf("%s failed (%d): %s\\n", label, code, http.errorToString(code).c_str());
  } else {
    Serial.printf("%s HTTP %d\\n", label, code);
  }
}

bool beginHttpRequest(HTTPClient& http, WiFiClient& plainClient, WiFiClientSecure& secureClient, const String& url) {
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  http.setReuse(false);
  if (url.startsWith("https://")) {
    secureClient.setInsecure();
    secureClient.setHandshakeTimeout(10);
    return http.begin(secureClient, url);
  }
  return http.begin(plainClient, url);
}

bool uploadCurrentFrame() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Camera capture failed");
    return false;
  }

  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  HTTPClient http;
  String url = String(CLOUD_BASE_URL) + "/api/esp32/frame";
  if (!beginHttpRequest(http, plainClient, secureClient, url)) {
    esp_camera_fb_return(fb);
    Serial.println("HTTP begin() failed for /api/esp32/frame");
    return false;
  }

  http.setTimeout(10000);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  http.addHeader("X-ESP32-IP", WiFi.localIP().toString());
  http.addHeader("X-ESP32-RSSI", String(WiFi.RSSI()));
  http.addHeader("X-ESP32-Uptime", String(millis()));

  int code = http.POST(fb->buf, fb->len);
  esp_camera_fb_return(fb);

  if (code == 200) {
    String resp = http.getString();
    handleServerState(resp);
    http.end();
    if (!cloudLinkedOnce) {
      cloudLinkedOnce = true;
      Serial.println("Cloud API connected! Frame uploaded (HTTP 200).");
    }
    return true;
  }

  logHttpError("Frame upload", code, http);
  http.end();
  return false;
}

void pollCloudCommands() {
  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  HTTPClient http;
  String url = String(CLOUD_BASE_URL) + "/api/esp32/poll?waitMs=10000"
             + "&ip=" + WiFi.localIP().toString()
             + "&rssi=" + String(WiFi.RSSI())
             + "&uptime=" + String(millis());

  if (!beginHttpRequest(http, plainClient, secureClient, url)) {
    Serial.println("HTTP begin() failed for /api/esp32/poll");
    delay(1200);
    return;
  }

  http.setTimeout(15000);
  http.addHeader("X-Device-Key", DEVICE_KEY);

  int code = http.GET();
  if (code == 200) {
    String resp = http.getString();
    handleServerState(resp);
    bool captureNow = parseJsonBool(resp, "capture", false);
    http.end();
    if (!cloudLinkedOnce) {
      cloudLinkedOnce = true;
      Serial.println("Cloud API connected! Heartbeat active (HTTP 200).");
    }
    if (captureNow) {
      uploadCurrentFrame();
    }
    return;
  }

  logHttpError("Cloud poll", code, http);
  http.end();
  delay(1500);
}

void ensureWifiConnected() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("Connecting to Wi-Fi %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    WiFi.setSleep(false);
    Serial.print("Wi-Fi connected! Local IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Cloud API Target: ");
    Serial.println(CLOUD_BASE_URL);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(FLASH_LED_PIN, OUTPUT);
  applyFlashLed(false, 0);

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    config.frame_size = FRAMESIZE_SVGA;  // 800x600 crisp OCR + fast upload
    config.jpeg_quality = 10;
    config.fb_count = 2;
    config.grab_mode = CAMERA_GRAB_LATEST;
  } else {
    config.frame_size = FRAMESIZE_VGA;
    config.jpeg_quality = 12;
    config.fb_count = 1;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\\n", err);
    delay(3000);
    ESP.restart();
  }

  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 0);
    s->set_contrast(s, 1);
  }

  ensureWifiConnected();
  if (WiFi.status() == WL_CONNECTED) {
    uploadCurrentFrame();
  }
}

void loop() {
  ensureWifiConnected();
  if (WiFi.status() != WL_CONNECTED) {
    delay(1500);
    return;
  }

  if (streamActive) {
    uploadCurrentFrame();
    delay(80); // ~8-10 FPS smooth live stream without overheating
  } else {
    pollCloudCommands();
  }
}
`;
}
