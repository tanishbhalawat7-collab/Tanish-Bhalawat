import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  DecodeHintType,
} from '@zxing/library';
import {
  AlertTriangle,
  Barcode,
  Camera,
  CheckCircle2,
  Flashlight,
  FlashlightOff,
  Loader2,
  Repeat,
  Search,
  Upload,
  Video,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import {
  PRODUCT_CATEGORIES,
  type BarcodeLookupResult,
  type NavSection,
  type ProductRecord,
} from '../types';

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type TorchConstraints = MediaTrackConstraintSet & { torch?: boolean };

const BARCODE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.QR_CODE,
];

function formatLabel(fmt: BarcodeFormat): string {
  switch (fmt) {
    case BarcodeFormat.EAN_13:
      return 'EAN-13';
    case BarcodeFormat.EAN_8:
      return 'EAN-8';
    case BarcodeFormat.UPC_A:
      return 'UPC-A';
    case BarcodeFormat.UPC_E:
      return 'UPC-E';
    case BarcodeFormat.CODE_128:
      return 'Code 128';
    case BarcodeFormat.CODE_39:
      return 'Code 39';
    case BarcodeFormat.QR_CODE:
      return 'QR Code';
    default:
      return String(fmt);
  }
}

export function BarcodeScannerPage({
  onNavigate,
  onProductSaved,
}: {
  onNavigate: (section: NavSection) => void;
  onProductSaved: (product: ProductRecord) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  const [liveScanning, setLiveScanning] = useState(false);
  const [fastScanMode, setFastScanMode] = useState(true);
  const [continuousMode, setContinuousMode] = useState(false);
  const [torchSupported, setTorchSupported] = useState<boolean | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [espFlashOn, setEspFlashOn] = useState(false);
  const [togglingEspFlash, setTogglingEspFlash] = useState(false);

  const [manualCode, setManualCode] = useState('');
  const [loadingLookup, setLoadingLookup] = useState(false);
  const [decodedCode, setDecodedCode] = useState<string | null>(null);
  const [decodedFormat, setDecodedFormat] = useState<string | null>(null);
  const [lookup, setLookup] = useState<BarcodeLookupResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Optional packaging OCR step after barcode identification
  const [ocrExpiry, setOcrExpiry] = useState('');
  const [ocrMfg, setOcrMfg] = useState('');
  const [ocrBatch, setOcrBatch] = useState('');
  const [productName, setProductName] = useState('');
  const [productBrand, setProductBrand] = useState('');
  const [productCategory, setProductCategory] = useState('Grocery');
  const [packagingImage, setPackagingImage] = useState<string | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedRecord, setSavedRecord] = useState<ProductRecord | null>(null);

  const lastScannedCodeRef = useRef<{ code: string; at: number } | null>(null);

  const stopLiveScanner = useCallback(() => {
    setTorchOn(false);
    setTorchSupported(null);
    if (readerRef.current) {
      readerRef.current.reset();
      readerRef.current = null;
    }
    setLiveScanning(false);
  }, []);

  useEffect(() => {
    return () => stopLiveScanner();
  }, [stopLiveScanner]);

  const inspectActiveVideoTorch = useCallback(() => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()?.[0];
    if (track && typeof track.getCapabilities === 'function') {
      const caps = track.getCapabilities() as TorchCapabilities;
      setTorchSupported(Boolean(caps.torch));
    } else if (track) {
      setTorchSupported(false);
    }
  }, []);

  const handleToggleDeviceTorch = async () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()?.[0];
    if (!track) return;
    const next = !torchOn;
    try {
      const advanced: TorchConstraints[] = [{ torch: next }];
      await track.applyConstraints({ advanced });
      setTorchOn(next);
    } catch (err) {
      setTorchSupported(false);
      setTorchOn(false);
      setError(
        err instanceof Error
          ? `Device flashlight unavailable: ${err.message}`
          : 'Device hardware torch is not supported on this camera.'
      );
    }
  };

  const handleToggleEspFlash = async () => {
    setError(null);
    setTogglingEspFlash(true);
    const next = !espFlashOn;
    try {
      const res = await api.setCameraFlash(next, 255);
      if (res.ok) {
        setEspFlashOn(res.enabled);
      } else {
        setError(res.error || 'Failed to toggle ESP32-CAM LED flash.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle ESP32-CAM LED flash.');
    } finally {
      setTogglingEspFlash(false);
    }
  };

  const runServerLookup = useCallback(
    async (code: string, format?: string) => {
      setLoadingLookup(true);
      setError(null);
      setSavedRecord(null);
      try {
        const res = await api.scanBarcode({
          barcode: code,
          format,
          fastMode: fastScanMode,
        });
        setDecodedCode(res.code);
        setDecodedFormat(res.format);
        setLookup(res.lookup);
        setStatusMessage(res.lookup?.note || res.message || null);
        if (res.lookup?.name) setProductName(res.lookup.name);
        if (res.lookup?.brand) setProductBrand(res.lookup.brand);
        if (res.lookup?.category) setProductCategory(res.lookup.category);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Barcode lookup failed.');
      } finally {
        setLoadingLookup(false);
      }
    },
    [fastScanMode]
  );

  const startLiveScanner = async () => {
    setError(null);
    setSavedRecord(null);
    setTorchOn(false);
    setTorchSupported(null);
    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, BARCODE_FORMATS);
      if (!fastScanMode) {
        hints.set(DecodeHintType.TRY_HARDER, true);
      }
      const reader = new BrowserMultiFormatReader(hints, fastScanMode ? 80 : 350);
      readerRef.current = reader;
      setLiveScanning(true);

      window.setTimeout(inspectActiveVideoTorch, 450);

      await reader.decodeFromVideoDevice(
        null,
        videoRef.current!,
        (result, err) => {
          if (result) {
            const text = result.getText();
            const fmt = formatLabel(result.getBarcodeFormat());
            const now = Date.now();
            if (
              continuousMode &&
              lastScannedCodeRef.current &&
              lastScannedCodeRef.current.code === text &&
              now - lastScannedCodeRef.current.at < 2500
            ) {
              return;
            }
            lastScannedCodeRef.current = { code: text, at: now };
            if (!continuousMode) {
              stopLiveScanner();
            }
            setManualCode(text);
            void runServerLookup(text, fmt);
          } else if (err && err.name !== 'NotFoundException') {
            // Ignore per-frame NotFoundException while scanning
          }
        }
      );
      inspectActiveVideoTorch();
    } catch (err) {
      stopLiveScanner();
      setError(
        err instanceof Error
          ? `Unable to start camera barcode scanner: ${err.message}`
          : 'Camera barcode scanner unavailable.'
      );
    }
  };

  const handleEsp32BarcodeCapture = async () => {
    setError(null);
    setLoadingLookup(true);
    setSavedRecord(null);
    try {
      const cap = await api.captureCameraFrame();
      setPackagingImage(cap.imageDataUrl);
      const res = await api.scanBarcode({
        image: cap.imageDataUrl,
        fastMode: fastScanMode,
      });
      if (!res.barcodeDetected || !res.code) {
        setDecodedCode(null);
        setLookup(null);
        setStatusMessage(
          res.message ||
            'No barcode decoded from ESP32-CAM frame. Hold barcode closer or use AI/OCR scan.'
        );
      } else {
        setManualCode(res.code);
        setDecodedCode(res.code);
        setDecodedFormat(res.format);
        setLookup(res.lookup);
        setStatusMessage(res.lookup?.note || null);
        if (res.lookup?.name) setProductName(res.lookup.name);
        if (res.lookup?.brand) setProductBrand(res.lookup.brand);
        if (res.lookup?.category) setProductCategory(res.lookup.category);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ESP32-CAM barcode capture failed.');
    } finally {
      setLoadingLookup(false);
    }
  };

  const handleUploadBarcodeImage = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setLoadingLookup(true);
    setSavedRecord(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result);
        setPackagingImage(dataUrl);
        const res = await api.scanBarcode({
          image: dataUrl,
          fastMode: fastScanMode,
        });
        if (!res.barcodeDetected || !res.code) {
          setDecodedCode(null);
          setLookup(null);
          setStatusMessage(res.message || 'No barcode found in uploaded image.');
        } else {
          setManualCode(res.code);
          setDecodedCode(res.code);
          setDecodedFormat(res.format);
          setLookup(res.lookup);
          setStatusMessage(res.lookup?.note || null);
          if (res.lookup?.name) setProductName(res.lookup.name);
          if (res.lookup?.brand) setProductBrand(res.lookup.brand);
          if (res.lookup?.category) setProductCategory(res.lookup.category);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Image barcode decode failed.');
      } finally {
        setLoadingLookup(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const runOcrWithImageData = async (dataUrl: string) => {
    setPackagingImage(dataUrl);
    const res = await api.processScan({
      image: dataUrl,
      source: 'barcode',
      barcode: decodedCode,
      barcodeFormat: decodedFormat,
      autoSave: false,
      fastMode: fastScanMode,
    });
    if (!productName && res.candidate.name !== 'Unidentified Product') {
      setProductName(res.candidate.name);
    }
    if (!productBrand && res.candidate.brand) setProductBrand(res.candidate.brand);
    if (res.candidate.expiryDate) setOcrExpiry(res.candidate.expiryDate);
    if (res.candidate.manufacturingDate) setOcrMfg(res.candidate.manufacturingDate);
    if (res.candidate.batchNumber) setOcrBatch(res.candidate.batchNumber);
    setStatusMessage(
      res.candidate.expiryDate
        ? `OCR extracted expiry date: ${res.candidate.expiryDate}`
        : 'OCR completed. Confirm or enter the printed expiry date below.'
    );
  };

  const handleEsp32DateOcr = async () => {
    setOcrRunning(true);
    setError(null);
    try {
      const cap = await api.captureCameraFrame();
      await runOcrWithImageData(cap.imageDataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ESP32-CAM date OCR failed.');
    } finally {
      setOcrRunning(false);
    }
  };

  const handleRunOcrOnPackage = async (file: File | undefined) => {
    if (!file) return;
    setOcrRunning(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await runOcrWithImageData(String(reader.result));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Packaging OCR failed.');
      } finally {
        setOcrRunning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveBarcodeProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim()) {
      setError('Product name is required to save.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.createProduct({
        barcode: decodedCode || manualCode.trim() || null,
        barcodeFormat: decodedFormat,
        name: productName.trim(),
        brand: productBrand.trim() || null,
        category: productCategory,
        manufacturingDate: ocrMfg.trim() || null,
        expiryDate: ocrExpiry.trim() || null,
        batchNumber: ocrBatch.trim() || null,
        imageData: packagingImage,
        verificationStatus: ocrExpiry.trim() ? 'verified' : 'needs_review',
        scanSource: 'barcode',
      });
      setSavedRecord(created);
      onProductSaved(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#E5EAE7] bg-white p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#111827]">
            ZXing Multi-Format Barcode Scanner
          </h2>
          <p className="text-xs text-[#6B7280]">
            Supports EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, and QR Code ·{' '}
            {fastScanMode ? 'Fast 80ms frame capture active' : 'High-precision TRY_HARDER mode'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-center">
          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3F6F4] border border-[#E5EAE7]">
            <button
              type="button"
              onClick={() => setFastScanMode(true)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                fastScanMode
                  ? 'bg-[#059669] text-white shadow-sm'
                  : 'text-[#4B5563] hover:text-[#111827]'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Fast (80ms)</span>
            </button>
            <button
              type="button"
              onClick={() => setFastScanMode(false)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                !fastScanMode
                  ? 'bg-[#0D2E22] text-white shadow-sm'
                  : 'text-[#4B5563] hover:text-[#111827]'
              }`}
            >
              <span>Deep</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('scan')}
            className="text-xs font-medium text-[#059669] hover:text-[#047857] whitespace-nowrap"
          >
            Switch to Full AI + OCR Scan →
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm text-[#991B1B] flex items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Scanner Controls */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-xl border border-[#E5EAE7] bg-white p-5 space-y-4">
            <div className="aspect-[4/3] w-full rounded-lg bg-[#0D2E22] overflow-hidden relative flex items-center justify-center border border-[#E5EAE7]">
              <video
                ref={videoRef}
                onLoadedMetadata={inspectActiveVideoTorch}
                className={`h-full w-full object-cover ${liveScanning ? 'block' : 'hidden'}`}
                muted
                playsInline
              />
              {liveScanning && fastScanMode && (
                <div className="absolute top-2.5 left-2.5 rounded-md bg-[#059669]/90 px-2.5 py-1 text-[11px] font-medium text-white inline-flex items-center gap-1.5">
                  <Zap className="h-3 w-3" />
                  <span>{continuousMode ? 'Continuous Fast Scan' : 'Fast Scan (80ms)'}</span>
                </div>
              )}
              {!liveScanning && (
                <div className="text-center p-4 space-y-2">
                  <Barcode className="h-9 w-9 text-[#A7F3D0] mx-auto" />
                  <p className="text-xs text-white/80">
                    Point webcam at product barcode, or capture from ESP32-CAM / upload image.
                  </p>
                </div>
              )}
            </div>

            {liveScanning && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleToggleDeviceTorch}
                  disabled={torchSupported === false}
                  title={
                    torchSupported === false
                      ? 'This camera/browser does not expose a hardware flashlight torch'
                      : 'Toggle device camera flashlight'
                  }
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    torchOn
                      ? 'border-[#F59E0B] bg-[#FFFBEB] text-[#B45309]'
                      : 'border-[#D1D5DB] bg-white text-[#111827] hover:bg-[#F6F9F7]'
                  } disabled:opacity-50`}
                >
                  {torchOn ? (
                    <Flashlight className="h-3.5 w-3.5 text-[#D97706]" />
                  ) : (
                    <FlashlightOff className="h-3.5 w-3.5 text-[#6B7280]" />
                  )}
                  <span>
                    {torchSupported === false
                      ? 'No Torch Hardware'
                      : torchOn
                        ? 'Flashlight On'
                        : 'Flashlight'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setContinuousMode((prev) => !prev)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    continuousMode
                      ? 'border-[#059669] bg-[#ECFDF5] text-[#065F46]'
                      : 'border-[#D1D5DB] bg-white text-[#111827] hover:bg-[#F6F9F7]'
                  }`}
                >
                  <Repeat className={`h-3.5 w-3.5 ${continuousMode ? 'animate-spin' : ''}`} />
                  <span>{continuousMode ? 'Continuous On' : 'Continuous'}</span>
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {!liveScanning ? (
                <button
                  type="button"
                  onClick={startLiveScanner}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#059669] px-3 py-2 text-xs font-medium text-white hover:bg-[#047857]"
                >
                  <Video className="h-3.5 w-3.5" />
                  <span>Start Live Barcode Cam</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopLiveScanner}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#DC2626] px-3 py-2 text-xs font-medium text-white hover:bg-[#B91C1C]"
                >
                  <span>Stop Scanner</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleEsp32BarcodeCapture}
                disabled={loadingLookup}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-xs font-medium text-[#111827] hover:bg-[#F6F9F7]"
              >
                <Camera className="h-3.5 w-3.5 text-[#059669]" />
                <span>ESP32-CAM Capture</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleToggleEspFlash}
              disabled={togglingEspFlash}
              className={`w-full inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                espFlashOn
                  ? 'border-[#F59E0B] bg-[#FFFBEB] text-[#B45309]'
                  : 'border-[#D1D5DB] bg-white text-[#374151] hover:bg-[#F6F9F7]'
              } disabled:opacity-60`}
            >
              {togglingEspFlash ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : espFlashOn ? (
                <Flashlight className="h-3.5 w-3.5 text-[#D97706]" />
              ) : (
                <FlashlightOff className="h-3.5 w-3.5 text-[#6B7280]" />
              )}
              <span>{espFlashOn ? 'ESP32-CAM LED Flash On' : 'ESP32-CAM Flashlight'}</span>
            </button>

            <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-[#D1D5DB] hover:border-[#059669] bg-[#F6F9F7] px-3 py-2.5 text-xs font-medium text-[#374151] cursor-pointer">
              <Upload className="h-3.5 w-3.5 text-[#059669]" />
              <span>Upload Barcode Photo</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleUploadBarcodeImage(e.target.files?.[0])}
              />
            </label>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (manualCode.trim()) runServerLookup(manualCode.trim(), 'Manual');
              }}
              className="pt-2 border-t border-[#E5EAE7] flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="h-3.5 w-3.5 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Enter barcode digits (e.g. 3017620422003)"
                  className="w-full rounded-lg border border-[#D1D5DB] pl-8 pr-3 py-2 text-xs font-mono focus:border-[#059669] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={loadingLookup || !manualCode.trim()}
                className="rounded-lg bg-[#0D2E22] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#133C2D] disabled:opacity-50 whitespace-nowrap"
              >
                Lookup
              </button>
            </form>
          </div>
        </div>

        {/* Lookup Result + Packaging OCR Pairing */}
        <div className="lg:col-span-7 rounded-xl border border-[#E5EAE7] bg-white p-6 space-y-5">
          {loadingLookup && (
            <div className="py-10 text-center space-y-2">
              <Loader2 className="h-6 w-6 text-[#059669] animate-spin mx-auto" />
              <p className="text-xs text-[#6B7280]">Decoding & querying product databases...</p>
            </div>
          )}

          {!loadingLookup && !decodedCode && (
            <div className="py-10 text-center space-y-2">
              <Barcode className="h-8 w-8 text-[#059669] mx-auto" />
              <h3 className="text-sm font-semibold text-[#111827]">Awaiting Barcode</h3>
              <p className="text-xs text-[#6B7280] max-w-md mx-auto">
                {statusMessage ||
                  'Scan a barcode with your camera, capture from ESP32-CAM, or enter a barcode number to look up product metadata.'}
              </p>
            </div>
          )}

          {!loadingLookup && decodedCode && (
            <>
              <div className="rounded-lg border border-[#E5EAE7] bg-[#F6F9F7] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <p className="text-xs text-[#6B7280]">Decoded Barcode ({decodedFormat || 'Barcode'})</p>
                  <p className="text-lg font-mono font-semibold text-[#111827] tabular-nums">
                    {decodedCode}
                  </p>
                </div>
                <div className="text-xs font-medium text-[#059669]">
                  {lookup?.foundInDatabase
                    ? `Matched via ${lookup.source.replace(/_/g, ' ')}`
                    : 'Not found in Open Food Facts'}
                </div>
              </div>

              {statusMessage && (
                <p className="text-xs text-[#4B5563] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3.5 py-2.5">
                  {statusMessage}
                </p>
              )}

              {savedRecord && (
                <div className="rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] p-3.5 flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-[#065F46]">
                    <CheckCircle2 className="h-4 w-4 text-[#059669]" />
                    Saved "{savedRecord.name}" to inventory.
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigate('inventory')}
                    className="text-xs font-semibold text-[#059669] hover:underline"
                  >
                    Open Inventory →
                  </button>
                </div>
              )}

              {/* Optional OCR Packaging Photo Upload or ESP32-CAM Capture for Expiry Date */}
              <div className="rounded-lg border border-[#E5EAE7] p-4 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[#111827]">
                      Read Expiry Date from Packaging (OCR)
                    </p>
                    <p className="text-[11px] text-[#6B7280]">
                      Barcodes never store expiry dates — capture or upload the EXP / BEST BEFORE print.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleEsp32DateOcr}
                      disabled={ocrRunning}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#059669] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#047857] disabled:opacity-60 whitespace-nowrap"
                    >
                      {ocrRunning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Camera className="h-3.5 w-3.5" />
                      )}
                      <span>{ocrRunning ? 'Reading Date...' : 'ESP32 Date OCR'}</span>
                    </button>
                    <label className="inline-flex items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#F6F9F7] cursor-pointer whitespace-nowrap">
                      <Upload className="h-3.5 w-3.5 text-[#059669]" />
                      <span>Upload Photo</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleRunOcrOnPackage(e.target.files?.[0])}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSaveBarcodeProduct} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-[#374151] mb-1">
                      Product Name
                    </label>
                    <input
                      type="text"
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      placeholder="Identified or manual product name"
                      required
                      className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm focus:border-[#059669] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#374151] mb-1">Brand</label>
                    <input
                      type="text"
                      value={productBrand}
                      onChange={(e) => setProductBrand(e.target.value)}
                      className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm focus:border-[#059669] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#374151] mb-1">Category</label>
                    <select
                      value={productCategory}
                      onChange={(e) => setProductCategory(e.target.value)}
                      className="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm focus:border-[#059669] focus:outline-none"
                    >
                      {PRODUCT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#374151] mb-1">
                      Expiry Date (YYYY-MM-DD or YYYY-MM)
                    </label>
                    <input
                      type="text"
                      value={ocrExpiry}
                      onChange={(e) => setOcrExpiry(e.target.value)}
                      placeholder="YYYY-MM-DD or YYYY-MM"
                      className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#374151] mb-1">
                      Batch Number
                    </label>
                    <input
                      type="text"
                      value={ocrBatch}
                      onChange={(e) => setOcrBatch(e.target.value)}
                      className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-[#059669] px-4 py-2 text-sm font-medium text-white hover:bg-[#047857] disabled:opacity-60"
                  >
                    {saving ? 'Saving...' : 'Save Product to Inventory'}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
