# Fresh Vibe – AI Smart Expiry Tracker

Full-stack smart expiry tracker with direct Cloud API AI-Thinker ESP32-CAM integration (USB Power Bank ready, zero Python or local bridges required), ZXing multi-format barcode decoding, hybrid Tesseract.js + Gemini AI packaging OCR date extraction, Gemini Live Voice Assistant, and SQLite persistence.

## Architecture

```
AI-Thinker ESP32-CAM (USB Power Bank + Wi-Fi)
        │  Direct outbound HTTPS requests (X-Device-Key auth)
        │  GET  /api/esp32/poll   (long-poll commands: capture, stream, flash)
        │  POST /api/esp32/frame  (JPEG upload for capture & live MJPEG stream)
        ▼
Fresh Vibe Full-Stack Cloud App (Express + SQLite + ZXing + Tesseract + Gemini AI)
        │  Same-origin HTTPS /api/* & /api/live WebSocket
        ▼
React Web Dashboard (Connect Camera, Scan Product, Barcode Scanner, Voice Assistant)
```

### Key Hardware & Security Decisions
- **Zero Python / Zero Localhost Bridge**: The ESP32-CAM connects directly over HTTPS to Fresh Vibe's Cloud API, so it runs standalone from any 5V USB Power Bank on Wi-Fi.
- **No `/status` Dependency**: Camera health is verified strictly through real JPEG uploads (`0xFF 0xD8 0xFF` validation) over `/api/esp32/frame`.
- **Battery-Aware Live Stream & Flashlight**: Live MJPEG streaming (`/api/camera/stream`) activates only while a viewer is open and pauses automatically on disconnect. GPIO 4 Flashlight control works both during idle polling and live streaming.
- **Honest Date & Product Verification**: Barcodes never fabricate expiry dates. Packaging OCR distinguishes manufacturing dates (`MFG`, `MFD`, `PKD`) from expiry dates (`EXP`, `BEST BEFORE`, `USE BY`), validates calendar dates, and preserves month-only precision (`YYYY-MM`).

---

## Setup & Usage

1. Configure `GEMINI_API_KEY` in your environment (`.env` locally or Secrets panel in AI Studio).
2. Install & start the app:
   ```bash
   npm install
   npm run dev
   ```
3. Open **Connect Camera** in Fresh Vibe:
   - Download `fresh_vibe_esp32_cloud.ino` (pre-filled with your Cloud API URL and Device Key).
   - Enter your Wi-Fi SSID & Password in the sketch and flash it once via Arduino IDE (`AI Thinker ESP32-CAM`, `PSRAM: Enabled`).
   - Unplug from your computer and plug the ESP32-CAM into a 5V USB Power Bank.
   - Click **Connect & Test**, **Capture Image**, **Flashlight**, or **Live Stream**.
