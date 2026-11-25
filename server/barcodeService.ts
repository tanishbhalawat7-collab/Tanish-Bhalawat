import zxingPkg from '@zxing/library';
import jpeg from 'jpeg-js';
import pngjsPkg from 'pngjs';
import { findProductByBarcode } from './db.ts';

const {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} = zxingPkg;
const { PNG } = pngjsPkg;

export interface DecodedBarcodeResult {
  found: boolean;
  code: string | null;
  format: string | null;
  error?: string;
}

export interface BarcodeLookupResult {
  barcode: string;
  foundInDatabase: boolean;
  source: 'local_db' | 'open_food_facts' | 'open_beauty_facts' | 'none';
  name: string | null;
  brand: string | null;
  category: string | null;
  quantity: string | null;
  imageUrl: string | null;
  note: string;
}

const SUPPORTED_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.QR_CODE,
];

function formatName(fmt: number): string {
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

function decodeRawImageToRgba(buffer: Buffer): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  // Check PNG signature
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

  // Default to JPEG
  const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
  return {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data,
  };
}

function rgbaToGrayscaleLuminance(
  rgba: Uint8Array,
  width: number,
  height: number
): Uint8ClampedArray {
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    lum[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return lum;
}

function rotateLuminance90(
  lum: Uint8ClampedArray,
  width: number,
  height: number
): { lum: Uint8ClampedArray; width: number; height: number } {
  const rotated = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = y * width + x;
      const dstX = height - 1 - y;
      const dstY = x;
      rotated[dstY * height + dstX] = lum[srcIdx];
    }
  }
  return { lum: rotated, width: height, height: width };
}

function tryDecodeLuminance(
  lum: Uint8ClampedArray,
  width: number,
  height: number
): DecodedBarcodeResult | null {
  const reader = new MultiFormatReader();
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);

  const source = new RGBLuminanceSource(lum, width, height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  try {
    const result = reader.decode(bitmap);
    return {
      found: true,
      code: result.getText(),
      format: formatName(result.getBarcodeFormat()),
    };
  } catch {
    return null;
  }
}

export function decodeBarcodeFromBuffer(buffer: Buffer): DecodedBarcodeResult {
  try {
    const { width, height, data } = decodeRawImageToRgba(buffer);
    const lum0 = rgbaToGrayscaleLuminance(data, width, height);
    const res0 = tryDecodeLuminance(lum0, width, height);
    if (res0) return res0;

    // Try 90-degree rotated orientation for vertical barcodes
    const rot = rotateLuminance90(lum0, width, height);
    const res90 = tryDecodeLuminance(rot.lum, rot.width, rot.height);
    if (res90) return res90;

    return { found: false, code: null, format: null };
  } catch (err) {
    return {
      found: false,
      code: null,
      format: null,
      error: err instanceof Error ? err.message : 'Unable to decode image for barcode scanning',
    };
  }
}

function mapOffCategory(categoriesTags?: string[], categoriesStr?: string): string {
  const joined = [...(categoriesTags || []), categoriesStr || ''].join(' ').toLowerCase();
  if (/medicine|pharma|drug|vitamin|supplement|tablet|capsule|syrup/.test(joined)) {
    return 'Medicine';
  }
  if (/beverage|drink|juice|soda|water|coffee|tea/.test(joined)) {
    return 'Beverages';
  }
  if (/dairy|milk|cheese|yogurt|butter/.test(joined)) {
    return 'Dairy';
  }
  if (/clean|detergent|soap|household|disinfectant|paper/.test(joined)) {
    return 'Household';
  }
  if (/shampoo|cosmetic|skin|toothpaste|personal/.test(joined)) {
    return 'Personal Care';
  }
  if (/snack|biscuit|cereal|bread|pasta|sauce|food|chocolate/.test(joined)) {
    return 'Food';
  }
  return 'Grocery';
}

export async function lookupBarcodeDatabase(
  barcode: string,
  options?: { timeoutMs?: number }
): Promise<BarcodeLookupResult> {
  const cleanCode = barcode.trim();
  if (!cleanCode) {
    return {
      barcode: '',
      foundInDatabase: false,
      source: 'none',
      name: null,
      brand: null,
      category: null,
      quantity: null,
      imageUrl: null,
      note: 'Empty barcode supplied.',
    };
  }

  // 1. Check local SQLite database first (instant)
  const localMatch = findProductByBarcode(cleanCode);
  if (localMatch) {
    return {
      barcode: cleanCode,
      foundInDatabase: true,
      source: 'local_db',
      name: localMatch.name,
      brand: localMatch.brand,
      category: localMatch.category,
      quantity: null,
      imageUrl: null,
      note: 'Matched from local inventory history. Expiry date must still be read from physical packaging OCR.',
    };
  }

  // 2. Query Open Food Facts & Open Beauty Facts APIs in parallel for low latency
  const timeoutMs = options?.timeoutMs ?? 2800;
  const endpoints: Array<{
    url: string;
    source: 'open_food_facts' | 'open_beauty_facts';
  }> = [
    {
      url: `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanCode)}.json`,
      source: 'open_food_facts',
    },
    {
      url: `https://world.openbeautyfacts.org/api/v2/product/${encodeURIComponent(cleanCode)}.json`,
      source: 'open_beauty_facts',
    },
  ];

  const results = await Promise.all(
    endpoints.map(async (ep): Promise<BarcodeLookupResult | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(ep.url, {
          headers: {
            'User-Agent': 'FreshVibeExpiryTracker/1.0 (https://freshvibe.local)',
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
        if (!resp.ok) return null;
        const json = (await resp.json()) as {
          status?: number;
          product?: {
            product_name?: string;
            product_name_en?: string;
            brands?: string;
            categories?: string;
            categories_tags?: string[];
            quantity?: string;
            image_front_small_url?: string;
          };
        };
        if (json.status === 1 && json.product) {
          const name = (json.product.product_name_en || json.product.product_name || '').trim();
          if (name) {
            return {
              barcode: cleanCode,
              foundInDatabase: true,
              source: ep.source,
              name,
              brand: json.product.brands?.split(',')[0]?.trim() || null,
              category: mapOffCategory(json.product.categories_tags, json.product.categories),
              quantity: json.product.quantity || null,
              imageUrl: json.product.image_front_small_url || null,
              note: 'Identified via Open Food/Product Facts. Barcodes do not encode expiry dates — capture packaging text for OCR date detection.',
            };
          }
        }
        return null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    })
  );

  const matched = results.find((r) => r !== null);
  if (matched) return matched;

  return {
    barcode: cleanCode,
    foundInDatabase: false,
    source: 'none',
    name: null,
    brand: null,
    category: null,
    quantity: null,
    imageUrl: null,
    note: 'Barcode decoded, but product is not listed in Open Food Facts. Use AI image recognition + packaging OCR to identify product and expiry date.',
  };
}

export function checkBarcodeEngineHealth(): { ok: boolean; formats: string[] } {
  try {
    const reader = new MultiFormatReader();
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
    reader.setHints(hints);
    return {
      ok: true,
      formats: SUPPORTED_FORMATS.map(formatName),
    };
  } catch {
    return { ok: false, formats: [] };
  }
}
