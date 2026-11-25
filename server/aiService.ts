import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import Tesseract from 'tesseract.js';
import {
  classifyLabelRole,
  computeShelfLifeExpiry,
  extractDatesAndBatchFromText,
  extractRelativeShelfLife,
  parseFlexibleDateFragment,
} from './dateParser.ts';
import { createHighContrastJpeg } from './imageEnhance.ts';
import type { DatePrecision, DetectedDateEntry } from './types.ts';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface TesseractOcrOutput {
  ok: boolean;
  rawText: string;
  confidence: number;
  error?: string;
}

export async function runTesseractOcr(imageBuffer: Buffer): Promise<TesseractOcrOutput> {
  try {
    const result = await Tesseract.recognize(imageBuffer, 'eng');
    const rawText = (result.data.text || '').trim();
    const rawConf = typeof result.data.confidence === 'number' ? result.data.confidence : 0;
    return {
      ok: true,
      rawText,
      confidence: Math.max(0, Math.min(1, rawConf / 100)),
    };
  } catch (err) {
    return {
      ok: false,
      rawText: '',
      confidence: 0,
      error: err instanceof Error ? err.message : 'Tesseract OCR failed',
    };
  }
}

export interface AiExtractedDate {
  rawText: string;
  label: string;
  role: 'expiry' | 'manufacturing' | 'unknown';
  dateString: string;
  normalizedIsoDate?: string;
}

export interface AiRecognitionOutput {
  available: boolean;
  error?: string;
  productName: string | null;
  brand: string | null;
  category: string | null;
  visibleText: string;
  batchNumber: string | null;
  barcodeDigits: string | null;
  extractedDates: AiExtractedDate[];
  relativeShelfLife: {
    amount: number;
    unit: 'days' | 'months' | 'years';
    rawPhrase: string;
  } | null;
  ocrConfidence: number;
  productConfidence: number;
  uncertainFields: string[];
  reasoningNote: string;
}

