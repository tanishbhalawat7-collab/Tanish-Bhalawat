import { addCameraLog, getSettings } from './db.ts';
import { esp32Relay } from './esp32CloudRelay.ts';

export function isValidJpegBuffer(buf: Buffer): boolean {
  return buf.length > 512 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
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

export async function captureCameraJpeg(): Promise<{
  ok: boolean;
  buffer?: Buffer;
  latencyMs: number;
  attempts: number;
  targetUrl: string;
  error?: string;
}> {
  const settings = getSettings();
  const maxAttempts = settings.autoReconnect
    ? Math.max(1, Math.min(3, settings.maxReconnectRetries || 2))
    : 1;

  const telemetry = esp32Relay.getTelemetry();
  if (!telemetry.deviceOnline) {
    const offlineMsg =
      'ESP32-CAM is not connected to the Cloud API. Plug your ESP32-CAM into a USB Power Bank with the Cloud API firmware and Wi-Fi enabled.';
    addCameraLog({
      level: 'warn',
      event: 'capture_offline',
      targetUrl: '/api/esp32/frame',
      message: offlineMsg,
    });
    return {
      ok: false,
      latencyMs: 0,
      attempts: 0,
      targetUrl: '/api/esp32/frame',
      error: offlineMsg,
    };
  }

  let lastError = 'Failed to receive JPEG frame from ESP32-CAM.';
  const start = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await esp32Relay.requestFreshFrame(5500);
    if (res.ok && res.buffer && isValidJpegBuffer(res.buffer)) {
      addCameraLog({
        level: 'info',
        event: 'capture_ok',
        targetUrl: '/api/esp32/frame',
        statusCode: 200,
        message: `Received valid JPEG (${res.buffer.length} bytes) via Cloud API in ${res.latencyMs}ms (attempt ${attempt}/${maxAttempts}).`,
      });
      return {
        ok: true,
        buffer: res.buffer,
        latencyMs: res.latencyMs,
        attempts: attempt,
        targetUrl: '/api/esp32/frame',
      };
    }

    lastError = res.error || 'Received invalid or incomplete JPEG frame from ESP32-CAM.';
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  addCameraLog({
    level: 'error',
    event: 'capture_failed',
    targetUrl: '/api/esp32/frame',
    message: lastError,
  });

  return {
    ok: false,
    latencyMs: Date.now() - start,
    attempts: maxAttempts,
    targetUrl: '/api/esp32/frame',
    error: lastError,
  };
}

export async function verifyCameraHealth(): Promise<CameraHealthStatus> {
  const telemetry = esp32Relay.getTelemetry();

  if (!telemetry.deviceOnline) {
    return {
      connected: false,
      mode: 'cloud_relay',
      deviceOnline: false,
      deviceIp: telemetry.deviceIp,
      rssi: telemetry.rssi,
      lastSeenAt: telemetry.lastSeenAt,
      streamActive: false,
      streamFps: 0,
      flashEnabled: telemetry.flashEnabled,
      flashIntensity: telemetry.flashIntensity,
      latencyMs: null,
      bytesReceived: telemetry.latestFrameBytes,
      attempts: 0,
      checkedAt: new Date().toISOString(),
      message:
        'Waiting for ESP32-CAM to connect directly to the Cloud API (power it via USB Power Bank — no Python or laptop needed).',
      error:
        'No active heartbeat received from ESP32-CAM in the last 25 seconds. Flash the Cloud API Arduino sketch to your ESP32-CAM and power it on.',
    };
  }

  const cap = await captureCameraJpeg();
  const updatedTelemetry = esp32Relay.getTelemetry();

  if (cap.ok && cap.buffer) {
    return {
      connected: true,
      mode: 'cloud_relay',
      deviceOnline: updatedTelemetry.deviceOnline,
      deviceIp: updatedTelemetry.deviceIp,
      rssi: updatedTelemetry.rssi,
      lastSeenAt: updatedTelemetry.lastSeenAt,
      streamActive: updatedTelemetry.streamActive,
      streamFps: updatedTelemetry.streamFps,
      flashEnabled: updatedTelemetry.flashEnabled,
      flashIntensity: updatedTelemetry.flashIntensity,
      latencyMs: cap.latencyMs,
      bytesReceived: cap.buffer.length,
      attempts: cap.attempts,
      checkedAt: new Date().toISOString(),
      message: `Connected via Cloud API — verified real JPEG frame (${cap.buffer.length} bytes) directly from ESP32-CAM.`,
    };
  }

  return {
    connected: false,
    mode: 'cloud_relay',
    deviceOnline: updatedTelemetry.deviceOnline,
    deviceIp: updatedTelemetry.deviceIp,
    rssi: updatedTelemetry.rssi,
    lastSeenAt: updatedTelemetry.lastSeenAt,
    streamActive: updatedTelemetry.streamActive,
    streamFps: updatedTelemetry.streamFps,
    flashEnabled: updatedTelemetry.flashEnabled,
    flashIntensity: updatedTelemetry.flashIntensity,
    latencyMs: cap.latencyMs,
    bytesReceived: null,
    attempts: cap.attempts,
    checkedAt: new Date().toISOString(),
    message: 'ESP32-CAM checked in, but did not return a valid JPEG frame yet.',
    error: cap.error,
  };
}

export interface CameraFlashResult {
  ok: boolean;
  enabled: boolean;
  intensity: number;
  deviceOnline: boolean;
  message?: string;
  error?: string;
}

export async function setCameraFlash(params: {
  enabled: boolean;
  intensity?: number;
}): Promise<CameraFlashResult> {
  const result = esp32Relay.setFlash(params.enabled, params.intensity ?? 255);

  addCameraLog({
    level: result.deviceOnline ? 'info' : 'warn',
    event: result.enabled ? 'flash_on' : 'flash_off',
    targetUrl: '/api/esp32/poll',
    statusCode: 200,
    message: result.deviceOnline
      ? result.enabled
        ? `ESP32-CAM LED flash turned ON (${result.intensity}/255) via Cloud API.`
        : 'ESP32-CAM LED flash turned OFF via Cloud API.'
      : `Flash command queued (${result.enabled ? 'ON' : 'OFF'}), waiting for ESP32-CAM to come online.`,
  });

  if (!result.deviceOnline) {
    return {
      ok: false,
      enabled: result.enabled,
      intensity: result.intensity,
      deviceOnline: false,
      error:
        'ESP32-CAM is currently offline on the Cloud API. Power on your ESP32-CAM with Wi-Fi connected and try again.',
    };
  }

  return {
    ok: true,
    enabled: result.enabled,
    intensity: result.intensity,
    deviceOnline: true,
    message: result.enabled
      ? `Flashlight turned ON (${result.intensity}/255).`
      : 'Flashlight turned OFF.',
  };
}
