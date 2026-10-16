// Copied from kharcha-mini/src/parsers/utils.ts; kept in sync with mini parser behavior.
export const DATE_TIME_FORMAT = "yyyy-MM-dd HH:mm";

export interface ParsedTransaction {
  amount: number;
  merchant: string;
  date: string | null;
  type: "expense" | "income" | "investment";
  category?: string;
  confidence?: "high" | "medium" | "low";
  isSubscription?: boolean;
  billingDay?: number | null;
  /** Bank reference / UTR / RRN extracted from the alert text. */
  referenceNumber?: string | null;
  /** Last 4 digits of the account/card used. */
  accountLast4?: string | null;
  /** ISO 4217 code when the SMS states a non-INR currency (e.g. "USD").
   * Undefined/"INR" means the amount is already INR. */
  currency?: string | null;
  /** Amount in `currency` exactly as the SMS states it (foreign spends). */
  originalAmount?: number | null;
  /** Set when the stored INR amount was derived via a fallback FX rate and
   * should be surfaced for human review. */
  needsReview?: boolean;
}

export type Parser = (body: string) => ParsedTransaction | null;

export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Current datetime as the standard fallback when no date can be extracted. */
export function fallbackNow(): string {
  return formatDate(new Date());
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3,
  april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

function makeDate(year: number, month: number, day: number, time?: string): Date | null {
  const [hours = 0, minutes = 0, seconds = 0] = time ? time.split(":").map(Number) : [];
  if (month < 0 || month > 11 || day < 1 || day > 31 || hours > 23 || minutes > 59 || seconds > 59) return null;
  const date = new Date(year, month, day, hours, minutes, seconds);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

function parseDate(raw: string, time?: string): Date | null {
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return makeDate(+match[1], +match[2] - 1, +match[3], time);

  match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
  if (match) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return makeDate(year, Number(match[2]) - 1, Number(match[1]), time);
  }

  match = raw.match(/^(\d{1,2})[\s\-/]*([A-Za-z]+)[\s\-/,]*(\d{2}|\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (month === undefined) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return makeDate(year, month, Number(match[1]), time);
}

export function parseIndianDate(raw: string, rawTime?: string): string | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const time = rawTime?.trim();
  const withTime = time && /^\d{2}:\d{2}:\d{2}$/.test(time) ? parseDate(cleaned, time) : null;
  if (withTime) return formatDate(withTime);
  const withoutTime = parseDate(cleaned.replace(/\s+/g, ""));
  return withoutTime ? formatDate(withoutTime) : null;
}

export function parseAxisDate(rawDate: string, rawTime?: string): string | null {
  return parseIndianDate(rawDate, rawTime);
}

export function parseHdfcDate(rawDate: string, rawTime?: string): string | null {
  return parseIndianDate(rawDate, rawTime);
}

export function parseAmount(str: string): number {
  return Number.parseFloat(str.replace(/,/g, ""));
}

/** Regex that extracts a date after "on" — covers common Indian banking formats. */
export const DATE_REGEX =
  /on\s+(\d{2}\s*\w{3}\s*\d{2,4}|\d{2}[-/]\w{3}[-/]\d{2,4}|\d{2}[-/]\d{2}[-/]\d{2,4}|\d{2}\s+\w{3}\s+\d{4})/i;

/** Regex that extracts a merchant name after at/towards. */
export const MERCHANT_REGEX =
  /(?:at|towards)\s+([A-Za-z][\w\s./-]{2,40}?)(?:\s+on\s|\s+dated|\s*$)/i;

export function tryParsers(parsers: Parser[], body: string): ParsedTransaction | null {
  for (const parser of parsers) {
    const result = parser(body);
    if (result) return result;
  }
  return null;
}

// --- Reference-number helpers (SMS-specific additions) ---

const AXIS_REF_PATTERNS = [
  /(?:Ref\s*(?:No|Number)|RRN|UTR)[.:\s#]+([A-Z0-9]{6,20})/i,
];

const HDFC_REF_PATTERNS = [
  /(?:Ref\s*(?:No|Number)|UTR|RRN)[.:\s#]+([A-Z0-9]{6,22})/i,
  /(?:UPI\s*Ref|IMPS\s*Ref)[.:\s#]+([A-Z0-9]{6,22})/i,
  /(?:Txn\s*ID|Transaction\s*ID)[.:\s#]+([A-Z0-9]{6,22})/i,
];

const INDUSIND_REF_PATTERNS = [
  /(?:Ref\s*(?:No|Number)|UTR|RRN|IMPS\s*Ref\s*no)[.:\s#]+([A-Z0-9]{6,22})/i,
  /UPI\/([\d]{6,20})/i,
];

/** Scan an alert for a plausible reference / UTR / RRN string. */
export function extractReferenceNumber(body: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) {
      const ref = match[1].trim();
      if (/^[A-Z0-9]{6,}$/i.test(ref)) return ref.toUpperCase();
    }
  }
  return null;
}

export const REFERENCE_PATTERNS: Record<string, RegExp[]> = {
  axis: AXIS_REF_PATTERNS,
  hdfc: HDFC_REF_PATTERNS,
  indusind: INDUSIND_REF_PATTERNS,
};

/** Extract the last 4 digits of an account or card number when explicitly present. */
export function extractAccountLast4(body: string): string | null {
  const match = body.match(/(?:ending|XX|a\/c\s*no\.?\s*X+)(\d{4})/i);
  return match?.[1] ?? null;
}
