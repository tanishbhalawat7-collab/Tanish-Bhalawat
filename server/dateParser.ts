import type { DatePrecision, DetectedDateEntry } from './types.ts';

const MONTH_MAP: Record<string, number> = {
  JAN: 1,
  JANUARY: 1,
  FEB: 2,
  FEBRUARY: 2,
  MAR: 3,
  MARCH: 3,
  APR: 4,
  APRIL: 4,
  MAY: 5,
  JUN: 6,
  JUNE: 6,
  JUL: 7,
  JULY: 7,
  AUG: 8,
  AUGUST: 8,
  SEP: 9,
  SEPT: 9,
  SEPTEMBER: 9,
  OCT: 10,
  OCTOBER: 10,
  NOV: 11,
  NOVEMBER: 11,
  DEC: 12,
  DECEMBER: 12,
};

const WORD_NUMBERS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  EIGHT: 8,
  NINE: 9,
  TEN: 10,
  ELEVEN: 11,
  TWELVE: 12,
  FIFTEEN: 15,
  EIGHTEEN: 18,
  TWENTY: 20,
  'TWENTY FOUR': 24,
  'TWENTY-FOUR': 24,
  THIRTY: 30,
  THIRTYSIX: 36,
  'THIRTY SIX': 36,
  'THIRTY-SIX': 36,
  FORTY: 40,
  SIXTY: 60,
  NINETY: 90,
};