function buildPackagingPrompt(params: {
  tesseractText?: string;
  barcodeContext?: {
    code: string;
    name: string | null;
    brand: string | null;
    category: string | null;
  } | null;
  hasEnhancedImage: boolean;
  recoveryPass?: boolean;
}): string {
  const contextLines = [
    params.barcodeContext?.code
      ? `Decoded barcode: ${params.barcodeContext.code}`
      : 'No barcode decoded from image yet.',
    params.barcodeContext?.name
      ? `Barcode database match -> Name: ${params.barcodeContext.name}, Brand: ${params.barcodeContext.brand || 'Unknown'}, Category: ${params.barcodeContext.category || 'Grocery'}`
      : '',
    params.tesseractText
      ? `Tesseract OCR pre-read text:\n${params.tesseractText.slice(0, 1200)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  if (params.recoveryPass) {
    return `FOCUSED DATE RECOVERY PASS:
The first scan could not isolate a clear expiry date. You are given BOTH a high-contrast sharpened view and a 90-degree rotated contrast view of the same package.
Carefully inspect EVERY region — horizontal, vertical (90°/270°), upside-down (180°), bottle necks, pouch crimp seals, faint dot-matrix inkjet dots, laser-etched characters, embossed plastic/cardboard, and small-print "Best before X months from packaging/MFD" statements.

Extract:
1. EVERY visible printed date (even faint or rotated), preserving exact printed text (e.g. "25NOV26", "E:11/27", "BB 08/26", "PKD 05/26", "2027-03-15") AND normalizedIsoDate ("YYYY-MM-DD" or "YYYY-MM" — NEVER invent a day if only month & year are printed).
2. Distinguish manufacturing dates (MFG, MFD, PKD, PROD, M:) from expiry dates (EXP, BBE, BB, USE BY, BEST BEFORE, VALID UNTIL, E:).
3. Any relative shelf-life claim (e.g., "Best before 6 months from manufacture" -> amount: 6, unit: "months").
4. Transcribe all date-area text into visibleText.

Context:
${contextLines}`;
  }

  return `Inspect this product packaging carefully.${
    params.hasEnhancedImage
      ? ' Image 1 is the original photo; Image 2 is a contrast-stretched sharpened version to reveal faint inkjet/dot-matrix or embossed date stamps.'
      : ''
  }

Tasks:
1. Identify productName, brand, and category (Grocery, Food, Medicine, Household, Beverages, Dairy, Personal Care, Other). Leave empty string if genuinely unreadable.
2. Transcribe visible printed text into visibleText — pay special attention to date stamps in ANY orientation (horizontal, vertical margins, upside-down, crimp seals, dot-matrix inkjet, laser-etched text) and shelf-life statements.
3. Extract EVERY visible date into extractedDates with:
   - rawText: exact printed substring (e.g. "EXP 25NOV26", "BB 11/2027", "PKD 14/05/26", "E:08/27")
   - label: printed label ("EXP", "EXPIRY", "BEST BEFORE", "USE BY", "BB", "BBE", "MFG", "MFD", "PKD", or "UNLABELED")
   - role: "expiry" | "manufacturing" | "unknown" (NEVER label MFG/MFD/PKD as expiry!)
   - dateString: the printed date portion (e.g. "25NOV26", "11/2027", "14/05/26")
   - normalizedIsoDate: strict "YYYY-MM-DD" (when day is printed) or "YYYY-MM" (when only month+year are printed — NEVER invent a day!)
4. If the package prints a relative shelf-life rule such as "Best before 6 months from manufacture/packaging" or "Use within 90 days of PKD", populate relativeShelfLife (amount, unit, rawPhrase).
5. Report honest ocrConfidence (0.0-1.0) and productConfidence (0.0-1.0). List only genuinely unreadable fields in uncertainFields.

Context:
${contextLines}`;
}

export async function analyzePackageWithGemini(params: {
  imageBuffer: Buffer;
  mimeType: string;
  enhancedBuffer?: Buffer | null;
  tesseractText?: string;
  thinkingLevel?: ThinkingLevel;
  recoveryPass?: boolean;
  barcodeContext?: {
    code: string;
    name: string | null;
    brand: string | null;
    category: string | null;
  } | null;
}): Promise<AiRecognitionOutput> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      available: false,
      error: 'GEMINI_API_KEY is not configured on the server.',
      productName: null,
      brand: null,
      category: null,
      visibleText: params.tesseractText || '',
      batchNumber: null,
      barcodeDigits: params.barcodeContext?.code || null,
      extractedDates: [],
      relativeShelfLife: null,
      ocrConfidence: 0,
      productConfidence: 0,
      uncertainFields: ['ai_recognition'],
      reasoningNote: 'Gemini AI unavailable; falling back to Tesseract OCR only.',
    };
  }

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [
    {
      inlineData: {
        mimeType: params.mimeType || 'image/jpeg',
        data: params.imageBuffer.toString('base64'),
      },
    },
  ];

  if (params.enhancedBuffer) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: params.enhancedBuffer.toString('base64'),
      },
    });
  }

  parts.push({
    text: buildPackagingPrompt({
      tesseractText: params.tesseractText,
      barcodeContext: params.barcodeContext,
      hasEnhancedImage: Boolean(params.enhancedBuffer),
      recoveryPass: params.recoveryPass,
    }),
  });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        ...(params.thinkingLevel
          ? { thinkingConfig: { thinkingLevel: params.thinkingLevel } }
          : {}),
        systemInstruction:
          'You are a precision packaging OCR, dot-matrix stamp reader, and product identification engine. Look at both natural and high-contrast images carefully across all orientations. Never fabricate dates or invent days for month-only dates.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            productName: { type: Type.STRING },
            brand: { type: Type.STRING },
            category: { type: Type.STRING },
            visibleText: { type: Type.STRING },
            batchNumber: { type: Type.STRING },
            barcodeDigits: { type: Type.STRING },
            extractedDates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  rawText: { type: Type.STRING },
                  label: { type: Type.STRING },
                  role: { type: Type.STRING },
                  dateString: { type: Type.STRING },
                  normalizedIsoDate: { type: Type.STRING },
                },
              },
            },
            relativeShelfLife: {
              type: Type.OBJECT,
              properties: {
                amount: { type: Type.INTEGER },
                unit: { type: Type.STRING },
                rawPhrase: { type: Type.STRING },
              },
            },
            ocrConfidence: { type: Type.NUMBER },
            productConfidence: { type: Type.NUMBER },
            uncertainFields: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            reasoningNote: { type: Type.STRING },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text || '{}').trim()) as Partial<AiRecognitionOutput>;
    const rel = parsed.relativeShelfLife;
    const validRel =
      rel &&
      typeof rel.amount === 'number' &&
      rel.amount > 0 &&
      (rel.unit === 'days' || rel.unit === 'months' || rel.unit === 'years')
        ? {
            amount: Math.round(rel.amount),
            unit: rel.unit,
            rawPhrase: (rel.rawPhrase || `Best before ${rel.amount} ${rel.unit}`).trim(),
          }
        : null;

    return {
      available: true,
      productName: parsed.productName?.trim() || null,
      brand: parsed.brand?.trim() || null,
      category: parsed.category?.trim() || null,
      visibleText: parsed.visibleText?.trim() || params.tesseractText || '',
      batchNumber: parsed.batchNumber?.trim() || null,
      barcodeDigits: parsed.barcodeDigits?.trim() || null,
      extractedDates: Array.isArray(parsed.extractedDates) ? parsed.extractedDates : [],
      relativeShelfLife: validRel,
      ocrConfidence:
        typeof parsed.ocrConfidence === 'number'
          ? Math.max(0, Math.min(1, parsed.ocrConfidence))
          : 0.5,
      productConfidence:
        typeof parsed.productConfidence === 'number'
          ? Math.max(0, Math.min(1, parsed.productConfidence))
          : 0.5,
      uncertainFields: Array.isArray(parsed.uncertainFields) ? parsed.uncertainFields : [],
      reasoningNote: parsed.reasoningNote?.trim() || '',
    };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : 'Gemini AI request failed',
      productName: null,
      brand: null,
      category: null,
      visibleText: params.tesseractText || '',
      batchNumber: null,
      barcodeDigits: null,
      extractedDates: [],
      relativeShelfLife: null,
      ocrConfidence: 0,
      productConfidence: 0,
      uncertainFields: ['ai_recognition'],
      reasoningNote: 'Gemini AI analysis returned an error; using deterministic OCR.',
    };
  }
}

export interface CombinedOcrOutcome {
  rawText: string;
  detectedDates: DetectedDateEntry[];
  expiryDate: string | null;
  expiryPrecision: DatePrecision;
  manufacturingDate: string | null;
  mfgPrecision: DatePrecision;
  batchNumber: string | null;
  ocrConfidence: number;
  needsConfirmation: boolean;
  uncertainReasons: string[];
  tesseractStatus: { ok: boolean; confidence: number; error?: string };
  aiResult: AiRecognitionOutput;
}

function mergeDatesFromAiAndText(params: {
  combinedRawText: string;
  aiOutputs: AiRecognitionOutput[];
}): {
  detectedDates: DetectedDateEntry[];
  expiryDate: string | null;
  expiryPrecision: DatePrecision;
  manufacturingDate: string | null;
  mfgPrecision: DatePrecision;
  batchNumber: string | null;
  computedFromShelfLife: boolean;
} {
  const deterministic = extractDatesAndBatchFromText(params.combinedRawText);
  const mergedDates: DetectedDateEntry[] = [...deterministic.detectedDates];
  const seenKeys = new Set(mergedDates.map((d) => `${d.role}:${d.normalized}`));

  for (const aiOut of params.aiOutputs) {
    for (const aiDate of aiOut.extractedDates) {
      const candidates = [aiDate.normalizedIsoDate, aiDate.dateString, aiDate.rawText].filter(
        (v): v is string => Boolean(v && v.trim())
      );

      let parsed = { normalized: null as string | null, precision: 'unknown' as DatePrecision, validCalendar: false };
      for (const frag of candidates) {
        const res = parseFlexibleDateFragment(frag);
        if (res.validCalendar && res.normalized) {
          parsed = res;
          break;
        }
      }
      if (!parsed.validCalendar || !parsed.normalized) continue;

      const labelUpper = (aiDate.label || 'UNLABELED').trim().toUpperCase();
      const labelRole = classifyLabelRole(labelUpper);
      const rawTextRole = classifyLabelRole(aiDate.rawText || '');
      const role: 'expiry' | 'manufacturing' | 'unknown' =
        labelRole !== 'unknown'
          ? labelRole
          : rawTextRole !== 'unknown'
            ? rawTextRole
            : aiDate.role === 'expiry' || aiDate.role === 'manufacturing'
              ? aiDate.role
              : 'unknown';

      const dedupKey = `${role}:${parsed.normalized}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);

      mergedDates.push({
        raw: aiDate.rawText || `${labelUpper} ${aiDate.dateString}`,
        label: labelUpper,
        normalized: parsed.normalized,
        precision: parsed.precision,
        role,
        validCalendar: true,
        confidence: role === 'unknown' ? 0.55 : Math.max(0.7, aiOut.ocrConfidence),
      });
    }
  }

  const expiryCandidates = mergedDates.filter((d) => d.role === 'expiry');
  const mfgCandidates = mergedDates.filter((d) => d.role === 'manufacturing');

  let expiryDate = deterministic.expiryDate;
  let expiryPrecision = deterministic.expiryPrecision;
  let manufacturingDate = deterministic.manufacturingDate;
  let mfgPrecision = deterministic.mfgPrecision;
  let computedFromShelfLife = false;

  if (!manufacturingDate && mfgCandidates.length > 0) {
    manufacturingDate = mfgCandidates[0].normalized;
    mfgPrecision = mfgCandidates[0].precision;
  }

  if (expiryCandidates.length > 0) {
    const sorted = [...expiryCandidates].sort((a, b) =>
      (b.normalized || '').localeCompare(a.normalized || '')
    );
    expiryDate = sorted[0].normalized;
    expiryPrecision = sorted[0].precision;
  }

  // If still no explicit expiry date, check relative shelf-life rule from AI or OCR text + MFG date
  if (!expiryDate && manufacturingDate) {
    const aiShelfLife = params.aiOutputs.find((a) => a.relativeShelfLife)?.relativeShelfLife || null;
    const shelfLife = aiShelfLife || extractRelativeShelfLife(params.combinedRawText);
    if (shelfLife) {
      const computed = computeShelfLifeExpiry(manufacturingDate, mfgPrecision, shelfLife);
      if (computed) {
        expiryDate = computed.normalized;
        expiryPrecision = computed.precision;
        computedFromShelfLife = true;
        const dedupKey = `expiry:${computed.normalized}`;
        if (!seenKeys.has(dedupKey)) {
          seenKeys.add(dedupKey);
          mergedDates.push({
            raw: `${shelfLife.rawPhrase} (from ${manufacturingDate})`,
            label: 'BEST BEFORE (COMPUTED)',
            normalized: computed.normalized,
            precision: computed.precision,
            role: 'expiry',
            validCalendar: true,
            confidence: 0.85,
          });
        }
      }
    }
  }

  return {
    detectedDates: mergedDates,
    expiryDate,
    expiryPrecision,
    manufacturingDate,
    mfgPrecision,
    batchNumber:
      params.aiOutputs.find((a) => a.batchNumber)?.batchNumber || deterministic.batchNumber,
    computedFromShelfLife,
  };
}

