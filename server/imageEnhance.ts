import jpeg from 'jpeg-js';
import pngjsPkg from 'pngjs';

const { PNG } = pngjsPkg;

interface RawRgba {
  width: number;
  height: number;
  data: Uint8Array;
}

function decodeToRgba(buffer: Buffer): RawRgba {
  if (
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height, data: png.data };
  }
  const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
  return { width: decoded.width, height: decoded.height, data: decoded.data };
}

function downscaleRgbaIfNeeded(img: RawRgba, maxDim: number): RawRgba {
  if (img.width <= maxDim && img.height <= maxDim) return img;
  const scale = maxDim / Math.max(img.width, img.height);
  const dstW = Math.max(1, Math.round(img.width * scale));
  const dstH = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8Array(dstW * dstH * 4);

  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(img.width - 1, Math.floor(x / scale));
      const srcIdx = (srcY * img.width + srcX) * 4;
      const dstIdx = (y * dstW + x) * 4;
      out[dstIdx] = img.data[srcIdx];
      out[dstIdx + 1] = img.data[srcIdx + 1];
      out[dstIdx + 2] = img.data[srcIdx + 2];
      out[dstIdx + 3] = 255;
    }
  }
  return { width: dstW, height: dstH, data: out };
}

function rotateRgba(img: RawRgba, deg: 0 | 90 | 180 | 270): RawRgba {
  if (deg === 0) return img;
  const { width: w, height: h, data } = img;
  if (deg === 180) {
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4;
        const d = ((h - 1 - y) * w + (w - 1 - x)) * 4;
        out[d] = data[s];
        out[d + 1] = data[s + 1];
        out[d + 2] = data[s + 2];
        out[d + 3] = 255;
      }
    }
    return { width: w, height: h, data: out };
  }

  const out = new Uint8Array(w * h * 4);
  const dstW = h;
  const dstH = w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const dx = deg === 90 ? h - 1 - y : y;
      const dy = deg === 90 ? x : w - 1 - x;
      const d = (dy * dstW + dx) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = 255;
    }
  }
  return { width: dstW, height: dstH, data: out };
}

/**
 * Generates a contrast-stretched, lightly sharpened JPEG image to make faint,
 * dot-matrix, embossed, or dim ESP32-CAM date stamps clearly readable for OCR & AI.
 */
export function createHighContrastJpeg(
  buffer: Buffer,
  options?: { rotateDeg?: 0 | 90 | 180 | 270; maxDim?: number }
): Buffer | null {
  try {
    const maxDim = options?.maxDim ?? 1280;
    const rotateDeg = options?.rotateDeg ?? 0;
    let img = downscaleRgbaIfNeeded(decodeToRgba(buffer), maxDim);
    img = rotateRgba(img, rotateDeg);

    const { width, height, data } = img;
    const totalPixels = width * height;
    const lum = new Uint8Array(totalPixels);
    const hist = new Uint32Array(256);

    for (let i = 0, p = 0; i < totalPixels; i++, p += 4) {
      const y = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
      lum[i] = y;
      hist[y]++;
    }

    // 2nd to 98th percentile contrast stretch
    const lowTarget = Math.floor(totalPixels * 0.02);
    const highTarget = Math.floor(totalPixels * 0.98);
    let cum = 0;
    let low = 0;
    let high = 255;
    for (let v = 0; v < 256; v++) {
      cum += hist[v];
      if (cum >= lowTarget) {
        low = v;
        break;
      }
    }
    cum = 0;
    for (let v = 255; v >= 0; v--) {
      cum += hist[v];
      if (cum >= totalPixels - highTarget) {
        high = v;
        break;
      }
    }
    const span = Math.max(24, high - low);

    const stretched = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      const norm = ((lum[i] - low) * 255) / span;
      stretched[i] = norm < 0 ? 0 : norm > 255 ? 255 : Math.round(norm);
    }

    // Light unsharp / edge enhancement on interior pixels
    const outRgba = new Uint8Array(totalPixels * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        let val = stretched[idx];
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
          const sharp =
            5 * val -
            stretched[idx - 1] -
            stretched[idx + 1] -
            stretched[idx - width] -
            stretched[idx + width];
          // Blend 55% stretched + 45% sharpened to avoid ringing noise
          val = Math.max(0, Math.min(255, Math.round(val * 0.55 + sharp * 0.45)));
        }
        const p = idx * 4;
        outRgba[p] = val;
        outRgba[p + 1] = val;
        outRgba[p + 2] = val;
        outRgba[p + 3] = 255;
      }
    }

    const encoded = jpeg.encode({ width, height, data: outRgba }, 88);
    return Buffer.from(encoded.data);
  } catch {
    return null;
  }
}

export function rotateImageJpeg(buffer: Buffer, rotateDeg: 90 | 180 | 270): Buffer | null {
  try {
    const img = rotateRgba(downscaleRgbaIfNeeded(decodeToRgba(buffer), 1280), rotateDeg);
    const encoded = jpeg.encode({ width: img.width, height: img.height, data: img.data }, 88);
    return Buffer.from(encoded.data);
  } catch {
    return null;
  }
}
