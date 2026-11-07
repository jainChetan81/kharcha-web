// Enum values shared by the Drizzle schema and the zod validators. No drizzle import here:
// validators ship to the browser with their server functions, and this keeps the schema out of that bundle.
export const TXN_TYPES = ["income", "expense", "investment"] as const;
export const CATEGORY_TYPES = ["expense", "income"] as const;
export const SERIES_KINDS = ["subscription", "bill", "sip", "emi", "insurance"] as const;
export const HOLDING_KINDS = ["fund", "gold", "nps", "other"] as const;
export const REIMBURSEMENT_STATUSES = ["pending", "partly", "reimbursed", "extra", "cancelled"] as const;