export async function runHybridOcrAndAi(params: {
  imageBuffer: Buffer;
  mimeType: string;
  fastMode?: boolean;
  barcodeContext?: {
    code: string;
    name: string | null;
    brand: string | null;
    category: string | null;
  } | null;
}): Promise<CombinedOcrOutcome> {
  const fastMode = params.fastMode !== false;

  // Generate a contrast-stretched, sharpened image (~20ms) so dot-matrix & dim ESP32-CAM stamps pop
  const enhanced0 = createHighContrastJpeg(params.imageBuffer, { rotateDeg: 0, maxDim: 1280 });

  let tess: TesseractOcrOutput = { ok: true, rawText: '', confidence: 0 };
  let primaryAi: AiRecognitionOutput;

  if (fastMode) {
    primaryAi = await analyzePackageWithGemini({
      imageBuffer: params.imageBuffer,
      mimeType: params.mimeType,
      enhancedBuffer: enhanced0,
      thinkingLevel: ThinkingLevel.LOW,
      barcodeContext: params.barcodeContext,
    });
    if (!primaryAi.available) {
      tess = await runTesseractOcr(enhanced0 || params.imageBuffer);
    }
  } else {
    const [tessRes, aiRes] = await Promise.all([
      runTesseractOcr(enhanced0 || params.imageBuffer),
      analyzePackageWithGemini({
        imageBuffer: params.imageBuffer,
        mimeType: params.mimeType,
        enhancedBuffer: enhanced0,
        thinkingLevel: ThinkingLevel.MEDIUM,
        barcodeContext: params.barcodeContext,
      }),
    ]);
    tess = tessRes;
    primaryAi = aiRes;
  }

  const aiOutputs: AiRecognitionOutput[] = [primaryAi];
  let combinedRawText = [primaryAi.visibleText, tess.rawText]
    .filter((t) => t && t.trim().length > 0)
    .join('\n---\n');

  let merged = mergeDatesFromAiAndText({ combinedRawText, aiOutputs });

  // Stage 2: Automatic Date Recovery Pass if Stage 1 failed to extract an expiry date
  // Uses a 90-degree rotated contrast-enhanced image + deeper Gemini reasoning + Tesseract in parallel
  if (!merged.expiryDate && enhanced0) {
    const enhanced90 = createHighContrastJpeg(params.imageBuffer, { rotateDeg: 90, maxDim: 1280 });
    const [recoveryAi, recoveryTess] = await Promise.all([
      primaryAi.available
        ? analyzePackageWithGemini({
            imageBuffer: enhanced0,
            mimeType: 'image/jpeg',
            enhancedBuffer: enhanced90,
            tesseractText: tess.rawText || primaryAi.visibleText,
            thinkingLevel: ThinkingLevel.MEDIUM,
            recoveryPass: true,
            barcodeContext: params.barcodeContext,
          })
        : Promise.resolve(primaryAi),
      !tess.rawText
        ? runTesseractOcr(enhanced0)
        : Promise.resolve(tess),
    ]);

    if (recoveryAi.available && recoveryAi !== primaryAi) {
      aiOutputs.push(recoveryAi);
    }
    if (recoveryTess.rawText && !tess.rawText) {
      tess = recoveryTess;
    }

    combinedRawText = [
      primaryAi.visibleText,
      recoveryAi !== primaryAi ? recoveryAi.visibleText : '',
      tess.rawText,
    ]
      .filter((t) => t && t.trim().length > 0)
      .join('\n---\n');

    merged = mergeDatesFromAiAndText({ combinedRawText, aiOutputs });

    // Preserve higher confidence & product identity across passes
    if (!primaryAi.productName && recoveryAi.productName) {
      primaryAi.productName = recoveryAi.productName;
    }
    if (!primaryAi.brand && recoveryAi.brand) {
      primaryAi.brand = recoveryAi.brand;
    }
    if (recoveryAi.ocrConfidence > primaryAi.ocrConfidence) {
      primaryAi.ocrConfidence = recoveryAi.ocrConfidence;
    }
    if (merged.expiryDate) {
      primaryAi.uncertainFields = primaryAi.uncertainFields.filter(
        (f) => f !== 'expiryDate' && f !== 'expiry'
      );
      primaryAi.reasoningNote = [
        primaryAi.reasoningNote,
        'Recovered expiry date using high-contrast + multi-orientation Stage 2 analysis.',
      ]
        .filter(Boolean)
        .join(' ');
    }
  }

  const unknownCandidates = merged.detectedDates.filter((d) => d.role === 'unknown');
  const uncertainReasons: string[] = [];

  if (!merged.expiryDate) {
    if (unknownCandidates.length > 0) {
      uncertainReasons.push(
        'Detected an unlabeled date on the package. Please confirm if it is the expiry date rather than manufacturing date.'
      );
    } else {
      uncertainReasons.push(
        'No readable expiry date found. Try turning on Flashlight, rotating the package, or bringing the date print closer.'
      );
    }
  }
  if (
    merged.expiryDate &&
    merged.manufacturingDate &&
    merged.expiryDate < merged.manufacturingDate
  ) {
    uncertainReasons.push(
      `Expiry date (${merged.expiryDate}) precedes manufacturing date (${merged.manufacturingDate}). Please verify.`
    );
  }
  if (primaryAi.uncertainFields.length > 0 && !merged.expiryDate) {
    uncertainReasons.push(`Uncertain fields flagged: ${primaryAi.uncertainFields.join(', ')}`);
  }

  const ocrConfidence = primaryAi.available
    ? tess.rawText
      ? Number(((primaryAi.ocrConfidence * 0.75) + (tess.confidence * 0.25)).toFixed(2))
      : Number(primaryAi.ocrConfidence.toFixed(2))
    : Number(tess.confidence.toFixed(2));

  return {
    rawText: combinedRawText,
    detectedDates: merged.detectedDates,
    expiryDate: merged.expiryDate,
    expiryPrecision: merged.expiryPrecision,
    manufacturingDate: merged.manufacturingDate,
    mfgPrecision: merged.mfgPrecision,
    batchNumber: merged.batchNumber,
    ocrConfidence,
    needsConfirmation: uncertainReasons.length > 0 || ocrConfidence < 0.6 || !merged.expiryDate,
    uncertainReasons,
    tesseractStatus: {
      ok: tess.ok,
      confidence: Number(tess.confidence.toFixed(2)),
      error: tess.error,
    },
    aiResult: primaryAi,
  };
}

