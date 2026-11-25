import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileImage,
  Flashlight,
  FlashlightOff,
  Loader2,
  RefreshCw,
  Repeat,
  RotateCw,
  ScanLine,
  Upload,
  Video,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import {
  PRODUCT_CATEGORIES,
  type CameraHealthStatus,
  type DatePrecision,
  type NavSection,
  type ProductRecord,
  type ScanProcessResponse,
  type ScanSource,
} from '../types';

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type TorchConstraints = MediaTrackConstraintSet & { torch?: boolean };

function compressImageDataUrl(file: File, maxDim = 1280, quality = 0.88): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image format.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function rotateDataUrl90(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Failed to rotate image.'));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.src = dataUrl;
  });
}

const WORKFLOW_STEPS = [
  'Capture product frame',
  'Decode barcode (ZXing)',
  'Lookup product database',
  'AI brand & category recognition',
  'OCR packaging text & dates',
  'Validate expiry vs MFG & save',
];

export function ScanProductPage({
  onNavigate,
  onProductSaved,
}: {
  onNavigate: (section: NavSection) => void;
  onProductSaved: (product: ProductRecord) => void;
}) {
  const [sourceMode, setSourceMode] = useState<ScanSource>('esp32_cam');
  const [cameraHealth, setCameraHealth] = useState<CameraHealthStatus | null>(null);
  const [checkingCam, setCheckingCam] = useState(false);

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [fastMode, setFastMode] = useState(true);
  const [rapidAutoScan, setRapidAutoScan] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number>(-1);
  const [scanResult, setScanResult] = useState<ScanProcessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Flashlight / Torch state
  const [espFlashOn, setEspFlashOn] = useState(false);
  const [togglingEspFlash, setTogglingEspFlash] = useState(false);
  const [torchSupported, setTorchSupported] = useState<boolean | null>(null);
  const [torchOn, setTorchOn] = useState(false);

  // Confirmation / edit state when confidence is insufficient or review needed
  const [editName, setEditName] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [editCategory, setEditCategory] = useState('Grocery');
  const [editBarcode, setEditBarcode] = useState('');
  const [editBatch, setEditBatch] = useState('');
  const [editMfgDate, setEditMfgDate] = useState('');
  const [editExpiryDate, setEditExpiryDate] = useState('');
  const [editPrecision, setEditPrecision] = useState<DatePrecision>('day');
  const [savingManual, setSavingManual] = useState(false);

  // Webcam state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);

  useEffect(() => {
    scanningRef.current = scanning;
  }, [scanning]);

  const stopWebcam = useCallback(() => {
    setRapidAutoScan(false);
    setTorchOn(false);
    setTorchSupported(null);
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setWebcamActive(false);
  }, []);

  useEffect(() => {
    return () => stopWebcam();
  }, [stopWebcam]);

  const checkEsp32 = async () => {
    setCheckingCam(true);
    try {
      const status = await api.checkCameraHealth();
      setCameraHealth(status);
    } catch (err) {
      setCameraHealth(null);
      setError(err instanceof Error ? err.message : 'Camera health check failed');
    } finally {
      setCheckingCam(false);
    }
  };

  useEffect(() => {
    setRapidAutoScan(false);
    if (sourceMode === 'esp32_cam') {
      stopWebcam();
      checkEsp32();
    } else if (sourceMode === 'upload') {
      stopWebcam();
    }
  }, [sourceMode, stopWebcam]);

  const startWebcam = async () => {
    setWebcamError(null);
    setTorchOn(false);
    setTorchSupported(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
        const caps = videoTrack.getCapabilities() as TorchCapabilities;
        setTorchSupported(Boolean(caps.torch));
      } else {
        setTorchSupported(false);
      }
      setWebcamActive(true);
    } catch (err) {
      setWebcamError(
        err instanceof Error
          ? `Camera access denied or unavailable: ${err.message}`
          : 'Unable to access device camera.'
      );
    }
  };

  const handleToggleDeviceTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
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

  const populateCandidateFields = (res: ScanProcessResponse) => {
    setEditName(res.candidate.name === 'Unidentified Product' ? '' : res.candidate.name);
    setEditBrand(res.candidate.brand || '');
    setEditCategory(res.candidate.category || 'Grocery');
    setEditBarcode(res.candidate.barcode || '');
    setEditBatch(res.candidate.batchNumber || '');
    setEditMfgDate(res.candidate.manufacturingDate || '');
    setEditExpiryDate(res.candidate.expiryDate || '');
    setEditPrecision(res.candidate.datePrecision || 'day');
  };

  const executePipeline = useCallback(
    async (imageDataUrl: string | undefined, source: ScanSource) => {
      setError(null);
      setScanResult(null);
      setScanning(true);
      setActiveStepIndex(0);

      const stepTimer = window.setInterval(
        () => {
          setActiveStepIndex((prev) => (prev < WORKFLOW_STEPS.length - 2 ? prev + 1 : prev));
        },
        fastMode ? 280 : 650
      );

      try {
        const res = await api.processScan({
          image: imageDataUrl,
          source,
          autoSave: true,
          fastMode,
        });
        window.clearInterval(stepTimer);
        setActiveStepIndex(WORKFLOW_STEPS.length - 1);
        setScanResult(res);
        if (res.candidate.imageData) {
          setCapturedImage(res.candidate.imageData);
        }
        populateCandidateFields(res);
        if (res.savedProduct) {
          onProductSaved(res.savedProduct);
        }
      } catch (err) {
        window.clearInterval(stepTimer);
        setActiveStepIndex(-1);
        setRapidAutoScan(false);
        setError(err instanceof Error ? err.message : 'Product scanning pipeline failed.');
      } finally {
        setScanning(false);
      }
    },
    [fastMode, onProductSaved]
  );

  const handleEsp32CaptureAndScan = useCallback(async () => {
    if (scanningRef.current) return;
    setError(null);
    setScanning(true);
    setActiveStepIndex(0);
    try {
      const frame = await api.captureCameraFrame();
      setCapturedImage(frame.imageDataUrl);
      await executePipeline(frame.imageDataUrl, 'esp32_cam');
    } catch (err) {
      setScanning(false);
      setActiveStepIndex(-1);
      setRapidAutoScan(false);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to capture frame from ESP32-CAM. Check camera connection.'
      );
    }
  }, [executePipeline]);

  const handleWebcamCaptureAndScan = useCallback(async () => {
    if (!videoRef.current || scanningRef.current) return;
    const video = videoRef.current;
    const srcW = video.videoWidth || 1280;
    const srcH = video.videoHeight || 720;
    const maxDim = fastMode ? 1024 : 1280;
    let dstW = srcW;
    let dstH = srcH;
    if (srcW > maxDim || srcH > maxDim) {
      if (srcW >= srcH) {
        dstH = Math.round((srcH * maxDim) / srcW);
        dstW = maxDim;
      } else {
        dstW = Math.round((srcW * maxDim) / srcH);
        dstH = maxDim;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, dstW, dstH);
    const dataUrl = canvas.toDataURL('image/jpeg', fastMode ? 0.84 : 0.9);
    setCapturedImage(dataUrl);
    await executePipeline(dataUrl, 'webcam');
  }, [executePipeline, fastMode]);

  useEffect(() => {
    if (!rapidAutoScan) return;
    if (sourceMode === 'webcam' && !webcamActive) return;
    if (sourceMode === 'upload') return;

    const timer = window.setInterval(() => {
      if (scanningRef.current) return;
      if (sourceMode === 'webcam' && webcamActive) {
        void handleWebcamCaptureAndScan();
      } else if (sourceMode === 'esp32_cam') {
        void handleEsp32CaptureAndScan();
      }
    }, 2200);

    return () => window.clearInterval(timer);
  }, [
    rapidAutoScan,
    sourceMode,
    webcamActive,
    handleWebcamCaptureAndScan,
    handleEsp32CaptureAndScan,
  ]);

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await compressImageDataUrl(
        file,
        fastMode ? 1024 : 1280,
        fastMode ? 0.84 : 0.88
      );
      setCapturedImage(dataUrl);
      await executePipeline(dataUrl, 'upload');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load image file.');
    }
  };

  const handleConfirmSave = async (allowDuplicate = false) => {
    if (!editName.trim()) {
      setError('Please enter or confirm the product name before saving.');
      return;
    }
    setError(null);
    setSavingManual(true);
    try {
      const saved = await api.createProduct({
        name: editName.trim(),
        brand: editBrand.trim() || null,
        category: editCategory,
        barcode: editBarcode.trim() || null,
        barcodeFormat: scanResult?.candidate.barcodeFormat || null,
        batchNumber: editBatch.trim() || null,
        manufacturingDate: editMfgDate.trim() || null,
        expiryDate: editExpiryDate.trim() || null,
        datePrecision: editExpiryDate.trim() ? editPrecision : 'unknown',
        imageData: capturedImage,
        ocrRawText: scanResult?.candidate.ocrRawText || null,
        detectedDates: scanResult?.candidate.detectedDates || [],
        confidence: scanResult?.candidate.confidence ?? 0.8,
        verificationStatus: 'verified',
        scanSource: sourceMode,
        allowDuplicate,
      });
      setScanResult((prev) =>
        prev
          ? {
              ...prev,
              status: 'auto_saved',
              savedProduct: saved,
              duplicateProduct: null,
            }
          : prev
      );
      onProductSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save confirmed product.');
    } finally {
      setSavingManual(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Capture Source & Speed Mode Selector */}
      <div className="rounded-xl border border-[#E5EAE7] bg-white p-5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#111827]">
            Automated Product & Expiry Scanner
          </h2>
          <p className="text-xs text-[#6B7280]">
            {fastMode
              ? 'Fast Scan active: low-latency AI OCR + parallel barcode lookup (~1–2s per item)'
              : 'Deep Dual-OCR active: parallel Tesseract + Gemini high-precision extraction'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start xl:self-center">
          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3F6F4] border border-[#E5EAE7]">
            <button
              type="button"
              onClick={() => setFastMode(true)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                fastMode
                  ? 'bg-[#059669] text-white shadow-sm'
                  : 'text-[#4B5563] hover:text-[#111827]'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Fast Scan</span>
            </button>
            <button
              type="button"
              onClick={() => setFastMode(false)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                !fastMode
                  ? 'bg-[#0D2E22] text-white shadow-sm'
                  : 'text-[#4B5563] hover:text-[#111827]'
              }`}
            >
              <span>Deep Dual-OCR</span>
            </button>
          </div>

          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#F3F6F4] border border-[#E5EAE7]">
            <button
              type="button"
              onClick={() => setSourceMode('esp32_cam')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                sourceMode === 'esp32_cam'
                  ? 'bg-white text-[#0D2E22] shadow-sm'
                  : 'text-[#4B5563] hover:text-[#111827]'
              }`}
            >
              <Camera className="h-3.5 w-3.5" />
              <span>ESP32-CAM</span>
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('webcam')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                sourceMode === 'webcam'
                  ? 'bg-white text-[#0D2E22] shadow-sm'
                  : 'text-[#4B5563] hover:text-[#111827]'
              }`}
            >
              <Video className="h-3.5 w-3.5" />
              <span>Device Camera</span>
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('upload')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                sourceMode === 'upload'
                  ? 'bg-white text-[#0D2E22] shadow-sm'
                  : 'text-[#4B5563] hover:text-[#111827]'
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Upload Photo</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm text-[#991B1B] flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">{error}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Capture & Pipeline Steps */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-xl border border-[#E5EAE7] bg-white p-5 space-y-4">
            {sourceMode === 'esp32_cam' && (
              <>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-[#374151]">
                    ESP32-CAM ({cameraHealth?.deviceIp ? `${cameraHealth.deviceIp} · Cloud API` : 'Cloud API'})
                  </div>
                  <button
                    type="button"
                    onClick={checkEsp32}
                    disabled={checkingCam}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#059669] hover:text-[#047857]"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${checkingCam ? 'animate-spin' : ''}`} />
                    <span>Verify Capture</span>
                  </button>
                </div>

                {cameraHealth && !cameraHealth.connected && (
                  <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3.5 text-xs text-[#92400E] space-y-2">
                    <p className="font-semibold">{cameraHealth.message}</p>
                    {cameraHealth.error && <p className="font-mono text-[11px]">{cameraHealth.error}</p>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => onNavigate('camera')}
                        className="rounded-md bg-[#0D2E22] text-white px-2.5 py-1 text-xs font-medium hover:bg-[#133C2D]"
                      >
                        Setup Cloud Camera
                      </button>
                      <button
                        type="button"
                        onClick={() => setSourceMode('upload')}
                        className="rounded-md border border-[#D97706]/30 bg-white px-2.5 py-1 text-xs font-medium text-[#92400E] hover:bg-[#FEF3C7]"
                      >
                        Use Photo Upload Instead
                      </button>
                    </div>
                  </div>
                )}

                {cameraHealth?.connected && (
                  <div className="rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-3.5 py-2.5 text-xs text-[#065F46] flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <span className="h-2 w-2 rounded-full bg-[#059669]" />
                      Connected via Cloud API
                    </span>
                    <span className="font-mono tabular-nums">{cameraHealth.latencyMs}ms</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleToggleEspFlash}
                    disabled={togglingEspFlash}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      espFlashOn
                        ? 'border-[#F59E0B] bg-[#FFFBEB] text-[#B45309]'
                        : 'border-[#D1D5DB] bg-white text-[#111827] hover:bg-[#F6F9F7]'
                    } disabled:opacity-60`}
                  >
                    {togglingEspFlash ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : espFlashOn ? (
                      <Flashlight className="h-3.5 w-3.5 text-[#D97706]" />
                    ) : (
                      <FlashlightOff className="h-3.5 w-3.5 text-[#6B7280]" />
                    )}
                    <span>{espFlashOn ? 'LED Flash On' : 'Flashlight'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRapidAutoScan((prev) => !prev)}
                    disabled={!cameraHealth?.connected && !rapidAutoScan}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      rapidAutoScan
                        ? 'border-[#059669] bg-[#ECFDF5] text-[#065F46]'
                        : 'border-[#D1D5DB] bg-white text-[#111827] hover:bg-[#F6F9F7]'
                    } disabled:opacity-50`}
                  >
                    <Repeat className={`h-3.5 w-3.5 ${rapidAutoScan ? 'animate-spin' : ''}`} />
                    <span>{rapidAutoScan ? 'Auto-Scan On' : 'Rapid Auto-Scan'}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleEsp32CaptureAndScan}
                  disabled={scanning}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#059669] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#047857] disabled:opacity-60 transition-colors"
                >
                  {scanning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : fastMode ? (
                    <Zap className="h-4 w-4" />
                  ) : (
                    <ScanLine className="h-4 w-4" />
                  )}
                  <span>
                    {scanning
                      ? 'Scanning Product...'
                      : fastMode
                        ? 'Fast Capture & Scan (ESP32-CAM)'
                        : 'Capture & Scan with ESP32-CAM'}
                  </span>
                </button>
              </>
            )}

            {sourceMode === 'webcam' && (
              <>
                <div className="aspect-[4/3] w-full rounded-lg bg-[#0D2E22] overflow-hidden relative flex items-center justify-center border border-[#E5EAE7]">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`h-full w-full object-cover ${webcamActive ? 'block' : 'hidden'}`}
                  />
                  {webcamActive && rapidAutoScan && (
                    <div className="absolute top-2.5 left-2.5 rounded-md bg-[#059669]/90 px-2.5 py-1 text-[11px] font-medium text-white inline-flex items-center gap-1.5">
                      <Repeat className="h-3 w-3 animate-spin" />
                      <span>Rapid Auto-Scan Active</span>
                    </div>
                  )}
                  {!webcamActive && (
                    <div className="text-center p-4 space-y-2">
                      <Video className="h-8 w-8 text-[#A7F3D0] mx-auto" />
                      <p className="text-xs text-white/80">
                        {webcamError || 'Start your device camera to capture packaging and barcodes.'}
                      </p>
                    </div>
                  )}
                </div>

                {webcamActive && (
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
                      onClick={() => setRapidAutoScan((prev) => !prev)}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                        rapidAutoScan
                          ? 'border-[#059669] bg-[#ECFDF5] text-[#065F46]'
                          : 'border-[#D1D5DB] bg-white text-[#111827] hover:bg-[#F6F9F7]'
                      }`}
                    >
                      <Repeat className={`h-3.5 w-3.5 ${rapidAutoScan ? 'animate-spin' : ''}`} />
                      <span>{rapidAutoScan ? 'Auto-Scan On' : 'Rapid Auto-Scan'}</span>
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {!webcamActive ? (
                    <button
                      type="button"
                      onClick={startWebcam}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#0D2E22] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#133C2D]"
                    >
                      <Video className="h-4 w-4" />
                      <span>Enable Camera</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={handleWebcamCaptureAndScan}
                        disabled={scanning}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#059669] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#047857] disabled:opacity-60"
                      >
                        {scanning ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : fastMode ? (
                          <Zap className="h-4 w-4" />
                        ) : (
                          <ScanLine className="h-4 w-4" />
                        )}
                        <span>
                          {scanning
                            ? 'Processing...'
                            : fastMode
                              ? 'Fast Snap & Analyze'
                              : 'Capture & Analyze'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={stopWebcam}
                        className="rounded-lg border border-[#D1D5DB] px-3 py-2.5 text-xs font-medium text-[#374151] hover:bg-[#F9FAFB]"
                      >
                        Stop
                      </button>
                    </>
                  )}
                </div>
              </>
            )}

            {sourceMode === 'upload' && (
              <label className="block cursor-pointer rounded-lg border-2 border-dashed border-[#D1D5DB] hover:border-[#059669] bg-[#F6F9F7] p-8 text-center transition-colors">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFileSelected(e.target.files?.[0])}
                />
                <FileImage className="h-8 w-8 text-[#059669] mx-auto mb-2" />
                <p className="text-sm font-medium text-[#111827]">
                  Select or drop a product packaging photo
                </p>
                <p className="text-xs text-[#6B7280] mt-1">
                  JPEG or PNG showing product label, barcode, or printed EXP / BEST BEFORE date
                </p>
              </label>
            )}

            {capturedImage && (
              <div className="pt-2 border-t border-[#E5EAE7]">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-medium text-[#4B5563]">Captured Frame</span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const rotated = await rotateDataUrl90(capturedImage);
                          setCapturedImage(rotated);
                          await executePipeline(rotated, sourceMode);
                        } catch {
                          // ignore
                        }
                      }}
                      disabled={scanning}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#374151] hover:text-[#111827] disabled:opacity-50"
                    >
                      <RotateCw className="h-3 w-3" />
                      <span>Rotate 90° & Scan</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => executePipeline(capturedImage, sourceMode)}
                      disabled={scanning}
                      className="text-xs font-medium text-[#059669] hover:text-[#047857] disabled:opacity-50"
                    >
                      Re-run OCR & AI
                    </button>
                  </div>
                </div>
                <img
                  src={capturedImage}
                  alt="Captured product packaging"
                  referrerPolicy="no-referrer"
                  className="w-full max-h-60 object-contain rounded-lg border border-[#E5EAE7] bg-[#F9FAFB]"
                />
              </div>
            )}
          </div>

          {/* Workflow Pipeline Steps */}
          <div className="rounded-xl border border-[#E5EAE7] bg-white p-5">
            <h3 className="text-xs font-semibold text-[#374151] mb-3">
              Automatic Recognition Pipeline
            </h3>
            <ol className="space-y-2.5">
              {WORKFLOW_STEPS.map((step, idx) => {
                const done = scanResult !== null || (!scanning && activeStepIndex >= idx);
                const current = scanning && activeStepIndex === idx;
                return (
                  <li key={step} className="flex items-center gap-2.5 text-xs">
                    {current ? (
                      <Loader2 className="h-3.5 w-3.5 text-[#059669] animate-spin shrink-0" />
                    ) : done && activeStepIndex >= idx ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#059669] shrink-0" />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full border border-[#D1D5DB] inline-flex items-center justify-center text-[10px] text-[#6B7280] shrink-0 tabular-nums">
                        {idx + 1}
                      </span>
                    )}
                    <span
                      className={
                        current || (done && activeStepIndex >= idx)
                          ? 'text-[#111827] font-medium'
                          : 'text-[#6B7280]'
                      }
                    >
                      {step}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* Right: Results, Detected Dates & Verification */}
        <div className="lg:col-span-7 space-y-4">
          {!scanResult && !scanning && (
            <div className="rounded-xl border border-[#E5EAE7] bg-white p-10 text-center space-y-2">
              <ScanLine className="h-8 w-8 text-[#059669] mx-auto" />
              <h3 className="text-base font-semibold text-[#111827]">Ready for Packaging Scan</h3>
              <p className="text-xs text-[#6B7280] max-w-md mx-auto">
                Capture a frame from ESP32-CAM, use your device camera, or upload a packaging image.
                Results will display barcode evidence, AI product identification, and all extracted dates.
              </p>
            </div>
          )}

          {scanning && (
            <div className="rounded-xl border border-[#E5EAE7] bg-white p-10 text-center space-y-3">
              <Loader2 className="h-8 w-8 text-[#059669] animate-spin mx-auto" />
              <p className="text-sm font-medium text-[#111827]">
                Decoding barcode and analyzing packaging OCR...
              </p>
              <p className="text-xs text-[#6B7280]">
                Distinguishing manufacturing dates from expiry dates and validating calendar values
              </p>
            </div>
          )}

          {scanResult && (
            <div className="rounded-xl border border-[#E5EAE7] bg-white p-6 space-y-6">
              {/* Status Banner */}
              {scanResult.status === 'auto_saved' && scanResult.savedProduct && (
                <div className="rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] p-4 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="h-4 w-4 text-[#059669] mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-[#065F46]">
                        Automatically Verified & Saved
                      </p>
                      <p className="text-xs text-[#047857] mt-0.5 tabular-nums">
                        {scanResult.savedProduct.name} · Confidence{' '}
                        {Math.round(scanResult.candidate.confidence * 100)}%
                        {scanResult.savedProduct.expiryDate
                          ? ` · Expiry ${scanResult.savedProduct.expiryDate}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('inventory')}
                    className="rounded-md bg-[#059669] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#047857] whitespace-nowrap"
                  >
                    View Inventory
                  </button>
                </div>
              )}

              {scanResult.status === 'duplicate_detected' && scanResult.duplicateProduct && (
                <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4 space-y-2">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-[#D97706] mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-[#92400E]">
                        Duplicate Product Entry Prevented
                      </p>
                      <p className="text-xs text-[#92400E] mt-0.5">
                        Matches existing record "{scanResult.duplicateProduct.name}" (Expiry{' '}
                        {scanResult.duplicateProduct.expiryDate || 'Unknown'}).
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleConfirmSave(true)}
                      disabled={savingManual}
                      className="rounded-md bg-[#D97706] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#B45309]"
                    >
                      Save Separate Entry Anyway
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate('inventory')}
                      className="rounded-md border border-[#D97706]/40 bg-white px-3 py-1.5 text-xs font-medium text-[#92400E]"
                    >
                      Inspect Existing Inventory
                    </button>
                  </div>
                </div>
              )}

              {scanResult.status === 'needs_confirmation' && (
                <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#92400E]">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>Confirmation Needed Before Saving</span>
                  </div>
                  <ul className="list-disc pl-5 text-xs text-[#92400E] space-y-0.5">
                    {scanResult.uncertainReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                    {scanResult.aiError && <li>AI note: {scanResult.aiError}</li>}
                  </ul>
                </div>
              )}

              {scanResult.aiReasoningNote && (
                <p className="text-xs text-[#065F46] bg-[#ECFDF5] border border-[#A7F3D0] rounded-lg px-3.5 py-2">
                  {scanResult.aiReasoningNote}
                </p>
              )}

              {/* Detected Dates Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-[#111827]">
                    Extracted Packaging Dates ({scanResult.candidate.detectedDates.length})
                  </h3>
                  <span className="text-xs font-mono text-[#6B7280] tabular-nums">
                    {scanResult.scanDurationMs !== undefined
                      ? `${(scanResult.scanDurationMs / 1000).toFixed(2)}s (${
                          scanResult.scanMode === 'fast' ? 'Fast' : 'Deep'
                        }) · `
                      : ''}
                    Confidence {Math.round(scanResult.candidate.confidence * 100)}%
                  </span>
                </div>

                {scanResult.candidate.detectedDates.length === 0 ? (
                  <p className="text-xs text-[#6B7280] rounded-lg border border-[#E5EAE7] bg-[#F6F9F7] p-3">
                    No valid calendar dates were read from this frame. Capture a sharper close-up of
                    the printed date stamp or enter the date manually below.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-[#E5EAE7]">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#F6F9F7] text-[#4B5563] border-b border-[#E5EAE7]">
                        <tr>
                          <th className="px-3 py-2 font-medium">Printed Text</th>
                          <th className="px-3 py-2 font-medium">Role</th>
                          <th className="px-3 py-2 font-medium">Normalized</th>
                          <th className="px-3 py-2 font-medium">Precision</th>
                          <th className="px-3 py-2 font-medium text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5EAE7]">
                        {scanResult.candidate.detectedDates.map((d, idx) => (
                          <tr key={`${d.raw}-${idx}`}>
                            <td className="px-3 py-2 font-mono text-[#111827]">{d.raw}</td>
                            <td className="px-3 py-2 capitalize">
                              <span
                                className={
                                  d.role === 'expiry'
                                    ? 'text-[#059669] font-medium'
                                    : d.role === 'manufacturing'
                                      ? 'text-[#4B5563]'
                                      : 'text-[#D97706]'
                                }
                              >
                                {d.role}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono tabular-nums">
                              {d.normalized || '—'}
                            </td>
                            <td className="px-3 py-2 capitalize text-[#6B7280]">{d.precision}</td>
                            <td className="px-3 py-2 text-right">
                              {d.normalized && scanResult.status !== 'auto_saved' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditExpiryDate(d.normalized || '');
                                    setEditPrecision(d.precision);
                                  }}
                                  className="text-xs font-medium text-[#059669] hover:underline"
                                >
                                  Use as Expiry
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Editable Confirmation Form (shown when not yet saved) */}
              {scanResult.status !== 'auto_saved' && (
                <div className="space-y-4 pt-2 border-t border-[#E5EAE7]">
                  <h3 className="text-sm font-semibold text-[#111827]">
                    Review & Save Product Details
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-[#374151] mb-1">
                        Product Name
                      </label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Enter product name if unidentified"
                        className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm focus:border-[#059669] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#374151] mb-1">Brand</label>
                      <input
                        type="text"
                        value={editBrand}
                        onChange={(e) => setEditBrand(e.target.value)}
                        className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm focus:border-[#059669] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#374151] mb-1">
                        Category
                      </label>
                      <select
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
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
                        Barcode
                      </label>
                      <input
                        type="text"
                        value={editBarcode}
                        onChange={(e) => setEditBarcode(e.target.value)}
                        className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#374151] mb-1">
                        Batch / Lot Number
                      </label>
                      <input
                        type="text"
                        value={editBatch}
                        onChange={(e) => setEditBatch(e.target.value)}
                        className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#374151] mb-1">
                        Manufacturing Date (MFG)
                      </label>
                      <input
                        type="text"
                        placeholder="YYYY-MM-DD or YYYY-MM"
                        value={editMfgDate}
                        onChange={(e) => setEditMfgDate(e.target.value)}
                        className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#374151] mb-1">
                        Expiry Date (EXP / Best Before)
                      </label>
                      <input
                        type="text"
                        placeholder="YYYY-MM-DD or YYYY-MM"
                        value={editExpiryDate}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditExpiryDate(val);
                          if (/^\d{4}-\d{2}$/.test(val.trim())) setEditPrecision('month');
                          else if (/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) setEditPrecision('day');
                        }}
                        className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:border-[#059669] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => handleConfirmSave(false)}
                      disabled={savingManual}
                      className="rounded-lg bg-[#059669] px-4 py-2 text-sm font-medium text-white hover:bg-[#047857] disabled:opacity-60"
                    >
                      {savingManual ? 'Saving...' : 'Confirm & Save Product'}
                    </button>
                  </div>
                </div>
              )}

              {/* Preserved OCR Raw Text */}
              <div className="pt-2 border-t border-[#E5EAE7]">
                <p className="text-xs font-medium text-[#4B5563] mb-1.5">
                  Preserved OCR Extracted Text
                </p>
                <pre className="rounded-lg bg-[#F6F9F7] border border-[#E5EAE7] p-3 text-xs font-mono text-[#374151] whitespace-pre-wrap max-h-36 overflow-y-auto">
                  {scanResult.candidate.ocrRawText || 'No readable text extracted from image.'}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