export function isValidCalendarDate(year: number, month: number, day?: number): boolean {
  if (!Number.isInteger(year) || year < 1990 || year > 2100) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (day === undefined) return true;
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function normalizeYear(rawYear: string): number {
  const digits = rawYear.replace(/^['’]/, '');
  const num = Number.parseInt(digits, 10);
  if (digits.length === 2) {
    return num >= 80 ? 1900 + num : 2000 + num;
  }
  return num;
}

function normalizeMonthOcrToken(token: string): string {
  // Recover common dot-matrix OCR confusions inside month names (e.g. N0V -> NOV, 0CT -> OCT)
  const upper = token.toUpperCase();
  if (MONTH_MAP[upper]) return upper;
  const fixed = upper
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S')
    .replace(/8/g, 'B');
  if (MONTH_MAP[fixed]) return fixed;
  return upper;
}

function fixNumericOcrNoise(raw: string): string {
  // Only replace O/I/l when adjacent to digits or date separators
  return raw
    .replace(/(?<=\d)[Oo]|[Oo](?=\d)/g, '0')
    .replace(/(?<=[-/.\s])[Oo](?=[-/.\s\d])|(?<=^)[Oo](?=\d[-/.])/g, '0')
    .replace(/(?<=\d)[Il|]|[Il|](?=\d)/g, '1');
}

export interface ParsedSingleDate {
  normalized: string | null;
  precision: DatePrecision;
  validCalendar: boolean;
}

export function parseDateString(rawDate: string): ParsedSingleDate {
  const cleaned = fixNumericOcrNoise(
    rawDate
      .trim()
      .replace(/^[(["'\s]+|[)\].,;"'\s]+$/g, '')
      .replace(/['’](\d{2})\b/g, '$1')
      .replace(/\s+/g, ' ')
      .toUpperCase()
  );

  if (!cleaned) {
    return { normalized: null, precision: 'unknown', validCalendar: false };
  }

  // YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD or YYYY MM DD
  let m = cleaned.match(/^(\d{4})[-/.\s](\d{1,2})[-/.\s](\d{1,2})$/);
  if (m) {
    const year = Number.parseInt(m[1], 10);
    const month = Number.parseInt(m[2], 10);
    const day = Number.parseInt(m[3], 10);
    const valid = isValidCalendarDate(year, month, day);
    return {
      normalized: valid ? `${year}-${pad2(month)}-${pad2(day)}` : null,
      precision: valid ? 'day' : 'unknown',
      validCalendar: valid,
    };
  }

  // Compact YYYYMMDD (e.g. 20261125)
  m = cleaned.match(/^(20\d{2})(\d{2})(\d{2})$/);
  if (m) {
    const year = Number.parseInt(m[1], 10);
    const month = Number.parseInt(m[2], 10);
    const day = Number.parseInt(m[3], 10);
    const valid = isValidCalendarDate(year, month, day);
    return {
      normalized: valid ? `${year}-${pad2(month)}-${pad2(day)}` : null,
      precision: valid ? 'day' : 'unknown',
      validCalendar: valid,
    };
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY or DD MM YYYY (or 2-digit year)
  m = cleaned.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{2,4})$/);
  if (m) {
    const first = Number.parseInt(m[1], 10);
    const second = Number.parseInt(m[2], 10);
    const year = normalizeYear(m[3]);
    let day = first;
    let month = second;
    if (second > 12 && first <= 12) {
      month = first;
      day = second;
    }
    const valid = isValidCalendarDate(year, month, day);
    return {
      normalized: valid ? `${year}-${pad2(month)}-${pad2(day)}` : null,
      precision: valid ? 'day' : 'unknown',
      validCalendar: valid,
    };
  }

  // DD MMM YYYY or DD-MMM-YYYY or DD MMM YY or compact 25NOV26 / 25NOV2026
  m = cleaned.match(/^(\d{1,2})[\s\-./]*([A-Z0-9]{3,9})[\s\-./]*(\d{2,4})$/);
  if (m) {
    const monKey = normalizeMonthOcrToken(m[2]);
    if (MONTH_MAP[monKey]) {
      const day = Number.parseInt(m[1], 10);
      const month = MONTH_MAP[monKey];
      const year = normalizeYear(m[3]);
      const valid = isValidCalendarDate(year, month, day);
      return {
        normalized: valid ? `${year}-${pad2(month)}-${pad2(day)}` : null,
        precision: valid ? 'day' : 'unknown',
        validCalendar: valid,
      };
    }
  }

  // YYYY MMM DD or 2026NOV25
  m = cleaned.match(/^(\d{4})[\s\-./]*([A-Z0-9]{3,9})[\s\-./]*(\d{1,2})$/);
  if (m) {
    const monKey = normalizeMonthOcrToken(m[2]);
    if (MONTH_MAP[monKey]) {
      const year = Number.parseInt(m[1], 10);
      const month = MONTH_MAP[monKey];
      const day = Number.parseInt(m[3], 10);
      const valid = isValidCalendarDate(year, month, day);
      return {
        normalized: valid ? `${year}-${pad2(month)}-${pad2(day)}` : null,
        precision: valid ? 'day' : 'unknown',
        validCalendar: valid,
      };
    }
  }

  // MMM DD YYYY (e.g. DEC 15 2026 or DEC 15, 2026)
  m = cleaned.match(/^([A-Z0-9]{3,9})[\s\-./]+(\d{1,2}),?[\s\-./]+(\d{2,4})$/);
  if (m) {
    const monKey = normalizeMonthOcrToken(m[1]);
    if (MONTH_MAP[monKey]) {
      const month = MONTH_MAP[monKey];
      const day = Number.parseInt(m[2], 10);
      const year = normalizeYear(m[3]);
      const valid = isValidCalendarDate(year, month, day);
      return {
        normalized: valid ? `${year}-${pad2(month)}-${pad2(day)}` : null,
        precision: valid ? 'day' : 'unknown',
        validCalendar: valid,
      };
    }
  }

  // MM/YYYY or MM-YYYY or MM.YYYY or MM YYYY or MM/YY
  m = cleaned.match(/^(\d{1,2})[-/.\s](\d{2,4})$/);
  if (m) {
    const month = Number.parseInt(m[1], 10);
    const year = normalizeYear(m[2]);
    const valid = isValidCalendarDate(year, month);
    return {
      normalized: valid ? `${year}-${pad2(month)}` : null,
      precision: valid ? 'month' : 'unknown',
      validCalendar: valid,
    };
  }

  // YYYY-MM or YYYY/MM or YYYY.MM
  m = cleaned.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) {
    const year = Number.parseInt(m[1], 10);
    const month = Number.parseInt(m[2], 10);
    const valid = isValidCalendarDate(year, month);
    return {
      normalized: valid ? `${year}-${pad2(month)}` : null,
      precision: valid ? 'month' : 'unknown',
      validCalendar: valid,
    };
  }

  // YYYY MMM or 2026NOV
  m = cleaned.match(/^(\d{4})[\s\-./]*([A-Z0-9]{3,9})$/);
  if (m) {
    const monKey = normalizeMonthOcrToken(m[2]);
    if (MONTH_MAP[monKey]) {
      const year = Number.parseInt(m[1], 10);
      const month = MONTH_MAP[monKey];
      const valid = isValidCalendarDate(year, month);
      return {
        normalized: valid ? `${year}-${pad2(month)}` : null,
        precision: valid ? 'month' : 'unknown',
        validCalendar: valid,
      };
    }
  }

  // MMM YYYY or MMM-YYYY or MMM YY or compact NOV26 / NOV2026
  m = cleaned.match(/^([A-Z0-9]{3,9})[\s\-./']*(\d{2,4})$/);
  if (m) {
    const monKey = normalizeMonthOcrToken(m[1]);
    if (MONTH_MAP[monKey]) {
      const month = MONTH_MAP[monKey];
      const year = normalizeYear(m[2]);
      const valid = isValidCalendarDate(year, month);
      return {
        normalized: valid ? `${year}-${pad2(month)}` : null,
        precision: valid ? 'month' : 'unknown',
        validCalendar: valid,
      };
    }
  }

  return { normalized: null, precision: 'unknown', validCalendar: false };
}

const MONTH_NAME_ALT =
  '(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUNE?|JULY?|AUG(?:UST)?|SEPT?(?:EMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)';

const FLEXIBLE_DATE_REGEX = new RegExp(
  [
    String.raw`\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b`,
    String.raw`\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b`,
    String.raw`\b\d{1,2}[\s\-./]*${MONTH_NAME_ALT}[\s\-./]*\d{2,4}\b`,
    String.raw`\b\d{4}[\s\-./]*${MONTH_NAME_ALT}[\s\-./]*\d{1,2}\b`,
    String.raw`\b${MONTH_NAME_ALT}[\s\-./]+\d{1,2},?[\s\-./]+\d{2,4}\b`,
    String.raw`\b\d{4}[\s\-./]*${MONTH_NAME_ALT}\b`,
    String.raw`\b${MONTH_NAME_ALT}[\s\-./']*\d{2,4}\b`,
    String.raw`\b\d{1,2}[-/.]\d{2,4}\b`,
    String.raw`\b\d{4}[-/.]\d{1,2}\b`,
    String.raw`\b20\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\b`,
  ].join('|'),
  'gi'
);

/**
 * Parses either a clean date string or a noisy fragment such as "EXP 11/26" or "Nov. 2026 (BB)".
 */
export function parseFlexibleDateFragment(fragment: string): ParsedSingleDate {
  const direct = parseDateString(fragment);
  if (direct.validCalendar && direct.normalized) return direct;

  const cleanedNoise = fixNumericOcrNoise(fragment.toUpperCase());
  const matches = cleanedNoise.match(FLEXIBLE_DATE_REGEX);
  if (matches) {
    for (const token of matches) {
      const parsed = parseDateString(token);
      if (parsed.validCalendar && parsed.normalized) return parsed;
    }
  }

  // Fallback for space-separated dates inside noisy fragments like "11 26" or "25 11 2026"
  const spaceTriple = cleanedNoise.match(/\b(\d{1,2})\s+(\d{1,2})\s+(\d{2,4})\b/);
  if (spaceTriple) {
    const parsed = parseDateString(`${spaceTriple[1]}/${spaceTriple[2]}/${spaceTriple[3]}`);
    if (parsed.validCalendar && parsed.normalized) return parsed;
  }
  const spacePair = cleanedNoise.match(/\b(\d{1,2})\s+(\d{2,4})\b/);
  if (spacePair) {
    const parsed = parseDateString(`${spacePair[1]}/${spacePair[2]}`);
    if (parsed.validCalendar && parsed.normalized) return parsed;
  }

  return { normalized: null, precision: 'unknown', validCalendar: false };
}

const EXPIRY_LABEL_REGEX =
  /\b(EXPIRY\s*DATE|EXP\.?\s*(?:DATE|DT\.?)|USE\s*(?:BY|BEFORE)(?:\s*END)?|BEST\s*BEFORE(?:\s*END)?|BEST\s*BY|EXPIRES?\s*(?:ON)?|VALID\s*(?:UNTIL|UP\s*TO|UPTO|THRU)|GOOD\s*THRU|SELL\s*BY|CONSUME\s*(?:BEFORE|BY)|EXPIRY|EXP\.?|B\.?B\.?E\.?|B\.?B\.?|U\.?B\.?|ED)\b|(?:^|[\s(/|])(E)\s*[:\-]/i;

const MFG_LABEL_REGEX =
  /\b(MANUFACTURED(?:\s*ON|\s*DATE)?|PRODUCTION\s*DATE|PACKED(?:\s*ON|\s*DATE)?|PACKING\s*DATE|MFG\.?\s*(?:DATE|DT\.?)|MFD\.?\s*(?:DATE|DT\.?)|PKD\.?\s*(?:DATE|DT\.?|ON)?|PKG\.?\s*(?:DATE|DT\.?)?|MFG\.?|MFD\.?|PKD\.?|PROD\.?|DOM)\b|(?:^|[\s(/|])(M)\s*[:\-]/i;

const LABEL_FINDER_REGEX =
  /(EXPIRY\s*DATE|EXP\.?\s*(?:DATE|DT\.?)|USE\s*(?:BY|BEFORE)(?:\s*END)?|BEST\s*BEFORE(?:\s*END)?|BEST\s*BY|EXPIRES?\s*(?:ON)?|VALID\s*(?:UNTIL|UP\s*TO|UPTO|THRU)|GOOD\s*THRU|SELL\s*BY|CONSUME\s*(?:BEFORE|BY)|EXPIRY|EXP\.?|B\.?B\.?E\.?|B\.?B\.?|U\.?B\.?|ED|MANUFACTURED(?:\s*ON|\s*DATE)?|PRODUCTION\s*DATE|PACKED(?:\s*ON|\s*DATE)?|PACKING\s*DATE|MFG\.?\s*(?:DATE|DT\.?)|MFD\.?\s*(?:DATE|DT\.?)|PKD\.?\s*(?:DATE|DT\.?|ON)?|PKG\.?\s*(?:DATE|DT\.?)?|MFG\.?|MFD\.?|PKD\.?|PROD\.?|DOM|\b[EM])(?=\s*[:\-./\s]|$)/gi;

const BATCH_REGEX =
  /\b(?:BATCH(?:\s*NO\.?|\s*NUMBER)?|LOT(?:\s*NO\.?|\s*NUMBER)?|B\.?\s*NO\.?|L\.?\s*NO\.?)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-/]{2,20})/i;

export function classifyLabelRole(labelText: string): 'expiry' | 'manufacturing' | 'unknown' {
  const upper = labelText.trim().toUpperCase();
  if (!upper || upper === 'UNLABELED') return 'unknown';
  if (upper === 'M' || upper === 'M:') return 'manufacturing';
  if (upper === 'E' || upper === 'E:') return 'expiry';
  if (MFG_LABEL_REGEX.test(upper)) return 'manufacturing';
  if (EXPIRY_LABEL_REGEX.test(upper)) return 'expiry';
  return 'unknown';
}

export interface RelativeShelfLifeMatch {
  amount: number;
  unit: 'days' | 'months' | 'years';
  rawPhrase: string;
}

export function extractRelativeShelfLife(text: string): RelativeShelfLifeMatch | null {
  const upper = text.toUpperCase().replace(/\s+/g, ' ');
  const pattern =
    /(?:BEST\s*BEFORE|USE\s*(?:BY|WITHIN)|EXPIR(?:Y|ES)|SHELF\s*LIFE|VALID\s*(?:FOR|UP\s*TO))\s*(?:WITHIN\s*)?(\d{1,3}|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|FIFTEEN|EIGHTEEN|TWENTY[- ]?FOUR|THIRTY[- ]?SIX|THIRTY|FORTY|SIXTY|NINETY)\s*(DAYS?|MONTHS?|YEARS?|MOS?|YRS?)(?:\s*(?:FROM|OF)\s*(?:THE\s*DATE\s*OF\s*)?(?:PACKAGING|PACKING|MANUFACTURE|MFG|MFD|PKD|PRODUCTION))?/i;
  const m = upper.match(pattern);
  if (!m) return null;

  const numToken = m[1].trim();
  const amount = /^\d+$/.test(numToken)
    ? Number.parseInt(numToken, 10)
    : WORD_NUMBERS[numToken] || 0;
  if (!amount || amount <= 0 || amount > 3650) return null;

  const unitRaw = m[2].toUpperCase();
  const unit: 'days' | 'months' | 'years' = unitRaw.startsWith('DAY')
    ? 'days'
    : unitRaw.startsWith('Y')
      ? 'years'
      : 'months';

  return {
    amount,
    unit,
    rawPhrase: m[0].trim(),
  };
}

export function computeShelfLifeExpiry(
  mfgNormalized: string,
  mfgPrecision: DatePrecision,
  shelfLife: RelativeShelfLifeMatch
): { normalized: string; precision: DatePrecision } | null {
  if (!mfgNormalized || mfgPrecision === 'unknown') return null;

  if (mfgPrecision === 'month' && /^\d{4}-\d{2}$/.test(mfgNormalized)) {
    const [y, m] = mfgNormalized.split('-').map(Number);
    const totalMonths =
      shelfLife.unit === 'years'
        ? shelfLife.amount * 12
        : shelfLife.unit === 'months'
          ? shelfLife.amount
          : Math.floor(shelfLife.amount / 30);
    const dt = new Date(Date.UTC(y, m - 1 + totalMonths, 1));
    return {
      normalized: `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}`,
      precision: 'month',
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(mfgNormalized)) {
    const [y, m, d] = mfgNormalized.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (shelfLife.unit === 'days') {
      dt.setUTCDate(dt.getUTCDate() + shelfLife.amount);
    } else if (shelfLife.unit === 'months') {
      const targetMonth = dt.getUTCMonth() + shelfLife.amount;
      dt.setUTCMonth(targetMonth);
    } else {
      dt.setUTCFullYear(dt.getUTCFullYear() + shelfLife.amount);
    }
    return {
      normalized: `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`,
      precision: 'day',
    };
  }

  return null;
}

export interface ExtractedOcrAnalysis {
  detectedDates: DetectedDateEntry[];
  expiryDate: string | null;
  expiryPrecision: DatePrecision;
  manufacturingDate: string | null;
  mfgPrecision: DatePrecision;
  batchNumber: string | null;
  relativeShelfLife: RelativeShelfLifeMatch | null;
  needsConfirmation: boolean;
  uncertainReasons: string[];
}

export function extractDatesAndBatchFromText(rawText: string): ExtractedOcrAnalysis {
  const text = rawText || '';
  const detectedDates: DetectedDateEntry[] = [];
  const seenKeys = new Set<string>();

  const datePattern = new RegExp(FLEXIBLE_DATE_REGEX.source, 'gi');
  const matches: Array<{ token: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = datePattern.exec(text)) !== null) {
    matches.push({ token: match[0], index: match.index });
  }

  for (let i = 0; i < matches.length; i++) {
    const { token: rawDateToken, index: startIdx } = matches[i];
    const parsed = parseDateString(rawDateToken);
    if (!parsed.validCalendar || !parsed.normalized) continue;

    const lineStart = text.lastIndexOf('\n', startIdx) + 1;
    const sameLinePrefix = text.slice(lineStart, startIdx);
    const contextBefore = text.slice(Math.max(0, startIdx - 48), startIdx);
    const contextAfter = text.slice(
      startIdx + rawDateToken.length,
      Math.min(text.length, startIdx + rawDateToken.length + 22)
    );

    let label = 'UNLABELED';
    let role: 'expiry' | 'manufacturing' | 'unknown' = 'unknown';

    // Check dual-header pattern like "MFD / EXP: 01/25 / 01/27"
    const dualMatch = contextBefore.match(
      /(MFG|MFD|PKD|PROD)[\s/&\-]+(EXP|BBE|BB|USE\s*BY)/i
    );
    if (dualMatch && i > 0) {
      // Second date after dual header -> expiry
      label = dualMatch[2].trim().toUpperCase();
      role = 'expiry';
    } else if (dualMatch && i + 1 < matches.length) {
      // First date after dual header -> manufacturing
      label = dualMatch[1].trim().toUpperCase();
      role = 'manufacturing';
    } else {
      // Check closest label immediately preceding date on same line
      const sameLineMatches = [...sameLinePrefix.matchAll(LABEL_FINDER_REGEX)];
      if (sameLineMatches.length > 0) {
        const last = sameLineMatches[sameLineMatches.length - 1];
        const between = sameLinePrefix.slice((last.index || 0) + last[0].length);
        // Ensure there isn't another date/long text separating the label from this date
        if (between.length <= 16 && !/\d{2}[-/.]\d{2}/.test(between)) {
          label = last[1].trim().toUpperCase();
          role = classifyLabelRole(label);
        }
      }

      // Check broader contextBefore (e.g. label on previous line)
      if (role === 'unknown') {
        const beforeMatches = [...contextBefore.matchAll(LABEL_FINDER_REGEX)];
        if (beforeMatches.length > 0) {
          const last = beforeMatches[beforeMatches.length - 1];
          const between = contextBefore.slice((last.index || 0) + last[0].length);
          if (between.length <= 18 && !/\d{2}[-/.]\d{2}/.test(between)) {
            label = last[1].trim().toUpperCase();
            role = classifyLabelRole(label);
          }
        }
      }

      // Check suffix label immediately following the date (e.g. "12/2026 EXP")
      if (role === 'unknown') {
        const afterMatches = [...contextAfter.matchAll(LABEL_FINDER_REGEX)];
        if (afterMatches.length > 0) {
          const firstAfter = afterMatches[0];
          const between = contextAfter.slice(0, firstAfter.index || 0);
          if (between.length <= 8) {
            label = firstAfter[1].trim().toUpperCase();
            role = classifyLabelRole(label);
          }
        }
      }
    }

    const dedupKey = `${role}:${parsed.normalized}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    detectedDates.push({
      raw: label !== 'UNLABELED' ? `${label} ${rawDateToken}` : rawDateToken,
      label,
      normalized: parsed.normalized,
      precision: parsed.precision,
      role,
      validCalendar: true,
      confidence: role === 'unknown' ? 0.5 : 0.9,
    });
  }

  const batchMatch = text.match(BATCH_REGEX);
  const batchNumber = batchMatch ? batchMatch[1].trim() : null;
  const relativeShelfLife = extractRelativeShelfLife(text);

  const expiryCandidates = detectedDates.filter((d) => d.role === 'expiry');
  const mfgCandidates = detectedDates.filter((d) => d.role === 'manufacturing');
  const unknownCandidates = detectedDates.filter((d) => d.role === 'unknown');

  const uncertainReasons: string[] = [];
  let expiryDate: string | null = null;
  let expiryPrecision: DatePrecision = 'unknown';
  let manufacturingDate: string | null = null;
  let mfgPrecision: DatePrecision = 'unknown';

  if (mfgCandidates.length > 0) {
    manufacturingDate = mfgCandidates[0].normalized;
    mfgPrecision = mfgCandidates[0].precision;
  }

  if (expiryCandidates.length === 1) {
    expiryDate = expiryCandidates[0].normalized;
    expiryPrecision = expiryCandidates[0].precision;
  } else if (expiryCandidates.length > 1) {
    const sorted = [...expiryCandidates].sort((a, b) =>
      (b.normalized || '').localeCompare(a.normalized || '')
    );
    expiryDate = sorted[0].normalized;
    expiryPrecision = sorted[0].precision;
    uncertainReasons.push('Multiple expiry date candidates detected on packaging.');
  } else if (manufacturingDate && relativeShelfLife) {
    const computed = computeShelfLifeExpiry(manufacturingDate, mfgPrecision, relativeShelfLife);
    if (computed) {
      expiryDate = computed.normalized;
      expiryPrecision = computed.precision;
      detectedDates.push({
        raw: `${relativeShelfLife.rawPhrase} (from ${manufacturingDate})`,
        label: 'BEST BEFORE (COMPUTED)',
        normalized: computed.normalized,
        precision: computed.precision,
        role: 'expiry',
        validCalendar: true,
        confidence: 0.85,
      });
    }
  } else if (unknownCandidates.length > 0) {
    uncertainReasons.push(
      'Visible date lacks an explicit EXP / BEST BEFORE / USE BY label. Please confirm whether it is the expiry date.'
    );
  } else {
    uncertainReasons.push('No valid expiry date detected in OCR text.');
  }

  if (expiryDate && manufacturingDate && expiryDate < manufacturingDate) {
    uncertainReasons.push(
      `Detected expiry date (${expiryDate}) is earlier than manufacturing date (${manufacturingDate}). Manual verification required.`
    );
  }

  return {
    detectedDates,
    expiryDate,
    expiryPrecision,
    manufacturingDate,
    mfgPrecision,
    batchNumber,
    relativeShelfLife,
    needsConfirmation: uncertainReasons.length > 0 || !expiryDate,
    uncertainReasons,
  };
}

export function computeDaysRemaining(
  expiryDate: string | null,
  precision: DatePrecision
): number | null {
  if (!expiryDate || precision === 'unknown') return null;

  let targetDate: Date;
  if (precision === 'month' && /^\d{4}-\d{2}$/.test(expiryDate)) {
    const [y, m] = expiryDate.split('-').map(Number);
    targetDate = new Date(Date.UTC(y, m, 0));
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    const [y, m, d] = expiryDate.split('-').map(Number);
    targetDate = new Date(Date.UTC(y, m - 1, d));
  } else {
    return null;
  }

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffMs = targetDate.getTime() - todayUtc;
  return Math.floor(diffMs / 86_400_000);
}