export async function checkOcrAndAiDiagnostics(): Promise<{
  tesseract: { ok: boolean; detail: string };
  gemini: { ok: boolean; model: string; detail: string };
}> {
  const tesseractOk = typeof Tesseract.recognize === 'function';
  const ai = getGeminiClient();
  if (!ai) {
    return {
      tesseract: {
        ok: tesseractOk,
        detail: tesseractOk ? 'Tesseract.js OCR engine initialized' : 'Tesseract.js unavailable',
      },
      gemini: {
        ok: false,
        model: 'gemini-4-hydrogen',
        detail: 'GEMINI_API_KEY is missing or unset on the server.',
      },
    };
  }

  try {
    const ping = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: 'Reply with OK',
    });
    const ok = Boolean(ping.text);
    return {
      tesseract: {
        ok: tesseractOk,
        detail: tesseractOk ? 'Tesseract.js OCR engine ready' : 'Tesseract.js unavailable',
      },
      gemini: {
        ok,
        model: 'gemini-4-hydrogen',
        detail: ok ? 'Gemini API responding normally' : 'Empty response from Gemini API',
      },
    };
  } catch (err) {
    return {
      tesseract: {
        ok: tesseractOk,
        detail: tesseractOk ? 'Tesseract.js OCR engine ready' : 'Tesseract.js unavailable',
      },
      gemini: {
        ok: false,
        model: 'gemini-4-hydrogen',
        detail: err instanceof Error ? err.message : 'Gemini API health check failed',
      },
    };
  }
}
