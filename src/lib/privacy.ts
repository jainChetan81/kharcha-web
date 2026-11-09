/** Merchant labels can carry UPI IDs or account numbers; neither may reach the AI model. */
export const scrub = (label: string) => (/@|\d(?:[\s.-]*\d){5}|\d{4}/.test(label) ? "[private payee]" : label); // 4 digits: card last-4 in labels like "Visa 4242".
/** Free text keeps its words but loses handles, long digit runs and bare 4-digit numbers (card last-4). Years and ₹ amounts stay. */
export const redact = (text: string) =>
  text
    .replace(/\S+@\S+/g, "[private]")
    .replace(/\d[\d\s.-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length >= 6 ? "[number]" : m))
    .replace(/(?<![\d,.]|₹ ?|Rs\.? ?|INR ?)(\d{4})(?![\d]|[,.]\d)/g, (m) => (/^(19|20)\d\d$/.test(m) ? m : "[number]"));

// Receipt-specific patterns remove structured payment identifiers and sensitive lines before AI calls.
const CARD_RUN = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;
const UPI_ID = /[\w.+-]+@[a-z]{2,}/gi;
const PRIVATE_RECEIPT_LINE =
  /\b(?:upi|vpa|card|a\s*\/\s*c|acct|account|ifsc|txn\s*id|ref\s*no|rrn|auth\s*code|approval|qr|scan\s+to\s+pay|pan)\b/i;

/** Remove sensitive receipt lines and identifiers before text leaves this server. */
export function redactReceiptText(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !PRIVATE_RECEIPT_LINE.test(line))
    .join("\n")
    .replace(CARD_RUN, "[number]")
    .replace(/(?<![\d,.])\d{9,}(?![\d,.])/g, "[number]")
    .replace(UPI_ID, "[id]")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 8000);
}

/** Drop card-like digit runs and UPI handles from an item name before it is stored. */
export function scrubItemName(name: string): string {
  return name
    .replace(CARD_RUN, " ")
    .replace(UPI_ID, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 120);
}
