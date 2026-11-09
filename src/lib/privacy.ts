/** Merchant labels can carry UPI IDs or account numbers; neither may reach the AI model. */
export const scrub = (label: string) => (/@|\d(?:[\s.-]*\d){5}|\d{4}/.test(label) ? "[private payee]" : label); // 4 digits: card last-4 in labels like "Visa 4242".
/** Free text keeps its words but loses handles, long digit runs and bare 4-digit numbers (card last-4). Years and ₹ amounts stay. */
export const redact = (text: string) =>
  text
    .replace(/\S+@\S+/g, "[private]")
    .replace(/\d[\d\s.-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length >= 6 ? "[number]" : m))
    .replace(/(?<![\d,.]|₹ ?|Rs\.? ?|INR ?)(\d{4})(?![\d]|[,.]\d)/g, (m) => (/^(19|20)\d\d$/.test(m) ? m : "[number]"));

// Receipt-specific patterns remove structured payment identifiers and sensitive lines before AI calls.
// OCR splits identifiers with spaces, dots, commas, brackets or hyphens ("4111.1111.1111.1111", "name @okhdfcbank").
const UPI_ID = /(?<![\w.+-])[\w.+-]{1,64} ?@ ?[a-z][a-z.]{1,63}/gi;
const PRIVATE_RECEIPT_LINE =
  /\b(?:upi|vpa|card|a\s*\/\s*c|acct|account|ifsc|txn\s*id|ref\s*no|rrn|auth\s*code|approval|qr|scan\s+to\s+pay|pan)\b/i;
/** Prices up to ₹9,99,999.99, dates and times: what a receipt needs. keepable() checks the values. */
const KEEP =
  /(?<![\d.,-])(?:\d{1,3}(?:,\d{2,3})+\.\d{2}|\d{1,6}\.\d{2}|\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{2,4}|\d{1,2}:\d{2}(?::\d{2})?)(?![\d]|[-./,]\d)/g;
const DIGIT_CHAIN = /\d+(?:[ .,()/:-]{1,3}\d+)*/g;

function keepable(value: string): boolean {
  if (/^[\d,]+\.\d{2}$/.test(value)) return true;
  const parts = value.split(/[-./:]/).map(Number);
  if (value.includes(":")) return parts[0] < 24 && parts[1] < 60 && (parts[2] ?? 0) < 60;
  const [y, m, d] = value.split(/[-./]/)[0].length === 4 ? parts : [parts[2], parts[1], parts[0]];
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && (y < 100 || (y >= 1900 && y < 2100));
}

/**
 * 8+ digits with at most one separator between each ("12345678", "1234-5678"), 10+ digits across
 * groups with at most one single digit ("12 34 56 78 90", "+91 9 8765 43210"), or a card's 13+ in any grouping. Integer bill
 * columns ("2 725 1450") join single spaces between short groups, so they stay unless a group is long.
 */
function holdsIdentifier(text: string): boolean {
  for (const chain of text.match(/\d+(?:[ .,()/:-]{1,3}\d+)*/g) ?? []) {
    const groups = chain.match(/\d+/g) ?? [];
    const digits = groups.join("").length;
    if (groups.some((g) => g.length >= 8)) return true;
    if (digits >= 13 || (digits >= 10 && (groups.filter((g) => g.length === 1).length <= 1 || groups.every((g) => g.length === 1))))
      return true;
    if (digits >= 8 && groups.length === 2 && !/ /.test(chain)) return true;
  }
  return false;
}

/** Luhn checksum: every real card number passes it, however OCR grouped or punctuated the digits. */
function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    sum += n;
  }
  return sum % 10 === 0;
}

/** A card hidden by OCR punctuation ("4111 11.11 1111 1111"): 13–19 neighbouring digits that pass Luhn. */
function hidesCard(line: string): boolean {
  for (const chain of line.match(/\d+(?:[ .,()/:-]{1,3}\d+)*/g) ?? []) {
    const digits = chain.replace(/\D/g, "");
    if (digits.length < 13) continue;
    // Bill lines of price columns ("10.00 70.00 20.00 25.00") are prices, not a card.
    if (/^\d{1,7}\.\d{2}(?:[ ,]+\d{1,7}\.\d{2})+$/.test(chain)) continue;
    for (let from = 0; from + 13 <= digits.length; from++)
      for (let to = from + 13; to <= Math.min(digits.length, from + 19); to++) if (luhn(digits.slice(from, to))) return true;
  }
  return false;
}

/**
 * One line: prices, dates and times stay. If the other digits could hold a card, account or phone number,
 * every other multi-digit chain on the line goes. A card OCR'd entirely as price columns
 * ("41.11 11.11 11.11 11.11") reads as prices and stays.
 */
function dropLine(line: string, mark: string): string {
  const pieces: { text: string; keep: boolean }[] = [];
  let from = 0;
  for (const match of line.matchAll(KEEP)) {
    if (!keepable(match[0])) continue;
    pieces.push({ text: line.slice(from, match.index), keep: false }, { text: match[0], keep: true });
    from = match.index + match[0].length;
  }
  pieces.push({ text: line.slice(from), keep: false });
  const rest = pieces.filter((piece) => !piece.keep).map((piece) => piece.text);
  if (!rest.some(holdsIdentifier) && !hidesCard(line)) return line;
  return pieces
    .map((piece) => (piece.keep ? piece.text : piece.text.replace(DIGIT_CHAIN, (chain) => (/\d\D*\d/.test(chain) ? mark : chain))))
    .join("");
}

function dropIdentifiers(text: string, mark: string): string {
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(UPI_ID, mark)
    .split("\n")
    .map((line) => dropLine(line, mark))
    .join("\n");
}

/** Remove sensitive receipt lines and identifiers before text leaves this server. */
export function redactReceiptText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => !PRIVATE_RECEIPT_LINE.test(line))
    .join("\n");
  return dropIdentifiers(lines, "[number]")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 8000);
}

/** Drop card-like digit runs and UPI handles from an item name before it is stored. */
export function scrubItemName(name: string): string {
  return dropIdentifiers(name, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 120);
}
